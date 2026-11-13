import assert from 'node:assert/strict';
import worker from './src/index.ts';

class MemoryKV {
  constructor() { this.map = new Map(); }
  async get(key) { return this.map.get(key) ?? null; }
  async put(key, value) { this.map.set(key, String(value)); }
  async delete(key) { this.map.delete(key); }
  async list({ prefix = '' } = {}) { return { keys: [...this.map.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true, cursor: null }; }
}
const kv = new MemoryKV();
const cacheStore = new Map();
const realCaches = globalThis.caches;
globalThis.caches = { default: {
  match: async req => { const hit = cacheStore.get(req.url); return hit ? hit.clone() : undefined; },
  put: async (req, res) => { cacheStore.set(req.url, res.clone()); },
  delete: async req => cacheStore.delete(req.url),
} };
const ctx = { waitUntil: p => Promise.resolve(p).catch(() => {}), passThroughOnException: () => {} };
const env = {
  SESSIONS: kv,
  AUTH_ISSUER: 'https://auth.example/application/o/dashboard',
  AUTH_BASE: 'https://auth.example',
  AUTHENTIK_CLIENT_ID: 'client',
  MSP_INTERNAL_HEADER: 'internal',
  APP_URL: 'https://dashboard.mysweetpea.cc',
};
const jwt = exp => `x.${Buffer.from(JSON.stringify({ iat: exp - 900, exp })).toString('base64url')}.x`;
const validSession = () => ({ at: 'not-a-jwt', rt: 'refresh', sub: 'user-1', username: 'member', name: 'Member', email: 'member@example.com', created: Date.now() });
const request = (path, options = {}) => new Request('https://dashboard.mysweetpea.cc' + path, options);
const cookie = sid => ({ cookie: `msp_dash_session=${sid}` });
let fetchImpl = async () => { throw new Error('unexpected fetch'); };
const memberMe = (groups = ['sweetpea'], active = true) => Response.json({
  user: { pk: 'user-1', username: 'member', name: 'Member', email: 'member@example.com', is_active: active, groups: groups.map(name => ({ name })) },
});
const realFetch = globalThis.fetch;
globalThis.fetch = (...args) => fetchImpl(...args);

try {
  // Expired access + rejected refresh must not authorize a protected route.
  kv.map.clear(); cacheStore.clear();
  const expired = { ...validSession(), at: jwt(Math.floor(Date.now() / 1000) - 3600), created: 1 };
  kv.map.set('sess:expired', JSON.stringify(expired));
  fetchImpl = async () => Response.json({ error: 'invalid_grant' }, { status: 400 });
  let res = await worker.handle(request('/api/avatar/meta', { headers: cookie('expired') }), env, ctx);
  assert.equal(res.status, 401, 'expired session with rejected refresh must be unauthorized');
  assert.equal(kv.map.has('sess:expired'), false, 'dead session must be deleted');

  // A sibling origin is same-site, but it is not the dashboard origin.
  fetchImpl = async () => memberMe();
  kv.map.clear(); cacheStore.clear(); kv.map.set('sess:valid', JSON.stringify(validSession()));
  res = await worker.handle(request('/api/referral', {
    method: 'POST', headers: { ...cookie('valid'), origin: 'https://other.mysweetpea.cc', 'content-type': 'text/plain' },
    body: JSON.stringify({ name: 'Friend', service: 'Moonfin' }),
  }), env, ctx);
  assert.equal(res.status, 403, 'sibling-origin mutation must be rejected');

  res = await worker.handle(request('/api/bug', {
    method: 'POST', headers: { ...cookie('valid'), origin: env.APP_URL, 'content-type': 'application/json' },
    body: JSON.stringify({ where: {}, what: 'broken' }),
  }), env, ctx);
  assert.equal(res.status, 400, 'non-string bug metadata must be rejected');

  // Two cold callers share one upstream Authentik request.
  kv.map.clear(); cacheStore.clear(); kv.map.set('sess:valid', JSON.stringify(validSession()));
  let authCalls = 0;
  fetchImpl = async url => {
    if (String(url).endsWith('/core/users/me/')) return memberMe();
    authCalls++; await new Promise(r => setTimeout(r, 30)); return Response.json({ results: [] });
  };
  const [r1, r2] = await Promise.all([
    worker.handle(request('/api/sessions', { headers: cookie('valid') }), env, ctx),
    worker.handle(request('/api/sessions', { headers: cookie('valid') }), env, ctx),
  ]);
  assert.equal(r1.status, 200); assert.equal(r2.status, 200);
  assert.equal(authCalls, 1, 'cold/stale SWR requests must share one producer');
  assert.deepEqual(await r1.json(), { results: [] }); assert.deepEqual(await r2.json(), { results: [] });

  // Upstream failures must not overwrite the cache as a successful session list.
  kv.map.clear(); cacheStore.clear(); kv.map.set('sess:valid', JSON.stringify(validSession()));
  let failedCalls = 0;
  fetchImpl = async url => {
    if (String(url).endsWith('/core/users/me/')) return memberMe();
    failedCalls++; return Response.json({ results: [] }, { status: 500 });
  };
  await worker.handle(request('/api/sessions', { headers: cookie('valid') }), env, ctx);
  await worker.handle(request('/api/sessions', { headers: cookie('valid') }), env, ctx);
  assert.equal(failedCalls, 2, 'failed upstream responses must be retried, not cached');

  // A callback without the browser's pre-auth binding cookie is login CSRF.
  kv.map.clear(); cacheStore.clear();
  kv.map.set('pkce:teststate', JSON.stringify({ v: 'verifier', b: 'not-used-without-cookie' }));
  let tokenCalls = 0;
  fetchImpl = async url => {
    if (String(url).endsWith('/token/')) { tokenCalls++; return Response.json({ access_token: 'at', refresh_token: 'rt' }); }
    return Response.json({ user: { pk: 'user-1', username: 'member', name: 'Member', email: 'member@example.com', is_active: true, groups: [{ name: 'sweetpea' }] } });
  };
  res = await worker.handle(request('/auth/callback?code=code&state=teststate'), env, ctx);
  assert.equal(res.status, 400, 'OIDC callback must require its browser-binding cookie');
  assert.equal(tokenCalls, 0, 'unbound callbacks must not reach token exchange');

  // Referral history must come from the records themselves, not a lossy index.
  fetchImpl = async () => memberMe();
  kv.map.clear();
  kv.map.set('sess:valid', JSON.stringify(validSession()));
  kv.map.set('referral:a', JSON.stringify({ id: 'a', by: 'user-1', status: 'pending', at: 1 }));
  kv.map.set('referral:b', JSON.stringify({ id: 'b', by: 'user-2', status: 'pending', at: 2 }));
  const referrals = await worker.handle(request('/api/referral', { headers: cookie('valid') }), env, ctx);
  assert.deepEqual((await referrals.json()).referrals.map(r => r.id), ['a']);

  // Existing dashboard sessions are re-authorized briefly and revoked on group loss.
  kv.map.clear(); cacheStore.clear(); kv.map.set('sess:valid', JSON.stringify(validSession()));
  let entitlementCalls = 0;
  fetchImpl = async () => { entitlementCalls++; return memberMe(); };
  for (let i = 0; i < 2; i++) {
    const allowed = await worker.handle(request('/api/referral', { headers: cookie('valid') }), env, ctx);
    assert.equal(allowed.status, 200);
  }
  assert.equal(entitlementCalls, 1, 'positive entitlement must use the five-minute cache');
  cacheStore.clear();
  fetchImpl = async () => memberMe(['other']);
  res = await worker.handle(request('/api/referral', { headers: cookie('valid') }), env, ctx);
  assert.equal(res.status, 401, 'group revocation must invalidate an existing session');
  assert.equal(kv.map.has('sess:valid'), false);
  kv.map.set('sess:valid', JSON.stringify(validSession()));
  fetchImpl = async () => Response.json({}, { status: 500 });
  res = await worker.handle(request('/api/referral', { headers: cookie('valid') }), env, ctx);
  assert.equal(res.status, 503, 'identity outages must not look like revocation');
  assert.equal(kv.map.has('sess:valid'), true, 'temporary outage must not delete the session');

  // The real interstitial + cookie completes a legitimate login round-trip.
  kv.map.clear(); cacheStore.clear();
  const login = await worker.handle(request('/auth/login'), env, ctx);
  assert.equal(login.status, 200);
  const loginCookie = (login.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(loginCookie.startsWith('msp_login='));
  const loginHtml = await login.text();
  const targetMatch = loginHtml.match(/location\.replace\("([^"]+)"\)/);
  assert.ok(targetMatch, 'login interstitial must carry the authorize URL');
  const authorize = new URL(targetMatch[1]);
  const state = authorize.searchParams.get('state');
  assert.ok(state);
  fetchImpl = async url => {
    if (String(url).endsWith('/token/')) return Response.json({ access_token: 'at', refresh_token: 'rt' });
    return Response.json({ user: { pk: 'user-1', username: 'member', name: 'Member', email: 'member@example.com', is_active: true, groups: [{ name: 'sweetpea' }] } });
  };
  const callback = await worker.handle(request('/auth/callback?code=code&state=' + state, { headers: { cookie: loginCookie } }), env, ctx);
  assert.equal(callback.status, 200, 'bound login callback must succeed');
  assert.equal([...kv.map.keys()].filter(k => k.startsWith('sess:')).length, 1);
  assert.equal(kv.map.has('pkce:' + state), false, 'PKCE state is one-time');

  // Active Authentik account is not enough: dashboard membership is explicit.
  const login2 = await worker.handle(request('/auth/login'), env, ctx);
  const cookie2 = (login2.headers.get('set-cookie') || '').split(';')[0];
  const state2 = new URL((await login2.text()).match(/location\.replace\("([^"]+)"\)/)[1]).searchParams.get('state');
  fetchImpl = async url => {
    if (String(url).endsWith('/token/')) return Response.json({ access_token: 'at', refresh_token: 'rt' });
    return Response.json({ user: { pk: 'outsider', username: 'outsider', name: 'Outsider', email: 'out@example.com', is_active: true, groups: [{ name: 'other' }] } });
  };
  const denied = await worker.handle(request('/auth/callback?code=code&state=' + state2, { headers: { cookie: cookie2 } }), env, ctx);
  assert.equal(denied.status, 403, 'users without a member group must not create dashboard sessions');
  assert.equal([...kv.map.keys()].filter(k => k.startsWith('sess:')).length, 1);

  // Two members must not share the unplayed feed or a persona token cache.
  kv.map.clear(); cacheStore.clear();
  const second = { ...validSession(), sub: 'user-2', username: 'second', name: 'Second' };
  kv.map.set('sess:one', JSON.stringify(validSession())); kv.map.set('sess:two', JSON.stringify(second));
  Object.assign(env, { AIOS_UUID: 'service', AIOS_PASSWORD: 'pw', MOONBASE_ADMIN_TOKEN: 'admin', MOONBASE_MOUNT: 'https://aiostreams.mysweetpea.cc/jellyfin/config/mount' });
  const mediaAuth = [];
  const provBodies = [];
  fetchImpl = async (url, options = {}) => {
    const u = String(url);
    if (u.includes('auth.example')) return Response.json({ user: { is_active: true, groups: [{ name: 'sweetpea' }] } });
    if (u.endsWith('/Moonfin/Admin/Provision')) { provBodies.push(JSON.parse(String(options.body || '{}'))); return Response.json({ pin: '123456' }); }
    if (u.endsWith('/Users/AuthenticateByName')) {
      const body = JSON.parse(String(options.body || '{}'));
      const token = u.includes('/config/mount/') ? (body.Username === 'second' ? 'member-2' : 'member-1') : 'service-token';
      return Response.json({ AccessToken: token });
    }
    if (u.endsWith('/UserViews')) return Response.json({ Items: [{ Id: 'trend', Name: 'Trending Movies' }] });
    if (u.includes('/Items?ParentId=')) {
      const auth = String(options.headers?.authorization || ''); mediaAuth.push(auth);
      const name = auth.includes('member-2') ? 'Second movie' : 'First movie';
      return Response.json({ Items: [{ Id: name, Name: name, Type: 'Movie' }] });
    }
    throw new Error('unexpected media fetch ' + u);
  };
  const one = await worker.handle(request('/api/media/unplayed', { headers: cookie('one') }), env, ctx);
  const two = await worker.handle(request('/api/media/unplayed', { headers: cookie('two') }), env, ctx);
  assert.equal((await one.json()).items[0].name, 'First movie');
  assert.equal((await two.json()).items[0].name, 'Second movie');
  assert.equal(mediaAuth.length, 2, 'each member needs their own upstream query');
  assert.equal(mediaAuth.every(a => a.includes('member-')), true);
  // Persona names are LOGIN names, never display names — a display-name persona
  // would split a member's watch history in two.
  assert.deepEqual(provBodies.map((b) => b.name), ['member', 'second']);

  console.log('PASS dashboard worker: stale-session rejection, mutation origin guard, SWR dedupe, OIDC binding, per-member media');
} finally {
  globalThis.fetch = realFetch;
  globalThis.caches = realCaches;
}
