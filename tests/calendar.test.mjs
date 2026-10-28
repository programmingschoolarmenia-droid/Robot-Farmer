import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, runCode, loadConfig } from './helpers.mjs';
import { QuestTracker } from '../js/engine/quests.js';
import { validateConfig } from '../js/core/config.js';

const MIN = 60000;
const HOUR = 60 * MIN;
const START = Date.UTC(2026, 9, 29, 8); // a whole hour: spring starts (15-minute seasons)

// A game whose real clock the test moves; today's luck is off unless `luck` is set.
function farm(now, opts = {}) {
  const game = makeGame({ clock: now, ...opts });
  if (!opts.luck) game.settings.calendar.luck = [];
  const clock = { now };
  game.stats.clock = () => clock.now;
  const set = (ms) => {
    clock.now = ms;
    game.calendar.checkAt = 0;
    game.calendar.update(game.time);
  };
  game.calendar.state = null;
  set(now);
  return { game, set };
}

// The first moment (inside a 5-minute weather slot) whose calendar matches `pred`.
function find(pred, from = START) {
  const { game } = farm(from);
  for (let ms = from + 1000; ms < from + 2000 * HOUR; ms += 5 * MIN) if (pred(game.calendar.at(ms))) return ms;
  throw new Error('no such time');
}

const seconds = (game, s) => {
  for (let i = 0; i < s * 10; i++) game.update(0.1);
};
const dry = (s) => s.weather !== 'Rain' && s.weather !== 'Storm';

test('calendar: every student has the same season, weather and luck at the same moment', () => {
  const now = START + 47 * MIN;
  const a = makeGame({ clock: now, seed: 1 }).calendar.state;
  const b = makeGame({ clock: now, seed: 2 }).calendar.state;
  assert.deepEqual(a, b);
  const season = (ms) => makeGame({ clock: ms }).calendar.state.season;
  assert.deepEqual([season(START + MIN), season(START + 16 * MIN), season(START + 31 * MIN), season(START + 46 * MIN)], ['Spring', 'Summer', 'Autumn', 'Winter']);
  assert.ok(['Sunny', 'Snow'].includes(a.weather), 'winter weather comes from calendar.weather.Winter');
});

test('calendar: crops grow ×2 in their season and ×0.5 outside it, exactly across a season change', () => {
  const at = find((s) => s.season === 'Spring' && dry(s) && s.next !== 'Rain' && s.next !== 'Storm' && (s.weatherEnds - START) % HOUR === 15 * MIN);
  const before = at + (15 * MIN - ((at - START) % HOUR)) - 2000; // 2 s before summer
  const { game, set } = farm(before, { levels: { Plant: 1, Carrots: 1 }, items: { Hay: 5, Wood: 5 } });
  const tile = game.world.tile(0, 0);
  game.world.till(tile, game.time);
  assert.ok(game.world.plant(tile, 'Carrot', game.time).ok);
  const t0 = game.time;
  seconds(game, 1); // spring: carrots love it
  const t1 = game.time;
  set(before + 4000); // summer: too hot for carrots
  assert.equal(game.calendar.state.season, 'Summer');
  seconds(game, 1);
  game.world.sync(tile, game.time);
  const expected = (2 * (t1 - t0) + 0.5 * (game.time - t1)) / tile.entity.growTime;
  assert.ok(Math.abs(tile.entity.progress - expected) < 1e-9, `${tile.entity.progress} vs ${expected}`);
});

test('calendar: rain fills every square and every pond, then the water dries again', () => {
  const at = find((s) => s.weather === 'Rain' && s.next === 'Sunny');
  const { game, set } = farm(at, { levels: { Expand: 1 } });
  const [soil, pond, meadow] = [0, 1, 2].map((x) => game.world.tile(x, 0));
  game.world.till(soil, game.time);
  game.world.digPond(pond, game.time);
  assert.deepEqual([soil.water, pond.water, meadow.water], [0, 0, 0]);
  seconds(game, 1);
  game.world.syncAll(game.time);
  assert.deepEqual([soil.water, pond.water, meadow.water], [1, 1, 1]);
  assert.equal(game.fishProblem(pond, game.time), null, 'a rained-on pond has fish');
  set(game.calendar.state.weatherEnds + 1000); // the rain is over
  assert.ok(!game.calendar.raining);
  const t = game.time;
  seconds(game, 10);
  game.world.syncAll(game.time);
  assert.ok(Math.abs(soil.water - Math.exp(-0.01 * (game.time - t))) < 1e-9);
  assert.equal(pond.water, 1, 'ponds never dry out');
});

test('calendar: winter water gives no boost, ponds still have fish, and the whitefish bites only then', () => {
  const at = find((s) => s.season === 'Winter');
  const { game } = farm(at, { levels: { Plant: 1, Carrots: 1, Expand: 1, Fishing: 1 }, items: { Hay: 5, Wood: 5 } });
  const [soil, pond] = [0, 1].map((x) => game.world.tile(x, 0));
  game.world.till(soil, game.time);
  game.world.plant(soil, 'Carrot', game.time);
  game.world.addWater(soil, 1, game.time);
  const t = game.time;
  seconds(game, 1);
  game.world.sync(soil, game.time);
  assert.ok(Math.abs(soil.entity.progress - (0.5 * (game.time - t)) / soil.entity.growTime) < 1e-9, 'out of season and no water boost');
  game.world.digPond(pond, game.time);
  game.world.addWater(pond, 1, game.time);
  assert.equal(game.fishProblem(pond, game.time), null);
  const caught = new Set();
  for (let i = 0; i < 300; i++) caught.add(game.catchFish(game.mainDrone, pond));
  assert.ok(caught.has('Whitefish') && !caught.has('Catfish'), [...caught].join());
  const fish = game.settings.fishing.fish;
  const spring = farm(find((s) => s.season === 'Spring' && s.weather === 'Sunny')).game.calendar;
  const rain = farm(find((s) => s.weather === 'Rain')).game.calendar;
  assert.deepEqual([spring.fishChance('Whitefish', fish.Whitefish), spring.fishChance('Catfish', fish.Catfish)], [0, 0]);
  assert.equal(rain.fishChance('Catfish', fish.Catfish), fish.Catfish.chance);
  assert.equal(makeGame().calendar.fishChance('Whitefish', fish.Whitefish), 0, 'no calendar, no winter');
});

test('calendar: heat dries water ×3 faster', () => {
  const { game } = farm(find((s) => s.weather === 'Heat'));
  const tile = game.world.tile(0, 0);
  game.world.addWater(tile, 1, game.time);
  const t = game.time;
  seconds(game, 10);
  game.world.sync(tile, game.time);
  assert.ok(Math.abs(tile.water - Math.exp(-0.03 * (game.time - t))) < 1e-9);
});

test('calendar: lightning charges a plant and its harvest is ×3', () => {
  const { game } = farm(find((s) => s.weather === 'Storm'), { levels: { Plant: 1, Carrots: 1 }, items: { Hay: 5, Wood: 5 } });
  const tile = game.world.tile(0, 0);
  game.world.till(tile, game.time);
  game.world.plant(tile, 'Carrot', game.time);
  tile.entity.progress = 1;
  const strikes = [];
  game.events.on('lightning', (e) => strikes.push(e.charged));
  game.calendar.tick(15, game.time);
  assert.deepEqual(strikes, [true]);
  assert.equal(tile.entity.data.charged, true);
  assert.deepEqual(game.world.harvest(tile, game.time).items, { Carrot: 3 });
});

test('luck: one per day, the same for everyone, never twice in a row, each once in every run of days', () => {
  const { game } = farm(START, { luck: true });
  const list = game.settings.calendar.luck;
  const day = (i) => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
  const lucks = Array.from({ length: 1000 }, (_, i) => game.calendar.luckOf(day(i)));
  for (let i = 1; i < lucks.length; i++) assert.notEqual(lucks[i], lucks[i - 1], day(i));
  const d0 = Date.UTC(2026, 0, 1) / 86400000;
  const first = Math.ceil(d0 / list.length) * list.length - d0; // runs start on multiples of N days
  for (let i = first; i + list.length <= lucks.length; i += list.length) assert.equal(new Set(lucks.slice(i, i + list.length)).size, list.length);
  assert.deepEqual(farm(START, { luck: true, seed: 7 }).game.calendar.state.luck, game.calendar.state.luck);
});

test('luck: harvest, pumpkin, bones, gold, fish and growth effects', () => {
  const dayWith = (pick) => {
    for (let ms = START; ; ms += 86400000) if (pick(farm(ms, { luck: true }).game.calendar.state.luck)) return ms;
  };
  const carrots = farm(dayWith((l) => l.yield && l.yield.Carrot === 2), { luck: true, levels: { Plant: 1, Carrots: 1 }, items: { Hay: 5, Wood: 5 } }).game;
  const tile = carrots.world.tile(0, 0);
  carrots.world.till(tile, carrots.time);
  carrots.world.plant(tile, 'Carrot', carrots.time);
  tile.entity.progress = 1;
  assert.deepEqual(carrots.world.harvest(tile, carrots.time).items, { Carrot: 2 });

  const pumpkins = farm(dayWith((l) => l.pumpkinDeath === 0), { luck: true, levels: { Plant: 1, Carrots: 1, Pumpkins: 1 }, items: { Carrot: 500 } }).game;
  const p = pumpkins.world.tile(0, 0);
  pumpkins.world.till(p, pumpkins.time);
  for (let i = 0; i < 100; i++) {
    assert.ok(pumpkins.world.plant(p, 'Pumpkin', pumpkins.time).ok);
    pumpkins.world.sync(p, (pumpkins.time += 100));
    assert.equal(p.entity.type, 'Pumpkin', 'no pumpkin rots today');
    pumpkins.world.harvest(p, pumpkins.time);
  }

  const bones = farm(dayWith((l) => l.yield && l.yield.Bone === 2), { luck: true, levels: { Dinosaurs: 1 } }).game;
  bones.dino = { drone: bones.mainDrone, tail: [], apple: null, eaten: 1 };
  bones.finishDino(bones.time);
  assert.equal(bones.inventory.get('Bone'), 4 * 2, 'a 2-long dinosaur gives 4 bones, ×2 today');
  const gold = farm(dayWith((l) => l.yield && l.yield.Gold === 2), { luck: true, levels: { Mazes: 1 } }).game;
  const plain = makeGame({ levels: { Mazes: 1 } });
  gold.world.maze = plain.world.maze = { size: 3 };
  assert.equal(gold.world.mazeGold(), 2 * plain.world.mazeGold());

  const golden = farm(dayWith((l) => l.fish && l.fish.Golden_Fish === 3), { luck: true }).game;
  assert.equal(golden.calendar.fishChance('Golden_Fish', golden.settings.fishing.fish.Golden_Fish), 3);
  const fast = farm(dayWith((l) => l.growth === 1.5), { luck: true }).game;
  assert.equal(fast.calendar.growth('Dead_Pumpkin'), 1.5, 'a plant without seasons: only the luck');
});

test('calendar: sezon(), exanak() and hajordExanak() in code; null without a calendar', () => {
  const { game } = farm(find((s) => s.season === 'Autumn'), { unlockAll: true });
  const s = game.calendar.state;
  const r = runCode(game, 'tpel(sezon(), exanak(), hajordExanak());');
  const label = (group, name) => String(game.api.enums[group].get(name));
  assert.deepEqual(r.out, [`Sezonner.Ashun ${label('Weathers', s.weather)} ${label('Weathers', s.next)}`]);
  assert.deepEqual(runCode(makeGame({ unlockAll: true }), 'tpel(sezon());').out, ['null']);
});

test('calendar: the season quest and old saves', () => {
  const game = farm(START, { levels: { Plant: 1, Debug: 1, Operators: 1, Calendar: 1 } }).game;
  const at = (saved) => {
    const q = new QuestTracker(game, saved);
    q.destroy();
    return q.current().id;
  };
  assert.equal(at({ index: 19 }), 'buy_trees', 'older saves skip the quests added later');
  const quests = new QuestTracker(game, { id: 'season_code' });
  runCode(game, 'if (sezon() === Sezonner.Garun) {\n  tpel(1);\n}');
  assert.equal(quests.current().id, 'buy_trees');
  quests.destroy();
});

test('calendar: config mistakes are reported', () => {
  const cfg = loadConfig();
  cfg.settings.calendar.weather.Winter = { Blizzard: 3 };
  cfg.settings.entities.Carrot.seasons = ['Monsoon'];
  const i = cfg.settings.calendar.luck.push({ text: 'x', yield: { Diamond: 2 }, pumpkinDeath: 2 }) - 1;
  cfg.settings.fishing.fish.Catfish.weather = ['Fog'];
  const paths = validateConfig(cfg).map((e) => e.path);
  for (const p of ['calendar.weather.Winter.Blizzard', 'entities.Carrot.seasons', `calendar.luck[${i}].yield.Diamond`, `calendar.luck[${i}].pumpkinDeath`, 'fishing.fish.Catfish.weather']) {
    assert.ok(paths.includes(p), `${p} in ${paths.join(', ')}`);
  }
});
