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
    this.put('item:Medal', medal());
    // --- festival objects found in the farm (config/events.json → festivals[].object)
    this.put('fest:firewood', firewood());
    this.put('fest:egg', paintedEgg());
    this.put('fest:drop', this.get('item:Water'));
    this.put('fest:basket', basket());
    this.put('fest:book', book());
    this.put('fest:flower', tulip());
    this.put('fest:gift', gift());
    this.put('machine:Mill', millMachine());
    this.put('machine:JamPot', jamPot());
    this.put('machine:Tonir', tonir());

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

    // --- the ranch: animals, goods and the things in its areas (the ranch view adds fill levels)
    this.put('hen', hen());
    this.put('cow', cow());
    this.put('item:Egg', egg());
    this.put('item:Milk', milkCan());
    this.put('item:Grain', grainSack());
    this.put('item:Bale', this.get('item:Hay'));
    this.put('item:Dram', banknote());
    this.put('thing:FeedTrough', trough());
    this.put('thing:WaterTrough', trough());
    this.put('thing:Well', well());
    this.put('thing:Basket', wicker());
    this.put('thing:Stall', stall());
    this.put('icon:ranch', this.get('cow'));
    this.put('goat', goat());
    // coloured animals: 'hen:Brown', … (the plain sprite is the first colour)
    const coat = { White: null, Spotted: null, Brown: ['#a8683f', '#c98d5f', '#7a4527'], Black: ['#3a3a44', '#55555f', '#26262c'], Gold: ['#f2b632', '#ffd96a', '#c98a14'], Red: ['#b4462c', '#d06a4e', '#8a2f1c'] };
    const coatOf = { hen: [PAL.white, PAL.white, PAL.lightGrey], cow: [PAL.white, PAL.white, PAL.lightGrey], goat: [PAL.sand, PAL.sand, PAL.tan] };
    for (const [animal, make] of Object.entries({ hen, cow, goat })) {
      for (const [color, to] of Object.entries(coat)) {
        if (!to) this.put(`${animal}:${color}`, this.get(animal));
        else this.put(`${animal}:${color}`, recolored(make(), { [coatOf[animal][0]]: to[0], [coatOf[animal][2]]: to[2] }));
      }
    }
    this.put('item:GoatMilk', recolored(milkCan(), { [PAL.sky]: PAL.lightGreen }));
    this.put('item:Matsun', matsun());
    this.put('item:Cheese', cheese());
    this.put('item:Butter', butter());
    this.put('item:Omelet', omelet());
    this.put('item:Manure', manure());
    this.put('item:Medicine', medicine());
    this.put('item:Plank', plank());
    this.put('item:Nazook', nazook());
    this.put('thing:Dairy', dairy());
    this.put('thing:Stove', stove());
    this.put('weeds', weeds());
    this.put('brokenBoard', brokenBoard());
    this.put('ruinShed', ruinShed());

    icons(this);

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

// The weekly challenge's medal: a gold coin on a blue and red ribbon.
function medal() {
  const p = new Pixels();
  p.polygon([[3, 0], [7, 0], [9.5, 7], [5.5, 7]], PAL.blue).polygon([[13, 0], [9, 0], [6.5, 7], [10.5, 7]], PAL.brightRed);
  p.disc(8, 10.5, 4.6, PAL.yellow);
  p.shade(PAL.yellow, PAL.brightYellow, PAL.amber);
  p.disc(8, 10.5, 1.6, PAL.amber);
  p.outline(PAL.outlineBrown);
  return p;
}

// --- festival objects -------------------------------------------------------------------

function firewood() {
  const p = new Pixels();
  p.line(2, 13, 13, 9, PAL.brown).line(2, 14, 13, 10, PAL.lightBrown);
  p.line(3, 9, 14, 13, PAL.brown).line(3, 10, 14, 14, PAL.lightBrown);
  p.polygon([[8, 1], [11.5, 8], [8, 9.5], [4.5, 8]], PAL.orange);
  p.polygon([[8, 4], [10, 8], [8, 9], [6, 8]], PAL.yellow);
  p.outline(PAL.outlineBrown);
  return p;
}

function paintedEgg() {
  const p = new Pixels();
  p.ellipse(8, 8.8, 5, 6.3, PAL.brightRed);
  p.shade(PAL.brightRed, '#f06a4d', PAL.red);
  p.rect(3, 8, 10, 1, PAL.yellow);
  for (const x of [5, 8, 11]) p.set(x, 11, PAL.white);
  p.set(6, 5, PAL.white);
  p.outline(PAL.outlineBrown);
  return p;
}

function basket() {
  const p = new Pixels();
  p.disc(6, 6, 2.6, PAL.brightRed).disc(10, 5.5, 2.6, PAL.orange).disc(8, 4, 2.2, PAL.yellow);
  p.polygon([[1.5, 7.5], [14.5, 7.5], [12.5, 14.5], [3.5, 14.5]], PAL.lightBrown);
  for (let y = 9; y < 14; y += 2) p.line(3, y, 13, y, PAL.brown);
  p.outline(PAL.outlineBrown);
  return p;
}

function book() {
  const p = new Pixels();
  p.rect(2, 3, 12, 10, PAL.blue);
  p.rect(3, 4, 10, 8, PAL.white);
  p.rect(8, 4, 1, 8, PAL.lightGrey);
  for (const y of [6, 8, 10]) p.rect(4, y, 3, 1, PAL.grey).rect(10, y, 2, 1, PAL.grey);
  p.outline(PAL.outline);
  return p;
}

function tulip() {
  const p = new Pixels();
  p.line(8, 8, 8, 15, PAL.green);
  p.polygon([[8, 13], [11.5, 9.5], [12, 11]], PAL.lightGreen);
  p.polygon([[4, 2], [6, 4], [8, 1.5], [10, 4], [12, 2], [11.5, 7.5], [8, 9], [4.5, 7.5]], '#e0457b');
  p.shade('#e0457b', '#f48fb1', '#a3164c');
  p.outline(PAL.outline);
  return p;
}

function gift() {
  const p = new Pixels();
  p.rect(2, 6, 12, 9, PAL.brightRed);
  p.rect(1, 4, 14, 3, '#f05a46');
  p.rect(7, 4, 2, 11, PAL.yellow);
  p.disc(5.5, 2.6, 2, PAL.yellow).disc(10.5, 2.6, 2, PAL.yellow);
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

// --- the ranch -----------------------------------------------------------------------------

function hen() {
  const p = new Pixels();
  p.art(0, 0, [
    '................',
    '..........RR....',
    '.........RRRR...',
    '.........WWWW...',
    '........WWWEWYY.',
    '........WWWWWYY.',
    '..WW....WWWWWR..',
    '.WWWW..WWWWWWR..',
    '.WWWWWWWWWWWW...',
    '.WWWWWWWWWWWW...',
    '..WWWWWWWWWWG...',
    '...WWWWWWWWGG...',
    '....GWWWWWGG....',
    '.....L...L......',
    '.....L...L......',
    '....LL..LL......',
  ], { W: PAL.white, G: PAL.lightGrey, R: PAL.brightRed, Y: PAL.amber, L: PAL.orange, E: PAL.outline });
  p.outline(PAL.outlineBrown);
  return p;
}

function cow() {
  const p = new Pixels();
  p.art(0, 0, [
    '................',
    '...........S.S..',
    '..........WWWW..',
    '..........WEWWP.',
    '.T........WWWPP.',
    '.TWWWWWWWWWWWPP.',
    '..WWKKWWWWWWW...',
    '..WKKKWWWWKKW...',
    '..WWKWWWWKKKW...',
    '..WWWWWWWWWWW...',
    '..WWWWWWWWWWG...',
    '..GWWWWPPWWWG...',
    '..W.W....W.W....',
    '..W.W....W.W....',
    '..K.K....K.K....',
    '................',
  ], { W: PAL.white, G: PAL.lightGrey, K: PAL.darkGrey, P: '#f4a6a6', S: PAL.sand, T: PAL.darkGrey, E: PAL.outline });
  p.outline(PAL.outlineBrown);
  return p;
}

function egg() {
  const p = new Pixels();
  p.ellipse(8, 9, 4, 5.2, '#f4ead0');
  p.shade('#f4ead0', PAL.white, '#d9c9a0');
  p.outline(PAL.outlineBrown);
  return p;
}

function milkCan() {
  const p = new Pixels();
  p.rect(4, 6, 8, 9, PAL.lightGrey);
  p.rect(5, 3, 6, 3, PAL.lightGrey);
  p.shade(PAL.lightGrey, PAL.white, PAL.grey);
  p.rect(4, 2, 8, 2, PAL.grey);
  p.rect(4, 9, 8, 2, PAL.sky);
  p.outline(PAL.outline);
  return p;
}

function grainSack() {
  const p = new Pixels();
  p.polygon([[3, 6], [13, 6], [14.5, 15], [1.5, 15]], PAL.tan);
  p.shade(PAL.tan, PAL.sand, PAL.lightBrown);
  p.ellipse(8, 6, 5, 2.2, PAL.yellow);
  for (const [x, y] of [[6, 5], [9, 6], [11, 5], [7, 7]]) p.set(x, y, PAL.amber);
  p.outline(PAL.outlineBrown);
  return p;
}

// ֏: a green banknote.
function banknote() {
  const p = new Pixels();
  p.rect(1, 4, 14, 8, PAL.lightGreen);
  p.rect(2, 5, 12, 6, PAL.paleGreen);
  p.disc(8, 8, 2.2, PAL.green);
  p.set(3, 6, PAL.green).set(12, 9, PAL.green);
  p.outline(PAL.outline);
  return p;
}

// A wooden trough (the ranch view draws its feed or water by how full it is).
function trough() {
  const p = new Pixels();
  p.rect(2, 13, 2, 2, PAL.brown).rect(12, 13, 2, 2, PAL.brown);
  p.polygon([[1, 6], [15, 6], [13.5, 13], [2.5, 13]], PAL.lightBrown);
  p.shade(PAL.lightBrown, PAL.tan, PAL.brown);
  p.rect(3, 7, 10, 3, PAL.darkBrown);
  p.outline(PAL.outlineBrown);
  return p;
}

function well() {
  const p = new Pixels();
  p.disc(8, 10.5, 5.2, PAL.lightGrey);
  p.shade(PAL.lightGrey, PAL.white, PAL.grey);
  p.disc(8, 10.5, 3.2, PAL.navy);
  p.rect(2, 2, 1, 8, PAL.brown).rect(13, 2, 1, 8, PAL.brown);
  p.polygon([[1, 3], [8, -0.5], [15, 3]], PAL.red);
  p.line(8, 3, 8, 8, PAL.tan);
  p.rect(7, 8, 2, 2, PAL.brown);
  p.outline(PAL.outlineBrown);
  return p;
}

// The basket where drones unload their hands.
function wicker() {
  const p = new Pixels();
  p.line(4, 8, 6, 3, PAL.brown).line(6, 3, 10, 3, PAL.brown).line(10, 3, 12, 8, PAL.brown);
  p.polygon([[1.5, 7.5], [14.5, 7.5], [12.5, 14.5], [3.5, 14.5]], PAL.tan);
  for (let y = 9; y < 14; y += 2) p.line(3, y, 13, y, PAL.lightBrown);
  p.outline(PAL.outlineBrown);
  return p;
}

// The market stall: a striped awning over a counter with eggs and milk.
function stall() {
  const p = new Pixels();
  p.rect(2, 6, 1, 4, PAL.brown).rect(13, 6, 1, 4, PAL.brown);
  for (let x = 1; x < 15; x += 4) p.rect(x, 2, 2, 4, PAL.brightRed).rect(x + 2, 2, 2, 4, PAL.white);
  p.rect(1, 10, 14, 5, PAL.lightBrown);
  p.shade(PAL.lightBrown, PAL.tan, PAL.brown);
  p.disc(5, 9, 1.4, '#f4ead0').disc(7.5, 9, 1.4, '#f4ead0');
  p.rect(10, 7, 3, 3, PAL.lightGrey);
  p.outline(PAL.outlineBrown);
  return p;
}

// --- ruins of the ranch areas not bought yet

function weeds() {
  const p = new Pixels();
  p.art(0, 0, [
    '................',
    '................',
    '................',
    '.......D........',
    '...D...DL...D...',
    '...DL.DD...DL...',
    '....D.D.L..D....',
    '.L..DDD.L.DD..D.',
    '.LL..DD.LDD..DL.',
    '..L..DD.DD..DD..',
    '..DL.D.DD..DD...',
    '...DDD.D..DD....',
    '....DD.DDDD.....',
    '.....DDDDD......',
    '................',
    '................',
  ], { D: PAL.darkGreen, L: PAL.paleGreen });
  return p;
}

function brokenBoard() {
  const p = new Pixels();
  p.polygon([[1, 9], [12, 5], [13, 7.5], [2, 11.5]], PAL.lightBrown);
  p.polygon([[9, 12], [15, 10.5], [15.5, 12.5], [9.5, 14]], PAL.tan);
  p.shade(PAL.lightBrown, PAL.tan, PAL.brown);
  p.set(4, 9, PAL.darkBrown).set(10, 7, PAL.darkBrown);
  p.outline(PAL.outlineBrown);
  return p;
}

// A shed whose roof fell in: grey walls, a broken dark roof and a hole for a door.
function ruinShed() {
  const p = new Pixels();
  p.rect(2, 7, 12, 8, PAL.lightBrown);
  p.shade(PAL.lightBrown, PAL.tan, PAL.brown);
  for (let x = 4; x < 14; x += 3) p.line(x, 8, x, 14, PAL.brown);
  p.polygon([[1, 7.5], [6, 2], [9, 5], [8, 7.5]], PAL.soilDark);
  p.polygon([[10, 7.5], [12, 4], [15, 7.5]], PAL.soil);
  p.rect(6, 10, 4, 5, PAL.darkBrown);
  p.line(9, 7, 11, 9, PAL.darkBrown);
  p.set(12, 10, PAL.darkGreen).set(13, 13, PAL.darkGreen).set(3, 13, PAL.darkGreen);
  p.outline(PAL.outlineBrown);
  return p;
}

// --- icons for the interface (buttons, chips, the leaderboard, stickers, festivals) --------------
// Every picture the game shows next to a label; the name is what config files write in "icon".

function icons(book) {
  const put = (name, p) => book.put(`icon:${name}`, p);
  const same = (name, sprite) => book.put(`icon:${name}`, book.get(sprite));
  same('farm', 'item:Hay');
  same('storage', 'thing:Basket');
  same('star', 'item:Star');
  same('research', 'item:Weird_Substance');
  same('book', 'fest:book');
  same('egg', 'item:Egg');
  same('milk', 'item:Milk');
  same('dram', 'item:Dram');
  same('fish', 'fish:Carp');
  same('iceFish', 'fish:Whitefish');
  same('goldFish', 'fish:Golden_Fish');
  same('gold', 'item:Gold');
  same('paintedEgg', 'fest:egg');
  same('drop', 'fest:drop');
  same('tulip', 'fest:flower');
  same('gift', 'fest:gift');
  same('dish', 'item:Gata');
  same('dino', 'dinoHead');
  same('tree3', 'tree3');
  same('cactus2', 'item:Cactus');
  same('pumpkin2', 'pumpkinIcon');
  same('hen', 'hen');
  same('cow', 'cow');
  same('trough', 'thing:FeedTrough');
  same('water2', 'thing:WaterTrough');
  same('stove', 'thing:Stove');
  same('medicine', 'item:Medicine');
  same('cheese', 'item:Cheese');
  put('village', house());
  put('gear', gear());
  put('player', person());
  put('tv', tv());
  put('code', codeIcon());
  put('flame', flame());
  put('crown', crown());
  put('cap', gradCap());
  put('medal1', book.get('item:Medal'));
  put('medal2', recolored(medal(), { [PAL.yellow]: PAL.lightGrey, [PAL.brightYellow]: PAL.white, [PAL.amber]: PAL.grey }));
  put('medal3', recolored(medal(), { [PAL.yellow]: PAL.lightBrown, [PAL.brightYellow]: PAL.tan, [PAL.amber]: PAL.brown }));
  put('tag', tag());
  put('door', door());
  put('bulb', bulb());
  put('js', jsIcon());
  put('sprout', sprout());
  put('herb', herb());
  put('scroll', scroll());
  put('compass', compass());
  put('bug', bug());
  put('eye', eye());
  put('cart', cart());
  put('board', clipboard());
  put('soon', cone());
  put('lock', padlock());
  put('check', check());
  put('party', party());
  put('confetti', confettiIcon());
  put('blossom', blossom());
  put('leaf', autumnLeaf());
  put('snowflake', snowflake());
  put('sun', sun());
  put('rain', cloud(PAL.lightGrey, (p) => [[5, 12], [8, 13], [11, 12]].forEach(([x, y]) => p.line(x, y, x - 1, y + 2, PAL.sky))));
  put('storm', cloud(PAL.grey, (p) => p.polygon([[9, 9], [6, 13], [8, 13], [6, 16], [11, 11], [9, 11], [10, 9]], PAL.yellow)));
  put('snow', cloud(PAL.lightGrey, (p) => [[5, 12], [8, 14], [11, 12]].forEach(([x, y]) => p.set(x, y, PAL.white).set(x, y + 1, PAL.sky))));
  put('tractor', tractor());
  put('gem', gem());
  put('fir', fir());
  put('loop', loopIcon());
  put('branch', branch());
  put('box', box());
  put('puzzle', puzzle());
  put('sliders', sliders());
  put('dolls', dolls());
  put('folder', folder());
  put('inbox', inbox());
  put('key', key());
  put('flip', flip());
  put('workshop', workshop());
  same('goat', 'goat');
  put('sheep', sheep());
  put('bee', bee());
  put('buffalo', buffalo());
  put('rabbit', rabbit());
  put('market', book.get('thing:Stall'));
  put('bigger', book.get('icon:expand'));
  put('hands', handsIcon());
  put('broom', broom());
  put('heart', heart());
  put('wagon', wagon());
  put('bell', bell());
  for (const [name, skin, hair, extra] of [
    ['granny', '#f2c6a0', PAL.lightGrey, 'scarf'],
    ['cook', '#e8b48a', PAL.darkBrown, 'cook'],
    ['fisher', '#d9a27a', PAL.brown, 'hat'],
    ['girl', '#f2c6a0', PAL.amber, 'bows'],
  ]) book.put(`face:${name}`, face(skin, hair, extra));
}

function recolored(p, map) {
  for (const [from, to] of Object.entries(map)) p.recolor(from, to);
  return p;
}

function house() {
  const p = new Pixels();
  p.rect(3, 8, 10, 7, PAL.sand);
  p.shade(PAL.sand, PAL.white, PAL.tan);
  p.polygon([[1, 8.5], [8, 2], [15, 8.5]], PAL.brightRed);
  p.shade(PAL.brightRed, null, PAL.red);
  p.rect(11, 3, 2, 3, PAL.brown);
  p.rect(7, 10, 3, 5, PAL.lightBrown);
  p.rect(4, 10, 2, 2, PAL.sky);
  p.outline(PAL.outlineBrown);
  return p;
}

function gear() {
  const p = new Pixels();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    p.disc(8 + Math.cos(a) * 5.6, 8 + Math.sin(a) * 5.6, 1.5, PAL.grey);
  }
  p.disc(8, 8, 5, PAL.grey);
  p.shade(PAL.grey, PAL.lightGrey, PAL.darkGrey);
  p.disc(8, 8, 1.8, PAL.darkGrey);
  p.outline(PAL.outline);
  return p;
}

function person() {
  const p = new Pixels();
  p.polygon([[2.5, 15.5], [4, 10], [12, 10], [13.5, 15.5]], PAL.blue);
  p.shade(PAL.blue, PAL.sky, PAL.navy);
  p.disc(8, 6, 3.3, '#f2c6a0');
  p.rect(5, 2, 6, 2, PAL.brown);
  p.outline(PAL.outline);
  return p;
}

function tv() {
  const p = new Pixels();
  p.line(5, 1, 7, 4, PAL.darkGrey).line(11, 1, 9, 4, PAL.darkGrey);
  p.rect(1, 4, 14, 10, PAL.lightBrown);
  p.shade(PAL.lightBrown, PAL.tan, PAL.brown);
  p.rect(2, 5, 9, 8, PAL.sky);
  p.rect(3, 6, 3, 2, PAL.pale);
  p.disc(13, 7, 0.8, PAL.yellow).disc(13, 10, 0.8, PAL.darkGrey);
  p.rect(3, 14, 2, 1, PAL.brown).rect(11, 14, 2, 1, PAL.brown);
  p.outline(PAL.outline);
  return p;
}

function codeIcon() {
  const p = new Pixels();
  p.rect(1, 2, 14, 11, PAL.navy);
  p.rect(6, 13, 4, 1, PAL.grey).rect(4, 14, 8, 1, PAL.grey);
  p.line(5, 5, 3, 7, PAL.yellow).line(3, 7, 5, 9, PAL.yellow);
  p.line(9, 4, 7, 10, PAL.white);
  p.line(11, 5, 13, 7, PAL.yellow).line(13, 7, 11, 9, PAL.yellow);
  p.outline(PAL.outline);
  return p;
}

function flame() {
  const p = new Pixels();
  p.polygon([[8, 0.5], [13, 7], [13, 12], [9.5, 15.5], [6.5, 15.5], [3, 12], [3, 7], [5.5, 9], [6, 4]], PAL.orange);
  p.polygon([[8.5, 6], [11, 10.5], [10, 14.5], [6, 14.5], [5.5, 11], [7, 12]], PAL.yellow);
  p.set(8, 13, PAL.brightYellow).set(8, 12, PAL.brightYellow);
  p.outline(PAL.outlineBrown);
  return p;
}

function crown() {
  const p = new Pixels();
  p.polygon([[1.5, 13.5], [1.5, 4.5], [5, 8.5], [8, 2.5], [11, 8.5], [14.5, 4.5], [14.5, 13.5]], PAL.yellow);
  p.shade(PAL.yellow, PAL.brightYellow, PAL.amber);
  p.rect(2, 11, 12, 2, PAL.amber);
  p.set(5, 11, PAL.brightRed).set(8, 11, PAL.sky).set(11, 11, PAL.brightRed);
  p.outline(PAL.outlineBrown);
  return p;
}

function gradCap() {
  const p = new Pixels();
  p.rect(4, 8, 8, 4, PAL.darkGrey);
  p.polygon([[0.5, 6.5], [8, 3], [15.5, 6.5], [8, 10]], PAL.outline);
  p.polygon([[2, 6.5], [8, 4], [14, 6.5], [8, 9]], PAL.darkGrey);
  p.line(13, 7, 13, 12, PAL.yellow).rect(12, 12, 2, 2, PAL.yellow);
  p.outline(PAL.outline);
  return p;
}

function tag() {
  const p = new Pixels();
  p.polygon([[1.5, 2.5], [9, 2.5], [15, 8.5], [8.5, 15], [1.5, 8]], PAL.yellow);
  p.shade(PAL.yellow, PAL.brightYellow, PAL.amber);
  p.disc(5, 6, 1.2, PAL.white);
  p.line(7, 9, 10, 12, PAL.amber);
  p.outline(PAL.outlineBrown);
  return p;
}

function door() {
  const p = new Pixels();
  p.rect(3, 1, 10, 14, PAL.darkBrown);
  p.rect(4, 2, 8, 13, PAL.lightBrown);
  p.shade(PAL.lightBrown, PAL.tan, PAL.brown);
  p.line(8, 3, 8, 14, PAL.brown);
  p.disc(10.5, 9, 0.8, PAL.yellow);
  p.outline(PAL.outline);
  return p;
}

function bulb() {
  const p = new Pixels();
  p.disc(8, 6.5, 5, PAL.yellow);
  p.rect(6, 10, 4, 2, PAL.yellow);
  p.shade(PAL.yellow, PAL.brightYellow, PAL.amber);
  p.rect(6, 12, 4, 2, PAL.lightGrey);
  p.rect(7, 14, 2, 1, PAL.grey);
  p.set(6, 4, PAL.white).set(5, 5, PAL.white);
  p.outline(PAL.outlineBrown);
  return p;
}

function jsIcon() {
  const p = new Pixels();
  p.rect(1, 1, 14, 14, PAL.yellow);
  p.art(3, 6, [
    '..JJ.SSSS',
    '...J.S...',
    '...J.SSSS',
    'J..J....S',
    '.JJ..SSSS',
  ], { J: PAL.outline, S: PAL.outline });
  p.outline(PAL.outlineBrown);
  return p;
}

function sprout() {
  const p = new Pixels();
  p.ellipse(8, 14, 6, 1.6, PAL.soil);
  p.line(8, 7, 8, 13, PAL.green);
  p.ellipse(5, 7, 3.2, 1.8, PAL.lightGreen).ellipse(11, 5.5, 3.2, 1.8, PAL.lightGreen);
  p.shade(PAL.lightGreen, PAL.paleGreen, PAL.green);
  p.outline(PAL.outline);
  return p;
}

function herb() {
  const p = new Pixels();
  p.line(8, 4, 8, 15, PAL.green);
  for (const [x, y] of [[5, 6], [11, 5], [5, 10], [11, 9], [8, 2.5]]) p.ellipse(x, y, 2.6, 1.5, PAL.lightGreen);
  p.shade(PAL.lightGreen, PAL.paleGreen, PAL.green);
  p.outline(PAL.outline);
  return p;
}

function scroll() {
  const p = new Pixels();
  p.rect(3, 3, 10, 10, PAL.sand);
  p.rect(2, 1.5, 12, 2, PAL.tan).rect(2, 12.5, 12, 2, PAL.tan);
  for (let y = 5; y < 12; y += 2) p.line(5, y, y % 4 ? 10 : 11, y, PAL.lightBrown);
  p.outline(PAL.outlineBrown);
  return p;
}

function compass() {
  const p = new Pixels();
  p.disc(8, 8, 7, PAL.yellow);
  p.disc(8, 8, 5.4, PAL.white);
  p.polygon([[8, 3], [10, 8], [6, 8]], PAL.brightRed);
  p.polygon([[8, 13], [10, 8], [6, 8]], PAL.darkGrey);
  p.outline(PAL.outlineBrown);
  return p;
}

function bug() {
  const p = new Pixels();
  for (const y of [7, 10, 13]) p.line(2, y - 1, 14, y + 1, PAL.outline);
  p.ellipse(8, 9.5, 5, 5.5, PAL.brightRed);
  p.shade(PAL.brightRed, null, PAL.red);
  p.line(8, 5, 8, 15, PAL.outline);
  p.disc(8, 3.5, 2.4, PAL.outline);
  for (const [x, y] of [[5.5, 8], [10.5, 8], [5.5, 12], [10.5, 12]]) p.disc(x, y, 0.8, PAL.outline);
  p.outline(PAL.outline);
  return p;
}

function eye() {
  const p = new Pixels();
  p.ellipse(8, 8, 7, 4.2, PAL.white);
  p.disc(8, 8, 2.8, PAL.sky);
  p.disc(8, 8, 1.3, PAL.outline);
  p.set(7, 7, PAL.white);
  p.outline(PAL.outline);
  return p;
}

function cart() {
  const p = new Pixels();
  p.line(0, 2, 2, 2, PAL.darkGrey).line(2, 2, 4, 10, PAL.darkGrey);
  p.polygon([[3, 4], [15, 4], [13, 10], [4.5, 10]], PAL.yellow);
  p.shade(PAL.yellow, PAL.brightYellow, PAL.amber);
  for (const x of [6, 9, 12]) p.line(x, 5, x - 0.5, 9, PAL.amber);
  p.line(4, 12, 13, 12, PAL.darkGrey);
  p.disc(5.5, 14, 1.3, PAL.darkGrey).disc(12, 14, 1.3, PAL.darkGrey);
  p.outline(PAL.outline);
  return p;
}

function clipboard() {
  const p = new Pixels();
  p.rect(2, 2, 12, 14, PAL.lightBrown);
  p.rect(3, 4, 10, 11, PAL.white);
  for (let y = 6; y < 14; y += 2) p.line(5, y, 11, y, PAL.lightGrey);
  p.rect(5, 1, 6, 3, PAL.grey);
  p.outline(PAL.outlineBrown);
  return p;
}

function cone() {
  const p = new Pixels();
  p.polygon([[7, 1], [9, 1], [12.5, 13], [3.5, 13]], PAL.orange);
  p.rect(5, 5, 6, 2, PAL.white).rect(4, 9, 8, 2, PAL.white);
  p.rect(2, 13, 12, 2, PAL.orange);
  p.outline(PAL.outlineBrown);
  return p;
}

function padlock() {
  const p = new Pixels();
  p.rect(4, 2, 2, 6, PAL.grey).rect(10, 2, 2, 6, PAL.grey).rect(5, 1, 6, 2, PAL.grey);
  p.rect(2, 7, 12, 8, PAL.yellow);
  p.shade(PAL.yellow, PAL.brightYellow, PAL.amber);
  p.disc(8, 10, 1.2, PAL.darkBrown).rect(7.5, 10, 1, 3, PAL.darkBrown);
  p.outline(PAL.outline);
  return p;
}

function check() {
  const p = new Pixels();
  for (const d of [0, 1, 2]) p.line(2, 8 + d, 6, 12 + d, PAL.lightGreen).line(6, 12 + d, 13, 4 + d, PAL.lightGreen);
  p.outline(PAL.deepGreen);
  return p;
}

function party() {
  const p = new Pixels();
  p.polygon([[1, 15], [4.5, 5], [11, 11.5]], PAL.yellow);
  p.line(3, 11, 6, 13, PAL.brightRed).line(4, 8, 8.5, 12, PAL.brightRed);
  for (const [x, y, c] of [[9, 3, PAL.pink], [13, 5, PAL.sky], [11, 1, PAL.lightGreen], [14, 9, PAL.brightRed], [7, 2, PAL.amber]]) p.rect(x, y, 2, 1, c);
  p.outline(PAL.outlineBrown);
  return p;
}

function confettiIcon() {
  const p = new Pixels();
  const c = [PAL.pink, PAL.sky, PAL.lightGreen, PAL.brightRed, PAL.yellow, PAL.purple];
  const at = [[2, 2], [7, 1], [12, 3], [4, 6], [9, 5], [14, 7], [1, 10], [6, 9], [11, 10], [3, 13], [8, 13], [13, 13]];
  at.forEach(([x, y], i) => p.rect(x, y, i % 2 ? 2 : 1, i % 2 ? 1 : 2, c[i % c.length]));
  return p;
}

function blossom() {
  const p = new Pixels();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    p.disc(8 + Math.cos(a) * 3.8, 8 + Math.sin(a) * 3.8, 2.8, '#f7a8c4');
  }
  p.disc(8, 8, 1.8, PAL.yellow);
  p.outline(PAL.pink);
  return p;
}

function autumnLeaf() {
  const p = new Pixels();
  p.polygon([[8, 1], [11, 4], [14.5, 4], [13, 8], [15, 11], [10, 11], [8, 14], [6, 11], [1, 11], [3, 8], [1.5, 4], [5, 4]], PAL.orange);
  p.shade(PAL.orange, PAL.amber, PAL.brightRed);
  p.line(8, 4, 8, 15, PAL.brown);
  p.outline(PAL.outlineBrown);
  return p;
}

function snowflake() {
  const p = new Pixels();
  p.line(8, 1, 8, 15, PAL.white).line(2, 4, 14, 12, PAL.white).line(2, 12, 14, 4, PAL.white);
  for (const [x, y] of [[8, 3], [8, 13]]) p.line(x - 2, y - (y < 8 ? 1 : -1), x + 2, y - (y < 8 ? 1 : -1), PAL.white);
  p.disc(8, 8, 1.4, PAL.pale);
  p.outline(PAL.sky);
  return p;
}

function sun() {
  const p = new Pixels();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    p.line(8 + Math.cos(a) * 5, 8 + Math.sin(a) * 5, 8 + Math.cos(a) * 7, 8 + Math.sin(a) * 7, PAL.amber);
  }
  p.disc(8, 8, 4.2, PAL.yellow);
  p.shade(PAL.yellow, PAL.brightYellow, PAL.amber);
  p.outline(PAL.outlineBrown);
  return p;
}

function cloud(color, below) {
  const p = new Pixels();
  p.disc(5, 7.5, 3, color).disc(9, 5.5, 3.8, color).disc(12, 8, 2.6, color).rect(3, 8, 10, 2.5, color);
  p.shade(color, PAL.white, PAL.grey);
  p.outline(PAL.outline);
  below(p);
  return p;
}

function tractor() {
  const p = new Pixels();
  p.rect(2, 7, 10, 4, PAL.brightRed);
  p.rect(7, 3, 4, 5, PAL.brightRed);
  p.rect(8, 4, 2, 2, PAL.sky);
  p.rect(3, 4, 1, 3, PAL.darkGrey);
  p.shade(PAL.brightRed, null, PAL.red);
  p.disc(10, 12, 3.2, PAL.darkGrey).disc(10, 12, 1.2, PAL.lightGrey);
  p.disc(4, 13, 2, PAL.darkGrey);
  p.outline(PAL.outline);
  return p;
}

function gem() {
  const p = new Pixels();
  p.polygon([[4, 2.5], [12, 2.5], [15, 6.5], [8, 15], [1, 6.5]], PAL.cyan);
  p.polygon([[4, 2.5], [12, 2.5], [15, 6.5], [1, 6.5]], PAL.pale);
  p.line(5.5, 6.5, 8, 14, PAL.sky).line(10.5, 6.5, 8, 14, PAL.sky);
  p.outline(PAL.navy);
  return p;
}

function fir() {
  const p = new Pixels();
  p.rect(7, 13, 2, 3, PAL.brown);
  for (const [y, w] of [[3, 3], [6, 5], [9, 7]]) p.polygon([[8, y - 2], [8 + w, y + 4], [8 - w, y + 4]], PAL.green);
  p.shade(PAL.green, PAL.lightGreen, PAL.darkGreen);
  for (const [x, y, c] of [[6, 7, PAL.brightRed], [10, 10, PAL.yellow], [5, 11, PAL.sky]]) p.set(x, y, c);
  p.set(8, 0, PAL.yellow).set(8, 1, PAL.yellow);
  p.outline(PAL.outline);
  return p;
}

function loopIcon() {
  const p = new Pixels();
  p.disc(8, 8, 6.2, PAL.sky);
  p.disc(8, 8, 3.6, null);
  p.rect(9, 0, 7, 8, null);
  p.polygon([[9, 1], [14.5, 4.5], [9, 8]], PAL.sky);
  p.outline(PAL.navy);
  return p;
}

function branch() {
  const p = new Pixels();
  for (const d of [0, 1]) p.line(7 + d, 15, 7 + d, 8, PAL.lightGreen).line(7 + d, 8, 3 + d, 4, PAL.lightGreen).line(7 + d, 8, 11 + d, 4, PAL.lightGreen);
  p.polygon([[1, 1.5], [6, 2], [2, 6]], PAL.lightGreen).polygon([[15, 1.5], [10, 2], [14, 6]], PAL.lightGreen);
  p.outline(PAL.deepGreen);
  return p;
}

function box() {
  const p = new Pixels();
  p.polygon([[1.5, 5], [8, 2], [14.5, 5], [8, 8]], PAL.tan);
  p.polygon([[1.5, 5], [8, 8], [8, 15], [1.5, 12]], PAL.lightBrown);
  p.polygon([[14.5, 5], [8, 8], [8, 15], [14.5, 12]], PAL.brown);
  p.line(4.5, 3.5, 11, 6.5, PAL.sand);
  p.outline(PAL.outlineBrown);
  return p;
}

function puzzle() {
  const p = new Pixels();
  p.rect(2, 5, 10, 10, PAL.sky);
  p.disc(7, 4, 2, PAL.sky).disc(13, 10, 2, PAL.sky);
  p.shade(PAL.sky, PAL.pale, PAL.blue);
  p.outline(PAL.navy);
  return p;
}

function sliders() {
  const p = new Pixels();
  for (const [y, x] of [[3, 5], [8, 11], [13, 7]]) {
    p.line(1, y, 14, y, PAL.grey);
    p.rect(x - 1, y - 2, 3, 5, PAL.yellow);
  }
  p.outline(PAL.outline);
  return p;
}

function dolls() {
  const p = new Pixels();
  p.ellipse(5.5, 10, 4.5, 5.5, PAL.brightRed).disc(5.5, 4, 3, PAL.brightRed);
  p.disc(5.5, 4.5, 1.8, '#f2c6a0');
  p.ellipse(12, 12, 3, 3.6, PAL.yellow).disc(12, 7.8, 2, PAL.yellow);
  p.set(12, 8, '#f2c6a0');
  p.outline(PAL.outlineBrown);
  return p;
}

function folder() {
  const p = new Pixels();
  p.rect(1, 3, 6, 3, PAL.amber);
  p.rect(1, 5, 14, 10, PAL.yellow);
  p.shade(PAL.yellow, PAL.brightYellow, PAL.amber);
  p.outline(PAL.outlineBrown);
  return p;
}

function inbox() {
  const p = new Pixels();
  p.rect(1, 9, 14, 6, PAL.grey);
  p.rect(4, 9, 8, 2, PAL.darkGrey);
  p.rect(7, 1, 2, 5, PAL.sky).polygon([[4, 5], [12, 5], [8, 9.5]], PAL.sky);
  p.outline(PAL.outline);
  return p;
}

function key() {
  const p = new Pixels();
  p.disc(4.5, 5, 3.5, PAL.yellow);
  p.disc(4.5, 5, 1.4, null);
  p.line(7, 7, 14, 14, PAL.yellow).line(7, 8, 13, 14, PAL.yellow);
  p.rect(10, 12, 2, 2, PAL.yellow).rect(12, 10, 2, 2, PAL.yellow);
  p.outline(PAL.outlineBrown);
  return p;
}

// A drone turning a somersault (the acrobat sticker).
function flip() {
  return recolored(loopIcon(), { [PAL.sky]: PAL.orange, [PAL.navy]: PAL.outlineBrown });
}

function workshop() {
  const p = new Pixels();
  p.rect(2, 6, 12, 9, PAL.lightBrown);
  p.shade(PAL.lightBrown, PAL.tan, PAL.brown);
  p.polygon([[1, 6.5], [8, 1.5], [15, 6.5]], PAL.grey);
  p.rect(11, 1, 2, 4, PAL.darkGrey);
  p.rect(6, 9, 4, 6, PAL.darkBrown);
  p.outline(PAL.outlineBrown);
  return p;
}

function goat() {
  const p = new Pixels();
  p.art(0, 0, [
    '................',
    '...........K.K..',
    '..........KWWK..',
    '..........WEWW..',
    '..........WWWWP.',
    '.W.......WWWW...',
    '..WWWWWWWWWW....',
    '..WWWWWWWWWW....',
    '..WWWWWWWWWG....',
    '..GWWWWWWWWG....',
    '...W.W...W.W....',
    '...W.W...W.W....',
    '...K.K...K.K....',
    '................',
    '................',
    '................',
  ], { W: PAL.sand, G: PAL.tan, K: PAL.darkGrey, P: '#f4a6a6', E: PAL.outline });
  p.outline(PAL.outlineBrown);
  return p;
}

function sheep() {
  const p = new Pixels();
  for (const [x, y] of [[4, 8], [7, 6.5], [10, 7], [6, 10], [10, 10]]) p.disc(x, y, 3, PAL.white);
  p.shade(PAL.white, null, PAL.lightGrey);
  p.ellipse(13, 7, 2, 2.5, PAL.darkGrey);
  p.rect(4, 12, 1, 3, PAL.darkGrey).rect(10, 12, 1, 3, PAL.darkGrey);
  p.outline(PAL.outline);
  return p;
}

function bee() {
  const p = new Pixels();
  p.ellipse(6, 4.5, 3, 2.4, PAL.white).ellipse(10, 4.5, 3, 2.4, PAL.white);
  p.ellipse(8, 10, 6, 4, PAL.yellow);
  for (const x of [6, 9]) p.rect(x, 6, 2, 8, PAL.outline);
  p.disc(13.5, 9.5, 1.6, PAL.outline);
  p.outline(PAL.outline);
  return p;
}

function buffalo() {
  const p = new Pixels();
  p.ellipse(7, 9, 6, 4, PAL.darkGrey).disc(12.5, 7, 2.6, PAL.darkGrey);
  p.line(11, 4, 10, 2, PAL.lightGrey).line(14, 4, 15, 2, PAL.lightGrey);
  p.rect(3, 12, 1, 3, PAL.outline).rect(9, 12, 1, 3, PAL.outline);
  p.set(13, 7, PAL.white);
  p.outline(PAL.outline);
  return p;
}

function rabbit() {
  const p = new Pixels();
  p.ellipse(6.5, 3.5, 1.2, 3.2, PAL.white).ellipse(9.5, 3.5, 1.2, 3.2, PAL.white);
  p.disc(8, 8, 3.4, PAL.white);
  p.ellipse(8, 12.5, 4.5, 3, PAL.white);
  p.shade(PAL.white, null, PAL.lightGrey);
  p.set(6.5, 7.5, PAL.outline).set(9.5, 7.5, PAL.outline).set(8, 9, '#f4a6a6');
  p.outline(PAL.outline);
  return p;
}

function handsIcon() {
  const p = new Pixels();
  p.ellipse(5, 9, 4, 5, '#f2c6a0').ellipse(11, 9, 4, 5, '#f2c6a0');
  p.shade('#f2c6a0', '#fbe0c8', '#d9a27a');
  p.line(8, 5, 8, 14, '#d9a27a');
  p.outline(PAL.outlineBrown);
  return p;
}

function broom() {
  const p = new Pixels();
  p.line(12, 1, 7, 9, PAL.lightBrown).line(13, 1, 8, 9, PAL.lightBrown);
  p.polygon([[5, 8], [10, 10], [8, 15.5], [1, 13]], PAL.yellow);
  p.shade(PAL.yellow, null, PAL.amber);
  p.outline(PAL.outlineBrown);
  return p;
}

function heart() {
  const p = new Pixels();
  p.disc(5, 6, 3.5, PAL.brightRed).disc(11, 6, 3.5, PAL.brightRed).polygon([[1.6, 7], [14.4, 7], [8, 14.5]], PAL.brightRed);
  p.shade(PAL.brightRed, '#f7a8c4', PAL.red);
  p.outline(PAL.outlineBrown);
  return p;
}

function wagon() {
  const p = new Pixels();
  p.rect(1, 5, 12, 6, PAL.lightBrown);
  p.shade(PAL.lightBrown, PAL.tan, PAL.brown);
  p.rect(2, 3, 10, 3, PAL.yellow);
  p.line(13, 9, 15, 7, PAL.brown);
  p.disc(4, 12.5, 2.3, PAL.darkBrown).disc(10, 12.5, 2.3, PAL.darkBrown);
  p.outline(PAL.outline);
  return p;
}

// A villager's face for the order lists: skin, hair and one thing that tells them apart.
function face(skin, hair, extra) {
  const p = new Pixels();
  p.rect(3, 13, 10, 3, extra === 'cook' ? PAL.white : extra === 'fisher' ? PAL.green : PAL.purple);
  p.disc(8, 8, 5, skin);
  p.ellipse(8, 4.5, 5.5, 2.6, hair);
  if (extra === 'scarf') p.ellipse(8, 4, 6.5, 3, PAL.brightRed).rect(2, 6, 2, 5, PAL.brightRed).rect(12, 6, 2, 5, PAL.brightRed);
  if (extra === 'cook') p.rect(4, 0, 8, 4, PAL.white).rect(3, 3, 10, 1, PAL.lightGrey);
  if (extra === 'hat') p.rect(3, 2, 10, 2, PAL.olive || PAL.darkGreen).rect(1, 4, 14, 1, PAL.darkGreen);
  if (extra === 'bows') p.disc(3, 5, 1.6, PAL.pink).disc(13, 5, 1.6, PAL.pink);
  p.set(6, 8, PAL.outline).set(10, 8, PAL.outline);
  p.line(7, 11, 9, 11, PAL.soilLight);
  if (extra === 'scarf') p.set(5, 7, PAL.grey).set(11, 7, PAL.grey);
  p.outline(PAL.outlineBrown);
  return p;
}

// --- the workshop and its goods

function matsun() {
  const p = new Pixels();
  p.polygon([[3, 6], [13, 6], [12, 14], [4, 14]], PAL.lightBrown);
  p.shade(PAL.lightBrown, PAL.tan, PAL.brown);
  p.ellipse(8, 6, 5, 1.8, PAL.white);
  p.rect(4, 9, 8, 1, PAL.sand);
  p.outline(PAL.outlineBrown);
  return p;
}

function cheese() {
  const p = new Pixels();
  p.polygon([[1.5, 9], [12, 4], [14.5, 9], [14.5, 13], [1.5, 13]], PAL.yellow);
  p.shade(PAL.yellow, PAL.brightYellow, PAL.amber);
  for (const [x, y] of [[5, 10], [10, 11], [12, 7]]) p.disc(x, y, 1, PAL.amber);
  p.outline(PAL.outlineBrown);
  return p;
}

function butter() {
  const p = new Pixels();
  p.rect(2, 9, 12, 5, PAL.lightGrey);
  p.polygon([[3, 9], [5, 5], [13, 5], [12, 9]], '#fff2a8');
  p.rect(3, 7, 9, 2, '#fff2a8');
  p.shade('#fff2a8', PAL.white, PAL.yellow);
  p.outline(PAL.outlineBrown);
  return p;
}

function omelet() {
  const p = new Pixels();
  p.ellipse(8, 10, 7, 4, PAL.lightGrey);
  p.ellipse(8, 9.5, 5.5, 3, '#fff2a8');
  p.disc(7, 9, 1.8, PAL.yellow).disc(10, 10, 1.2, PAL.yellow);
  p.set(5, 10, PAL.lightGreen).set(11, 8, PAL.lightGreen);
  p.outline(PAL.outlineBrown);
  return p;
}

function manure() {
  const p = new Pixels();
  p.ellipse(8, 12, 6, 2.5, PAL.soilDark).ellipse(8, 9.5, 4.2, 2, PAL.soil).ellipse(8, 7.5, 2.4, 1.5, PAL.soilLight);
  p.outline(PAL.outlineBrown);
  return p;
}

function medicine() {
  const p = new Pixels();
  p.rect(4, 5, 8, 10, PAL.white);
  p.shade(PAL.white, null, PAL.lightGrey);
  p.rect(5, 2, 6, 3, PAL.brightRed);
  p.rect(7, 7, 2, 6, PAL.brightRed).rect(5, 9, 6, 2, PAL.brightRed);
  p.outline(PAL.outline);
  return p;
}

function plank() {
  const p = new Pixels();
  p.polygon([[1, 10], [13, 3], [15, 6], [3, 13]], PAL.tan);
  p.shade(PAL.tan, PAL.sand, PAL.lightBrown);
  p.line(4, 10, 12, 5, PAL.lightBrown);
  p.set(4, 11, PAL.darkGrey).set(12, 5, PAL.darkGrey);
  p.outline(PAL.outlineBrown);
  return p;
}

function nazook() {
  const p = new Pixels();
  p.rect(1, 6, 14, 6, PAL.tan);
  p.shade(PAL.tan, PAL.sand, PAL.lightBrown);
  for (const x of [5, 10]) p.line(x, 6, x - 1, 11, PAL.lightBrown);
  p.line(2, 9, 13, 9, '#fff2a8');
  p.outline(PAL.outlineBrown);
  return p;
}

// The dairy: a churn and a cheese press on a table.
function dairy() {
  const p = new Pixels();
  p.rect(1, 11, 14, 2, PAL.lightBrown).rect(2, 13, 2, 3, PAL.brown).rect(12, 13, 2, 3, PAL.brown);
  p.polygon([[3, 4], [7, 4], [7.5, 11], [2.5, 11]], PAL.tan);
  p.shade(PAL.tan, PAL.sand, PAL.lightBrown);
  p.line(5, 0, 5, 4, PAL.brown);
  p.rect(9, 7, 5, 4, PAL.yellow).rect(9, 5, 5, 2, PAL.grey);
  p.outline(PAL.outlineBrown);
  return p;
}

function stove() {
  const p = new Pixels();
  p.rect(2, 5, 12, 10, PAL.grey);
  p.shade(PAL.grey, PAL.lightGrey, PAL.darkGrey);
  p.rect(4, 9, 8, 4, PAL.darkGrey);
  p.rect(5, 10, 6, 2, PAL.orange).set(7, 10, PAL.yellow);
  p.rect(10, 1, 2, 4, PAL.darkGrey);
  p.ellipse(6, 4.5, 3, 1, PAL.darkGrey);
  p.outline(PAL.outline);
  return p;
}

function bell() {
  const p = new Pixels();
  p.polygon([[8, 2], [12, 6], [13, 12], [3, 12], [4, 6]], PAL.yellow);
  p.shade(PAL.yellow, PAL.brightYellow, PAL.amber);
  p.rect(2, 12, 12, 2, PAL.amber);
  p.disc(8, 14.5, 1.3, PAL.amber);
  p.rect(7, 0, 2, 2, PAL.amber);
  p.outline(PAL.outlineBrown);
  return p;
}
