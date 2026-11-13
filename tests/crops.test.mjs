// Our own crop rules: seeds, apricot fruits, mulberry bees, the three watermelons, pomegranate juice,
// grape rows, the snake's mouse, tired soil, the farm sizes and the saves from before them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, runCode } from './helpers.mjs';
import { Game } from '../js/engine/game.js';
import { QuestTracker } from '../js/engine/quests.js';

// Puts a plant on a square (soil unless `ground` says otherwise), ripe by default.
function put(game, x, y, type, { progress = 1, ground = 'Soil', ...data } = {}) {
  const tile = game.world.tile(x, y);
  tile.ground = ground;
  tile.entity = game.world.makeEntity(type);
  tile.entity.progress = progress;
  tile.lastSync = game.time;
  Object.assign(tile.entity.data, data);
  return tile;
}
const wait = (game, seconds, step = 0.1) => {
  for (const end = game.time + seconds; game.time < end - 1e-9; ) game.update(Math.min(step, end - game.time));
};

test('eggplant: planted from a seed, each harvest gives 1–3 seeds back, and the seeds are not scaled by the level', () => {
  const game = makeGame({ levels: { Plant: 1, Carrots: 3 }, items: { Seeds: 1 } });
  const r = runCode(game, 'till();\nplant(Entities.Carrot);');
  assert.deepEqual([r.error, game.inventory.get('Seeds'), game.world.tile(0, 0).entity.type], [null, 0, 'Carrot']);
  game.world.tile(0, 0).entity.progress = 1;
  assert.equal(runCode(game, 'harvest();').error, null);
  const seeds = game.inventory.get('Seeds');
  assert.deepEqual([game.inventory.get('Carrot'), seeds >= 1 && seeds <= 3], [4, true], 'level 3 gives ×4 eggplants, still 1–3 seeds');
  const poor = makeGame({ levels: { Plant: 1, Carrots: 1 } });
  assert.deepEqual(runCode(poor, 'till();\nplant(Entities.Carrot);').warnings, ['plant_cost']);
  assert.equal(poor.world.tile(0, 0).entity, null);
});

test('wheat drops a seed about 1 time in 20, but only once the eggplant card is owned', () => {
  const seedsFrom = (levels) => {
    const game = makeGame({ levels });
    for (let i = 0; i < 400; i++) {
      put(game, 0, 0, 'Grass', { ground: 'Grassland' });
      game.onHarvest(game.world.harvest(game.world.tile(0, 0), game.time), game.mainDrone);
    }
    return [game.inventory.get('Hay'), game.inventory.get('Seeds')];
  };
  assert.deepEqual(seedsFrom({ Plant: 1 }), [400, 0]);
  const [hay, seeds] = seedsFrom({ Plant: 1, Carrots: 1 });
  assert.ok(hay === 400 && seeds >= 8 && seeds <= 40, `${seeds} seeds from 400 wheat`);
});

test('apricot: three fruits from one tree, chapel() counts what is left, neighbours do not slow it', () => {
  const game = makeGame({ levels: { Loops: 1, Plant: 1, Debug: 1, Carrots: 1, Trees: 1, Expand: 1 } });
  const tree = put(game, 0, 0, 'Tree', { ground: 'Grassland' });
  put(game, 1, 0, 'Tree', { ground: 'Grassland', progress: 0 });
  const grow = tree.entity.growTime;
  const r = runCode(game, 'tpel(chapel());\ntpel(havaqel());\ntpel(chapel(), hasunE());');
  assert.deepEqual([r.error, r.out, game.inventory.get('Wood')], [null, ['3', 'true', '2 false'], 5]);
  assert.ok(tree.entity.type === 'Tree' && tree.entity.progress >= 0.5 && tree.entity.progress < 0.7, 'the tree stays and starts half way to its next fruit');
  const neighbour = game.world.tile(1, 0);
  game.world.sync(neighbour, game.time);
  const before = neighbour.entity.progress;
  const t0 = game.time;
  wait(game, 1);
  game.world.sync(neighbour, game.time);
  assert.ok(Math.abs(neighbour.entity.progress - before - (game.time - t0) / neighbour.entity.growTime) < 1e-9, 'a tree next to a tree grows at full speed');
  tree.entity.progress = 1;
  runCode(game, 'havaqel();');
  tree.entity.progress = 1;
  const last = runCode(game, 'tpel(chapel());\nhavaqel();\ntpel(inchKa());');
  assert.deepEqual([last.out, game.inventory.get('Wood')], [['1', 'Buyser.Coren'], 15], 'after the third fruit the tree is gone');
  assert.ok(grow > 0);
});

test('mulberry: a ripe rosehip right next to it doubles the wood (bees); an unripe one does not', () => {
  const wood = (bushProgress) => {
    const game = makeGame({ levels: { Plant: 1, Carrots: 1, Trees: 1, Mulberry: 1, Expand: 2 } });
    const tile = put(game, 1, 1, 'Mulberry', { ground: 'Grassland' });
    if (bushProgress !== null) put(game, 1, 2, 'Bush', { ground: 'Grassland', progress: bushProgress });
    const r = game.world.harvest(tile, game.time);
    return [r.items.Wood, !!r.bees];
  };
  assert.deepEqual([wood(null), wood(0.5), wood(1)], [[6, false], [6, false], [12, true]]);
});

test('watermelon: grown is not sweet yet; chapel() goes 0 → 100, 80 and more gives the harvest, too late it rots', () => {
  const game = makeGame({ levels: { Plant: 1, Debug: 1, Operators: 1, Carrots: 1, Trees: 1, Pumpkins: 1 }, items: { Carrot: 10 } });
  const cfg = game.settings.entities.Pumpkin;
  const tile = put(game, 0, 0, 'Pumpkin');
  assert.deepEqual(runCode(game, 'tpel(hasunE(), chapel());').out, ['true 0']);
  wait(game, cfg.ripeWindow / 2 - (game.time - tile.lastSync));
  const half = runCode(game, 'tpel(chapel());').out[0];
  assert.ok(Number(half) >= 49 && Number(half) <= 52, half);
  const green = runCode(game, 'tpel(havaqel());');
  assert.deepEqual([green.warnings, game.inventory.get('Pumpkin'), tile.entity && tile.entity.type], [['harvest_green'], 0, null], 'harvested too early: wasted');

  const sweet = put(game, 0, 0, 'Pumpkin', { over: cfg.ripeWindow * 0.8 });
  assert.deepEqual([runCode(game, 'if (chapel() >= 80) {\n  havaqel();\n}').warnings, game.inventory.get('Pumpkin')], [[], 1]);
  assert.equal(sweet.entity, null);

  const late = put(game, 0, 0, 'Pumpkin');
  const rotten = [];
  game.events.on('pumpkinDied', (e) => rotten.push([e.x, e.y]));
  wait(game, cfg.ripeWindow + cfg.rotSeconds - 0.5);
  game.world.sync(late, game.time);
  assert.deepEqual([late.entity.type, game.world.ripeness(late.entity)], ['Pumpkin', 100], 'still good just before');
  wait(game, 1);
  game.world.sync(late, game.time);
  assert.deepEqual([late.entity.type, rotten, game.world.isRipe(late)], ['Dead_Pumpkin', [[0, 0]], false]);
  assert.deepEqual(runCode(game, 'tnkel(Buyser.Dzmeruk);\ntpel(inchKa());').out, ['Buyser.Dzmeruk'], 'a new one is planted over the rotten one');
});

test('watermelon: the sweetness is the same however the time is cut into frames, also on wet soil', () => {
  const overAt = (step) => {
    const game = makeGame({ levels: { Plant: 1, Carrots: 1, Pumpkins: 1, Watering: 1 }, seed: 5 });
    const tile = put(game, 0, 0, 'Pumpkin', { progress: 0 });
    tile.entity.growTime = 3;
    tile.water = 0.8;
    wait(game, 4, step);
    game.world.sync(tile, game.time);
    return tile.entity.data.over;
  };
  const [coarse, fine] = [overAt(0.1), overAt(0.01)];
  assert.ok(coarse > 2 && Math.abs(coarse - fine) < 1e-6, `${coarse} and ${fine}`);
});

test('yellow melon: ripe ones send vines to the empty soil next to them; one harvest takes the joined ripe ones, n give n²', () => {
  const play = (step) => {
    const game = makeGame({ levels: { Plant: 1, Carrots: 1, Pumpkins: 1, YellowMelon: 1, Expand: 3 }, items: { Carrot: 5 }, seed: 9 });
    for (const tile of game.world.tiles) if (tile.x < 3) tile.ground = 'Soil';
    for (const tile of game.world.tiles) tile.entity = null;
    assert.ok(game.world.plant(game.world.tile(1, 1), 'YellowMelon', game.time).ok);
    wait(game, 30, step);
    game.world.syncAll(game.time);
    const ripe = game.world.tiles.filter((t) => t.entity && t.entity.type === 'YellowMelon').map((t) => `${t.x},${t.y}:${t.entity.progress >= 1 ? 1 : t.entity.progress.toFixed(6)}`);
    const r = game.world.harvest(game.world.tile(1, 1), game.time);
    return { game, ripe, r };
  };
  const { game, ripe, r } = play(0.1);
  assert.equal(game.inventory.get('Carrot'), 4, 'only the first one costs eggplants');
  assert.equal(ripe.length, 12, 'the vines filled the soil (3 columns of 4) and never left it');
  assert.deepEqual([r.items.YellowMelon, r.patch], [r.tiles.length * r.tiles.length, r.tiles.length]);
  assert.ok(r.tiles.length >= 9, `${r.tiles.length} ripe melons in the patch`);
  assert.deepEqual(play(0.01).ripe, ripe, 'the same farm at any frame rate');
});

test('square melon: a full square of ripe ones becomes a giant and gives n³', () => {
  const game = makeGame({ seed: 7, levels: { Expand: 2, Pumpkins: 1, SquareMelon: 1 } });
  const w = game.world;
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) put(game, x, y, 'SquareMelon', { progress: 0 });
  w.syncAll(game.time + 10);
  const g = w.tile(1, 1).entity.data.giant;
  assert.deepEqual([!!g, g && g.size], [true, 3], 'giant formed (no melon dies any more)');
  const r = w.harvest(w.tile(2, 2), game.time + 10);
  assert.deepEqual([r.ok, r.items.SquareMelon, r.tiles.length, r.giantSize], [true, 27, 9, 3]);
  // the plain watermelon does not merge
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) put(game, x, y, 'Pumpkin', { progress: 0 });
  w.syncAll(game.time + 20);
  assert.equal(w.tile(0, 0).entity.data.giant, undefined);
});

test('pomegranate: even ones in rising order grow the combo, a smaller even one starts it again, an odd one spills a juice', () => {
  const game = makeGame({ levels: { Plant: 1, Carrots: 1, Sunflowers: 1 }, items: { Power: 5 } });
  const take = (seeds) => {
    const tile = put(game, 0, 0, 'Sunflower', { petals: seeds });
    const r = game.world.harvest(tile, game.time);
    game.onHarvest(r, game.mainDrone);
    return game.inventory.get('Power');
  };
  assert.deepEqual([take(4), take(10), take(12)], [6, 8, 11], '+1, +2, +3');
  assert.equal(take(7), 10, 'odd: one juice is lost');
  assert.equal(take(20), 14, 'the odd one did not break the combo: +4');
  assert.equal(take(20), 15, 'not bigger: the combo starts again at 1');
  assert.equal(take(22), 17);
  const empty = makeGame({ levels: { Plant: 1, Carrots: 1, Sunflowers: 1 } });
  const tile = put(empty, 0, 0, 'Sunflower', { petals: 3 });
  empty.onHarvest(empty.world.harvest(tile, empty.time), empty.mainDrone);
  assert.equal(empty.inventory.get('Power'), 0, 'never below 0');
  const copy = new Game(game.config, JSON.parse(JSON.stringify(game.toSave())));
  assert.deepEqual(copy.world.juiceCombo, { last: 22, n: 2 }, 'the combo is saved');
});

test('juice: nothing happens by itself; xmel() spends one and doubles the speed for the next 50 actions', () => {
  const game = makeGame({ items: { Power: 2 }, levels: { Loops: 1, Variables: 1, Operators: 1, Expand: 1, Sunflowers: 1, Debug: 1 } });
  const base = game.mainDrone.tickRate();
  const slow = runCode(game, 'for (let i = 0; i < 4; i++) {\n  move(East);\n}', { step: 0.01 });
  assert.equal(game.inventory.get('Power'), 2, 'juice in the storage is not used up');
  const fast = runCode(game, 'tpel(xmel());\nfor (let i = 0; i < 4; i++) {\n  move(East);\n}', { step: 0.01 });
  assert.deepEqual([fast.out, game.inventory.get('Power'), game.mainDrone.tickRate()], [['true'], 1, base * 2]);
  assert.ok(Math.abs(slow.seconds - (4 * 150) / base) < 0.06 && Math.abs(fast.seconds - (200 + 4 * 150) / (2 * base)) < 0.06, `${slow.seconds} then ${fast.seconds}`);
  runCode(game, 'for (let i = 0; i < 50; i++) {\n  move(East);\n}');
  assert.equal(game.mainDrone.tickRate(), base, 'after 50 actions the juice has worn off');
  game.inventory.items.delete('Power');
  assert.deepEqual([runCode(game, 'tpel(xmel());').out, runCode(game, 'xmel();').warnings], [['false'], ['notEnoughItem']]);
});

test('grapes: a row sorted from left to right is harvested whole for n²; an unsorted one gives a single grape', () => {
  const game = makeGame({ levels: { Expand: 3, Carrots: 1, Pumpkins: 1, Cactus: 1, Loops: 1, Operators: 1, Variables: 1, Plant: 1, Debug: 1 } });
  const w = game.world;
  const row = (y, sizes) => sizes.forEach((size, x) => put(game, x, y, 'Cactus', { size }));
  row(0, [1, 3, 3, 7]);
  row(1, [9, 0, 0, 0]); // (the row above does not matter any more)
  const sorted = w.harvest(w.tile(2, 0), game.time);
  assert.deepEqual([sorted.items.Cactus, sorted.chain, sorted.tiles.length], [16, 4, 4]);
  const unsorted = w.harvest(w.tile(1, 1), game.time);
  assert.deepEqual([unsorted.items.Cactus, unsorted.chain, w.tile(0, 1).entity.type], [1, 1, 'Cactus']);
  row(2, [5, 2, 8]);
  w.tile(3, 2).entity = null;
  game.mainDrone.x = 0;
  game.mainDrone.y = 2;
  const r = runCode(game, 'for (let pass = 0; pass < 3; pass++) {\n  for (let x = 0; x < 2; x++) {\n    if (measure() > measure(East)) {\n      swap(East);\n    }\n    move(East);\n  }\n  move(West);\n  move(West);\n}\ntpel(swap(North));\nharvest();');
  assert.deepEqual([r.error, r.out, r.warnings, game.inventory.get('Cactus')], [null, ['false'], ['swapSideways'], 9], 'sorted by swaps to the side; up and down is refused');
});

test('snake: the mouse costs nothing and runs from the head every 2 moves; skin = mice × length', () => {
  const game = makeGame({ levels: { Loops: 1, Expand: 5, Hats: 1, Dinosaurs: 1, Debug: 1 }, seed: 3 });
  assert.equal(runCode(game, 'changeHat(Hats.Dinosaur_Hat);').error, null);
  const dino = game.dino;
  const place = (x, y) => game.putMouse(game.world.tile(x, y), game.time);
  place(3, 0);
  assert.equal(game.world.tile(3, 0).entity.type, 'Apple');
  runCode(game, 'move(East);');
  assert.deepEqual(dino.apple, { x: 3, y: 0 }, 'after one move the mouse still sits');
  runCode(game, 'move(East);');
  assert.deepEqual([dino.apple, game.world.tile(3, 0).entity.type, game.world.tile(3, 1).entity.type], [{ x: 3, y: 1 }, 'Grass', 'Apple'], 'after the second it ran one square away from the head');
  assert.deepEqual(runCode(game, 'tpel(chapel());').out, ['[3, 1]']);
  place(5, 5);
  game.mainDrone.x = 3;
  game.mainDrone.y = 5;
  dino.moves = 0;
  runCode(game, 'move(East);\nmove(East);');
  assert.deepEqual([dino.eaten, dino.tail.length], [1, 1], 'a mouse in the corner has nowhere to run');
  place(0, 0);
  dino.eaten = 3;
  runCode(game, 'changeHat(Hats.Straw_Hat);');
  assert.deepEqual([game.inventory.get('Bone'), game.dino, game.world.tile(0, 0).entity.type], [3 * 4, null, 'Grass'], '3 mice, 4 long');
});

test('tired soil: only after the Humus card; the same crop again weakens the soil down to a half, another crop rests it, humus mends it', () => {
  const run = (levels, crops) => {
    const game = makeGame({ levels: { Plant: 1, Carrots: 6, ...levels }, items: { Fertilizer: 5 } });
    const out = [];
    for (const type of crops) {
      if (type === 'Humus') {
        game.useItem(game.mainDrone, 'Fertilizer', 1, game.time);
        continue;
      }
      const tile = put(game, 0, 0, type);
      const r = game.world.harvest(tile, game.time);
      out.push(type === 'Carrot' ? r.items.Carrot : !!r.tired);
    }
    return [out, game.world.tile(0, 0).s];
  };
  assert.deepEqual(run({}, ['Carrot', 'Carrot', 'Carrot']), [[32, 32, 32], undefined], 'no card: the soil never tires');
  const [same, s] = run({ Watering: 1, Fertilizer: 1 }, Array(8).fill('Carrot'));
  assert.equal(same[0], 32);
  assert.deepEqual(same.slice(1).map((n) => Math.round(n / 3.2)), [10, 9, 8, 7, 6, 5, 5], 'full, then 90%, 80% … down to 50%');
  assert.equal(s, 0.5);
  assert.deepEqual(run({ Watering: 1, Fertilizer: 1 }, ['Carrot', 'Sunflower', 'Carrot', 'Sunflower', 'Carrot'])[0], [32, false, 32, false, 32], 'taking turns keeps it strong');
  assert.deepEqual(run({ Watering: 1, Fertilizer: 1 }, ['Carrot', 'Carrot', 'Carrot', 'Sunflower', 'Sunflower', 'Carrot'])[1], 0.9, 'another crop lets tired soil rest: 0.8, then 0.9, then the same crop again');
  const [mended, after] = run({ Watering: 1, Fertilizer: 1 }, ['Carrot', 'Carrot', 'Carrot', 'Humus', 'Carrot']);
  assert.deepEqual([mended[3], after], [32, 0.9], 'humus made it strong again (and the same crop tires it once more)');
  // humus still speeds a growing plant, and on nothing it is not spent
  const game = makeGame({ levels: { Plant: 1, Watering: 1, Fertilizer: 1 }, items: { Fertilizer: 3 } });
  const r = runCode(game, 'plant(Entities.Bush);\nuseItem(Items.Fertilizer);\nuseItem(Items.Fertilizer);\nharvest();');
  assert.deepEqual([r.error, game.inventory.get('Fertilizer'), game.inventory.get('Weird_Substance')], [null, 1, 0], 'no magic dust from humus any more');
  assert.ok(game.inventory.get('Wood') >= 1);
  assert.deepEqual([runCode(game, 'harvest();\nuseItem(Items.Fertilizer);').warnings, game.inventory.get('Fertilizer')], [['fertilizeNothing'], 1]);
  assert.deepEqual(runCode(makeGame({ levels: { Plant: 1, Watering: 1 }, items: { Weird_Substance: 3 } }), 'useItem(Items.Weird_Substance);').warnings, ['cannotUseItem'], 'magic dust is only for mazes');
});

test('tired soil is saved, and fresh after the ground is dug over', () => {
  const game = makeGame({ levels: { Plant: 1, Carrots: 1, Watering: 1, Fertilizer: 1 } });
  for (let i = 0; i < 3; i++) game.world.harvest(put(game, 0, 0, 'Carrot'), game.time);
  const copy = new Game(game.config, JSON.parse(JSON.stringify(game.toSave())));
  assert.deepEqual([copy.world.tile(0, 0).s, copy.world.tile(0, 0).lc], [0.8, 'Carrot']);
  runCode(copy, 'till();\ntill();');
  assert.deepEqual([copy.world.tile(0, 0).ground, copy.world.tile(0, 0).s, copy.world.tile(0, 0).lc], ['Soil', undefined, undefined]);
});

test('the farm grows 1, 2, 3, 4, 5, 6, 8, 10, 12, 16; moving is the quickest action and tilling the slowest', () => {
  const game = makeGame({ unlockAll: false, levels: { Loops: 1, Plant: 1, Carrots: 1 } });
  const sizes = [];
  for (let level = 0; level <= 9; level++) sizes.push(game.worldSizeForLevel(level)[0]);
  assert.deepEqual(sizes, [1, 2, 3, 4, 5, 6, 8, 10, 12, 16]);
  const rate = game.mainDrone.tickRate();
  const took = (code) => runCode(makeGame({ levels: { Loops: 1, Plant: 1, Carrots: 1, Expand: 1 } }), code, { step: 0.005 }).seconds * rate;
  const near = (ticks, want) => Math.abs(ticks - want) <= 4;
  assert.ok(near(took('move(East);'), 150) && near(took('till();'), 300) && near(took('plant(Entities.Bush);'), 200) && near(took('doAFlip();'), 400), 'move 150, till 300, plant 200 ticks');
});

test('saves from before the new rules: the farm never shrinks, giants, items and levels stay, old plant marks are dropped', () => {
  const config = makeGame().config;
  const old = (Expand, extra = {}) => new Game(config, { v: 2, research: { Loops: 1, Speed: 3, Expand, ...extra }, inventory: { Hay: 12, Wood: 34, Carrot: 56, Pumpkin: 78, Power: 3, Weird_Substance: 9 } });
  const width = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => old(level).world.width);
  assert.deepEqual(width, [1, 3, 3, 4, 6, 8, 12, 16, 22, 32], 'every old farm keeps its width (3×1 became 3×3)');
  assert.deepEqual([old(1).world.height, old(9).research.level('Expand'), old(9).flags.farmSize, old(4).research.level('Expand')], [3, 9, 32, 5]);

  // a big old farm with a giant, a plant humus had infected, a favourite neighbour and the removed card
  const before = old(9, { Plant: 1, Carrots: 2, Pumpkins: 1, Polyculture: 2, Trees: 1 });
  const tiles = before.world.tiles.map((tl) => ({ g: 1 }));
  const at = (x, y) => tiles[y * 32 + x];
  for (const [x, y] of [[4, 4], [5, 4], [4, 5], [5, 5]]) Object.assign(at(x, y), { e: 'Pumpkin', p: 1, gt: 2 });
  Object.assign(at(0, 0), { e: 'Carrot', p: 0.5, gt: 5, d: { infected: true } });
  Object.assign(at(1, 0), { e: 'Bush', p: 1, gt: 4, d: { companion: { type: 'Tree', x: 2, y: 0 }, charged: true } });
  const save = JSON.parse(JSON.stringify(before.toSave()));
  Object.assign(save, { v: 2, research: { Loops: 1, Speed: 3, Expand: 9, Plant: 1, Carrots: 2, Pumpkins: 1, Polyculture: 2, Trees: 1 }, flags: {}, world: { w: 32, h: 32, tiles, giants: [{ x: 4, y: 4, size: 2 }], maze: null } });
  const game = new Game(config, save);
  assert.deepEqual([game.world.width, game.world.height], [32, 32]);
  assert.deepEqual(['Hay', 'Wood', 'Carrot', 'Pumpkin', 'Power', 'Weird_Substance', 'Seeds'].map((item) => game.inventory.get(item)), [12, 34, 56, 78, 3, 9, 10], 'every item stays; eggplant owners get 10 seeds');
  assert.deepEqual([game.research.level('Polyculture'), game.research.level('Carrots'), game.research.level('Pumpkins'), game.flags.juiceNote], [0, 2, 1, true]);
  const giant = game.world.tile(5, 5).entity;
  assert.deepEqual([giant.type, giant.data.giant.size], ['SquareMelon', 2], 'the giant watermelon is a giant square melon');
  assert.deepEqual([game.world.tile(0, 0).entity.data, game.world.tile(1, 0).entity.data], [{}, { charged: true }]);
  assert.equal(game.world.harvest(game.world.tile(4, 4), game.time).items.SquareMelon, 8);
  // saved again it is a version 4 save: nothing is converted twice
  const again = new Game(config, JSON.parse(JSON.stringify(game.toSave())));
  assert.deepEqual([again.world.width, again.research.level('Expand'), again.inventory.get('Seeds')], [32, 9, 10]);
  const fresh = new Game(config, {});
  assert.deepEqual([fresh.world.width, fresh.inventory.get('Seeds'), fresh.flags.juiceNote], [1, 0, undefined], 'a new game is not converted');
});

test('old saves standing on the removed good-neighbours quest go on with the next one', () => {
  const game = makeGame();
  const at = (saved) => {
    const q = new QuestTracker(game, saved);
    q.destroy();
    return q.current().id;
  };
  assert.deepEqual([at({ id: 'buy_polyculture', index: 44 }), at({ index: 31 })], ['buy_cactus', 'buy_cactus']);
});
