// Settings window: language, sounds, font size, low graphics, grid, the privacy page; log out.
import { h, icon } from './dom.js';
import { openModal } from './modal.js';
import { LANGS } from '../core/i18n.js';

// Each language named in itself, so a player who can't read the current one still finds theirs.
const LANG_NAMES = { hy: ['Հայ', 'Հայերեն'], en: ['Eng', 'English'], ru: ['Рус', 'Русский'] };
export function langSwitch(app, onPick) {
  return h(
    'div',
    { class: 'seg lang-seg', role: 'group' },
    LANGS.map((l) =>
      h('button', { type: 'button', lang: l, title: LANG_NAMES[l][1], class: app.lang === l ? 'active' : '', onclick: () => l !== app.lang && onPick(l) }, LANG_NAMES[l][0]),
    ),
  );
}

// The privacy policy and the game's rules (privacy.html: the same page Google Play links to), inside
// the game, in the game's language; part: 'rules' opens at the rules.
export function openPrivacy(app, part = '') {
  const t = app.i18n.t;
  openModal({
    title: t('ui.privacy'),
    width: 'min(720px, calc(100vw - 32px))',
    body: h('iframe', { class: 'privacy-frame', src: `privacy.html?lang=${app.lang}${part ? `#${part}` : ''}`, title: t('ui.privacy') }),
    buttons: [{ label: t('ui.close'), class: 'btn-primary' }],
  });
}

export function openSettings({ app, prefs, onChange, onLogout, onLang }) {
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
      row(t('ui.language'), langSwitch(app, onLang)),
      row(t('ui.sfx'), range('sfxVolume')),
      row(t('ui.music'), range('musicVolume')),
      row(t('ui.blips'), toggle('blips')),
      row(t('ui.fontSize'), seg),
      row(t('ui.lowGraphics'), toggle('lowGraphics')),
      row(t('ui.showGrid'), toggle('showGrid')),
      h('button', { class: 'link-quiet', onclick: () => openPrivacy(app) }, t('ui.privacy')),
    ],
    buttons: [
      { label: t('ui.logout'), class: 'btn-danger', onClick: (close) => (close(), onLogout()) },
      { label: t('ui.close'), class: 'btn-primary', onClick: (close) => close() },
    ],
  });
}
