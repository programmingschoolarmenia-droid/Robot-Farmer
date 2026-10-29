import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, runCode, loadConfig } from './helpers.mjs';
import { Game } from '../js/engine/game.js';
import { QuestTracker } from '../js/engine/quests.js';
import { validateConfig } from '../js/core/config.js';
import { describeError } from '../js/ui/errorText.js';
import { createI18n } from '../js/core/i18n.js';

const MIN = 60000;
const START = Date.UTC(2026, 9, 29, 8); // spring (15-minute seasons start every hour)
const seconds = (game, s) => {
  for (let i = 0; i < s * 10; i++) game.update(0.1);
};
const reload = (game) => new Game(game.config, JSON.parse(JSON.stringify(game.toSave())));
// Seasons on (at `clock`), today's luck off.
const seasonGame = (clock, opts) => {
  const game = makeGame({ clock, ...opts });
  game.settings.calendar.luck = [];
  game.calendar.state = null;
  game.calendar.update(game.time);
  return game;
};

test('village: buildings are repaired little by little, in order, and their grants unlock commands', () => {
  const game = makeGame({ levels: { Plant: 1, Debug: 1 }, items: { Wood: 200, Hay: 100 } });
  const v = game.village;
  assert.deepEqual(['Bridge', 'Mill', 'School'].map((id) => v.state(id)), ['open', 'locked', 'locked']);
  game.config.village.buildings.find((b) => b.id === 'School').available = false;
  assert.equal(v.state('School'), 'soon', 'available: false shows «soon»');
  delete game.config.village.buildings.find((b) => b.id === 'School').available;
  assert.deepEqual(v.give('Bridge'), { given: { Wood: 200, Hay: 100 }, repaired: false });
  assert.deepEqual(v.missing('Bridge'), { Wood: 100, Hay: 400 });
  assert.equal(game.inventory.get('Wood'), 0);
  const events = [];
  game.events.on('village', (e) => events.push(e));
  game.inventory.add('Wood', 1000);
  game.inventory.add('Hay', 1000);
  assert.deepEqual(v.give('Bridge'), { given: { Wood: 100, Hay: 400 }, repaired: true });
  assert.deepEqual([game.inventory.get('Wood'), events.at(-1).repaired, v.state('Bridge'), v.state('Mill'), v.state('School'), v.state('Square')], [900, true, 'repaired', 'open', 'open', 'open']);

  // karucel() is locked until the mill is repaired, and the error points to the village.
  const r = runCode(game, 'karucel(Sarqer.Jraxac);');
  assert.equal(r.error.code, 'lockedFunction');
  const i18n = createI18n(game.config.texts, [...game.config.research.nodes, ...game.config.village.buildings], game.config.guide);
  assert.match(describeError(r.error, i18n, game).message, /«Ջրաղաց»-ը գյուղում/);
  v.repair('Mill');
  assert.equal(runCode(game, 'tpel(karucel(Sarqer.Jraxac));').out[0], 'true');
  assert.equal(game.world.tile(0, 0).entity.type, 'Mill');
  assert.ok(reload(game).village.isRepaired('Mill'), 'repairs stay in the save');
});

test('village: daily requests ask for gathered items, scale with the farm, pay stars and a bonus', () => {
  const game = seasonGame(START, { items: { Wood: 400, Hay: 600 } });
  const v = game.village;
  assert.equal(v.requests(), null, 'the board opens with the bridge');
  v.give('Bridge');
  game.stats.totals.clear();
  game.inventory.add('Carrot', 100000);
  game.inventory.add('Fish', 30);
  game.inventory.add('Hay', 49);
  const board = v.requests();
  const byItem = Object.fromEntries(board.list.map((q) => [q.item, q.amount]));
  assert.deepEqual(byItem, { Carrot: 2000, Fish: 10, Hay: 50 }, 'only gathered items: 2% or the base, rounded to two digits');
  assert.equal(new Set(board.list.map((q) => q.who)).size, 3, 'three different villagers');
  assert.equal(v.requests(), board, 'the same board all day');
  const stars = board.list.map((q, i) => {
    if (q.item === 'Hay') game.inventory.add('Hay', 1);
    return v.deliver(i);
  });
  assert.deepEqual(stars, [1, 1, 3], 'the last one also pays the bonus');
  assert.equal(v.deliver(0), 0, 'a request is done once');
  assert.deepEqual([game.inventory.get('Star'), game.inventory.get('Carrot'), v.done], [5, 98000, 3]);
  const copy = reload(game);
  assert.deepEqual([copy.village.board, copy.village.done], [board, 3]);
  game.stats.clock = () => START + 24 * 60 * MIN;
  game.calendar.checkAt = 0;
  game.calendar.update(game.time);
  assert.notEqual(v.requests().day, board.day, 'new requests every day');
});

test('machines: build, cook for a fixed time, collect; an unfinished machine is never destroyed', () => {
  const game = makeGame({ clock: START, unlockAll: true, items: { Wood: 1000, Hay: 100, Water: 10 } });
  const tile = game.world.tile(0, 0);
  const code = ['karucel(Sarqer.Jraxac);', 'ogtagorcel(Irer.Jur, 4);', 'patrastel(Irer.Aljur);', 'havaqel();', 'tpel(hasunE(), inchKa(), qanak(Irer.Aljur));'].join('\n');
  const r = runCode(game, code);
  assert.equal(r.error, null);
  assert.deepEqual(r.out, ['false Sarqer.Jraxac 0']);
  assert.deepEqual([tile.entity.type, tile.entity.data.making], ['Mill', 'Flour']);
  const left = 5 * (1 - tile.entity.progress);
  seconds(game, left - 0.3);
  game.world.sync(tile, game.time);
  assert.ok(tile.entity.progress < 1, 'water, rain, seasons and speed do not change the time');
  seconds(game, 0.5);
  const done = runCode(game, 'tpel(hasunE());\nhavaqel();\ntpel(qanak(Irer.Aljur), qanak(Irer.ChorXot));');
  assert.deepEqual(done.out, ['true', '1 80']);
  assert.deepEqual([tile.entity.type, tile.entity.data.making], ['Mill', null]);
  runCode(game, 'herkel();');
  assert.notEqual(tile.entity && tile.entity.type, 'Mill', 'herkel() removes it');
});

test('machines: clear warnings', () => {
  const game = makeGame({ unlockAll: true, items: { Wood: 600, Hay: 30, Flour: 1 } });
  const w = (code) => runCode(game, code).warnings;
  assert.deepEqual(w('patrastel(Irer.Aljur);'), ['make_noMachine']);
  assert.deepEqual(w('karucel(Sarqer.Jraxac);\npatrastel(Irer.Lavash);'), ['make_wrongMachine']);
  assert.deepEqual(w('patrastel(Irer.Aljur);\npatrastel(Irer.Aljur);'), ['make_busy']);
  game.world.tile(0, 0).entity.progress = 1;
  assert.deepEqual(w('patrastel(Irer.Aljur);'), ['make_ready']);
  runCode(game, 'havaqel();');
  assert.deepEqual(w('patrastel(Irer.Aljur);'), ['make_cost']);
  assert.deepEqual(w('karucel(Sarqer.Jraxac);'), ['build_occupied']);
  assert.deepEqual(w('gnal(Aj);\nkarucel(Sarqer.Tonir);'), ['build_cost']);
  const locked = makeGame({ levels: { Plant: 1 }, items: { Wood: 5000 } });
  locked.village.repair('Bridge');
  locked.village.repair('Mill');
  assert.deepEqual(runCode(locked, 'karucel(Sarqer.Tonir);').warnings, ['build_locked']);
});

test('dishes: gata speeds the drone, ghapama the plants (exactly), grilled fish the golden fish', () => {
  const game = makeGame({ levels: { Plant: 1, Carrots: 1 }, items: { Gata: 2, Ghapama: 1, Grilled_Fish: 1, Hay: 5, Wood: 5 } });
  const d = game.mainDrone;
  const rate = d.tickRate();
  assert.deepEqual(game.eat('Gata', game.time), { ok: true });
  assert.equal(d.tickRate(), rate * 2);
  game.eat('Gata', game.time);
  assert.equal(game.boosts.speed.until, game.time + 60, 'eating again adds time');
  assert.deepEqual(game.eat('Gata', game.time), { ok: false, reason: 'none' });
  assert.deepEqual(game.eat('Carrot', game.time), { ok: false, reason: 'notDish' });

  const tile = game.world.tile(0, 0);
  game.world.till(tile, game.time);
  game.world.plant(tile, 'Carrot', game.time);
  const t0 = game.time;
  game.eat('Ghapama', t0);
  seconds(game, 1);
  game.world.sync(tile, game.time);
  assert.ok(Math.abs(tile.entity.progress - (2 * (game.time - t0)) / tile.entity.growTime) < 1e-9, 'ghapama: ×2');
  seconds(game, 30);
  assert.equal(game.boosts.growth, undefined, 'the boost ends');
  game.world.harvest(tile, game.time);
  game.world.plant(tile, 'Carrot', game.time);
  const t1 = game.time;
  seconds(game, 1);
  game.world.sync(tile, game.time);
  assert.ok(Math.abs(tile.entity.progress - (game.time - t1) / tile.entity.growTime) < 1e-9, 'then the normal speed');

  game.eat('Grilled_Fish', game.time);
  const golden = game.settings.fishing.fish.Golden_Fish.chance;
  let n = 0;
  for (let i = 0; i < 4000; i++) if (game.catchFish(d, game.world.tile(1, 1)) === 'Golden_Fish') n++;
  assert.ok(Math.abs(n / 4000 - (golden * 3) / 102) < 0.012, `golden ×3: ${n}`);
});

test('greenhouse glass: always in season, no rain, ice or lightning; saved', () => {
  const game = seasonGame(START + 50 * MIN, { levels: { Plant: 1, Carrots: 1, Debug: 1 }, items: { Hay: 10, Wood: 1010, Cactus: 400 } });
  for (const b of game.village.buildings) if (b.available !== false) game.village.repair(b.id);
  const tile = game.world.tile(0, 0);
  assert.equal(runCode(game, 'herkel();\napakepatel();\ntpel(apakepatel());').out[0], 'false');
  assert.equal(tile.glass, true);
  game.world.plant(tile, 'Carrot', game.time);
  game.world.addWater(tile, 1, game.time);
  const t0 = game.time;
  seconds(game, 0.2); // (×2 and ×5 water: a carrot is ripe in about half a second)
  game.world.sync(tile, game.time);
  const k = 0.01;
  const effective = (game.time - t0) + (4 * (1 - Math.exp(-k * (game.time - t0)))) / k;
  assert.ok(Math.abs(tile.entity.progress - (2 * effective) / tile.entity.growTime) < 1e-9, 'winter: ×2 and the water works');
  assert.equal(reload(game).world.tile(0, 0).glass, true);

  const storm = seasonGame(START, { levels: { Plant: 1, Carrots: 1 }, items: { Wood: 600, Cactus: 400, Hay: 5 } });
  let at = START;
  while (storm.calendar.at(at).weather !== 'Storm') at += 5 * MIN;
  storm.stats.clock = () => at;
  storm.calendar.checkAt = 0;
  storm.calendar.update(storm.time);
  const glass = storm.world.tile(0, 0);
  storm.world.glaze(glass, storm.time);
  storm.world.syncAll(storm.time + 1);
  assert.equal(glass.water, 0, 'no rain under glass');
  storm.world.till(glass, storm.time + 1);
  storm.world.plant(glass, 'Carrot', storm.time + 1);
  const strikes = [];
  storm.events.on('lightning', (e) => strikes.push(e.charged));
  storm.calendar.tick(15, storm.time + 1);
  assert.deepEqual(strikes, [false]);
});

test('village quests: repair the bridge, then help a villager', () => {
  const game = makeGame({ items: { Wood: 400, Hay: 600 } });
  const quests = new QuestTracker(game, { id: 'repair_bridge' });
  game.village.give('Bridge');
  assert.equal(quests.current().id, 'first_request');
  game.inventory.add('Carrot', 100);
  game.village.requests();
  game.village.deliver(game.village.board.list.findIndex((q) => game.inventory.get(q.item) >= q.amount));
  assert.equal(quests.current().id, 'buy_trees');
  quests.destroy();
});

test('village.json mistakes are reported', () => {
  const cfg = loadConfig();
  cfg.village.buildings[1].cost.Diamond = 5;
  cfg.village.buildings[1].grants.machines.push('Oven');
  cfg.village.buildings[2].after = ['Castle'];
  cfg.village.machines.Tonir.recipes.Lavash.seconds = 0;
  cfg.village.requests.building = 'Tower';
  cfg.village.boosts.Gata.kind = 'flying';
  const paths = validateConfig(cfg).map((e) => e.path);
  for (const p of ['buildings[1].cost.Diamond', 'buildings[1].grants.machines', 'buildings[2].after', 'machines.Tonir.recipes.Lavash', 'requests.building', 'boosts.Gata']) {
    assert.ok(paths.includes(p), `${p} in ${paths.join(', ')}`);
  }
});
