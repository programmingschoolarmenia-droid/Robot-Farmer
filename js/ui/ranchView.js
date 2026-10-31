// Draws the ranch on a canvas: one fenced field cut into equal squares, one for every area (map.layout).
// An open area fills its square with its pen (a bigger pen gets more, smaller tiles, like the farm):
// ground, things, troughs with their feed or water, eggs, dirt, animals and the drone. An area not
// bought yet is a ruin. Built on FarmView (the canvas, the drone, puffs and popups): withPen() points
// FarmView's tile geometry at one pen, whose squares count up from its bottom-left corner.
import { h } from './dom.js';
import { FarmView, SEASON_TINT } from './farmView.js';

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
    const on = (name, fn) =>
      this.offs.push(
        ev.on(name, (e) => {
          const pen = this.game.pens.get(e.pen);
          if (pen && this.cellPx) this.withPen(pen, () => fn(e));
        }),
      );
    on('pickup', (e) => {
      this.puff(e.x, e.y, ['#ffffff', '#f4ead0', '#ffd541'], 8);
      this.popup(e.x, e.y, '+1', `item:${e.item}`);
    });
    on('laid', (e) => this.puff(e.x, e.y, ['#ffffff', '#f4ead0'], 4));
    on('fill', (e) => this.puff(e.x, e.y, e.item === 'Water' ? ['#249fde', '#a6fcdb', '#ffffff'] : ['#ffd541', '#f9a31b'], 10));
    on('clean', (e) => this.puff(e.x, e.y, ['#dba463', '#ffffff'], 8));
    on('pet', (e) => this.puff(e.x, e.y, ['#f48fb1', '#e0457b', '#ffffff'], 10));
    on('build', (e) => this.puff(e.x, e.y, ['#bb7547', '#dba463', '#71413b'], 12));
    on('unload', (e) => this.puff(e.x, e.y, ['#ffd541', '#ffffff'], 8));
    on('born', (e) => this.puff(e.x, e.y, ['#ffffff', '#f7a8c4', '#ffd541'], 14));
    on('heal', (e) => this.puff(e.x, e.y, ['#59c135', '#ffffff'], 12));
    on('hole', (e) => this.puff(e.x, e.y, ['#71413b', '#bb7547'], 12));
    on('made', (e) => this.popup(e.x, e.y, '✓', `item:${e.item}`));
    const market = (fn) => (e) => {
      const pen = this.game.pens.get(this.game.marketId);
      if (pen && this.cellPx) this.withPen(pen, () => fn(e));
    };
    this.offs.push(
      ev.on('sold', market((e) => this.popup(1, 1, `+${e.dram} ֏`, `item:${e.item}`))),
      ev.on('order', market((e) => this.popup(1, 1, `+${e.pay} ֏`, 'item:Dram'))),
      ev.on('shop', () => (this.layoutKey = '')),
    );
  }

  // ---------------------------------------------------------------- geometry

  // Canvas pixels of an area's square: { x, y, s } (top-left corner and side).
  cellRect(id) {
    const c = this.game.cell(id);
    return { x: this.fx0 + c.col * this.cellPx, y: this.fy0 + c.row * this.cellPx, s: this.cellPx };
  }

  // A pen inside its square, a little inset from the fences: { x, y, tile } (the top-left corner).
  penRect(pen) {
    const r = this.cellRect(pen.id);
    const n = pen.size;
    const tile = Math.max(2, Math.floor((r.s - 2 * this.inset) / n));
    return { x: Math.round(r.x + (r.s - n * tile) / 2), y: Math.round(r.y + (r.s - n * tile) / 2), tile };
  }

  // Runs fn with FarmView's tileRect / center / drawDrone measuring in this pen's squares.
  withPen(pen, fn) {
    const saved = [this.ox, this.oy, this.tile];
    const p = this.penRect(pen);
    this.tile = p.tile;
    this.ox = p.x;
    this.oy = p.y + (pen.size - this.game.world.height) * p.tile;
    try {
      return fn(p);
    } finally {
      [this.ox, this.oy, this.tile] = saved;
    }
  }

  layout() {
    const g = this.game;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const cols = g.world.width;
    const rows = g.world.height;
    const sizes = [...g.pens.values()].map((p) => `${p.id}${p.size}`).join();
    const key = `${W}x${H}:${this.focus}:${sizes}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    if (this.focus && g.pens.has(this.focus)) {
      // one square fills the panel; the rest of the field lies around it, off the canvas
      this.cellPx = Math.floor(Math.min(W, H) * 0.96);
      const c = g.cell(this.focus);
      this.fx0 = Math.floor((W - this.cellPx) / 2) - c.col * this.cellPx;
      this.fy0 = Math.floor((H - this.cellPx) / 2) - c.row * this.cellPx;
    } else {
      const room = Math.min(W / cols, (H * 0.94) / (rows + 0.35)); // + the gate's sign below
      this.cellPx = Math.floor(room * 0.94);
      this.fx0 = Math.floor((W - cols * this.cellPx) / 2);
      this.fy0 = Math.floor((H - (rows + 0.3) * this.cellPx) / 2);
    }
    this.px = Math.max(1, Math.min(this.cellPx / 90, 3 * this.dpr)); // one «pixel» of the fences
    this.inset = Math.ceil(this.px * 4);
    this.tile = Math.max(4, Math.floor(this.cellPx / 6)); // effects' size outside a pen
    this.ox = this.fx0;
    this.oy = this.fy0;
    this.buildBackground();
  }

  // Meadow, every area's ground or ruin, the fences and the gate (cached).
  buildBackground() {
    const g = this.game;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const bg = document.createElement('canvas');
    bg.width = W;
    bg.height = H;
    const ctx = bg.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const mt = Math.round(48 * this.dpr);
    for (let y = (this.fy0 % mt) - mt, j = 0; y < H; y += mt, j++) {
      for (let x = (this.fx0 % mt) - mt, i = 0; x < W; x += mt, i++) ctx.drawImage(this.sprites.get(`meadow${(i * 7 + j * 3) & 3}`), x, y, mt, mt);
    }
    const cols = g.world.width;
    const rows = g.world.height;
    const s = this.cellPx;
    ctx.fillStyle = 'rgba(40, 70, 30, 0.18)'; // soft shadow under the field
    ctx.fillRect(this.fx0 - s * 0.01, this.fy0 + s * 0.02, cols * s + s * 0.02, rows * s);
    for (const id of g.areaIds()) {
      const pen = g.pens.get(id);
      if (pen) this.drawGround(ctx, pen);
      else this.drawRuin(ctx, id);
    }
    // inner fences on the shared lines, then the outer fence with the gate
    for (let c = 1; c < cols; c++) this.fenceLine(ctx, this.fx0 + c * s, this.fy0, this.fx0 + c * s, this.fy0 + rows * s);
    for (let r = 1; r < rows; r++) this.fenceLine(ctx, this.fx0, this.fy0 + r * s, this.fx0 + cols * s, this.fy0 + r * s);
    const x1 = this.fx0 + cols * s;
    const y1 = this.fy0 + rows * s;
    this.fenceLine(ctx, this.fx0, this.fy0, x1, this.fy0);
    this.fenceLine(ctx, this.fx0, this.fy0, this.fx0, y1);
    this.fenceLine(ctx, x1, this.fy0, x1, y1);
    const gate = s * 0.36;
    const mid = this.fx0 + (cols * s) / 2;
    this.fenceLine(ctx, this.fx0, y1, mid - gate / 2, y1);
    this.fenceLine(ctx, mid + gate / 2, y1, x1, y1);
    this.drawSign(ctx, mid, y1 + s * 0.13, this.i18n.t('ui.ranchTitle'), Math.max(10 * this.dpr, s * 0.075));
    this.bg = bg;
  }

  // An open area's ground: grass for animals, packed soil for the market.
  drawGround(ctx, pen) {
    const cell = this.cellRect(pen.id);
    ctx.fillStyle = pen.cfg.animal ? '#5f9a3a' : '#9a6a44';
    ctx.fillRect(cell.x, cell.y, cell.s, cell.s);
    const p = this.penRect(pen);
    const n = pen.size;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const name = pen.cfg.animal ? `grassland${(x * 3 + y * 5) & 3}` : `soil${(x + y) & 1}`;
        ctx.drawImage(this.sprites.get(name), p.x + x * p.tile, p.y + (n - 1 - y) * p.tile, p.tile, p.tile);
      }
    }
  }

  // A wooden fence from (x0, y0) to (x1, y1) (canvas pixels, horizontal or vertical): two rails and posts.
  fenceLine(ctx, x0, y0, x1, y1) {
    const px = this.px;
    const flat = y0 === y1;
    const len = flat ? x1 - x0 : y1 - y0;
    if (len <= 0) return;
    const rail = (off) => {
      ctx.fillStyle = '#71413b';
      if (flat) ctx.fillRect(x0, y0 + off - px * 1.5, len, px * 3);
      else ctx.fillRect(x0 + off - px * 1.5, y0, px * 3, len);
      ctx.fillStyle = '#bb7547';
      if (flat) ctx.fillRect(x0, y0 + off - px * 0.75, len, px * 1.5);
      else ctx.fillRect(x0 + off - px * 0.75, y0, px * 1.5, len);
    };
    rail(-px * 1.6);
    rail(px * 1.6);
    const n = Math.max(1, Math.round(len / (this.cellPx / 6)));
    for (let i = 0; i <= n; i++) {
      const x = flat ? x0 + (len * i) / n : x0;
      const y = flat ? y0 : y0 + (len * i) / n;
      ctx.fillStyle = '#3b1725';
      ctx.fillRect(x - px * 2.5, y - px * 3.5, px * 5, px * 7);
      ctx.fillStyle = '#bb7547';
      ctx.fillRect(x - px * 1.5, y - px * 2.5, px * 3, px * 5);
      ctx.fillStyle = '#dba463';
      ctx.fillRect(x - px * 1.5, y - px * 2.5, px * 3, px);
    }
  }

  // A small wooden sign with a name, centred on (cx, cy).
  drawSign(ctx, cx, cy, text, font) {
    ctx.font = `800 ${Math.round(font)}px 'Noto Sans Armenian', sans-serif`;
    const w = ctx.measureText(text).width + font * 1.2;
    const hh = font * 1.6;
    const px = this.px;
    ctx.fillStyle = '#3b1725';
    ctx.fillRect(cx - w / 2 + font * 0.4, cy, px * 3, hh * 0.9);
    ctx.fillRect(cx + w / 2 - font * 0.4 - px * 3, cy, px * 3, hh * 0.9);
    ctx.fillRect(cx - w / 2 - px, cy - hh / 2 - px, w + 2 * px, hh + 2 * px);
    ctx.fillStyle = '#bb7547';
    ctx.fillRect(cx - w / 2, cy - hh / 2, w, hh);
    ctx.fillStyle = '#dba463';
    ctx.fillRect(cx - w / 2, cy - hh / 2, w, px * 1.5);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy + px * 0.5);
  }

  // An area not bought yet: weedy ground, broken boards, a fallen shed and its name on a sign
  // («soon» if it can't be bought yet).
  drawRuin(ctx, id) {
    const cfg = this.game.cfg.areas[id];
    const r = this.cellRect(id);
    const s = r.s;
    ctx.fillStyle = '#7c8a4a';
    ctx.fillRect(r.x, r.y, s, s);
    let seed = [...id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 8) / 16777216;
    const weed = this.sprites.get('weeds');
    for (let i = 0; i < 9; i++) {
      const w = s * (0.1 + rnd() * 0.06);
      ctx.drawImage(weed, r.x + rnd() * (s - w), r.y + rnd() * (s - w), w, w);
    }
    const board = this.sprites.get('brokenBoard');
    for (let i = 0; i < 3; i++) {
      const w = s * 0.18;
      ctx.drawImage(board, r.x + s * 0.06 + rnd() * s * 0.7, r.y + s * (0.08 + i * 0.3) + rnd() * s * 0.05, w, w);
    }
    const shed = s * 0.5;
    ctx.drawImage(this.sprites.get('ruinShed'), r.x + (s - shed) / 2, r.y + s * 0.14, shed, shed);
    const label = cfg.available === false ? `${cfg.name} · ${this.i18n.t('ui.ranchShopSoon')}` : cfg.name;
    this.drawSign(ctx, r.x + s / 2, r.y + s * 0.78, label, Math.max(9 * this.dpr, s * 0.065));
  }

  // ---------------------------------------------------------------- every frame

  render(now) {
    this.resize();
    this.layout();
    const ctx = this.ctx;
    const g = this.game;
    const t = now / 1000;
    g.syncAll();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.bg, 0, 0);
    for (const pen of g.pens.values()) this.withPen(pen, (p) => this.drawPen(ctx, pen, p, t));
    const cal = g.main.calendar;
    const tint = cal && cal.state && SEASON_TINT[cal.state.season];
    if (tint) {
      ctx.fillStyle = tint;
      ctx.fillRect(this.fx0, this.fy0, g.world.width * this.cellPx, g.world.height * this.cellPx);
    }
    for (const pen of g.pens.values()) this.withPen(pen, () => this.drawPenDrone(ctx, pen, t));
    if (this.selected && g.pens.has(this.selected)) {
      const c = this.cellRect(this.selected);
      const w = Math.max(2, this.px * 2);
      ctx.strokeStyle = 'rgba(255, 213, 65, 0.9)';
      ctx.lineWidth = w;
      ctx.strokeRect(c.x + this.inset * 0.6, c.y + this.inset * 0.6, c.s - this.inset * 1.2, c.s - this.inset * 1.2);
    }
    if (this.hover && this.hover.pen) {
      this.withPen(this.hover.pen, () => {
        const r = this.tileRect(this.hover.x, this.hover.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = Math.max(2, this.dpr * 2);
        ctx.setLineDash([6 * this.dpr, 4 * this.dpr]);
        ctx.strokeRect(r.x + 1, r.y + 1, r.s - 2, r.s - 2);
        ctx.setLineDash([]);
      });
    }
    if (this.hover) this.updateTip();
    this.drawEffects(ctx);
  }

  // One pen (inside withPen): dirt, things, eggs and animals.
  drawPen(ctx, pen, p, t) {
    const g = this.game;
    const tile = p.tile;
    const need = g.cfg.needs || {};
    for (const [k, v] of Object.entries(pen.dirt)) {
      if (v < 15) continue;
      const [x, y] = k.split(',').map(Number);
      const r = this.tileRect(x, y);
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
      const r = this.tileRect(thing.x, thing.y);
      ctx.drawImage(this.sprites.get(`thing:${thing.type}`), r.x, r.y, tile, tile);
      if ((thing.type === 'FeedTrough' || thing.type === 'WaterTrough') && thing.amount > 0) {
        ctx.fillStyle = thing.type === 'WaterTrough' ? FILL.Water : FILL[pen.animalCfg && pen.animalCfg.feed] || FILL.Grain;
        const k = Math.min(1, thing.amount / cap);
        ctx.fillRect(r.x + tile * 0.19, r.y + tile * (0.44 + 0.18 * (1 - k)), tile * 0.62, tile * 0.18 * k + 1);
      }
    }
    for (const o of pen.objects) {
      if (!o.making && !o.ready) continue;
      const r = this.tileRect(o.x, o.y);
      if (o.ready) ctx.drawImage(this.sprites.get(`item:${o.ready}`), r.x + tile * 0.55, r.y - tile * 0.1, tile * 0.42, tile * 0.42);
      else {
        const recipe = ((g.cfg.machines || {})[o.type] || {})[o.making];
        const k = recipe ? 1 - Math.max(0, o.until - g.time) / recipe.seconds : 0;
        ctx.fillStyle = 'rgba(20, 30, 40, 0.6)';
        ctx.fillRect(r.x + tile * 0.1, r.y + tile * 0.04, tile * 0.8, tile * 0.1);
        ctx.fillStyle = '#9cdb43';
        ctx.fillRect(r.x + tile * 0.1, r.y + tile * 0.04, tile * 0.8 * Math.min(1, k), tile * 0.1);
      }
    }
    for (const [k, item] of Object.entries(pen.ground)) {
      const [x, y] = k.split(',').map(Number);
      const r = this.tileRect(x, y);
      ctx.drawImage(this.sprites.get(`item:${item}`), r.x + tile * 0.3, r.y + tile * 0.45, tile * 0.45, tile * 0.45);
    }
    this.drawHoles(ctx, pen, p);
    if (!pen.cfg.animal) return;
    const kind = pen.cfg.animal.toLowerCase();
    const big = pen.cfg.animal === 'Cow';
    for (const a of pen.animals) {
      const q = a.movedAt === undefined ? 1 : Math.min(1, Math.max(0, (g.time - a.movedAt) / WALK));
      const ax = a.fromX === undefined ? a.x : a.fromX + (a.x - a.fromX) * q;
      const ay = a.fromY === undefined ? a.y : a.fromY + (a.y - a.fromY) * q;
      const r = this.tileRect(ax, ay);
      const bob = this.fx && q < 1 ? -Math.abs(Math.sin(q * Math.PI * 2)) * tile * 0.06 : 0;
      const left = a.fromX !== undefined && a.x < a.fromX;
      const size = (big ? tile * 1.1 : tile * 0.85) * (pen.young(a, g.time) ? 0.6 : 1);
      ctx.save();
      ctx.translate(r.x + tile / 2, r.y + tile - size * 0.05 + bob);
      if (left) ctx.scale(-1, 1);
      if (a.mood < need.sad) ctx.globalAlpha = 0.75;
      ctx.drawImage(this.sprites.get(a.color && this.sprites.has(`${kind}:${a.color}`) ? `${kind}:${a.color}` : kind), -size / 2, -size, size, size);
      ctx.restore();
      const ready = a.prod >= 1 && !pen.animalCfg.lays;
      const icon = a.sick ? 'item:Medicine' : ready ? `item:${pen.animalCfg.product}` : a.thirst >= need.seek ? 'item:Water' : a.hunger >= need.seek ? `item:${pen.animalCfg.feed}` : null;
      if (icon) {
        const s = tile * 0.36;
        const wob = this.fx ? Math.sin(t * 4 + a.id) * tile * 0.03 : 0;
        ctx.globalAlpha = 0.95;
        ctx.drawImage(this.sprites.get(icon), r.x + tile * 0.62, r.y - tile * 0.12 + wob, s, s);
        ctx.globalAlpha = 1;
      }
    }
  }

  // Holes in the pen's fence (inside withPen) and a sign with how many animals ran away.
  drawHoles(ctx, pen, p) {
    const cell = this.cellRect(pen.id);
    const px = this.px;
    for (const k of pen.holes()) {
      const [x, y, side] = k.split(',');
      const r = this.tileRect(Number(x), Number(y));
      const flat = side === 'N' || side === 'S';
      const at = { N: cell.y, S: cell.y + cell.s, W: cell.x, E: cell.x + cell.s }[side];
      ctx.fillStyle = '#5f9a3a';
      if (flat) ctx.fillRect(r.x + p.tile * 0.15, at - px * 3.6, p.tile * 0.7, px * 7.2);
      else ctx.fillRect(at - px * 3.6, r.y + p.tile * 0.15, px * 7.2, p.tile * 0.7);
      const b = p.tile * 0.4;
      ctx.drawImage(this.sprites.get('brokenBoard'), flat ? r.x + p.tile * 0.3 : at - b / 2, flat ? at - b / 2 : r.y + p.tile * 0.3, b, b);
    }
    if (!pen.runaways.length) return;
    const s = Math.max(14 * this.dpr, cell.s * 0.12);
    const kind = pen.cfg.animal.toLowerCase();
    ctx.globalAlpha = 0.85;
    ctx.drawImage(this.sprites.get(kind), cell.x + cell.s - s * 2.2, cell.y + this.inset, s, s);
    ctx.globalAlpha = 1;
    ctx.font = `800 ${Math.round(s * 0.6)}px 'Noto Sans Armenian', sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, s / 8);
    ctx.strokeStyle = '#3b1725';
    ctx.fillStyle = '#ffffff';
    const label = `×${pen.runaways.length}`;
    ctx.strokeText(label, cell.x + cell.s - s * 1.15, cell.y + this.inset + s / 2);
    ctx.fillText(label, cell.x + cell.s - s * 1.15, cell.y + this.inset + s / 2);
  }

  // The area's drones (inside withPen) and what each holds.
  drawPenDrone(ctx, pen, t) {
    const drones = pen.runner.drones.filter((d) => d === pen.drone || ['running', 'waiting', 'listening'].includes(d.state));
    if (!drones.includes(pen.drone)) drones.unshift(pen.drone);
    for (const d of drones) {
      this.drawDrone(ctx, d, t);
      const items = Object.entries(d.hands || {});
      if (!items.length) continue;
      const pos = d.visualPosition(this.game.time);
      const r = this.tileRect(pos.x, pos.y);
      const s = this.tile * 0.3;
      items.slice(0, 3).forEach(([item], i) => ctx.drawImage(this.sprites.get(`item:${item}`), r.x + i * s * 0.8, r.y + this.tile - s, s, s));
    }
  }

  // ---------------------------------------------------------------- hover tooltip

  onPointer(e) {
    if (!this.cellPx) return;
    const rect = this.canvas.getBoundingClientRect();
    const g = this.game;
    const mx = (e.clientX - rect.left) * this.dpr;
    const my = (e.clientY - rect.top) * this.dpr;
    const id = g.areaIds().find((a) => {
      const c = this.cellRect(a);
      return mx >= c.x && my >= c.y && mx < c.x + c.s && my < c.y + c.s;
    });
    if (!id) {
      this.hover = null;
      this.tip.hidden = true;
      return;
    }
    const pen = g.pens.get(id) || null;
    let x = -1;
    let y = -1;
    if (pen) {
      const p = this.penRect(pen);
      x = Math.floor((mx - p.x) / p.tile);
      y = pen.size - 1 - Math.floor((my - p.y) / p.tile);
    }
    this.hover = { id, pen: pen && pen.inside(x, y) ? pen : null, x, y, mx: e.clientX - rect.left, my: e.clientY - rect.top };
    this.updateTip();
  }

  updateTip() {
    const hv = this.hover;
    if (!hv) return;
    const g = this.game;
    const i18n = this.i18n;
    const t = i18n.t;
    const cfg = g.cfg.areas[hv.id];
    const pen = hv.pen;
    const lines = [h('div', {}, cfg.name, pen ? h('span', { class: 'coord' }, ` (${hv.x}, ${hv.y})`) : '')];
    if (!g.pens.has(hv.id)) lines.push(h('div', {}, cfg.available === false ? t('ui.ranchTipSoon') : t('ui.ranchTipRuins')));
    else if (g.pens.get(hv.id).runaways.length) lines.push(h('div', {}, t('ui.ranchRunaways', { n: g.pens.get(hv.id).runaways.length })));
    else if (pen) {
      const thing = pen.objectAt(hv.x, hv.y);
      const recipes = thing && (g.cfg.machines || {})[thing.type];
      if (recipes) {
        const state = thing.ready ? t('ui.ranchTipReadyItem', { item: i18n.item(thing.ready) }) : thing.making ? t('ui.ranchTipMaking', { item: i18n.item(thing.making) }) : t('ui.ranchTipIdle');
        lines.push(h('div', {}, t('ui.ranchTipMachine', { machine: t(`machines.${thing.type}`), state })));
        if (thing.making) lines.push(h('div', { class: 'bar' }, h('span', { style: { width: `${Math.floor(100 * (1 - Math.max(0, thing.until - g.time) / recipes[thing.making].seconds))}%` } })));
        const inside = Object.entries(thing.inside || {});
        if (inside.length) lines.push(h('div', {}, t('ui.ranchTipInside', { list: inside.map(([it, n]) => `${n} ${i18n.item(it)}`).join(', ') })));
      } else if (thing) lines.push(h('div', {}, t(`machines.${thing.type}`), thing.type.endsWith('Trough') ? ` · ${thing.amount} / ${(g.cfg.troughs || {}).capacity || 10}` : ''));
      if (pen.holeAt(hv.x, hv.y)) lines.push(h('div', {}, t('ui.ranchTipHole')));
      const item = pen.ground[`${hv.x},${hv.y}`];
      if (item) lines.push(h('div', {}, i18n.item(item)));
      const dirt = Math.round(pen.dirtAt(hv.x, hv.y));
      if (dirt >= 1) lines.push(h('div', {}, t('ui.ranchTipDirt', { n: dirt })));
      for (const a of pen.animalsAt(hv.x, hv.y)) {
        const bar = (label, v, bad) => h('div', { class: 'ranch-need' }, h('span', {}, label), h('div', { class: `bar ${bad ? 'bad' : ''}` }, h('span', { style: { width: `${Math.round(v)}%` } })));
        const need = g.cfg.needs;
        lines.push(h('div', { class: 'ranch-tip-animal' }, `${i18n.entity(a.type)} #${a.id}`, a.color ? ` · ${t(`ui.colors.${a.color}`)}` : ''));
        if (pen.young(a, g.time)) lines.push(h('div', {}, t('ui.ranchTipYoung')));
        if (a.sick) lines.push(h('div', {}, t('ui.ranchTipSick')));
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
