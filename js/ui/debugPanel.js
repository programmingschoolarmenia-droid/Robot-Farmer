// "Variables" panel (Debugger research): shows the running drone's variables live.
import { h } from './dom.js';
import { formatValue, Closure } from '../lang/values.js';

export class DebugPanel {
  constructor({ app, game, container }) {
    this.app = app;
    this.game = game;
    const t = app.i18n.t;
    this.body = h('div', { class: 'debug-body' });
    this.status = h('span', { class: 'muted' });
    this.el = h('section', { class: 'panel debug-panel', hidden: true }, h('div', { class: 'panel-head' }, '🔍 ', t('ui.debugTitle'), h('span', { class: 'spacer' }), this.status), this.body);
    container.append(this.el);
    this.lastKey = '';
  }

  update() {
    const game = this.game;
    const show = game.research.hasPanel('debugger');
    if (this.el.hidden === show) this.el.hidden = !show;
    if (!show) return;
    const t = this.app.i18n.t;
    const r = game.runner;
    const d = game.mainDrone;
    if (!r.isActive() || !d.interp) {
      if (this.lastKey !== 'idle') {
        this.lastKey = 'idle';
        this.status.textContent = '';
        this.body.replaceChildren(h('div', { class: 'debug-empty' }, t('ui.debugIdle')));
      }
      return;
    }
    const I = d.interp;
    const vars = I.visibleVariables().filter((v) => !(v.value instanceof Closure && v.kind === 'function'));
    const stack = I.frames.filter((f) => !f.module).map((f) => f.name);
    const line = I.currentNode && I.currentNode.loc ? I.currentNode.loc.start.line : '?';
    const rows = vars.map((v) => {
      let text = formatValue(v.value, true);
      if (text.length > 80) text = `${text.slice(0, 77)}…`;
      return h('div', { class: 'debug-row' }, h('code', { class: 'debug-name' }, v.name), h('code', { class: 'debug-value' }, text));
    });
    const key = `${line}|${stack.join('>')}|${rows.map((r) => r.textContent).join('|')}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.status.textContent = t('ui.atLine', { line });
    const parts = [];
    if (stack.length) parts.push(h('div', { class: 'debug-stack' }, '📚 ', stack.join(' → ')));
    if (rows.length) parts.push(...rows);
    else parts.push(h('div', { class: 'debug-empty' }, t('ui.debugNoVars')));
    this.body.replaceChildren(...parts);
  }
}
