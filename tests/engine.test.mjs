import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, runCode } from './helpers.mjs';
import { Game } from '../js/engine/game.js';

test('first harvest gives hay and takes 0.5 s of game time', () => {
  const game = makeGame();
  game.update(0.1); // let the grass ripen (0.5 s)
  for (let i = 0; i < 5; i++) game.update(0.1);
  const r = runCode(game, 'harvest();');
  assert.equal(r.error, null);
  assert.equal(game.inventory.get('Hay'), 1);
  assert.ok(Math.abs(r.seconds - 0.5) < 0.11, `took ${r.seconds}`);
});

test('unripe grass stays when harvested, so the first loop earns hay at every Speed level', () => {
  const game = makeGame();
  const grass = game.world.tile(0, 0).entity;
  runCode(game, 'harvest();'); // grass at t=0 is not ripe
  assert.equal(game.inventory.get('Hay'), 0);
  assert.equal(game.world.tile(0, 0).entity, grass, 'not destroyed');
  for (const Speed of [0, 1, 2, 5, 7]) {
    const g = makeGame({ levels: { Loops: 1, Speed } });
    const r = runCode(g, 'while (true) {\n  harvest();\n}', { maxSeconds: 60, step: 0.05 });
    assert.equal(r.error, null);
    assert.ok(g.stats.total('Hay') >= 100, `Speed ${Speed}: ${g.stats.total('Hay')} hay in a minute`);
  }
});

test('other plants harvested unripe are still lost, and the student is told once', () => {
  const game = makeGame({ levels: { Plant: 1, Loops: 1 }, items: { Wood: 50 } });
  const r = runCode(game, 'plant(Entities.Bush); harvest(); plant(Entities.Bush); harvest();');
  assert.equal(r.error, null);
  assert.deepEqual([r.warnings, game.inventory.get('Wood') >= 0, game.stats.total('Wood')], [['harvestUnripe'], true, 0]);
  assert.equal(game.world.tile(0, 0).entity.type, 'Grass', 'the bush is gone');
});

test('silent mistakes get a message; correct code gets none', () => {
  const lv = { Loops: 1, Plant: 1, Operators: 1, Variables: 1, Functions: 1, Debug: 1 };
  const warns = (code) => runCode(makeGame({ levels: lv }), code, { maxSeconds: 1 }).warnings;
  assert.deepEqual(warns('havaqel;'), ['fnNoCall']);
  assert.deepEqual(warns('if (hasunE) {\n  tpel(1);\n}'), ['fnAsCondition']);
  assert.deepEqual(warns('while (!hasunE) {\n}'), ['fnAsCondition']);
  assert.deepEqual(warns('if (1 < 2 && hasunE) {\n  tpel(1);\n}'), ['fnAsCondition']);
  assert.deepEqual(warns('let x = 1;\nif (x = 2) {\n  tpel(x);\n}'), ['assignInCondition']);
  assert.deepEqual(warns('if (inchKa() == "Xot") {\n  tpel(1);\n}'), ['enumVsText']);
  assert.deepEqual(warns('if ("Xot" !== inchKa()) {\n  tpel(1);\n}'), ['enumVsText']);
  assert.deepEqual(warns('function f() {\n  tpel(1);\n}\nf;'), ['fnNoCall']);
  // none of these is a mistake
  assert.deepEqual(warns('havaqel();\nif (hasunE()) {\n  tpel(1);\n}'), []);
  assert.deepEqual(warns('if (inchKa() == Buyser.Xot) {\n  tpel(1);\n}'), []);
  assert.deepEqual(warns('if ("a" == "b") {\n  tpel(1);\n}'), []);
  assert.deepEqual(warns('let hasunE = 1;\nif (hasunE) {\n  tpel(1);\n}'), [], 'a variable of the same name');
  assert.deepEqual(warns('let x = 1;\nif (x == 1) {\n  x = 2;\n}\nx;'), []);
  assert.deepEqual(warns('for (let i = 0; i < 2; i++) {\n  tpel(i);\n}'), []);
});

test('obvious JavaScript: Number(), toString(), and no internal errors from inherited names', () => {
  const lv = { Loops: 1, Plant: 1, Operators: 1, Variables: 1, Functions: 1, Debug: 1, Lists: 1, Objects: 1, Utilities: 1 };
  const run = (code) => runCode(makeGame({ levels: lv }), code, { maxSeconds: 1 });
  const out = (code) => {
    const r = run(code);
    assert.equal(r.error, null, code);
    return r.out;
  };
  assert.deepEqual(out('tpel(Number("7") + 1);\ntpel(Number("x"));\ntpel(Number());\ntpel(Number(true));\ntpel(Number(5));'), ['8', 'NaN', '0', '1', '5']);
  assert.deepEqual(out('tpel(["1", "2"].map(Number).join());\ntpel(typeof Number);\ntpel(Number.isInteger(5));'), ['1,2', 'function', 'true']);
  assert.deepEqual(out('tpel(Number({}));\ntpel(Number([]));\ntpel(Number([5]));'), ['NaN', '0', '5']);
  assert.deepEqual(out('tpel([1, 2, 3].toString());\ntpel("ab".toString());\ntpel((5).toString());'), ['1,2,3', 'ab', '5']);
  assert.deepEqual(out('tpel((255).toString(16));\ntpel((5).toString(2));\ntpel((5).toString(99));'), ['ff', '101', '5']);
  for (const code of ['[1].constructor();', '"a".valueOf();', '(1).hasOwnProperty("a");', 'new Map().toLocaleString();']) {
    assert.equal(run(code).error.code, 'noMember', code);
  }
});

test('Expand resizes the farm and move wraps around', () => {
  const game = makeGame({ items: { Hay: 1000, Wood: 1000 }, levels: { Loops: 1, Speed: 1 } });
  assert.equal(game.research.buy('Expand').ok, true);
  assert.deepEqual([game.world.width, game.world.height], [2, 2]);
  const r = runCode(game, 'move(East); move(East);', { step: 0.01 });
  assert.equal(r.error, null);
  assert.equal(game.mainDrone.x, 0);
  // Speed level 1: 534 ticks/s, a move costs 150 ticks → 0.28 s each.
  assert.ok(Math.abs(r.seconds - 2 * (150 / 534)) < 0.03, `took ${r.seconds}`);
  assert.equal(game.research.buy('Expand').ok, true);
  assert.deepEqual([game.world.width, game.world.height], [3, 3]);
});

test('speed research: 7 levels, the same top speed as the old 5 levels of ×1.5', () => {
  const game = makeGame({ items: { Hay: 1000, Wood: 1000 }, levels: { Loops: 1, Speed: 1, Expand: 1 } });
  const r = runCode(game, 'move(East); move(East);', { step: 0.01 });
  assert.ok(Math.abs(r.seconds - 2 * (150 / 534)) < 0.03, `took ${r.seconds}`);
  assert.equal(game.research.maxLevel('Speed'), 7);
  game.research.levels.set('Speed', 7);
  assert.ok(Math.abs(game.mainDrone.tickRate() / 400 - Math.pow(1.5, 5)) < 0.01, 'top speed');
});

test('saves from before: Speed moves to the level at least as fast, and only once', () => {
  const old = (level) => {
    const game = makeGame();
    return new Game(game.config, { v: 1, research: { Loops: 1, Speed: level } });
  };
  const rate = (g) => g.mainDrone.tickRate() / 400;
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => old(n).research.level('Speed')), [2, 3, 5, 6, 7]);
  for (const n of [1, 2, 3, 4, 5]) assert.ok(rate(old(n)) >= Math.pow(1.5, n) - 0.01, `old level ${n} is not slower`);
  const again = new Game(old(3).config, JSON.parse(JSON.stringify(old(3).toSave())));
  assert.equal(again.research.level('Speed'), 5);
});

test('saves from before the new code order keep every bought card, also without its new parent cards', () => {
  const config = makeGame().config;
  const game = new Game(config, { v: 2, research: { Loops: 1, Speed: 1, Expand: 2, Plant: 1, Carrots: 2, Watering: 1, Sunflowers: 1 }, inventory: { Hay: 500, Wood: 50 } });
  assert.deepEqual(['Plant', 'Carrots', 'Watering', 'Sunflowers'].map((id) => game.research.level(id)), [1, 2, 1, 1]);
  assert.equal(runCode(game, 'herkel();\nif (hasunE()) {\n  havaqel();\n}\ntnkel(Buyser.Badrjan);').error, null, 'what they bought still works');
  assert.deepEqual([game.research.parentsDone('Variables'), game.research.parentsDone('Debug'), game.research.parentsDone('Lists')], [true, false, true]);
  assert.equal(game.research.buy('Variables').ok, true, 'and the cards they skipped can be bought in the new order');
  assert.equal(new Game(config, JSON.parse(JSON.stringify(game.toSave()))).research.level('Carrots'), 2);
});

test('mushroom: needs a side, any habit loses, only random choices win', () => {
  const levels = { Loops: 1, Speed: 3, Expand: 2, Plant: 1, Debug: 1, Operators: 1, Variables: 1, Functions: 1, Utilities: 1, Mushrooms: 1 };
  const play = (choose, n = 200) => {
    const game = makeGame({ items: { Wood: 5000 }, levels, seed: 7 });
    const code = `let n = 0;\nlet i = 0;\nwhile (i < ${n}) {\n  tnkel(Buyser.Sunk);\n  while (!hasunE()) {\n    i = i;\n  }\n  if (${choose}) {\n    if (havaqel(Aj)) {\n      n = n + 1;\n    }\n  } else if (havaqel(Dzax)) {\n    n = n + 1;\n  }\n  i = i + 1;\n}\ntpel(n);`;
    const r = runCode(game, code, { maxSeconds: 5000 });
    assert.equal(r.error, null);
    return { wins: Number(r.out[0]), weird: game.inventory.get('Weird_Substance'), warnings: r.warnings };
  };
  assert.ok(play('true').wins <= 3, 'always the same side');
  assert.ok(play('i % 2 == 0').wins <= 5, 'taking turns');
  assert.ok(play('i % 3 == 0').wins <= 8, 'a longer pattern');
  const random = play('Math.random() < 0.5');
  assert.ok(random.wins > 70 && random.wins < 130, `random choices win about half: ${random.wins}`);
  assert.equal(random.weird, random.wins, 'each found mushroom gives weird substance');
  const noSide = makeGame({ items: { Wood: 100 }, levels });
  noSide.world.tile(0, 0).entity = noSide.world.makeEntity('Mushroom');
  noSide.world.tile(0, 0).entity.progress = 1;
  const r = runCode(noSide, 'tpel(havaqel());');
  assert.deepEqual([r.out, r.warnings, noSide.world.tile(0, 0).entity.type], [['false'], ['mushroomSide'], 'Mushroom']);
});

test('mazes are planted like a plant: no bush, the size follows the farm and the substance', () => {
  const levels = { Loops: 1, Speed: 1, Expand: 4, Plant: 1, Mazes: 1 };
  const game = makeGame({ levels, items: { Weird_Substance: 100 } });
  const size = game.world.width;
  assert.equal(runCode(game, 'tnkel(Buyser.Labirint);').error, null);
  assert.deepEqual([game.world.maze.size, game.inventory.get('Weird_Substance')], [size, 100 - size]);
  const poor = makeGame({ levels, items: { Weird_Substance: 3 } });
  runCode(poor, 'tnkel(Buyser.Labirint);');
  assert.deepEqual([poor.world.maze.size, poor.inventory.get('Weird_Substance')], [3, 0]);
  const none = makeGame({ levels, items: { Weird_Substance: 1 } });
  assert.deepEqual(runCode(none, 'tnkel(Buyser.Labirint);').warnings, ['mazeTooSmall']);
  assert.equal(none.inventory.get('Weird_Substance'), 1);
  const locked = makeGame({ levels: { Loops: 1, Plant: 1 }, items: { Weird_Substance: 50 } });
  assert.deepEqual(runCode(locked, 'tnkel(Buyser.Labirint);').warnings, ['plant_entityLocked']);
});

test('patahakan() is gone: its old users are told about Math.random()', () => {
  const game = makeGame({ levels: { Plant: 1, Debug: 1, Utilities: 1 } });
  const r = runCode(game, 'tpel(patahakan());');
  assert.equal(r.error.code, 'notDefined');
  assert.equal(r.error.params.python, 'Math.random()');
  assert.equal(game.research.node('Utilities').grants.functions.join(), 'Math');
  const out = runCode(makeGame({ levels: { Plant: 1, Debug: 1, Operators: 1, Utilities: 1 } }), 'tpel(Math.random() < 1);');
  assert.deepEqual([out.error, out.out], [null, ['true']]);
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

test('eggplants need soil and a seed', () => {
  const game = makeGame({ items: { Seeds: 2 }, levels: { Loops: 1, Speed: 1, Plant: 1, Carrots: 1 } });
  const r = runCode(game, 'plant(Entities.Carrot);');
  assert.equal(r.error, null);
  assert.ok(r.warnings.includes('plant_wrongGround'));
  const r2 = runCode(game, 'till();\nplant(Entities.Carrot);');
  assert.equal(r2.error, null);
  assert.equal(game.inventory.get('Seeds'), 1);
  assert.equal(game.world.tile(0, 0).entity.type, 'Carrot');
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

test('nvagel(): locked until the Music card; a note lasts its beats, a rest is silent, a wrong length is explained', () => {
  const before = makeGame({ levels: { Debug: 1 } });
  assert.equal(runCode(before, 'nvagel(Notaner.Do, 1);').error.code, 'lockedFunction');
  assert.equal(runCode(before, 'tpel(Notaner.Do);').error.params.canonical, 'Notes'); // the word list is locked too
  const game = makeGame({ levels: { Music: 1 } });
  const heard = [];
  game.events.on('music', (e) => heard.push([e.freq, e.seconds]));
  const r = runCode(game, 'nvagel(Notaner.Do, 2);\nnvagel(Notaner.Dadar);\nnvagel(Notaner.Lya, 0.5);', { step: 0.01 });
  assert.equal(r.error, null);
  assert.deepEqual(heard, [[261.63, 1], [440, 0.25]]);
  assert.ok(Math.abs(r.seconds - 1.75) < 0.05, `${r.seconds} s`);
  assert.equal(runCode(game, 'nvagel(Notaner.Mi, 9);').error.code, 'noteLength');
  assert.equal(runCode(game, 'nvagel(1);').error.code, 'badArg');
});
