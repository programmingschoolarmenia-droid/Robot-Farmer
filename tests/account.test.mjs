import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Accounts, scoreOf } from '../js/storage/account.js';
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

test('leaderboard: more research first, then less play time; own place outside the top', async () => {
  const a = new Accounts(memory(), { leaderboardSize: 2 });
  for (const [name, research, playSeconds] of [['ani', 5, 900], ['bob', 7, 3000], ['gor', 5, 300], ['dav', 1, 10]]) {
    await a.register(name, 'secret1');
    await a.saveOnline({}, { research, playSeconds });
  }
  const { rows, place } = await a.leaderboard({ id: 'dav', research: 1, playSeconds: 10 });
  assert.deepEqual(rows.map((r) => r.name), ['bob', 'gor']);
  assert.equal(place, 4);
  assert.equal((await a.leaderboard({ id: 'gor', research: 5, playSeconds: 300 })).place, 2);
  assert.equal((await a.leaderboard()).place, 0);
  assert.ok(scoreOf(5, 300) > scoreOf(5, 900) && scoreOf(6, 99999) > scoreOf(5, 0));
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
    await pc.saveOnline({ game: { time: 1 } }, { research: 3, playSeconds: 100 });
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
    await phone.saveOnline(later, { research: 4, playSeconds: 200 });
    assert.equal((await pc.loadSave()).game.time, 9);
    // ...and an unsent newer browser copy beats an older online one.
    await tick();
    pc.saveLocal({ game: { time: 12 } });
    assert.equal((await pc.loadSave()).game.time, 12);

    // Expired ID token → refreshed with the refresh token.
    fb.expireTokens();
    pc.session.expires = 0;
    await pc.saveOnline({ game: { time: 12 } }, { research: 5, playSeconds: 300 });
    assert.ok(fb.requests.some((r) => r.url.startsWith('https://securetoken.googleapis.com/')));

    await pc.register('bob_7', 'secret1');
    await pc.saveOnline({}, { research: 2, playSeconds: 50 });
    const board = await pc.leaderboard({ id: 'bob_7', research: 2, playSeconds: 50 });
    assert.deepEqual(board.rows.map((r) => [r.name, r.research]), [['Aram', 5], ['bob_7', 2]]);
    assert.equal(board.place, 2);

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
