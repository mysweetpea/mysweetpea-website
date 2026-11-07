/* MySweetPea dashboard — first-run guided tour.
 *
 * Self-contained: injects its own CSS, no dependencies, no build step.
 * Drives the EXISTING UI rather than reimplementing it:
 *   - window.setTab()            (already global) to switch sections
 *   - #nav-toggle / .dh-open / body.dh-lock for the mobile drawer
 *   - stable ids already in index.html (#tabs, #acct-trigger, #hm-*)
 *
 * ponytail: box-shadow does the spotlight (no clip-path / SVG mask math);
 * mobile card is a bottom sheet (no tooltip-position clamping). If the tour
 * ever needs element-anchored arrows or collision detection beyond this,
 * that is the point to vendor driver.js instead of growing this file.
 */
(function () {
  'use strict';
  if (window.mspTour) return; // idempotent — safe to include twice

  var KEY = 'msp_tour_v1';           // localStorage: seen flag
  var MOBILE_MQ = '(max-width: 768px)';

  /* ── copy ─────────────────────────────────────────────────────────────
   * Written for non-technical users: short sentences, no jargon.
   * Edit freely — this array is the only place the words live.
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

    { center: true, drawer: false,
      title: 'This is Home',
      body: 'Your services, what is new, and what you have been watching — all in one place.' },

    { target: '#hm-services-sec', drawer: false,
      title: 'Your services',
      body: 'Tap any card to open that service. Think of this as your shortcut shelf.' },

    { target: '#hm-upnext', drawer: false,
      title: 'Something to watch',
      body: 'New picks land here. The Media tab has the full library when you want to browse.' },

    { center: true, drawer: false,
      title: 'You are all set',
      body: 'Replay this whenever you like — tap the ? at the top of the screen.' },
  ];

  var DESKTOP_STEPS = [
    { center: true,
      title: 'Welcome to MySweetPea',
      body: 'This is your dashboard — the home base for everything you have access to. Give me a minute and I will show you around.' },

    { target: '#tabs',
      title: 'Your sections',
      body: 'Home, Media, Services, Stats, Guides and Contact. Click any one to jump straight there.' },

    { center: true,
      title: 'This is Home',
      body: 'Your services, what is new, and what you have been watching — all in one place.' },

    { target: '#hm-services-sec',
      title: 'Your services',
      body: 'Click any card to open that service. Think of this as your shortcut shelf.' },

    { target: '#hm-upnext',
      title: 'Something to watch',
      body: 'New picks land here. The Media tab has the full library when you want to browse.' },

    { target: '#acct-trigger', openAcct: true,
      title: 'Your account',
      body: 'Password, sessions, your vault, and this tour again — it all lives behind your name up here.' },

    { center: true, closeAcct: true,
      title: 'You are all set',
      body: 'Replay this whenever you like — from your account menu, or the ? at the top of the screen.' },
  ];

  /* ── state ─────────────────────────────────────────────────────────── */
  var steps = [];
  var idx = 0;
  var root = null;
  var spot = null;
  var block = null;
  var card = null;
  var escHandler = null;
  var resizeHandler = null;

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
      // the spotlight: transparent box whose huge outer shadow dims everything else
      '.mst-spot{position:absolute;border-radius:14px;box-shadow:0 0 0 9999px rgba(6,7,13,.76);transition:all .28s cubic-bezier(.22,1,.36,1);z-index:1}',
      '.mst-spot.no-anim{transition:none}',
      // click blocker for non-interactive steps (hidden on do-it steps)
      '.mst-block{position:absolute;inset:0;pointer-events:auto;z-index:2}',
      '.mst-block[hidden]{display:none}',
      '.mst-card{position:absolute;z-index:3;pointer-events:auto;box-sizing:border-box;',
      '  max-width:340px;padding:18px 18px 14px;border-radius:16px;',
      '  background:linear-gradient(165deg,rgba(30,26,60,.98),rgba(13,14,26,.99));',
      '  border:1px solid rgba(151,146,255,.28);box-shadow:0 24px 60px rgba(0,0,0,.55);',
      '  color:#e8e6f5;font-size:.92rem;line-height:1.5;',
      '  transition:top .28s cubic-bezier(.22,1,.36,1),left .28s cubic-bezier(.22,1,.36,1)}',
      '.mst-card.no-anim{transition:none}',
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
      // mobile: card becomes a bottom sheet — thumb reachable, no clamping math
      '@media (max-width:768px){',
      '  .mst-card{left:0!important;right:0;bottom:0;top:auto!important;max-width:none;',
      '    border-radius:18px 18px 0 0;padding:20px 20px calc(18px + env(safe-area-inset-bottom));',
      '    transition:none}',
      '  .mst-skip{top:auto;bottom:calc(100% + 8px);right:14px}',
      '}',
      '@media (prefers-reduced-motion: reduce){.mst-spot,.mst-card{transition:none!important}}',
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

    spot = document.createElement('div');
    spot.className = 'mst-spot';

    block = document.createElement('div');
    block.className = 'mst-block';

    card = document.createElement('div');
    card.className = 'mst-card';

    root.appendChild(spot);
    root.appendChild(block);
    root.appendChild(card);
    document.body.appendChild(root);
  }

  /* ── drawer + account-menu helpers (reuse existing UI) ─────────────── */
  function setDrawer(open) {
    var d = document.getElementById('dh-menu');
    if (!d) return;
    d.classList.toggle('dh-open', !!open);
    document.body.classList.toggle('dh-lock', !!open);
    var tg = document.getElementById('nav-toggle');
    if (tg) tg.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function setAcct(open) {
    var pop = document.getElementById('acct-pop');
    var trg = document.getElementById('acct-trigger');
    if (!pop || !trg) return;
    pop.hidden = !open;
    trg.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  /* ── painting ──────────────────────────────────────────────────────── */
  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function paint() {
    var st = steps[idx];
    if (!st) return finish();

    // apply side effects for this step
    if (st.drawer === true) setDrawer(true);
    else if (st.drawer === false) setDrawer(false);
    if (st.openAcct) setAcct(true);
    if (st.closeAcct) setAcct(false);

    var noAnim = reduceMotion();
    spot.classList.toggle('no-anim', noAnim);
    card.classList.toggle('no-anim', noAnim);

    // click blocker only when the user is NOT meant to interact with the page
    block.hidden = !!st.doIt;

    var el = st.target ? document.querySelector(st.target) : null;
    if (el) el.scrollIntoView({ block: 'center', behavior: noAnim ? 'auto' : 'smooth' });

    // wait a beat for scroll/drawer transitions, then position
    setTimeout(function () { position(el); }, noAnim ? 0 : (el ? 320 : 60));

    // content
    var last = idx === steps.length - 1;
    var first = idx === 0;
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

    // do-it steps: advance when the user actually taps the target
    if (st.doIt && el) {
      el.addEventListener('click', onDoIt, { once: true });
    }
  }

  function onDoIt() { next(); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function position(el) {
    var vw = window.innerWidth, vh = window.innerHeight, pad = 12;

    if (!el || !visible(el)) {
      // nothing to point at — dim uniformly and centre the card
      spot.style.width = '0px';
      spot.style.height = '0px';
      spot.style.left = '-9999px';
      spot.style.top = '-9999px';
      spot.style.boxShadow = '0 0 0 9999px rgba(6,7,13,.76)';
      card.style.left = Math.max(pad, (vw - Math.min(340, vw - pad * 2)) / 2) + 'px';
      card.style.top = Math.max(pad, (vh - card.offsetHeight) / 2) + 'px';
      return;
    }

    var r = el.getBoundingClientRect();
    var m = 6;
    spot.style.boxShadow = '0 0 0 9999px rgba(6,7,13,.76)';
    spot.style.left = (r.left - m) + 'px';
    spot.style.top = (r.top - m) + 'px';
    spot.style.width = (r.width + m * 2) + 'px';
    spot.style.height = (r.height + m * 2) + 'px';

    if (isMobile()) return; // bottom sheet handles itself

    var cw = Math.min(340, vw - pad * 2);
    var ch = card.offsetHeight || 160;
    var left = r.left + r.width / 2 - cw / 2;
    left = Math.max(pad, Math.min(left, vw - cw - pad));
    var top = r.bottom + 14;
    if (top + ch > vh - pad) top = Math.max(pad, r.top - ch - 14); // flip above
    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }

  /* ── flow ──────────────────────────────────────────────────────────── */
  function go(i) {
    idx = Math.max(0, Math.min(i, steps.length - 1));
    paint();
  }
  function next() { idx >= steps.length - 1 ? finish() : go(idx + 1); }
  function back() { go(idx - 1); }

  function start(force) {
    build();
    if (!force && seen()) return;
    steps = isMobile() ? MOBILE_STEPS : DESKTOP_STEPS;
    idx = 0;
    root.hidden = false;
    document.body.classList.add('dh-lock');
    escHandler = function (e) { if (e.key === 'Escape') finish(); };
    document.addEventListener('keydown', escHandler);
    resizeHandler = function () { paint(); };
    window.addEventListener('resize', resizeHandler);
    paint();
  }

  function finish() {
    if (!root) return;
    root.hidden = true;
    spot.style.boxShadow = '0 0 0 0 transparent';
    setDrawer(false);
    setAcct(false);
    document.body.classList.remove('dh-lock');
    try { localStorage.setItem(KEY, '1'); } catch (e) {}
    if (escHandler) document.removeEventListener('keydown', escHandler);
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    escHandler = resizeHandler = null;
  }

  function seen() {
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return true; }
  }

  /* ── wiring ────────────────────────────────────────────────────────── */
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-tour]') : null;
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
