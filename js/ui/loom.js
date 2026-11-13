// The carpets' full-screen window: the loom (the sample next to the carpet growing, how alike they are,
// the yarn on the loom), today's orders, my carpets and the weekly contest. The ranch keeps running
// under it; RanchScreen calls update() a few times a second.
import { h, icon, pixelImg, carpetCanvas, paintCarpet, onBack, phoneText } from './dom.js';
import { confirmModal } from './modal.js';
import { carpetGallery, isHidden, reportContent } from './account.js';
import { alikeShare, sampleCells } from '../engine/carpet.js';
import { weekKey } from '../core/util.js';

const TABS = ['Loom', 'Orders', 'Gallery', 'Contest'];

export class LoomScreen {
  // container: the ranch screen; test: on a test ranch (no gallery and no contest).
  constructor({ app, ranch, container, test = false, onClose }) {
    this.app = app;
    this.ranch = ranch;
    this.onClose = onClose;
    const t = app.i18n.t;
    this.body = h('div', { class: 'loom-body' });
    this.tabs = (test ? TABS.slice(0, 2) : TABS).map((id) => h('button', { class: 'login-tab', dataset: { tab: id }, onclick: () => this.setTab(id) }, phoneText(t, `loomTab${id}`)));
    this.el = h(
      'section',
      { class: 'loom-screen' },
      h('header', { class: 'loom-head' }, h('b', {}, icon(app.sprites, 'loom'), ` ${t('ui.loomTitle')}`), h('button', { class: 'btn', onclick: () => this.close() }, t('ui.loomClose'))),
      h('div', { class: 'login-tabs loom-tabs' }, this.tabs),
      this.body,
    );
    container.append(this.el);
    this.setTab('Loom');
    this.unback = onBack(() => this.close()); // the phone's Back key closes it
  }

  get palette() {
    return this.ranch.carpetCfg.palette || {};
  }

  setTab(id) {
    this.tab = id;
    for (const b of this.tabs) b.classList.toggle('active', b.dataset.tab === id);
    this.key = null;
    if (id === 'Loom') this.buildLoom();
    else if (id === 'Orders') this.buildOrders();
    else if (id === 'Gallery') this.buildGallery();
    else this.buildContest();
  }

  // ---------------------------------------------------------------- the loom

  buildLoom() {
    const t = this.app.i18n.t;
    this.sampleBox = h('div', { class: 'loom-carpet' });
    this.carpetBox = h('div', { class: 'loom-carpet' });
    this.info = h('div', { class: 'loom-info' });
    this.body.replaceChildren(h('div', { class: 'loom-pair' }, h('div', { class: 'loom-col' }, h('h4', {}, t('ui.loomSample')), this.sampleBox), h('div', { class: 'loom-col' }, h('h4', {}, t('ui.loomCarpet')), this.carpetBox)), this.info);
    this.canvas = null;
    this.update();
  }

  update() {
    if (this.tab !== 'Loom') return;
    const { t, item } = this.app.i18n;
    const found = this.ranch.loom();
    const c = found && found.loom.carpet;
    const sample = c && c.sample && this.ranch.sample(c.sample);
    const inside = Object.entries((found && found.loom.inside) || {});
    const key = `${c ? c.cells : ''}|${JSON.stringify(inside)}|${this.ranch.carpets.length}`;
    if (key === this.key) return;
    const sampleId = c ? c.sample || '' : null;
    if (sampleId !== this.sampleId || !this.canvas) {
      this.sampleId = sampleId;
      this.sampleBox.replaceChildren(sample ? carpetCanvas(this.palette, sampleCells(sample), 18) : h('div', { class: 'board-note' }, t(c ? 'ui.loomFree' : 'ui.loomEmpty')));
      this.canvas = c ? carpetCanvas(this.palette, c.cells, 18) : null;
      this.carpetBox.replaceChildren(...(this.canvas ? [this.canvas] : []));
    }
    if (c) paintCarpet(this.canvas, this.palette, c.cells, 18);
    this.key = key;
    const lines = [];
    if (c) {
      lines.push(h('div', {}, h('b', {}, sample ? sample.name : t('ui.loomFree'))));
      lines.push(h('div', {}, t('ui.loomKnots', { n: c.knots, max: c.cells.length })));
      if (sample) lines.push(h('div', {}, t('ui.loomAlike', { n: Math.floor(alikeShare(c.cells, sample, this.palette) * 100) })));
    }
    lines.push(
      h(
        'div',
        { class: 'loom-yarn' },
        inside.length ? [h('span', {}, t('ui.loomYarn')), ...inside.map(([it, n]) => h('span', { class: 'chip', title: item(it) }, pixelImg(this.app.sprites.url(`item:${it}`, 2)), String(n)))] : h('span', { class: 'muted' }, t('ui.loomNoYarn')),
      ),
    );
    if (this.ranch.carpets.length) lines.push(h('div', { class: 'muted' }, t('ui.loomUnsold', { n: this.ranch.carpets.length })));
    this.info.replaceChildren(...lines);
  }

  // ---------------------------------------------------------------- today's orders

  buildOrders() {
    const t = this.app.i18n.t;
    const list = this.ranch.carpetOrders().list.map((q, i) => {
      const s = this.ranch.sample(q.sample);
      return h(
        'div',
        { class: `loom-card ${q.taken ? 'done' : ''}` },
        carpetCanvas(this.palette, sampleCells(s), 10),
        h('div', {}, t('ui.loomOrderLine', { i, name: s.name, level: s.level, pay: q.pay })),
        q.taken ? h('div', { class: 'muted' }, t('ui.loomOrderTaken')) : null,
      );
    });
    this.body.replaceChildren(h('p', { class: 'form-hint' }, t('ui.loomOrderHint')), h('div', { class: 'loom-grid' }, list));
  }

  // ---------------------------------------------------------------- my carpets

  // (A guest can't enter the contest: see buildContest.)
  buildGallery() {
    this.body.replaceChildren(
      carpetGallery(this.app, this.ranch, {
        onEnter: this.app.account.isGuest
          ? null
          : async (cells) => {
              await this.app.account.enterContest(this.week(), cells);
              this.app.toast(this.app.i18n.t('ui.contestEntered'));
              this.setTab('Contest');
            },
      }),
    );
  }

  // ---------------------------------------------------------------- the contest

  week() {
    return weekKey(this.ranch.today());
  }

  async buildContest() {
    const app = this.app;
    const t = app.i18n.t;
    const me = app.account.user && app.account.user.id;
    const guest = app.account.isGuest; // looks, but can't enter or like
    const box = h('div', { class: 'board-note' }, t('ui.loading'));
    this.body.replaceChildren(h('p', { class: 'form-hint' }, t(guest ? 'ui.guestOnly' : 'ui.contestHelp')), box);
    let entries;
    try {
      entries = await app.account.contest(this.week());
    } catch (e) {
      console.warn('The contest was not loaded:', e);
      box.textContent = t('ui.contestOffline');
      return;
    }
    if (this.tab !== 'Contest') return;
    const week = this.week();
    entries = entries.filter((e) => !isHidden(app, e.id, `${week}~${e.id}`)); // reported ones stay hidden for this player
    if (!entries.length) {
      box.textContent = t('ui.contestEmpty');
      return;
    }
    const act = (fn) => async () => {
      try {
        await fn();
      } catch (e) {
        console.warn('Contest:', e);
        app.toast(t('ui.contestOffline'), 'warn');
      }
      if (this.tab === 'Contest') this.buildContest();
    };
    box.replaceWith(
      h(
        'div',
        { class: 'loom-grid' },
        entries.map((e) =>
          h(
            'div',
            { class: 'loom-card' },
            carpetCanvas(this.palette, e.cells, 10),
            h('b', {}, e.name),
            h('div', {}, t('ui.contestLikes', { n: e.likes })),
            e.id === me
              ? h('div', { class: 'muted' }, t('ui.contestMine'))
              : guest
                ? null
                : h('button', { class: 'btn btn-sm', disabled: e.liked, onclick: act(() => app.account.likeCarpet(this.week(), e.id)) }, t(e.liked ? 'ui.contestLiked' : 'ui.contestLike')),
            e.id !== me && !guest && !app.account.isAdmin
              ? h(
                  'button',
                  {
                    class: 'link-quiet',
                    onclick: async () => {
                      if ((await reportContent(app, { kind: 'carpet', target: e.id, name: e.name, week, cells: e.cells })) && this.tab === 'Contest') this.buildContest();
                    },
                  },
                  t('ui.report'),
                )
              : null,
            app.account.isAdmin
              ? h(
                  'button',
                  {
                    class: 'btn btn-sm btn-danger',
                    onclick: act(async () => {
                      if (await confirmModal(app.i18n, { title: t('ui.contestRemove'), text: t('ui.contestRemoveAsk', { name: e.name }), okLabel: t('ui.contestRemove') })) await app.account.removeEntry(this.week(), e.id);
                    }),
                  },
                  t('ui.contestRemove'),
                )
              : null,
          ),
        ),
      ),
    );
  }

  close() {
    this.el.remove();
    this.unback();
    this.onClose();
  }
}
