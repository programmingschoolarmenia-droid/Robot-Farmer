// Text lookup (config/texts.json; command docs from config/guide.json) and the game's languages.
// t('ui.run') -> "Գործարկել";  t('ui.level', { n: 2, max: 5 }) -> "Մակարդակ՝ 2 / 5"
// Plural forms: "{n} {n|день|дня|дней}" picks the form for n with the browser's Intl.PluralRules.
export const LANGS = ['hy', 'en', 'ru'];

export function createI18n(texts, research, guide = {}, lang = 'hy') {
  const get = (path) => {
    let v = texts;
    for (const part of path.split('.')) {
      if (v == null) return undefined;
      v = v[part];
    }
    return v;
  };

  const plural = new Intl.PluralRules(lang);
  const ORDER = ['zero', 'one', 'two', 'few', 'many', 'other'];
  const kinds = ORDER.filter((k) => plural.resolvedOptions().pluralCategories.includes(k)); // en: one, other; ru: one, few, many, other
  const fill = (template, params = {}) =>
    String(template).replace(/\{(\w+)(?:\|([^{}]*))?\}/g, (m, k, forms) => {
      const v = params[k];
      if (v === undefined || v === null) return m;
      if (forms === undefined) return String(v);
      const list = forms.split('|');
      return list[Math.min(kinds.indexOf(plural.select(Number(v))), list.length - 1)] ?? list[list.length - 1];
    });

  const t = (path, params) => {
    const v = get(path);
    if (v === undefined) return path;
    return params ? fill(v, params) : v;
  };

  const item = (name) => get(`items.${name}`) || name;
  const entity = (name) => get(`entities.${name}`) || name;
  const ground = (name) => get(`grounds.${name}`) || name;
  const hat = (name) => get(`hats.${name}`) || name;
  const feature = (name) => get(`features.${name}`) || name;
  const typeName = (key) => get(`types.${key}`) || key;
  const expected = (key) => get(`expected.${key}`) || key;
  const fnDoc = (name) => (guide.commands && guide.commands[name]) || null;
  const nodeName = (id) => {
    const n = research && research.find((x) => x.id === id);
    return n ? n.name : id;
  };
  const amount = (n, name) => fill(get('ui.amount') || '{n} {item}', { n, item: item(name) }); // n may be formatted ("1 500")

  const costText = (cost) =>
    Object.entries(cost || {})
      .map(([k, v]) => amount(v, k))
      .join(', ');

  return { lang, t, fill, get, item, entity, ground, hat, feature, typeName, expected, fnDoc, nodeName, amount, costText };
}

// The language a visit starts in: ?lang= or the player's own choice, else Armenian in Armenia's time zone
// (school computers often have a Russian or English browser), else the first of the browser's languages
// we speak (Russian also for Belarusian, Kazakh, Kyrgyz and Tajik), else English.
export function pickLang({ chosen, timeZone, languages = [] } = {}) {
  if (LANGS.includes(chosen)) return chosen;
  if (timeZone === 'Asia/Yerevan') return 'hy';
  for (const l of languages) {
    const code = String(l).toLowerCase().split('-')[0];
    if (code === 'hy' || code === 'en') return code;
    if (['ru', 'be', 'kk', 'ky', 'tg'].includes(code)) return 'ru';
  }
  return 'en';
}

// ------------------------------------------------------------------ translations (config/en, config/ru)
// A translation file is a flat map { key: text } for one config file. Every Armenian text is translated; a
// code field without Armenian letters (an example, a command's signature) is not: its game names are renamed
// to the language's names when the game loads, so it stays right when a teacher edits the Armenian one.
export const TEXT_FILES = ['settings', 'research', 'texts', 'bridgy', 'guide', 'village', 'events', 'ranch'];
export const ARMENIAN = /[\u0531-\u058A]/; // Armenian letters and punctuation (the dram sign ֏ is used in every language)
const CODE_FIELDS = new Set(['example', 'code', 'sig', 'label', 'syntax', 'popularWords', 'answers']); // (quiz answers are often code)

// fn(key, value, set, isCode) for every Armenian text of one config file and every code field without Armenian
// (in texts.json every string is a text, "{n} {item}" too). Inside a list, an object is named by its id (or
// entity), so moving quests around keeps their keys.
export function eachText(data, fn, file = '') {
  const visit = (v, key, field, set) => {
    if (typeof v === 'string') {
      if (ARMENIAN.test(v) || (file === 'texts' && !CODE_FIELDS.has(field))) fn(key, v, set, false);
      else if (CODE_FIELDS.has(field)) fn(key, v, set, true);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => {
        const id = x && typeof x === 'object' ? (x.id ?? x.entity) : undefined;
        visit(x, `${key}${key ? '.' : ''}${id ?? i}`, field, (y) => (v[i] = y));
      });
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) if (k[0] !== '_') visit(x, `${key}${key ? '.' : ''}${k}`, k, (y) => (v[k] = y));
    }
  };
  visit(data, '', '', null);
}

// Every language's command names work everywhere; the chosen language's come first (the first is shown).
// aliases: { hy, en, ru } files of the same shape.
export function mergeAliases(aliases, lang) {
  const order = [lang, ...LANGS.filter((l) => l !== lang)].map((l) => aliases[l]);
  const merge = (list) => {
    if (list.some(Array.isArray)) return [...new Set(list.flatMap((x) => (Array.isArray(x) ? x : [])))];
    const out = {};
    for (const o of list) for (const k of Object.keys(o || {})) if (k[0] !== '_' && !(k in out)) out[k] = merge(list.map((x) => x && x[k]));
    return out;
  };
  return merge(order);
}

// Renames the Armenian game names in a piece of code to the language's shown names, in its comments too (they
// show what the code prints, `// Buyser.Masur`); texts in quotes stay.
export function codeRenamer(hy, target) {
  const first = (l) => (Array.isArray(l) && l[0]) || null;
  const globals = new Map();
  const spaces = new Map(); // any Armenian name of a group -> { label, members }
  const names = (canon, list) => [canon, ...(list || [])].filter((n) => !ARMENIAN.test(n));
  for (const [h, t] of [[hy, target], [hy.ranch || {}, target.ranch || {}]]) {
    for (const sec of ['functions', 'constants', 'namespaces']) {
      for (const [canon, list] of Object.entries(h[sec] || {})) {
        const to = first((t[sec] || {})[canon]);
        if (to) for (const n of names(canon, list)) if (n !== canon) globals.set(n, to);
      }
    }
  }
  const nsLabel = (canon) => first((target.namespaces || {})[canon]) || first(((target.ranch || {}).namespaces || {})[canon]) || canon;
  for (const [h, t] of [[hy.members, target.members], [(hy.ranch || {}).members, (target.ranch || {}).members]]) {
    for (const [ns, members] of Object.entries(h || {})) {
      const nsNames = names(ns, (hy.namespaces || {})[ns] || ((hy.ranch || {}).namespaces || {})[ns]);
      const entry = spaces.get(nsNames[0]) || { label: nsLabel(ns), members: new Map() };
      for (const [canon, list] of Object.entries(members)) {
        const to = first(((t || {})[ns] || {})[canon]);
        if (to) for (const n of names(canon, list)) entry.members.set(n, to);
      }
      for (const n of nsNames) spaces.set(n, entry);
    }
  }
  const re = /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`)|([A-Za-z_$][\w$]*)(?:(\s*\.\s*)([A-Za-z_$][\w$]*))?/g;
  return (code) =>
    code.replace(re, (m, skip, id, dot, member, at, all) => {
      if (skip || all[at - 1] === '.') return m;
      const ns = spaces.get(id);
      if (ns && member) return `${ns.label}${dot}${ns.members.get(member) || member}`;
      return `${(!ns && globals.get(id)) || (ns && ns.label) || id}${dot || ''}${member || ''}`;
    });
}

// Puts a language into a loaded config (in place): its texts over the Armenian ones, the renamed code, all names.
// packs: { aliases: { hy, en, ru }, <file>: { key: text } } for the chosen language.
export function localize(config, lang, packs) {
  const aliases = { ...packs.aliases, hy: config.aliases };
  config.aliases = mergeAliases(aliases, lang);
  if (lang === 'hy') return config;
  const rename = codeRenamer(aliases.hy || {}, aliases[lang] || {});
  for (const file of TEXT_FILES) {
    const pack = packs[file] || {};
    if (config[file]) eachText(config[file], (key, v, set, isCode) => set(typeof pack[key] === 'string' ? pack[key] : isCode ? rename(v) : v), file);
  }
  return config;
}
