export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

// 1234 -> "1 234", 1500000 -> "1.5Մ" (Armenian short suffixes: Հ = հազար, Մ = միլիոն, Մլրդ = միլիարդ)
export function formatCount(n) {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (abs < 100000) return groupDigits(Math.floor(n));
  const units = [
    [1e9, 'Մլրդ'],
    [1e6, 'Մ'],
    [1e3, 'Հ'],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const v = n / size;
      const text = v >= 100 ? Math.floor(v).toString() : v.toFixed(1).replace(/\.0$/, '');
      return text + suffix;
    }
  }
  return groupDigits(Math.floor(n));
}

export function groupDigits(n) {
  const s = String(Math.abs(n));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ' ';
    out += s[i];
  }
  return (n < 0 ? '-' : '') + out;
}

// Seconds -> "1:05" or "1:02:05"
// Tenths of a second as «1:23.4» (the weekly challenge's times).
export function formatTenths(tenths) {
  const s = Math.max(0, Math.round(tenths)) / 10;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Calendar day 'YYYYMMDD' in a time zone (undefined = this device's), so every player's day
// starts at the same midnight. Used for the daily / monthly leaderboards.
const dayFormats = new Map();
export function dayKey(ms, timeZone) {
  let f = dayFormats.get(timeZone);
  if (!f) dayFormats.set(timeZone, (f = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })));
  const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}`;
}

// '20261101' -> '20261031'
export function prevDayKey(key) {
  const d = new Date(Date.UTC(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8) - 1));
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// 'YYYYMMDD' <-> days since 1 Jan 1970, to count and add days.
export function dayNumber(key) {
  return Date.UTC(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8)) / 86400000;
}

export function keyOfDay(n) {
  return new Date(n * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
}

// The ISO week (Monday to Sunday) of a day: '20261029' -> '202644'.
export function weekKey(key) {
  const t = new Date(dayNumber(key) * 86400000);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3); // the Thursday of that week
  const year = t.getUTCFullYear();
  const week = 1 + Math.floor((t - Date.UTC(year, 0, 1)) / 604800000);
  return `${year}${String(week).padStart(2, '0')}`;
}

// '202601' -> '202512'
export function prevMonthKey(key) {
  const y = +key.slice(0, 4);
  const m = +key.slice(4, 6);
  return m === 1 ? `${y - 1}12` : `${y}${String(m - 1).padStart(2, '0')}`;
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// Closest names to `name` (case-insensitive), for "did you mean …?" hints.
export function suggestNames(name, candidates, max = 2) {
  const lower = name.toLowerCase();
  const scored = [];
  for (const c of candidates) {
    const cl = c.toLowerCase();
    let d = levenshtein(lower, cl);
    if (cl.startsWith(lower) || lower.startsWith(cl)) d = Math.min(d, 1);
    const limit = Math.max(1, Math.floor(c.length / 3));
    if (d <= limit) scored.push([d, c]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  return scored.slice(0, max).map((s) => s[1]);
}

export function deepClone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
