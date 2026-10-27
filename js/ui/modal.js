// Simple modal dialogs (confirm / ask for text / custom content).
import { h } from './dom.js';

export function openModal({ title, body, buttons = [], onClose, width, className = '' }) {
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose();
  };
  const onKey = (e) => {
    // Escape closes only the top window (e.g. a player card over the profile).
    if (e.key !== 'Escape' || [...document.querySelectorAll('.modal-backdrop')].pop() !== backdrop) return;
    e.stopPropagation();
    close();
  };
  const foot = buttons.length
    ? h(
        'div',
        { class: 'modal-foot' },
        buttons.map((b) =>
          h('button', { class: `btn ${b.class || ''}`, onclick: () => (b.onClick ? b.onClick(close) : close()) }, b.label),
        ),
      )
    : null;
  const modal = h(
    'div',
    { class: `modal ${className}`, role: 'dialog', 'aria-modal': 'true', style: width ? { width } : null },
    h('div', { class: 'modal-head' }, h('span', {}, title), h('span', { class: 'spacer' }), h('button', { class: 'btn btn-ghost btn-sm', onclick: close, 'aria-label': '×' }, '✕')),
    h('div', { class: 'modal-body' }, body),
    foot,
  );
  const backdrop = h('div', { class: 'modal-backdrop', onmousedown: (e) => e.target === backdrop && close() }, modal);
  document.body.append(backdrop);
  document.addEventListener('keydown', onKey, true);
  return { close, modal };
}

export function confirmModal(i18n, { title, text, okLabel, okClass = 'btn-danger' }) {
  return new Promise((resolve) => {
    let answered = false;
    openModal({
      title,
      body: h('p', { style: { margin: 0, lineHeight: 1.5 } }, text),
      buttons: [
        { label: i18n.t('ui.cancel'), onClick: (close) => close() },
        {
          label: okLabel || 'OK',
          class: okClass,
          onClick: (close) => {
            answered = true;
            close();
          },
        },
      ],
      onClose: () => resolve(answered),
    });
  });
}

export function askText(i18n, { title, label, value = '', validate }) {
  return new Promise((resolve) => {
    let result = null;
    const input = h('input', { class: 'input', value, maxlength: '40' });
    const err = h('div', { class: 'form-error' });
    const submit = (close) => {
      const v = input.value.trim();
      const msg = validate ? validate(v) : null;
      if (msg) {
        err.textContent = msg;
        input.focus();
        return;
      }
      result = v;
      close();
    };
    const { close } = openModal({
      title,
      body: [h('label', { style: { fontWeight: 700 } }, label), input, err],
      buttons: [
        { label: i18n.t('ui.cancel'), onClick: (c) => c() },
        { label: 'OK', class: 'btn-primary', onClick: submit },
      ],
      onClose: () => resolve(result),
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit(close);
    });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 30);
  });
}
