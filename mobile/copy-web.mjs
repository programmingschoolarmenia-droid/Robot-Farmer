// Copies the game into www/ for the Android app. The game files themselves are never changed:
// only the copy differs, in three ways:
//  - the Google Fonts are downloaded into www/fonts/ so the app also looks right without internet;
//  - files the app never loads are left out (SKIP);
//  - with --test, config/settings.json gets empty Firebase keys (local accounts, like npm run play).
// Run: node copy-web.mjs [--test]
import { cp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const GAME = fileURLToPath(new URL('..', import.meta.url));
const WWW = fileURLToPath(new URL('www/', import.meta.url));
const PARTS = ['index.html', 'privacy.html', 'js', 'css', 'config', 'assets', 'vendor'];
// The source pictures of Bridgy and the drone are not used by the game, and Android's WebView always
// plays the Ogg music (js/audio.js picks MP3 only where Ogg can't play): 5.3 MB less to download.
const SKIP = new Set(['assets/originals', 'assets/audio/apricot-afternoon.mp3'].map((p) => join(GAME, p)));
// A current Chrome user agent makes Google Fonts answer with woff2 files.
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

await rm(WWW, { recursive: true, force: true });
for (const part of PARTS) await cp(join(GAME, part), join(WWW, part), { recursive: true, filter: (src) => !SKIP.has(src) });

// ---- fonts: the <link> to Google becomes a local fonts/fonts.css
const indexFile = join(WWW, 'index.html');
let html = await readFile(indexFile, 'utf8');
const link = html.match(/<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com\/[^"]+)">/);
if (!link) throw new Error('index.html: the Google Fonts <link> was not found (did it change?)');
const get = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res;
};
let css = await (await get(link[1].replaceAll('&amp;', '&'))).text();
await mkdir(join(WWW, 'fonts'));
const urls = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)]+/g))];
await Promise.all(
  urls.map(async (url, i) => {
    const name = `f${i}.woff2`;
    await writeFile(join(WWW, 'fonts', name), Buffer.from(await (await get(url)).arrayBuffer()));
    css = css.replaceAll(url, name);
  }),
);
await writeFile(join(WWW, 'fonts', 'fonts.css'), css);
html = html
  .replace(/\s*<link rel="preconnect" href="https:\/\/fonts\.[^"]+"( crossorigin)?>/g, '')
  .replace(link[0], '<link rel="stylesheet" href="fonts/fonts.css">');
// The game leaves room only for the bottom bar (env(safe-area-inset-bottom)), so in the app Android keeps
// the page between the status bar and the navigation bar instead of drawing it under them.
if (!html.includes('viewport-fit=cover')) throw new Error('index.html: viewport-fit=cover was not found (did it change?)');
html = html.replace('viewport-fit=cover', 'viewport-fit=contain');
await writeFile(indexFile, html);

// ---- test build: no live keys inside
if (process.argv.includes('--test')) {
  const file = join(WWW, 'config', 'settings.json');
  const s = JSON.parse(await readFile(file, 'utf8'));
  s.online = { ...s.online, apiKey: '', projectId: '' };
  await writeFile(file, JSON.stringify(s, null, 2));
}
console.log(`www/ ready: ${urls.length} font files${process.argv.includes('--test') ? ', test keys (local accounts)' : ''}`);
