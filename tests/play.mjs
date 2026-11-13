// Browser play-through: opens the game in headless Chrome in every language at a desktop, a phone, a small
// phone and a landscape phone size, registers a local account, runs a tiny program and checks that nothing broke.
// Run: npm run play   (CHROME=/path/to/chrome to choose the browser, SHOTS=<folder> to save screenshots,
//                      LANGS=ru to test one language)
// Safe with the live keys: settings.json is served with empty Firebase keys (local accounts only),
// and any request to Google/Firebase is blocked as well.
import { join } from 'node:path';
import { startServer, launchChrome, openPage, sleep } from './browser.mjs';

const SIZES = [
  [1366, 768],
  [390, 844],
  [320, 640],
  [844, 390],
];
const LANGS = (process.env.LANGS || 'hy,en,ru').split(',');
const PROGRAM = { hy: 'havaqel();\nhavaqel();\n', en: 'gather();\ngather();\n', ru: 'sobrat();\nsobrat();\n' }; // each language's own names
const server = await startServer();
const chrome = await launchChrome();

// ---------- one play-through at one screen size; returns the problems found
// Text that doesn't fit its button or tab, and Armenian letters left in another language.
const LOOK = (lang) => `(() => {
  const out = [];
  for (const el of document.querySelectorAll('button, .btn, .login-tab, .panel-head')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const range = document.createRange();
    range.selectNodeContents(el);
    const t = range.getBoundingClientRect(); // the text itself: it may use the padding, not leave the box
    const clipped = getComputedStyle(el).overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 2;
    if (clipped || t.left < r.left - 2 || t.right > r.right + 2) out.push('text cut off: «' + el.innerText.trim().slice(0, 30) + '»');
  }
  if (${JSON.stringify(lang)} !== 'hy') {
    const seg = document.querySelector('.lang-seg');
    const text = document.body.innerText.replace(seg ? seg.innerText : '', '');
    const m = text.match(/[^\\n]{0,20}[\\u0531-\\u058A][^\\n]{0,20}/);
    if (m) out.push('Armenian text left: «' + m[0] + '»');
  }
  return [...new Set(out)].slice(0, 6);
})()`;

async function play(lang, width, height) {
  const { evaluate, waitFor, screenshot, problems, phone, close } = await openPage(chrome, { url: `${server.url}?lang=${lang}`, width, height });

  try {
    await waitFor(`!!document.querySelector('.login-tab')`, 'the login screen');
    if ((await evaluate('document.documentElement.lang')) !== lang) problems.push(`the page is not in ${lang}`);
    for (const p of await evaluate(LOOK(lang))) problems.push(`start screen: ${p}`);
    await evaluate(`(() => {
      document.querySelector('.login-tab[data-tab=register]').click();
      const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
      set('input[autocomplete=username]', 'playtest');
      set('input[type=password]', 'secret123');
      document.querySelector('.login-submit').click();
    })()`);
    await waitFor(`!!(window.bridgysFarm.screen && window.bridgysFarm.screen.game)`, 'the farm');
    await sleep(500);
    for (const p of await evaluate(LOOK(lang))) problems.push(`farm: ${p}`);

    // A tiny program: it must run, and the game's own rAF loop must keep going after it.
    await evaluate(`(() => { const s = bridgysFarm.screen; s.editor.setCode(s.game.activeScript, ${JSON.stringify(PROGRAM[lang])}); s.run(); })()`);
    const before = await evaluate(`bridgysFarm.screen.raf`);
    await sleep(2000);
    const after = await evaluate(`(() => { const c = bridgysFarm.screen.editor.console.body; return { raf: bridgysFarm.screen.raf, finished: !!c.querySelector('.console-line.ok'), errors: c.querySelectorAll('.console-line.error').length, log: c.innerText.trim().slice(-300) }; })()`);
    if (after.raf - before < 10) problems.push(`game loop stopped (${after.raf - before} frames in 2 s)`);
    if (!after.finished || after.errors) problems.push(`the program did not finish cleanly; console: ${after.log}`);
    if (await evaluate(`document.documentElement.scrollWidth > innerWidth`)) problems.push('the page scrolls sideways');

    if (phone) {
      // Code tab: the symbol keys scroll to the last one; the console's button opens it, and its clear button shows.
      await evaluate(`bridgysFarm.screen.setTab('code')`);
      await sleep(400);
      const code = await evaluate(`(() => {
        const inView = (r) => r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
        const bar = document.querySelector('.screen-game .symbol-bar');
        const toggle = document.querySelector('.screen-game .console-toggle');
        if (!bar || !toggle) return { missing: !bar ? 'symbol keys' : 'console button' };
        if (!inView(toggle.getBoundingClientRect())) return { missing: 'console button on screen' };
        toggle.click();
        const clear = document.querySelector('.screen-game .console-head button');
        bar.scrollLeft = bar.scrollWidth;
        const keys = bar.querySelectorAll('.sym');
        const last = keys[keys.length - 1].getBoundingClientRect();
        const shown = { barInView: inView(bar.getBoundingClientRect()), lastKey: inView(last) && last.right <= bar.getBoundingClientRect().right + 1, clear: inView(clear.getBoundingClientRect()) };
        toggle.click();
        return shown;
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
    await screenshot(join(process.env.SHOTS, `play-${lang}-${width}x${height}.png`));
  }
  await close();
  return problems;
}

let failed = 0;
try {
  for (const lang of LANGS) {
    for (const [w, h] of SIZES) {
      const problems = await play(lang, w, h);
      console.log(`${problems.length ? '✕' : '✓'} ${lang} ${w}×${h}${problems.map((p) => `\n    ${p}`).join('')}`);
      if (problems.length) failed++;
    }
  }
} finally {
  await chrome.close();
  server.close();
}
process.exit(failed ? 1 : 0);
