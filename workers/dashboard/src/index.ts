// MySweetPea Dashboard Worker — session + OIDC PKCE + authentik API proxy
// Phase 1 skeleton: auth round-trip + /api/me + static SPA serving.

import {
  RUNTIME_PROBES,
  parseVer,
  runPipeline,
  reconcile,
  buildUpdate,
} from './lib/updates-pipeline.mjs';

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
  AIOS_UUID: string;
  AIOS_PASSWORD: string;
  JELLYFIN_API_KEY: string;

  IMMICH_URL: string;
  IMMICH_API_KEY: string;
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
  // Media access ("generate pin"): the dashboard provisions the member's
  // Moonfin persona on demand instead of the redeem workflow emailing a PIN.
  // MOONBASE_MOUNT is the full picker URL the member pastes into Moonfin
  // (https://<host>/jellyfin/<config-uuid>/<encpw>) — PIN sign-in only works
  // on the mount path, never on the bare /jellyfin address.
  MOONBASE_ADMIN_TOKEN?: string;
  MOONBASE_MOUNT?: string;
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
    // password accepted, flow advanced to another stage (e.g. MFA). An ERROR
    // stage must not count: an unknown user re-renders identification and the
    // old "anything but the password stage" rule accepted that as success.
    if (!errs && data.component && data.component !== 'ak-stage-password' && data.component !== 'ak-stage-identification') return true;
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
// (session docs). A KV failure (quota, transient
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
    // The member-facing media app (Moonfin on the AIOStreams server). Every
    // media item/genre deep-link must use THIS, not `media` — that host is
    // Jellyfin, which has carried no library since Oct 2026.
    moonfin: cleanOrigin(AIOS_HOST) || 'https://aiostreams.mysweetpea.cc',
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
/* ── AIOStreams media source ─────────────────────────────────────────────
   Media lives on the AIOStreams server now. The old Jellyfin library server
   is Live TV only since the Oct 2026 transformation and reports
   MovieCount:0 / SeriesCount:0, so every media row built from it came back
   empty. The API shapes are identical on the new host — only the base URL
   and the token change.

   The token is minted from the config credentials and cached for an hour:
   one extra round-trip on a cold cache, none after. Deliberately NOT KV —
   the Cache API is unmetered and this is a pure derived value.

   Posters need NO token (verified: /jellyfin/Items/<id>/Images/Primary
   returns 200 image/jpeg unauthenticated), which is what lets the browser
   load them straight from this host. */
const AIOS_HOST = 'https://aiostreams.mysweetpea.cc';
const AIOS_UA = 'MediaBrowser Client="msp-dashboard", Device="worker", DeviceId="msp-dashboard", Version="1.0"';

async function aiosToken(env: Env): Promise<string> {
  const cached = await cacheGetJson('cache:aios-token');
  if (cached) {
    try { const t = JSON.parse(cached).t; if (typeof t === 'string' && t) return t; } catch { /* remint below */ }
  }
  if (!env.AIOS_UUID || !env.AIOS_PASSWORD) throw new Error('aios not configured');
  const r = await fetch(AIOS_HOST + '/jellyfin/Users/AuthenticateByName', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-emby-authorization': AIOS_UA },
    body: JSON.stringify({ Username: env.AIOS_UUID, Pw: env.AIOS_PASSWORD }),
  });
  if (!r.ok) throw new Error('aios auth ' + r.status);
  const d = await r.json() as any;
  const t = d && d.AccessToken;
  if (!t) throw new Error('aios auth: no token in response');
  await cachePutJson('cache:aios-token', JSON.stringify({ t }), 3600);
  return t;
}

// Base URL + auth header for the AIOStreams media server. `base` is used for
// BOTH the query and the poster URLs so they can never drift apart.
async function aiosSrc(env: Env): Promise<{ base: string; auth: string }> {
  return { base: AIOS_HOST + '/jellyfin', auth: 'MediaBrowser Token="' + (await aiosToken(env)) + '"' };
}

/* ── per-member media identity ───────────────────────────────────────────
   Resolve the member's Moonfin persona and PIN (create-or-get; the shim
   returns the SAME pin on repeat calls, so this is safe to call on every
   request). Shared by the PIN card and the per-user media rows so exactly
   one place knows how a member's media identity is minted. */
type MemberIdentity =
  | { ok: true; pin: string; name: string; isAdmin: boolean }
  | { ok: false; error: string; status: number };

async function provisionMember(env: Env, sess: SessionData): Promise<MemberIdentity> {
  if (!env.MOONBASE_ADMIN_TOKEN || !env.MOONBASE_MOUNT) {
    return { ok: false, error: 'media access is not configured yet', status: 503 };
  }
  // The tier gate lives on the shim, but we must send the member's REAL tier —
  // never a hardcoded one — or a seedling could self-provision sweetpea media
  // access. Groups come from authentik; SessionData has no groups field.
  let tier = '';
  let isAdmin = false;
  const tierKey = 'cache:tier:' + String(sess.sub || '');
  const tierRaw = await cacheGetJson(tierKey);
  if (tierRaw) {
    try {
      const t = JSON.parse(tierRaw) as { tier?: string; admin?: boolean };
      tier = String(t.tier || '');
      isAdmin = !!t.admin;
    } catch { /* re-derive below */ }
  }
  if (!tier) try {
    const r = await authentikFetch(env, sess.at, '/api/v3/core/users/me/');
    const d = await r.json() as any;
    const u = d && d.user ? d.user : d;
    const names = (u && u.groups ? u.groups : []).map((g: any) => String((g && g.name) || '').toLowerCase());
    tier = names.includes('sweetpea') ? 'sweetpea' : names.includes('seedling') ? 'seedling' : '';
    isAdmin = names.includes('authentik admins');
    if (tier) {
      try { await cachePutJson(tierKey, JSON.stringify({ tier, admin: isAdmin }), 300); } catch { /* cache is optional */ }
    }
  } catch { /* fall through to the no-tier error below */ }
  if (!tier) return { ok: false, error: 'could not verify your account tier', status: 502 };

  const username = String(sess.username || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(username)) {
    return { ok: false, error: 'your username cannot be used for media access', status: 400 };
  }
  let r: Response;
  try {
    r = await fetch(AIOS_HOST + '/Moonfin/Admin/Provision', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Admin-Token': env.MOONBASE_ADMIN_TOKEN,
        'user-agent': 'msp-dashboard/1.0',
      },
      body: JSON.stringify({ username, name: sess.name || username, tier }),
    });
  } catch {
    return { ok: false, error: 'media service is unreachable right now', status: 502 };
  }
  if (!r.ok) return { ok: false, error: 'media setup failed', status: 502 };
  const d: any = await r.json().catch(() => ({}));
  if (d && d.skipped === 'tier') {
    return { ok: false, error: 'Media access is not part of your tier.', status: 200 };
  }
  const pin = d && d.pin ? String(d.pin) : '';
  if (!pin) return { ok: false, error: 'no pin came back — try again in a moment', status: 502 };
  // ⚠️ The sign-in NAME is the persona's name, NOT the authentik username.
  // parseSignIn treats any non-uuid username on a mount as the persona name,
  // and personaByName matches on `name`. We provision with sess.name.
  return { ok: true, pin, name: String(sess.name || username).trim(), isAdmin };
}

/* Base URL + auth header scoped to ONE member, for per-user rows.
   ⚠️ The media server scopes UserData by TOKEN, not by the uid in the path —
   querying with the service token would return the OWNER's watch history.
   Sign-in is on the MOUNT path (PIN sign-in does not work on the bare one),
   with Username = the persona NAME and Pw = the PIN. Cached per member for
   an hour so a page load costs at most one extra round-trip. */
/* The one media-item shape. Every /api/media/* route maps through this, so a
   renderer can read any of these fields from any rail. The six inline mappers
   this replaces had drifted apart (latest had no rating, only unplayed had
   genres, only mostplayed had playCount) — and a renderer reading a field its
   endpoint does not emit fails silently. */
/* ⚠️ aios only honours SortBy=Random on /Items, and /Items/Latest without a
   ParentId round-robins the FIRST few catalogs. So a "sort" requested from
   this server silently degrades to catalog order — which is how four
   different rails ended up showing the same twelve titles. Rows therefore
   come from the right CATALOG, and any ranking is done here on a page we
   already paid for. */
let VIEWS_TTL = 0;
let VIEWS_CACHE: Array<{ id: string; name: string }> = [];
async function aiosViews(env: Env): Promise<Array<{ id: string; name: string }>> {
  if (Date.now() < VIEWS_TTL) return VIEWS_CACHE;
  try {
    const { base, auth } = await aiosSrc(env);
    const r = await fetch(base + '/UserViews', { headers: { authorization: auth } });
    if (r.ok) {
      const d = await r.json() as any;
      VIEWS_CACHE = ((d.Items ?? []) as any[])
        .map((v) => ({ id: String(v.Id), name: String(v.Name || '') }))
        .filter((v) => v.id);
      VIEWS_TTL = Date.now() + 600000;
    }
  } catch { /* keep the last good list */ }
  return VIEWS_CACHE;
}
const viewBy = (views: Array<{ id: string; name: string }>, re: RegExp) =>
  (views.find((v) => re.test(v.name)) || { id: '' }).id;
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);

async function aiosRow(url: string, auth: string): Promise<any[]> {
  const r = await fetch(url, { headers: { authorization: auth } });
  if (!r.ok) throw new Error('aios ' + r.status);
  const d = await r.json() as any;
  return (Array.isArray(d) ? d : (d.Items ?? [])) as any[];
}

const mediaItem = (it: any, base: string) => ({
  id: it.Id,
  name: it.Name,
  seriesName: it.SeriesName ?? '',
  type: it.Type,
  year: it.ProductionYear ?? null,
  rating: (typeof it.CommunityRating === 'number' && it.CommunityRating > 0) ? it.CommunityRating : null, // 0 = no votes yet, not a 0-star film
  playCount: it.UserData?.PlayCount ?? 0,
  progressPct: Math.round(it.UserData?.PlayedPercentage ?? 0),
  genres: (it.Genres ?? []).slice(0, 2),
  // Episodes have no poster of their own upstream — the series art is the
  // card (same rule Moonfin uses for its Continue-watching row).
  img: base + '/Items/' + ((it.Type === 'Episode' && it.SeriesId) ? it.SeriesId : it.Id) +
    '/Images/Primary?fillHeight=420&fillWidth=280&quality=75',
});

async function aiosUserSrc(env: Env, sess: SessionData): Promise<{ base: string; auth: string } | null> {
  const key = 'cache:aios-utok:' + String(sess.username || '').toLowerCase();
  const cached = await cacheGetJson(key);
  if (cached) {
    try { const t = JSON.parse(cached).t; if (typeof t === 'string' && t) return { base: AIOS_HOST + '/jellyfin', auth: 'MediaBrowser Token="' + t + '"' }; } catch { /* remint */ }
  }
  /* One retry: this mints through authentik + the media shim, and a single
     blip used to blank every personal row for the request (which reads as a
     missing section, not as an error). */
  let who = await provisionMember(env, sess);
  if (!who.ok) {
    await new Promise((r) => setTimeout(r, 250));
    who = await provisionMember(env, sess);
  }
  if (!who.ok) return null;
  // The owner watches as the config account itself (bare lane, uuid+password),
  // so their persona is empty. Their real watching lives on the service
  // identity — use it, or every personal row reads empty for them.
  if (who.isAdmin) return aiosSrc(env);
  try {
    const r = await fetch(env.MOONBASE_MOUNT + '/Users/AuthenticateByName', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-emby-authorization': AIOS_UA },
      body: JSON.stringify({ Username: who.name, Pw: who.pin }),
    });
    if (!r.ok) return null;
    const d = await r.json() as any;
    const t = d && d.AccessToken;
    if (!t) return null;
    await cachePutJson(key, JSON.stringify({ t }), 3600);
    return { base: AIOS_HOST + '/jellyfin', auth: 'MediaBrowser Token="' + t + '"' };
  } catch {
    return null;
  }
}

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
      /* An EMPTY row is more often a transient upstream failure than a real
         empty shelf, and caching it fresh hid whole sections of the dashboard
         for the full TTL. Store it as already-stale so the next request
         re-computes (and a real failure heals on the following load). */
      let t = Date.now();
      try { const j = JSON.parse(d) as any; if (j && Array.isArray(j.items) && !j.items.length) t = 0; } catch { /* not our shape */ }
      await cachePutJson(key, JSON.stringify({ d, t }), 86400);
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

let kumaInFlight: Promise<{ monitors: KumaMonitor[] } | null> | null = null;
function fetchPublicKuma(env: Env): Promise<{ monitors: KumaMonitor[] } | null> {
  // Several cards ask for status at boot; without this they all miss the cache
  // on the same tick and multiply the upstream load.
  if (!kumaInFlight) {
    kumaInFlight = fetchPublicKumaOnce(env).finally(() => { kumaInFlight = null; });
  }
  return kumaInFlight;
}
async function fetchPublicKumaOnce(env: Env): Promise<{ monitors: KumaMonitor[] } | null> {
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

// The MOONBASE_MOUNT secret holds the per-device token only, so the card used
// to hand members a bare 'eyJ...' blob with no host — unpasteable. Compose the
// address members actually type into Moonfin: origin + /jellyfin/<uuid>/<token>.
function fullMount(env: Env): string {
  const raw = String(env.MOONBASE_MOUNT || '').trim().replace(/^\/+/, '');
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const origin = cleanOrigin(AIOS_HOST) || 'https://aiostreams.mysweetpea.cc';
  const segs = raw.split('/');
  const hasUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segs[0] || '');
  return origin + '/jellyfin/' + (hasUuid ? raw : String(env.AIOS_UUID || '') + '/' + raw);
}

const path0 = (r: Request) => { try { return new URL(r.url).pathname; } catch { return '?'; } };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    let res: Response;
    try {
      res = await this.handle(request, env, ctx);
    } catch (e) {
      console.error('handle failed', path0(request), e);
      res = new Response(JSON.stringify({ error: 'internal error' }), {
        status: 500, headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
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
      if (!code || !state || !/^[A-Za-z0-9_-]{8,128}$/.test(state)) {
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
      /* recovery is a FLOW, not a settings page — route straight to authentik's
         recovery flow (email-verified identity + new password) */
      if (/recovery/.test(f)) {
        const html = `<!doctype html><meta charset="utf-8"><title>Password reset…</title><meta http-equiv="refresh" content="0;url=${env.AUTH_BASE}/if/flow/default-recovery-flow/">`;
        return new Response(html, { headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' } });
      }
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
      headers.append('set-cookie', `${COOKIE}=${sid}; Domain=.mysweetpea.cc; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=15552000`);
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
      await env.SESSIONS.put('referral:' + id, JSON.stringify(rec), { expirationTtl: 180 * 86400 });
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
        await env.SESSIONS.delete(rlKey);

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
        const out = await swrJson(ctx, env, 'cache:sess:' + sess.sub, 60000, async () => {
          const r = await authentikFetch(env, sess.at, '/api/v3/core/authenticated_sessions/');
          return JSON.stringify(await r.json());
        });
        return new Response(out, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      }
      if (path === '/api/consents') {
        const out = await swrJson(ctx, env, 'cache:consent:' + sess.sub, 60000, async () => {
          const r = await authentikFetch(env, sess.at, '/api/v3/core/user_consent/');
          return JSON.stringify(await r.json());
        });
        return new Response(out, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      }
      if (path === '/api/devices') {
        const out = await swrJson(ctx, env, 'cache:dev:' + sess.sub, 60000, async () => {
          const [r, r2, r3] = await Promise.all([
            authentikFetch(env, sess.at, '/api/v3/authenticators/totp/?include_unconfirmed=true'),
            authentikFetch(env, sess.at, '/api/v3/authenticators/webauthn/'),
            authentikFetch(env, sess.at, '/api/v3/authenticators/static/'),
          ]);
          const [totp, webauthn, statics] = await Promise.all([r.json(), r2.json(), r3.json()]);
          return JSON.stringify({ totp: (totp as any).results ?? [], webauthn: (webauthn as any).results ?? [], static: (statics as any).results ?? [] });
        });
        return new Response(out, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      }
      if (path === '/api/stats') {
        // SWR: instant from cache (fresh OR stale); refresh in background.
        // Per-service tiles for in-cluster-only services (Nextcloud,
        // Vaultwarden, AFFiNE, Open WebUI) come from a KV snapshot pushed by
        // the cluster (svc-stats:<key>) — the worker cannot reach
        // cluster-internal hosts, and public origins sit behind BFM.
        const out: Record<string, unknown> = {
          movies: null, series: null, episodes: null, songs: null, boxsets: null, jf_resume: null,
          jf_watch_hours: null, jf_resume_titles: null, jf_top_title: null, jf_played_titles: null, jf_periods: null,
          photos: null, videos: null, usage_mb: null,
          users: null, sessions: null,
          nc_files: null, nc_shares: null, nc_activity: null,
          vw_users: null, vw_items: null,
          affine_users: null, affine_docs: null, affine_workspaces: null,
          owui_users: null, owui_chats: null,
        };
        const payload = await swrJson(ctx, env, `cache:stats2:${sess.sub}`, 300000, async () => {
          for (const k of ['svc-stats:nextcloud', 'svc-stats:vaultwarden', 'svc-stats:affine', 'svc-stats:openwebui']) {
            try {
              const raw = await env.SESSIONS.get(k);
              if (raw) Object.assign(out, JSON.parse(raw) as Record<string, number | null>);
            } catch { /* bad snapshot -> keep nulls (honest) */ }
          }
          await Promise.all([
            (async () => {
              // Media numbers come from the MEMBER's own persona, not the old
              // Jellyfin library (zero movies/series since the Oct 2026
              // transformation). The media server scopes UserData by token, so
              // the service token would report the OWNER's watching instead.
              const src = await aiosUserSrc(env, sess);
              if (!src) return;   // no persona yet -> tiles stay '—' (honest)
              const H = { headers: { authorization: src.auth } };
              // One fetch of the member's PLAYED items gives everything:
              // watched movies, episodes, distinct series (SeriesId — note
              // that counting IsPlayed *Series* is structurally always 0, you
              // play episodes not series) and real watch time from RunTimeTicks.
              // UserData.LastPlayedDate is populated, so the same list buckets
              // into the hero's week / month / all-time pills.
              // ponytail: one page of 500; a member past 500 plays under-reports
              // by the tail. Page it only if someone gets there.
              let playedItems = 0;
              const seriesIds = new Set<string>();
              const movieIds = new Set<string>();
              const episodeIds = new Set<string>();
              const seenIds = new Set<string>();
              const buckets: Record<string, { ticks: number; titles: Set<string>; items: number }> = {
                week: { ticks: 0, titles: new Set<string>(), items: 0 },
                month: { ticks: 0, titles: new Set<string>(), items: 0 },
                all: { ticks: 0, titles: new Set<string>(), items: 0 },
              };
              const now = Date.now();
              const WEEK = 7 * 86400000, MONTH = 30 * 86400000;
              const add = (b: { ticks: number; titles: Set<string>; items: number }, ticks: number, key: string) => {
                b.ticks += ticks; b.items += 1; if (key) b.titles.add(key);
              };
              try {
                const r = await fetch(src.base + '/Items?userId=&Recursive=true&Filters=IsPlayed&IncludeItemTypes=Movie,Episode&Fields=RunTimeTicks,SeriesId&SortBy=DatePlayed&SortOrder=Descending&Limit=500', H);
                if (r.ok) {
                  const d = await r.json() as any;
                  const items = (Array.isArray(d.Items) ? d.Items : []) as any[];
                  playedItems = items.length;
                  for (const it of items) {
                    if (!it) continue;
                    const ticks = Number(it.RunTimeTicks) || 0;
                    const isEp = it.Type === 'Episode';
                    const key = String((isEp ? it.SeriesId : it.Id) || '');
                    if (isEp) { if (key) seriesIds.add(key); if (it.Id) episodeIds.add(String(it.Id)); }
                    else if (key) movieIds.add(key);
                    if (it.Id) seenIds.add(String(it.Id));
                    const lp = it.UserData ? it.UserData.LastPlayedDate : null;
                    const ts = lp ? Date.parse(String(lp)) : NaN;
                    add(buckets.all, ticks, key);
                    if (isFinite(ts)) {
                      const age = now - ts;
                      if (age <= MONTH) add(buckets.month, ticks, key);
                      if (age <= WEEK) add(buckets.week, ticks, key);
                    }
                  }
                }
              } catch {}
              out.movies = movieIds.size;
              out.episodes = episodeIds.size;
              out.series = seriesIds.size;
              // in progress: its partial position still counts as watched time
              let resumeTicks = 0;
              try {
                const r = await fetch(src.base + '/Items?userId=&Recursive=true&Filters=IsResumable&Fields=UserData,RunTimeTicks,SeriesId,SeriesName&Limit=50', H);
                if (r.ok) {
                  const d = await r.json() as any;
                  const items = (Array.isArray(d.Items) ? d.Items : []) as any[];
                  for (const it of items) {
                    const pos = it && it.UserData ? Number(it.UserData.PlaybackPositionTicks) : 0;
                    const t = (isFinite(pos) ? pos : 0) || 0;
                    resumeTicks += t;
                    // an in-progress item belongs in the period it was LAST
                    // played — adding it to every bucket gave 'week' hours with
                    // zero plays in it. It is a play in its own right, so it
                    // lands in `all` too, unless it is already in the played
                    // list (a re-watch in progress).
                    if (it && it.Id && seenIds.has(String(it.Id))) continue;
                    const lp = it && it.UserData ? it.UserData.LastPlayedDate : null;
                    const ts = lp ? Date.parse(String(lp)) : NaN;
                    const key = String((it && (it.SeriesId || it.Id)) || '');
                    add(buckets.all, t, key);
                    if (isFinite(ts)) {
                      const age = now - ts;
                      if (age <= MONTH) add(buckets.month, t, key);
                      if (age <= WEEK) add(buckets.week, t, key);
                    }
                  }
                  out.jf_resume = typeof d.TotalRecordCount === 'number' ? d.TotalRecordCount : items.length;
                  out.jf_resume_titles = items.length;
                  const top = items[0];
                  out.jf_top_title = top ? (String(top.SeriesName || top.Name || '').trim() || null) : null;
                }
              } catch {}
              const hrs = (t: number) => (t > 0 ? Math.round((t / 3.6e10) * 10) / 10 : 0); // .NET ticks are 100ns
              out.jf_watch_hours = hrs(buckets.all.ticks);
              out.jf_played_titles = buckets.all.titles.size;
              out.jf_periods = {
                week: { hours: hrs(buckets.week.ticks), titles: buckets.week.titles.size, items: buckets.week.items },
                month: { hours: hrs(buckets.month.ticks), titles: buckets.month.titles.size, items: buckets.month.items },
                all: { hours: hrs(buckets.all.ticks), titles: buckets.all.titles.size, items: buckets.all.items },
              };
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
                // Members, not user rows: authentik holds a service account per
                // outpost/provider (ldap-service-account, svc-dashboard, ...), so
                // the plain user count read "7 members" on a one-person garden.
                // Count real people in the two access groups instead.
                const groups = ['sweetpea', 'seedling'];
                const seen = new Set<string>();
                for (const g of groups) {
                  const r = await authentikFetch(env, env.AUTHENTIK_ADMIN_TOKEN,
                    '/api/v3/core/users/?page_size=200&groups_by_name=' + g);
                  if (!r.ok) continue;
                  const d = await r.json() as any;
                  for (const u of ((d.results ?? []) as any[])) {
                    if (!u || u.is_active === false || u.type === 'service_account') continue;
                    if (u.uuid) seen.add(String(u.uuid));
                  }
                }
                out.users = seen.size;
              } catch {}
            })(),
            (async () => {
              try {
                const s = await authentikFetch(env, sess.at, '/api/v3/core/authenticated_sessions/');
                if (s.ok) { const d = await s.json() as any; out.sessions = (d.results ?? []).length; }
              } catch {}
            })(),
          ]);
          return JSON.stringify(out);
        });
        return new Response(payload, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      }

      if (path === '/api/media/continue') {
        // Continue watching — the member's OWN progress. The media server scopes
        // UserData by token, so this MUST use their persona token; the service
        // token would return the owner's history.
        const src = await aiosUserSrc(env, sess);
        if (!src) return json({ items: [] });
        const payload = await swrJson(ctx, env, 'cache:media-cont2:' + sess.sub, 120000, async () => {
          const r = await fetch(src.base + '/Items?userId=&Recursive=true&SortBy=DatePlayed&SortOrder=Descending' +
            '&Filters=IsResumable&IncludeItemTypes=Movie,Episode&Limit=12&Fields=ProductionYear,SeriesName&EnableImages=true',
            { headers: { authorization: src.auth } });
          if (!r.ok) throw new Error('aios ' + r.status);
          const d = await r.json() as any;
          // One card per show: the resume list is per EPISODE, so a show you
          // stopped in the middle of season 4 filled the whole row.
          const seen = new Set<string>();
          const items = ((d.Items ?? []) as any[])
            .filter((it) => {
              const k = String(it.SeriesId || it.Id || '');
              if (!k || seen.has(k)) return false;
              seen.add(k);
              return true;
            })
            .map((it) => mediaItem(it, src.base));
          return JSON.stringify({ items });
        });
        return json(JSON.parse(payload));
      }

      if (path === '/api/media/latest') {
        // "New for you" — the newest titles of the rolling New Releases
        // catalogs. /Items/Latest with no ParentId walks the first few views
        // only, which is why this used to return the head of Netflix Movies.
        const payload = await swrJson(ctx, env, 'cache:media-latest4', 300000, async () => {
          const { base, auth } = await aiosSrc(env);
          const views = await aiosViews(env);
          const pids = [viewBy(views, /^new releases movies$/i), viewBy(views, /^new releases shows$/i)].filter(Boolean);
          if (!pids.length) {   // catalog rename -> fall back to the old shape rather than go blank
            const items = (await aiosRow(base + '/Items/Latest?Limit=12', auth)).map((it) => mediaItem(it, base));
            return JSON.stringify({ items });
          }
          const lists = await Promise.all(pids.map((pid) =>
            aiosRow(base + '/Items/Latest?ParentId=' + encodeURIComponent(pid) + '&Limit=8', auth).catch(() => [] as any[])));
          const merged: any[] = [];
          for (let i = 0; i < 8 && merged.length < 12; i++) for (const l of lists) if (l[i]) merged.push(l[i]);
          return JSON.stringify({ items: merged.slice(0, 12).map((it) => mediaItem(it, base)) });
        });
        return json(JSON.parse(payload));
      }

      if (path === '/api/media/mostplayed') {
        // Most played — per member, from the played list (the one watch-state
        // query aios answers across every catalog), ranked here because
        // SortBy=PlayCount is ignored upstream. One card per show: six
        // episodes of the same series is not "most played".
        const src = await aiosUserSrc(env, sess);
        if (!src) return json({ items: [] });
        const payload = await swrJson(ctx, env, 'cache:media-mostplayed5:' + sess.sub, 600000, async () => {
          const all = await aiosRow(src.base + '/Items?Filters=IsPlayed&Recursive=true&Limit=200' +
            '&IncludeItemTypes=Movie,Episode&Fields=SeriesId,SeriesName', src.auth);
          const seen = new Set<string>();
          const ranked = all
            .map((it) => ({ it, plays: num(it.UserData?.PlayCount), when: String(it.UserData?.LastPlayedDate || '') }))
            .sort((a, b) => (b.plays - a.plays) || b.when.localeCompare(a.when))
            .filter(({ it }) => {
              const k = String(it.SeriesId || it.Id || '');
              if (!k || seen.has(k)) return false;
              seen.add(k);
              return true;
            })
            .slice(0, 12)
            .map(({ it }) => mediaItem(it, src.base));
          return JSON.stringify({ items: ranked });
        });
        return json(JSON.parse(payload));
      }

      if (path === '/api/media/unplayed') {
        // Popular you have not watched: the trending catalog minus anything
        // played, ranked by rating on the page we fetched.
        const payload = await swrJson(ctx, env, 'cache:media-unplayed5', 600000, async () => {
          const { base, auth } = await aiosSrc(env);
          const views = await aiosViews(env);
          const pid = viewBy(views, /^trending movies$/i);
          const q = pid
            ? '/Items?ParentId=' + encodeURIComponent(pid)
            : '/Items?Recursive=true';
          // Catalog order == popularity order, and it is the only order the
          // server keeps. Ranking by rating here surfaced one-vote 10.0 titles,
          // so the catalog's own order wins.
          const rows = await aiosRow(base + q + '&Filters=IsUnplayed&Limit=100&IncludeItemTypes=Movie,Series', auth);
          const items = rows.slice(0, 12).map((it) => mediaItem(it, base));
          return JSON.stringify({ items });
        });
        return json(JSON.parse(payload));
      }

      if (path === '/api/media/genres') {
        // Top genres by item count (user-scoped). Deep Media tab — not on Home.
        const payload = await swrJson(ctx, env, 'cache:media-genres', 900000, async () => {
          const { base, auth } = await aiosSrc(env);
          const r = await fetch(base + '/Genres?userId=&Limit=10&SortBy=ItemCount&SortOrder=Descending',
            { headers: { authorization: auth } });
          if (!r.ok) throw new Error('jellyfin ' + r.status);
          const d = await r.json() as any;
          const genres = ((d.Items ?? []) as any[]).map((g) => ({ name: g.Name }));
          return JSON.stringify({ genres });
        });
        return json(JSON.parse(payload));
      }

      
      if (path === '/api/media/trending') {
        // Home "Trending now": the head of the Trending catalogs — real
        // popularity order, straight from the catalog rather than a sort this
        // server would ignore.
        const payload = await swrJson(ctx, env, 'cache:media-trending4', 1800000, async () => {
          const { base, auth } = await aiosSrc(env);
          const views = await aiosViews(env);
          const pids = [viewBy(views, /^trending movies$/i), viewBy(views, /^trending shows$/i)].filter(Boolean);
          if (!pids.length) {
            const items = (await aiosRow(base + '/Items/Latest?Limit=12', auth)).map((it) => mediaItem(it, base));
            return JSON.stringify({ items });
          }
          const lists = await Promise.all(pids.map((pid) =>
            aiosRow(base + '/Items/Latest?ParentId=' + encodeURIComponent(pid) + '&Limit=8', auth).catch(() => [] as any[])));
          const merged: any[] = [];
          for (let i = 0; i < 8 && merged.length < 12; i++) for (const l of lists) if (l[i]) merged.push(l[i]);
          return JSON.stringify({ items: merged.slice(0, 12).map((it) => mediaItem(it, base)) });
        });
        return json(JSON.parse(payload));
      }

      if (path === '/api/media/recommend') {
        // Because-you-watched: similar to this member's most-played title, with
        // the resume item as the fallback seed. Per member, so the seed is THEIR
        // taste and not the owner's.
        const src = await aiosUserSrc(env, sess);
        if (!src) return json({ items: [], seed: '' });
        const payload = await swrJson(ctx, env, 'cache:media-recommend-v6:' + sess.sub, 1800000, async () => {
          const H = { headers: { authorization: src.auth } };
          let seedId = '', seedName = '';
          // SortBy is a no-op upstream, so rank the played list here. An episode
          // seeds its SERIES (Similar on an episode returns an empty list), and
          // the label reads the show name, not the episode title.
          const pick = (it: any) => ({
            id: String((it.Type === 'Episode' ? it.SeriesId : it.Id) || it.Id || ''),
            name: String((it.Type === 'Episode' ? it.SeriesName : it.Name) || it.Name || ''),
          });
          try {
            const rows = await aiosRow(src.base + '/Items?Filters=IsPlayed&Recursive=true&Limit=200&IncludeItemTypes=Movie,Episode', src.auth);
            const best = rows
              .map((it) => ({ it, plays: num(it.UserData?.PlayCount), when: String(it.UserData?.LastPlayedDate || '') }))
              .sort((a, b) => (b.plays - a.plays) || b.when.localeCompare(a.when))[0];
            if (best) ({ id: seedId, name: seedName } = pick(best.it));
          } catch { /* fall through to the resume seed */ }
          if (!seedId) {
            try {
              const rows = await aiosRow(src.base + '/Items?Filters=IsResumable&Recursive=true&IncludeItemTypes=Movie,Episode&Limit=1', src.auth);
              if (rows[0]) ({ id: seedId, name: seedName } = pick(rows[0]));
            } catch { /* no seed -> empty row */ }
          }
          if (!seedId) return JSON.stringify({ items: [], seed: '' });
          const r2 = await fetch(src.base + '/Items/' + seedId + '/Similar?userId=&Limit=12&Fields=ProductionYear,CommunityRating&EnableImages=true', H);
          if (!r2.ok) throw new Error('aios similar ' + r2.status);
          const d2 = await r2.json() as any;
          const items = ((d2.Items ?? []) as any[]).filter((it) => it.Id !== seedId).slice(0, 12).map((it) => mediaItem(it, src.base));
          return JSON.stringify({ items, seed: seedName });
        });
        return json(JSON.parse(payload));
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
          if (!v) continue;
          try { out.push(JSON.parse(v)); } catch { /* skip corrupt record */ }
        }
        return json(out);
      }
      if (path === '/api/updates') {
        // Service updates feed — SWR cached 30 min; a refresh fetches 6 GitHub
        // pages + 6 runtime probes (in parallel) on cache-miss only.
        const payload = await swrJson(ctx, env, 'cache:updates', 1800000, () => produceUpdates(env));
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
        await env.SESSIONS.put('bug:' + id, JSON.stringify(rec), { expirationTtl: 90 * 86400 });
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

      // ── media access: the member's Moonfin PIN ────────────────────────
      // Members press "Generate PIN" in the dashboard instead of hunting for
      // it in the welcome email. Idempotent by design — the shim returns the
      // SAME pin on repeat calls, so this can be called on every tab open
      // without ever invalidating a login the member already has.
      if (path === '/api/media/pin' && request.method === 'POST') {
        const who = await provisionMember(env, sess);
        if (!who.ok) {
          // status 200 here is the "not your tier" case: the card renders it as
          // a message, not an error
          return who.status === 200
            ? json({ ok: false, reason: 'tier', message: who.error })
            : json({ error: who.error }, who.status);
        }
        return json({
          ok: true,
          pin: who.pin,
          name: who.name,
          username: String(sess.username || '').toLowerCase(),
          mount: fullMount(env),
        });
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

