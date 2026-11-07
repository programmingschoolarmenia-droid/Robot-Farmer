import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, loadConfig } from './helpers.mjs';
import { Game } from '../js/engine/game.js';
import { STEP } from '../js/engine/animals.js';
import { validateConfig } from '../js/core/config.js';
import { createI18n } from '../js/core/i18n.js';
import { describeError } from '../js/ui/errorText.js';
import { Accounts, boardField, playerRow, ascending } from '../js/storage/account.js';
import { testRanch, watchRanchGoal, weekTask, rollRanchWeek, recordRanchResult, giveContestPrize } from '../js/engine/challenge.js';
import { weekKey } from '../js/core/util.js';
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

test('the ranch research appears after 40 research levels and shows the ranch button', () => {
  const levels = { Loops: 1, Speed: 5, Grass: 10, Expand: 7, Plant: 1, Carrots: 10, Operators: 1, Variables: 1, Lists: 1, Objects: 1, Functions: 1 };
  const game = makeGame({ levels, items: { Hay: 250000, Wood: 250000, Carrot: 100000, Pumpkin: 50000 } });
  assert.equal(game.research.totalLevels(), 39);
  assert.equal(game.research.state('Ranch'), 'locked', 'its parents are done, but only 39 levels');
  game.research.levels.set('Expand', 8);
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

test('rescue: nothing to feed, sell or buy with brings a villager with feed, once a day', () => {
  const game = makeGame({ seed: 3 });
  const r = game.ranch;
  game.stats.clock = () => noon('20260105');
  const pen = r.penOf('Hen');
  const broke = () => {
    for (const item of ['Grain', 'Dram']) r.inventory.add(item, -r.inventory.get(item));
    pen.ground = {};
    for (const o of pen.objects) if (o.type === 'FeedTrough') o.amount = 0;
    for (const a of pen.animals) Object.assign(a, { hunger: 100, thirst: 100, prod: 0 });
  };
  const look = () => {
    r.rescueAt = 0;
    r.rescue();
    return r.inventory.get('Grain');
  };
  const events = [];
  r.events.on('rescue', (e) => events.push(e));
  assert.equal(look(), 6, 'a new ranch needs no help');
  broke();
  assert.equal(look(), 5, 'starving, no feed, no goods, no money');
  assert.equal(events.length, 1);
  assert.ok(events[0].who.name);
  broke();
  assert.equal(look(), 0, 'only once a day');
  assert.equal(reload(game).ranch.rescueDay, r.rescueDay, 'remembered in the save');
  game.stats.clock = () => noon('20260106');
  // each of these still has a way out, so nobody comes
  broke();
  pen.ground = { '1,1': 'Egg' };
  assert.equal(look(), 0, 'an egg on the ground');
  broke();
  r.inventory.add('Egg', 1);
  assert.equal(look(), 0, 'an egg to sell');
  r.inventory.add('Egg', -1);
  broke();
  r.inventory.add('Dram', 15);
  assert.equal(look(), 0, 'money for the feed command');
  broke();
  pen.animals[0].hunger = 50;
  assert.equal(look(), 0, 'a hen that can still lay');
  broke();
  assert.equal(look(), 5, 'and on a new day, help again');
  // a challenge is on its own
  const test = testRanch(game.config, { seed: 1, levels: {} }).ranch;
  assert.equal(test.noRescue, true);
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
  assert.deepEqual(['Cows', 'Cow', 'Goats', 'Sheep', 'pet'].map((id) => r.shopState(id)), ['expensive', 'locked', 'locked', 'locked', 'affordable']);
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
  assert.deepEqual(runRanch(game, { havanoc: 'herkel();' }).errors, ['notDefined']);
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
  assert.deepEqual(r.seasonFactors(), { hunger: 1, thirst: 1.5, dirt: 1.5, breed: 1, heat: 1.5, wool: 1, honey: 1 });
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

// ---------------------------------------------------------------- part 3

const sheepRanch = () => {
  const game = makeGame({ unlockAll: true });
  const r = game.ranch;
  buy(r, 'Cows', 'Workshop', 'Goats', 'Sheep', 'animals');
  return { game, r, pen: r.pens.get('Sheep') };
};
const only = (pen, ...at) => {
  pen.animals.splice(1);
  const [a] = pen.animals;
  Object.assign(a, { x: at[0], y: at[1], hunger: 0, thirst: 0, mood: 100, timer: 1 });
  return a;
};

test('sheep keep away from the drone; a program can push one into the shearing corner; only there it can be sheared', () => {
  const { game, r, pen } = sheepRanch();
  assert.equal(pen.size, 6);
  assert.equal(pen.animals.length, 3);
  const a = only(pen, 2, 2);
  pen.drone.x = 1;
  pen.drone.y = 2;
  pen.sync(r.time + 2);
  assert.ok(Math.abs(a.x - 1) + Math.abs(a.y - 2) > 1, 'it stepped away');
  // pushed from the bottom left it runs into the top right corner
  Object.assign(a, { x: 1, y: 1, timer: 1, hunger: 0, thirst: 0 });
  Object.assign(pen.drone, { x: 0, y: 0 });
  const out = runRanch(game, {
    parax: `${GO}while (true) {
  let s = kendaniner()[0];
  if (s.x >= 4 && s.y >= 4) { break; }
  go(Math.max(0, s.x - 1), Math.max(0, s.y - 1));
}
tpel("ok");`,
  }, { seconds: 300 });
  assert.deepEqual([out.errors, out.out], [[], ['ok']]);
  assert.ok(pen.inCorner(a.x, a.y));
  // outside the corner it is refused; inside it gives wool of its colour
  Object.assign(a, { x: 3, y: 3, prod: 1, color: 'Brown', timer: 1000 });
  Object.assign(pen.drone, { x: 3, y: 3 });
  const no = runRanch(game, { parax: 'tpel(xuzel());\ntpel(kitel());' });
  assert.deepEqual([no.out, no.warnings], [['false', 'false'], ['ranch_shearCorner']]);
  Object.assign(a, { x: 5, y: 5 });
  Object.assign(pen.drone, { x: 5, y: 5 });
  const yes = runRanch(game, { parax: 'tpel(xuzel());\ntpel(dzerqum(Irer.BurdDarchnaguyn));\ntpel(kendaniner()[0].patrast);' });
  assert.deepEqual([yes.out, r.counts.sheared], [['true', '1', 'false'], 1]);
});

test('herding gives the same result at any frame rate', () => {
  const play = (step) => {
    const { game, r, pen } = sheepRanch();
    const out = runRanch(game, {
      parax: `${GO}for (let k = 0; k < 12; k++) {
  let s = kendaniner()[k % 3];
  go(Math.max(0, s.x - 1), Math.max(0, s.y - 1));
}`,
    }, { seconds: 200, step });
    assert.deepEqual(out.errors, []);
    return JSON.stringify(pen.animals.map((a) => [a.x, a.y, a.prod]));
  };
  assert.equal(play(0.033), play(0.1));
});

test('the bell brings the sheep to its square; the gampr frightens them like the drone', () => {
  const { game, r, pen } = sheepRanch();
  buy(r, 'Bell', 'Gampr');
  const a = only(pen, 0, 3);
  const out = runRanch(game, { parax: `${GO}go(3, 3);\nzangel();\ntpel(dirqX());` });
  assert.deepEqual(out.errors, []);
  assert.ok(pen.bell && pen.bell.x === 3 && pen.bell.y === 3);
  pen.sync(r.time + 12);
  assert.deepEqual([a.x, a.y], [3, 3], 'it came to the bell (and does not run from the drone)');
  pen.bell = null;
  // the gampr: a command walks it, and a sheep next to it runs
  Object.assign(pen.drone, { x: 0, y: 0 });
  assert.deepEqual(pen.dogHere(), { x: 5, y: 1 });
  const walk = runRanch(game, { parax: 'tpel(gamprGnal(Verev));\ntpel(gamprGnal(Aj));' });
  assert.deepEqual([walk.out, pen.dog.x, pen.dog.y], [['true', 'false'], 5, 2]);
  Object.assign(a, { x: 4, y: 2, timer: 1, hunger: 0, thirst: 0 });
  pen.sync(pen.steps * STEP + 3);
  assert.ok(Math.abs(a.x - 5) + Math.abs(a.y - 2) > 1, 'it ran from the gampr');
  // the bell and the gampr work only with sheep
  const hens = runRanch(game, { havanoc: 'tpel(zangel());\ntpel(gamprGnal(Aj));' });
  assert.deepEqual([hens.out, hens.warnings], [['false', 'false'], ['ranch_bellWhere', 'ranch_noDog']]);
});

test('wool becomes yarn of its colour on the wheel, white yarn takes a dye from a plant; what does not fit in the hands stays', () => {
  const { game, r, pen } = sheepRanch();
  buy(r, 'DyePot');
  r.inventory.add('WoolBrown', 2);
  r.inventory.add('YarnWhite', 5);
  r.inventory.add('Pumpkin', 1);
  const spin = runRanch(game, {
    parax: `${GO}vercnel(Irer.BurdDarchnaguyn, 1);
go(2, 0);
lcnel();
tpel(patrastel(Irer.TelSev));
tpel(patrastel(Irer.TelDarchnaguyn));
while (!havaqel()) {}
tpel(dzerqum(Irer.TelDarchnaguyn));
go(0, 0);
datarkel();
go(2, 0);
havaqel();
go(0, 0);
datarkel();
go(1, 1);
karucel(Sarqer.Nerkaman);
go(0, 0);
vercnel(Irer.TelSpitak, 3);
go(1, 1);
lcnel();
go(0, 0);
vercnel(Irer.TelSpitak, 2);
vercnel(Irer.Ddum, 1);
go(1, 1);
lcnel();
tpel(patrastel(Irer.TelKarmir));`,
  });
  assert.deepEqual(spin.errors, []);
  assert.deepEqual(spin.out, ['false', 'true', '3', 'true']);
  assert.deepEqual(spin.warnings, ['ranch_machineMissing']);
  assert.equal(r.inventory.get('YarnBrown'), 5);
  assert.equal(r.counts.yarn, 1);
  const pot = pen.objectAt(1, 1);
  pen.sync(pot.until + 1);
  assert.deepEqual([pot.ready, pot.count, r.counts.dyed], ['YarnRed', 5, 1]);
});

test('weaving: an order on the loom, knots that cannot be changed, 81 knots end it; the price follows how alike it is', () => {
  const { game, r, pen } = sheepRanch();
  buy(r, 'events');
  const loom = pen.objectAt(3, 0);
  Object.assign(pen.drone, { x: 3, y: 0 });
  r.carpetBoard = { day: r.today(), list: [{ sample: 'rows', pay: 300, taken: false }, { sample: 'frame', pay: 400, taken: false }] };
  const loomOnly = runRanch(game, { parax: 'tpel(hyusel(0, 0, Guyner.Sev));' });
  assert.deepEqual(loomOnly.warnings, ['ranch_noCarpet']);
  r.inventory.add('YarnBlack', 1);
  const orders = runRanch(game, { parax: `let o = gorgPatverner();\ntpel(o.length, o[0].gin, o[0].vercvac);\ntpel(gorg(5));\ntpel(gorg(0));\ntpel(gorg(1));` });
  assert.deepEqual([orders.out, orders.warnings], [['2 300 false', 'false', 'true', 'false'], ['ranch_carpet_noOrder', 'ranch_carpet_busy']]);
  assert.equal(r.carpetBoard.list[0].taken, true);
  assert.deepEqual(runRanch(game, { parax: 'tpel(gorg(0));' }).warnings, ['ranch_carpet_busy'], 'the loom is busy');
  // no yarn yet, a square outside, a knot twice
  loom.inside = { YarnBlack: 1 };
  const knots = runRanch(game, { parax: `tpel(hyusel(0, 0, Guyner.Spitak));\ntpel(hyusel(9, 0, Guyner.Sev));\ntpel(hyusel(1.5, 0, Guyner.Sev));\ntpel(hyusel(0, 0, Guyner.Sev));\ntpel(hyusel(0, 0, Guyner.Sev));` });
  assert.deepEqual(knots.out, ['false', 'false', 'false', 'true', 'false']);
  assert.deepEqual(knots.warnings, ['ranch_knot_yarn', 'ranch_knot_outside', 'ranch_knot_outside', 'ranch_knot_taken']);
  assert.equal(loom.carpet.cells[72], 'K', '(0, 0) is the bottom left: the first letter of the last row');
  // the rest of the sample: a nested loop; a knot takes a second
  loom.inside = { YarnBlack: 50, YarnWhite: 50 };
  const t0 = r.time;
  let doneAt = 0;
  r.events.on('carpet', () => (doneAt = doneAt || pen.drone.time));
  const rest = runRanch(game, {
    parax: `erb("gorg", (e) => { tpel("done", e.tokos, e.gin); });
for (let y = 0; y < 9; y++) {
  for (let x = 0; x < 9; x++) {
    if (x > 0 || y > 0) {
      hyusel(x, y, y % 2 == 0 ? Guyner.Sev : Guyner.Spitak);
    }
  }
}`,
  }, { seconds: 200 });
  r.stopAll();
  assert.deepEqual([rest.errors, rest.warnings, rest.out], [[], [], ['done 100 300']]);
  assert.ok(doneAt - t0 >= 78 && doneAt - t0 < 90, `${doneAt - t0} seconds`);
  assert.deepEqual([loom.carpet, r.carpets.length, r.inventory.get('Carpet'), r.counts.carpets, r.counts.perfect, r.perfect.total], [null, 1, 1, 1, 1, 1]);
  assert.deepEqual([r.gallery.length, r.gallery[0].alike], [1, 1]);
  assert.equal(game.research.hasHat('Papakh_Hat'), true, 'the first carpet gives the papakh');
  // half alike pays half; soft yarn counts as white and pays more
  loom.inside = { YarnBlack: 81 };
  const half = runRanch(game, { parax: 'gorg(1);\nfor (let y = 0; y < 9; y++) {\n  for (let x = 0; x < 9; x++) {\n    hyusel(x, y, Guyner.Sev);\n  }\n}' }, { seconds: 200 });
  assert.deepEqual(half.errors, []);
  assert.deepEqual([Math.round(r.carpets[1].alike * 81), r.carpets[1].price], [32, Math.round((400 * 32) / 81)]);
  loom.inside = { YarnSoft: 81 };
  runRanch(game, { parax: 'gorg();\nfor (let y = 0; y < 9; y++) {\n  for (let x = 0; x < 9; x++) {\n    hyusel(x, y, Guyner.Papuk);\n  }\n}' }, { seconds: 200 });
  const free = r.carpets[2];
  assert.deepEqual([free.alike, free.price], [null, Math.round(250 * 1.5)]);
  // the market sells them all
  const dram = r.inventory.get('Dram');
  const sold = runRanch(game, { shuka: 'tpel(vacharelGorg());\ntpel(vacharelGorg());' });
  const sum = 300 + Math.round((400 * 32) / 81) + 375;
  assert.deepEqual([sold.out, sold.warnings, r.inventory.get('Dram') - dram, r.inventory.get('Carpet'), r.carpets], [[String(sum), '0'], ['ranch_noCarpets'], sum, 0, []]);
  assert.deepEqual(runRanch(game, { parax: 'vacharelGorg();' }).warnings, ['ranch_notMarket']);
});

test('bees: hives fill faster with more kinds of flowers around; stings slow the drone until the first honey gives the hat', () => {
  const game = makeGame({ unlockAll: true });
  const r = game.ranch;
  buy(r, 'Cows', 'Workshop', 'Goats', 'Sheep', 'Bees');
  const pen = r.pens.get('Bees');
  const hive = pen.objectAt(2, 2);
  r.inventory.add('Seed', 3);
  // planting takes a seed from the hands, one flower a square, only here
  const plant = runRanch(game, {
    mexvanoc: `${GO}tpel(tnkel(Caxikner.Vard));
vercnel(Irer.Serm, 3);
go(1, 1);
tpel(tnkel(Caxikner.Vard));
tpel(tnkel(Caxikner.Kakach));
go(3, 1);
tnkel(Caxikner.Vard);
tpel(caxkiTesak());
go(0, 4);
tnkel(Caxikner.Hasmik);
tpel(caxkiTesak());`,
  });
  assert.deepEqual(plant.errors, []);
  assert.deepEqual(plant.out, ['false', 'true', 'false', '1', '1']);
  assert.deepEqual(plant.warnings, ['ranch_noSeed', 'ranch_occupied']);
  assert.deepEqual(pen.flowers, { '1,1': 'Rose', '3,1': 'Rose', '0,4': 'Jasmine' });
  assert.equal(pen.flowerKinds(2, 2), 2, 'two kinds within 2 squares');
  assert.equal(runRanch(game, { havanoc: 'tpel(tnkel(Caxikner.Vard));' }).warnings[0], 'ranch_flowersWhere');
  const every = r.cfg.hive.every;
  hive.comb = 0;
  const t = r.time;
  pen.sync(t + every / 2 - 1);
  assert.equal(hive.ready, undefined);
  pen.sync(t + every / 2 + 1);
  assert.deepEqual([hive.ready, hive.comb], ['Comb', 0], 'two kinds: twice as fast');
  // stings: slower by the hive
  Object.assign(pen.drone, { x: 2, y: 3 });
  const stung = pen.drone.tickRate();
  pen.drone.x = 0;
  pen.drone.y = 0;
  assert.equal(stung / pen.drone.tickRate(), r.cfg.hive.sting);
  // comb → honey: the hat, and no more stings
  Object.assign(pen.drone, { x: 2, y: 2 });
  const honey = runRanch(game, { mexvanoc: `${GO}havaqel();\ngo(1, 0);\nlcnel();\npatrastel(Irer.Mexr);\nwhile (!havaqel()) {}\ngo(0, 0);\ndatarkel();` }, { seconds: 200 });
  assert.deepEqual([honey.errors, r.inventory.get('Honey'), game.research.hasHat('Beekeeper_Hat'), r.counts.honey], [[], 1, true, 1]);
  Object.assign(pen.drone, { x: 2, y: 3 });
  assert.equal(stung / pen.drone.tickRate(), r.cfg.hive.sting, 'as fast as far from a hive');
  assert.equal(pen.drone.tickRate(), stung / r.cfg.hive.sting);
  // maqrel takes a flower away; winter makes half the honey
  Object.assign(pen.drone, { x: 1, y: 1 });
  buy(r, 'clean');
  runRanch(game, { mexvanoc: 'maqrel();' });
  assert.equal(pen.flowers['1,1'], undefined);
  game.calendar.state = { season: 'Winter', weather: 'Snow' };
  assert.equal(r.seasonFactors().honey, 0.5);
  game.calendar.state = null;
});

test('buffalo: a hot buffalo gives no milk until it bathes in the pool the code keeps full', () => {
  const game = makeGame({ unlockAll: true });
  const r = game.ranch;
  buy(r, 'Cows', 'Workshop', 'Goats', 'Sheep', 'Bees', 'Buffalo');
  const pen = r.penOf('Buffalo');
  pen.animals.splice(1);
  const a = pen.animals[0];
  const keepFed = () => Object.assign(a, { hunger: 0, thirst: 0 });
  Object.assign(a, { heat: 90, prod: 0, mood: 100, x: 0, y: 2, timer: 1 });
  keepFed();
  pen.sync(r.time + 20);
  assert.equal(a.prod, 0, 'hot: no milk');
  assert.ok(a.mood < 100);
  const pool = pen.objectAt(2, 2);
  assert.equal(pool.type, 'Pool');
  // the drone brings water from the well
  const fill = runRanch(game, { gomeshanoc: `${GO}go(4, 0);\nvercnel(Irer.Jur, 3);\ngo(2, 2);\ntpel(lcnel());` });
  assert.deepEqual([fill.errors, fill.out, pool.amount], [[], ['3'], 3]);
  keepFed();
  a.heat = 90;
  let guard = 0;
  while (a.heat >= 50 && guard++ < 400) {
    keepFed();
    a.mood = 100;
    r.time += 1;
    pen.sync(r.time);
  }
  assert.ok(a.heat < 50 && pool.amount < 3, 'it walked to the pool and bathed');
  const prod = a.prod;
  keepFed();
  pen.sync(r.time + 5);
  assert.ok(a.prod > prod, 'cool: milk grows');
  game.calendar.state = { season: 'Summer', weather: 'Sunny' };
  assert.equal(r.seasonFactors().heat, 1.5);
  game.calendar.state = null;
  // Lori cheese in the dairy
  assert.deepEqual(r.cfg.machines.Dairy.LoriCheese.in, { BuffaloMilk: 3 });
});

test('rabbits breed past the room of the pen; in a crowd they give no down until the code sells the extras', () => {
  const game = makeGame({ unlockAll: true });
  const r = game.ranch;
  buy(r, 'Cows', 'Workshop', 'Goats', 'Sheep', 'Rabbits', 'sellAnimals', 'animals');
  const pen = r.penOf('Rabbit');
  assert.equal(pen.capacity(), 8);
  const feedAll = () => pen.animals.forEach((a) => Object.assign(a, { hunger: 0, thirst: 0, mood: 100, sick: false, dirtTime: 0 }));
  for (let i = 0; i < 1000; i++) {
    feedAll();
    pen.sync((r.time += 2));
  }
  assert.equal(pen.animals.length, 12, 'it stops at 1.5 × the room');
  feedAll();
  const a = pen.animals.find((b) => !pen.young(b, r.time));
  a.prod = 0;
  pen.sync(r.time + 5);
  assert.equal(a.prod, 0, 'a crowd: no down');
  // sold as pets, the rest give down again
  const ids = pen.animals.filter((b) => !pen.young(b, r.time)).slice(0, 8).map((b) => b.id);
  const sold = runRanch(game, { shuka: ids.map((id) => `vacharelKendani(${id});`).join('\n') });
  assert.deepEqual([sold.errors, sold.warnings, pen.animals.length], [[], [], 4]);
  feedAll();
  const b = pen.animals[0];
  delete b.grownAt;
  b.prod = 0;
  pen.sync(r.time + 5);
  assert.ok(b.prod > 0, 'room again: down grows');
  Object.assign(b, { x: 1, y: 1, prod: 1, timer: 1000, hunger: 0, thirst: 0, mood: 100 });
  Object.assign(pen.drone, { x: 1, y: 1 });
  const down = runRanch(game, { chagaranoc: 'tpel(kitel());\ntpel(xuzel());\ntpel(dzerqum(Irer.Axvamaz));' });
  assert.deepEqual([down.out, down.warnings], [['false', 'true', '1'], []]);
});

test('the donkey: any area sends it, one trip at a time, the goods arrive at the end and erb hears it (at any frame rate)', () => {
  const play = (step) => {
    const game = makeGame({ unlockAll: true, items: { Carrot: 10000, Pumpkin: 5000 } });
    const r = game.ranch;
    buy(r, 'Cows', 'Workshop', 'Donkey', 'events');
    r.inventory.add('Honey', 4);
    const shipped = game.stats.total('Honey');
    const out = runRanch(game, {
      havanoc: `erb("esh", (e) => { tpel("arrived", e.ir, e.qanak, numItems(e.ir)); });
tpel(eshBerel(Irer.Gazar, 3));
tpel(eshBerel(Irer.Ddum, 1));
tpel(numItems(Irer.Gazar));`,
    }, { seconds: 25, step });
    r.stopAll();
    assert.deepEqual(out.errors, []);
    assert.deepEqual(out.warnings, ['ranch_donkey_busy']);
    assert.deepEqual([r.donkey, r.inventory.get('Carrot'), game.inventory.get('Carrot')], [null, 3, 10000 - 3 * r.cfg.cart.Carrot.Carrot]);
    const ship = runRanch(game, { gom: 'tpel(eshTanel(Irer.Mexr, 3));\ntpel(numItems(Irer.Mexr));' }, { seconds: 5, step });
    assert.deepEqual([ship.out, game.inventory.get('Honey'), r.donkey.n], [['3', '1'], 0, 3]);
    r.update(0.1);
    while (r.donkey) r.update(step);
    assert.equal(game.inventory.get('Honey'), 3);
    return { out: out.out, stats: game.stats.total('Honey') - shipped };
  };
  const a = play(0.1);
  assert.deepEqual(a.out[3].split(' ').slice(0, 3), ['arrived', 'Irer.Gazar', '3']);
  assert.equal(a.stats, 0, 'a move, not a harvest');
  assert.deepEqual(play(0.033).out, a.out);
});

test('dishes speed the drones for their seconds of drone time; festivals: ranch prices, wool, a special sample and the hunt', () => {
  const game = makeGame({ unlockAll: true });
  const r = game.ranch;
  buy(r, 'Cows', 'Workshop', 'dishes');
  r.inventory.add('HoneyCake', 1);
  const pen = r.penOf('Hen');
  const rate = pen.drone.tickRate();
  const eat = runRanch(game, { havanoc: 'tpel(utel(Irer.Mexrablit));\ntpel(utel(Irer.Mexrablit));\ntpel(utel(Irer.Dzu));' });
  assert.deepEqual([eat.out, eat.warnings, r.inventory.get('HoneyCake')], [['true', 'false', 'false'], ['ranch_eat_none', 'ranch_eat_notDish'], 0]);
  assert.equal(pen.drone.tickRate(), rate * r.cfg.dishes.HoneyCake.multiplier);
  pen.drone.time = r.boosts.speed.until;
  assert.equal(pen.drone.tickRate(), rate);

  const day = makeGame({ unlockAll: true, clock: noon('20270328') }); // Easter Sunday 2027
  const f = day.ranch;
  assert.equal(day.calendar.state.festival.id, 'Easter');
  const plain = makeGame({ unlockAll: true });
  plain.stats.clock = day.stats.clock;
  assert.equal(f.price('Egg'), Math.round(plain.ranch.price('Egg') * 2));
  const list = f.carpetOrders().list;
  assert.deepEqual(list.at(-1).sample, 'fest_Easter');
  assert.equal(list.length, 4);
  for (const id of ['Bridge', 'Square']) day.village.repair(id);
  const hen = f.penOf('Hen');
  const spots = f.huntSpots(hen);
  assert.equal(spots.length, 3);
  const [x, y] = spots[0];
  const to = `${GO}go(${x}, ${y});\ntpel(hototel());\ntpel(porel());`;
  const out = runRanch(day, { havanoc: to });
  assert.deepEqual([out.errors, out.out], [[], ['0', 'true']]);
  assert.equal(day.festivals.count(day.calendar.state.festival.key), 1, 'it counts for the same festival');
  assert.equal(runRanch(game, { havanoc: 'tpel(hototel());\ntpel(porel());' }).warnings[0], 'ranch_noHunt');
});

test('the fair: all places, its goods and a carpet alike enough; New Game Plus keeps the code and the hats and starts over', () => {
  const game = makeGame({ unlockAll: true });
  const r = game.ranch;
  r.inventory.add('Dram', 1e6);
  assert.equal(r.shopState('Fair'), 'locked');
  assert.equal(r.missingNeed(r.shopItem('Fair')), 'Cows');
  for (const id of ['Cows', 'Workshop', 'Goats', 'Sheep', 'Bees', 'Buffalo', 'Rabbits']) assert.deepEqual(r.buy(id), { ok: true }, id);
  assert.equal(r.fairDone, false);
  assert.deepEqual(r.buy('Fair'), { ok: true });
  const goods = r.cfg.fair.goods;
  const try1 = runRanch(game, { shuka: 'tpel(tonavachar());' });
  assert.deepEqual([try1.out, try1.warnings], [['false'], ['ranch_fair_missing']]);
  for (const [item, n] of Object.entries(goods)) r.inventory.add(item, n);
  const try2 = runRanch(game, { shuka: 'tpel(tonavachar());' });
  assert.deepEqual(try2.warnings, ['ranch_fair_carpet']);
  r.carpets.push({ cells: '', sample: 'rows', alike: 0.5, price: 1, pay: 1, soft: 0 }, { cells: '', sample: 'rows', alike: 0.96, price: 1, pay: 1, soft: 0 });
  r.inventory.add('Carpet', 2);
  const dram = r.inventory.get('Dram');
  const try3 = runRanch(game, { shuka: 'tpel(tonavachar());\ntpel(tonavachar());' });
  assert.deepEqual([try3.out, try3.warnings], [['true', 'false'], ['ranch_fair_done']]);
  assert.deepEqual([r.fairDone, r.fairs, r.inventory.get('Carpet'), r.inventory.get('Dram') - dram, r.carpets.length], [true, 1, 1, r.cfg.fair.pay - 0, 1]);
  assert.equal(game.research.hasHat('Rancher_Hat'), true);
  // New Game Plus
  r.setScriptCode('gom', 'tpel("my code");');
  r.gallery.push({ cells: 'x', sample: null, alike: null });
  const reached = r.progress().value;
  assert.deepEqual(r.restart(), { ok: true });
  assert.deepEqual(r.restart(), { ok: false }, 'only after a fair');
  assert.deepEqual([r.plus, [...r.pens.keys()], r.inventory.toSave(), r.owned, r.fairDone, r.carpets], [1, ['Hens', 'Market'], { Dram: 50, Grain: 6 }, {}, false, []]);
  assert.equal(r.script('gom').code, 'tpel("my code");', 'the code stays');
  assert.equal(r.gallery.length, 1);
  assert.equal(r.progress().value, reached, 'Perfection is not taken back');
  assert.equal(r.nextCost('Cows'), Math.round(r.shopItem('Cows').cost * r.cfg.plus.shop));
  assert.equal(r.seasonFactors().hunger, r.cfg.plus.needs);
  assert.equal(r.goodsFactor(), r.cfg.plus.goods);
  assert.equal(game.leaderStats().ranchPlus, 1);
  // the old commands must be bought again
  assert.equal(r.hasFunction('milk'), false);
});

test('part 3 is saved with the ranch', () => {
  const { game, r, pen } = sheepRanch();
  buy(r, 'Bees', 'Rabbits', 'Gampr', 'Donkey', 'dishes');
  const loom = pen.objectAt(3, 0);
  r.carpetBoard = { day: r.today(), list: [{ sample: 'rows', pay: 300, taken: false }] };
  r.startCarpet(loom, 0);
  loom.inside = { YarnBlack: 2 };
  r.knot(pen, loom, 0, 0, 'Black', r.time);
  r.pens.get('Bees').flowers['1,1'] = 'Rose';
  pen.bell = { x: 1, y: 1, until: 99 };
  pen.dogHere();
  r.gallery.push({ cells: 'c', sample: null, alike: null });
  r.favorite = 'c';
  r.perfect.total = 7;
  r.plus = 2;
  r.fairs = 1;
  r.boosts.speed = { item: 'Omelet', multiplier: 1.5, until: 50 };
  r.donkey = { kind: 'bring', item: 'Carrot', n: 2, pen: 'Hens', start: 0, until: 30 };
  r.challenge.best = 321;
  const back = reload(game).ranch;
  const p = back.pens.get('Sheep');
  assert.deepEqual([p.objectAt(3, 0).carpet.knots, p.objectAt(3, 0).inside, back.pens.get('Bees').flowers, p.bell, p.dog], [1, { YarnBlack: 1 }, { '1,1': 'Rose' }, { x: 1, y: 1, until: 99 }, { x: 5, y: 1 }]);
  assert.deepEqual([back.gallery, back.favorite, back.perfect.total, back.plus, back.fairs, back.boosts.speed.until, back.donkey.until, back.challenge.best], [[{ cells: 'c', sample: null, alike: null }], 'c', 7, 2, 1, 50, 30, 321]);
});

test('every new name works in Latin and Armenian letters, and carpets.samples mistakes are reported', () => {
  const game = makeGame({ unlockAll: true });
  const r = game.ranch;
  r.inventory.add('Dram', 1e6);
  for (const id of ['Cows', 'Workshop', 'Goats', 'Sheep', 'Bees', 'Buffalo', 'Rabbits', 'Bell', 'Gampr', 'Donkey', 'dishes', 'Fair']) r.buy(id);
  const pairs = [['xuzel', 'խուզել'], ['zangel', 'զանգել'], ['gamprGnal', 'գամփռգնալ'], ['gorg', 'գորգ'], ['hyusel', 'հյուսել'], ['gorgPatverner', 'գորգպատվերներ'], ['vacharelGorg', 'վաճառելգորգ'], ['tnkel', 'տնկել'], ['caxkiTesak', 'ծաղկիտեսակ'], ['utel', 'ուտել'], ['eshBerel', 'էշբերել'], ['eshTanel', 'էշտանել'], ['tonavachar', 'տոնավաճառ'], ['Caxikner.Vard', 'Ծաղիկներ.Վարդ'], ['Guyner.Kapuyt', 'Գույներ.Կապույտ'], ['Irer.TelKarmir', 'Իրեր.ԹելԿարմիր'], ['Irer.Xorisx', 'Իրեր.Խորիսխ'], ['Irer.Mexr', 'Իրեր.Մեղր'], ['Tesakner.Vochxar', 'Տեսակներ.Ոչխար'], ['Sarqer.Dazgah', 'Սարքեր.Դազգահ'], ['Sarqer.Mexratun', 'Սարքեր.Մեղրատուն']];
  const out = runRanch(game, { havanoc: pairs.map(([a, b]) => `tpel(${a} == ${b});`).join('\n') });
  assert.deepEqual([out.errors, out.out], [[], pairs.map(() => 'true')]);
  const config = loadConfig();
  assert.deepEqual(validateConfig(config), []);
  config.ranch.carpets.samples[0].rows = ['WWW'];
  config.ranch.carpets.samples[1].rows[0] = 'ZZZZZZZZZ';
  config.events.festivals[0].sample = 'none';
  const msgs = validateConfig(config).map((e) => e.path);
  assert.ok(msgs.includes('carpets.samples[0]') && msgs.includes('carpets.samples[1]') && msgs.includes('festivals.Trndez.sample'), msgs.join());
});

test('the ranch challenge: a fresh test ranch, the same time at any speed; every task can be set up and its code runs', () => {
  const config = loadConfig();
  const tasks = config.events.ranchChallenges;
  assert.ok(tasks.length >= 10);
  const play = (step, speed) => {
    const task = tasks.find((x) => x.id === 'eggs15');
    const code = `${GO}while (true) {
  for (let y = 0; y < fermayiChap(); y++) {
    for (let x = 0; x < fermayiChap(); x++) {
      go(x, y);
      havaqel();
    }
  }
  go(0, 0);
  datarkel();
  vercnel(Irer.Hatik, 3);
  go(0, 3);
  lcnel();
  go(3, 0);
  vercnel(Irer.Jur, 3);
  go(3, 3);
  lcnel();
}`;
    const game = testRanch(config, task, { havanoc: code });
    const r = game.ranch;
    r.speed = speed;
    const goal = watchRanchGoal(game, task.goal);
    r.startAll();
    for (let i = 0; i < 100000 && goal.done === null && r.time < 900; i++) r.update(step);
    return { done: goal.done, time: r.time, storage: game.stats.total('Egg') };
  };
  const a = play(0.1, 1);
  assert.ok(a.done > 0, 'the goal was reached');
  assert.equal(play(0.033, 1).done, a.done);
  assert.equal(play(0.1, 8).done, a.done);
  // every task opens its places with its animals and items
  for (const task of tasks) {
    const game = testRanch(config, task);
    const r = game.ranch;
    for (const [type, n] of Object.entries(task.animals)) assert.ok(r.penOf(type).animals.length >= n, task.id);
    for (const [item, n] of Object.entries(task.items)) assert.equal(r.inventory.get(item), n, task.id);
    assert.ok(watchRanchGoal(game, task.goal).done === null, task.id);
    assert.deepEqual(weekTask(config.events, '20261102', 'ranchChallenges').week, weekTask(config.events, '20261108', 'ranchChallenges').week);
  }
  // a real solution of the carpet task, through its goal
  const task = tasks.find((x) => x.id === 'carpet1');
  const carpetGame = testRanch(config, task);
  const cr = carpetGame.ranch;
  const sample = cr.sample(cr.carpetOrders().list[0].sample);
  const names = { W: 'Spitak', K: 'Sev', B: 'Darchnaguyn' };
  const knots = sample.rows.flatMap((row, i) => [...row].map((ch, x) => `hyusel(${x}, ${8 - i}, Guyner.${names[ch]});`)).join('\n');
  const yarn = `${GO}for (const it of [Irer.TelSpitak, Irer.TelSev, Irer.TelDarchnaguyn]) {\n  for (let i = 0; i < 27; i++) {\n    go(0, 0);\n    vercnel(it, 3);\n    go(3, 0);\n    lcnel();\n  }\n}\ngorg(0);\n${knots}`;
  cr.setScriptCode('parax', yarn);
  const carpetGoal = watchRanchGoal(carpetGame, task.goal);
  cr.start('Sheep');
  for (let i = 0; i < 100000 && carpetGoal.done === null && cr.time < 900; i++) cr.update(0.1);
  assert.ok(carpetGoal.done > 80 && carpetGoal.done < 900, `carpet done at ${carpetGoal.done}`);
  // results and the week: the best stays with its code, last week's goes to `prev`
  const game = makeGame();
  const r = game.ranch;
  rollRanchWeek(r, '202645');
  assert.deepEqual(recordRanchResult(game, 500, 'a'), { better: true, first: true });
  assert.deepEqual(recordRanchResult(game, 700, 'b'), { better: false, first: false });
  assert.deepEqual(recordRanchResult(game, 400, 'c'), { better: true, first: false });
  rollRanchWeek(r, '202646');
  assert.deepEqual([r.challenge.best, r.challenge.prev], [0, { week: '202645', best: 400, bestCode: 'c' }]);
  assert.equal(game.inventory.get('Star'), config.events.ranchChallenge.stars);
});

test('the leaderboard: perfect carpets for day, month and all time; the ranch challenge list; the favourite carpet and the plus level', () => {
  const game = makeGame({ clock: noon('20261105') });
  const r = game.ranch;
  r.perfectCarpet(3);
  r.perfectCarpet(1);
  r.favorite = 'WK';
  r.plus = 2;
  rollRanchWeek(r, weekKey('20261105'));
  recordRanchResult(game, 321, 'code');
  const row = playerRow('A', game.leaderStats());
  const today = '20261105';
  assert.deepEqual([row.carpets, row[boardField('carpets_day', today)], row[boardField('carpets_month', today)], row[boardField('carpets_all', today)]], [4, 4, 4, 4]);
  assert.deepEqual([row.carpet, row.ranchPlus, row[boardField('ranchChallenge', today)], row[`rcc${weekKey(today)}`]], ['WK', 2, 321, 'code']);
  assert.equal(ascending(boardField('ranchChallenge', today)), true);
  assert.equal(ascending(boardField('carpets_all', today)), false);
  assert.deepEqual([r.counts.perfect, r.perfect.total], [2, 4]);
});

test('the carpet contest: one entry a player, one like per carpet, not your own; the teacher removes an entry (here and on Firebase)', async () => {
  const fb = createFakeFirebase({ admins: ['admin'] });
  const realFetch = globalThis.fetch;
  globalThis.fetch = fb.fetch;
  const memory = () => {
    const m = new Map();
    return { get: (k) => m.get(k) ?? null, set: (k, v) => (m.set(k, v), true), remove: (k) => m.delete(k) };
  };
  const code = (p) => p.then(() => 'ok', (e) => e.code || e.message);
  try {
    for (const cfg of [{ admins: ['admin'] }, { apiKey: 'test-key', projectId: 'test-project', admins: ['admin'] }]) {
      const store = memory();
      const a = new Accounts(cfg.apiKey ? memory() : store, cfg);
      const b = new Accounts(cfg.apiKey ? memory() : store, cfg);
      const t = new Accounts(cfg.apiKey ? memory() : store, cfg);
      await a.register('Ani', 'secret1');
      await b.register('Bob', 'secret1');
      await t.register('admin', 'secret1');
      const carpet = (letter) => letter.repeat(81);
      await a.enterContest('202645', carpet('A'));
      await b.enterContest('202645', carpet('B'));
      await b.enterContest('202645', carpet('C')); // one entry: a new one replaces it
      await a.enterContest('202644', carpet('O'));
      await t.enterContest('202645', 'not a carpet'); // (left out)
      assert.deepEqual((await a.contest('202645')).map((e) => [e.id, e.name, e.cells[0], e.likes]), [['ani', 'Ani', 'A', 0], ['bob', 'Bob', 'C', 0]]);
      assert.equal(await code(a.likeCarpet('202645', 'ani')), 'unknown', 'not your own');
      await a.likeCarpet('202645', 'bob');
      await a.likeCarpet('202645', 'bob'); // only once
      await t.likeCarpet('202645', 'bob');
      const list = await a.contest('202645');
      assert.deepEqual(list.map((e) => [e.id, e.likes, e.liked]), [['bob', 2, true], ['ani', 0, false]]);
      assert.equal(await code(a.removeEntry('202645', 'bob')), 'unknown');
      await t.removeEntry('202645', 'bob');
      assert.deepEqual((await a.contest('202645')).map((e) => e.id), ['ani']);
    }
    // on Firebase a student can write only their own entry and likes
    const s = new Accounts(memory(), { apiKey: 'test-key', projectId: 'test-project' });
    await s.login('ani', 'secret1');
    await assert.rejects(s.backend.contestWrite(s.session, 'carpets', '202645~bob', { week: '202645', owner: 'bob', name: 'x', cells: 'x', at: 1 }));
    await assert.rejects(s.backend.contestWrite(s.session, 'likes', '202645~bob~ani', { week: '202645', owner: 'bob', voter: 'carol' }));
  } finally {
    globalThis.fetch = realFetch;
  }
  // the prize: a hat and medals by the place
  const game = makeGame();
  giveContestPrize(game, 2);
  assert.deepEqual([game.research.hasHat('Carpet_Hat'), game.inventory.get('Medal')], [true, 2]);
});
