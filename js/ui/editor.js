// Code editor (CodeMirror 5) with file tabs, live error marks, the running-line highlight,
// autocomplete limited to unlocked functions, and the console.
import { h, clear, mobileQuery } from './dom.js';
import { describeError } from './errorText.js';
import { askText, confirmModal } from './modal.js';

const CM = window.CodeMirror;
const NAME_RE = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const WORD_RE = /[\p{L}_$][\p{L}\p{N}_$]*$/u;

const KEYWORDS_BY_FEATURE = {
  loops: ['while', 'for', 'break', 'continue', 'do'],
  if: ['if', 'else', 'switch', 'case', 'default'],
  variables: ['let', 'const'],
  functions: ['function', 'return'],
  lists: ['of'],
  objects: ['new', 'in'],
  import: ['import', 'export', 'from'],
};
const ALWAYS_KEYWORDS = ['true', 'false', 'null'];
// Phone symbol bar (most used first): brackets and quotes are inserted in pairs; ◀ ▶ move the cursor.
const SYMBOLS = ['◀', '▶', '(', ')', '{', '}', ';', '=', '"', '<', '>', '+', '-', '*', '/', '%', '!', '&', '|', ',', '.', '[', ']', '⇥'];
const PAIRS = { '(': ')', '{': '}', '[': ']', '"': '"' };

export class ConsolePanel {
  constructor(i18n, onJump) {
    this.i18n = i18n;
    this.onJump = onJump;
    this.body = h('div', { class: 'console-body', role: 'log' });
    this.el = h(
      'div',
      { class: 'console' },
      h(
        'div',
        { class: 'console-head' },
        h('span', {}, `🖥 ${i18n.t('ui.console')}`),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => this.clear() }, i18n.t('ui.clearConsole')),
      ),
      this.body,
    );
    this.count = 0;
  }

  log(text, kind = 'print', opts = {}) {
    const nearBottom = this.body.scrollHeight - this.body.scrollTop - this.body.clientHeight < 40;
    const line = h('div', { class: `console-line ${kind}` });
    if (opts.drone) line.append(h('span', { class: 'drone-tag' }, `#${opts.drone}`));
    line.append(text);
    if (opts.loc && this.onJump) {
      line.classList.add('clickable');
      line.addEventListener('click', () => this.onJump(opts.module, opts.loc.line));
    }
    this.body.append(line);
    this.count++;
    while (this.count > 300) {
      this.body.firstChild.remove();
      this.count--;
    }
    if (nearBottom) this.body.scrollTop = this.body.scrollHeight;
  }

  clear() {
    clear(this.body);
    this.count = 0;
  }
}

export class EditorPanel {
  constructor({ app, game, container, onChange, onRun }) {
    this.app = app;
    this.i18n = app.i18n;
    this.game = game;
    this.onChange = onChange;
    this.onRun = onRun;
    this.docs = new Map();
    this.marks = [];
    this.errorLine = null;
    this.execLine = null;
    this.checkTimer = null;
    this.running = false;

    this.tabsBar = h('div', { class: 'tabs-bar' });
    this.wrap = h('div', { class: 'editor-wrap' });
    this.banner = h('div', { class: 'editor-banner', hidden: true }, this.i18n.t('ui.readOnlyWhileRunning'));
    this.wrap.append(this.banner);
    this.console = new ConsolePanel(this.i18n, (module, line) => this.jumpTo(module, line));
    container.append(this.tabsBar, this.wrap, this.symbolBar(), this.console.el);

    this.cm = CM(this.wrap, {
      value: '',
      mode: 'javascript',
      lineNumbers: true,
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      matchBrackets: true,
      autoCloseBrackets: true,
      styleActiveLine: true,
      gutters: ['marker-gutter', 'CodeMirror-linenumbers'],
      viewportMargin: 20,
      lineWrapping: true,
      extraKeys: {
        'Ctrl-Enter': () => this.onRun && this.onRun(),
        'Cmd-Enter': () => this.onRun && this.onRun(),
        'Ctrl-Space': (cm) => this.showHint(cm, true),
        'Ctrl-/': 'toggleComment',
        'Cmd-/': 'toggleComment',
        Tab: (cm) => {
          if (cm.somethingSelected()) cm.indentSelection('add');
          else cm.replaceSelection('  ', 'end');
        },
        'Shift-Tab': (cm) => cm.indentSelection('subtract'),
      },
    });
    this.cm.addOverlay(this.makeOverlay());
    this.cm.on('changes', () => this.handleChange());
    this.cm.on('inputRead', (cm, change) => this.maybeHint(cm, change));
    // Phones: while typing, the control and tab bars hide to leave room above the keyboard.
    this.cm.on('focus', () => document.documentElement.classList.toggle('typing', mobileQuery.matches));
    this.cm.on('blur', () => document.documentElement.classList.remove('typing'));
    this.resizeObserver = new ResizeObserver(() => this.cm.refresh());
    this.resizeObserver.observe(this.wrap);

    for (const s of game.scripts) this.docs.set(s.name, CM.Doc(s.code, 'javascript'));
    this.switchTo(game.activeScript, true);
    this.renderTabs();
  }

  // Buttons don't take the focus (mousedown is cancelled), so the phone keyboard stays open.
  symbolBar() {
    const press = (sym) => {
      const cm = this.cm;
      if (cm.getOption('readOnly')) return;
      if (sym === '◀' || sym === '▶') cm.execCommand(sym === '◀' ? 'goCharLeft' : 'goCharRight');
      else if (sym === '⇥') cm.replaceSelection('  ');
      else if (PAIRS[sym] && !cm.somethingSelected()) {
        cm.replaceSelection(sym + PAIRS[sym]);
        cm.execCommand('goCharLeft');
      } else cm.replaceSelection(sym);
      cm.focus();
    };
    return h(
      'div',
      { class: 'symbol-bar' },
      SYMBOLS.map((sym) => h('button', { class: 'sym', type: 'button', onmousedown: (e) => e.preventDefault(), onclick: () => press(sym) }, sym)),
    );
  }

  // Colours game functions (blue) and enums (amber) in the code.
  makeOverlay() {
    const api = this.game.api;
    return {
      token(stream) {
        if (stream.match(/^[\p{L}_$][\p{L}\p{N}_$]*/u)) {
          const kind = api.codeKind(stream.current());
          return kind === 'fn' ? 'gamefn' : kind === 'enum' ? 'gameenum' : null;
        }
        stream.next();
        return null;
      },
    };
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.hideHintDoc();
    document.documentElement.classList.remove('typing');
  }

  get active() {
    return this.game.activeScript;
  }

  switchTo(name, silent = false) {
    const doc = this.docs.get(name);
    if (!doc) return;
    this.game.activeScript = name;
    this.cm.swapDoc(doc);
    this.cm.setOption('readOnly', this.running ? true : false);
    this.renderTabs();
    this.scheduleCheck(50);
    if (!silent) this.cm.focus();
  }

  renderTabs() {
    const i18n = this.i18n;
    const runner = this.game.runner;
    const tabs = this.game.scripts.map((s) => {
      const isActive = s.name === this.active;
      const tab = h(
        'div',
        {
          class: `tab ${isActive ? 'active' : ''} ${runner.isActive() && runner.entry === s.name ? 'running' : ''} ${this.errorTabs && this.errorTabs.has(s.name) ? 'has-error' : ''}`,
          title: isActive ? `${i18n.t('ui.runThisFile')} · ${i18n.t('ui.renameTab')}: 2×` : s.name,
          onclick: () => this.switchTo(s.name),
          ondblclick: () => this.renameTab(s.name),
        },
        h('span', {}, s.name),
      );
      if (this.game.scripts.length > 1) {
        tab.append(
          h(
            'button',
            {
              class: 'tab-close',
              title: i18n.t('ui.deleteTab'),
              onclick: (e) => {
                e.stopPropagation();
                this.deleteTab(s.name);
              },
            },
            '✕',
          ),
        );
      }
      return tab;
    });
    this.tabsBar.replaceChildren(...tabs, h('button', { class: 'tab-add', title: i18n.t('ui.newTab'), onclick: () => this.newTab() }, '+'));
  }

  validName(name, except = null) {
    if (!NAME_RE.test(name)) return this.i18n.t('ui.tabNameInvalid');
    if (this.game.scripts.some((s) => s.name !== except && s.name === name)) return this.i18n.t('ui.tabNameTaken');
    return null;
  }

  async newTab(code = '', suggested = null) {
    let name = suggested;
    if (!name) {
      let n = this.game.scripts.length + 1;
      while (this.game.scripts.some((s) => s.name === `file${n}`)) n++;
      name = await askText(this.i18n, {
        title: this.i18n.t('ui.newTab'),
        label: this.i18n.t('ui.tabNamePrompt'),
        value: `file${n}`,
        validate: (v) => this.validName(v),
      });
      if (!name) return null;
    }
    this.addScript(name, code);
    return name;
  }

  addScript(name, code) {
    this.game.scripts.push({ name, code });
    this.docs.set(name, CM.Doc(code, 'javascript'));
    this.switchTo(name);
    this.onChange && this.onChange();
  }

  async renameTab(old) {
    if (this.running) return;
    const name = await askText(this.i18n, {
      title: this.i18n.t('ui.renameTab'),
      label: this.i18n.t('ui.tabNamePrompt'),
      value: old,
      validate: (v) => this.validName(v, old),
    });
    if (!name || name === old) return;
    const s = this.game.scripts.find((x) => x.name === old);
    s.name = name;
    this.docs.set(name, this.docs.get(old));
    this.docs.delete(old);
    if (this.game.activeScript === old) this.game.activeScript = name;
    this.game.api.compiled.delete(old);
    this.renderTabs();
    this.onChange && this.onChange();
  }

  async deleteTab(name) {
    if (this.running) return;
    if (this.game.scripts.length <= 1) return;
    const ok = await confirmModal(this.i18n, {
      title: this.i18n.t('ui.deleteTab'),
      text: this.i18n.t('ui.confirmDeleteTab', { name }),
      okLabel: this.i18n.t('ui.delete'),
    });
    if (!ok) return;
    this.game.scripts = this.game.scripts.filter((s) => s.name !== name);
    this.docs.delete(name);
    this.game.api.compiled.delete(name);
    if (this.game.activeScript === name) this.switchTo(this.game.scripts[0].name, true);
    this.renderTabs();
    this.onChange && this.onChange();
  }

  setCode(name, code) {
    const doc = this.docs.get(name);
    if (doc) doc.setValue(code);
  }

  handleChange() {
    const name = this.active;
    this.game.setScriptCode(name, this.cm.getValue());
    this.clearRunError();
    this.scheduleCheck();
    this.onChange && this.onChange();
  }

  scheduleCheck(ms = 450) {
    clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => this.liveCheck(), ms);
  }

  // Marks syntax errors / locked features while typing.
  liveCheck() {
    const name = this.active;
    const code = this.cm.getValue();
    const errors = this.game.api.check(name, code).filter((e) => !e.module || e.module === name);
    this.clearMarks();
    const doc = this.docs.get(name);
    for (const err of errors) this.markError(doc, err);
  }

  clearMarks() {
    for (const m of this.marks) m.clear();
    this.marks = [];
    this.cm.clearGutter('marker-gutter');
    if (this.execLine) this.setExecGutter();
  }

  markError(doc, err) {
    if (!err.loc) return;
    const line = Math.max(0, err.loc.line - 1);
    if (line >= doc.lineCount()) return;
    const text = doc.getLine(line);
    let from = { line, ch: Math.min(err.loc.column, text.length) };
    let to;
    if (err.loc.endLine) {
      to = { line: err.loc.endLine - 1, ch: err.loc.endColumn };
      if (to.line !== line) to = { line, ch: text.length };
    } else {
      const m = text.slice(from.ch).match(/^[\p{L}\p{N}_$]+|^\S/u);
      to = { line, ch: from.ch + (m ? m[0].length : 1) };
    }
    if (to.ch <= from.ch) {
      if (from.ch > 0) from = { line, ch: from.ch - 1 };
      to = { line, ch: from.ch + 1 };
    }
    const lock = err.code === 'lockedSyntax' || err.code === 'lockedFunction';
    const { message } = describeError(err, this.i18n, this.game);
    this.marks.push(doc.markText(from, to, { className: lock ? 'cm-lock-mark' : 'cm-err-mark', title: message }));
    if (doc === this.cm.getDoc()) {
      this.cm.setGutterMarker(line, 'marker-gutter', h('div', { class: `gutter-marker ${lock ? 'lock' : 'error'}`, title: message }));
    }
  }

  showRunError(err) {
    const module = err.module || this.active;
    if (!this.docs.has(module)) return;
    if (module !== this.active) this.switchTo(module, true);
    this.clearRunError();
    if (!err.loc) return;
    const doc = this.docs.get(module);
    const line = Math.max(0, Math.min(doc.lineCount() - 1, err.loc.line - 1));
    this.errorLine = { doc, handle: doc.addLineClass(line, 'background', 'cm-error-line') };
    this.markError(doc, err);
    this.cm.scrollIntoView({ line, ch: 0 }, 80);
    this.errorTabs = new Set([module]);
    this.renderTabs();
  }

  clearRunError() {
    if (this.errorLine) {
      this.errorLine.doc.removeLineClass(this.errorLine.handle, 'background', 'cm-error-line');
      this.errorLine = null;
    }
    if (this.errorTabs && this.errorTabs.size) {
      this.errorTabs = null;
      this.renderTabs();
    }
  }

  jumpTo(module, line) {
    if (module && this.docs.has(module) && module !== this.active) this.switchTo(module, true);
    this.cm.focus();
    this.cm.setCursor({ line: Math.max(0, line - 1), ch: 0 });
    this.cm.scrollIntoView(null, 80);
  }

  // Highlights the line the main drone is executing.
  setExecLine(module, line) {
    const key = module && line ? `${module}:${line}` : null;
    if (key === (this.execLine && this.execLine.key)) return;
    if (this.execLine) {
      const { doc, handle } = this.execLine;
      doc.removeLineClass(handle, 'background', 'cm-exec-line');
      if (doc === this.cm.getDoc()) this.cm.setGutterMarker(handle, 'marker-gutter', null);
      this.execLine = null;
    }
    if (!key || !this.docs.has(module)) return;
    const doc = this.docs.get(module);
    const ln = Math.max(0, Math.min(doc.lineCount() - 1, line - 1));
    const handle = doc.addLineClass(ln, 'background', 'cm-exec-line');
    this.execLine = { key, doc, handle };
    this.setExecGutter();
    if (doc === this.cm.getDoc()) {
      const info = this.cm.getScrollInfo();
      const top = this.cm.heightAtLine(ln, 'local');
      if (top < info.top || top > info.top + info.clientHeight - 30) this.cm.scrollIntoView({ line: ln, ch: 0 }, 60);
    }
  }

  setExecGutter() {
    if (!this.execLine || this.execLine.doc !== this.cm.getDoc()) return;
    this.cm.setGutterMarker(this.execLine.handle, 'marker-gutter', h('div', { class: 'gutter-marker exec' }));
  }

  setRunning(running) {
    this.running = running;
    this.cm.setOption('readOnly', running ? true : false);
    this.banner.hidden = !running;
    if (!running) this.setExecLine(null, null);
    this.renderTabs();
  }

  refresh() {
    this.cm.refresh();
  }

  // ------------------------------------------------------------------ autocomplete

  maybeHint(cm, change) {
    if (this.running) return;
    const text = change.text.join('');
    if (text === '.') {
      this.showHint(cm, false);
      return;
    }
    if (!/^[\p{L}_$]$/u.test(text)) return;
    const cur = cm.getCursor();
    const before = cm.getLine(cur.line).slice(0, cur.ch);
    const m = before.match(WORD_RE);
    if (m && m[0].length >= 2) this.showHint(cm, false);
  }

  showHint(cm, explicit) {
    cm.showHint({
      hint: (c) => this.hintList(c, explicit),
      completeSingle: false,
      closeCharacters: /[\s()[\]{};:>,]/,
    });
  }

  hintList(cm, explicit) {
    const api = this.game.api;
    const research = this.game.research;
    const cur = cm.getCursor();
    const before = cm.getLine(cur.line).slice(0, cur.ch);
    const memberMatch = before.match(/([\p{L}_$][\p{L}\p{N}_$]*)\.([\p{L}\p{N}_$]*)$/u);
    let items = [];
    let prefix;
    if (memberMatch) {
      prefix = memberMatch[2];
      const ns = api.globals.get(api.canonicalName(memberMatch[1]));
      if (!ns || !ns.value || !ns.value.members) return null;
      for (const name of ns.value.displayNames()) items.push({ text: name, kind: memberMatch[1] });
    } else {
      const m = before.match(WORD_RE);
      prefix = m ? m[0] : '';
      if (!prefix && !explicit) return null;
      for (const name of api.knownNames()) {
        const canon = api.canonicalName(name);
        const g = api.globals.get(canon);
        if (!g) continue;
        const isFn = g.kind === 'function';
        const sig = this.i18n.fnDoc(canon)?.sig;
        items.push({ text: name, kind: isFn ? 'fn' : g.kind, canon, takesArgs: isFn && sig ? !/\(\)$/.test(sig) : isFn });
      }
      for (const [feature, words] of Object.entries(KEYWORDS_BY_FEATURE)) {
        if (research.hasSyntax(feature)) for (const w of words) items.push({ text: w, kind: 'kw' });
      }
      for (const w of ALWAYS_KEYWORDS) items.push({ text: w, kind: 'kw' });
      const own = new Set();
      const re = /\b(?:let|const|var|function)\s+([\p{L}_$][\p{L}\p{N}_$]*)/gu;
      let mm;
      const code = cm.getValue();
      while ((mm = re.exec(code))) own.add(mm[1]);
      for (const w of own) items.push({ text: w, kind: 'var' });
    }
    const lower = prefix.toLowerCase();
    const seen = new Set();
    items = items.filter((it) => {
      if (seen.has(it.text)) return false;
      seen.add(it.text);
      return it.text.toLowerCase().startsWith(lower) && it.text !== prefix;
    });
    items.sort((a, b) => Number(!a.text.startsWith(prefix)) - Number(!b.text.startsWith(prefix)) || a.text.length - b.text.length || a.text.localeCompare(b.text));
    if (!items.length) return null;
    const from = { line: cur.line, ch: cur.ch - prefix.length };
    const list = items.slice(0, 40).map((it) => ({
      text: it.text,
      displayText: it.text,
      data: it,
      render: (el) => {
        el.append(
          h(
            'span',
            { class: 'hint-row' },
            h('span', { class: 'hint-name' }, it.kind === 'fn' ? `${it.text}()` : it.text),
            h('span', { class: 'hint-kind' }, kindLabel(this.i18n, it.kind)),
          ),
        );
      },
      hint: (c, self, data) => {
        if (it.kind === 'fn') {
          c.replaceRange(`${it.text}()`, self.from, self.to);
          if (it.takesArgs) c.setCursor({ line: self.from.line, ch: self.from.ch + it.text.length + 1 });
        } else c.replaceRange(data.text, self.from, self.to);
      },
    }));
    const result = { list, from, to: cur };
    CM.on(result, 'select', (completion, el) => this.showHintDoc(completion.data, el));
    CM.on(result, 'close', () => this.hideHintDoc());
    return result;
  }

  showHintDoc(item, el) {
    this.hideHintDoc();
    if (!item || item.kind !== 'fn' || mobileQuery.matches) return;
    const doc = this.i18n.fnDoc(item.canon || item.text);
    if (!doc) return;
    const r = el.getBoundingClientRect();
    const box = el.closest('.CodeMirror-hints').getBoundingClientRect();
    this.hintDoc = h('div', { class: 'hint-doc' }, h('code', {}, doc.sig), doc.doc);
    document.body.append(this.hintDoc);
    this.hintDoc.style.left = `${box.right + 8}px`;
    this.hintDoc.style.top = `${r.top}px`;
  }

  hideHintDoc() {
    if (this.hintDoc) this.hintDoc.remove();
    this.hintDoc = null;
  }
}

function kindLabel(i18n, kind) {
  switch (kind) {
    case 'fn':
      return i18n.t('ui.hintKindFn');
    case 'kw':
      return i18n.t('ui.hintKindKeyword');
    case 'var':
      return i18n.t('ui.hintKindVar');
    case 'enum':
    case 'lib':
      return i18n.t('ui.hintKindGroup');
    case 'constant':
      return i18n.t('ui.hintKindConst');
    default:
      return '';
  }
}
