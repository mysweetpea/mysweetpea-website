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
            /* A dead feed removes data-count; stop painting instead of falling
               back to the captured placeholder (that would repaint a fake 99.9
               over the em dash markUnreachable just wrote). */
            if (el.getAttribute('data-count') === null) return;
            var p = Math.min(1, (t - t0) / 1200);
            var v = 1 - Math.pow(1 - p, 3);
            // last frame re-reads data-count: the live-value fetch may have updated it mid-animation
            var tgt = p < 1 ? target : parseFloat(el.getAttribute('data-count'));
            if (isNaN(tgt)) return;
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
            var nS = d.services.length, nR = (d.siteFacts && d.siteFacts.publicRepos) || (d.repos || []).length;
            /* the hero status rail hard-coded "9 services" — it drifted the moment
               a service was added or removed (same class as the plate badges) */
            var railSvc = document.querySelector('[data-fact="rail-services"]');
            if (railSvc) railSvc.textContent = nS + (nS === 1 ? ' service' : ' services');
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
        }).catch(function (err) { console.warn('[msp] about facts: ' + (err && err.message ? err.message : 'unavailable')); });
    })();

    /* ---------- live uptime (monitor ids resolved at runtime via MSP) ---------- */

    var MONITOR_IDS = null; /* filled from MSP.monitors() below */

    var stateEl = document.getElementById('aboutUptimeState');
    var tickerEl = document.getElementById('aboutTickerState');
    /* Explicit state instead of sniffing the rendered 'CHECKING' copy — a
       wording change would have left the ticker on its placeholder forever. */
    var tickerDone = false;

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
        /* Never leave the server-rendered 99.9 sitting next to "LIVE DATA
           UNREACHABLE" — a plausible-looking number with no data behind it is
           exactly the fake-liveness this file exists to avoid. Drop the
           data-count too so a pending count-up cannot repaint it. */
        if (pctEl) {
            pctEl.removeAttribute('data-count');
            pctEl.textContent = '\u2014';
            var pc = pctEl.parentElement && pctEl.parentElement.querySelector('small');
            if (pc) pc.hidden = true;
        }
        tickerDone = true;
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
            /* 'hint' = baked extraction-time IDs, never validated against the
               live payload. A hint that happens to point at another monitor
               passes the partial-set check and yields a plausible-but-wrong
               average, so fail closed instead of showing it. */
            if (mons && (mons.source === 'hint' || mons.source === 'none')) return Promise.reject(new Error('monitor map is unverified (' + mons.source + ')'));
            if (!data || !data.uptimeList || !pctEl || !Object.keys(MONITOR_IDS).length) return Promise.reject(new Error('no usable feed'));
            // uptimeList keys are "<monitorId>_24", values are fractions 0..1
            var pa = PageAvg(MONITOR_IDS, data.uptimeList);
            if (pa.avg == null) return Promise.reject(new Error('partial monitor set'));
            var avg = pa.avg; /* already one-decimal from PageAvg */
            var s = avg.toFixed(1);   /* one decimal, matching the old static */
            /* The tile ships with NO data-count so a 404'd script cannot leave
               a fake number on screen. Consequence: the IntersectionObserver
               above never watched it, so there is no count-up to aim — write
               the value and settle it. Setting data-count here also stops a
               later frame from re-animating it from zero. */
            pctEl.setAttribute('data-count', s);
            pctEl.textContent = s;
            /* Current status from the LATEST beat: the 24h average alone
               cannot license 'ALL SYSTEMS OPERATIONAL' — a monitor that is
               down NOW must say so. */
            var hbNow = data.heartbeatList || {}, downNow = 0, sawBeat = false;
            Object.keys(MONITOR_IDS).forEach(function (name) {
                var beats = hbNow[String(MONITOR_IDS[name])] || [], last = null, lastT = -Infinity;
                beats.forEach(function (b) {
                    if (!b || typeof b.status !== 'number') return;
                    /* numeric compare: String() ordering breaks on epoch
                       timestamps ("999" > "1000"), letting an older beat win
                       and hiding a monitor that is down right now. */
                    var t = Date.parse(b.time);
                    if (isNaN(t)) t = Number(b.time);
                    if (isNaN(t)) return;
                    if (t >= lastT) { lastT = t; last = b; }
                });
                if (last) { sawBeat = true; if (last.status === 0) downNow++; }
            });
            /* success path lives INSIDE the success handler: the old trailing
               .then ran after .catch too, painting the LIVE badge on a FAILED
               fetch (catch-resolves-chain bug) */
            if (!sawBeat) return Promise.reject(new Error('no usable heartbeat'));
            markVerified();
            if (tickerEl && !tickerDone) {
                tickerEl.textContent = downNow === 0
                    ? 'ALL SYSTEMS OPERATIONAL · LIVE'
                    : downNow + (downNow === 1 ? ' SERVICE DOWN · LIVE' : ' SERVICES DOWN · LIVE');
            }
            tickerDone = true;
            /* markup ships the % hidden behind a neutral placeholder */
            if (pctEl && pctEl.parentElement) {
                var pc = pctEl.parentElement.querySelector('small');
                if (pc) pc.hidden = false;
            }
        })
        .catch(function (err) {
            console.warn('[msp] about uptime fetch failed:', err && err.message ? err.message : err);
            markUnreachable();
        }); })();
