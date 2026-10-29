import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, runCode, loadConfig } from './helpers.mjs';
import { Game } from '../js/engine/game.js';
import { validateConfig } from '../js/core/config.js';
import { easterDay, festivalOn, nextFestival, lastFestival } from '../js/engine/festivals.js';
import { keyOfDay, weekKey } from '../js/core/util.js';
import { perfection } from '../js/engine/stickers.js';
import { weekTask, testGame, watchGoal, rollWeek, recordResult, givePrize, CHALLENGE_SCRIPT } from '../js/engine/challenge.js';
import { playerRow } from '../js/storage/account.js';

const noon = (key) => Date.UTC(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8), 8);
const reload = (game) => new Game(game.config, JSON.parse(JSON.stringify(game.toSave())));

// A game on a real day (seasons on, its festival if any), with the village built up to `repaired`.
function dayGame(key, opts = {}, repaired = ['Bridge', 'Square']) {
  const game = makeGame({ clock: noon(key), ...opts });
  for (const id of repaired) game.village.repair(id);
  return game;
}

test('dates: Easter, the ISO week, and every festival on its days', () => {
  const easter = (y) => keyOfDay(easterDay(y));
  assert.deepEqual([2026, 2027, 2028, 2029, 2030].map(easter), ['20260405', '20270328', '20280416', '20290401', '20300421']);
  assert.deepEqual(['20260101', '20261029', '20270101', '20261231'].map(weekKey), ['202601', '202644', '202653', '202653']);
  const events = loadConfig().events;
  const on = (day) => (festivalOn(events, day) || {}).key || null;
  assert.deepEqual(
    ['20260213', '20260215', '20260216', '20260404', '20260406', '20260712', '20260713', '20260811', '20260901', '20261005', '20261230', '20270106', '20270107', '20261029'].map(on),
    ['Trndez2026', 'Trndez2026', null, 'Easter2026', 'Easter2026', 'Vardavar2026', 'Vardavar2026', 'Navasard2026', 'KnowledgeDay2026', 'TeachersDay2026', 'NewYear2026', 'NewYear2026', null, null],
  );
  assert.deepEqual([nextFestival(events, '20261029').id, nextFestival(events, '20261029').inDays], ['NewYear', 62]);
  assert.equal(lastFestival(events, '20261029').key, 'TeachersDay2026');
  assert.equal(festivalOn({ ...events, today: 'Vardavar' }, '20261029').key, 'Vardavar2026', "the teacher's «today»");
});

test('festival bonus: it replaces the luck of the day, for everyone (no Square needed)', () => {
  const game = dayGame('20260405', {}, []);
  const s = game.calendar.state;
  assert.equal(s.festival.id, 'Easter');
  assert.equal(s.luck.growth, 1.5);
  assert.equal(game.calendar.growth('Dead_Pumpkin'), 1.5);
  assert.equal(game.festivals.active, null, 'the hidden objects need the Festival square');
  assert.equal(game.festivals.distance(game.mainDrone), null);
});

test('hidden objects: hototel() measures, porel() finds, a wrong dig makes the nearest one run away', () => {
  const game = dayGame('20260405', { levels: { Expand: 4, Debug: 1, Fishing: 1 } });
  const spots = game.festivals.hidden();
  assert.equal(spots.length, 3);
  const d = game.mainDrone;
  const [x, y] = spots[0];
  const near = Math.min(...spots.map(([a, b]) => Math.abs(a - d.x) + Math.abs(b - d.y)));
  assert.deepEqual(runCode(game, 'tpel(hototel());').out, [String(near)]);
  const found = [];
  game.events.on('festivalFound', (e) => found.push(e.count));
  [d.x, d.y] = [x, y];
  runCode(game, 'porel();');
  assert.deepEqual(found, [1]);
  assert.equal(game.festivals.count('Easter2026'), 1);
  assert.equal(game.festivals.hidden().length, 3, 'a new one hides');
  // a wrong dig: nothing found, the nearest object moves
  const before = game.festivals.hidden().map((p) => p.join(','));
  const free = game.world.tiles.find((t) => t.ground !== 'Pond' && !before.includes(`${t.x},${t.y}`));
  [d.x, d.y] = [free.x, free.y];
  const misses = [];
  game.events.on('festivalMiss', () => misses.push(1));
  runCode(game, 'porel();');
  assert.equal(misses.length, 1);
  assert.equal(game.festivals.count('Easter2026'), 1);
  assert.notDeepEqual(game.festivals.hidden().map((p) => p.join(',')).sort(), before.sort());
  // the hat at 60, saved
  game.festivals.found.Easter2026 = 59;
  const [hx, hy] = game.festivals.hidden()[0];
  [d.x, d.y] = [hx, hy];
  runCode(game, 'porel();');
  assert.equal(game.research.hasHat('Easter_Hat'), true);
  const copy = reload(game);
  assert.deepEqual([copy.festivals.count('Easter2026'), copy.research.hasHat('Easter_Hat')], [60, true]);
});

test('Vardavar: water is free, and watering may splash a new drop out', () => {
  const game = dayGame('20260712', { levels: { Watering: 1, Expand: 4 } });
  game.config.events.festivals.find((f) => f.id === 'Vardavar').splash = 1;
  game.calendar.state = null;
  game.calendar.update(game.time);
  assert.equal(game.inventory.get('Water'), 0);
  const r = runCode(game, 'ogtagorcel(Irer.Jur);');
  assert.deepEqual([r.warnings, game.inventory.get('Water'), game.world.tile(0, 0).water], [[], 0, 0.25]);
  assert.equal(game.festivals.hidden().length, 4, 'a splash added a hidden drop');
  const plain = makeGame({ clock: noon('20261029'), levels: { Watering: 1 } });
  assert.equal(plain.useItem(plain.mainDrone, 'Water', 1, 0, null), false, 'water is not free on other days');
});

test('events.json mistakes are reported', () => {
  const cfg = loadConfig();
  cfg.events.festivals[0].from = '13-40';
  cfg.events.festivals[1].hat = 'Crown_Hat';
  cfg.events.festivals[2].luck.yield = { Diamond: 2 };
  cfg.events.today = 'Halloween';
  const paths = validateConfig(cfg).map((e) => `${e.file}:${e.path}`);
  for (const p of ['events.json:festivals[0]', 'events.json:festivals[1].hat', 'events.json:festivals[2].luck.yield.Diamond', 'events.json:today']) {
    assert.ok(paths.includes(p), `${p} in ${paths.join(', ')}`);
  }
});

test('notes: every code note really gives its square (run by the game itself)', () => {
  const { notes } = loadConfig().events;
  for (const n of notes.list.filter((x) => x.kind === 'code')) {
    const r = runCode(makeGame({ unlockAll: true }), `${n.code}\ntpel(x, y);`);
    assert.equal(r.error, null, n.id);
    assert.deepEqual(r.out, [`${n.x} ${n.y}`], n.id);
  }
  const cells = notes.list.filter((x) => !x.fact).map((x) => `${x.x},${x.y}`);
  assert.equal(new Set(cells).size, cells.length, 'every note has its own square');
  assert.ok(notes.list.length >= 30);
});

test('notes: villagers give one at a time; gtnel() pays on the right square, a wrong one fails it (and it comes back)', () => {
  const game = makeGame({ levels: { Expand: 5, Plant: 1, Debug: 1 } });
  game.village.repair('Bridge');
  game.config.events.notes.chance = 1;
  const given = [];
  game.events.on('note', (e) => given.push(e.id));
  game.events.emit('request', {});
  game.events.emit('request', {});
  assert.deepEqual(given, ['n01'], 'one note at a time');
  const d = game.mainDrone;
  [d.x, d.y] = [0, 0];
  assert.deepEqual(runCode(game, 'tpel(gtnel());').out, ['false']);
  assert.deepEqual([game.notes.status.n01, game.notes.active], ['failed', null]);
  game.events.emit('request', {});
  assert.deepEqual(given, ['n01', 'n01'], 'the failed note comes again');
  [d.x, d.y] = [1, 2];
  const stars = game.inventory.get('Star');
  assert.deepEqual(runCode(game, 'tpel(gtnel());').out, ['true']);
  assert.deepEqual([game.notes.status.n01, game.inventory.get('Star') - stars], ['solved', 3]);
  assert.deepEqual(runCode(game, 'gtnel();').warnings, ['noNote']);
  runCode(game, 'porel();');
  assert.equal(game.notes.solved, 1, 'porel() never touches notes');
  const copy = reload(game);
  assert.deepEqual([copy.notes.status.n01, copy.notes.got], ['solved', ['n01']]);
});

test('notes: a note waits for a big enough farm (and its research); facts are read from the farm, ties count; all solved gives the hat', () => {
  const game = makeGame({ levels: { Expand: 2 } }); // 3×3, no Sunflowers, Cactus, … research
  game.config.events.notes.chance = 1;
  const { status } = game.notes;
  for (const n of game.notes.list.slice(0, 4)) status[n.id] = 'solved';
  game.events.emit('request', {});
  assert.equal(game.notes.active, 'n05', '(1, 0) fits a 3×3 farm');
  status.n05 = 'solved';
  game.notes.active = null;
  game.events.emit('request', {});
  assert.equal(game.notes.active, null, 'the others need a bigger farm, the facts their research');
  // a fact: under the sunflower with the most petals (two have 12: both count)
  const sun = makeGame({ levels: { Expand: 4, Plant: 1, Carrots: 1, Sunflowers: 1 }, items: { Carrot: 10 } });
  for (const [x, petals] of [[1, 9], [3, 12], [4, 12]]) {
    const t = sun.world.tile(x, 0);
    sun.world.till(t, 0);
    sun.world.plant(t, 'Sunflower', 0);
    t.entity.data.petals = petals;
  }
  assert.deepEqual(sun.notes.targets(sun.notes.note('n31')), [[3, 0], [4, 0]]);
  sun.notes.active = 'n31';
  assert.equal(sun.notes.dig(4, 0), 'solved');
  // every note solved: the treasure hunter's hat
  for (const n of sun.notes.list) if (n.id !== 'n35') sun.notes.status[n.id] = 'solved';
  sun.notes.active = 'n35'; // x = gold % 10 = 0, y = 0
  assert.equal(sun.notes.dig(0, 0), 'solved');
  assert.equal(sun.research.hasHat('Treasure_Hat'), true);
});

test('Perfection: research levels and repaired buildings by their weights; 100% gives the Legend hat', () => {
  const fresh = makeGame();
  const { nodes } = fresh.research;
  const buildings = fresh.village.buildings.filter((b) => b.available !== false);
  const levels = nodes.reduce((a, n) => a + n.tiers.length, 0);
  assert.deepEqual(perfection(fresh), { percent: 0, parts: [{ id: 'research', value: 0, max: levels, weight: 70 }, { id: 'village', value: 0, max: buildings.length, weight: 30 }] });
  const game = makeGame({ levels: Object.fromEntries(nodes.map((n) => [n.id, n.tiers.length])) });
  assert.equal(perfection(game).percent, 70, 'all research');
  game.village.repair(buildings[0].id);
  assert.equal(perfection(game).percent, Math.floor(70 + 30 / buildings.length));
  for (const b of buildings.slice(1, -1)) game.village.repair(b.id);
  assert.equal(game.research.hasHat('Legend_Hat'), false);
  game.village.repair(buildings.at(-1).id);
  assert.deepEqual([perfection(game).percent, game.leaderStats().perfect, game.research.hasHat('Legend_Hat')], [100, 100, true]);
  game.config.research.nodes[0].available = false;
  game.research.levels.set(nodes[0].id, 0);
  assert.equal(perfection(game).percent, 100, '«soon» research does not count');
});

test('stickers: each one earned once, from code, the farm, the village and secret counts; kept in the save', () => {
  const game = makeGame({ unlockAll: true });
  const got = [];
  game.events.on('sticker', (e) => got.push(e.ids));
  runCode(game, 'function f(n) {\n  if (n > 0) {\n    f(n - 1);\n  }\n}\nlet a = [1, 2];\nfor (let i = 0; i < 2; i++) {\n  f(i);\n}');
  assert.deepEqual(got, [['loop', 'if', 'variable', 'function', 'params', 'recursion', 'list']], 'one event for all of them');
  runCode(game, 'let b = { c: [1] };\nfor (let i = 0; i < 2; i++) {}');
  assert.deepEqual(got.at(-1), ['object'], 'the others are not earned again');
  const ev = (name, e = {}, times = 1) => {
    for (let i = 0; i < times; i++) game.events.emit(name, e);
  };
  ev('harvest', { chain: 29 });
  ev('harvest', { giantSize: 6, chain: 30 });
  ev('dino', { end: true, length: 30 });
  game.stats.recordHarvest('Whitefish');
  ev('fish');
  ev('flip', {}, 99);
  assert.equal(game.stickers.earned.has('flips100'), false);
  ev('flip');
  for (const hat of Object.keys(game.config.settings.hats).slice(0, 10)) ev('hat', { hat });
  ev('boost', { until: 0 }, 30);
  ev('boost', { until: 5 }, 20);
  game.village.done = 50;
  ev('request');
  for (const n of game.notes.list.slice(0, 10)) game.notes.status[n.id] = 'solved';
  ev('noteSolved');
  game.earnHat(game.config.events.festivals[0].hat);
  game.flags.challengeTop = 2;
  ev('challengePrize');
  assert.deepEqual(got.slice(2).flat(), ['giant6', 'chain30', 'dragon', 'iceFish', 'flips100', 'hats10', 'eat20', 'requests50', 'notes10', 'festival', 'challenge']);
  const copy = reload(game);
  assert.deepEqual([[...copy.stickers.earned].length, copy.stickers.seen.flips], [game.stickers.earned.size, 100]);
});

test('events.json: a sticker or Perfection mistake is reported', () => {
  const cfg = loadConfig();
  cfg.events.stickers[1].id = cfg.events.stickers[0].id;
  cfg.events.stickers[2].when = { feature: 'classes' };
  cfg.events.stickers[3].when = { jumps: 3 };
  cfg.events.stickers[4].when = { fish: 'Shark' };
  cfg.events.perfection.hat = 'Crown_Hat';
  const paths = validateConfig(cfg).map((e) => `${e.file}:${e.path}`);
  for (const p of ['stickers[1].id', 'stickers[2].when.feature', 'stickers[3].when', 'stickers[4].when.fish', 'perfection.hat']) assert.ok(paths.includes(`events.json:${p}`), `${p} in ${paths.join(', ')}`);
});

test('challenge: a new task every Monday for everyone; every try is the same fresh test farm (the same time at ×1 and ×8)', () => {
  const { events } = loadConfig();
  const ids = ['20261026', '20261101', '20261102'].map((day) => weekTask(events, day).id);
  assert.equal(ids[0], ids[1], 'Monday to Sunday');
  assert.notEqual(ids[1], ids[2], 'a new one on Monday');
  assert.equal(weekTask(events, '20261029').week, '202644');
  const main = makeGame({ clock: noon('20261029') });
  const task = events.challenges.find((c) => c.id === 'giant3');
  const farm = testGame(main.config, task);
  assert.equal(farm.calendar.state, null, 'no seasons, weather, luck or festival');
  assert.deepEqual([farm.world.width, farm.world.height, farm.research.level('Pumpkins'), farm.research.level('Loops'), farm.inventory.get('Carrot')], [3, 3, 1, 1, 200]);
  assert.deepEqual(farm.settings.game.speedOptions, [1, 2, 4, 8]);
  assert.ok(main.calendar.state && main.config.settings.calendar, 'the main farm keeps its calendar');
  assert.deepEqual(main.config.settings.game.speedOptions, [0.25, 0.5, 1]);
  const code = 'while (true) {\n  for (let i = 0; i < 3; i++) {\n    for (let j = 0; j < 3; j++) {\n      if (getGroundType() != Grounds.Soil) { till(); }\n      if (getEntityType() != Entities.Pumpkin) { plant(Entities.Pumpkin); }\n      if (i == 2 && j == 2 && canHarvest()) { harvest(); }\n      move(North);\n    }\n    move(East);\n  }\n}';
  const time = (speed) => {
    const game = testGame(main.config, task, code);
    const goal = watchGoal(game, task.goal);
    game.speed = speed;
    game.runner.start(CHALLENGE_SCRIPT);
    while (goal.done === null && game.time < 600) game.update(0.1);
    return goal.done;
  };
  const first = time(1);
  assert.ok(first > 5 && first < 60, String(first));
  assert.deepEqual([time(1), time(8)], [first, first]);
  assert.equal(main.time, 0, 'the main farm did not move');
});

test('challenge goals: items gathered, things harvested or caught, a dinosaur this long; timed by the drone that did it', () => {
  const farm = testGame(loadConfig(), { goal: {}, levels: {} });
  const goals = [watchGoal(farm, { items: { Hay: 10, Wood: 1 } }), watchGoal(farm, { harvest: { Trout: 1 } }), watchGoal(farm, { dino: 5 })];
  farm.mainDrone.time = 4.2;
  farm.inventory.add('Hay', 10, { drone: 0 });
  farm.inventory.add('Wood', 2, 'use');
  farm.stats.recordHarvest('Trout');
  farm.events.emit('fish', { drone: 0 });
  farm.events.emit('appleEaten', { eaten: 3 });
  assert.deepEqual(goals.map((g) => g.done), [4.2, 4.2, null]);
  farm.mainDrone.time = 9;
  farm.events.emit('appleEaten', { eaten: 4 });
  assert.equal(goals[2].done, 9);
});

test('challenge: the code is kept all week and a new week starts empty; the best time keeps its code; ⭐ once; the row has this and last week', () => {
  const main = makeGame();
  rollWeek(main, '202644');
  main.challenge.code = 'harvest();';
  const stars = main.inventory.get('Star');
  assert.deepEqual([recordResult(main, 500, 'a'), recordResult(main, 600, 'b'), recordResult(main, 420, 'c')], [{ better: true, first: true }, { better: false, first: false }, { better: true, first: false }]);
  assert.equal(main.inventory.get('Star') - stars, 5);
  assert.equal(rollWeek(main, '202644').code, 'harvest();');
  let row = playerRow('Aram', main.leaderStats());
  assert.deepEqual([row.c202644, row.cc202644], [420, 'c']);
  assert.deepEqual(reload(main).challenge, main.challenge);
  rollWeek(main, '202645');
  assert.deepEqual([main.challenge.code, main.challenge.best, main.challenge.prev], ['', 0, { week: '202644', best: 420, bestCode: 'c' }]);
  row = playerRow('Aram', main.leaderStats());
  assert.deepEqual([row.c202644, row.cc202644, row.c202645], [420, 'c', undefined], "last week's result stays for its prizes");
});

test('challenge prizes: the top 3 get their hat and 🏅 medals (worth points) and the sticker', () => {
  const game = makeGame();
  const places = [];
  game.events.on('challengePrize', (e) => places.push(e.place));
  givePrize(game, 1);
  assert.deepEqual([game.research.hasHat('Challenge_Gold_Hat'), game.inventory.get('Medal'), game.stats.points(), game.stickers.earned.has('challenge')], [true, 3, 3000, true]);
  givePrize(game, 3);
  assert.deepEqual([game.research.hasHat('Challenge_Bronze_Hat'), game.inventory.get('Medal'), game.flags.challengeTop, places], [true, 4, 1, [1, 3]]);
});

test('events.json: a challenge mistake is reported', () => {
  const cfg = loadConfig();
  cfg.events.challenge.hats = ['Challenge_Gold_Hat', 'Nope_Hat', 'Red_Hat'];
  cfg.events.challenge.levels.Flying = 1;
  cfg.events.challenges[0].goal = { jump: 3 };
  cfg.events.challenges[1].goal = { items: { Diamond: 5 } };
  cfg.events.challenges[2].levels.Expand = 99;
  cfg.events.challenges[3].id = cfg.events.challenges[4].id;
  const paths = validateConfig(cfg).map((e) => `${e.file}:${e.path}`);
  for (const p of ['challenge.hats', 'challenge.levels.Flying', 'challenges[0].goal', 'challenges[1].goal.items.Diamond', 'challenges[2].levels.Expand', 'challenges[4].id']) assert.ok(paths.includes(`events.json:${p}`), `${p} in ${paths.join(', ')}`);
});
