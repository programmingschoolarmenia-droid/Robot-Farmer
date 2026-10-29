// The village screen: a painted map of the village across the river (ruins turn into buildings as
// they are repaired), each building's needs, unlocks, recipes and story, and the villagers' requests.
import { h, pixelImg } from './dom.js';
import { formatCount } from '../core/util.js';

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
    this.map = h('div', { class: 'village-map' }, this.background());
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
      return this.spot(b.x, b.y, `${state === 'repaired' ? 'building' : 'ruin'}:${b.icon}`, b.name, badge, b.id, state);
    });
    const r = village.cfg.requests || {};
    if (village.requestsOpen) {
      const left = village.requests().list.filter((q) => !q.done).length;
      spots.push(this.spot(r.x ?? 64, r.y ?? 52, 'building:board', this.app.i18n.t('ui.villageBoard'), left ? `📜 ${left}` : '✓', 'board', 'repaired'));
    }
    this.map.replaceChildren(this.map.firstChild, ...spots);
    this.panel.replaceChildren(...(this.selected === 'board' ? this.board() : this.buildingPanel(village.building(this.selected))));
  }

  spot(x, y, sprite, name, badge, id, state) {
    return h(
      'button',
      { class: `village-spot ${state}${this.selected === id ? ' selected' : ''}${id === 'Bridge' ? ' bridge' : ''}`, style: { left: `${x}%`, top: `${y}%` }, onclick: () => this.select(id) },
      pixelImg(this.app.sprites.url(sprite, 3), '', ''),
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
      h('div', { class: 'rd-head' }, h('div', { class: 'rd-icon village-panel-icon' }, pixelImg(sprites.url(`${state === 'repaired' ? 'building' : 'ruin'}:${b.icon}`, 2), '', '')), h('div', { class: 'rd-name' }, b.name)),
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
    if (board.list.length) parts.push(h('div', { class: 'rd-note' }, board.bonus ? t('ui.requestsBonusDone') : t('ui.requestsBonus', { n: board.list.length, bonus: r.bonus ?? 0 })));
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

  // The meadow, the river with the bridge's road from Bridgy's farm (left) to the village square.
  background() {
    const W = 320;
    const H = 200;
    const cv = h('canvas', { class: 'pixel village-bg', width: W, height: H });
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < H; y += 16) for (let x = 0; x < W; x += 16) ctx.drawImage(this.app.sprites.get(`meadow${((x * 7 + y * 13) >> 4) % 4}`), x, y, 16, 16);
    ctx.fillStyle = '#dba463';
    ctx.fillRect(0, 112, W * 0.72, 10);
    ctx.fillRect(W * 0.6, 60, 10, 110);
    ctx.fillStyle = '#c9925a';
    ctx.fillRect(0, 122, W * 0.72, 2);
    for (let y = 0; y < H; y++) {
      const x = W * 0.24 + Math.sin(y / 14) * 5;
      ctx.fillStyle = '#285cc4';
      ctx.fillRect(x - 1, y, 22, 1);
      ctx.fillStyle = '#249fde';
      ctx.fillRect(x + 1, y, 18, 1);
      if ((y >> 2) % 6 === 0) {
        ctx.fillStyle = '#a6fcdb';
        ctx.fillRect(x + 4 + ((y * 3) % 9), y, 4, 1);
      }
    }
    ctx.fillStyle = '#71413b';
    for (let x = 4; x < 40; x += 9) ctx.fillRect(x, 100, 2, 10);
    ctx.fillRect(2, 102, 40, 2);
    return cv;
  }
}
