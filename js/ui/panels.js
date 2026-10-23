// Control bar, inventory panel and the quest card.
import { h, pixelImg } from './dom.js';
import { formatCount, formatClock } from '../core/util.js';

export class Controls {
  constructor({ app, game, container, onRun, onStop, onPause, onStep, onSpeed }) {
    this.app = app;
    this.game = game;
    const t = app.i18n.t;
    const label = (text) => h('span', { class: 'btn-label' }, text);
    this.runBtn = h('button', { class: 'btn btn-run', onclick: onRun, title: `${t('ui.run')} (${t('ui.shortcutRun')})` }, h('span', { class: 'ico' }, '▶'), label(t('ui.run')));
    this.pauseBtn = h('button', { class: 'btn', onclick: onPause, title: t('ui.pause') }, h('span', { class: 'ico' }, '⏸'), label(t('ui.pause')));
    this.stepBtn = h('button', { class: 'btn', onclick: onStep, title: t('ui.step') }, h('span', { class: 'ico' }, '⏭'), label(t('ui.step')));
    this.stopBtn = h('button', { class: 'btn btn-stop', onclick: onStop, title: t('ui.stop') }, h('span', { class: 'ico' }, '⏹'), label(t('ui.stop')));
    const speeds = (game.settings.game && game.settings.game.speedOptions) || [1];
    this.speedButtons = speeds.map((s) =>
      h('button', { onclick: () => onSpeed(s), dataset: { speed: s } }, `×${s === 0.25 ? '¼' : s === 0.5 ? '½' : s}`),
    );
    this.status = h('span', { class: 'status-pill' });
    this.clock = h('span', { class: 'clock', title: t('ui.gameTime') });
    container.append(
      h('div', { class: 'ctrl-group' }, this.runBtn, this.pauseBtn, this.stepBtn, this.stopBtn),
      h('div', { class: 'ctrl-sep' }),
      h('div', { class: 'ctrl-group' }, h('span', { class: 'ctrl-label' }, t('ui.speed')), h('div', { class: 'speed-group' }, this.speedButtons)),
      h('div', { class: 'ctrl-spacer' }),
      this.status,
      h('span', { class: 'ctrl-label' }, `⏱`),
      this.clock,
    );
    this.lastKey = '';
  }

  update(hasError) {
    const t = this.app.i18n.t;
    const r = this.game.runner;
    const state = r.state;
    const key = `${state}:${hasError}:${this.game.speed}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.runBtn.disabled = state === 'running';
      this.stopBtn.disabled = state === 'idle';
      this.pauseBtn.disabled = state === 'idle';
      this.pauseBtn.lastChild.textContent = state === 'paused' ? t('ui.resume') : t('ui.pause');
      this.pauseBtn.firstChild.textContent = state === 'paused' ? '▶' : '⏸';
      const cls = state === 'running' ? 'running' : state === 'paused' ? 'paused' : hasError ? 'error' : '';
      this.status.className = `status-pill ${cls}`;
      this.status.textContent =
        state === 'running' ? t('ui.statusRunning') : state === 'paused' ? t('ui.statusPaused') : hasError ? t('ui.statusError') : t('ui.statusIdle');
      for (const b of this.speedButtons) b.classList.toggle('active', Number(b.dataset.speed) === this.game.speed);
    }
    this.clock.textContent = formatClock(this.game.time);
  }
}

export class InventoryPanel {
  constructor({ app, game, list }) {
    this.app = app;
    this.game = game;
    this.list = list;
    this.rows = new Map();
    this.order = (game.settings.items && game.settings.items.order) || [];
    this.empty = h('div', { class: 'inventory-empty' }, app.i18n.t('ui.inventoryEmpty'));
    this.last = new Map();
    this.update(true);
  }

  update(force = false) {
    const { inventory, stats } = this.game;
    const i18n = this.app.i18n;
    let shown = 0;
    for (const item of this.order) {
      const count = inventory.get(item);
      const visible = count > 0 || stats.total(item) > 0;
      let row = this.rows.get(item);
      if (!visible) {
        if (row) row.el.hidden = true;
        continue;
      }
      shown++;
      if (!row) {
        const countEl = h('span', { class: 'inv-count' });
        const rateEl = h('span', { class: 'inv-rate' });
        const el = h(
          'li',
          { class: 'inv-row', title: i18n.item(item) },
          pixelImg(this.app.sprites.url(`item:${item}`, 2), '', ''),
          h('div', {}, h('span', { class: 'inv-name' }, i18n.item(item)), rateEl),
          countEl,
        );
        row = { el, countEl, rateEl };
        this.rows.set(item, row);
        this.insertInOrder(item, el);
      }
      row.el.hidden = false;
      const prev = this.last.get(item);
      if (prev !== count || force) {
        row.countEl.textContent = formatCount(Math.floor(count));
        if (prev !== undefined && count > prev && this.app.prefs.animations !== false) {
          row.el.classList.remove('flash');
          void row.el.offsetWidth;
          row.el.classList.add('flash');
        }
        this.last.set(item, count);
      }
      const rate = stats.perMinute(item);
      row.rateEl.textContent = rate > 0 ? i18n.t('ui.perMinute', { n: formatCount(Math.round(rate)) }) : '';
    }
    if (!shown && !this.empty.isConnected) this.list.append(this.empty);
    if (shown && this.empty.isConnected) this.empty.remove();
  }

  insertInOrder(item, el) {
    const idx = this.order.indexOf(item);
    for (const other of this.order.slice(idx + 1)) {
      const r = this.rows.get(other);
      if (r) {
        this.list.insertBefore(el, r.el);
        return;
      }
    }
    this.list.append(el);
  }
}

export class QuestBar {
  constructor({ app, game, quests, container, onHint, onOpen }) {
    this.app = app;
    this.game = game;
    this.quests = quests;
    const t = app.i18n.t;
    this.title = h('div', { class: 'quest-title' });
    this.text = h('div', { class: 'quest-text' });
    this.progress = h('div', { class: 'quest-progress' });
    this.hintBtn = h('button', { class: 'btn btn-gold btn-sm', onclick: onHint, title: t('ui.hint') }, '💡', h('span', { class: 'btn-label' }, t('ui.hint')));
    this.el = h(
      'div',
      { class: 'quest-card', onclick: (e) => !e.target.closest('button') && onOpen && onOpen() },
      h('span', { class: 'quest-label' }, t('ui.quest')),
      h('div', { class: 'quest-body' }, this.title, this.text),
      this.progress,
      this.hintBtn,
    );
    container.append(this.el);
    this.render();
  }

  flash() {
    this.el.classList.remove('flash');
    void this.el.offsetWidth;
    this.el.classList.add('flash');
  }

  render() {
    const q = this.quests.current();
    const i18n = this.app.i18n;
    if (!q) {
      this.title.textContent = '🏆';
      this.text.textContent = i18n.t('ui.allQuestsDone');
      this.progress.replaceChildren();
      this.hintBtn.hidden = true;
      return;
    }
    this.hintBtn.hidden = !(q.hints && q.hints.length);
    this.title.textContent = q.title;
    this.text.textContent = q.text;
    this.el.title = q.text;
    const chips = q.goals.map((goal, i) => {
      const p = this.quests.goalProgress(goal, i);
      const done = p.done;
      const chip = h('span', { class: `chip ${done ? 'done' : ''}` });
      switch (goal.type) {
        case 'gain':
        case 'have':
          chip.append(pixelImg(this.app.sprites.url(`item:${goal.item}`, 2)), `${formatCount(Math.floor(p.value))}/${formatCount(p.target)}`);
          break;
        case 'harvest':
          chip.append(`${i18n.entity(goal.entity)} ${p.value}/${p.target}`);
          break;
        case 'research':
          chip.append(`🔬 ${done ? '✓' : `${p.value}/${p.target}`}`);
          break;
        case 'code':
          chip.append(`</> ${goal.feature ? i18n.feature(goal.feature).split(' ')[0] : `${goal.fn}()`} ${done ? '✓' : ''}`);
          break;
        case 'visitAll':
          chip.append(`🗺 ${done ? '✓' : ''}`);
          break;
        case 'giant':
          chip.append(`🎃 ${goal.size}×${goal.size} ${done ? '✓' : ''}`);
          break;
        case 'use':
          chip.append(pixelImg(this.app.sprites.url(`item:${goal.item}`, 2)), `${p.value}/${p.target}`);
          break;
        case 'chain':
          chip.append(`🌵 ×${goal.size} ${done ? '✓' : ''}`);
          break;
        default:
          chip.append(done ? '✓' : '…');
      }
      return chip;
    });
    this.progress.replaceChildren(...chips);
  }
}
