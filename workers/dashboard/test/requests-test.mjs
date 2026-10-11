// Unit test: Seerr requests display logic against requests-fixtures.json
// (REAL captured Seerr API responses, 2026-09-17).
//
// The logic is IMPORTED from ../src/lib/requests-display.mjs — the SAME
// module the worker ships (same pattern as pipeline-test.mjs), so tests can
// never drift from shipped behavior. No network.
//
// Run: node test/requests-test.mjs   (from workers/dashboard)
import { readFileSync } from 'node:fs';
import {
  SEERR_UA, resolveSeerrUser, stateFor, buildCard, etaTextFromDownload, pctFromDownload,
} from '../src/lib/requests-display.mjs';

const fx = JSON.parse(readFileSync(new URL('./requests-fixtures.json', import.meta.url), 'utf8'));

let failures = 0;
const check = (label, cond, extra) => {
  if (cond) console.log('PASS', label);
  else { failures++; console.error('FAIL', label, extra || ''); }
};

// ---------- shared fixture pieces ----------
const users = fx.users;
const BASE = 'https://request.mysweetpea.cc';

check('UA constant is the verified browser string', SEERR_UA ===
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36');

// ---------- 1-3: user resolution (username primary, email fallback) ----------
check('resolve sweetpea -> Seerr id 2 (jellyfinUsername match)', resolveSeerrUser(users, { username: 'sweetpea', email: 'admin@mysweetpea.cc' }) === 2);
check('resolve mysweetpea -> Seerr id 1 (username AND email both work)', resolveSeerrUser(users, { username: 'mysweetpea', email: 'sweetpea@tuta.io' }) === 1);
check('resolve nobody -> null', resolveSeerrUser(users, { username: 'nobody', email: '' }) === null);
check('empty session username never matches an empty Seerr email', resolveSeerrUser(users, { username: '', email: '' }) === null);
check('matching is case-insensitive', resolveSeerrUser(users, { username: 'SweetPea', email: '' }) === 2);

// ---------- 4: Family Guy (request id 2, media.status 7 DELETED) ----------
const fg = buildCard(fx.reqUid2[0], fx.details['tv-1434'], BASE);
check('Family Guy state is removed', fg.state.key === 'removed' && fg.state.label === 'No longer in library' && fg.state.tone === 'warn', JSON.stringify(fg.state));
check('Family Guy link is seerrBase + /tv/1434', fg.link === BASE + '/tv/1434', fg.link);
check('Family Guy posterUrl ends /3PFsEuAiyLkWsP4GG6dIV37Q6gu.jpg', fg.posterUrl != null && fg.posterUrl.endsWith('/3PFsEuAiyLkWsP4GG6dIV37Q6gu.jpg'), fg.posterUrl);
check('Family Guy card basics', fg.id === 2 && fg.tmdbId === 1434 && fg.type === 'tv' && fg.title === 'Family Guy');
check('Family Guy seasons: 0 of 24 in library (status 7 = DELETED, never counted)', fg.seasonsTotal === 24 && fg.seasonsAvailable === 0, fg.seasonsTotal + '/' + fg.seasonsAvailable);

// ---------- 5: The Simpsons (media.status 3 PROCESSING) ----------
const sim = buildCard(fx.reqUid2[1], fx.details['tv-456'], BASE);
check('Simpsons state is processing', sim.state.key === 'processing' && sim.state.tone === 'info', JSON.stringify(sim.state));

// ---------- 6: live in-flight download (media.status 4 + downloadStatus) ----------
const activeReq = {
  id: 10, status: 2, type: 'tv',
  createdAt: '2026-09-17T02:00:00.000Z', updatedAt: '2026-09-17T02:40:00.000Z',
  media: { tmdbId: 255358, mediaType: 'tv', status: 4, downloadStatus: [] },
};
const active = buildCard(activeReq, fx.details['tv-255358-ACTIVE'], BASE);
check('ACTIVE detail maps to downloading', active.state.key === 'downloading', JSON.stringify(active.state));
check("timeLeft 00:10:44.2433438 -> '~11 min'", active.etaText === '~11 min', active.etaText);
check('pct is 0 when sizeLeft === size', active.pct === 0, active.pct);
// status ladder beats stale download data: AVAILABLE must never be relabelled
const staleDl = [{ timeLeft: '00:05:00', size: 100, sizeLeft: 50 }];
check('media.status 5 + stale downloadStatus still maps to available', stateFor({ status: 2 }, { mediaInfo: { status: 5, downloadStatus: staleDl } }).key === 'available');
check('available card leaks NO eta/pct from stale download data', (() => {
  const c = buildCard({ id: 11, status: 5, type: 'movie', media: { tmdbId: 1, status: 5, downloadStatus: staleDl } }, { mediaInfo: { status: 5, downloadStatus: staleDl } }, BASE);
  return c.etaText === null && c.pct === null && c.state.key === 'available';
})());

// ---------- 7: Bob Hearts Abishola (media.status 4, NO downloadStatus -> partial) ----------
const bobReq = { id: 8, status: 2, type: 'tv', media: { tmdbId: 92461, mediaType: 'tv', status: 4, downloadStatus: [] } };
const bob = buildCard(bobReq, fx.details['tv-92461'], BASE);
check('Bob seasons: 1 of 5 in library (only PARTIAL/AVAILABLE count)', bob.seasonsTotal === 5 && bob.seasonsAvailable === 1, bob.seasonsTotal + '/' + bob.seasonsAvailable);
check('Bob Hearts Abishola is partial (NOT downloading — boundary guard)', bob.state.key === 'partial' && bob.state.tone === 'info', JSON.stringify(bob.state));
check('Bob Hearts Abishola seasons 5 total / 1 available', bob.seasonsTotal === 5 && bob.seasonsAvailable === 1, bob.seasonsTotal + '/' + bob.seasonsAvailable);

// ---------- 8: full media.status + request.status mapping ----------
const st = (mediaStatus, reqStatus, dl) => stateFor(
  { status: reqStatus, media: { status: mediaStatus, downloadStatus: dl || [] } },
  mediaStatus != null ? { mediaInfo: { status: mediaStatus, downloadStatus: dl || [] } } : null);
check('media 5 -> available/ok', st(5, 5).key === 'available' && st(5, 5).tone === 'ok');
check('media 7 -> removed/warn', st(7, 5).key === 'removed' && st(7, 5).tone === 'warn');
check('media 6 -> blocked/warn', st(6, 2).key === 'blocked' && st(6, 2).tone === 'warn');
check('media 4 -> partial/info', st(4, 2).key === 'partial');
check('media 3 -> processing/info', st(3, 2).key === 'processing');
check('media 2 -> pending/muted', st(2, 2).key === 'pending' && st(2, 2).tone === 'muted');
check('request 1 (unknown media) -> awaiting/muted', st(1, 1).key === 'awaiting' && st(1, 1).tone === 'muted');
check('request 3 (unknown media) -> declined/warn', st(1, 3).key === 'declined' && st(1, 3).tone === 'warn');
check('request 4 (unknown media) -> failed/warn', st(1, 4).key === 'failed' && st(1, 4).tone === 'warn');
check('no media at all + request 1 -> awaiting', stateFor({ status: 1 }, null).key === 'awaiting');
check('nothing matches -> unknown/muted', stateFor({ status: 2 }, { mediaInfo: { status: 1, downloadStatus: [] } }).key === 'unknown');
check('downloading beats media 3 (PENDING) — live capture behavior', st(3, 2, staleDl).key === 'downloading');

// ---------- 9: etaTextFromDownload / pctFromDownload ----------
check("eta '01:02:30' -> '~1 h 3 min'", etaTextFromDownload({ timeLeft: '01:02:30' }) === '~1 h 3 min', etaTextFromDownload({ timeLeft: '01:02:30' }));
check("eta '00:00:30' -> '~1 min' (rounds up)", etaTextFromDownload({ timeLeft: '00:00:30' }) === '~1 min');
check('eta missing -> null', etaTextFromDownload({}) === null && etaTextFromDownload(null) === null && etaTextFromDownload([]) === null);
check("eta whole hours omit minutes ('02:00:00' -> '~2 h')", etaTextFromDownload({ timeLeft: '02:00:00' }) === '~2 h');
check('eta unparseable -> null', etaTextFromDownload({ timeLeft: 'soon' }) === null);
check("eta accepts a bare timeLeft string", etaTextFromDownload('00:10:44.2433438') === '~11 min');
check('eta supports multi-day TimeSpan (d.hh:mm:ss)', etaTextFromDownload('1.02:30:00') === '~26 h 30 min', String(etaTextFromDownload('1.02:30:00')));
check("eta array form uses first entry", etaTextFromDownload([{ timeLeft: '00:45:00' }]) === '~45 min');
check('pct half downloaded -> 50', pctFromDownload({ size: 100, sizeLeft: 50 }) === 50);
check('pct missing sizes -> null', pctFromDownload({}) === null && pctFromDownload(null) === null);
check('pct clamps to 0..100', pctFromDownload({ size: 10, sizeLeft: -5 }) === 100 && pctFromDownload({ size: 10, sizeLeft: 99 }) === 0);

// ---------- detail-fetch fallback (list data only) ----------
const fallback = buildCard({ id: 7, status: 2, type: 'movie', createdAt: '2026-08-20T19:16:59.000Z', media: { tmdbId: 980431, mediaType: 'movie', status: 1, downloadStatus: [] } }, null, BASE);
check('failed detail falls back to list data (title Request #7, state unknown)', fallback.title === 'Request #7' && fallback.id === 7 && fallback.state.key === 'unknown', JSON.stringify(fallback));
check('failed detail -> posterUrl null', fallback.posterUrl === null);
check('movie card has null seasons', (() => {
  const m = buildCard(fx.reqUid1[2], fx.details['movie-980431'], BASE);
  return m.type === 'movie' && m.seasonsTotal === null && m.seasonsAvailable === null && m.state.key === 'available' && m.title === 'Avatar Aang: The Last Airbender';
})());

// ---------- 10: label refinement + watch deep-link (2026-10-11) ----------
const procNoLib = buildCard({ id: 20, status: 2, type: 'tv', media: { tmdbId: 999, status: 3, downloadStatus: [] } },
  { name: 'Tracker', mediaInfo: { status: 3, downloadStatus: [], seasons: [{ seasonNumber: 1, status: 1 }, { seasonNumber: 2, status: 1 }] } }, BASE);
check('processing + nothing in library -> searching label', procNoLib.state.key === 'processing' && procNoLib.state.label === 'Searching — nothing found yet', JSON.stringify(procNoLib.state));
const procSome = buildCard({ id: 21, status: 2, type: 'tv', media: { tmdbId: 998, status: 3, downloadStatus: [] } },
  { name: 'Filling Show', mediaInfo: { status: 3, downloadStatus: [], seasons: [{ seasonNumber: 1, status: 4 }, { seasonNumber: 2, status: 1 }] } }, BASE);
check('processing + some in library -> filling-in label', procSome.state.key === 'processing' && procSome.state.label === 'Filling in', JSON.stringify(procSome.state));
const wl = buildCard({ id: 22, status: 2, type: 'movie', media: { tmdbId: 997, status: 5, mediaUrl: 'http://jellyfin.private.svc.cluster.local:8096/web/index.html#!/details?id=abc123' } }, null, BASE, 'https://media.mysweetpea.cc');
check('watchUrl rewritten to public base', wl.watchUrl === 'https://media.mysweetpea.cc/web/index.html#!/details?id=abc123', String(wl.watchUrl));
const noPub = buildCard({ id: 23, status: 2, type: 'movie', media: { tmdbId: 996, status: 5, mediaUrl: 'http://jellyfin.private.svc.cluster.local:8096/x' } }, null, BASE);
check('internal mediaUrl without public base -> watchUrl null (no cluster leak)', noPub.watchUrl === null, String(noPub.watchUrl));
const pubDirect = buildCard({ id: 24, status: 2, type: 'movie', media: { tmdbId: 995, status: 5, mediaUrl: 'https://media.mysweetpea.cc/web/index.html#!/details?id=zzz' } }, null, BASE, 'https://media.mysweetpea.cc');
check('already-public mediaUrl passes through', pubDirect.watchUrl === 'https://media.mysweetpea.cc/web/index.html#!/details?id=zzz', String(pubDirect.watchUrl));

if (failures) { console.error(failures + ' FAILURES'); process.exit(1); }
console.log('ALL CHECKS PASSED');
