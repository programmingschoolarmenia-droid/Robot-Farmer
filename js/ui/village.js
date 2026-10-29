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
      spots.push(this.spot({ x: r.x ?? 44, y: r.y ?? 33, w: r.w ?? 7 }, pixelImg(sprites.url('village:board', 4), '', ''), this.app.i18n.t('ui.villageBoard'), left ? `📜 ${left}` : '✓', 'board', 'repaired'));
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

  // The meadow in isometric tiles, the river under the bridge (down-right, like the bridge's stream),
  // Bridgy's field on the near bank, and dirt roads: field → bridge → square → every building.
  background() {
    const cv = h('canvas', { class: 'pixel village-bg', width: W, height: H });
    const ctx = cv.getContext('2d');
    const at = (b) => [(b.x * W) / 100, (b.y * H) / 100];
    const poly = (color, pts) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.fill();
    };
    for (let r = 0; r * 4 < H + 8; r++) {
      for (let c = -1; c * 16 < W + 16; c++) {
        const x = c * 16 + (r % 2) * 8;
        const y = r * 4;
        poly(r % 2 ? '#a3d571' : '#9bcf69', [[x, y - 4], [x + 8, y], [x, y + 4], [x - 8, y]]);
      }
    }
    for (let i = 0; i < 260; i++) {
      const n = (i * 2654435761) >>> 0;
      ctx.fillStyle = i % 9 === 0 ? (i % 2 ? '#ffffff' : '#ffe066') : '#7fb552';
      ctx.fillRect(n % W, (n >>> 12) % H, i % 9 === 0 ? 1 : 2, 1);
    }
    const band = (extra) => [[0, RIVER.at - extra], [W, RIVER.at + W / 2 - extra], [W, RIVER.at + W / 2 + extra], [0, RIVER.at + extra]];
    const half = RIVER.width / 2;
    poly('#6aa84a', band(half + 5));
    poly('#e3c68d', band(half + 3));
    poly('#2f80d8', band(half));
    poly('#3ea6ee', band(half - 3));
    ctx.fillStyle = '#bfeeff';
    for (let x = 6; x < W; x += 23) for (const k of [-6, 5]) ctx.fillRect(x + ((x * 7) % 11), x / 2 + RIVER.at + k + ((x * 3) % 5), 6, 1);
    // Bridgy's field: rows of soil with sprouts, on the near (lower-left) bank.
    for (let i = 0; i < 4; i++) {
      const x = 24 + i * 12;
      const y = 238 + i * 6;
      poly('#9a6a44', [[x, y], [x + 40, y - 20], [x + 48, y - 16], [x + 8, y + 4]]);
      ctx.fillStyle = '#5fbf3a';
      for (let k = 0; k < 5; k++) ctx.fillRect(x + 6 + k * 8, y - 3 - k * 4, 2, 2);
    }
    // Roads along the isometric axes: an L from a to b (up-right first, then down-right).
    const road = (a, b) => {
      const s = ((b[0] - a[0]) / 2 - (b[1] - a[1])) / 2;
      const corner = [a[0] + 2 * s, a[1] - s];
      for (const [color, width] of [['#b88a50', 9], ['#d6ad6b', 7]]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(...a);
        ctx.lineTo(...corner);
        ctx.lineTo(...b);
        ctx.stroke();
      }
    };
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
    return cv;
  }
}
