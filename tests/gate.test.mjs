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
