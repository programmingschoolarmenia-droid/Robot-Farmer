import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Accounts, playerRow, boardField } from '../js/storage/account.js';
import { createFakeFirebase } from './fakeFirebase.mjs';

// In-memory stand-in for LocalStorageAdapter.
function memory() {
  const m = new Map();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => (m.set(k, v), true), remove: (k) => m.delete(k) };
}

async function codeOf(promise) {
  try {
    await promise;
    return 'ok';
  } catch (e) {
    return e.code || e.message;
  }
}

const tick = () => new Promise((r) => setTimeout(r, 3));

// Numbers like Game.leaderStats() for a test player.
const stats = (o = {}) => ({
  research: 0,
  playSeconds: 0,
  hat: 'Straw_Hat',
  farm: '1×1',
  points: 0,
  code: 0,
  streak: 1,
  day: { key: '', points: 0 },
  prevDay: null,
  month: { key: '', points: 0 },
  prevMonth: null,
  ...o,
});

test('local accounts: register, login, rules and errors', async () => {
  const a = new Accounts(memory(), {});
  assert.equal(a.online, false);
  assert.equal(await codeOf(a.register('ab', 'secret1')), 'nameInvalid');
  assert.equal(await codeOf(a.register('Արամ', 'secret1')), 'nameInvalid');
  assert.equal(await codeOf(a.register('Aram_1', '12345')), 'passwordShort');
  assert.deepEqual(await a.register('Aram_1', 'secret1'), { id: 'aram_1', name: 'Aram_1' });
  assert.equal(await codeOf(a.register('aram_1', 'other12')), 'nameTaken');
  a.logout();
  assert.equal(a.user, null);
  assert.equal(await codeOf(a.login('aram_1', 'wrong12')), 'badLogin');
  assert.equal(await codeOf(a.login('aram_1', '')), 'badLogin');
  assert.deepEqual(await a.login('ARAM_1', 'secret1'), { id: 'aram_1', name: 'Aram_1' });
});

test('the session and the farm survive a page reload', async () => {
  const store = memory();
  const a = new Accounts(store, {});
  await a.register('mari', 'secret1');
  assert.equal(await a.loadSave(), null);
  a.saveLocal({ game: { time: 5 } });
  const b = new Accounts(store, {});
  assert.deepEqual(b.user, { id: 'mari', name: 'mari' });
  const save = await b.loadSave();
  assert.equal(save.game.time, 5);
  assert.equal(save.v, 1);
});

test('leaderboard row: numbers and dated day / month points', () => {
  const row = playerRow('Gor', stats({ points: 310.9, playSeconds: 61.7, day: { key: '20261028', points: 80.6 }, prevDay: { key: '20261027', points: 5 }, month: { key: '202610', points: 0.4 } }));
  assert.deepEqual(row, { name: 'Gor', hat: 'Straw_Hat', farm: '1×1', research: 0, playSeconds: 61, points: 310, code: 0, streak: 1, streakDay: '20261028', d20261028: 80, d20261027: 5 });
  assert.deepEqual([boardField('day', '20261028'), boardField('month', '20261028'), boardField('all', '20261028'), boardField('code', '20261028')], ['d20261028', 'm202610', 'points', 'code']);
});

test('leaderboard: each tab ranks by its field; own place and the rival', async () => {
  const a = new Accounts(memory(), { leaderboardSize: 2 });
  const today = '20261028';
  const month = (points) => ({ key: '202610', points });
  for (const [name, o] of [
    ['ani', { points: 500, code: 40, day: { key: today, points: 30 }, month: month(300) }],
    ['bob', { points: 900, code: 10, day: { key: '20261027', points: 99 }, month: month(600) }],
    ['gor', { points: 300, code: 70, day: { key: today, points: 80 }, prevDay: { key: '20261027', points: 5 }, month: month(200) }],
    ['dav', { points: 100, code: 0, day: { key: today, points: 10 }, month: month(50) }],
  ]) {
    await a.register(name, 'secret1');
    await a.saveOnline({}, stats(o));
  }
  const names = async (tab) => (await a.leaderboard(boardField(tab, today))).rows.map((r) => r.name);
  assert.deepEqual(await names('all'), ['bob', 'ani']);
  assert.deepEqual(await names('day'), ['gor', 'ani']); // bob played only yesterday
  assert.deepEqual(await names('month'), ['bob', 'ani']);
  assert.deepEqual(await names('code'), ['gor', 'ani']);
  // dav is 3rd today, outside the top 2: own place and the closest player above
  const dav = await a.leaderboard(`d${today}`, { id: 'dav', value: 10 });
  assert.deepEqual([dav.place, dav.rival.name], [3, 'ani']);
  // inside the list the rival is the row above; the leader has none
  assert.equal((await a.leaderboard(`d${today}`, { id: 'ani', value: 30 })).rival.name, 'gor');
  assert.deepEqual(Object.values(await a.leaderboard(`d${today}`, { id: 'gor', value: 80 })).slice(1), [1, null]);
  assert.equal(await a.place(`d${today}`, 30), 2);
  // yesterday's champion: bob (99 > 5); last month nobody played
  const champs = await a.champions('d20261027', 'm202609');
  assert.deepEqual([champs.day.name, champs.month], ['bob', null]);
});

test('firebase: accounts, farm sync between devices and the leaderboard over REST', async () => {
  const fb = createFakeFirebase();
  const realFetch = globalThis.fetch;
  globalThis.fetch = fb.fetch;
  try {
    const cfg = { apiKey: 'test-key', projectId: 'test-project' };
    const pc = new Accounts(memory(), cfg);
    assert.equal(pc.online, true);
    assert.deepEqual(await pc.register('Aram', 'secret1'), { id: 'aram', name: 'Aram' });
    assert.ok(fb.users.has('aram@bridgys-farm.app'));
    assert.equal(await codeOf(pc.register('aram', 'other12')), 'nameTaken');
    assert.equal(await pc.loadSave(), null);

    pc.saveLocal({ game: { time: 1 } });
    await pc.saveOnline({ game: { time: 1 } }, stats({ research: 3, playSeconds: 100, points: 40, day: { key: '20261027', points: 40 } }));
    assert.equal(fb.docs.get('players/aram').name.stringValue, 'Aram');

    // Another device: wrong password, then the farm comes from the cloud.
    const phone = new Accounts(memory(), cfg);
    assert.equal(await codeOf(phone.login('aram', 'nope123')), 'badLogin');
    assert.deepEqual(await phone.login('ARAM', 'secret1'), { id: 'aram', name: 'Aram' });
    assert.equal((await phone.loadSave()).game.time, 1);

    // The newer copy wins: phone plays and saves online, then the PC loads.
    await tick();
    const later = { game: { time: 9 } };
    phone.saveLocal(later);
    await phone.saveOnline(later, stats({ research: 4, playSeconds: 200, points: 60, day: { key: '20261028', points: 20 }, prevDay: { key: '20261027', points: 40 } }));
    assert.equal((await pc.loadSave()).game.time, 9);
    // ...and an unsent newer browser copy beats an older online one.
    await tick();
    pc.saveLocal({ game: { time: 12 } });
    assert.equal((await pc.loadSave()).game.time, 12);

    // Expired ID token → refreshed with the refresh token.
    fb.expireTokens();
    pc.session.expires = 0;
    await pc.saveOnline({ game: { time: 12 } }, stats({ research: 5, playSeconds: 300, points: 70, day: { key: '20261028', points: 30 } }));
    assert.ok(fb.requests.some((r) => r.url.startsWith('https://securetoken.googleapis.com/')));

    // The row is replaced on every save: yesterday's field went with the last save.
    assert.deepEqual(Object.keys(fb.docs.get('players/aram')).filter((k) => /^[dm]\d/.test(k)), ['d20261028']);

    await pc.register('bob_7', 'secret1');
    await pc.saveOnline({}, stats({ research: 2, playSeconds: 50, points: 20, hat: 'Red_Hat', day: { key: '20261028', points: 50 } }));
    const board = await pc.leaderboard('points', { id: 'bob_7', value: 20 });
    assert.deepEqual(board.rows.map((r) => [r.name, r.points, r.research, r.hat]), [['Aram', 70, 5, 'Straw_Hat'], ['bob_7', 20, 2, 'Red_Hat']]);
    assert.deepEqual([board.place, board.rival.name], [2, 'Aram']);
    assert.deepEqual((await pc.leaderboard('d20261028', null, true)).rows.map((r) => [r.name, r.d20261028]), [['bob_7', 50], ['Aram', 30]]);
    assert.equal(await pc.place('d20261028', 30), 2);
    assert.equal((await pc.champions('d20261027', 'm202609')).day, null); // nobody keeps yesterday's field

    // No internet: login fails; a known farm still loads from this browser; an unknown one doesn't.
    fb.offline = true;
    assert.equal(await codeOf(phone.login('aram', 'secret1')), 'offline');
    phone.session.expires = 0;
    assert.equal((await phone.loadSave()).game.time, 9);
    const fresh = new Accounts(memory(), cfg);
    fresh.session = { id: 'aram', name: 'Aram', refreshToken: 'x', expires: 0 };
    assert.equal(await codeOf(fresh.loadSave()), 'offline');
    fb.offline = false;

    // The teacher deleted the account → log in again; a wrong API key is a setup problem.
    fb.users.delete('aram@bridgys-farm.app');
    phone.session.expires = 0;
    assert.equal(await codeOf(phone.loadSave()), 'relogin');
    assert.equal(await codeOf(new Accounts(memory(), { ...cfg, apiKey: 'bad' }).register('newkid', 'secret1')), 'config');
  } finally {
    globalThis.fetch = realFetch;
  }
});
