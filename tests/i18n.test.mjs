// Languages: the language a visit starts in, plural forms, the command names of every language, and the
// English/Russian translations (complete, same placeholders, no Armenian left, code with the right names).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConfig, rawConfig } from './helpers.mjs';
import { LANGS, TEXT_FILES, ARMENIAN, pickLang, createI18n, eachText, codeRenamer } from '../js/core/i18n.js';
import { validateConfig } from '../js/core/config.js';
import { GameApi } from '../js/engine/api.js';
import { RanchApi } from '../js/engine/ranchApi.js';
import { status, problems, apis, wrongNames } from '../tools/i18n.mjs';

const OTHER = LANGS.filter((l) => l !== 'hy');
const aliasFile = (lang) => JSON.parse(readFileSync(new URL(`../config/${lang}/aliases.json`, import.meta.url), 'utf8'));

test('the first visit picks the language: own choice, Armenia, the browser, else English', () => {
  assert.equal(pickLang({ chosen: 'ru', timeZone: 'Asia/Yerevan', languages: ['hy'] }), 'ru');
  assert.equal(pickLang({ chosen: 'xx', timeZone: 'Asia/Yerevan', languages: ['ru-RU'] }), 'hy');
  assert.equal(pickLang({ timeZone: 'Europe/Moscow', languages: ['ru-RU', 'en'] }), 'ru');
  assert.equal(pickLang({ timeZone: 'Asia/Almaty', languages: ['kk-KZ'] }), 'ru');
  assert.equal(pickLang({ timeZone: 'Europe/Berlin', languages: ['de-DE', 'en-US'] }), 'en');
  assert.equal(pickLang({ timeZone: 'America/Los_Angeles', languages: ['hy-AM'] }), 'hy');
  assert.equal(pickLang({ timeZone: 'Europe/Paris', languages: ['fr'] }), 'en');
});

test('plural forms follow each language', () => {
  const ru = createI18n({ ui: { d: '{n} {n|день|дня|дней}' } }, [], {}, 'ru');
  assert.deepEqual([1, 2, 5, 11, 21, 22].map((n) => ru.t('ui.d', { n })), ['1 день', '2 дня', '5 дней', '11 дней', '21 день', '22 дня']);
  const en = createI18n({ ui: { d: '{n} {n|day|days}', amount: '{item} ×{n}' }, items: { Hay: 'Wheat' } }, [], {}, 'en');
  assert.deepEqual([1, 2].map((n) => en.t('ui.d', { n })), ['1 day', '2 days']);
  assert.equal(en.costText({ Hay: 3 }), 'Wheat ×3');
});

test('every text has its own key, and keys stay when a list is reordered', () => {
  const cfg = rawConfig();
  for (const file of TEXT_FILES) {
    const keys = [];
    eachText(cfg[file], (key) => keys.push(key), file);
    assert.equal(new Set(keys).size, keys.length, `${file}: two texts share a key`);
  }
  const quests = structuredClone(cfg.bridgy);
  quests.quests.reverse();
  const a = [];
  const b = [];
  eachText(cfg.bridgy, (k, v) => a.push(`${k}=${v}`));
  eachText(quests, (k, v) => b.push(`${k}=${v}`));
  assert.deepEqual(a.sort(), b.sort());
});

test('every language has a name for every command and value, without Armenian letters', () => {
  const hy = rawConfig().aliases;
  for (const lang of OTHER) {
    const pack = aliasFile(lang);
    const walk = (a, b, path) => {
      for (const [k, v] of Object.entries(a)) {
        if (k[0] === '_') continue;
        if (Array.isArray(v)) {
          assert.ok(Array.isArray(b && b[k]) && b[k].length, `${lang}: no name for ${path}${k}`);
          for (const n of b[k]) assert.ok(!ARMENIAN.test(n) && /^[A-Za-z_$][\w$]*$/.test(n), `${lang}: bad name «${n}» for ${path}${k}`);
        } else walk(v, b && b[k], `${path}${k}.`);
      }
    };
    walk(hy, pack, '');
  }
});

test('the game accepts all languages at once and shows the chosen one', () => {
  for (const lang of LANGS) {
    const config = loadConfig(lang);
    assert.deepEqual(validateConfig(config), [], `${lang}: config errors`);
    const api = new GameApi({ config });
    const shown = { hy: 'tnkel', en: 'sow', ru: 'posadit' }[lang];
    assert.equal(api.displayName('plant'), shown);
    for (const name of ['tnkel', 'sow', 'posadit', 'plant']) assert.equal(api.canonicalName(name), 'plant');
    assert.equal(api.enums.Entities.get('Pshenitsa'), api.enums.Entities.get('Coren'));
  }
});

test('code examples are renamed to the language, texts in quotes untouched', () => {
  const cfg = rawConfig();
  const ru = codeRenamer(cfg.aliases, aliasFile('ru'));
  assert.equal(ru('while (karoxEmGnal(Verev)) { gnal(Verev); tnkel(Buyser.Coren); } // Buyser.Masur'), 'while (mozhnoIdti(Vverkh)) { idti(Vverkh); posadit(Rasteniya.Pshenitsa); } // Rasteniya.Shipovnik');
  assert.equal(ru('tpel("tnkel"); list.gnal(); Math.floor(x); x = Irer.Mexr;'), 'vyvesti("tnkel"); list.gnal(); Math.floor(x); x = Veshchi.Med;');
  const en = codeRenamer(cfg.aliases, aliasFile('en'));
  assert.equal(en('nvagel(Notaner.Do, 1); vacharel(Irer.Dzu); Sarqer.Lchak; Hoxer.Lchak'), 'playNote(Notes.C, 1); sell(Goods.Egg); Machines.MudPool; Soils.Pond');
});


for (const lang of OTHER) {
  test(`${lang}: every Armenian text is translated, nothing extra`, () => {
    const problems = [];
    for (const file of TEXT_FILES) {
      const s = status(lang, file);
      if (s.missing.length) problems.push(`${file}: ${s.missing.length} missing (e.g. ${s.missing.slice(0, 3).join(', ')})`);
      if (s.extra.length) problems.push(`${file}: ${s.extra.length} extra (e.g. ${s.extra.slice(0, 3).join(', ')})`);
    }
    assert.deepEqual(problems, [], 'run: npm run i18n');
  });

  test(`${lang}: translations keep placeholders and plural forms, use ${lang} command names, have no Armenian letters`, () => {
    const api = apis(lang);
    const found = TEXT_FILES.flatMap((file) => problems(lang, file, api).map(([key, p]) => `${file} ${key}: ${p}`));
    assert.deepEqual(found.slice(0, 40), [], `${found.length} problems (npm run i18n -- ${lang} --check)`);
  });

  test(`${lang}: code examples renamed by the game use ${lang} names`, () => {
    const config = loadConfig(lang);
    const farm = new GameApi({ config });
    const ranch = new RanchApi({ config });
    const found = [];
    for (const file of TEXT_FILES) {
      eachText(config[file], (key, v, set, isCode) => {
        const bad = isCode ? wrongNames(v, farm, ranch) : [];
        if (bad.length) found.push(`${file} ${key}: ${bad.join(', ')}`);
      }, file);
    }
    assert.deepEqual(found, []);
  });
}
