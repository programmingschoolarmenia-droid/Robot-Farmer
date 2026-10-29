// Player accounts: registration / login, the saved farm and the leaderboard.
// With Firebase keys in config/settings.json → online, everything goes through the Firebase REST
// APIs (Auth + Firestore, no SDK). Without keys, accounts live only in this browser.
// The farm is always also kept in this browser, so the game keeps working without internet.
import { weekKey } from '../core/util.js';

export const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
export const MIN_PASSWORD = 6;
const SESSION_KEY = 'session.v1';
const saveKey = (id) => `save.v2.${id}`;

// code: nameInvalid | passwordShort | nameTaken | badLogin | offline | tooMany | config | relogin | unknown
export class AccountError extends Error {
  constructor(code, detail = '') {
    super(detail || code);
    this.name = 'AccountError';
    this.code = code;
  }
}

// The public leaderboard row of a player (players/{id}); `s` comes from Game.leaderStats().
// Day and month points are stored under dated fields (d20261028, m202610), so a new day starts
// an empty list without deleting anything; yesterday's field stays for the champion's crown.
const MAX_CODE = 6000; // characters of challenge code kept in the row
export function playerRow(name, s) {
  const row = { name, hat: s.hat, farm: s.farm, research: s.research, playSeconds: Math.floor(s.playSeconds), points: Math.floor(s.points), code: s.code, streak: s.streak, streakDay: s.day.key };
  for (const [prefix, periods] of [['d', [s.day, s.prevDay]], ['m', [s.month, s.prevMonth]]]) {
    for (const p of periods) if (p && p.key && p.points >= 1) row[prefix + p.key] = Math.floor(p.points);
  }
  if (s.perfect >= 1) row.perfect = s.perfect; // Perfection %
  if (s.festival && s.festival.found >= 1) row[`f${s.festival.key}`] = s.festival.found; // objects found in the latest festival
  // the weekly challenge (this week's and last week's): the best time in tenths of a second and its code
  for (const c of s.challenge ? [s.challenge, s.challenge.prev] : []) {
    if (c && c.best >= 1) Object.assign(row, { [`c${c.week}`]: c.best, [`cc${c.week}`]: String(c.bestCode).slice(0, MAX_CODE) });
  }
  // ֏ earned on the ranch: all time, and this day and month (like the points)
  const r = s.ranch;
  if (r && r.total >= 1) {
    row.ranch = Math.floor(r.total);
    if (r.day.key && r.day.dram >= 1) row[`rd${r.day.key}`] = Math.floor(r.day.dram);
    if (r.month.key && r.month.dram >= 1) row[`rm${r.month.key}`] = Math.floor(r.month.dram);
  }
  return row;
}

// The row field a leaderboard list ranks by (today = 'YYYYMMDD'): points of the 'day', the
// 'month' or 'all' time, 'code', 'perfect', this week's 'challenge' (lower is better, see
// ASCENDING), the running 'festival' (`festival` = its key, e.g. 'Easter2026') or ֏ earned on the
// ranch ('ranch_day', 'ranch_month', 'ranch_all').
export function boardField(tab, today, festival = '') {
  if (tab === 'day') return `d${today}`;
  if (tab === 'month') return `m${today.slice(0, 6)}`;
  if (tab === 'challenge') return `c${weekKey(today)}`;
  if (tab === 'festival') return `f${festival}`;
  if (tab === 'ranch_day') return `rd${today}`;
  if (tab === 'ranch_month') return `rm${today.slice(0, 6)}`;
  if (tab === 'ranch_all') return 'ranch';
  return tab === 'code' || tab === 'perfect' ? tab : 'points';
}

// Lists where the smallest number is the best (the challenge times).
export const ascending = (field) => /^c\d/.test(field);

// Upgrades old save formats. (Only version 1 exists so far.)
export function migrateSave(save) {
  if (!save || typeof save !== 'object') return save;
  if (!save.v) save.v = 1;
  return save;
}

function readJSON(adapter, key) {
  try {
    return JSON.parse(adapter.get(key)) || null;
  } catch {
    return null;
  }
}

export class Accounts {
  constructor(adapter, online = {}) {
    this.adapter = adapter;
    this.online = !!(online.apiKey && online.projectId);
    this.backend = this.online ? new FirebaseBackend(online) : new LocalBackend(adapter);
    this.limit = online.leaderboardSize || 50;
    this.session = readJSON(adapter, SESSION_KEY);
    this.cache = new Map(); // leaderboard field -> { at, rows }
  }

  get user() {
    return this.session ? { id: this.session.id, name: this.session.name } : null;
  }

  async register(name, password) {
    const n = String(name || '').trim();
    if (!NAME_RE.test(n)) throw new AccountError('nameInvalid');
    if (String(password || '').length < MIN_PASSWORD) throw new AccountError('passwordShort');
    return this.start(await this.backend.signUp(n.toLowerCase(), password, n));
  }

  async login(name, password) {
    const n = String(name || '').trim();
    if (!NAME_RE.test(n)) throw new AccountError('nameInvalid');
    if (!password) throw new AccountError('badLogin');
    return this.start(await this.backend.signIn(n.toLowerCase(), password, n));
  }

  start(session) {
    this.session = session;
    this.persist();
    return this.user;
  }

  persist() {
    if (this.session) this.adapter.set(SESSION_KEY, JSON.stringify(this.session));
  }

  logout() {
    this.session = null;
    this.adapter.remove(SESSION_KEY);
  }

  // The newer of this browser's copy and the online copy; null for a new farm.
  // Without internet the browser copy is used; with neither copy it throws (so a fresh farm
  // never overwrites an online one).
  async loadSave() {
    const local = readJSON(this.adapter, saveKey(this.session.id));
    let remote = null;
    try {
      remote = await this.backend.getSave(this.session);
      this.persist();
    } catch (e) {
      if (!local || e.code === 'relogin') throw e;
      console.warn('Online save not loaded, using this browser copy:', e);
    }
    const best = remote && (!local || (remote.updated || 0) > (local.updated || 0)) ? remote : local;
    return best ? migrateSave(best) : null;
  }

  saveLocal(data) {
    data.updated = Date.now();
    return this.adapter.set(saveKey(this.session.id), JSON.stringify(data));
  }

  // stats: Game.leaderStats() for the leaderboard row.
  async saveOnline(data, stats, keepalive = false) {
    const session = this.session;
    if (!session) return;
    await this.backend.putSave(session, data, playerRow(session.name, stats), keepalive);
    this.cache.clear(); // my row changed
    if (this.session === session) this.persist();
  }

  // { rows, place, rival } for the list ranked by `field` (only players with more than 0).
  // With `me` ({ id, value }): my place and the closest player above me (null when nobody is, and
  // in a challenge list when I am not in it). A list is reused for a minute (until my next save),
  // so switching tabs costs nothing; `fresh` asks again.
  async leaderboard(field, me = null, fresh = false) {
    const asc = ascending(field);
    let c = this.cache.get(field);
    if (fresh || !c || Date.now() - c.at > 60000) {
      c = { at: Date.now(), rows: await this.backend.query(field, 0, asc, this.limit) };
      this.cache.set(field, c);
    }
    const rows = c.rows;
    if (!me) return { rows, place: 0, rival: null };
    const i = rows.findIndex((r) => r.id === me.id);
    if (i >= 0) return { rows, place: i + 1, rival: rows.slice(0, i).reverse().find((r) => (asc ? r[field] < me.value : r[field] > me.value)) || null };
    if (asc) return { rows, place: me.value > 0 ? await this.place(field, me.value) : 0, rival: null };
    const [above, rival] = await Promise.all([this.backend.count(field, me.value), this.backend.query(field, me.value, true, 1)]);
    return { rows, place: above + 1, rival: rival[0] || null };
  }

  // My place (1 = first) in the list of `field` with `value`. The counts only ask «more than», so
  // a challenge place is 1 + (all times) − (times of `value` or more); times are whole tenths.
  async place(field, value) {
    if (!ascending(field)) return 1 + (await this.backend.count(field, value));
    const [all, from] = await Promise.all([this.backend.count(field, 0), this.backend.count(field, value - 1)]);
    return 1 + all - from;
  }

  // The best `n` rows of a list (for the prizes of a finished week or festival).
  top(field, n = 3) {
    return this.backend.query(field, 0, ascending(field), n);
  }

  // The #1 rows of yesterday's, last month's and last week's challenge lists: { day, month, week }
  // (null when empty).
  champions(dayField, monthField, weekField) {
    const key = `${dayField}/${monthField}/${weekField}`;
    if (!this.champs || this.champs.key !== key) {
      const first = (f) => (f ? this.top(f, 1).then((rows) => rows[0] || null) : null);
      const entry = { key, promise: Promise.all([first(dayField), first(monthField), first(weekField)]).then(([day, month, week]) => ({ day, month, week })) };
      entry.promise.catch(() => this.champs === entry && (this.champs = null)); // ask again next time
      this.champs = entry;
    }
    return this.champs.promise;
  }
}

// ---------------------------------------------------------------------------- Firebase (REST)

const FIREBASE_ERRORS = {
  EMAIL_EXISTS: 'nameTaken',
  INVALID_LOGIN_CREDENTIALS: 'badLogin',
  INVALID_PASSWORD: 'badLogin',
  EMAIL_NOT_FOUND: 'badLogin',
  USER_DISABLED: 'badLogin',
  WEAK_PASSWORD: 'passwordShort',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'tooMany',
  OPERATION_NOT_ALLOWED: 'config',
  CONFIGURATION_NOT_FOUND: 'config',
  PROJECT_NOT_FOUND: 'config',
  TOKEN_EXPIRED: 'relogin',
  USER_NOT_FOUND: 'relogin',
  INVALID_REFRESH_TOKEN: 'relogin',
  UNAUTHENTICATED: 'relogin',
  PERMISSION_DENIED: 'config',
  RESOURCE_EXHAUSTED: 'tooMany',
};

function firebaseCode(error = {}) {
  const msg = String(error.message || '');
  const code = FIREBASE_ERRORS[msg.split(/[\s:]/)[0]] || FIREBASE_ERRORS[error.status];
  if (code) return code;
  return /API key|does not exist/i.test(msg) ? 'config' : 'unknown';
}

async function call(url, { body, token, keepalive, missingOk } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body && JSON.stringify(body),
      keepalive,
    });
  } catch {
    throw new AccountError('offline');
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  if (missingOk && res.status === 404 && !/does not exist/i.test(data.error && data.error.message)) return null;
  throw new AccountError(firebaseCode(data.error), data.error && data.error.message);
}

const int = (n) => ({ integerValue: String(Math.floor(n)) });
const encode = (v) => (typeof v === 'number' ? int(v) : { stringValue: String(v) });
const decode = (v) => ('integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue : v.stringValue);
const above = (field, min) => ({ fieldFilter: { field: { fieldPath: field }, op: 'GREATER_THAN', value: int(min) } });

class FirebaseBackend {
  constructor({ apiKey, projectId, emailDomain }) {
    this.key = apiKey;
    this.domain = emailDomain || 'bridgys-farm.app';
    this.docs = `projects/${projectId}/databases/(default)/documents`;
    this.url = `https://firestore.googleapis.com/v1/${this.docs}`;
  }

  async auth(method, body, id, name) {
    const r = await call(`https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${this.key}`, {
      body: { ...body, email: `${id}@${this.domain}`, returnSecureToken: true },
    });
    return { id, name: r.displayName || name, idToken: r.idToken, refreshToken: r.refreshToken, expires: Date.now() + Number(r.expiresIn || 3600) * 1000 };
  }

  signUp(id, password, name) {
    return this.auth('signUp', { password, displayName: name }, id, name);
  }

  signIn(id, password, name) {
    return this.auth('signInWithPassword', { password }, id, name);
  }

  // ID tokens live one hour; the refresh token gets a new one.
  async token(s) {
    if (s.idToken && Date.now() < s.expires - 60000) return s.idToken;
    const r = await call(`https://securetoken.googleapis.com/v1/token?key=${this.key}`, {
      body: { grantType: 'refresh_token', refreshToken: s.refreshToken },
    });
    Object.assign(s, { idToken: r.id_token, refreshToken: r.refresh_token, expires: Date.now() + Number(r.expires_in || 3600) * 1000 });
    return s.idToken;
  }

  async getSave(s) {
    const doc = await call(`${this.url}/saves/${s.id}`, { token: await this.token(s), missingOk: true });
    return doc && doc.fields ? JSON.parse(doc.fields.data.stringValue) : null;
  }

  // The farm and the leaderboard row are written together (the row replaces the old one).
  async putSave(s, data, row, keepalive) {
    const update = (collection, fields) => ({ update: { name: `${this.docs}/${collection}/${s.id}`, fields } });
    await call(`${this.url}:commit`, {
      token: await this.token(s),
      keepalive,
      body: {
        writes: [
          update('saves', { data: { stringValue: JSON.stringify(data) } }),
          update('players', Object.fromEntries(Object.entries(row).map(([k, v]) => [k, encode(v)]))),
        ],
      },
    });
  }

  // Rows whose `field` is above `min`, sorted by it. Firestore indexes every field by itself,
  // so the dated day / month fields need no setup.
  async query(field, min, asc, limit) {
    const res = await call(`${this.url}:runQuery?key=${this.key}`, {
      body: {
        structuredQuery: {
          from: [{ collectionId: 'players' }],
          where: above(field, min),
          orderBy: [{ field: { fieldPath: field }, direction: asc ? 'ASCENDING' : 'DESCENDING' }],
          limit,
        },
      },
    });
    return res
      .filter((r) => r.document)
      .map(({ document: d }) => ({ id: d.name.split('/').pop(), ...Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, decode(v)])) }));
  }

  async count(field, min) {
    const res = await call(`${this.url}:runAggregationQuery?key=${this.key}`, {
      body: {
        structuredAggregationQuery: {
          structuredQuery: { from: [{ collectionId: 'players' }], where: above(field, min) },
          aggregations: [{ alias: 'n', count: {} }],
        },
      },
    });
    return Number(res[0].result.aggregateFields.n.integerValue);
  }
}

// ---------------------------------------------------------------------------- this browser only

async function hashPassword(salt, password) {
  const text = salt + password;
  if (globalThis.crypto && crypto.subtle) {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // crypto.subtle only exists on https / localhost (e.g. not on a plain-http school server).
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return `fnv-${h.toString(16)}`;
}

class LocalBackend {
  constructor(adapter) {
    this.adapter = adapter;
  }

  table(key) {
    return readJSON(this.adapter, key) || {};
  }

  async signUp(id, password, name) {
    const users = this.table('users.v1');
    if (users[id]) throw new AccountError('nameTaken');
    const salt = Math.random().toString(36).slice(2);
    users[id] = { name, salt, hash: await hashPassword(salt, password) };
    this.adapter.set('users.v1', JSON.stringify(users));
    return { id, name };
  }

  async signIn(id, password) {
    const u = this.table('users.v1')[id];
    if (!u || u.hash !== (await hashPassword(u.salt, password))) throw new AccountError('badLogin');
    return { id, name: u.name };
  }

  async getSave() {
    return null; // the browser copy is the only copy
  }

  async putSave(s, data, row) {
    const players = this.table('players.v1');
    players[s.id] = row;
    this.adapter.set('players.v1', JSON.stringify(players));
  }

  async query(field, min, asc, limit) {
    return Object.entries(this.table('players.v1'))
      .map(([id, p]) => ({ id, ...p }))
      .filter((r) => r[field] > min)
      .sort((a, b) => (asc ? a[field] - b[field] : b[field] - a[field]))
      .slice(0, limit);
  }

  async count(field, min) {
    return (await this.query(field, min, true, Infinity)).length;
  }
}
