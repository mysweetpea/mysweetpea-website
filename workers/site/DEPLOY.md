# MySweetPea — Deploy Notes

## Deploy ritual (CURRENT — content-hash versioning via deploy.py)

The manual ?v= sweep is RETIRED. From `workers/site/`:

```bash
python deploy.py        # bake + hash-version every pin + regenerate sw.js + gates
# gates: node --check all JS, control-byte scan, JSON parse, CSP drift reminder
# then: git add/commit/push + npx wrangler deploy (both still manual)
```

How it works:
- Every `PATH?v=N` pin in every HTML page is rewritten to `PATH?v=h<sha256-8>`
  of the file's current bytes. Identical content = identical URL = warm caches;
  different content = new URL everywhere simultaneously. Mixed-version drift
  (the fonts.css v107/v108 class of bug) is structurally impossible.
- `assets/site-data.json` is BAKED into `assets/js/site-data.js` between the
  `__MSP_BAKED_START__/__MSP_BAKED_END__` markers (validated fallback so a
  failed/corrupted fetch can never blank the site) and `BAKED_HASH` is stamped.
- `sw.js`: `CACHE = 'mysweetpea-<hash-of-hashes>'` and the CORE precache
  entries carry the SAME ?v= URLs the HTML requests.
- `python deploy.py --check` = read-only drift report.

Data-driven editing (what to change and where):
- Service catalog / coming-soon / suggest categories / pricing featured
  order: edit `assets/site-data.json` (the single source of truth) then run
  `python deploy.py`. Pages reconcile at runtime (adopt-by-name, never
  duplicate; retired items hidden). Static HTML stays the SEO/no-JS skeleton.
- Monitor IDs: NO LONGER HARDCODED anywhere. `site-data.js` resolves
  Kuma monitor IDs at runtime by name from the public status API
  (7-day localStorage cache `msp.monitors.v1`; baked extraction-time hints
  as last resort). Renumbering a monitor in Kuma self-heals within a visit.
- Editing inline JS in any HTML file still requires `python rebuild_csp.py`.

## Cache-busting (LEGACY — kept for history)

## Cache-busting (IMPORTANT)

The site uses a service worker (`sw.js`) that caches assets aggressively for
offline support. **Every time you change CSS or JS, you MUST bump the version
in two places** or returning users will see stale content:

1. **Asset query strings** — in every `.html` file, bump `?v=N`:
   - `/assets/css/site.css?v=N`
   - `/assets/css/fonts.css?v=N`
   - `/assets/js/site.js?v=N`
   - `/assets/js/qrcode.min.js?v=N`

2. **Service worker cache name** — in `sw.js`, bump `mysweetpea-vN`:
   ```js
   const CACHE = 'mysweetpea-vN';
   ```

Both must be bumped together. The SW `activate` handler deletes old caches,
so bumping the name forces a clean refresh.

### Quick way to bump (from `workers/site/`)

```bash
# Replace all ?v=N with ?v=N+1 across HTML files
find . -name '*.html' -exec sed -i 's/?v=[0-9]*/?v=3/g' {} +
# Then update sw.js cache name to match
sed -i "s/mysweetpea-v[0-9]*/mysweetpea-v3/" sw.js
```

## Deploy

The site auto-deploys via Cloudflare Workers Git integration on every push to
`main`. No manual step needed.

## Backend integration

These live features are wired to real backends:

| Feature | Endpoint | Status |
|---------|----------|--------|
| Live status pill (home) | `https://status.mysweetpea.cc/api/status-page/heartbeat/public` | Live (Uptime Kuma) |
| Notify-me buttons (services) | `https://subscribe.mysweetpea.cc/webhook/suggest` | Live (n8n) |
| Invite-code check (redeem) | `https://subscribe.mysweetpea.cc/webhook/check-code` | Live (n8n) |
| Incidents (status) | `https://subscribe.mysweetpea.cc/webhook/incidents` | Live (n8n + Telegram `/incident`) |
| Donation requests (form) | `https://subscribe.mysweetpea.cc/webhook/donation-request` | Live (n8n) |
| Sweet Pea requests (form) | `https://subscribe.mysweetpea.cc/webhook/sweetpea-request` | Live (n8n) |
| Changelog commits | `/api/commits` (worker proxy) | Live (GitHub API, 5-min cache) |

All endpoints fail gracefully (status shows "All systems operational",
buttons flip to "We'll let you know", code check keeps default hint).

## Service URLs

The services page advertises these as LIVE and they resolve through the
Cloudflare tunnel to the cluster:
- `cloud.mysweetpea.cc` (Nextcloud)
- `photos.mysweetpea.cc` (Immich)
- `chat.mysweetpea.cc` (Open WebUI)
