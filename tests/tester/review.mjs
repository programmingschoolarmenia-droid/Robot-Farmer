// Test report review site: `npm run reports` → http://localhost:8090
// Shows every test-reports/*.json, saves the teacher's decisions to
// test-reports/decisions.json and keeps test-reports/TO-FIX.md (approved, not fixed) up to date.
import http from 'node:http';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../test-reports/', import.meta.url));
const PAGE = fileURLToPath(new URL('./review.html', import.meta.url));
const DECISIONS = join(ROOT, 'decisions.json');
const PORT = Number(process.env.PORT) || 8090;
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.md': 'text/plain; charset=utf-8', '.json': 'application/json' };

const readJson = async (file, fallback) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } };

async function loadReports() {
  const files = (await readdir(ROOT)).filter(f => f.endsWith('.json') && f !== 'decisions.json').sort().reverse();
  return Promise.all(files.map(async f => ({ file: f, ...(await readJson(join(ROOT, f), { items: [] })) })));
}

async function writeToFix(reports, decisions) {
  let out = '# To fix\n\nApproved in the review site (`npm run reports`) and not fixed yet. After fixing an item, set its status to "done" in `decisions.json`.\n';
  for (const r of reports) {
    const items = r.items.filter(i => decisions[`${r.file}#${i.id}`]?.status === 'approved');
    if (!items.length) continue;
    out += `\n## ${r.title} (${r.date}), from \`${r.file.replace(/\.json$/, '.md')}\`\n`;
    for (const i of items) {
      const note = decisions[`${r.file}#${i.id}`].note;
      out += `\n### ${i.id} · ${i.kind === 'bug' ? i.severity : i.kind === 'idea' ? 'NEW IDEA (plan it first)' : 'SUGGESTION'} · ${i.title}\n`;
      for (const [label, key] of [['Problem', 'problem'], ['Idea', 'idea'], ['Result', 'result'], ['Effort', 'effort'], ['Where', 'where'], ['Steps', 'steps'], ['Actual', 'actual'], ['Fix', 'fix']])
        if (i[key]) out += `- ${label}: ${i[key]}\n`;
      if (i.shots?.length) out += `- Screenshots: ${i.shots.join(', ')}\n`;
      if (note) out += `- **Teacher's note:** ${note}\n`;
    }
  }
  await writeFile(join(ROOT, 'TO-FIX.md'), out);
}

const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(body); };

http.createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (url === '/') return send(res, 200, await readFile(PAGE), 'text/html; charset=utf-8');
    if (url === '/api/reports') {
      const reports = await loadReports(), decisions = await readJson(DECISIONS, {});
      await writeToFix(reports, decisions);
      return send(res, 200, JSON.stringify({ reports, decisions }));
    }
    if (url === '/api/decide' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { key, status, note } = JSON.parse(body);
      const decisions = await readJson(DECISIONS, {});
      if (status || note) decisions[key] = { status, note: note || '', at: new Date().toISOString() };
      else delete decisions[key];
      await writeFile(DECISIONS, JSON.stringify(decisions, null, 2));
      await writeToFix(await loadReports(), decisions);
      return send(res, 200, '{"ok":true}');
    }
    const file = normalize(join(ROOT, url));
    if (!file.startsWith(ROOT)) return send(res, 403, 'no');
    send(res, 200, await readFile(file), TYPES[extname(file)] || 'application/octet-stream');
  } catch (e) {
    send(res, e.code === 'ENOENT' ? 404 : 500, String(e.message), 'text/plain');
  }
}).listen(PORT, () => {
  const link = `http://localhost:${PORT}`;
  console.log(`Test reports: ${link}  (Ctrl+C to stop)`);
  if (process.platform === 'darwin') exec(`open ${link}`);
});
