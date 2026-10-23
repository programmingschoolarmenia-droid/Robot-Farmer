// Checks a parsed program against what the player has unlocked, before it runs.
// Reports: locked language features (loops, if, …), locked game functions,
// unknown names (typos) and JavaScript features the game does not support.
import { GameError } from './errors.js';
import { walk, declaredNames, isReference } from './frontend-js.js';

// Syntax feature names used in research.json → grants.syntax
export const SYNTAX_FEATURES = ['loops', 'if', 'operators', 'variables', 'functions', 'lists', 'objects', 'import'];

const UNSUPPORTED = {
  ClassDeclaration: 'class',
  ClassExpression: 'class',
  ThisExpression: 'this',
  Super: 'super',
  TryStatement: 'try/catch',
  ThrowStatement: 'throw',
  LabeledStatement: 'label',
  WithStatement: 'with',
  DebuggerStatement: 'debugger',
  YieldExpression: 'yield',
  AwaitExpression: 'await',
  MetaProperty: 'import.meta',
  TaggedTemplateExpression: 'tagged template',
  ImportExpression: 'import()',
  ExportAllDeclaration: 'export *',
};

function featuresOf(node, parent, key) {
  switch (node.type) {
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'ForStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
      return ['loops'];
    case 'ForOfStatement':
      return ['loops', 'lists'];
    case 'ForInStatement':
      return ['loops', 'objects'];
    case 'IfStatement':
    case 'ConditionalExpression':
    case 'SwitchStatement':
      return ['if'];
    case 'BinaryExpression':
      if (node.operator === 'in') return ['operators', 'objects'];
      return ['operators'];
    case 'LogicalExpression':
    case 'UpdateExpression':
    case 'SequenceExpression':
      return ['operators'];
    case 'UnaryExpression':
      if ((node.operator === '-' || node.operator === '+') && node.argument.type === 'Literal' && typeof node.argument.value === 'number') {
        return [];
      }
      if (node.operator === 'delete') return ['objects'];
      return ['operators'];
    case 'VariableDeclaration':
    case 'TemplateLiteral':
      return ['variables'];
    case 'AssignmentExpression':
      return node.operator === '=' ? ['variables'] : ['variables', 'operators'];
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'ReturnStatement':
      return ['functions'];
    case 'ArrayExpression':
    case 'ArrayPattern':
    case 'SpreadElement':
    case 'RestElement':
      return ['lists'];
    case 'MemberExpression':
      return node.computed ? ['lists'] : [];
    case 'ObjectExpression':
    case 'ObjectPattern':
    case 'NewExpression':
    case 'ChainExpression':
      return ['objects'];
    case 'ImportDeclaration':
    case 'ExportNamedDeclaration':
    case 'ExportDefaultDeclaration':
      return ['import'];
    default:
      return [];
  }
}

// ctx: {
//   isSyntaxUnlocked(feature) -> bool
//   globalStatus(name) -> 'unlocked' | 'locked' | 'unknown'
//   suggest(name) -> string[]
// }
// Returns an array of GameErrors (empty = OK). At most one error per feature/name.
export function checkProgram(ast, ctx) {
  const errors = [];
  const reported = new Set();
  const declared = declaredNames(ast);
  const report = (key, err) => {
    if (reported.has(key)) return;
    reported.add(key);
    errors.push(err);
  };

  walk(ast, (node, parent, key) => {
    const unsupported = UNSUPPORTED[node.type];
    if (unsupported) {
      report(`unsupported:${unsupported}`, new GameError('unsupported', { what: unsupported }, node));
      return;
    }
    if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') && (node.async || node.generator)) {
      report('unsupported:async', new GameError('unsupported', { what: node.async ? 'async' : 'function*' }, node));
    }
    if (node.type === 'Literal' && node.regex) {
      report('unsupported:regex', new GameError('unsupported', { what: 'regex' }, node));
    }
    if (node.type === 'Literal' && typeof node.bigint === 'string') {
      report('unsupported:bigint', new GameError('unsupported', { what: 'BigInt' }, node));
    }
    if (node.type === 'Property' && (node.kind === 'get' || node.kind === 'set')) {
      report('unsupported:getset', new GameError('unsupported', { what: 'get/set' }, node));
    }
    if (node.type === 'BinaryExpression' && node.operator === 'instanceof') {
      report('unsupported:instanceof', new GameError('unsupported', { what: 'instanceof' }, node));
    }
    if (node.type === 'UnaryExpression' && node.operator === 'void') {
      report('unsupported:void', new GameError('unsupported', { what: 'void' }, node));
    }

    for (const f of featuresOf(node, parent, key)) {
      if (!ctx.isSyntaxUnlocked(f)) {
        report(`syntax:${f}`, new GameError('lockedSyntax', { feature: f }, node));
      }
    }

    if (node.type === 'Identifier' && isReference(node, parent, key)) {
      const name = node.name;
      if (declared.has(name)) return;
      if (parent && parent.type === 'AssignmentExpression' && key === 'left') {
        if (ctx.globalStatus(name) === 'unknown') {
          report(`assign:${name}`, new GameError('assignUndeclared', { name }, node));
          return;
        }
      }
      if (parent && parent.type === 'UpdateExpression' && ctx.globalStatus(name) === 'unknown') {
        report(`assign:${name}`, new GameError('assignUndeclared', { name }, node));
        return;
      }
      const status = ctx.globalStatus(name);
      if (status === 'locked') {
        const canonical = ctx.canonical ? ctx.canonical(name) : name;
        report(`fn:${name}`, new GameError('lockedFunction', { name, canonical }, node));
      } else if (status === 'unknown') {
        report(`name:${name}`, new GameError('notDefined', { name, suggestions: ctx.suggest(name) }, node));
      }
    }
  });

  errors.sort((a, b) => (a.loc && b.loc ? a.loc.line - b.loc.line || a.loc.column - b.loc.column : 0));
  return errors;
}
