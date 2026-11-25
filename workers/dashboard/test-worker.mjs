import assert from 'node:assert/strict';
import worker from './src/index.ts';

class MemoryKV {
  constructor() { this.map = new Map(); this.lists = 0; this.reads = 0; this.failKeys = new Set(); }
  async get(key) {
    this.reads++;
    if (this.failKeys.has(key)) throw new Error('KV unavailable: ' + key);
    return this.map.get(key) ?? null;
  }
  async put(key, value) { this.map.set(key, String(value)); }
  async delete(key) { this.map.delete(key); }
  async list({ prefix = '' } = {}) { this.lists++; return { keys: [...this.map.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true, cursor: null }; }
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
  BOT_ADMIN_TOKEN: 'bot',
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
  // ⚠️ MOONBASE_MOUNT holds the TOKEN ONLY in production (see fullMount). The
  // fixture used to hold a whole URL, which is exactly why a refactor that
  // changed the secret's shape passed CI while every member's personal rows
  // blanked in prod. Keep it token-shaped.
  kv.map.clear(); cacheStore.clear();
  const second = { ...validSession(), sub: 'user-2', username: 'second', name: 'Second', at: 'token-two' };
  kv.map.set('sess:one', JSON.stringify(validSession())); kv.map.set('sess:two', JSON.stringify(second));
  Object.assign(env, { AIOS_UUID: 'service', AIOS_PASSWORD: 'pw', MOONBASE_ADMIN_TOKEN: 'admin', MOONBASE_MOUNT: 'config/mount' });
  const mediaAuth = [];
  const provBodies = [];
  const personaLogins = [];
  const personaNames = [];
  fetchImpl = async (url, options = {}) => {
    const u = String(url);
    if (u.includes('auth.example')) {
      // Distinct display names per member, delivered by authentik (not the
      // session doc), so the Provision body can be asserted.
      const auth = String(options.headers?.authorization || '');
      const name = auth.includes('token-two') ? 'Second Display' : 'Member Display';
      return Response.json({ user: { name, is_active: true, groups: [{ name: 'sweetpea' }] } });
    }
    if (u.endsWith('/Moonfin/Admin/Provision')) {
      const body = JSON.parse(String(options.body || '{}'));
      provBodies.push(body);
      // Echo the persona name like the shim does: provisioning must hand back
      // the name that sign-in will actually use.
      return Response.json({ pin: '123456', name: body.name, renamed: body.rename ? true : undefined });
    }
    if (u.endsWith('/Users/AuthenticateByName')) {
      const body = JSON.parse(String(options.body || '{}'));
      if (body.Username !== 'service') { personaLogins.push(u); personaNames.push(String(body.Username)); }
      const token = u.includes('/config/mount/') ? (body.Username === 'Second Display' ? 'member-2' : 'member-1') : 'service-token';
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
  // The persona is keyed by USERNAME (so watch history never splits) while its
  // NAME follows authentik's current display name — that is what Moonfin's
  // Who's-watching tile and the mount sign-in show.
  assert.deepEqual(provBodies.map((b) => [b.username, b.name, b.rename]),
    [['member', 'Member Display', true], ['second', 'Second Display', true]]);
  // The persona sign-in MUST be an absolute URL on the composed mount path.
  // Concatenating the raw token secret produced 'config/mount/Users/...' —
  // an invalid URL that threw, was swallowed, and blanked every personal row.
  assert.equal(personaLogins.length, 2, 'each member signs in once');
  // Sign-in uses the persona's returned name — which is now the display name.
  assert.deepEqual(personaNames, ['Member Display', 'Second Display']);
  assert.equal(personaLogins.every((u) => /^https:\/\/aiostreams\.mysweetpea\.cc\/jellyfin\/service\/config\/mount\/Users\/AuthenticateByName$/.test(u)), true,
    'persona login must use fullMount(env), not the raw secret: ' + personaLogins.join(' | '));

  // A display-name save always reconciles the persona (even when the name
  // matches the session snapshot), and a KV failure fails CLOSED: no Provision
  // under the post-rename username, which would mint a second persona.
  kv.map.clear(); kv.failKeys.clear(); cacheStore.clear();
  kv.map.set('sess:prof', JSON.stringify(validSession()));
  Object.assign(env, { AUTHENTIK_ADMIN_TOKEN: 'admin', MOONBASE_ADMIN_TOKEN: 'admin' });
  const profProvisions = [];
  fetchImpl = async (url, options = {}) => {
    const u = String(url);
    if (u.includes('/api/v3/flows/executor/')) {
      const body = options.method === 'POST' ? JSON.parse(String(options.body || '{}')) : {};
      if (body.component === 'ak-stage-password') {
        return Response.json({ component: 'xak-flow-redirect', to: '/', type: 'redirect' });
      }
      return Response.json({ component: body.component || 'ak-stage-identification', challenge: 'c' });
    }
    if (u.endsWith('/api/v3/core/users/me/')) return Response.json({ user: { is_active: true, groups: [{ name: 'sweetpea' }] } });
    if (u.includes('/api/v3/core/users/?username=')) return Response.json({ results: [{ pk: 7 }] });
    if (u.includes('/api/v3/core/users/7/')) return Response.json({ pk: 7 });
    if (u.endsWith('/Moonfin/Admin/Provision')) {
      profProvisions.push(JSON.parse(String(options.body || '{}')));
      return Response.json({ success: true, pin: '1', name: 'Member', renamed: true });
    }
    throw new Error('unexpected profile fetch ' + u);
  };
  const profile = (name) => worker.handle(request('/api/profile/update', {
    method: 'POST',
    headers: { ...cookie('prof'), origin: env.APP_URL, 'content-type': 'application/json' },
    body: JSON.stringify({ name, password: 'pw' }),
  }), env, ctx);
  let profRes = await profile('Member');
  assert.equal(profRes.status, 200);
  assert.equal((await profRes.json()).mediaName, true);
  assert.deepEqual(profProvisions.map(b => [b.username, b.name, b.rename]),
    [['member', 'Member', true]], 'a submitted name must always reach Provision with rename:true');
  kv.failKeys.add('unmap:member');
  profProvisions.length = 0;
  profRes = await profile('Mom');
  const profBody = await profRes.json();
  assert.equal(profRes.status, 200);
  assert.equal(profBody.mediaName, false, 'unresolvable persona key must report the rename as not done');
  assert.equal(profProvisions.length, 0, 'no Provision may run when the persona key cannot be resolved');
  kv.failKeys.clear();

  // Vaultwarden request lane: member asks, Gardener sees it once, member closes it.
  kv.map.clear(); cacheStore.clear();
  kv.map.set('sess:vault', JSON.stringify(validSession()));
  fetchImpl = async () => memberMe();
  let vault = await worker.handle(request('/api/vault', { headers: cookie('vault') }), env, ctx);
  assert.equal((await vault.json()).request, null);
  vault = await worker.handle(request('/api/vault/request', {
    method: 'POST', headers: { ...cookie('vault'), origin: env.APP_URL, 'content-type': 'application/json' }, body: '{}',
  }), env, ctx);
  assert.equal(vault.status, 200);
  assert.equal((await vault.json()).request.status, 'pending');
  vault = await worker.handle(request('/api/bot/vault-requests', { headers: { 'x-msp-internal': 'bot' } }), env, ctx);
  const queue = await vault.json();
  assert.equal(queue.requests.length, 1);
  assert.equal(queue.requests[0].email, 'member@example.com');
  vault = await worker.handle(request('/api/vault/accept', {
    method: 'POST', headers: { ...cookie('vault'), origin: env.APP_URL, 'content-type': 'application/json' }, body: '{}',
  }), env, ctx);
  assert.equal((await vault.json()).request.status, 'done');
  // A member can mark accepted before the owner sees the request; it must still
  // reach the owner because status and notification are separate concerns.
  vault = await worker.handle(request('/api/bot/vault-requests', { headers: { 'x-msp-internal': 'bot' } }), env, ctx);
  assert.equal((await vault.json()).requests.length, 1);
  vault = await worker.handle(request('/api/bot/vault-requests/notified', {
    method: 'POST', headers: { 'x-msp-internal': 'bot', 'content-type': 'application/json' },
    body: JSON.stringify({ id: queue.requests[0].id }),
  }), env, ctx);
  assert.equal(vault.status, 200);
  vault = await worker.handle(request('/api/bot/vault-requests', { headers: { 'x-msp-internal': 'bot' } }), env, ctx);
  assert.equal((await vault.json()).requests.length, 0, 'notified request must not repeat');
  vault = await worker.handle(request('/api/vault', { headers: cookie('vault') }), env, ctx);
  assert.equal((await vault.json()).request.status, 'done');
  vault = await worker.handle(request('/api/bot/vault-requests'), env, ctx);
  assert.equal(vault.status, 403, 'vault bot lane must be token-gated');

  // KV list quota: Gardener polls the vault inbox every 120s. An idle poll must
  // cost a READ, never a LIST (lists are capped at 1,000/day, reads at 100,000).
  assert.equal(kv.map.has('vault-inbox'), false, 'marker must be cleared once nothing is pending');
  kv.lists = 0;
  for (let i = 0; i < 10; i++) {
    const idle = await worker.handle(request('/api/bot/vault-requests', { headers: { 'x-msp-internal': 'bot' } }), env, ctx);
    assert.equal((await idle.json()).requests.length, 0);
  }
  assert.equal(kv.lists, 0, '10 idle polls must not LIST KV (this is the 720-lists/day quota bug)');
  // A new request re-arms the marker, and an un-notified request keeps it armed
  // so a failed Telegram send retries on the next poll.
  kv.map.delete('vaultreq:user-1');
  vault = await worker.handle(request('/api/vault/request', {
    method: 'POST', headers: { ...cookie('vault'), origin: env.APP_URL, 'content-type': 'application/json' }, body: '{}',
  }), env, ctx);
  assert.equal(vault.status, 200);
  assert.equal(kv.map.has('vault-inbox'), true, 'creating a request must arm the poll marker');
  for (let i = 0; i < 2; i++) {
    vault = await worker.handle(request('/api/bot/vault-requests', { headers: { 'x-msp-internal': 'bot' } }), env, ctx);
    assert.equal((await vault.json()).requests.length, 1, 'un-notified request must survive repeated polls');
    assert.equal(kv.map.has('vault-inbox'), true, 'marker stays armed while anything is un-notified');
  }

  // Temporary-password gate signal: authentik stamps password_change_date on
  // creation too, so "changed within 120s of joining" == still on the emailed
  // temp password. The gate must be quiet for everyone else, and quiet on error.
  kv.map.clear(); cacheStore.clear();
  env.AUTHENTIK_ADMIN_TOKEN = 'admin-token';
  kv.map.set('sess:pw', JSON.stringify({ ...validSession(), sub: 'pw-user' }));
  const pwMe = () => Response.json({ user: { pk: 42, username: 'member', name: 'Member', email: 'm@example.com', is_active: true, groups: [{ name: 'sweetpea' }] } });
  const adminUser = (joined, changed) => Response.json({ pk: 42, date_joined: joined, password_change_date: changed });
  const askMe = async () => {
    cacheStore.clear();
    const r = await worker.handle(request('/api/me', { headers: cookie('pw') }), env, ctx);
    return (await r.json()).temp_password;
  };
  fetchImpl = async (url) => {
    const u = String(url);
    if (u.endsWith('/core/users/me/')) return pwMe();
    if (u.endsWith('/core/users/42/')) return adminUser('2026-11-19T10:00:00Z', '2026-11-19T10:00:04Z');
    throw new Error('unexpected pw fetch ' + u);
  };
  assert.equal(await askMe(), true, 'password set at creation = still temporary');
  fetchImpl = async (url) => {
    const u = String(url);
    if (u.endsWith('/core/users/me/')) return pwMe();
    if (u.endsWith('/core/users/42/')) return adminUser('2026-11-19T10:00:00Z', '2026-11-19T10:09:00Z');
    throw new Error('unexpected pw fetch ' + u);
  };
  assert.equal(await askMe(), false, 'a real password change must silence the gate');
  fetchImpl = async (url) => {
    const u = String(url);
    if (u.endsWith('/core/users/me/')) return pwMe();
    return Response.json({ detail: 'nope' }, { status: 500 });
  };
  assert.equal(await askMe(), false, 'an admin-read failure must fail safe (no false accusation)');

  // Username availability: authentikResults returns the {results:[...]} envelope.
  // Calling .some() on the envelope used to throw -> every request 502'd.
  kv.map.clear(); cacheStore.clear();
  kv.map.set('sess:un', JSON.stringify(validSession()));
  fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('/core/users/?username=')) return Response.json({ results: [{ username: 'taken' }, { username: 'other' }] });
    if (u.endsWith('/core/users/me/')) return memberMe();
    throw new Error('unexpected un fetch ' + u);
  };
  const unPost = (desired) => worker.handle(request('/api/username/request', {
    method: 'POST', headers: { ...cookie('un'), origin: env.APP_URL, 'content-type': 'application/json' },
    body: JSON.stringify({ desired }),
  }), env, ctx);
  const takenRes = await unPost('taken');
  assert.equal(takenRes.status, 409, 'existing username must be rejected, not 502');
  const freeRes = await unPost('free-name');
  assert.equal(freeRes.status, 200, 'free username must be accepted');
  assert.equal((await freeRes.json()).desired, 'free-name');

  console.log('PASS dashboard worker: stale-session rejection, mutation origin guard, SWR dedupe, OIDC binding, per-member media, mount-path persona login, vault request lane + KV list quota, temp-password signal, username availability');
} finally {
  globalThis.fetch = realFetch;
  globalThis.caches = realCaches;
}
