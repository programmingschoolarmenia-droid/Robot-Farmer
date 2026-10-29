// Seasons, weather and the luck of the day (settings.json → calendar). They follow the real clock
// (the luck follows the date in leaderboard.timeZone), so every student has the same season, weather
// and luck at the same moment. Without a `calendar` section the farm has no seasons.
// World.sync reads the rules below; update() syncs the whole farm before each change, so no tile's
// sync interval ever mixes two seasons or two weathers.
import { Rng } from '../core/rng.js';
import { dayKey } from '../core/util.js';

export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];
export const WEATHER_NAMES = ['Sunny', 'Rain', 'Storm', 'Heat', 'Snow'];

export class Calendar {
  constructor(game) {
    this.game = game;
    this.state = null; // { season, weather, next, day, luck, seasonEnds, weatherEnds } (ends: real ms)
    this.checkAt = 0;
    this.strike = 0; // game seconds since the last lightning
  }

  get cfg() {
    return this.game.settings.calendar;
  }

  // The calendar at real time `now` (ms).
  at(now) {
    const c = this.cfg;
    const seasonMs = c.seasonMinutes * 60000;
    const weatherMs = c.weatherMinutes * 60000;
    const seasonAt = (ms) => SEASON_NAMES[Math.floor(ms / seasonMs) % 4];
    const weatherOf = (slot) => pickWeighted(c.weather[seasonAt(slot * weatherMs)], new Rng(slot).next());
    const slot = Math.floor(now / weatherMs);
    const day = dayKey(now, (this.game.settings.leaderboard || {}).timeZone);
    return {
      season: seasonAt(now),
      weather: weatherOf(slot),
      next: weatherOf(slot + 1),
      day,
      luck: this.luckOf(day),
      seasonEnds: (Math.floor(now / seasonMs) + 1) * seasonMs,
      weatherEnds: (slot + 1) * weatherMs,
    };
  }

  // Every luck comes once in each run of N days, in a shuffled order, and never two days in a row.
  luckOf(day) {
    const list = this.cfg.luck || [];
    const n = list.length;
    if (!n) return null;
    const d = Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8)) / 86400000;
    if (n < 3) return list[d % n];
    const order = (run) => {
      const rng = new Rng(run);
      const a = list.map((_, i) => i);
      for (let i = n - 1; i > 0; i--) {
        const j = rng.int(0, i);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const run = Math.floor(d / n);
    const a = order(run);
    if (a[0] === order(run - 1)[n - 1]) [a[0], a[1]] = [a[1], a[0]];
    return list[a[d % n]];
  }

  // Called before every frame and once at load: starts a new season / weather / day at game time t.
  update(t) {
    if (!this.cfg) return;
    const now = this.game.stats.clock();
    if (this.state && now < this.checkAt) return;
    const s = this.at(now);
    const before = this.state;
    if (!before || s.season !== before.season || s.weather !== before.weather || s.day !== before.day) {
      this.game.world.syncAll(t); // the farm grows by the old rules up to this moment
      this.state = s;
      this.game.events.emit('calendar', { ...s, before });
    } else this.state = s;
    this.checkAt = Math.min(s.weatherEnds, s.seasonEnds, now + 30000);
  }

  // Storms: lightning strikes a random square every lightningSeconds of game time, and a plant
  // there becomes charged (its harvest × lightningMultiplier, see World.harvest).
  tick(dt, t) {
    if (!this.state || this.state.weather !== 'Storm') return;
    const every = this.cfg.lightningSeconds ?? 15;
    const world = this.game.world;
    for (this.strike += dt; this.strike >= every; this.strike -= every) {
      const tile = world.tiles[Math.floor(this.game.rng.next() * world.tiles.length)];
      world.sync(tile, t);
      const e = tile.entity;
      const plant = e && this.game.settings.entities[e.type]; // not machines; glass keeps lightning out
      const charged = !!plant && plant.plantable !== false && e.type !== 'Grass' && !tile.glass;
      if (charged) e.data.charged = true;
      this.game.events.emit('lightning', { x: tile.x, y: tile.y, charged });
    }
  }

  // ---------------------------------------------------------------- rules (neutral without a calendar)

  // ×inSeason in the plant's seasons (settings.json → entities.X.seasons) and under greenhouse glass,
  // ×outOfSeason outside them, × today's luck.
  growth(type, glass = false) {
    const s = this.state;
    if (!s) return 1;
    const seasons = (this.game.settings.entities[type] || {}).seasons;
    const k = !seasons ? 1 : glass || seasons.includes(s.season) ? this.cfg.inSeason ?? 2 : this.cfg.outOfSeason ?? 0.5;
    return k * ((s.luck && s.luck.growth) || 1);
  }

  // Rain and storms keep every square full of water.
  get raining() {
    const w = this.state && this.state.weather;
    return w === 'Rain' || w === 'Storm';
  }

  // Winter: water on the ground is ice and doesn't speed plants up (ponds still have fish).
  get frozen() {
    return !!this.state && this.state.season === 'Winter';
  }

  get evaporation() {
    return this.state && this.state.weather === 'Heat' ? this.cfg.heatEvaporation ?? 3 : 1;
  }

  get lightningMultiplier() {
    return (this.cfg && this.cfg.lightningMultiplier) ?? 3;
  }

  // Today's luck: × harvest / fishing amounts, a pumpkin death chance, × fish chances.
  yieldOf(item) {
    const l = this.state && this.state.luck;
    return (l && l.yield && l.yield[item]) || 1;
  }

  pumpkinDeath(base) {
    const l = this.state && this.state.luck;
    return l && l.pumpkinDeath !== undefined ? l.pumpkinDeath : base;
  }

  // Catch weight of a fish (settings.json → fishing.fish.X): 0 outside its seasons / weather.
  fishChance(species, f = {}) {
    const s = this.state;
    const fits = (list, v) => !list || (!!s && list.includes(v));
    if (!fits(f.seasons, s && s.season) || !fits(f.weather, s && s.weather)) return 0;
    const l = s && s.luck;
    return (f.chance || 0) * ((l && l.fish && l.fish[species]) || 1);
  }
}

// A key of `weights` ({ Sunny: 5, Rain: 4 }) chosen by r in [0, 1).
function pickWeighted(weights, r) {
  const entries = Object.entries(weights || {}).filter(([, w]) => w > 0);
  let left = r * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [name, w] of entries) if ((left -= w) < 0) return name;
  return entries.length ? entries[entries.length - 1][0] : 'Sunny';
}
