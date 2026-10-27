// "Best coder" leaderboard: how much working code a student wrote, in code words.
// After a run without errors, every statement that really ran becomes a fingerprint: its own
// tokens (nested statements count separately), numbers and texts as L, the student's own names as
// V, plus the kind of statement it is written in. A fingerprint counts once per student, ever, so
// repeating code (tpel(); tpel(); …), changing numbers or renaming variables gives nothing new,
// and repeated chains (1 + 1 + 1 …, [1, 2, 3, …]) collapse to one step. Words are the names,
// keywords, values and operators of the statement (brackets and ; do not count).
import * as acorn from '../../vendor/acorn/acorn.mjs';
import { walk } from './frontend-js.js';
import { Namespace } from './values.js';
import { ARRAY_METHODS, STRING_METHODS, NUMBER_METHODS, MAP_METHODS, SET_METHODS } from './stdlib.js';

const METHODS = new Set(['length', 'size', ...[ARRAY_METHODS, STRING_METHODS, NUMBER_METHODS, MAP_METHODS, SET_METHODS].flatMap(Object.keys)]);
const CONTEXTUAL = new Set(['let', 'of', 'async', 'await', 'from', 'as', 'get', 'set', 'static', 'yield']);
const LITERALS = new Set(['num', 'string', 'regexp', 'template']);
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

const isStatement = (node, key) =>
  (/Statement$/.test(node.type) || /^(Variable|Function|Import)Declaration$/.test(node.type)) &&
  node.type !== 'BlockStatement' &&
  node.type !== 'EmptyStatement' &&
  key !== 'init' && // for (let i = 0; …) belongs to the for
  key !== 'left'; // for (const x of …) too

// [{ hash, words }] for the statements of the parsed modules `asts` that ran in run `runId`
// (the interpreter marks them with node._ran). `api` tells game names from the student's own.
export function codeFingerprints(asts, runId, api) {
  const out = [];
  for (const ast of asts) {
    const tokens = [...acorn.tokenizer(ast._source, { ecmaVersion: 2022, sourceType: 'module' })];
    const firstAt = (pos) => {
      let lo = 0;
      let hi = tokens.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (tokens[mid].start < pos) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    // Each token belongs to the innermost statement around it (parents are visited first).
    const owner = new Array(tokens.length).fill(null);
    const context = new Map([[ast, 'top']]);
    const statements = new Set();
    walk(ast, (node, parent, key) => {
      if (parent) context.set(node, statements.has(parent) || FUNCTIONS.has(parent.type) ? parent.type : context.get(parent));
      if (!isStatement(node, key)) return;
      statements.add(node);
      for (let i = firstAt(node.start); i < tokens.length && tokens[i].end <= node.end; i++) owner[i] = node;
    });
    const own = new Map([...statements].map((s) => [s, []]));
    tokens.forEach((tok, i) => owner[i] && own.get(owner[i]).push(normalize(tokens, i, api)));
    for (const [s, list] of own) {
      const ran = s.type === 'FunctionDeclaration' ? s.body.body.some((b) => b._ran === runId) : s._ran === runId;
      if (!ran) continue;
      const words = collapse(list);
      const count = words.filter((w) => w[1]).length;
      if (count) out.push({ hash: hash(`${context.get(s)}|${words.map((w) => w[0]).join(' ')}`), words: count });
    }
  }
  return out;
}

// [text, isWord] for one token.
function normalize(tokens, i, api) {
  const { type, value } = tokens[i];
  if (type.keyword) return [type.keyword, true];
  if (LITERALS.has(type.label)) return ['L', true];
  if (type.label !== 'name') return [typeof value === 'string' ? value : type.label, !!(type.binop || type.isAssign || type.prefix || type.postfix)];
  const global = (name) => api.globals.get(api.canonicalName(name));
  const prev = tokens[i - 1];
  if (prev && (prev.type.label === '.' || prev.type.label === '?.')) {
    // Bujser.Gazar, Math.floor keep their member; list.push keeps the method; obj.myField → V
    const obj = tokens[i - 2];
    const g = obj && obj.type.label === 'name' && global(obj.value);
    if (g && g.value instanceof Namespace) return [g.value.canonical.get(value) || value, true];
    return [METHODS.has(value) ? value : 'V', true];
  }
  if (CONTEXTUAL.has(value)) return [value, true];
  return [global(value) ? api.canonicalName(value) : 'V', true];
}

// "+ L + L + L" → "+ L", "[ L , L , L ]" → "[ L , L ]"
function collapse(list) {
  for (let n = 1; n <= 4; n++) {
    for (let i = 0; i + 2 * n <= list.length; ) {
      let same = true;
      for (let k = 0; k < n && same; k++) same = list[i + k][0] === list[i + n + k][0];
      if (same) list.splice(i + n, n);
      else i++;
    }
  }
  return list;
}

// FNV-1a, 32 bits, in base 36 (short enough to keep thousands in a save).
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36);
}
