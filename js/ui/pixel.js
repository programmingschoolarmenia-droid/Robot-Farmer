// Tiny pixel painter used to draw the game's own 16×16 sprites in code
// (ground, bush, tree, carrot, cactus, item icons, …) in the same style as the
// CC0 crop pack: flat colours, light top-left, dark outline.

// Palette taken from the crop pack (ENDESGA-like).
export const PAL = {
  outline: '#122020',
  outlineBrown: '#221c1a',
  deepGreen: '#24523b',
  darkGreen: '#1a7a3e',
  green: '#14a02e',
  lightGreen: '#59c135',
  paleGreen: '#9cdb43',
  lime: '#d6f264',
  orange: '#fa6a0a',
  amber: '#f9a31b',
  yellow: '#ffd541',
  brightYellow: '#fffc40',
  darkBrown: '#3b1725',
  brown: '#71413b',
  lightBrown: '#bb7547',
  tan: '#dba463',
  sand: '#f4d29c',
  red: '#b4202a',
  brightRed: '#df3e23',
  purple: '#793a80',
  pink: '#bc4a9b',
  darkPurple: '#403353',
  white: '#ffffff',
  grey: '#6d758d',
  lightGrey: '#b3b9d1',
  darkGrey: '#333941',
  soilDark: '#5b3138',
  soil: '#8e5252',
  soilLight: '#ba756a',
  navy: '#143464',
  blue: '#285cc4',
  sky: '#249fde',
  cyan: '#20d6c7',
  pale: '#a6fcdb',
};

export class Pixels {
  constructor(w = 16, h = 16) {
    this.w = w;
    this.h = h;
    this.data = new Array(w * h).fill(null);
  }

  set(x, y, c) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return this;
    this.data[y * this.w + x] = c;
    return this;
  }

  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.data[y * this.w + x];
  }

  rect(x, y, w, h, c) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
    return this;
  }

  // Filled ellipse centred at (cx, cy) with radii rx, ry (pixel centres at +0.5).
  ellipse(cx, cy, rx, ry, c) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
    }
    return this;
  }

  disc(cx, cy, r, c) {
    return this.ellipse(cx, cy, r, r, c);
  }

  line(x0, y0, x1, y1, c) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
    return this;
  }

  // Polygon fill (even-odd) with points [[x,y],…] in pixel units.
  polygon(points, c) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const [xi, yi] = points[i];
          const [xj, yj] = points[j];
          if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) this.set(x, y, c);
      }
    }
    return this;
  }

  // Recolour pixels of colour `from` that satisfy `where(x,y)`.
  recolor(from, to, where = () => true) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) === from && where(x, y)) this.set(x, y, to);
      }
    }
    return this;
  }

  // Shade: pixels of `base` near the top-left edge become `light`, bottom-right become `dark`.
  shade(base, light, dark) {
    const copy = this.data.slice();
    const at = (x, y) => (x < 0 || y < 0 || x >= this.w || y >= this.h ? null : copy[y * this.w + x]);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (at(x, y) !== base) continue;
        if (light && (at(x - 1, y) === null || at(x, y - 1) === null)) this.set(x, y, light);
        else if (dark && (at(x + 1, y) === null || at(x, y + 1) === null)) this.set(x, y, dark);
      }
    }
    return this;
  }

  // 1-pixel outline around everything drawn so far.
  outline(c = PAL.outline, diagonal = false) {
    const copy = this.data.slice();
    const filled = (x, y) => x >= 0 && y >= 0 && x < this.w && y < this.h && copy[y * this.w + x] !== null;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (filled(x, y)) continue;
        const n = filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1);
        const d = diagonal && (filled(x - 1, y - 1) || filled(x + 1, y - 1) || filled(x - 1, y + 1) || filled(x + 1, y + 1));
        if (n || d) this.set(x, y, c);
      }
    }
    return this;
  }

  // Draws a string-art block: rows of characters mapped through `map` ('.' = transparent).
  art(x0, y0, rows, map) {
    rows.forEach((row, j) => {
      [...row].forEach((ch, i) => {
        if (ch === '.' || ch === ' ') return;
        const c = map[ch];
        if (c) this.set(x0 + i, y0 + j, c);
      });
    });
    return this;
  }

  toCanvas(scale = 1) {
    const cv = makeCanvas(this.w * scale, this.h * scale);
    const ctx = cv.getContext('2d');
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.data[y * this.w + x];
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    return cv;
  }
}

export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv;
}

// Deterministic small random for sprite variants.
export function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
