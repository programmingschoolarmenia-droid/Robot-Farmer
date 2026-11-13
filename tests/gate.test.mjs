import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, runCode } from './helpers.mjs';

test('fresh game: only harvest() and doAFlip() are allowed', () => {
  const game = makeGame();
  assert.equal(runCode(game, 'harvest();\ndoAFlip();').error, null);
  const loop = runCode(game, 'while (true) { harvest(); }');
  assert.equal(loop.error.code, 'lockedSyntax');
  assert.equal(loop.error.params.feature, 'loops');
  const mv = runCode(game, 'move(East);');
  assert.equal(mv.error.code, 'lockedFunction');
  assert.equal(mv.error.params.name, 'move');
  const v = runCode(game, 'let a = 1;');
  assert.equal(v.error.params.feature, 'variables');
});

test('negative number literals do not need operators', () => {
  const game = makeGame({ levels: { Loops: 1, Speed: 1, Plant: 1, Debug: 1 } });
  assert.equal(runCode(game, 'print(-5);').error, null);
  assert.equal(runCode(game, 'print(1 + 1);').error.params.feature, 'operators');
});

test('buying research unlocks syntax and functions', () => {
  const game = makeGame({ items: { Hay: 100 } });
  assert.equal(game.research.buy('Loops').ok, true);
  assert.equal(runCode(game, 'let n = 0;').error.params.feature, 'variables');
  const r = runCode(game, 'while (true) { harvest(); }', { maxSeconds: 2 });
  assert.equal(r.error, null);
});

test('aliases of locked functions are also locked', () => {
  const game = makeGame();
  const r = runCode(game, 'gnal(East);');
  assert.equal(r.error.code, 'lockedFunction');
  assert.equal(r.error.params.name, 'gnal');
  assert.equal(r.error.params.canonical, 'move');
});

test('the code order: while comes first, for waits for Variables; console.log and alert come with Debug', () => {
  const loops = makeGame({ levels: { Loops: 1 } });
  assert.equal(runCode(loops, 'while (true) {\n  havaqel();\n}', { maxSeconds: 1 }).error, null);
  for (const code of ['for (;;) {\n  havaqel();\n}', 'for (let i = 0; i < 2; i++) {\n  havaqel();\n}']) {
    const e = runCode(loops, code, { maxSeconds: 1 }).error;
    assert.deepEqual([e.code, e.params.feature], ['lockedSyntax', 'variables'], code);
  }
  const counting = makeGame({ levels: { Loops: 1, Variables: 1, Operators: 1 } });
  assert.equal(runCode(counting, 'for (let i = 0; i < 2; i++) {\n  havaqel();\n}').error, null);
  for (const code of ['console.log(1);', 'alert(1);']) assert.equal(runCode(counting, code).error.code, 'lockedFunction', code);
  const debug = makeGame({ levels: { Debug: 1 } });
  const r = runCode(debug, 'console.log("a", 2);\ntpel("b");\nalert("c", 3);\nhavaqel();');
  assert.deepEqual([r.error, r.out, r.finished], [null, ['a 2', 'b', 'c 3'], true], 'with no window to show, alert only prints');
});

test('alert tells the screen, and the program can be stopped right after it', () => {
  const game = makeGame({ levels: { Loops: 1, Debug: 1 } });
  const said = [];
  game.events.on('alert', (e) => {
    said.push(e.text);
    game.runner.pause(); // what the game screen does while its window is open
  });
  game.scripts = [{ name: 'main', code: 'alert("Barev");\nwhile (true) {\n  havaqel();\n}' }];
  game.runner.start('main');
  for (let i = 0; i < 20; i++) game.update(0.1);
  assert.deepEqual([said, game.runner.state, game.mainDrone.actions], [['Barev'], 'paused', 0], 'nothing runs behind the window');
  game.runner.resume();
  for (let i = 0; i < 20; i++) game.update(0.1);
  assert.ok(game.mainDrone.actions > 0, 'it goes on when the window is closed');
});
