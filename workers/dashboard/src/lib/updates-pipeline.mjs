// Shared updates-pipeline module — single source of truth.
//
// Both the dashboard worker (src/index.ts) and the unit test
// (test/pipeline-test.mjs) import THIS file, so the test can never drift from
// what actually ships. Plain ES module (no TS types at runtime; JSDoc for
// editors) so a .mjs test can import it directly without a build step.
//
// Pipeline: parse "build: automatic update of X ... updates image Y tag 'a'
// to 'b'" commits -> dedupe (keep earliest) -> drop downgrades -> reconcile
// against live runtime versions (drop releases that never ran, keep chains).

// ---------- config tables (shared single source) ----------

/** app (image dir name) -> user-facing service key */
export const APP_SERVICE = {
  'vaultwarden': 'vaultwarden',
  'matrix-synapse': 'matrix', 'matrix-mas': 'matrix', 'element-web': 'matrix', 'matrix-rtc': 'matrix',
  'affine': 'affine', 'koalasync': 'koalasync', 'jellyfin': 'jellyfin', 'seerr': 'seerr',
  'nextcloud': 'nextcloud', 'immich': 'immich', 'open-webui': 'open-webui',
};

export const SERVICE_NAME = {
  'vaultwarden': 'Vaultwarden', 'matrix': 'Matrix / Element', 'affine': 'AFFiNE', 'koalasync': 'KoalaSync',
  'jellyfin': 'Jellyfin', 'seerr': 'Seerr', 'nextcloud': 'Nextcloud', 'immich': 'Immich', 'open-webui': 'Open WebUI',
};

// Release-notes repos. prefix: 'v' | '' (vaultwarden tags bare) | null (SHA tags
// are not releases — link the releases list instead). Jellyfin deliberately
// absent: upstream latest is v12.x while the cluster runs 10.11.11 — never link.
export const APP_RELEASE = {
  'vaultwarden': { repo: 'dani-garcia/vaultwarden', prefix: '' },
  'matrix-synapse': { repo: 'element-hq/synapse', prefix: 'v' },
  'element-web': { repo: 'element-hq/element-web', prefix: 'v' },
  'matrix-mas': { repo: 'element-hq/matrix-authentication-service', prefix: 'v' },
  'affine': { repo: 'toeverything/AFFiNE', prefix: null },
  'koalasync': { repo: 'Shik3i/KoalaSync', prefix: 'v' },
  'seerr': { repo: 'seerr-team/seerr', prefix: 'v' },
  'nextcloud': { repo: 'nextcloud/server', prefix: 'v' },
  'immich': { repo: 'immich-app/immich', prefix: 'v' },
  'open-webui': { repo: 'open-webui/open-webui', prefix: 'v' },
};

// Runtime version probes (all verified 200 from a Worker). Keyed by APP — only
// apps whose image version IS the endpoint's version reconcile (element-web
// must not be compared against synapse's version). Apps NOT in this map
// (element-web/affine/koalasync/matrix-mas/matrix-rtc) have no public endpoint
// -> git evidence only. The test derives its RECONCILABLE set FROM THIS MAP so
// adding/removing a probe can never desync the test.
/** Immich /api/server/version returns {major,minor,patch} (older builds: a plain string). */
function immichVersion(d) {
  if (!d) return '';
  if (typeof d === 'string') return d;
  if (typeof d.major === 'number') return `${d.major}.${d.minor}.${d.patch}`;
  return '';
}

// NOTE: probe URLs are deliberately STATIC public hostnames (not env vars): this
// module is imported by the test runner (no env available), and a Cloudflare
// Worker can only reach PUBLIC endpoints anyway — internal cluster URLs would
// never resolve. A probe failure degrades safely (git evidence alone), so a
// domain change costs reconcile, not correctness.
export const RUNTIME_PROBES = {
  'vaultwarden': { url: 'https://vault.mysweetpea.cc/api/version', pick: (d) => (typeof d === 'string' ? d : '') },
  'matrix-synapse': { url: 'https://matrix.mysweetpea.cc/_matrix/federation/v1/version', pick: (d) => (d && d.server && d.server.version) || '' },
  'nextcloud': { url: 'https://cloud.mysweetpea.cc/status.php', pick: (d) => (d && d.versionstring) || '' },
  'immich': {
    url: 'https://photos.mysweetpea.cc/api/server/version',
    pick: immichVersion,
  },
  'open-webui': { url: 'https://ai.mysweetpea.cc/api/config', pick: (d) => (d && d.version) || '' },
};

export const UPDATES_WINDOW_DAYS = 90;

// ---------- pure helpers ----------

const UPD_SUBJECT_RE = /^build: automatic update of (\S+)/m;
const UPD_TAGLINE_RE = /updates image (\S+) tag '([^']*)' to '([^']*)'/; // no /g: match() semantics, no lastIndex state

export const isVersionLike = (t) => /^v?\d+(\.\d+)+/.test(String(t || ''));
export const isShaLike = (t) => /^[A-Za-z]+-[0-9a-f]{6,}$/.test(String(t || '')) || /^[0-9a-f]{7,40}$/.test(String(t || ''));

export function parseVer(t) {
  const s = String(t || '').replace(/^v/, '');
  const m = s.match(/^\d+(\.\d+)*/);
  if (!m) return null;
  // A suffix after the numeric prefix (1.2.3-rc.1, 10.11.11-4) is NOT treated as
  // a comparable version: comparing bare numeric prefixes would equate an RC with
  // its final and misclassify rollbacks. Safe path = non-version route (skips the
  // downgrade filter AND reconcile suppression): an unusual tag is announced,
  // never silently hidden. Plain '1.2.3' / 'v1.2.3' are unaffected.
  if (m[0].length !== s.length) return null;
  const parts = m[0].split('.').map(Number);
  return parts.every((n) => isFinite(n)) ? parts : null;
}

export function cmpVer(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Parse one GitHub commit (API shape) into a raw update entry, or null. */
export function parseUpdateCommit(c) {
  const msg = String((c && c.commit && c.commit.message) || '');
  const sm = msg.match(UPD_SUBJECT_RE);
  if (!sm) return null;
  const app = sm[1].split('/').pop();
  if (!APP_SERVICE[app]) return null;
  const tm = UPD_TAGLINE_RE.exec(msg);
  if (!tm) return null;
  const date = String((c.commit.author && c.commit.author.date) || '').slice(0, 10);
  return { app, from: tm[2], to: tm[3], date, sha: String(c.sha || '').slice(0, 7) };
}

/** Materialize a raw entry into the feed item shape. */
export function buildUpdate(e) {
  const rel = APP_RELEASE[e.app];
  let releaseUrl = null;
  if (rel && rel.prefix !== null && isVersionLike(e.to)) {
    const tag = rel.prefix + String(e.to).replace(/^v/, '');
    releaseUrl = 'https://github.com/' + rel.repo + '/releases/tag/' + tag;
  } else if (rel && rel.prefix === null) {
    releaseUrl = 'https://github.com/' + rel.repo + '/releases';
  }
  let kind = 'update'; // non-version from tag ("latest"/"testing"/"preview-*")
  if (isVersionLike(e.from) && isVersionLike(e.to)) kind = 'version';
  else if (isShaLike(e.from) || isShaLike(e.to)) kind = 'build'; // affine stable-<sha>
  return { service: APP_SERVICE[e.app], name: SERVICE_NAME[APP_SERVICE[e.app]], from: e.from, to: e.to, date: e.date, sha: e.sha, releaseUrl, kind };
}

/**
 * Full parse -> dedupe -> downgrade-filter pass over raw GitHub commits.
 * Returns RAW entries (parseUpdateCommit shape, with .app) at every stage —
 * callers run reconcile() on kept, THEN buildUpdate() the survivors.
 * @param {any[]} rawCommits GitHub API commit objects
 * @param {number} [nowMs] clock override (tests)
 */
export function runPipeline(rawCommits, nowMs) {
  const now = nowMs || Date.now();
  const cutoff = new Date(now - UPDATES_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const parsed = [];
  for (const c of rawCommits) {
    const e = parseUpdateCommit(c);
    if (e && e.date >= cutoff) parsed.push(e);
  }
  // dedupe by (app, from, to) — keep EARLIEST date.
  // Keyed by APP not service: sibling matrix images (synapse/element-web/mas/rtc)
  // are independent release trains; a same-string coincidence must not collapse them.
  const best = new Map();
  for (const e of parsed) {
    const k = e.app + '|' + e.from + '|' + e.to;
    const prev = best.get(k);
    if (!prev || e.date < prev.date) best.set(k, e);
  }
  const deduped = Array.from(best.values());
  // drop downgrades — ONLY when BOTH tags are version-like (AFFiNE's
  // stable-<sha> tags parse as garbage numbers and must never be compared)
  const kept = [], droppedDowngrades = [];
  for (const e of deduped) {
    const f = parseVer(e.from), t = parseVer(e.to);
    if (f && t && cmpVer(t, f) < 0) { droppedDowngrades.push(e); continue; }
    kept.push(e);
  }
  kept.sort((a, b) => {
    if (a.date < b.date) return 1;
    if (a.date > b.date) return -1;
    return 0;
  });
  return { parsed, deduped, kept, droppedDowngrades };
}

/**
 * Reconcile against live runtime versions: keep when to is a non-version tag,
 * the app has no probe, the probe failed, or to <= running (LTE keeps the
 * announced chain; equality would collapse history and drop the newest real hop).
 * @param {any[]} updates items from runPipeline().kept
 * @param {Record<string, number[]>} running probe results by app
 */
export function reconcile(updates, running) {
  return updates.filter((u) => {
    if (!RUNTIME_PROBES[u.app]) return true; // element-web/affine/... -> git evidence only
    const run = running[u.app];
    if (!run) return true;
    const to = parseVer(u.to);
    if (!to) return true;
    return cmpVer(to, run) <= 0;
  });
}
