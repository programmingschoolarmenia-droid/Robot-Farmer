// Bridgy's book (config/guide.json): game commands, JavaScript topics and plants — only the
// parts the player has unlocked. Plant numbers come live from settings.json.
import { h, icon, pixelImg, highlightCode } from './dom.js';
import { openModal } from './modal.js';
import { SYNTAX_FEATURES } from '../lang/gate.js';

const TABS = [
  ['commands', 'book', 'ui.helpCommands'],
  ['js', 'js', 'ui.helpJs'],
  ['plants', 'sprout', 'ui.helpPlants'],
  ['notes', 'scroll', 'ui.helpNotes'],
];
const NOTE_ICONS = { math: 'puzzle', code: 'code', cipher: 'key', fact: 'sunflower' };

// On the ranch (game = the Ranch) the book has its commands and the JavaScript topics.
export function openBook({ app, game, tab = 'commands' }) {
  const t = app.i18n.t;
  const list = h('div', { class: 'book-list' });
  const search = h('input', { class: 'input book-search', type: 'search', placeholder: t('ui.bookSearch'), oninput: () => filter() });
  const tabs = TABS.filter(([id]) => !game.isRanch || id === 'commands' || id === 'js');
  const tabButtons = tabs.map(([id, ico, label]) => h('button', { class: 'login-tab', dataset: { tab: id }, onclick: () => show(id) }, icon(app.sprites, ico), ` ${t(label)}`));
  const nothing = h('div', { class: 'board-note', hidden: true }, t('ui.bookNothing'));
  const show = (id) => {
    for (const b of tabButtons) b.classList.toggle('active', b.dataset.tab === id);
    const { cards, locked } = buildCards(app, game, id);
    list.replaceChildren(...cards, nothing, locked ? h('div', { class: 'book-locked' }, t(id === 'notes' ? 'ui.notesLocked' : 'ui.bookLocked', { n: locked })) : '');
    filter();
  };
  const filter = () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const card of list.querySelectorAll('.book-card')) {
      card.hidden = !!q && !card.textContent.toLowerCase().includes(q);
      if (q) card.open = !card.hidden;
      if (!card.hidden) shown++;
    }
    nothing.hidden = shown > 0;
  };
  openModal({
    title: [icon(app.sprites, 'book'), ` ${t('ui.bookTitle')}`],
    className: 'book-modal',
    body: [h('div', { class: 'login-tabs' }, tabButtons), search, list],
  });
  show(tabs.some(([id]) => id === tab) ? tab : 'commands');
}

function buildCards(app, game, tab) {
  const guide = app.config.guide;
  const { research, api } = game;
  const unlocked = (need) => (SYNTAX_FEATURES.includes(need) ? research.hasSyntax(need) : research.hasFunction(need));
  let entries;
  if (tab === 'commands') {
    // Game commands only (they have an Armenian name); Math & co. are explained in the JS tab.
    entries = Object.entries(game.isRanch ? { ...guide.commands, ...guide.ranch } : guide.commands)
      .filter(([name]) => api.labels.has(name))
      .map(([name, c]) => ({ open: research.hasFunction(name), card: () => commandCard(app, game, name, c) }));
  } else if (tab === 'js') {
    entries = guide.js.map((topic) => ({ open: (topic.needs || []).every(unlocked), card: () => topicCard(app, game, topic) }));
  } else if (tab === 'notes') {
    entries = game.notes.list.map((n, i) => ({ open: game.notes.got.includes(n.id), card: () => noteCard(app, game, n, i + 1) }));
  } else {
    entries = guide.plants.map((p) => ({
      open: p.entity ? research.hasEntity(p.entity) : research.level(p.research) > 0,
      card: () => plantCard(app, game, p),
    }));
  }
  const open = entries.filter((e) => e.open);
  return { cards: open.map((e) => e.card()), locked: entries.length - open.length };
}

const code = (game, text) => h('pre', { class: 'bridgy-code' }, highlightCode(text, (w) => game.api.codeKind(w)));
const section = (title, ...content) => h('div', { class: 'book-section' }, h('h4', {}, title), ...content);

function commandCard(app, game, name, c) {
  const t = app.i18n.t;
  const node = game.research.nodeForFunction(name);
  return h(
    'details',
    { class: 'book-card' },
    h('summary', {}, h('code', { class: 'book-sig' }, c.sig), h('span', { class: 'book-short' }, c.doc)),
    c.example ? section(t('ui.bookExample'), code(game, c.example)) : null,
    c.notes ? h('p', { class: 'book-note' }, icon(app.sprites, 'bulb'), ` ${c.notes}`) : null,
    node ? h('p', { class: 'book-from' }, fromText(app, game, node)) : null,
  );
}

// Where a command comes from: the ranch's shop, a village building or a research.
function fromText(app, game, node) {
  const t = app.i18n.t;
  if (game.isRanch && game.shopItem(node)) return [icon(app.sprites, 'cart'), ` ${t('ui.bookFrom', { name: game.shopName(game.shopItem(node)) })}`];
  return [icon(app.sprites, game.village.building(node) ? 'village' : 'research'), ` ${t('ui.bookFrom', { name: app.i18n.nodeName(node) })}`];
}

// A secret note in Bridgy's book: its riddle (and program) and whether its treasure was found.
function noteCard(app, game, n, number) {
  const t = app.i18n.t;
  const notes = game.notes;
  const state = notes.active === n.id ? 'active' : notes.status[n.id] || 'active';
  const tag = { active: 'ui.noteActiveTag', solved: 'ui.noteSolvedTag', failed: 'ui.noteFailedTag' }[state];
  return h(
    'details',
    { class: 'book-card', open: state === 'active' },
    h('summary', {}, h('span', { class: 'book-title' }, icon(app.sprites, NOTE_ICONS[n.kind] || 'scroll'), ` ${t('ui.noteTitle', { n: number })}`), h('span', { class: 'book-short' }, t(tag))),
    h('p', {}, n.text),
    n.code ? code(game, n.code) : null,
  );
}

function topicCard(app, game, topic) {
  const t = app.i18n.t;
  return h(
    'details',
    { class: 'book-card' },
    h('summary', {}, h('span', { class: 'book-title' }, topic.title)),
    h('p', {}, topic.about),
    topic.syntax ? section(t('ui.bookSyntax'), code(game, topic.syntax)) : null,
    topic.example ? section(t('ui.bookExample'), code(game, topic.example)) : null,
    topic.mistakes && topic.mistakes.length ? section(t('ui.bookMistakes'), h('ul', {}, topic.mistakes.map((m) => h('li', {}, m)))) : null,
  );
}

function plantCard(app, game, p) {
  const { i18n, sprites } = app;
  const t = i18n.t;
  const facts = [];
  if (p.entity) {
    const cfg = game.settings.entities[p.entity] || {};
    const [min, max] = cfg.growTime || [0, 0];
    const cost = game.world.plantCost(p.entity);
    const mult = game.world.yieldMultiplier(p.entity);
    const fact = (label, value) => h('div', { class: 'book-fact' }, h('span', {}, label), h('b', {}, value));
    facts.push(
      fact(t('ui.plantInCode'), String(game.api.enums.Entities.get(p.entity))),
      fact(t('ui.plantWhere'), (cfg.grounds || []).includes('Grassland') ? t('ui.groundAny') : t('ui.groundSoil')),
      fact(t('ui.plantCost'), Object.keys(cost).length ? i18n.costText(cost) : t('ui.free')),
      fact(t('ui.plantGrow'), t('ui.seconds', { n: min === max ? min : `${min}–${max}` })),
      cfg.seasons ? fact(t('ui.plantSeasons'), cfg.seasons.map((s) => t(`seasons.${s}`)).join(', ')) : null,
      fact(t('ui.plantYield'), Object.entries(cfg.yield || {}).map(([item, n]) => `${n * mult} ${i18n.item(item)}`).join(', ')),
    );
  }
  const title = p.title || i18n.entity(p.entity);
  return h(
    'details',
    { class: 'book-card' },
    h('summary', {}, pixelImg(sprites.url(p.icon, 2), 'book-icon'), h('span', { class: 'book-title' }, title)),
    facts.length ? h('div', { class: 'book-facts' }, facts) : null,
    h('p', {}, p.about),
    p.tips ? h('p', { class: 'book-note' }, icon(sprites, 'bulb'), ` ${p.tips}`) : null,
  );
}
