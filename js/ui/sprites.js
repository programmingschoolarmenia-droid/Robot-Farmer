// All game graphics: crops from the CC0 "Farming crops 16x16" pack by josehzz
// (assets/sprites/crops-josehzz.png), the user's drone/Bridgy images, and sprites
// drawn in code with the Pixels painter (ground, bush, tree, carrot, cactus, icons…).
import { Pixels, PAL, makeCanvas, seeded } from './pixel.js';

const SHEET = { cell: 16 };
// Sheet rows (each row has two crops: columns 0-5 and 6-11; col 0/6 = icon,
// col 1/7 = ripe … col 4/10 = sprout, col 5/11 = seeds).
const CROP_ROWS = { wheat: [5, 0], pumpkin: [8, 0], sunflower: [9, 6] };

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

export class SpriteBook {
  constructor() {
    this.sprites = new Map();
    this.urls = new Map();
    this.images = {};
  }

  async load(settings) {
    const [crops, drone] = await Promise.all([loadImage('assets/sprites/crops-josehzz.png'), loadImage('assets/sprites/drone.png')]);
    this.images.crops = crops;
    this.images.drone = drone;
    this.build(settings);
    return this;
  }

  get(name) {
    return this.sprites.get(name) || this.sprites.get('missing');
  }

  has(name) {
    return this.sprites.has(name);
  }

  put(name, pixelsOrCanvas) {
    const cv = pixelsOrCanvas instanceof Pixels ? pixelsOrCanvas.toCanvas() : pixelsOrCanvas;
    this.sprites.set(name, cv);
    return cv;
  }

  // PNG data URL of a sprite scaled up with crisp pixels (for <img> in the DOM).
  url(name, scale = 3) {
    const key = `${name}@${scale}`;
    if (this.urls.has(key)) return this.urls.get(key);
    const src = this.get(name);
    const cv = makeCanvas(src.width * scale, src.height * scale);
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, cv.width, cv.height);
    const url = cv.toDataURL('image/png');
    this.urls.set(key, url);
    return url;
  }

  sheetCell(row, col) {
    const cv = makeCanvas(16, 16);
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.images.crops, col * SHEET.cell, row * SHEET.cell, 16, 16, 0, 0, 16, 16);
    return cv;
  }

  // Recolours a canvas with a colour map { '#rrggbb': '#rrggbb' }.
  recolorCanvas(src, map) {
    const cv = makeCanvas(src.width, src.height);
    const ctx = cv.getContext('2d');
    ctx.drawImage(src, 0, 0);
    const img = ctx.getImageData(0, 0, cv.width, cv.height);
    const d = img.data;
    const parsed = Object.entries(map).map(([a, b]) => [hexToRgb(a), hexToRgb(b)]);
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      for (const [from, to] of parsed) {
        if (d[i] === from[0] && d[i + 1] === from[1] && d[i + 2] === from[2]) {
          d[i] = to[0];
          d[i + 1] = to[1];
          d[i + 2] = to[2];
          break;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  build(settings) {
    const missing = new Pixels();
    missing.rect(2, 2, 12, 12, PAL.pink).outline();
    this.put('missing', missing);

    // --- ground
    for (let v = 0; v < 4; v++) this.put(`grassland${v}`, grassTile(v + 1));
    for (let v = 0; v < 2; v++) this.put(`soil${v}`, soilTile(v + 7));
    this.put('pondPit', pondPit());
    this.put('pondWater', pondWater());
    for (let v = 0; v < 4; v++) this.put(`meadow${v}`, meadowTile(v + 13));

    // --- crops from the sheet
    const stagesFrom = (name, key) => {
      const [row, c0] = CROP_ROWS[key];
      // stage 0 = sprout … stage 3 = ripe
      this.put(`${name}0`, this.sheetCell(row, c0 + 4));
      this.put(`${name}1`, this.sheetCell(row, c0 + 3));
      this.put(`${name}2`, this.sheetCell(row, c0 + 2));
      this.put(`${name}3`, this.sheetCell(row, c0 + 1));
      this.put(`${name}Icon`, this.sheetCell(row, c0));
    };
    stagesFrom('grass', 'wheat');
    // Ripe wheat is very orange in the pack; make it straw-yellow so it doesn't look like fire.
    this.put('grass3', this.recolorCanvas(this.get('grass3'), { '#fa6a0a': '#f9a31b', '#f9a31b': '#ffd541' }));
    stagesFrom('pumpkin', 'pumpkin');
    stagesFrom('sunflower', 'sunflower');
    this.put('deadPumpkin', this.recolorCanvas(this.get('pumpkinIcon'), DEAD_PUMPKIN));
    this.put('deadPumpkinSmall', this.recolorCanvas(this.get('pumpkin3'), DEAD_PUMPKIN));

    // --- crops drawn in code
    for (let s = 0; s < 3; s++) this.put(`bush${s}`, bush(s));
    for (let s = 0; s < 4; s++) this.put(`tree${s}`, tree(s));
    for (let s = 0; s < 4; s++) this.put(`carrot${s}`, carrot(s));
    this.put('carrotIcon', carrotIcon());
    for (let size = 0; size <= 9; size++) this.put(`cactus${size}`, cactus(size, true));
    this.put('cactusSprout', cactus(0, false));
    this.put('hedge', hedge());
    this.put('treasure', treasure());
    this.put('apple', apple());
    this.put('dinoHead', dinoHead());
    this.put('dinoTail', dinoTail());

    // --- items
    this.put('item:Hay', hayBale());
    this.put('item:Wood', woodLog());
    this.put('item:Carrot', this.get('carrotIcon'));
    this.put('item:Pumpkin', this.get('pumpkinIcon'));
    this.put('item:Power', bolt());
    this.put('item:Water', droplet());
    this.put('item:Fertilizer', sack());
    this.put('item:Weird_Substance', flask());
    this.put('item:Cactus', cactus(6, true));
    this.put('item:Bone', bone());
    this.put('item:Gold', coin());
    this.put('item:Fish', fish(PAL.sky, PAL.pale, PAL.blue));
    this.put('fish:Carp', fish('#8f9a5c', '#c2cc84', '#5d6638'));
    this.put('fish:Barbel', fish('#a0694e', '#c08a68', '#71413b', 'whiskers'));
    this.put('fish:Trout', fish('#9fb6c8', '#e3eef5', '#5c7a96', 'spots'));
    this.put('fish:Golden_Fish', fish(PAL.yellow, PAL.brightYellow, PAL.amber, 'sparkles'));
    this.put('fish:Whitefish', fish('#c7d3dd', '#ffffff', '#8796a5'));
    this.put('fish:Catfish', fish('#6b6a5e', '#9a9886', '#3f3e36', 'whiskers'));
    // --- the village kitchen: products, machines on farm squares, the village buildings (and their ruins)
    this.put('item:Flour', flour());
    this.put('item:Jam', jam());
    this.put('item:Lavash', lavash());
    this.put('item:Gata', gata());
    this.put('item:Ghapama', ghapama());
    this.put('item:Grilled_Fish', grilledFish());
    this.put('item:Star', star());
    this.put('machine:Mill', millMachine());
    this.put('machine:JamPot', jamPot());
    this.put('machine:Tonir', tonir());
    this.put('village:board', noticeBoard()); // (the buildings are pictures: assets/village)

    // --- research icons
    this.put('icon:hat', sideHat('#f2c04d', '#2b6fd6'));
    this.put('icon:goldhat', sideHat('#ffd541', '#b4202a'));
    this.put('icon:speed', speedIcon());
    this.put('icon:grass', this.get('item:Hay'));
    this.put('icon:expand', expandIcon());
    this.put('icon:carrot', this.get('carrotIcon'));
    this.put('icon:water', this.get('item:Water'));
    this.put('icon:tree', this.get('tree3'));
    this.put('icon:fertilizer', this.get('item:Fertilizer'));
    this.put('icon:sunflower', this.get('sunflowerIcon'));
    this.put('icon:maze', mazeIcon());
    this.put('icon:drones', dronesIcon());
    this.put('icon:pumpkin', this.get('pumpkinIcon'));
    this.put('icon:cactus', this.get('item:Cactus'));
    this.put('icon:polyculture', polycultureIcon());
    this.put('icon:dinosaur', this.get('dinoHead'));
    this.put('icon:secret', questionIcon());
    this.put('icon:debugger', magnifier());
    this.put('icon:trophy', trophy());
    this.put('icon:fishing', fishingRod());
    this.put('icon:calendar', calendarIcon());

    // --- hats for the drone (seen from above) and for the leaderboard avatars (from the side)
    const hats = (settings && settings.hats) || {};
    for (const [name, h] of Object.entries(hats)) {
      this.put(`hat:${name}`, topHat(name, h.color, h.band));
      this.put(`hatSide:${name}`, sideHat(h.color, h.band));
    }
  }
}

const DEAD_PUMPKIN = {
  '#fa6a0a': '#8e5252',
  '#f9a31b': '#ba756a',
  '#df3e23': '#5b3138',
  '#b4202a': '#3b1725',
  '#ffd541': '#ba756a',
  '#14a02e': '#6d758d',
  '#1a7a3e': '#4a5462',
  '#59c135': '#8b93af',
  '#24523b': '#333941',
  '#9cdb43': '#b3b9d1',
};

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ------------------------------------------------------------------ ground

function grassTile(seed) {
  const r = seeded(seed * 9973);
  const p = new Pixels();
  p.rect(0, 0, 16, 16, '#86cc5a');
  for (let i = 0; i < 7; i++) {
    const x = Math.floor(r() * 15);
    const y = 1 + Math.floor(r() * 14);
    p.set(x, y, '#6cb948');
    p.set(x + 1, y - 1, '#6cb948');
  }
  for (let i = 0; i < 6; i++) p.set(Math.floor(r() * 16), Math.floor(r() * 16), '#a3dc75');
  return p;
}

function meadowTile(seed) {
  const r = seeded(seed * 7919);
  const p = new Pixels();
  p.rect(0, 0, 16, 16, '#b5e08f');
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(r() * 15);
    const y = 1 + Math.floor(r() * 14);
    p.set(x, y, '#9fd27a');
    p.set(x + 1, y - 1, '#9fd27a');
  }
  if (r() < 0.55) {
    const x = 2 + Math.floor(r() * 12);
    const y = 2 + Math.floor(r() * 12);
    const petals = [PAL.white, PAL.yellow, '#f5a3c7'][Math.floor(r() * 3)];
    p.set(x, y - 1, petals).set(x - 1, y, petals).set(x + 1, y, petals).set(x, y + 1, petals).set(x, y, PAL.amber);
  }
  return p;
}

function soilTile(seed) {
  const r = seeded(seed * 4441);
  const p = new Pixels();
  p.rect(0, 0, 16, 16, '#a0694e');
  for (const y of [3, 7, 11, 15]) {
    p.rect(0, y, 16, 1, '#7d4a36');
    p.rect(0, y - 1, 16, 1, '#ad7658');
  }
  for (let i = 0; i < 6; i++) p.set(Math.floor(r() * 16), Math.floor(r() * 16), '#8a5640');
  for (let i = 0; i < 3; i++) p.set(Math.floor(r() * 16), Math.floor(r() * 16), '#c08a68');
  return p;
}

// ------------------------------------------------------------------ crops

function bush(stage) {
  const p = new Pixels();
  const r = [3, 4.6, 6][stage];
  const cy = 15.5 - r * 0.9;
  p.ellipse(8, cy, r, r * 0.9, PAL.green);
  if (stage >= 1) {
    p.disc(8 - r * 0.6, cy + r * 0.25, r * 0.55, PAL.green);
    p.disc(8 + r * 0.6, cy + r * 0.3, r * 0.55, PAL.green);
  }
  p.shade(PAL.green, PAL.lightGreen, PAL.darkGreen);
  if (stage >= 1) {
    p.set(6, Math.round(cy - 1), PAL.paleGreen).set(9, Math.round(cy - r * 0.5), PAL.paleGreen);
  }
  if (stage === 2) {
    // ripe: berries
    for (const [x, y] of [
      [5, 9],
      [10, 8],
      [8, 12],
      [11, 12],
    ]) {
      p.set(x, y, PAL.brightRed).set(x, y - 1, PAL.white);
    }
  }
  p.outline();
  return p;
}

function tree(stage) {
  const p = new Pixels();
  if (stage === 0) {
    p.rect(8, 10, 1, 6, PAL.lightBrown);
    p.set(7, 10, PAL.lightGreen).set(6, 9, PAL.lightGreen).set(9, 9, PAL.green).set(10, 8, PAL.green);
    p.outline();
    return p;
  }
  const crown = [0, 3.6, 5, 6.4][stage];
  const cy = [0, 8.5, 7, 6.2][stage];
  const trunkTop = Math.round(cy + crown * 0.6);
  p.rect(7, trunkTop, 2, 16 - trunkTop, PAL.brown);
  p.rect(7, trunkTop, 1, 16 - trunkTop, PAL.lightBrown);
  p.disc(8, cy, crown, PAL.darkGreen);
  if (stage >= 2) {
    p.disc(8 - crown * 0.55, cy + crown * 0.35, crown * 0.55, PAL.darkGreen);
    p.disc(8 + crown * 0.55, cy + crown * 0.35, crown * 0.55, PAL.darkGreen);
  }
  p.shade(PAL.darkGreen, PAL.green, PAL.deepGreen);
  p.set(6, Math.round(cy - crown * 0.4), PAL.lightGreen).set(7, Math.round(cy - crown * 0.55), PAL.lightGreen);
  if (stage === 3) {
    for (const [x, y] of [
      [5, 5],
      [10, 4],
      [11, 8],
      [6, 9],
    ]) p.set(x, y, PAL.lime);
  }
  p.outline();
  return p;
}

function carrot(stage) {
  const p = new Pixels();
  const leafH = [2, 4, 6, 8][stage];
  const baseY = stage >= 2 ? 12 : 14;
  // leaves (three blades)
  for (let i = 0; i < leafH; i++) {
    const y = baseY - i;
    p.set(8, y, i % 2 ? PAL.lightGreen : PAL.green);
    if (i > 0 && stage >= 1) p.set(7 - Math.floor(i / 3), y, PAL.green);
    if (i > 0 && stage >= 1) p.set(9 + Math.floor(i / 3), y, PAL.lightGreen);
  }
  if (stage >= 2) {
    const w = stage === 3 ? 6 : 4;
    const x0 = 8 - w / 2;
    p.rect(x0, baseY + 1, w, 2, PAL.orange);
    p.rect(x0 + 1, baseY + 3, w - 2, 1, PAL.orange);
    p.set(x0, baseY + 1, PAL.amber);
    p.set(x0 + 1, baseY + 1, PAL.amber);
  }
  p.outline();
  return p;
}

function carrotIcon() {
  const p = new Pixels();
  p.polygon(
    [
      [2.5, 14.5],
      [8.6, 4.2],
      [12.8, 8.4],
    ],
    PAL.orange,
  );
  p.disc(10.9, 6.1, 2.6, PAL.orange);
  p.shade(PAL.orange, PAL.amber, PAL.brightRed);
  for (const [x, y] of [
    [6, 10],
    [8, 9],
    [5, 12],
  ])
    p.set(x, y, PAL.brightRed);
  p.line(12, 4, 14, 1, PAL.green);
  p.line(12, 5, 15, 3, PAL.lightGreen);
  p.line(11, 3, 11, 0, PAL.green);
  p.line(13, 4, 15, 1, PAL.green);
  p.outline();
  return p;
}

function cactus(size, grown) {
  const p = new Pixels();
  if (!grown) {
    p.rect(7, 12, 2, 4, PAL.green).set(7, 12, PAL.lightGreen);
    p.outline();
    return p;
  }
  const h = 6 + Math.round(size * 0.9);
  const top = 16 - h;
  p.rect(6, top + 1, 4, h - 1, PAL.green);
  p.rect(7, top, 2, 1, PAL.green);
  if (size >= 3) {
    const ay = top + Math.round(h * 0.45);
    p.rect(4, ay, 2, 1, PAL.green);
    p.rect(3, ay - 3, 2, 4, PAL.green);
  }
  if (size >= 6) {
    const ay = top + Math.round(h * 0.3);
    p.rect(10, ay + 1, 2, 1, PAL.green);
    p.rect(11, ay - 2, 2, 4, PAL.green);
  }
  p.shade(PAL.green, PAL.lightGreen, PAL.darkGreen);
  for (let y = top + 2; y < 15; y += 3) p.set(8, y, PAL.lime);
  if (size >= 8) {
    p.set(7, top - 1, PAL.pink).set(8, top - 1, PAL.pink).set(7, top - 2, '#f5a3c7');
  }
  p.outline();
  return p;
}

function hedge() {
  const p = new Pixels();
  p.rect(0, 0, 16, 16, PAL.darkGreen);
  const r = seeded(31);
  for (let i = 0; i < 22; i++) p.set(Math.floor(r() * 16), Math.floor(r() * 16), PAL.green);
  for (let i = 0; i < 10; i++) p.set(Math.floor(r() * 16), Math.floor(r() * 16), PAL.deepGreen);
  return p;
}

function treasure() {
  const p = new Pixels();
  p.rect(3, 7, 10, 7, PAL.brown);
  p.rect(3, 5, 10, 3, PAL.lightBrown);
  p.rect(3, 8, 10, 1, PAL.amber);
  p.rect(7, 7, 2, 3, PAL.yellow);
  p.set(5, 6, PAL.tan).set(6, 6, PAL.tan);
  p.outline(PAL.outlineBrown);
  return p;
}

function apple() {
  const p = new Pixels();
  p.disc(8, 9.5, 4.8, PAL.brightRed);
  p.shade(PAL.brightRed, '#f5555d', PAL.red);
  p.set(6, 7, PAL.white);
  p.rect(8, 3, 1, 3, PAL.brown);
  p.set(9, 3, PAL.lightGreen).set(10, 3, PAL.green).set(10, 2, PAL.lightGreen);
  p.outline();
  return p;
}

function dinoHead() {
  const p = new Pixels();
  p.ellipse(8, 9, 6, 5, PAL.lightGreen);
  p.ellipse(11, 10.5, 3.5, 2.5, PAL.lightGreen);
  p.shade(PAL.lightGreen, PAL.paleGreen, PAL.green);
  p.set(9, 7, PAL.white).set(10, 7, PAL.outline);
  p.set(13, 11, PAL.outline);
  for (const x of [3, 5, 7]) p.set(x, 4 + (x === 5 ? -1 : 0), PAL.amber);
  p.outline();
  return p;
}

function dinoTail() {
  const p = new Pixels();
  p.disc(8, 8, 5, PAL.lightGreen);
  p.shade(PAL.lightGreen, PAL.paleGreen, PAL.green);
  p.set(8, 3, PAL.amber).set(8, 2, PAL.amber);
  p.outline();
  return p;
}

// ------------------------------------------------------------------ items & icons

function hayBale() {
  const p = new Pixels();
  p.rect(1, 5, 14, 9, PAL.yellow);
  p.rect(2, 4, 12, 1, PAL.yellow);
  p.rect(2, 14, 12, 1, PAL.yellow);
  for (const y of [6, 9, 12]) for (let x = 2; x < 14; x += 3) p.set(x + (y % 2), y, PAL.amber);
  p.rect(1, 4, 14, 1, PAL.brightYellow);
  p.rect(4, 4, 1, 11, PAL.lightBrown);
  p.rect(11, 4, 1, 11, PAL.lightBrown);
  p.outline(PAL.outlineBrown);
  return p;
}

function woodLog() {
  const p = new Pixels();
  p.rect(2, 6, 11, 6, PAL.lightBrown);
  p.rect(2, 6, 11, 1, PAL.tan);
  p.rect(2, 11, 11, 1, PAL.brown);
  for (const x of [4, 8]) p.rect(x, 8, 2, 1, PAL.brown);
  p.ellipse(13, 9, 2.4, 3.2, PAL.tan);
  p.set(13, 9, PAL.lightBrown).set(13, 8, PAL.sand);
  p.outline(PAL.outlineBrown);
  return p;
}

function bolt() {
  const p = new Pixels();
  p.polygon(
    [
      [9.5, 0.5],
      [3, 9],
      [7.5, 9],
      [5.5, 15.5],
      [13, 6.5],
      [8.5, 6.5],
      [11, 0.5],
    ],
    PAL.yellow,
  );
  p.shade(PAL.yellow, PAL.brightYellow, PAL.amber);
  p.outline(PAL.outlineBrown);
  return p;
}

function droplet() {
  const p = new Pixels();
  p.disc(8, 10.2, 4.6, PAL.sky);
  p.polygon(
    [
      [8, 1],
      [3.6, 9.5],
      [12.4, 9.5],
    ],
    PAL.sky,
  );
  p.shade(PAL.sky, PAL.cyan, PAL.blue);
  p.set(6, 9, PAL.pale).set(6, 10, PAL.pale).set(7, 7, PAL.pale);
  p.outline(PAL.navy);
  return p;
}

function sack() {
  const p = new Pixels();
  p.ellipse(8, 10.5, 5.5, 4.8, PAL.tan);
  p.rect(6, 3, 4, 4, PAL.tan);
  p.shade(PAL.tan, PAL.sand, PAL.lightBrown);
  p.rect(5, 6, 6, 1, PAL.brown);
  p.set(7, 10, PAL.green).set(8, 9, PAL.lightGreen).set(9, 10, PAL.green).set(8, 11, PAL.green).set(8, 10, PAL.green);
  p.outline(PAL.outlineBrown);
  return p;
}

function flask() {
  const p = new Pixels();
  p.disc(8, 10.5, 4.7, PAL.pink);
  p.rect(7, 3, 2, 4, PAL.lightGrey);
  p.rect(6, 2, 4, 1, PAL.lightBrown);
  p.shade(PAL.pink, '#e07cc4', PAL.purple);
  p.set(6, 9, PAL.white).set(9, 12, '#e07cc4').set(10, 10, PAL.white);
  p.outline(PAL.darkPurple);
  return p;
}

function bone() {
  const p = new Pixels();
  p.line(4, 12, 12, 4, PAL.sand);
  p.line(4, 11, 11, 4, PAL.sand);
  p.line(5, 12, 12, 5, PAL.sand);
  for (const [x, y] of [
    [3, 11],
    [5, 13],
    [11, 3],
    [13, 5],
  ])
    p.disc(x, y, 1.7, PAL.sand);
  p.shade(PAL.sand, PAL.white, PAL.tan);
  p.outline(PAL.outlineBrown);
  return p;
}

function coin() {
  const p = new Pixels();
  p.disc(8, 8, 6.5, PAL.yellow);
  p.disc(8, 8, 4.4, PAL.amber);
  p.disc(8, 8, 3.4, PAL.yellow);
  p.set(5, 4, PAL.white).set(4, 5, PAL.white).set(8, 6, PAL.brightYellow);
  p.rect(7, 6, 2, 4, PAL.amber);
  p.outline(PAL.outlineBrown);
  return p;
}

// A pond: the empty pit dug into the ground, and its water (drawn over the pit as it fills).
function pondPit() {
  const p = new Pixels();
  p.rect(0, 0, 16, 16, '#a0694e');
  p.ellipse(8, 8.5, 7, 6.2, PAL.soilDark);
  p.ellipse(8, 9.6, 5.4, 4.4, '#4a2a2f');
  for (const [x, y] of [[4, 2], [8, 2], [12, 3], [2, 6], [14, 7]]) p.set(x, y, '#c08a68');
  return p;
}

function pondWater() {
  const p = new Pixels();
  p.ellipse(8, 8.5, 6.6, 5.8, PAL.sky);
  p.shade(PAL.sky, PAL.cyan, PAL.blue);
  p.set(5, 6, PAL.pale).set(6, 6, PAL.pale).set(10, 10, PAL.pale).set(11, 10, PAL.pale);
  return p;
}

// A fish facing left; `marks` adds a species' look (barbel whiskers, trout spots, golden sparkles).
function fish(body, light, dark, marks = '') {
  const p = new Pixels();
  p.ellipse(6.5, 8.5, 5.5, 3.3, body);
  p.polygon([[10.5, 8.5], [15.2, 4.6], [15.2, 12.4]], body);
  p.polygon([[5, 5.6], [9, 3.6], [9.6, 6]], body);
  p.shade(body, light, dark);
  if (marks === 'spots') for (const [x, y] of [[5, 8], [7, 7], [8, 9], [10, 8]]) p.set(x, y, PAL.brightRed);
  if (marks === 'whiskers') p.set(1, 10, PAL.darkBrown).set(2, 11, PAL.darkBrown);
  p.set(3, 7, PAL.outline);
  p.outline(PAL.outline);
  if (marks === 'sparkles') for (const [x, y] of [[1, 3], [13, 1], [14, 14], [0, 13]]) p.set(x, y, PAL.white);
  return p;
}

function fishingRod() {
  const p = new Pixels();
  p.line(2, 14, 12, 2, PAL.brown);
  p.line(3, 14, 13, 2, PAL.lightBrown);
  p.disc(13, 12, 1.7, PAL.brightRed);
  p.set(13, 13, PAL.white);
  p.outline(PAL.outlineBrown);
  p.line(13, 3, 13, 10, PAL.lightGrey);
  return p;
}

// --- the village kitchen -------------------------------------------------------------

function flour() {
  const p = new Pixels();
  p.ellipse(8, 10.5, 5.5, 4.8, '#f4efe2');
  p.rect(6, 3, 4, 4, '#f4efe2');
  p.shade('#f4efe2', PAL.white, '#cfc6b0');
  p.rect(5, 6, 6, 1, PAL.lightBrown);
  p.set(7, 10, PAL.amber).set(8, 9, PAL.yellow).set(9, 10, PAL.amber);
  p.outline(PAL.outlineBrown);
  return p;
}

function jam() {
  const p = new Pixels();
  p.rect(4, 5, 8, 9, '#d6402b');
  p.shade('#d6402b', '#f06a4d', PAL.red);
  p.rect(5, 7, 2, 4, '#ffb38a');
  p.rect(3, 3, 10, 2, PAL.white);
  p.set(4, 4, PAL.brightRed).set(7, 4, PAL.brightRed).set(10, 4, PAL.brightRed);
  p.outline(PAL.outlineBrown);
  return p;
}

function lavash() {
  const p = new Pixels();
  p.ellipse(8, 9, 7.5, 4.5, '#ecd29a');
  p.shade('#ecd29a', '#f8e8c2', PAL.tan);
  for (const [x, y] of [[4, 8], [7, 7], [10, 9], [12, 8], [6, 10], [9, 11]]) p.set(x, y, PAL.lightBrown);
  p.outline(PAL.outlineBrown);
  return p;
}

function gata() {
  const p = new Pixels();
  p.disc(8, 8.5, 6.5, '#e2a948');
  p.shade('#e2a948', '#f4cd7a', '#b9782b');
  for (let i = 0; i < 8; i++) p.set(8 + Math.round(3.6 * Math.cos((i * Math.PI) / 4)), 8.5 + Math.round(3.6 * Math.sin((i * Math.PI) / 4)), PAL.brown);
  p.set(8, 8, PAL.brown).set(7, 9, PAL.brown);
  p.outline(PAL.outlineBrown);
  return p;
}

function ghapama() {
  const p = new Pixels();
  p.ellipse(8, 10, 6.5, 5, PAL.orange);
  p.shade(PAL.orange, PAL.amber, '#c4500a');
  p.line(5, 7, 5, 14, '#c4500a').line(11, 7, 11, 14, '#c4500a');
  p.ellipse(8, 6.5, 4.5, 1.6, PAL.yellow);
  p.set(7, 6, PAL.white).set(9, 7, PAL.white).set(10, 6, PAL.red);
  p.ellipse(12, 3.5, 2.5, 1.5, PAL.orange).rect(12, 1, 1, 2, PAL.green);
  p.outline(PAL.outlineBrown);
  return p;
}

function grilledFish() {
  const p = fish('#a0562c', '#d08a4e', '#6b3a1e');
  p.line(0, 13, 15, 4, PAL.tan);
  for (const [x, y] of [[5, 8], [8, 8], [11, 8]]) p.set(x, y, '#3b1725');
  return p;
}

function star() {
  const p = new Pixels();
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 3 : 7.2;
    pts.push([8 + r * Math.cos(a), 8.6 + r * Math.sin(a)]);
  }
  p.polygon(pts, PAL.yellow);
  p.shade(PAL.yellow, PAL.brightYellow, PAL.amber);
  p.outline(PAL.outlineBrown);
  return p;
}

// Machines on farm squares (the farm view adds their fire, steam and progress).
function millMachine() {
  const p = new Pixels();
  p.rect(4, 9, 8, 6, PAL.lightBrown);
  p.polygon([[3, 9.5], [8, 5], [13, 9.5]], PAL.red);
  p.disc(8, 6, 4.6, PAL.tan);
  p.line(4, 6, 12, 6, PAL.brown).line(8, 2, 8, 10, PAL.brown).line(5, 3, 11, 9, PAL.brown).line(11, 3, 5, 9, PAL.brown);
  p.disc(8, 6, 1.2, PAL.darkBrown);
  p.rect(7, 12, 2, 3, PAL.darkBrown);
  p.outline(PAL.outlineBrown);
  return p;
}

function jamPot() {
  const p = new Pixels();
  p.rect(4, 13, 8, 2, PAL.brown);
  p.ellipse(8, 9, 5.5, 4, '#c8743a');
  p.shade('#c8743a', '#e8a066', '#8a4a22');
  p.rect(2, 6, 12, 2, '#8a4a22');
  p.ellipse(8, 6.5, 4, 1, '#d6402b');
  p.set(1, 7, PAL.darkGrey).set(14, 7, PAL.darkGrey);
  p.outline(PAL.outlineBrown);
  return p;
}

function tonir() {
  const p = new Pixels();
  p.ellipse(8, 11, 7, 6.5, '#c47a4a');
  p.rect(1, 11, 14, 4, '#c47a4a');
  p.shade('#c47a4a', '#e09a68', '#8e5232');
  p.ellipse(8, 11.5, 3, 2.5, PAL.darkBrown);
  p.rect(5, 12, 6, 3, PAL.darkBrown);
  p.outline(PAL.outlineBrown);
  return p;
}

// The villagers' requests board on the village map: a small tiled roof, posts and paper notes.
function noticeBoard() {
  const p = new Pixels(32, 32);
  p.rect(6, 14, 2, 17, PAL.brown).rect(24, 14, 2, 17, PAL.brown);
  p.rect(3, 9, 26, 15, PAL.lightBrown);
  p.shade(PAL.lightBrown, PAL.tan, PAL.brown);
  p.rect(5, 11, 22, 11, '#c9925a');
  p.polygon([[1, 10], [16, 2], [31, 10]], PAL.red);
  p.shade(PAL.red, PAL.brightRed, '#7a1620');
  p.rect(7, 12, 6, 7, PAL.white).rect(15, 13, 5, 6, '#fff1b8').rect(22, 12, 4, 5, PAL.white);
  for (const [x, y] of [[8, 14], [9, 16], [16, 15], [23, 14]]) p.rect(x, y, 3, 1, PAL.grey);
  p.set(10, 12, PAL.brightRed).set(17, 13, PAL.blue).set(24, 12, PAL.brightRed);
  p.outline(PAL.outlineBrown);
  return p;
}

// A calendar page: red top, two rings, day squares (today in blue).
function calendarIcon() {
  const p = new Pixels();
  p.rect(2, 3, 12, 11, PAL.white);
  p.rect(2, 3, 12, 3, PAL.brightRed);
  for (const x of [4, 7, 10]) for (const y of [8, 11]) p.rect(x, y, 2, 2, PAL.lightGrey);
  p.rect(10, 11, 2, 2, PAL.sky);
  p.outline(PAL.outline);
  p.rect(4, 1, 1, 3, PAL.grey);
  p.rect(11, 1, 1, 3, PAL.grey);
  return p;
}

function sideHat(color, band) {
  const p = new Pixels();
  p.ellipse(8, 11.5, 7.5, 2.3, color);
  p.ellipse(8, 8, 4.3, 4.3, color);
  p.rect(4, 11, 9, 2, color);
  p.rect(4, 9, 9, 2, band);
  p.shade(color, PAL.white, null);
  p.outline(PAL.outlineBrown);
  return p;
}

function speedIcon() {
  const p = new Pixels();
  const chevron = (x0, c) =>
    p.polygon(
      [
        [x0, 3],
        [x0 + 4, 3],
        [x0 + 9, 8],
        [x0 + 4, 13],
        [x0, 13],
        [x0 + 5, 8],
      ],
      c,
    );
  chevron(1, PAL.sky);
  chevron(6, PAL.blue);
  p.outline(PAL.navy);
  return p;
}

function expandIcon() {
  const p = new Pixels();
  p.rect(5, 5, 6, 6, PAL.lightGreen);
  p.rect(5, 5, 6, 1, PAL.paleGreen);
  const arrow = (pts) => p.polygon(pts, PAL.amber);
  arrow([
    [8, 0],
    [11, 3.5],
    [5, 3.5],
  ]);
  arrow([
    [8, 16],
    [5, 12.5],
    [11, 12.5],
  ]);
  arrow([
    [0, 8],
    [3.5, 5],
    [3.5, 11],
  ]);
  arrow([
    [16, 8],
    [12.5, 11],
    [12.5, 5],
  ]);
  p.outline(PAL.outlineBrown);
  return p;
}

function mazeIcon() {
  const p = new Pixels();
  p.rect(1, 1, 14, 14, PAL.sand);
  const walls = [
    [1, 1, 14, 1],
    [1, 14, 14, 1],
    [1, 1, 1, 14],
    [14, 1, 1, 14],
    [4, 4, 1, 8],
    [4, 4, 7, 1],
    [7, 7, 1, 7],
    [10, 4, 1, 7],
    [10, 10, 3, 1],
  ];
  for (const [x, y, w, h] of walls) p.rect(x, y, w, h, PAL.darkGreen);
  p.set(12, 12, PAL.yellow).set(12, 13, PAL.amber);
  p.outline();
  return p;
}

function miniDrone(p, cx, cy) {
  for (const [dx, dy] of [
    [-2.5, -2.5],
    [2.5, -2.5],
    [-2.5, 2.5],
    [2.5, 2.5],
  ])
    p.disc(cx + dx, cy + dy, 1.7, PAL.sky);
  p.disc(cx, cy, 2, PAL.blue);
  p.set(Math.round(cx - 0.5), Math.round(cy - 0.5), PAL.yellow);
}

function dronesIcon() {
  const p = new Pixels();
  miniDrone(p, 5, 5);
  miniDrone(p, 11, 6);
  miniDrone(p, 7.5, 11.5);
  p.outline(PAL.navy);
  return p;
}

function polycultureIcon() {
  const p = new Pixels();
  p.ellipse(5, 11, 4, 3.6, PAL.green);
  p.shade(PAL.green, PAL.lightGreen, PAL.darkGreen);
  p.rect(11, 5, 1, 7, PAL.green);
  p.set(10, 6, PAL.lightGreen).set(12, 7, PAL.lightGreen).set(9, 8, PAL.green);
  p.rect(10, 12, 3, 2, PAL.orange);
  p.set(7, 3, PAL.pink).set(8, 2, PAL.pink).set(8, 4, PAL.pink).set(9, 3, PAL.pink).set(8, 3, PAL.yellow);
  p.outline();
  return p;
}

function questionIcon() {
  const p = new Pixels();
  p.art(
    4,
    2,
    ['.####.', '##..##', '....##', '...##.', '..##..', '..##..', '......', '..##..', '..##..'],
    { '#': PAL.white },
  );
  p.outline(PAL.navy);
  return p;
}

function magnifier() {
  const p = new Pixels();
  p.disc(6.5, 6.5, 5, PAL.lightGrey);
  p.disc(6.5, 6.5, 3.6, PAL.pale);
  p.set(5, 4, PAL.white).set(4, 5, PAL.white);
  p.line(10, 10, 14, 14, PAL.brown);
  p.line(11, 10, 15, 14, PAL.lightBrown);
  p.outline(PAL.navy);
  return p;
}

function trophy() {
  const p = new Pixels();
  p.polygon(
    [
      [3, 2],
      [13, 2],
      [12, 7],
      [9, 9.5],
      [7, 9.5],
      [4, 7],
    ],
    PAL.yellow,
  );
  p.rect(7, 9, 2, 3, PAL.amber);
  p.rect(5, 12, 6, 2, PAL.amber);
  p.set(2, 3, PAL.yellow).set(1, 4, PAL.yellow).set(2, 5, PAL.yellow).set(13, 3, PAL.yellow).set(14, 4, PAL.yellow).set(13, 5, PAL.yellow);
  p.shade(PAL.yellow, PAL.brightYellow, PAL.amber);
  p.outline(PAL.outlineBrown);
  return p;
}

// A hat seen from above, drawn on the drone's body.
function topHat(name, color, band) {
  const p = new Pixels();
  if (name === 'Secret_Hat') {
    p.disc(8, 8, 7, '#1f2937');
    p.disc(8, 8, 4.5, band);
    p.disc(8, 8, 3.6, '#111827');
    p.set(6, 6, '#4b5563');
  } else if (name === 'Dinosaur_Hat') {
    p.disc(8, 8, 6, color);
    for (const [x, y] of [
      [8, 1],
      [8, 15],
      [1, 8],
      [15, 8],
      [3, 3],
      [13, 13],
    ])
      p.set(x, y, PAL.amber);
    p.shade(color, PAL.paleGreen, band);
  } else {
    p.disc(8, 8, 7.2, color);
    p.disc(8, 8, 4.6, band);
    p.disc(8, 8, 3.6, color);
    p.shade(color, PAL.white, null);
  }
  p.outline(PAL.outlineBrown);
  return p;
}
