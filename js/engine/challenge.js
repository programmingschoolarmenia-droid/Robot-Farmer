// The weekly challenge (config/events.json → challenge, challenges): one puzzle a week for everyone,
// played on a test farm that is the same for all (the task's research, items and seed; no seasons,
// luck, boosts or village). Every run starts a fresh farm; the score is the game time the goal was
// reached at (tenths of a second, lower is better), so watching faster (×8) changes nothing.
// The player's part is kept in the main game: game.challenge = { week, code, best, bestCode, prev }.
import { Game } from './game.js';
import { dayNumber, weekKey } from '../core/util.js';

export const CHALLENGE_SCRIPT = 'challenge';

// This week's task for day 'YYYYMMDD' (the list goes round, a new task every Monday), plus `week`.
export function weekTask(events, day) {
  const list = (events && events.challenges) || [];
  if (!list.length) return null;
  const n = Math.floor((dayNumber(day) + 3) / 7); // weeks since Monday 1969-12-29
  return { ...list[n % list.length], week: weekKey(day) };
}

// A fresh test farm for `task` with `code` in its only file.
export function testGame(config, task, code = '') {
  const cfg = (config.events && config.events.challenge) || {};
  const settings = { ...config.settings, game: { ...config.settings.game, speedOptions: cfg.speeds || [1, 2, 4, 8], defaultSpeed: 1 }, dev: { ...config.settings.dev, unlockAll: false } };
  delete settings.calendar; // no seasons, weather, luck or festivals
  return new Game(
    { ...config, settings },
    { seed: task.seed ?? 1, research: { ...cfg.levels, ...task.levels }, inventory: { ...task.items }, scripts: [{ name: CHALLENGE_SCRIPT, code }] },
  );
}

// Watches a test farm for the task's goal; returns { done } with the game time of the drone that
// reached it (null until then). Goals: { items: { Hay: 300 } } gathered, { harvest: { Trout: 1 } }
// harvested or caught, { giant: 4 } pumpkin, { chain: 20 } cacti, { dino: 10 } long dinosaur.
export function watchGoal(game, goal) {
  const [kind, v] = Object.entries(goal || {})[0] || [];
  const { stats, events } = game;
  const run = { done: null };
  const met = (e) => {
    if (kind === 'items') return Object.entries(v).every(([item, n]) => stats.total(item) >= n);
    if (kind === 'harvest') return Object.entries(v).every(([type, n]) => stats.harvestCount(type) >= n);
    if (kind === 'giant') return e.giantSize >= v;
    if (kind === 'chain') return e.chain >= v;
    return kind === 'dino' && e.eaten + 1 >= v;
  };
  const check = (e, id) => {
    if (run.done !== null || !met(e)) return;
    run.done = (game.runner.drones.find((d) => d.id === id) || game.mainDrone).time;
  };
  run.offs = [
    events.on('harvest', (e) => check(e, e.drone)),
    events.on('fish', (e) => check(e, e.drone)),
    events.on('items', (e) => e.amount > 0 && check(e, e.source && e.source.drone)),
    events.on('appleEaten', (e) => check(e, game.dino && game.dino.drone.id)),
  ];
  return run;
}

// A new week starts with an empty editor; last week's result is kept (as `prev`) for the leaderboard
// row until its prizes and the winner's code are no longer needed.
export function rollWeek(game, week) {
  const ch = game.challenge;
  if (ch.week === week) return ch;
  if (ch.best) ch.prev = { week: ch.week, best: ch.best, bestCode: ch.bestCode };
  return Object.assign(ch, { week, code: '', best: 0, bestCode: '' });
}

// A finished run (tenths of a second): the best one is kept with its code; the first one pays ⭐.
export function recordResult(game, tenths, code) {
  const ch = game.challenge;
  const first = !ch.best;
  const better = first || tenths < ch.best;
  if (better) Object.assign(ch, { best: tenths, bestCode: code });
  if (first) game.inventory.add('Star', ((game.config.events || {}).challenge || {}).stars ?? 5, 'challenge');
  return { better, first };
}

// Last week's top 3 (place 1–3): the challenge hat and medals.
export function givePrize(game, place) {
  const cfg = (game.config.events || {}).challenge || {};
  game.earnHat((cfg.hats || [])[place - 1]);
  game.inventory.add('Medal', (cfg.medals || [3, 2, 1])[place - 1] || 0, 'challenge');
  game.flags.challengeTop = Math.min(game.flags.challengeTop || place, place);
  game.events.emit('challengePrize', { place });
}
