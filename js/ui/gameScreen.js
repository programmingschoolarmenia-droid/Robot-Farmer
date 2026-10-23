// The main game screen: wires the engine to the farm view, editor, Bridgy and panels.
import { h, pixelImg, mobileQuery } from './dom.js';
import { Game, SAVE_VERSION } from '../engine/game.js';
import { QuestTracker } from '../engine/quests.js';
import { FarmView } from './farmView.js';
import { EditorPanel } from './editor.js';
import { Controls, InventoryPanel, QuestBar } from './panels.js';
import { ResearchTree } from './researchTree.js';
import { DebugPanel } from './debugPanel.js';
import { Bridgy } from './bridgy.js';
import { openSettings } from './settingsModal.js';
import { describeError, describeWarning } from './errorText.js';
import { openProfile, accountErrorText } from './account.js';
import { openBook } from './book.js';
import { formatClock } from '../core/util.js';

// Warnings Bridgy explains in a dialog the first time they happen.
const TEACH_WARNINGS = new Set(['plant_wrongGround', 'plant_cost', 'plant_entityLocked', 'hatLocked', 'indexOutOfRange', 'notEnoughItem']);

export class GameScreen {
  // save: the player's saved farm (null for a new one); onExit: after logging out.
  constructor(app, save, onExit) {
    this.app = app;
    this.onExit = onExit;
    const saved = save || {};
    const display = app.config.settings.display || {};
    this.ui = { introDone: false, lessonsSeen: [], taught: [], firsts: [], ...(saved.ui || {}) };
    this.prefs = {
      animations: display.animations !== false,
      lowGraphics: !!display.lowGraphics,
      fontSize: 'normal',
      sfxVolume: display.sfxVolume ?? 0.5,
      musicVolume: display.musicVolume ?? 0,
      blips: display.blips !== false,
      showGrid: display.showGrid !== false,
      ...(saved.ui && saved.ui.prefs),
    };
    app.prefs = this.prefs;
    this.game = new Game(app.config, saved.game || {});
    this.quests = new QuestTracker(this.game, saved.quests || {});
    this.lastError = null;
    this.destroyed = false;
    this.offs = [];
    this.build();
    this.applyPrefs();
    this.wire();
    this.last = performance.now();
    this.slowTimer = 0;
    this.frame = 0;
    this.raf = requestAnimationFrame((t) => this.tick(t));
    const autosave = ((app.config.settings.game && app.config.settings.game.autosaveSeconds) || 10) * 1000;
    this.lastPush = 0;
    this.saveTimer = setInterval(() => {
      this.save();
      this.syncCloud();
    }, autosave);
    this.onVisibility = () => {
      if (document.hidden) this.leaveSave();
      else if (this.cloudDirty) this.syncCloud({ now: true }); // back in the app: send what didn't go out
    };
    document.addEventListener('visibilitychange', this.onVisibility);
    this.onUnload = () => this.leaveSave();
    window.addEventListener('beforeunload', this.onUnload);
    this.onResize = () => this.layoutSizes();
    window.addEventListener('resize', this.onResize);
    this.onKey = (e) => this.handleKey(e);
    document.addEventListener('keydown', this.onKey);
    this.layoutSizes();
    setTimeout(() => this.startStory(), 400);
    this.save();
    this.syncCloud({ now: true }); // new players appear on the leaderboard right away
  }

  // ------------------------------------------------------------------ DOM

  build() {
    const app = this.app;
    const t = app.i18n.t;
    const game = this.game;

    this.questSlot = h('div', { style: { flex: '1', minWidth: '0', display: 'flex' } });
    this.researchBadge = h('span', { class: 'badge', hidden: true });
    this.researchBtn = h(
      'button',
      { class: 'btn btn-gold research-button', onclick: () => this.openResearch() },
      pixelImg(app.sprites.url('icon:debugger', 2)),
      t('ui.researchButton'),
      this.researchBadge,
    );
    // Phone tabs (hidden on wide screens by CSS); the storage tab repeats the research badge.
    this.tabBadge = h('span', { class: 'badge', hidden: true });
    this.tabButtons = [
      ['farm', '🌾', t('ui.farm')],
      ['code', '</>', t('ui.codeTab')],
      ['storage', '🧺', t('ui.inventory')],
    ].map(([id, icon, label]) =>
      h('button', { class: 'btn mobile-tab', dataset: { tab: id }, onclick: () => this.setTab(id) }, h('span', { class: 'ico' }, icon), label, id === 'storage' ? this.tabBadge : null),
    );
    this.farmSizeLabel = h('span', { class: 'muted' });
    this.farmStage = h('div', { class: 'farm-stage' });
    this.codePanel = h('section', { class: 'panel code-panel' });
    this.inventoryList = h('ul', { class: 'inventory-list' });
    this.controlbar = h('footer', { class: 'controlbar' });

    this.el = h(
      'section',
      { class: 'screen screen-game' },
      h(
        'header',
        { class: 'topbar' },
        h('div', { class: 'logo' }, pixelImg(app.config.bridgy.avatar || 'assets/bridgy/bridgy-head.png'), h('span', {}, t('ui.title'))),
        this.questSlot,
        h(
          'button',
          { class: 'btn help-button', onclick: () => this.bridgy.helpMenu(), title: t('ui.helpButton') },
          pixelImg(app.config.bridgy.avatar || 'assets/bridgy/bridgy-head.png'),
          h('span', { class: 'btn-label' }, t('ui.helpButton')),
        ),
        h('button', { class: 'btn btn-icon', title: t('ui.settingsButton'), onclick: () => this.openSettings() }, '⚙'),
        h('button', { class: 'btn player-pill', title: t('ui.profileTitle'), onclick: () => this.openProfile() }, '👤', h('span', { class: 'btn-label' }, app.account.user.name)),
      ),
      h(
        'main',
        { class: 'game-main' },
        h('section', { class: 'panel farm-panel' }, h('div', { class: 'panel-head' }, '🌾 ', t('ui.farm'), h('span', { class: 'spacer' }), this.farmSizeLabel), this.farmStage),
        this.codePanel,
        (this.sidePanel = h(
          'aside',
          { class: 'side-panel' },
          h('section', { class: 'panel grow' }, h('div', { class: 'panel-head' }, '🧺 ', t('ui.inventory')), this.inventoryList),
          this.researchBtn,
        )),
      ),
      this.controlbar,
      h('nav', { class: 'mobile-tabs' }, this.tabButtons),
    );
    app.root.append(this.el);
    this.setTab('farm');

    this.farm = new FarmView({ game, sprites: app.sprites, i18n: app.i18n, stage: this.farmStage, prefs: this.prefs });
    this.editor = new EditorPanel({
      app,
      game,
      container: this.codePanel,
      onChange: () => this.markDirty(),
      onRun: () => this.run(),
    });
    this.controls = new Controls({
      app,
      game,
      container: this.controlbar,
      onRun: () => this.run(),
      onStop: () => this.stop(),
      onPause: () => this.togglePause(),
      onStep: () => this.step(),
      onSpeed: (s) => {
        game.speed = s;
        this.app.audio.play('click');
      },
    });
    this.inventory = new InventoryPanel({ app, game, list: this.inventoryList });
    this.debugPanel = new DebugPanel({ app, game, container: this.sidePanel });
    this.sidePanel.insertBefore(this.debugPanel.el, this.researchBtn);
    this.questBar = new QuestBar({
      app,
      game,
      quests: this.quests,
      container: this.questSlot,
      onHint: () => this.bridgy.helpHint(true),
      onOpen: () => {
        const q = this.quests.current();
        if (q) this.bridgy.say([{ emotion: 'happy', text: `${q.title}. ${q.text}` }], { key: 'menu', replaceSame: true, interrupt: true });
      },
    });
    this.research = new ResearchTree({ app, game, onBuy: (id, card) => this.onResearchBought(id, card) });
    this.bridgy = new Bridgy({
      app,
      codeKind: (w) => game.api.codeKind(w),
      onShowLine: (err) => {
        this.setTab('code');
        this.editor.jumpTo(err.module, err.loc.line);
      },
      getHelpContext: () => ({
        quests: this.quests,
        api: game.api,
        research: game.research,
        lastError: this.lastError,
        explainLastError: () => this.explainError(this.lastError),
        openBook: (tab) => openBook({ app, game, tab }),
      }),
    });
    this.updateFarmLabel();
  }

  // Wide screens: the farm panel is a square as tall as the main area (leaving room for the
  // editor and the side panel). Phones show one panel at a time (setTab).
  layoutSizes() {
    if (!mobileQuery.matches) {
      const H = window.innerHeight - 62 - 66 - 40;
      const W = window.innerWidth - 48 - (this.sidePanel.offsetWidth || 272) - 340;
      this.el.style.setProperty('--farm-size', `${Math.floor(Math.max(300, Math.min(H, W, 900)))}px`);
    }
    if (this.editor) this.editor.refresh();
  }

  setTab(tab) {
    this.tab = tab;
    this.el.dataset.tab = tab;
    for (const b of this.tabButtons) b.classList.toggle('active', b.dataset.tab === tab);
    if (tab === 'code' && this.editor) setTimeout(() => this.editor.refresh(), 0);
  }

  updateFarmLabel() {
    const w = this.game.world;
    this.farmSizeLabel.textContent = `${w.width}×${w.height}`;
  }

  // ------------------------------------------------------------------ events

  wire() {
    const ev = this.game.events;
    const app = this.app;
    const t = app.i18n.t;
    const con = this.editor.console;
    const on = (name, fn) => this.offs.push(ev.on(name, fn));

    on('runStart', (e) => {
      this.editor.setRunning(true);
      this.editor.clearRunError();
      this.lastError = null;
      this.idle = { actions: this.game.mainDrone.actions, since: this.game.time, warned: false };
      con.log(t('ui.runStarted', { name: e.script }), 'info');
      app.audio.play('run');
    });
    on('runEnd', (e) => {
      this.editor.setRunning(false);
      con.log(e.reason === 'done' ? t('ui.runFinished') : t('ui.runStopped'), e.reason === 'done' ? 'ok' : 'info');
      if (e.reason !== 'done' && e.reason !== 'restart') app.audio.play('stop');
      this.save();
    });
    on('runError', (e) => {
      this.editor.setRunning(false);
      const err = e.error;
      this.lastError = err;
      this.editor.showRunError(err);
      const d = describeError(err, app.i18n, this.game);
      const where = err.loc ? t('ui.runErrorLine', { file: err.module || this.game.activeScript, line: err.loc.line }) : t('ui.runErrorNoLine');
      con.log(`${where}: ${d.message}${d.suggestion ? `  (${d.suggestion})` : ''}`, 'error', { loc: err.loc, module: err.module });
      app.audio.play('error');
      this.explainError(err);
    });
    on('runPause', () => {});
    on('print', (e) => con.log(e.text, 'print', { drone: e.drone || null }));
    on('warning', (w) => {
      const text = describeWarning(w, app.i18n, this.game);
      con.log(`${w.loc ? `${t('ui.warningLine', { line: w.loc.line })}: ` : '⚠ '}${text}`, 'warn', { loc: w.loc, module: w.module });
      app.audio.play('warn');
      if (TEACH_WARNINGS.has(w.code) && !this.ui.taught.includes(w.code)) {
        this.ui.taught.push(w.code);
        this.bridgy.say([{ emotion: 'thinking', text: `${this.bridgy.pick('warning')} ${text}`.trim() }], { key: 'warn' });
      }
    });
    on('research', (e) => this.onResearch(e));
    on('questComplete', (e) => this.onQuestComplete(e));
    on('questProgress', () => {
      this.questDirty = true;
    });
    on('harvest', (e) => {
      if (e.ok) app.audio.play('harvest');
      if (e.giantSize >= 2) {
        app.audio.play('giant');
        if (this.first('giant')) this.bridgy.toast(this.bridgy.pick('giantPumpkin'));
      }
    });
    on('plant', () => app.audio.play('plant'));
    on('till', () => app.audio.play('till'));
    on('flip', () => app.audio.play('flip'));
    on('pumpkinDied', () => {
      app.audio.play('died');
      if (this.first('pumpkinDied')) this.bridgy.say([{ emotion: 'worried', text: this.bridgy.pick('pumpkinDied') }], { key: 'died' });
    });
    on('worldResized', () => this.updateFarmLabel());
    on('items', () => {
      this.itemsDirty = true;
    });
  }

  first(key) {
    if (this.ui.firsts.includes(key)) return false;
    this.ui.firsts.push(key);
    return true;
  }

  explainError(err) {
    if (!err) return;
    const d = describeError(err, this.app.i18n, this.game);
    this.bridgy.explainError(err, d);
  }

  onResearch({ id }) {
    const app = this.app;
    app.audio.play('unlock');
    if (this.prefs.animations !== false && !this.prefs.lowGraphics) app.confetti.burst(window.innerWidth / 2, window.innerHeight / 3, 70);
    const node = this.game.research.node(id);
    if (node.final) {
      this.showCredits();
      this.save();
      return;
    }
    const lesson = app.config.bridgy.lessons && app.config.bridgy.lessons[id];
    if (lesson && !this.ui.lessonsSeen.includes(id)) {
      this.ui.lessonsSeen.push(id);
      this.bridgy.say(lesson, { key: `lesson:${id}` });
    } else {
      const special = app.config.bridgy.reactions && app.config.bridgy.reactions[id];
      this.bridgy.toast(special ? this.bridgy.pick(id) : `${this.bridgy.pick('research')} ${app.i18n.t('ui.researchBought', { name: node.name })}`);
    }
    this.editor.scheduleCheck(50);
    this.questDirty = true;
    this.cloudSoon = true;
    this.save();
  }

  showCredits() {
    const app = this.app;
    this.ui.finished = true;
    if (this.research.isOpen) this.research.close();
    if (this.prefs.animations !== false && !this.prefs.lowGraphics) {
      [0, 600, 1200, 1800].forEach((ms, i) =>
        setTimeout(() => app.confetti.burst(window.innerWidth * (0.2 + 0.2 * i), window.innerHeight * 0.3, 120), ms),
      );
    }
    const t = app.i18n.t;
    const pages = (app.config.bridgy.credits || []).slice();
    pages.push({
      emotion: 'happy',
      text: t('ui.creditsStats', { time: formatClock(this.game.playSeconds), research: this.game.research.totalLevels() }),
    });
    this.bridgy.say(pages, { key: 'credits', interrupt: true });
  }

  onResearchBought(id, card) {
    if (card && this.prefs.animations !== false && !this.prefs.lowGraphics) {
      const r = card.getBoundingClientRect();
      this.app.confetti.burst(r.left + r.width / 2, r.top + r.height / 2, 50);
    }
  }

  onQuestComplete({ quest, next }) {
    const app = this.app;
    app.audio.play('quest');
    this.questBar.render();
    this.questBar.flash();
    const pages = [{ emotion: 'celebrating', text: quest.done || this.bridgy.pick('questDone') }];
    if (next) pages.push({ emotion: 'happy', text: `${app.i18n.t('ui.quest')}՝ ${next.title}։ ${next.text}` });
    this.bridgy.say(pages, { key: `quest:${quest.id}` });
    this.save();
  }

  startStory() {
    if (this.destroyed) return;
    if (!this.ui.introDone) {
      this.bridgy.say(this.app.config.bridgy.intro, {
        key: 'intro',
        onDone: () => {
          this.ui.introDone = true;
          this.save();
        },
      });
    }
    this.quests.check();
  }

  // ------------------------------------------------------------------ controls

  run() {
    const r = this.game.runner;
    if (r.state === 'paused') {
      r.resume();
      return;
    }
    if (r.isActive()) r.stop('restart', true);
    this.editor.clearRunError();
    this.save();
    this.setTab('farm');
    r.start(this.game.activeScript);
  }

  stop() {
    this.game.runner.stop('user');
  }

  togglePause() {
    const r = this.game.runner;
    if (r.state === 'running') r.pause();
    else if (r.state === 'paused') r.resume();
  }

  step() {
    this.game.runner.step();
  }

  handleKey(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      this.run();
    }
  }

  openResearch(id) {
    this.research.open(id);
  }

  openSettings() {
    openSettings({
      app: this.app,
      prefs: this.prefs,
      onChange: () => {
        this.applyPrefs();
        this.save();
      },
      onLogout: () => this.exit(),
    });
  }

  openProfile() {
    this.save();
    openProfile(this.app, {
      stats: { research: this.game.research.totalLevels(), playSeconds: this.game.playSeconds },
      sync: this.syncCloud({ now: true }),
      onLogout: () => this.exit(),
    });
  }

  applyPrefs() {
    const p = this.prefs;
    const root = document.documentElement;
    root.classList.remove('font-small', 'font-normal', 'font-large');
    root.classList.add(`font-${p.fontSize || 'normal'}`);
    root.classList.toggle('low-gfx', !!p.lowGraphics);
    this.app.audio.setVolumes({ sfx: p.sfxVolume, music: p.musicVolume, blips: p.blips });
    this.app.confetti.enabled = !p.lowGraphics && p.animations !== false;
    if (this.editor) setTimeout(() => this.editor.refresh(), 30);
  }

  // ------------------------------------------------------------------ loop

  tick(now) {
    if (this.destroyed) return;
    const dt = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    this.frame++;
    const game = this.game;
    game.update(dt);
    const farmShown = this.tab === 'farm' || !mobileQuery.matches;
    if (farmShown && (!this.prefs.lowGraphics || this.frame % 2 === 0)) this.farm.render(now);
    this.controls.update(!!this.lastError);

    const r = game.runner;
    if (r.isActive()) {
      const d = game.mainDrone;
      const node = d.interp && d.interp.currentNode;
      if (node && node.loc) this.editor.setExecLine(node._mod, node.loc.start.line);
      this.checkIdle();
    }

    this.slowTimer += dt;
    if (this.slowTimer > 0.2) {
      this.slowTimer = 0;
      if (this.itemsDirty) {
        this.itemsDirty = false;
        this.inventory.update();
        this.updateResearchBadge();
        if (this.research.isOpen) this.research.refresh();
      } else this.inventory.update();
      this.debugPanel.update();
      if (this.questDirty) {
        this.questDirty = false;
        this.questBar.render();
        this.updateResearchBadge();
      }
    }
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  checkIdle() {
    const d = this.game.mainDrone;
    const idle = this.idle;
    if (!idle || this.game.runner.state !== 'running') return;
    if (d.actions !== idle.actions) {
      idle.actions = d.actions;
      idle.since = this.game.time;
      return;
    }
    if (!idle.warned && this.game.time - idle.since > 15) {
      idle.warned = true;
      this.bridgy.toast(this.bridgy.pick('idle'), 6000);
    }
  }

  updateResearchBadge() {
    const research = this.game.research;
    let n = 0;
    for (const node of research.nodes) if (research.state(node.id) === 'affordable') n++;
    for (const badge of [this.researchBadge, this.tabBadge]) {
      badge.hidden = n === 0;
      badge.textContent = String(n);
    }
    this.researchBtn.classList.toggle('has-new', n > 0);
  }

  markDirty() {
    this.dirty = true;
  }

  // ------------------------------------------------------------------ saving

  // The browser copy is written on every save; the online copy by syncCloud().
  save() {
    if (this.destroyed) return;
    this.lastData = {
      v: SAVE_VERSION,
      game: this.game.toSave(),
      quests: this.quests.toSave(),
      ui: { ...this.ui, prefs: this.prefs },
    };
    this.app.account.saveLocal(this.lastData);
    this.cloudDirty = true;
    this.dirty = false;
  }

  // Online copy + leaderboard row: every `online.cloudSaveSeconds` when something changed, at the
  // next autosave after a research, and right away when asked. Resolves to true when saved.
  syncCloud({ now = false, keepalive = false } = {}) {
    if (this.pushing) return this.pushing.then(() => this.syncCloud({ now, keepalive }));
    const every = ((this.app.config.settings.online || {}).cloudSaveSeconds || 60) * 1000;
    if (!this.cloudDirty || (!now && !this.cloudSoon && Date.now() - this.lastPush < every)) return Promise.resolve(true);
    this.cloudDirty = this.cloudSoon = false;
    this.lastPush = Date.now();
    const t = this.app.i18n.t;
    const stats = { research: this.game.research.totalLevels(), playSeconds: this.game.playSeconds };
    this.pushing = this.app.account
      .saveOnline(this.lastData, stats, keepalive)
      .then(
        () => {
          if (this.syncFailed) this.app.toast(t('ui.syncBack'));
          this.syncFailed = false;
          return true;
        },
        (e) => {
          this.cloudDirty = true;
          console.warn('Online save failed:', e);
          if (keepalive) return false; // best effort while the page is hidden or closing
          if (!this.syncFailed && !this.destroyed) this.app.toast(`${t('ui.syncFailed')} ${accountErrorText(this.app.i18n, e)}`, 'warn');
          this.syncFailed = true;
          return false;
        },
      )
      .finally(() => {
        this.pushing = null;
      });
    return this.pushing;
  }

  // Page hidden or closing (phones switch apps without closing): save everywhere now.
  leaveSave() {
    this.save();
    this.syncCloud({ now: true, keepalive: true });
  }

  async exit() {
    if (this.leaving) return;
    this.leaving = true;
    this.save();
    const saved = await Promise.race([this.syncCloud({ now: true }), new Promise((r) => setTimeout(() => r(false), 5000))]);
    if (!saved) this.app.toast(this.app.i18n.t('ui.logoutOffline'), 'warn');
    this.destroy();
    this.onExit();
  }

  destroy() {
    if (this.destroyed) return;
    this.game.runner.stop('exit', true);
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    clearInterval(this.saveTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('beforeunload', this.onUnload);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('keydown', this.onKey);
    this.offs.forEach((f) => f());
    this.quests.destroy();
    this.editor.destroy();
    this.farm.destroy();
    this.bridgy.destroy();
    if (this.research.isOpen) this.research.close();
    this.el.remove();
  }
}

export { formatClock };
