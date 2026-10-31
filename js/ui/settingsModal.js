// Settings window: sounds, font size, low graphics, grid; log out.
import { h, icon } from './dom.js';
import { openModal } from './modal.js';

export function openSettings({ app, prefs, onChange, onLogout }) {
  const t = app.i18n.t;
  const set = (key, value) => {
    prefs[key] = value;
    onChange(prefs);
  };
  const toggle = (key) => {
    const btn = h('button', {
      class: `toggle ${prefs[key] ? 'on' : ''}`,
      role: 'switch',
      'aria-checked': String(!!prefs[key]),
      onclick: () => {
        set(key, !prefs[key]);
        btn.classList.toggle('on', !!prefs[key]);
        btn.setAttribute('aria-checked', String(!!prefs[key]));
      },
    });
    return btn;
  };
  const range = (key) =>
    h('input', {
      type: 'range',
      min: '0',
      max: '1',
      step: '0.05',
      value: String(prefs[key] ?? 0),
      oninput: (e) => set(key, Number(e.target.value)),
    });
  const sizes = [
    ['small', t('ui.fontSmall')],
    ['normal', t('ui.fontNormal')],
    ['large', t('ui.fontLarge')],
  ];
  const seg = h('div', { class: 'seg' });
  const renderSeg = () =>
    seg.replaceChildren(
      ...sizes.map(([k, label]) =>
        h(
          'button',
          {
            class: prefs.fontSize === k ? 'active' : '',
            onclick: () => {
              set('fontSize', k);
              renderSeg();
            },
          },
          label,
        ),
      ),
    );
  renderSeg();
  const row = (label, control) => h('div', { class: 'setting-row' }, h('span', {}, label), control);
  openModal({
    title: [icon(app.sprites, 'gear'), ` ${t('ui.settingsTitle')}`],
    body: [
      row(t('ui.sfx'), range('sfxVolume')),
      row(t('ui.music'), range('musicVolume')),
      row(t('ui.blips'), toggle('blips')),
      row(t('ui.fontSize'), seg),
      row(t('ui.lowGraphics'), toggle('lowGraphics')),
      row(t('ui.showGrid'), toggle('showGrid')),
    ],
    buttons: [
      { label: t('ui.logout'), class: 'btn-danger', onClick: (close) => (close(), onLogout()) },
      { label: t('ui.close'), class: 'btn-primary', onClick: (close) => close() },
    ],
  });
}
