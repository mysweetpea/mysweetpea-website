/* MySweetPea — about.html only (Exhibit v2, Sep 2026). Standalone file.
   1) Live uptime: fetch the Uptime-Kuma status-page heartbeat and average the
      24h uptime across monitors 1-9 (same fetch/parse pattern as
      status-page.js, but self-contained — no shared code).
   2) Count-up for [data-count] values: IO threshold 0.5, ease-out cubic,
      1200ms, runs once. Respects prefers-reduced-motion (skips animation).
   Honesty rule: if live data is unreachable we keep the server-rendered 99.9
   fallback but SAY so — never fake liveness. */
(function () {
    'use strict';

    var reducedMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------- count-up ---------- */

    function decimalsOf(str) {
        var i = String(str).indexOf('.');
        return i === -1 ? 0 : String(str).length - i - 1;
    }

    function animateCount(el) {
        var target = parseFloat(el.getAttribute('data-count'));
        if (isNaN(target)) return;
        var dec = decimalsOf(el.getAttribute('data-count'));
        var t0 = performance.now();
        function tick(t) {
            var p = Math.min(1, (t - t0) / 1200);
            var v = 1 - Math.pow(1 - p, 3);
            // last frame re-reads data-count: the live-value fetch may have updated it mid-animation
            var tgt = p < 1 ? target : parseFloat(el.getAttribute('data-count'));
            if (isNaN(tgt)) tgt = target;
            if (p < 1) {
                el.textContent = (v * tgt).toFixed(dec);
                requestAnimationFrame(tick);
            } else {
                el.textContent = tgt.toFixed(dec);
            }
        }
        requestAnimationFrame(tick);
    }

    var pctEl = document.getElementById('aboutUptimePct');
    var pctFired = false;

    if (!reducedMotion && 'IntersectionObserver' in window) {
        var cio = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (!e.isIntersecting) return;
                cio.unobserve(e.target);
                if (e.target === pctEl) pctFired = true;
                animateCount(e.target);
            });
        }, { threshold: 0.5 });
        var nodes = document.querySelectorAll('[data-count]');
        for (var i = 0; i < nodes.length; i++) cio.observe(nodes[i]);
    }

    /* ---------- dynamic factsheet counts (from site-data.json) ----------
       Markup ships 9 / 2 as SEO statics. At runtime re-aim the count-ups at
       the validated data; repaint when the animation already finished. */
    (function syncFacts() {
        if (!window.MSP) return;
        window.MSP.data().then(function (d) {
            if (!d) return;
            var nS = d.services.length, nR = (d.repos || []).length;
            var stats = document.querySelectorAll('.about-x-bignum .about-x-bn');
            stats.forEach(function (bn) {
                var lbl = bn.querySelector('.about-x-bl');
                var val = bn.querySelector('.about-x-bv span[data-count]');
                if (!lbl || !val) return;
                var txt = lbl.textContent.toLowerCase();
                var target = null;
                /* exact-tile matching: the uptime tile also says "services" —
                   only the "Services, all open source" / "Public repositories"
                   tiles are count tiles. Uptime lives in the lead tile with
                   the live % (id'd separately). */
                if (txt.indexOf('uptime') !== -1) return;
                if (txt.indexOf('services') !== -1) target = nS;
                else if (txt.indexOf('repositor') !== -1) target = nR;
                if (target == null) return;
                val.setAttribute('data-count', String(target));
                var cur = parseFloat(val.textContent);
                if (isFinite(cur) && cur > 0 && cur !== target) val.textContent = String(target);
            });
        }).catch(function () { });
    })();

    /* ---------- live uptime (monitor ids resolved at runtime via MSP) ---------- */

    var MONITOR_IDS = null; /* filled from MSP.monitors() below */

    var stateEl = document.getElementById('aboutUptimeState');
    var tickerEl = document.getElementById('aboutTickerState');

    function markUnreachable() {
        if (stateEl) {
            /* keep the existing markup contract: toggle the dot's class and
               update ONLY the label span's text — never delete the styled
               span or wholesale textContent the container (that destroys
               the dot element and any future markup). */
            var dot = stateEl.querySelector('.about-x-dot');
            var label = stateEl.querySelector('.about-x-live-txt');
            if (dot) {
                dot.classList.remove('about-x-dot-on');
                dot.classList.add('about-x-dot-off');
            }
            if (label) {
                label.textContent = 'UPTIME — LIVE DATA UNREACHABLE';
            } else if (dot) {
                dot.insertAdjacentText('afterend', ' Uptime — live data unreachable');
            } else {
                stateEl.textContent = 'Uptime — live data unreachable';
            }
        }
        if (tickerEl) tickerEl.textContent = 'STATUS UNAVAILABLE';
    }

    /* markup ships neutral (no dot-on, "CHECKING…"); this flips it to live
       ONLY after a verified fetch. Keeps the page honest when JS dies or
       the status page is unreachable. */
    function markVerified() {
        if (stateEl) {
            var dot = stateEl.querySelector('.about-x-dot');
            var label = stateEl.querySelector('.about-x-live-txt');
            if (dot) { dot.classList.add('about-x-dot-on'); dot.classList.remove('about-x-dot-off'); }
            if (label) label.textContent = 'LIVE · LAST 24 H';
        }
    }

    /* PageAvg: mean 24h uptime across the resolved monitors. Honesty rule
       (kept from the hand-rolled version): a PARTIAL set means IDs drifted —
       avg is null so the caller fails closed instead of showing a
       plausible-but-wrong number. */
    function PageAvg(ids, uptimeList) {
        var sum = 0, n = 0, keys = Object.keys(ids);
        keys.forEach(function (name) {
            var v = uptimeList[ids[name] + '_24'];
            if (typeof v === 'number' && v >= 0 && v <= 1) { sum += v; n++; }
        });
        if (n !== keys.length) {
            console.warn('[msp] about uptime: partial monitor set (' + n + '/' + keys.length + ')');
            return { n: n, avg: null };
        }
        return { n: n, avg: Math.round((sum / n) * 1000) / 10 };
    }

    /* Shared pipeline: ONE heartbeat fetch + runtime-resolved monitor map. */
    var feedP = (window.MSP
        ? Promise.all([window.MSP.heartbeat(), window.MSP.monitors()])
        : Promise.reject(new Error('MSP missing')));
    feedP
        .then(function (res) {
            var data = res[0], mons = res[1] || {};
            MONITOR_IDS = mons.byKey || {};
            if (!data || !data.uptimeList || !pctEl || !Object.keys(MONITOR_IDS).length) return Promise.reject(new Error('no usable feed'));
            // uptimeList keys are "<monitorId>_24", values are fractions 0..1
            var pa = PageAvg(MONITOR_IDS, data.uptimeList);
            if (pa.avg == null) return Promise.reject(new Error('partial monitor set'));
            var avg = pa.avg; /* already one-decimal from PageAvg */
            var s = avg.toFixed(1);   /* one decimal, matching "99.9" markup default */
            if (pctFired || reducedMotion || !('IntersectionObserver' in window)) {
                // animation already ran (or will never run): show the live value.
                // data-count too — a count-up still in flight re-reads it on its final frame.
                pctEl.setAttribute('data-count', s);
                pctEl.textContent = s;
            } else {
                // not fired yet: aim the count-up at the real number
                pctEl.setAttribute('data-count', s);
            }
            /* Current status from the LATEST beat: the 24h average alone
               cannot license 'ALL SYSTEMS OPERATIONAL' — a monitor that is
               down NOW must say so. */
            var hbNow = data.heartbeatList || {}, downNow = 0, sawBeat = false;
            Object.keys(MONITOR_IDS).forEach(function (name) {
                var beats = hbNow[String(MONITOR_IDS[name])] || [], last = null;
                beats.forEach(function (b) {
                    if (b && typeof b.status === 'number' && (!last || String(b.time) >= String(last.time))) last = b;
                });
                if (last) { sawBeat = true; if (last.status === 0) downNow++; }
            });
            /* success path lives INSIDE the success handler: the old trailing
               .then ran after .catch too, painting the LIVE badge on a FAILED
               fetch (catch-resolves-chain bug) */
            markVerified();
            if (tickerEl && tickerEl.textContent.indexOf('CHECKING') !== -1) {
                tickerEl.textContent = sawBeat
                    ? (downNow === 0 ? 'ALL SYSTEMS OPERATIONAL · LIVE'
                        : downNow + (downNow === 1 ? ' SERVICE DOWN · LIVE' : ' SERVICES DOWN · LIVE'))
                    : 'STATUS UNAVAILABLE';
            }
        })
        .catch(function (err) {
            console.warn('[msp] about uptime fetch failed:', err && err.message ? err.message : err);
            markUnreachable();
        }); })();
