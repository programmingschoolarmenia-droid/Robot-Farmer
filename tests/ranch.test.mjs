import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, loadConfig } from './helpers.mjs';
import { Game } from '../js/engine/game.js';
import { STEP } from '../js/engine/animals.js';
import { validateConfig } from '../js/core/config.js';
import { createI18n } from '../js/core/i18n.js';
import { describeError } from '../js/ui/errorText.js';
import { Accounts, boardField } from '../js/storage/account.js';
import { createFakeFirebase } from './fakeFirebase.mjs';

const noon = (key) => Date.UTC(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8), 8);
const reload = (game) => new Game(game.config, JSON.parse(JSON.stringify(game.toSave())));
// Takes an area's drone to (x, y).
const GO = 'function go(x, y) {\n  while (dirqX() < x) gnal(Aj);\n  while (dirqX() > x) gnal(Dzax);\n  while (dirqY() < y) gnal(Verev);\n  while (dirqY() > y) gnal(Nerqev);\n}\n';

// Runs ranch scripts ({ tab: code }) together until all of them end or `seconds` of ranch time pass.
function runRanch(game, scripts, { seconds = 600, step = 0.1 } = {}) {
  const r = game.ranch;
  const out = [];
  const warnings = [];
  const errors = [];
  const offs = [
    r.events.on('print', (e) => out.push(e.text)),
    r.events.on('warning', (e) => warnings.push(e.code)),
    r.events.on('runError', (e) => errors.push(e.error)),
  ];
  for (const [name, code] of Object.entries(scripts)) r.setScriptCode(name, code);
  for (const name of Object.keys(scripts)) r.start(r.penOfScript(name).id);
  const end = r.time + seconds;
  while (r.state() === 'running' && r.time < end) r.update(step);
  offs.forEach((f) => f());
  return { out, warnings, errors: errors.map((e) => e.code), error: errors[0] };
}

const buy = (r, ...ids) => {
  r.inventory.add('Dram', 100000);
  for (const id of ids) assert.deepEqual(r.buy(id), { ok: true }, id);
};

test('the ranch research appears after 70 research levels and shows the ranch button', () => {
  const levels = { Loops: 1, Speed: 5, Grass: 10, Expand: 9, Plant: 1, Carrots: 10, Operators: 1, Watering: 9, Trees: 10, Variables: 1, Lists: 1, Objects: 1, Functions: 1, Pumpkins: 9 };
  const game = makeGame({ levels, items: { Hay: 500000, Wood: 500000, Carrot: 200000, Pumpkin: 100000 } });
  assert.equal(game.research.totalLevels(), 69);
  assert.equal(game.research.state('Ranch'), 'locked', 'its parents are done, but only 69 levels');
  game.research.levels.set('Pumpkins', 10);
  assert.equal(game.research.state('Ranch'), 'affordable');
  assert.equal(game.research.hasPanel('ranch'), false);
  assert.equal(game.research.buy('Ranch').ok, true);
  assert.equal(game.research.hasPanel('ranch'), true);
  assert.deepEqual(['Hay', 'Wood', 'Carrot', 'Pumpkin'].map((i) => game.inventory.get(i)), [0, 0, 0, 0]);
});

test('a new ranch: two hens and the market on one map, 50 ֏ and some grain, a code tab and a drone per area', () => {
  const r = makeGame().ranch;
  assert.deepEqual([...r.pens.keys()], ['Hens', 'Market']);
  assert.deepEqual(r.scripts.map((s) => s.name), ['havanoc', 'shuka']);
  assert.deepEqual(r.inventory.toSave(), { Dram: 50, Grain: 6 });
  assert.equal(r.penOf('Hen').animals.length, 2);
  assert.equal(r.marketId, 'Market');
  assert.deepEqual([r.world, r.cell('Hens'), r.cell('Market'), r.penSize('Hens')], [{ width: 3, height: 3 }, { col: 0, row: 0 }, { col: 0, row: 1 }, 4]);
  assert.deepEqual(r.quests.current().id, 'ranch_egg');
});

test('animals: hunger grows; a hungry hen walks to the trough with grain and eats from it', () => {
  const r = makeGame({ seed: 3 }).ranch;
  const pen = r.penOf('Hen');
  pen.animals.splice(1);
  const hen = pen.animals[0];
  const trough = pen.objectAt(0, 3);
  Object.assign(hen, { x: 3, y: 0, hunger: 0, thirst: 0, timer: 1000 });
  pen.sync(10);
  assert.equal(hen.hunger, 5, '0.5 a second');
  Object.assign(hen, { hunger: 90, timer: 1 });
  trough.amount = 2;
  for (let t = 10; t < 200 && trough.amount === 2; t += STEP) pen.sync(t);
  assert.deepEqual([hen.x, hen.y, trough.amount], [0, 3, 1]);
  assert.ok(hen.hunger < 50, 'ate');
});

test('mood: a starving, thirsty hen gives nothing; a happy one lays eggs on free squares', () => {
  const r = makeGame({ seed: 5 }).ranch;
  const pen = r.penOf('Hen');
  const [sad, happy] = pen.animals;
  Object.assign(sad, { hunger: 100, thirst: 100, mood: 30, prod: 0 });
  Object.assign(happy, { hunger: 0, thirst: 0, mood: 100, prod: 0 });
  pen.sync(120);
  assert.equal(sad.prod, 0);
  assert.ok(sad.mood <= 30);
  const eggs = Object.keys(pen.ground);
  assert.ok(eggs.length >= 1, 'laid');
  for (const k of eggs) assert.equal(pen.objectAt(...k.split(',').map(Number)), null, 'never on a trough, the well or the basket');
});

test('hands: carried eggs go into the basket and count as points; feed and water go into the troughs', () => {
  const game = makeGame({ unlockAll: true, seed: 9 });
  const r = game.ranch;
  const pen = r.penOf('Hen');
  pen.ground = { '1,1': 'Egg', '2,1': 'Egg', '3,1': 'Egg', '1,2': 'Egg' };
  for (const a of pen.animals) a.prod = 0;
  const code = 'go(1, 1); havaqel(); go(2, 1); havaqel(); go(3, 1); havaqel();\ngo(1, 2); tpel(havaqel(), dzerqum());\ngo(0, 0); tpel(datarkel());\ntpel(vercnel(Irer.Hatik, 2)); go(0, 3); tpel(lcnel());\ngo(3, 0); tpel(vercnel(Irer.Jur)); go(3, 3); tpel(lcnel()); tpel(lcnel());';
  const res = runRanch(game, { havanoc: GO + code });
  assert.deepEqual(res.out, ['false 3', '3', '2', '2', '3', '3', '0']);
  assert.deepEqual(res.warnings, ['ranch_handsFull', 'ranch_wrongFeed']);
  assert.deepEqual([r.inventory.get('Egg'), r.inventory.get('Grain'), pen.objectAt(0, 3).amount, pen.objectAt(3, 3).amount], [3, 4, 2, 3]);
  const egg = game.stats.breakdown().find((b) => b.item === 'Egg');
  assert.deepEqual([egg.amount, egg.points], [3, 3 * game.config.settings.leaderboard.points.Egg]);
  const wrong = runRanch(game, { havanoc: GO + 'go(1, 1); vercnel(Irer.Hatik); datarkel(); go(0, 0); vercnel(Irer.Jur); vercnel(Irer.Dzu);' });
  assert.deepEqual(wrong.warnings, ['ranch_takeWhere', 'ranch_noBasket', 'ranch_takeWhat']);
});

test('cows walk around: the drone finds a ready cow with kendaniner() and milks it', () => {
  const game = makeGame({ unlockAll: true, seed: 11 });
  const r = game.ranch;
  buy(r, 'Cows', 'animals');
  for (const c of r.penOf('Cow').animals) Object.assign(c, { prod: 1, hunger: 0, thirst: 0, mood: 100 });
  const code = 'while (!kitel()) {\n  let c = kendaniner().find((a) => a.patrast);\n  go(c.x, c.y);\n}\ntpel(dzerqum(Irer.Kat), kendaniner().filter((a) => a.patrast).length);\ngo(0, 0);\ndatarkel();';
  const res = runRanch(game, { gom: GO + code });
  assert.deepEqual([res.errors, res.out], [[], ['1 1']]);
  assert.equal(r.inventory.get('Milk'), 1);
});

test('the market: prices change every day and are the same for everyone; only the market drone trades', () => {
  const day = '20261029';
  const game = makeGame({ clock: noon(day), unlockAll: true });
  const r = game.ranch;
  const other = makeGame({ clock: noon(day), seed: 99 }).ranch;
  const items = ['Egg', 'Milk', 'Grain', 'Bale'];
  const today = items.map((i) => r.price(i));
  assert.deepEqual(today, items.map((i) => other.price(i)));
  assert.ok(['20261030', '20261031', '20261101'].some((d) => items.map((i) => r.price(i, d)).join() !== today.join()), 'they change');
  items.forEach((item, i) => {
    const base = r.cfg.items[item].sell ?? r.cfg.items[item].buy;
    assert.ok(today[i] >= Math.floor(base * 0.7) && today[i] <= Math.ceil(base * 1.3), item);
  });
  r.inventory.add('Egg', 10);
  const egg = r.price('Egg');
  assert.deepEqual(runRanch(game, { havanoc: 'tpel(vacharel(Irer.Dzu));' }), { out: ['0'], warnings: ['ranch_notMarket'], errors: [], error: undefined });
  assert.deepEqual(runRanch(game, { shuka: 'tpel(vacharel(Irer.Dzu, 4));\ntpel(vacharel(Irer.Dzu));\ntpel(vacharel(Irer.Dzu));' }).out, [String(4 * egg), String(6 * egg), '0']);
  assert.deepEqual([r.inventory.get('Dram'), r.earned.total, r.earned.day, r.earned.month], [50 + 10 * egg, 10 * egg, { key: day, dram: 10 * egg }, { key: '202610', dram: 10 * egg }]);
  // feed for ֏, and the farm's cart (10 000 farm hay → 1 bale)
  assert.deepEqual(runRanch(game, { shuka: 'gnel(Irer.Hatik, 1);' }).errors, ['lockedFunction']);
  buy(r, 'buy', 'cart');
  const dram = r.inventory.get('Dram');
  game.inventory.add('Hay', 25000);
  const res = runRanch(game, { shuka: 'tpel(gnel(Irer.Hatik, 5));\ntpel(gnel(Irer.Dzu, 1));\ntpel(berel(Irer.XotiHak, 3));' });
  assert.deepEqual([res.out, res.warnings], [['5', '0', '2'], ['ranch_cantBuy', 'ranch_cartShort']]);
  assert.deepEqual([r.inventory.get('Grain'), r.inventory.get('Dram'), r.inventory.get('Bale'), game.inventory.get('Hay')], [11, dram - 5 * r.price('Grain'), 2, 5000]);
});

test('orders: three a day for what the ranch makes, the same for everyone; each pays once, more than the market', () => {
  const day = '20261029';
  const game = makeGame({ clock: noon(day), unlockAll: true });
  const r = game.ranch;
  const board = r.orders();
  assert.equal(board.list.length, 3);
  assert.deepEqual(board.list, makeGame({ clock: noon(day), seed: 4 }).ranch.orders().list);
  assert.ok(board.list.every((q) => Object.keys(q.items).join() === 'Egg'), 'no cows, no milk');
  const q = board.list[0];
  assert.ok(q.pay > q.items.Egg * r.cfg.items.Egg.sell);
  buy(r, 'orders');
  r.inventory.add('Egg', q.items.Egg);
  const dram = r.inventory.get('Dram');
  const res = runRanch(game, { shuka: 'tpel(hanznel(0));\ntpel(hanznel(0));\ntpel(hanznel(7));\nlet p = patverner();\ntpel(p.length, p[0].katarvac, p[0].gin);' });
  assert.deepEqual([res.out, res.warnings], [['true', 'false', 'false', `3 true ${q.pay}`], ['ranch_order_done', 'ranch_order_noOrder']]);
  assert.deepEqual([r.inventory.get('Dram'), r.inventory.get('Egg'), r.ordersDone, r.earned.total], [dram + q.pay, 0, 1, q.pay]);
});

test('the shop: areas, animals while there is room, bigger pens, troughs built by code, upgrades and commands', () => {
  const game = makeGame({ unlockAll: true });
  const r = game.ranch;
  assert.deepEqual(['Cows', 'Cow', 'Goats', 'Sheep', 'pet'].map((id) => r.shopState(id)), ['expensive', 'locked', 'locked', 'soon', 'affordable']);
  buy(r, 'Cows');
  assert.deepEqual([[...r.pens.keys()], r.penOf('Cow').animals.length, r.scripts.map((s) => s.name), r.hasFunction('milk')], [['Hens', 'Market', 'Cows'], 2, ['havanoc', 'shuka', 'gom'], true]);
  const pen = r.penOf('Hen');
  buy(r, 'Hen', 'Hen');
  assert.deepEqual([pen.animals.length, pen.capacity(), r.shopState('Hen')], [4, 4, 'full']);
  buy(r, 'HensBig');
  assert.deepEqual([pen.size, pen.capacity(), r.shopState('Hen'), r.shopState('HensBig')], [5, 6, 'affordable', 'affordable']);
  buy(r, 'FeedTrough');
  const res = runRanch(game, { havanoc: GO + 'go(2, 2);\ntpel(karucel(Sarqer.Keraman));\ntpel(karucel(Sarqer.Keraman));\ngo(1, 1);\ntpel(karucel(Sarqer.Jrhor));' });
  assert.deepEqual([res.out, res.warnings, pen.objectAt(2, 2).type, r.tokens.FeedTrough], [['true', 'false', 'false'], ['ranch_noToken', 'ranch_cantBuild'], 'FeedTrough', 0]);
  const rate = pen.drone.tickRate();
  buy(r, 'Speed', 'Hands');
  assert.deepEqual([pen.drone.tickRate() / rate, r.handsCapacity()], [1.5, 5]);
  // a command that is not bought yet, and a farm command the ranch doesn't have
  const locked = runRanch(game, { havanoc: 'shoyel();' });
  const i18n = createI18n(game.config.texts, game.config.research.nodes, game.config.guide);
  assert.deepEqual([locked.errors, describeError(locked.error, i18n, r).message], [['lockedFunction'], 'shoyel() հրամանը դեռ չունես։ Գնիր այն ռանչոյի «Խանութ»-ից։']);
  assert.deepEqual(runRanch(game, { havanoc: 'tnkel(Bujser.Xot);' }).errors, ['notDefined']);
  buy(r, 'pet');
  assert.deepEqual(runRanch(game, { havanoc: 'tpel(shoyel() || true);' }).errors, []);
});

test('running: all areas at once or one by one, fences stop the drones, and each world waits while the other runs', () => {
  const game = makeGame({ unlockAll: true });
  const r = game.ranch;
  const res = runRanch(game, { havanoc: 'gnal(Dzax);\ngnal(Nerqev);\ntpel(dirqX(), dirqY(), karoxEmGnal(Dzax), karoxEmGnal(Aj), fermayiChap());', shuka: 'tpel(fermayiChap());' });
  assert.deepEqual(res.out.sort(), ['0 0 false true 4', '3']);
  r.setScriptCode('havanoc', 'while (true) {\n  gnal(Aj);\n  gnal(Dzax);\n}');
  r.setScriptCode('shuka', 'while (true) {\n  tpel(1);\n}');
  r.startAll();
  assert.equal(r.state(), 'running');
  r.stop('Market');
  assert.deepEqual([r.pens.get('Hens').runner.state, r.pens.get('Market').runner.state], ['running', 'idle']);
  const [farmTime, ranchTime] = [game.time, r.time];
  r.update(0.1);
  assert.deepEqual([game.time, r.time > ranchTime], [farmTime, true], 'the farm waits while the ranch runs');
  const now = r.time;
  game.update(0.1);
  assert.deepEqual([r.time, game.time > farmTime], [now, true], 'and the ranch waits while the farm runs');
  r.pauseAll();
  r.update(0.1);
  assert.equal(r.time, now, 'paused');
  r.stopAll();
  assert.equal(r.state(), 'idle');
});

test('the same ranch program gives the same result at any speed and frame rate', () => {
  const code = `${GO}let eggs = 0;
vercnel(Irer.Hatik, 3); go(0, 3); lcnel();
go(3, 0); vercnel(Irer.Jur); go(3, 3); lcnel();
while (eggs < 3) {
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      go(x, y);
      if (inchKa() == Irer.Dzu) {
        havaqel();
        eggs++;
      }
    }
  }
}
go(0, 0);
datarkel();
tpel(zhamanak(), qanak(Irer.Dzu));`;
  const play = (speed, step) => {
    const game = makeGame({ unlockAll: true, seed: 21 });
    game.ranch.speed = speed;
    return runRanch(game, { havanoc: code }, { seconds: 900, step }).out;
  };
  const base = play(1, 0.1);
  assert.equal(base.length, 1);
  assert.match(base[0], / 3$/);
  assert.deepEqual([play(0.25, 0.1), play(1, 0.033), play(0.5, 0.07)], [base, base, base]);
});

test('the ranch is saved with the game and comes back the same', () => {
  const game = makeGame({ unlockAll: true, seed: 2 });
  const r = game.ranch;
  buy(r, 'Cows', 'FeedTrough', 'Hands');
  runRanch(game, { havanoc: GO + 'go(2, 2);\nkarucel(Sarqer.Keraman);\ngo(0, 0);\nvercnel(Irer.Hatik, 2);' });
  r.update(0.1);
  r.syncAll();
  const copy = reload(game).ranch;
  assert.deepEqual(copy.toSave(), r.toSave());
  assert.deepEqual([copy.penOf('Hen').drone.hands, copy.penOf('Hen').objectAt(2, 2).type, copy.handsCapacity()], [{ Grain: 2 }, 'FeedTrough', 5]);
});

test('ranch stickers, quests and the leaderboard row', () => {
  const day = '20261029';
  const game = makeGame({ clock: noon(day), unlockAll: true });
  const r = game.ranch;
  const pen = r.penOf('Hen');
  pen.ground = { '1,0': 'Egg' };
  runRanch(game, { havanoc: GO + 'go(1, 0);\nhavaqel();\ngo(0, 0);\ndatarkel();' });
  assert.equal(game.stickers.earned.has('firstEgg'), true);
  assert.equal(r.quests.current().id, 'ranch_troughs');
  r.inventory.add('Egg', 300);
  runRanch(game, { shuka: 'vacharel(Irer.Dzu);' });
  const row = game.leaderStats().ranch;
  assert.deepEqual(row, { total: r.earned.total, day: { key: day, dram: r.earned.total }, month: { key: '202610', dram: r.earned.total } });
  assert.equal(game.stickers.earned.has('dram1000'), r.earned.total >= 1000);
});

test('the 🐄 ranch list: ֏ earned today, this month and all time (here and on Firebase)', async () => {
  const realFetch = globalThis.fetch;
  const memory = () => {
    const m = new Map();
    return { get: (k) => m.get(k) ?? null, set: (k, v) => (m.set(k, v), true), remove: (k) => m.delete(k) };
  };
  const stats = (ranch) => ({ research: 0, playSeconds: 0, hat: 'Straw_Hat', farm: '1×1', points: 0, code: 0, streak: 1, day: { key: '', points: 0 }, month: { key: '', points: 0 }, ranch });
  for (const online of [false, true]) {
    globalThis.fetch = createFakeFirebase().fetch;
    try {
      const a = new Accounts(memory(), online ? { apiKey: 'test-key', projectId: 'test-project' } : {});
      const earned = (total, today) => ({ total, day: { key: today ? '20261029' : '20261028', dram: 40 }, month: { key: '202610', dram: total } });
      for (const [name, r] of [['ani', earned(500, true)], ['bob', earned(900, false)], ['gor', null]]) {
        await a.register(name, 'secret1');
        await a.saveOnline({}, stats(r));
      }
      const list = async (tab) => (await a.leaderboard(boardField(tab, '20261029'))).rows.map((row) => [row.name, row[boardField(tab, '20261029')]]);
      assert.deepEqual(await list('ranch_all'), [['bob', 900], ['ani', 500]]);
      assert.deepEqual(await list('ranch_month'), [['bob', 900], ['ani', 500]]);
      assert.deepEqual(await list('ranch_day'), [['ani', 40]]);
    } finally {
      globalThis.fetch = realFetch;
    }
  }
});

test('ranch.json and the ranch names in aliases.json: mistakes are reported', () => {
  const config = loadConfig();
  config.ranch.map.layout[0][0] = 'Hense';
  config.ranch.animals.Hen.feed = 'Egg';
  config.ranch.shop.push({ id: 'fly', kind: 'command', cost: 5, grants: ['fly'] });
  config.ranch.quests[0].goals[0] = { type: 'gain', item: 'Gold', amount: 1 };
  config.aliases.ranch.functions.sell = ['gin']; // price() is gin
  const node = config.research.nodes.findIndex((n) => n.id === 'Ranch');
  config.research.nodes[node].minLevels = -1;
  const found = validateConfig(config).map((e) => `${e.file} ${e.path}`);
  const fly = `ranch.json shop[${config.ranch.shop.length - 1}].grants`;
  for (const where of ['ranch.json map.layout', 'ranch.json animals.Hen.feed', fly, 'ranch.json quests[0].goals[0].item', 'aliases.json ranch.functions.price', `research.json nodes[${node}] (Ranch).minLevels`]) {
    assert.ok(found.includes(where), `${where} in ${found.join(' | ')}`);
  }
  assert.deepEqual(validateConfig(loadConfig()), []);
});

// ---------------------------------------------------------------- part 2: workshop and life

test('the workshop: milk from the basket into the dairy, cheese after its seconds, then into the storage', () => {
  const game = makeGame({ unlockAll: true });
  const r = game.ranch;
  buy(r, 'Cows', 'Workshop');
  assert.deepEqual([r.pens.has('Workshop'), r.hasFunction('make'), r.penOf('Cow') !== null], [true, true, true]);
  r.inventory.add('Milk', 3);
  const code = `${GO}vercnel(Irer.Kat, 3);
go(3, 1);
tpel(lcnel(), patrastel(Irer.Panir), havaqel());
while (inchKa() == Sarqer.Katnatun && !havaqel()) {}
go(0, 0);
tpel(datarkel(), qanak(Irer.Panir), qanak(Irer.Kat));`;
  const out = runRanch(game, { arhestanoc: code }, { seconds: 200 });
  assert.deepEqual(out.out, ['3 true false', '1 1 0']);
  assert.deepEqual(out.errors, []);
  const dairy = r.pens.get('Workshop').objectAt(3, 1);
  assert.deepEqual([dairy.making, dairy.ready, dairy.inside], [null, null, {}]);
  const busy = runRanch(game, { arhestanoc: `${GO}go(3, 1);\npatrastel(Irer.Karag);\npatrastel(Irer.Dzu);` });
  assert.deepEqual(busy.warnings, ['ranch_machineMissing', 'ranch_noRecipe']);
});

test('events: erb() handlers run only when the drone is free, one after another; an endless loop blocks them', () => {
  const handler = `${GO}erb("dzu", (e) => {
  go(e.x, e.y);
  havaqel();
  go(0, 0);
  datarkel();
});
tpel("listening");`;
  const play = (code, step) => {
    const game = makeGame({ unlockAll: true, seed: 5 });
    const r = game.ranch;
    buy(r, 'events');
    for (const a of r.penOf('Hen').animals) Object.assign(a, { hunger: 0, thirst: 0, mood: 100, prod: 0.9 });
    const out = runRanch(game, { havanoc: code }, { seconds: 120, step });
    return { out: out.out, eggs: r.inventory.get('Egg'), state: r.pens.get('Hens').runner.state, errors: out.errors, time: r.time };
  };
  const a = play(handler, 0.1);
  assert.deepEqual([a.out, a.state, a.errors], [['listening'], 'running', []]);
  assert.ok(a.eggs >= 2, `eggs ${a.eggs}`);
  assert.deepEqual(play(handler, 0.037).eggs, a.eggs, 'the same at another frame rate');
  const blocked = play(`${handler}\nwhile (true) { gnal(Aj); gnal(Dzax); }`, 0.1);
  assert.deepEqual([blocked.eggs, blocked.out], [0, ['listening']]);
  const game = makeGame({ unlockAll: true });
  const bad = runRanch(game, { havanoc: 'erb("thunder", () => 1);' });
  assert.deepEqual(bad.errors, ['lockedFunction']);
  buy(game.ranch, 'events');
  assert.deepEqual(runRanch(game, { havanoc: 'erb("thunder", () => 1);' }).errors, ['badArg']);
});

test('the shared board: copies in and out, and writing tells the listening drones', () => {
  const game = makeGame({ unlockAll: true });
  const r = game.ranch;
  buy(r, 'events', 'board');
  const out = runRanch(game, {
    shuka: 'erb("grum", (e) => tpel("read", e.anun, kardal(e.anun).n));',
    havanoc: 'gnal(Aj);\nlet o = { n: 5, list: [1, 2] };\ngrel("hatik", o);\no.n = 9;\nlet c = kardal("hatik");\nc.list.push(3);\ntpel(kardal("hatik").n, kardal("hatik").list.length, kardal("chka"));',
  }, { seconds: 5 });
  assert.deepEqual(out.out.sort(), ['5 2 null', 'read hatik 5']);
  assert.deepEqual(reload(game).ranch.read('hatik'), { obj: { n: 5, list: [1, 2] } });
});

test('life: an egg left on the ground hatches into a chick with its mother\'s colour; cows get a calf', () => {
  const game = makeGame({ unlockAll: true, seed: 8 });
  const r = game.ranch;
  const pen = r.penOf('Hen');
  const hen = pen.animals[0];
  hen.color = 'Brown';
  r.cfg.needs.rareChance = 0;
  pen.ground['2,2'] = 'Egg';
  pen.laid['2,2'] = { t: r.time, color: 'Brown' };
  r.time += 100;
  pen.sync(r.time);
  const chick = pen.animals.find((a) => a.grownAt !== undefined);
  assert.deepEqual([pen.ground['2,2'], chick && chick.color, pen.young(chick, r.time), r.counts.born], [undefined, 'Brown', true, 1]);
  r.time += 200;
  pen.sync(r.time);
  assert.equal(pen.young(chick, r.time), false, 'grown up');
  buy(r, 'Cows');
  const cows = r.penOf('Cow');
  cows.objects.find((o) => o.type === 'FeedTrough').amount = 0;
  const keep = () => cows.animals.forEach((a) => Object.assign(a, { hunger: 0, thirst: 0, mood: 100 }));
  for (let i = 0; i < 1300; i++) {
    keep();
    r.time += 0.25;
    cows.sync(r.time);
  }
  assert.equal(cows.animals.length, 3, 'one calf in 300 s of happy cows');
  assert.ok(['Spotted', 'Brown', 'Black'].includes(cows.animals[2].color));
});

test('selling animals by id and by a villager\'s order for a colour', () => {
  const game = makeGame({ unlockAll: true, clock: noon('20261029') });
  const r = game.ranch;
  buy(r, 'sellAnimals', 'orders');
  const pen = r.penOf('Hen');
  const [h1, h2] = pen.animals;
  h1.color = 'Gold';
  const dram = r.inventory.get('Dram');
  const out = runRanch(game, { shuka: `tpel(vacharelKendani(${h1.id}), vacharelKendani(999));` });
  assert.deepEqual([out.out, out.warnings, pen.animals.length, r.inventory.get('Dram') - dram], [[String(25 * 3) + ' 0'], ['ranch_sellAnimal_noAnimal'], 1, 75]);
  r.board = { day: r.today(), list: [{ who: 0, line: 0, items: {}, animal: { type: 'Hen', color: h2.color }, pay: 40, done: false }] };
  assert.deepEqual([r.deliver(0).ok, pen.animals.length, r.board.list[0].done], [true, 0, true]);
});

test('sickness: a long time in dirt makes an animal sick; medicine and buzhel() cure it', () => {
  const game = makeGame({ unlockAll: true });
  const r = game.ranch;
  const pen = r.penOf('Hen');
  pen.animals.splice(1);
  const hen = pen.animals[0];
  Object.assign(hen, { x: 1, y: 1, timer: 1e9 });
  pen.dirt['1,1'] = 100;
  r.time += 70;
  pen.sync(r.time);
  assert.equal(hen.sick, true);
  buy(r, 'heal', 'animals');
  r.inventory.add('Medicine', 1);
  const out = runRanch(game, { havanoc: `${GO}tpel(buzhel());\nvercnel(Irer.Dex);\ngo(1, 1);\ntpel(kendaniner()[0].hivand, buzhel(), kendaniner()[0].hivand);` }, { seconds: 10 });
  assert.deepEqual([out.out, out.warnings, hen.sick, r.counts.healed], [['false', 'true true false'], ['ranch_noMedicine'], false, 1]);
});

test('goats butt the fence; through a hole they run away, and a plank and the rope bring them back', () => {
  const game = makeGame({ unlockAll: true, seed: 4 });
  const r = game.ranch;
  buy(r, 'Cows', 'Goats');
  const pen = r.penOf('Goat');
  assert.deepEqual([pen.animals.length, r.hasFunction('repair'), r.hasFunction('rope')], [2, true, true]);
  pen.fence['0,2,W'] = 0;
  const goat = pen.animals[0];
  Object.assign(goat, { x: 0, y: 2, timer: 1 });
  r.time += 1;
  pen.sync(r.time);
  assert.deepEqual([pen.runaways.length, pen.animals.length], [1, 1]);
  r.inventory.add('Plank', 1);
  buy(r, 'animals');
  const code = `${GO}go(2, 2);
tpel(kapel());
go(0, 0);
vercnel(Irer.Taxtak);
go(0, 2);
tpel(kapel(), norogel(), kapel(), kendaniner().length);`;
  const out = runRanch(game, { aycanoc: code }, { seconds: 30 });
  assert.deepEqual([out.out, out.warnings], [['false', 'false true true 2'], ['ranch_ropeEdge', 'ranch_ropeHole']]);
  assert.deepEqual([pen.holes(), pen.runaways.length, r.counts.returned], [[], 0, 1]);
  // goats on the edge damage the fence until there is a hole
  pen.animals.splice(0);
  const g = pen.addAnimal('Goat', 99);
  Object.assign(g, { x: 0, y: 0, hunger: 0, thirst: 0, mood: 100 });
  for (let i = 0; i < 4000 && !pen.holes().length; i++) {
    Object.assign(g, { x: 0, y: 0 });
    r.time += 0.25;
    pen.sync(r.time);
  }
  assert.equal(pen.holes().length, 1);
});

test('links: manure to the farm as fertilizer (not counted twice), farm boosts for ֏, seasons and more drones', () => {
  const game = makeGame({ unlockAll: true });
  const r = game.ranch;
  buy(r, 'ship', 'clean');
  r.penOf('Hen').dirt['1,0'] = 80;
  const before = game.stats.total('Fertilizer');
  const out = runRanch(game, { havanoc: `${GO}go(1, 0);\nmaqrel();\nmaqrel();`, shuka: '' });
  assert.deepEqual([out.errors, r.inventory.get('Manure')], [[], 1]);
  runRanch(game, { shuka: 'tpel(tanel(Irer.Gomaxb, 5), tanel(Irer.Hatik));' });
  assert.deepEqual([game.inventory.get('Fertilizer'), game.stats.total('Fertilizer') - before, r.inventory.get('Manure')], [3, 0, 0]);
  buy(r, 'FarmSpeed');
  assert.deepEqual([game.boost('speed'), game.boosts.speed.item], [1.5, 'Dram']);
  game.calendar.state = { season: 'Summer', weather: 'Rain' };
  assert.deepEqual(r.seasonFactors(), { hunger: 1, thirst: 1.5, dirt: 1.5, breed: 1 });
  game.calendar.state = null;
  buy(r, 'Drones');
  const two = runRanch(game, { havanoc: 'let d = norDron(() => 7);\ntpel(maxDronner(), spasel(d));' });
  assert.deepEqual([two.out, two.errors], [['2 7'], []]);
});

test('part 2 is saved with the ranch', () => {
  const game = makeGame({ unlockAll: true, seed: 6 });
  const r = game.ranch;
  buy(r, 'Cows', 'Workshop', 'Goats', 'board');
  const pen = r.penOf('Goat');
  pen.fence['0,1,W'] = 0;
  pen.runaways.push({ id: 50, type: 'Goat', x: 0, y: 1, hunger: 0, thirst: 0, mood: 10, prod: 0, petUntil: 0, timer: 1, color: 'Black' });
  r.pens.get('Workshop').objectAt(3, 1).inside = { Milk: 2 };
  r.write('plan', [1, 2], r.time);
  r.counts.born = 3;
  const copy = reload(game).ranch;
  assert.deepEqual(copy.toSave(), r.toSave());
  assert.deepEqual([copy.penOf('Goat').holes(), copy.penOf('Goat').runaways.length, copy.read('plan'), copy.counts.born], [['0,1,W'], 1, [1, 2], 3]);
});
