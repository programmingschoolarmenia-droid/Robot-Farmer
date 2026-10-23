// Draws the farm on a canvas: meadow, fence, ground, plants, drones and juicy effects.
import { h } from './dom.js';
import { formatCount } from '../core/util.js';

const MAX_TILE_CSS = 80;
const MEADOW_TILE_CSS = 48;
const SWAY = new Set(['Grass', 'Bush', 'Tree', 'Carrot', 'Sunflower']);
const PARTICLE_COLORS = {
  Grass: ['#ffd541', '#f9a31b', '#9cdb43'],
  Bush: ['#59c135', '#14a02e', '#df3e23'],
  Tree: ['#59c135', '#1a7a3e', '#bb7547'],
  Carrot: ['#fa6a0a', '#f9a31b', '#59c135'],
  Pumpkin: ['#fa6a0a', '#f9a31b', '#ffd541'],
  Sunflower: ['#ffd541', '#fffc40', '#59c135'],
  Cactus: ['#14a02e', '#59c135', '#d6f264'],
  Dead_Pumpkin: ['#8e5252', '#5b3138'],
};

function hash(x, y) {
  let n = (x * 374761393 + y * 668265263) >>> 0;
  n = ((n ^ (n >>> 13)) * 1274126177) >>> 0;
  return n >>> 0;
}

export class FarmView {
  constructor({ game, sprites, i18n, stage, prefs }) {
    this.game = game;
    this.sprites = sprites;
    this.i18n = i18n;
    this.stage = stage;
    this.prefs = prefs; // { animations, lowGraphics, showGrid }
    this.canvas = h('canvas', { class: 'pixel' });
    this.tip = h('div', { class: 'farm-tip', hidden: true });
    stage.append(this.canvas, this.tip);
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.popups = [];
    this.giantBorn = new Map();
    this.groundCache = null;
    this.groundState = [];
    this.bg = null;
    this.layoutKey = '';
    this.hover = null;
    this.offs = [];
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(stage);
    this.resize();
    this.bindEvents();
    // Mouse hover or a finger tap shows the tile's info.
    for (const type of ['pointermove', 'pointerdown']) this.canvas.addEventListener(type, (e) => this.onPointer(e));
    this.canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return; // keep the tip after a tap
      this.hover = null;
      this.tip.hidden = true;
    });
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.offs.forEach((f) => f());
  }

  get fx() {
    return this.prefs.animations !== false && !this.prefs.lowGraphics;
  }

  bindEvents() {
    const ev = this.game.events;
    this.offs.push(
      ev.on('harvest', (e) => {
        if (!e.ok) {
          this.puff(e.x, e.y, ['#b3b9d1', '#8b93af'], 6);
          return;
        }
        const colors = PARTICLE_COLORS[e.type] || ['#ffffff'];
        for (const tile of e.tiles.slice(0, 64)) this.puff(tile.x, tile.y, colors, e.tiles.length > 8 ? 4 : 10);
        const entries = Object.entries(e.items);
        const cx = e.giantSize ? e.tiles.reduce((a, t) => a + t.x, 0) / e.tiles.length : e.x;
        const cy = e.giantSize ? e.tiles.reduce((a, t) => a + t.y, 0) / e.tiles.length : e.y;
        entries.forEach(([item, n], i) => this.popup(cx, cy, `+${formatCount(n)}`, `item:${item}`, i * 0.18));
      }),
      ev.on('plant', (e) => this.puff(e.x, e.y, ['#bb7547', '#dba463'], 5)),
      ev.on('till', (e) => this.puff(e.x, e.y, ['#8e5252', '#a0694e', '#ba756a'], 8)),
      ev.on('giantPumpkin', (e) => {
        this.giantBorn.set(`${e.x},${e.y},${e.size}`, performance.now());
      }),
      ev.on('pumpkinDied', (e) => this.puff(e.x, e.y, ['#5b3138', '#333941'], 6)),
      ev.on('useItem', (e) => {
        const c = e.item === 'Water' ? ['#249fde', '#a6fcdb', '#ffffff'] : e.item === 'Fertilizer' ? ['#dba463', '#59c135'] : ['#bc4a9b', '#e07cc4'];
        this.puff(e.x, e.y, c, 10);
      }),
      ev.on('worldResized', () => {
        this.layoutKey = '';
      }),
      ev.on('treasureMoved', (e) => {
        this.puff(e.x, e.y, ['#ffd541', '#fffc40', '#f9a31b'], 14);
        this.popup(e.x, e.y, `+${formatCount(e.gold)}`, 'item:Gold');
      }),
      ev.on('appleEaten', (e) => this.puff(e.x, e.y, ['#df3e23', '#59c135', '#ffffff'], 10)),
      ev.on('mazeCreated', (e) => {
        for (let y = e.y0; y < e.y0 + e.size; y++) for (let x = e.x0; x < e.x0 + e.size; x++) this.puff(x, y, ['#bc4a9b', '#1a7a3e'], 2);
      }),
    );
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(this.stage.clientWidth * dpr));
    const hgt = Math.max(1, Math.floor(this.stage.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== hgt) {
      this.canvas.width = w;
      this.canvas.height = hgt;
      this.layoutKey = '';
    }
    this.dpr = dpr;
  }

  layout() {
    const world = this.game.world;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const key = `${W}x${H}:${world.width}x${world.height}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    const dpr = this.dpr;
    const fit = Math.min((W * 0.9) / world.width, (H * 0.9) / world.height);
    let tile = Math.min(fit, MAX_TILE_CSS * dpr);
    tile = tile >= 32 ? Math.floor(tile / 8) * 8 : Math.floor(tile);
    tile = Math.max(4, tile);
    this.tile = tile;
    this.ox = Math.floor((W - world.width * tile) / 2);
    this.oy = Math.floor((H - world.height * tile) / 2);
    this.buildBackground();
    this.groundCache = document.createElement('canvas');
    this.groundCache.width = world.width * tile;
    this.groundCache.height = world.height * tile;
    this.groundState = new Array(world.width * world.height).fill(null);
  }

  // Meadow + fence around the farm (cached).
  buildBackground() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const world = this.game.world;
    const tile = this.tile;
    const bg = document.createElement('canvas');
    bg.width = W;
    bg.height = H;
    const ctx = bg.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const mt = MEADOW_TILE_CSS * this.dpr;
    const startX = this.ox - Math.ceil(this.ox / mt) * mt;
    const startY = this.oy - Math.ceil(this.oy / mt) * mt;
    for (let y = startY, j = 0; y < H; y += mt, j++) {
      for (let x = startX, i = 0; x < W; x += mt, i++) {
        ctx.drawImage(this.sprites.get(`meadow${hash(i, j) % 4}`), x, y, mt, mt);
      }
    }
    // soft shadow under the farm
    ctx.fillStyle = 'rgba(40, 70, 30, 0.18)';
    ctx.fillRect(this.ox - tile * 0.06, this.oy + tile * 0.08, world.width * tile + tile * 0.12, world.height * tile + tile * 0.06);
    this.drawFence(ctx);
    this.bg = bg;
  }

  drawFence(ctx) {
    const world = this.game.world;
    const tile = this.tile;
    const px = Math.max(1, Math.min(tile / 16, 3)) * this.dpr;
    const gap = 3 * px;
    const x0 = this.ox - gap;
    const y0 = this.oy - gap;
    const x1 = this.ox + world.width * tile + gap;
    const y1 = this.oy + world.height * tile + gap;
    const rail = (ax, ay, bx, by) => {
      ctx.fillStyle = '#71413b';
      if (ay === by) ctx.fillRect(Math.min(ax, bx), ay - px * 1.5, Math.abs(bx - ax), px * 3);
      else ctx.fillRect(ax - px * 1.5, Math.min(ay, by), px * 3, Math.abs(by - ay));
      ctx.fillStyle = '#bb7547';
      if (ay === by) ctx.fillRect(Math.min(ax, bx), ay - px * 0.75, Math.abs(bx - ax), px * 1.5);
      else ctx.fillRect(ax - px * 0.75, Math.min(ay, by), px * 1.5, Math.abs(by - ay));
    };
    rail(x0, y0, x1, y0);
    rail(x0, y1, x1, y1);
    rail(x0, y0, x0, y1);
    rail(x1, y0, x1, y1);
    const post = (x, y) => {
      ctx.fillStyle = '#3b1725';
      ctx.fillRect(x - px * 2.5, y - px * 3.5, px * 5, px * 7);
      ctx.fillStyle = '#bb7547';
      ctx.fillRect(x - px * 1.5, y - px * 2.5, px * 3, px * 5);
      ctx.fillStyle = '#dba463';
      ctx.fillRect(x - px * 1.5, y - px * 2.5, px * 3, px);
    };
    for (let i = 0; i <= world.width; i++) {
      post(this.ox + i * tile, y0);
      post(this.ox + i * tile, y1);
    }
    for (let j = 0; j <= world.height; j++) {
      post(x0, this.oy + j * tile);
      post(x1, this.oy + j * tile);
    }
  }

  // Redraws ground tiles that changed (tilled / untilled).
  updateGround() {
    const world = this.game.world;
    const ctx = this.groundCache.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const tile = this.tile;
    for (const t of world.tiles) {
      const i = t.y * world.width + t.x;
      if (this.groundState[i] === t.ground) continue;
      this.groundState[i] = t.ground;
      const sx = t.x * tile;
      const sy = (world.height - 1 - t.y) * tile;
      const name = t.ground === 'Soil' ? `soil${hash(t.x, t.y) % 2}` : `grassland${hash(t.x, t.y) % 4}`;
      ctx.drawImage(this.sprites.get(name), sx, sy, tile, tile);
    }
  }

  tileRect(x, y) {
    const world = this.game.world;
    return { x: this.ox + x * this.tile, y: this.oy + (world.height - 1 - y) * this.tile, s: this.tile };
  }

  spriteFor(e) {
    const p = e.progress;
    const stage = p >= 1 ? 3 : Math.min(2, Math.floor(p * 3));
    switch (e.type) {
      case 'Grass':
        return `grass${stage}`;
      case 'Bush':
        return p >= 1 ? 'bush2' : p < 0.5 ? 'bush0' : 'bush1';
      case 'Tree':
        return p >= 1 ? 'tree3' : `tree${Math.min(2, Math.floor(p * 3))}`;
      case 'Carrot':
        return `carrot${stage}`;
      case 'Pumpkin':
        return p >= 1 ? 'pumpkinIcon' : `pumpkin${stage}`;
      case 'Dead_Pumpkin':
        return 'deadPumpkin';
      case 'Sunflower':
        return `sunflower${stage}`;
      case 'Cactus':
        return p >= 1 ? `cactus${e.data.size ?? 0}` : 'cactusSprout';
      case 'Hedge':
        return 'hedge';
      case 'Treasure':
        return 'treasure';
      case 'Apple':
        return 'apple';
      case 'Dinosaur':
        return 'dinoTail';
      default:
        return 'missing';
    }
  }

  render(now) {
    this.resize();
    this.layout();
    const ctx = this.ctx;
    const game = this.game;
    const world = game.world;
    const tile = this.tile;
    const t = now / 1000;
    world.syncAll(game.time);
    this.updateGround();

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.bg, 0, 0);
    ctx.drawImage(this.groundCache, this.ox, this.oy);

    // wet ground
    for (const tl of world.tiles) {
      if (tl.water > 0.01) {
        const r = this.tileRect(tl.x, tl.y);
        ctx.fillStyle = `rgba(30, 70, 150, ${Math.min(0.42, tl.water * 0.45)})`;
        ctx.fillRect(r.x, r.y, r.s, r.s);
      }
    }

    if (this.prefs.showGrid !== false && tile >= 12) {
      ctx.strokeStyle = 'rgba(20, 40, 20, 0.10)';
      ctx.lineWidth = Math.max(1, this.dpr);
      ctx.beginPath();
      for (let i = 1; i < world.width; i++) {
        ctx.moveTo(this.ox + i * tile + 0.5, this.oy);
        ctx.lineTo(this.ox + i * tile + 0.5, this.oy + world.height * tile);
      }
      for (let j = 1; j < world.height; j++) {
        ctx.moveTo(this.ox, this.oy + j * tile + 0.5);
        ctx.lineTo(this.ox + world.width * tile, this.oy + j * tile + 0.5);
      }
      ctx.stroke();
    }

    const md = game.mainDrone;

    if (world.maze) this.drawMaze(ctx, world.maze);

    // drone target tile highlight
    {
      const r = this.tileRect(md.x, md.y);
      ctx.strokeStyle = 'rgba(255, 213, 65, 0.9)';
      ctx.lineWidth = Math.max(2, tile * 0.05);
      const inset = ctx.lineWidth;
      ctx.strokeRect(r.x + inset / 2, r.y + inset / 2, r.s - inset, r.s - inset);
    }

    // plants
    const fx = this.fx;
    const giants = new Set();
    for (const tl of world.tiles) {
      const e = tl.entity;
      if (!e) continue;
      if (e.type === 'Hedge') continue;
      if (e.data.giant) {
        giants.add(e.data.giant);
        continue;
      }
      const r = this.tileRect(tl.x, tl.y);
      const sprite = this.sprites.get(this.spriteFor(e));
      if (fx && SWAY.has(e.type)) {
        const k = Math.sin(t * 1.8 + tl.x * 0.9 + tl.y * 1.7) * (e.type === 'Tree' ? 0.03 : 0.06);
        ctx.save();
        ctx.translate(r.x + r.s / 2, r.y + r.s);
        ctx.transform(1, 0, k, 1, 0, 0);
        ctx.drawImage(sprite, -r.s / 2, -r.s, r.s, r.s);
        ctx.restore();
      } else {
        ctx.drawImage(sprite, r.x, r.y, r.s, r.s);
      }
      if (e.data.infected) this.drawInfection(ctx, r, t);
      if (fx && e.progress >= 1 && e.type !== 'Dead_Pumpkin') this.drawSparkle(ctx, r, t, hash(tl.x, tl.y));
    }
    for (const g of giants) this.drawGiant(ctx, g, now);

    // drones
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.ox - tile * 0.5, this.oy - tile * 0.5, world.width * tile + tile, world.height * tile + tile);
    ctx.clip();
    const drones = game.runner.drones.length ? game.runner.drones : [md];
    if (!drones.includes(md)) drones.unshift(md);
    for (const d of drones) this.drawDrone(ctx, d, t);
    ctx.restore();

    // hover
    if (this.hover && this.hover.x < world.width && this.hover.y < world.height) {
      const r = this.tileRect(this.hover.x, this.hover.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = Math.max(2, this.dpr * 2);
      ctx.setLineDash([6 * this.dpr, 4 * this.dpr]);
      ctx.strokeRect(r.x + 1, r.y + 1, r.s - 2, r.s - 2);
      ctx.setLineDash([]);
      this.updateTip();
    }

    this.drawEffects(ctx);
  }

  drawMaze(ctx, m) {
    const tile = this.tile;
    const th = Math.max(2, Math.round(tile * 0.2));
    ctx.fillStyle = '#e9dcae';
    for (let y = m.y0; y < m.y0 + m.size; y++) {
      for (let x = m.x0; x < m.x0 + m.size; x++) {
        const r = this.tileRect(x, y);
        ctx.fillRect(r.x, r.y, r.s, r.s);
      }
    }
    const wall = (x, y, w, h) => {
      ctx.fillStyle = '#1a7a3e';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#2f9a4a';
      ctx.fillRect(x + th * 0.25, y + th * 0.25, Math.max(1, w - th * 0.5), Math.max(1, h - th * 0.5));
    };
    for (let y = m.y0; y < m.y0 + m.size; y++) {
      for (let x = m.x0; x < m.x0 + m.size; x++) {
        const open = m.cellOpen(x, y);
        const r = this.tileRect(x, y);
        if (!(open & 1)) wall(r.x - th / 2, r.y - th / 2, r.s + th, th);
        if (!(open & 4)) wall(r.x - th / 2, r.y + r.s - th / 2, r.s + th, th);
        if (!(open & 8)) wall(r.x - th / 2, r.y - th / 2, th, r.s + th);
        if (!(open & 2)) wall(r.x + r.s - th / 2, r.y - th / 2, th, r.s + th);
      }
    }
  }

  drawGiant(ctx, g, now) {
    const tile = this.tile;
    const world = this.game.world;
    const x = this.ox + g.x * tile;
    const y = this.oy + (world.height - (g.y + g.size)) * tile;
    const size = g.size * tile;
    const born = this.giantBorn.get(`${g.x},${g.y},${g.size}`);
    let s = 1;
    if (born && this.fx) {
      const k = Math.min(1, (now - born) / 450);
      s = k < 1 ? 0.6 + 0.5 * Math.sin(k * Math.PI * 0.75) : 1;
    }
    const pad = size * 0.04;
    const w = (size - pad * 2) * s;
    ctx.drawImage(this.sprites.get('pumpkinIcon'), x + size / 2 - w / 2, y + size / 2 - w / 2, w, w);
  }

  drawInfection(ctx, r, t) {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const a = t * 2 + i * 2.1;
      const px = r.x + r.s * (0.5 + Math.cos(a) * 0.3);
      const py = r.y + r.s * (0.4 + Math.sin(a * 1.3) * 0.25);
      ctx.fillStyle = i % 2 ? '#bc4a9b' : '#e07cc4';
      const s = Math.max(2, r.s / 12);
      ctx.fillRect(px, py, s, s);
    }
  }

  drawSparkle(ctx, r, t, seed) {
    const phase = (t * 0.7 + (seed % 100) / 37) % 3;
    if (phase > 0.35) return;
    const k = 1 - Math.abs(phase - 0.175) / 0.175;
    const s = Math.max(2, (r.s / 16) * 1.2);
    const x = r.x + r.s * (0.25 + ((seed >> 3) % 50) / 100);
    const y = r.y + r.s * (0.2 + ((seed >> 7) % 30) / 100);
    ctx.globalAlpha = Math.max(0, k);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - s, y, s * 3, s);
    ctx.fillRect(x, y - s, s, s * 3);
    ctx.globalAlpha = 1;
  }

  drawDrone(ctx, d, t) {
    const game = this.game;
    const world = game.world;
    const tile = this.tile;
    const img = this.sprites.images.drone;
    const pos = d.visualPosition(game.time);
    const cx = this.ox + (pos.x + 0.5) * tile;
    const cy = this.oy + (world.height - 1 - pos.y + 0.5) * tile;
    const dw = Math.max(26 * this.dpr, Math.min(tile * 0.92, 150 * this.dpr));
    const dh = (dw * img.height) / img.width;
    const fx = this.fx;
    const bob = fx ? Math.sin(t * 5 + d.id) * tile * 0.03 : 0;
    // shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + tile * 0.3, dw * 0.3, dw * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();

    let angle = 0;
    let scale = 1;
    const a = d.anim;
    if (a && a.kind === 'flip' && game.time >= a.start && game.time < a.end) {
      const p = (game.time - a.start) / (a.end - a.start);
      angle = p * Math.PI * 2;
      scale = 1 + Math.sin(p * Math.PI) * 0.25;
    }
    if (game.dino && game.dino.drone === d) {
      const head = this.sprites.get('dinoHead');
      const s = tile * 1.05;
      ctx.save();
      ctx.translate(cx, cy + bob);
      if (d.anim && d.anim.dx < 0) ctx.scale(-1, 1);
      ctx.drawImage(head, -s / 2, -s / 2, s, s);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.translate(cx, cy - tile * 0.06 + bob);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.imageSmoothingEnabled = false;
    if (fx) {
      // spinning propellers (faint blades)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = Math.max(1, dw * 0.018);
      ctx.lineCap = 'round';
      // rotor centres measured on the drone image (relative to its centre)
      const rotors = [
        [-0.3, -0.29],
        [0.3, -0.29],
        [-0.3, 0.27],
        [0.3, 0.27],
      ];
      const len = dw * 0.13;
      rotors.forEach(([rx, ry], i) => {
        const ang = t * 28 + i;
        const px = rx * dw;
        const py = ry * dh;
        ctx.beginPath();
        ctx.moveTo(px - Math.cos(ang) * len, py - Math.sin(ang) * len);
        ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
        ctx.stroke();
      });
      ctx.lineCap = 'butt';
    }
    // hat on top of the body
    const hat = this.sprites.get(`hat:${d.hat}`);
    if (hat) {
      const hs = dw * 0.36;
      ctx.drawImage(hat, -hs / 2, -hs / 2 - dh * 0.02, hs, hs);
    }
    if (d.id > 0 && tile >= 20) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#173a7a';
      ctx.lineWidth = 3 * this.dpr;
      ctx.font = `800 ${Math.round(10 * this.dpr)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.strokeText(String(d.id), dw * 0.42, -dh * 0.35);
      ctx.fillText(String(d.id), dw * 0.42, -dh * 0.35);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ effects

  center(x, y) {
    const world = this.game.world;
    return { cx: this.ox + (x + 0.5) * this.tile, cy: this.oy + (world.height - 1 - y + 0.5) * this.tile };
  }

  puff(x, y, colors, n = 8) {
    if (!this.fx || this.tile === undefined) return;
    if (this.particles.length > 600) return;
    const { cx, cy } = this.center(x, y);
    const s = Math.max(2, this.tile / 14);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const v = (1.5 + Math.random() * 2.5) * this.dpr * Math.max(1, this.tile / 60);
      this.particles.push({
        x: cx + (Math.random() - 0.5) * this.tile * 0.3,
        y: cy + this.tile * 0.1,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 1,
        size: s * (0.7 + Math.random() * 0.6),
        color: colors[(Math.random() * colors.length) | 0],
      });
    }
  }

  popup(x, y, text, icon, delay = 0) {
    if (this.tile === undefined) return;
    if (this.popups.length > 40) this.popups.shift();
    const { cx, cy } = this.center(x, y);
    this.popups.push({ x: cx, y: cy - this.tile * 0.2, text, icon, life: 1 + delay, delay });
  }

  drawEffects(ctx) {
    const g = 0.18 * this.dpr;
    for (const p of this.particles) {
      p.vy += g;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.03;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.life > 0);

    const fontPx = Math.round(Math.max(13, Math.min(22, this.tile / 3.2)) * (this.dpr > 1 ? this.dpr : 1));
    ctx.font = `800 ${fontPx}px 'Noto Sans Armenian', sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const p of this.popups) {
      p.life -= 0.016;
      if (p.life > 1) continue;
      const k = 1 - p.life;
      const y = p.y - k * this.tile * 0.9;
      ctx.globalAlpha = Math.min(1, p.life * 2.5);
      const icon = this.sprites.get(p.icon);
      const is = fontPx * 1.3;
      const tw = ctx.measureText(p.text).width;
      const x = p.x - (is + 4 + tw) / 2;
      ctx.drawImage(icon, x, y - is / 2, is, is);
      ctx.lineWidth = Math.max(3, fontPx / 4);
      ctx.strokeStyle = '#173a7a';
      ctx.strokeText(p.text, x + is + 4, y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(p.text, x + is + 4, y);
    }
    ctx.globalAlpha = 1;
    this.popups = this.popups.filter((p) => p.life > 0);
  }

  // ------------------------------------------------------------------ hover tooltip

  onPointer(e) {
    if (this.tile === undefined) return;
    const rect = this.canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * this.dpr;
    const my = (e.clientY - rect.top) * this.dpr;
    const world = this.game.world;
    const tx = Math.floor((mx - this.ox) / this.tile);
    const ty = world.height - 1 - Math.floor((my - this.oy) / this.tile);
    if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) {
      this.hover = null;
      this.tip.hidden = true;
      return;
    }
    this.hover = { x: tx, y: ty, mx: e.clientX - rect.left, my: e.clientY - rect.top };
    this.updateTip();
  }

  updateTip() {
    const hv = this.hover;
    if (!hv) return;
    const tile = this.game.world.tile(hv.x, hv.y);
    const i18n = this.i18n;
    const e = tile.entity;
    const parts = [h('span', { class: 'coord' }, `(${hv.x}, ${hv.y})`), ' ', i18n.ground(tile.ground)];
    const lines = [h('div', {}, parts)];
    if (e) {
      let name = i18n.entity(e.type);
      if (e.type === 'Sunflower') name += ` · ${e.data.petals} 🌼`;
      if (e.type === 'Cactus') name += ` · ${e.data.size}`;
      if (e.data.giant) name += ` · ${e.data.giant.size}×${e.data.giant.size}`;
      lines.push(h('div', {}, name, e.progress < 1 ? ` · ${Math.floor(e.progress * 100)}%` : ' ✓'));
      if (e.type !== 'Dead_Pumpkin') lines.push(h('div', { class: 'bar' }, h('span', { style: { width: `${Math.floor(e.progress * 100)}%` } })));
    }
    if (tile.water > 0.01) lines.push(h('div', {}, `💧 ${Math.round(tile.water * 100)}%`));
    const world = this.game.world;
    if (e && world.polycultureLevel() > 0) {
      const c = world.companionOf(tile);
      if (c) lines.push(h('div', {}, `🤝 ${i18n.entity(c.type)} (${c.x}, ${c.y})`));
    }
    this.tip.replaceChildren(...lines);
    this.tip.hidden = false;
    const sw = this.stage.clientWidth;
    const left = Math.min(hv.mx + 14, sw - this.tip.offsetWidth - 6);
    this.tip.style.left = `${Math.max(4, left)}px`;
    this.tip.style.top = `${Math.max(4, hv.my + 16)}px`;
  }
}
