// Mazes: weird substance on a grown bush turns an area into a hedge maze with a treasure.
// Walls are stored per cell as a bitmask of OPEN sides: N=1, E=2, S=4, W=8.
export const DIR_BITS = { North: 1, East: 2, South: 4, West: 8 };
const OPPOSITE = { North: 'South', South: 'North', East: 'West', West: 'East' };
const STEPS = { North: [0, 1], East: [1, 0], South: [0, -1], West: [-1, 0] };

export class Maze {
  constructor({ x0, y0, size, open, treasure, uses = 0, amount = 0 }) {
    this.x0 = x0;
    this.y0 = y0;
    this.size = size;
    this.open = open; // Uint8Array(size*size)
    this.treasure = treasure; // { x, y } in world coordinates
    this.uses = uses;
    this.amount = amount;
  }

  static generate(x0, y0, size, rng) {
    const open = new Uint8Array(size * size);
    const seen = new Uint8Array(size * size);
    const stack = [[Math.floor(rng.next() * size), Math.floor(rng.next() * size)]];
    seen[stack[0][1] * size + stack[0][0]] = 1;
    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];
      const options = [];
      for (const [dir, [dx, dy]] of Object.entries(STEPS)) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size && !seen[ny * size + nx]) options.push([dir, nx, ny]);
      }
      if (!options.length) {
        stack.pop();
        continue;
      }
      const [dir, nx, ny] = options[Math.floor(rng.next() * options.length)];
      open[cy * size + cx] |= DIR_BITS[dir];
      open[ny * size + nx] |= DIR_BITS[OPPOSITE[dir]];
      seen[ny * size + nx] = 1;
      stack.push([nx, ny]);
    }
    const maze = new Maze({ x0, y0, size, open });
    maze.placeTreasure(rng);
    return maze;
  }

  contains(x, y) {
    return x >= this.x0 && y >= this.y0 && x < this.x0 + this.size && y < this.y0 + this.size;
  }

  cellOpen(x, y) {
    return this.open[(y - this.y0) * this.size + (x - this.x0)];
  }

  // Can a drone at (x, y) move in `dir`? (Only meaningful inside or next to the maze.)
  canMove(x, y, dir) {
    const [dx, dy] = STEPS[dir];
    const inside = this.contains(x, y);
    const targetInside = this.contains(x + dx, y + dy);
    if (inside) {
      if (!targetInside) return false; // outer walls
      return (this.cellOpen(x, y) & DIR_BITS[dir]) !== 0;
    }
    return !targetInside; // can't walk into the maze from outside
  }

  placeTreasure(rng, avoid = null) {
    for (let i = 0; i < 50; i++) {
      const x = this.x0 + Math.floor(rng.next() * this.size);
      const y = this.y0 + Math.floor(rng.next() * this.size);
      if (!avoid || x !== avoid.x || y !== avoid.y) {
        this.treasure = { x, y };
        return;
      }
    }
    this.treasure = { x: this.x0, y: this.y0 };
  }

  // Relocating the treasure also knocks down a few walls (making loops).
  relocate(rng) {
    const old = this.treasure;
    this.placeTreasure(rng, old);
    const knock = Math.max(1, Math.floor(this.size / 2));
    for (let i = 0; i < knock; i++) {
      const cx = Math.floor(rng.next() * this.size);
      const cy = Math.floor(rng.next() * this.size);
      const dirs = Object.keys(STEPS);
      const dir = dirs[Math.floor(rng.next() * 4)];
      const [dx, dy] = STEPS[dir];
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= this.size || ny >= this.size) continue;
      this.open[cy * this.size + cx] |= DIR_BITS[dir];
      this.open[ny * this.size + nx] |= DIR_BITS[OPPOSITE[dir]];
    }
    this.uses++;
  }

  toSave() {
    return { x0: this.x0, y0: this.y0, size: this.size, open: Array.from(this.open), treasure: this.treasure, uses: this.uses, amount: this.amount };
  }

  static fromSave(d) {
    return new Maze({ ...d, open: Uint8Array.from(d.open || []) });
  }
}
