// The player market's window: everybody's orders, my orders and a new order. The farm keeps
// running under it; every change of goods goes through GameScreen.trade().
import { h, icon, pixelImg, clear, phoneText } from './dom.js';
import { openModal, confirmModal } from './modal.js';
import { accountErrorText, avatar } from './account.js';
import { AccountError } from '../storage/account.js';
import { allowedRange, equalAmount, giveRange, orderExpired, orderProblem, placeProblem, takeProblem, tradable } from '../engine/market.js';
import { formatCount } from '../core/util.js';

const TABS = ['All', 'Mine', 'New'];

export class MarketScreen {
  // screen: the GameScreen.
  constructor({ screen, onClose }) {
    this.screen = screen;
    this.app = screen.app;
    this.game = screen.game;
    const { t } = this.app.i18n;
    this.content = h('div', { class: 'market-content' });
    this.foot = h('div', { class: 'market-send', hidden: true });
    this.tabs = TABS.map((id) => h('button', { class: 'login-tab', dataset: { tab: id }, onclick: () => this.setTab(id) }, phoneText(t, `marketTab${id}`)));
    this.closeModal = openModal({
      title: [icon(this.app.sprites, 'market'), ' ', phoneText(t, 'marketTitle')],
      className: 'market-modal',
      body: [h('div', { class: 'login-tabs market-tabs' }, this.tabs), this.content, this.foot],
      onClose: () => {
        this.closed = true;
        onClose();
      },
    }).close;
    this.setTab('All');
  }

  get settings() {
    return this.app.config.settings;
  }

  get cfg() {
    return this.settings.market || {};
  }

  setTab(id) {
    if (this.closed) return;
    this.tab = id;
    this.seq = (this.seq || 0) + 1;
    for (const b of this.tabs) b.classList.toggle('active', b.dataset.tab === id);
    this.foot.hidden = true;
    clear(this.foot);
    if (id === 'New') this.buildNew();
    else this.buildList(id);
  }

  words(item, n) {
    return `${formatCount(n)} ${this.app.i18n.item(item)}`;
  }

  problemText(code, item) {
    return this.app.i18n.t(`ui.marketProblem.${code}`, { item: item && this.app.i18n.item(item), n: this.cfg.openOrders });
  }

  // Runs a market step and shows what went wrong. A refused order was usually just taken by
  // someone else (the rules answer that the same way as when they are not published yet).
  async act(fn, order = null) {
    try {
      await fn();
    } catch (e) {
      let error = e;
      if (e.code === 'config' && order) {
        const now = await this.app.account.orders(0).catch(() => null);
        if (now && !now.some((o) => o.id === order.id && o.updateTime === order.updateTime)) error = new AccountError('gone');
      }
      if (error.code !== 'gone') console.warn('Market:', e);
      this.app.toast(accountErrorText(this.app.i18n, error), 'warn');
    }
    this.setTab(this.tab);
  }

  // ---------------------------------------------------------------- parts

  empty(text, button) {
    return h('div', { class: 'market-empty' }, h('img', { src: this.app.config.bridgy.avatar || 'assets/bridgy/bridgy-head.png', alt: '' }), text, button);
  }

  toNew(label, cls = 'btn btn-gold') {
    return h('button', { class: cls, onclick: () => this.setTab('New') }, label);
  }

  tile(label, item, n, cls = '', note = null) {
    return h('div', { class: `market-tile ${cls}`.trim() }, pixelImg(this.app.sprites.url(`item:${item}`, 3)), h('small', {}, label), h('b', {}, formatCount(n)), h('span', {}, this.app.i18n.item(item)), note);
  }

  swap(left, right) {
    return h('div', { class: 'market-swap' }, left, h('span', { class: 'market-arrow' }, '→'), right);
  }

  timeLeft(o) {
    const { t } = this.app.i18n;
    const hours = Math.max(1, Math.ceil(((this.cfg.days ?? 3) * 86400000 - (Date.now() - o.at)) / 3600000));
    return hours > 24 ? t('ui.marketLeftDays', { n: Math.ceil(hours / 24) }) : t('ui.marketLeftHours', { n: hours });
  }

  // ---------------------------------------------------------------- the lists

  async buildList(id) {
    const { account, i18n } = this.app;
    const { t } = i18n;
    const seq = this.seq;
    this.content.replaceChildren(h('div', { class: 'market-empty' }, t('ui.loading')));
    let rows;
    try {
      if (id === 'Mine') await this.screen.collectOrders();
      rows = id === 'All' ? await this.openOrders() : await account.myOrders();
    } catch (e) {
      console.warn('Market not loaded:', e);
      if (seq === this.seq) this.content.replaceChildren(this.empty(accountErrorText(i18n, e)));
      return;
    }
    if (seq !== this.seq || this.closed) return;
    this.content.replaceChildren(...(id === 'All' ? this.allOrders(rows) : this.myOrders(rows)));
  }

  // Open, not too old and fair (a forged order never reaches the list).
  async openOrders() {
    const now = Date.now();
    const rows = await this.app.account.orders(now - (this.cfg.days ?? 3) * 86400000);
    return rows.filter((o) => o.status === 'open' && !orderExpired(this.settings, o, now) && !orderProblem(this.settings, o));
  }

  allOrders(rows) {
    const { t } = this.app.i18n;
    const info = h(
      'div',
      { class: 'market-info' },
      h('span', { class: 'grow' }, t('ui.marketHelp')),
      h('span', { class: 'chip' }, t('ui.marketToday', { n: this.screen.takenToday(), max: this.cfg.takenPerDay })),
      h('button', { class: 'btn btn-sm', onclick: () => this.setTab('All') }, t('ui.marketRefresh')),
    );
    if (!rows.length) return [info, this.empty(t('ui.marketEmpty'), this.toNew(t('ui.marketFirst')))];
    const taken = this.screen.takenToday();
    const cards = rows.map((o) => ({ o, problem: takeProblem(this.game, o, this.screen.me, taken) })).sort((a, b) => !!a.problem - !!b.problem);
    return [info, h('div', { class: 'market-cards' }, cards.map(({ o, problem }) => this.orderCard(o, problem)))];
  }

  orderCard(o, problem) {
    const { account, i18n } = this.app;
    const { t } = i18n;
    const mine = o.owner === this.screen.me;
    const have = this.game.inventory.get(o.want);
    const remove = async () => {
      if (await confirmModal(i18n, { title: t('ui.marketRemove'), text: t('ui.marketRemoveAsk', { name: o.name }), okLabel: t('ui.marketRemove') })) await this.act(() => account.removeOrder(o), o);
    };
    const take = async () => {
      if (!(await confirmModal(i18n, { title: t('ui.marketTake'), text: t('ui.marketTakeAsk', { pay: this.words(o.want, o.wantN), get: this.words(o.give, o.giveN) }), okLabel: t('ui.marketTake'), okClass: 'btn-gold' }))) return;
      await this.act(async () => {
        await this.screen.takeOrder(o);
        this.app.toast(t('ui.marketTaken'));
      }, o);
    };
    return h(
      'article',
      { class: `market-card ${problem ? 'locked' : ''}`.trim() },
      h('div', { class: 'market-card-head' }, avatar(this.app, o.name, null, 'small'), h('b', {}, o.name), h('span', { class: 'spacer' }), h('span', { class: 'muted' }, this.timeLeft(o))),
      mine
        ? this.swap(this.tile(t('ui.marketIGive'), o.give, o.giveN), this.tile(t('ui.marketIWant'), o.want, o.wantN, 'get'))
        : this.swap(this.tile(t('ui.marketYouPay'), o.want, o.wantN, '', h('span', { class: have < o.wantN ? 'short' : '' }, t('ui.marketHave', { n: formatCount(Math.floor(have)) }))), this.tile(t('ui.marketYouGet'), o.give, o.giveN, 'get')),
      h(
        'div',
        { class: 'market-card-foot' },
        problem ? h('span', { class: 'market-reason' }, this.problemText(problem, o.want)) : h('button', { class: 'btn btn-gold main', onclick: take }, t('ui.marketTake')),
        account.isAdmin ? h('button', { class: 'btn btn-sm btn-danger', onclick: remove }, t('ui.marketRemove')) : null,
      ),
    );
  }

  myOrders(rows) {
    const { t } = this.app.i18n;
    const max = this.cfg.openOrders ?? 3;
    const open = rows.filter((o) => o.status === 'open').length;
    const info = h('div', { class: 'market-info' }, h('span', { class: 'chip' }, t('ui.marketSlots', { n: open, max })));
    if (!rows.length) return [info, this.empty(t('ui.marketMineEmpty'), this.toNew(t('ui.marketFirst')))];
    const free = Array.from({ length: Math.max(0, max - open) }, () => this.toNew(t('ui.marketFreeSlot'), 'market-slot'));
    return [info, h('div', { class: 'market-cards' }, rows.map((o) => this.myCard(o)), free)];
  }

  myCard(o) {
    const { t } = this.app.i18n;
    const open = o.status === 'open';
    const cancel = () =>
      this.act(async () => {
        await this.screen.trade({ get: [o.give, o.giveN], op: { order: o } });
        this.app.toast(t('ui.marketCancelled'));
      }, o);
    return h(
      'article',
      { class: 'market-card' },
      h('div', { class: 'market-card-head' }, h('b', {}, t(open ? 'ui.marketWaiting' : 'ui.marketClosing')), h('span', { class: 'spacer' }), open ? h('span', { class: 'muted' }, this.timeLeft(o)) : null),
      this.swap(this.tile(t('ui.marketIGive'), o.give, o.giveN), this.tile(t('ui.marketIWant'), o.want, o.wantN, 'get')),
      open ? h('div', { class: 'market-card-foot' }, h('button', { class: 'btn main', onclick: cancel }, t('ui.marketCancel'))) : null,
    );
  }

  // ---------------------------------------------------------------- a new order

  // The two sides are always a fair deal: the slider only offers fair amounts.
  buildNew() {
    const { i18n, sprites, account } = this.app;
    const { t } = i18n;
    const { settings, game } = this;
    const seq = this.seq;
    const have = (item) => Math.floor(game.inventory.get(item));
    const made = (this.cfg.goods || []).filter((item) => tradable(settings, item) && game.stats.total(item) > 0);
    const giving = made.filter((item) => have(item) >= 1);
    if (!giving.length || made.length < 2) {
      this.content.replaceChildren(this.empty(t('ui.marketNoGoods')));
      return;
    }
    const s = { give: giving[0], want: made.find((item) => item !== giving[0]), giveN: Math.max(1, Math.floor(have(giving[0]) / 4)), wantN: 0 };
    let open = null; // my open orders, once known
    let chosen = false; // the student moved the slider: keep their price while it is fair

    const pick = (item, side) =>
      h('button', { class: 'market-pick', title: i18n.item(item), dataset: { item }, onclick: () => choose(side, item) }, pixelImg(sprites.url(`item:${item}`, 2)), i18n.item(item), side === 'give' ? h('b', {}, formatCount(have(item))) : null);
    const givePicks = giving.map((item) => pick(item, 'give'));
    const wantPicks = made.map((item) => pick(item, 'want'));
    const giveN = h('input', { type: 'number', min: 1, step: 1, 'aria-label': t('ui.marketAmount'), oninput: () => setGive(Number(giveN.value), true), onchange: () => paint() });
    const wantN = h('input', { type: 'number', min: 1, step: 1, 'aria-label': t('ui.marketAmount'), oninput: () => setWant(Number(wantN.value), true), onchange: () => paint() });
    const slider = h('input', { type: 'range', step: 1, 'aria-label': t('ui.marketAmount'), oninput: () => setWant(Number(slider.value)) });
    const low = h('span');
    const equal = h('span');
    const high = h('span');
    const range = h('div', { class: 'market-range' }, slider, h('div', {}, low, equal, high));
    const none = h('div', { class: 'market-reason' });
    const line = h('p');
    const send = h('button', { class: 'btn btn-gold', onclick: () => place() }, t('ui.marketPlace'));
    const share = (label, f) => h('button', { class: 'btn btn-sm', onclick: () => setGive(Math.max(1, Math.floor(have(s.give) * f))) }, label);

    // The boxes keep only amounts the market accepts: too much is cut at once, too little when the box
    // is left (so «15» can be typed when the least is 7).
    const limit = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
    const paint = (typing) => {
      const g = giveRange(settings, s.give, s.want, have(s.give));
      const can = g.max >= g.min; // has enough for a fair price at all
      s.giveN = typing === 'give' ? Math.min(s.giveN, g.max) : limit(s.giveN, can ? g.min : 1, g.max);
      const r = allowedRange(settings, s.give, s.giveN, s.want);
      const fair = can && s.giveN >= g.min && r.max >= r.min;
      range.hidden = !fair;
      none.hidden = can;
      none.textContent = can ? '' : t('ui.marketRangeNone', { n: this.words(s.give, g.min) });
      if (fair) {
        slider.min = wantN.min = r.min;
        slider.max = wantN.max = r.max;
        if (!chosen) s.wantN = equalAmount(settings, s.give, s.giveN, s.want);
        else s.wantN = typing === 'want' ? Math.min(s.wantN, r.max) : limit(s.wantN, r.min, r.max);
        slider.value = s.wantN;
        low.textContent = `${t('ui.marketFewer')} ${formatCount(r.min)}`;
        equal.textContent = t('ui.marketEqual', { n: formatCount(equalAmount(settings, s.give, s.giveN, s.want)) });
        high.textContent = `${t('ui.marketMore')} ${formatCount(r.max)}`;
      }
      giveN.min = can ? g.min : 1;
      giveN.max = g.max;
      if (Number(giveN.value) !== s.giveN) giveN.value = s.giveN || '';
      if (Number(wantN.value) !== s.wantN) wantN.value = s.wantN || '';
      for (const b of givePicks) b.classList.toggle('active', b.dataset.item === s.give);
      for (const b of wantPicks) {
        b.classList.toggle('active', b.dataset.item === s.want);
        b.disabled = b.dataset.item === s.give;
      }
      const between = (lo, hi) => t('ui.marketAmountRange', { min: formatCount(lo), max: formatCount(hi) });
      const problem = placeProblem(game, s, open ?? 0);
      const warn = !can ? this.problemText('have', s.give) : !fair ? between(g.min, g.max) : s.wantN < r.min ? between(r.min, r.max) : problem && this.problemText(problem, s.give);
      line.classList.toggle('warn', !!warn);
      line.textContent = warn || t('ui.marketSummary', { give: this.words(s.give, s.giveN), want: this.words(s.want, s.wantN) });
      send.disabled = !!warn || open === null;
    };
    const choose = (side, item) => {
      s[side] = item;
      if (side === 'give') {
        if (s.want === item) s.want = made.find((other) => other !== item);
        s.giveN = Math.min(s.giveN || 1, have(item));
      }
      chosen = false;
      paint();
    };
    const setGive = (n, typing = false) => {
      s.giveN = Math.floor(n) || 0;
      paint(typing ? 'give' : null);
    };
    const setWant = (n, typing = false) => {
      s.wantN = Math.floor(n) || 0;
      chosen = true;
      paint(typing ? 'want' : null);
    };
    const place = () =>
      this.act(async () => {
        const { give, want, giveN: gn, wantN: wn } = s;
        const o = { give, giveN: gn, want, wantN: wn };
        const mine = await account.myOrders();
        const problem = placeProblem(game, o, mine.filter((m) => m.status === 'open').length);
        if (problem) return this.app.toast(this.problemText(problem, give), 'warn');
        const at = Date.now();
        const { id, name } = account.user;
        await this.screen.trade({ pay: [give, gn], op: { id: `${id}~${at}`, fields: { owner: id, name, ...o, at, status: 'open' } } });
        this.app.toast(t('ui.marketPlaced'));
        this.tab = 'Mine';
      });

    this.content.replaceChildren(
      h(
        'div',
        { class: 'market-form' },
        h('section', { class: 'market-side' }, h('h4', {}, t('ui.marketIGive')), h('div', { class: 'market-picks' }, givePicks), h('div', { class: 'market-amount' }, giveN, share('¼', 0.25), share('½', 0.5), share(t('ui.marketAll'), 1))),
        h('span', { class: 'market-arrow' }, '→'),
        h('section', { class: 'market-side' }, h('h4', {}, t('ui.marketIWant')), h('div', { class: 'market-picks' }, wantPicks), h('div', { class: 'market-amount' }, wantN), range, none),
      ),
    );
    this.foot.replaceChildren(line, send);
    this.foot.hidden = false;
    paint();
    account.myOrders().then(
      (mine) => {
        if (seq !== this.seq || this.closed) return;
        open = mine.filter((m) => m.status === 'open').length;
        paint();
      },
      (e) => {
        console.warn('Market not loaded:', e);
        if (seq !== this.seq || this.closed) return;
        line.classList.add('warn');
        line.textContent = accountErrorText(i18n, e);
      },
    );
  }

  close() {
    this.closeModal();
  }
}
