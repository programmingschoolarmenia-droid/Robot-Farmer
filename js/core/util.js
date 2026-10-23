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
export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
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
