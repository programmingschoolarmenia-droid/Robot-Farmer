// Bridgy: the mascot's dialogs (portrait bottom-left + text box), lessons, hints,
// error explanations, the help menu and quick reaction bubbles.
import { h, icon, highlightCode, mobileQuery, onBack, closeOnTap } from './dom.js';

const TOAST_HURRY = 4000; // ms a message stays at most while others wait
const TOAST_QUEUE = 5; // messages waiting at most (the oldest goes)

export class Bridgy {
  // onPoint(text): what Bridgy says now (his dialog and his toast, '' when silent), to light up the buttons he names.
  constructor({ app, codeKind, onShowLine, getHelpContext, onPoint }) {
    this.app = app;
    this.onPoint = onPoint || (() => {});
    this.i18n = app.i18n;
    this.cfg = app.config.bridgy;
    this.codeKind = codeKind || (() => null);
    this.onShowLine = onShowLine;
    this.getHelpContext = getHelpContext;
    this.queue = [];
    this.conv = null;
    this.page = 0;
    this.unback = null; // (see start)
    this.timer = null;
    const t = this.i18n.t;

    this.portraitImg = h('img', { src: this.portraitFor('happy'), alt: t('ui.bridgyName'), class: 'pixel' });
    this.portrait = h('div', { class: 'bridgy-portrait' }, this.portraitImg);
    this.textEl = h('div', { class: 'bridgy-text', onclick: () => this.finishTyping() });
    this.extraEl = h('div', {});
    this.buttonsEl = h('div', { class: 'bridgy-buttons' });
    this.nameEl = h('div', { class: 'bridgy-name' }, t('ui.bridgyName'));
    this.box = h(
      'div',
      { class: 'bridgy-box' },
      this.nameEl,
      h('button', { class: 'btn btn-ghost btn-sm bridgy-close', title: t('ui.close'), onclick: () => this.closeAll() }, '✕'),
      this.textEl,
      this.extraEl,
      this.buttonsEl,
    );
    this.root = h('div', { class: 'bridgy-dialog', hidden: true }, this.portrait, this.box);
    this.toasts = h('div', { class: 'bridgy-toasts' });
    this.toastQueue = [];
    this.toastNow = null;
    document.body.append(this.root, this.toasts);
    // Load the friends' pictures now, so the portrait swap does not wait for the network.
    for (const f of Object.values(this.cfg.friends || {})) if (f.portrait) new Image().src = f.portrait;
  }

  destroy() {
    clearInterval(this.timer);
    clearTimeout(this.swapTimer);
    clearTimeout(this.toastTimer);
    clearTimeout(this.waitTimer);
    this.releaseBack();
    this.root.remove();
    this.toasts.remove();
  }

  get isOpen() {
    return !!this.conv;
  }

  portraitFor(emotion) {
    const p = this.cfg.portraits || {};
    return p[emotion] || p.happy || 'assets/bridgy/bridgy.png';
  }

  // A friend from bridgy.json → friends (a student) instead of Bridgy, or null.
  friend(id) {
    const f = this.cfg.friends && this.cfg.friends[id];
    return f && f.portrait ? f : null;
  }

  // The text with one of the friend's short lines before it.
  friendText(id, text) {
    const lines = (this.friend(id) || {}).lines || [];
    return lines.length ? `${lines[Math.floor(Math.random() * lines.length)]}\n\n${text}` : text;
  }

  // pages: [{ text, emotion, who, code, options, node, buttons, quiz }] — who: a friends id
  say(pages, opts = {}) {
    if (!pages || !pages.length) return;
    const conv = { pages, ...opts };
    // A new menu / hint replaces the old one instead of piling up behind it.
    if (opts.replaceSame) this.queue = this.queue.filter((c) => c.key !== opts.key);
    if (opts.replaceSame && this.conv && this.conv.key === opts.key) this.start(conv);
    else if (opts.interrupt && this.conv) {
      this.queue.unshift({ ...this.conv, resumeAt: this.page });
      this.start(conv);
    } else if (!this.conv) this.start(conv);
    else this.queue.push(conv);
  }

  start(conv) {
    this.fresh = this.root.hidden; // just opening: no picture to swap out
    // One Back step while the dialog is on screen (the next conversation in the queue keeps it).
    if (!this.unback) this.unback = onBack(() => this.closeAll());
    this.conv = conv;
    this.page = conv.resumeAt || 0;
    this.root.hidden = false;
    this.root.classList.add('open');
    this.root.classList.remove('enter');
    void this.root.offsetWidth;
    this.root.classList.add('enter');
    this.render();
  }

  render() {
    const page = this.conv.pages[this.page];
    const emotion = page.emotion || 'happy';
    this.quizSolved = !page.quiz;
    const friend = this.friend(page.who);
    this.root.className = `bridgy-dialog open emotion-${emotion}${friend ? ' friend' : ''}`;
    this.setPortrait(friend ? friend.portrait : this.portraitFor(emotion));
    this.portraitImg.alt = this.nameEl.textContent = friend ? friend.name : this.i18n.t('ui.bridgyName');
    this.extraEl.replaceChildren();
    if (page.code) {
      const pre = h('pre', { class: 'bridgy-code' });
      pre.append(highlightCode(page.code, this.codeKind));
      this.extraEl.append(pre);
    }
    if (page.node) this.extraEl.append(page.node);
    if (page.options) {
      this.extraEl.append(
        h(
          'div',
          { class: 'bridgy-options' },
          page.options.map((o) => h('button', { class: `btn ${o.class || ''}`, onclick: () => o.onClick() }, o.label)),
        ),
      );
    }
    if (page.quiz) this.extraEl.append(this.quizNode(page.quiz));
    this.renderButtons(page);
    this.type(page.text || '');
    this.point();
  }

  point() {
    const page = this.conv && this.conv.pages[this.page];
    this.onPoint([page && page.text, this.toastNow && this.toastNow.text].filter(Boolean).join('\n'));
  }

  // When the speaker changes in an open dialog, the old picture slides out and the new one
  // slides in once it is decoded.
  setPortrait(src) {
    const img = this.portraitImg;
    const fresh = this.fresh;
    this.fresh = false;
    if (img.getAttribute('src') === src) return;
    clearTimeout(this.swapTimer);
    const show = () => {
      img.src = src;
      img
        .decode()
        .catch(() => {})
        .then(() => img.getAttribute('src') === src && img.classList.remove('swap'));
    };
    img.classList.add('swap');
    if (fresh) show();
    else this.swapTimer = setTimeout(show, 200);
  }

  // Answer buttons for a lesson question: a wrong answer gets an explanation and can be retried;
  // the right one shows the "Next" button.
  quizNode(quiz) {
    const buttons = quiz.answers.map((answer, i) =>
      h(
        'button',
        {
          class: 'btn',
          onclick: () => {
            if (this.quizSolved) return;
            const right = i === quiz.correct;
            buttons[i].classList.add(right ? 'right' : 'wrong');
            this.app.audio.play(right ? 'quest' : 'warn');
            this.type(right ? quiz.right : quiz.wrong);
            if (right) {
              this.quizSolved = true;
              this.renderButtons(this.conv.pages[this.page]);
            }
          },
        },
        answer,
      ),
    );
    return h('div', { class: 'bridgy-options bridgy-quiz' }, buttons);
  }

  renderButtons(page) {
    const t = this.i18n.t;
    const buttons = [];
    if (this.conv.pages.length > 1) {
      buttons.push(h('div', { class: 'page-dots' }, this.conv.pages.map((_, i) => h('span', { class: i === this.page ? 'on' : '' }))));
    }
    for (const b of page.buttons || []) buttons.push(h('button', { class: `btn ${b.class || ''}`, onclick: b.onClick }, b.label));
    if (!page.options && this.quizSolved) {
      const last = this.page >= this.conv.pages.length - 1;
      buttons.push(h('button', { class: 'btn btn-primary', onclick: () => this.next() }, last ? t('ui.gotIt') : t('ui.next')));
    }
    this.buttonsEl.replaceChildren(...buttons);
  }

  type(text) {
    clearInterval(this.timer);
    const instant = this.app.prefs.lowGraphics || this.app.prefs.animations === false;
    if (instant) {
      this.textEl.textContent = text;
      this.typing = null;
      return;
    }
    const chars = [...text];
    let i = 0;
    const caret = h('span', { class: 'caret' });
    const span = document.createTextNode('');
    this.textEl.replaceChildren(span, caret);
    this.root.classList.add('talking');
    this.typing = { text, chars };
    this.timer = setInterval(() => {
      const step = chars.length > 220 ? 3 : 2;
      for (let k = 0; k < step && i < chars.length; k++, i++) {
        span.data += chars[i];
        if (i % 4 === 0 && chars[i].trim()) this.app.audio.blip();
      }
      if (i >= chars.length) this.finishTyping();
    }, 28);
  }

  finishTyping() {
    if (!this.typing) return;
    clearInterval(this.timer);
    this.textEl.textContent = this.typing.text;
    this.typing = null;
    this.root.classList.remove('talking');
  }

  next() {
    if (this.typing) {
      this.finishTyping();
      return;
    }
    if (this.conv && this.page < this.conv.pages.length - 1) {
      this.page++;
      this.render();
    } else this.end();
  }

  end() {
    clearInterval(this.timer);
    this.typing = null;
    const conv = this.conv;
    this.conv = null;
    this.root.hidden = true;
    this.root.classList.remove('open', 'talking');
    if (conv && conv.onDone) conv.onDone();
    if (!this.conv && this.queue.length) this.start(this.queue.shift());
    else if (!this.conv) {
      this.releaseBack();
      this.point();
    }
  }

  releaseBack() {
    if (this.unback) this.unback();
    this.unback = null;
  }

  closeAll() {
    this.queue = [];
    if (this.conv) this.end();
  }

  // One message at a time: the others wait, and the one on show hurries up for them.
  toast(text, ms = 3600) {
    const showing = this.toastNow;
    if ((showing && showing.text === text) || this.toastQueue.some((q) => q.text === text)) return;
    this.toastQueue.push({ text, ms });
    if (this.toastQueue.length > TOAST_QUEUE) this.toastQueue.shift();
    if (!showing) this.nextToast();
    else if (!showing.hiding) this.planToastEnd();
  }

  // Phones: while the student codes (the Code tab is open), messages wait instead of covering the code.
  coding() {
    return mobileQuery.matches && !!document.querySelector('.screen-game:not([hidden])[data-tab="code"]');
  }

  nextToast() {
    clearTimeout(this.waitTimer);
    const wait = this.toastQueue.length && this.coding();
    const next = (this.toastNow = wait ? null : this.toastQueue.shift() || null);
    this.point();
    if (wait) this.waitTimer = setTimeout(() => this.nextToast(), 1000);
    if (!next) return;
    const avatar = document.querySelector('.help-button img');
    if (avatar) {
      avatar.classList.remove('react');
      void avatar.offsetWidth;
      avatar.classList.add('react');
    }
    next.el = h('div', { class: 'bridgy-toast' }, next.text);
    closeOnTap(next.el, () => this.hideToast(next));
    next.shownAt = Date.now();
    this.toasts.append(next.el);
    this.planToastEnd();
  }

  planToastEnd() {
    const now = this.toastNow;
    const ms = this.toastQueue.length ? Math.min(now.ms, TOAST_HURRY) : now.ms;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.hideToast(now), Math.max(0, ms - (Date.now() - now.shownAt)));
  }

  hideToast(now) {
    if (now.hiding) return;
    clearTimeout(this.toastTimer);
    now.hiding = true;
    now.el.classList.add('hide');
    this.toastTimer = setTimeout(() => {
      now.el.remove();
      this.nextToast();
    }, 450);
  }

  pick(key) {
    const list = (this.cfg.reactions && this.cfg.reactions[key]) || [];
    return list.length ? list[Math.floor(Math.random() * list.length)] : '';
  }

  // ------------------------------------------------------------------ content helpers

  explainError(err, described) {
    const t = this.i18n.t;
    const nodes = [];
    if (described.suggestion) nodes.push(h('div', { class: 'bridgy-suggest' }, icon(this.app.sprites, 'bulb'), ' ', described.suggestion));
    if (described.where) {
      nodes.push(
        h(
          'div',
          { class: 'bridgy-where-row' },
          h('span', { class: 'bridgy-error-where' }, described.where),
          err.loc && this.onShowLine ? h('button', { class: 'btn btn-sm', onclick: () => this.onShowLine(err) }, icon(this.app.sprites, 'eye'), ' ', t('ui.showLine')) : null,
        ),
      );
    }
    this.say(
      [{ emotion: 'worried', text: `${this.pick('errorIntro')} ${described.message}`.trim(), node: nodes.length ? h('div', { style: { display: 'grid', gap: '8px' } }, nodes) : null }],
      { interrupt: true, key: 'error', replaceSame: true },
    );
  }

  // who: a friend who gives the hint (only from the help menu); intro: the friend's short line first.
  showHint(hint, quest, who, intro) {
    const t = this.i18n.t;
    if (!hint) return;
    const tier = h('span', { class: 'bridgy-hint-tier' }, `${t('ui.hint')} ${hint.tier + 1}/${quest.hints.length}`);
    const page = { emotion: 'thinking', who, text: who && intro ? this.friendText(who, hint.text) : hint.text, node: tier };
    if (!hint.last) {
      page.buttons = [{ label: [icon(this.app.sprites, 'bulb'), ` ${t('ui.moreHint')}`], class: 'btn-gold', onClick: () => this.helpHint(true, who, false) }];
    }
    this.say([page], { key: 'hint', replaceSame: true, interrupt: true });
  }

  helpHint(fromButton = false, who, intro = true) {
    const ctx = this.getHelpContext();
    const q = ctx.quests.current();
    if (!q) {
      this.say([{ emotion: 'happy', text: this.i18n.t('ui.allQuestsDone') }], { key: 'hint', replaceSame: true, interrupt: fromButton });
      return;
    }
    const hint = ctx.quests.nextHint();
    if (!hint) return;
    this.showHint(hint, q, who, intro);
  }

  // (On the ranch, ctx.ranch: only Bridgy helps, and the book has no plants.)
  helpMenu() {
    const t = this.i18n.t;
    const ctx = this.getHelpContext();
    const q = ctx.quests.current();
    const friend = (id) => (!ctx.ranch && this.friend(id) ? id : undefined);
    const label = (name, text) => [icon(this.app.sprites, name), ` ${text}`];
    const options = [
      {
        label: label('compass', t('ui.helpWhatNow')),
        onClick: () => {
          const who = friend('nshan');
          const text = q ? `${q.title}. ${q.text}` : t('ui.allQuestsDone');
          this.say([{ emotion: 'happy', who, text: who ? this.friendText(who, text) : text }], { key: 'menu', replaceSame: true, interrupt: true });
        },
      },
      { label: label('bulb', t('ui.helpHint')), onClick: () => this.helpHint(true, friend('erik')) },
      ctx.note && {
        label: label('scroll', t('ui.helpNote')),
        onClick: () => {
          const who = this.friend('erik') ? 'erik' : undefined;
          this.say([{ emotion: 'thinking', who, text: who ? this.friendText(who, ctx.note.hint) : ctx.note.hint }], { key: 'menu', replaceSame: true, interrupt: true });
        },
      },
      { label: label('book', t('ui.helpCommands')), onClick: () => this.openBook('commands') },
      { label: label('js', t('ui.helpJs')), onClick: () => this.openBook('js') },
      !ctx.ranch && { label: label('sprout', t('ui.helpPlants')), onClick: () => this.openBook('plants') },
      ctx.hasNotes && { label: label('scroll', t('ui.helpNotes')), onClick: () => this.openBook('notes') },
      {
        label: label('bug', t('ui.helpLastError')),
        onClick: () => {
          if (ctx.lastError) ctx.explainLastError();
          else this.say([{ emotion: 'celebrating', text: t('ui.helpNoError') }], { key: 'menu', replaceSame: true, interrupt: true });
        },
      },
      { label: t('ui.helpClose'), onClick: () => this.end() },
    ].filter(Boolean);
    this.say([{ emotion: 'happy', text: this.pick('helpIntro') || t('ui.helpButton'), options }], { key: 'menu', replaceSame: true, interrupt: true });
  }

  openBook(tab) {
    this.end();
    this.getHelpContext().openBook(tab);
  }
}
