// The ranch screen (js/engine/ranch.js): the map, a code tab for every area (each with its own ▶/■;
// the big ▶ runs them all), the ranch storage and what the selected area's drone holds, the shop and
// the market board with the fair, the loom's window. The farm waits while it is open (GameScreen.openRanch);
// the main game's autosave keeps saving the ranch with it. The ranch's weekly challenge shows a test ranch
// on this screen too (`challenge`: js/ui/ranchChallenge.js), with only what a try needs.
import { h, icon, pixelImg, mobileQuery, sizeFarm, CALENDAR_ICONS } from './dom.js';
import { RanchView } from './ranchView.js';
import { LoomScreen } from './loom.js';
import { EditorPanel } from './editor.js';
import { Controls, InventoryPanel, QuestBar } from './panels.js';
import { describeError, describeWarning } from './errorText.js';
import { openModal, confirmModal } from './modal.js';
import { formatCount, formatClock } from '../core/util.js';

export class RanchScreen {
  // main: the main Game (main.ranch is shown); bridgy: the game's Bridgy; first(key): true the first
  // time (GameScreen's «firsts»); onDirty: the scripts changed; onClose: back to the farm.
  constructor({ app, main, bridgy, first, onDirty, onClose, challenge = null }) {
    this.app = app;
    this.challenge = challenge;
    this.main = main;
    this.ranch = main.ranch;
    this.bridgy = bridgy;
    this.onClose = onClose;
    this.lastError = null;
    this.talk = []; // Bridgy's pages waiting for the shop to close
    const t = app.i18n.t;
    const ranch = this.ranch;
    this.stage = h('div', { class: 'farm-stage' });
    this.codePanel = h('section', { class: 'panel code-panel' });
    this.inventoryList = h('ul', { class: 'inventory-list' });
    this.handsEl = h('div', { class: 'ranch-hands' });
    this.controlbar = h('footer', { class: 'controlbar' });
    this.questSlot = h('div', { class: 'quest-slot', style: { flex: '1', minWidth: '0', display: 'flex' } });
    this.dramChip = h('span', { class: 'chip ranch-dram', title: app.i18n.item('Dram') });
    this.zoomBtn = h('button', { class: 'btn btn-sm ranch-zoom', onclick: () => this.toggleZoom() });
    this.tabButtons = [
      ['farm', icon(app.sprites, 'ranch'), t('ui.ranchMap')],
      ['code', '</>', t('ui.codeTab')],
      ['storage', icon(app.sprites, 'storage'), t('ui.inventory')],
    ].map(([id, ico, label]) => h('button', { class: 'btn mobile-tab', dataset: { tab: id }, onclick: () => this.setTab(id) }, h('span', { class: 'ico' }, ico), label));
    this.calendarChip = h('span', { class: 'chip calendar-chip' });
    this.boostChip = h('span', { class: 'chip boost-chip', hidden: true });
    this.loomBtn = h('button', { class: 'btn ranch-loom-button', hidden: true, title: t('ui.ranchLoom'), onclick: () => this.openLoom() }, icon(app.sprites, 'loom'), h('span', { class: 'btn-label' }, t('ui.ranchLoom')));
    this.timeChip = h('span', { class: 'chip challenge-chip', title: t('ui.challengeTime') });
    this.bestChip = h('span', { class: 'chip challenge-chip', title: t('ui.challengeBestTitle') });
    const avatar = app.config.bridgy.avatar || 'assets/bridgy/bridgy-head.png';
    // The way to the shop, the market, the loom and back to the farm: at the bottom right, like on the farm.
    const nav = challenge
      ? null
      : h(
          'nav',
          { class: 'side-nav' },
          h('button', { class: 'btn btn-gold ranch-shop-button', title: t('ui.ranchShop'), onclick: () => this.openShop() }, icon(app.sprites, 'cart'), h('span', { class: 'btn-label' }, t('ui.ranchShop'))),
          h('button', { class: 'btn ranch-market-button', title: t('ui.ranchMarket'), onclick: () => this.openMarket() }, icon(app.sprites, 'board'), h('span', { class: 'btn-label' }, t('ui.ranchMarket'))),
          this.loomBtn,
          h('button', { class: 'btn ranch-back-button', title: t('ui.ranchBack'), onclick: () => this.close() }, icon(app.sprites, 'farm'), h('span', { class: 'btn-label' }, t('ui.ranchBack'))),
        );
    const topbar = challenge
      ? [h('div', { class: 'challenge-task' }, h('b', {}, icon(app.sprites, 'cap'), ` ${challenge.task.name}`), h('span', {}, challenge.task.about)), this.loomBtn, this.bestChip, this.timeChip, h('button', { class: 'btn', title: t('ui.challengeBack'), onclick: () => this.close() }, '⬅', h('span', { class: 'btn-label' }, t('ui.challengeBack')))]
      : [
          h('div', { class: 'logo' }, h('span', { class: 'ranch-logo' }, icon(app.sprites, 'ranch')), h('span', {}, t('ui.ranchTitle'))),
          this.questSlot,
          h('button', { class: 'btn help-button', onclick: () => this.bridgy.helpMenu(), title: t('ui.helpButton') }, h('img', { src: avatar, alt: '' }), h('span', { class: 'btn-label' }, t('ui.helpButton'))),
          this.calendarChip,
          this.boostChip,
          this.dramChip,
        ];
    this.el = h(
      'section',
      { class: 'screen screen-game screen-ranch' },
      h('header', { class: 'topbar' }, topbar),
      h(
        'main',
        { class: 'game-main' },
        h('section', { class: 'panel farm-panel' }, h('div', { class: 'panel-head' }, icon(app.sprites, 'ranch'), ' ', t('ui.ranchMap'), h('span', { class: 'spacer' }), this.zoomBtn), this.stage),
        this.codePanel,
        (this.sidePanel = h(
          'aside',
          { class: 'side-panel' },
          h('section', { class: 'panel grow' }, h('div', { class: 'panel-head' }, icon(app.sprites, 'storage'), ' ', t('ui.ranchStorage')), this.inventoryList),
          h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, t('ui.ranchHands')), this.handsEl),
          nav,
        )),
      ),
      this.controlbar,
      h('nav', { class: 'mobile-tabs' }, this.tabButtons),
    );
    app.root.append(this.el);
    this.setTab('farm');
    this.view = new RanchView({ game: ranch, sprites: app.sprites, i18n: app.i18n, stage: this.stage, prefs: app.prefs });
    if (mobileQuery.matches) this.view.focus = (ranch.penOfScript(ranch.activeScript) || ranch.pens.values().next().value).id; // phones start on one area
    this.editor = new EditorPanel({
      app,
      game: ranch,
      container: this.codePanel,
      onChange: onDirty,
      onRun: () => this.runTab(),
      tabs: {
        fixed: (name) => !!ranch.penOfScript(name),
        running: (name) => {
          const pen = ranch.penOfScript(name);
          return !!pen && pen.runner.isActive();
        },
        title: (name) => {
          const pen = ranch.penOfScript(name);
          return pen ? pen.cfg.name : t('ui.ranchHelperFile');
        },
        extra: (name) => this.tabButton(name),
      },
    });
    this.controls = new Controls({
      app,
      game: ranch,
      container: this.controlbar,
      onRun: () => (challenge && ranch.state() !== 'paused' ? challenge.run() : this.runAll()),
      onStop: () => ranch.stopAll(),
      onPause: () => this.togglePause(),
      onStep: () => this.step(),
      onSpeed: (s) => {
        ranch.speed = s;
        app.audio.play('click');
      },
    });
    this.inventory = new InventoryPanel({ app, game: ranch, list: this.inventoryList });
    if (!challenge) {
      this.questBar = new QuestBar({
        app,
        game: ranch,
        quests: ranch.quests,
        container: this.questSlot,
        onHint: () => this.bridgy.helpHint(true),
        onOpen: () => {
          const q = ranch.quests.current();
          if (q) this.bridgy.say([{ emotion: 'happy', text: `${q.title}. ${q.text}` }], { key: 'menu', replaceSame: true, interrupt: true });
        },
      });
    }
    this.wire();
    this.updateSide();
    this.onResize = () => this.layout();
    window.addEventListener('resize', this.onResize);
    this.layout();
    this.last = performance.now();
    this.slowTimer = 0;
    this.raf = requestAnimationFrame((now) => this.tick(now));
    if (first('ranchIntro')) setTimeout(() => this.bridgy.say((ranch.cfg.story || {}).intro || [], { key: 'ranchIntro', interrupt: true }), 300);
  }

  layout() {
    sizeFarm(this.el, this.sidePanel);
    this.editor.refresh();
    if (!mobileQuery.matches && this.view.focus) this.view.focus = null;
    this.zoomBtn.hidden = !mobileQuery.matches;
    this.zoomBtn.textContent = this.app.i18n.t(this.view.focus ? 'ui.ranchZoomAll' : 'ui.ranchZoomPen');
  }

  setTab(tab) {
    this.tab = tab;
    this.el.dataset.tab = tab;
    for (const b of this.tabButtons) b.classList.toggle('active', b.dataset.tab === tab);
    if (tab === 'code' && this.editor) setTimeout(() => this.editor.refresh(), 0);
  }

  // Phones: the map shows the selected area, or the whole ranch.
  toggleZoom() {
    const pen = this.activePen() || this.ranch.pens.values().next().value;
    this.view.focus = this.view.focus ? null : pen.id;
    this.layout();
  }

  activePen() {
    return this.ranch.penOfScript(this.ranch.activeScript);
  }

  // The small ▶ / ■ on an area's code tab.
  tabButton(name) {
    const pen = this.ranch.penOfScript(name);
    if (!pen || this.challenge) return null; // (a challenge's try starts all areas)
    const t = this.app.i18n.t;
    const active = pen.runner.isActive();
    return h(
      'button',
      {
        class: `tab-run ${active ? 'stop' : ''}`,
        title: t(active ? 'ui.ranchStopArea' : 'ui.ranchRunArea'),
        onclick: (e) => {
          e.stopPropagation();
          this.runArea(pen);
        },
      },
      active ? '■' : '▶',
    );
  }

  // ---------------------------------------------------------------- running

  runArea(pen) {
    const ranch = this.ranch;
    if (pen.runner.isActive()) return ranch.stop(pen.id);
    if (ranch.state() === 'paused') ranch.resumeAll();
    this.editor.clearRunError();
    ranch.start(pen.id);
    if (mobileQuery.matches) this.setTab('farm');
  }

  // Ctrl+Enter: the open tab's area (all areas from a helper file).
  runTab() {
    const pen = this.activePen();
    if (this.challenge) this.challenge.run();
    else if (pen) this.runArea(pen);
    else this.runAll();
  }

  runAll() {
    const ranch = this.ranch;
    if (ranch.state() === 'paused') return ranch.resumeAll();
    this.editor.clearRunError();
    ranch.startAll();
    if (mobileQuery.matches) this.setTab('farm');
  }

  togglePause() {
    const ranch = this.ranch;
    if (ranch.state() === 'running') ranch.pauseAll();
    else if (ranch.state() === 'paused') ranch.resumeAll();
  }

  // Step: only the open tab's area moves (the others wait).
  step() {
    const pen = this.activePen();
    if (!pen) return;
    if (this.ranch.state() === 'running') this.ranch.pauseAll();
    pen.runner.step();
  }

  wire() {
    const app = this.app;
    const t = app.i18n.t;
    const ranch = this.ranch;
    const con = this.editor.console;
    const ev = ranch.events;
    const name = (script) => {
      const pen = ranch.penOfScript(script);
      return pen ? pen.cfg.name : script;
    };
    const where = (penId) => (penId && ranch.cfg.areas[penId] ? `${ranch.cfg.areas[penId].name}: ` : '');
    this.offs = [
      ev.on('runStart', (e) => {
        this.lastError = null;
        con.log(t('ui.ranchRunStarted', { name: name(e.script) }), 'info');
        app.audio.play('run');
        this.editor.renderTabs();
      }),
      ev.on('runListen', (e) => con.log(t('ui.ranchRunListening', { name: name(e.script) }), 'info')),
      ev.on('runEnd', (e) => {
        con.log(t(e.reason === 'done' ? 'ui.ranchRunFinished' : 'ui.ranchRunStopped', { name: name(e.script) }), e.reason === 'done' ? 'ok' : 'info');
        if (e.code > 0) con.log(t('ui.codeWordsEarned', { n: e.code, total: ranch.stats.codeWords }), 'ok');
        this.editor.renderTabs();
      }),
      ev.on('runError', (e) => {
        const err = (this.lastError = e.error);
        this.editor.showRunError(err);
        const d = describeError(err, app.i18n, ranch);
        const where = err.loc ? t('ui.runErrorLine', { file: err.module || e.script, line: err.loc.line }) : t('ui.runErrorNoLine');
        con.log(`${where}: ${d.message}${d.suggestion ? `  (${d.suggestion})` : ''}`, 'error', { loc: err.loc, module: err.module });
        app.audio.play('error');
        this.editor.renderTabs();
      }),
      ev.on('print', (e) => con.log(`${where(e.pen)}${e.text}`, 'print')),
      ev.on('warning', (w) => con.log(`${where(w.pen)}${w.loc ? `${t('ui.warningLine', { line: w.loc.line })}: ` : '⚠ '}${describeWarning(w, app.i18n, ranch)}`, 'warn', { loc: w.loc, module: w.module })),
      ev.on('pickup', () => app.audio.play('harvest')),
      ev.on('sold', () => app.audio.play('unlock')),
      ev.on('order', () => app.audio.play('quest')),
      ev.on('questProgress', () => this.questBar && this.questBar.render()),
      ev.on('questComplete', (e) => {
        if (!this.questBar) return;
        this.questBar.render();
        this.questBar.flash();
        app.audio.play('quest');
        this.bridgy.toast(e.quest.done || e.quest.title, 4500);
      }),
      ev.on('shop', (e) => this.onBought(e)),
      ev.on('bell', () => app.audio.play('quest')),
      ev.on('carpet', (e) => this.onCarpet(e)),
      ev.on('fair', () => this.onFair()),
      ev.on('restart', () => this.onRestart()),
      ev.on('rescue', (e) => {
        app.audio.play('quest');
        this.bridgy.toast(t('ui.ranchRescue', { name: e.who.name, n: e.amount, item: app.i18n.item(e.item).toLowerCase() }), 9000);
      }),
    ];
  }

  // A shop item was bought: its area gets a code tab; its story or lesson waits for the shop to close.
  onBought({ id, item }) {
    const cfg = this.ranch.cfg;
    const stories = (cfg.story || {}).areas || {};
    this.editor.addDocs();
    if (item.kind === 'area' && stories[id]) this.talk.push([stories[id], `ranchStory:${id}`]);
    if ((cfg.lessons || {})[id]) this.talk.push([cfg.lessons[id], `ranchLesson:${id}`]);
    // the last place bought: the village invites the ranch to the fair
    const fair = this.ranch.shopItem('Fair');
    if (fair && item.kind === 'area' && !this.ranch.missingNeed(fair) && (cfg.story || {}).fairOpen) this.talk.push([cfg.story.fairOpen, 'ranchFairOpen']);
    this.updateSide();
  }

  // A carpet is finished: its result, and Bridgy after the very first one.
  onCarpet(e) {
    const t = this.app.i18n.t;
    this.app.audio.play('quest');
    this.app.toast(e.alike === null ? t('ui.ranchCarpetFree', { pay: e.price }) : t('ui.ranchCarpetDone', { n: Math.round(e.alike * 100), pay: e.price }));
    const story = (this.ranch.cfg.story || {}).firstCarpet;
    if (!this.challenge && story && this.ranch.counts.carpets === 1) this.bridgy.say(story, { key: 'ranchFirstCarpet', interrupt: true });
  }

  // The ranch won its prize at the fair.
  onFair() {
    const app = this.app;
    if (app.prefs.animations !== false && !app.prefs.lowGraphics) app.confetti.burst(window.innerWidth / 2, window.innerHeight / 3, 140);
    app.audio.play('quest');
    if (!this.challenge) this.bridgy.say((this.ranch.cfg.story || {}).fair || [], { key: 'ranchFair', interrupt: true });
  }

  // New Game Plus: the same screen on an empty ranch.
  onRestart() {
    this.view.focus = null;
    this.view.layoutKey = '';
    this.editor.switchTo(this.ranch.activeScript, true);
    this.editor.renderTabs();
    this.updateSide();
    this.layout();
  }

  tick(now) {
    if (this.closed) return;
    const dt = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    const ranch = this.ranch;
    ranch.update(dt);
    const pen = this.activePen();
    this.view.selected = pen ? pen.id : null;
    if (this.view.focus && pen && this.view.focus !== pen.id) {
      this.view.focus = pen.id;
      this.view.layoutKey = '';
    }
    if (this.tab === 'farm' || !mobileQuery.matches) this.view.render(now);
    this.controls.update(!!this.lastError);
    if (this.challenge) this.challenge.tick();
    if (this.closed) return;
    const node = pen && pen.runner.isActive() && pen.drone.interp && pen.drone.interp.currentNode;
    if (node && node.loc) this.editor.setExecLine(node._mod, node.loc.start.line);
    else this.editor.setExecLine(null, null);
    const readOnly = !!pen && pen.runner.isActive();
    if (readOnly !== this.editor.running) this.editor.setRunning(readOnly);
    this.slowTimer += dt;
    if (this.slowTimer > 0.2) {
      this.slowTimer = 0;
      this.inventory.update();
      this.updateSide();
      if (this.loom) this.loom.update();
    }
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  // ֏ in the top bar and what the open tab's drone holds.
  updateSide() {
    const app = this.app;
    const ranch = this.ranch;
    const cal = this.main.calendar.state;
    const key0 = cal ? `${cal.season}:${cal.weather}` : '';
    if (key0 !== this.calendarKey) {
      this.calendarKey = key0;
      this.calendarChip.hidden = !cal;
      if (cal) this.calendarChip.replaceChildren(icon(app.sprites, CALENDAR_ICONS[cal.season]), icon(app.sprites, CALENDAR_ICONS[cal.weather]));
      if (cal) this.calendarChip.title = `${app.i18n.t(`seasons.${cal.season}`)} · ${app.i18n.t(`weathers.${cal.weather}`)}`;
    }
    this.dramChip.replaceChildren(pixelImg(app.sprites.url('item:Dram', 2)), formatCount(Math.floor(ranch.inventory.get('Dram'))));
    this.loomBtn.hidden = !ranch.loom();
    const boost = ranch.boosts.speed && ranch.boosts.speed.until > ranch.time ? ranch.boosts.speed : null;
    this.boostChip.hidden = !boost;
    if (boost) this.boostChip.replaceChildren(pixelImg(app.sprites.url(`item:${boost.item}`, 2)), formatClock(boost.until - ranch.time));
    const pen = this.activePen();
    const hands = pen ? Object.entries(pen.drone.hands) : [];
    const key = `${pen && pen.id}:${JSON.stringify(hands)}:${ranch.handsCapacity()}`;
    if (key === this.handsKey) return;
    this.handsKey = key;
    const held = hands.reduce((a, [, n]) => a + n, 0);
    this.handsEl.replaceChildren(
      h('div', { class: 'ranch-hands-head' }, pen ? pen.cfg.name : '—', h('span', { class: 'muted' }, ` ${held} / ${ranch.handsCapacity()}`)),
      hands.length
        ? h('div', { class: 'ranch-hands-items' }, hands.map(([item, n]) => h('span', { class: 'chip', title: app.i18n.item(item) }, pixelImg(app.sprites.url(`item:${item}`, 2)), String(n))))
        : h('div', { class: 'muted' }, app.i18n.t('ui.ranchHandsEmpty')),
    );
  }

  // ---------------------------------------------------------------- the loom, the shop and the market

  openLoom() {
    if (this.loom) return;
    this.loom = new LoomScreen({ app: this.app, ranch: this.ranch, container: this.el, test: !!this.challenge, onClose: () => (this.loom = null) });
  }

  openShop() {
    const app = this.app;
    const t = app.i18n.t;
    const ranch = this.ranch;
    const body = h('div', { class: 'ranch-shop' });
    const render = () => {
      const groups = { places: [], upgrades: [], commands: [], farm: [] };
      const group = { upgrade: 'upgrades', command: 'commands', boost: 'farm' };
      for (const item of ranch.shop) groups[group[item.kind] || 'places'].push(this.shopCard(item, render));
      body.replaceChildren(
        h('div', { class: 'ranch-shop-have' }, pixelImg(app.sprites.url('item:Dram', 2)), t('ui.ranchShopHave', { n: formatCount(Math.floor(ranch.inventory.get('Dram'))) })),
        ...Object.entries(groups)
          .filter(([, cards]) => cards.length)
          .flatMap(([g, cards]) => [h('h4', { class: 'ranch-shop-group' }, t(`ui.ranchShopGroups.${g}`)), h('div', { class: 'ranch-shop-list' }, cards)]),
      );
    };
    render();
    openModal({
      title: t('ui.ranchShopTitle'),
      className: 'ranch-shop-modal',
      body,
      onClose: () => {
        for (const [pages, key] of this.talk.splice(0)) this.bridgy.say(pages, { key, interrupt: true });
      },
    });
  }

  shopCard(item, rerender) {
    const app = this.app;
    const t = app.i18n.t;
    const ranch = this.ranch;
    const state = ranch.shopState(item.id);
    const notes = [];
    if (item.costs && state !== 'soon') notes.push(t('ui.ranchShopLevel', { n: ranch.level(item.id), max: ranch.maxLevel(item) }));
    if ((item.kind === 'trough' || item.kind === 'machine') && ranch.tokens[item.id]) notes.push(t('ui.ranchShopTokens', { n: ranch.tokens[item.id] }));
    const pen = item.kind === 'animal' && ranch.penOf(item.animal);
    if (pen) notes.push(`${pen.animals.length} / ${pen.capacity()}`);
    let action;
    if (state === 'affordable' || state === 'expensive') {
      action = h(
        'button',
        {
          class: 'btn btn-run btn-sm',
          disabled: state !== 'affordable',
          onclick: () => {
            if (!ranch.buy(item.id).ok) return;
            app.audio.play('unlock');
            rerender();
          },
        },
        t('ui.ranchShopBuy', { n: formatCount(ranch.nextCost(item.id)) }),
      );
    } else {
      const text = {
        owned: t('ui.ranchShopOwned'),
        soon: [icon(app.sprites, 'soon'), ` ${t('ui.ranchShopSoon')}`],
        full: t('ui.ranchShopFull'),
        locked: [icon(app.sprites, 'lock'), ` ${t('ui.ranchShopNeeds', { name: ranch.missingNeed(item) ? ranch.shopName(ranch.shopItem(ranch.missingNeed(item))) : '' })}`],
      }[state];
      action = h('span', { class: 'ranch-shop-state' }, text);
    }
    return h(
      'div',
      { class: `ranch-shop-card ${state}` },
      h('span', { class: 'ranch-shop-icon' }, item.icon ? pixelImg(app.sprites.url(`icon:${item.icon}`, 3)) : null),
      h('div', { class: 'ranch-shop-text' }, h('b', {}, ranch.shopName(item)), h('span', {}, item.about || ''), notes.length ? h('span', { class: 'muted' }, notes.join(' · ')) : null),
      action,
    );
  }

  openMarket() {
    const app = this.app;
    const { t, item: itemName, fill } = app.i18n;
    const ranch = this.ranch;
    const prices = Object.entries(ranch.cfg.items)
      .filter(([, c]) => c.sell || c.buy)
      .map(([item, c]) =>
        h('div', { class: 'ranch-price' }, pixelImg(app.sprites.url(`item:${item}`, 2)), h('span', {}, itemName(item)), h('b', {}, `${ranch.price(item)} ֏`), h('span', { class: 'muted' }, t(c.sell ? 'ui.ranchPriceSell' : 'ui.ranchPriceBuy'))),
      );
    const board = ranch.orders();
    const lines = ranch.cfg.orders.lines || [];
    const orders = board.list.map((q, i) => {
      const v = ranch.villager(q.who);
      const goods = Object.entries(q.items).map(([item, n]) => `${n} ${itemName(item)}`);
      if (q.animal) goods.push(t('ui.ranchOrderAnimal', { color: t(`ui.colors.${q.animal.color}`), animal: app.i18n.entity(q.animal.type).toLowerCase() }));
      const list = goods.join(', ');
      return h(
        'div',
        { class: `ranch-order ${q.done ? 'done' : ''}` },
        h('img', { class: 'village-face pixel', src: v.portrait || app.sprites.url(`face:${v.face}`, 3), alt: '' }),
        h('div', { class: 'ranch-order-text' }, h('b', {}, `${i}. ${v.name}`), h('span', {}, fill(lines[q.line] || '{list}', { list, pay: q.pay }))),
        h('span', { class: 'ranch-order-pay' }, q.done ? t('ui.ranchOrderDone') : `${q.pay} ֏`),
      );
    });
    const market = openModal({
      title: t('ui.ranchMarketTitle'),
      className: 'ranch-market-modal',
      body: [
        h('h4', {}, t('ui.ranchPrices')),
        h('div', { class: 'ranch-prices' }, prices),
        h('h4', {}, t('ui.ranchOrders')),
        ranch.hasFunction('orders') ? null : h('div', { class: 'board-note' }, t('ui.ranchOrdersLocked', { name: ranch.api.displayName('orders') })),
        orders.length ? h('div', { class: 'ranch-orders' }, orders) : h('div', { class: 'board-note' }, t('ui.ranchNoOrders')),
        this.fairPart(() => market.close()),
      ],
    });
  }

  // The fair in the market's window: what it asks for, and New Game Plus after it.
  fairPart(close) {
    const app = this.app;
    const { t, costText } = app.i18n;
    const ranch = this.ranch;
    const fair = ranch.cfg.fair;
    if (!fair || ranch.level('Cows') === 0) return null;
    let text;
    if (ranch.fairDone) text = t('ui.fairDone');
    else if (ranch.level('Fair')) text = t('ui.fairHelp', { list: costText(fair.goods), n: Math.round(fair.carpet * 100) });
    else text = t('ui.fairClosed');
    const name = t('ui.ranchPlusBadge', { n: ranch.plus + 1 });
    return h(
      'div',
      { class: 'ranch-fair' },
      h('h4', {}, icon(app.sprites, 'party'), ` ${t('ui.fairTitle')}`),
      h('p', {}, text),
      ranch.fairDone
        ? h(
            'button',
            {
              class: 'btn btn-danger',
              onclick: async () => {
                if (!(await confirmModal(app.i18n, { title: t('ui.plusButton', { name }), text: t('ui.plusAsk'), okLabel: t('ui.plusButton', { name }) }))) return;
                close();
                ranch.restart();
              },
            },
            t('ui.plusButton', { name }),
          )
        : null,
    );
  }

  // ---------------------------------------------------------------- closing

  close() {
    this.destroy();
    this.onClose();
  }

  // (Running areas are not stopped: they wait with the ranch and go on when it is opened again.)
  destroy() {
    if (this.closed) return;
    this.closed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.offs.forEach((off) => off());
    this.editor.destroy();
    this.view.destroy();
    this.el.remove();
  }
}
