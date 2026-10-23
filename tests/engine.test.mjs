import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, runCode } from './helpers.mjs';

test('first harvest gives hay and takes 0.5 s of game time', () => {
  const game = makeGame();
  game.update(0.1); // let the grass ripen (0.5 s)
  for (let i = 0; i < 5; i++) game.update(0.1);
  const r = runCode(game, 'harvest();');
  assert.equal(r.error, null);
  assert.equal(game.inventory.get('Hay'), 1);
  assert.ok(Math.abs(r.seconds - 0.5) < 0.11, `took ${r.seconds}`);
});

test('harvesting unripe grass destroys it without yield', () => {
  const game = makeGame();
  runCode(game, 'harvest();'); // grass at t=0 is not ripe
  assert.equal(game.inventory.get('Hay'), 0);
});

test('Expand resizes the farm and move wraps around', () => {
  const game = makeGame({ items: { Hay: 1000, Wood: 1000 }, levels: { Loops: 1, Speed: 1 } });
  assert.equal(game.research.buy('Expand').ok, true);
  assert.equal(game.world.width, 3);
  assert.equal(game.world.height, 1);
  const r = runCode(game, 'move(East); move(East); move(East);');
  assert.equal(r.error, null);
  assert.equal(game.mainDrone.x, 0);
  // Speed level 1: 600 ticks/s, a move costs 200 ticks → 1/3 s each.
  assert.ok(r.seconds >= 0.99 && r.seconds < 1.11, `took ${r.seconds}`);
  assert.equal(game.research.buy('Expand').ok, true);
  assert.equal(game.world.width, 3);
  assert.equal(game.world.height, 3);
});

test('speed research makes drones 1.5x faster', () => {
  const game = makeGame({ items: { Hay: 1000, Wood: 1000 }, levels: { Loops: 1, Speed: 1, Expand: 1 } });
  const r = runCode(game, 'move(East); move(East);');
  assert.ok(Math.abs(r.seconds - 2 * (200 / 600)) < 0.11, `took ${r.seconds}`);
});

test('bushes: plant, grow, harvest wood', () => {
  const game = makeGame({ levels: { Loops: 1, Speed: 1, Expand: 1, Plant: 1 } });
  const r = runCode(
    game,
    'while (numWood() < 3) { if (canHarvest()) { harvest(); plant(Entities.Bush); } move(East); }\nfunction numWood() { return 0; }',
    { maxSeconds: 60 },
  );
  // functions/operators are locked at this point → error expected
  assert.ok(r.error);
  const game2 = makeGame({ levels: { Loops: 1, Speed: 1, Expand: 1, Plant: 1 } });
  runCode(game2, 'while (true) { if (canHarvest()) { harvest(); plant(Entities.Bush); } move(East); }', { maxSeconds: 30 });
  assert.ok(game2.inventory.get('Wood') >= 5, `wood=${game2.inventory.get('Wood')}`);
});

test('carrots need soil and cost hay + wood', () => {
  const game = makeGame({ items: { Hay: 10, Wood: 10 }, levels: { Loops: 1, Speed: 1, Plant: 1, Carrots: 1 } });
  const r = runCode(game, 'plant(Entities.Carrot);');
  assert.equal(r.error, null);
  assert.ok(r.warnings.includes('plant_wrongGround'));
  const r2 = runCode(game, 'till();\nplant(Entities.Carrot);');
  assert.equal(r2.error, null);
  assert.equal(game.inventory.get('Hay'), 9);
  assert.equal(game.inventory.get('Wood'), 9);
  assert.equal(game.world.tile(0, 0).entity.type, 'Carrot');
});

test('trees grow slower next to other trees', () => {
  const game = makeGame({ levels: { Loops: 1, Speed: 1, Expand: 2, Plant: 1, Carrots: 1, Trees: 1 }, unlockAll: false });
  const w = game.world;
  const a = w.tile(0, 0);
  const b = w.tile(1, 0);
  a.entity = w.makeEntity('Tree');
  b.entity = w.makeEntity('Tree');
  assert.equal(w.growthSlowdown(a, a.entity), 2);
  const c = w.tile(1, 1);
  c.entity = w.makeEntity('Tree');
  assert.equal(w.growthSlowdown(b, b.entity), 4);
});

test('pumpkins merge into giant pumpkins and yield n^3', () => {
  const game = makeGame({ seed: 7, levels: { Expand: 3, Pumpkins: 1 } });
  const w = game.world;
  // Make death impossible for this test.
  game.config.settings.entities.Pumpkin.deathChance = 0;
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      const t = w.tile(x, y);
      t.ground = 'Soil';
      t.entity = w.makeEntity('Pumpkin');
      t.lastSync = game.time;
    }
  }
  w.syncAll(game.time + 10);
  const g = w.tile(1, 1).entity.data.giant;
  assert.ok(g, 'giant formed');
  assert.equal(g.size, 3);
  const r = w.harvest(w.tile(2, 2), game.time + 10);
  assert.equal(r.ok, true);
  assert.equal(r.items.Pumpkin, 27);
  assert.equal(r.tiles.length, 9);
});

test('pumpkins sometimes die and dead pumpkins block merging', () => {
  const game = makeGame({ seed: 3, levels: { Expand: 3, Pumpkins: 1 } });
  game.config.settings.entities.Pumpkin.deathChance = 1;
  const w = game.world;
  const t = w.tile(0, 0);
  t.ground = 'Soil';
  t.entity = w.makeEntity('Pumpkin');
  t.lastSync = game.time;
  w.sync(t, game.time + 10);
  assert.equal(t.entity.type, 'Dead_Pumpkin');
  assert.equal(w.isRipe(t), false);
});

test('cactus chain harvest yields n^2 when sorted', () => {
  const game = makeGame({ levels: { Expand: 2, Pumpkins: 1, Cactus: 1 }, available: true });
  const w = game.world;
  const sizes = [
    [1, 2, 3],
    [2, 3, 4],
    [3, 4, 5],
  ];
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      const t = w.tile(x, y);
      t.ground = 'Soil';
      t.entity = w.makeEntity('Cactus');
      t.entity.data.size = sizes[y][x];
      t.entity.progress = 1;
    }
  }
  const r = w.harvest(w.tile(0, 0), game.time);
  assert.equal(r.items.Cactus, 81);
});

test('research costs are paid and states update', () => {
  const game = makeGame({ items: { Hay: 4 } });
  assert.equal(game.research.state('Loops'), 'expensive');
  assert.equal(game.research.state('Speed'), 'locked');
  game.inventory.add('Hay', 1);
  assert.equal(game.research.state('Loops'), 'affordable');
  assert.equal(game.research.buy('Loops').ok, true);
  assert.equal(game.inventory.get('Hay'), 0);
  assert.equal(game.research.state('Loops'), 'maxed');
  assert.equal(game.research.state('Speed'), 'expensive');
  assert.equal(game.research.state('Watering'), 'locked');
});

test('step runs one line at a time', () => {
  const game = makeGame({ levels: { Loops: 1, Speed: 1, Expand: 1 } });
  game.scripts = [{ name: 'main', code: 'move(East);\nmove(East);\nmove(East);' }];
  game.activeScript = 'main';
  game.runner.step();
  assert.equal(game.runner.state, 'paused');
  assert.equal(game.mainDrone.interp.currentNode.loc.start.line, 1);
  game.runner.step();
  assert.equal(game.mainDrone.x, 1);
  assert.equal(game.mainDrone.interp.currentNode.loc.start.line, 2);
});

test('save and load keep the farm', async () => {
  const { Game } = await import('../js/engine/game.js');
  const game = makeGame({ items: { Hay: 50, Wood: 7 }, levels: { Loops: 1, Speed: 2, Expand: 2 } });
  game.world.tile(1, 1).ground = 'Soil';
  const data = JSON.parse(JSON.stringify(game.toSave()));
  const copy = new Game(game.config, data);
  assert.equal(copy.inventory.get('Hay'), 50);
  assert.equal(copy.research.level('Speed'), 2);
  assert.equal(copy.world.width, 3);
  assert.equal(copy.world.tile(1, 1).ground, 'Soil');
});
