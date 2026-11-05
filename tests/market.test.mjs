import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Accounts } from '../js/storage/account.js';
import { Game } from '../js/engine/game.js';
import { validateConfig } from '../js/core/config.js';
import { allowedRange, equalAmount, orderExpired, orderProblem, placeProblem, takeProblem } from '../js/engine/market.js';
import { createFakeFirebase } from './fakeFirebase.mjs';
import { loadConfig } from './helpers.mjs';

const config = await loadConfig();
const { settings } = config;
const order = (give, giveN, want, wantN, owner = 'aram') => ({ owner, give, giveN, want, wantN, at: 1000 });

function memory() {
  const m = new Map();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => (m.set(k, v), true), remove: (k) => m.delete(k) };
}

const codeOf = (promise) => promise.then(() => 'ok', (e) => e.code || e.message);

const row = { research: 0, playSeconds: 0, hat: 'Straw_Hat', farm: '1×1', points: 0, code: 0, streak: 0, day: { key: '', points: 0 }, month: { key: '', points: 0 } };

// Two students on one fake Firebase (each with their own browser).
async function classroom() {
  const fake = createFakeFirebase({ admins: ['admin'] });
  const realFetch = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  const online = { apiKey: 'test-key', projectId: 'test-project', admins: ['admin'] };
  const join = async (name) => {
    const a = new Accounts(memory(), online);
    await a.register(name, 'secret1');
    return a;
  };
  return { fake, join, done: () => (globalThis.fetch = realFetch) };
}

const place = (a, o = { give: 'Gold', giveN: 500, want: 'Pumpkin', wantN: 5000 }, rev = 1) => {
  const { id, name } = a.user;
  const at = Date.now();
  return a.tradeSave({ rev, goods: 'after placing' }, row, { id: `${id}~${at}`, fields: { owner: id, name, ...o, at, status: 'open' } });
};

test('fair price: 500 Gold for 5000 Pumpkins passes, 100000 Gold for 1 Carrot never does', () => {
  assert.deepEqual(allowedRange(settings, 'Gold', 500, 'Pumpkin'), { min: 834, max: 7500 });
  assert.equal(equalAmount(settings, 'Gold', 500, 'Pumpkin'), 2500);
  assert.equal(orderProblem(settings, order('Gold', 500, 'Pumpkin', 5000)), null);
  assert.equal(orderProblem(settings, order('Gold', 500, 'Pumpkin', 7500)), null);
  assert.equal(orderProblem(settings, order('Gold', 500, 'Pumpkin', 834)), null);
  assert.equal(orderProblem(settings, order('Gold', 500, 'Pumpkin', 833)), 'price');
  assert.equal(orderProblem(settings, order('Gold', 500, 'Pumpkin', 7501)), 'price');
  assert.equal(orderProblem(settings, order('Gold', 100000, 'Carrot', 1)), 'price');
  assert.equal(orderProblem(settings, order('Carrot', 1, 'Gold', 100000)), 'price');
});

test('only listed goods in whole amounts: no rewards, no ranch goods, no fractions', () => {
  for (const item of ['Star', 'Medal', 'Water', 'Fertilizer', 'Power', 'Egg', 'Dram']) assert.equal(orderProblem(settings, order(item, 1, 'Hay', 1)), 'same', item);
  assert.equal(orderProblem(settings, order('Hay', 5, 'Hay', 5)), 'same');
  for (const n of [0, -5, 1.5, NaN, 1e7]) assert.equal(orderProblem(settings, order('Hay', n, 'Wood', 1)), 'amount', String(n));
});

test('placing and taking: goods your farm made, enough goods, and the limits', () => {
  const g = new Game(config, {});
  const o = order('Gold', 500, 'Pumpkin', 5000, 'seller');
  assert.equal(placeProblem(g, o, 0), 'made');
  assert.equal(takeProblem(g, o, 'me', 0), 'made');
  g.inventory.add('Gold', 500, 'transfer'); // traded goods don't count as made
  g.inventory.add('Pumpkin', 5000, 'transfer');
  assert.equal(placeProblem(g, o, 0), 'made');
  g.inventory.add('Gold', 1);
  g.inventory.add('Pumpkin', 1);
  g.inventory.add('Gold', -501, 'transfer');
  assert.equal(placeProblem(g, o, 0), 'have');
  g.inventory.add('Gold', 500, 'transfer');
  assert.equal(placeProblem(g, o, 0), null);
  assert.equal(placeProblem(g, o, 2), null);
  assert.equal(placeProblem(g, o, 3), 'open');
  assert.equal(takeProblem(g, o, 'seller', 0), 'mine');
  assert.equal(takeProblem(g, o, 'me', 4), null);
  assert.equal(takeProblem(g, o, 'me', 5), 'limit');
  assert.equal(takeProblem(g, { ...o, wantN: 999999 }, 'me', 0), 'have');
});

test('traded goods add no points or production, and orders expire after the set days', () => {
  const g = new Game(config, {});
  const before = g.stats.points();
  g.inventory.add('Gold', 500, 'transfer');
  assert.equal(g.stats.points(), before);
  assert.equal(g.stats.total('Gold'), 0);
  const day = 86400000;
  assert.equal(orderExpired(settings, { at: 0 }, 3 * day), false);
  assert.equal(orderExpired(settings, { at: 0 }, 3 * day + 1), true);
});

test('place, take and collect on Firebase: the order and each farm change in one write', async () => {
  const { fake, join, done } = await classroom();
  try {
    const [aram, gor] = [await join('aram'), await join('gor')];
    await place(aram);
    assert.equal(fake.docs.get('saves/aram').rev.integerValue, '1');
    const [o] = await gor.orders(0);
    assert.deepEqual([o.owner, o.name, o.give, o.giveN, o.want, o.wantN, o.status], ['aram', 'aram', 'Gold', 500, 'Pumpkin', 5000, 'open']);
    assert.ok(o.updateTime);
    await gor.tradeSave({ rev: 1, goods: 'taken' }, row, { order: o, fields: { status: 'taken', taker: 'gor' } });
    assert.equal(JSON.parse(fake.docs.get('saves/gor').data.stringValue).goods, 'taken');
    const [sold] = await aram.myOrders();
    assert.deepEqual([sold.status, sold.taker, sold.give, sold.owner], ['taken', 'gor', 'Gold', 'aram']); // the rest of the order stays
    await aram.tradeSave({ rev: 2, goods: 'paid' }, row, { order: sold });
    assert.deepEqual(await aram.myOrders(), []);
    assert.equal(JSON.parse(fake.docs.get('saves/aram').data.stringValue).goods, 'paid');
  } finally {
    done();
  }
});

test('one order, one taker; cancel loses to a take; a refused step writes neither the farm nor the order', async () => {
  const { fake, join, done } = await classroom();
  try {
    const [aram, gor, ani] = [await join('aram'), await join('gor'), await join('ani')];
    await place(aram);
    const [o] = await gor.orders(0);
    await gor.saveOnline({ rev: 0, goods: 'before' }, row);
    await ani.saveOnline({ rev: 0, goods: 'before' }, row);
    const take = (a, id, goods) => a.tradeSave({ rev: 1, goods }, row, { order: o, fields: { status: 'taken', taker: id } });
    assert.deepEqual(await Promise.all([codeOf(take(gor, 'gor', 'won')), codeOf(take(ani, 'ani', 'won'))]).then((r) => r.sort()), ['config', 'ok']);
    const winners = ['gor', 'ani'].filter((id) => JSON.parse(fake.docs.get(`saves/${id}`).data.stringValue).goods === 'won');
    assert.equal(winners.length, 1);
    assert.equal(await codeOf(aram.tradeSave({ rev: 2, goods: 'refund' }, row, { order: o })), 'gone'); // aram's copy of the order is older
    assert.equal(JSON.parse(fake.docs.get('saves/aram').data.stringValue).goods, 'after placing');
    assert.equal((await aram.myOrders())[0].status, 'taken');
  } finally {
    done();
  }
});

test('my own order is not for me; nobody can change an order into something else', async () => {
  const { join, done } = await classroom();
  try {
    const [aram, gor] = [await join('aram'), await join('gor')];
    await place(aram);
    const [o] = await aram.myOrders();
    assert.equal(await codeOf(aram.tradeSave({ rev: 2 }, row, { order: o, fields: { status: 'taken', taker: 'aram' } })), 'config');
    assert.equal(await codeOf(gor.backend.orderWrite(gor.session, { order: o, fields: { status: 'taken', taker: 'gor', wantN: 1 } })), 'config');
    assert.equal(await codeOf(gor.backend.orderWrite(gor.session, { order: o })), 'config'); // only its owner closes it
    assert.equal(await codeOf(gor.tradeSave({ rev: 1 }, row, { id: 'x', fields: { owner: 'aram', status: 'open', at: 1 } })), 'config');
  } finally {
    done();
  }
});

test('an older tab cannot bring sold goods back; ordinary saves keep working; loading prefers the higher rev', async () => {
  const { fake, join, done } = await classroom();
  try {
    const aram = await join('aram');
    await aram.saveOnline({ rev: 0, goods: 'all', updated: 1 }, row);
    await aram.saveOnline({ rev: 0, goods: 'all, later', updated: 2 }, row); // no trade: as before
    await place(aram);
    assert.equal(await codeOf(aram.saveOnline({ rev: 0, goods: 'all', updated: 3 }, row)), 'stale');
    assert.equal(JSON.parse(fake.docs.get('saves/aram').data.stringValue).goods, 'after placing');
    assert.equal(await codeOf(aram.saveOnline({ rev: 1, goods: 'same tab', updated: 4 }, row)), 'ok');
    aram.saveLocal({ rev: 0, goods: 'old browser copy' }); // newer `updated`, but from before the trade
    assert.equal((await aram.loadSave()).goods, 'same tab');
    aram.saveLocal({ rev: 1, goods: 'newest copy' }); // same rev: the newer one, as before
    assert.equal((await aram.loadSave()).goods, 'newest copy');
  } finally {
    done();
  }
});

test('the teacher takes an order off the list and its owner gets the goods back; deleting a player removes their orders', async () => {
  const { fake, join, done } = await classroom();
  try {
    const [aram, gor, admin] = [await join('aram'), await join('gor'), await join('admin')];
    await place(aram);
    const [o] = await admin.orders(0);
    assert.equal(await codeOf(gor.removeOrder(o)), 'unknown');
    await admin.removeOrder(o);
    const [removed] = await aram.myOrders();
    assert.equal(removed.status, 'removed');
    await aram.tradeSave({ rev: 2 }, row, { order: removed });
    await place(gor);
    await admin.removePlayer('gor');
    assert.equal([...fake.docs.keys()].filter((k) => k.startsWith('orders/')).length, 0);
  } finally {
    done();
  }
});

test('rename is refused while you have orders, and works after them', async () => {
  const { join, done } = await classroom();
  try {
    const aram = await join('aram');
    await place(aram);
    assert.equal(await codeOf(aram.rename('Aramik', 'secret1', { rev: 1 }, row)), 'hasOrders');
    const [o] = await aram.myOrders();
    await aram.tradeSave({ rev: 2 }, row, { order: o });
    assert.deepEqual(await aram.rename('Aramik', 'secret1', { rev: 2 }, row), { id: 'aramik', name: 'Aramik' });
  } finally {
    done();
  }
});

test('the market works in this browser too, without Firebase', async () => {
  const a = new Accounts(memory());
  await a.register('aram', 'secret1');
  await place(a);
  const [o] = await a.orders(0);
  await a.backend.orderWrite(a.session, { order: o, fields: { status: 'taken', taker: 'gor' } });
  assert.equal(await codeOf(a.tradeSave({ rev: 2 }, row, { order: o })), 'gone'); // changed since I saw it
  const [sold] = await a.myOrders();
  assert.equal(sold.status, 'taken');
  await a.tradeSave({ rev: 2 }, row, { order: sold });
  assert.deepEqual(await a.myOrders(), []);
});

test('market mistakes in settings.json are reported', () => {
  const broken = structuredClone(config);
  broken.settings.market.goods.push('Star2');
  broken.settings.market.band = 0;
  const errors = validateConfig(broken).map((e) => e.path || e.field || String(e)).join();
  assert.match(errors, /market\.goods/);
  assert.match(errors, /market\.band/);
});
