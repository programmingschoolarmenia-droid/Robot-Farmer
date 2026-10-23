// Start screen (login / registration / leaderboard), the profile window and the leaderboard table.
import { h, pixelImg } from './dom.js';
import { openModal } from './modal.js';
import { formatClock } from '../core/util.js';

const AVATAR_COLORS = ['#2d6be0', '#36a852', '#e2483d', '#f08a24', '#7c3aed', '#0e7490', '#c026d3', '#b45309'];
const MEDALS = ['🥇', '🥈', '🥉'];

export function accountErrorText(i18n, e) {
  if (!e || !e.code) console.error(e);
  const text = i18n.t(`accountErrors.${(e && e.code) || 'unknown'}`);
  return text.startsWith('accountErrors.') ? i18n.t('accountErrors.unknown') : text;
}

const researchTotal = (config) => config.research.nodes.reduce((sum, n) => sum + n.tiers.length, 0);

function avatar(name) {
  let n = 0;
  for (const ch of name) n = (n * 31 + ch.codePointAt(0)) >>> 0;
  return h('div', { class: 'profile-avatar', style: { background: AVATAR_COLORS[n % AVATAR_COLORS.length] } }, name[0].toUpperCase());
}

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

// The leaderboard table. `me` = { id, research, playSeconds } highlights the player and shows
// their place; `before` (a promise) is awaited before the first load (fresh online save).
export function leaderboardView(app, me = null, before = null) {
  const t = app.i18n.t;
  const body = h('div', { class: 'board-body' });
  const load = async () => {
    body.replaceChildren(h('div', { class: 'board-note' }, t('ui.loading')));
    try {
      await before;
      before = null;
      const { rows, place } = await app.account.leaderboard(me);
      const list = rows.map((r, i) =>
        h(
          'li',
          { class: `board-row ${me && r.id === me.id ? 'me' : ''}` },
          h('span', { class: 'board-rank' }, MEDALS[i] || String(i + 1)),
          h('span', { class: 'board-name' }, r.name),
          h('span', { class: 'board-stat', title: t('ui.colResearch') }, `🔬 ${r.research}`),
          h('span', { class: 'board-stat', title: t('ui.colTime') }, `⏱ ${formatClock(r.playSeconds)}`),
        ),
      );
      body.replaceChildren(list.length ? h('ol', { class: 'board' }, list) : h('div', { class: 'board-note' }, t('ui.leadersEmpty')));
      if (place && !rows.some((r) => r.id === me.id)) body.append(h('div', { class: 'board-place' }, t('ui.yourPlace', { n: place })));
    } catch (e) {
      body.replaceChildren(h('div', { class: 'board-note form-error' }, accountErrorText(app.i18n, e)));
    }
  };
  load();
  return h(
    'div',
    { class: 'board-wrap' },
    h('div', { class: 'board-head' }, h('span', {}, `🏆 ${t('ui.leadersTitle')}`), h('button', { class: 'btn btn-ghost btn-sm', onclick: load }, `↻ ${t('ui.refresh')}`)),
    body,
  );
}

// stats = { research, playSeconds }; sync = promise of the fresh online save.
export function openProfile(app, { stats, sync, onLogout }) {
  const t = app.i18n.t;
  const user = app.account.user;
  openModal({
    title: `👤 ${t('ui.profileTitle')}`,
    body: [
      h(
        'div',
        { class: 'profile-head' },
        avatar(user.name),
        h(
          'div',
          {},
          h('div', { class: 'profile-name' }, user.name),
          h('div', { class: 'profile-meta' }, t('ui.profileStats', { research: stats.research, total: researchTotal(app.config), time: formatClock(stats.playSeconds) })),
        ),
      ),
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
