import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Accounts, playerRow, boardField } from '../js/storage/account.js';
import { Game } from '../js/engine/game.js';
import { createFakeFirebase } from './fakeFirebase.mjs';
import { loadConfig } from './helpers.mjs';

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

    // The teacher deleted the account: refused at once even with a fresh ID token, nothing is
    // written back, and the browser forgets the session and its farm.
    const tab = new Accounts(memory(), cfg);
    await tab.login('aram', 'secret1');
    tab.saveLocal({ game: { time: 13 } });
    fb.users.delete('aram@bridgys-farm.app');
    fb.docs.delete('players/aram');
    fb.docs.delete('saves/aram');
    assert.equal(await codeOf(phone.saveOnline({ game: { time: 13 } }, stats())), 'deleted');
    assert.equal(fb.docs.has('players/aram') || fb.docs.has('saves/aram'), false);
    assert.equal(phone.session, null);
    assert.equal(await codeOf(tab.loadSave()), 'deleted');
    assert.deepEqual([tab.session, tab.adapter.get('save.v2.aram')], [null, null]);
    assert.equal(await codeOf(phone.login('aram', 'secret1')), 'badLogin');
    // A disabled account is refused the same way.
    const kid = new Accounts(memory(), cfg);
    await kid.register('kid_1', 'secret1');
    fb.users.get('kid_1@bridgys-farm.app').disabled = true;
    assert.equal(await codeOf(kid.saveOnline({}, stats())), 'deleted');
    // A wrong API key is a setup problem.
    assert.equal(await codeOf(new Accounts(memory(), { ...cfg, apiKey: 'bad' }).register('newkid', 'secret1')), 'config');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('firebase: a student from the old version keeps everything and gets points for their history', async () => {
  const fb = createFakeFirebase();
  const realFetch = globalThis.fetch;
  globalThis.fetch = fb.fetch;
  try {
    // As the previous version left it: a research-only row and a farm save with all gathered items.
    const int = (n) => ({ integerValue: String(n) });
    fb.users.set('vahan@bridgys-farm.app', { password: 'secret1', displayName: 'Vahan' });
    fb.docs.set('players/vahan', { name: { stringValue: 'Vahan' }, research: int(4), playSeconds: int(36000), score: int(4e7 - 36000) });
    const old = { v: 1, game: { playSeconds: 36000, research: { Loops: 1, Speed: 1, Expand: 2 }, stats: { totals: { Hay: 900, Wood: 300, Carrot: 50, Gold: 10 }, runs: 40 } } };
    fb.docs.set('saves/vahan', { data: { stringValue: JSON.stringify(old) } });

    const a = new Accounts(memory(), { apiKey: 'test-key', projectId: 'test-project' });
    assert.deepEqual((await a.leaderboard('points')).rows, []); // old rows have no points yet

    // The first login with the new version: the same farm, points for the whole history.
    await a.login('vahan', 'secret1');
    const game = new Game(loadConfig(), (await a.loadSave()).game);
    await a.saveOnline({ v: 1, game: game.toSave() }, game.leaderStats());
    const row = (await a.leaderboard('points')).rows[0];
    assert.deepEqual([row.name, row.points, row.research, row.playSeconds], ['Vahan', 900 + 300 + 50 * 2 + 10 * 20, 4, 36000]);
    assert.equal(fb.docs.get('players/vahan').score, undefined); // the old row is fully replaced
    const saved = JSON.parse(fb.docs.get('saves/vahan').data.stringValue).game;
    assert.deepEqual([saved.playSeconds, saved.research.Expand, saved.stats.totals.Hay, saved.stats.runs], [36000, 2, 900, 40]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the weekly challenge list: the fastest first, my place from two counts, last week kept for its prizes (here and on Firebase)', async () => {
  const realFetch = globalThis.fetch;
  for (const online of [false, true]) {
    globalThis.fetch = createFakeFirebase().fetch;
    try {
      const a = new Accounts(memory(), online ? { apiKey: 'test-key', projectId: 'test-project', leaderboardSize: 2 } : { leaderboardSize: 2 });
      const challenge = (best, prev = null) => ({ challenge: { week: '202644', best, bestCode: `code ${best}`, prev } });
      for (const [name, o] of [['ani', challenge(834, { week: '202643', best: 700, bestCode: 'old' })], ['bob', challenge(612)], ['gor', challenge(990)], ['dav', challenge(0)]]) {
        await a.register(name, 'secret1');
        await a.saveOnline({}, stats(o));
      }
      const field = boardField('challenge', '20261029');
      const board = await a.leaderboard(field, { id: 'gor', value: 990 });
      assert.deepEqual([field, board.rows.map((r) => [r.name, r[field], r[`cc${field.slice(1)}`]]), board.place, board.rival], ['c202644', [['bob', 612, 'code 612'], ['ani', 834, 'code 834']], 3, null]);
      assert.equal((await a.leaderboard(field, { id: 'ani', value: 834 })).rival.name, 'bob');
      assert.deepEqual(await Promise.all([612, 700, 834, 990].map((v) => a.place(field, v))), [1, 2, 2, 3]);
      assert.deepEqual((await a.top('c202643')).map((r) => [r.name, r.cc202643]), [['ani', 'old']]);
      assert.equal((await a.champions('d20261028', 'm202609', 'c202643')).week.name, 'ani');
    } finally {
      globalThis.fetch = realFetch;
    }
  }
});

test('rename: the farm and the row move to the new name, the old account is gone (here and on Firebase)', async () => {
  const fb = createFakeFirebase();
  const realFetch = globalThis.fetch;
  globalThis.fetch = fb.fetch;
  try {
    for (const cfg of [{}, { apiKey: 'test-key', projectId: 'test-project' }]) {
      const acc = new Accounts(memory(), cfg);
      await acc.register('Aram', 'secret1');
      await acc.register('taken', 'secret1');
      await acc.login('aram', 'secret1');
      const farm = { game: { time: 5 } };
      acc.saveLocal(farm);
      await acc.saveOnline(farm, stats({ points: 40 }));
      assert.equal(await codeOf(acc.rename('Taken', 'secret1', farm, stats())), 'nameTaken');
      assert.equal(await codeOf(acc.rename('aram', 'secret1', farm, stats())), 'nameTaken');
      assert.equal(await codeOf(acc.rename('a b', 'secret1', farm, stats())), 'nameInvalid');
      assert.equal(await codeOf(acc.rename('Gandom', 'wrong12', farm, stats())), 'badLogin');
      assert.equal(acc.user.id, 'aram');

      assert.deepEqual(await acc.rename('Gandom', 'secret1', farm, stats({ points: 40 })), { id: 'gandom', name: 'Gandom' });
      assert.equal((await acc.loadSave()).game.time, 5);
      assert.deepEqual((await acc.leaderboard('points', null, true)).rows.map((r) => [r.name, r.points]), [['Gandom', 40]]);
      assert.equal(acc.adapter.get('save.v2.aram'), null);
      assert.equal(await codeOf(acc.login('aram', 'secret1')), 'badLogin');
      assert.deepEqual(await new Accounts(acc.adapter, cfg).login('gandom', 'secret1'), { id: 'gandom', name: 'Gandom' });
      if (cfg.apiKey) assert.equal(fb.docs.has('saves/aram') || fb.docs.has('players/aram'), false);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a guest plays in this browser only, then keeps the farm under a name (here and on Firebase)', async () => {
  const fb = createFakeFirebase();
  const realFetch = globalThis.fetch;
  globalThis.fetch = fb.fetch;
  try {
    for (const cfg of [{}, { apiKey: 'test-key', projectId: 'test-project' }]) {
      const acc = new Accounts(memory(), cfg);
      assert.equal(acc.hasGuestFarm(), false);
      acc.startGuest('Հյուր');
      assert.equal(acc.isGuest, true);
      assert.equal(acc.isAdmin, false);
      assert.equal(await acc.loadSave(), null); // a new farm
      const farm = { game: { time: 7 } };
      acc.saveLocal(farm);
      const before = fb.requests.length;
      await acc.saveOnline(farm, stats({ points: 50 }));
      assert.equal(fb.requests.length, before, 'nothing goes online for a guest');
      assert.equal(acc.hasGuestFarm(), true);

      // a reload: the same guest farm comes back from this browser
      const again = new Accounts(acc.adapter, cfg);
      assert.equal(again.isGuest, true);
      assert.equal((await again.loadSave()).game.time, 7);

      // a student named "guest" on the same computer has their own farm
      const named = new Accounts(acc.adapter, cfg);
      await named.register('guest', 'secret1');
      named.saveLocal({ game: { time: 99 } });
      assert.equal((await again.loadSave()).game.time, 7);
      assert.equal(await codeOf(again.keepGuestFarm('a b', 'secret1', farm)), 'nameInvalid');
      assert.equal(await codeOf(again.keepGuestFarm('Nare', '123', farm)), 'passwordShort');
      assert.equal(again.isGuest, true);
      assert.deepEqual(await again.keepGuestFarm('Nare', 'secret1', farm), { id: 'nare', name: 'Nare' });
      assert.equal(again.isGuest, false);
      assert.equal(again.hasGuestFarm(), false);
      assert.equal((await again.loadSave()).game.time, 7); // this browser's copy, before the first online save
      await again.saveOnline(farm, stats({ points: 50 }));
      assert.deepEqual((await again.leaderboard('points', null, true)).rows.map((r) => [r.name, r.points]), [['Nare', 50]]);
      if (cfg.apiKey) assert.ok(fb.docs.has('saves/nare'));

      // start over: the old guest farm goes
      again.logout();
      again.startGuest('Հյուր');
      again.saveLocal({ game: { time: 1 } });
      again.dropGuestFarm();
      assert.equal(await again.loadSave(), null);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a teacher deletes a player from the leaderboard: the farm and row go, the name is blocked at once', async () => {
  const fb = createFakeFirebase({ admins: ['admin'] });
  const realFetch = globalThis.fetch;
  globalThis.fetch = fb.fetch;
  try {
    for (const cfg of [{ admins: ['admin'] }, { apiKey: 'test-key', projectId: 'test-project', admins: ['Admin'] }]) {
      const kid = new Accounts(memory(), cfg);
      await kid.register('Seroj', 'secret1');
      kid.saveLocal({ game: { time: 3 } });
      await kid.saveOnline({ game: { time: 3 } }, stats({ points: 30 }));
      assert.equal(kid.isAdmin, false);
      assert.equal(await codeOf(kid.removePlayer('seroj')), 'unknown');

      const teacher = new Accounts(memory(), cfg);
      await teacher.register('admin', 'secret1');
      assert.equal(teacher.isAdmin, true);
      assert.equal(await codeOf(teacher.removePlayer('admin')), 'unknown', 'not yourself');
      await teacher.removePlayer('seroj');
      assert.deepEqual((await teacher.leaderboard('points', null, true)).rows, []);
      if (!cfg.apiKey) continue;
      assert.equal(fb.docs.has('saves/seroj') || fb.docs.has('players/seroj'), false);
      // The student's open game is refused at the next save and forgets the farm; logging in again fails too.
      assert.equal(await codeOf(kid.saveOnline({ game: { time: 4 } }, stats({ points: 40 }))), 'deleted');
      assert.equal(fb.docs.has('players/seroj'), false);
      assert.deepEqual([kid.session, kid.adapter.get('save.v2.seroj')], [null, null]);
      await kid.login('seroj', 'secret1');
      assert.equal(await codeOf(kid.loadSave()), 'deleted');
      assert.equal(await codeOf(kid.register('seroj', 'secret1')), 'nameTaken');
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a forgotten password: the teacher moves the farm to the new account, the old name is blocked (here and on Firebase)', async () => {
  const fb = createFakeFirebase({ admins: ['admin'] });
  const realFetch = globalThis.fetch;
  globalThis.fetch = fb.fetch;
  try {
    for (const cfg of [{ admins: ['admin'] }, { apiKey: 'test-key', projectId: 'test-project', admins: ['admin'] }]) {
      const browser = memory(); // (local accounts: everyone on one computer)
      const pc = () => (cfg.apiKey ? memory() : browser);
      const old = new Accounts(pc(), cfg);
      await old.register('Seroj', 'secret1');
      const farm = { rev: 2, game: { time: 300 } };
      old.saveLocal(farm);
      await old.saveOnline(farm, stats({ points: 30 }));
      const fresh = new Accounts(pc(), cfg);
      await fresh.register('Seroj2', 'secret2');
      fresh.saveLocal({ game: { time: 1 } });
      await fresh.saveOnline({ game: { time: 1 } }, stats());

      assert.equal(await codeOf(fresh.moveFarm('seroj', 'seroj2')), 'unknown', 'only teachers');
      const teacher = new Accounts(pc(), cfg);
      await teacher.register('admin', 'secret1');
      assert.equal(await codeOf(teacher.moveFarm('seroj', 'nobody')), 'noPlayer');
      assert.equal(await codeOf(teacher.moveFarm('seroj', 'seroj')), 'nameInvalid');
      await teacher.moveFarm('seroj', 'Seroj2');
      const rows = (await teacher.leaderboard('points', null, true)).rows;
      assert.deepEqual(rows.map((r) => [r.id, r.name, r.points]), [['seroj2', 'Seroj2', 30]]);
      if (!cfg.apiKey) {
        assert.equal((await fresh.loadSave()).game.time, 300);
        continue;
      }
      // The new account's open game can't write its fresh farm over the moved one; after logging in again it has the old farm.
      assert.equal(await codeOf(fresh.saveOnline({ game: { time: 2 } }, stats())), 'stale');
      assert.equal((await fresh.loadSave()).game.time, 300);
      await old.login('seroj', 'secret1');
      assert.equal(await codeOf(old.loadSave()), 'deleted');
      assert.equal(fb.docs.has('saves/seroj'), true, 'kept as a backup');
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('closing the page: the last save goes out at once, without the account check first', async () => {
  const fb = createFakeFirebase();
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = (url, init = {}) => (sent.push({ url, keepalive: !!init.keepalive }), fb.fetch(url, init));
  try {
    const kid = new Accounts(memory(), { apiKey: 'test-key', projectId: 'test-project' });
    await kid.register('Aram', 'secret1');
    sent.length = 0;
    await kid.saveOnline({ game: { time: 5 } }, stats({ points: 5 }), true);
    assert.deepEqual(sent.map((r) => [r.url.split(/[/:]/).pop(), r.keepalive]), [['commit', true]]);
    // A farm too big for keepalive (the browser's 64 KB) still goes, as a normal request.
    sent.length = 0;
    await kid.saveOnline({ game: { time: 6, big: 'x'.repeat(70000) } }, stats({ points: 6 }), true);
    assert.deepEqual(sent.map((r) => r.keepalive), [false]);
    assert.equal(JSON.parse(fb.docs.get('saves/aram').data.stringValue).game.time, 6);
    // The normal path still checks the account first.
    sent.length = 0;
    await kid.saveOnline({ game: { time: 7 } }, stats({ points: 7 }));
    assert.ok(sent.length > 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a player deletes their own account: their farm, row, orders, carpets, likes and reports go, nobody else\'s (here and on Firebase)', async () => {
  const fb = createFakeFirebase({ admins: ['admin'] });
  const realFetch = globalThis.fetch;
  globalThis.fetch = fb.fetch;
  try {
    for (const cfg of [{ admins: ['admin'] }, { apiKey: 'test-key', projectId: 'test-project', admins: ['admin'] }]) {
      const browser = memory(); // (local accounts: everyone on one computer)
      const pc = () => (cfg.apiKey ? memory() : browser);
      const week = '2026W46';
      const join = async (name, points) => {
        const acc = new Accounts(pc(), cfg);
        await acc.register(name, 'secret1');
        const farm = { game: { time: points } };
        acc.saveLocal(farm);
        await acc.saveOnline(farm, stats({ points }));
        await acc.enterContest(week, name[0].repeat(81));
        return acc;
      };
      const aram = await join('Aram', 30);
      const nare = await join('Nare', 20);
      const teacher = new Accounts(pc(), cfg);
      await teacher.register('admin', 'secret1');
      await aram.tradeSave({ game: { time: 30 } }, stats({ points: 30 }), { id: 'aram~1', fields: { owner: 'aram', name: 'Aram', at: 1, status: 'open' } });
      await aram.likeCarpet(week, 'nare');
      await nare.likeCarpet(week, 'aram');
      await aram.report({ kind: 'carpet', target: 'nare', name: 'Nare', week, cells: 'N'.repeat(81) });
      await nare.report({ kind: 'player', target: 'aram', name: 'Aram' });

      assert.equal(await codeOf(aram.deleteMe('wrong12')), 'badLogin');
      assert.equal(await codeOf(aram.deleteMe('')), 'badLogin');
      assert.equal(await codeOf(teacher.deleteMe('secret1')), 'unknown', 'a teacher keeps the name');
      assert.equal(aram.user.id, 'aram', 'nothing happened yet');
      await aram.deleteMe('secret1');
      assert.equal(aram.session, null);
      assert.equal(aram.adapter.get('save.v2.aram'), null);

      assert.deepEqual((await nare.leaderboard('points', null, true)).rows.map((r) => r.id), ['nare']);
      assert.deepEqual((await nare.contest(week)).map((e) => [e.id, e.likes]), [['nare', 0]]);
      assert.deepEqual(await nare.orders(0), []);
      assert.deepEqual((await teacher.reports()).map((r) => [r.by, r.name]), [['Nare', 'Aram']], 'reports about Aram stay for the teacher');
      assert.equal(await codeOf(aram.login('aram', 'secret1')), 'badLogin');
      await aram.register('Aram', 'secret2'); // the name is free again
      assert.equal(await aram.loadSave(), null, 'a new, empty farm');
      if (cfg.apiKey) assert.deepEqual([...fb.docs.keys()].filter((k) => k.includes('aram')), ['reports/nare~aram']);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('reports: players report a player or a contest carpet, only teachers see and close them (here and on Firebase)', async () => {
  const fb = createFakeFirebase({ admins: ['admin'] });
  const realFetch = globalThis.fetch;
  globalThis.fetch = fb.fetch;
  try {
    for (const cfg of [{ admins: ['admin'] }, { apiKey: 'test-key', projectId: 'test-project', admins: ['admin'] }]) {
      const browser = memory();
      const pc = () => (cfg.apiKey ? memory() : browser);
      const kid = new Accounts(pc(), cfg);
      await kid.register('Seroj', 'secret1');
      await kid.saveOnline({ game: {} }, stats({ points: 5 }));
      const other = new Accounts(pc(), cfg);
      await other.register('Gor', 'secret1');
      await other.saveOnline({ game: {} }, stats({ points: 7 }));
      const teacher = new Accounts(pc(), cfg);
      await teacher.register('admin', 'secret1');

      assert.equal(await codeOf(kid.report({ kind: 'player', target: 'seroj', name: 'Seroj' })), 'unknown', 'not yourself');
      assert.equal(await kid.report({ kind: 'player', target: 'gor', name: 'Gor' }), 'gor');
      await tick();
      assert.equal(await kid.report({ kind: 'carpet', target: 'gor', name: 'Gor', week: '2026W46', cells: 'B'.repeat(81) }), '2026W46~gor');
      await kid.report({ kind: 'player', target: 'gor', name: 'Gor' }); // again: still one report
      assert.equal(await codeOf(kid.reports()), 'unknown', 'only teachers read them');
      const guest = new Accounts(memory(), cfg);
      guest.startGuest('Հյուր');
      assert.equal(await codeOf(guest.report({ kind: 'player', target: 'gor', name: 'Gor' })), 'unknown');

      const list = await teacher.reports();
      assert.deepEqual(list.map((r) => [r.id, r.by, r.kind, r.name]), [['seroj~gor', 'Seroj', 'player', 'Gor'], ['seroj~2026W46~gor', 'Seroj', 'carpet', 'Gor']]);
      assert.equal(list[1].cells, 'B'.repeat(81));
      assert.equal(list[1].week, '2026W46');
      assert.equal(list[0].cells, undefined);
      assert.equal((await teacher.player('gor')).name, 'Gor');
      assert.equal(await teacher.player('nobody'), null);
      await teacher.closeReport('seroj~gor');
      assert.deepEqual((await teacher.reports()).map((r) => r.id), ['seroj~2026W46~gor']);
      assert.equal(await codeOf(kid.closeReport('seroj~2026W46~gor')), 'unknown');
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});
