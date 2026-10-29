// A drone flying over the farm. Drone #0 always exists; more appear with Megafarm.
export class Drone {
  constructor(game, id, saved = {}) {
    this.game = game;
    this.id = id;
    this.x = saved.x ?? 0;
    this.y = saved.y ?? 0;
    this.hat = saved.hat ?? 'Straw_Hat';
    this.time = 0; // local game time (seconds)
    this.interp = null;
    this.gen = null;
    this.state = 'idle'; // idle | running | waiting | done | error
    this.anim = null; // { kind, fromX, fromY, toX, toY, start, end, dx, dy }
    this.execSpeed = 0; // setSpeed(): 0 = no limit
    this.result = undefined;
    this.tickCount = 0;
    this.actions = 0;
    this.idleTicks = 0;
  }

  // Ticks per game second for this drone right now.
  tickRate() {
    const g = this.game;
    const s = g.config.settings;
    const time = s.time || {};
    const base = time.ticksPerSecond ?? 400;
    let rate = base * Math.pow(time.speedPerTier ?? 1.5, g.research.level(time.speedResearch || 'Speed'));
    if (g.inventory.get('Power') > 0) rate *= (s.power && s.power.speedMultiplier) || 2;
    rate *= g.boost('speed'); // gata (village kitchen)
    if (this.execSpeed > 0) rate = Math.min(rate, base * this.execSpeed);
    return rate;
  }

  startAnim(kind, fromX, fromY, toX, toY, dx, dy, duration) {
    this.anim = { kind, fromX, fromY, toX, toY, dx, dy, start: this.time, end: this.time + duration };
  }

  // Visual position at game time t (handles wrap-around moves).
  visualPosition(t) {
    const a = this.anim;
    if (!a || t >= a.end || a.kind !== 'move') return { x: this.x, y: this.y, wrapping: false, progress: 1 };
    const p = Math.max(0, Math.min(1, (t - a.start) / Math.max(1e-6, a.end - a.start)));
    const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    const wrapped = a.toX !== a.fromX + a.dx || a.toY !== a.fromY + a.dy;
    if (!wrapped) {
      return { x: a.fromX + (a.toX - a.fromX) * ease, y: a.fromY + (a.toY - a.fromY) * ease, wrapping: false, progress: p };
    }
    // Wrap: fly out one side, come in from the other.
    if (ease < 0.5) {
      return { x: a.fromX + a.dx * ease, y: a.fromY + a.dy * ease, wrapping: true, progress: p };
    }
    return { x: a.toX - a.dx * (1 - ease), y: a.toY - a.dy * (1 - ease), wrapping: true, progress: p };
  }

  toSave() {
    return { x: this.x, y: this.y, hat: this.hat };
  }
}
