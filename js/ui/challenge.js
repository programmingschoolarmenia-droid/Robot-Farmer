// The weekly challenge (js/engine/challenge.js): the School's part of the village panel (this week's
// task, the top 10, my place and last week's best solution) and the challenge page, a clear full
// screen like the game: the test farm, its own editor, console, storage and controls. The main
// farm waits while it is open, and every ▶ starts a fresh test farm.
import { h, sizeFarm, mobileQuery, highlightCode } from './dom.js';
import { FarmView } from './farmView.js';
import { EditorPanel } from './editor.js';
import { Controls, InventoryPanel } from './panels.js';
import { openModal } from './modal.js';
import { describeError, describeWarning } from './errorText.js';
import { championsOf } from './account.js';
import { testGame, watchGoal, rollWeek, recordResult, CHALLENGE_SCRIPT } from '../engine/challenge.js';
import { formatTenths, dayNumber, keyOfDay, weekKey } from '../core/util.js';

const MEDALS = ['🥇', '🥈', '🥉'];

// The School's panel part: `task` = this week's (weekTask), onStart opens the challenge page.
export function schoolPanel(app, game, task, today, onStart) {
  const t = app.i18n.t;
  const ch = game.challenge;
  const best = ch.week === task.week ? ch.best : 0;
  const field = `c${task.week}`;
  const me = app.account.user.id;
  const top = h('div', { class: 'board-note' }, t('ui.loading'));
  const winner = h('div');
  app.account.leaderboard(field, best ? { id: me, value: best } : null).then(
    ({ rows, place }) =>
      top.replaceWith(
        rows.length
          ? h('ol', { class: 'challenge-top' }, rows.slice(0, 10).map((r, i) => h('li', { class: r.id === me ? 'me' : '' }, h('span', {}, MEDALS[i] || `${i + 1}.`), h('span', { class: 'board-name' }, r.name), h('b', {}, formatTenths(r[field])))))
          : h('div', { class: 'board-note' }, t('ui.leadersEmptyChallenge')),
        place ? h('div', { class: 'board-place' }, t('ui.challengePlace', { place })) : '',
      ),
    () => (top.textContent = t('ui.challengeOffline')),
  );
  const last = weekKey(keyOfDay(dayNumber(today) - 7));
  championsOf(app, today).then((c) => {
    const w = c && c.week;
    if (w && w[`cc${last}`]) {
      winner.replaceChildren(
        h('h4', {}, t('ui.challengeWinner', { name: w.name, time: formatTenths(w[`c${last}`]) })),
        h('pre', { class: 'bridgy-code challenge-code' }, highlightCode(w[`cc${last}`], (word) => game.api.codeKind(word))),
      );
    }
  });
  return h(
    'div',
    { class: 'rd-section challenge-panel' },
    h('h4', {}, t('ui.challengeTitle')),
    h('div', {}, h('b', {}, task.name), '․ ', task.about),
    h('div', { class: 'rd-note' }, best ? t('ui.challengeBest', { time: formatTenths(best) }) : t('ui.challengeNotYet', { n: (app.config.events.challenge || {}).stars ?? 5 })),
    h('button', { class: 'btn btn-run', onclick: onStart }, t('ui.challengeStart')),
    top,
    winner,
    h('div', { class: 'rd-note' }, t('ui.challengeShare')),
  );
}

export class ChallengeScreen {
  // main: the main Game (its `challenge` keeps the code and the best time); onResult: save the main
  // game now (returns a promise); onClose: back to the village.
  constructor({ app, main, task, onResult, onClose }) {
    this.app = app;
    this.main = main;
    this.task = task;
    this.onResult = onResult;
    this.onClose = onClose;
    this.limit = (app.config.events.challenge || {}).limit ?? 600;
    const t = app.i18n.t;
    rollWeek(main, task.week);
    this.game = testGame(app.config, task, main.challenge.code);
    this.goal = null; // the goal watcher of the running try
    this.lastError = null;
    this.stage = h('div', { class: 'farm-stage' });
    this.codePanel = h('section', { class: 'panel code-panel' });
    this.inventoryList = h('ul', { class: 'inventory-list' });
    this.controlbar = h('footer', { class: 'controlbar' });
    this.timeChip = h('span', { class: 'chip challenge-chip', title: t('ui.challengeTime') });
    this.bestChip = h('span', { class: 'chip challenge-chip', title: t('ui.challengeBestTitle') });
    this.tabButtons = [
      ['farm', '🌾', t('ui.farm')],
      ['code', '</>', t('ui.codeTab')],
      ['storage', '🧺', t('ui.inventory')],
    ].map(([id, icon, label]) => h('button', { class: 'btn mobile-tab', dataset: { tab: id }, onclick: () => this.setTab(id) }, h('span', { class: 'ico' }, icon), label));
    this.sidePanel = h('aside', { class: 'side-panel' }, h('section', { class: 'panel grow' }, h('div', { class: 'panel-head' }, '🧺 ', t('ui.inventory')), this.inventoryList));
    this.el = h(
      'section',
      { class: 'screen screen-game screen-challenge' },
      h(
        'header',
        { class: 'topbar' },
        h('div', { class: 'challenge-task' }, h('b', {}, `🎓 ${task.name}`), h('span', {}, task.about)),
        this.bestChip,
        this.timeChip,
        h('button', { class: 'btn', title: t('ui.challengeBack'), onclick: () => this.close() }, '⬅', h('span', { class: 'btn-label' }, t('ui.challengeBack'))),
      ),
      h(
        'main',
        { class: 'game-main' },
        h('section', { class: 'panel farm-panel' }, h('div', { class: 'panel-head' }, '🎓 ', t('ui.challengeFarm')), this.stage),
        this.codePanel,
        this.sidePanel,
      ),
      this.controlbar,
      h('nav', { class: 'mobile-tabs' }, this.tabButtons),
    );
    app.root.append(this.el);
    this.setTab('code');
    this.farm = this.makeFarm();
    this.editor = new EditorPanel({
      app,
      game: this.game,
      container: this.codePanel,
      onChange: () => (main.challenge.code = this.game.scripts[0].code),
      onRun: () => this.run(),
    });
    this.controls = new Controls({
      app,
      game: this.game,
      container: this.controlbar,
      onRun: () => this.run(),
      onStop: () => this.game.runner.stop('user'),
      onPause: () => this.togglePause(),
      onStep: () => this.step(),
      onSpeed: (s) => {
        this.game.speed = s;
        app.audio.play('click');
      },
    });
    this.inventory = new InventoryPanel({ app, game: this.game, list: this.inventoryList });
    this.wire();
    this.updateBest();
    this.onResize = () => this.layout();
    window.addEventListener('resize', this.onResize);
    this.layout();
    this.last = performance.now();
    this.slowTimer = 0;
    this.raf = requestAnimationFrame((now) => this.tick(now));
  }

  makeFarm() {
    return new FarmView({ game: this.game, sprites: this.app.sprites, i18n: this.app.i18n, stage: this.stage, prefs: this.app.prefs });
  }

  layout() {
    sizeFarm(this.el, this.sidePanel);
    this.editor.refresh();
  }

  setTab(tab) {
    this.tab = tab;
    this.el.dataset.tab = tab;
    for (const b of this.tabButtons) b.classList.toggle('active', b.dataset.tab === tab);
    if (tab === 'code' && this.editor) setTimeout(() => this.editor.refresh(), 0);
  }

  updateBest() {
    const best = this.main.challenge.best;
    this.bestChip.textContent = `🏅 ${best ? formatTenths(best) : '—'}`;
  }

  // The console and the editor follow the test farm's runs.
  wire() {
    const app = this.app;
    const t = app.i18n.t;
    const con = this.editor.console;
    const ev = this.game.events;
    this.offs = [
      ev.on('runStart', () => {
        this.editor.setRunning(true);
        this.editor.clearRunError();
        this.lastError = null;
        con.log(t('ui.challengeRunStarted'), 'info');
        app.audio.play('run');
      }),
      ev.on('runEnd', (e) => {
        this.editor.setRunning(false);
        if (e.reason === 'done' && this.goal && this.goal.done === null) con.log(t('ui.challengeEnded'), 'warn');
      }),
      ev.on('runError', (e) => {
        this.editor.setRunning(false);
        const err = (this.lastError = e.error);
        this.editor.showRunError(err);
        const d = describeError(err, app.i18n, this.game);
        const where = err.loc ? t('ui.runErrorLine', { file: err.module || CHALLENGE_SCRIPT, line: err.loc.line }) : t('ui.runErrorNoLine');
        con.log(`${where}: ${d.message}${d.suggestion ? `  (${d.suggestion})` : ''}`, 'error', { loc: err.loc, module: err.module });
        app.audio.play('error');
      }),
      ev.on('print', (e) => con.log(e.text, 'print', { drone: e.drone || null })),
      ev.on('warning', (w) => con.log(`${w.loc ? `${t('ui.warningLine', { line: w.loc.line })}: ` : '⚠ '}${describeWarning(w, app.i18n, this.game)}`, 'warn', { loc: w.loc, module: w.module })),
    ];
  }

  // Every try starts on a fresh test farm (the same for everyone); the code and the speed stay.
  fresh() {
    const old = this.game;
    old.runner.stop('restart', true);
    this.offs.forEach((off) => off());
    this.game = testGame(this.app.config, this.task, this.main.challenge.code);
    this.game.speed = old.speed;
    this.editor.game = this.controls.game = this.inventory.game = this.game;
    this.controls.lastKey = '';
    this.inventory.last.clear();
    this.inventory.update(true);
    this.farm.destroy();
    this.stage.replaceChildren();
    this.farm = this.makeFarm();
    this.wire();
    this.goal = watchGoal(this.game, this.task.goal);
  }

  run() {
    const r = this.game.runner;
    if (r.state === 'paused') return r.resume();
    this.fresh();
    this.editor.clearRunError();
    this.setTab('farm');
    this.game.runner.start(CHALLENGE_SCRIPT);
  }

  step() {
    if (this.game.runner.state === 'idle') this.fresh();
    this.game.runner.step();
  }

  togglePause() {
    const r = this.game.runner;
    if (r.state === 'running') r.pause();
    else if (r.state === 'paused') r.resume();
  }

  tick(now) {
    if (this.closed) return;
    const dt = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    const game = this.game;
    game.update(dt);
    if (this.tab === 'farm' || !mobileQuery.matches) this.farm.render(now);
    this.controls.update(!!this.lastError);
    const r = game.runner;
    const goal = this.goal;
    if (r.isActive()) {
      const node = game.mainDrone.interp && game.mainDrone.interp.currentNode;
      if (node && node.loc) this.editor.setExecLine(node._mod, node.loc.start.line);
    }
    // (a program may reach the goal and end in the same frame)
    if (goal && !goal.finished && (goal.done !== null || (r.isActive() && game.time >= this.limit))) this.finish(goal);
    const shown = goal && goal.done !== null ? goal.done : goal ? Math.min(game.time, this.limit) : 0;
    this.timeChip.textContent = `⏱ ${formatTenths(shown * 10)}`;
    this.slowTimer += dt;
    if (this.slowTimer > 0.2) {
      this.slowTimer = 0;
      this.inventory.update();
    }
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  // The goal was reached at game time goal.done (or the time ran out: null): the try stops, its time
  // counts when it is my best (saved and sent right away) and a window shows it with my place.
  finish(goal) {
    const app = this.app;
    const t = app.i18n.t;
    const { done } = goal;
    goal.finished = true;
    this.game.runner.stop('user');
    if (done === null) {
      app.audio.play('stop');
      openModal({ title: t('ui.challengeTimeUpTitle'), body: h('p', {}, t('ui.challengeTimeUp', { n: Math.round(this.limit / 60) })), buttons: [{ label: t('ui.close'), class: 'btn-primary' }] });
      return;
    }
    const tenths = Math.max(1, Math.round(done * 10));
    const { better, first } = recordResult(this.main, tenths, this.game.scripts[0].code);
    this.updateBest();
    app.audio.play('quest');
    if (app.prefs.animations !== false && !app.prefs.lowGraphics) app.confetti.burst(window.innerWidth / 2, window.innerHeight / 3, better ? 90 : 40);
    const place = h('div', { class: 'challenge-result-line' }, t('ui.loading'));
    const best = this.main.challenge.best;
    openModal({
      title: t('ui.challengeDoneTitle'),
      body: h(
        'div',
        { class: 'challenge-result' },
        h('div', { class: 'challenge-result-time' }, `⏱ ${formatTenths(tenths)}`),
        h('div', { class: 'challenge-result-line' }, better && !first ? t('ui.challengeRecord') : t('ui.challengeBest', { time: formatTenths(best) })),
        first ? h('div', { class: 'challenge-result-line' }, t('ui.challengeStars', { n: (app.config.events.challenge || {}).stars ?? 5 })) : null,
        place,
      ),
      buttons: [{ label: t('ui.close'), class: 'btn-primary' }],
    });
    Promise.resolve(this.onResult())
      .then((saved) => (saved === false ? null : app.account.place(`c${this.task.week}`, best)))
      .then(
        (n) => (place.textContent = n ? t('ui.challengePlace', { place: n }) : t('ui.challengeOffline')),
        () => (place.textContent = t('ui.challengeOffline')),
      );
  }

  close() {
    this.destroy();
    this.onClose();
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    this.game.runner.stop('exit', true);
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.offs.forEach((off) => off());
    this.editor.destroy();
    this.farm.destroy();
    this.el.remove();
  }
}
