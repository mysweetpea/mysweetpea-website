# Home Page — MOTION/ANIMATION Systems: Research Findings

**Date:** Sep 21, 2026 · **Scope:** `workers/site/index.html` (live tree) · **Method:** repo audit (measured CSP header, existing JS assets, budgets) + library docs/bundles fetched live and grepped (`eval`/`new Function` count = measured) + browser-compat data verified against the skill's BCD-audited table. Sizes below are real downloads, not marketing numbers.

---

## 1. The constraints any system must satisfy (measured from this repo)

| Constraint | Actual value today | Consequence |
|---|---|---|
| CSP `script-src` | `'self'` + 13 `sha256-…` inline hashes; **no `unsafe-inline`, no `unsafe-eval`, no CDN origins** (`_headers` line 24, 1005 chars) | New JS must be a **self-hosted external file** under `assets/js/` (free under `'self'`). Any *inline* JS edit forces a `bake_html.py --check` rehash of the whole header |
| Build system | **None** — 14 static HTML pages, vendored IIFE scripts (`lenis.min.js` 17.7 KB is the precedent) | No npm/bundler pipeline to hide a library behind; whatever we add is a vendored file + `<script defer>` |
| Lenis | **Already shipped**: 1.3.23 vendored, `lerp: 0.09`, `autoRaf`, gated OFF on touch AND `prefers-reduced-motion` | Any animation system must coexist with Lenis's rAF loop — or better, need **zero wiring** because of native scroll (see §2) |
| Page-JS budget for motion | **≤3 KB raw (~1 KB gzip) in ONE deferred external file** (skill rule) | IO-reveal + count-up already fit; a big library must justify breaking this budget explicitly |
| Site `connect-src` | `'self'` + subscribe/status hosts only | Rules out any library phoning home (none below do) |

The governing question is therefore not "which library is best" but **which tier of dependency, if any, the home page actually needs**.

---

## 2. The decisive Lenis fact: it runs on NATIVE scroll

Lenis's README (darkroomengineering/lenis, verified 2026-09): *"Runs on native scroll — wraps the browser's own scroll, so `position: sticky`, anchor links, and accessibility keep working."* Measured on our own site: **~108 native `scroll` events fire during one wheel gesture** under Lenis.

This splits all candidate systems into two classes:

- **Class A — zero-wiring:** anything that reads `scrollY` / `getBoundingClientRect()` / native `scroll` events / IntersectionObserver / CSS `animation-timeline: scroll()`. All of these work unchanged under Lenis because the window really does scroll. **Our existing IO reveals already prove this in production.**
- **Class B — frame-sync wiring:** anything that wants to update on Lenis's animation frames (GSAP ScrollTrigger's "perfect sync" recipe). Optional for Class A reasons, and a known footgun (§5).

**Contrast:** transform-wrapper smoothers (Locomotive, GSAP ScrollSmoother) hijack layout and break Class A — one reason Lenis was the right pick and why swapping it out later would be costly.

---

## 3. Candidate systems — verified findings

### 3.1 Pure CSS (keyframes / transitions / `@keyframes` + class hooks) — **status quo, still winning**

- Cost: **0 KB JS**, no CSP interaction, no library risk.
- Already carries: card hovers (`cubic-bezier(0.05,0.7,0.1,1)`, 150–250ms, `@media (hover:hover)`), petals/portal/ascii-ripple ambience (reduced-motion gated), logo bloom (SVG/CSS, chosen over Lottie).
- Ceiling: no scroll-*linked* values, no sequencing, no springs in CSS (spring timing functions exist in Chrome only). For storytelling-style hero choreography it gets verbose, not impossible.

### 3.2 CSS scroll-driven animations (`animation-timeline: scroll()` / `view()`)

- Support (verified against BCD + Safari 26 notes, skill table): **Chrome 115+, Safari 26.0+, Firefox preview-only — still NOT Baseline.**
- **Compatible with Lenis at zero wiring cost** (Class A — it tracks the real scroller). This is the sleeper argument for it *here specifically*.
- Site rule already established: decoration only (e.g. timeline-rail fill), behind `@supports (animation-timeline: scroll())` with a static fallback; **IntersectionObserver stays primary for content reveals** because it degrades to "visible" everywhere.
- `@property` (registered custom props for count-ups) IS universal (Chrome 85+, Safari 16.4+, FF 128+) — but the skill already mandates IO + rAF count-ups with server-rendered final values, so no change.

### 3.3 Motion (motion.dev, ex-Framer Motion) — best *library* fit if one is wanted

- License MIT; vanilla-JS first-class (React not required).
- Module sizes (from docs): mini `animate()` **2.3 KB**, `inView` **0.5 KB**, `scroll()` **5.1 KB**. Full UMD global `motion.js` measured here: **146,962 raw / 48,942 gzip** — do NOT ship the UMD bundle; ship a tree-shaken ESM→IIFE subset.
- Distribution: docs offer a jsdelivr `<script>` — **our CSP forbids that origin**, so it must be vendored like Lenis (same pattern, no header change, `'self'` covers it). The legacy-global build sets `window.Motion` (verified in the downloaded bundle header).
- CSP safety: **measured 0 occurrences of `eval(`/`new Function`** in the full UMD bundle → strict-CSP clean.
- Lenis interplay: `scroll()` uses the **ScrollTimeline API where available → hardware-accelerated and inherently in sync with Lenis** (Class A); where unsupported it falls back to scroll listeners, which we know fire fine under Lenis. `inView` is IO-based (Class A). **No wiring, no ticker conflict.** Bonus: if `scroll()` is used on a Chromium/Safari-26 audience it costs ~0 main-thread work.
- `prefers-reduced-motion`: no global toggle — must be gated per-call like our other motion (our init pattern already does this).

### 3.4 GSAP 3 + ScrollTrigger — the heavyweight, now free

- **Now 100% free for all users incl. bonus plugins** (SplitText, ScrollSmoother, etc.) since the Webflow acquisition — the old "bonus plugins cost money" objection is gone. Standard license, MIT-adjacent GSAP terms.
- Cost measured here: `gsap.min.js` **72,435 raw / 28,153 gz** + `ScrollTrigger.min.js` **44,157 / 17,849** = **~46 KB gzip** — ~45× the entire motion-JS budget, for a page whose reference sites (incl. Hermes itself) show **no heavy per-section parallax**.
- CSP safety: **measured 0 `eval`/`new Function`** → works under strict CSP once vendored (this is a common question; verified, not assumed).
- Lenis: officially documented pairing. Canonical recipe (Lenis README):
  ```js
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => { lenis.raf(time * 1000); });
  gsap.ticker.lagSmoothing(0);
  ```
  **Footgun (documented GSAP-forum bug):** this recipe must **replace**, not accompany, any standalone `requestAnimationFrame` loop calling `lenis.raf()` — double-driving flips scroll direction every frame. Our `lenis-init.js` uses `autoRaf`, so adopting the ticker recipe means disabling that first. Conversely, *because* Lenis is native-scroll, ScrollTrigger largely works with **no** wiring at all (`ScrollTrigger.update` on the native scroll event is enough for non-pinned triggers) — the ticker sync buys frame-perfect pinned/scrubbed scenes only.
- Verdict: only justified if the redesign commits to true scroll storytelling (pinned scenes, scrubbed SVG paths, SplitText reveals). Nothing in the decoded references asks for that.

### 3.5 Cross-document View Transitions (MPA page morphs) — cheap, progressive, on-brand

- Support: **Chrome/Edge 126+, Safari 18.2+ (macOS+iOS); Firefox NOT yet** (caniuse + Chrome docs). Same-origin only, opt-in via CSS `@view-transition { navigation: auto; }`.
- For 14 static pages this gives animated home→services→about navigation with **zero library** — pure CSS + tiny `pageswap`/`pagereveal` hooks for directional types if wanted (which would live in the existing external file; no rehash).
- CSP-neutral (no script execution involved in the base form). **Firefox users get plain navigation** — genuinely progressive, nothing to polyfill. Gate animations under `prefers-reduced-motion` (the transition respects `@media` in its pseudo-element styles).
- Best single upgrade-per-byte in this list: a few hundred bytes of CSS.

### 3.6 Lottie / DotLottie — **already rejected**

The user explicitly chose dependency-free SVG/CSS over a Lottie runtime for the logo bloom (2026-09 decision, skill record). Runtime is ~50–70 KB and canvas-based; nothing new reverses that trade.

---

## 4. Decision matrix

| System | JS cost (raw/gz) | CSP friction | Lenis wiring | Support risk | Fit for this home page |
|---|---|---|---|---|---|
| CSS transitions/keyframes (current) | 0 | none | none | none | **Baseline tier — keep as default** |
| `animation-timeline` (decoration) | 0 | none | **none (native scroll)** | FF missing → `@supports` fallback | Rail fills, hero parallax accent |
| Cross-document View Transitions | ~0 (CSS) | none | none (inter-page, not scroll) | FF missing → plain nav fallback | **Recommended addition** |
| Motion mini (`animate`+`inView`+`scroll`) | ~8 KB / ~3 gz vendored | none (external, `'self'`) | none (ScrollTimeline/IO/native) | low | If JS-choreographed hero/stagger wanted |
| GSAP + ScrollTrigger | ~117 KB / ~46 gz vendored | none (external, `'self'`) | optional; **ticker recipe conflicts with `autoRaf`** | none (mature) | Only for pinned/scrubbed storytelling — not asked for |
| Lottie | ~50–70 KB | none | n/a | n/a | Rejected by user decision |

---

## 5. Cross-cutting rules (apply to whichever tier is chosen)

1. **One rAF owner.** Lenis currently self-drives (`autoRaf`). Any future ticker-based lib must take over `lenis.raf()` exclusively or leave `autoRaf` alone — never both (measured symptom: scroll direction flip-flopping every frame).
2. **Vendored externals only**, never CDN (CSP has no third-party script origins) and never new inline JS (rehash tax on a 1005-char header already near budget).
3. **Gate everything** on `prefers-reduced-motion` AND touch (`(hover: none), (pointer: coarse)`) — matches the live `lenis-init.js` pattern and the site's a11y record.
4. **Content reveals stay IO-first**; scroll-timeline CSS is decoration-only behind `@supports`. This remains correct in 2026-26 (Firefox still preview).
5. **Verify motion, don't eyeball**: sample `getComputedStyle` in a rAF loop expecting a ramp; `scrollWidth <= innerWidth` at 360–1440 for any new overlay layer; wheel-event (not `scrollTo`) probes for anything scroll-linked.

---

## 6. Recommendation

**Tiered adoption, no new heavyweight dependency:**

1. **Now (0 KB):** keep CSS-transition tier; add `@supports`-gated scroll-timeline decoration where the redesign wants parallax accents.
2. **Best value add:** cross-document View Transitions CSS for page-to-page morphs — progressive, Firefox-safe, CSP-free.
3. **If the hero needs choreography** (staggered intro, spring): vendor **Motion mini** (~3 KB gz) as one external file — hybrid ScrollTimeline engine is a uniquely good Lenis match.
4. **GSAP only if** a future concept explicitly requires pinned/scrubbed scroll scenes; it's free and CSP-clean now, but ~46 KB gz and an `autoRaf` conflict to manage. The decoded reference sites (incl. Hermes) achieve their feel with Lenis + sticky, not ScrollTrigger.

## Sources

- Lenis README (integrations, settings, `respectReducedMotion`, GSAP recipe): github.com/darkroomengineering/lenis (fetched 2026-09-21)
- Motion docs — quick-start (script-tag/global build), `scroll()` (ScrollTimeline hybrid engine, 5.1 KB), `inView` (0.5 KB): motion.dev
- GSAP pricing ("100% free for all users", Webflow): gsap.com/pricing
- GSAP forum topic 39286 (ScrollTrigger×Lenis double-rAF direction flip, solved by akapowl): gsap.com/community
- Chrome for Developers — cross-document view transitions (same-origin, opt-in, types): developer.chrome.com
- caniuse cross-document-view-transitions; browser-compat-data audit table in skill `site-motion-and-animation.md`
- Local measurements: `_headers` (CSP line), `assets/js/*` sizes, `lenis-init.js` config, downloaded bundles (`motion.js`, `gsap.min.js`, `ScrollTrigger.min.js`) — sizes and `eval` grep run 2026-09-21
