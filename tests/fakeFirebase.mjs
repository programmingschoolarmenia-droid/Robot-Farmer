// A tiny in-memory stand-in for the Firebase Auth + Firestore REST endpoints the game uses,
// so tests (and the browser play-throughs) exercise the real request code without a project.
export function createFakeFirebase({ apiKey = 'test-key', projectId = 'test-project' } = {}) {
  const users = new Map(); // email -> { password, displayName }
  const tokens = new Map(); // idToken -> email
  const refresh = new Map(); // refreshToken -> email
  const docs = new Map(); // 'saves/aram' -> fields
  const prefix = `projects/${projectId}/databases/(default)/documents`;
  let n = 0;
  const fake = { users, docs, requests: [], offline: false };

  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fail = (status, message, extra = {}) => json(status, { error: { code: status, message, ...extra } });
  const issue = (email) => {
    const idToken = `id-${++n}`;
    const refreshToken = `rt-${n}`;
    tokens.set(idToken, email);
    refresh.set(refreshToken, email);
    return { idToken, refreshToken, expiresIn: '3600' };
  };
  const owner = (req) => tokens.get(String(req.headers.Authorization || '').replace('Bearer ', ''));
  const ownsDoc = (email, path) => email && email.split('@')[0] === path.split('/').pop();
  const num = (fields, f) => (fields[f] && 'integerValue' in fields[f] ? Number(fields[f].integerValue) : undefined);

  fake.expireTokens = () => tokens.clear();

  fake.handle = (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    const req = { headers: init.headers || {} };
    fake.requests.push({ url, method: init.method || 'GET', body });
    if (fake.offline) throw new TypeError('Failed to fetch');
    if (u.searchParams.has('key') && u.searchParams.get('key') !== apiKey) return fail(400, 'API key not valid. Please pass a valid API key.', { status: 'INVALID_ARGUMENT' });

    if (u.hostname === 'identitytoolkit.googleapis.com') {
      const user = users.get(body.email);
      if (u.pathname.endsWith('accounts:signUp')) {
        if (user) return fail(400, 'EMAIL_EXISTS');
        if (String(body.password).length < 6) return fail(400, 'WEAK_PASSWORD : Password should be at least 6 characters');
        users.set(body.email, { password: body.password, displayName: body.displayName });
        return json(200, { ...issue(body.email), email: body.email, displayName: body.displayName, localId: `uid-${n}` });
      }
      if (!user || user.password !== body.password) return fail(400, 'INVALID_LOGIN_CREDENTIALS');
      return json(200, { ...issue(body.email), email: body.email, displayName: user.displayName, registered: true });
    }

    if (u.hostname === 'securetoken.googleapis.com') {
      const email = refresh.get(body.refreshToken || body.refresh_token);
      if (!email || !users.has(email)) return fail(400, email ? 'USER_NOT_FOUND' : 'INVALID_REFRESH_TOKEN');
      const t = issue(email);
      return json(200, { id_token: t.idToken, refresh_token: t.refreshToken, expires_in: '3600', user_id: email });
    }

    const path = decodeURIComponent(u.pathname).replace(`/v1/${prefix}`, '');
    if (path.startsWith('/saves/') && !body) {
      const email = owner(req);
      if (!email) return fail(401, 'Request had invalid authentication credentials.', { status: 'UNAUTHENTICATED' });
      if (!ownsDoc(email, path)) return fail(403, 'Missing or insufficient permissions.', { status: 'PERMISSION_DENIED' });
      const fields = docs.get(path.slice(1));
      return fields ? json(200, { name: `${prefix}${path}`, fields }) : fail(404, `Document "${prefix}${path}" not found.`, { status: 'NOT_FOUND' });
    }
    if (path === ':commit') {
      const email = owner(req);
      if (!email) return fail(401, 'Request had invalid authentication credentials.', { status: 'UNAUTHENTICATED' });
      for (const w of body.writes) if (!ownsDoc(email, w.update.name)) return fail(403, 'Missing or insufficient permissions.', { status: 'PERMISSION_DENIED' });
      for (const w of body.writes) docs.set(w.update.name.replace(`${prefix}/`, ''), w.update.fields);
      return json(200, { commitTime: new Date().toISOString() });
    }
    const players = [...docs].filter(([k]) => k.startsWith('players/'));
    if (path === ':runQuery') {
      // Like Firestore: documents without the sort field are left out, and an inequality filter
      // must be on the first sort field.
      const q = body.structuredQuery;
      const f = q.orderBy[0].field.fieldPath;
      const where = q.where && q.where.fieldFilter;
      if (where && where.field.fieldPath !== f) return fail(400, 'inequality filter property and first sort order must be the same', { status: 'INVALID_ARGUMENT' });
      const min = where ? Number(where.value.integerValue) : -Infinity;
      const dir = q.orderBy[0].direction === 'ASCENDING' ? 1 : -1;
      const rows = players
        .filter(([, fields]) => num(fields, f) > min)
        .sort((a, b) => dir * (num(a[1], f) - num(b[1], f)))
        .slice(0, q.limit)
        .map(([k, fields]) => ({ document: { name: `${prefix}/${k}`, fields }, readTime: 'now' }));
      return json(200, rows.length ? rows : [{ readTime: 'now' }]);
    }
    if (path === ':runAggregationQuery') {
      const where = body.structuredAggregationQuery.structuredQuery.where.fieldFilter;
      const count = players.filter(([, fields]) => num(fields, where.field.fieldPath) > Number(where.value.integerValue)).length;
      return json(200, [{ result: { aggregateFields: { n: { integerValue: String(count) } } }, readTime: 'now' }]);
    }
    return fail(404, `Unknown fake endpoint ${url}`);
  };

  fake.fetch = async (url, init) => fake.handle(url, init);
  return fake;
}
