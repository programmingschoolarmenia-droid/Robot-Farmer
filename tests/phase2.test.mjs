import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, runCode, loadConfig } from './helpers.mjs';
import { validateConfig } from '../js/core/config.js';
import { QuestTracker } from '../js/engine/quests.js';

test('shipped config passes validation', () => {
  const errors = validateConfig(loadConfig());
  assert.deepEqual(errors, []);
});

test('validation reports teacher mistakes with file and path', () => {
  const cfg = loadConfig();
  cfg.settings.entities.Carrot.growTime = [5, 1];
  cfg.research.nodes[0].tiers = [{ Hayy: 5 }];
  cfg.research.nodes[1].parents = ['Nope'];
  cfg.bridgy.quests[0].goals = [{ type: 'gain', item: 'Gold2', amount: 1 }];
  const errors = validateConfig(cfg);
  const paths = errors.map((e) => `${e.file}:${e.path}`);
  assert.ok(paths.some((p) => p.startsWith('settings.json:entities.Carrot.growTime')), paths.join('\n'));
  assert.ok(paths.some((p) => p.startsWith('research.json:nodes[0]')), paths.join('\n'));
  assert.ok(paths.some((p) => p.includes('parents')), paths.join('\n'));
  assert.ok(paths.some((p) => p.startsWith('bridgy.json:quests[0].goals[0].item')), paths.join('\n'));
});

test('water makes plants grow faster and evaporates', () => {
  const game = makeGame({ levels: { Watering: 1 } });
  const w = game.world;
  const dry = w.tile(0, 0);
  dry.entity = w.makeEntity('Bush');
  dry.entity.growTime = 4;
  dry.lastSync = 0;
  w.sync(dry, 0.5);
  const dryProgress = dry.entity.progress;
  const game2 = makeGame({ levels: { Watering: 1 } });
  const w2 = game2.world;
  const wet = w2.tile(0, 0);
  wet.entity = w2.makeEntity('Bush');
  wet.entity.growTime = 4;
  wet.lastSync = 0;
  wet.water = 1;
  w2.sync(wet, 0.5);
  assert.ok(wet.entity.progress > dryProgress * 4.5, `wet ${wet.entity.progress} dry ${dryProgress}`);
  assert.ok(wet.water < 1 && wet.water > 0.98);
});

test('water tanks are produced over time after Watering', () => {
  const game = makeGame({ levels: { Watering: 1 } });
  for (let i = 0; i < 210; i++) game.update(0.1);
  assert.equal(game.inventory.get('Water'), 2);
});

test('power doubles drone speed and drains with actions', () => {
  const game = makeGame({ items: { Power: 1 }, levels: { Expand: 1 } });
  const r = runCode(game, 'move(East);\nmove(East);');
  assert.ok(Math.abs(r.seconds - 0.5) < 0.11, `took ${r.seconds}`);
  const game2 = makeGame({ items: { Power: 1 }, levels: { Expand: 1, Loops: 1 } });
  runCode(game2, 'while (true) { move(East); }', { maxSeconds: 20 });
  assert.equal(game2.inventory.get('Power'), 0);
});

test('sunflower with most petals gives the bonus when there are 10+', () => {
  const game = makeGame({ levels: { Expand: 4, Sunflowers: 1 }, available: true });
  const w = game.world;
  let i = 0;
  for (const tl of w.tiles.slice(0, 12)) {
    tl.ground = 'Soil';
    tl.entity = w.makeEntity('Sunflower');
    tl.entity.progress = 1;
    tl.entity.data.petals = 7 + (i++ % 5);
  }
  const best = w.tiles.find((t) => t.entity && t.entity.data.petals === 11);
  const other = w.tiles.find((t) => t.entity && t.entity.data.petals === 7);
  assert.equal(w.harvest(other, game.time).items.Power, 1);
  assert.equal(w.harvest(best, game.time).items.Power, 8);
});

test('fertilizer speeds growth and infection gives weird substance', () => {
  const game = makeGame({ items: { Fertilizer: 3 }, levels: { Plant: 1, Watering: 1, Fertilizer: 1 } });
  const r = runCode(game, 'plant(Entities.Bush);\nuseItem(Items.Fertilizer);\nuseItem(Items.Fertilizer);\nharvest();');
  assert.equal(r.error, null);
  assert.equal(game.inventory.get('Fertilizer'), 1);
  assert.ok(game.inventory.get('Weird_Substance') >= 1);
  assert.ok(game.inventory.get('Wood') >= 1);
});

test('measure and swap sort cacti', () => {
  const game = makeGame({ items: { Pumpkin: 100 }, levels: { Expand: 2, Plant: 1, Carrots: 1, Pumpkins: 1, Cactus: 1, Loops: 1, Operators: 1, Variables: 1, Senses: 1 }, available: true });
  const w = game.world;
  [5, 2, 8].forEach((size, x) => {
    const tl = w.tile(x, 0);
    tl.ground = 'Soil';
    tl.entity = w.makeEntity('Cactus');
    tl.entity.data.size = size;
    tl.entity.progress = 1;
  });
  const r = runCode(
    game,
    'for (let pass = 0; pass < 3; pass++) {\n  for (let x = 0; x < 2; x++) {\n    if (measure() > measure(East)) {\n      swap(East);\n    }\n    move(East);\n  }\n  move(East);\n}',
  );
  assert.equal(r.error, null);
  assert.deepEqual([0, 1, 2].map((x) => w.tile(x, 0).entity.data.size), [2, 5, 8]);
});

test('quests: gain baseline, research and code goals', () => {
  const game = makeGame({ items: { Hay: 10 } });
  const q = new QuestTracker(game, {});
  assert.equal(q.current().id, 'first_harvest');
  game.inventory.add('Hay', 1); // the 'items' event completes first_harvest
  assert.equal(q.current().id, 'hay_5');
  q.check(); // 11 hay ≥ 5
  assert.equal(q.current().id, 'buy_loops');
  game.research.buy('Loops');
  q.check();
  assert.equal(q.current().id, 'use_while');
  runCode(game, 'while (true) { harvest(); }', { maxSeconds: 1 });
  assert.equal(q.satisfied[0], true);
  const hint1 = q.nextHint();
  const hint2 = q.nextHint();
  assert.notEqual(hint1.text, hint2.text);
  q.destroy();
});

test('debugger sees variables', () => {
  const game = makeGame({ unlockAll: true });
  game.scripts = [{ name: 'main', code: 'let apples = 3;\nlet name = "Բրիջի";\nharvest();\nharvest();' }];
  game.activeScript = 'main';
  game.runner.step();
  game.runner.step();
  game.runner.step();
  const vars = game.mainDrone.interp.visibleVariables();
  const names = vars.map((v) => v.name);
  assert.ok(names.includes('apples') && names.includes('name'), names.join(','));
});
