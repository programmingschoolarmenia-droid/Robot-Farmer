// Plays the app on a real Android (emulator) and checks it, like tests/play.mjs does in Chrome:
// installs the debug APK, registers a local account, runs a program, checks the game loop, the Code tab,
// that it stays portrait when the phone turns, the on-screen keyboard and a start without internet. Screenshots and the log go to OUT.
// The APK must be a test build (npm run web:test): no live Firebase keys inside.
// Run (with adb and a started emulator): node android-test.mjs <app-debug.apk> [OUT folder]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [APK, OUT = 'android-report'] = process.argv.slice(2);
const APP = 'app.bridgysfarm.game';
const PORT = 9333;
const PROGRAM = 'havaqel();\nhavaqel();\n';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 1 << 26 });
const problems = [];
const notes = [];
mkdirSync(OUT, { recursive: true });

const shot = (name) => writeFileSync(join(OUT, `${name}.png`), execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 1 << 26 }));

// ---- the app's WebView over the DevTools protocol (debug builds allow it)
async function connect() {
  let socket;
  // The socket of this app process (a closed one can still be listed for a moment after a restart).
  for (let i = 0; i < 60 && !socket; i++, await sleep(500)) {
    const pid = adb('shell', `pidof ${APP} || true`).trim(); // (pidof fails while the app is still starting)
    if (pid) socket = adb('shell', 'cat', '/proc/net/unix').match(new RegExp(`@(webview_devtools_remote_${pid})\\b`))?.[1];
  }
  if (!socket) throw new Error('the app WebView did not start');
  adb('forward', `tcp:${PORT}`, `localabstract:${socket}`);
  let page;
  for (let i = 0; i < 30 && !page; i++, await sleep(500)) page = (await (await fetch(`http://127.0.0.1:${PORT}/json`).catch(() => null))?.json().catch(() => null))?.find((t) => t.type === 'page');
  if (!page) throw new Error('no page in the app WebView');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => (ws.addEventListener('open', r), ws.addEventListener('error', j)));
  let id = 0;
  const waiting = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id) {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') problems.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problems.push(`log: ${m.params.entry.text} ${m.params.entry.url || ''}`);
  });
  const cmd = (method, params = {}) => new Promise((resolve, reject) => (waiting.set(++id, { resolve, reject }), ws.send(JSON.stringify({ id, method, params }))));
  const evaluate = async (expression) => {
    const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expression, what, ms = 30000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if (await evaluate(expression).catch(() => false)) return;
    throw new Error(`timed out waiting for ${what}`);
  };
  await cmd('Runtime.enable');
  await cmd('Log.enable');
  await cmd('Page.enable');
  await cmd('Page.reload'); // from the start, now that errors are being collected
  await sleep(1000);
  return { cmd, evaluate, waitFor, close: () => ws.close() };
}

const start = async () => {
  adb('shell', 'am', 'force-stop', APP);
  adb('shell', 'am', 'start', '-W', '-n', `${APP}/.MainActivity`);
  return connect();
};
const loopFrames = (p) => p.evaluate(`new Promise((r) => { const a = bridgysFarm.screen.raf; setTimeout(() => r(bridgysFarm.screen.raf - a), 2000); })`);
const fontsLoaded = `Promise.all([document.fonts.load('16px "Noto Sans Armenian"', 'Բ'), document.fonts.load('16px "JetBrains Mono"', 'a')]).then((f) => f.every((x) => x.length > 0))`;
const rotate = (landscape) => {
  adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0');
  adb('shell', 'settings', 'put', 'system', 'user_rotation', landscape ? '1' : '0');
};
const step = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    problems.push(`${name}: ${e.message}`);
  }
};

let p;
// A busy emulator often shows "Pixel Launcher isn't responding" (the home screen, not the game);
// that window would cover the screenshots and take the keyboard, so Android is told not to show it.
adb('shell', 'settings', 'put', 'secure', 'anr_show_background', '0');
adb('shell', 'settings', 'put', 'global', 'hide_error_dialogs', '1');
adb('install', '-r', '-g', APK);
rotate(false);
await step('start', async () => {
  p = await start();
  await p.waitFor(`!!document.querySelector('.login-tab')`, 'the login screen');
  notes.push(`screen: ${await p.evaluate(`JSON.stringify({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ua: navigator.userAgent.match(/Chrome\\/[\\d.]+/)?.[0] })`)}`);
  notes.push(`fonts inside the app: ${await p.evaluate(fontsLoaded)}`);
  shot('1-login');
});

await step('farm', async () => {
  await p.evaluate(`(() => {
    document.querySelector('.login-tab[data-tab=register]').click();
    const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('input[autocomplete=username]', 'playtest');
    set('input[type=password]', 'secret123');
    document.querySelector('.login-submit').click();
  })()`);
  await p.waitFor(`!!(window.bridgysFarm.screen && window.bridgysFarm.screen.game)`, 'the farm');
  await sleep(1500);
  shot('2-farm');
  await p.evaluate(`(() => { const s = bridgysFarm.screen; s.editor.setCode(s.game.activeScript, ${JSON.stringify(PROGRAM)}); s.run(); })()`);
  await sleep(3000);
  const r = await p.evaluate(`(() => { const c = bridgysFarm.screen.editor.console.body; return { ok: !!c.querySelector('.console-line.ok'), errors: c.querySelectorAll('.console-line.error').length, log: c.innerText.trim().slice(-300) }; })()`);
  if (!r.ok || r.errors) problems.push(`the program did not finish cleanly; console: ${r.log}`);
  const frames = await loopFrames(p);
  notes.push(`frames per second on the farm (emulator, not a real phone's speed): ${frames / 2}`);
  if (frames < 10) problems.push(`game loop stopped (${frames} frames in 2 s)`);
  if (await p.evaluate(`document.documentElement.scrollWidth > innerWidth`)) problems.push('the page scrolls sideways');
});

await step('code tab', async () => {
  await p.evaluate(`bridgysFarm.screen.setTab('code')`);
  await sleep(800);
  shot('3-code');
  const code = await p.evaluate(`(() => {
    const inView = (r) => r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
    const bar = document.querySelector('.screen-game .symbol-bar');
    const clear = document.querySelector('.screen-game .console-head button');
    if (!bar || !clear) return { missing: !bar ? 'symbol keys' : 'console clear button' };
    return { bar: inView(bar.getBoundingClientRect()), clear: inView(clear.getBoundingClientRect()) };
  })()`);
  if (code.missing) problems.push(`Code tab: no ${code.missing}`);
  else if (!code.bar || !code.clear) problems.push(`Code tab: ${!code.bar ? 'symbol keys' : "console's clear button"} off screen`);
});

// A real tap on the editor: does Android's keyboard open, and does the game notice (.keyboard)?
await step('keyboard', async () => {
  const at = await p.evaluate(`(() => { const r = document.querySelector('.screen-game .CodeMirror').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 20 }; })()`);
  for (const type of ['touchStart', 'touchEnd']) await p.cmd('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: at.x, y: at.y }] });
  await sleep(2000);
  const shown = /mInputShown=true|isInputViewShown=true/.test(adb('shell', 'dumpsys', 'input_method'));
  const game = await p.evaluate(`({ keyboard: document.documentElement.classList.contains('keyboard'), h: innerHeight })`);
  notes.push(`keyboard: Android shows it ${shown}, the game sees it ${game.keyboard}, page height with it ${game.h}`);
  if (shown && !game.keyboard) problems.push('the keyboard is open but the game does not notice it (bars may cover the editor)');
  shot('4-keyboard');
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); // closes the keyboard
  await sleep(1000);
  await p.evaluate(`(document.activeElement && document.activeElement.blur(), bridgysFarm.screen.setTab('farm'))`);
});

// The app is portrait only (AndroidManifest.xml): turning the phone must not turn the game.
await step('turned phone', async () => {
  rotate(true);
  await sleep(3000);
  shot('5-turned');
  const size = await p.evaluate(`innerWidth + '×' + innerHeight`);
  notes.push(`phone turned sideways: page ${size}`);
  if (await p.evaluate(`innerWidth > innerHeight`)) problems.push(`the game turned to landscape (${size}), it must stay portrait`);
  if ((await loopFrames(p)) < 10) problems.push('turned phone: game loop stopped');
  rotate(false);
  await sleep(1500);
});

// No internet at all: the app must still open (its files and fonts are inside) and continue the farm.
await step('offline', async () => {
  p.close();
  adb('shell', 'svc', 'wifi', 'disable');
  adb('shell', 'svc', 'data', 'disable');
  await sleep(1500);
  p = await start();
  await p.waitFor(`!!document.querySelector('.login-submit, .login-tab')`, 'the start screen without internet');
  notes.push(`fonts without internet: ${await p.evaluate(fontsLoaded)}`);
  shot('6-offline');
});
adb('shell', 'svc', 'wifi', 'enable');
adb('shell', 'svc', 'data', 'enable');

writeFileSync(join(OUT, 'logcat.txt'), adb('logcat', '-d', '-v', 'time'));
const crash = adb('logcat', '-d', '-b', 'crash');
if (crash.trim()) problems.push(`the app crashed:\n${crash.slice(0, 2000)}`);
const report = [...notes.map((n) => `• ${n}`), '', problems.length ? `✕ ${problems.length} problem(s):` : '✓ no problems', ...problems.map((x) => `  - ${x}`)].join('\n');
writeFileSync(join(OUT, 'report.txt'), report);
console.log(report);
p?.close();
process.exit(problems.length ? 1 : 0);
