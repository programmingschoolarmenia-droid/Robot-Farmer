// Player accounts: registration / login, the saved farm and the leaderboard.
// With Firebase keys in config/settings.json → online, everything goes through the Firebase REST
// APIs (Auth + Firestore, no SDK). Without keys, accounts live only in this browser.
// The farm is always also kept in this browser, so the game keeps working without internet.

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

// Leaderboard order: more research first, then less play time.
export const scoreOf = (research, playSeconds) => research * 1e7 - Math.min(Math.floor(playSeconds), 1e7 - 1);

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

  // stats: { research, playSeconds } for the leaderboard.
  async saveOnline(data, stats, keepalive = false) {
    const session = this.session;
    if (!session) return;
    await this.backend.putSave(session, data, stats, keepalive);
    if (this.session === session) this.persist();
  }

  // { rows: [{ id, name, research, playSeconds }], place } — place is 0 when `me` is not given.
  async leaderboard(me = null) {
    const rows = await this.backend.top(this.limit);
    let place = 0;
    if (me) {
      const i = rows.findIndex((r) => r.id === me.id);
      place = i >= 0 ? i + 1 : 1 + (await this.backend.countAbove(scoreOf(me.research, me.playSeconds)));
    }
    return { rows, place };
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

  // The farm and the leaderboard row are written together.
  async putSave(s, data, stats, keepalive) {
    const update = (collection, fields) => ({ update: { name: `${this.docs}/${collection}/${s.id}`, fields } });
    await call(`${this.url}:commit`, {
      token: await this.token(s),
      keepalive,
      body: {
        writes: [
          update('saves', { data: { stringValue: JSON.stringify(data) } }),
          update('players', {
            name: { stringValue: s.name },
            research: int(stats.research),
            playSeconds: int(stats.playSeconds),
            score: int(scoreOf(stats.research, stats.playSeconds)),
          }),
        ],
      },
    });
  }

  async top(limit) {
    const res = await call(`${this.url}:runQuery?key=${this.key}`, {
      body: { structuredQuery: { from: [{ collectionId: 'players' }], orderBy: [{ field: { fieldPath: 'score' }, direction: 'DESCENDING' }], limit } },
    });
    return res
      .filter((r) => r.document)
      .map(({ document: d }) => ({
        id: d.name.split('/').pop(),
        name: d.fields.name.stringValue,
        research: Number(d.fields.research.integerValue),
        playSeconds: Number(d.fields.playSeconds.integerValue),
      }));
  }

  async countAbove(score) {
    const res = await call(`${this.url}:runAggregationQuery?key=${this.key}`, {
      body: {
        structuredAggregationQuery: {
          structuredQuery: { from: [{ collectionId: 'players' }], where: { fieldFilter: { field: { fieldPath: 'score' }, op: 'GREATER_THAN', value: int(score) } } },
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

  async putSave(s, data, stats) {
    const players = this.table('players.v1');
    players[s.id] = { name: s.name, research: stats.research, playSeconds: Math.floor(stats.playSeconds) };
    this.adapter.set('players.v1', JSON.stringify(players));
  }

  async top(limit) {
    return Object.entries(this.table('players.v1'))
      .map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => scoreOf(b.research, b.playSeconds) - scoreOf(a.research, a.playSeconds))
      .slice(0, limit);
  }

  async countAbove(score) {
    return Object.values(this.table('players.v1')).filter((p) => scoreOf(p.research, p.playSeconds) > score).length;
  }
}
