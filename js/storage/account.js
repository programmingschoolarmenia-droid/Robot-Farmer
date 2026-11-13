// Player accounts: registration / login, the saved farm and the leaderboard.
// With Firebase keys in config/settings.json → online, everything goes through the Firebase REST
// APIs (Auth + Firestore, no SDK). Without keys, accounts live only in this browser.
// The farm is always also kept in this browser, so the game keeps working without internet.
import { weekKey } from '../core/util.js';

export const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
export const MIN_PASSWORD = 6;
const SESSION_KEY = 'session.v1';
const saveKey = (id) => `save.v2.${id}`;
// A guest plays without an account: one farm per browser, only in this browser, nothing online.
// '~' can't be in a username, so no player's farm shares its key.
const GUEST_ID = '~guest';

// code: nameInvalid | passwordShort | nameTaken | badLogin | offline | tooMany | config | relogin | unknown
//   | stale (an older tab after a trade) | gone (the order was just taken or removed) | hasOrders
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
export const CARPET_RE = /^[A-Z]{81}$/; // a finished carpet's knots
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
  // perfect carpets (all time, this day and month), the favourite carpet and the New Game Plus level
  const g = s.carpets;
  if (g && g.total >= 1) {
    row.carpets = g.total;
    if (g.day.key && g.day.n >= 1) row[`gd${g.day.key}`] = g.day.n;
    if (g.month.key && g.month.n >= 1) row[`gm${g.month.key}`] = g.month.n;
  }
  if (s.favorite) row.carpet = s.favorite;
  if (s.ranchPlus >= 1) row.ranchPlus = s.ranchPlus;
  // the ranch's weekly challenge (this week's and last week's)
  for (const c of s.ranchChallenge ? [s.ranchChallenge, s.ranchChallenge.prev] : []) {
    if (c && c.best >= 1) Object.assign(row, { [`rc${c.week}`]: c.best, [`rcc${c.week}`]: String(c.bestCode).slice(0, MAX_CODE) });
  }
  return row;
}

// The row field a leaderboard list ranks by (today = 'YYYYMMDD'): points of the 'day', the
// 'month' or 'all' time, 'code', 'perfect', this week's 'challenge' or 'ranchChallenge' (lower is
// better, see `ascending`), the running 'festival' (`festival` = its key, e.g. 'Easter2026'), ֏ earned
// on the ranch ('ranch_day', 'ranch_month', 'ranch_all') or perfect carpets ('carpets_day', …).
export function boardField(tab, today, festival = '') {
  if (tab === 'day') return `d${today}`;
  if (tab === 'month') return `m${today.slice(0, 6)}`;
  if (tab === 'challenge') return `c${weekKey(today)}`;
  if (tab === 'ranchChallenge') return `rc${weekKey(today)}`;
  if (tab === 'carpets_day') return `gd${today}`;
  if (tab === 'carpets_month') return `gm${today.slice(0, 6)}`;
  if (tab === 'carpets_all') return 'carpets';
  if (tab === 'festival') return `f${festival}`;
  if (tab === 'ranch_day') return `rd${today}`;
  if (tab === 'ranch_month') return `rm${today.slice(0, 6)}`;
  if (tab === 'ranch_all') return 'ranch';
  return tab === 'code' || tab === 'perfect' ? tab : 'points';
}

// Lists where the smallest number is the best (the challenge times).
export const ascending = (field) => /^r?c\d/.test(field);

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
    this.admins = (online.admins || []).map((a) => String(a).toLowerCase());
    this.session = readJSON(adapter, SESSION_KEY);
    this.cache = new Map(); // leaderboard field -> { at, rows }
  }

  get user() {
    return this.session ? { id: this.session.id, name: this.session.name } : null;
  }

  get isGuest() {
    return !!this.session && this.session.guest === true;
  }

  // name: what the game shows for a guest («Հյուր»).
  startGuest(name) {
    return this.start({ id: GUEST_ID, name, guest: true });
  }

  hasGuestFarm() {
    return this.adapter.get(saveKey(GUEST_ID)) !== null;
  }

  dropGuestFarm() {
    this.adapter.remove(saveKey(GUEST_ID));
  }

  // The guest keeps the farm: a new account gets it (here at once, online at the next save), and
  // the guest farm leaves this browser.
  async keepGuestFarm(name, password, data) {
    const user = await this.register(name, password);
    this.adapter.set(saveKey(user.id), JSON.stringify(data));
    this.dropGuestFarm();
    return user;
  }

  // Teachers (settings.json → online.admins) can delete any player from the leaderboard.
  get isAdmin() {
    return !!this.session && this.admins.includes(this.session.id);
  }

  // The player's farm and row go, and the username is blocked: an open game of that player is
  // logged out at its next save.
  async removePlayer(id) {
    if (!this.isAdmin || id === this.session.id) throw new AccountError('unknown', 'not allowed');
    await this.backend.removePlayer(this.session, id);
    this.cache.clear();
  }

  // A forgotten password: the student registers a new name, then the teacher moves the old farm,
  // points and row there. The old name is blocked like a delete (its online farm stays as a backup).
  async moveFarm(fromId, toName) {
    const to = String(toName || '').trim().toLowerCase();
    if (!this.isAdmin || fromId === this.session.id) throw new AccountError('unknown', 'not allowed');
    if (!NAME_RE.test(to) || to === fromId) throw new AccountError('nameInvalid');
    await this.backend.moveFarm(this.session, fromId, to);
    this.cache.clear();
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

  // A new username (login too): the password is checked, a new account gets the farm and the
  // leaderboard row, then the old account and its documents are removed. If removing fails, the
  // new account still works (the teacher can delete the old one).
  async rename(name, password, data, stats) {
    const n = String(name || '').trim();
    if (!NAME_RE.test(n)) throw new AccountError('nameInvalid');
    const id = n.toLowerCase();
    if (id === this.session.id) throw new AccountError('nameTaken');
    // Orders belong to the name: they would be left without an owner.
    const orders = await this.myOrders().catch((e) => {
      if (e.code === 'config') return []; // the rules have no market part yet, so no orders either
      throw e;
    });
    if (orders.length) throw new AccountError('hasOrders');
    const old = await this.backend.signIn(this.session.id, password, this.session.name);
    const fresh = await this.backend.signUp(id, password, n);
    try {
      await this.backend.putSave(fresh, data, playerRow(n, stats));
    } catch (e) {
      await this.backend.remove(fresh).catch((err) => console.warn('New account not removed:', err));
      throw e;
    }
    this.adapter.set(saveKey(id), JSON.stringify(data));
    this.forget(old.id);
    this.start(fresh);
    this.cache.clear();
    await this.backend.remove(old).catch((e) => console.warn('Old account not removed:', e));
    return this.user;
  }

  // The player deletes their own account (Google Play asks for this): the password again for a fresh
  // login, then everything of theirs goes (see erase()) and this browser forgets the farm. Not a
  // teacher: a student could then register the teacher's name.
  async deleteMe(password) {
    if (!this.session || this.isGuest || this.isAdmin) throw new AccountError('unknown', 'not allowed');
    if (!password) throw new AccountError('badLogin');
    const s = await this.backend.signIn(this.session.id, password, this.session.name);
    await this.backend.erase(s);
    this.forget(s.id);
    this.cache.clear();
  }

  // The teacher deleted the account: this browser forgets its farm too.
  forget(id) {
    this.adapter.remove(saveKey(id));
    if (this.session && this.session.id === id) this.logout();
  }

  // The newer of this browser's copy and the online copy; null for a new farm.
  // Without internet the browser copy is used; with neither copy it throws (so a fresh farm
  // never overwrites an online one).
  async loadSave() {
    const local = readJSON(this.adapter, saveKey(this.session.id));
    if (this.isGuest) return local ? migrateSave(local) : null;
    let remote = null;
    try {
      remote = await this.backend.getSave(this.session);
      this.persist();
    } catch (e) {
      if (e.code === 'deleted') this.forget(this.session.id);
      if (!local || e.code === 'relogin' || e.code === 'deleted') throw e;
      console.warn('Online save not loaded, using this browser copy:', e);
    }
    // A trade raises `rev`: a copy from before it would bring sold goods back, however new it is.
    const ahead = remote && local ? (remote.rev || 0) - (local.rev || 0) : 0;
    const best = remote && (!local || ahead > 0 || (ahead === 0 && (remote.updated || 0) > (local.updated || 0))) ? remote : local;
    return best ? migrateSave(best) : null;
  }

  saveLocal(data) {
    data.updated = Date.now();
    return this.adapter.set(saveKey(this.session.id), JSON.stringify(data));
  }

  // stats: Game.leaderStats() for the leaderboard row.
  async saveOnline(data, stats, keepalive = false) {
    const session = this.session;
    if (!session || session.guest) return;
    try {
      await this.backend.putSave(session, data, playerRow(session.name, stats), keepalive);
    } catch (e) {
      if (e.code === 'deleted') this.forget(session.id);
      // Refused: is this an older tab, from before a trade made somewhere else?
      if (e.code === 'config') {
        const now = await this.backend.getSave(session).catch(() => null);
        if (now && (now.rev || 0) > (data.rev || 0)) throw new AccountError('stale');
      }
      throw e;
    }
    this.cache.clear(); // my row changed
    if (this.session === session) this.persist();
  }

  // ---- the player market: orders/{owner}~{at}. Each step writes my farm and the order together.

  // op: { id, fields } a new order, { order, fields } changes it, { order } closes it.
  async tradeSave(data, stats, op) {
    const session = this.session;
    try {
      await this.backend.tradeSave(session, data, playerRow(session.name, stats), op);
    } catch (e) {
      if (e.code === 'deleted') this.forget(session.id);
      throw e;
    }
    this.cache.clear();
    this.persist();
  }

  // Orders placed after `since`, the newest first.
  orders(since) {
    return this.backend.orders(since);
  }

  myOrders() {
    return this.backend.ordersOf(this.session.id);
  }

  // Teachers take an order off the list; its owner's game returns the goods.
  removeOrder(order) {
    if (!this.isAdmin) return Promise.reject(new AccountError('unknown', 'not allowed'));
    return this.backend.orderWrite(this.session, { order, fields: { status: 'removed' } });
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

  // ---- the weekly carpet contest: one entry a player, one like per carpet and voter

  // This week's entries, the most liked first: [{ id, name, cells, likes, liked, at }].
  async contest(week) {
    const me = this.session && this.session.id;
    const [entries, likes] = await Promise.all([this.backend.contestEntries(week), this.backend.contestLikes(week)]);
    return entries
      .filter((e) => CARPET_RE.test(e.cells))
      .map((e) => {
        const mine = likes.filter((l) => l.owner === e.id);
        return { ...e, likes: mine.length, liked: mine.some((l) => l.voter === me) };
      })
      .sort((a, b) => b.likes - a.likes || a.at - b.at);
  }

  enterContest(week, cells) {
    return this.backend.contestEnter(this.session, week, cells, Date.now());
  }

  likeCarpet(week, owner) {
    if (!this.session || owner === this.session.id) return Promise.reject(new AccountError('unknown', 'not allowed'));
    return this.backend.contestLike(this.session, week, owner);
  }

  // Teachers take a carpet out of the contest.
  removeEntry(week, owner) {
    if (!this.isAdmin) return Promise.reject(new AccountError('unknown', 'not allowed'));
    return this.backend.contestRemove(this.session, week, owner);
  }

  // ---- reports: a player reports another player or a contest carpet; only the teachers read them.
  // what: { kind: 'player' | 'carpet', target (id), name, week (a carpet's), cells (the carpet) }.
  // Resolves to the key the reporter hides: the player's id, or «week~id» for a carpet.
  async report({ kind, target, name, week, cells }) {
    const s = this.session;
    if (!s || this.isGuest || target === s.id) throw new AccountError('unknown', 'not allowed');
    const key = kind === 'carpet' ? `${week}~${target}` : target;
    const fields = { reporter: s.id, by: s.name, key, kind, target, name, at: Date.now() };
    if (week) fields.week = week;
    if (CARPET_RE.test(cells || '')) fields.cells = cells;
    await this.backend.report(s, `${s.id}~${key}`, fields);
    return key;
  }

  // Teachers: the newest reports first, [{ id, by, kind, target, name, week, cells, at }].
  reports() {
    if (!this.isAdmin) return Promise.reject(new AccountError('unknown', 'not allowed'));
    return this.backend.reports(this.session);
  }

  closeReport(id) {
    if (!this.isAdmin) return Promise.reject(new AccountError('unknown', 'not allowed'));
    return this.backend.closeReport(this.session, id);
  }

  // A player's leaderboard row by id (null when the player is gone).
  player(id) {
    return this.backend.player(id);
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
  USER_NOT_FOUND: 'deleted',
  INVALID_REFRESH_TOKEN: 'relogin',
  UNAUTHENTICATED: 'relogin',
  PERMISSION_DENIED: 'config',
  FAILED_PRECONDITION: 'gone',
  ALREADY_EXISTS: 'gone',
  NOT_FOUND: 'gone',
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
const fieldsOf = (doc) => ({ id: doc.name.split('/').pop(), ...Object.fromEntries(Object.entries(doc.fields).map(([k, v]) => [k, decode(v)])) });
// A collection the rules don't have yet holds nothing of anyone.
const noneIfMissing = (promise) =>
  promise.catch((e) => {
    if (e.code === 'config') return [];
    throw e;
  });

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

  // A deleted account's ID token still works for up to an hour, so every load and save first
  // asks Auth whether the account still exists (and is not disabled).
  // A teacher's delete leaves a deleted/{id} document.
  async check(s) {
    const idToken = await this.token(s);
    const [r, blocked] = await Promise.all([
      call(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${this.key}`, { body: { idToken } }).catch((e) => {
        throw e.code === 'badLogin' ? new AccountError('deleted') : e; // USER_DISABLED
      }),
      call(`${this.url}/deleted/${s.id}`, { token: idToken, missingOk: true }).catch((e) => {
        if (e.code !== 'config') throw e;
        console.warn('Firestore rules have no "deleted" part yet (config/README.md), the teacher cannot delete players:', e);
        return null;
      }),
    ]);
    if (!r.users || !r.users.length || r.users[0].disabled || blocked) throw new AccountError('deleted');
    return idToken;
  }

  async getSave(s) {
    const doc = await call(`${this.url}/saves/${s.id}`, { token: await this.check(s), missingOk: true });
    return doc && doc.fields ? JSON.parse(doc.fields.data.stringValue) : null;
  }

  // The farm and the leaderboard row are written together (the row replaces the old one).
  saveWrites(s, data, row) {
    const update = (collection, fields) => ({ update: { name: `${this.docs}/${collection}/${s.id}`, fields } });
    return [
      update('saves', { data: { stringValue: JSON.stringify(data) }, rev: int(data.rev || 0) }),
      update('players', Object.fromEntries(Object.entries(row).map(([k, v]) => [k, encode(v)]))),
    ];
  }

  // Closing the page (keepalive): no time for check(), the page dies before it answers, so a token
  // still valid is used as it is (the rules refuse a deleted player anyway). Browsers send at most
  // 64 KB with keepalive; a bigger farm goes as a normal request and may not arrive.
  async putSave(s, data, row, keepalive) {
    const body = { writes: this.saveWrites(s, data, row) };
    const token = keepalive && s.idToken && Date.now() < s.expires - 60000 ? s.idToken : await this.check(s);
    await call(`${this.url}:commit`, { token, keepalive: keepalive && JSON.stringify(body).length < 60000, body });
  }

  // ---- the player market
  orderOp({ id, order, fields }) {
    const name = `${this.docs}/orders/${id || order.id}`;
    const data = fields && Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, encode(v)]));
    if (id) return { update: { name, fields: data }, currentDocument: { exists: false } };
    const currentDocument = { updateTime: order.updateTime }; // it changed since I saw it: refused
    return fields ? { update: { name, fields: data }, updateMask: { fieldPaths: Object.keys(fields) }, currentDocument } : { delete: name, currentDocument };
  }

  async tradeSave(s, data, row, op) {
    await call(`${this.url}:commit`, { token: await this.check(s), body: { writes: [...this.saveWrites(s, data, row), this.orderOp(op)] } });
  }

  async orderWrite(s, op) {
    await call(`${this.url}:commit`, { token: await this.check(s), body: { writes: [this.orderOp(op)] } });
  }

  async orderQuery(query) {
    const res = await call(`${this.url}:runQuery?key=${this.key}`, { body: { structuredQuery: { from: [{ collectionId: 'orders' }], ...query } } });
    return res.filter((r) => r.document).map(({ document: d }) => ({ id: d.name.split('/').pop(), updateTime: d.updateTime, ...Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, decode(v)])) }));
  }

  orders(since) {
    return this.orderQuery({ where: above('at', since), orderBy: [{ field: { fieldPath: 'at' }, direction: 'DESCENDING' }], limit: 200 });
  }

  ordersOf(id) {
    return this.orderQuery({ where: { fieldFilter: { field: { fieldPath: 'owner' }, op: 'EQUAL', value: { stringValue: id } } }, limit: 50 });
  }

  // ---- the carpet contest: carpets/{week}~{player} and likes/{week}~{player}~{voter}
  async contestDocs(collection, week) {
    const res = await call(`${this.url}:runQuery?key=${this.key}`, {
      body: {
        structuredQuery: {
          from: [{ collectionId: collection }],
          where: { fieldFilter: { field: { fieldPath: 'week' }, op: 'EQUAL', value: { stringValue: week } } },
          limit: 500,
        },
      },
    });
    return res.filter((r) => r.document).map(({ document: d }) => Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, decode(v)])));
  }

  async contestEntries(week) {
    return (await this.contestDocs('carpets', week)).map((e) => ({ id: e.owner, name: e.name, cells: e.cells, at: e.at }));
  }

  contestLikes(week) {
    return this.contestDocs('likes', week);
  }

  async contestWrite(s, collection, id, fields) {
    const name = `${this.docs}/${collection}/${id}`;
    const data = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, encode(v)]));
    await call(`${this.url}:commit`, { token: await this.check(s), body: { writes: [{ update: { name, fields: data } }] } });
  }

  contestEnter(s, week, cells, at) {
    return this.contestWrite(s, 'carpets', `${week}~${s.id}`, { week, owner: s.id, name: s.name, cells, at });
  }

  contestLike(s, week, owner) {
    return this.contestWrite(s, 'likes', `${week}~${owner}~${s.id}`, { week, owner, voter: s.id });
  }

  async contestRemove(s, week, owner) {
    await call(`${this.url}:commit`, { token: await this.check(s), body: { writes: [{ delete: `${this.docs}/carpets/${week}~${owner}` }] } });
  }

  // The farm gets a rev above the new account's, so an open game of that account is refused and
  // sent to the login instead of writing its fresh farm over the moved one.
  async moveFarm(s, from, to) {
    const token = await this.check(s);
    const get = (path) => call(`${this.url}/${path}`, { token, missingOk: true });
    const [save, row, target, targetSave] = await Promise.all([get(`saves/${from}`), get(`players/${from}`), get(`players/${to}`), get(`saves/${to}`)]);
    if (!target) throw new AccountError('noPlayer');
    if (!save || !save.fields) throw new AccountError('noFarm');
    const data = JSON.parse(save.fields.data.stringValue);
    data.rev = Math.max(data.rev || 0, Number((targetSave && targetSave.fields && targetSave.fields.rev && targetSave.fields.rev.integerValue) || 0)) + 1;
    const doc = (collection, id) => `${this.docs}/${collection}/${id}`;
    const writes = [
      { update: { name: doc('saves', to), fields: { data: { stringValue: JSON.stringify(data) }, rev: int(data.rev) } } },
      { update: { name: doc('players', to), fields: { ...(row ? row.fields : {}), name: target.fields.name } } },
      { update: { name: doc('deleted', from), fields: { by: { stringValue: s.id }, movedTo: { stringValue: to } } } },
      { delete: doc('players', from) },
      ...(await this.ordersOrNone(from)).map((o) => ({ delete: doc('orders', o.id) })),
    ];
    await call(`${this.url}:commit`, { token, body: { writes } });
  }

  ordersOrNone(id) {
    return this.ordersOf(id).catch((e) => {
      if (e.code === 'config') return []; // the rules have no market part yet
      throw e;
    });
  }

  // Another player's documents go and deleted/{id} blocks the name (the Firestore rules let only
  // the teachers do this; Auth accounts can be deleted only in the Firebase console).
  async removePlayer(s, id) {
    const doc = (collection) => `${this.docs}/${collection}/${id}`;
    const orders = await this.ordersOrNone(id);
    await call(`${this.url}:commit`, {
      token: await this.check(s),
      body: { writes: [{ update: { name: doc('deleted'), fields: { by: { stringValue: s.id } } } }, { delete: doc('saves') }, { delete: doc('players') }, ...orders.map((o) => ({ delete: `${this.docs}/orders/${o.id}` }))] },
    });
  }

  // The account and its documents (a fresh session from signIn / signUp).
  async remove(s) {
    const del = (collection) => ({ delete: `${this.docs}/${collection}/${s.id}` });
    await call(`${this.url}:commit`, { token: s.idToken, body: { writes: [del('saves'), del('players')] } });
    await call(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${this.key}`, { body: { idToken: s.idToken } });
  }

  // The full names of the documents in `collection` whose `field` is `value`.
  async docsWhere(collection, field, value, token) {
    const where = { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } };
    const res = await call(`${this.url}:runQuery${token ? '' : `?key=${this.key}`}`, { token, body: { structuredQuery: { from: [{ collectionId: collection }], where } } });
    return res.filter((r) => r.document).map((r) => r.document.name);
  }

  // A player deletes their own account (s: a fresh session): their market orders, contest carpets,
  // likes given and got and the reports they wrote go first, then the farm, the row and the login
  // (remove). Anything failing on the way leaves the account working, so the player can try again.
  async erase(s) {
    const token = s.idToken;
    const lists = await Promise.all([
      noneIfMissing(this.docsWhere('orders', 'owner', s.id)),
      noneIfMissing(this.docsWhere('carpets', 'owner', s.id)),
      noneIfMissing(this.docsWhere('likes', 'owner', s.id)),
      noneIfMissing(this.docsWhere('likes', 'voter', s.id)),
      noneIfMissing(this.docsWhere('reports', 'reporter', s.id, token)),
    ]);
    const writes = [...new Set(lists.flat())].map((name) => ({ delete: name }));
    for (let i = 0; i < writes.length; i += 400) await call(`${this.url}:commit`, { token, body: { writes: writes.slice(i, i + 400) } }); // (Firestore: 500 writes a commit)
    await this.remove(s);
  }

  // ---- reports/{reporter}~{key}: one per reporter and player or carpet
  async report(s, id, fields) {
    const data = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, encode(v)]));
    await call(`${this.url}:commit`, { token: await this.check(s), body: { writes: [{ update: { name: `${this.docs}/reports/${id}`, fields: data } }] } });
  }

  async reports(s) {
    const query = { from: [{ collectionId: 'reports' }], orderBy: [{ field: { fieldPath: 'at' }, direction: 'DESCENDING' }], limit: 100 };
    const res = await call(`${this.url}:runQuery`, { token: await this.check(s), body: { structuredQuery: query } });
    return res.filter((r) => r.document).map((r) => fieldsOf(r.document));
  }

  async closeReport(s, id) {
    await call(`${this.url}:commit`, { token: await this.check(s), body: { writes: [{ delete: `${this.docs}/reports/${id}` }] } });
  }

  async player(id) {
    const doc = await call(`${this.url}/players/${id}?key=${this.key}`, { missingOk: true });
    return doc && doc.fields ? fieldsOf(doc) : null;
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

  async removePlayer(s, id) {
    const table = this.table('orders.v1');
    for (const key of Object.keys(table)) if (table[key].owner === id) delete table[key];
    this.adapter.set('orders.v1', JSON.stringify(table));
    return this.remove({ id });
  }

  async moveFarm(s, from, to) {
    const users = this.table('users.v1');
    if (!users[to]) throw new AccountError('noPlayer');
    const data = readJSON(this.adapter, saveKey(from));
    if (!data) throw new AccountError('noFarm');
    const old = readJSON(this.adapter, saveKey(to));
    data.rev = Math.max(data.rev || 0, (old && old.rev) || 0) + 1;
    this.adapter.set(saveKey(to), JSON.stringify(data));
    const players = this.table('players.v1');
    if (players[from]) players[to] = { ...players[from], name: users[to].name };
    this.adapter.set('players.v1', JSON.stringify(players));
    await this.removePlayer(s, from);
  }

  // the player market, in this browser
  async orderWrite(s, { id, order, fields }) {
    const table = this.table('orders.v1');
    const key = id || order.id;
    if (order && (!table[key] || table[key].updateTime !== order.updateTime)) throw new AccountError('gone');
    if (order && !fields) delete table[key];
    else table[key] = { ...table[key], ...fields, id: key, updateTime: Date.now() + Math.random() };
    this.adapter.set('orders.v1', JSON.stringify(table));
  }

  async tradeSave(s, data, row, op) {
    await this.orderWrite(s, op);
    await this.putSave(s, data, row);
  }

  async orders(since) {
    return Object.values(this.table('orders.v1'))
      .filter((o) => o.at > since)
      .sort((a, b) => b.at - a.at);
  }

  async ordersOf(id) {
    return Object.values(this.table('orders.v1')).filter((o) => o.owner === id);
  }

  // the carpet contest, in this browser
  contestEntries(week) {
    return Promise.resolve(Object.values(this.table('carpets.v1')).filter((e) => e.week === week));
  }

  contestLikes(week) {
    return Promise.resolve(Object.values(this.table('likes.v1')).filter((l) => l.week === week));
  }

  async contestEnter(s, week, cells, at) {
    const table = this.table('carpets.v1');
    table[`${week}~${s.id}`] = { id: s.id, week, name: s.name, cells, at };
    this.adapter.set('carpets.v1', JSON.stringify(table));
  }

  async contestLike(s, week, owner) {
    const table = this.table('likes.v1');
    table[`${week}~${owner}~${s.id}`] = { week, owner, voter: s.id };
    this.adapter.set('likes.v1', JSON.stringify(table));
  }

  async contestRemove(s, week, owner) {
    const table = this.table('carpets.v1');
    delete table[`${week}~${owner}`];
    this.adapter.set('carpets.v1', JSON.stringify(table));
  }

  async remove(s) {
    for (const key of ['users.v1', 'players.v1']) {
      const table = this.table(key);
      delete table[s.id];
      this.adapter.set(key, JSON.stringify(table));
    }
  }

  // Drops the rows of a table that `gone` picks.
  drop(key, gone) {
    const table = this.table(key);
    for (const k of Object.keys(table)) if (gone(table[k])) delete table[k];
    this.adapter.set(key, JSON.stringify(table));
  }

  async erase(s) {
    this.drop('orders.v1', (o) => o.owner === s.id);
    this.drop('carpets.v1', (c) => c.id === s.id);
    this.drop('likes.v1', (l) => l.owner === s.id || l.voter === s.id);
    this.drop('reports.v1', (r) => r.reporter === s.id);
    await this.remove(s);
  }

  // reports, in this browser
  async report(s, id, fields) {
    const table = this.table('reports.v1');
    table[id] = { ...fields, id };
    this.adapter.set('reports.v1', JSON.stringify(table));
  }

  async reports() {
    return Object.values(this.table('reports.v1')).sort((a, b) => b.at - a.at);
  }

  async closeReport(s, id) {
    this.drop('reports.v1', (r) => r.id === id);
  }

  async player(id) {
    const p = this.table('players.v1')[id];
    return p ? { id, ...p } : null;
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
