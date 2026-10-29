// Start screen (login / registration / leaderboard), the profile window and the leaderboard table.
import { h, pixelImg } from './dom.js';
import { openModal } from './modal.js';
import { formatClock, formatCount, formatTenths, dayKey, prevDayKey, prevMonthKey, dayNumber, keyOfDay, weekKey } from '../core/util.js';
import { boardField, playerRow, ascending } from '../storage/account.js';
import { festivalOn } from '../engine/festivals.js';

const AVATAR_COLORS = ['#2d6be0', '#36a852', '#e2483d', '#f08a24', '#7c3aed', '#0e7490', '#c026d3', '#b45309'];
const MEDALS = ['🥇', '🥈', '🥉'];
const WHAT = ['points', 'code', 'challenge', 'perfect', 'ranch', 'festival']; // the festival only while one runs
const WHEN = ['day', 'month', 'all']; // (for points and the ranch's ֏)

export function accountErrorText(i18n, e) {
  if (!e || !e.code) console.error(e);
  const text = i18n.t(`accountErrors.${(e && e.code) || 'unknown'}`);
  return text.startsWith('accountErrors.') ? i18n.t('accountErrors.unknown') : text;
}

const researchTotal = (config) => config.research.nodes.reduce((sum, n) => sum + n.tiers.length, 0);

// A round badge in the player's own colour with their drone hat (or the first letter).
function avatar(app, name, hat, cls = '') {
  let n = 0;
  for (const ch of name) n = (n * 31 + ch.codePointAt(0)) >>> 0;
  const sprite = `hatSide:${hat}`;
  return h(
    'div',
    { class: `profile-avatar ${cls}`.trim(), style: { background: AVATAR_COLORS[n % AVATAR_COLORS.length] } },
    hat && app.sprites.has(sprite) ? pixelImg(app.sprites.url(sprite, 3)) : name[0].toUpperCase(),
  );
}

// The rank tier for all-time points (settings.json → leaderboard.tiers): { index, tier, next }.
export function tierOf(settings, points) {
  const tiers = (settings.leaderboard && settings.leaderboard.tiers) || [];
  let index = -1;
  tiers.forEach((tier, i) => points >= tier.points && (index = i));
  return { index, tier: tiers[index] || null, next: tiers[index + 1] || null };
}

const todayKey = (app) => dayKey(Date.now(), (app.config.settings.leaderboard || {}).timeZone);

// Days in a row, while the streak is alive (played today or yesterday).
const streakOf = (r, today) => (r.streakDay === today || r.streakDay === prevDayKey(today) ? r.streak || 0 : 0);

export class LoginScreen {
  constructor(app, onLogin, notice = '') {
    this.app = app;
    this.onLogin = onLogin;
    const t = app.i18n.t;
    this.name = h('input', { class: 'input', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: '16' });
    this.pass = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
    const eye = h('button', {
      type: 'button',
      class: 'btn btn-ghost btn-sm',
      title: t('ui.showPassword'),
      onclick: () => {
        this.pass.type = this.pass.type === 'password' ? 'text' : 'password';
      },
    }, '👁');
    this.rule = h('div', { class: 'form-hint' });
    this.error = h('div', { class: 'form-error' });
    this.submit = h('button', { class: 'btn btn-run login-submit', type: 'submit' });
    this.form = h(
      'form',
      {
        class: 'login-form',
        onsubmit: (e) => {
          e.preventDefault();
          this.send();
        },
      },
      h('label', { class: 'field' }, h('span', {}, t('ui.username')), this.name),
      h('label', { class: 'field' }, h('span', {}, t('ui.password')), h('div', { class: 'password-row' }, this.pass, eye)),
      this.rule,
      this.error,
      this.submit,
    );
    this.board = h('div', { hidden: true });
    this.tabs = ['login', 'register', 'leaders'].map((tab) =>
      h('button', { type: 'button', class: 'login-tab', dataset: { tab }, onclick: () => this.setTab(tab) }, t(`ui.${tab}Tab`)),
    );
    const meadow = h('div', { class: 'login-meadow' });
    meadow.style.backgroundImage = `url(${app.sprites.url('meadow0', 3)}), url(${app.sprites.url('meadow2', 3)})`;
    meadow.style.backgroundPosition = '0 0, 24px 48px';
    const adapter = app.account.adapter;
    this.el = h(
      'section',
      { class: 'screen screen-login' },
      h(
        'div',
        { class: 'login-card' },
        h('div', { class: 'login-hero' }, pixelImg('assets/bridgy/bridgy.png', '', t('ui.bridgyName'))),
        h(
          'div',
          { class: 'login-main' },
          h('h1', { class: 'game-title' }, t('ui.title')),
          h('p', { class: 'game-subtitle' }, t('ui.subtitle')),
          h('div', { class: 'login-tabs', role: 'tablist' }, this.tabs),
          this.form,
          this.board,
          app.account.online ? null : h('p', { class: 'form-hint' }, t('ui.localMode')),
          adapter.available === false ? h('p', { class: 'form-error' }, t('ui.storageBlocked')) : null,
        ),
      ),
      meadow,
    );
    app.root.append(this.el);
    this.setTab('login');
    if (notice) this.error.textContent = notice;
  }

  destroy() {
    this.el.remove();
  }

  setTab(tab) {
    const t = this.app.i18n.t;
    this.tab = tab;
    for (const b of this.tabs) b.classList.toggle('active', b.dataset.tab === tab);
    this.form.hidden = tab === 'leaders';
    this.board.hidden = tab !== 'leaders';
    if (tab === 'leaders') {
      this.board.replaceChildren(leaderboardView(this.app));
      return;
    }
    const reg = tab === 'register';
    this.error.textContent = '';
    this.rule.textContent = reg ? `${t('ui.nameRule')} ${t('ui.passwordRule')}` : '';
    this.pass.autocomplete = reg ? 'new-password' : 'current-password';
    this.submit.textContent = t(reg ? 'ui.registerButton' : 'ui.loginButton');
    if (matchMedia('(pointer: fine)').matches) setTimeout(() => this.name.focus(), 30);
  }

  async send() {
    if (this.submit.disabled) return;
    this.submit.disabled = true;
    this.error.textContent = '';
    try {
      await this.app.account[this.tab === 'register' ? 'register' : 'login'](this.name.value, this.pass.value);
      this.onLogin();
    } catch (e) {
      this.error.textContent = accountErrorText(this.app.i18n, e);
      this.submit.disabled = false;
    }
  }
}

// The #1 players of yesterday, last month and last week's challenge (for the crowns).
export function championsOf(app, today) {
  return app.account.champions(`d${prevDayKey(today)}`, `m${prevMonthKey(today.slice(0, 6))}`, `c${weekKey(keyOfDay(dayNumber(today) - 7))}`).catch((e) => {
    console.warn('Champions not loaded:', e);
    return null;
  });
}

// The leaderboard with two dropdowns: what (points / code words / this week's challenge /
// Perfection / the running festival) × when (today / this month / all time, for points). `me` =
// { id, ...Game.leaderStats() } highlights the player, adds their own row when they are outside
// the top and the rival line; `before` (the fresh online save, a promise) is awaited first.
export function leaderboardView(app, me = null, before = null) {
  const t = app.i18n.t;
  const store = app.account.adapter;
  const festival = festivalOn(app.config.events, todayKey(app));
  const whats = WHAT.filter((w) => w !== 'festival' || festival);
  let what = whats.includes(store.get('boardWhat')) ? store.get('boardWhat') : 'points';
  let when = WHEN.includes(store.get('boardWhen')) ? store.get('boardWhen') : 'day';
  let seq = 0; // answers for a list the player already left are dropped
  const body = h('div', { class: 'board-body' });
  const help = h('div', { class: 'board-help', hidden: true });
  const select = (list, value, label, pick) =>
    h('select', { class: 'input board-select', onchange: (e) => pick(e.target.value) }, list.map((v) => h('option', { value: v, selected: v === value }, label(v))));
  const whenSelect = select(WHEN, when, (v) => t(`ui.board_${v}`), (v) => {
    when = v;
    store.set('boardWhen', v);
    load();
  });
  const whatSelect = select(whats, what, (v) => (v === 'festival' ? `${festival.icon} ${festival.name}` : t(`ui.boardWhat.${v}`)), (v) => {
    what = v;
    store.set('boardWhat', v);
    load();
  });
  const load = async (refresh = false) => {
    const mine = ++seq;
    const tab = what === 'points' ? when : what === 'ranch' ? `ranch_${when}` : what;
    whenSelect.hidden = what !== 'points' && what !== 'ranch';
    help.textContent = t(`ui.boardHelp.${what}`);
    body.replaceChildren(h('div', { class: 'board-note' }, t('ui.loading')));
    const today = todayKey(app);
    const field = boardField(tab, today, festival && festival.key);
    try {
      await before;
      const meRow = me && { id: me.id, ...playerRow(app.account.user.name, me) };
      const [board, champs] = await Promise.all([app.account.leaderboard(field, meRow && { id: meRow.id, value: meRow[field] || 0 }, refresh), championsOf(app, today)]);
      if (mine === seq) body.replaceChildren(...boardContent(app, { ...board, tab, field, today, me: meRow, champs }));
    } catch (e) {
      if (mine === seq) body.replaceChildren(h('div', { class: 'board-note form-error' }, accountErrorText(app.i18n, e)));
    }
  };
  load();
  return h(
    'div',
    { class: 'board-wrap' },
    h(
      'div',
      { class: 'board-head' },
      h('span', {}, `🏆 ${t('ui.leadersTitle')} `, questionButton(help)),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => load(true) }, `↻ ${t('ui.refresh')}`),
    ),
    h('div', { class: 'board-selects' }, whatSelect, whenSelect),
    help,
    body,
  );
}

function boardContent(app, ctx) {
  const t = app.i18n.t;
  const { rows, place, rival, me, champs, field, tab } = ctx;
  const out = [];
  const crowns = ['day', 'month', 'week'].map((k) => champs && champs[k] && t(`ui.champion_${k}`, { name: champs[k].name })).filter(Boolean);
  if (crowns.length) out.push(h('div', { class: 'board-champs' }, crowns.map((c) => h('span', {}, c))));
  if (rows.length) out.push(h('ol', { class: 'board' }, rows.map((r, i) => boardRow(app, r, i + 1, ctx))));
  else out.push(h('div', { class: 'board-note' }, t({ day: 'ui.leadersEmptyDay', code: 'ui.leadersEmptyCode', challenge: 'ui.leadersEmptyChallenge' }[tab] || (tab.startsWith('ranch') ? 'ui.leadersEmptyRanch' : 'ui.leadersEmpty'))));
  const myValue = me ? me[field] || 0 : 0;
  if (myValue > 0 && !rows.some((r) => r.id === me.id)) out.push(h('ol', { class: 'board board-mine' }, boardRow(app, me, place, ctx)));
  const what = ['day', 'month', 'all'].includes(tab) ? 'points' : tab.startsWith('ranch') ? 'ranch' : tab;
  const gap = Math.abs(myValue - (rival ? rival[field] : 0));
  if (rival) out.push(h('div', { class: 'board-place' }, t(`ui.rival.${what}`, { name: rival.name, n: what === 'challenge' ? (gap / 10).toFixed(1) : formatCount(gap) })));
  else if (myValue > 0 && (place === 1 || !ascending(field))) out.push(h('div', { class: 'board-place' }, t('ui.rivalFirst')));
  return out;
}

// A row's number as its list shows it: a time, a percent or a count.
export function boardValue(field, v) {
  if (ascending(field)) return formatTenths(v || 0);
  if (field === 'ranch' || /^r[dm]\d/.test(field)) return `${formatCount(v || 0)} ֏`;
  return field === 'perfect' ? `${v || 0}%` : formatCount(v || 0);
}

// A small "?" that shows / hides an explanation, so the windows stay simple.
const questionButton = (el) => h('button', { type: 'button', class: 'btn btn-sm question', onclick: () => (el.hidden = !el.hidden) }, '?');

function boardRow(app, r, place, ctx) {
  const t = app.i18n.t;
  return h(
    'li',
    { class: `board-row${ctx.me && r.id === ctx.me.id ? ' me' : ''}`, title: t('ui.cardTitle'), onclick: () => openCard(app, r, ctx) },
    h('span', { class: 'board-rank' }, MEDALS[place - 1] || String(place)),
    avatar(app, r.name, r.hat, 'small'),
    h('span', { class: 'board-who' }, h('span', { class: 'board-name' }, r.name), badges(app, r, ctx)),
    h('span', { class: 'board-value' }, boardValue(ctx.field, r[ctx.field])),
    h('span', { class: 'board-stat', title: t('ui.colResearch') }, `🔬 ${r.research || 0}`),
    h('span', { class: 'board-stat', title: t('ui.colTime') }, `⏱ ${formatClock(r.playSeconds || 0)}`),
  );
}

// [[icon, title]] for 👑 yesterday's, 🏆 last month's and 🎓 last week's challenge champion.
function crownsOf(app, r, champs) {
  const t = app.i18n.t;
  const out = [];
  if (champs && champs.day && champs.day.id === r.id) out.push(['👑', t('ui.crownDay')]);
  if (champs && champs.month && champs.month.id === r.id) out.push(['🏆', t('ui.crownMonth')]);
  if (champs && champs.week && champs.week.id === r.id) out.push(['🎓', t('ui.crownWeek')]);
  return out;
}

// Crowns, the rank tier and the 🔥 day streak next to a name.
function badges(app, r, { champs, today }) {
  const tier = tierOf(app.config.settings, r.points || 0).tier;
  const streak = streakOf(r, today);
  const badge = ([text, title]) => h('span', { class: 'board-badge', title }, text);
  return [
    ...crownsOf(app, r, champs).map(badge),
    tier ? badge([tier.icon, tier.name]) : null,
    streak >= 2 ? badge([`🔥${streak}`, app.i18n.t('ui.streakDays', { n: streak })]) : null,
  ];
}

// A player's card: hat, tier, crowns and every number of their row.
function openCard(app, r, ctx) {
  const t = app.i18n.t;
  const { tier } = tierOf(app.config.settings, r.points || 0);
  const stat = (label, value) => h('div', { class: 'card-stat' }, h('span', {}, label), h('b', {}, value));
  openModal({
    title: `🃏 ${t('ui.cardTitle')}`,
    width: 'min(420px, calc(100vw - 32px))',
    body: h(
      'div',
      { class: 'player-card' },
      avatar(app, r.name, r.hat, 'big'),
      h('div', { class: 'card-name' }, r.name),
      tier ? h('div', { class: 'card-tier' }, `${tier.icon} ${tier.name}`) : null,
      h('div', { class: 'card-badges' }, crownsOf(app, r, ctx.champs).map(([icon, title]) => h('span', { class: 'chip' }, `${icon} ${title}`))),
      h(
        'div',
        { class: 'card-stats' },
        stat(`⭐ ${t('ui.colPoints')}`, formatCount(r.points || 0)),
        stat(`💻 ${t('ui.colCode')}`, formatCount(r.code || 0)),
        stat(`🔬 ${t('ui.colResearch')}`, `${r.research || 0} / ${researchTotal(app.config)}`),
        stat(`⏱ ${t('ui.colTime')}`, formatClock(r.playSeconds || 0)),
        stat(`🌾 ${t('ui.colFarm')}`, r.farm || '1×1'),
        stat(`🔥 ${t('ui.colStreak')}`, String(streakOf(r, ctx.today))),
        stat(`🌟 ${t('ui.colPerfect')}`, `${r.perfect || 0}%`),
      ),
    ),
    buttons: [{ label: t('ui.close'), class: 'btn-primary' }],
  });
}

// What the points are made of: amount × weight = points for each item (gold counts ×20, …).
function breakdownView(app, list) {
  const { t, item } = app.i18n;
  return h(
    'div',
    { class: 'breakdown' },
    h('div', { class: 'breakdown-title' }, t('ui.breakdownTitle')),
    list.length
      ? h(
          'div',
          { class: 'breakdown-list' },
          list.map((b) =>
            h(
              'span',
              { class: 'chip', title: t('ui.breakdownItem', { amount: formatCount(b.amount), item: item(b.item), points: formatCount(b.points) }) },
              pixelImg(app.sprites.url(`item:${b.item}`, 2)),
              h('small', {}, `${formatCount(b.amount)} × ${b.weight} =`),
              formatCount(b.points),
            ),
          ),
        )
      : h('div', { class: 'board-note' }, t('ui.breakdownEmpty')),
  );
}

// Perfection: how far each part is (research levels, repaired buildings), and the hat for 100%.
function perfectionView(app, parts) {
  const t = app.i18n.t;
  const hat = ((app.config.events || {}).perfection || {}).hat;
  return h(
    'div',
    { class: 'breakdown' },
    h('div', { class: 'breakdown-title' }, t('ui.perfectTitle')),
    h('div', { class: 'breakdown-list' }, parts.map((p) => h('span', { class: 'chip' }, `${t(`ui.perfectParts.${p.id}`)} ${p.value} / ${p.max}`))),
    hat ? h('div', { class: 'board-note' }, t('ui.perfectHat', { hatName: app.i18n.hat(hat) })) : null,
  );
}

// The sticker album (events.json → stickers): earned ones in color, a secret one is «?» until
// earned. A tap on a sticker tells how to get it (phones have no hover titles).
function albumView(app, earned) {
  const t = app.i18n.t;
  const list = (app.config.events || {}).stickers || [];
  const info = h('div', { class: 'board-note' }, t('ui.stickerHint'));
  const sticker = (s) => {
    const got = earned.includes(s.id);
    const hide = s.secret && !got;
    return h(
      'button',
      { type: 'button', class: `sticker${got ? ' got' : ''}`, onclick: () => (info.textContent = hide ? t('ui.stickerSecretAbout') : `${s.icon} ${s.name}․ ${s.about}`) },
      h('span', { class: 'sticker-icon' }, hide ? '?' : s.icon),
      h('small', {}, hide ? t('ui.stickerSecret') : s.name),
    );
  };
  return h(
    'div',
    { class: 'breakdown' },
    h('div', { class: 'breakdown-title' }, t('ui.stickersTitle', { n: earned.length, total: list.length })),
    [...new Set(list.map((s) => s.group))].map((g) => [h('div', { class: 'sticker-group' }, t(`ui.stickerGroups.${g}`)), h('div', { class: 'sticker-album' }, list.filter((s) => s.group === g).map(sticker))]),
    info,
  );
}

// stats = { ...Game.leaderStats(), breakdown, parts (Perfection), stickers (earned ids) };
// sync = promise of the fresh online save.
export function openProfile(app, { stats, sync, onLogout }) {
  const t = app.i18n.t;
  const user = app.account.user;
  const { tier, next } = tierOf(app.config.settings, stats.points);
  const from = tier ? tier.points : 0;
  const streak = streakOf({ streak: stats.streak, streakDay: stats.day.key }, todayKey(app));
  const breakdown = breakdownView(app, stats.breakdown);
  const perfect = perfectionView(app, stats.parts);
  const album = albumView(app, stats.stickers);
  breakdown.hidden = perfect.hidden = album.hidden = true;
  openModal({
    title: `👤 ${t('ui.profileTitle')}`,
    body: [
      h(
        'div',
        { class: 'profile-head' },
        avatar(app, user.name, stats.hat),
        h(
          'div',
          { class: 'profile-info' },
          h('div', { class: 'profile-name' }, user.name, tier ? h('span', { class: 'profile-tier' }, `${tier.icon} ${tier.name}`) : null),
          h('div', { class: 'profile-meta' }, t('ui.profileStats', { research: stats.research, total: researchTotal(app.config), time: formatClock(stats.playSeconds) })),
          next ? h('div', { class: 'tier-bar' }, h('span', { style: { width: `${Math.min(100, ((stats.points - from) / (next.points - from)) * 100)}%` } })) : null,
          h('div', { class: 'profile-meta' }, next ? t('ui.tierNext', { n: formatCount(next.points - stats.points), icon: next.icon, name: next.name }) : t('ui.tierMax')),
        ),
      ),
      h(
        'div',
        { class: 'profile-chips' },
        h('span', { class: 'chip', title: t('ui.colPoints') }, `⭐ ${formatCount(stats.points)}`, questionButton(breakdown)),
        h('span', { class: 'chip', title: t('ui.colCode') }, `💻 ${formatCount(stats.code)}`),
        h('span', { class: 'chip', title: t('ui.colPerfect') }, `🌟 ${stats.perfect}%`, questionButton(perfect)),
        h('span', { class: 'chip', title: t('ui.stickersShort') }, `🏷 ${stats.stickers.length} / ${((app.config.events || {}).stickers || []).length}`, questionButton(album)),
        streak >= 2 ? h('span', { class: 'chip', title: t('ui.colStreak') }, t('ui.streakDays', { n: streak })) : null,
      ),
      breakdown,
      perfect,
      album,
      leaderboardView(app, { id: user.id, ...stats }, sync),
      app.account.online ? null : h('p', { class: 'form-hint' }, t('ui.localMode')),
    ],
    buttons: [
      {
        label: `🚪 ${t('ui.logout')}`,
        class: 'btn-danger',
        onClick: (close) => {
          close();
          onLogout();
        },
      },
      { label: t('ui.close'), class: 'btn-primary' },
    ],
  });
}
