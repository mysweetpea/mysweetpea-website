/* MySweetPea — Cloudflare Worker (dynamic routes only)
 *
 * Since the Sep 2026 P1/P2 pass this Worker no longer touches HTML:
 *   - pages are built by bake_html.py (account chip, canonical, JSON-LD baked in)
 *   - the strict CSP + security headers live in the _headers file, applied by the
 *     static-assets layer (hash-based script-src, no per-request nonce)
 *   - run_worker_first is an ARRAY, so every asset request bypasses this script
 *     entirely (free, unlimited, no CPU, cannot hit the 10 ms cap)
 *
 * This file now serves ONLY:
 *   /api/commits           — GitHub commits proxy for the changelog
 *   /api/auth/state        — session probe proxy (site nav chip)
 *   /api/avatar            — avatar proxy (site nav chip)
 *   /api/suggest           — authenticated suggestion proxy -> n8n webhook
 *   /.well-known/matrix/*  — Matrix federation discovery
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const DASH = 'https://dashboard.mysweetpea.cc';

// In-memory cache for /api/commits (survives across requests within an isolate)
let commitsCache = { data: null, ts: 0 };
let commitsInflight = null; // shared fan-out: concurrent cold misses get the same promise
const COMMITS_TTL = 300_000; // 5 minutes in ms

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // --- Proxy GitHub commits for the changelog (token stays server-side) ---
    // "Highlights + Activity console" aggregation: noise-filtered, categorized
    // (f/d/i), top-3 highlights with optional manual override, week-grouped rows.
    if (url.pathname === '/api/commits') {
      const now = Date.now();
      if (commitsCache.data && (now - commitsCache.ts) < (commitsCache.ttl || COMMITS_TTL)) {
        return new Response(JSON.stringify(commitsCache.data), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=' + Math.round((commitsCache.ttl || COMMITS_TTL) / 1000),
            'X-Cache': 'HIT'
          }
        });
      }
      // In-flight dedup: concurrent cold misses share one GitHub fan-out;
      // the handler RETURNS the shared promise so the route resolves the response.
      if (commitsInflight) return commitsInflight;
      commitsInflight = (async () => {
      const token = env.GITHUB_TOKEN || '';
      const repos = ['mysweetpea/mysweetpea-website', 'mysweetpea/mysweetpea-homelab'];
      const headers = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'mysweetpea-site'
      };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      const results = await Promise.all(repos.map(async (repo) => {
        try {
          const res = await fetch('https://api.github.com/repos/' + repo + '/commits?per_page=100', { headers });
          if (!res.ok) { console.error('commits fetch failed', repo, res.status); return []; }
          let data = await res.json();
          // Paginate until the 30-day window is covered (guarded, max 3 pages).
          const cutoff = Date.now() - 30 * 86400000;
          for (let page = 1; page < 3 && Array.isArray(data) && data.length === 100; page++) {
            const oldest = data[data.length - 1];
            const od = oldest && oldest.commit && oldest.commit.author && Date.parse(oldest.commit.author.date);
            if (!od || od < cutoff) break;
            const res2 = await fetch('https://api.github.com/repos/' + repo + '/commits?per_page=100&page=' + (page + 1), { headers });
            if (!res2.ok) break;
            const more = await res2.json();
            if (!Array.isArray(more) || more.length === 0) break;
            data = data.concat(more);
          }
          if (!Array.isArray(data)) return [];
          return data.filter((c) => c && c.sha && c.commit && c.commit.author && c.commit.author.date).map((c) => ({
            repo: repo.split('/')[1],
            full: c.sha,
            sha: c.sha.slice(0, 7),
            message: (c.commit.message || '').split('\n')[0],
            date: c.commit.author.date
          }));
        } catch (e) {
          console.error('commits fetch threw', repo, e && e.message);
          return [];
        }
      }));

      const all = results.flat().sort((a, b) => new Date(b.date) - new Date(a.date));

      // 1. NOISE: drop automated deploy commits, count them (total + per repo)
      const NOISE_RE = /^build: automatic update of /i;
      const items = [];
      const total = { features: 0, improvements: 0, fixes: 0, noise: 0 };
      for (const c of all) {
        if (NOISE_RE.test(c.message)) { total.noise++; continue; }
        items.push(c);
      }

      // 2. Categorize by prefix: f = feature, d = fix, i = improvement
      const catOf = (msg) => {
        const m = msg.toLowerCase();
        if (/^feat/.test(m) || /^add /.test(m) || /^new /.test(m)) return 'f';
        if (/(^|[:\s])fix/.test(m) || m.includes('defect') || /^revert /.test(m)) return 'd';
        return 'i';
      };

      // 3. Highlight candidates: big features + security/backup fixes
      const flagged = [];
      for (const it of items) {
        const m = it.message.toLowerCase();
        it.cat = catOf(it.message);
        total[it.cat === 'f' ? 'features' : it.cat === 'd' ? 'fixes' : 'improvements']++;
        const featCandidate = it.cat === 'f' && (/^feat/.test(m) || it.message.length > 40);
        const secCandidate = it.cat === 'd' && (m.includes('security') || m.includes('backup'));
        if (featCandidate || secCandidate) flagged.push(it);
      }

      // 4. OPTIONAL manual override: /changelog-highlights.json in the site
      //    assets (JSON array of 7-char or longer hex shas; 7/32/40 all work)
      //    forces highlight=true for matches, BEFORE the cap to 3. Purely
      //    optional; absence is fine.
      try {
        const res = await env.ASSETS.fetch(new Request('https://assets.local/changelog-highlights.json'));
        if (res.ok) {
          const arr = await res.json();
          if (Array.isArray(arr)) {
            const forced = new Set(arr
              .filter((s) => typeof s === 'string' && /^[0-9a-f]{7,40}$/i.test(s.trim()))
              .map((s) => s.trim().toLowerCase()));
            for (const it of items) {
              if (flagged.includes(it)) continue;
              for (const sha of forced) {
                if (it.full.startsWith(sha)) { flagged.push(it); break; }
              }
            }
          }
        }
      } catch (e) { /* override file absent - purely optional */ }

      const highlights = flagged.slice(0, 3); // items are already newest-first
      const isHighlight = new Set(highlights);
      const rows = items.filter((it) => !isHighlight.has(it));

      // 5. Group the rest into Monday-based weeks, newest first (cap 6)
      const weekStart = (dstr) => {
        const d = new Date(dstr);
        if (isNaN(d.getTime())) return null;
        const back = (d.getUTCDay() + 6) % 7; // days since Monday
        const mon = new Date(d.getTime() - back * 86400000);
        return Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate());
      };
      const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const weekLabel = (start) => {
        const mon = new Date(start);
        const sun = new Date(start + 6 * 86400000);
        const from = MONTHS[mon.getUTCMonth()] + ' ' + mon.getUTCDate();
        const to = sun.getUTCMonth() === mon.getUTCMonth()
          ? String(sun.getUTCDate())
          : MONTHS[sun.getUTCMonth()] + ' ' + sun.getUTCDate();
        return 'Week of ' + from + ' \u2013 ' + to;
      };

      const weeks = [];
      const byStart = new Map();
      for (const it of rows) {
        const start = weekStart(it.date);
        if (start === null) continue;
        let wk = byStart.get(start);
        if (!wk) {
          wk = { label: weekLabel(start), count: 0, noise: 0, start, items: [] };
          byStart.set(start, wk);
          weeks.push(wk);
        }
        wk.count++;
        wk.items.push({ sha: it.sha, repo: it.repo, message: it.message, date: it.date, cat: it.cat });
      }
      for (const c of all) {
        if (!NOISE_RE.test(c.message)) continue;
        const start = weekStart(c.date);
        const wk = start !== null ? byStart.get(start) : null;
        if (wk) wk.noise++;
      }
      weeks.sort((a, b) => b.start - a.start);

      const payload = {
        generated: new Date().toISOString(),
        totals: total,
        highlights: highlights.map((it) => ({
          sha: it.sha, repo: it.repo, message: it.message, date: it.date, cat: it.cat
        })),
        weeks: weeks.slice(0, 6).map((wk) => ({
          label: wk.label, count: wk.count, noise: wk.noise, items: wk.items
        }))
      };

      // Cache good results for the full TTL; cache empty results only 30s so a
      // GitHub failure/repo-hiccup bounds the fan-out instead of re-fetching on
      // every request, without blanking the changelog for 5 minutes.
      const ttl = (items.length > 0 || total.noise > 0) ? COMMITS_TTL : 30_000;
      commitsCache = { data: payload, ts: now, ttl };

      return new Response(JSON.stringify(payload), {
        headers: {
          'Content-Type': 'application/json',
          // browser/edge cache must match the effective TTL (30s on degraded
          // results — otherwise a blank changelog is cached the full 5 minutes)
          'Cache-Control': 'public, max-age=' + Math.round(ttl / 1000),
          'X-Cache': 'MISS'
        }
      });
      })();
      const result = commitsInflight;
      commitsInflight = null;
      return result;
    }

    // --- Suggest-a-Service: authenticated proxy to the n8n webhook ---
    // Only signed-in members may submit; anonymous traffic is rejected here so the
    // upstream webhook is never exposed to the public.
    if (url.pathname === '/api/suggest') {
      if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: JSON_HEADERS });
      // CSRF guard: same-origin browser submissions only (state-changing POST)
      const site = request.headers.get('Sec-Fetch-Site');
      const origin = request.headers.get('Origin');
      if (site && site !== 'same-origin') return new Response(JSON.stringify({ error: 'cross_site_forbidden' }), { status: 403, headers: JSON_HEADERS });
      if (origin) { try { if (new URL(origin).host !== url.host) return new Response(JSON.stringify({ error: 'cross_site_forbidden' }), { status: 403, headers: JSON_HEADERS }); } catch { return new Response(JSON.stringify({ error: 'bad_origin' }), { status: 403, headers: JSON_HEADERS }); } }
      const state = await (async () => {
        const fwd = {};
        const cookie = request.headers.get('Cookie');
        const ua = request.headers.get('User-Agent');
        if (cookie) fwd['Cookie'] = cookie;
        if (ua) fwd['User-Agent'] = ua;
        try { return await (await fetch(DASH + '/api/auth/state', { headers: fwd })).json(); }
        catch { return { logged_in: false }; }
      })();
      if (!state.logged_in) return new Response(JSON.stringify({ error: 'sign_in_required' }), { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      let payload;
      try { payload = await request.json(); } catch { return new Response(JSON.stringify({ error: 'bad_json' }), { status: 400, headers: JSON_HEADERS }); }
      if (!payload || typeof payload !== 'object') return new Response(JSON.stringify({ error: 'bad_json' }), { status: 400, headers: JSON_HEADERS });
      // Sanitize: only known fields, bounded lengths, explicit types
      const str = (v) => (typeof v === 'string' ? v : '');
      const clean = {
        service_name: str(payload.service_name).slice(0, 120),
        project_url: str(payload.project_url).slice(0, 300),
        category: str(payload.category).slice(0, 60),
        reason: str(payload.reason).slice(0, 2000),
        your_name: (typeof state.name === 'string' && state.name ? state.name : str(payload.your_name)).slice(0, 120),
        your_email: str(payload.your_email).slice(0, 200)
      };
      if (!clean.service_name || !clean.category || !clean.reason) return new Response(JSON.stringify({ error: 'missing_fields' }), { status: 400, headers: JSON_HEADERS });
      let upstream;
      try {
        upstream = await fetch('https://subscribe.mysweetpea.cc/webhook/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(clean)
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'upstream_unreachable' }), { status: 502, headers: JSON_HEADERS });
      }
      return new Response(JSON.stringify({ ok: upstream.ok }), {
        status: upstream.ok ? 200 : 502,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    // --- RSS feed for the changelog (reuses the commits cache) ---
    if (url.pathname === '/feed.xml') {
      const now = Date.now();
      let payload = commitsCache.data;
      if (!payload || (now - commitsCache.ts) >= (commitsCache.ttl || COMMITS_TTL)) {
        // trigger a fresh fetch through the API route logic by calling it
        try {
          const r = await fetch(new URL('/api/commits', url.origin), { headers: { 'User-Agent': 'mysweetpea-site-rss' } });
          payload = r.ok ? await r.json() : commitsCache.data;
        } catch (e) { /* fall back to stale cache */ }
      }
      const items = (payload && Array.isArray(payload.highlights) ? payload.highlights : []).slice(0, 15);
      const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>' +
        '<title>MySweetPea changelog</title>' +
        '<link>https://mysweetpea.cc/changelog</link>' +
        '<description>Recent changes to the MySweetPea website and homelab.</description>' +
        '<language>en</language>' +
        items.map((h) => {
          const d = h.date ? new Date(h.date) : new Date();
          const repoName = h.repo === 'portfolio' ? 'mysweetpea-website' : 'mysweetpea-homelab';
          const link = 'https://github.com/mysweetpea/' + repoName + '/commit/' + (h.full || h.sha || '');
          return '<item><title>' + esc(h.name || h.message || 'change') + '</title><link>' + esc(link) + '</link><guid isPermaLink="true">' + esc(link) + '</guid><pubDate>' + d.toUTCString() + '</pubDate></item>';
        }).join('') +
        '</channel></rss>';
      return new Response(xml, {
        headers: {
          'Content-Type': 'application/rss+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=300'
        }
      });
    }

    if (url.pathname === '/api/auth/state') {
      const fwd = {};
      const cookie = request.headers.get('Cookie');
      const ua = request.headers.get('User-Agent');
      const accept = request.headers.get('Accept');
      const lang = request.headers.get('Accept-Language');
      if (cookie) fwd['Cookie'] = cookie;
      if (ua) fwd['User-Agent'] = ua;
      if (accept) fwd['Accept'] = accept;
      if (lang) fwd['Accept-Language'] = lang;
      let upstream;
      try {
        // client query-params deliberately dropped — no parameter injection upstream
        upstream = await fetch(DASH + '/api/auth/state', { headers: fwd });
      } catch (e) {
        return new Response(JSON.stringify({ logged_in: false, error: 'upstream_unreachable' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        });
      }
      const body = await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    // --- Avatar proxy (signed-in chip): forwards session cookie to the dashboard ---
    if (url.pathname === '/api/avatar') {
      const fwd = {};
      const cookie = request.headers.get('Cookie');
      if (cookie) fwd['Cookie'] = cookie;
      fwd['User-Agent'] = request.headers.get('User-Agent') || '';
      let upstream;
      try {
        upstream = await fetch(DASH + '/api/avatar', { headers: fwd, redirect: 'manual' });
      } catch (e) {
        return new Response('upstream_unreachable', { status: 502 });
      }
      if (!upstream.ok) return new Response('no avatar', { status: upstream.status });
      const ctype = upstream.headers.get('Content-Type') || '';
      // only relay actual images — never let an HTML error page render same-origin
      const safeType = ctype.startsWith('image/') ? ctype : 'application/octet-stream';
      const buf = await upstream.arrayBuffer();
      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': safeType,
          'Cache-Control': 'private, max-age=300'
        }
      });
    }

    // --- Matrix federation well-known ---
    if (url.pathname === '/.well-known/matrix/server') {
      return new Response(JSON.stringify({
        'm.server': 'matrix.mysweetpea.cc:443'
      }), { headers: JSON_HEADERS });
    }

    if (url.pathname === '/.well-known/matrix/client') {
      return new Response(JSON.stringify({
        'm.homeserver': { 'base_url': 'https://matrix.mysweetpea.cc' }
      }), { headers: JSON_HEADERS });
    }

    // Everything else is a static asset. With run_worker_first as an array,
    // asset requests never reach this script — this branch only catches paths
    // that explicitly match the array (kept as a safe fallback).
    return env.ASSETS.fetch(request);
  }
};
