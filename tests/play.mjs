// Browser play-through: opens the game in headless Chrome at a desktop, a phone and a landscape phone size,
// registers a local account, runs a tiny program and checks that nothing broke.
// Run: npm run play   (CHROME=/path/to/chrome to choose the browser, SHOTS=<folder> to save screenshots)
// Safe with the live keys: settings.json is served with empty Firebase keys (local accounts only),
// and any request to Google/Firebase is blocked as well.
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SIZES = [
  [1366, 768],
  [390, 844],
  [844, 390],
];
const PROGRAM = 'havaqel();\nhavaqel();\n';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- a small static server (python's drops connections when many modules load at once)
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, path.endsWith('/') ? `${path}index.html` : path);
  try {
    let body = await readFile(file);
    if (path === '/config/settings.json') {
      const s = JSON.parse(body);
      s.online = { ...s.online, apiKey: '', projectId: '' };
      body = JSON.stringify(s);
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

// ---------- Chrome over the DevTools protocol (Node's built-in WebSocket, no dependencies)
const chromePath =
  process.env.CHROME ||
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
if (!chromePath) throw new Error('Chrome not found: set CHROME=/path/to/chrome');
const profile = await mkdtemp(join(tmpdir(), 'bridgy-play-'));
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-sandbox', '--mute-audio', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let err = '';
  chrome.stderr.on('data', (d) => {
    err += d;
    const m = err.match(/ws:\/\/\S+/);
    if (m) resolve(m[0]);
  });
  chrome.on('exit', () => reject(new Error(`Chrome exited:\n${err}`)));
});
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let nextId = 0;
const waiting = new Map();
const listeners = [];
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && waiting.has(msg.id)) {
    const { resolve, reject } = waiting.get(msg.id);
    waiting.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  } else for (const l of listeners) l(msg);
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

// ---------- one play-through at one screen size; returns the problems found
async function play(width, height) {
  const problems = [];
  const { browserContextId } = await send('Target.createBrowserContext'); // clean localStorage each time
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cmd = (method, params) => send(method, params, sessionId);
  listeners.push((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') problems.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problems.push(`log: ${m.params.entry.text} ${m.params.entry.url || ''}`);
  });
  const evaluate = async (expression) => {
    const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expression, what, ms = 15000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await evaluate(expression)) return;
    throw new Error(`timed out waiting for ${what}`);
  };

  const phone = width < 1024 || height < 600;
  await cmd('Runtime.enable');
  await cmd('Log.enable');
  await cmd('Network.enable');
  await cmd('Network.setBlockedURLs', { urls: ['*googleapis*', '*firebase*'] });
  await cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: phone });
  if (phone) await cmd('Emulation.setTouchEmulationEnabled', { enabled: true });
  await cmd('Page.navigate', { url });

  try {
    await waitFor(`!!document.querySelector('.login-tab')`, 'the login screen');
    await evaluate(`(() => {
      document.querySelector('.login-tab[data-tab=register]').click();
      const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
      set('input[autocomplete=username]', 'playtest');
      set('input[type=password]', 'secret123');
      document.querySelector('.login-submit').click();
    })()`);
    await waitFor(`!!(window.bridgysFarm.screen && window.bridgysFarm.screen.game)`, 'the farm');
    await sleep(500);

    // A tiny program: it must run, and the game's own rAF loop must keep going after it.
    await evaluate(`(() => { const s = bridgysFarm.screen; s.editor.setCode(s.game.activeScript, ${JSON.stringify(PROGRAM)}); s.run(); })()`);
    const before = await evaluate(`bridgysFarm.screen.raf`);
    await sleep(2000);
    const after = await evaluate(`(() => { const c = bridgysFarm.screen.editor.console.body; return { raf: bridgysFarm.screen.raf, finished: !!c.querySelector('.console-line.ok'), errors: c.querySelectorAll('.console-line.error').length, log: c.innerText.trim().slice(-300) }; })()`);
    if (after.raf - before < 10) problems.push(`game loop stopped (${after.raf - before} frames in 2 s)`);
    if (!after.finished || after.errors) problems.push(`the program did not finish cleanly; console: ${after.log}`);
    if (await evaluate(`document.documentElement.scrollWidth > innerWidth`)) problems.push('the page scrolls sideways');

    if (phone) {
      // Code tab: the symbol keys scroll to the last one, and the console's clear button shows.
      await evaluate(`bridgysFarm.screen.setTab('code')`);
      await sleep(400);
      const code = await evaluate(`(() => {
        const inView = (r) => r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
        const bar = document.querySelector('.screen-game .symbol-bar');
        const clear = document.querySelector('.screen-game .console-head button');
        if (!bar || !clear) return { missing: !bar ? 'symbol keys' : 'console clear button' };
        bar.scrollLeft = bar.scrollWidth;
        const keys = bar.querySelectorAll('.sym');
        const last = keys[keys.length - 1].getBoundingClientRect();
        return { barInView: inView(bar.getBoundingClientRect()), lastKey: inView(last) && last.right <= bar.getBoundingClientRect().right + 1, clear: inView(clear.getBoundingClientRect()) };
      })()`);
      if (code.missing) problems.push(`Code tab: no ${code.missing}`);
      else {
        if (!code.barInView) problems.push('Code tab: symbol keys are off screen');
        if (!code.lastKey) problems.push('Code tab: the symbol keys do not scroll to the last one');
        if (!code.clear) problems.push("Code tab: the console's clear button is hidden");
      }
      await evaluate(`bridgysFarm.screen.setTab('farm')`);
    }
    const loop = await evaluate(`new Promise((r) => { const a = bridgysFarm.screen.raf; setTimeout(() => r(bridgysFarm.screen.raf - a), 1000); })`);
    if (loop < 5) problems.push('game loop stopped after switching tabs');
  } catch (e) {
    problems.push(e.message);
  }
  if (process.env.SHOTS) {
    const { data } = await cmd('Page.captureScreenshot');
    await writeFile(join(process.env.SHOTS, `play-${width}x${height}.png`), Buffer.from(data, 'base64'));
  }
  await send('Target.disposeBrowserContext', { browserContextId });
  return problems;
}

let failed = 0;
try {
  for (const [w, h] of SIZES) {
    const problems = await play(w, h);
    console.log(`${problems.length ? '✕' : '✓'} ${w}×${h}${problems.map((p) => `\n    ${p}`).join('')}`);
    if (problems.length) failed++;
  }
} finally {
  ws.close();
  chrome.kill();
  server.close();
  await sleep(300);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
process.exit(failed ? 1 : 0);
