// The player market's window: everybody's orders, my orders and a new order. The farm keeps
// running under it; every change of goods goes through GameScreen.trade().
import { h, icon, pixelImg } from './dom.js';
import { confirmModal } from './modal.js';
import { accountErrorText } from './account.js';
import { AccountError } from '../storage/account.js';
import { allowedRange, orderExpired, orderProblem, placeProblem, takeProblem, tradable } from '../engine/market.js';
import { formatCount } from '../core/util.js';

const TABS = ['All', 'Mine', 'New'];

export class MarketScreen {
  // screen: the GameScreen.
  constructor({ screen, onClose }) {
    this.screen = screen;
    this.app = screen.app;
    this.game = screen.game;
    this.onClose = onClose;
    const t = this.app.i18n.t;
    this.body = h('div', { class: 'loom-body' });
    this.tabs = TABS.map((id) => h('button', { class: 'login-tab', dataset: { tab: id }, onclick: () => this.setTab(id) }, t(`ui.marketTab${id}`)));
    this.el = h(
      'section',
      { class: 'loom-screen' },
      h('header', { class: 'loom-head' }, h('b', {}, icon(this.app.sprites, 'market'), ` ${t('ui.marketTitle')}`), h('div', { class: 'loom-tabs' }, this.tabs), h('button', { class: 'btn', onclick: () => this.close() }, t('ui.marketClose'))),
      this.body,
    );
    screen.el.append(this.el);
    this.setTab('All');
  }

  get settings() {
    return this.app.config.settings;
  }

  get cfg() {
    return this.settings.market || {};
  }

  setTab(id) {
    this.tab = id;
    for (const b of this.tabs) b.classList.toggle('active', b.dataset.tab === id);
    if (id === 'New') this.buildNew();
    else this.buildList(id);
  }

  goods(item, n) {
    return h('span', { class: 'chip', title: this.app.i18n.item(item) }, pixelImg(this.app.sprites.url(`item:${item}`, 2)), ` ${formatCount(n)} ${this.app.i18n.item(item)}`);
  }

  words(item, n) {
    return `${formatCount(n)} ${this.app.i18n.item(item)}`;
  }

  problemText(code, order) {
    const t = this.app.i18n.t;
    const item = code === 'have' ? (order.owner === this.screen.me ? order.give : order.want) : '';
    return t(`ui.marketProblem.${code}`, { item: item && this.app.i18n.item(item), n: this.cfg.openOrders });
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
    if (this.el.isConnected) this.setTab(this.tab);
  }

  // ---------------------------------------------------------------- the lists

  async buildList(id) {
    const { account, i18n } = this.app;
    const t = i18n.t;
    const seq = (this.seq = (this.seq || 0) + 1);
    const box = h('div', { class: 'board-note' }, t('ui.loading'));
    this.body.replaceChildren(id === 'All' ? h('p', { class: 'form-hint' }, t('ui.marketHelp', { n: this.screen.takenToday(), max: this.cfg.takenPerDay })) : null, box);
    let rows;
    try {
      if (id === 'Mine') await this.screen.collectOrders();
      rows = id === 'All' ? await this.openOrders() : await account.myOrders();
    } catch (e) {
      console.warn('Market not loaded:', e);
      if (seq === this.seq) box.textContent = accountErrorText(i18n, e);
      return;
    }
    if (seq !== this.seq || this.tab !== id) return;
    if (!rows.length) {
      box.textContent = t(id === 'All' ? 'ui.marketEmpty' : 'ui.marketMineEmpty');
      return;
    }
    box.replaceWith(h('div', { class: 'market-list' }, rows.map((o) => (id === 'All' ? this.orderRow(o) : this.myRow(o)))));
  }

  // Open, not too old and fair (a forged order never reaches the list).
  async openOrders() {
    const now = Date.now();
    const rows = await this.app.account.orders(now - (this.cfg.days ?? 3) * 86400000);
    return rows.filter((o) => o.status === 'open' && !orderExpired(this.settings, o, now) && !orderProblem(this.settings, o));
  }

  orderRow(o) {
    const { account, i18n } = this.app;
    const t = i18n.t;
    const problem = takeProblem(this.game, o, this.screen.me, this.screen.takenToday());
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
      'div',
      { class: 'market-row' },
      h('b', { class: 'market-name' }, o.name),
      h('span', { class: 'muted' }, t('ui.marketGives')),
      this.goods(o.give, o.giveN),
      h('span', { class: 'muted' }, t('ui.marketWants')),
      this.goods(o.want, o.wantN),
      h('span', { class: 'spacer' }),
      problem ? h('span', { class: 'muted' }, this.problemText(problem, o)) : h('button', { class: 'btn btn-sm btn-gold', onclick: take }, t('ui.marketTake')),
      account.isAdmin ? h('button', { class: 'btn btn-sm btn-danger', onclick: remove }, t('ui.marketRemove')) : null,
    );
  }

  myRow(o) {
    const t = this.app.i18n.t;
    return h(
      'div',
      { class: 'market-row' },
      h('span', { class: 'muted' }, t('ui.marketIGive')),
      this.goods(o.give, o.giveN),
      h('span', { class: 'muted' }, t('ui.marketIWant')),
      this.goods(o.want, o.wantN),
      h('span', { class: 'spacer' }),
      o.status === 'open'
        ? h(
            'button',
            {
              class: 'btn btn-sm',
              onclick: () =>
                this.act(async () => {
                  await this.screen.trade({ get: [o.give, o.giveN], op: { order: o } });
                  this.app.toast(t('ui.marketCancelled'));
                }, o),
            },
            t('ui.marketCancel'),
          )
        : h('span', { class: 'muted' }, t('ui.marketClosing')),
    );
  }

  // ---------------------------------------------------------------- a new order

  buildNew() {
    const { i18n } = this.app;
    const t = i18n.t;
    this.seq = (this.seq || 0) + 1;
    const { settings, game } = this;
    const items = (this.cfg.goods || []).filter((item) => tradable(this.settings, item) && this.game.stats.total(item) > 0);
    if (items.length < 2) {
      this.body.replaceChildren(h('div', { class: 'board-note' }, t('ui.marketNoGoods')));
      return;
    }
    const hint = h('p', { class: 'form-hint' });
    const send = h('button', { class: 'btn btn-gold', disabled: true, onclick: () => place() }, t('ui.marketPlace'));
    const order = () => ({ give: give.value, giveN: Number(giveN.value), want: want.value, wantN: Number(wantN.value) });
    let open = 0;
    let loaded = false;
    const refresh = () => {
      const o = order();
      const fits = Number.isInteger(o.giveN) && o.giveN >= 1 && o.give !== o.want;
      const range = fits ? allowedRange(settings, o.give, o.giveN, o.want) : null;
      const lines = [];
      if (range && range.max >= range.min) lines.push(t('ui.marketRange', { min: formatCount(range.min), max: formatCount(range.max), item: i18n.item(o.want) }));
      else if (range) lines.push(t('ui.marketRangeNone'));
      const problem = loaded ? placeProblem(game, o, open) : 'amount';
      if (loaded && problem && (o.giveN || o.wantN || problem !== 'amount')) lines.push(this.problemText(problem, { ...o, owner: self.screen.me }));
      hint.textContent = lines.join(' ');
      send.disabled = !!problem;
    };
    const select = (first) => h('select', { class: 'market-field', onchange: refresh }, items.map((item) => h('option', { value: item, selected: item === first }, i18n.item(item))));
    const number = () => h('input', { class: 'market-field', type: 'number', min: 1, step: 1, oninput: refresh });
    const give = select(items[0]);
    const want = select(items[1]);
    const giveN = number();
    const wantN = number();
    const place = () =>
      this.act(async () => {
        const o = order();
        const mine = await this.app.account.myOrders();
        const problem = placeProblem(game, o, mine.filter((m) => m.status === 'open').length);
        if (problem) return this.app.toast(this.problemText(problem, { ...o, owner: this.screen.me }), 'warn');
        const at = Date.now();
        const user = this.app.account.user;
        await this.screen.trade({ pay: [o.give, o.giveN], op: { id: `${user.id}~${at}`, fields: { owner: user.id, name: user.name, ...o, at, status: 'open' } } });
        this.app.toast(t('ui.marketPlaced'));
        this.tab = 'Mine';
      });
    this.body.replaceChildren(
      h(
        'div',
        { class: 'market-form' },
        h('label', {}, h('b', {}, t('ui.marketIGive')), give, giveN),
        h('label', {}, h('b', {}, t('ui.marketIWant')), want, wantN),
        hint,
        send,
      ),
    );
    this.app.account.myOrders().then(
      (mine) => {
        open = mine.filter((m) => m.status === 'open').length;
        loaded = true;
        refresh();
      },
      (e) => {
        console.warn('Market not loaded:', e);
        hint.textContent = accountErrorText(i18n, e);
      },
    );
    refresh();
  }

  close() {
    this.seq = (this.seq || 0) + 1;
    this.el.remove();
    this.onClose();
  }
}
