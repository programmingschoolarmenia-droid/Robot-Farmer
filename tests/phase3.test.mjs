import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, runCode, loadConfig } from './helpers.mjs';
import { validateConfig } from '../js/core/config.js';

const ALL = {
  Loops: 1, Speed: 1, Expand: 4, Plant: 1, Carrots: 1, Debug: 1, Operators: 1, Senses: 1, Variables: 1, Functions: 1,
  Lists: 1, Objects: 1, Trees: 1, Pumpkins: 1, Cactus: 1, Hats: 1, Watering: 1, Fertilizer: 1, Mazes: 1, Dinosaurs: 1,
  Polyculture: 1, Megafarm: 2, Utilities: 1,
};

function bushReady(game) {
  const tile = game.world.tile(game.mainDrone.x, game.mainDrone.y);
  tile.entity = game.world.makeEntity('Bush');
  tile.entity.progress = 1;
  return tile;
}

test('weird substance on a bush creates a maze; walls block moves; treasure gives gold', () => {
  const game = makeGame({ levels: ALL, available: true, items: { Weird_Substance: 100 } });
  bushReady(game);
  const r = runCode(game, 'useItem(Items.Weird_Substance, 6);');
  assert.equal(r.error, null);
  const m = game.world.maze;
  assert.ok(m, 'maze exists');
  assert.equal(m.size, 6);
  // Solve with the right-hand rule written by a player.
  const solve = `
let dirs = [North, East, South, West];
let d = 0;
let [tx, ty] = measure();
let steps = 0;
while ((getPosX() != tx || getPosY() != ty) && steps < 2000) {
  let right = (d + 1) % 4;
  if (canMove(dirs[right])) {
    d = right;
  } else if (!canMove(dirs[d])) {
    d = (d + 3) % 4;
    continue;
  }
  move(dirs[d]);
  steps++;
}
harvest();
print(numItems(Items.Gold));
`;
  const r2 = runCode(game, solve, { maxSeconds: 5000 });
  assert.equal(r2.error, null);
  assert.equal(game.inventory.get('Gold'), 36);
  assert.equal(game.world.maze, null);
});

test('maze outer walls block wrapping and moving in from outside', () => {
  const game = makeGame({ levels: ALL, available: true, items: { Weird_Substance: 100 } });
  bushReady(game);
  runCode(game, 'useItem(Items.Weird_Substance, 3);');
  const m = game.world.maze;
  const d = game.mainDrone;
  // put the drone at the maze's west edge and try to go West
  d.x = m.x0;
  d.y = m.y0;
  assert.equal(game.canMove(d, 'West'), false);
  assert.equal(game.canMove(d, 'South'), false);
});

test('dinosaur eats apples, grows, and pays bones when the hat comes off', () => {
  const game = makeGame({ levels: ALL, available: true, items: { Cactus: 1000 } });
  const r = runCode(game, 'changeHat(Hats.Dinosaur_Hat);');
  assert.equal(r.error, null);
  assert.ok(game.dino && game.dino.apple);
  // chase 3 apples with a simple greedy program
  const chase = `
for (let n = 0; n < 3; n++) {
  let [ax, ay] = measure();
  while (getPosX() < ax && move(East)) {}
  while (getPosX() > ax && move(West)) {}
  while (getPosY() < ay && move(North)) {}
  while (getPosY() > ay && move(South)) {}
}
changeHat(Hats.Straw_Hat);
`;
  const r2 = runCode(game, chase, { maxSeconds: 2000 });
  assert.equal(r2.error, null);
  assert.ok(game.inventory.get('Bone') >= 4, `bones ${game.inventory.get('Bone')}`);
  assert.equal(game.dino, null);
});

test('polyculture companion multiplies the yield', () => {
  const game = makeGame({ levels: ALL, available: true });
  const w = game.world;
  const a = w.tile(1, 1);
  a.entity = w.makeEntity('Bush');
  a.entity.progress = 1;
  const c = w.companionOf(a);
  assert.ok(c);
  const comp = w.tileNoWrap(c.x, c.y);
  comp.ground = 'Soil';
  comp.entity = w.makeEntity(c.type);
  const r = w.harvest(a, game.time);
  assert.equal(r.items.Wood, 5 * 2); // Trees level 1 doubles bush wood; polyculture x5
});

test('spawnDrone runs code on extra drones and waitFor returns the result', () => {
  const game = makeGame({ levels: ALL, available: true });
  const code = `
function work(n) {
  move(East);
  return n * 2;
}
let d1 = spawnDrone(work, 5);
let d2 = spawnDrone(work, 7);
print(maxDrones(), d2 == null);
print(waitFor(d1));
`;
  const r = runCode(game, code);
  assert.equal(r.error, null);
  assert.deepEqual(r.out, ['4 false', '10']);
});

test('Bridgy teaches instead of giving answers: no insert-code buttons, no code lines in hints, valid quizzes', () => {
  const { bridgy } = loadConfig();
  for (const [id, pages] of Object.entries(bridgy.lessons)) for (const p of pages) assert.equal(p.try, undefined, `lessons.${id}`);
  for (const q of bridgy.quests) {
    for (const hint of q.hints || []) {
      for (const line of hint.split('\n')) assert.ok(!/[;{}]\s*$/.test(line.trim()), `${q.id}: «${line}»`);
    }
  }
  const quizzes = Object.values(bridgy.lessons).flat().filter((p) => p.quiz);
  assert.ok(quizzes.length >= 9);
  const cfg = loadConfig();
  cfg.bridgy.lessons.Loops.at(-1).quiz.correct = 7;
  assert.ok(validateConfig(cfg).some((e) => e.path === `lessons.Loops[${cfg.bridgy.lessons.Loops.length - 1}].quiz`));
});

test("Bridgy's book: every game command is documented under its Armenian name; mistakes are reported", () => {
  const game = makeGame();
  const { guide } = loadConfig();
  for (const [canon, label] of game.api.labels) {
    if (game.api.globals.get(canon).kind !== 'function') continue;
    assert.ok(guide.commands[canon], `no guide entry for ${canon}`);
    assert.ok(guide.commands[canon].sig.startsWith(`${label}(`), `${canon}: ${guide.commands[canon].sig}`);
  }
  const cfg = loadConfig();
  cfg.guide.commands.nope = { sig: 'x()', doc: 'y' };
  cfg.guide.js[0].needs = ['loopz'];
  cfg.guide.plants[0].entity = 'Banana';
  const paths = validateConfig(cfg).map((e) => `${e.file}:${e.path}`);
  for (const p of ['guide.json:commands.nope', 'guide.json:js[0].needs', 'guide.json:plants[0]']) assert.ok(paths.includes(p), `${p}\n${paths.join('\n')}`);
});
