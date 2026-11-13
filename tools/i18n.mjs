// Translations: what is missing, changed or extra in config/en and config/ru (see config/README.md).
//   npm run i18n                          summary for every language
//   npm run i18n -- ru                    summary for one language
//   npm run i18n -- ru bridgy --todo      the Armenian texts to translate in bridgy.json (missing + changed), as JSON
//   npm run i18n -- ru bridgy --stamp     after translating: remember which Armenian each translation was made from
//                                         (and sort the file like the Armenian one)
//   npm run i18n -- ru bridgy --check     the translated texts' problems: Armenian letters, placeholders, plural
//                                         forms, command names of another language (npm test runs the same)
// A translation is "changed" when its Armenian text was edited after the stamp (config/<lang>/_source.json).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LANGS, TEXT_FILES, ARMENIAN, eachText, localize } from '../js/core/i18n.js';
import { GameApi } from '../js/engine/api.js';
import { RanchApi } from '../js/engine/ranchApi.js';

const dir = new URL('../config/', import.meta.url);
const readJson = (f, fallback) => (existsSync(new URL(f, dir)) ? JSON.parse(readFileSync(new URL(f, dir), 'utf8')) : fallback);
const writeJson = (f, data) => writeFileSync(new URL(f, dir), `${JSON.stringify(data, null, 2)}\n`);

// FNV-1a: a short fingerprint of an Armenian text.
export const fingerprint = (text) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
};

// { key: Armenian text } of one config file. Code fields without Armenian are renamed by the game itself, so
// they are optional (code: true adds them): a translation may still replace one, e.g. to give its variables
// English names (`let koxm` → `let side`); then it is checked and tracked like a text.
export function armenianTexts(file, { code = false } = {}) {
  const out = {};
  eachText(readJson(`${file}.json`), (key, v, set, isCode) => (code || !isCode) && (out[key] = v), file);
  return out;
}

export function status(lang, file) {
  const pack = readJson(`${lang}/${file}.json`, {});
  const all = armenianTexts(file, { code: true });
  const texts = armenianTexts(file);
  const hy = Object.fromEntries(Object.entries(all).filter(([k]) => k in texts || k in pack));
  const source = readJson(`${lang}/_source.json`, {})[file] || {};
  const missing = Object.keys(texts).filter((k) => typeof pack[k] !== 'string');
  const changed = Object.keys(hy).filter((k) => typeof pack[k] === 'string' && source[k] !== fingerprint(hy[k]));
  const extra = Object.keys(pack).filter((k) => !(k in hy));
  return { hy, pack, missing, changed, extra };
}

// The game names in a text that are not the shown names of the language (Armenian, another language, the
// hidden old English ones): calls name(…), constants (directions) and Group.Member values.
export function wrongNames(text, farm, ranch) {
  const bad = [];
  const global = (name) => {
    for (const api of [farm, ranch]) {
      const canon = api.canonicalName(name);
      const g = api.globals.get(canon);
      if (g && (canon !== name || api.labels.has(canon))) return { api, canon, g };
    }
    return null;
  };
  for (const m of text.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)(?:\s*\.\s*([A-Za-z_$][\w$]*))?(\()?/g)) { // a call: name( with nothing between ("on (3, 0)" is prose)
    const [, name, member, call] = m;
    const found = global(name);
    if (!found) continue;
    const { api, canon, g } = found;
    if (g.kind === 'enum' && member) {
      const other = api === farm ? ranch.enums[canon] : farm.enums[canon];
      const ns = [api.enums[canon] || g.value, other].find((n) => n && (n.canonical.get(member) || n.has(member)));
      if (name !== api.displayName(canon) || (ns && ns.labelOf(ns.canonical.get(member) || member) !== member)) bad.push(m[0].trim());
    } else if ((call && g.kind === 'function') || g.kind === 'constant') { // (a group's name alone is often an ordinary word: "Unlocks")
      if (name !== api.displayName(canon)) bad.push(name);
    }
  }
  return [...new Set(bad)];
}

// The game's APIs in a language (for wrongNames).
export function apis(lang) {
  const raw = Object.fromEntries(['settings', 'research', 'aliases', ...TEXT_FILES].map((f) => [f, readJson(`${f}.json`)]));
  const packs = { aliases: Object.fromEntries(LANGS.filter((l) => l !== 'hy').map((l) => [l, readJson(`${l}/aliases.json`, {})])) };
  const config = localize(raw, lang, packs);
  return { farm: new GameApi({ config }), ranch: new RanchApi({ config }) };
}

// Problems of the translated texts of one file: [key, problem].
export function problems(lang, file, api = apis(lang)) {
  const { hy, pack } = status(lang, file);
  const forms = lang === 'ru' ? [3, 4] : [2, 2];
  const names = (text) => [...new Set([...text.matchAll(/(?<!\$)\{(\w+)(?:\|[^{}]*)?\}/g)].map((x) => x[1]))].sort().join(', '); // (${x} is JavaScript)
  const out = [];
  for (const [key, text] of Object.entries(pack)) {
    if (!(key in hy)) continue;
    if (typeof text !== 'string') {
      out.push([key, 'not a text']);
      continue;
    }
    if (ARMENIAN.test(text)) out.push([key, 'Armenian letters']);
    // a text of the wrong language (a script that wrote English into the Russian file, or the reverse)
    if (lang === 'ru' && /[\u0531-\u0587]{2}/.test(hy[key]) && !/[А-яЁё]/.test(text)) out.push([key, 'no Russian letters']);
    if (lang === 'en' && /[А-яЁё]/.test(text)) out.push([key, 'Russian letters']);
    if (names(hy[key]) !== names(text)) out.push([key, `placeholders {${names(hy[key])}} became {${names(text)}}`]);
    for (const p of text.matchAll(/\{\w+\|([^{}]*)\}/g)) {
      const n = p[1].split('|').length;
      if (n < forms[0] || n > forms[1]) out.push([key, `${n} plural forms in ${p[0]} (${lang}: ${forms[0]}${forms[1] > forms[0] ? `–${forms[1]}` : ''})`]);
    }
    const bad = wrongNames(text, api.farm, api.ranch);
    if (bad.length) out.push([key, `names of another language: ${bad.join(', ')}`]);
  }
  return out;
}

function main(args) {
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const [lang, file] = args.filter((a) => !a.startsWith('--'));
  const langs = lang ? [lang] : LANGS.filter((l) => l !== 'hy');
  if (lang && !LANGS.includes(lang)) throw new Error(`Unknown language "${lang}" (${LANGS.join(', ')})`);
  if (file && !TEXT_FILES.includes(file)) throw new Error(`Unknown file "${file}" (${TEXT_FILES.join(', ')})`);
  if (flags.has('--todo')) {
    const s = status(lang, file);
    const todo = Object.fromEntries([...s.missing, ...s.changed].map((k) => [k, s.hy[k]]));
    process.stdout.write(`${JSON.stringify(todo, null, 2)}\n`);
    return;
  }
  if (flags.has('--check')) {
    const api = apis(lang);
    let n = 0;
    for (const f of file ? [file] : TEXT_FILES) {
      for (const [key, problem] of problems(lang, f, api)) {
        console.log(`${f} ${key}: ${problem}`);
        n++;
      }
    }
    console.log(n ? `${n} problems` : 'no problems');
    if (n) process.exitCode = 1;
    return;
  }
  if (flags.has('--stamp')) {
    const s = status(lang, file);
    const sources = readJson(`${lang}/_source.json`, {});
    sources[file] = Object.fromEntries(Object.keys(s.hy).filter((k) => typeof s.pack[k] === 'string').map((k) => [k, fingerprint(s.hy[k])]));
    const sorted = Object.fromEntries([...Object.keys(s.hy), ...s.extra].filter((k) => k in s.pack).map((k) => [k, s.pack[k]]));
    writeJson(`${lang}/${file}.json`, sorted);
    writeJson(`${lang}/_source.json`, Object.fromEntries(TEXT_FILES.filter((f) => sources[f]).map((f) => [f, sources[f]])));
    console.log(`${lang}/${file}.json: ${Object.keys(sources[file]).length} translations stamped${s.missing.length ? `, ${s.missing.length} still missing` : ''}`);
    return;
  }
  let open = 0;
  for (const l of langs) {
    console.log(`\n${l}`);
    for (const f of file ? [file] : TEXT_FILES) {
      const s = status(l, f);
      open += s.missing.length + s.changed.length + s.extra.length;
      const total = Object.keys(s.hy).length;
      console.log(`  ${f.padEnd(9)} ${String(total - s.missing.length).padStart(5)} / ${String(total).padEnd(5)} missing ${String(s.missing.length).padEnd(5)} changed ${String(s.changed.length).padEnd(5)} extra ${s.extra.length}`);
    }
  }
  if (open) process.exitCode = 1;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
