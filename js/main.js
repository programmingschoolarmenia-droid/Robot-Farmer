// Bridgy's Farm — entry point: load config, then show the login screen or the player's farm.
import { loadConfig } from './core/config.js';
import { createI18n, pickLang, LANGS } from './core/i18n.js';
import { SpriteBook } from './ui/sprites.js';
import { LocalStorageAdapter } from './storage/localStorageAdapter.js';
import { Accounts } from './storage/account.js';
import { LoginScreen, accountErrorText } from './ui/account.js';
import { GameScreen } from './ui/gameScreen.js';
import { GameAudio } from './audio.js';
import { Confetti } from './ui/confetti.js';
import { h, closeOnTap } from './ui/dom.js';
import { WORDS } from './core/util.js';

// Phones: size the app to the visible area (on iPhone the keyboard only shrinks the visual viewport), and
// know whether the keyboard is really open: it can be closed while the editor keeps the focus.
function fitVisualViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const tallest = new Map(); // the visible height at each width, without the keyboard
  const fit = () => {
    if (vv.scale > 1.01) return; // pinch zoom doesn't change the app
    const width = Math.round(vv.width);
    tallest.set(width, Math.max(tallest.get(width) || 0, vv.height));
    root.style.setProperty('--app-h', `${vv.height}px`);
    root.classList.toggle('keyboard', touch && vv.height < tallest.get(width) * 0.8);
    if (vv.offsetTop || window.scrollY) window.scrollTo(0, 0); // (a page left scrolled hides the bottom bars)
  };
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
  fit();
}

// The language: ?lang= (this visit only), this tab's (an account's own language, see showGame), the browser's choice.
const LANG_KEY = 'bridgysFarm.lang';
const ENTER_KEY = 'bridgysFarm.enter'; // after a switch inside the game, go straight back to the farm
const stored = (storage, value, key = LANG_KEY) => {
  try {
    if (value === undefined) return storage.getItem(key);
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    return null; // storage blocked: the language just isn't remembered
  }
  return null;
};
const urlLang = new URLSearchParams(location.search).get('lang');
const lang = pickLang({
  chosen: urlLang || stored(sessionStorage) || stored(localStorage),
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  languages: navigator.languages || [navigator.language],
});
// A new language reloads the game (every text is read once at start). enter: open the farm again after it.
function switchLang(to, { thisTab = false, enter = false } = {}) {
  if (!LANGS.includes(to)) return;
  if (enter) stored(sessionStorage, '1', ENTER_KEY);
  if (thisTab) stored(sessionStorage, to);
  else {
    stored(localStorage, to);
    stored(sessionStorage, null);
  }
  if (urlLang) location.replace(location.pathname);
  else location.reload();
}

async function boot() {
  fitVisualViewport();
  document.documentElement.lang = lang;
  const root = document.getElementById('app');
  const loading = document.getElementById('screen-loading');
  let result;
  try {
    result = await loadConfig('config/', lang);
  } catch (e) {
    result = { config: {}, errors: [{ file: 'config', path: '', message: String(e.message || e), fatal: true }] };
  }
  const { config, errors } = result;
  if (errors.length) {
    loading.remove();
    showConfigErrors(root, errors, config.texts);
    return;
  }

  const i18n = createI18n(config.texts, [...config.research.nodes, ...config.village.buildings], config.guide, lang); // names of research cards and village buildings
  document.title = i18n.t('ui.title');
  Object.assign(WORDS, i18n.get('ui.engineWords'));
  const sprites = await new SpriteBook().load(config.settings);
  const account = new Accounts(new LocalStorageAdapter(), config.settings.online);
  const toastStack = h('div', { class: 'toast-stack' });
  document.body.append(toastStack);
  const app = {
    config,
    i18n,
    lang,
    switchLang,
    sprites,
    account,
    root,
    audio: new GameAudio(),
    confetti: new Confetti(),
    prefs: { animations: true, lowGraphics: false },
    toast(text, kind = '') {
      const el = h('div', { class: `toast ${kind}` }, text);
      toastStack.append(el);
      closeOnTap(el, () => el.remove());
      setTimeout(() => el.remove(), 3500);
    },
  };
  window.bridgysFarm = app; // handy for teachers/debugging in the browser console

  const show = (screen) => {
    if (app.screen) app.screen.destroy();
    app.screen = screen;
  };
  const showLogin = (notice) => show(new LoginScreen(app, showGame, notice));
  async function showGame() {
    show(null);
    loading.hidden = false;
    let save;
    try {
      save = await account.loadSave();
    } catch (e) {
      if (e.code === 'relogin') account.logout();
      loading.hidden = true;
      showLogin(accountErrorText(i18n, e));
      return;
    }
    // The player chose a language on another computer: this tab follows it.
    const own = save && save.ui && save.ui.prefs && save.ui.prefs.lang;
    if (LANGS.includes(own) && own !== lang && !urlLang) return switchLang(own, { thisTab: true, enter: true });
    loading.hidden = true;
    show(
      new GameScreen(app, save, (notice) => {
        app.screen = null;
        stored(sessionStorage, null);
        account.logout();
        showLogin(notice);
      }),
    );
  }
  loading.hidden = true;
  const enter = stored(sessionStorage, undefined, ENTER_KEY);
  stored(sessionStorage, null, ENTER_KEY);
  if (enter && account.user) showGame();
  else showLogin(); // (a player still logged in gets «Continue as …» there)
}

function showConfigErrors(root, errors, texts) {
  const ui = (texts && texts.ui) || {};
  const isFile = location.protocol === 'file:';
  const list = h(
    'ul',
    { class: 'error-list' },
    errors.map((e) => h('li', {}, h('div', { class: 'where' }, `${e.file}${e.path ? ` → ${e.path}` : ''}`), h('div', {}, e.message))),
  );
  root.append(
    h(
      'section',
      { class: 'screen screen-error' },
      h(
        'div',
        { class: 'error-card' },
        h('img', { src: 'assets/bridgy/bridgy.png', alt: '' }),
        h(
          'div',
          {},
          h('h1', {}, ui.loadError || 'Խաղը չհաջողվեց բեռնել'),
          h('p', {}, isFile ? ui.serverHint || 'Խաղը պետք է բացել սերվերով (օրինակ՝ python3 -m http.server)։' : ui.loadErrorHint || ''),
          list,
        ),
      ),
    ),
  );
}

boot().catch((e) => {
  console.error(e);
  const root = document.getElementById('app');
  const loading = document.getElementById('screen-loading');
  if (loading) loading.remove();
  showConfigErrors(root, [{ file: 'js', path: '', message: String((e && e.stack) || e) }], null);
});
