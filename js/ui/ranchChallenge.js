// The ranch's weekly challenge (js/engine/challenge.js): the School's panel part and the challenge
// page. Every ▶ builds a fresh RanchScreen on a fresh test ranch; the code of each tab stays. The score
// is the ranch time the goal was reached at, so watching faster changes nothing.
import { h, icon, highlightCode } from './dom.js';
import { isHidden } from './account.js';
import { RanchScreen } from './ranch.js';
import { openModal } from './modal.js';
import { testRanch, watchRanchGoal, rollRanchWeek, recordRanchResult } from '../engine/challenge.js';
import { formatTenths, dayNumber, keyOfDay, weekKey } from '../core/util.js';

export function ranchSchoolPanel(app, game, task, today, onStart) {
  const t = app.i18n.t;
  const ch = game.ranch.challenge;
  const best = ch.week === task.week ? ch.best : 0;
  const me = app.account.isGuest ? null : app.account.user.id; // a guest is not on the list
  const top = h('div', { class: 'board-note' }, t('ui.loading'));
  const winner = h('div');
  app.account.leaderboard(`rc${task.week}`, best && me ? { id: me, value: best } : null).then(
    ({ rows, place }) =>
      top.replaceWith(
        rows.length ? h('ol', { class: 'challenge-top' }, rows.slice(0, 10).map((r) => !isHidden(app, r.id) && h('li', { class: r.id === me ? 'me' : '' }, h('span', {}, r.name), h('b', {}, formatTenths(r[`rc${task.week}`])))).filter(Boolean)) : h('div', { class: 'board-note' }, t('ui.leadersEmptyChallenge')),
        place ? h('div', { class: 'board-place' }, t('ui.challengePlace', { place })) : me ? '' : h('div', { class: 'board-note' }, t('ui.guestOnly')),
      ),
    () => (top.textContent = t('ui.challengeOffline')),
  );
  const last = weekKey(keyOfDay(dayNumber(today) - 7));
  app.account.top(`rc${last}`, 1).then(
    ([w]) => {
      if (w && w[`rcc${last}`] && !isHidden(app, w.id)) winner.replaceChildren(h('h4', {}, t('ui.challengeWinner', { name: w.name, time: formatTenths(w[`rc${last}`]) })), h('pre', { class: 'bridgy-code challenge-code' }, highlightCode(w[`rcc${last}`], (word) => game.ranch.api.codeKind(word))));
    },
    (e) => console.warn('Last week\'s ranch winner not loaded:', e),
  );
  return h(
    'div',
    { class: 'rd-section challenge-panel' },
    h('h4', {}, t('ui.ranchChallengeTitle')),
    h('div', {}, h('b', {}, task.name), '․ ', task.about),
    h('div', { class: 'rd-note' }, best ? t('ui.challengeBest', { time: formatTenths(best) }) : t('ui.challengeNotYet', { n: (app.config.events.ranchChallenge || {}).stars ?? 5 })),
    h('button', { class: 'btn btn-run', onclick: onStart }, t('ui.challengeStart')),
    top,
    winner,
  );
}

export class RanchChallengeScreen {
  // main: the main Game (main.ranch.challenge keeps the code and the best time); bridgy: the game's;
  // onResult: save the main game now (a promise); onClose: back to the village.
  constructor({ app, main, task, bridgy, onResult, onClose }) {
    this.app = app;
    this.main = main;
    this.task = task;
    this.bridgy = bridgy;
    this.onResult = onResult;
    this.onClose = onClose;
    this.limit = (app.config.events.ranchChallenge || {}).limit ?? 900;
    this.speed = 1;
    this.ch = rollRanchWeek(main.ranch, task.week);
    this.build();
  }

  // A new test ranch with the code kept so far, on a new screen.
  build() {
    if (this.screen) this.screen.destroy();
    this.game = testRanch(this.app.config, this.task, this.ch.scripts);
    this.game.ranch.speed = this.speed;
    this.goal = null;
    this.screen = new RanchScreen({
      app: this.app,
      main: this.game,
      bridgy: this.bridgy,
      first: () => false,
      onDirty: () => this.keepCode(),
      onClose: () => this.close(),
      challenge: this,
    });
    this.updateBest();
  }

  keepCode() {
    for (const s of this.game.ranch.scripts) this.ch.scripts[s.name] = s.code;
  }

  updateBest() {
    this.screen.bestChip.replaceChildren(icon(this.app.sprites, 'medal1'), ` ${this.ch.best ? formatTenths(this.ch.best) : '—'}`);
  }

  // ▶: a fresh ranch, all its areas start.
  run() {
    this.keepCode();
    this.speed = this.game.ranch.speed;
    this.build();
    this.goal = watchRanchGoal(this.game, this.task.goal);
    this.game.ranch.startAll();
    this.screen.setTab('farm');
  }

  // Every frame (from the screen).
  tick() {
    const goal = this.goal;
    const ranch = this.game.ranch;
    if (goal && !goal.finished && (goal.done !== null || (ranch.state() !== 'idle' && ranch.time >= this.limit))) this.finish(goal);
    const shown = goal && goal.done !== null ? goal.done : goal ? Math.min(ranch.time, this.limit) : 0;
    this.screen.timeChip.textContent = `⏱ ${formatTenths(shown * 10)}`;
  }

  finish(goal) {
    const app = this.app;
    const t = app.i18n.t;
    const { done } = goal;
    goal.finished = true;
    this.game.ranch.stopAll('user');
    if (done === null) {
      app.audio.play('stop');
      openModal({ title: t('ui.challengeTimeUpTitle'), body: h('p', {}, t('ui.challengeTimeUp', { n: Math.round(this.limit / 60) })), buttons: [{ label: t('ui.close'), class: 'btn-primary' }] });
      return;
    }
    const tenths = Math.max(1, Math.round(done * 10));
    const code = this.game.ranch.scripts.map((s) => `// ${s.name}\n${s.code}`).join('\n');
    const { better, first } = recordRanchResult(this.main, tenths, code);
    this.updateBest();
    app.audio.play('quest');
    if (app.prefs.animations !== false && !app.prefs.lowGraphics) app.confetti.burst(window.innerWidth / 2, window.innerHeight / 3, better ? 90 : 40);
    const place = h('div', { class: 'challenge-result-line' }, t('ui.loading'));
    const best = this.ch.best;
    openModal({
      title: t('ui.challengeDoneTitle'),
      body: h(
        'div',
        { class: 'challenge-result' },
        h('div', { class: 'challenge-result-time' }, `⏱ ${formatTenths(tenths)}`),
        h('div', { class: 'challenge-result-line' }, better && !first ? t('ui.challengeRecord') : t('ui.challengeBest', { time: formatTenths(best) })),
        first ? h('div', { class: 'challenge-result-line' }, t('ui.challengeStars', { n: (app.config.events.ranchChallenge || {}).stars ?? 5 })) : null,
        place,
      ),
      buttons: [{ label: t('ui.close'), class: 'btn-primary' }],
    });
    const guest = app.account.isGuest;
    Promise.resolve(this.onResult())
      .then((saved) => (saved === false || guest ? null : app.account.place(`rc${this.task.week}`, best)))
      .then(
        (n) => (place.textContent = n ? t('ui.challengePlace', { place: n }) : t(guest ? 'ui.guestOnly' : 'ui.challengeOffline')),
        () => (place.textContent = t('ui.challengeOffline')),
      );
  }

  close() {
    this.keepCode();
    this.destroy();
    this.onClose();
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    this.game.ranch.stopAll('exit', true);
    this.screen.destroy();
  }
}
