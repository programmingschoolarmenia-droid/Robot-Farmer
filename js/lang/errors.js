// Errors raised while checking or running player code.
// The interpreter only produces a `code` and `params`; the UI turns them into friendly
// Armenian text using config/texts.json (errors.<code>).

export class GameError extends Error {
  constructor(code, params = {}, node = null) {
    super(`${code} ${JSON.stringify(params)}`);
    this.name = 'GameError';
    this.code = code;
    this.params = params;
    this.loc = locOf(node);
    this.module = (node && node._mod) || null;
  }
  at(node) {
    if (!this.loc) this.loc = locOf(node);
    if (!this.module && node && node._mod) this.module = node._mod;
    return this;
  }
}

export function locOf(node) {
  if (!node) return null;
  if (node.loc && node.loc.start) {
    return {
      line: node.loc.start.line,
      column: node.loc.start.column,
      endLine: node.loc.end.line,
      endColumn: node.loc.end.column,
    };
  }
  if (typeof node.line === 'number') return { line: node.line, column: node.column || 0 };
  return null;
}

// --- Syntax error helpers -------------------------------------------------------------

// Finds the first bracket problem in the source, ignoring strings and comments.
export function checkBrackets(source) {
  const stack = [];
  const pairs = { ')': '(', ']': '[', '}': '{' };
  let line = 1;
  let col = 0;
  let i = 0;
  const n = source.length;
  const templateDepth = [];
  const advance = () => {
    if (source[i] === '\n') {
      line++;
      col = 0;
    } else col++;
    i++;
  };
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') advance();
      continue;
    }
    if (ch === '/' && next === '*') {
      advance();
      advance();
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) advance();
      advance();
      advance();
      continue;
    }
    if (ch === '"' || ch === "'") {
      advance();
      while (i < n && source[i] !== ch && source[i] !== '\n') {
        if (source[i] === '\\') advance();
        advance();
      }
      if (source[i] !== ch) return null; // unterminated string: acorn reports it better
      advance();
      continue;
    }
    if (ch === '`') {
      advance();
      while (i < n && source[i] !== '`') {
        if (source[i] === '\\') advance();
        else if (source[i] === '$' && source[i + 1] === '{') {
          // Treat template expressions as nested code: push a marker.
          templateDepth.push(stack.length);
          stack.push({ ch: '{', line, column: col, template: true });
          advance();
          advance();
          break;
        }
        advance();
      }
      if (source[i] === '`') advance();
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push({ ch, line, column: col });
    } else if (ch === ')' || ch === ']' || ch === '}') {
      const top = stack[stack.length - 1];
      if (!top) return { kind: 'unexpected', char: ch, line, column: col };
      if (top.ch !== pairs[ch]) {
        return { kind: 'mismatch', char: ch, open: top.ch, line, column: col, openLine: top.line };
      }
      stack.pop();
      if (top.template && ch === '}') {
        templateDepth.pop();
        // continue scanning the rest of the template literal
        advance();
        while (i < n && source[i] !== '`') {
          if (source[i] === '\\') advance();
          else if (source[i] === '$' && source[i + 1] === '{') {
            templateDepth.push(stack.length);
            stack.push({ ch: '{', line, column: col, template: true });
            advance();
            break;
          }
          advance();
        }
        if (source[i] === '`') advance();
        continue;
      }
    }
    advance();
  }
  if (stack.length) {
    const top = stack[stack.length - 1];
    return { kind: 'unclosed', char: top.ch, line: top.line, column: top.column };
  }
  return null;
}

function tokenAt(source, line, column) {
  const text = source.split('\n')[line - 1] || '';
  const rest = text.slice(column);
  const m = rest.match(/^\s*([A-Za-z_$Ա-֏][\w$Ա-֏]*|\d+(\.\d+)?|\S)/);
  return m ? m[1] : '';
}

const PY_HINTS = [
  { re: /^\s*def\s+\w+/, code: 'syntaxPythonDef' },
  { re: /^\s*elif\b/, code: 'syntaxPythonElif' },
  { re: /^\s*(if|while|for)\b(?!\s*\()/, code: 'syntaxConditionParens' },
  { re: /^\s*(if|while|for|else)\b.*:\s*$/, code: 'syntaxPythonColon' },
];

// Converts an Acorn SyntaxError into a GameError with a helpful code.
export function syntaxErrorFromAcorn(err, source) {
  const raw = String(err.message || '').replace(/\s*\(\d+:\d+\)\s*$/, '');
  const loc = err.loc ? { line: err.loc.line, column: err.loc.column } : { line: 1, column: 0 };
  const lineText = source.split('\n')[loc.line - 1] || '';
  const mk = (code, params = {}, where = loc) => {
    const e = new GameError(code, { ...params, detail: raw }, null);
    e.loc = { line: where.line, column: where.column };
    return e;
  };

  if (/Unterminated string/.test(raw)) return mk('syntaxString');
  if (/Unterminated template/.test(raw)) return mk('syntaxTemplate');
  if (/Unterminated comment/.test(raw)) return mk('syntaxComment');

  const charMatch = raw.match(/Unexpected character '(.+)'/);
  if (charMatch) {
    const ch = charMatch[1];
    if ('«»“”„‘’'.includes(ch)) return mk('syntaxQuotes', { char: ch });
    if (ch === '։' || ch === '՝' || ch === '՞' || ch === '՛' || ch === '՜') {
      return mk('syntaxArmenianPunct', { char: ch });
    }
    return mk('syntaxCharacter', { char: ch });
  }

  for (const h of PY_HINTS) {
    if (h.re.test(lineText)) return mk(h.code, { line: loc.line });
  }
  // Python hints can also apply to the previous line (error is often reported on the next one).
  const prevText = source.split('\n')[loc.line - 2] || '';
  for (const h of PY_HINTS) {
    if (h.re.test(prevText)) return mk(h.code, { line: loc.line - 1 }, { line: loc.line - 1, column: 0 });
  }

  const redeclared = raw.match(/Identifier '(.+)' has already been declared/);
  if (redeclared) return mk('redeclare', { name: redeclared[1] });
  if (/'return' outside of function/.test(raw)) return mk('syntaxReturnOutside');
  if (/Unsyntactic (break|continue)/.test(raw)) return mk('syntaxBreakOutside');
  if (/Assigning to rvalue|Invalid left-hand side/.test(raw)) return mk('syntaxAssignTarget');
  const kw = raw.match(/(?:Unexpected keyword|The keyword) '(\w+)'/);
  if (kw) return mk('syntaxKeyword', { word: kw[1] });

  const br = checkBrackets(source);
  if (br) {
    if (br.kind === 'unclosed') return mk('syntaxUnclosed', { char: br.char }, br);
    if (br.kind === 'unexpected') return mk('syntaxUnexpectedCloser', { char: br.char }, br);
    return mk('syntaxMismatch', { char: br.char, open: br.open }, br);
  }

  if (/Unexpected token/.test(raw)) {
    const tok = tokenAt(source, loc.line, loc.column);
    if (!tok) return mk('syntaxUnexpectedEnd');
    return mk('syntaxUnexpected', { token: tok });
  }
  return mk('syntax');
}
