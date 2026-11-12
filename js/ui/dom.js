// Small DOM helpers.
import { formatCount } from '../core/util.js';

// True while the mouse or a finger is pressing: a button rebuilt between press and release loses its
// click, so what redraws on a timer waits for the release.
let pressing = false;
window.addEventListener('pointerdown', () => (pressing = true), true);
for (const type of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(type, () => (pressing = false), true);
export const isPressing = () => pressing;

// Messages (Bridgy's bubbles, the game's toasts) let taps through to the buttons under them
// (pointer-events: none); a tap on one still sends it away.
const tapAways = new Map(); // element → close()
window.addEventListener(
  'pointerdown',
  (e) => {
    for (const [el, close] of tapAways) {
      if (!el.isConnected) {
        tapAways.delete(el);
        continue;
      }
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) close();
    }
  },
  true,
);
export const closeOnTap = (el, close) => tapAways.set(el, close);

// Android's back key (and the browser's Back): each open window, view or Bridgy's dialog registers
// with onBack(close), and Back closes the one on top instead of leaving the game. The game keeps one
// history step per open thing (steps are all alike, so any order of closing works). A window closed
// by its own button calls the returned function, and its step goes again. A step is never added
// while our own history.go() is on its way (Chrome would land on the wrong step), only after it.
const backStack = [];
let steps = 0; // history steps the game has added
let moving = false; // our history.go() hasn't landed yet
function syncSteps() {
  if (moving) return;
  if (steps > backStack.length) {
    moving = true;
    history.go(backStack.length - steps);
    steps = backStack.length;
  }
  for (; steps < backStack.length; steps++) {
    try {
      history.pushState(history.state, '');
    } catch {
      return; // (too many steps too fast: Back closes fewer things this time)
    }
  }
}
export function onBack(close) {
  const entry = { close };
  backStack.push(entry);
  syncSteps();
  return () => {
    const i = backStack.indexOf(entry);
    if (i < 0) return; // Back closed it
    backStack.splice(i, 1);
    syncSteps();
  };
}
window.addEventListener('popstate', () => {
  if (moving) moving = false; // our own step back landed
  else if (!steps) return history.back(); // nothing open (a step left from before a reload): Back leaves
  else {
    steps--;
    const top = backStack.pop();
    if (top) top.close();
  }
  syncSteps();
});

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

// A label with a shorter form for narrow phones (texts.json → ui.short.<key>; css/mobile.css shows it under 400 px).
export function phoneText(t, key) {
  const short = t(`ui.short.${key}`);
  if (short === `ui.short.${key}`) return t(`ui.${key}`);
  return [h('span', { class: 'text-long' }, t(`ui.${key}`)), h('span', { class: 'text-short' }, short)];
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

// The pictures of the seasons and the weathers (calendar.js names).
export const CALENDAR_ICONS = { Spring: 'blossom', Summer: 'summer', Autumn: 'leaf', Winter: 'snowflake', Sunny: 'sun', Rain: 'rain', Storm: 'storm', Heat: 'flame', Snow: 'snow' };

// The storage chips in a full-screen window's head: only the numbers change while items come in.
export function itemChips(box, { sprites, i18n }, game) {
  const inv = game.inventory;
  const shown = ((game.settings.items && game.settings.items.order) || []).filter((item) => inv.get(item) > 0);
  const key = shown.join();
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.replaceChildren(...shown.map((item) => h('span', { class: 'chip', title: i18n.item(item), dataset: { item } }, pixelImg(sprites.url(`item:${item}`, 2)), h('span', {}))));
  }
  for (const chip of box.children) {
    const text = formatCount(Math.floor(inv.get(chip.dataset.item)));
    if (chip.lastChild.textContent !== text) chip.lastChild.textContent = text;
  }
}

// A small picture from the sprite book next to a label (icon:<name>, or any sprite name with a «:»).
export function icon(sprites, name, cls = '') {
  return pixelImg(sprites.url(name.includes(':') ? name : `icon:${name}`, 2), `ico-img ${cls}`.trim());
}

// A carpet (js/engine/carpet.js) on a canvas: `px` screen pixels a knot; a knot not woven shows the warp.
export function paintCarpet(canvas, palette, cells, px) {
  const n = Math.round(Math.sqrt(cells.length));
  const hex = Object.fromEntries(Object.values(palette).map((c) => [c.letter, c.hex]));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e6d8c0';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < cells.length; i++) {
    const x = (i % n) * px;
    const y = Math.floor(i / n) * px;
    if (cells[i] === '.') {
      ctx.fillStyle = '#cdbb9c';
      ctx.fillRect(x + Math.floor(px / 2), y, 1, px);
    } else {
      ctx.fillStyle = hex[cells[i]] || '#000000';
      ctx.fillRect(x, y, px, px);
    }
  }
}

export function carpetCanvas(palette, cells, px = 8) {
  const n = Math.round(Math.sqrt(cells.length));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n * px;
  canvas.className = 'carpet-canvas';
  paintCarpet(canvas, palette, cells, px);
  return canvas;
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

// A frame that throws must not stop the game loop (that was the 2026-10-31 freeze): each new error
// goes to the console once, and the player gets one calm message.
const frameErrors = new Set();
export function frameError(app, e) {
  const key = String((e && e.stack) || e);
  if (frameErrors.has(key)) return;
  frameErrors.add(key);
  console.error('Game frame error:', e);
  if (frameErrors.size === 1) app.toast(app.i18n.t('ui.frameError'), 'warn');
}
