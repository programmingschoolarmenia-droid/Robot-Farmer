// Full-screen research tree (layout from config/research.json, shape like the user's photo).
import { h, icon, pixelImg, mobileQuery } from './dom.js';
import { formatCount } from '../core/util.js';

const CARD_W = 100;
const CARD_H = 80;
const GAP_X = 16;
const GAP_Y = 38;
const PAD = 30;

export class ResearchTree {
  constructor({ app, game, onBuy, onClose }) {
    this.app = app;
    this.game = game;
    this.onBuy = onBuy;
    this.onClose = onClose;
    this.el = null;
    this.selected = null;
    this.view = { x: 0, y: 0, s: 1 };
    this.cards = new Map();
    this.computeLayout();
  }

  get isOpen() {
    return !!this.el;
  }

  computeLayout() {
    const nodes = this.game.research.nodes;
    const kids = new Map(nodes.map((n) => [n.id, []]));
    const roots = [];
    for (const n of nodes) {
      const p = (n.parents || [])[0];
      if (p && kids.has(p)) kids.get(p).push(n.id);
      else roots.push(n.id);
    }
    const width = new Map();
    const measure = (id) => {
      const c = kids.get(id);
      const w = c.length ? c.reduce((a, k) => a + measure(k), 0) : 1;
      width.set(id, w);
      return w;
    };
    const pos = new Map();
    let maxDepth = 0;
    const place = (id, x0, depth) => {
      const w = width.get(id);
      pos.set(id, { x: x0 + w / 2, depth });
      maxDepth = Math.max(maxDepth, depth);
      let x = x0;
      for (const k of kids.get(id)) {
        place(k, x, depth + 1);
        x += width.get(k);
      }
    };
    let x = 0;
    for (const r of roots) {
      measure(r);
      place(r, x, 0);
      x += width.get(r);
    }
    this.layout = { pos, units: x, depth: maxDepth };
    this.treeW = x * (CARD_W + GAP_X) + PAD * 2;
    this.treeH = (maxDepth + 1) * (CARD_H + GAP_Y) + PAD * 2;
  }

  cardXY(id) {
    const p = this.layout.pos.get(id);
    return { x: PAD + p.x * (CARD_W + GAP_X) - CARD_W / 2, y: PAD + p.depth * (CARD_H + GAP_Y) };
  }

  open(selectId = null) {
    if (this.el) return;
    const t = this.app.i18n.t;
    this.items = h('div', { class: 'research-items' });
    this.canvas = h('div', { class: 'tree-canvas', style: { width: `${this.treeW}px`, height: `${this.treeH}px` } });
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'tree-lines');
    this.svg.setAttribute('width', this.treeW);
    this.svg.setAttribute('height', this.treeH);
    this.canvas.append(this.svg);
    this.details = h('div', { class: 'research-details', hidden: true, onwheel: (e) => e.stopPropagation() });
    this.body = h(
      'div',
      { class: 'research-body' },
      this.canvas,
      this.details,
      h(
        'div',
        { class: 'research-zoom' },
        h('button', { class: 'btn btn-icon', onclick: () => this.zoom(1.2) }, '+'),
        h('button', { class: 'btn btn-icon', onclick: () => this.zoom(1 / 1.2) }, '−'),
        h('button', { class: 'btn btn-icon', onclick: () => this.fit(), title: 'fit' }, '⤢'),
      ),
    );
    this.el = h(
      'div',
      { class: 'research-overlay', role: 'dialog' },
      h(
        'div',
        { class: 'research-head' },
        pixelImg(this.app.sprites.url('icon:debugger', 2), '', ''),
        h('h2', {}, t('ui.researchTitle')),
        this.items,
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: () => this.close() }, '✕ ', t('ui.close')),
      ),
      this.body,
    );
    document.body.append(this.el);
    this.buildCards();
    this.bindPanZoom();
    this.keyHandler = (e) => {
      if (e.key === 'Escape') this.close();
    };
    document.addEventListener('keydown', this.keyHandler);
    this.fit();
    this.refresh();
    if (selectId) this.select(selectId);
  }

  close() {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    this.cards.clear();
    document.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    if (this.onClose) this.onClose();
  }

  buildCards() {
    const research = this.game.research;
    for (const n of research.nodes) {
      const { x, y } = this.cardXY(n.id);
      const card = h('div', {
        class: 'rnode',
        style: { left: `${x}px`, top: `${y}px` },
        dataset: { id: n.id },
        onclick: (e) => {
          e.stopPropagation();
          this.select(n.id);
        },
      });
      this.canvas.append(card);
      this.cards.set(n.id, card);
    }
  }

  cardContent(n, state) {
    const secretHidden = n.secret && state === 'locked';
    const body = h('div', { class: 'rn-body' });
    if (secretHidden) body.append(pixelImg(this.app.sprites.url('icon:secret', 3)));
    else if (n.icon) body.append(pixelImg(this.app.sprites.url(`icon:${n.icon}`, 3)));
    else body.append(h('div', { class: 'rn-label' }, n.label || n.id));
    const parts = [body];
    const max = n.tiers.length;
    if (max > 1) parts.push(h('div', { class: 'rn-level' }, `${this.game.research.level(n.id)} / ${max}`));
    if (state === 'soon') parts.push(h('div', { class: 'rn-ribbon' }, this.app.i18n.t('ui.soon')));
    return parts;
  }

  refresh() {
    if (!this.el) return;
    const research = this.game.research;
    for (const n of research.nodes) {
      const card = this.cards.get(n.id);
      const state = research.state(n.id);
      const key = `${state}:${research.level(n.id)}`;
      if (card.dataset.key !== key) {
        card.dataset.key = key;
        card.className = `rnode state-${state} ${n.tiers.length > 1 ? 'has-level' : ''} ${this.selected === n.id ? 'selected' : ''}`;
        card.title = n.secret && state === 'locked' ? '???' : n.name;
        card.replaceChildren(...this.cardContent(n, state));
      }
    }
    this.drawLines();
    this.renderItems();
    if (this.selected) this.renderDetails();
  }

  drawLines() {
    const research = this.game.research;
    const paths = [];
    for (const n of research.nodes) {
      for (const p of n.parents || []) {
        const a = this.cardXY(p);
        const b = this.cardXY(n.id);
        const ax = a.x + CARD_W / 2;
        const ay = a.y + CARD_H;
        const bx = b.x + CARD_W / 2;
        const by = b.y;
        const mid = ay + (by - ay) / 2;
        const visible = research.parentsDone(n.id);
        paths.push(`<path class="${visible ? '' : 'dim'}" d="M${ax},${ay + 2} V${mid} H${bx} V${by - 3}"/>`);
      }
    }
    this.svg.innerHTML = paths.join('');
  }

  renderItems() {
    const inv = this.game.inventory;
    const i18n = this.app.i18n;
    const order = (this.game.settings.items && this.game.settings.items.order) || [];
    const chips = order
      .filter((item) => inv.get(item) > 0)
      .map((item) => h('span', { class: 'chip', title: i18n.item(item) }, pixelImg(this.app.sprites.url(`item:${item}`, 2)), formatCount(Math.floor(inv.get(item)))));
    this.items.replaceChildren(...chips);
  }

  select(id) {
    if (this.selected && this.cards.get(this.selected)) this.cards.get(this.selected).classList.remove('selected');
    this.selected = id;
    const card = id && this.cards.get(id);
    if (card) card.classList.add('selected');
    if (id) this.renderDetails();
    else this.details.hidden = true;
  }

  effectText(n) {
    const g = this.game;
    const s = g.settings;
    const t = this.app.i18n.t;
    const lvl = g.research.level(n.id);
    if (lvl >= n.tiers.length) return null;
    if (n.id === ((s.time && s.time.speedResearch) || 'Speed')) {
      const f = s.time.speedPerTier || 1.5;
      return t('ui.effectSpeed', { now: round2(Math.pow(f, lvl)), next: round2(Math.pow(f, lvl + 1)) });
    }
    if (n.id === g.sizeResearch) {
      const [a, b] = g.worldSizeForLevel(lvl);
      const [c, d] = g.worldSizeForLevel(lvl + 1);
      return t('ui.effectExpand', { now: `${a}×${b}`, next: `${c}×${d}` });
    }
    for (const [name, e] of Object.entries(s.entities || {})) {
      if (e.yieldResearch === n.id && lvl >= (e.yieldBaseLevel ?? 1)) {
        const f = e.yieldFactor ?? 2;
        const base = e.yieldBaseLevel ?? 1;
        return t('ui.effectYield', { now: Math.pow(f, Math.max(0, lvl - base)), next: Math.pow(f, Math.max(0, lvl + 1 - base)) }) + ` (${this.app.i18n.entity(name)})`;
      }
    }
    for (const key of ['water', 'fertilizer']) {
      const c = s[key];
      if (c && c.research === n.id && lvl >= 1) {
        const per = c.secondsPerItem || 10;
        return t('ui.effectProduction', { now: round2(per / Math.pow(2, lvl - 1)), next: round2(per / Math.pow(2, lvl)) });
      }
    }
    return null;
  }

  renderDetails() {
    const n = this.game.research.node(this.selected);
    if (!n) return;
    const research = this.game.research;
    const i18n = this.app.i18n;
    const t = i18n.t;
    const state = research.state(n.id);
    const lvl = research.level(n.id);
    const max = n.tiers.length;
    const hidden = n.secret && state === 'locked';
    const pic = h('div', { class: 'rd-icon' });
    if (hidden) pic.append(pixelImg(this.app.sprites.url('icon:secret', 3)));
    else if (n.icon) pic.append(pixelImg(this.app.sprites.url(`icon:${n.icon}`, 3)));
    else pic.append(h('code', {}, n.label));
    const parts = [
      h('button', { class: 'btn btn-ghost btn-sm rd-close', title: t('ui.close'), onclick: () => this.select(null) }, '✕'),
      h('div', { class: 'rd-head' }, pic, h('div', {}, h('div', { class: 'rd-name' }, hidden ? t('ui.secret') : n.name), h('div', { class: 'rd-level' }, t('ui.level', { n: lvl, max })))),
      h('div', { class: 'rd-desc' }, hidden ? '???' : n.description),
    ];
    const effect = !hidden && this.effectText(n);
    if (effect) parts.push(h('div', { class: 'rd-effect' }, effect));
    const g = n.grants || {};
    const tagSection = (title, list, fmt) =>
      list && list.length ? h('div', { class: 'rd-section' }, h('h4', {}, title), h('div', { class: 'rd-tags' }, list.map((x) => h('code', {}, fmt(x))))) : null;
    if (!hidden) {
      parts.push(tagSection(t('ui.unlocksFunctions'), (g.functions || []).filter((f) => /^[a-z]/.test(f)), (f) => `${this.game.api.displayName(f)}()`));
      parts.push(tagSection(t('ui.unlocksSyntax'), g.syntax, (f) => i18n.feature(f)));
      parts.push(tagSection(t('ui.unlocksEntities'), g.entities, (e) => i18n.entity(e)));
      parts.push(tagSection(t('ui.unlocksHats'), g.hats, (x) => i18n.hat(x)));
    }
    if (state === 'maxed') {
      parts.push(h('div', { class: 'rd-note' }, icon(this.app.sprites, 'check'), ' ', t('ui.maxed')));
    } else if (state === 'soon') {
      parts.push(h('div', { class: 'rd-note' }, icon(this.app.sprites, 'soon'), ' ', t('ui.soonHint')));
    } else {
      const cost = research.nextCost(n.id);
      const inv = this.game.inventory;
      parts.push(
        h(
          'div',
          { class: 'rd-section' },
          h('h4', {}, t('ui.cost')),
          h(
            'div',
            { class: 'rd-cost' },
            Object.entries(cost).map(([item, need]) => {
              const have = inv.get(item);
              return h(
                'span',
                { class: `chip ${have >= need ? 'done' : 'missing'}`, title: t('ui.have', { n: formatCount(Math.floor(have)) }) },
                pixelImg(this.app.sprites.url(`item:${item}`, 2)),
                `${formatCount(need)} ${i18n.item(item)}`,
              );
            }),
          ),
        ),
      );
      if (state === 'locked') {
        const names = (n.parents || []).filter((p) => research.level(p) === 0).map((p) => `«${research.node(p).name}»`);
        if (names.length) parts.push(h('div', { class: 'rd-note' }, icon(this.app.sprites, 'lock'), ' ', t('ui.lockedNeed', { parents: names.join(', ') })));
        const have = research.totalLevels();
        if (have < (n.minLevels || 0)) parts.push(h('div', { class: 'rd-note' }, icon(this.app.sprites, 'lock'), ' ', t('ui.lockedLevels', { n: n.minLevels, have })));
      }
      const btn = h(
        'button',
        { class: 'btn btn-run', disabled: state !== 'affordable', onclick: () => this.buy(n.id) },
        max > 1 ? t('ui.buyLevel', { n: lvl + 1 }) : t('ui.buy'),
      );
      parts.push(btn);
    }
    this.details.replaceChildren(...parts.filter(Boolean));
    this.details.hidden = false;
  }

  buy(id) {
    const r = this.game.research.buy(id);
    if (!r.ok) return;
    const card = this.cards.get(id);
    if (card) {
      card.classList.add('just-bought');
      setTimeout(() => card.classList.remove('just-bought'), 600);
    }
    this.refresh();
    if (this.onBuy) this.onBuy(id, card);
  }

  // ------------------------------------------------------------------ pan & zoom

  applyView() {
    const v = this.view;
    this.canvas.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.s})`;
  }

  // Fit the tree to the screen width (the tree can be scrolled down). Phones start with the
  // root card in the middle (the details open as a bottom sheet there).
  fit() {
    const r = this.body.getBoundingClientRect();
    const s = Math.max(0.6, Math.min(1.05, (r.width - 360) / this.treeW, r.width / this.treeW));
    let x = Math.max(10, (r.width - 340 - this.treeW * s) / 2);
    if (mobileQuery.matches) x = r.width / 2 - (this.cardXY(this.game.research.nodes[0].id).x + CARD_W / 2) * s;
    this.view = { s, x, y: 6 };
    this.applyView();
  }

  pan(dx, dy) {
    const r = this.body.getBoundingClientRect();
    const v = this.view;
    v.x += dx;
    v.y += dy;
    const minX = Math.min(10, r.width - this.treeW * v.s - 10);
    const minY = Math.min(10, r.height - this.treeH * v.s - 10);
    v.x = Math.max(minX - 300, Math.min(300, v.x));
    v.y = Math.max(minY, Math.min(20, v.y));
    this.applyView();
  }

  zoom(f, cx, cy) {
    const r = this.body.getBoundingClientRect();
    const px = cx === undefined ? r.width / 2 : cx;
    const py = cy === undefined ? r.height / 2 : cy;
    const v = this.view;
    const s = Math.max(0.3, Math.min(2.2, v.s * f));
    v.x = px - ((px - v.x) * s) / v.s;
    v.y = py - ((py - v.y) * s) / v.s;
    v.s = s;
    this.applyView();
  }

  // Drag with the mouse or a finger to pan; pinch with two fingers (or Ctrl + wheel) to zoom.
  bindPanZoom() {
    const pointers = new Map();
    let last = null; // previous centre { x, y } and finger distance d
    this.body.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || e.target.closest('.research-details, .research-zoom')) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      last = null;
      this.body.classList.add('dragging');
    });
    window.addEventListener('pointermove', (this.onMove = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = pointers.values();
      const now = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) } : { x: a.x, y: a.y, d: 0 };
      if (last) {
        this.view.x += now.x - last.x;
        this.view.y += now.y - last.y;
        const r = this.body.getBoundingClientRect();
        if (now.d && last.d) this.zoom(now.d / last.d, now.x - r.left, now.y - r.top);
        else this.applyView();
      }
      last = now;
    }));
    window.addEventListener('pointerup', (this.onUp = (e) => {
      pointers.delete(e.pointerId);
      last = null;
      if (!pointers.size && this.body) this.body.classList.remove('dragging');
    }));
    window.addEventListener('pointercancel', this.onUp);
    this.body.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          const r = this.body.getBoundingClientRect();
          this.zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
        } else if (e.shiftKey) this.pan(-e.deltaY, 0);
        else this.pan(-e.deltaX, -e.deltaY);
      },
      { passive: false },
    );
  }
}

function round2(v) {
  return Math.round(v * 100) / 100;
}
