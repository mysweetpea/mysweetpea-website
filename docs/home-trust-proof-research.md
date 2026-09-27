# Home Page — TRUST/PROOF & Content Strategy: Research Findings

**Date:** Sep 21, 2026 · **Scope:** `workers/site/index.html` (live tree) · **Method:** live-page inventory + repo audit + live Uptime-Kuma payload verification + external CRO/trust-signal research. Every factual claim below was measured, not assumed.

---

## 1. What the live home page actually says (measured)

26,781 bytes of markup → **265 visible words**, 3 content sections + footer:

| # | Section | Content | Trust work it does |
|---|---------|---------|--------------------|
| 1 | Hero (`h1` "MySweetPea / Your Private Garden") | One-line pitch + "Request an Invitation" + "See Available Services" + **live status chip** ("Checking service status…" → "All systems operational" via `site.js`) | Tier 1 visual professionalism; the status chip is the page's only *live* proof element |
| 2 | "How access works" (3 numbered steps) | Choose a tier → Submit request → Receive invite code. Stats strip: "0 Public services · 0% Uptime target · 0 Ads · trackers · subscriptions" | Explains process; **the stats strip is copy, not data** |
| 2b | "Why MySweetPea?" values deck (pos. 3, icon-disclosure) | 6 values: Privacy First / Open Source / Self-Hosted / Crypto Donations / Community-Funded / Community Driven | Beliefs, not proof — nothing verifiable |
| 3 | "Ready to Join?" CTA | "A **$5 minimum** community contribution helps protect capacity…" | Cost stated before ask ✓ (trust-ladder compliant) but **contradicts pricing.html** (see §5) |

**Structural gap (matches the skill's prior measurement):** zero of the 9 services are shown, zero screenshots, zero uptime numbers, zero artifacts. The page asserts values ("Open Source", "Self-Hosted") that other pages on the same site *prove* — the home page never links proof to claim.

---

## 2. The proof inventory (what already exists and is verifiable)

The site's unusual constraint (from locked project rules): **invite-only, single operator, no testimonials possible — never fabricate social proof.** The honest substitutes are verifiable artifacts. Verified live on 2026-09-21 from `status.mysweetpea.cc/api/status-page/heartbeat/public` (browser-UA curl, per the BFM/pitfall rule):

| Artifact | Live value today | Source of truth | Already rendered on |
|---|---|---|---|
| **Uptime, 24h window, all 9 monitors** | 7× 100% · KoalaSync 99.93% · Jellyfin 99.51% · avg **99.94%** | `uptimeList` in Kuma public payload | status.html rows; about.html "99.9% / last 24h" (via `about-page.js`) |
| **Real-time heartbeats** | 10 monitors × 1-min beats, all status=1 | `heartbeatList` (100-beat ring ≈ 1.6h tail) | Home status chip (aggregate only); status.html rows |
| **Operational count** | **9 of 9 operational** | Kuma payload, monitors 1–9 | status.html summary |
| **Service count / catalogue** | 9 Sweet Pea services + 6 Seedling "coming soon" | services.html | services.html only — **not on home** |
| **Real screenshots** | 9 `assets/screenshots/*.webp` exist | repo | services.html only — **not on home** (user-set: home services panel is ICONS ONLY) |
| **Public repos** | "2 Public repositories" + per-service GitHub links | github.com/mysweetpea | about.html; footer link |
| **Incident honesty** | Aug 3 2026 ArgoCD incident, post-mortem visible, "Resolved" | status.html incidents | status.html only |
| **Operator story** | Founded 2024, one laptop → 9 services; nightly on+off-site backups; 3 a.m. paging; "tended daily" | about.html | about.html only |

**Key asymmetry:** about.html and status.html are already *evidence pages* — 576 and 272 words of verifiable claims with a live payload behind them. The home page (265 words) is an *assertion page*. The trust deficit is not a content-creation problem; it is a **surfacing problem**.

---

## 3. External research: what actually builds trust (and what's noise)

Synthesized from current CRO/trust-signal literature (homepageauditor.com hierarchy; websentry.dev evidence-ranking; Baymard-cited friction data):

**Ranked signal tiers (time-to-effect):**
1. **Tier 1 — Visual professionalism (0–0.5s):** consistent brand, clean layout, fast load. *The site already has this; the premium redesign is done.*
2. **Tier 2 — Quantified proof (0.5–2s):** specific numbers beat vague superlatives; "9 of 9 operational · 99.9% / 24h" is exactly the specific-number pattern that outperforms. Round numbers read inflated; **sourced numbers read true** — showing "live from status.mysweetpea.cc" is itself the signal.
3. **Tier 3 — Qualitative proof (2–5s):** outcome-specific testimonials. **Not available and must not be fabricated** (locked rule) — the substitute is the operator story + artifacts.
4. **Tier 4 — Authority (3–10s):** for this audience the authority markers are **open-source repos, open post-mortems, and self-hosted stack transparency** — all already owned.

**Signals that are noise (avoid):** generic "100% Secure"-style badges; auto-rotating testimonial sliders; "as seen in" logos with no link; pop-up activity notifications ("Sarah from Boston just…"); badge clutter (five badges read as one, ten read as desperation).

**Highest-leverage findings for THIS site specifically:**
- **Verifiability beats volume.** Self-hosted testimonials convert worse than third-party reviews *because users assume cherry-picking* — the honest equivalent is a **link to the raw, live source** (status page, GitHub). A number that links to its own evidence is the strongest single trust element available here.
- **Proximity to the ask matters.** Trust marks convert at the moment of decision; the same mark elsewhere does nothing. Proof belongs **adjacent to "Request an Invitation"**, not in a distant section.
- **Technical hygiene is an invisible trust layer:** HTTPS everywhere, no mixed content, password-manager-friendly forms, sub-2.5s LCP. The CSP/headers posture is already strong (hash-based CSP, HSTS via CF); the home page loads fast — this box is ticked.
- **"A real face / a named human"** outperforms anonymous copy. The operator story (one person, founded 2024, 3 a.m. paging) is the site's Tier-3 substitute for testimonials and is currently buried on about.html.
- **Include the imperfection.** Perfect ratings read as fake; one visible resolved incident (the Aug 3 post-mortem) *raises* trust. The site already does this on status.html — home should not hide it.

## 3b. Copy strategy findings

- **The home page's claims are already answerable — they're just unproven on-page.** "Open Source" (value card) → could link the 2 public repos; "Self-Hosted" → could link the status page's hardware/monitor detail; "Community-Funded" → pricing.html. Each value card is a claim lacking its evidence link.
- **Stats strip is a wasted slot:** "0 Public services · 0% Uptime target · 0 Ads/trackers/subscriptions" — two of three cells are jokes ("0 ads"), one is a target not a fact. The live payload supports replacing the middle cell with real uptime, and "0 ads" belongs as a supporting line under a *real* number, not as a stat.
- **Differentiation copy exists but is stranded on about.html:** "kept like a garden", "tended daily, answerable to no advertiser, algorithm or acquisition", "It stays small on purpose." This is the voice that differentiates; home currently speaks generic SaaS ("Private alternatives to the services you use every day").
- **Cost clarity:** the trust-ladder principle (capability and cost before the ask) is already satisfied by the "Ready to Join?" copy; the $5/pricing-on-request conflict (§5) is the only honesty defect.

---

## 4. Recommendations (additive only — locked rule: no restructures)

All recommendations respect the user-set constraints: section list/order is his; services panel stays icons-only; the live-inventory section was deleted as filler; large rebuilds are HIGH RISK post-revert. Everything below is a scoped, individually-declinable change:

1. **Make the hero status chip a proof anchor.** It already says "All systems operational" — extend it with the sourced number: "9/9 operational · 99.9% / 24h ↗" linking to `/status.html`. One line of JS in `site.js` (data already fetched); the chip is above the fold, satisfying the "Tier 2 above the fold" finding.
2. **Replace the stats strip's middle cell with live data.** "99.9% uptime (24h)" rendered from `uptimeList`, with the honesty rule from `about-page.js`: keep a server-rendered fallback, and if live data is unreachable, say so — never fake liveness.
3. **Link each value card to its evidence.** "Open Source" → GitHub repos; "Self-Hosted" → status page; "Community-Funded" → pricing. Turns six assertions into six verifiable claims at zero layout cost. (Respects icons-only: links are copy-level, not new media.)
4. **Surface the operator + incident honesty near the CTA.** One line under "Ready to Join?": run by one person since 2024, nightly backups, and one public post-mortem when things broke — the "real face" + "include the imperfection" findings, delivered as copy, not a new section.
5. **Fix the $5 inconsistency** (§5) before any trust work: a price contradiction between home and pricing is a *fabricated-looking* signal, the exact opposite of proof.
6. **Do NOT add:** testimonials (locked rule — none exist to quote), user counts (invite-only; small numbers would read as failure), security badges (noise), activity notifications (noise), a services screenshot grid on home (user-set icons-only).

**Priority order:** 5 → 1 → 2 → 3 → 4. Each is one scoped diff, previewable in the site-preview lane, reversible via git/wrangler rollback.

---

## 5. Defects & discrepancies found during research

1. **Price contradiction (copy-level, pre-existing):** home "Ready to Join?" says "**$5 minimum** community contribution"; `pricing.html` says "**Pricing on request**" and "one-time donation — amount announced at launch" (Seedling). Locked rule says pricing stays non-specific until the crypto wallet exists, and home must **agree with pricing.html** — home is currently the outlier. Fix is copy alignment toward pricing.html's "amount confirmed when we reply" phrasing, not a number.
2. **`uptimeList` window is 24d-labeled but actually 24h data** (keys `"<id>_24"`; Kuma semantics) — cosmetic, but if home ever prints a window label, verify against Kuma's actual window meaning before labelling it "24h" vs "30 days". status.html's "UPTIME WINDOW 30 DAYS" label does not match the payload's available window (payload exposes only the `_24` duration).
3. **Heartbeat payload only exposes the last 100 beats (~1.6h)** per monitor from the public endpoint — fine for "operational now" chips, insufficient for any home-page uptime history claim; longer windows must come from `uptimeList`, not heartbeat averaging.
4. **BFM blocks bare curl** on both domains (403) — all live-data probes must send a browser UA (known pitfall, re-confirmed today).

## 6. Claim → source table (per locked rule: every claim maps to a source)

| Claim (proposed for home) | Source |
|---|---|
| "9 of 9 services operational" | Kuma `heartbeatList`, monitors 1–9, verified 2026-09-21 |
| "99.9% uptime (24h)" | Kuma `uptimeList` avg = 99.94% across monitors 1–9, verified 2026-09-21 |
| Service names/count (9 Sweet Pea + 6 Seedling) | `services.html` |
| Price positioning | `pricing.html` ("pricing on request" — home must agree) |
| Trust statements (backups, founded 2024, one operator, post-mortem) | `about.html`, `status.html` |
| "No ads / no tracking / no subscriptions" | `index.html` hero + all pages (consistent) |
| "2 public repositories" | `about.html` → github.com/mysweetpea |
