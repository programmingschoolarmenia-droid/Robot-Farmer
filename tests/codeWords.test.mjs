import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, runCode } from './helpers.mjs';

// Code words that running `code` to the end adds to the player's total.
function words(game, code) {
  const before = game.stats.codeWords;
  runCode(game, code, { maxSeconds: 60 });
  return game.stats.codeWords - before;
}

test('code words: repeats, other numbers, other names and long chains count once', () => {
  const game = makeGame({ unlockAll: true });
  assert.equal(words(game, 'tpel(1);\ntpel(2);\ntpel(3); tpel(4);'), 2); // tpel + a value
  assert.equal(words(game, 'tpel(5);'), 0); // the same code in a new run
  assert.equal(words(game, 'print(7);'), 0); // the English name is the same command
  assert.equal(words(game, 'let a = 1;\nlet b = 2;'), 4); // let, a name, =, a value
  assert.equal(words(game, 'tpel(1 + 2 + 3 + 4);'), 4); // tpel, value, +, value
  assert.equal(words(game, 'tpel(1 + 2);'), 0);
  assert.equal(words(game, 'let list = [1, 2, 3, 4, 5];\nlist.push(6);\ntpel(list.length);'), 11);
  assert.equal(words(game, 'gnal(Aj);\nmove(East);\ngnal(Dzax);'), 4); // gnal(Aj) = move(East)
});

test('code words: only code that ran without an error', () => {
  const game = makeGame({ unlockAll: true });
  assert.equal(words(game, 'tpel(1'), 0); // syntax error
  assert.equal(words(game, 'let o = null;\ntpel(o.x);'), 0); // runtime error
  assert.equal(words(game, 'if (false) {\n  havaqel();\n}'), 2); // the body never ran
  assert.equal(words(game, 'havaqel();'), 1);
  // the same command inside a loop is new code, and the loop header counts too
  assert.equal(words(game, 'for (let i = 0; i < 2; i++) {\n  havaqel();\n}'), 11);
  // a function counts once it is called
  assert.equal(words(game, 'function f(x) {\n  return x * 2;\n}'), 0);
  assert.equal(words(game, 'function g(x) {\n  return x * 2;\n}\ntpel(g(3));'), 10);
});

test('code words: a stopped endless loop and drones count; the run end reports them', () => {
  const game = makeGame({ unlockAll: true });
  let end = null;
  game.events.on('runEnd', (e) => (end = e));
  game.scripts = [{ name: 'main', code: 'while (true) {\n  salto();\n}' }];
  game.runner.start('main');
  for (let i = 0; i < 50; i++) game.update(0.1);
  game.runner.stop('user');
  assert.deepEqual(end, { reason: 'user', code: 3, script: 'main' });
  assert.equal(words(game, 'function work() {\n  harvest();\n  doAFlip();\n}\nlet d = spawnDrone(work);\nwaitFor(d);'), 11);
  assert.equal(game.stats.codeWords, 14);
});
