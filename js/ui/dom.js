// Small DOM helpers.

// Phone / portrait-tablet layout (tabs instead of side-by-side panels). Keep in sync with css/mobile.css.
export const mobileQuery = window.matchMedia('(max-width: 1023px), (max-height: 599px)');

// Wide screens: the farm panel of a game screen is a square as tall as the main area (leaving room
// for the editor and the side panel). Phones show one panel at a time.
export function sizeFarm(screen, sidePanel) {
  if (mobileQuery.matches) return;
  const H = window.innerHeight - 62 - 66 - 40;
  const W = window.innerWidth - 48 - (sidePanel.offsetWidth || 272) - 340;
  screen.style.setProperty('--farm-size', `${Math.floor(Math.max(300, Math.min(H, W, 900)))}px`);
}
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of [children].flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function pixelImg(src, cls = '', alt = '') {
  return h('img', { src, class: `pixel ${cls}`.trim(), alt, draggable: 'false' });
}

// Highlights a small code sample for Bridgy's dialog (very small JS tokenizer).
const KEYWORDS = new Set([
  'while', 'for', 'if', 'else', 'let', 'const', 'var', 'function', 'return', 'true', 'false', 'null', 'undefined',
  'break', 'continue', 'of', 'in', 'new', 'import', 'export', 'from', 'do', 'switch', 'case', 'default', 'typeof',
]);
// codeKind(word) -> 'fn' | 'enum' | null (GameApi.codeKind), so Armenian names are coloured too.
export function highlightCode(code, codeKind = () => null) {
  const frag = document.createDocumentFragment();
  const re = /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$Ա-֏][\w$Ա-֏]*)|([\s\S])/g;
  let m;
  let plain = '';
  const flush = () => {
    if (plain) {
      frag.append(plain);
      plain = '';
    }
  };
  const span = (cls, text) => {
    flush();
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    frag.append(s);
  };
  while ((m = re.exec(code))) {
    if (m[1]) span('c', m[1]);
    else if (m[2]) span('s', m[2]);
    else if (m[3]) span('n', m[3]);
    else if (m[4]) {
      const w = m[4];
      const kind = KEYWORDS.has(w) ? 'k' : { fn: 'f', enum: 'e' }[codeKind(w)];
      if (kind) span(kind, w);
      else plain += w;
    } else plain += m[5];
  }
  flush();
  return frag;
}
