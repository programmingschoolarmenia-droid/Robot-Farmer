// Carpets (config/ranch.json → carpets): a carpet is a text of palette letters, one letter per knot,
// row by row from the top (like a sample's rows); '.' is a knot not woven yet. Squares count from the
// bottom-left corner, like the pens.
export const EMPTY = '.';

export const emptyCells = (n) => EMPTY.repeat(n * n);
export const cellIndex = (n, x, y) => (n - 1 - y) * n + x;
export const sampleCells = (sample) => sample.rows.join('');

// The letter a knot counts as when compared with a sample (soft yarn is white yarn).
function plainLetters(palette) {
  const out = {};
  for (const c of Object.values(palette)) out[c.letter] = c.like ? palette[c.like].letter : c.letter;
  return out;
}

// How alike a carpet and a sample are: 0…1 (the share of the same knots).
export function alikeShare(cells, sample, palette) {
  const plain = plainLetters(palette);
  const want = sampleCells(sample);
  let same = 0;
  for (let i = 0; i < want.length; i++) if (plain[cells[i]] === want[i]) same++;
  return same / want.length;
}

// What a finished carpet pays: an order's price × how alike it is, a free carpet's fixed price; soft
// yarn adds its bonus.
export function carpetPrice(cfg, carpet) {
  const base = carpet.pay ? carpet.pay * carpet.alike : cfg.free;
  const soft = (carpet.soft || 0) / carpet.cells.length;
  return Math.round(base * (1 + (cfg.softBonus ?? 0) * soft));
}

// A list of mistakes in carpets config (for the validator).
export function carpetProblems(cfg) {
  const out = [];
  const n = cfg.size ?? 9;
  const letters = new Set(Object.values(cfg.palette || {}).map((c) => c.letter));
  (cfg.samples || []).forEach((s, i) => {
    const p = `carpets.samples[${i}]`;
    if (!Array.isArray(s.rows) || s.rows.length !== n || !s.rows.every((r) => typeof r === 'string' && r.length === n)) out.push([p, `rows-ը պետք է լինի ${n} տող՝ ${n}-ական տառով`]);
    else if (![...s.rows.join('')].every((ch) => letters.has(ch))) out.push([p, `Անհայտ տառ. թույլատրված են՝ ${[...letters].join(' ')}`]);
  });
  return out;
}
