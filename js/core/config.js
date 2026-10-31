// Loads config/*.json and checks them, so a teacher's typo shows a clear message
// (file, field, problem) instead of a broken game.
import { GameApi, ENTITY_NAMES, ITEM_NAMES, GROUND_NAMES, FISH_NAMES, MACHINE_NAMES } from '../engine/api.js';
import { RanchApi, RANCH_THINGS } from '../engine/ranchApi.js';
import { SYNTAX_FEATURES } from '../lang/gate.js';
import { SEASON_NAMES, WEATHER_NAMES } from '../engine/calendar.js';

export const CONFIG_FILES = ['settings', 'research', 'texts', 'bridgy', 'aliases', 'guide', 'village', 'events', 'ranch'];

export async function loadConfig(base = 'config/') {
  const config = {};
  const errors = [];
  for (const name of CONFIG_FILES) {
    const file = `${name}.json`;
    let text;
    try {
      const res = await fetch(`${base}${file}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } catch (e) {
      errors.push({ file, path: '', message: `Ֆայլը չհաջողվեց բեռնել (${e.message})`, fatal: true });
      continue;
    }
    try {
      config[name] = JSON.parse(text);
    } catch (e) {
      errors.push({ file, path: jsonErrorPosition(e, text), message: `JSON-ի սխալ. ստուգիր ստորակետները, չակերտները և փակագծերը (${e.message})` });
    }
  }
  if (!errors.length) errors.push(...validateConfig(config));
  return { config, errors };
}

function jsonErrorPosition(e, text) {
  const msg = String(e.message || '');
  let m = msg.match(/line (\d+) column (\d+)/);
  if (m) return `տող ${m[1]}, սյունակ ${m[2]}`;
  m = msg.match(/position (\d+)/);
  if (m) {
    const pos = Number(m[1]);
    const before = text.slice(0, pos).split('\n');
    return `տող ${before.length}, սյունակ ${before[before.length - 1].length + 1}`;
  }
  return '';
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
// A picture's name from the sprite book (tools/sprites.html shows them all): «flame», not an emoji.
const isIcon = (v) => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(v);
const ICON_HINT = 'Պետք է լինի նկարի անուն (տես tools/sprites.html), օրինակ՝ "flame"';

export function validateConfig(config) {
  const errors = [];
  const err = (file, path, message) => errors.push({ file, path, message });
  const S = 'settings.json';
  const R = 'research.json';
  const B = 'bridgy.json';
  const A = 'aliases.json';
  const T = 'texts.json';
  const G = 'guide.json';
  const V = 'village.json';
  const E = 'events.json';
  const RA = 'ranch.json';
  const { settings, research, texts, bridgy, aliases, guide, village, events, ranch } = config;

  for (const [name, v] of Object.entries({ settings, research, texts, bridgy, aliases, guide, village, events, ranch })) {
    if (!isObj(v)) err(`${name}.json`, '', 'Ֆայլը պետք է պարունակի JSON օբյեկտ { … }');
  }
  if (errors.length) return errors;
  const ranchItems = isObj(ranch.items) ? Object.keys(ranch.items) : [];

  // ---------------------------------------------------------------- research
  const nodes = research.nodes;
  const ids = new Set();
  if (!Array.isArray(nodes) || !nodes.length) {
    err(R, 'nodes', 'Պետք է լինի հետազոտությունների ոչ դատարկ ցուցակ');
    return errors;
  }
  nodes.forEach((n, i) => {
    const p = `nodes[${i}]`;
    if (!isObj(n)) return err(R, p, 'Պետք է լինի օբյեկտ');
    if (typeof n.id !== 'string' || !/^[A-Za-z_]\w*$/.test(n.id)) err(R, `${p}.id`, 'id-ն պետք է լինի լատինատառ անուն, օրինակ՝ "Speed"');
    else if (ids.has(n.id)) err(R, `${p}.id`, `«${n.id}» id-ն կրկնվում է`);
    else ids.add(n.id);
  });
  const settingsHats = isObj(settings.hats) ? Object.keys(settings.hats) : [];
  let knownFunctions = new Set();
  try {
    const api = new GameApi({ config });
    knownFunctions = new Set([...api.globals].filter(([, g]) => g.kind === 'function' || g.kind === 'lib').map(([k]) => k));
  } catch (e) {
    err(R, '', `Չհաջողվեց ստուգել ֆունկցիաները (${e.message})`);
  }
  nodes.forEach((n, i) => {
    if (!isObj(n)) return;
    const p = `nodes[${i}] (${n.id})`;
    if (typeof n.name !== 'string' || !n.name) err(R, `${p}.name`, 'Պետք է լինի անուն (տեքստ)');
    if (n.parents !== undefined && !Array.isArray(n.parents)) err(R, `${p}.parents`, 'Պետք է լինի ցուցակ');
    for (const par of n.parents || []) if (!ids.has(par)) err(R, `${p}.parents`, `Անհայտ ծնող «${par}»`);
    if (n.minLevels !== undefined && !(Number.isInteger(n.minLevels) && n.minLevels >= 0)) err(R, `${p}.minLevels`, 'Պետք է լինի 0 կամ դրական ամբողջ թիվ (քանի հետազոտություն է պետք)');
    if (!Array.isArray(n.tiers) || !n.tiers.length) err(R, `${p}.tiers`, 'Պետք է լինի առնվազն մեկ մակարդակ');
    else
      n.tiers.forEach((tier, j) => {
        if (!isObj(tier)) return err(R, `${p}.tiers[${j}]`, 'Պետք է լինի օբյեկտ, օրինակ՝ { "Hay": 5 }');
        for (const [item, amount] of Object.entries(tier)) {
          if (!ITEM_NAMES.includes(item)) err(R, `${p}.tiers[${j}]`, `Անհայտ իր «${item}»`);
          if (!isNum(amount) || amount < 0) err(R, `${p}.tiers[${j}].${item}`, 'Պետք է լինի 0 կամ դրական թիվ');
        }
      });
    const g = n.grants || {};
    if (!isObj(g)) err(R, `${p}.grants`, 'Պետք է լինի օբյեկտ');
    for (const f of g.syntax || []) if (!SYNTAX_FEATURES.includes(f)) err(R, `${p}.grants.syntax`, `Անհայտ հնարավորություն «${f}»։ Թույլատրված են՝ ${SYNTAX_FEATURES.join(', ')}`);
    for (const f of g.functions || []) if (knownFunctions.size && !knownFunctions.has(f)) err(R, `${p}.grants.functions`, `Անհայտ ֆունկցիա «${f}»`);
    for (const e of g.entities || []) if (!ENTITY_NAMES.includes(e)) err(R, `${p}.grants.entities`, `Անհայտ բույս «${e}»`);
    for (const h of g.hats || []) if (!settingsHats.includes(h)) err(R, `${p}.grants.hats`, `Անհայտ գլխարկ «${h}» (ավելացրու settings.json → hats)`);
  });
  // cycles
  const byId = new Map(nodes.filter(isObj).map((n) => [n.id, n]));
  const visiting = new Set();
  const done = new Set();
  const visit = (id, trail) => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      err(R, id, `Ծառում շրջան կա՝ ${[...trail, id].join(' → ')}`);
      return;
    }
    visiting.add(id);
    for (const p of (byId.get(id) && byId.get(id).parents) || []) if (byId.has(p)) visit(p, [...trail, id]);
    visiting.delete(id);
    done.add(id);
  };
  for (const id of byId.keys()) visit(id, []);

  // ---------------------------------------------------------------- settings
  const needObj = (path, v) => {
    if (!isObj(v)) {
      err(S, path, 'Պարտադիր բաժին է (օբյեկտ)');
      return false;
    }
    return true;
  };
  const needNum = (path, v, { min = -Infinity, int = false, optional = false } = {}) => {
    if (v === undefined && optional) return;
    if (!isNum(v)) return err(S, path, 'Պետք է լինի թիվ');
    if (v < min) return err(S, path, `Պետք է լինի ${min} կամ ավելի`);
    if (int && !Number.isInteger(v)) err(S, path, 'Պետք է լինի ամբողջ թիվ');
  };
  const needNames = (path, v, names) => {
    if (v !== undefined && (!Array.isArray(v) || !v.every((x) => names.includes(x)))) err(S, path, `Պետք է լինի ցուցակ ${names.join(' / ')} արժեքներով`);
  };
  if (needObj('game', settings.game)) {
    const g = settings.game;
    needNum('game.maxCallDepth', g.maxCallDepth, { min: 10, int: true, optional: true });
    needNum('game.autosaveSeconds', g.autosaveSeconds, { min: 2, optional: true });
    if (g.speedOptions !== undefined && (!Array.isArray(g.speedOptions) || !g.speedOptions.length || !g.speedOptions.every((x) => isNum(x) && x > 0))) {
      err(S, 'game.speedOptions', 'Պետք է լինի դրական թվերի ցուցակ, օրինակ՝ [0.25, 0.5, 1]');
    }
    if (g.startItems !== undefined) {
      if (!isObj(g.startItems)) err(S, 'game.startItems', 'Պետք է լինի օբյեկտ');
      else for (const k of Object.keys(g.startItems)) if (!ITEM_NAMES.includes(k)) err(S, `game.startItems.${k}`, `Անհայտ իր «${k}»`);
    }
  }
  if (needObj('time', settings.time)) {
    needNum('time.ticksPerSecond', settings.time.ticksPerSecond, { min: 1 });
    needNum('time.speedPerTier', settings.time.speedPerTier, { min: 1 });
    if (settings.time.speedResearch && !ids.has(settings.time.speedResearch)) err(S, 'time.speedResearch', `Անհայտ հետազոտություն «${settings.time.speedResearch}»`);
  }
  if (needObj('costs', settings.costs)) {
    needNum('costs.actionSuccess', settings.costs.actionSuccess, { min: 1 });
    needNum('costs.actionFail', settings.costs.actionFail, { min: 0 });
    needNum('costs.getter', settings.costs.getter, { min: 0 });
  }
  if (needObj('world', settings.world)) {
    const w = settings.world;
    if (!ids.has(w.sizeResearch)) err(S, 'world.sizeResearch', `Անհայտ հետազոտություն «${w.sizeResearch}»`);
    if (!Array.isArray(w.sizes) || !w.sizes.length) err(S, 'world.sizes', 'Պետք է լինի չափերի ցուցակ, օրինակ՝ [[1, 1], [3, 3]]');
    else
      w.sizes.forEach((s, i) => {
        if (!Array.isArray(s) || s.length !== 2 || !s.every((x) => Number.isInteger(x) && x >= 1 && x <= 64)) {
          err(S, `world.sizes[${i}]`, 'Պետք է լինի [լայնություն, բարձրություն]՝ 1-ից 64 ամբողջ թվեր');
        }
      });
  }
  if (needObj('entities', settings.entities)) {
    for (const [name, e] of Object.entries(settings.entities)) {
      const p = `entities.${name}`;
      if (!ENTITY_NAMES.includes(name)) {
        err(S, p, `Անհայտ բույս «${name}»`);
        continue;
      }
      if (!isObj(e)) {
        err(S, p, 'Պետք է լինի օբյեկտ');
        continue;
      }
      if (e.plantable === false) continue;
      if (!Array.isArray(e.growTime) || e.growTime.length !== 2 || !e.growTime.every((x) => isNum(x) && x > 0) || e.growTime[0] > e.growTime[1]) {
        err(S, `${p}.growTime`, 'Պետք է լինի [նվազագույն, առավելագույն] վայրկյաններ, օրինակ՝ [3, 5]');
      }
      for (const key of ['yield', 'plantCost']) {
        if (e[key] === undefined) continue;
        if (!isObj(e[key])) err(S, `${p}.${key}`, 'Պետք է լինի օբյեկտ, օրինակ՝ { "Wood": 1 }');
        else
          for (const [item, n] of Object.entries(e[key])) {
            if (!ITEM_NAMES.includes(item)) err(S, `${p}.${key}`, `Անհայտ իր «${item}»`);
            if (!isNum(n) || n < 0) err(S, `${p}.${key}.${item}`, 'Պետք է լինի 0 կամ դրական թիվ');
          }
      }
      if (e.grounds !== undefined && (!Array.isArray(e.grounds) || !e.grounds.every((g) => GROUND_NAMES.includes(g)))) {
        err(S, `${p}.grounds`, `Պետք է լինի ցուցակ ${GROUND_NAMES.join(' / ')} արժեքներով`);
      }
      if (e.yieldResearch !== undefined && !ids.has(e.yieldResearch)) err(S, `${p}.yieldResearch`, `Անհայտ հետազոտություն «${e.yieldResearch}»`);
      needNames(`${p}.seasons`, e.seasons, SEASON_NAMES);
    }
    for (const must of ['Grass', 'Bush']) if (!settings.entities[must]) err(S, `entities.${must}`, 'Պարտադիր բույս է');
  }
  if (settings.online !== undefined) {
    const o = settings.online;
    if (!isObj(o)) err(S, 'online', 'Պետք է լինի օբյեկտ');
    else {
      for (const key of ['apiKey', 'projectId', 'emailDomain']) {
        if (o[key] !== undefined && typeof o[key] !== 'string') err(S, `online.${key}`, 'Պետք է լինի տեքստ');
      }
      if (!o.apiKey !== !o.projectId) err(S, o.apiKey ? 'online.projectId' : 'online.apiKey', 'Firebase-ի համար պետք են և՛ apiKey-ն, և՛ projectId-ն');
      needNum('online.cloudSaveSeconds', o.cloudSaveSeconds, { min: 10, optional: true });
      needNum('online.leaderboardSize', o.leaderboardSize, { min: 1, int: true, optional: true });
    }
  }
  if (settings.fishing !== undefined) {
    const f = settings.fishing;
    if (!isObj(f)) err(S, 'fishing', 'Պետք է լինի օբյեկտ');
    else {
      if (!ids.has(f.research)) err(S, 'fishing.research', `Անհայտ հետազոտություն «${f.research}»`);
      needNum('fishing.castSeconds', f.castSeconds, { min: 0.1 });
      if (f.hat !== undefined && !settingsHats.includes(f.hat)) err(S, 'fishing.hat', `Անհայտ գլխարկ «${f.hat}» (ավելացրու settings.json → hats)`);
      for (const name of FISH_NAMES) {
        const fish = isObj(f.fish) ? f.fish[name] : null;
        if (!isObj(fish)) err(S, `fishing.fish.${name}`, 'Պետք է լինի { "chance": 70, "amount": 1 }');
        else {
          needNum(`fishing.fish.${name}.chance`, fish.chance, { min: 0 });
          needNum(`fishing.fish.${name}.amount`, fish.amount, { min: 1 });
          needNames(`fishing.fish.${name}.seasons`, fish.seasons, SEASON_NAMES);
          needNames(`fishing.fish.${name}.weather`, fish.weather, WEATHER_NAMES);
        }
      }
    }
  }
  if (settings.calendar !== undefined) {
    const c = settings.calendar;
    if (!isObj(c)) err(S, 'calendar', 'Պետք է լինի օբյեկտ');
    else {
      needNum('calendar.seasonMinutes', c.seasonMinutes, { min: 1 });
      needNum('calendar.weatherMinutes', c.weatherMinutes, { min: 1 });
      for (const key of ['inSeason', 'outOfSeason', 'heatEvaporation', 'lightningSeconds']) needNum(`calendar.${key}`, c[key], { min: 0.01, optional: true });
      needNum('calendar.lightningMultiplier', c.lightningMultiplier, { min: 1, optional: true });
      for (const season of SEASON_NAMES) {
        const w = isObj(c.weather) ? c.weather[season] : null;
        if (!isObj(w) || !Object.values(w).some((n) => n > 0)) err(S, `calendar.weather.${season}`, 'Պետք է լինի եղանակների կշիռներ, օրինակ՝ { "Sunny": 5, "Rain": 4 }');
        else
          for (const [name, n] of Object.entries(w)) {
            if (!WEATHER_NAMES.includes(name)) err(S, `calendar.weather.${season}.${name}`, `Անհայտ եղանակ «${name}»։ Թույլատրված են՝ ${WEATHER_NAMES.join(', ')}`);
            else needNum(`calendar.weather.${season}.${name}`, n, { min: 0 });
          }
      }
      if (c.luck !== undefined && !Array.isArray(c.luck)) err(S, 'calendar.luck', 'Պետք է լինի բախտերի ցուցակ');
      else (c.luck || []).forEach((l, i) => checkLuck(S, `calendar.luck[${i}]`, l));
    }
  }
  // A luck of the day (also a festival's): { text, yield, fish, growth, pumpkinDeath, freeWater }.
  function checkLuck(file, p, l) {
    const bad = (path, message) => err(file, path, message);
    if (!isObj(l) || typeof l.text !== 'string') return bad(p, 'Պետք է լինի { "text": "…", "yield": { "Carrot": 2 } }');
    for (const [key, names] of [['yield', ITEM_NAMES], ['fish', FISH_NAMES]]) {
      if (l[key] !== undefined && !isObj(l[key])) bad(`${p}.${key}`, 'Պետք է լինի օբյեկտ');
      else
        for (const [name, n] of Object.entries(l[key] || {})) {
          const min = key === 'yield' ? 1 : 0;
          if (!names.includes(name)) bad(`${p}.${key}.${name}`, `Անհայտ անուն «${name}»`);
          else if (!isNum(n) || n < min || (key === 'yield' && !Number.isInteger(n))) bad(`${p}.${key}.${name}`, `Պետք է լինի ${min} կամ ավելի${key === 'yield' ? ' ամբողջ' : ''} թիվ`);
        }
    }
    if (l.growth !== undefined && !(isNum(l.growth) && l.growth >= 0.01)) bad(`${p}.growth`, 'Պետք է լինի 0.01 կամ ավելի թիվ');
    if (l.pumpkinDeath !== undefined && !(isNum(l.pumpkinDeath) && l.pumpkinDeath >= 0 && l.pumpkinDeath <= 1)) bad(`${p}.pumpkinDeath`, 'Պետք է լինի 0-ից 1 թիվ');
    if (l.freeWater !== undefined && typeof l.freeWater !== 'boolean') bad(`${p}.freeWater`, 'Պետք է լինի true կամ false');
  }
  if (settings.leaderboard !== undefined) {
    const lb = settings.leaderboard;
    if (!isObj(lb)) err(S, 'leaderboard', 'Պետք է լինի օբյեկտ');
    else {
      try {
        if (lb.timeZone !== undefined) new Intl.DateTimeFormat('en-US', { timeZone: lb.timeZone });
      } catch {
        err(S, 'leaderboard.timeZone', 'Անհայտ ժամային գոտի, օրինակ՝ "Asia/Yerevan"');
      }
      if (!isObj(lb.points)) err(S, 'leaderboard.points', 'Պետք է լինի օբյեկտ, օրինակ՝ { "Hay": 1, "Gold": 20 }');
      else
        for (const [item, n] of Object.entries(lb.points)) {
          if (!ITEM_NAMES.includes(item) && !ranchItems.includes(item)) err(S, `leaderboard.points.${item}`, `Անհայտ իր «${item}»`);
          else needNum(`leaderboard.points.${item}`, n, { min: 0 });
        }
      if (lb.tiers !== undefined && !Array.isArray(lb.tiers)) err(S, 'leaderboard.tiers', 'Պետք է լինի աստիճանների ցուցակ');
      else
        (lb.tiers || []).forEach((tier, i) => {
          const p = `leaderboard.tiers[${i}]`;
          if (!isObj(tier) || typeof tier.name !== 'string' || !isIcon(tier.icon) || !isNum(tier.points)) err(S, p, 'Պետք է լինի { "name": "…", "icon": "sprout" (նկարի անուն), "points": 1000 }');
          else if (i > 0 && isObj(lb.tiers[i - 1]) && !(tier.points > lb.tiers[i - 1].points)) err(S, `${p}.points`, 'Աստիճանները պետք է լինեն միավորների աճման կարգով');
        });
    }
  }
  if (!isObj(settings.hats) || !settings.hats.Straw_Hat) err(S, 'hats', 'Պետք է պարունակի առնվազն "Straw_Hat"');
  if (settings.items && settings.items.order && !settings.items.order.every((x) => ITEM_NAMES.includes(x))) {
    err(S, 'items.order', `Թույլատրված իրեր՝ ${ITEM_NAMES.join(', ')}`);
  }

  // ---------------------------------------------------------------- texts
  for (const section of ['ui', 'accountErrors', 'items', 'entities', 'errors', 'warnings', 'features']) {
    if (!isObj(texts[section])) err(T, section, 'Պարտադիր բաժին է');
  }

  // ---------------------------------------------------------------- bridgy
  const questIds = new Set();
  if (!Array.isArray(bridgy.quests)) err(B, 'quests', 'Պետք է լինի առաջադրանքների ցուցակ');
  else
    bridgy.quests.forEach((q, i) => {
      const p = `quests[${i}]`;
      if (!isObj(q)) return err(B, p, 'Պետք է լինի օբյեկտ');
      if (typeof q.id !== 'string') err(B, `${p}.id`, 'Պետք է լինի տեքստ');
      else if (questIds.has(q.id)) err(B, `${p}.id`, `«${q.id}» id-ն կրկնվում է`);
      else questIds.add(q.id);
      if (typeof q.title !== 'string') err(B, `${p}.title`, 'Պետք է լինի տեքստ');
      if (!Array.isArray(q.goals) || !q.goals.length) err(B, `${p}.goals`, 'Պետք է լինի նպատակների ցուցակ');
      else
        q.goals.forEach((g, j) => {
          const gp = `${p}.goals[${j}]`;
          const types = ['gain', 'have', 'research', 'harvest', 'code', 'visitAll', 'giant', 'plant', 'use', 'chain', 'pond', 'fish', 'repair', 'request'];
          if (!isObj(g) || !types.includes(g.type)) return err(B, gp, `type-ը պետք է լինի՝ ${types.join(', ')}`);
          if ((g.type === 'gain' || g.type === 'have' || g.type === 'use') && !ITEM_NAMES.includes(g.item)) err(B, `${gp}.item`, `Անհայտ իր «${g.item}»`);
          if ((g.type === 'harvest' || g.type === 'plant') && !ENTITY_NAMES.includes(g.entity)) err(B, `${gp}.entity`, `Անհայտ բույս «${g.entity}»`);
          if (g.type === 'research' && !ids.has(g.id)) err(B, `${gp}.id`, `Անհայտ հետազոտություն «${g.id}»`);
          if (g.type === 'fish' && !FISH_NAMES.includes(g.fish)) err(B, `${gp}.fish`, `Անհայտ ձուկ «${g.fish}»։ Թույլատրված են՝ ${FISH_NAMES.join(', ')}`);
          if (g.type === 'code' && g.feature && !SYNTAX_FEATURES.includes(g.feature)) err(B, `${gp}.feature`, `Անհայտ հնարավորություն «${g.feature}»`);
          if (g.type === 'repair' && !(village.buildings || []).some((b) => isObj(b) && b.id === g.id)) err(B, `${gp}.id`, `Անհայտ շենք «${g.id}» (տես village.json)`);
          if (g.type === 'request' && !(Number.isInteger(g.amount) && g.amount >= 1)) err(B, `${gp}.amount`, 'Պետք է լինի 1 կամ ավելի ամբողջ թիվ');
        });
      if (q.hints !== undefined && (!Array.isArray(q.hints) || !q.hints.every((h) => typeof h === 'string'))) {
        err(B, `${p}.hints`, 'Պետք է լինի տեքստերի ցուցակ');
      }
    });
  if (bridgy.lessons !== undefined) {
    if (!isObj(bridgy.lessons)) err(B, 'lessons', 'Պետք է լինի օբյեկտ');
    else
      for (const [id, pages] of Object.entries(bridgy.lessons)) {
        if (!ids.has(id)) err(B, `lessons.${id}`, `Անհայտ հետազոտություն «${id}»`);
        if (!Array.isArray(pages) || !pages.every((pg) => isObj(pg) && typeof pg.text === 'string')) {
          err(B, `lessons.${id}`, 'Պետք է լինի էջերի ցուցակ՝ [{ "text": "…" }]');
          continue;
        }
        checkPages(B, `lessons.${id}`, pages);
      }
  }
  if (!Array.isArray(bridgy.intro)) err(B, 'intro', 'Պետք է լինի էջերի ցուցակ');
  // Bridgy's pages ({ text, code?, quiz? }) in lessons and in the village stories.
  function checkPages(file, path, pages) {
    if (!Array.isArray(pages) || !pages.every((pg) => isObj(pg) && typeof pg.text === 'string')) return err(file, path, 'Պետք է լինի էջերի ցուցակ՝ [{ "text": "…" }]');
    pages.forEach((pg, j) => {
      const q = pg.quiz;
      const ok =
        isObj(q) && Array.isArray(q.answers) && q.answers.length >= 2 && q.answers.every((a) => typeof a === 'string') &&
        Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.answers.length && typeof q.right === 'string' && typeof q.wrong === 'string';
      if (q !== undefined && !ok) err(file, `${path}[${j}].quiz`, 'Պետք է լինի { "answers": ["…", "…"], "correct": 0, "right": "…", "wrong": "…" }');
    });
  }
  for (const [id, f] of Object.entries(bridgy.friends || {})) {
    if (id === '_readme') continue;
    if (!isObj(f) || typeof f.name !== 'string' || typeof f.portrait !== 'string') err(B, `friends.${id}`, 'Պետք է լինի { "name": "…", "portrait": "assets/…png", "lines": ["…"] }');
    else if (f.lines !== undefined && (!Array.isArray(f.lines) || !f.lines.every((l) => typeof l === 'string'))) err(B, `friends.${id}.lines`, 'Պետք է լինի տեքստերի ցուցակ');
  }

  // ---------------------------------------------------------------- guide (Bridgy's book)
  if (!isObj(guide.commands)) err(G, 'commands', 'Պարտադիր բաժին է');
  else
    for (const [name, c] of Object.entries(guide.commands)) {
      if (knownFunctions.size && !knownFunctions.has(name)) err(G, `commands.${name}`, `Անհայտ ֆունկցիա «${name}»`);
      if (!isObj(c) || typeof c.sig !== 'string' || typeof c.doc !== 'string') err(G, `commands.${name}`, 'Պետք է լինի { "sig": "…", "doc": "…" }');
    }
  if (!Array.isArray(guide.js)) err(G, 'js', 'Պետք է լինի թեմաների ցուցակ');
  else
    guide.js.forEach((topic, i) => {
      if (!isObj(topic) || typeof topic.title !== 'string' || typeof topic.about !== 'string') return err(G, `js[${i}]`, 'Պետք է լինի { "title": "…", "about": "…" }');
      for (const n of topic.needs || []) if (!SYNTAX_FEATURES.includes(n) && !knownFunctions.has(n)) err(G, `js[${i}].needs`, `Անհայտ «${n}»`);
    });
  if (!Array.isArray(guide.plants)) err(G, 'plants', 'Պետք է լինի քարտերի ցուցակ');
  else
    guide.plants.forEach((pl, i) => {
      if (!isObj(pl) || typeof pl.about !== 'string') return err(G, `plants[${i}]`, 'Պետք է լինի { "entity": "…", "about": "…" }');
      if (pl.entity ? !ENTITY_NAMES.includes(pl.entity) : !ids.has(pl.research)) err(G, `plants[${i}]`, `Անհայտ «${pl.entity || pl.research}»`);
    });

  // ---------------------------------------------------------------- village
  const items = (path, v, { min = 0, int = false, file = V, names = ITEM_NAMES } = {}) => {
    if (!isObj(v)) return err(file, path, 'Պետք է լինի օբյեկտ, օրինակ՝ { "Wood": 300 }');
    for (const [item, n] of Object.entries(v)) {
      if (!names.includes(item)) err(file, `${path}.${item}`, `Անհայտ իր «${item}»`);
      else if (!isNum(n) || n < min || (int && !Number.isInteger(n))) err(file, `${path}.${item}`, `Պետք է լինի ${min} կամ ավելի${int ? ' ամբողջ' : ''} թիվ`);
    }
  };
  if (village.research !== undefined && !ids.has(village.research)) err(V, 'research', `Անհայտ հետազոտություն «${village.research}»`);
  const buildingIds = new Set();
  if (!Array.isArray(village.buildings)) err(V, 'buildings', 'Պետք է լինի շենքերի ցուցակ');
  else {
    for (const b of village.buildings) if (isObj(b) && typeof b.id === 'string') buildingIds.add(b.id);
    village.buildings.forEach((b, i) => {
      const p = `buildings[${i}]`;
      if (!isObj(b) || typeof b.id !== 'string' || typeof b.name !== 'string') return err(V, p, 'Պետք է լինի { "id": "Mill", "name": "…", "cost": { … } }');
      if (village.buildings.findIndex((x) => isObj(x) && x.id === b.id) !== i) err(V, `${p}.id`, `«${b.id}» id-ն կրկնվում է`);
      if (ids.has(b.id)) err(V, `${p}.id`, `«${b.id}» id-ն արդեն հետազոտություն է, ընտրիր ուրիշ անուն`);
      for (const a of b.after || []) if (!buildingIds.has(a)) err(V, `${p}.after`, `Անհայտ շենք «${a}»`);
      for (const key of ['x', 'y']) if (!isNum(b[key]) || b[key] < 0 || b[key] > 100) err(V, `${p}.${key}`, 'Պետք է լինի 0-ից 100 թիվ (տոկոս)');
      if (b.w !== undefined && (!isNum(b.w) || b.w <= 0 || b.w > 100)) err(V, `${p}.w`, 'Պետք է լինի 1-ից 100 թիվ (տոկոս)');
      if (b.available === false) return;
      items(`${p}.cost`, b.cost, { min: 0 });
      const gr = b.grants || {};
      for (const f of gr.functions || []) if (knownFunctions.size && !knownFunctions.has(f)) err(V, `${p}.grants.functions`, `Անհայտ ֆունկցիա «${f}»`);
      for (const m of gr.machines || []) if (!MACHINE_NAMES.includes(m)) err(V, `${p}.grants.machines`, `Անհայտ սարք «${m}»։ Թույլատրված են՝ ${MACHINE_NAMES.join(', ')}`);
      for (const h of gr.hats || []) if (!settingsHats.includes(h)) err(V, `${p}.grants.hats`, `Անհայտ գլխարկ «${h}» (ավելացրու settings.json → hats)`);
      checkPages(V, `${p}.story`, b.story || []);
    });
  }
  for (const key of ['intro', 'finale']) checkPages(V, key, village[key] || []);
  if (!isObj(village.machines)) err(V, 'machines', 'Պարտադիր բաժին է');
  else
    for (const [m, cfg] of Object.entries(village.machines)) {
      const p = `machines.${m}`;
      if (!MACHINE_NAMES.includes(m)) err(V, p, `Անհայտ սարք «${m}»։ Թույլատրված են՝ ${MACHINE_NAMES.join(', ')}`);
      if (!isObj(cfg)) {
        err(V, p, 'Պետք է լինի { "cost": { … }, "recipes": { … } }');
        continue;
      }
      items(`${p}.cost`, cfg.cost || {});
      for (const [item, r] of Object.entries(cfg.recipes || {})) {
        if (!ITEM_NAMES.includes(item)) err(V, `${p}.recipes.${item}`, `Անհայտ իր «${item}»`);
        if (!isObj(r) || !isNum(r.seconds) || r.seconds <= 0) err(V, `${p}.recipes.${item}`, 'Պետք է լինի { "in": { "Hay": 20 }, "seconds": 5 }');
        else items(`${p}.recipes.${item}.in`, r.in, { min: 1 });
      }
    }
  for (const [item, b] of Object.entries(village.boosts || {})) {
    const p = `boosts.${item}`;
    if (!ITEM_NAMES.includes(item)) err(V, p, `Անհայտ իր «${item}»`);
    if (!isObj(b) || !['speed', 'growth', 'goldenFish'].includes(b.kind) || !isNum(b.multiplier) || b.multiplier <= 0 || !isNum(b.seconds) || b.seconds <= 0) {
      err(V, p, 'Պետք է լինի { "kind": "speed" | "growth" | "goldenFish", "multiplier": 2, "seconds": 30 }');
    }
  }
  const rq = village.requests;
  if (!isObj(rq)) err(V, 'requests', 'Պարտադիր բաժին է');
  else {
    if (!buildingIds.has(rq.building)) err(V, 'requests.building', `Անհայտ շենք «${rq.building}»`);
    if (!Number.isInteger(rq.perDay) || rq.perDay < 1) err(V, 'requests.perDay', 'Պետք է լինի 1 կամ ավելի ամբողջ թիվ');
    for (const key of ['stars', 'bonus', 'share']) if (rq[key] !== undefined && (!isNum(rq[key]) || rq[key] < 0)) err(V, `requests.${key}`, 'Պետք է լինի 0 կամ դրական թիվ');
    items('requests.items', rq.items, { min: 1 });
    if (!Array.isArray(rq.villagers) || !rq.villagers.length) err(V, 'requests.villagers', 'Պետք է լինի գյուղացիների ցուցակ');
    else
      rq.villagers.forEach((v, i) => {
        const ok = isObj(v) && typeof v.name === 'string' && (isIcon(v.face) || typeof v.portrait === 'string');
        if (!ok || !Array.isArray(v.lines) || !v.lines.length || !v.lines.every((l) => typeof l === 'string')) {
          err(V, `requests.villagers[${i}]`, 'Պետք է լինի { "name": "…", "face": "granny" (granny, cook, fisher, girl) կամ "portrait": "assets/…png", "lines": ["… {amount} {item} …"] }');
        }
      });
  }
  if (village.greenhouse !== undefined) items('greenhouse.cost', (village.greenhouse || {}).cost || {});

  // ---------------------------------------------------------------- events (festivals, …)
  const fest = isObj(events.festival) ? events.festival : null;
  if (!fest) err(E, 'festival', 'Պարտադիր բաժին է');
  else {
    if (!buildingIds.has(fest.building)) err(E, 'festival.building', `Անհայտ շենք «${fest.building}» (տես village.json)`);
    for (const key of ['count', 'hidden']) if (!Number.isInteger(fest[key]) || fest[key] < 1) err(E, `festival.${key}`, 'Պետք է լինի 1 կամ ավելի ամբողջ թիվ');
  }
  const festIds = new Set();
  const md = (v) => typeof v === 'string' && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);
  if (!Array.isArray(events.festivals)) err(E, 'festivals', 'Պետք է լինի տոների ցուցակ');
  else
    events.festivals.forEach((f, i) => {
      const p = `festivals[${i}]`;
      if (!isObj(f) || typeof f.id !== 'string' || typeof f.name !== 'string') return err(E, p, 'Պետք է լինի { "id": "Easter", "name": "…", … }');
      if (festIds.has(f.id)) err(E, `${p}.id`, `«${f.id}» id-ն կրկնվում է`);
      festIds.add(f.id);
      const easter = Array.isArray(f.easter) && f.easter.length === 2 && f.easter.every(Number.isInteger) && f.easter[0] <= f.easter[1];
      if (!easter && !(md(f.from) && md(f.to))) err(E, p, 'Պետք է ունենա "from" և "to" ("MM-DD", օրինակ՝ "02-13") կամ "easter": [-1, 1]');
      checkLuck(E, `${p}.luck`, f.luck);
      for (const key of ['hat', 'goldHat']) if (!settingsHats.includes(f[key])) err(E, `${p}.${key}`, `Անհայտ գլխարկ «${f[key]}» (ավելացրու settings.json → hats)`);
      if (f.splash !== undefined && !(isNum(f.splash) && f.splash >= 0 && f.splash <= 1)) err(E, `${p}.splash`, 'Պետք է լինի 0-ից 1 թիվ');
      if (!Array.isArray(f.colors) || !f.colors.every((c) => typeof c === 'string')) err(E, `${p}.colors`, 'Պետք է լինի գույների ցուցակ, օրինակ՝ ["#e4572e", "#ffd23f"]');
      for (const key of ['object', 'objectName', 'greeting']) if (typeof f[key] !== 'string') err(E, `${p}.${key}`, 'Պետք է լինի տեքստ');
      if (!isIcon(f.icon)) err(E, `${p}.icon`, ICON_HINT);
    });
  if (events.today !== undefined && events.today !== '' && !festIds.has(events.today)) err(E, 'today', `Անհայտ տոն «${events.today}»։ Թույլատրված են՝ ${[...festIds].join(', ')} կամ ""`);
  const notes = isObj(events.notes) ? events.notes : null;
  if (!notes) err(E, 'notes', 'Պարտադիր բաժին է');
  else {
    if (!(isNum(notes.chance) && notes.chance >= 0 && notes.chance <= 1)) err(E, 'notes.chance', 'Պետք է լինի 0-ից 1 թիվ');
    if (!(Number.isInteger(notes.stars) && notes.stars >= 0)) err(E, 'notes.stars', 'Պետք է լինի 0 կամ դրական ամբողջ թիվ');
    if (!settingsHats.includes(notes.hat)) err(E, 'notes.hat', `Անհայտ գլխարկ «${notes.hat}» (ավելացրու settings.json → hats)`);
    const noteIds = new Set();
    const cell = (v) => Number.isInteger(v) && v >= 0 && v < 64;
    (Array.isArray(notes.list) ? notes.list : []).forEach((n, i) => {
      const p = `notes.list[${i}]`;
      if (!isObj(n) || typeof n.id !== 'string' || typeof n.text !== 'string' || typeof n.hint !== 'string') return err(E, p, 'Պետք է լինի { "id": "n01", "text": "…", "x": 1, "y": 2, "hint": "…" }');
      if (noteIds.has(n.id)) err(E, `${p}.id`, `«${n.id}» id-ն կրկնվում է`);
      noteIds.add(n.id);
      if (!['math', 'code', 'cipher', 'fact'].includes(n.kind)) err(E, `${p}.kind`, 'Պետք է լինի math, code, cipher կամ fact');
      if (n.code !== undefined && typeof n.code !== 'string') err(E, `${p}.code`, 'Պետք է լինի տեքստ');
      if (n.fact !== undefined) {
        if (!['sunflower', 'cactus', 'giant', 'ponds', 'gold'].includes(n.fact)) err(E, `${p}.fact`, 'Պետք է լինի sunflower, cactus, giant, ponds կամ gold');
        for (const key of ['dx', 'dy']) if (n[key] !== undefined && !Number.isInteger(n[key])) err(E, `${p}.${key}`, 'Պետք է լինի ամբողջ թիվ');
        if (n.needs !== undefined && !ids.has(n.needs)) err(E, `${p}.needs`, `Անհայտ հետազոտություն «${n.needs}»`);
      } else if (!cell(n.x) || !cell(n.y)) err(E, p, 'Պետք է ունենա x և y (0-ից 63 ամբողջ թվեր) կամ "fact"');
    });
    if (!Array.isArray(notes.list) || !notes.list.length) err(E, 'notes.list', 'Պետք է լինի գրառումների ցուցակ');
  }
  // research levels of a test farm: { "Expand": 3 } (known nodes, 0 … their last level)
  const levels = (path, v) => {
    if (!isObj(v)) return err(E, path, 'Պետք է լինի օբյեկտ, օրինակ՝ { "Expand": 3 }');
    for (const [id, lvl] of Object.entries(v)) {
      const node = nodes.find((n) => n.id === id);
      if (!node) err(E, `${path}.${id}`, `Անհայտ հետազոտություն «${id}»`);
      else if (!Number.isInteger(lvl) || lvl < 0 || lvl > node.tiers.length) err(E, `${path}.${id}`, `Պետք է լինի 0-ից ${node.tiers.length} ամբողջ թիվ`);
    }
  };
  const ch = isObj(events.challenge) ? events.challenge : null;
  if (!ch) err(E, 'challenge', 'Պարտադիր բաժին է');
  else {
    if (!buildingIds.has(ch.building)) err(E, 'challenge.building', `Անհայտ շենք «${ch.building}» (տես village.json)`);
    if (!(isNum(ch.limit) && ch.limit > 0)) err(E, 'challenge.limit', 'Պետք է լինի դրական թիվ (խաղի վայրկյաններ)');
    if (!Array.isArray(ch.speeds) || !ch.speeds.length || !ch.speeds.every((v) => isNum(v) && v > 0)) err(E, 'challenge.speeds', 'Պետք է լինի արագությունների ցուցակ, օրինակ՝ [1, 2, 4, 8]');
    if (!(Number.isInteger(ch.stars) && ch.stars >= 0)) err(E, 'challenge.stars', 'Պետք է լինի 0 կամ դրական ամբողջ թիվ');
    if (!Array.isArray(ch.hats) || ch.hats.length !== 3 || !ch.hats.every((hat) => settingsHats.includes(hat))) err(E, 'challenge.hats', 'Պետք է լինի 3 հայտնի գլխարկ (1-ին, 2-րդ, 3-րդ տեղերի համար)');
    if (!Array.isArray(ch.medals) || ch.medals.length !== 3 || !ch.medals.every((n) => Number.isInteger(n) && n >= 0)) err(E, 'challenge.medals', 'Պետք է լինի 3 ամբողջ թիվ, օրինակ՝ [3, 2, 1]');
    levels('challenge.levels', ch.levels);
  }
  const GOALS = { items: ITEM_NAMES, harvest: [...ENTITY_NAMES, ...FISH_NAMES] };
  const challengeIds = new Set();
  if (!Array.isArray(events.challenges) || !events.challenges.length) err(E, 'challenges', 'Պետք է լինի առաջադրանքների ցուցակ');
  else
    events.challenges.forEach((c, i) => {
      const p = `challenges[${i}]`;
      if (!isObj(c) || typeof c.id !== 'string' || typeof c.name !== 'string' || typeof c.about !== 'string') return err(E, p, 'Պետք է լինի { "id": "…", "name": "…", "about": "…", "goal": { … }, "levels": { … } }');
      if (challengeIds.has(c.id)) err(E, `${p}.id`, `«${c.id}» id-ն կրկնվում է`);
      challengeIds.add(c.id);
      const [kind, v] = isObj(c.goal) && Object.keys(c.goal).length === 1 ? Object.entries(c.goal)[0] : [];
      if (GOALS[kind]) items(`${p}.goal.${kind}`, v, { min: 1, file: E, names: GOALS[kind] });
      else if (!['giant', 'chain', 'dino'].includes(kind)) err(E, `${p}.goal`, 'Պետք է ունենա մեկ նպատակ՝ items, harvest, giant, chain կամ dino');
      else if (!Number.isInteger(v) || v < 2) err(E, `${p}.goal.${kind}`, 'Պետք է լինի 2 կամ ավելի ամբողջ թիվ');
      levels(`${p}.levels`, c.levels);
      if (c.items !== undefined) items(`${p}.items`, c.items, { file: E });
      if (c.seed !== undefined && !Number.isInteger(c.seed)) err(E, `${p}.seed`, 'Պետք է լինի ամբողջ թիվ');
    });
  const KINDS = ['feature', 'params', 'recursion', 'drones', 'codeWords', 'giant', 'chain', 'sunflowerBonus', 'dino', 'fishAll', 'fish', 'goldenFish', 'total', 'researchAll', 'village', 'requests', 'notes', 'festivalHats', 'challengeTop', 'perfection', 'flips', 'hats', 'eaten', 'ranchEarned', 'ranchOrders', 'ranchCount'];
  const stickerIds = new Set();
  (Array.isArray(events.stickers) ? events.stickers : []).forEach((st, i) => {
    const p = `stickers[${i}]`;
    if (!isObj(st) || typeof st.id !== 'string' || typeof st.name !== 'string' || !isIcon(st.icon) || typeof st.about !== 'string') return err(E, p, 'Պետք է լինի { "id": "…", "icon": "loop" (նկարի անուն), "name": "…", "about": "…", "when": { … } }');
    if (stickerIds.has(st.id)) err(E, `${p}.id`, `«${st.id}» id-ն կրկնվում է`);
    stickerIds.add(st.id);
    const keys = isObj(st.when) ? Object.keys(st.when) : [];
    if (keys.length !== 1 || !KINDS.includes(keys[0])) err(E, `${p}.when`, `Պետք է ունենա մեկ պայման՝ ${KINDS.join(', ')}`);
    else if (keys[0] === 'feature' && !SYNTAX_FEATURES.includes(st.when.feature)) err(E, `${p}.when.feature`, `Անհայտ հնարավորություն «${st.when.feature}»`);
    else if (keys[0] === 'fish' && !FISH_NAMES.includes(st.when.fish)) err(E, `${p}.when.fish`, `Անհայտ ձուկ «${st.when.fish}»`);
    else if (keys[0] === 'total' && (!isObj(st.when.total) || !Object.keys(st.when.total).every((k) => ITEM_NAMES.includes(k) || ranchItems.includes(k)))) err(E, `${p}.when.total`, 'Պետք է լինի { "Hay": 1000000 } (հայտնի իրերով)');
  });
  const perf = isObj(events.perfection) ? events.perfection : null;
  if (!perf) err(E, 'perfection', 'Պարտադիր բաժին է');
  else {
    for (const key of ['research', 'village', 'ranch']) if (!(isNum(perf[key]) && perf[key] >= 0)) err(E, `perfection.${key}`, 'Պետք է լինի 0 կամ դրական թիվ');
    if (!settingsHats.includes(perf.hat)) err(E, 'perfection.hat', `Անհայտ գլխարկ «${perf.hat}» (ավելացրու settings.json → hats)`);
  }

  // ---------------------------------------------------------------- ranch
  const areas = isObj(ranch.areas) ? ranch.areas : {};
  const animals = isObj(ranch.animals) ? ranch.animals : {};
  const isFeed = (item) => !!(ranch.items && isObj(ranch.items[item]) && ranch.items[item].feed);
  if (!ids.has(ranch.research)) err(RA, 'research', `Անհայտ հետազոտություն «${ranch.research}»`);
  if (!ranchItems.includes('Dram')) err(RA, 'items', 'Պետք է լինի ապրանքների օբյեկտ՝ Dram-ով, օրինակ՝ { "Dram": {}, "Egg": { "sell": 4 } }');
  for (const [item, c] of Object.entries(ranch.items || {})) {
    if (!/^[A-Z]\w*$/.test(item) || !isObj(c)) err(RA, `items.${item}`, 'Պետք է լինի լատինատառ անուն (մեծատառով) և օբյեկտ, օրինակ՝ "Egg": { "sell": 4 }');
    else for (const key of ['sell', 'buy']) if (c[key] !== undefined && !(isNum(c[key]) && c[key] > 0)) err(RA, `items.${item}.${key}`, 'Պետք է լինի դրական թիվ (֏)');
  }
  const map = ranch.map;
  const mapOk = isObj(map) && Array.isArray(map.layout) && map.layout.length > 0 && map.layout.every((r) => Array.isArray(r) && r.length === map.layout[0].length);
  if (!mapOk) err(RA, 'map', 'Պետք է լինի { "layout": [["Hens", "Cows"], ["Market", "Goats"]] } (հավասար տողերով)');
  else for (const id of map.layout.flat()) if (!areas[id]) err(RA, 'map.layout', `Անհայտ վայր «${id}» (տես areas)`);
  const scripts = new Set();
  for (const [id, a] of Object.entries(areas)) {
    const p = `areas.${id}`;
    if (!isObj(a) || typeof a.name !== 'string' || !isIcon(a.icon)) {
      err(RA, p, 'Պետք է լինի { "icon": "hen" (նկարի անուն), "name": "…", … }');
      continue;
    }
    if (a.available === false) continue;
    if (typeof a.script !== 'string' || !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(a.script) || scripts.has(a.script)) err(RA, `${p}.script`, 'Պետք է լինի կոդի ներդիրի չկրկնվող անուն (տառեր և թվեր)');
    scripts.add(a.script);
    const most = 12;
    if (!Array.isArray(a.sizes) || !a.sizes.length || !a.sizes.every((n, i) => Number.isInteger(n) && n >= 2 && n <= most && (i === 0 || n > a.sizes[i - 1]))) err(RA, `${p}.sizes`, `Պետք է լինի աճող չափերի ցուցակ (2-ից ${most})`);
    if (a.animal !== undefined && !animals[a.animal]) err(RA, `${p}.animal`, `Անհայտ կենդանի «${a.animal}» (տես animals)`);
    const first = Array.isArray(a.sizes) ? a.sizes[0] : 2;
    for (const [type, xy] of Object.entries(a.objects || {})) {
      if (!RANCH_THINGS.includes(type)) err(RA, `${p}.objects.${type}`, `Անհայտ իր։ Թույլատրված են՝ ${RANCH_THINGS.join(', ')}`);
      else if (!Array.isArray(xy) || xy.length !== 2 || !xy.every((v) => Number.isInteger(v) && v >= 0 && v < first)) err(RA, `${p}.objects.${type}`, `Պետք է լինի [x, y]՝ 0-ից ${first - 1}`);
    }
    if (a.animal && !(a.objects || {}).Basket) err(RA, `${p}.objects`, 'Կենդանիների վայրին պետք է զամբյուղ (Basket)');
  }
  if (!Object.values(areas).some((a) => isObj(a) && a.available !== false && (a.objects || {}).Stall)) err(RA, 'areas', 'Պետք է լինի շուկա՝ վայր "Stall"-ով');
  for (const [type, c] of Object.entries(animals)) {
    const p = `animals.${type}`;
    if (!isObj(c)) {
      err(RA, p, 'Պետք է լինի օբյեկտ');
      continue;
    }
    if (!isFeed(c.feed)) err(RA, `${p}.feed`, 'Պետք է լինի կերի ապրանք (items-ում "feed": true)');
    if (!ranchItems.includes(c.product)) err(RA, `${p}.product`, `Անհայտ ապրանք «${c.product}»`);
    for (const key of ['every', 'space', 'step']) if (!(isNum(c[key]) && c[key] > 0)) err(RA, `${p}.${key}`, 'Պետք է լինի դրական թիվ');
    for (const key of ['hunger', 'thirst', 'dirt']) if (!(isObj(c.needs) && isNum(c.needs[key]) && c.needs[key] >= 0)) err(RA, `${p}.needs.${key}`, 'Պետք է լինի 0 կամ դրական թիվ');
    for (const key of ['hatch', 'breed', 'grow', 'price', 'butt']) if (c[key] !== undefined && !(isNum(c[key]) && c[key] >= 0)) err(RA, `${p}.${key}`, 'Պետք է լինի 0 կամ դրական թիվ');
    if (c.colors !== undefined && !(Array.isArray(c.colors) && c.colors.length && [...c.colors, c.rare ?? 'A'].every((x) => /^[A-Z][A-Za-z]*$/.test(x)))) err(RA, `${p}.colors`, 'Պետք է լինի գույների անունների ցուցակ, օրինակ՝ ["White", "Brown"] (և "rare"՝ հազվագյուտը)');
  }
  // the workshop's machines: { "Dairy": { "Cheese": { "in": { "Milk": 3 }, "seconds": 60 } } }
  for (const [m, recipes] of Object.entries(ranch.machines || {})) {
    if (!RANCH_THINGS.includes(m) || !isObj(recipes)) err(RA, `machines.${m}`, `Պետք է լինի մեքենա (${RANCH_THINGS.join(', ')}) և նրա բաղադրատոմսերը`);
    else
      for (const [item, r] of Object.entries(recipes)) {
        if (!ranchItems.includes(item)) err(RA, `machines.${m}.${item}`, `Անհայտ ապրանք «${item}»`);
        if (!isObj(r) || !(isNum(r.seconds) && r.seconds > 0)) err(RA, `machines.${m}.${item}`, 'Պետք է լինի { "in": { "Milk": 3 }, "seconds": 60 }');
        else items(`machines.${m}.${item}.in`, r.in, { min: 1, file: RA, names: ranchItems });
      }
  }
  for (const [when, f] of Object.entries(ranch.seasons || {})) {
    if (!isObj(f) || !Object.entries(f).every(([k, v]) => ['hunger', 'thirst', 'dirt', 'breed'].includes(k) && isNum(v) && v > 0)) err(RA, `seasons.${when}`, 'Պետք է լինի { "thirst": 1.5 } (hunger, thirst, dirt կամ breed)');
  }
  for (const [item, to] of Object.entries(ranch.ship || {})) {
    if (!ranchItems.includes(item)) err(RA, `ship.${item}`, `Անհայտ ապրանք «${item}»`);
    items(`ship.${item}`, to, { min: 1, file: RA, names: ITEM_NAMES });
  }
  for (const key of ['seek', 'fill', 'unhappy', 'dirty', 'sad', 'petBoost', 'petSeconds', 'moodSpeed']) {
    if (!(isObj(ranch.needs) && isNum(ranch.needs[key]) && ranch.needs[key] >= 0)) err(RA, `needs.${key}`, 'Պետք է լինի 0 կամ դրական թիվ');
  }
  const st = isObj(ranch.start) ? ranch.start : {};
  for (const id of st.areas || []) if (!areas[id] || areas[id].available === false) err(RA, 'start.areas', `Անհայտ վայր «${id}»`);
  for (const [type, n] of Object.entries(st.animals || {})) if (!animals[type] || !Number.isInteger(n) || n < 0) err(RA, `start.animals.${type}`, 'Պետք է լինի հայտնի կենդանի և 0 կամ դրական ամբողջ թիվ');
  items('start.items', st.items || {}, { file: RA, names: ranchItems });
  for (const [item, cost] of Object.entries(ranch.cart || {})) {
    if (!ranchItems.includes(item) || item === 'Dram') err(RA, `cart.${item}`, `Անհայտ ապրանք «${item}»`);
    items(`cart.${item}`, cost, { min: 1, file: RA });
  }
  const ord = isObj(ranch.orders) ? ranch.orders : {};
  if (!(Number.isInteger(ord.perDay) && ord.perDay >= 0) || !(isNum(ord.pay) && ord.pay > 0) || !Array.isArray(ord.lines) || !ord.lines.every((l) => typeof l === 'string')) {
    err(RA, 'orders', 'Պետք է լինի { "perDay": 3, "pay": 1.6, "base": { "Egg": 6 }, "lines": ["… {list} … {pay} ֏"] }');
  }
  items('orders.base', ord.base || {}, { min: 1, file: RA, names: ranchItems.filter((it) => ranch.items[it].sell) });
  if (!Array.isArray(ranch.hands) || !ranch.hands.length || !ranch.hands.every((n) => Number.isInteger(n) && n >= 1)) err(RA, 'hands', 'Պետք է լինի ամբողջ թվերի ցուցակ, օրինակ՝ [3, 5, 10, 20]');
  let ranchFns = new Set();
  try {
    ranchFns = new Set([...new RanchApi({ config: { ...config, aliases: {} } }).globals].filter(([, g]) => g.kind === 'function' || g.kind === 'lib').map(([k]) => k));
  } catch (e) {
    err(RA, '', `Չհաջողվեց ստուգել ռանչոյի հրամանները (${e.message})`);
  }
  const shopIds = new Set((Array.isArray(ranch.shop) ? ranch.shop : []).filter((it) => isObj(it) && typeof it.id === 'string').map((it) => it.id));
  const SHOP_KINDS = ['area', 'animal', 'size', 'trough', 'machine', 'upgrade', 'command', 'boost'];
  if (!Array.isArray(ranch.shop)) err(RA, 'shop', 'Պետք է լինի ցուցակ');
  else
    ranch.shop.forEach((it, i) => {
      const p = `shop[${i}]`;
      if (!isObj(it) || typeof it.id !== 'string' || !SHOP_KINDS.includes(it.kind)) return err(RA, p, `Պետք է լինի { "id": "…", "kind": "…" }։ kind-ը՝ ${SHOP_KINDS.join(', ')}`);
      if (ranch.shop.findIndex((x) => isObj(x) && x.id === it.id) !== i) err(RA, `${p}.id`, `«${it.id}» id-ն կրկնվում է`);
      if (it.icon !== undefined && !isIcon(it.icon)) err(RA, `${p}.icon`, ICON_HINT);
      if (it.available === false) return;
      const costs = it.costs || [it.cost];
      if (!Array.isArray(costs) || !costs.length || !costs.every((c) => isNum(c) && c >= 0)) err(RA, `${p}.cost`, 'Պետք է լինի "cost" (֏) կամ "costs" (ամեն մակարդակի գինը)');
      if (it.needs !== undefined && !shopIds.has(it.needs)) err(RA, `${p}.needs`, `Անհայտ «${it.needs}»`);
      if (it.kind === 'area' && !(areas[it.id] && Array.isArray(areas[it.id].sizes))) err(RA, `${p}.id`, 'Պետք է լինի վայր areas-ից');
      if (it.kind === 'machine' && !(ranch.machines || {})[it.id]) err(RA, `${p}.id`, 'Պետք է լինի մեքենա machines-ից');
      if (it.kind === 'boost' && !(isObj(it.boost) && ['speed', 'growth', 'goldenFish'].includes(it.boost.kind) && isNum(it.boost.multiplier) && isNum(it.boost.seconds))) err(RA, `${p}.boost`, 'Պետք է լինի { "kind": "speed", "multiplier": 1.5, "seconds": 600 }');
      if (it.kind === 'animal' && !animals[it.animal]) err(RA, `${p}.animal`, `Անհայտ կենդանի «${it.animal}»`);
      if (it.kind === 'size' && !(areas[it.area] && Array.isArray(it.costs) && it.costs.length === (areas[it.area].sizes || []).length - 1)) err(RA, `${p}.costs`, 'Պետք է ունենա "area" և այնքան գին, որքան մեծացում կա (sizes-ից մեկով պակաս)');
      if (it.kind === 'trough' && !['FeedTrough', 'WaterTrough'].includes(it.id)) err(RA, `${p}.id`, 'Պետք է լինի FeedTrough կամ WaterTrough');
      if (it.kind === 'upgrade' && !['Speed', 'Hands', 'Drones'].includes(it.id)) err(RA, `${p}.id`, 'Պետք է լինի Speed, Hands կամ Drones');
      if (it.id === 'Hands' && (it.costs || []).length !== (ranch.hands || []).length - 1) err(RA, `${p}.costs`, 'Գների քանակը պետք է լինի hands-ից մեկով պակաս');
      for (const f of it.grants || []) if (ranchFns.size && !ranchFns.has(f)) err(RA, `${p}.grants`, `Անհայտ հրաման «${f}»`);
    });
  const story = isObj(ranch.story) ? ranch.story : {};
  checkPages(RA, 'story.intro', story.intro || []);
  for (const [id, pages] of Object.entries(story.areas || {})) {
    if (!areas[id]) err(RA, `story.areas.${id}`, `Անհայտ վայր «${id}»`);
    checkPages(RA, `story.areas.${id}`, pages);
  }
  for (const [id, pages] of Object.entries(ranch.lessons || {})) {
    if (!shopIds.has(id)) err(RA, `lessons.${id}`, `Անհայտ «${id}» (տես shop)`);
    checkPages(RA, `lessons.${id}`, pages);
  }
  // quests: like bridgy.json; "research" goals name shop items, "earn" counts ֏, "order" orders
  const ranchQuestIds = new Set();
  (Array.isArray(ranch.quests) ? ranch.quests : []).forEach((q, i) => {
    const p = `quests[${i}]`;
    if (!isObj(q) || typeof q.id !== 'string' || typeof q.title !== 'string' || !Array.isArray(q.goals) || !q.goals.length) return err(RA, p, 'Պետք է լինի { "id": "…", "title": "…", "goals": [ … ] }');
    if (ranchQuestIds.has(q.id)) err(RA, `${p}.id`, `«${q.id}» id-ն կրկնվում է`);
    ranchQuestIds.add(q.id);
    q.goals.forEach((g, j) => {
      const gp = `${p}.goals[${j}]`;
      const types = ['gain', 'have', 'research', 'code', 'earn', 'order'];
      if (!isObj(g) || !types.includes(g.type)) return err(RA, gp, `type-ը պետք է լինի՝ ${types.join(', ')}`);
      if ((g.type === 'gain' || g.type === 'have') && !ranchItems.includes(g.item)) err(RA, `${gp}.item`, `Անհայտ ապրանք «${g.item}»`);
      if (g.type === 'research' && !shopIds.has(g.id)) err(RA, `${gp}.id`, `Անհայտ «${g.id}» (տես shop)`);
      if (g.type === 'code' && g.feature && !SYNTAX_FEATURES.includes(g.feature)) err(RA, `${gp}.feature`, `Անհայտ հնարավորություն «${g.feature}»`);
      if (g.type === 'code' && g.fn && ranchFns.size && !ranchFns.has(g.fn)) err(RA, `${gp}.fn`, `Անհայտ հրաման «${g.fn}»`);
      if (['gain', 'have', 'earn', 'order'].includes(g.type) && !(isNum(g.amount) && g.amount >= 1)) err(RA, `${gp}.amount`, 'Պետք է լինի 1 կամ ավելի թիվ');
    });
    if (q.hints !== undefined && (!Array.isArray(q.hints) || !q.hints.every((x) => typeof x === 'string'))) err(RA, `${p}.hints`, 'Պետք է լինի տեքստերի ցուցակ');
  });
  for (const [name, c] of Object.entries(guide.ranch || {})) {
    if (ranchFns.size && !ranchFns.has(name)) err(G, `ranch.${name}`, `Անհայտ ռանչոյի հրաման «${name}»`);
    if (!isObj(c) || typeof c.sig !== 'string' || typeof c.doc !== 'string') err(G, `ranch.${name}`, 'Պետք է լինի { "sig": "…", "doc": "…" }');
  }

  // ---------------------------------------------------------------- aliases
  // Format: { canonical: [shownName, ...otherNames] }
  try {
    const api = new GameApi({ config: { ...config, aliases: {} } });
    const checkNames = (path, target, names, taken, exists) => {
      if (!Array.isArray(names) || !names.length) return err(A, path, 'Պետք է լինի անունների ցուցակ, օրինակ՝ ["tnkel", "տնկել"]');
      for (const n of names) {
        if (typeof n !== 'string' || !/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(n)) err(A, path, `«${n}» անունը պետք է բաղկացած լինի տառերից և թվերից`);
        else if ((taken.has(n) && taken.get(n) !== target) || (exists(n) && n !== target)) err(A, path, `«${n}» անունն արդեն զբաղված է`);
        else taken.set(n, target);
      }
    };
    const globalNames = new Map();
    for (const section of ['functions', 'constants', 'namespaces']) {
      for (const [target, names] of Object.entries(aliases[section] || {})) {
        if (!api.globals.has(target)) err(A, `${section}.${target}`, `Անհայտ անուն «${target}»`);
        checkNames(`${section}.${target}`, target, names, globalNames, (n) => api.globals.has(n));
      }
    }
    for (const [ns, members] of Object.entries(aliases.members || {})) {
      const enumNs = api.enums[ns];
      if (!enumNs) {
        err(A, `members.${ns}`, `Անհայտ խումբ «${ns}»`);
        continue;
      }
      const memberNames = new Map();
      for (const [target, names] of Object.entries(members)) {
        if (!enumNs.has(target)) err(A, `members.${ns}.${target}`, `«${ns}» խմբում «${target}» չկա`);
        checkNames(`members.${ns}.${target}`, target, names, memberNames, (n) => enumNs.has(n));
      }
    }
    // the ranch's own names ("ranch" section, same format); the farm's names keep working there
    const r = isObj(aliases.ranch) ? aliases.ranch : {};
    const rapi = new RanchApi({ config: { ...config, aliases: {} } });
    const ranchNames = new Map();
    for (const section of ['functions', 'constants', 'namespaces']) {
      for (const [target, names] of Object.entries(aliases[section] || {})) if (rapi.globals.has(target) && Array.isArray(names)) for (const n of names) ranchNames.set(n, target);
    }
    for (const section of ['functions', 'namespaces']) {
      for (const [target, names] of Object.entries(r[section] || {})) {
        if (!rapi.globals.has(target)) err(A, `ranch.${section}.${target}`, `Անհայտ ռանչոյի անուն «${target}»`);
        checkNames(`ranch.${section}.${target}`, target, names, ranchNames, (n) => rapi.globals.has(n));
      }
    }
    for (const [ns, members] of Object.entries(r.members || {})) {
      const enumNs = rapi.enums[ns];
      if (!enumNs) {
        err(A, `ranch.members.${ns}`, `Անհայտ խումբ «${ns}»`);
        continue;
      }
      const memberNames = new Map();
      for (const [target, names] of Object.entries((aliases.members || {})[ns] || {})) if (enumNs.has(target) && Array.isArray(names)) for (const n of names) memberNames.set(n, target);
      for (const [target, names] of Object.entries(members)) {
        if (!enumNs.has(target)) err(A, `ranch.members.${ns}.${target}`, `«${ns}» խմբում «${target}» չկա`);
        checkNames(`ranch.members.${ns}.${target}`, target, names, memberNames, (n) => enumNs.has(n));
      }
    }
  } catch (e) {
    err(A, '', `Չհաջողվեց ստուգել (${e.message})`);
  }
  return errors;
}
