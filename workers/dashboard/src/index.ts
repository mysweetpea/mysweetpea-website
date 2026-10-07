// MySweetPea Dashboard Worker — session + OIDC PKCE + authentik API proxy
// Phase 1 skeleton: auth round-trip + /api/me + static SPA serving.

import {
  RUNTIME_PROBES,
  parseVer,
  runPipeline,
  reconcile,
  buildUpdate,
} from './lib/updates-pipeline.mjs';
import {
  SEERR_UA,
  resolveSeerrUser,
  buildCard,
} from './lib/requests-display.mjs';
import {
  WINDOW_DAYS,
  IMPORT_ERA,
  CAP_FLOOR,
  bucketByDay,
  computeGrowth,
} from './lib/growth.mjs';

export interface Env {
  SESSIONS: KVNamespace;
  ASSETS: Fetcher;
  AUTHENTIK_CLIENT_ID: string;
  MSP_INTERNAL_HEADER: string;
  AUTH_ISSUER: string;
  AUTH_BASE: string;
  APP_URL: string;
  KUMA_STATUS_URL: string;
  JELLYFIN_URL: string;
  SEERR_URL: string;
  JELLYFIN_API_KEY: string;
  SEERR_API_KEY: string;

  IMMICH_URL: string;
  IMMICH_API_KEY: string;
  JELLYFIN_USER_ID: string;
  AUTHENTIK_ADMIN_TOKEN: string;
  // Optional per-service stats sources (stats tab "beyond the library" tiles).
  // Each absent -> its tiles render '—' (honest degrade).
  NEXTCLOUD_URL?: string;       // e.g. https://cloud.mysweetpea.cc
  NEXTCLOUD_ADMIN_USER?: string;
  NEXTCLOUD_ADMIN_PASS?: string;
  VAULTWARDEN_DB_B64?: string;  // lazy: whole sqlite snapshot, base64 (users+items only read)
  AFFINE_DB_URL?: string;       // full postgres DSN for the affine database
  OPENWEBUI_URL?: string;       // internal URL reachable from the worker is NOT possible;
  OPENWEBUI_STATS_B64?: string; // so webui.db snapshot, base64 (users+chats only)
  GOTIFY_REFERRAL_TOKEN?: string; // referral pings -> Gotify app 14 'Referrals'
  GOTIFY_BUG_TOKEN?: string; // user bug reports -> Gotify 'Bugs' app (PC alert-poller -> Paperclip)
  GITHUB_TOKEN?: string; // optional — homelab-k8s is public; token only lifts the 60/hr anon limit
  GH_COMMITS_REPO?: string; // optional — commits source repo 'owner/name' (default: mysweetpea/mysweetpea-homelab)
  MAIN_SITE_URL?: string;   // optional — marketing site origin (default: https://mysweetpea.cc)
  SUPPORT_EMAIL?: string;   // optional — contact email (default: support@mysweetpea.cc)
}

interface SessionData {
  at: string;            // access token
  rt?: string;           // refresh token
  sub: string;           // user uuid
  username: string;
  name: string;
  email: string;
  created: number;
}

const COOKIE = 'msp_dash_session';
const REFERRAL_STATUSES_OK = new Set(['pending', 'approved', 'declined', 'created']);
const SCOPES = 'openid profile email offline_access goauthentik.io/api';

function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomB64u(n = 32): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b64uEncode(b);
}

async function sha256(s: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

function akHeaders(env: Env, token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'x-msp-internal': env.MSP_INTERNAL_HEADER,
  };
}

async function authentikFetch(env: Env, token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${env.AUTH_BASE}${path}`, {
    ...init,
    headers: {
      ...akHeaders(env, token),
      'content-type': 'application/json',
      ...(init.headers as Record<string, string> || {}),
    },
  });
}

// Sniff magic bytes — never trust a client-supplied mime type.
function sniffImageMime(b: Uint8Array): string | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

// Password step-up: drive the default authentication flow headlessly with a
// minimal cookie jar and check the password stage accepts. The submitted
// password is only ever sent to authentik's flow executor — never stored or
// logged anywhere.
async function verifyPassword(env: Env, username: string, password: string): Promise<boolean> {
  const url = `${env.AUTH_BASE}/api/v3/flows/executor/default-authentication-flow/`;
  let jar: string[] = [];
  const absorb = (r: Response) => {
    try {
      const sc = typeof r.headers.getSetCookie === 'function'
        ? r.headers.getSetCookie()
        : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie') as string] : []);
      jar = jar.concat(sc.map((c) => c.split(';')[0]));
    } catch { /* keep whatever jar we have */ }
  };
  const cookieHeader = (): Record<string, string> => (jar.length ? { cookie: jar.join('; ') } : {});
  const post = (payload: unknown) => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-msp-internal': env.MSP_INTERNAL_HEADER, ...cookieHeader() },
    body: JSON.stringify(payload),
  });
  try {
    // 1. start the flow, capture session/csrf cookies
    absorb(await fetch(url, { headers: { 'x-msp-internal': env.MSP_INTERNAL_HEADER } }));
    // 2. identification stage
    absorb(await post({ component: 'ak-stage-identification', uid_field: username }));
    // 3. password stage
    const pr = await post({ component: 'ak-stage-password', password });
    if (!pr.ok) return false;
    let data: any = null;
    try { data = await pr.json(); } catch { return false; }
    if (!data || typeof data !== 'object') return false;
    /* authentik 2026.8 emits snake_case response_errors (object keyed by field:
       {password: [{string, code}]}); the old camelCase check never matched.
       Wrong passwords still fell through to `return false` (component stays
       ak-stage-password with no `to`), so this is defense-in-depth, not a hole. */
    const errs = !!(Array.isArray(data.non_field_errors) && data.non_field_errors.length) ||
      !!data.responseErrors || !!data.response_errors || !!(Array.isArray(data.messages) && data.messages.length);
    // wrong password: executor re-renders the password stage with errors
    if (data.component === 'ak-stage-password' && errs) return false;
    // flow completed -> redirect target present
    if (typeof data.to === 'string' && data.to) return true;
    // password accepted, flow advanced to another stage (e.g. MFA)
    if (data.component && data.component !== 'ak-stage-password') return true;
    return false;
  } catch {
    return false;
  }
}

async function getSession(request: Request, env: Env): Promise<SessionData | null> {
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(new RegExp(`${COOKIE}=([a-zA-Z0-9_-]+)`));
  if (!m) return null;
  const raw = await env.SESSIONS.get(`sess:${m[1]}`);
  if (!raw) return null;
  return JSON.parse(raw) as SessionData;
}

async function refreshSession(env: Env, sess: SessionData): Promise<SessionData | null> {
  if (!sess.rt) return null;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: sess.rt,
    client_id: env.AUTHENTIK_CLIENT_ID,
  });
  const r = await fetch(`${env.AUTH_ISSUER}/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-msp-internal': env.MSP_INTERNAL_HEADER },
    body,
  });
  if (!r.ok) return null;
  const t = await r.json() as { access_token: string; refresh_token?: string };
  // Reset `created` so the 10-minute refresh window restarts. Without this the
  // stamp stays old and EVERY request re-runs this token round-trip.
  return { ...sess, at: t.access_token, rt: t.refresh_token ?? sess.rt, created: Date.now() };
}

// ---------- Referrals ----------
// KV layout: referral:<id> = { id, by, byName, name, service, note, status, at }
// plus referral-index = array of ids (small; one KV list call avoided, one put per referral).
async function listReferrals(env: Env, by?: string): Promise<any[]> {
  const ids: string[] = JSON.parse((await env.SESSIONS.get('referral-index')) || '[]');
  const out: any[] = [];
  for (const id of ids.slice(-200)) {
    try {
      const rec = JSON.parse((await env.SESSIONS.get('referral:' + id)) || 'null');
      if (rec && (!by || rec.by === by)) out.push(rec);
    } catch { /* skip bad record */ }
  }
  return out.reverse(); // newest first
}
async function indexReferral(env: Env, id: string): Promise<void> {
  const ids: string[] = JSON.parse((await env.SESSIONS.get('referral-index')) || '[]');
  ids.push(id);
  await env.SESSIONS.put('referral-index', JSON.stringify(ids.slice(-200)));
}

async function requireSession(request: Request, env: Env): Promise<{ sess: SessionData; sid: string } | Response> {
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(new RegExp(`${COOKIE}=([a-zA-Z0-9_-]+)`));
  if (!m) return json({ error: 'unauthorized' }, 401);
  const sid = m[1];
  const raw = await env.SESSIONS.get(`sess:${sid}`);
  if (!raw) return json({ error: 'unauthorized' }, 401);
  const sess = JSON.parse(raw) as SessionData;
  // Refresh when the access token is past half its lifetime (JWT exp/iat),
  // NOT on a fixed wall-clock timer. Dashboard provider tokens last 24h, so
  // this is ~1 refresh/day per active session instead of ~144. If the token
  // cannot be parsed (not a JWT), fall back to a 12h cap so the refresh rate
  // stays bounded either way.
  const refreshAt = accessTokenRefreshAt(sess.at);
  const stale = refreshAt > 0
    ? Date.now() >= refreshAt
    : (Date.now() - sess.created > 12 * 60 * 60 * 1000);
  if (stale) {
    const fresh = await refreshSession(env, sess);
    if (fresh) {
      await kvPutBestEffort(env, `sess:${sid}`, JSON.stringify(fresh), 180 * 86400);
      return { sess: fresh, sid };
    }
  }
  return { sess, sid };
}

// Resolve the NUMERIC authentik pk for a session user (404 on uuid in
// /core/users/{id}/). Looked up once via the admin token, cached 30d in KV.
async function resolveUpk(env: Env, sess: SessionData): Promise<number> {
  let upk = parseInt((await env.SESSIONS.get(`upk:${sess.sub}`)) || '', 10);
  if (upk) return upk;
  /* sub is whatever the OIDC provider's sub_mode emits — uuid, numeric pk,
     username, or a hashed id. Only the uuid can be queried directly; numeric
     pk IS the answer; everything else resolves through the username that
     lives in the session doc. (Broken when the provider stopped emitting
     uuids: ?uuid=4 -> 'Enter a valid UUID' -> upk 0 -> 502 on every
     profile/password write.) */
  const sub = String(sess.sub);
  let path = '';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sub)) {
    path = `/api/v3/core/users/?uuid=${sub}`;
  } else if (/^\d+$/.test(sub)) {
    upk = parseInt(sub, 10);
    await env.SESSIONS.put(`upk:${sess.sub}`, String(upk), { expirationTtl: 86400 * 30 });
    return upk;
  } else {
    path = `/api/v3/core/users/?username=${encodeURIComponent(sess.username)}`;
  }
  const lookup = await authentikFetch(env, env.AUTHENTIK_ADMIN_TOKEN, path);
  if (!lookup.ok) return 0;
  const arr = (await lookup.json() as { results?: { pk?: number }[] }).results || [];
  if (arr[0]?.pk) {
    upk = arr[0].pk;
    await env.SESSIONS.put(`upk:${sess.sub}`, String(upk), { expirationTtl: 86400 * 30 });
  }
  return upk || 0;
}

// ---------- Uptime Kuma: PUBLIC status page only ----------
// End-user surfaces (Services tab uptime bars, Home status card) must show
// ONLY the `public` visitor set ("Visitor Services" group), never the admin
// `homelab` page with all ~48 monitors. KUMA_STATUS_URL may point at any
// slug — derive just the origin here and request the `public` slug so the
// secret's value can never leak admin monitors to members.
const KUMA_PUBLIC_SLUG = 'public';

/* strict origin from a configured URL: scheme+host only, no path/query.
   Returns '' for anything that is not a well-formed http(s) URL. */
function cleanOrigin(raw: string | undefined): string {
  const s = (raw || '').trim();
  const m = s.match(/^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?=\/|$)/i);
  return m ? m[0] : '';
}

function kumaOrigin(env: Env): string {
  const raw = (env.KUMA_STATUS_URL || '').trim();
  const m = raw.match(/^https?:\/\/[^/]+/i);
  return m ? m[0] : 'https://status.mysweetpea.cc';
}

interface KumaMonitor {
  id: number;
  name: string;
  group: string;
  current: boolean;
  up24: number | null;
  beats: boolean[];
}

// Fetch + shape the public status page (page config for names/groups,
// heartbeat endpoint for beats/uptime). Cached 180s in the Cache API under a
// public-specific key (`cache:kuma-pub`) so switching slugs later stays trivial.
// Best-effort KV write for the small set of durable keys that remain in KV
// (session docs, the seerr-uid mapping). A KV failure (quota, transient
// errors) must never 500 a route — session refreshes retry on the next
// request. Response caches no longer live here (see cachePutJson).
async function kvPutBestEffort(env: Env, key: string, value: string, ttl: number): Promise<void> {
  try {
    await env.SESSIONS.put(key, value, { expirationTtl: Math.max(ttl, 60) });
  } catch { /* cache writes are best-effort */ }
}

// /api/config handler — public-safe deployment config (see route note)
async function handleConfig(env: Env): Promise<Response> {
  const cfg = {
    mainSite: cleanOrigin(env.MAIN_SITE_URL) || 'https://mysweetpea.cc',
    supportEmail: /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(env.SUPPORT_EMAIL || '') ? (env.SUPPORT_EMAIL as string) : 'support@mysweetpea.cc',
    media: cleanOrigin(env.JELLYFIN_URL) || 'https://media.mysweetpea.cc',
    request: cleanOrigin(env.SEERR_URL) || 'https://request.mysweetpea.cc',
  };
  const body = JSON.stringify(cfg);
  await cachePutJson('cache:spa-config', body, 3600).catch(() => {});
  return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}

// ---------- Response caches live in the Cache API, NOT KV ----------
// Everything under `cache:*` is a cache COPY, never durable state. The Workers
// KV free tier allows only 1,000 write operations/day (every put() counts,
// even to the same key) and the response caches were a large share of this
// account's ~890 writes/day peak. The Cache API is free, unmetered, per-colo,
// and does not touch the KV quota. KV now holds only durable state: sessions,
// PKCE verifiers, avatars, audit entries and rate-limit counters.
const CACHE_ORIGIN = 'https://cache.msp.internal';

function cacheUrl(key: string): string {
  return CACHE_ORIGIN + '/' + encodeURIComponent(key);
}

async function cacheGetJson(key: string): Promise<string | null> {
  try {
    const hit = await caches.default.match(new Request(cacheUrl(key)));
    return hit ? await hit.text() : null;
  } catch {
    return null;
  }
}

async function cachePutJson(key: string, body: string, ttlSeconds: number): Promise<void> {
  try {
    await caches.default.put(
      new Request(cacheUrl(key)),
      new Response(body, {
        headers: {
          'content-type': 'application/json',
          'cache-control': 'public, max-age=' + Math.max(ttlSeconds, 60),
        },
      }),
    );
  } catch {
    /* caches are droppable — never fail a request over a cache write */
  }
}

async function cacheDeleteJson(key: string): Promise<void> {
  try {
    await caches.default.delete(new Request(cacheUrl(key)));
  } catch {
    /* no-op */
  }
}

// When should this access token be refreshed? Read the JWT exp/iat claims
// (the signature is NOT verified here — authentik validates the token
// server-side on every API call; this is scheduling only). Refresh once half
// the token's lifetime has elapsed: ~1 refresh per 12h on the 24h tokens the
// dashboard provider now mints, and any old 15-minute token is re-minted
// once, immediately. This replaced a fixed "every 10 minutes" timer that
// cost ~144 KV writes per active session per day.
function accessTokenRefreshAt(token: string): number {
  try {
    const part = token.split('.')[1];
    if (!part) return 0;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '==='.slice((b64.length + 3) % 4);
    const claims = JSON.parse(atob(padded)) as { exp?: number; iat?: number };
    if (!claims.exp) return 0;
    const iat = claims.iat || (claims.exp - 900);
    const lifetimeMs = Math.max(claims.exp - iat, 300) * 1000;
    return claims.exp * 1000 - lifetimeMs / 2;
  } catch {
    return 0;
  }
}

// Stale-while-revalidate JSON helper.
// The dashboard's slow feel = blocking upstream fetches whenever a cache
// entry expires (media rows, stats). With SWR the client ALWAYS gets an
// answer in ~10ms when any cached copy exists (fresh OR stale); the refresh
// happens in the background via ctx.waitUntil. Only the very first request
// after a cold cache (or brand-new instance) pays upstream latency.
// Backed by the Cache API (see helpers above) — never KV.
// Stored shape: {"d": <payload string>, "t": <unix ms>}. Legacy raw payloads
// are treated as ts=0 (= immediately stale, served instantly + refreshed).
async function swrJson(ctx: ExecutionContext, env: Env, key: string, freshMs: number, produce: () => Promise<string>): Promise<string> {
  let payload: string | null = null;
  let ts = 0;
  const raw = await cacheGetJson(key);
  if (raw) {
    try {
      const p = JSON.parse(raw) as { d?: string; t?: number };
      if (typeof p?.d === 'string') { payload = p.d; ts = p.t || 0; }
      else { payload = raw; ts = 0; } // legacy format
    } catch { payload = raw; ts = 0; } // legacy non-JSON payload
  }
  const now = Date.now();
  const refresh = async (): Promise<void> => {
    try {
      const d = await produce();
      await cachePutJson(key, JSON.stringify({ d, t: Date.now() }), 86400);
    } catch { /* keep serving stale copy */ }
  };
  if (payload !== null && (now - ts) < freshMs) return payload; // fresh
  if (payload !== null) {
    ctx.waitUntil(refresh()); // stale: serve now, refresh behind the scenes
    return payload;
  }
  await refresh(); // cold: must block once
  const raw2 = await cacheGetJson(key);
  if (raw2) { try { const p = JSON.parse(raw2) as { d?: string }; if (typeof p?.d === 'string') return p.d; } catch { /* fall through */ } }
  return '{"items":[]}';
}

async function fetchPublicKuma(env: Env): Promise<{ monitors: KumaMonitor[] } | null> {
  const cached = await cacheGetJson('cache:kuma-pub');
  if (cached) {
    try { return JSON.parse(cached) as { monitors: KumaMonitor[] }; } catch { /* refetch */ }
  }
  const base = kumaOrigin(env);
  const opt: RequestInit = { headers: { 'user-agent': 'Mozilla/5.0', 'x-msp-internal': env.MSP_INTERNAL_HEADER } };
  let page: any = null;
  let hb: any = null;
  try {
    const [pageR, hbR] = await Promise.all([
      fetch(`${base}/api/status-page/${KUMA_PUBLIC_SLUG}`, opt),
      fetch(`${base}/api/status-page/heartbeat/${KUMA_PUBLIC_SLUG}`, opt),
    ]);
    if (!hbR.ok) return null;
    hb = await hbR.json();
    if (pageR.ok) page = await pageR.json();
  } catch {
    return null;
  }
  const heartbeatList = (hb && hb.heartbeatList) || {};
  const uptimeList = (hb && hb.uptimeList) || {};
  const groups: any[] = (page && Array.isArray(page.publicGroupList) && page.publicGroupList.length)
    ? page.publicGroupList
    : [{ name: '', monitorList: Object.keys(heartbeatList).map((id) => ({ id: parseInt(id, 10) || 0, name: '' })) }];
  const monitors: KumaMonitor[] = [];
  for (const g of groups) {
    const groupName = typeof g?.name === 'string' ? g.name : '';
    for (const m of (Array.isArray(g?.monitorList) ? g.monitorList : [])) {
      const id = Number(m?.id);
      if (!id) continue;
      const beats: boolean[] = ((heartbeatList[String(id)] || []) as { status?: number }[])
        .slice(-40)
        .map((h) => h?.status === 1);
      const up = uptimeList[`${id}_24`];
      monitors.push({
        id,
        name: typeof m?.name === 'string' ? m.name : `Monitor ${id}`,
        group: groupName,
        current: beats.length ? beats[beats.length - 1] : false,
        up24: typeof up === 'number' ? Math.round(up * 1000) / 10 : null,
        beats,
      });
    }
  }
  const payload = JSON.stringify({ monitors });
  await cachePutJson('cache:kuma-pub', payload, 180);
  return { monitors };
}

// ---------- Service updates feed (git commits + runtime reconcile) ----------
// argocd-image-updater commit format (verified 53/53 over 180d, 0 parse fails):
//   subject: build: automatic update of <app>
//   body:    updates image <image> tag '<from>' to '<to>'
// Pipeline: parse -> dedupe (app,from,to; keep earliest) -> drop downgrades
//   (ONLY when both tags version-like) -> 90d window -> reconcile.
// The pipeline itself lives in ./lib/updates-pipeline.mjs — SHARED with the
// unit test so tests can never drift from shipped behavior. This file keeps
// only the fetch (GitHub pages + runtime probes) and the HTTP surface.
// Reconcile rule: announce when to <= running (LTE, not == — equality would
// collapse every historical step; LTE keeps the chain and still suppresses the
// rolled-back nextcloud 35.0.0 chain). Non-version tags skip the comparison.
/* commits source repo: env-overridable (GH_COMMITS_REPO, 'owner/name'),
   literal = the homelab repo fallback */
const ghCommitsRepo = (env: Env) => {
  const raw = (env.GH_COMMITS_REPO || '').trim();
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw) ? raw : 'mysweetpea/mysweetpea-homelab';
};
const GH_PAGES = 6; // 600 commits ~ 34 days of history, covers the 30d Services window
// GitHub commit objects: only .sha, .commit.message and .commit.author.date are
// consumed (see parseUpdateCommit in the shared pipeline). Raw `any` is deliberate:
// third-party JSON, defensively parsed — malformed entries are dropped, not trusted.
async function fetchGithubCommitPages(env: Env): Promise<any[]> {
  const headers: Record<string, string> = {
    'user-agent': 'mysweetpea-dashboard',
    'accept': 'application/vnd.github+json',
  };
  if (env.GITHUB_TOKEN) headers['authorization'] = 'Bearer ' + env.GITHUB_TOKEN;
  let okCount = 0;
  const pages = await Promise.all(Array.from({ length: GH_PAGES }, async (_, i) => {
    try {
      const r = await fetch(`https://api.github.com/repos/${ghCommitsRepo(env)}/commits?per_page=100&page=${i + 1}`, { headers });
      if (!r.ok) return [];
      okCount++;
      return (await r.json() as any[]) || [];
    } catch { return []; }
  }));
  // Fail closed -> THROW when every page failed (GitHub outage / anon rate limit):
  // swrJson catches producer errors and keeps serving the previous payload, so a
  // transient GitHub hiccup can never blank the feed with an empty "fresh" copy.
  if (okCount === 0) throw new Error('github: all commit pages failed');
  return pages.flat();
}

async function fetchRunningVersions(): Promise<{ running: Record<string, number[]>; ok: number }> {
  const keys = Object.keys(RUNTIME_PROBES);
  const settled = await Promise.allSettled(keys.map(async (k) => {
    const p = RUNTIME_PROBES[k];
    const r = await fetch(p.url, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error(String(r.status));
    return parseVer(p.pick(await r.json()));
  }));
  const running: Record<string, number[]> = {};
  let ok = 0;
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled' && s.value) { running[keys[i]] = s.value; ok++; }
  });
  return { running, ok };
}

async function produceUpdates(env: Env): Promise<string> {
  // Runtime probes and the GitHub fetch are independent — start BOTH now so the
  // cold-cache latency is max(probes, github) instead of their sum.
  const runningP = fetchRunningVersions();
  const commits = await fetchGithubCommitPages(env);
  // parse -> dedupe (earliest) -> downgrade filter -> 90d window
  const { kept } = runPipeline(commits);
  // reconcile against live runtimes: drop releases that never ran, keep chains
  const { running, ok } = await runningP;
  const updates = reconcile(kept, running).map(buildUpdate);
  return JSON.stringify({ updates, generated: Date.now(), reconciled: ok > 0 });
}

// ---------- Library growth (Jellyfin DateCreated histogram) ----------
// The ONLY honest source is DateCreated on items (verified live 2026-09-17,
// server 10.11.11; MinDateCreated/MinDateLastSaved are dead ends — see
// ./lib/growth.mjs). Verified paging cost: 4,938 items = 5 calls / 1.77s at
// Limit=1000. Sort is not strictly reliable WITHIN a page, so paging
// continues while a page contains ANY in-window item; a partial page
// (< Limit) is the true end of data. MAX_PAGES guards a pathological sort
// (12 x 1000 = 12k items) and reports partial:true to the UI.
const GROWTH_PAGE = 1000;
const GROWTH_MAX_PAGES = 12;

async function fetchJellyfinGrowthItems(env: Env): Promise<{ items: any[]; partial: boolean }> {
  const base = String(env.JELLYFIN_URL || '').replace(/\/+$/, '');
  const windowStart = new Date(Date.now() - (WINDOW_DAYS - 1) * 86400000).toISOString().slice(0, 10);
  const items: any[] = [];
  for (let page = 0; page < GROWTH_MAX_PAGES; page++) {
    const r = await fetch(base + '/Items?Recursive=true&IncludeItemTypes=Movie,Series,Episode' +
      '&Fields=DateCreated&EnableImages=false&EnableUserData=false' +
      '&SortBy=DateCreated&SortOrder=Descending' +
      '&StartIndex=' + (page * GROWTH_PAGE) + '&Limit=' + GROWTH_PAGE,
      { headers: { authorization: `MediaBrowser Token="${env.JELLYFIN_API_KEY}"` } });
    if (!r.ok) throw new Error('jellyfin ' + r.status);
    const d = await r.json() as any;
    const pageItems = (Array.isArray(d && d.Items) ? d.Items : []) as any[];
    items.push(...pageItems);
    if (pageItems.length < GROWTH_PAGE) return { items, partial: false }; // partial page = end of data
    const anyInWindow = pageItems.some((it) => String((it && it.DateCreated) || '').slice(0, 10) >= windowStart);
    if (!anyInWindow) return { items, partial: false }; // zero in-window here -> older pages are too
  }
  return { items, partial: true }; // MAX_PAGES guard hit — return what we have
}

async function produceGrowth(env: Env): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  // FAIL-CLOSED: on a Jellyfin error, THROW so swrJson keeps serving the last
  // good payload (its catch keeps the stale copy). Returning a zero payload
  // here would be cached as "fresh" for a full hour and blank the card even
  // after Jellyfin recovers — the exact failure mode the updates feed avoids.
  const { items, partial } = await fetchJellyfinGrowthItems(env);
  const growth = computeGrowth(bucketByDay(items), today, { partial });
  // True library size (all-time, NOT window-scoped) — /Items/Counts is a
  // separate cheap call already used by /api/stats. totals.all counts only
  // items ADDED in the window, so the card must not label it "in library".
  growth.libraryTotal = null;
  growth.libraryMovies = null;
  growth.librarySeries = null;
  growth.libraryEpisodes = null;
  try {
    const r = await fetch(String(env.JELLYFIN_URL || '').replace(/\/+$/, '') + '/Items/Counts',
      { headers: { authorization: `MediaBrowser Token="${env.JELLYFIN_API_KEY}"` } });
    if (r.ok) {
      const c = await r.json() as any;
      const sum = ['MovieCount', 'SeriesCount', 'EpisodeCount']
        .reduce((a, k) => a + (typeof c[k] === 'number' ? c[k] : 0), 0);
      growth.libraryTotal = sum || null;
      growth.libraryMovies = typeof c.MovieCount === 'number' ? c.MovieCount : null;
      growth.librarySeries = typeof c.SeriesCount === 'number' ? c.SeriesCount : null;
      growth.libraryEpisodes = typeof c.EpisodeCount === 'number' ? c.EpisodeCount : null;
    }
  } catch { /* counts are nice-to-have; the card still renders */ }
  return JSON.stringify(growth);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const res = await this.handle(request, env, ctx);
    // security headers on every response (dashboard is auth-gated, but
    // defense-in-depth costs nothing — mirrors the site worker's posture)
    const h = new Headers(res.headers);
    if (!h.has('X-Frame-Options')) h.set('X-Frame-Options', 'DENY');
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  },

  async handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // ---------- auth ----------
    if (path === '/auth/login') {
      // Cookie-free PKCE: the verifier lives server-side in KV keyed by
      // state (state already travels in the authorize URL). The previous
      // design set the pkce cookie on this cross-site 302; some
      // browsers/extensions drop Set-Cookie during redirect chains, the
      // callback then 400'd on a missing cookie and login looped forever.
      const state = randomB64u(16);
      const verifier = randomB64u(64);
      const challenge = b64uEncode(await sha256(verifier));
      await env.SESSIONS.put(`pkce:${state}`, verifier, { expirationTtl: 600 });
      const authorizeUrl = new URL(`${env.AUTH_ISSUER}/authorize/`);
      authorizeUrl.searchParams.set('client_id', env.AUTHENTIK_CLIENT_ID);
      authorizeUrl.searchParams.set('redirect_uri', new URL('/auth/callback', env.APP_URL).toString());
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('scope', SCOPES);
      authorizeUrl.searchParams.set('state', state);
      authorizeUrl.searchParams.set('code_challenge', challenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');
      return Response.redirect(authorizeUrl.toString(), 302);
    }

    if (path === '/auth/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state) {
        return new Response('Invalid OAuth state', { status: 400 });
      }
      // Cookie-free PKCE: verifier from KV by state (one-time read).
      const verifier = await env.SESSIONS.get(`pkce:${state}`);
      if (!verifier) {
        return new Response('Invalid OAuth state', { status: 400 });
      }
      await env.SESSIONS.delete(`pkce:${state}`);
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: new URL('/auth/callback', env.APP_URL).toString(),
        client_id: env.AUTHENTIK_CLIENT_ID,
        code_verifier: verifier,
      });
      const tr = await fetch(`${env.AUTH_ISSUER}/token/`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-msp-internal': env.MSP_INTERNAL_HEADER },
        body,
      });
      if (!tr.ok) return new Response('Token exchange failed', { status: 502 });
      const tokens = await tr.json() as { access_token: string; refresh_token?: string; id_token?: string };

      // fetch profile as the user
      const me = await authentikFetch(env, tokens.access_token, '/api/v3/core/users/me/');
      if (!me.ok) return new Response('Profile fetch failed', { status: 502 });
      const meData = await me.json() as { user: { pk: string; username: string; name: string; email: string; is_active: boolean } };
      if (!meData.user.is_active) return new Response('Account disabled', { status: 403 });

      const sid = randomB64u(32);
      const sess: SessionData = {
        at: tokens.access_token,
        rt: tokens.refresh_token,
        sub: meData.user.pk,
        username: meData.user.username,
        name: meData.user.name,
        email: meData.user.email,
        created: Date.now(),
      };
      await env.SESSIONS.put(`sess:${sid}`, JSON.stringify(sess), { expirationTtl: 180 * 86400 });
      // audit
      const audit = { t: Date.now(), event: 'login', ip: request.headers.get('cf-connecting-ip') || '' };
      await env.SESSIONS.put(`audit:${sess.sub}:${Date.now()}`, JSON.stringify(audit), { expirationTtl: 90 * 86400 });

      // One-time landing token: avoids Set-Cookie during the cross-site
      // navigation (privacy blockers eat those). The interstitial exchanges
      // this token for the session cookie via a same-site fetch.
      const token = randomB64u(32);
      await env.SESSIONS.put('land:' + token, sid, { expirationTtl: 60 });
      const headers = new Headers({ 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' });
      headers.append('set-cookie', 'msp_pkce=; Path=/auth; HttpOnly; Secure; Max-Age=0');
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Signing you in…</title>
<style>body{background:#0C1316;color:#EDF3F4;font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.c{width:46px;height:46px;border:3px solid rgba(143,175,181,.2);border-top-color:#8FAFB5;border-radius:50%;animation:s 0.9s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}</style></head>
<body><div class="c"></div><script>
(async () => {
  const t = ${JSON.stringify(token)};
  try {
    const lr = await fetch('/auth/land', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: t }), credentials: 'include' });
    if (!lr.ok) throw new Error('land failed ' + lr.status);
  } catch (e) { location.replace('/?login_retry=1'); return; }
  let n = 0;
  const go = () => fetch('/api/me', { credentials: 'include' }).then(r => {
    if (r.ok) location.replace('/');
    else if (++n < 20) setTimeout(go, 250);
    else location.replace('/?login_retry=1');
  }).catch(() => { if (++n < 20) setTimeout(go, 250); else location.replace('/?login_retry=1'); });
  go();
})();
</script></body></html>`;
      return new Response(html, { status: 200, headers });
    }

    // Popup ceremony: deep-link into an authentik-hosted setup flow with
    // a return-to-dashboard next. The user's authentik browser session runs
    // the ceremony (stock-supported path); completion lands back on /.
    if (path === '/auth/ceremony') {
      // authentik's embedded user interface handles all self-service
      // ceremonies with the user's own browser session (stock-supported).
      // 2026.8 dropped #/mfa-style fragments: deep links are now
      // #/settings;{"page":"page-<key>"} (verified in the UI bundle).
      // Serve a tiny client-side redirector instead of a Location header so
      // the raw JSON fragment survives without URL-encoding questions.
      const f = url.searchParams.get('f') || 'mfa';
      const page = /password/.test(f) ? 'page-details'
                 : /session/.test(f) ? 'page-sessions'
                 : 'page-credentials';
      const html = `<!doctype html><meta charset="utf-8"><title>Opening settings…</title>
<script>location.replace(${JSON.stringify(env.AUTH_BASE + '/if/user/#/settings;')} + ${JSON.stringify(JSON.stringify({ page }))});</script>`;
      return new Response(html, { headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' } });
    }

    if (path === '/auth/land' && request.method === 'POST') {
      const { token } = await request.json() as { token?: string };
      if (!token) return json({ ok: false, error: 'no token' }, 400);
      const sid = await env.SESSIONS.get('land:' + token);
      if (!sid) return json({ ok: false, error: 'token expired' }, 401);
      await env.SESSIONS.delete('land:' + token);
      const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
      headers.append('set-cookie', `${COOKIE}=${sid}; Domain=.mysweetpea.cc; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000`);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    if (path === '/auth/logout') {
      const cookie = request.headers.get('cookie') || '';
      const m = cookie.match(new RegExp(`${COOKIE}=([a-zA-Z0-9_-]+)`));
      if (m) await env.SESSIONS.delete(`sess:${m[1]}`);
      const headers = new Headers({ location: '/' });
      headers.append('set-cookie', `${COOKIE}=; Domain=.mysweetpea.cc; Path=/; HttpOnly; Secure; Max-Age=0`);
      return new Response(null, { status: 302, headers });
    }

    // ---------- API ----------
    // Portal identity probe (no auth roundtrip): the site worker proxies this
    // so its nav chip can show "Sign in" vs the user's first name.
    if (path === '/api/auth/state') {
      const cookie = request.headers.get('cookie') || '';
      const m = cookie.match(new RegExp(`${COOKIE}=([a-zA-Z0-9_-]+)`));
      let raw: string | null = null;
      if (m) raw = await env.SESSIONS.get(`sess:${m[1]}`);
      const logged_in = !!raw;
      if (logged_in && url.searchParams.get('name') === '1') {
        try {
          const s = JSON.parse(raw as string) as Partial<SessionData>;
          return json({ logged_in, name: s.name || s.username || '' });
        } catch {
          return json({ logged_in });
        }
      }
      return json({ logged_in });
    }
    if (path === '/api/config') {
      // PUBLIC (like /api/auth/state): the login gate + pre-login shell adopt
      // this config too; body is public-safe by construction (no secrets).
      return handleConfig(env);
    }
    if (path === '/api/ingest/svc-stats' && request.method === 'POST') {
      // Cluster -> worker snapshot push (in-cluster services can't be reached
      // by the worker directly). Auth: shared internal header, NOT user auth.
      // Body: { key: 'nextcloud'|'vaultwarden'|'affine'|'openwebui', stats: {...} }
      // Stored under svc-stats:<key> with 48h TTL — a dead pusher degrades to
      // '—' tiles instead of showing stale numbers forever.
      if (request.headers.get('x-msp-internal') !== env.MSP_INTERNAL_HEADER) {
        return json({ error: 'forbidden' }, 403);
      }
      let body: any;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      const ALLOWED = new Set(['nextcloud', 'vaultwarden', 'affine', 'openwebui']);
      const key = typeof body?.key === 'string' ? body.key : '';
      if (!ALLOWED.has(key)) return json({ error: 'bad key' }, 400);
      const stats = body?.stats;
      if (!stats || typeof stats !== 'object') return json({ error: 'bad stats' }, 400);
      // Whitelist numeric fields only — never store arbitrary JSON.
      const clean: Record<string, number | null> = {};
      for (const [k, v] of Object.entries(stats as Record<string, unknown>)) {
        if (!/^[a-z_]{1,40}$/.test(k)) continue;
        if (typeof v === 'number' && isFinite(v)) clean[k] = v;
        else if (v === null) clean[k] = null;
      }
      await env.SESSIONS.put('svc-stats:' + key, JSON.stringify(clean), { expirationTtl: 172800 });
      return json({ ok: true, fields: Object.keys(clean).length });
    }
    if (path === '/api/referral/status' && request.method === 'PATCH') {
      // Owner-only status flip (internal header, like the ingest route).
      if (request.headers.get('x-msp-internal') !== env.MSP_INTERNAL_HEADER) {
        return json({ error: 'forbidden' }, 403);
      }
      let body: any;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      const id = typeof body?.id === 'string' ? body.id.slice(0, 40) : '';
      const status = typeof body?.status === 'string' ? body.status : '';
      if (!id || !REFERRAL_STATUSES_OK.has(status)) return json({ error: 'bad id/status' }, 400);
      const raw = await env.SESSIONS.get('referral:' + id);
      if (!raw) return json({ error: 'not found' }, 404);
      const rec = JSON.parse(raw);
      rec.status = status;
      await env.SESSIONS.put('referral:' + id, JSON.stringify(rec));
      return json({ ok: true });
    }
    if (path.startsWith('/api/')) {
      const auth = await requireSession(request, env);
      if (auth instanceof Response) return auth;
      const { sess, sid } = auth;

      if (path === '/api/me') {
        // SWR-cached: /api/me is called on EVERY dashboard load and does a live
        // authentik round-trip; the profile rarely changes, so cache it per-user
        // (60s fresh, stale-served instantly while refreshing in the background).
        // ⚠️ MUST NOT cache failures: an expired/momentary authentik error used to
        // get cached as the "profile" (HTTP 200, body {detail:...}) for 24h, which
        // crashed the client boot (applyAcctMenu .split of undefined) and left the
        // tab bar unpainted. Failures now bypass the cache AND return their real
        // status; stale-but-valid cached profiles are still served instantly.
        const meKey = 'cache:me:' + sess.sub;
        const meProduce = async (): Promise<string> => {
          const r = await authentikFetch(env, sess.at, '/api/v3/core/users/me/');
          const d = await r.json() as any;
          const user = d && d.user ? d.user : d;
          // Auth/permission failure or malformed body -> signal error, do not cache.
          if (!r.ok || !user || typeof user.username !== 'string' || user.username === '') {
            throw new Error('me ' + r.status);
          }
          user.has_avatar = false;
          user.avatar_ts = 0;
          // tier badge: membership of the authentik 'sweetpea' / 'seedling' groups
          const groupNames = (user.groups || []).map((g: any) => String(g && g.name || '').toLowerCase());
          user.tier = groupNames.includes('sweetpea') ? 'sweetpea'
                    : groupNames.includes('seedling') ? 'seedling'
                    : 'seedling';
          try {
            const m = await env.SESSIONS.get(`avm:${sess.sub}`);
            if (m) {
              const meta = JSON.parse(m) as { updated?: number };
              user.has_avatar = true;
              user.avatar_ts = meta.updated || 0;
            }
          } catch { /* fall back to initials */ }
          return JSON.stringify(user);
        };
        // Serve fresh cache directly; serve stale cache instantly + refresh behind;
        // on cold miss do a blocking fetch but NEVER cache/return an error body.
        let meRaw: string | null = null;
        let meFresh = false;
        const raw = await cacheGetJson(meKey);
        if (raw) {
          try {
            const p = JSON.parse(raw) as { d?: string; t?: number };
            if (typeof p?.d === 'string' && p.d.indexOf('"detail"') < 0) {
              meRaw = p.d;
              meFresh = (Date.now() - (p.t || 0)) < 60000;
            }
          } catch { /* cold */ }
        }
        if (meRaw && meFresh) {
          return new Response(meRaw, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
        }
        if (meRaw) {
          ctx.waitUntil((async () => { try { const d = await meProduce(); await cachePutJson(meKey, JSON.stringify({ d, t: Date.now() }), 86400); } catch { /* keep serving stale */ } })());
          return new Response(meRaw, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
        }
        try {
          const d = await meProduce();
          await cachePutJson(meKey, JSON.stringify({ d, t: Date.now() }), 86400);
          return new Response(d, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
        } catch {
          // Real failure (token expired/authentik down): surface it honestly so the
          // client falls back to the sign-in gate instead of crashing mid-boot.
          return json({ error: 'unauthorized' }, 401);
        }
      }

      // ---------- avatar (KV-stored profile picture) ----------
      if (path === '/api/avatar/meta') {
        const m = await env.SESSIONS.get(`avm:${sess.sub}`);
        if (!m) return json({ has: false, mime: '', bytes: 0, updated: 0 });
        try {
          const meta = JSON.parse(m) as { mime: string; bytes: number; updated: number };
          return json({ has: true, mime: meta.mime || '', bytes: meta.bytes || 0, updated: meta.updated || 0 });
        } catch {
          return json({ has: false, mime: '', bytes: 0, updated: 0 });
        }
      }
      if (path === '/api/avatar' && request.method === 'POST') {
        let body: { data?: string } = {};
        try { body = await request.json() as { data?: string }; } catch {}
        if (!body.data || typeof body.data !== 'string') return json({ error: 'Missing image data' }, 400);
        // 512KB max after base64 decode (~700KB of base64 text); reject before decoding huge payloads
        if (body.data.length > 700000) return json({ error: 'Image too large (max 512KB)' }, 413);
        // Fast path: Uint8Array.fromBase64 (native, ~6x faster than the
        // atob + charCodeAt loop for 512KB payloads — probe-verified on this
        // runtime). Falls back to atob where unavailable (older runtimes).
        let bytes: Uint8Array;
        try {
          bytes = (typeof (Uint8Array as any).fromBase64 === 'function')
            ? (Uint8Array as any).fromBase64(body.data)
            : (() => {
                const bin = atob(body.data);
                const u = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
                return u;
              })();
        } catch { return json({ error: 'Invalid image data' }, 400); }
        if (bytes.length > 512 * 1024) return json({ error: 'Image too large (max 512KB)' }, 413);
        const mime = sniffImageMime(bytes);
        if (!mime) return json({ error: 'Unsupported image type (use PNG, JPEG or WebP)' }, 400);
        await env.SESSIONS.put(`av:${sess.sub}`, bytes.buffer as ArrayBuffer);
        const updated = Date.now();
        await env.SESSIONS.put(`avm:${sess.sub}`, JSON.stringify({ mime, bytes: bytes.length, updated }));
        await env.SESSIONS.put(`audit:${sess.sub}:${updated}`, JSON.stringify({ t: updated, event: 'avatar_set' }), { expirationTtl: 90 * 86400 });
        return json({ ok: true });
      }
      if (path === '/api/avatar' && request.method === 'DELETE') {
        await env.SESSIONS.delete(`av:${sess.sub}`);
        await env.SESSIONS.delete(`avm:${sess.sub}`);
        const now = Date.now();
        await env.SESSIONS.put(`audit:${sess.sub}:${now}`, JSON.stringify({ t: now, event: 'avatar_removed' }), { expirationTtl: 90 * 86400 });
        return json({ ok: true });
      }
      if (path === '/api/avatar') {
        const m = await env.SESSIONS.get(`avm:${sess.sub}`);
        if (!m) return json({ error: 'no avatar' }, 404);
        const data = await env.SESSIONS.get(`av:${sess.sub}`, { type: 'arrayBuffer' });
        if (!data) return json({ error: 'no avatar' }, 404);
        let mime = 'application/octet-stream';
        try { mime = (JSON.parse(m) as { mime?: string }).mime || mime; } catch {}
        return new Response(data, {
          headers: { 'content-type': mime, 'cache-control': 'private, max-age=300' },
        });
      }

      // ---------- profile edit (name + email) with password step-up ----------
      if (path === '/api/profile/update' && request.method === 'POST') {
        let body: { name?: unknown; email?: unknown; password?: unknown } = {};
        try { body = await request.json() as typeof body; } catch {}
        const password = typeof body.password === 'string' ? body.password : '';
        if (!password) return json({ error: 'Your password is required to save changes.' }, 400);

        const updates: { name?: string; email?: string } = {};
        if (body.name !== undefined) {
          if (typeof body.name !== 'string') return json({ error: 'Name must be 1-80 characters.' }, 400);
          const name = body.name.trim();
          if (name.length < 1 || name.length > 80) return json({ error: 'Name must be 1-80 characters.' }, 400);
          updates.name = name;
        }
        if (body.email !== undefined) {
          if (typeof body.email !== 'string') return json({ error: 'Enter a valid email address.' }, 400);
          const email = body.email.trim();
          if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
          updates.email = email;
        }
        if (!updates.name && !updates.email) return json({ error: 'Nothing to update.' }, 400);

        // rate limit: 5 attempts per hour (counter increments even on failure)
        const rlKey = `rl:prof:${sess.sub}`;
        const count = (parseInt((await env.SESSIONS.get(rlKey)) || '0', 10) || 0) + 1;
        await env.SESSIONS.put(rlKey, String(count), { expirationTtl: 3600 });
        if (count > 5) return json({ error: 'Too many attempts, try again later' }, 429);

        if (!(await verifyPassword(env, sess.username, password))) {
          return json({ error: 'Incorrect password' }, 401);
        }

        // authentik FOSS denies self-writes; the worker patches via an admin
        // token, gated by the step-up above (user can only change their own).
        const upk = await resolveUpk(env, sess);
        if (!upk) return json({ error: 'Profile update failed.' }, 502);
        const pr = await authentikFetch(env, env.AUTHENTIK_ADMIN_TOKEN, `/api/v3/core/users/${upk}/`, {
          method: 'PATCH',
          body: JSON.stringify(updates),
        });
        if (!pr.ok) return json({ error: 'Profile update failed.' }, 502);

        // keep the KV session doc in sync so the dashboard reflects immediately
        const raw = await env.SESSIONS.get(`sess:${sid}`);
        if (raw) {
          const doc = JSON.parse(raw) as SessionData;
          if (updates.name) doc.name = updates.name;
          if (updates.email) doc.email = updates.email;
          await env.SESSIONS.put(`sess:${sid}`, JSON.stringify(doc), { expirationTtl: 180 * 86400 });
        }

        const now = Date.now();
        await env.SESSIONS.put(`audit:${sess.sub}:${now}`, JSON.stringify({ t: now, event: 'profile_updated', fields: Object.keys(updates) }), { expirationTtl: 90 * 86400 });
        await cacheDeleteJson('cache:me:' + sess.sub); // invalidate /api/me cache
        return json({ ok: true, name: updates.name ?? sess.name, email: updates.email ?? sess.email });
      }

      // ---------- inline password change (verifies current, writes to authentik) ----------
      if (path === '/api/password/change' && request.method === 'POST') {
        let body: { currentPassword?: unknown; newPassword?: unknown } = {};
        try { body = await request.json() as typeof body; } catch {}
        const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
        const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
        if (!currentPassword || !newPassword) return json({ error: 'Both fields are required.' }, 400);
        if (newPassword.length < 12) return json({ error: 'New password must be at least 12 characters.' }, 400);

        // rate limit: 5 attempts per hour (counter increments even on failure)
        const rlKey = `rl:pw:${sess.sub}`;
        const count = (parseInt((await env.SESSIONS.get(rlKey)) || '0', 10) || 0) + 1;
        await env.SESSIONS.put(rlKey, String(count), { expirationTtl: 3600 });
        if (count > 5) return json({ error: 'Too many attempts, try again later' }, 429);

        if (!(await verifyPassword(env, sess.username, currentPassword))) {
          return json({ error: 'Incorrect current password' }, 401);
        }

        const upk = await resolveUpk(env, sess);
        if (!upk) return json({ error: 'Password change failed.' }, 502);
        const pr = await authentikFetch(env, env.AUTHENTIK_ADMIN_TOKEN, `/api/v3/core/users/${upk}/set_password/`, {
          method: 'POST',
          body: JSON.stringify({ password: newPassword }),
        });
        if (!pr.ok) return json({ error: 'Password change failed.' }, 502);

        const now = Date.now();
        await env.SESSIONS.put(`audit:${sess.sub}:${now}`, JSON.stringify({ t: now, event: 'password_changed' }), { expirationTtl: 90 * 86400 });
        return json({ ok: true });
      }

      if (path === '/api/sessions') {
        const r = await authentikFetch(env, sess.at, '/api/v3/core/authenticated_sessions/');
        return json(await r.json(), r.status);
      }
      if (path === '/api/consents') {
        const r = await authentikFetch(env, sess.at, '/api/v3/core/user_consent/');
        return json(await r.json(), r.status);
      }
      if (path === '/api/devices') {
        const r = await authentikFetch(env, sess.at, '/api/v3/authenticators/totp/?include_unconfirmed=true');
        const r2 = await authentikFetch(env, sess.at, '/api/v3/authenticators/webauthn/');
        const r3 = await authentikFetch(env, sess.at, '/api/v3/authenticators/static/');
        const [totp, webauthn, statics] = await Promise.all([r.json(), r2.json(), r3.json()]);
        return json({ totp: totp.results ?? [], webauthn: webauthn.results ?? [], static: statics.results ?? [] });
      }
      if (path === '/api/stats') {
        // SWR: instant from cache (fresh OR stale); refresh in background.
        // Per-service tiles for in-cluster-only services (Nextcloud,
        // Vaultwarden, AFFiNE, Open WebUI) come from a KV snapshot pushed by
        // the cluster (svc-stats:<key>) — the worker cannot reach
        // cluster-internal hosts, and public origins sit behind BFM.
        const out: Record<string, number | string | null> = {
          movies: null, series: null, episodes: null, songs: null, boxsets: null, jf_resume: null,
          jf_watch_hours: null, jf_resume_titles: null, jf_top_title: null,
          photos: null, videos: null, usage_mb: null,
          users: null, sessions: null,
          seerr_total: null, seerr_pending: null, seerr_approved: null, seerr_available: null, seerr_media: null,
          nc_files: null, nc_shares: null, nc_activity: null,
          vw_users: null, vw_items: null,
          affine_users: null, affine_docs: null, affine_workspaces: null,
          owui_users: null, owui_chats: null,
        };
        const payload = await swrJson(ctx, env, 'cache:stats', 300000, async () => {
          for (const k of ['svc-stats:nextcloud', 'svc-stats:vaultwarden', 'svc-stats:affine', 'svc-stats:openwebui']) {
            try {
              const raw = await env.SESSIONS.get(k);
              if (raw) Object.assign(out, JSON.parse(raw) as Record<string, number | null>);
            } catch { /* bad snapshot -> keep nulls (honest) */ }
          }
          await Promise.all([
            (async () => {
              try {
                const r = await fetch(env.JELLYFIN_URL + '/Items/Counts', { headers: { authorization: `MediaBrowser Token="${env.JELLYFIN_API_KEY}"` } });
                if (r.ok) {
                  const d = await r.json() as any;
                  out.movies = d.MovieCount ?? null;
                  out.series = d.SeriesCount ?? null;
                  out.episodes = d.EpisodeCount ?? null;
                  out.songs = d.SongCount ?? null;
                  out.boxsets = d.BoxSetCount ?? null;
                }
              } catch {}
            })(),
            (async () => {
              // resume/watching count — TotalRecordCount only, no item fetch
              try {
                const r = await fetch(env.JELLYFIN_URL + '/Items?userId=' + env.JELLYFIN_USER_ID +
                  '&Recursive=true&Filters=IsResumable&Limit=1',
                  { headers: { authorization: `MediaBrowser Token="${env.JELLYFIN_API_KEY}"` } });
                if (r.ok) {
                  const d = await r.json() as any;
                  out.jf_resume = typeof d.TotalRecordCount === 'number' ? d.TotalRecordCount : null;
                }
              } catch {}
            })(),
            (async () => {
              // wrapped hero: sum playback positions of resumable items -> watch hours
              try {
                const r = await fetch(env.JELLYFIN_URL + '/Items?userId=' + env.JELLYFIN_USER_ID +
                  '&Recursive=true&Filters=IsResumable&Fields=UserData,PlaybackPositionTicks&Limit=50',
                  { headers: { authorization: `MediaBrowser Token="${env.JELLYFIN_API_KEY}"` } });
                if (r.ok) {
                  const d = await r.json() as any;
                  const items = (Array.isArray(d.Items) ? d.Items : []) as any[];
                  let hours = 0;
                  for (const it of items) hours += (it && it.UserData && typeof it.UserData.PlaybackPositionTicks === 'number' ? it.UserData.PlaybackPositionTicks : 0) / 3.6e10; // .NET ticks are 100ns: 1e7/s * 3600s
                  out.jf_watch_hours = Math.round(hours * 10) / 10;
                  out.jf_resume_titles = items.length;
                  out.jf_top_title = (items[0] && typeof items[0].Name === 'string' && items[0].Name) || null;
                }
              } catch {}
            })(),
            (async () => {
              try {
                const r = await fetch(env.IMMICH_URL + '/api/server/statistics', { headers: { 'x-api-key': env.IMMICH_API_KEY } });
                if (r.ok) {
                  const d = await r.json() as any;
                  out.photos = d.photos ?? null;
                  out.videos = d.videos ?? null;
                  if (typeof d.usage === 'number') out.usage_mb = Math.round(d.usage / 1048576);
                }
              } catch {}
            })(),
            (async () => {
              try {
                // admin token: total member count from the users pagination header
                const r = await authentikFetch(env, env.AUTHENTIK_ADMIN_TOKEN, '/api/v3/core/users/?page=1&page_size=1');
                if (r.ok) {
                  const d = await r.json() as any;
                  const c = d && d.pagination && typeof d.pagination.count === 'number' ? d.pagination.count : null;
                  out.users = c;
                }
              } catch {}
            })(),
            (async () => {
              try {
                const s = await authentikFetch(env, sess.at, '/api/v3/core/authenticated_sessions/');
                if (s.ok) { const d = await s.json() as any; out.sessions = (d.results ?? []).length; }
              } catch {}
            })(),
            (async () => {
              try {
                // /api/v1 ONLY: this Seerr fork 307s /api/v3 to /login. Browser
                // UA required (Cloudflare BFM 403s server UAs).
                const r = await fetch(env.SEERR_URL + '/api/v1/request/count', { headers: { 'user-agent': SEERR_UA, 'X-Api-Key': env.SEERR_API_KEY } });
                if (r.ok) {
                  const d = await r.json() as any;
                  out.seerr_total = typeof d.total === 'number' ? d.total : null;
                  out.seerr_pending = typeof d.pending === 'number' ? d.pending : null;
                  out.seerr_approved = typeof d.approved === 'number' ? d.approved : null;
                  out.seerr_available = typeof d.available === 'number' ? d.available : null;
                }
              } catch {}
            })(),
            (async () => {
              try {
                const r = await fetch(env.SEERR_URL + '/api/v1/media?take=1', { headers: { 'user-agent': SEERR_UA, 'X-Api-Key': env.SEERR_API_KEY } });
                if (r.ok) {
                  const d = await r.json() as any;
                  const total = d && d.pageInfo && (d.pageInfo.results ?? d.pageInfo.resultsTotal);
                  out.seerr_media = typeof total === 'number' ? total : null;
                }
              } catch {}
            })(),
          ]);
          return JSON.stringify(out);
        });
        return new Response(payload, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      }
      if (path === '/api/media/continue') {
        // SWR: instant from cache (fresh OR stale); refresh in background.
        const payload = await swrJson(ctx, env, 'cache:media-cont', 120000, async () => {
          const r = await fetch(env.JELLYFIN_URL + '/Items?userId=' + env.JELLYFIN_USER_ID +
            '&Recursive=true&SortBy=DatePlayed&SortOrder=Descending&Filters=IsResumable' +
            '&IncludeItemTypes=Movie,Episode&Limit=12&Fields=ProductionYear,SeriesName&EnableImages=true',
            { headers: { authorization: `MediaBrowser Token="${env.JELLYFIN_API_KEY}"` } });
          if (!r.ok) throw new Error('jellyfin ' + r.status);
          const d = await r.json() as any;
          const items = ((d.Items ?? []) as any[]).map((it) => ({
            id: it.Id,
            name: it.Name,
            seriesName: it.SeriesName ?? '',
            type: it.Type,
            progressPct: Math.round(it.UserData?.PlayedPercentage ?? 0),
            img: env.JELLYFIN_URL + '/Items/' + it.Id + '/Images/Primary?fillHeight=420&fillWidth=280&quality=75',
          }));
          return JSON.stringify({ items });
        });
        return json(JSON.parse(payload));
      }
      if (path === '/api/media/latest') {
        // SWR: instant from cache (fresh OR stale); refresh in background.
        const payload = await swrJson(ctx, env, 'cache:media-latest', 300000, async () => {
          const r = await fetch(env.JELLYFIN_URL + '/Items/Latest?userId=' + env.JELLYFIN_USER_ID + '&Limit=12&EnableImages=true',
            { headers: { authorization: `MediaBrowser Token="${env.JELLYFIN_API_KEY}"` } });
          if (!r.ok) throw new Error('jellyfin ' + r.status);
          const d = await r.json() as any;
          const items = ((Array.isArray(d) ? d : []) as any[]).map((it) => ({
            id: it.Id,
            name: it.Name,
            seriesName: it.SeriesName ?? '',
            type: it.Type,
            img: env.JELLYFIN_URL + '/Items/' + it.Id + '/Images/Primary?fillHeight=420&fillWidth=280&quality=75',
          }));
          return JSON.stringify({ items });
        });
        return json(JSON.parse(payload));
      }
      if (path === '/api/media/mostplayed') {
        // Most-played movies+series (PlayCount desc). Deep Media tab — not on Home.
        const payload = await swrJson(ctx, env, 'cache:media-mostplayed', 600000, async () => {
          const r = await fetch(env.JELLYFIN_URL + '/Items?userId=' + env.JELLYFIN_USER_ID + '&SortBy=PlayCount&SortOrder=Descending&Recursive=true&Limit=12&IncludeItemTypes=Movie,Series&Fields=ProductionYear,CommunityRating&EnableImages=true',
            { headers: { authorization: `MediaBrowser Token="${env.JELLYFIN_API_KEY}"` } });
          if (!r.ok) throw new Error('jellyfin ' + r.status);
          const d = await r.json() as any;
          const items = ((d.Items ?? []) as any[]).map((it) => ({
            id: it.Id, name: it.Name, type: it.Type, year: it.ProductionYear ?? null,
            rating: it.CommunityRating ?? null, playCount: it.UserData?.PlayCount ?? 0,
            img: env.JELLYFIN_URL + '/Items/' + it.Id + '/Images/Primary?fillHeight=420&fillWidth=280&quality=75',
          }));
          return JSON.stringify({ items });
        });
        return json(JSON.parse(payload));
      }
      if (path === '/api/media/unplayed') {
        // Fresh picks: highest-rated unwatched movies. Deep Media tab — not on Home.
        const payload = await swrJson(ctx, env, 'cache:media-unplayed', 600000, async () => {
          const r = await fetch(env.JELLYFIN_URL + '/Items?userId=' + env.JELLYFIN_USER_ID + '&SortBy=CommunityRating&SortOrder=Descending&Recursive=true&Limit=12&IncludeItemTypes=Movie&Filters=IsUnplayed&Fields=ProductionYear,CommunityRating,Genres&EnableImages=true',
            { headers: { authorization: `MediaBrowser Token="${env.JELLYFIN_API_KEY}"` } });
          if (!r.ok) throw new Error('jellyfin ' + r.status);
          const d = await r.json() as any;
          const items = ((d.Items ?? []) as any[]).map((it) => ({
            id: it.Id, name: it.Name, type: it.Type, year: it.ProductionYear ?? null,
            rating: it.CommunityRating ?? null, genres: (it.Genres ?? []).slice(0, 2),
            img: env.JELLYFIN_URL + '/Items/' + it.Id + '/Images/Primary?fillHeight=420&fillWidth=280&quality=75',
          }));
          return JSON.stringify({ items });
        });
        return json(JSON.parse(payload));
      }
      if (path === '/api/media/genres') {
        // Top genres by item count (user-scoped). Deep Media tab — not on Home.
        const payload = await swrJson(ctx, env, 'cache:media-genres', 900000, async () => {
          const r = await fetch(env.JELLYFIN_URL + '/Genres?userId=' + env.JELLYFIN_USER_ID + '&Limit=10&SortBy=ItemCount&SortOrder=Descending',
            { headers: { authorization: `MediaBrowser Token="${env.JELLYFIN_API_KEY}"` } });
          if (!r.ok) throw new Error('jellyfin ' + r.status);
          const d = await r.json() as any;
          const genres = ((d.Items ?? []) as any[]).map((g) => ({ name: g.Name }));
          return JSON.stringify({ genres });
        });
        return json(JSON.parse(payload));
      }
      if (path === '/api/media/watchstats') {
        // Stats tab "what you love": genre counts (per-genre TotalRecordCount —
        // /Genres ItemCount is null on Jellyfin 10.11) + device-app list
        // (/Devices, real past devices w/ app names). NO per-day watch history:
        // /Sessions/History is 404 on this server, PlaybackReporting has no HTTP
        // route, and admin-scoped IsPlayed covers only admin plays (3 items).
        // Honest-degrade: no fabricated bars.
        const payload = await swrJson(ctx, env, 'cache:media-watchstats', 900000, async () => {
          const UA = { authorization: `MediaBrowser Token="${env.JELLYFIN_API_KEY}"`, 'user-agent': SEERR_UA };
          const GENRE_NAMES = ['Action', 'Adventure', 'Animation', 'Anime', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance', 'Science Fiction', 'Thriller', 'War', 'Western'];
          const [genreCounts, devices] = await Promise.all([
            (async () => {
              try {
                const lists = await Promise.all(GENRE_NAMES.map((g) =>
                  fetch(env.JELLYFIN_URL + '/Items?userId=' + env.JELLYFIN_USER_ID + '&Recursive=true&Genres=' + encodeURIComponent(g) + '&Limit=1&IncludeItemTypes=Movie,Series', { headers: UA })
                    .then((r) => (r.ok ? r.json() as any : null)).catch(() => null)));
                return GENRE_NAMES.map((g, i) => ({ name: g, count: lists[i] && typeof lists[i].TotalRecordCount === 'number' ? lists[i].TotalRecordCount : 0 }))
                  .filter((x) => x.count > 0).sort((a, b) => b.count - a.count).slice(0, 6);
              } catch { return []; }
            })(),
            (async () => {
              try {
                const r = await fetch(env.JELLYFIN_URL + '/Devices', { headers: UA });
                if (!r.ok) return [];
                const d = await r.json() as any;
                // Real client apps only: drop infra speakers (Seerr, curl, setup-script)
                // + sort newest-activity first, cap 12
                const INFRA = /^(seerr|curl|setup-script)$/i;
                return ((d.Items ?? []) as any[])
                  .filter((x) => !INFRA.test(String(x.AppName || '')))
                  .map((x) => ({
                    app: typeof x.AppName === 'string' ? x.AppName : 'Unknown',
                    last: typeof x.DateLastActivity === 'string' ? x.DateLastActivity.slice(0, 10) : null,
                  }))
                  .sort((a, b) => (b.last || '').localeCompare(a.last || ''))
                  .slice(0, 12);
              } catch { return []; }
            })(),
          ]);
          return JSON.stringify({ genres: genreCounts, devices });
        });
        return json(JSON.parse(payload));
      }
      if (path === '/api/media/trending') {
        // Home 'Trending now' rail: highest CommunityRating across movies+series,
        // then PlayCount as tiebreak. Reads as 'the best of the library right now'
        // without pretending to have global trending data (honest-degrade law).
        const payload = await swrJson(ctx, env, 'cache:media-trending', 1800000, async () => {
          const r = await fetch(env.JELLYFIN_URL + '/Items?userId=' + env.JELLYFIN_USER_ID + '&SortBy=CommunityRating,PlayCount&SortOrder=Descending&Recursive=true&Limit=12&IncludeItemTypes=Movie,Series&Fields=ProductionYear,CommunityRating&EnableImages=true',
            { headers: { authorization: `MediaBrowser Token="${env.JELLYFIN_API_KEY}"` } });
          if (!r.ok) throw new Error('jellyfin ' + r.status);
          const d = await r.json() as any;
          const items = ((d.Items ?? []) as any[]).map((it) => ({
            id: it.Id, name: it.Name, type: it.Type, year: it.ProductionYear ?? null,
            rating: it.CommunityRating ?? null,
            img: env.JELLYFIN_URL + '/Items/' + it.Id + '/Images/Primary?fillHeight=420&fillWidth=280&quality=75',
          }));
          return JSON.stringify({ items });
        });
        return json(JSON.parse(payload));
      }
      if (path === '/api/media/recommend') {
        // Because-you-watched: Similar to the most-played movie (userId-scoped).
        // 3-step: most-played id -> /Items/{id}/Similar?userId=... Falls back to
        // resume-source if no play counts yet. 30-min cache (browsing shifts it).
        const payload = await swrJson(ctx, env, 'cache:media-recommend-v3', 1800000, async () => {
          const q = (extra: string) => env.JELLYFIN_URL + extra;
          const H = { headers: { authorization: `MediaBrowser Token="${env.JELLYFIN_API_KEY}"` } };
          let seedId = '';
          let seedName = '';
          try {
            const r = await fetch(q('/Items?userId=' + env.JELLYFIN_USER_ID + '&SortBy=PlayCount&SortOrder=Descending&Recursive=true&Limit=1&IncludeItemTypes=Movie'), H);
            if (r.ok) { const d = await r.json() as any; const it = (d.Items ?? [])[0]; if (it) { seedId = it.Id; seedName = it.Name; } }
          } catch {}
          if (!seedId) {
            try {
              const r = await fetch(q('/Items?userId=' + env.JELLYFIN_USER_ID + '&Recursive=true&Filters=IsResumable&SortBy=DatePlayed&SortOrder=Descending&IncludeItemTypes=Movie,Episode&Limit=1'), H);
              if (r.ok) { const d = await r.json() as any; const it = (d.Items ?? [])[0]; if (it) { seedId = it.Id; seedName = it.SeriesName || it.Name; } }
            } catch {}
          }
          if (!seedId) return JSON.stringify({ items: [], seed: null });
          const r2 = await fetch(q('/Items/' + seedId + '/Similar?userId=' + env.JELLYFIN_USER_ID + '&Limit=12&Fields=ProductionYear,CommunityRating'), H);
          if (!r2.ok) return JSON.stringify({ items: [], seed: seedName });
          const d2 = await r2.json() as any;
          const items = ((d2.Items ?? []) as any[]).slice(0, 12).map((it) => ({
            id: it.Id, name: it.Name, type: it.Type, year: it.ProductionYear ?? null,
            rating: it.CommunityRating ?? null,
            img: env.JELLYFIN_URL + '/Items/' + it.Id + '/Images/Primary?fillHeight=420&fillWidth=280&quality=75',
          }));
          return JSON.stringify({ items, seed: seedName });
        });
        return json(JSON.parse(payload));
      }
      if (path === '/api/requests') {
        // Home "Your requests" rail (default take 12) + Media tab full list
        // (?scope=all, take 24). Seerr user resolved by jellyfinUsername ==
        // authentik username (email fallback — the admin Seerr account has an
        // empty email, email-only matching never worked). EVERY Seerr fetch
        // sends a browser UA (Cloudflare BFM 403s server UAs) and hits
        // /api/v1/* ONLY (this fork 307s /api/v3/* to /login). SWR-cached per
        // user+scope for 120s via the Cache API (never KV): stale serves
        // instantly while one background produce refreshes. Unmatched users
        // get {requests:[],linked:false} — the SPA shows a link hint, no error.
        // Subrequest budget: 1 (users) + 1 (list) + <=24 details = <=26 of 32.
        const scopeAll = url.searchParams.get('scope') === 'all';
        const payload = await swrJson(ctx, env, 'cache:requests:' + sess.sub + (scopeAll ? ':all' : ''), 120000, async () => {
          const take = scopeAll ? 24 : 12;
          const seerrHeaders = { 'user-agent': SEERR_UA, 'X-Api-Key': env.SEERR_API_KEY };
          const ur = await fetch(env.SEERR_URL + '/api/v1/user?take=100', { headers: seerrHeaders })
            .then((r) => (r.ok ? r.json() as any : null))
            .catch(() => null);
          // Seerr UNREACHABLE (outage/BFM blip) must NOT be cached as "not linked":
          // throw so swrJson keeps serving the stale copy instead of persisting a
          // misleading linked:false for the whole TTL.
          if (ur == null) throw new Error('seerr users fetch failed');
          const users: any[] = Array.isArray(ur) ? ur : ((ur && ur.results) || []);
          const uid = resolveSeerrUser(users, { username: sess.username, email: sess.email });
          if (!uid) return JSON.stringify({ requests: [], linked: false, seerrBase: env.SEERR_URL });
          const lr = await fetch(env.SEERR_URL + '/api/v1/request?take=' + take + '&sort=added&requestedBy=' + uid, { headers: seerrHeaders })
            .then((r) => (r.ok ? r.json() as any : null))
            .catch(() => null);
          if (lr == null) throw new Error('seerr request list fetch failed');
          const reqs: any[] = (lr && lr.results) || [];
          const details = await Promise.allSettled(reqs.map((rq) => {
            const seg = rq?.type === 'tv' ? 'tv' : 'movie';
            const tmdb = rq?.media?.tmdbId;
            if (tmdb == null) return Promise.resolve(null);
            return fetch(env.SEERR_URL + '/api/v1/' + seg + '/' + tmdb, { headers: seerrHeaders })
              .then((r) => (r.ok ? r.json() as any : null))
              .catch(() => null);
          }));
          const cards = reqs.map((rq, i) =>
            buildCard(rq, details[i].status === 'fulfilled' ? details[i].value : null, env.SEERR_URL));
          return JSON.stringify({ requests: cards, linked: true, seerrBase: env.SEERR_URL });
        });
        return new Response(payload, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      }
      if (path === '/api/status') {
        // Home "Service status" card — public slug only, shaped for the SPA.
        const d = await fetchPublicKuma(env);
        if (!d) return json({ monitors: [] });
        return json({ monitors: d.monitors.map((m) => ({ name: m.name, current: m.current, uptime24h: m.up24 })) });
      }
      if (path === '/api/status/extended') {
        // Services tab uptime bars — public slug only, beats for the strip.
        const d = await fetchPublicKuma(env);
        if (!d) return json({ monitors: [] });
        return json(d);
      }
      if (path === '/api/audit') {
        const list = await env.SESSIONS.list({ prefix: `audit:${sess.sub}:` });
        const out = [];
        for (const k of list.keys.slice(-30).reverse()) {
          const v = await env.SESSIONS.get(k.name);
          if (v) out.push(JSON.parse(v));
        }
        return json(out);
      }
      if (path === '/api/updates') {
        // Service updates feed — SWR cached 30 min; a refresh fetches 6 GitHub
        // pages + 6 runtime probes (in parallel) on cache-miss only.
        const payload = await swrJson(ctx, env, 'cache:updates', 1800000, () => produceUpdates(env));
        return new Response(payload, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      }
      if (path === '/api/growth') {
        // Library growth — SWR cached 1 h. addedToday is time-sensitive (the
        // pipeline adds items continuously), so 24 h would freeze it; a
        // refresh is only ~5 Jellyfin calls / ~2 s, <= 24 refreshes/day.
        // Cache API via swrJson — NEVER KV (free-tier write budget).
        // Key carries a SCHEMA VERSION: bump it whenever the payload shape
        // changes so a deploy starts from a clean slot instead of serving the
        // previous shape for up to an hour (v2 added libraryTotal*).
        const payload = await swrJson(ctx, env, 'cache:growth:v2', 3600000, () => produceGrowth(env));
        return new Response(payload, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      }

      // ---------- Referrals: "I recommended a friend" ----------
      // POST /api/referral {name, service, note?} -> KV + Gotify ping
      // GET  /api/referral       -> my referrals (with status)
      // Status flips: pending -> approved|declined|created, set by the owner
      // (admin) via PATCH with the internal header; members read-only.
      if (path === '/api/referral' && request.method === 'POST') {
        let body: any;
        try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
        const clean = (v: unknown, max: number) =>
          (typeof v === 'string' ? v : '').replace(/[^\p{L}\p{N} @.+,!?'’-]/gu, '').trim().slice(0, max);
        const name = clean(body?.name, 60);
        const service = clean(body?.service, 40);
        const note = clean(body?.note, 200);
        if (name.length < 2 || !service) return json({ error: 'name and service required' }, 400);
        // rate limit: max 5 open referrals per user
        const mine = await listReferrals(env, sess.sub);
        if (mine.filter((r) => r.status === 'pending').length >= 5) {
          return json({ error: 'too many pending referrals' }, 429);
        }
        const id = crypto.randomUUID().slice(0, 8);
        const rec = { id, by: sess.sub, byName: sess.name || sess.username, name, service, note,
          status: 'pending', at: Date.now() };
        await env.SESSIONS.put(`referral:${id}`, JSON.stringify(rec));
        await indexReferral(env, id);
        // Gotify ping (best-effort — the referral is already stored)
        if (env.GOTIFY_REFERRAL_TOKEN) {
          try {
            await fetch('https://gotify.mysweetpea.cc/message', {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0', 'X-gotify-Key': env.GOTIFY_REFERRAL_TOKEN },
              body: JSON.stringify({
                title: 'Referral: ' + name,
                message: sess.name + ' recommends ' + name + ' for ' + service + (note ? ' — "' + note + '"' : ''),
                priority: 5,
              }),
            });
          } catch { /* stored regardless */ }
        }
        return json({ ok: true, id });
      }
      if (path === '/api/referral' && request.method === 'GET') {
        const mine = await listReferrals(env, sess.sub);
        return json({ referrals: mine });
      }

      // POST /api/bug — user bug report: store + Gotify ping (PC poller relays to Paperclip)
      if (path === '/api/bug' && request.method === 'POST') {
        let b: any = {};
        try { b = await request.json(); } catch { /* handled below */ }
        const where = String(b.where || '').slice(0, 80).trim();
        const what = String(b.what || '').slice(0, 2000).trim();
        if (!what) return json({ error: 'Describe the bug first' }, 400);
        const id = 'bug-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        const rec = { id, user: sess.username, name: sess.name, where, what, at: Date.now(), status: 'open' };
        await env.SESSIONS.put('bug:' + id, JSON.stringify(rec));
        if (env.GOTIFY_BUG_TOKEN) {
          try {
            await fetch('https://gotify.mysweetpea.cc/message', {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0', 'X-gotify-Key': env.GOTIFY_BUG_TOKEN },
              body: JSON.stringify({
                // priority 5: notify-only — the PC poller creates an UNASSIGNED issue on
                // the Paperclip board; nothing auto-fires until the owner assigns
                // Groundskeeper there (approval happens in Paperclip)
                title: 'BUG REPORT: ' + (where || 'dashboard') + ' — ' + sess.username,
                message: what,
                priority: 5,
              }),
            });
          } catch { /* stored regardless */ }
        }
        return json({ ok: true, id });
      }

      // DELETE endpoints
      if (request.method === 'DELETE') {
        if (path.startsWith('/api/sessions/')) {
          const uuid = path.split('/')[3];
          const r = await authentikFetch(env, sess.at, `/api/v3/core/authenticated_sessions/${uuid}/`, { method: 'DELETE' });
          await env.SESSIONS.put(`audit:${sess.sub}:${Date.now()}`, JSON.stringify({ t: Date.now(), event: 'session_revoked', target: uuid }));
          return json({ ok: r.ok }, r.status);
        }
        if (path.startsWith('/api/devices/')) {
          const [kind, pk] = path.split('/').slice(3);
          const map: Record<string, string> = { totp: 'totp', webauthn: 'webauthn', static: 'static' };
          if (!map[kind]) return json({ error: 'bad device type' }, 400);
          const r = await authentikFetch(env, sess.at, `/api/v3/authenticators/${map[kind]}/${pk}/`, { method: 'DELETE' });
          await env.SESSIONS.put(`audit:${sess.sub}:${Date.now()}`, JSON.stringify({ t: Date.now(), event: 'device_removed', target: kind + ':' + pk }));
          return json({ ok: r.ok }, r.status);
        }
        if (path.startsWith('/api/consents/')) {
          const id = path.split('/')[3];
          const r = await authentikFetch(env, sess.at, `/api/v3/core/user_consent/${id}/`, { method: 'DELETE' });
          await env.SESSIONS.put(`audit:${sess.sub}:${Date.now()}`, JSON.stringify({ t: Date.now(), event: 'consent_revoked', target: id }));
          return json({ ok: r.ok }, r.status);
        }
      }

      return json({ error: 'not found' }, 404);
    }

    // ---------- static ----------
    if (path === '/' || path === '/index.html') {
      return env.ASSETS.fetch(new URL('/', request.url));
    }
    // Real asset files (site.webmanifest, icons) — fall through to the assets
    // binding before 404ing. run_worker_first sends everything here first.
    const asset = await env.ASSETS.fetch(new URL(path, request.url));
    if (asset.status !== 404) {
      // Immutable versioned assets get long-lived caching (fonts/icons/manifest)
      if (/\.(woff2|svg|png|webp)$/.test(path)) {
        const h = new Headers(asset.headers);
        h.set('cache-control', 'public, max-age=31536000, immutable');
        return new Response(asset.body, { status: asset.status, headers: h });
      }
      return asset;
    }
    return new Response('Not found', { status: 404 });
  },
};

