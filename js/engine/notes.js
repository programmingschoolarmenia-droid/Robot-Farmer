// Secret code notes (config/events.json → notes): after a request a villager sometimes gives the
// next one. Each note is a riddle (math, a little program, a cipher or a fact about the farm) whose
// answer is a square; gtnel() on that square digs out the treasure (⭐ stars). gtnel() on a wrong
// square loses the treasure: the note fails, and a villager may give it again later.
export class Notes {
  constructor(game, saved = {}) {
    const s = saved || {};
    this.game = game;
    this.active = s.active || null; // the note being solved (one at a time)
    this.status = s.status || {}; // { n01: 'solved' | 'failed' }
    this.got = s.got || []; // the notes given so far, in order (Bridgy's book shows them)
    game.events.on('request', () => this.maybeGive());
  }

  get cfg() {
    return (this.game.config.events || {}).notes || {};
  }

  get list() {
    return this.cfg.list || [];
  }

  note(id) {
    return this.list.find((n) => n.id === id) || null;
  }

  get solved() {
    return this.list.filter((n) => this.status[n.id] === 'solved').length;
  }

  // A note waits until the farm is big enough for its square (and has what a fact asks about).
  fits(n) {
    const w = this.game.world;
    if (n.needs && this.game.research.level(n.needs) <= 0) return false;
    return !!n.fact || (n.x < w.width && n.y < w.height);
  }

  // The squares a note points to now ([[x, y]]; more than one when the farm has a tie, e.g. two
  // sunflowers with the most petals). Facts are read from the farm at the moment of digging.
  targets(n) {
    if (!n.fact) return [[n.x, n.y]];
    const tiles = this.game.world.tiles;
    const most = (type, value) => {
      const list = tiles.filter((t) => t.entity && t.entity.type === type && value(t) > 0);
      const top = Math.max(...list.map(value));
      return list.filter((t) => value(t) === top);
    };
    let at = [];
    if (n.fact === 'sunflower') at = most('Sunflower', (t) => t.entity.data.petals);
    else if (n.fact === 'cactus') at = most('Cactus', (t) => t.entity.data.size + 1);
    else if (n.fact === 'giant') at = most('Pumpkin', (t) => (t.entity.data.giant ? t.entity.data.giant.size : 0)).map((t) => t.entity.data.giant); // lower left corners
    else if (n.fact === 'ponds') at = [{ x: tiles.filter((t) => t.ground === 'Pond').length, y: 0 }];
    else if (n.fact === 'gold') at = [{ x: Math.floor(this.game.inventory.get('Gold')) % 10, y: 0 }];
    return at.map((p) => [p.x + (n.dx || 0), p.y + (n.dy || 0)]);
  }

  // After a villager's request: sometimes the next unsolved note that fits the farm.
  maybeGive() {
    if (this.active || !this.game.rng.chance(this.cfg.chance ?? 0.25)) return null;
    const n = this.list.find((x) => this.status[x.id] !== 'solved' && this.fits(x));
    if (!n) return null;
    this.active = n.id;
    delete this.status[n.id]; // a failed note can come again
    if (!this.got.includes(n.id)) this.got.push(n.id);
    this.game.events.emit('note', { id: n.id });
    return n;
  }

  // gtnel() at (x, y): 'solved', 'failed', or null when there is no note to solve.
  dig(x, y) {
    const n = this.note(this.active);
    if (!n) return null;
    const right = this.targets(n).some(([tx, ty]) => tx === x && ty === y);
    this.active = null;
    this.status[n.id] = right ? 'solved' : 'failed';
    if (right) {
      this.game.inventory.add('Star', this.cfg.stars ?? 3, 'note');
      if (this.solved === this.list.length) this.game.earnHat(this.cfg.hat);
    }
    this.game.events.emit(right ? 'noteSolved' : 'noteFailed', { id: n.id, x, y });
    return this.status[n.id];
  }

  toSave() {
    return { active: this.active, status: this.status, got: this.got };
  }
}
