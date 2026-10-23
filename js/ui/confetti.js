// Pixel confetti for celebrations (research bought, quest done).
const COLORS = ['#f4b63f', '#2d6be0', '#36a852', '#e2483d', '#7c3aed', '#ffffff', '#f08a24'];

export class Confetti {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'confetti-layer';
    document.body.append(this.canvas);
    this.parts = [];
    this.running = false;
    this.enabled = true;
  }

  burst(x = window.innerWidth / 2, y = window.innerHeight / 3, n = 90) {
    if (!this.enabled) return;
    const dpr = window.devicePixelRatio || 1;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 3 + Math.random() * 7;
      this.parts.push({
        x: x * dpr,
        y: y * dpr,
        vx: Math.cos(a) * s * dpr,
        vy: (Math.sin(a) * s - 6) * dpr,
        size: (4 + Math.random() * 5) * dpr,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        life: 1,
        spin: Math.random() * 6,
      });
    }
    if (!this.running) {
      this.running = true;
      requestAnimationFrame(() => this.tick());
    }
  }

  tick() {
    const dpr = window.devicePixelRatio || 1;
    const cv = this.canvas;
    if (cv.width !== innerWidth * dpr || cv.height !== innerHeight * dpr) {
      cv.width = innerWidth * dpr;
      cv.height = innerHeight * dpr;
    }
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of this.parts) {
      p.vy += 0.35 * dpr;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.011;
      p.spin += 0.2;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
      ctx.fillStyle = p.color;
      const w = p.size * Math.abs(Math.cos(p.spin));
      ctx.fillRect(p.x - w / 2, p.y - p.size / 2, Math.max(1, w), p.size);
    }
    ctx.globalAlpha = 1;
    this.parts = this.parts.filter((p) => p.life > 0 && p.y < cv.height + 40);
    if (this.parts.length) requestAnimationFrame(() => this.tick());
    else {
      this.running = false;
      ctx.clearRect(0, 0, cv.width, cv.height);
    }
  }
}
