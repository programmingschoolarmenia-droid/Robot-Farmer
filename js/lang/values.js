// Runtime value types used by the interpreter (besides plain JS numbers, strings, booleans,
// null, undefined, arrays, null-prototype objects, Map and Set).

// A function written by the player.
export class Closure {
  constructor(node, scope, name) {
    this.node = node;
    this.scope = scope;
    this.name = name || (node.id && node.id.name) || '';
  }
}

// A function provided by the game (harvest, move, print, …).
// spec: { name, impl(interp, args, node), gen?: boolean }
export class BuiltinFunction {
  constructor(spec) {
    this.name = spec.name;
    this.impl = spec.impl;
    this.gen = !!spec.gen;
    this.spec = spec;
  }
}

// Members of enums like Entities.Carrot, Items.Hay, North.
// `label` is the name players see (Armenian, e.g. Bujser.Gazar); `group`/`name` stay canonical.
export class EnumValue {
  constructor(group, name, label) {
    this.group = group;
    this.name = name;
    this.label = label || (group ? `${group}.${name}` : name);
    Object.freeze(this);
  }
  toString() {
    return this.label;
  }
}

// A read-only bag of members: enums (Entities, Items, …) and libraries (Math, Object).
export class Namespace {
  constructor(name, kind = 'enum', label = name) {
    this.name = name;
    this.kind = kind;
    this.label = label; // shown name (Armenian for game groups)
    this.members = new Map();
    this.canonical = new Map(); // alias -> canonical member name
    this.labels = new Map(); // canonical member -> shown name
  }
  set(name, value) {
    this.members.set(name, value);
    return this;
  }
  alias(alias, canonical) {
    if (this.members.has(canonical)) {
      this.members.set(alias, this.members.get(canonical));
      this.canonical.set(alias, canonical);
    }
    return this;
  }
  get(name) {
    return this.members.get(name);
  }
  has(name) {
    return this.members.has(name);
  }
  names() {
    return [...this.members.keys()];
  }
  labelOf(member) {
    return this.labels.get(member) || member;
  }
  // One shown name per member (no aliases), for autocomplete and suggestions.
  displayNames() {
    return this.names()
      .filter((n) => !this.canonical.has(n))
      .map((n) => this.labelOf(n));
  }
}

// Method of a string/array/map/set bound to its receiver: list.push, text.length, …
export class BoundMethod {
  constructor(target, name, method) {
    this.target = target;
    this.name = name;
    this.method = method; // { fn, gen?, cost? }
  }
}

// Handle returned by spawnDrone().
export class DroneHandle {
  constructor(drone) {
    this.drone = drone;
  }
}

export function isUserObject(v) {
  return v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === null;
}

export function isCallable(v) {
  return v instanceof Closure || v instanceof BuiltinFunction || v instanceof BoundMethod;
}

export function makeObject() {
  return Object.create(null);
}

// Text shown by print(), the debugger panel and error messages.
export function formatValue(v, nested = false, depth = 0) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  const t = typeof v;
  if (t === 'string') return nested ? JSON.stringify(v) : v;
  if (t === 'number') {
    if (Number.isInteger(v) || !Number.isFinite(v)) return String(v);
    return String(Math.round(v * 1e6) / 1e6);
  }
  if (t === 'boolean') return String(v);
  if (depth > 3) return '…';
  if (v instanceof EnumValue) return v.toString();
  if (Array.isArray(v)) {
    const shown = v.slice(0, 50).map((x) => formatValue(x, true, depth + 1));
    if (v.length > 50) shown.push(`… (${v.length})`);
    return `[${shown.join(', ')}]`;
  }
  if (v instanceof Map) {
    const parts = [];
    for (const [k, val] of v) {
      if (parts.length >= 30) {
        parts.push('…');
        break;
      }
      parts.push(`${formatValue(k, true, depth + 1)} => ${formatValue(val, true, depth + 1)}`);
    }
    return `Map {${parts.join(', ')}}`;
  }
  if (v instanceof Set) {
    const parts = [];
    for (const x of v) {
      if (parts.length >= 30) {
        parts.push('…');
        break;
      }
      parts.push(formatValue(x, true, depth + 1));
    }
    return `Set {${parts.join(', ')}}`;
  }
  if (v instanceof Closure) return `function ${v.name || ''}()`.replace('function ()', 'function()');
  if (v instanceof BuiltinFunction) return `${v.label || v.name}()`;
  if (v instanceof BoundMethod) return `${v.name}()`;
  if (v instanceof Namespace) return v.label;
  if (v instanceof DroneHandle) return `Դրոն #${v.drone.id}`;
  if (isUserObject(v)) {
    const keys = Object.keys(v);
    const parts = keys.slice(0, 30).map((k) => {
      const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
      return `${key}: ${formatValue(v[k], true, depth + 1)}`;
    });
    if (keys.length > 30) parts.push('…');
    return parts.length ? `{ ${parts.join(', ')} }` : '{}';
  }
  return String(v);
}

// Short description of a value's type, used in error messages ("թիվ", "տեքստ", …).
export function typeKey(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  const t = typeof v;
  if (t === 'number') return 'number';
  if (t === 'string') return 'string';
  if (t === 'boolean') return 'boolean';
  if (v instanceof EnumValue) return v.group ? `enum:${v.group}` : 'enum';
  if (Array.isArray(v)) return 'array';
  if (v instanceof Map) return 'map';
  if (v instanceof Set) return 'set';
  if (isCallable(v)) return 'function';
  if (v instanceof Namespace) return 'namespace';
  if (v instanceof DroneHandle) return 'drone';
  if (isUserObject(v)) return 'object';
  return 'unknown';
}
