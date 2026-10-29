// Draws the ranch on a canvas: a meadow with paths, every open area (its fence, things, troughs with
// their feed or water, eggs, dirt, animals and drone) and the ruins of the areas not bought yet.
// Built on FarmView (the canvas, the drone, puffs and popups); map squares count up from the
// bottom-left like the farm's, and each area adds its origin to its own coordinates.
import { h } from './dom.js';
import { FarmView } from './farmView.js';

const WALK = 0.45; // game seconds an animal takes for one square
const FILL = { Water: '#3d8fe0', Grain: '#ffd541', Bale: '#c9b458' };

export class RanchView extends FarmView {
  // game: the Ranch. focus: an area id to zoom to (phones), or null for the whole ranch.
  constructor(opts) {
    super(opts);
    this.focus = null;
    this.selected = null; // the area whose code tab is open (outlined)
  }

  bindEvents() {
    const ev = this.game.events;
    const on = (name, fn) => this.offs.push(ev.on(name, (e) => fn(this.mapXY(e.pen, e.x, e.y), e)));
    on('pickup', (m, e) => {
      this.puff(m.x, m.y, ['#ffffff', '#f4ead0', '#ffd541'], 8);
      this.popup(m.x, m.y, '+1', `item:${e.item}`);
    });
    on('laid', (m) => this.puff(m.x, m.y, ['#ffffff', '#f4ead0'], 4));
    on('fill', (m, e) => this.puff(m.x, m.y, e.item === 'Water' ? ['#249fde', '#a6fcdb', '#ffffff'] : ['#ffd541', '#f9a31b'], 10));
    on('clean', (m) => this.puff(m.x, m.y, ['#dba463', '#ffffff'], 8));
    on('pet', (m) => this.puff(m.x, m.y, ['#f48fb1', '#e0457b', '#ffffff'], 10));
    on('build', (m) => this.puff(m.x, m.y, ['#bb7547', '#dba463', '#71413b'], 12));
    on('unload', (m) => this.puff(m.x, m.y, ['#ffd541', '#ffffff'], 8));
    const market = (fn) => (e) => {
      const id = this.game.marketId;
      if (this.game.pens.has(id)) fn(this.mapXY(id, 1, 1), e);
    };
    this.offs.push(
      ev.on('sold', market((m, e) => this.popup(m.x, m.y, `+${e.dram} ֏`, `item:${e.item}`))),
      ev.on('order', market((m, e) => this.popup(m.x, m.y, `+${e.pay} ֏`, 'item:Dram'))),
      ev.on('shop', () => (this.layoutKey = '')),
    );
  }

  mapXY(penId, x, y) {
    const o = this.game.origin(penId);
    return { x: o.x + x, y: o.y + y };
  }

  // The map squares shown: the whole ranch, or the focused area (as big as it is now) with a path around it.
  viewRect() {
    const g = this.game;
    if (this.focus && g.pens.has(this.focus)) {
      const o = g.origin(this.focus);
      const s = g.pens.get(this.focus).size;
      return { x: o.x - 1, y: o.y - 1, w: s + 2, h: s + 2 };
    }
    return { x: 0, y: 0, w: g.world.width, h: g.world.height };
  }

  layout() {
    const g = this.game;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const v = this.viewRect();
    const sizes = [...g.pens.values()].map((p) => `${p.id}${p.size}`).join();
    const key = `${W}x${H}:${v.x},${v.y},${v.w}:${sizes}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    let tile = Math.min((W * 0.98) / v.w, (H * 0.98) / v.h, 96 * this.dpr);
    tile = tile >= 32 ? Math.floor(tile / 8) * 8 : Math.floor(tile);
    this.tile = Math.max(4, tile);
    this.ox = Math.floor(W / 2 - (v.x + v.w / 2) * this.tile);
    this.oy = Math.floor(H / 2 - (g.world.height - (v.y + v.h / 2)) * this.tile);
    this.buildBackground();
  }

  // Meadow, paths between the areas, each area's ground and fence, or its ruin (cached).
  buildBackground() {
    const g = this.game;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const tile = this.tile;
    const bg = document.createElement('canvas');
    bg.width = W;
    bg.height = H;
    const ctx = bg.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const mt = Math.max(tile, 24 * this.dpr);
    for (let y = this.oy % mt - mt, j = 0; y < H; y += mt, j++) {
      for (let x = this.ox % mt - mt, i = 0; x < W; x += mt, i++) ctx.drawImage(this.sprites.get(`meadow${(i * 7 + j * 3) & 3}`), x, y, mt, mt);
    }
    // dirt paths between the areas
    const r0 = this.tileRect(0, g.world.height - 1);
    ctx.fillStyle = '#c9a26b';
    ctx.fillRect(r0.x, r0.y, g.world.width * tile, g.world.height * tile);
    for (const id of g.areaIds()) {
      const o = g.origin(id);
      const s = g.areaSize;
      const a = this.tileRect(o.x, o.y + s - 1);
      ctx.fillStyle = '#7fb24a';
      ctx.fillRect(a.x, a.y, s * tile, s * tile);
      if (g.pens.has(id)) this.drawArea(ctx, g.pens.get(id));
      else this.drawRuin(ctx, id);
    }
    this.bg = bg;
  }

  drawArea(ctx, pen) {
    const g = this.game;
    const tile = this.tile;
    const o = g.origin(pen.id);
    const n = pen.size;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const r = this.tileRect(o.x + x, o.y + y);
        ctx.drawImage(this.sprites.get(pen.cfg.animal ? `grassland${(x * 3 + y * 5) & 3}` : `soil${(x + y) & 1}`), r.x, r.y, tile, tile);
      }
    }
    const top = this.tileRect(o.x, o.y + n - 1);
    this.fence(ctx, top.x, top.y, n * tile, n * tile);
  }

  // A wooden fence around a rectangle (canvas pixels).
  fence(ctx, x, y, w, hgt, broken = false) {
    const px = Math.max(1, Math.min(this.tile / 16, 3)) * this.dpr;
    ctx.fillStyle = broken ? '#8a6a4a' : '#71413b';
    const rail = (ax, ay, bw, bh) => ctx.fillRect(ax, ay, bw, bh);
    if (broken) {
      for (let i = 0; i < 6; i++) rail(x + (i * w) / 6, y - px, w / 10, px * 2);
      for (let i = 0; i < 6; i++) rail(x + (i * w) / 6 + w / 12, y + hgt - px, w / 10, px * 2);
      return;
    }
    rail(x - px, y - px, w + 2 * px, px * 2);
    rail(x - px, y + hgt - px, w + 2 * px, px * 2);
    rail(x - px, y - px, px * 2, hgt + 2 * px);
    rail(x + w - px, y - px, px * 2, hgt + 2 * px);
    ctx.fillStyle = '#3b1725';
    const step = this.tile;
    for (let i = 0; i <= Math.round(w / step); i++) {
      ctx.fillRect(x + i * step - px * 1.5, y - px * 2.5, px * 3, px * 5);
      ctx.fillRect(x + i * step - px * 1.5, y + hgt - px * 2.5, px * 3, px * 5);
    }
    for (let j = 1; j < Math.round(hgt / step); j++) {
      ctx.fillRect(x - px * 1.5, y + j * step - px * 2.5, px * 3, px * 5);
      ctx.fillRect(x + w - px * 1.5, y + j * step - px * 2.5, px * 3, px * 5);
    }
  }

  // An area not bought yet: faded ground, a broken fence, its icon and name («soon» if it can't be bought).
  drawRuin(ctx, id) {
    const g = this.game;
    const cfg = g.cfg.areas[id];
    const s = g.areaSize;
    const o = g.origin(id);
    const r = this.tileRect(o.x, o.y + s - 1);
    const size = s * this.tile;
    ctx.fillStyle = 'rgba(90, 70, 40, 0.35)';
    ctx.fillRect(r.x, r.y, size, size);
    this.fence(ctx, r.x + this.tile, r.y + this.tile, size - 2 * this.tile, size - 2 * this.tile, true);
    const font = Math.max(10, Math.round(size / 5));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.75;
    ctx.font = `${font}px sans-serif`;
    ctx.fillText(cfg.icon, r.x + size / 2, r.y + size * 0.42);
    ctx.globalAlpha = 1;
    const small = Math.max(9, Math.round(size / 11));
    ctx.font = `800 ${small}px 'Noto Sans Armenian', sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(40, 30, 20, 0.8)';
    ctx.lineWidth = Math.max(2, small / 4);
    const label = cfg.available === false ? `${cfg.name} · ${this.i18n.t('ui.ranchShopSoon')}` : cfg.name;
    ctx.strokeText(label, r.x + size / 2, r.y + size * 0.72);
    ctx.fillText(label, r.x + size / 2, r.y + size * 0.72);
  }

  render(now) {
    this.resize();
    this.layout();
    const ctx = this.ctx;
    const g = this.game;
    const t = now / 1000;
    g.syncAll();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.bg, 0, 0);
    for (const pen of g.pens.values()) this.drawPen(ctx, pen, t);
    for (const pen of g.pens.values()) this.drawPenDrone(ctx, pen, t);
    if (this.hover) {
      const r = this.tileRect(this.hover.mx0, this.hover.my0);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = Math.max(2, this.dpr * 2);
      ctx.setLineDash([6 * this.dpr, 4 * this.dpr]);
      ctx.strokeRect(r.x + 1, r.y + 1, r.s - 2, r.s - 2);
      ctx.setLineDash([]);
      this.updateTip();
    }
    this.drawEffects(ctx);
  }

  drawPen(ctx, pen, t) {
    const g = this.game;
    const tile = this.tile;
    const o = g.origin(pen.id);
    const need = g.cfg.needs || {};
    if (this.selected === pen.id) {
      const top = this.tileRect(o.x, o.y + pen.size - 1);
      ctx.strokeStyle = 'rgba(255, 213, 65, 0.9)';
      ctx.lineWidth = Math.max(2, tile * 0.06);
      ctx.strokeRect(top.x - tile * 0.12, top.y - tile * 0.12, pen.size * tile + tile * 0.24, pen.size * tile + tile * 0.24);
    }
    for (const [k, v] of Object.entries(pen.dirt)) {
      if (v < 15) continue;
      const [x, y] = k.split(',').map(Number);
      const r = this.tileRect(o.x + x, o.y + y);
      ctx.fillStyle = `rgba(92, 58, 30, ${Math.min(0.55, v / 160)})`;
      for (let i = 0; i < 4; i++) {
        const sx = ((x * 7 + y * 3 + i * 5) % 10) / 14;
        const sy = ((x * 3 + y * 11 + i * 7) % 10) / 14;
        ctx.beginPath();
        ctx.ellipse(r.x + tile * (0.15 + sx), r.y + tile * (0.2 + sy), tile * 0.14, tile * 0.09, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const cap = (g.cfg.troughs && g.cfg.troughs.capacity) || 10;
    for (const thing of pen.objects) {
      const r = this.tileRect(o.x + thing.x, o.y + thing.y);
      ctx.drawImage(this.sprites.get(`thing:${thing.type}`), r.x, r.y, tile, tile);
      if ((thing.type === 'FeedTrough' || thing.type === 'WaterTrough') && thing.amount > 0) {
        const fill = thing.type === 'WaterTrough' ? FILL.Water : FILL[pen.animalCfg && pen.animalCfg.feed] || FILL.Grain;
        ctx.fillStyle = fill;
        const k = Math.min(1, thing.amount / cap);
        ctx.fillRect(r.x + tile * 0.19, r.y + tile * (0.44 + 0.18 * (1 - k)), tile * 0.62, tile * 0.18 * k + 1);
      }
    }
    for (const [k, item] of Object.entries(pen.ground)) {
      const [x, y] = k.split(',').map(Number);
      const r = this.tileRect(o.x + x, o.y + y);
      ctx.drawImage(this.sprites.get(`item:${item}`), r.x + tile * 0.3, r.y + tile * 0.45, tile * 0.45, tile * 0.45);
    }
    const sprite = pen.cfg.animal && this.sprites.get(pen.cfg.animal === 'Cow' ? 'cow' : 'hen');
    const fx = this.fx;
    for (const a of pen.animals) {
      const p = a.movedAt === undefined ? 1 : Math.min(1, Math.max(0, (g.time - a.movedAt) / WALK));
      const ax = a.fromX === undefined ? a.x : a.fromX + (a.x - a.fromX) * p;
      const ay = a.fromY === undefined ? a.y : a.fromY + (a.y - a.fromY) * p;
      const r = this.tileRect(o.x + ax, o.y + ay);
      const bob = fx && p < 1 ? -Math.abs(Math.sin(p * Math.PI * 2)) * tile * 0.06 : 0;
      const left = a.fromX !== undefined && a.x < a.fromX;
      const size = pen.cfg.animal === 'Cow' ? tile * 1.1 : tile * 0.85;
      ctx.save();
      ctx.translate(r.x + tile / 2, r.y + tile - size * 0.05 + bob);
      if (left) ctx.scale(-1, 1);
      if (a.mood < need.sad) ctx.globalAlpha = 0.75;
      ctx.drawImage(sprite, -size / 2, -size, size, size);
      ctx.restore();
      const icon = a.prod >= 1 && !pen.animalCfg.lays ? 'item:Milk' : a.thirst >= need.seek ? 'item:Water' : a.hunger >= need.seek ? `item:${pen.animalCfg.feed}` : null;
      if (icon) {
        const s = tile * 0.36;
        const wob = fx ? Math.sin(t * 4 + a.id) * tile * 0.03 : 0;
        ctx.globalAlpha = 0.95;
        ctx.drawImage(this.sprites.get(icon), r.x + tile * 0.62, r.y - tile * 0.12 + wob, s, s);
        ctx.globalAlpha = 1;
      }
    }
  }

  // The area's drone (drawn by FarmView in map squares) and what it holds.
  drawPenDrone(ctx, pen, t) {
    const o = this.game.origin(pen.id);
    const [ox, oy] = [this.ox, this.oy];
    this.ox += o.x * this.tile;
    this.oy -= o.y * this.tile;
    this.drawDrone(ctx, pen.drone, t);
    const items = Object.entries(pen.drone.hands || {});
    if (items.length) {
      const pos = pen.drone.visualPosition(this.game.time);
      const r = this.tileRect(pos.x, pos.y);
      const s = this.tile * 0.3;
      items.slice(0, 3).forEach(([item], i) => ctx.drawImage(this.sprites.get(`item:${item}`), r.x + i * s * 0.8, r.y + this.tile - s, s, s));
    }
    [this.ox, this.oy] = [ox, oy];
  }

  // ---------------------------------------------------------------- hover tooltip

  onPointer(e) {
    if (this.tile === undefined) return;
    const rect = this.canvas.getBoundingClientRect();
    const g = this.game;
    const mx = Math.floor(((e.clientX - rect.left) * this.dpr - this.ox) / this.tile);
    const my = g.world.height - 1 - Math.floor(((e.clientY - rect.top) * this.dpr - this.oy) / this.tile);
    const id = g.areaIds().find((a) => {
      const o = g.origin(a);
      return mx >= o.x && my >= o.y && mx < o.x + g.areaSize && my < o.y + g.areaSize;
    });
    if (!id) {
      this.hover = null;
      this.tip.hidden = true;
      return;
    }
    const o = g.origin(id);
    this.hover = { id, x: mx - o.x, y: my - o.y, mx0: mx, my0: my, mx: e.clientX - rect.left, my: e.clientY - rect.top };
    this.updateTip();
  }

  updateTip() {
    const hv = this.hover;
    if (!hv) return;
    const g = this.game;
    const i18n = this.i18n;
    const t = i18n.t;
    const cfg = g.cfg.areas[hv.id];
    const pen = g.pens.get(hv.id);
    const lines = [h('div', {}, `${cfg.icon} ${cfg.name}`, pen && pen.inside(hv.x, hv.y) ? h('span', { class: 'coord' }, ` (${hv.x}, ${hv.y})`) : '')];
    if (!pen) lines.push(h('div', {}, cfg.available === false ? t('ui.ranchTipSoon') : t('ui.ranchTipRuins')));
    else if (pen.inside(hv.x, hv.y)) {
      const thing = pen.objectAt(hv.x, hv.y);
      if (thing) lines.push(h('div', {}, t(`machines.${thing.type}`), thing.type.endsWith('Trough') ? ` · ${thing.amount} / ${(g.cfg.troughs || {}).capacity || 10}` : ''));
      const item = pen.ground[`${hv.x},${hv.y}`];
      if (item) lines.push(h('div', {}, i18n.item(item)));
      const dirt = Math.round(pen.dirtAt(hv.x, hv.y));
      if (dirt >= 1) lines.push(h('div', {}, t('ui.ranchTipDirt', { n: dirt })));
      for (const a of pen.animalsAt(hv.x, hv.y)) {
        const bar = (label, v, bad) => h('div', { class: 'ranch-need' }, h('span', {}, label), h('div', { class: `bar ${bad ? 'bad' : ''}` }, h('span', { style: { width: `${Math.round(v)}%` } })));
        const need = g.cfg.needs;
        lines.push(h('div', { class: 'ranch-tip-animal' }, `${i18n.entity(a.type)} #${a.id}`));
        lines.push(bar(t('ui.ranchTipHunger'), a.hunger, a.hunger >= need.seek), bar(t('ui.ranchTipThirst'), a.thirst, a.thirst >= need.seek), bar(t('ui.ranchTipMood'), a.mood, a.mood < need.sad));
        if (a.prod >= 1 && !pen.animalCfg.lays) lines.push(h('div', {}, t('ui.ranchTipReady')));
      }
    }
    this.tip.replaceChildren(...lines);
    this.tip.hidden = false;
    const sw = this.stage.clientWidth;
    this.tip.style.left = `${Math.max(4, Math.min(hv.mx + 14, sw - this.tip.offsetWidth - 6))}px`;
    this.tip.style.top = `${Math.max(4, hv.my + 16)}px`;
  }
}
