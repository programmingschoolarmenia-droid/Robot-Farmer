import { readFileSync } from 'node:fs';
import { Game } from '../js/engine/game.js';

const base = new URL('../config/', import.meta.url);
const read = (f) => JSON.parse(readFileSync(new URL(f, base), 'utf8'));

export function loadConfig() {
  return {
    settings: read('settings.json'),
    research: read('research.json'),
    aliases: read('aliases.json'),
    texts: read('texts.json'),
    bridgy: read('bridgy.json'),
    guide: read('guide.json'),
    village: read('village.json'),
    events: read('events.json'),
    ranch: read('ranch.json'),
  };
}

// Creates a game. Options: unlockAll, items, seed, levels ({ id: level }), available (all nodes),
// clock (real ms: seasons, weather, luck and the leaderboard day). Seasons follow the real clock,
// so they are off unless a test passes `clock`.
export function makeGame(opts = {}) {
  const config = loadConfig();
  if (opts.clock === undefined) delete config.settings.calendar;
  if (opts.available) for (const n of config.research.nodes) n.available = true;
  config.settings.dev.unlockAll = !!opts.unlockAll;
  config.settings.game.frameBudgetMs = 10000;
  const save = { seed: opts.seed ?? 12345 };
  if (opts.items) save.inventory = { ...opts.items };
  if (opts.levels) save.research = { ...opts.levels };
  const game = new Game(config, save);
  if (opts.clock !== undefined) {
    game.stats.clock = () => opts.clock;
    game.calendar.state = null; // read the season again from the test's clock
    game.calendar.update(game.time);
  }
  game.speed = opts.speed ?? 1;
  return game;
}

// Runs `code` as the main script until it finishes (or maxSeconds of game time pass).
export function runCode(game, code, { maxSeconds = 600, step = 0.1, scripts = [] } = {}) {
  game.scripts = [{ name: 'main', code }, ...scripts];
  game.activeScript = 'main';
  const out = [];
  const warnings = [];
  let error = null;
  const offs = [
    game.events.on('print', (e) => out.push(e.text)),
    game.events.on('runError', (e) => {
      error = e.error;
    }),
    game.events.on('warning', (e) => warnings.push(e.code)),
  ];
  const start = game.time;
  const r = game.runner.start('main');
  if (!r.ok) {
    offs.forEach((f) => f());
    return { out, error: r.error, warnings, seconds: 0 };
  }
  let guard = 0;
  while (game.runner.state === 'running' && game.time - start < maxSeconds && guard++ < 1e7) {
    game.update(step);
  }
  offs.forEach((f) => f());
  return { out, error, warnings, seconds: game.time - start, finished: game.runner.state === 'idle' };
}
