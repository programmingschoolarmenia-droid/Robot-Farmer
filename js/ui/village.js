// The village screen: a map of the village across the river (each building is a picture in
// assets/village, <icon>.png and its ruin <icon>-ruin.png), each building's needs, unlocks, recipes
// and story, and the villagers' requests.
import { h, pixelImg } from './dom.js';
import { formatCount } from '../core/util.js';

const W = 480; // the background canvas (16:10, like the map)
const H = 300;
const RIVER = { at: 90, width: 30 }; // the river runs down-right along y = x / 2 + at (canvas units)

const art = (b, state) => `assets/village/${b.icon}${state === 'repaired' ? '' : '-ruin'}.png`;

// «20 Չոր խոտ → Ալյուր (5 վրկ)»
export function recipeText(i18n, item, recipe) {
  const inputs = Object.entries(recipe.in).map(([k, n]) => `${n} ${i18n.item(k)}`).join(' + ');
  return i18n.t('ui.villageRecipe', { inputs, item: i18n.item(item), seconds: recipe.seconds });
}

export class VillageView {
  constructor({ app, game, onStory }) {
    this.app = app;
    this.game = game;
    this.onStory = onStory; // (building) → Bridgy tells its story again
    this.el = null;
    this.selected = null;
  }

  get isOpen() {
    return !!this.el;
  }

  get village() {
    return this.game.village;
  }

  open() {
    if (this.el) return;
    const t = this.app.i18n.t;
    this.items = h('div', { class: 'research-items' });
    this.map = h('div', { class: 'village-map' }, this.background(), h('span', { class: 'village-farm' }, t('ui.villageFarm')));
    this.panel = h('div', { class: 'village-panel' });
    this.el = h(
      'div',
      { class: 'research-overlay village-overlay', role: 'dialog' },
      h(
        'div',
        { class: 'research-head' },
        h('span', { class: 'village-icon' }, '🏘'),
        h('h2', {}, t('ui.villageTitle')),
        this.items,
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: () => this.close() }, '✕ ', t('ui.close')),
      ),
      h('div', { class: 'village-body' }, this.map, this.panel),
    );
    document.body.append(this.el);
    this.keyHandler = (e) => {
      if (e.key === 'Escape') this.close();
    };
    document.addEventListener('keydown', this.keyHandler);
    const open = this.village.buildings.find((b) => this.village.state(b.id) === 'open');
    this.select(this.village.requestsOpen ? 'board' : open ? open.id : this.village.buildings[0].id);
  }

  close() {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    document.removeEventListener('keydown', this.keyHandler);
  }

  select(id) {
    this.selected = id;
    this.refresh();
  }

  refresh() {
    if (!this.el) return;
    const { village } = this;
    const sprites = this.app.sprites;
    const inv = this.game.inventory;
    const order = (this.game.settings.items && this.game.settings.items.order) || [];
    this.items.replaceChildren(
      ...order
        .filter((item) => inv.get(item) > 0)
        .map((item) => h('span', { class: 'chip', title: this.app.i18n.item(item) }, pixelImg(sprites.url(`item:${item}`, 2)), formatCount(Math.floor(inv.get(item))))),
    );
    const spots = village.buildings.map((b) => {
      const state = village.state(b.id);
      const badge = state === 'repaired' ? '✓' : state === 'soon' ? '🚧' : state === 'locked' ? '🔒' : `${this.percent(b)}%${this.canGive(b) ? ' 🔨' : ''}`;
      return this.spot(b, h('img', { src: art(b, state), alt: '' }), b.name, badge, b.id, state);
    });
    const r = village.cfg.requests || {};
    if (village.requestsOpen) {
      const left = village.requests().list.filter((q) => !q.done).length;
      spots.push(this.spot({ x: r.x ?? 44, y: r.y ?? 36, w: r.w ?? 9 }, h('img', { src: 'assets/village/board.png', alt: '' }), this.app.i18n.t('ui.villageBoard'), left ? `📜 ${left}` : '✓', 'board', 'repaired'));
    }
    this.map.replaceChildren(...[...this.map.children].slice(0, 2), ...spots);
    this.panel.replaceChildren(...(this.selected === 'board' ? this.board() : this.buildingPanel(village.building(this.selected))));
  }

  // A building on the map: its picture centred at x, y (% of the map), w % of the map wide.
  spot(b, img, name, badge, id, state) {
    return h(
      'button',
      { class: `village-spot ${state}${this.selected === id ? ' selected' : ''}`, style: { left: `${b.x}%`, top: `${b.y}%`, width: `${b.w ?? 17}%` }, onclick: () => this.select(id) },
      img,
      h('span', { class: 'village-name' }, name),
      h('span', { class: 'village-badge' }, badge),
    );
  }

  percent(b) {
    const cost = Object.values(b.cost || {}).reduce((a, n) => a + n, 0);
    const missing = Object.values(this.village.missing(b.id)).reduce((a, n) => a + n, 0);
    return cost ? Math.floor((100 * (cost - missing)) / cost) : 100;
  }

  canGive(b) {
    return this.village.state(b.id) === 'open' && Object.keys(this.village.missing(b.id)).some((item) => this.game.inventory.get(item) >= 1);
  }

  buildingPanel(b) {
    const { i18n, sprites } = this.app;
    const t = i18n.t;
    const village = this.village;
    const state = village.state(b.id);
    const parts = [
      h('div', { class: 'rd-head' }, h('img', { class: 'village-panel-art', src: art(b, state), alt: '' }), h('div', { class: 'rd-name' }, b.name)),
      h('div', { class: 'rd-desc' }, b.description || ''),
    ];
    if (state === 'soon') parts.push(h('div', { class: 'rd-note' }, t('ui.villageSoon')));
    if (state === 'locked') parts.push(h('div', { class: 'rd-note' }, t('ui.villageLocked', { names: (b.after || []).map((a) => village.building(a).name).join(', ') })));
    if (state === 'repaired') parts.push(h('div', { class: 'rd-note' }, t('ui.villageRepaired')));
    if (state === 'open' || state === 'locked') {
      const given = village.given[b.id] || {};
      const rows = Object.entries(b.cost || {}).map(([item, need]) => {
        const got = Math.min(need, given[item] || 0);
        return h(
          'div',
          { class: 'village-need' },
          pixelImg(sprites.url(`item:${item}`, 2), '', ''),
          h('div', {}, h('div', {}, `${i18n.item(item)} · ${formatCount(got)} / ${formatCount(need)}`), h('div', { class: 'bar' }, h('span', { style: { width: `${Math.floor((100 * got) / need)}%` } }))),
          h('span', { class: 'village-have' }, t('ui.villageHave', { n: formatCount(Math.floor(this.game.inventory.get(item))) })),
        );
      });
      parts.push(h('div', { class: 'rd-section' }, h('h4', {}, t('ui.villageNeeds')), ...rows));
      if (state === 'open') {
        const canGive = this.canGive(b);
        parts.push(h('button', { class: 'btn btn-run', title: t('ui.villageGiveTitle'), disabled: !canGive, onclick: () => this.give(b.id) }, '🤲 ', t('ui.villageGive')));
        if (!canGive) parts.push(h('div', { class: 'rd-note' }, t('ui.villageNothing')));
      }
    }
    const tags = this.unlocks(b);
    if (tags.length) parts.push(h('div', { class: 'rd-section' }, h('h4', {}, t('ui.villageUnlocks')), h('div', { class: 'rd-tags' }, tags.map((x) => h('code', {}, x)))));
    if (state === 'repaired') {
      const recipes = [];
      for (const m of (b.grants && b.grants.machines) || []) {
        for (const [item, r] of Object.entries((village.cfg.machines[m] || {}).recipes || {})) recipes.push(h('div', {}, `${t(`machines.${m}`)}՝ ${recipeText(i18n, item, r)}`));
      }
      if (recipes.length) parts.push(h('div', { class: 'rd-section' }, h('h4', {}, t('ui.villageRecipes')), ...recipes));
      if (b.story) parts.push(h('button', { class: 'btn btn-sm', onclick: () => this.onStory(b) }, t('ui.villageStory')));
    }
    return parts;
  }

  // What a building opens: commands, machines, a hat, the requests board.
  unlocks(b) {
    const { i18n } = this.app;
    const g = b.grants || {};
    const out = (g.functions || []).map((f) => `${this.game.api.displayName(f)}()`);
    for (const m of g.machines || []) out.push(String(this.game.api.enums.Machines.get(m)));
    for (const hat of g.hats || []) out.push(i18n.hat(hat));
    if ((this.village.cfg.requests || {}).building === b.id) out.push(`📜 ${i18n.t('ui.villageBoard')}`);
    return out;
  }

  board() {
    const { i18n, sprites } = this.app;
    const t = i18n.t;
    const r = this.village.cfg.requests;
    const board = this.village.requests();
    const parts = [h('div', { class: 'rd-name' }, t('ui.requestsTitle'))];
    if (!board.list.length) parts.push(h('div', { class: 'rd-note' }, t('ui.requestsEmpty')));
    board.list.forEach((q, i) => {
      const v = r.villagers[q.who];
      const name = i18n.item(q.item);
      const text = v.lines[q.line].replace('{amount}', formatCount(q.amount)).replace('{item}', name.charAt(0).toLowerCase() + name.slice(1));
      const enough = this.game.inventory.get(q.item) >= q.amount;
      parts.push(
        h(
          'div',
          { class: `village-request${q.done ? ' done' : ''}` },
          v.portrait ? h('img', { class: 'village-face', src: v.portrait, alt: '' }) : h('span', { class: 'village-face' }, v.face),
          h(
            'div',
            {},
            h('b', {}, v.name),
            h('div', {}, text),
            h('div', { class: 'village-reward' }, pixelImg(sprites.url(`item:${q.item}`, 2), '', ''), `${formatCount(Math.floor(this.game.inventory.get(q.item)))} / ${formatCount(q.amount)} · ⭐ ${r.stars ?? 1}`),
          ),
          q.done ? h('span', { class: 'village-done' }, t('ui.requestsDone')) : h('button', { class: 'btn btn-run btn-sm', disabled: !enough, onclick: () => this.deliver(i) }, t('ui.villageGive')),
        ),
      );
    });
    if (board.bonus) parts.push(h('div', { class: 'rd-note' }, t('ui.requestsBonusDone')));
    else if (board.list.length > 1) parts.push(h('div', { class: 'rd-note' }, t('ui.requestsBonus', { n: board.list.length, bonus: r.bonus ?? 0 })));
    parts.push(h('div', { class: 'rd-note' }, t('ui.requestsNew')));
    return parts;
  }

  give(id) {
    this.village.give(id);
    this.refresh();
  }

  deliver(i) {
    this.village.deliver(i);
    this.refresh();
  }

  // A pixel-art meadow in the buildings' style, drawn pixel by pixel (each art pixel is 2×2): textured
  // grass, the river under the bridge (down-right, like the bridge's stream) between grey stone banks,
  // Bridgy's field on the near bank, pebbled dirt roads (field → bridge → square → every building),
  // and bushes with flowers.
  background() {
    const S = 2;
    const cv = h('canvas', { class: 'village-bg', width: W * S, height: H * S });
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(W * S, H * S);
    const grid = new Uint32Array(W * H); // 0xRRGGBB per art pixel
    const noise = (x, y, k = 0) => {
      let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(k, 1442695041)) | 0;
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    };
    const set = (x, y, c) => {
      if (x >= 0 && y >= 0 && x < W && y < H) grid[(y | 0) * W + (x | 0)] = c;
    };
    const get = (x, y) => grid[(y | 0) * W + (x | 0)];
    const pick = (r, list) => list.find(([p]) => (r -= p) < 0)[1];
    // grass: clumps of four greens
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const r = noise(x >> 2, y >> 1, 1) * 0.6 + noise(x, y, 2) * 0.4;
        set(x, y, pick(r, [[0.18, 0x5aa83a], [0.6, 0x6cba44], [0.2, 0x7bc94f], [1, 0x92d95e]]));
      }
    }
    // Bridgy's field: furrows with sprouts, and a fence
    for (let y = 205; y < 262; y++) {
      for (let x = 16; x < 120; x++) {
        const u = x - 2 * (y - 205); // along the rows (up-right)
        const v = x / 2 + (y - 205); // across them
        if (u < -70 || u > 30 || v < 12 || v > 76) continue;
        const row = Math.floor(v / 8);
        const inRow = v - row * 8;
        set(x, y, inRow < 2 ? 0x7a4e2e : inRow < 6 ? (noise(x, y, 3) < 0.15 ? 0x8a5a36 : 0x9a6a44) : 0x6cba44);
        if (inRow >= 2 && inRow < 4 && (x + row * 3) % 7 === 0) {
          set(x, y - 1, 0x4fae32);
          set(x - 1, y - 2, 0x6fd046);
          set(x + 1, y - 2, 0x6fd046);
        }
      }
    }
    // roads: L-shaped along the isometric axes, dirt with pebbles and darker edges
    const segs = [];
    const road = (a, b) => {
      const k = ((b[0] - a[0]) / 2 - (b[1] - a[1])) / 2;
      const c = [a[0] + 2 * k, a[1] - k];
      segs.push([a, c], [c, b]);
    };
    const at = (b) => [(b.x * W) / 100, (b.y * H) / 100];
    const v = this.village;
    const bridge = v.building('Bridge');
    const square = v.buildings.find((b) => b.icon === 'square') || bridge;
    if (bridge) {
      const [bx, by] = at(bridge);
      const reach = ((bridge.w ?? 22) * W) / 100 / 2.6; // the bridge's ends, along its deck (up-right)
      road([70, 222], [bx - reach, by + reach / 2]);
      road([bx + reach, by - reach / 2], at(square));
      for (const b of v.buildings) if (b !== bridge && b !== square) road(at(square), [at(b)[0], at(b)[1] + ((b.w ?? 17) * W) / 100 / 5]);
    }
    for (const [[x1, y1], [x2, y2]] of segs) {
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      for (let y = Math.floor(Math.min(y1, y2) - 6); y <= Math.max(y1, y2) + 6; y++) {
        for (let x = Math.floor(Math.min(x1, x2) - 6); x <= Math.max(x1, x2) + 6; x++) {
          const t = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / (len * len)));
          const d = Math.hypot(x - x1 - t * (x2 - x1), y - y1 - t * (y2 - y1));
          if (d > 4.6 || x < 0 || y < 0 || x >= W || y >= H) continue;
          const old = get(x, y);
          if (d > 3.4) {
            if (old !== 0xc9965a && old !== 0xd6a76c && old !== 0x9c8d80) set(x, y, 0xa0703f);
          } else set(x, y, noise(x, y, 4) < 0.05 ? 0x9c8d80 : noise(x >> 1, y, 5) < 0.5 ? 0xc9965a : 0xd6a76c);
        }
      }
    }
    // the river: water between stone banks
    const half = RIVER.width / 2;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = y - (x / 2 + RIVER.at);
        const a = Math.abs(d);
        if (a < half) {
          const edge = half - a;
          let c = edge < 3 ? 0x1f6cc4 : edge < 7 ? 0x2b84dc : 0x3597ea;
          if (noise(Math.floor((x - 2 * y) / 9), y >> 1, 6) < 0.12 && edge > 4) c = 0x7fcaf8;
          if (noise(x >> 2, y, 7) < 0.02 && edge > 4) c = 0xe8f8ff;
          set(x, y, c);
        } else if (a < half + 7) {
          const k = a - half; // 0 at the water … 6 at the grass
          const block = Math.floor((x + (d < 0 ? 0 : 4)) / 8);
          const tone = [0x8b939b, 0x9aa2aa, 0x7d858c][Math.floor(noise(block, d < 0 ? 1 : 2, 8) * 3)];
          let c = k > 6 ? 0x3c3f42 : (x + (d < 0 ? 0 : 4)) % 8 === 0 || k === 3 ? 0x5c636b : k > 5 ? 0xb9c0c6 : tone;
          if (k >= 6) c = 0x3c3f42;
          if (noise(x, y, 9) < 0.07) c = 0x5ea83d;
          set(x, y, c);
        }
      }
    }
    // bushes and flowers on the grass (never on the water, the roads or the field)
    const grass = new Set([0x5aa83a, 0x6cba44, 0x7bc94f, 0x92d95e]);
    for (let i = 0; i < 70; i++) {
      const cx = Math.floor(noise(i, 1, 10) * W);
      const cy = Math.floor(noise(i, 2, 10) * H);
      const r = 3 + Math.floor(noise(i, 3, 10) * 4);
      if (![[0, 0], [r, 0], [-r, 0], [0, r]].every(([dx, dy]) => grass.has(get(cx + dx, Math.min(H - 1, cy + dy))))) continue;
      for (let y = -r - 1; y <= r + 1; y++) {
        for (let x = -r - 1; x <= r + 1; x++) {
          const q = (x * x) / (r * r) + (y * y) / (r * r * 0.7);
          if (q > 1.35) continue;
          set(cx + x, cy + y, q > 1 ? 0x24461e : x + y < -r * 0.6 ? 0x8fdc5a : x + y > r * 0.5 ? 0x3b8a2c : 0x5cb83c);
        }
      }
      if (i % 2) for (const [dx, dy] of [[-1, -1], [2, 0]]) set(cx + dx, cy + dy, 0xffffff);
    }
    for (let i = 0; i < 160; i++) {
      const x = Math.floor(noise(i, 4, 11) * W);
      const y = Math.floor(noise(i, 5, 11) * H);
      if (!grass.has(get(x, y))) continue;
      if (i % 4) {
        set(x, y, 0x4a9a30);
        set(x + 1, y - 1, 0x4a9a30);
        set(x + 2, y, 0x4a9a30);
      } else {
        set(x, y, i % 8 ? 0xffffff : 0xffd84a);
        set(x, y + 1, 0x4a9a30);
      }
    }
    // art pixels → canvas pixels
    for (let y = 0; y < H * S; y++) {
      for (let x = 0; x < W * S; x++) {
        const c = grid[((y / S) | 0) * W + ((x / S) | 0)];
        const o = (y * W * S + x) * 4;
        img.data[o] = c >> 16;
        img.data[o + 1] = (c >> 8) & 255;
        img.data[o + 2] = c & 255;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }
}
