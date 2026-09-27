/* ==========================================================================
   MySweetPea — Premium Pack JS (2026-08)
   Count-up stats, rippling ASCII hero, toast notifications, live service
   dots, footer status widget. Loaded after site.js on all pages.
   ========================================================================== */
(function () {
    'use strict';

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    /* === 1. Count-up stats (hero proof row) === */
    function animateCount(el) {
        var target = parseFloat(el.getAttribute('data-count'));
        if (isNaN(target)) return;
        var suffix = el.getAttribute('data-suffix') || '';
        var decimals = (String(target).split('.')[1] || '').length;
        var duration = 1200;
        var start = null;
        function step(ts) {
            if (!start) start = ts;
            var p = Math.min((ts - start) / duration, 1);
            var eased = 1 - Math.pow(1 - p, 3);
            var val = target * eased;
            el.textContent = (decimals ? val.toFixed(decimals) : Math.round(val)) + suffix;
            if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    var proofStats = document.querySelectorAll('.proof-value[data-count]');
    if (proofStats.length) {
        if (reduceMotion.matches) {
            proofStats.forEach(function (el) {
                el.textContent = el.getAttribute('data-count') + (el.getAttribute('data-suffix') || '');
            });
        } else {
            var proofObserver = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        animateCount(entry.target);
                        proofObserver.unobserve(entry.target);
                    }
                });
            }, { threshold: 0.4 });
            proofStats.forEach(function (el) { proofObserver.observe(el); });
        }
    }

    /* === 2. Rippling ASCII hero (openclaw.ai-style) ===
       A 220x26 char grid where each cell's brightness is a sine wave
       radiating from the center (distance d, time t):
         b = (0.5 + 0.5*sin(d*0.3 - t*0.35))^3.5
       Mapped through the dither ramp ' .:-=+xX#8@' with a 4x4 threshold
       pattern for organic anti-aliasing. The center stays a calm dark
       void — the site logo floats there. Pauses off-screen / hidden tab. */
    var asciiPre = document.getElementById('asciiRipple');
    if (asciiPre) {
        var asciiLogo = document.createElement('img');
        asciiLogo.className = 'ascii-logo';
        asciiLogo.src = document.documentElement.getAttribute('data-theme') === 'light' ? '/logo-light.svg' : '/logo.svg';
        asciiLogo.alt = '';
        asciiLogo.width = 150;
        asciiLogo.height = 150;
        asciiLogo.loading = 'eager';
        asciiLogo.decoding = 'async';
        asciiPre.parentNode.appendChild(asciiLogo);

        var RAMP = ' .:-=+xX#8@';
        var THRESH = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
        var COLS = 220, ROWS = 26, CELLS = [];

        // Mobile: shrink the grid to fit the viewport (~6px per char at the
        // 7px minimum font size, 24px side padding) so the ripple fills the
        // screen instead of being cropped to a sliver by overflow:hidden.
        function computeCols() {
            var w = window.innerWidth || document.documentElement.clientWidth || 1024;
            return Math.max(60, Math.min(220, Math.floor((w - 24) / 6)));
        }
        function buildCells() {
            COLS = computeCols();
            CELLS = [];
            var half = COLS / 2;
            for (var r = 0; r < ROWS; r++) {
                for (var c = 0; c < COLS; c++) {
                    var dx = c - half;
                    var dy = (ROWS - 1 - r) * 1.9;
                    var dist = Math.sqrt(dx * dx + dy * dy);
                    var envelope = Math.pow(Math.sin(Math.atan2(dy, dx)), 2);
                    // Envelope constants scale with grid size so the ripple
                    // keeps its shape on small screens (was tuned for 220).
                    var fadeIn = Math.min(Math.max(1.15 - dist / (half * 1.0), 0), 1);
                    var fadeOut = Math.min(Math.max((dist - half * 0.22) / (half * 0.16), 0), 1);
                    CELLS.push({
                        dist: dist,
                        env: envelope * fadeIn * fadeOut * 1.4,
                        thr: (THRESH[r % 4][c % 4] + 0.5) / 16
                    });
                }
            }
        }
        buildCells();

        function renderRipple(t) {
            var out = '';
            for (var i = 0; i < CELLS.length; i++) {
                var cell = CELLS[i];
                var wave = Math.pow(0.5 + 0.5 * Math.sin(cell.dist * 0.3 - t * 0.35), 3.5) * cell.env;
                if (wave < 0.05) wave = 0;
                wave = Math.min(Math.max(wave, 0), 1);
                var v = wave * 10;
                var idx = Math.min(10, Math.floor(v) + (v % 1 > cell.thr ? 1 : 0));
                out += RAMP.charAt(idx);
                if ((i + 1) % COLS === 0) out += '\n';
            }
            asciiPre.textContent = out;
        }

        var rafId = 0, running = false, pageVisible = true, inView = false, reduced = false;
        var lastTs = 0, lastPhase = 0;
        function frame(ts) {
            if (!pageVisible || !inView || !running) { rafId = 0; return; }
            if (ts - lastTs >= 100) { lastTs = ts; lastPhase = ts / 1000; renderRipple(lastPhase); }
            rafId = requestAnimationFrame(frame);
        }
        /* Single gate: animate only while the strip is on screen AND the tab
           is visible. (Previously visibilitychange restarted the loop even
           when the observer had stopped it for an off-screen hero, so a
           hide/show cycle with the hero scrolled away resumed a hidden rAF.) */
        function syncRipple() {
            var should = pageVisible && inView && !reduced;
            if (should && !running) { running = true; lastTs = 0; rafId = requestAnimationFrame(frame); }
            else if (!should && running) { running = false; if (rafId) cancelAnimationFrame(rafId); rafId = 0; }
        }
        document.addEventListener('visibilitychange', function () {
            pageVisible = !document.hidden;
            syncRipple();
        });
        var asciiObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                inView = entry.isIntersecting;
                syncRipple();
            });
        }, { rootMargin: '160px 0px' });
        asciiObserver.observe(asciiPre);

        // Rebuild the grid on resize/orientation change (mobile rotation).
        // Re-render at the CURRENT phase — a t=0 re-render visibly snaps the
        // wave pattern mid-animation.
        var resizeTimer = 0;
        window.addEventListener('resize', function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () {
                var newCols = computeCols();
                if (newCols !== COLS) {
                    buildCells();
                    renderRipple(reduced ? 1.2 : lastPhase);
                }
            }, 200);
        });

        // Reduced-motion: render one static frame instead of animating
        if (reduceMotion.matches) {
            reduced = true;
            renderRipple(1.2);
        } else {
            renderRipple(0);
            /* Animation begins once the IntersectionObserver reports the
               strip in view; initial state is intentionally stopped. */
        }
    }

    /* === 3. Toast notifications === */
    var toastStack = null;
    function ensureToastStack() {
        if (!toastStack) {
            toastStack = document.createElement('div');
            toastStack.className = 'toast-stack';
            toastStack.setAttribute('aria-live', 'polite');
            document.body.appendChild(toastStack);
        }
        return toastStack;
    }
    window.showToast = function (message, type) {
        var stack = ensureToastStack();
        var toast = document.createElement('div');
        toast.className = 'toast toast-' + (type || 'info');
        var text = document.createElement('span');
        text.textContent = message;
        var close = document.createElement('button');
        close.className = 'toast-close';
        close.setAttribute('aria-label', 'Dismiss');
        close.textContent = '\u00d7';
        close.addEventListener('click', function () { dismiss(); });
        toast.appendChild(text);
        toast.appendChild(close);
        stack.appendChild(toast);
        var dismissTimer = 0;
        function dismiss() {
            /* Cancel the auto-dismiss timer and guard against double-dismiss
               (close click + 5s timer both firing re-added toast-out and
               scheduled remove() twice). */
            if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = 0; }
            if (toast.isConnected === false) return;
            toast.classList.add('toast-out');
            dismissTimer = setTimeout(function () { dismissTimer = 0; toast.remove(); }, 260);
        }
        dismissTimer = setTimeout(dismiss, 5000);
        return toast;
    };

    /* === 4+5. Live status dots on service cards + footer status widget ===
       Both widgets consume the SAME heartbeat payload — fetch it once and
       share the result (two independent fetches issued duplicate requests on
       the services page, the only page with both widgets). */
    var SERVICE_MONITORS = {
        vaultwarden: 1, matrix: 2, affine: 3, koalasync: 4,
        jellyfin: 5, seerr: 6, nextcloud: 7, immich: 8, openwebui: 9
    };
    function applyHeartbeat(hb, uptimeList) {
        /* Card dots */
        var cards = document.querySelectorAll('.service-card[data-service]');
        if (cards.length) {
            cards.forEach(function (card) {
                var dot = card.querySelector('.status-dot');
                if (!dot) return;
                var id = SERVICE_MONITORS[card.getAttribute('data-service')];
                var list = (hb && id) ? hb[id] : null;
                if (!list || !list.length) {
                    /* No heartbeat for this monitor (unknown/renumbered ID):
                       the default dot styling reads as healthy — mark it
                       unknown instead of silently claiming uptime. */
                    dot.classList.add('status-unknown');
                    dot.title = 'Status unknown';
                    dot.setAttribute('aria-label', 'Status: unknown');
                    return;
                }
                var up = list[list.length - 1].status === 1;
                var wasDown = list.some(function (b) { return b.status !== 1; });
                dot.classList.remove('status-down', 'status-unknown');
                if (!up) dot.classList.add('status-down');
                dot.title = up ? (wasDown ? 'Recovered in last 24h' : 'Operational') : 'Down';
                dot.setAttribute('aria-label', up ? (wasDown ? 'Status: recovered after outage' : 'Status: operational') : 'Status: down');
            });
        }
        var hbCards = document.querySelectorAll('.service-card[data-service]');
        hbCards.forEach(function (card) {
            var id = SERVICE_MONITORS[card.getAttribute('data-service')];
            var upEl = card.querySelector('.hb-uptime');
            if (upEl) {
                var uptime = (uptimeList && id) ? uptimeList[id + '_24'] : undefined;
                /* Honest display: round to 2 decimals; only show '100%' when it
                   really is >= 99.95% (Math.round turned a real 99.58% into 100%). */
                if (typeof uptime === 'number') {
                    var pct = uptime * 100;
                    upEl.textContent = '24H · ' + (pct >= 99.95 ? Math.round(pct) : pct.toFixed(2)) + '% UPTIME';
                } else {
                    upEl.textContent = '24H · —';
                }
            }
            var bar = card.querySelector('.hbar');
            if (bar) {
                var fill = bar.firstElementChild;
                var fmt = function (p) { return p >= 99.95 ? Math.round(p) : p.toFixed(2); };
                if (typeof uptime === 'number') {
                    var pct = uptime * 100;
                    fill.style.width = pct + '%';
                    /* three states: red = down right now (latest heartbeat),
                       amber = recovering (up now, but the 24h window holds an
                       outage so uptime < 99.5%), sage = healthy. A service that
                       comes back after a long down reads amber, not red, until
                       the window heals. */
                    var mlist = (hb && id) ? hb[id] : null;
                    var wasDown = mlist && mlist.length && mlist[mlist.length - 1].status !== 1;
                    fill.classList.remove('hbar-low', 'hbar-degraded');
                    if (wasDown) {
                        fill.classList.add('hbar-low');
                        bar.title = 'Down right now \u2014 24h uptime: ' + fmt(pct) + '%';
                    } else if (pct < 99.5) {
                        fill.classList.add('hbar-degraded');
                        bar.title = 'Recovering \u2014 back up, 24h uptime: ' + fmt(pct) + '%';
                    } else {
                        bar.title = '24h uptime: ' + fmt(pct) + '%';
                    }
                } else {
                    fill.style.width = '0%';
                    fill.classList.remove('hbar-low', 'hbar-degraded');
                    bar.title = '';
                }
            }
        });
        /* Footer pill */
        var footerStatus = document.getElementById('footerStatus');
        var footerStatusText = document.getElementById('footerStatusText');
        if (footerStatus && footerStatusText) {
            var down = 0, total = 0;
            // Count only our 9 known service monitors — the public page
            // also includes the mysweetpea.cc website itself.
            Object.keys(SERVICE_MONITORS).forEach(function (key) {
                var list = hb ? hb[SERVICE_MONITORS[key]] : null;
                if (!list || !list.length) return;
                total++;
                if (list[list.length - 1].status !== 1) down++;
            });
            if (total === 0) {
                /* Payload without data for ANY known monitor ID (malformed
                   response or Kuma renumbering): "All systems operational"
                   here would be a lie — report unavailable. */
                footerStatusText.textContent = 'Status unavailable';
                footerStatus.classList.add('degraded');
            } else if (down === 0) {
                footerStatusText.textContent = 'All systems operational';
                footerStatus.classList.add('online');
            } else {
                footerStatusText.textContent = down + ' of ' + total + ' services down';
                footerStatus.classList.add('offline');
            }
        }
    }
    function markAllUnknown() {
        document.querySelectorAll('.service-card[data-service] .status-dot').forEach(function (dot) {
            dot.classList.add('status-unknown');
            dot.title = 'Status unknown';
            dot.setAttribute('aria-label', 'Status: unknown');
        });
        document.querySelectorAll('.service-card[data-service] .hb-uptime').forEach(function (el) { el.textContent = '24H · —'; });
        document.querySelectorAll('.service-card[data-service] .hbar i').forEach(function (fill) {
            fill.style.width = '0%';
            fill.classList.remove('hbar-low', 'hbar-degraded');
            if (fill.parentElement) fill.parentElement.title = '';
        });
        var footerStatus = document.getElementById('footerStatus');
        var footerStatusText = document.getElementById('footerStatusText');
        if (footerStatus && footerStatusText) {
            footerStatusText.textContent = 'Status unavailable';
            footerStatus.classList.add('degraded');
        }
    }
    var heartbeatPromise = fetch('https://status.mysweetpea.cc/api/status-page/heartbeat/public')
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(function (data) {
            var hb = data && data.heartbeatList;
            if (!hb) throw new Error('no heartbeatList');
            applyHeartbeat(hb, data && data.uptimeList);
        })
        .catch(function () { markAllUnknown(); });

})();
