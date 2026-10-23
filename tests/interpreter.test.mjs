import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, runCode, loadConfig } from './helpers.mjs';
import { createI18n } from '../js/core/i18n.js';
import { describeError } from '../js/ui/errorText.js';
import { validateConfig } from '../js/core/config.js';

function run(code, opts = {}) {
  const game = makeGame({ unlockAll: true, ...opts });
  return runCode(game, code, opts);
}

function outOf(code, opts) {
  const r = run(code, opts);
  if (r.error) throw new Error(`error ${r.error.code} ${JSON.stringify(r.error.params)} at ${JSON.stringify(r.error.loc)}`);
  return r.out;
}

test('arithmetic, strings and printing', () => {
  assert.deepEqual(outOf('print(1 + 2 * 3); print("a" + 1); print(7 % 3, 2 ** 3); print(10 / 4);'), ['7', 'a1', '1 8', '2.5']);
  assert.deepEqual(outOf('print(`x=${1 + 1}`);'), ['x=2']);
  assert.deepEqual(outOf('print(0.1 + 0.2);'), ['0.3']);
});

test('variables, const and scopes', () => {
  assert.deepEqual(outOf('let a = 1; { let a = 2; print(a); } print(a);'), ['2', '1']);
  const r = run('const x = 1; x = 2;');
  assert.equal(r.error.code, 'assignConst');
  const r2 = run('y = 5;');
  assert.equal(r2.error.code, 'assignUndeclared');
});

test('loops: while, for, for-of, for-in, do-while, break, continue', () => {
  assert.deepEqual(outOf('let i = 0; while (i < 3) { print(i); i++; }'), ['0', '1', '2']);
  assert.deepEqual(outOf('for (let i = 0; i < 5; i++) { if (i == 1) continue; if (i == 4) break; print(i); }'), ['0', '2', '3']);
  assert.deepEqual(outOf('for (const x of [3, 4]) print(x);'), ['3', '4']);
  assert.deepEqual(outOf('for (const k in {a: 1, b: 2}) print(k);'), ['a', 'b']);
  assert.deepEqual(outOf('let n = 0; do { n++; } while (n < 3); print(n);'), ['3']);
});

test('for-let creates a fresh binding per iteration', () => {
  assert.deepEqual(outOf('const fs = []; for (let i = 0; i < 3; i++) { fs.push(() => i); } print(fs.map((f) => f()));'), ['[0, 1, 2]']);
});

test('functions, closures, recursion, defaults, rest', () => {
  assert.deepEqual(outOf('function f(a, b = 2) { return a + b; } print(f(1), f(1, 5));'), ['3 6']);
  assert.deepEqual(
    outOf('function counter() { let c = 0; return () => { c++; return c; }; } const k = counter(); k(); print(k());'),
    ['2'],
  );
  assert.deepEqual(outOf('function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); } print(fact(10));'), ['3628800']);
  assert.deepEqual(outOf('function s(...xs) { return xs.length; } print(s(1, 2, 3));'), ['3']);
  assert.deepEqual(outOf('print(later()); function later() { return "hoisted"; }'), ['hoisted']);
});

test('recursion limit gives a friendly error', () => {
  const r = run('function f() { return f(); } f();');
  assert.equal(r.error.code, 'recursion');
});

test('arrays and methods (including callbacks)', () => {
  assert.deepEqual(outOf('const a = [3, 1, 2]; a.push(5); print(a.length, a[0], a.includes(2));'), ['4 3 true']);
  assert.deepEqual(outOf('print([1, 2, 3].map((x) => x * 2).filter((x) => x > 2));'), ['[4, 6]']);
  assert.deepEqual(outOf('print([3, 1, 2].sort((a, b) => a - b), [10, 9, 1].sort());'), ['[1, 2, 3] [1, 10, 9]']);
  assert.deepEqual(outOf('print([1, 2, 3].reduce((s, x) => s + x, 0));'), ['6']);
  assert.deepEqual(outOf('const [a, , b = 7, ...rest] = [1, 2, undefined, 4, 5]; print(a, b, rest);'), ['1 7 [4, 5]']);
});

test('objects, Map, Set, destructuring, optional chaining', () => {
  assert.deepEqual(outOf('const o = {a: 1, b: {c: 2}}; o.d = 3; print(o.a + o.b.c + o.d, o.x);'), ['6 undefined']);
  assert.deepEqual(outOf('const {a, b: {c}} = {a: 1, b: {c: 2}}; print(a, c);'), ['1 2']);
  assert.deepEqual(outOf('const m = new Map(); m.set("k", 5); print(m.get("k"), m.size, m.has("z"));'), ['5 1 false']);
  assert.deepEqual(outOf('const s = new Set([1, 1, 2]); print(s.size);'), ['2']);
  assert.deepEqual(outOf('const o = null; print(o?.x, o?.x.y);'), ['undefined undefined']);
  assert.deepEqual(outOf('print(Object.keys({x: 1, y: 2}));'), ['["x", "y"]']);
});

test('switch and conditional expressions', () => {
  assert.deepEqual(outOf('for (const v of [1, 2, 3]) { switch (v) { case 1: print("one"); break; case 2: print("two"); default: print("d"); } }'), [
    'one',
    'two',
    'd',
    'd',
  ]);
});

test('runtime errors are GameErrors with locations', () => {
  const r = run('let x = null;\nprint(x.y);');
  assert.equal(r.error.code, 'nullMember');
  assert.equal(r.error.loc.line, 2);
  const r2 = run('harvst();');
  assert.equal(r2.error.code, 'notDefined');
  assert.deepEqual(r2.error.params.suggestions, ['havaqel']);
  const r3 = run('let n = 5; n();');
  assert.equal(r3.error.code, 'notFunction');
});

test('syntax errors are explained', () => {
  assert.equal(run('print("hi);').error.code, 'syntaxString');
  assert.equal(run('while true {\n harvest();\n}').error.code, 'syntaxConditionParens');
  assert.equal(run('def f():\n  harvest()').error.code, 'syntaxPythonDef');
  assert.equal(run('if (true) {\n harvest();\n').error.code, 'syntaxUnclosed');
  assert.equal(run('print(«x»);').error.code, 'syntaxQuotes');
});

test('python words give hints', () => {
  const r = run('if (True) { harvest(); }');
  assert.equal(r.error.code, 'notDefined');
  assert.equal(r.error.params.python, 'true');
});

test('unsupported features are rejected', () => {
  assert.equal(run('class A {}').error.code, 'unsupported');
  assert.equal(run('try { harvest(); } catch (e) {}').error.code, 'unsupported');
});

test('infinite loop without actions keeps game time moving (no hang)', () => {
  const game = makeGame({ unlockAll: true });
  const r = runCode(game, 'while (true) {}', { maxSeconds: 5 });
  assert.equal(r.error, null);
  assert.ok(r.seconds >= 5, `ran ${r.seconds}s`);
});

test('import / export between scripts', () => {
  const game = makeGame({ unlockAll: true });
  const r = runCode(game, 'import { twice, NAME } from "utils";\nprint(twice(4), NAME);', {
    scripts: [{ name: 'utils', code: 'export function twice(x) { return x * 2; }\nexport const NAME = "u";' }],
  });
  assert.equal(r.error, null);
  assert.deepEqual(r.out, ['8 u']);
  const r2 = runCode(game, 'import { nope } from "utils";', {
    scripts: [{ name: 'utils', code: 'export const a = 1;' }],
  });
  assert.equal(r2.error.code, 'importNoExport');
});

test('Armenian aliases work for functions, directions and enums', () => {
  const game = makeGame({ unlockAll: true });
  const r = runCode(game, 'tpel(Bujser.Gazar, Իրեր.Փայտ, Hyusis);\nհավաքել();');
  assert.equal(r.error, null);
  assert.deepEqual(r.out, ['Bujser.Gazar Irer.Payt Verev']);
});

test('Armenian names are shown everywhere, English names still work hidden', () => {
  assert.deepEqual(outOf('print(Entities.Carrot, East, harvest, Math.floor(2.5));\nharvest();'), ['Bujser.Gazar Aj havaqel() 2']);
  assert.match(outOf('tpel(arzheq(Hetazotutyunner.Aragutyun, 0), arzheq(Bujser.Gazar));')[0], /^\{ ChorXot: 20 \} \{ ChorXot: \d+, Payt: \d+ \}$/);
  assert.deepEqual(outOf('tpel(texapoxel == poxatexel, Bujser.Ganc == Bujser.Gandz);'), ['true true']);
  const game = makeGame({ unlockAll: true });
  const names = game.api.knownNames();
  for (const n of ['havaqel', 'tnkel', 'Bujser', 'Verev', 'Math']) assert.ok(names.includes(n), n);
  for (const n of ['harvest', 'Entities', 'North', 'հավաքել', 'Hyusis']) assert.ok(!names.includes(n), n);
  assert.ok(game.api.enums.Entities.displayNames().includes('Xot'));
  assert.ok(!game.api.enums.Entities.displayNames().includes('Grass'));
  assert.deepEqual(game.api.suggest('havakel'), ['havaqel']);
  assert.equal(run('Xot;').error.params.enumHint[0], 'Bujser.Xot');
  assert.deepEqual(run('Bujser.Gazr;').error.params.suggestions, ['Gazar']);
});

test('error messages name game functions in Armenian', () => {
  const cfg = loadConfig();
  const i18n = createI18n(cfg.texts, cfg.research.nodes);
  const game = makeGame();
  const locked = runCode(game, 'plant(Entities.Bush);').error;
  assert.equal(locked.code, 'lockedFunction');
  assert.match(describeError(locked, i18n, game).message, /tnkel\(\)/);
  const bad = run('tnkel(5);').error;
  assert.equal(bad.code, 'badArg');
  assert.match(describeError(bad, i18n, game).message, /^tnkel\(\)/);
});

test('aliases.json validation catches broken and clashing names', () => {
  const cfg = loadConfig();
  cfg.aliases.functions.plant = ['havaqel'];
  cfg.aliases.functions.nope = ['x'];
  cfg.aliases.members.Items.Hay = ['Wood'];
  cfg.aliases.constants.North = 'Verev';
  const paths = validateConfig(cfg).map((e) => `${e.file}:${e.path}`);
  for (const p of ['aliases.json:functions.plant', 'aliases.json:functions.nope', 'aliases.json:members.Items.Hay', 'aliases.json:constants.North']) {
    assert.ok(paths.includes(p), `${p}\n${paths.join('\n')}`);
  }
});
