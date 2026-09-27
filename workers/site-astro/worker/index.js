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
const COMMITS_TTL = 300_000; // 5 minutes in ms

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // --- Proxy GitHub commits for the changelog (token stays server-side) ---
    if (url.pathname === '/api/commits') {
      const now = Date.now();
      if (commitsCache.data && (now - commitsCache.ts) < COMMITS_TTL) {
        return new Response(JSON.stringify(commitsCache.data), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300',
            'X-Cache': 'HIT'
          }
        });
      }

      const token = env.GITHUB_TOKEN || '';
      const repos = ['mysweetpea/mysweetpea-website', 'mysweetpea/mysweetpea-homelab'];
      const headers = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'mysweetpea-site'
      };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      const results = await Promise.all(repos.map(async (repo) => {
        try {
          const res = await fetch('https://api.github.com/repos/' + repo + '/commits?per_page=10', { headers });
          if (!res.ok) return [];
          const data = await res.json();
          return data.map((c) => ({
            repo: repo.split('/')[1],
            sha: c.sha.slice(0, 7),
            message: (c.commit && c.commit.message || '').split('\n')[0],
            date: c.commit && c.commit.author && c.commit.author.date
          }));
        } catch (e) {
          return [];
        }
      }));

      const all = results.flat().sort((a, b) => new Date(b.date) - new Date(a.date));
      // Don't cache empty results: a transient GitHub failure would otherwise
      // blank the changelog for the whole TTL.
      if (all.length > 0) {
        commitsCache = { data: all, ts: now };
      }

      return new Response(JSON.stringify(all), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
          'X-Cache': 'MISS'
        }
      });
    }

    // --- Suggest-a-Service: authenticated proxy to the n8n webhook ---
    // Only signed-in members may submit; anonymous traffic is rejected here so the
    // upstream webhook is never exposed to the public.
    if (url.pathname === '/api/suggest') {
      if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: JSON_HEADERS });
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
      // Sanitize: only known fields, bounded lengths
      const clean = {
        service_name: String(payload.service_name || '').slice(0, 120),
        project_url: String(payload.project_url || '').slice(0, 300),
        category: String(payload.category || '').slice(0, 60),
        reason: String(payload.reason || '').slice(0, 2000),
        your_name: state.name || String(payload.your_name || '').slice(0, 120),
        your_email: String(payload.your_email || '').slice(0, 200)
      };
      if (!clean.service_name || !clean.category || !clean.reason) return new Response(JSON.stringify({ error: 'missing_fields' }), { status: 400, headers: JSON_HEADERS });
      const upstream = await fetch('https://subscribe.mysweetpea.cc/webhook/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clean)
      });
      return new Response(JSON.stringify({ ok: upstream.ok }), {
        status: upstream.ok ? 200 : 502,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
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
        upstream = await fetch(DASH + '/api/auth/state' + (url.search || ''), { headers: fwd });
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
      const buf = await upstream.arrayBuffer();
      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': upstream.headers.get('Content-Type') || 'image/png',
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
