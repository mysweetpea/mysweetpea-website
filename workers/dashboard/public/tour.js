/* MySweetPea dashboard — first-run guided tour.
 *
 * Self-contained: injects its own CSS, no dependencies, no build step.
 * Drives the EXISTING UI rather than reimplementing it:
 *   - window.setTab()                          to move between sections
 *   - #nav-toggle / .dh-open / body.dh-lock    for the mobile drawer
 *   - #acct-trigger / #acct-pop                for the account menu
 *
 * Motion technique (the same one driver.js uses — it is the reference for how
 * a tour should feel):
 *   1. The dim is ONE svg <path> with fill-rule:evenodd — a full-screen rect
 *      plus a rounded cutout. A single layer, so the dim can never double up
 *      or flicker the way two overlapping spotlights would.
 *   2. The cutout is tweened by requestAnimationFrame with easeInOutQuad, NOT
 *      a CSS transition. Transitions on geometry retrigger mid-flight and
 *      stretch the box into odd shapes; an elapsed-time tween is stable and
 *      eases properly at both ends.
 *   3. The card animates via the Web Animations API (native, no class juggling,
 *      no transition-retrigger bugs).
 *   4. We wait for the target to STOP MOVING before tweening, so the cutout
 *      never chases a layout that is still settling.
 *
 * ponytail: still no library — driver.js is ~40KB for what is ~130 lines here,
 * and it ships a design language we would fight. Revisit only if this ever
 * needs collision-aware popover placement or arrows.
 */
(function () {
  'use strict';
  if (window.mspTour) return; // idempotent

  var KEY = 'msp_tour_v1';
  var MOBILE_MQ = '(max-width: 768px)';
  var TWEEN_MS = 380;   // cutout travel
  var PAD = 8;          // cutout padding around the target
  var RADIUS = 14;      // cutout corner radius
  var TAB_SETTLE = 380; // setTab runs an entrance cascade; let it start first

  /* ── copy ─────────────────────────────────────────────────────────────
   * Written for non-technical users. This is the ONLY place the words live.
   * Edit here and nothing else needs to change.
   */
  var MOBILE_STEPS = [
    { center: true,
      title: 'Welcome to MySweetPea',
      body: 'This is your dashboard — the home base for everything you have access to. Give me a minute and I will show you around.' },

    { target: '#nav-toggle', doIt: true, nextLabel: 'I tapped it',
      title: 'This button is how you get around',
      body: 'Tap it and your whole menu opens up. You will use this one a lot.' },

    { target: '.dh-panel', drawer: true,
      title: 'Everything lives in this menu',
      body: 'Home, Media, Services, Stats, Guides and Contact. Tap any one to jump straight there.' },

    { target: '.dh-chips', drawer: true,
      title: 'Your account and shortcuts',
      body: 'Your invite link for friends, plus quick ways to ask for help or report something broken.' },

    { target: '#hm-hero', drawer: false, tab: 'home',
      title: 'This is Home',
      body: 'Your services, what is new, and what you have been watching — all in one place.' },

    { target: '#hm-services-sec',
      title: 'Your services',
      body: 'Tap any card to open that service. Think of this as your shortcut shelf.' },

    { tab: 'media',
      title: 'Media — where you watch',
      body: 'Everything you can watch lives here. Let me show you how it works.' },

    { target: '#sec-pin',
      title: 'Your PIN, ready to copy',
      body: 'This card hands you two things: your Moonfin PIN and your server address. Copy PIN and Copy address put them on your clipboard \u2014 paste them into Moonfin, never type them. There is a 30-second walkthrough right below if you want to watch it done.' },

    { target: '#sec-media-m',
      title: 'Browse or search',
      body: 'Everything you can watch, in rows — new arrivals, top rated, and by genre. Tap any poster to start watching.' },

    { tab: 'services',
      title: 'Services — your shortcuts',
      body: 'Every service you have access to, all in one place.' },

    { target: '#sv-orbs',
      title: 'Check before you click',
      body: 'These show whether each service is running. Green means go.' },

    { target: '.sv-guide-cta',
      title: 'Every service has a setup guide',
      body: 'See this on a service card? It takes you straight to step-by-step instructions for that service — what to install, how to sign in, and what to do first.' },

    { target: '.sv-foot-note',
      title: 'Missing something? Ask for it',
      body: 'If a service you want is not listed, suggest it right here. Members can request services and a human reviews every one.' },

    { tab: 'guides',
      title: 'Guides — your help desk',
      body: 'This is the one to remember. If you are ever stuck on a service, the answer is almost always here.' },

    { target: '#guide-nav',
      title: 'Pick a service',
      body: 'Choose any service here and the guide beside it updates to match.' },

    { target: '.gp-key',
      title: 'Some are still being built',
      body: 'A gold Soon tag means that service is not open to everyone yet. The steps are written down early, so nothing is a surprise when it goes live.' },

    { target: '.svc-guide-step',
      title: 'Follow the steps, use the buttons',
      body: 'Every guide is numbered steps in plain language. Where a step needs an action, the button sits right there — open the app, copy a server address, download the app.' },

    { target: '.gp-picker',
      title: 'Tell it where you will use it',
      body: 'Most guides ask this first. Pick your device — phone, tablet, web, TV — and the steps below change to match exactly what you need to do.' },

    { tab: 'stats',
      title: 'Stats — how things are doing',
      body: 'A live look at your services and what you have been watching. Titles are listed by show or film, never the single episode.' },

    { tab: 'contact',
      title: 'Contact — talk to us',
      body: 'Stuck, or something broken? Send us a message here and we will get back to you.' },

    { tab: 'home', center: true,
      title: 'You are all set',
      body: 'That is the whole dashboard. Replay this whenever you like — tap the ? at the top of the screen.' },
  ];

  var DESKTOP_STEPS = [
    { center: true,
      title: 'Welcome to MySweetPea',
      body: 'This is your dashboard — the home base for everything you have access to. Give me a minute and I will show you around.' },

    { target: '#tabs',
      title: 'Your sections',
      body: 'Home, Media, Services, Stats, Guides and Contact. Click any one to jump straight there.' },

    { target: '#hm-hero', tab: 'home',
      title: 'This is Home',
      body: 'Your services, what is new, and what you have been watching — all in one place.' },

    { target: '#hm-services-sec',
      title: 'Your services',
      body: 'Click any card to open that service. Think of this as your shortcut shelf.' },

    { tab: 'media',
      title: 'Media — where you watch',
      body: 'Everything you can watch lives here. Let me show you how it works.' },

    { target: '#sec-pin',
      title: 'Your PIN, ready to copy',
      body: 'This card hands you two things: your Moonfin PIN and your server address. Copy PIN and Copy address put them on your clipboard \u2014 paste them into Moonfin, never type them. There is a 30-second walkthrough right below if you want to watch it done.' },

    { target: '#sec-media-m',
      title: 'Browse or search',
      body: 'Everything you can watch, in rows — new arrivals, top rated, and by genre. Click any poster to start watching.' },

    { tab: 'services',
      title: 'Services — your shortcuts',
      body: 'Every service you have access to, all in one place.' },

    { target: '#sv-orbs',
      title: 'Check before you click',
      body: 'These show whether each service is running. Green means go.' },

    { target: '.sv-guide-cta',
      title: 'Every service has a setup guide',
      body: 'See this on a service card? It takes you straight to step-by-step instructions for that service — what to install, how to sign in, and what to do first.' },

    { target: '.sv-foot-note',
      title: 'Missing something? Ask for it',
      body: 'If a service you want is not listed, suggest it right here. Members can request services and a human reviews every one.' },

    { tab: 'guides',
      title: 'Guides — your help desk',
      body: 'This is the one to remember. If you are ever stuck on a service, the answer is almost always here.' },

    { target: '#guide-nav',
      title: 'Pick a service',
      body: 'Choose any service here and the guide beside it updates to match.' },

    { target: '.gp-key',
      title: 'Some are still being built',
      body: 'A gold Soon tag means that service is not open to everyone yet. The steps are written down early, so nothing is a surprise when it goes live.' },

    { target: '.svc-guide-step',
      title: 'Follow the steps, use the buttons',
      body: 'Every guide is numbered steps in plain language. Where a step needs an action, the button sits right there — open the app, copy a server address, download the app.' },

    { target: '.gp-picker',
      title: 'Tell it where you will use it',
      body: 'Most guides ask this first. Pick your device — phone, tablet, web, TV — and the steps below change to match exactly what you need to do.' },

    { tab: 'stats',
      title: 'Stats — how things are doing',
      body: 'A live look at your services and what you have been watching. Titles are listed by show or film, never the single episode.' },

    { tab: 'contact',
      title: 'Contact — talk to us',
      body: 'Stuck, or something broken? Send us a message here and we will get back to you.' },

    { target: '#acct-trigger', openAcct: true, tab: 'home',
      title: 'Your account',
      body: 'Password, sessions, your vault, and this tour again — it all lives behind your name up here.' },

    { closeAcct: true, center: true,
      title: 'You are all set',
      body: 'That is the whole dashboard. Replay this whenever you like — from your account menu, or the ? up top.' },
  ];

  /* ── state ─────────────────────────────────────────────────────────── */
  var steps = [], idx = 0;
  var root = null, svg = null, dim = null, block = null, card = null, toast = null;
  var toastFade = null;   // the in-flight fade-out, cancelled before a new toast
  var stage = null;   // {x,y,w,h} of the cutout right now
  var rafId = null;
  var escHandler = null, resizeHandler = null;
  var seq = 0;        // guards against a stale async step finishing late
  // Tab state is STICKY: a step without `tab` inherits the previous step's tab.
  // Without this, stepping BACKWARD from a tab-switching step left the app on
  // the wrong panel, so the next target was hidden and the tour looked broken.
  var curTab = 'home', appliedTab = null;

  function isMobile() { return window.matchMedia(MOBILE_MQ).matches; }
  function reduceMotion() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

  /* ── css ───────────────────────────────────────────────────────────── */
  function injectCss() {
    if (document.getElementById('msp-tour-css')) return;
    var s = document.createElement('style');
    s.id = 'msp-tour-css';
    s.textContent = [
      '.mst-root{position:fixed;inset:0;z-index:9999;pointer-events:none}',
      '.mst-root[hidden]{display:none}',
      '.mst-svg{position:absolute;inset:0;width:100%;height:100%;display:block}',
      '.mst-dim{fill:rgba(6,7,13,.78)}',
      '.mst-block{position:absolute;inset:0;pointer-events:auto;z-index:2}',
      '.mst-block[hidden]{display:none}',
      '.mst-card{position:absolute;z-index:3;pointer-events:auto;box-sizing:border-box;',
      '  max-width:352px;padding:18px 18px 14px;border-radius:16px;',
      '  background:linear-gradient(165deg,rgba(30,26,60,.985),rgba(13,14,26,.995));',
      '  border:1px solid rgba(151,146,255,.30);box-shadow:0 24px 64px rgba(0,0,0,.58);',
      '  color:#e8e6f5;font-size:.92rem;line-height:1.5;will-change:transform,opacity}',
      '.mst-card h3{margin:0 0 6px;font-size:1.02rem;font-weight:600;color:#fff;letter-spacing:.1px}',
      '.mst-card p{margin:0 0 14px;color:#b9b6d0}',
      '.mst-row{display:flex;align-items:center;gap:8px}',
      '.mst-count{font-size:.74rem;letter-spacing:.6px;text-transform:uppercase;color:#8f8bb0;margin-right:auto}',
      '.mst-btn{appearance:none;border:1px solid rgba(151,146,255,.32);background:rgba(151,146,255,.12);',
      '  color:#e8e6f5;border-radius:10px;padding:9px 14px;font:inherit;font-size:.86rem;',
      '  cursor:pointer;min-height:40px;transition:background .15s,border-color .15s}',
      '.mst-btn:hover{background:rgba(151,146,255,.2)}',
      '.mst-btn.primary{background:linear-gradient(135deg,#8b7ef6,#45d6c8);border-color:transparent;color:#08090f;font-weight:600}',
      '.mst-btn.primary:hover{filter:brightness(1.08)}',
      '.mst-btn.ghost{border-color:transparent;background:none;color:#8f8bb0;padding:9px 10px}',
      '.mst-btn.ghost:hover{color:#e8e6f5;background:rgba(151,146,255,.1)}',
      '.mst-skip{position:absolute;top:8px;right:10px;z-index:4;pointer-events:auto}',
      // tab-change indicator: the mobile tabs live in a closed drawer, so a
      // toast is the only thing that reads on both surfaces
      '.mst-toast{position:absolute;top:76px;left:50%;z-index:4;pointer-events:none;',
      '  padding:9px 18px;border-radius:999px;font-size:.83rem;font-weight:700;letter-spacing:.2px;',
      '  background:linear-gradient(135deg,rgba(139,126,246,.97),rgba(69,214,200,.92));color:#08090f;',
      '  box-shadow:0 12px 34px rgba(0,0,0,.5);white-space:nowrap}',
      '@media (max-width:768px){.mst-toast{top:76px;bottom:auto}}',
      // mobile: card becomes a bottom sheet — thumb reachable, no clamping math
      '@media (max-width:768px){',
      '  .mst-card{left:0!important;right:0;bottom:0;top:auto!important;max-width:none;',
      '    border-radius:18px 18px 0 0;padding:20px 20px calc(18px + env(safe-area-inset-bottom))}',
      '  .mst-skip{top:auto;bottom:calc(100% + 8px);right:14px}',
      '}',
    ].join('');
    document.head.appendChild(s);
  }

  /* ── dom ───────────────────────────────────────────────────────────── */
  function build() {
    if (root) return;
    injectCss();
    root = document.createElement('div');
    root.className = 'mst-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Dashboard tour');
    root.hidden = true;

    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'mst-svg');
    svg.setAttribute('aria-hidden', 'true');
    dim = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    dim.setAttribute('class', 'mst-dim');
    dim.setAttribute('fill-rule', 'evenodd');
    svg.appendChild(dim);

    block = document.createElement('div');
    block.className = 'mst-block';

    card = document.createElement('div');
    card.className = 'mst-card';

    toast = document.createElement('div');
    toast.className = 'mst-toast';
    toast.hidden = true;

    root.appendChild(svg);
    root.appendChild(block);
    root.appendChild(card);
    root.appendChild(toast);
    document.body.appendChild(root);
  }

  // "Switched to the X tab" pill. Shown whenever the tour changes tab so the
  // jump is unmistakable, then fades itself out.
  var toastTimer = null;
  function showToast(label) {
    if (!toast) return;
    clearTimeout(toastTimer);
    toast.textContent = label;
    toast.hidden = false;
    toast.style.transform = 'translateX(-50%)';
    if (!reduceMotion() && toast.animate) {
      toast.animate(
        [{ opacity: 0, transform: 'translateX(-50%) translateY(-8px)' },
         { opacity: 1, transform: 'translateX(-50%) translateY(0)' }],
        { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)' }
      );
    }
    toastTimer = setTimeout(function () {
      if (!toast.animate || reduceMotion()) { toast.hidden = true; return; }
      if (toastFade) { try { toastFade.cancel(); } catch (e) {} }
      var a = toastFade = toast.animate(
        [{ opacity: 1, transform: 'translateX(-50%) translateY(0)' },
         { opacity: 0, transform: 'translateX(-50%) translateY(-8px)' }],
        { duration: 260, easing: 'ease-in', fill: 'forwards' }
      );
      a.onfinish = function () { a.cancel(); toastFade = null; toast.hidden = true; toast.style.opacity = ''; };
    }, 1500);
  }

  /* ── geometry ──────────────────────────────────────────────────────── */
  function easeInOutQuad(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // full-screen rect + rounded cutout as ONE evenodd path (driver.js geometry).
  // ⚠️ Every number is finite-checked. If we ever emit `d="MNaN,…"` the SVG
  // becomes invalid and browsers KEEP THE PREVIOUS `d` — which is exactly how a
  // stale spotlight box survives into a step that should have none.
  function stagePath(s) {
    var W = window.innerWidth, H = window.innerHeight;
    var outer = 'M' + W + ',0L0,0L0,' + H + 'L' + W + ',' + H + 'L' + W + ',0Z';
    if (!s) return outer;
    var v = [s.x, s.y, s.w, s.h];
    for (var i = 0; i < 4; i++) if (!isFinite(v[i])) return outer;
    if (s.w <= 1 || s.h <= 1) return outer;
    var rad = Math.floor(Math.max(Math.min(RADIUS, s.w / 2, s.h / 2), 0));
    var bw = Math.max(s.w - rad * 2, 0);
    var bh = Math.max(s.h - rad * 2, 0);
    var bx = s.x + rad, by = s.y;
    return outer +
      'M' + bx + ',' + by + 'h' + bw +
      'a' + rad + ',' + rad + ' 0 0 1 ' + rad + ',' + rad +
      'v' + bh +
      'a' + rad + ',' + rad + ' 0 0 1 -' + rad + ',' + rad +
      'h-' + bw +
      'a' + rad + ',' + rad + ' 0 0 1 -' + rad + ',-' + rad +
      'v-' + bh +
      'a' + rad + ',' + rad + ' 0 0 1 ' + rad + ',-' + rad + 'z';
  }

  function paintStage(s) { dim.setAttribute('d', stagePath(s)); }

  // elapsed-time tween — this is what makes the movement read as smooth
  function tweenTo(to, dur) {
    cancelAnimationFrame(rafId);
    var from = stage;
    // A centred step has no target. Collapse the hole into its own centre
    // rather than interpolating toward `null` (which produced NaN and left the
    // old box on screen).
    if (!to) {
      to = from
        ? { x: from.x + from.w / 2, y: from.y + from.h / 2, w: 0, h: 0 }
        : null;
    }
    if (!from || !to || reduceMotion() || !dur) { stage = to; paintStage(stage); return; }
    var t0 = performance.now();
    rafId = requestAnimationFrame(function frame(now) {
      var t = Math.min((now - t0) / dur, 1);
      var k = easeInOutQuad(t);
      stage = {
        x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k),
        w: lerp(from.w, to.w, k), h: lerp(from.h, to.h, k),
      };
      paintStage(stage);
      if (t < 1) rafId = requestAnimationFrame(frame);
      else stage = to; // land exactly on the target
    });
  }

  function cutoutFor(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return null;
    return { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
  }

  // wait until the target stops moving before tweening to it
  function settle(el, cb, maxMs) {
    var last = null, stable = 0, t0 = performance.now();
    (function loop() {
      var r = el ? el.getBoundingClientRect() : null;
      var key = r
        ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',')
        : 'none';
      if (key === last) { if (++stable >= 2) return cb(); }
      else { stable = 0; last = key; }
      if (performance.now() - t0 > (maxMs || 1100)) return cb();
      requestAnimationFrame(loop);
    })();
  }

  /* ── drawer + account helpers (reuse existing UI) ──────────────────── */
  function setDrawer(open) {
    var d = document.getElementById('dh-menu');
    if (!d) return;
    d.classList.toggle('dh-open', !!open);
    // the tour owns the lock while it is visible — closing the drawer must not
    // re-enable page scroll underneath the overlay
    document.body.classList.toggle('dh-lock', !!open || (root && !root.hidden));
    var tg = document.getElementById('nav-toggle');
    if (tg) tg.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function setAcct(open) {
    var pop = document.getElementById('acct-pop'), trg = document.getElementById('acct-trigger');
    if (!pop || !trg) return;
    pop.hidden = !open;
    trg.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  /* ── card ──────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function animateCard() {
    if (reduceMotion() || !card.animate) return;
    card.animate(
      [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
      { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)' }
    );
  }

  function placeCard(el) {
    if (isMobile()) return; // bottom sheet positions itself
    var vw = window.innerWidth, vh = window.innerHeight, pad = 12;
    var cw = Math.min(352, vw - pad * 2);
    var ch = card.offsetHeight || 170;
    var left = vw / 2 - cw / 2, top = vh / 2 - ch / 2;

    if (el) {
      var r = el.getBoundingClientRect();
      if (r.width > 1 && r.height > 1) {
        left = r.left + r.width / 2 - cw / 2;
        top = r.bottom + 16;
        if (top + ch > vh - pad) top = r.top - ch - 16; // flip above
      }
    }
    card.style.left = Math.max(pad, Math.min(left, vw - cw - pad)) + 'px';
    card.style.top = Math.max(pad, Math.min(top, vh - ch - pad)) + 'px';
  }

  function renderCard() {
    var st = steps[idx];
    var last = idx === steps.length - 1, first = idx === 0;
    card.innerHTML =
      '<button type="button" class="mst-btn ghost mst-skip" data-tour="skip">Skip</button>' +
      '<h3>' + esc(st.title) + '</h3>' +
      '<p>' + esc(st.body) + '</p>' +
      '<div class="mst-row">' +
        '<span class="mst-count">' + (idx + 1) + ' of ' + steps.length + '</span>' +
        (first ? '' : '<button type="button" class="mst-btn" data-tour="back">Back</button>') +
        '<button type="button" class="mst-btn primary" data-tour="next">' +
          (last ? 'Done' : esc(st.nextLabel || 'Next')) +
        '</button>' +
      '</div>';
    animateCard();
  }

  /* ── step flow ─────────────────────────────────────────────────────── */
  // Scroll the target into view ONLY if it is not already there, and do it
  // INSTANTLY. driver.js does the same: smooth scrolling leaves the cutout
  // parked while the page glides, which reads as a lag after pressing Next.
  // The cutout's own tween is the motion the eye follows.
  function inView(el) {
    var r = el.getBoundingClientRect();
    return r.top >= 8 && r.bottom <= (window.innerHeight - 8);
  }
  function revealTarget(el) {
    if (!el || inView(el)) return;
    try { el.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (e) {}
  }

  var TAB_LABELS = {
    home: 'Home', media: 'Media', services: 'Services',
    stats: 'Stats', guides: 'Guides', contact: 'Contact',
  };

  function arrive(st, el, my) {
    if (my !== seq) return;
    tweenTo(cutoutFor(el), TWEEN_MS);
    placeCard(el);
    clearDoIt();
    if (st.doIt && el) {
      doItEl = el;
      doItHandler = function () { if (!root.hidden) next(); };
      el.addEventListener('click', doItHandler, { once: true });
    }
  }

  function paint() {
    var st = steps[idx];
    if (!st) return finish();
    clearDoIt();
    var my = ++seq; // any earlier async work is now stale

    // side effects first, so the layout we measure is the layout we keep
    if (st.drawer === true) setDrawer(true);
    else if (st.drawer === false) setDrawer(false);
    if (st.openAcct) setAcct(true);
    if (st.closeAcct) setAcct(false);
    block.hidden = !!st.doIt;

    var needsTab = false;
    if (st.tab) curTab = st.tab;
    if (curTab && curTab !== appliedTab && typeof window.setTab === 'function') {
      appliedTab = curTab;
      needsTab = true;
    }

    // The card text updates IMMEDIATELY either way — the user should never
    // press Next and see nothing happen.
    renderCard();

    if (!needsTab) {
      // FAST PATH: no panel change, so the cutout can move on the next frame.
      var el = st.target ? document.querySelector(st.target) : null;
      revealTarget(el);
      requestAnimationFrame(function () { arrive(st, el, my); });
      return;
    }

    // SLOW PATH: the app is swapping panels and running an entrance cascade.
    // Collapse the hole now so the wait reads as deliberate choreography
    // rather than a frozen box, announce the tab, then expand on the target.
    tweenTo(null, 200);
    showToast(TAB_LABELS[curTab] || curTab);
    try { window.setTab(curTab); } catch (e) {}
    setTimeout(function () {
      if (my !== seq) return;
      // look the target up only now: the panel has just been rendered
      var el2 = st.target ? document.querySelector(st.target) : null;
      revealTarget(el2);
      settle(el2, function () { arrive(st, el2, my); }, 900);
    }, TAB_SETTLE);
  }

  var doItEl = null, doItHandler = null;
  function clearDoIt() {
    if (doItEl && doItHandler) doItEl.removeEventListener('click', doItHandler);
    doItEl = null; doItHandler = null;
  }
  function onDoIt() { next(); }

  function go(i) {
    idx = Math.max(0, Math.min(i, steps.length - 1));
    paint();
  }
  function next() { if (idx >= steps.length - 1) finish(); else go(idx + 1); }
  function back() { if (idx > 0) go(idx - 1); }

  /* ── lifecycle ─────────────────────────────────────────────────────── */
  function start(force) {
    build();
    if (!force && seen()) return;
    // restarting an open tour used to overwrite escHandler/resizeHandler, so the
    // old pair could never be removed and every restart stacked another listener
    if (!root.hidden) finish();
    steps = isMobile() ? MOBILE_STEPS : DESKTOP_STEPS;
    idx = 0; stage = null; seq++;
    curTab = 'home';
    appliedTab = 'home';   // the welcome step needs no tab switch, so skip the slow path
    try { if (typeof window.setTab === 'function') window.setTab('home'); } catch (e) {}
    root.hidden = false;
    document.body.classList.add('dh-lock');
    paintStage(null);
    if (!reduceMotion() && root.animate) {
      root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: 'ease-out' });
    }
    escHandler = function (e) { if (e.key === 'Escape') finish(); };
    document.addEventListener('keydown', escHandler);
    resizeHandler = function () {
      var st = steps[idx];
      var el = st && st.target ? document.querySelector(st.target) : null;
      cancelAnimationFrame(rafId);
      stage = cutoutFor(el);
      paintStage(stage);
      placeCard(el);
    };
    window.addEventListener('resize', resizeHandler);
    paint();
  }

  function finish() {
    if (!root) return;
    seq++;
    clearDoIt();
    cancelAnimationFrame(rafId);
    root.hidden = true;
    stage = null;
    setDrawer(false);
    setAcct(false);
    document.body.classList.remove('dh-lock');
    try { localStorage.setItem(KEY, '1'); } catch (e) {}
    if (escHandler) document.removeEventListener('keydown', escHandler);
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    escHandler = resizeHandler = null;
  }

  function seen() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return true; } }

  /* ── wiring ────────────────────────────────────────────────────────── */
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-tour]') : null;
    if (!t) return;
    e.preventDefault();
    var act = t.getAttribute('data-tour');
    if (act === 'next') next();
    else if (act === 'back') back();
    else if (act === 'skip') finish();
  });

  window.mspTour = {
    start: function () { start(true); },
    auto: function () { start(false); },
    reset: function () { try { localStorage.removeItem(KEY); } catch (e) {} },
    seen: seen,
  };
})();
