// Shared, safe way to open the game in headless Chrome (used by tests/play.mjs and the tester agent).
// firebase: 'blocked' (default) serves settings.json with empty keys and blocks Google/Firebase (local accounts);
//           'fake' serves keys test-key/test-project and answers every Firebase request from tests/fakeFirebase.mjs;
//           'live' opens the given url as it is (the real site; only with the test accounts, see .claude/agents/tester.md).
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createFakeFirebase } from './fakeFirebase.mjs';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2' };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A small static server (python's drops connections when many modules load at once).
// root: the game folder (default: this repo; pass another for an old copy made with git archive).
export async function startServer({ root = fileURLToPath(new URL('..', import.meta.url)), firebase = 'blocked' } = {}) {
  const keys = firebase === 'fake' ? { apiKey: 'test-key', projectId: 'test-project' } : { apiKey: '', projectId: '' };
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(root, path.endsWith('/') ? `${path}index.html` : path);
    try {
      let body = await readFile(file);
      if (path === '/config/settings.json') {
        const s = JSON.parse(body);
        s.online = { ...s.online, ...keys };
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
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}

// Chrome over the DevTools protocol (Node's built-in WebSocket, no dependencies).
export async function launchChrome() {
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
  const close = async () => {
    ws.close();
    chrome.kill();
    await sleep(300);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  };
  return { send, listeners, close };
}

// Opens one clean page (its own localStorage). Exceptions and console errors land in page.problems.
// fake: a createFakeFirebase() to share between pages (two players on one fake project); made if missing.
// userAgent: e.g. an Android one for phone typing tests.
export async function openPage(chrome, { url, width = 1366, height = 768, firebase = 'blocked', fake, userAgent } = {}) {
  const { send, listeners } = chrome;
  const problems = [];
  const { browserContextId } = await send('Target.createBrowserContext');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cmd = (method, params) => send(method, params, sessionId);
  if (firebase === 'fake') fake ||= createFakeFirebase();
  listeners.push(async (m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') problems.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problems.push(`log: ${m.params.entry.text} ${m.params.entry.url || ''}`);
    if (m.method === 'Fetch.requestPaused') answerFake(cmd, fake, m.params);
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
  const screenshot = async (file) => {
    const { data } = await cmd('Page.captureScreenshot');
    await writeFile(file, Buffer.from(data, 'base64'));
  };

  const phone = width < 1024 || height < 600;
  await cmd('Runtime.enable');
  await cmd('Log.enable');
  await cmd('Network.enable');
  if (firebase === 'blocked') await cmd('Network.setBlockedURLs', { urls: ['*googleapis*', '*firebase*'] });
  if (firebase === 'fake') {
    // Firebase's own hosts go to the fake; anything else of Google's (fonts) is blocked as in 'blocked' mode.
    // Note: the fake answers 404 for docs that don't exist yet (deleted/<name>, a new save), as real Firestore does.
    await cmd('Fetch.enable', { patterns: ['identitytoolkit', 'securetoken', 'firestore'].map((h) => ({ urlPattern: `*${h}.googleapis.com*` })) });
    await cmd('Network.setBlockedURLs', { urls: ['*fonts.googleapis*', '*firebaseio*', '*firebaseapp*'] });
  }
  if (userAgent) await cmd('Emulation.setUserAgentOverride', { userAgent });
  await cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: phone });
  if (phone) await cmd('Emulation.setTouchEmulationEnabled', { enabled: true });
  await cmd('Page.navigate', { url });
  return { cmd, evaluate, waitFor, screenshot, problems, phone, fake, close: () => send('Target.disposeBrowserContext', { browserContextId }) };
}

// Answers one intercepted Firebase request from the fake (CORS preflights included).
async function answerFake(cmd, fake, { requestId, request }) {
  const cors = [
    { name: 'Access-Control-Allow-Origin', value: '*' },
    { name: 'Access-Control-Allow-Headers', value: '*, Authorization, Content-Type' },
    { name: 'Access-Control-Allow-Methods', value: 'GET, POST, PATCH, DELETE, OPTIONS' },
  ];
  try {
    if (request.method === 'OPTIONS') return await cmd('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: cors });
    const headers = {};
    for (const [k, v] of Object.entries(request.headers)) headers[k.toLowerCase() === 'authorization' ? 'Authorization' : k] = v;
    const res = await fake.handle(request.url, { method: request.method, headers, body: request.postData });
    const body = Buffer.from(await res.text()).toString('base64');
    await cmd('Fetch.fulfillRequest', { requestId, responseCode: res.status, responseHeaders: [...cors, { name: 'Content-Type', value: 'application/json' }], body });
  } catch {
    await cmd('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' }).catch(() => {});
  }
}
