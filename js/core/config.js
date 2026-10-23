// Loads config/*.json and checks them, so a teacher's typo shows a clear message
// (file, field, problem) instead of a broken game.
import { GameApi, ENTITY_NAMES, ITEM_NAMES, GROUND_NAMES } from '../engine/api.js';
import { SYNTAX_FEATURES } from '../lang/gate.js';

export const CONFIG_FILES = ['settings', 'research', 'texts', 'bridgy', 'aliases', 'guide'];

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

export function validateConfig(config) {
  const errors = [];
  const err = (file, path, message) => errors.push({ file, path, message });
  const S = 'settings.json';
  const R = 'research.json';
  const B = 'bridgy.json';
  const A = 'aliases.json';
  const T = 'texts.json';
  const G = 'guide.json';
  const { settings, research, texts, bridgy, aliases, guide } = config;

  for (const [name, v] of Object.entries({ settings, research, texts, bridgy, aliases, guide })) {
    if (!isObj(v)) err(`${name}.json`, '', 'Ֆայլը պետք է պարունակի JSON օբյեկտ { … }');
  }
  if (errors.length) return errors;

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
          const types = ['gain', 'have', 'research', 'harvest', 'code', 'visitAll', 'giant', 'plant', 'use', 'chain'];
          if (!isObj(g) || !types.includes(g.type)) return err(B, gp, `type-ը պետք է լինի՝ ${types.join(', ')}`);
          if ((g.type === 'gain' || g.type === 'have' || g.type === 'use') && !ITEM_NAMES.includes(g.item)) err(B, `${gp}.item`, `Անհայտ իր «${g.item}»`);
          if ((g.type === 'harvest' || g.type === 'plant') && !ENTITY_NAMES.includes(g.entity)) err(B, `${gp}.entity`, `Անհայտ բույս «${g.entity}»`);
          if (g.type === 'research' && !ids.has(g.id)) err(B, `${gp}.id`, `Անհայտ հետազոտություն «${g.id}»`);
          if (g.type === 'code' && g.feature && !SYNTAX_FEATURES.includes(g.feature)) err(B, `${gp}.feature`, `Անհայտ հնարավորություն «${g.feature}»`);
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
        pages.forEach((pg, j) => {
          const q = pg.quiz;
          const ok =
            isObj(q) && Array.isArray(q.answers) && q.answers.length >= 2 && q.answers.every((a) => typeof a === 'string') &&
            Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.answers.length && typeof q.right === 'string' && typeof q.wrong === 'string';
          if (q !== undefined && !ok) err(B, `lessons.${id}[${j}].quiz`, 'Պետք է լինի { "answers": ["…", "…"], "correct": 0, "right": "…", "wrong": "…" }');
        });
      }
  }
  if (!Array.isArray(bridgy.intro)) err(B, 'intro', 'Պետք է լինի էջերի ցուցակ');

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
  } catch (e) {
    err(A, '', `Չհաջողվեց ստուգել (${e.message})`);
  }
  return errors;
}
