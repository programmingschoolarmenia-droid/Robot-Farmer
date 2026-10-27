// Step-by-step interpreter for the player's JavaScript.
//
// Every statement is executed by a generator. The interpreter `yield`s at statement starts,
// loop iterations and after drone actions; the scheduler resumes it as game time allows.
// `ticks` accumulates the cost of everything executed since the last resume.
//
// Expressions that contain no calls are evaluated by the faster synchronous `evalSync`.
// Each AST node carries `_call = true` when it (or a child) contains a call (see frontend-js).

import { GameError } from './errors.js';
import {
  Closure,
  BuiltinFunction,
  BoundMethod,
  EnumValue,
  Namespace,
  DroneHandle,
  isUserObject,
  isCallable,
  makeObject,
  formatValue,
  typeKey,
} from './values.js';
import { ARRAY_METHODS, STRING_METHODS, NUMBER_METHODS, MAP_METHODS, SET_METHODS } from './stdlib.js';

export const Y = Object.freeze({ STMT: 1, ACTION: 2, LOOP: 3, WAIT: 4 });

const BREAK = Object.freeze({ type: 'break' });
const CONTINUE = Object.freeze({ type: 'continue' });
class ReturnSignal {
  constructor(value) {
    this.type = 'return';
    this.value = value;
  }
}
const CHAIN_SHORT = Object.freeze({ chainShortCircuit: true });

const MAX_STRING = 100000;
const MAX_LIST = 100000;

export const DEFAULT_COSTS = Object.freeze({
  loop: 1,
  if: 1,
  binary: 1,
  index: 1,
  define: 1,
  callValue: 1,
  collection: 1,
  template: 1,
  method: 1,
});

export class Scope {
  constructor(parent, kind) {
    this.parent = parent;
    this.kind = kind; // 'module' | 'function' | 'block'
    this.vars = new Map(); // name -> { value, kind, init }
  }

  declare(name, kind, value, node) {
    const existing = this.vars.get(name);
    if (existing) {
      if (kind === 'var' && existing.kind === 'var') {
        if (value !== undefined) existing.value = value;
        return existing;
      }
      if (kind === 'function' && existing.kind === 'function') {
        existing.value = value;
        return existing;
      }
      throw new GameError('redeclare', { name }, node);
    }
    const b = { value, kind, init: true };
    this.vars.set(name, b);
    return b;
  }

  find(name) {
    let s = this;
    while (s) {
      const b = s.vars.get(name);
      if (b !== undefined) return b;
      s = s.parent;
    }
    return null;
  }

  functionScope() {
    let s = this;
    while (s.parent && s.kind === 'block') s = s.parent;
    return s;
  }
}

function isPrimitive(v) {
  return v === null || (typeof v !== 'object' && typeof v !== 'function');
}

function isIndexKey(key) {
  if (typeof key === 'number') return Number.isInteger(key);
  if (typeof key === 'string' && key !== '' && /^\d+$/.test(key)) return true;
  return false;
}

function propName(key) {
  if (typeof key === 'string') return key;
  if (typeof key === 'number') return String(key);
  return formatValue(key);
}

export class Interpreter {
  // opts: { host, costs, maxCallDepth }
  // host: {
  //   getGlobal(name, node, interp) -> value (throws GameError notDefined / lockedFunction)
  //   loadModule(spec, fromName) -> { name, ast }   (throws importNotFound)
  //   random() -> number in [0,1)
  //   print(text, interp)
  //   warn(code, params, node, interp)
  // }
  constructor(opts) {
    this.host = opts.host;
    this.costs = { ...DEFAULT_COSTS, ...(opts.costs || {}) };
    this.maxCallDepth = opts.maxCallDepth ?? 400;
    this.ticks = 0;
    this.actionPending = false;
    this.currentNode = null;
    this.callDepth = 0;
    this.frames = []; // [{ name, scope }]
    this.modules = new Map(); // name -> { name, scope, exports: Map, state }
    this.drone = null;
    this.game = null;
    this.runId = 0; // stamped on each executed statement (node._ran), see codeWords.js
  }

  // ---------------------------------------------------------------- entry points

  // Runs a module (script tab) to completion as the main program.
  *runModule(name) {
    const mod = yield* this.loadModule(name, null, null);
    return mod;
  }

  // Calls a function value (used by spawnDrone to start a drone on a function).
  *runFunction(fn, args) {
    return yield* this.callFunction(fn, args, null);
  }

  *loadModule(spec, fromName, node) {
    const info = this.host.loadModule(spec, fromName, node);
    const existing = this.modules.get(info.name);
    if (existing) {
      if (existing.state === 'loading') throw new GameError('importCycle', { name: info.name }, node);
      return existing;
    }
    const scope = new Scope(null, 'module');
    const mod = { name: info.name, scope, exports: new Map(), state: 'loading', ast: info.ast };
    this.modules.set(info.name, mod);
    this.frames.push({ name: info.name, scope, module: true });
    const body = info.ast.body;

    // Imports first (like real JS modules).
    for (const stmt of body) {
      if (stmt.type === 'ImportDeclaration') {
        this.currentNode = stmt;
        const dep = yield* this.loadModule(stmt.source.value, info.name, stmt);
        for (const sp of stmt.specifiers) {
          let value;
          if (sp.type === 'ImportNamespaceSpecifier') {
            const ns = new Namespace(stmt.source.value, 'module');
            for (const [k, v] of dep.exports) ns.set(k, v.get());
            value = ns;
          } else {
            const importedName = sp.type === 'ImportDefaultSpecifier' ? 'default' : sp.imported.name;
            const exp = dep.exports.get(importedName);
            if (!exp) throw new GameError('importNoExport', { name: importedName, module: dep.name }, sp);
            value = exp.get();
          }
          scope.declare(sp.local.name, 'import', value, sp);
        }
      }
    }

    const c = yield* this.execStatements(body, scope, mod);
    this.frames.pop();
    mod.state = 'done';
    if (c && c.type === 'return') return mod;
    return mod;
  }

  // ---------------------------------------------------------------- statements

  *execStatements(stmts, scope, mod) {
    // Hoist function declarations so they can be called before their definition.
    for (let i = 0; i < stmts.length; i++) {
      let s = stmts[i];
      if (s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration') s = s.declaration;
      if (s && s.type === 'FunctionDeclaration' && s.id) {
        scope.declare(s.id.name, 'function', new Closure(s, scope), s);
        this.ticks += this.costs.define;
      }
    }
    for (let i = 0; i < stmts.length; i++) {
      const s = stmts[i];
      let c;
      if (mod && (s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration')) {
        c = yield* this.execExport(s, scope, mod);
      } else {
        c = yield* this.exec(s, scope);
      }
      if (c) return c;
    }
    return null;
  }

  *execExport(node, scope, mod) {
    if (node.type === 'ExportDefaultDeclaration') {
      const d = node.declaration;
      if (d.type === 'FunctionDeclaration') {
        if (d.id) {
          const name = d.id.name;
          mod.exports.set('default', { get: () => scope.find(name).value });
        } else {
          const fn = new Closure(d, scope, 'default');
          mod.exports.set('default', { get: () => fn });
        }
        return null;
      }
      this.currentNode = node;
      yield Y.STMT;
      const v = d._call ? yield* this.eval(d, scope) : this.evalSync(d, scope);
      mod.exports.set('default', { get: () => v });
      return null;
    }
    // ExportNamedDeclaration
    if (node.declaration) {
      const d = node.declaration;
      const names = [];
      if (d.type === 'FunctionDeclaration') names.push(d.id.name);
      else if (d.type === 'VariableDeclaration') {
        for (const decl of d.declarations) collectPatternNames(decl.id, names);
      }
      if (d.type !== 'FunctionDeclaration') {
        const c = yield* this.exec(d, scope);
        if (c) return c;
      }
      for (const n of names) mod.exports.set(n, { get: () => scope.find(n).value });
      return null;
    }
    if (node.source) throw new GameError('unsupported', { what: 'export … from' }, node);
    for (const sp of node.specifiers) {
      const local = sp.local.name;
      const exported = sp.exported.name || sp.exported.value;
      if (!scope.find(local)) throw new GameError('notDefined', { name: local, suggestions: [] }, sp);
      mod.exports.set(exported, { get: () => scope.find(local).value });
    }
    return null;
  }

  *execBody(node, scope) {
    if (node.type === 'BlockStatement') {
      return yield* this.execStatements(node.body, new Scope(scope, 'block'), null);
    }
    return yield* this.exec(node, scope);
  }

  *exec(node, scope) {
    node._ran = this.runId;
    switch (node.type) {
      case 'ExpressionStatement': {
        this.currentNode = node;
        this.currentScope = scope;
        yield Y.STMT;
        const e = node.expression;
        if (e._call) yield* this.eval(e, scope);
        else this.evalSync(e, scope);
        return null;
      }

      case 'VariableDeclaration': {
        this.currentNode = node;
        this.currentScope = scope;
        yield Y.STMT;
        yield* this.declareVariables(node, scope);
        return null;
      }

      case 'IfStatement': {
        this.currentNode = node;
        this.currentScope = scope;
        yield Y.STMT;
        this.ticks += this.costs.if;
        const t = node.test;
        const test = t._call ? yield* this.eval(t, scope) : this.evalSync(t, scope);
        if (test) return yield* this.execBody(node.consequent, scope);
        if (node.alternate) return yield* this.execBody(node.alternate, scope);
        return null;
      }

      case 'BlockStatement':
        return yield* this.execStatements(node.body, new Scope(scope, 'block'), null);

      case 'WhileStatement': {
        const t = node.test;
        for (;;) {
          this.currentNode = node;
          this.ticks += this.costs.loop;
          yield Y.LOOP;
          const test = t._call ? yield* this.eval(t, scope) : this.evalSync(t, scope);
          if (!test) break;
          const c = yield* this.execBody(node.body, scope);
          if (c) {
            if (c === BREAK) break;
            if (c === CONTINUE) continue;
            return c;
          }
        }
        return null;
      }

      case 'DoWhileStatement': {
        const t = node.test;
        for (;;) {
          this.currentNode = node;
          this.ticks += this.costs.loop;
          yield Y.LOOP;
          const c = yield* this.execBody(node.body, scope);
          if (c) {
            if (c === BREAK) break;
            if (c !== CONTINUE) return c;
          }
          this.currentNode = node;
          const test = t._call ? yield* this.eval(t, scope) : this.evalSync(t, scope);
          if (!test) break;
        }
        return null;
      }

      case 'ForStatement':
        return yield* this.execFor(node, scope);

      case 'ForOfStatement':
        return yield* this.execForOf(node, scope);

      case 'ForInStatement':
        return yield* this.execForIn(node, scope);

      case 'BreakStatement':
        this.currentNode = node;
        if (node.label) throw new GameError('unsupported', { what: 'label' }, node);
        return BREAK;

      case 'ContinueStatement':
        this.currentNode = node;
        if (node.label) throw new GameError('unsupported', { what: 'label' }, node);
        return CONTINUE;

      case 'ReturnStatement': {
        this.currentNode = node;
        this.currentScope = scope;
        yield Y.STMT;
        const a = node.argument;
        const v = a ? (a._call ? yield* this.eval(a, scope) : this.evalSync(a, scope)) : undefined;
        return new ReturnSignal(v);
      }

      case 'FunctionDeclaration':
        return null; // hoisted in execStatements

      case 'EmptyStatement':
        return null;

      case 'SwitchStatement':
        return yield* this.execSwitch(node, scope);

      case 'ImportDeclaration':
        return null; // handled in loadModule

      case 'ExportNamedDeclaration':
      case 'ExportDefaultDeclaration':
        throw new GameError('exportNotTopLevel', {}, node);

      default:
        throw new GameError('unsupported', { what: node.type }, node);
    }
  }

  *declareVariables(node, scope) {
    const kind = node.kind; // var | let | const
    const target = kind === 'var' ? scope.functionScope() : scope;
    for (const d of node.declarations) {
      let value;
      if (d.init) {
        value = d.init._call ? yield* this.eval(d.init, scope) : this.evalSync(d.init, scope);
        if (d.init.type === 'ArrowFunctionExpression' || d.init.type === 'FunctionExpression') {
          if (value instanceof Closure && !value.name && d.id.type === 'Identifier') value.name = d.id.name;
        }
      } else if (kind === 'const') {
        throw new GameError('constNoValue', { name: d.id.name }, d);
      }
      if (d.id.type === 'Identifier') {
        target.declare(d.id.name, kind, value, d);
      } else {
        yield* this.bindPattern(d.id, value, target, kind);
      }
    }
  }

  *execFor(node, scope) {
    const loopScope = new Scope(scope, 'block');
    let perIteration = null;
    if (node.init) {
      if (node.init.type === 'VariableDeclaration') {
        this.currentNode = node;
        yield* this.declareVariables(node.init, loopScope);
        if (node.init.kind === 'let') perIteration = [...loopScope.vars.keys()];
      } else {
        const i = node.init;
        if (i._call) yield* this.eval(i, loopScope);
        else this.evalSync(i, loopScope);
      }
    }
    let iterScope = loopScope;
    const copyScope = () => {
      if (!perIteration) return loopScope;
      const s = new Scope(scope, 'block');
      for (const name of perIteration) {
        const b = iterScope.vars.get(name);
        s.vars.set(name, { value: b.value, kind: b.kind, init: true });
      }
      return s;
    };
    iterScope = copyScope();
    for (;;) {
      this.currentNode = node;
      this.ticks += this.costs.loop;
      yield Y.LOOP;
      if (node.test) {
        const t = node.test;
        const test = t._call ? yield* this.eval(t, iterScope) : this.evalSync(t, iterScope);
        if (!test) break;
      }
      const c = yield* this.execBody(node.body, iterScope);
      if (c) {
        if (c === BREAK) break;
        if (c !== CONTINUE) return c;
      }
      iterScope = copyScope();
      if (node.update) {
        this.currentNode = node;
        const u = node.update;
        if (u._call) yield* this.eval(u, iterScope);
        else this.evalSync(u, iterScope);
      }
    }
    return null;
  }

  iterableToArray(value, node) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return [...value];
    if (value instanceof Map) return [...value.entries()].map(([k, v]) => [k, v]);
    if (value instanceof Set) return [...value];
    throw new GameError('notIterable', { type: typeKey(value) }, node);
  }

  *bindLoopVar(left, value, scope) {
    if (left.type === 'VariableDeclaration') {
      const d = left.declarations[0];
      const kind = left.kind;
      const target = kind === 'var' ? scope.functionScope() : scope;
      if (d.id.type === 'Identifier') target.declare(d.id.name, kind, value, d);
      else yield* this.bindPattern(d.id, value, target, kind);
    } else if (left.type === 'Identifier') {
      this.setVariable(left.name, value, scope, left);
    } else {
      yield* this.bindPattern(left, value, scope, null);
    }
  }

  *execForOf(node, scope) {
    this.currentNode = node;
    const r = node.right;
    const iterable = r._call ? yield* this.eval(r, scope) : this.evalSync(r, scope);
    const live = Array.isArray(iterable);
    const items = this.iterableToArray(iterable, node.right);
    for (let i = 0; live ? i < iterable.length : i < items.length; i++) {
      this.currentNode = node;
      this.ticks += this.costs.loop;
      yield Y.LOOP;
      const iterScope = new Scope(scope, 'block');
      yield* this.bindLoopVar(node.left, live ? iterable[i] : items[i], iterScope);
      const c = yield* this.execBody(node.body, iterScope);
      if (c) {
        if (c === BREAK) break;
        if (c !== CONTINUE) return c;
      }
    }
    return null;
  }

  *execForIn(node, scope) {
    this.currentNode = node;
    const r = node.right;
    const obj = r._call ? yield* this.eval(r, scope) : this.evalSync(r, scope);
    let keys;
    if (isUserObject(obj)) keys = Object.keys(obj);
    else if (Array.isArray(obj) || typeof obj === 'string') keys = Object.keys([...obj]);
    else if (obj === null || obj === undefined) keys = [];
    else throw new GameError('notIterable', { type: typeKey(obj) }, node.right);
    for (const k of keys) {
      this.currentNode = node;
      this.ticks += this.costs.loop;
      yield Y.LOOP;
      const iterScope = new Scope(scope, 'block');
      yield* this.bindLoopVar(node.left, k, iterScope);
      const c = yield* this.execBody(node.body, iterScope);
      if (c) {
        if (c === BREAK) break;
        if (c !== CONTINUE) return c;
      }
    }
    return null;
  }

  *execSwitch(node, scope) {
    this.currentNode = node;
    yield Y.STMT;
    const d = node.discriminant;
    const value = d._call ? yield* this.eval(d, scope) : this.evalSync(d, scope);
    const switchScope = new Scope(scope, 'block');
    let matched = -1;
    for (let i = 0; i < node.cases.length; i++) {
      const cs = node.cases[i];
      if (!cs.test) continue;
      this.ticks += this.costs.if;
      const t = cs.test._call ? yield* this.eval(cs.test, switchScope) : this.evalSync(cs.test, switchScope);
      if (t === value) {
        matched = i;
        break;
      }
    }
    if (matched < 0) matched = node.cases.findIndex((c) => !c.test);
    if (matched < 0) return null;
    for (let i = matched; i < node.cases.length; i++) {
      const c = yield* this.execStatements(node.cases[i].consequent, switchScope, null);
      if (c) {
        if (c === BREAK) return null;
        return c;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- patterns

  *bindPattern(pattern, value, scope, kind) {
    switch (pattern.type) {
      case 'Identifier':
        if (kind) scope.declare(pattern.name, kind, value, pattern);
        else this.setVariable(pattern.name, value, scope, pattern);
        return;
      case 'MemberExpression': {
        const o = pattern.object._call ? yield* this.eval(pattern.object, scope) : this.evalSync(pattern.object, scope);
        let key;
        if (pattern.computed) {
          const p = pattern.property;
          key = p._call ? yield* this.eval(p, scope) : this.evalSync(p, scope);
        } else key = pattern.property.name;
        this.setMember(o, key, value, pattern);
        return;
      }
      case 'AssignmentPattern': {
        let v = value;
        if (v === undefined) {
          const r = pattern.right;
          v = r._call ? yield* this.eval(r, scope) : this.evalSync(r, scope);
        }
        yield* this.bindPattern(pattern.left, v, scope, kind);
        return;
      }
      case 'ArrayPattern': {
        const items = value === null || value === undefined ? null : this.iterableToArray(value, pattern);
        if (!items) throw new GameError('destructureNull', { value: String(value) }, pattern);
        for (let i = 0; i < pattern.elements.length; i++) {
          const el = pattern.elements[i];
          if (!el) continue;
          if (el.type === 'RestElement') {
            yield* this.bindPattern(el.argument, items.slice(i), scope, kind);
            break;
          }
          yield* this.bindPattern(el, items[i], scope, kind);
        }
        return;
      }
      case 'ObjectPattern': {
        if (value === null || value === undefined) {
          throw new GameError('destructureNull', { value: String(value) }, pattern);
        }
        const used = [];
        for (const prop of pattern.properties) {
          if (prop.type === 'RestElement') {
            const rest = makeObject();
            if (isUserObject(value)) {
              for (const k of Object.keys(value)) if (!used.includes(k)) rest[k] = value[k];
            }
            yield* this.bindPattern(prop.argument, rest, scope, kind);
            continue;
          }
          let key;
          if (prop.computed) {
            key = prop.key._call ? yield* this.eval(prop.key, scope) : this.evalSync(prop.key, scope);
          } else key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
          key = propName(key);
          used.push(key);
          yield* this.bindPattern(prop.value, this.getMember(value, key, prop), scope, kind);
        }
        return;
      }
      case 'RestElement':
        yield* this.bindPattern(pattern.argument, value, scope, kind);
        return;
      default:
        throw new GameError('unsupported', { what: pattern.type }, pattern);
    }
  }

  // ---------------------------------------------------------------- variables

  lookup(name, scope, node) {
    let s = scope;
    while (s) {
      const b = s.vars.get(name);
      if (b !== undefined) return b.value;
      s = s.parent;
    }
    return this.host.getGlobal(name, node, this);
  }

  setVariable(name, value, scope, node) {
    const b = scope.find(name);
    if (!b) {
      if (this.host.hasGlobal && this.host.hasGlobal(name)) throw new GameError('assignBuiltin', { name }, node);
      throw new GameError('assignUndeclared', { name }, node);
    }
    if (b.kind === 'const') throw new GameError('assignConst', { name }, node);
    if (b.kind === 'import') throw new GameError('assignImport', { name }, node);
    b.value = value;
  }

  // ---------------------------------------------------------------- members

  getMember(obj, key, node) {
    if (obj === null || obj === undefined) {
      throw new GameError('nullMember', { prop: propName(key), value: String(obj) }, node);
    }
    const t = typeof obj;
    if (t === 'string') {
      if (key === 'length') return obj.length;
      if (isIndexKey(key)) {
        this.ticks += this.costs.index;
        return obj[Number(key)];
      }
      const m = STRING_METHODS[key];
      if (m) return new BoundMethod(obj, key, m);
      throw this.noMember('string', key, Object.keys(STRING_METHODS).concat(['length']), node);
    }
    if (t === 'number') {
      const m = NUMBER_METHODS[key];
      if (m) return new BoundMethod(obj, key, m);
      throw this.noMember('number', key, Object.keys(NUMBER_METHODS), node);
    }
    if (Array.isArray(obj)) {
      if (key === 'length') return obj.length;
      if (isIndexKey(key)) {
        this.ticks += this.costs.index;
        const i = Number(key);
        if (i >= obj.length && this.host.warn) this.host.warn('indexOutOfRange', { index: i, length: obj.length }, node, this);
        return obj[i];
      }
      if (typeof key === 'number' && this.host.warn) {
        this.host.warn('indexOutOfRange', { index: key, length: obj.length }, node, this);
        return undefined;
      }
      const m = ARRAY_METHODS[key];
      if (m) return new BoundMethod(obj, key, m);
      throw this.noMember('array', key, Object.keys(ARRAY_METHODS).concat(['length']), node);
    }
    if (obj instanceof Namespace) {
      const v = obj.get(propName(key));
      if (v === undefined) throw this.noMember(obj.name, key, obj.displayNames(), node, obj.label);
      return v;
    }
    if (isUserObject(obj)) {
      const k = propName(key);
      return Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : undefined;
    }
    if (obj instanceof Map) {
      if (key === 'size') return obj.size;
      const m = MAP_METHODS[key];
      if (m) return new BoundMethod(obj, key, m);
      throw this.noMember('map', key, Object.keys(MAP_METHODS).concat(['size']), node);
    }
    if (obj instanceof Set) {
      if (key === 'size') return obj.size;
      const m = SET_METHODS[key];
      if (m) return new BoundMethod(obj, key, m);
      throw this.noMember('set', key, Object.keys(SET_METHODS).concat(['size']), node);
    }
    if (obj instanceof EnumValue) {
      if (key === 'name') return obj.name;
    }
    if (obj instanceof DroneHandle) {
      if (key === 'id') return obj.drone.id;
    }
    throw new GameError('noMember', { type: typeKey(obj), prop: propName(key), suggestions: [] }, node);
  }

  noMember(type, key, names, node, owner) {
    const prop = propName(key);
    const suggestions = this.host.suggest ? this.host.suggest(prop, names) : [];
    return new GameError(owner ? 'noNamespaceMember' : 'noMember', { type, owner, prop, suggestions }, node);
  }

  setMember(obj, key, value, node) {
    if (obj === null || obj === undefined) {
      throw new GameError('nullMember', { prop: propName(key), value: String(obj) }, node);
    }
    if (Array.isArray(obj)) {
      if (key === 'length') {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0 || n > MAX_LIST) throw new GameError('badLength', {}, node);
        obj.length = n;
        return;
      }
      if (isIndexKey(key)) {
        const i = Number(key);
        if (i > MAX_LIST) throw new GameError('listTooLong', { max: MAX_LIST }, node);
        this.ticks += this.costs.index;
        obj[i] = value;
        return;
      }
      throw new GameError('cannotSet', { type: 'array', prop: propName(key) }, node);
    }
    if (isUserObject(obj)) {
      const k = propName(key);
      if (!(k in obj) && Object.keys(obj).length >= MAX_LIST) throw new GameError('listTooLong', { max: MAX_LIST }, node);
      obj[k] = value;
      return;
    }
    throw new GameError('cannotSet', { type: typeKey(obj), prop: propName(key) }, node);
  }

  // ---------------------------------------------------------------- operators

  binaryOp(op, l, r, node) {
    switch (op) {
      case '+':
        if (typeof l === 'number' && typeof r === 'number') return l + r;
        if (typeof l === 'string' || typeof r === 'string' || !isPrimitive(l) || !isPrimitive(r)) {
          const s = (isPrimitive(l) ? String(l) : formatValue(l)) + (isPrimitive(r) ? String(r) : formatValue(r));
          if (s.length > MAX_STRING) throw new GameError('stringTooLong', { max: MAX_STRING }, node);
          return s;
        }
        return l + r;
      case '-':
      case '*':
      case '/':
      case '%':
      case '**':
      case '&':
      case '|':
      case '^':
      case '<<':
      case '>>':
      case '>>>':
        if (!isPrimitive(l) || !isPrimitive(r)) throw new GameError('mathOnObject', { op }, node);
        switch (op) {
          case '-':
            return l - r;
          case '*':
            return l * r;
          case '/':
            return l / r;
          case '%':
            return l % r;
          case '**':
            return l ** r;
          case '&':
            return l & r;
          case '|':
            return l | r;
          case '^':
            return l ^ r;
          case '<<':
            return l << r;
          case '>>':
            return l >> r;
          default:
            return l >>> r;
        }
      case '==':
        // eslint-disable-next-line eqeqeq
        return isPrimitive(l) && isPrimitive(r) ? l == r : l === r;
      case '!=':
        // eslint-disable-next-line eqeqeq
        return isPrimitive(l) && isPrimitive(r) ? l != r : l !== r;
      case '===':
        return l === r;
      case '!==':
        return l !== r;
      case '<':
      case '>':
      case '<=':
      case '>=':
        if (!isPrimitive(l) || !isPrimitive(r)) throw new GameError('compareObjects', { op }, node);
        if (op === '<') return l < r;
        if (op === '>') return l > r;
        if (op === '<=') return l <= r;
        return l >= r;
      case 'in':
        if (isUserObject(r)) return Object.prototype.hasOwnProperty.call(r, propName(l));
        if (Array.isArray(r)) return isIndexKey(l) && Number(l) < r.length;
        if (r instanceof Map || r instanceof Set) return r.has(l);
        throw new GameError('inOperator', {}, node);
      default:
        throw new GameError('unsupported', { what: `operator ${op}` }, node);
    }
  }

  unaryOp(node, v) {
    switch (node.operator) {
      case '-':
        if (!isPrimitive(v)) throw new GameError('mathOnObject', { op: '-' }, node);
        return -v;
      case '+':
        if (!isPrimitive(v)) throw new GameError('mathOnObject', { op: '+' }, node);
        return +v;
      case '!':
        return !v;
      case '~':
        return ~v;
      case 'typeof': {
        if (v === null) return 'object';
        if (isCallable(v)) return 'function';
        if (v instanceof EnumValue || v instanceof Namespace || v instanceof DroneHandle) return 'object';
        return typeof v;
      }
      default:
        throw new GameError('unsupported', { what: `operator ${node.operator}` }, node);
    }
  }

  // ---------------------------------------------------------------- synchronous expressions (no calls)

  evalSync(node, scope) {
    switch (node.type) {
      case 'Literal':
        if (node.regex) throw new GameError('unsupported', { what: 'regex' }, node);
        if (typeof node.value === 'bigint') throw new GameError('unsupported', { what: 'BigInt' }, node);
        return node.value;

      case 'Identifier':
        if (node.name === 'undefined') {
          const b = scope.find('undefined');
          return b ? b.value : undefined;
        }
        return this.lookup(node.name, scope, node);

      case 'BinaryExpression': {
        const l = this.evalSync(node.left, scope);
        const r = this.evalSync(node.right, scope);
        this.ticks += this.costs.binary;
        return this.binaryOp(node.operator, l, r, node);
      }

      case 'LogicalExpression': {
        this.ticks += this.costs.binary;
        const l = this.evalSync(node.left, scope);
        if (node.operator === '&&') return l ? this.evalSync(node.right, scope) : l;
        if (node.operator === '||') return l ? l : this.evalSync(node.right, scope);
        return l !== null && l !== undefined ? l : this.evalSync(node.right, scope);
      }

      case 'UnaryExpression': {
        if (node.operator === 'delete') return this.deleteMember(node.argument, scope, null);
        if (node.operator === 'typeof' && node.argument.type === 'Identifier' && !scope.find(node.argument.name)) {
          if (!(this.host.hasGlobal && this.host.hasGlobal(node.argument.name))) return 'undefined';
        }
        const v = this.evalSync(node.argument, scope);
        return this.unaryOp(node, v);
      }

      case 'UpdateExpression':
        return this.updateSync(node, scope);

      case 'AssignmentExpression':
        return this.assignSync(node, scope);

      case 'MemberExpression': {
        const obj = this.evalSync(node.object, scope);
        if (node.optional && (obj === null || obj === undefined)) throw CHAIN_SHORT;
        const key = node.computed ? this.evalSync(node.property, scope) : node.property.name;
        return this.getMember(obj, key, node);
      }

      case 'ChainExpression':
        try {
          return this.evalSync(node.expression, scope);
        } catch (e) {
          if (e === CHAIN_SHORT) return undefined;
          throw e;
        }

      case 'ConditionalExpression':
        this.ticks += this.costs.if;
        return this.evalSync(node.test, scope)
          ? this.evalSync(node.consequent, scope)
          : this.evalSync(node.alternate, scope);

      case 'ArrayExpression': {
        this.ticks += this.costs.collection;
        const out = [];
        for (const el of node.elements) {
          if (el === null) out.push(undefined);
          else if (el.type === 'SpreadElement') {
            const v = this.evalSync(el.argument, scope);
            for (const x of this.iterableToArray(v, el)) out.push(x);
          } else out.push(this.evalSync(el, scope));
        }
        if (out.length > MAX_LIST) throw new GameError('listTooLong', { max: MAX_LIST }, node);
        return out;
      }

      case 'ObjectExpression': {
        this.ticks += this.costs.collection;
        const obj = makeObject();
        for (const p of node.properties) {
          if (p.type === 'SpreadElement') {
            const v = this.evalSync(p.argument, scope);
            if (isUserObject(v)) Object.assign(obj, v);
            continue;
          }
          if (p.kind !== 'init') throw new GameError('unsupported', { what: 'getter/setter' }, p);
          const key = p.computed ? propName(this.evalSync(p.key, scope)) : p.key.type === 'Identifier' ? p.key.name : propName(p.key.value);
          let v = this.evalSync(p.value, scope);
          if (v instanceof Closure && !v.name) v.name = key;
          obj[key] = v;
        }
        return obj;
      }

      case 'TemplateLiteral': {
        this.ticks += this.costs.template;
        let s = node.quasis[0].value.cooked;
        for (let i = 0; i < node.expressions.length; i++) {
          const v = this.evalSync(node.expressions[i], scope);
          s += isPrimitive(v) ? String(v) : formatValue(v);
          s += node.quasis[i + 1].value.cooked;
        }
        if (s.length > MAX_STRING) throw new GameError('stringTooLong', { max: MAX_STRING }, node);
        return s;
      }

      case 'SequenceExpression': {
        let v;
        for (const e of node.expressions) v = this.evalSync(e, scope);
        return v;
      }

      case 'ArrowFunctionExpression':
      case 'FunctionExpression': {
        this.ticks += this.costs.define;
        const fn = new Closure(node, scope);
        if (node.type === 'FunctionExpression' && node.id) {
          // Named function expressions can call themselves.
          const own = new Scope(scope, 'block');
          own.declare(node.id.name, 'const', fn, node);
          fn.scope = own;
        }
        return fn;
      }

      case 'ParenthesizedExpression':
        return this.evalSync(node.expression, scope);

      case 'ThisExpression':
        throw new GameError('unsupported', { what: 'this' }, node);

      default:
        throw new GameError('unsupported', { what: node.type }, node);
    }
  }

  updateSync(node, scope) {
    const arg = node.argument;
    if (arg.type === 'Identifier') {
      const old = this.lookup(arg.name, scope, arg);
      const n = this.numberForUpdate(old, node);
      const nv = node.operator === '++' ? n + 1 : n - 1;
      this.ticks += this.costs.binary;
      this.setVariable(arg.name, nv, scope, arg);
      return node.prefix ? nv : n;
    }
    if (arg.type === 'MemberExpression') {
      const obj = this.evalSync(arg.object, scope);
      const key = arg.computed ? this.evalSync(arg.property, scope) : arg.property.name;
      return this.updateMember(node, obj, key);
    }
    throw new GameError('syntaxAssignTarget', {}, node);
  }

  updateMember(node, obj, key) {
    const old = this.getMember(obj, key, node.argument);
    const n = this.numberForUpdate(old, node);
    const nv = node.operator === '++' ? n + 1 : n - 1;
    this.ticks += this.costs.binary;
    this.setMember(obj, key, nv, node.argument);
    return node.prefix ? nv : n;
  }

  numberForUpdate(v, node) {
    if (!isPrimitive(v)) throw new GameError('mathOnObject', { op: node.operator }, node);
    return Number(v);
  }

  assignSync(node, scope) {
    const left = node.left;
    const op = node.operator;
    if (left.type === 'Identifier') {
      if (op === '=') {
        const v = this.evalSync(node.right, scope);
        if (v instanceof Closure && !v.name) v.name = left.name;
        this.setVariable(left.name, v, scope, left);
        return v;
      }
      const cur = this.lookup(left.name, scope, left);
      if (op === '&&=' || op === '||=' || op === '??=') {
        if (!this.logicalAssignNeeded(op, cur)) return cur;
        const v = this.evalSync(node.right, scope);
        this.setVariable(left.name, v, scope, left);
        return v;
      }
      const r = this.evalSync(node.right, scope);
      this.ticks += this.costs.binary;
      const v = this.binaryOp(op.slice(0, -1), cur, r, node);
      this.setVariable(left.name, v, scope, left);
      return v;
    }
    if (left.type === 'MemberExpression') {
      const obj = this.evalSync(left.object, scope);
      const key = left.computed ? this.evalSync(left.property, scope) : left.property.name;
      if (op === '=') {
        const v = this.evalSync(node.right, scope);
        this.setMember(obj, key, v, left);
        return v;
      }
      const cur = this.getMember(obj, key, left);
      if (op === '&&=' || op === '||=' || op === '??=') {
        if (!this.logicalAssignNeeded(op, cur)) return cur;
        const v = this.evalSync(node.right, scope);
        this.setMember(obj, key, v, left);
        return v;
      }
      const r = this.evalSync(node.right, scope);
      this.ticks += this.costs.binary;
      const v = this.binaryOp(op.slice(0, -1), cur, r, node);
      this.setMember(obj, key, v, left);
      return v;
    }
    // Destructuring assignment: patterns may contain defaults; run them through the generator path.
    const v = this.evalSync(node.right, scope);
    runSync(this.bindPattern(left, v, scope, null));
    return v;
  }

  logicalAssignNeeded(op, cur) {
    if (op === '&&=') return !!cur;
    if (op === '||=') return !cur;
    return cur === null || cur === undefined;
  }

  deleteMember(arg, scope) {
    if (arg.type !== 'MemberExpression') throw new GameError('unsupported', { what: 'delete' }, arg);
    const obj = this.evalSync(arg.object, scope);
    const key = arg.computed ? this.evalSync(arg.property, scope) : arg.property.name;
    if (isUserObject(obj)) return delete obj[propName(key)];
    throw new GameError('cannotSet', { type: typeKey(obj), prop: propName(key) }, arg);
  }

  // ---------------------------------------------------------------- generator expressions (may contain calls)

  *eval(node, scope) {
    switch (node.type) {
      case 'CallExpression':
        return yield* this.evalCall(node, scope);

      case 'NewExpression':
        return yield* this.evalNew(node, scope);

      case 'BinaryExpression': {
        const a = node.left;
        const b = node.right;
        const l = a._call ? yield* this.eval(a, scope) : this.evalSync(a, scope);
        const r = b._call ? yield* this.eval(b, scope) : this.evalSync(b, scope);
        this.ticks += this.costs.binary;
        return this.binaryOp(node.operator, l, r, node);
      }

      case 'LogicalExpression': {
        this.ticks += this.costs.binary;
        const a = node.left;
        const b = node.right;
        const l = a._call ? yield* this.eval(a, scope) : this.evalSync(a, scope);
        if (node.operator === '&&') {
          if (!l) return l;
        } else if (node.operator === '||') {
          if (l) return l;
        } else if (l !== null && l !== undefined) return l;
        return b._call ? yield* this.eval(b, scope) : this.evalSync(b, scope);
      }

      case 'UnaryExpression': {
        if (node.operator === 'delete') return this.deleteMember(node.argument, scope);
        const a = node.argument;
        const v = a._call ? yield* this.eval(a, scope) : this.evalSync(a, scope);
        return this.unaryOp(node, v);
      }

      case 'UpdateExpression': {
        const arg = node.argument;
        if (arg.type === 'MemberExpression') {
          const o = arg.object;
          const obj = o._call ? yield* this.eval(o, scope) : this.evalSync(o, scope);
          let key = arg.property.name;
          if (arg.computed) {
            const p = arg.property;
            key = p._call ? yield* this.eval(p, scope) : this.evalSync(p, scope);
          }
          return this.updateMember(node, obj, key);
        }
        return this.updateSync(node, scope);
      }

      case 'AssignmentExpression':
        return yield* this.evalAssign(node, scope);

      case 'MemberExpression': {
        const o = node.object;
        const obj = o._call ? yield* this.eval(o, scope) : this.evalSync(o, scope);
        if (node.optional && (obj === null || obj === undefined)) throw CHAIN_SHORT;
        let key = node.property.name;
        if (node.computed) {
          const p = node.property;
          key = p._call ? yield* this.eval(p, scope) : this.evalSync(p, scope);
        }
        return this.getMember(obj, key, node);
      }

      case 'ChainExpression':
        try {
          return yield* this.eval(node.expression, scope);
        } catch (e) {
          if (e === CHAIN_SHORT) return undefined;
          throw e;
        }

      case 'ConditionalExpression': {
        this.ticks += this.costs.if;
        const t = node.test;
        const test = t._call ? yield* this.eval(t, scope) : this.evalSync(t, scope);
        const branch = test ? node.consequent : node.alternate;
        return branch._call ? yield* this.eval(branch, scope) : this.evalSync(branch, scope);
      }

      case 'ArrayExpression': {
        this.ticks += this.costs.collection;
        const out = [];
        for (const el of node.elements) {
          if (el === null) out.push(undefined);
          else if (el.type === 'SpreadElement') {
            const a = el.argument;
            const v = a._call ? yield* this.eval(a, scope) : this.evalSync(a, scope);
            for (const x of this.iterableToArray(v, el)) out.push(x);
          } else out.push(el._call ? yield* this.eval(el, scope) : this.evalSync(el, scope));
        }
        if (out.length > MAX_LIST) throw new GameError('listTooLong', { max: MAX_LIST }, node);
        return out;
      }

      case 'ObjectExpression': {
        this.ticks += this.costs.collection;
        const obj = makeObject();
        for (const p of node.properties) {
          if (p.type === 'SpreadElement') {
            const a = p.argument;
            const v = a._call ? yield* this.eval(a, scope) : this.evalSync(a, scope);
            if (isUserObject(v)) Object.assign(obj, v);
            continue;
          }
          if (p.kind !== 'init') throw new GameError('unsupported', { what: 'getter/setter' }, p);
          let key;
          if (p.computed) {
            const k = p.key;
            key = propName(k._call ? yield* this.eval(k, scope) : this.evalSync(k, scope));
          } else key = p.key.type === 'Identifier' ? p.key.name : propName(p.key.value);
          const val = p.value;
          const v = val._call ? yield* this.eval(val, scope) : this.evalSync(val, scope);
          if (v instanceof Closure && !v.name) v.name = key;
          obj[key] = v;
        }
        return obj;
      }

      case 'TemplateLiteral': {
        this.ticks += this.costs.template;
        let s = node.quasis[0].value.cooked;
        for (let i = 0; i < node.expressions.length; i++) {
          const e = node.expressions[i];
          const v = e._call ? yield* this.eval(e, scope) : this.evalSync(e, scope);
          s += isPrimitive(v) ? String(v) : formatValue(v);
          s += node.quasis[i + 1].value.cooked;
        }
        if (s.length > MAX_STRING) throw new GameError('stringTooLong', { max: MAX_STRING }, node);
        return s;
      }

      case 'SequenceExpression': {
        let v;
        for (const e of node.expressions) v = e._call ? yield* this.eval(e, scope) : this.evalSync(e, scope);
        return v;
      }

      case 'ParenthesizedExpression':
        return yield* this.eval(node.expression, scope);

      default:
        return this.evalSync(node, scope);
    }
  }

  *evalAssign(node, scope) {
    const left = node.left;
    const op = node.operator;
    const right = node.right;
    if (left.type === 'Identifier') {
      if (op === '=') {
        const v = right._call ? yield* this.eval(right, scope) : this.evalSync(right, scope);
        if (v instanceof Closure && !v.name) v.name = left.name;
        this.setVariable(left.name, v, scope, left);
        return v;
      }
      const cur = this.lookup(left.name, scope, left);
      if (op === '&&=' || op === '||=' || op === '??=') {
        if (!this.logicalAssignNeeded(op, cur)) return cur;
        const v = right._call ? yield* this.eval(right, scope) : this.evalSync(right, scope);
        this.setVariable(left.name, v, scope, left);
        return v;
      }
      const r = right._call ? yield* this.eval(right, scope) : this.evalSync(right, scope);
      this.ticks += this.costs.binary;
      const v = this.binaryOp(op.slice(0, -1), cur, r, node);
      this.setVariable(left.name, v, scope, left);
      return v;
    }
    if (left.type === 'MemberExpression') {
      const o = left.object;
      const obj = o._call ? yield* this.eval(o, scope) : this.evalSync(o, scope);
      let key = left.property.name;
      if (left.computed) {
        const p = left.property;
        key = p._call ? yield* this.eval(p, scope) : this.evalSync(p, scope);
      }
      if (op === '=') {
        const v = right._call ? yield* this.eval(right, scope) : this.evalSync(right, scope);
        this.setMember(obj, key, v, left);
        return v;
      }
      const cur = this.getMember(obj, key, left);
      if (op === '&&=' || op === '||=' || op === '??=') {
        if (!this.logicalAssignNeeded(op, cur)) return cur;
        const v = right._call ? yield* this.eval(right, scope) : this.evalSync(right, scope);
        this.setMember(obj, key, v, left);
        return v;
      }
      const r = right._call ? yield* this.eval(right, scope) : this.evalSync(right, scope);
      this.ticks += this.costs.binary;
      const v = this.binaryOp(op.slice(0, -1), cur, r, node);
      this.setMember(obj, key, v, left);
      return v;
    }
    const v = right._call ? yield* this.eval(right, scope) : this.evalSync(right, scope);
    yield* this.bindPattern(left, v, scope, null);
    return v;
  }

  *evalArgs(args, scope) {
    const out = [];
    for (const a of args) {
      if (a.type === 'SpreadElement') {
        const arg = a.argument;
        const v = arg._call ? yield* this.eval(arg, scope) : this.evalSync(arg, scope);
        for (const x of this.iterableToArray(v, a)) out.push(x);
      } else out.push(a._call ? yield* this.eval(a, scope) : this.evalSync(a, scope));
    }
    return out;
  }

  *evalCall(node, scope) {
    const callee = node.callee;
    let fn;
    let name;
    if (callee.type === 'Identifier') {
      name = callee.name;
      fn = this.lookup(name, scope, callee);
    } else if (callee.type === 'MemberExpression') {
      const o = callee.object;
      const obj = o._call ? yield* this.eval(o, scope) : this.evalSync(o, scope);
      if (callee.optional && (obj === null || obj === undefined)) throw CHAIN_SHORT;
      let key = callee.property.name;
      if (callee.computed) {
        const p = callee.property;
        key = p._call ? yield* this.eval(p, scope) : this.evalSync(p, scope);
      }
      name = calleeText(callee);
      fn = this.getMember(obj, key, callee);
      if (!(fn instanceof BoundMethod) && !(fn instanceof BuiltinFunction)) this.ticks += this.costs.callValue;
    } else {
      fn = callee._call ? yield* this.eval(callee, scope) : this.evalSync(callee, scope);
      name = calleeText(callee);
      this.ticks += this.costs.callValue;
    }
    if (node.optional && (fn === null || fn === undefined)) throw CHAIN_SHORT;
    const args = yield* this.evalArgs(node.arguments, scope);
    if (!isCallable(fn)) throw new GameError('notFunction', { name, type: typeKey(fn) }, callee);
    this.currentCall = node;
    return yield* this.callFunction(fn, args, node);
  }

  *evalNew(node, scope) {
    const callee = node.callee;
    const args = yield* this.evalArgs(node.arguments, scope);
    if (callee.type === 'Identifier') {
      const b = scope.find(callee.name);
      if (!b) {
        // make sure Map/Set are unlocked (getGlobal throws if not)
        const ctor = this.host.getGlobal(callee.name, callee, this);
        this.ticks += this.costs.collection;
        if (callee.name === 'Map' || (ctor && ctor.name === 'Map')) {
          const m = new Map();
          if (args[0] !== undefined) {
            for (const entry of this.iterableToArray(args[0], node)) {
              if (Array.isArray(entry)) m.set(entry[0], entry[1]);
            }
          }
          return m;
        }
        if (callee.name === 'Set' || (ctor && ctor.name === 'Set')) {
          return new Set(args[0] === undefined ? [] : this.iterableToArray(args[0], node));
        }
        if (callee.name === 'Array') {
          const n = Number(args[0] ?? 0);
          if (!Number.isInteger(n) || n < 0 || n > MAX_LIST) throw new GameError('badLength', {}, node);
          return new Array(n).fill(undefined);
        }
      }
    }
    throw new GameError('unsupported', { what: 'new' }, node);
  }

  isCallable(v) {
    return isCallable(v);
  }

  // Calls any callable value with already-evaluated arguments.
  *callFunction(fn, args, node) {
    if (fn instanceof Closure) return yield* this.callClosure(fn, args, node);
    if (fn instanceof BuiltinFunction) {
      if (fn.gen) return yield* fn.impl(this, args, node);
      const v = fn.impl(this, args, node);
      if (this.actionPending) {
        this.actionPending = false;
        yield Y.ACTION;
      }
      return v;
    }
    if (fn instanceof BoundMethod) {
      const m = fn.method;
      const cost = m.cost === undefined ? this.costs.method : typeof m.cost === 'function' ? m.cost(fn.target, args) : m.cost;
      this.ticks += cost;
      if (m.gen) return yield* m.fn(this, fn.target, args, node);
      return m.fn(this, fn.target, args, node);
    }
    throw new GameError('notFunction', { name: '?', type: typeKey(fn) }, node);
  }

  *callClosure(fn, args, node) {
    if (this.callDepth >= this.maxCallDepth) {
      throw new GameError('recursion', { max: this.maxCallDepth, name: fn.name }, node);
    }
    const f = fn.node;
    const scope = new Scope(fn.scope, 'function');
    this.callDepth++;
    this.frames.push({ name: fn.name || 'function', scope });
    try {
      const params = f.params;
      for (let i = 0; i < params.length; i++) {
        const p = params[i];
        if (p.type === 'Identifier') scope.declare(p.name, 'param', args[i], p);
        else if (p.type === 'RestElement') yield* this.bindPattern(p.argument, args.slice(i), scope, 'param');
        else yield* this.bindPattern(p, args[i], scope, 'param');
      }
      if (f.expression) {
        const b = f.body;
        return b._call ? yield* this.eval(b, scope) : this.evalSync(b, scope);
      }
      const c = yield* this.execStatements(f.body.body, scope, null);
      if (c && c.type === 'return') return c.value;
      return undefined;
    } finally {
      this.callDepth--;
      this.frames.pop();
    }
  }

  // ---------------------------------------------------------------- helpers for builtins

  // Called by builtins: charge `ticks` and, if `animated`, pause after the call (drone action).
  action(ticks, animated = true) {
    this.ticks += ticks;
    if (animated) this.actionPending = true;
  }

  random() {
    return this.host.random ? this.host.random() : Math.random();
  }

  // Variables visible in the current function (for the debugger panel).
  visibleVariables() {
    const frame = this.frames[this.frames.length - 1];
    if (!frame) return [];
    const seen = new Set();
    const out = [];
    let s = this.currentScope || frame.scope;
    while (s) {
      for (const [name, b] of s.vars) {
        if (seen.has(name)) continue;
        seen.add(name);
        out.push({ name, value: b.value, kind: b.kind });
      }
      s = s.parent;
    }
    return out;
  }
}

// Runs a generator that is not expected to yield (destructuring in sync context).
function runSync(gen) {
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}

function calleeText(node) {
  if (!node) return '?';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed) return `${calleeText(node.object)}.${node.property.name}`;
  if (node.type === 'MemberExpression') return `${calleeText(node.object)}[…]`;
  return '(…)';
}

export function collectPatternNames(p, out) {
  if (!p) return out;
  switch (p.type) {
    case 'Identifier':
      out.push(p.name);
      break;
    case 'AssignmentPattern':
      collectPatternNames(p.left, out);
      break;
    case 'ArrayPattern':
      for (const e of p.elements) collectPatternNames(e, out);
      break;
    case 'ObjectPattern':
      for (const prop of p.properties) collectPatternNames(prop.type === 'RestElement' ? prop.argument : prop.value, out);
      break;
    case 'RestElement':
      collectPatternNames(p.argument, out);
      break;
    default:
      break;
  }
  return out;
}
