// Bridgy's Farm — entry point: load config, then show the login screen or the player's farm.
import { loadConfig } from './core/config.js';
import { createI18n } from './core/i18n.js';
import { SpriteBook } from './ui/sprites.js';
import { LocalStorageAdapter } from './storage/localStorageAdapter.js';
import { Accounts } from './storage/account.js';
import { LoginScreen, accountErrorText } from './ui/account.js';
import { GameScreen } from './ui/gameScreen.js';
import { GameAudio } from './audio.js';
import { Confetti } from './ui/confetti.js';
import { h } from './ui/dom.js';

// Phones: size the app to the visible area (on iPhone the keyboard only shrinks the visual viewport).
function fitVisualViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const fit = () => {
    document.documentElement.style.setProperty('--app-h', `${vv.height}px`);
    if (vv.offsetTop) window.scrollTo(0, 0);
  };
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
  fit();
}

async function boot() {
  fitVisualViewport();
  const root = document.getElementById('app');
  const loading = document.getElementById('screen-loading');
  let result;
  try {
    result = await loadConfig('config/');
  } catch (e) {
    result = { config: {}, errors: [{ file: 'config', path: '', message: String(e.message || e), fatal: true }] };
  }
  const { config, errors } = result;
  if (errors.length) {
    loading.remove();
    showConfigErrors(root, errors, config.texts);
    return;
  }

  const i18n = createI18n(config.texts, [...config.research.nodes, ...config.village.buildings], config.guide); // names of research cards and village buildings
  document.title = i18n.t('ui.title');
  const sprites = await new SpriteBook().load(config.settings);
  const account = new Accounts(new LocalStorageAdapter(), config.settings.online);
  const toastStack = h('div', { class: 'toast-stack' });
  document.body.append(toastStack);
  const app = {
    config,
    i18n,
    sprites,
    account,
    root,
    audio: new GameAudio(),
    confetti: new Confetti(),
    prefs: { animations: true, lowGraphics: false },
    toast(text, kind = '') {
      const el = h('div', { class: `toast ${kind}` }, text);
      toastStack.append(el);
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
    loading.hidden = true;
    show(
      new GameScreen(app, save, () => {
        app.screen = null;
        account.logout();
        showLogin();
      }),
    );
  }
  loading.hidden = true;
  if (account.user) showGame();
  else showLogin();
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
