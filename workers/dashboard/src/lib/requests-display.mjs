// Shared Seerr requests display module — single source of truth.
//
// Both the dashboard worker (src/index.ts) and the unit test
// (test/requests-test.mjs) import THIS file, so the test can never drift from
// what actually ships (same pattern as updates-pipeline.mjs). Plain ES module,
// dependency-free, no network — pure functions over captured API shapes.
//
// Seerr facts encoded here (verified against live captures, 2026-09-17 +
// 2026-10-11 re-probe):
//   - This fork's real API is /api/v1/* — /api/v3/* 307-redirects to /login.
//   - Server-side fetches MUST send a browser User-Agent: Cloudflare Bot Fight
//     Mode 403s everything else (library-default UAs killed every fetch).
//   - Users are matched by jellyfinUsername == authentik username (the admin
//     Seerr account has an EMPTY email, so email alone never matched; it is
//     only a fallback).
//   - media.mediaUrl exists (both list and detail) and points at the INTERNAL
//     jellyfin.private.svc address — buildCard rewrites it to the public base
//     (watchUrl) or drops it. The tv detail has NO nextEpisodeToAir field
//     (fork), so no "next airs" line can be built without extra subrequests.

/** Browser UA required by Cloudflare BFM in front of Seerr (verified passing). */
export const SEERR_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

/** TMDB poster base — w300 verified live: no auth, hotlinkable. */
export const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w300';

/** Internal Jellyfin prefix Seerr stores inside media.mediaUrl. */
export const JELLYFIN_INTERNAL_PREFIX = 'http://jellyfin.private.svc.cluster.local:8096';

// Non-empty, case-insensitive equality (empty session values must never match
// empty Seerr fields — the admin user's email is literally '').
function eq(a, b) {
  const x = String(a == null ? '' : a).trim().toLowerCase();
  const y = String(b == null ? '' : b).trim().toLowerCase();
  return x !== '' && x === y;
}

/**
 * Resolve the Seerr numeric user id for a dashboard session user.
 * @param {Array<{id?:number, jellyfinUsername?:string, email?:string}>} users
 * @param {{username?:string, name?:string, email?:string}} sessionUser
 * @returns {number|null}
 * Match order: (1) jellyfinUsername == username (case-insensitive),
 * (2) non-empty email == email. Else null (SPA shows a "not linked" hint).
 */
export function resolveSeerrUser(users, sessionUser) {
  const s = sessionUser || {};
  const uname = String(s.username || s.name || '').trim();
  const email = String(s.email || '').trim();
  const list = Array.isArray(users) ? users : [];
  if (uname) {
    const byName = list.find((u) => u && eq(u.jellyfinUsername, uname));
    if (byName && byName.id != null) return byName.id;
  }
  if (email) {
    const byEmail = list.find((u) => u && eq(u.email, email));
    if (byEmail && byEmail.id != null) return byEmail.id;
  }
  return null;
}

/**
 * Honest state ladder. Checked in order:
 *   1. detail downloadStatus[0] exists AND media.status in {2,3,4} -> downloading
 *      (only real ETA source; live captures show in-flight downloads carry
 *      media.status 4; AVAILABLE(5)/BLOCKLISTED(6)/DELETED(7) are never
 *      relabelled by a stale downloadStatus)
 *   2. media.status 5|4|3|2|7|6 -> available|partial|processing|pending|removed|blocked
 *   3. request.status 3|4|1 -> declined|failed|awaiting (list-data fallbacks)
 *   4. else unknown. request.status 5 (completed) has no state of its own —
 *      the media.status ladder reflects reality.
 * media.status comes from the detail's mediaInfo, falling back to the list
 * entry's media blob when the detail fetch failed.
 * @returns {{key:string, label:string, tone:'ok'|'info'|'warn'|'muted'}}
 */
export function stateFor(request, detail) {
  const media = (detail && detail.mediaInfo) || (request && request.media) || {};
  const ms = media.status;
  const rs = request && request.status;
  const dl = Array.isArray(media.downloadStatus) ? media.downloadStatus : [];
  if (dl.length > 0 && (ms === 2 || ms === 3 || ms === 4)) {
    return { key: 'downloading', label: 'Downloading', tone: 'info' };
  }
  if (ms === 5) return { key: 'available', label: 'Ready to watch', tone: 'ok' };
  if (ms === 4) return { key: 'partial', label: 'Partially available', tone: 'info' };
  if (ms === 3) return { key: 'processing', label: 'Processing', tone: 'info' };
  if (ms === 2) return { key: 'pending', label: 'Pending', tone: 'muted' };
  if (ms === 7) return { key: 'removed', label: 'No longer in library', tone: 'warn' };
  if (ms === 6) return { key: 'blocked', label: 'Blocked', tone: 'warn' };
  if (rs === 3) return { key: 'declined', label: 'Declined', tone: 'warn' };
  if (rs === 4) return { key: 'failed', label: 'Failed', tone: 'warn' };
  if (rs === 1) return { key: 'awaiting', label: 'Awaiting approval', tone: 'muted' };
  return { key: 'unknown', label: 'Unknown', tone: 'muted' };
}

/** "HH:MM:SS.fffffff" (Seerr/sonarr timeLeft) -> total minutes, rounded up. */
function parseTimeLeftMinutes(t) {
  if (typeof t !== 'string') return null;
  // Accepts both 'hh:mm:ss' and .NET TimeSpan 'd.hh:mm:ss' (Sonarr/Seerr emit
  // the day segment for downloads running past 24 h).
  const m = t.match(/^(?:(\d+)\.)?(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\.\d+)?$/);
  if (!m) return null;
  const days = m[1] ? parseInt(m[1], 10) : 0;
  const sec = (days * 86400) + (parseInt(m[2], 10) * 3600) + (parseInt(m[3], 10) * 60) + parseInt(m[4], 10);
  if (!isFinite(sec) || sec <= 0) return null;
  return Math.ceil(sec / 60);
}

/**
 * Human ETA from a downloadStatus entry (or array, or bare timeLeft string).
 * "00:10:44.2433438" -> "~11 min"; "01:02:30" -> "~1 h 3 min" (M omitted at 0);
 * missing/unparseable -> null. NEVER invent a value.
 */
export function etaTextFromDownload(dl) {
  let t = null;
  if (typeof dl === 'string') t = dl;
  else if (Array.isArray(dl)) t = (dl[0] && dl[0].timeLeft) || null;
  else if (dl && typeof dl === 'object') t = dl.timeLeft || null;
  const min = parseTimeLeftMinutes(t);
  if (min == null) return null;
  if (min < 60) return '~' + min + ' min';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return '~' + h + ' h' + (m ? ' ' + m + ' min' : '');
}

/** 0-100 completion from a downloadStatus entry (size/sizeLeft), else null. */
export function pctFromDownload(dl) {
  const d = Array.isArray(dl) ? dl[0] : dl;
  if (!d || typeof d !== 'object') return null;
  const size = Number(d.size);
  const left = Number(d.sizeLeft);
  if (!isFinite(size) || !isFinite(left) || size <= 0) return null;
  return Math.max(0, Math.min(100, Math.round(((size - left) / size) * 100)));
}

/**
 * Build the display card for one Seerr request (+ its detail, when fetched).
 * A failed/missing detail falls back to list data (title 'Request #<id>',
 * state from the list media blob, seasons from the list entry).
 *
 * Label refinement (2026-10-11): bare 'Processing' is the vague state users
 * complain about ("is it actually working?"). With the seasons numbers known,
 * buildCard refines it: nothing in the library yet -> 'Searching — nothing
 * found yet'; some content present -> 'Filling in'. Keys stay 'processing'
 * so existing consumers/tests keep working.
 *
 * watchUrl: Seerr stores media.mediaUrl pointing at the internal cluster
 * address; rewrite it to the public Jellyfin base (jellyfinUrl param, e.g.
 * https://media.mysweetpea.cc) so 'Ready' cards can deep-link straight to
 * playback. Internal/non-https leftovers are dropped (never leak a cluster
 * address into the browser).
 *
 * @returns {{id:number|null, tmdbId:number|null, type:'tv'|'movie', title:string,
 *   posterUrl:string|null, link:string|null, watchUrl:string|null,
 *   state:{key:string,label:string,tone:string}, etaText:string|null,
 *   pct:number|null, seasonsTotal:number|null, seasonsAvailable:number|null,
 *   requestedAt:string|null, updatedAt:string|null}}
 */
export function buildCard(request, detail, seerrBase, jellyfinUrl) {
  const rq = request || {};
  const listMedia = rq.media || {};
  const mi = (detail && detail.mediaInfo) || listMedia;
  const type = rq.type === 'tv' ? 'tv' : 'movie';
  let tmdbId = null;
  if (listMedia.tmdbId != null) tmdbId = listMedia.tmdbId;
  else if (mi.tmdbId != null) tmdbId = mi.tmdbId;
  const state = stateFor(rq, detail);
  const dl = Array.isArray(mi.downloadStatus) ? mi.downloadStatus : [];
  const downloading = state.key === 'downloading';
  let seasonsSrc = [];
  if (detail && detail.mediaInfo && Array.isArray(detail.mediaInfo.seasons)) seasonsSrc = detail.mediaInfo.seasons;
  else if (Array.isArray(rq.seasons)) seasonsSrc = rq.seasons;
  const name = detail ? (type === 'tv' ? detail.name : detail.title) : null;
  const base = String(seerrBase || '').replace(/\/+$/, '');
  // Season.status uses the SAME MediaStatus enum as media (verified in Seerr's
  // entity/Season.js). "In library" = the season has SOME content: 4=PARTIALLY
  // and 5=AVAILABLE count; 6=BLOCKLISTED and 7=DELETED must NOT (the old >=4
  // test reported 24/24 for Family Guy whose seasons were all deleted(7)).
  const seasonsAvailable = type === 'tv'
    ? seasonsSrc.filter((s) => { const v = Number(s && s.status); return v === 4 || v === 5; }).length
    : null;
  // Refine the vague 'Processing' label with what we actually know.
  let label = state.label;
  if (state.key === 'processing') {
    label = seasonsAvailable > 0 ? 'Filling in' : 'Searching — nothing found yet';
  }
  // Public watch deep-link (detail first, list fallback; rewrite internal base).
  const rawMediaUrl = (typeof mi.mediaUrl === 'string' && mi.mediaUrl)
    || (typeof listMedia.mediaUrl === 'string' && listMedia.mediaUrl) || null;
  let watchUrl = null;
  if (rawMediaUrl && rawMediaUrl.indexOf('://') > 0) {
    const pub = String(jellyfinUrl || '').replace(/\/+$/, '');
    watchUrl = rawMediaUrl.indexOf(JELLYFIN_INTERNAL_PREFIX) === 0
      ? (pub ? pub + rawMediaUrl.slice(JELLYFIN_INTERNAL_PREFIX.length) : null)
      : rawMediaUrl;
    if (watchUrl && !/^https:\/\//.test(watchUrl)) watchUrl = null; // never leak http/cluster addresses
  }
  return {
    id: rq.id != null ? rq.id : null,
    tmdbId,
    type,
    title: (typeof name === 'string' && name) || ('Request #' + (rq.id != null ? rq.id : '?')),
    posterUrl: (detail && typeof detail.posterPath === 'string' && detail.posterPath)
      ? TMDB_POSTER_BASE + detail.posterPath
      : null,
    link: tmdbId != null ? (base + '/' + type + '/' + tmdbId) : (base || null),
    watchUrl,
    state: { key: state.key, label, tone: state.tone },
    etaText: downloading ? etaTextFromDownload(dl) : null,
    pct: downloading ? pctFromDownload(dl) : null,
    seasonsTotal: type === 'tv' ? seasonsSrc.length : null,
    seasonsAvailable,
    requestedAt: rq.createdAt != null ? rq.createdAt : null,
    updatedAt: rq.updatedAt != null ? rq.updatedAt : null,
  };
}
