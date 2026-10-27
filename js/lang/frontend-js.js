// JavaScript front end: parses player code with Acorn and prepares the AST for the interpreter.
// (A future Python front end would produce the same kind of AST.)
import * as acorn from '../../vendor/acorn/acorn.mjs';
import { syntaxErrorFromAcorn } from './errors.js';
import { collectPatternNames } from './interpreter.js';

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const CALL_TYPES = new Set(['CallExpression', 'NewExpression', 'TaggedTemplateExpression', 'ImportExpression']);
const SKIP_KEYS = new Set(['type', 'loc', 'start', 'end', 'range', 'raw', 'regex', 'bigint']);

// Parses source; throws GameError on syntax errors.
// `moduleName` (the script tab) is stored on every node as `_mod` so errors know their tab.
export function parseProgram(source, moduleName = 'main') {
  let ast;
  try {
    ast = acorn.parse(source, {
      ecmaVersion: 2022,
      sourceType: 'module',
      locations: true,
      allowHashBang: false,
      allowAwaitOutsideFunction: false,
    });
  } catch (e) {
    if (e instanceof SyntaxError) {
      const err = syntaxErrorFromAcorn(e, source);
      err.module = moduleName;
      throw err;
    }
    throw e;
  }
  annotate(ast, moduleName);
  ast._source = source; // for counting code words (codeWords.js)
  return ast;
}

// Marks each node with `_call` when evaluating it may call a function. `_ran` is set by the
// interpreter to the run id when a statement executes.
function annotate(node, mod) {
  node._mod = mod;
  node._ran = 0;
  let call = false;
  for (const key in node) {
    if (SKIP_KEYS.has(key) || key.charCodeAt(0) === 95 /* _ */) continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) {
        if (c && typeof c.type === 'string' && annotate(c, mod)) call = true;
      }
    } else if (v && typeof v === 'object' && typeof v.type === 'string') {
      if (annotate(v, mod)) call = true;
    }
  }
  if (CALL_TYPES.has(node.type)) call = true;
  if (FUNCTION_TYPES.has(node.type)) {
    node._call = false;
    return false;
  }
  node._call = call;
  return call;
}

// Walks every node, calling visit(node, parent, key).
export function walk(node, visit, parent = null, key = null) {
  if (!node || typeof node.type !== 'string') return;
  if (visit(node, parent, key) === false) return;
  for (const k in node) {
    if (SKIP_KEYS.has(k) || k.charCodeAt(0) === 95) continue;
    const v = node[k];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === 'string') walk(c, visit, node, k);
    } else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, visit, node, k);
  }
}

// Every name the program declares anywhere (variables, functions, parameters, imports).
export function declaredNames(ast) {
  const names = new Set();
  walk(ast, (node) => {
    switch (node.type) {
      case 'VariableDeclarator':
        for (const n of collectPatternNames(node.id, [])) names.add(n);
        break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (node.id) names.add(node.id.name);
        for (const p of node.params) for (const n of collectPatternNames(p, [])) names.add(n);
        break;
      case 'ImportSpecifier':
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier':
        names.add(node.local.name);
        break;
      case 'CatchClause':
        if (node.param) for (const n of collectPatternNames(node.param, [])) names.add(n);
        break;
      default:
        break;
    }
  });
  return names;
}

// Is this Identifier node a reference to a variable (not a property name, label or declaration)?
export function isReference(node, parent, key) {
  if (!parent) return true;
  switch (parent.type) {
    case 'MemberExpression':
      return key === 'object' || parent.computed;
    case 'Property':
      if (key === 'key') return parent.computed;
      return true;
    case 'PropertyDefinition':
    case 'MethodDefinition':
      return key !== 'key' || parent.computed;
    case 'VariableDeclarator':
      return key !== 'id';
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      return key === 'body';
    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
      return false;
    case 'ExportSpecifier':
      return key === 'local';
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
      return false;
    case 'AssignmentPattern':
      return key === 'right';
    case 'ArrayPattern':
    case 'ObjectPattern':
    case 'RestElement':
      return false;
    case 'CatchClause':
      return key !== 'param';
    default:
      return true;
  }
}
