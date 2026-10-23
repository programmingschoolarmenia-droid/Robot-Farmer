// Whitelisted methods of strings, arrays, maps, sets and numbers.
// Each method: { fn(interp, target, args, node), gen?: true, cost?: number | (target,args)=>number }
// Generator methods (map, filter, sort, …) may call player functions.
import { GameError } from './errors.js';
import { formatValue, makeObject, Namespace, BuiltinFunction, isUserObject } from './values.js';

const MAX_LIST = 100000;

function checkLength(n, node) {
  if (n > MAX_LIST) throw new GameError('listTooLong', { max: MAX_LIST }, node);
}

function toInt(v, dflt) {
  if (v === undefined) return dflt;
  const n = Math.trunc(Number(v));
  return Number.isNaN(n) ? 0 : n;
}

// JS default sort order (compares as strings), kept faithful to real JavaScript.
function defaultCompare(a, b) {
  if (a === undefined) return b === undefined ? 0 : 1;
  if (b === undefined) return -1;
  const sa = formatValue(a, false);
  const sb = formatValue(b, false);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

// Merge sort that can call a player comparator (generator).
function* mergeSort(interp, arr, cmp, node) {
  if (arr.length < 2) return arr;
  const mid = arr.length >> 1;
  const left = yield* mergeSort(interp, arr.slice(0, mid), cmp, node);
  const right = yield* mergeSort(interp, arr.slice(mid), cmp, node);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    let r;
    if (cmp) {
      r = Number(yield* interp.callFunction(cmp, [left[i], right[j]], node));
    } else {
      interp.ticks += 1;
      r = defaultCompare(left[i], right[j]);
    }
    if (r > 0) out.push(right[j++]);
    else out.push(left[i++]);
  }
  while (i < left.length) out.push(left[i++]);
  while (j < right.length) out.push(right[j++]);
  return out;
}

function needFn(interp, fn, name, node) {
  if (!interp.isCallable(fn)) throw new GameError('callbackNeeded', { method: name }, node);
}

export const ARRAY_METHODS = {
  push: {
    fn(I, a, args, node) {
      checkLength(a.length + args.length, node);
      a.push(...args);
      return a.length;
    },
  },
  pop: { fn: (I, a) => a.pop() },
  shift: { fn: (I, a) => a.shift(), cost: (a) => 1 + a.length },
  unshift: {
    fn(I, a, args, node) {
      checkLength(a.length + args.length, node);
      return a.unshift(...args);
    },
    cost: (a) => 1 + a.length,
  },
  includes: { fn: (I, a, [v]) => a.includes(v), cost: (a) => 1 + a.length },
  indexOf: { fn: (I, a, [v]) => a.indexOf(v), cost: (a) => 1 + a.length },
  lastIndexOf: { fn: (I, a, [v]) => a.lastIndexOf(v), cost: (a) => 1 + a.length },
  slice: { fn: (I, a, [s, e]) => a.slice(toInt(s, 0), toInt(e, a.length)), cost: (a) => 1 + a.length },
  splice: {
    fn(I, a, args) {
      const [s, c, ...items] = args;
      return a.splice(toInt(s, 0), c === undefined ? a.length : toInt(c, 0), ...items);
    },
    cost: (a) => 1 + a.length,
  },
  concat: {
    fn(I, a, args, node) {
      const out = a.concat(...args.map((x) => (Array.isArray(x) ? x : [x])));
      checkLength(out.length, node);
      return out;
    },
    cost: (a) => 1 + a.length,
  },
  join: {
    fn: (I, a, [sep]) => a.map((x) => (x === null || x === undefined ? '' : formatValue(x))).join(sep === undefined ? ',' : String(sep)),
    cost: (a) => 1 + a.length,
  },
  reverse: { fn: (I, a) => a.reverse(), cost: (a) => 1 + a.length },
  fill: {
    fn: (I, a, [v, s, e]) => a.fill(v, toInt(s, 0), toInt(e, a.length)),
    cost: (a) => 1 + a.length,
  },
  at: { fn: (I, a, [i]) => a.at(toInt(i, 0)) },
  sort: {
    gen: true,
    *fn(I, a, [cmp], node) {
      if (cmp !== undefined) needFn(I, cmp, 'sort', node);
      const sorted = yield* mergeSort(I, a.slice(), cmp, node);
      for (let i = 0; i < sorted.length; i++) a[i] = sorted[i];
      return a;
    },
  },
  map: {
    gen: true,
    *fn(I, a, [cb], node) {
      needFn(I, cb, 'map', node);
      const out = [];
      for (let i = 0; i < a.length; i++) out.push(yield* I.callFunction(cb, [a[i], i, a], node));
      return out;
    },
  },
  filter: {
    gen: true,
    *fn(I, a, [cb], node) {
      needFn(I, cb, 'filter', node);
      const out = [];
      for (let i = 0; i < a.length; i++) {
        if (yield* I.callFunction(cb, [a[i], i, a], node)) out.push(a[i]);
      }
      return out;
    },
  },
  forEach: {
    gen: true,
    *fn(I, a, [cb], node) {
      needFn(I, cb, 'forEach', node);
      for (let i = 0; i < a.length; i++) yield* I.callFunction(cb, [a[i], i, a], node);
      return undefined;
    },
  },
  find: {
    gen: true,
    *fn(I, a, [cb], node) {
      needFn(I, cb, 'find', node);
      for (let i = 0; i < a.length; i++) {
        if (yield* I.callFunction(cb, [a[i], i, a], node)) return a[i];
      }
      return undefined;
    },
  },
  findIndex: {
    gen: true,
    *fn(I, a, [cb], node) {
      needFn(I, cb, 'findIndex', node);
      for (let i = 0; i < a.length; i++) {
        if (yield* I.callFunction(cb, [a[i], i, a], node)) return i;
      }
      return -1;
    },
  },
  some: {
    gen: true,
    *fn(I, a, [cb], node) {
      needFn(I, cb, 'some', node);
      for (let i = 0; i < a.length; i++) {
        if (yield* I.callFunction(cb, [a[i], i, a], node)) return true;
      }
      return false;
    },
  },
  every: {
    gen: true,
    *fn(I, a, [cb], node) {
      needFn(I, cb, 'every', node);
      for (let i = 0; i < a.length; i++) {
        if (!(yield* I.callFunction(cb, [a[i], i, a], node))) return false;
      }
      return true;
    },
  },
  reduce: {
    gen: true,
    *fn(I, a, args, node) {
      const [cb] = args;
      needFn(I, cb, 'reduce', node);
      let i = 0;
      let acc;
      if (args.length > 1) acc = args[1];
      else {
        if (!a.length) throw new GameError('reduceEmpty', {}, node);
        acc = a[0];
        i = 1;
      }
      for (; i < a.length; i++) acc = yield* I.callFunction(cb, [acc, a[i], i, a], node);
      return acc;
    },
  },
};

export const STRING_METHODS = {
  toUpperCase: { fn: (I, s) => s.toUpperCase() },
  toLowerCase: { fn: (I, s) => s.toLowerCase() },
  includes: { fn: (I, s, [x]) => s.includes(String(x)) },
  indexOf: { fn: (I, s, [x]) => s.indexOf(String(x)) },
  startsWith: { fn: (I, s, [x]) => s.startsWith(String(x)) },
  endsWith: { fn: (I, s, [x]) => s.endsWith(String(x)) },
  slice: { fn: (I, s, [a, b]) => s.slice(toInt(a, 0), toInt(b, s.length)) },
  substring: { fn: (I, s, [a, b]) => s.substring(toInt(a, 0), toInt(b, s.length)) },
  split: { fn: (I, s, [sep]) => (sep === undefined ? [s] : s.split(String(sep))) },
  trim: { fn: (I, s) => s.trim() },
  charAt: { fn: (I, s, [i]) => s.charAt(toInt(i, 0)) },
  at: { fn: (I, s, [i]) => s.at(toInt(i, 0)) },
  repeat: {
    fn(I, s, [n], node) {
      const c = Math.max(0, toInt(n, 0));
      checkLength(s.length * c, node);
      return s.repeat(c);
    },
  },
  padStart: { fn: (I, s, [n, p]) => s.padStart(Math.min(toInt(n, 0), MAX_LIST), p === undefined ? ' ' : String(p)) },
  padEnd: { fn: (I, s, [n, p]) => s.padEnd(Math.min(toInt(n, 0), MAX_LIST), p === undefined ? ' ' : String(p)) },
  replace: { fn: (I, s, [a, b]) => s.replace(String(a), String(b)) },
  replaceAll: { fn: (I, s, [a, b]) => s.split(String(a)).join(String(b)) },
  concat: { fn: (I, s, args) => s + args.map((x) => formatValue(x)).join('') },
};

export const NUMBER_METHODS = {
  toFixed: { fn: (I, n, [d]) => n.toFixed(Math.max(0, Math.min(20, toInt(d, 0)))) },
  toString: { fn: (I, n) => String(n) },
};

export const MAP_METHODS = {
  get: { fn: (I, m, [k]) => m.get(k) },
  set: {
    fn(I, m, [k, v], node) {
      if (!m.has(k)) checkLength(m.size + 1, node);
      m.set(k, v);
      return m;
    },
  },
  has: { fn: (I, m, [k]) => m.has(k) },
  delete: { fn: (I, m, [k]) => m.delete(k) },
  clear: { fn: (I, m) => m.clear() },
  keys: { fn: (I, m) => [...m.keys()], cost: (m) => 1 + m.size },
  values: { fn: (I, m) => [...m.values()], cost: (m) => 1 + m.size },
  entries: { fn: (I, m) => [...m.entries()].map(([k, v]) => [k, v]), cost: (m) => 1 + m.size },
  forEach: {
    gen: true,
    *fn(I, m, [cb], node) {
      needFn(I, cb, 'forEach', node);
      for (const [k, v] of [...m]) yield* I.callFunction(cb, [v, k, m], node);
      return undefined;
    },
  },
};

export const SET_METHODS = {
  add: {
    fn(I, s, [v], node) {
      if (!s.has(v)) checkLength(s.size + 1, node);
      s.add(v);
      return s;
    },
  },
  has: { fn: (I, s, [v]) => s.has(v) },
  delete: { fn: (I, s, [v]) => s.delete(v) },
  clear: { fn: (I, s) => s.clear() },
  values: { fn: (I, s) => [...s], cost: (s) => 1 + s.size },
  forEach: {
    gen: true,
    *fn(I, s, [cb], node) {
      needFn(I, cb, 'forEach', node);
      for (const v of [...s]) yield* I.callFunction(cb, [v, v, s], node);
      return undefined;
    },
  },
};

// Library namespaces available to player code (each still gated by research).
export function createLibraries() {
  const fn = (name, impl) => new BuiltinFunction({ name, impl });
  const num = (v) => {
    const n = Number(v);
    return n;
  };

  const MathNs = new Namespace('Math', 'lib');
  MathNs.set('PI', Math.PI);
  for (const name of ['floor', 'ceil', 'round', 'abs', 'sqrt', 'sign', 'trunc', 'log', 'exp', 'sin', 'cos', 'tan', 'atan2', 'hypot', 'cbrt']) {
    MathNs.set(name, fn(`Math.${name}`, (I, args) => Math[name](...args.map(num))));
  }
  MathNs.set('pow', fn('Math.pow', (I, [a, b]) => Math.pow(num(a), num(b))));
  MathNs.set('min', fn('Math.min', (I, args) => Math.min(...flatNums(args))));
  MathNs.set('max', fn('Math.max', (I, args) => Math.max(...flatNums(args))));
  MathNs.set('random', fn('Math.random', (I) => I.random()));

  const ObjectNs = new Namespace('Object', 'lib');
  const needObj = (v, name, node) => {
    if (!isUserObject(v)) throw new GameError('badArg', { fn: `Object.${name}`, index: 1, expected: 'object' }, node);
  };
  ObjectNs.set('keys', fn('Object.keys', (I, [o], node) => (needObj(o, 'keys', node), Object.keys(o))));
  ObjectNs.set('values', fn('Object.values', (I, [o], node) => (needObj(o, 'values', node), Object.values(o))));
  ObjectNs.set(
    'entries',
    fn('Object.entries', (I, [o], node) => (needObj(o, 'entries', node), Object.entries(o).map(([k, v]) => [k, v]))),
  );

  const ArrayNs = new Namespace('Array', 'lib');
  ArrayNs.set('isArray', fn('Array.isArray', (I, [v]) => Array.isArray(v)));

  const NumberNs = new Namespace('Number', 'lib');
  NumberNs.set('isInteger', fn('Number.isInteger', (I, [v]) => Number.isInteger(v)));

  return {
    Math: MathNs,
    Object: ObjectNs,
    Array: ArrayNs,
    Number: NumberNs,
    parseInt: fn('parseInt', (I, [s, base]) => parseInt(formatValue(s), base === undefined ? 10 : Number(base))),
    parseFloat: fn('parseFloat', (I, [s]) => parseFloat(formatValue(s))),
    String: fn('String', (I, [v]) => formatValue(v)),
    isNaN: fn('isNaN', (I, [v]) => Number.isNaN(Number(v))),
    newObject: makeObject,
  };
}

function flatNums(args) {
  // Math.max([1,2,3]) is a common beginner mistake; accept a single array too.
  if (args.length === 1 && Array.isArray(args[0])) return args[0].map(Number);
  return args.map(Number);
}
