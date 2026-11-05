// The player market's rules (config/settings.json → market). Item values are the leaderboard's
// points, so there is one value table. A problem is a key of texts.json → ui.marketProblem.
const cfgOf = (settings) => settings.market || {};
const worth = (settings, item) => ((settings.leaderboard || {}).points || {})[item] || 0;

export const tradable = (settings, item) => (cfgOf(settings).goods || []).includes(item) && worth(settings, item) > 0;

// Lowest and highest amount of `want` that is a fair price for `giveN` of `give`.
export function allowedRange(settings, give, giveN, want) {
  const value = giveN * worth(settings, give);
  const w = worth(settings, want);
  const band = cfgOf(settings).band ?? 3;
  return { min: Math.max(1, Math.ceil(value / (w * band))), max: Math.floor((value * band) / w) };
}

// The amount of `want` worth the same as `giveN` of `give` (inside the allowed range).
export function equalAmount(settings, give, giveN, want) {
  const { min, max } = allowedRange(settings, give, giveN, want);
  return Math.min(max, Math.max(min, Math.round((giveN * worth(settings, give)) / worth(settings, want))));
}

// Is this order allowed at all? Other students' games ask it too, so a forged order is refused.
export function orderProblem(settings, { give, giveN, want, wantN }) {
  const { band = 3, maxAmount = Infinity } = cfgOf(settings);
  if (!tradable(settings, give) || !tradable(settings, want) || give === want) return 'same';
  for (const n of [giveN, wantN]) if (!Number.isInteger(n) || n < 1 || n > maxAmount) return 'amount';
  const a = giveN * worth(settings, give);
  const b = wantN * worth(settings, want);
  return a > b * band || b > a * band ? 'price' : null;
}

export const orderExpired = (settings, order, now) => now - order.at > (cfgOf(settings).days ?? 3) * 86400000;

// Trading saves time but never skips a mechanic: only goods this player's own farm has made.
const made = (game, item) => game.stats.total(item) > 0;

// Why this player can't place the order (null = can). open: their open orders now.
export function placeProblem(game, order, open) {
  const problem = orderProblem(game.config.settings, order);
  if (problem) return problem;
  if (!made(game, order.give) || !made(game, order.want)) return 'made';
  if (game.inventory.get(order.give) < order.giveN) return 'have';
  return open >= (cfgOf(game.config.settings).openOrders ?? 3) ? 'open' : null;
}

// Why this player can't take the order (null = can). takenToday: orders taken today.
export function takeProblem(game, order, me, takenToday) {
  if (order.owner === me) return 'mine';
  if (!made(game, order.give) || !made(game, order.want)) return 'made';
  if (game.inventory.get(order.want) < order.wantN) return 'have';
  return takenToday >= (cfgOf(game.config.settings).takenPerDay ?? 5) ? 'limit' : null;
}
