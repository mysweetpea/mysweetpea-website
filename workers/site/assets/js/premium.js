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
        function asciiLogoSrc() {
            asciiLogo.src = document.documentElement.getAttribute('data-theme') === 'light' ? '/logo-light.svg' : '/logo.svg';
        }
        asciiLogoSrc();
        /* keep the logo on-theme across mid-session toggles */
        new MutationObserver(asciiLogoSrc).observe(document.documentElement, { attributeFilter: ['data-theme'] });
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
       Both widgets consume the SAME heartbeat payload — via MSP (site-data.js)
       the payload is fetched ONCE per page and monitor IDs are resolved at
       runtime from the Kuma public status API (no hardcoded ID map left). */

    function applyHeartbeat(hb, uptimeList, monitors) {
        /* Card dots */
        var cards = document.querySelectorAll('.service-card[data-service]');
        if (cards.length) {
            cards.forEach(function (card) {
                var dot = card.querySelector('.status-dot');
                if (!dot) return;
                var id = monitors ? monitors[card.getAttribute('data-service')] : null;
                var list = (hb && id) ? hb[id] : null;
                if (!list || !list.length) {
                    /* No heartbeat for this monitor (unknown/renumbered ID):
                       the default dot styling reads as healthy — mark it
                       unknown instead of silently claiming uptime. */
                    dot.classList.add('status-unknown');
                    dot.title = 'Status unknown';
                    dot.setAttribute('aria-label', 'Status: unknown');
                    var meta2 = dot.parentElement;
                    var lab2 = meta2 ? meta2.querySelector('.sp-txt') : null;
                    if (meta2) meta2.classList.remove('state-down', 'state-degraded');
                    if (lab2) lab2.textContent = 'UNKNOWN';
                    return;
                }
                var up = list[list.length - 1].status === 1;
                /* binary states only (user call): LIVE or DOWN, no recovering */
                var meta = dot.parentElement; /* .sp-meta wraps dot + label */
                var lab = meta ? meta.querySelector('.sp-txt') : null;
                if (meta) meta.classList.remove('state-down', 'state-degraded');
                dot.classList.remove('status-down', 'status-unknown', 'status-degraded');
                if (!up) {
                    dot.classList.add('status-down');
                    if (meta) meta.classList.add('state-down');
                    if (lab) lab.textContent = 'DOWN';
                } else if (lab) {
                    lab.textContent = 'LIVE';
                }
                dot.title = up ? 'Operational' : 'Down';
                dot.setAttribute('aria-label', up ? 'Status: operational' : 'Status: down');
            });
        }
        var hbCards = document.querySelectorAll('.service-card[data-service]');
        hbCards.forEach(function (card) {
            var id = monitors ? monitors[card.getAttribute('data-service')] : null;
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
                    /* binary: red only while down right now; sage otherwise.
                       The 24h average still shows in the width + footer text. */
                    var mlist = (hb && id) ? hb[id] : null;
                    var wasDown = mlist && mlist.length && mlist[mlist.length - 1].status === 0;
                    fill.classList.remove('hbar-low', 'hbar-degraded');
                    if (wasDown) {
                        fill.classList.add('hbar-low');
                        bar.title = 'Down right now \u2014 24h uptime: ' + fmt(pct) + '%';
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
            // Count only our public service monitors (resolved via MSP) —
            // the public Kuma page also includes the mysweetpea.cc site itself.
            var monKeys = monitors ? Object.keys(monitors) : [];
            monKeys.forEach(function (key) {
                var list = hb ? hb[monitors[key]] : null;
                if (!list || !list.length) return;
                total++;
                /* only a confirmed 0 counts as down (2=pending/3=maintenance
                   are not outages — binary display per user call) */
                if (list[list.length - 1].status === 0) down++;
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
            var meta3 = dot.parentElement;
            var lab3 = meta3 ? meta3.querySelector('.sp-txt') : null;
            if (meta3) meta3.classList.remove('state-down', 'state-degraded');
            if (lab3) lab3.textContent = 'UNKNOWN';
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
    /* === Pricing featured bento (dynamic, from site-data.json) ==============
       The Sweet Pea tier's bento tiles ship static markup (SEO/no-JS). At
       runtime order + names + tags follow the validated featured list; the
       "+N More services" tile is derived from the real service count.
       createElement/textContent only. Static tiles are adopted by matching
       their .tb-name text to the featured tile name — never duplicated. */
    (function syncPricingBento() {
        if (!window.MSP) return;
        var bento = document.querySelector('#card-sweetpea .tier-bento');
        if (!bento) return;
        window.MSP.data().then(function (d) {
            if (!d || !d.pricing || !d.pricing.featured) return;
            var byKey = {};
            var i, k;
            for (i = 0; i < d.services.length; i++) byKey[d.services[i].key] = d.services[i];
            var more = bento.querySelector('.tb-more');
            var tiles = Array.prototype.slice.call(bento.querySelectorAll('.tb-tile:not(.tb-more)'));
            /* 1. adopt static tiles by name -> data-key */
            tiles.forEach(function (tile) {
                var nm = tile.querySelector('.tb-name');
                var txt = nm ? String(nm.textContent).trim().toLowerCase() : '';
                var match = null;
                for (var j = 0; j < d.pricing.featured.length; j++) {
                    if (d.pricing.featured[j].tile.toLowerCase() === txt) { match = d.pricing.featured[j]; break; }
                }
                if (match) tile.setAttribute('data-key', match.key);
                else tile.remove(); /* stale tile (service no longer featured) */
            });
            /* 2. enforce featured order + sync names/tags; create missing */
            var ref = more;
            for (i = d.pricing.featured.length - 1; i >= 0; i--) {
                (function (f) {
                    var svc = byKey[f.key];
                    if (!svc) return;
                    /* f.key is validated by MSP (KEY_RE) before it reaches this
                       selector — quote/bracket injection cannot survive validation */
                    var tile = bento.querySelector('.tb-tile[data-key="' + f.key + '"]');
                    if (!tile) {
                        tile = document.createElement('div');
                        tile.className = 'tb-tile';
                        tile.setAttribute('role', 'listitem');
                        tile.setAttribute('data-key', f.key);
                        var ic = document.createElement('span'); ic.className = 'tb-ic';
                        var img = document.createElement('img');
                        img.src = svc.icon; img.alt = ''; img.width = 20; img.height = 20;
                        img.loading = 'lazy'; img.decoding = 'async';
                        ic.appendChild(img);
                        var nm = document.createElement('span'); nm.className = 'tb-name';
                        nm.textContent = f.tile;
                        var tg = document.createElement('span'); tg.className = 'tb-tag';
                        tg.textContent = f.tag;
                        tile.appendChild(ic); tile.appendChild(nm); tile.appendChild(tg);
                    } else {
                        var nm2 = tile.querySelector('.tb-name');
                        var tg2 = tile.querySelector('.tb-tag');
                        if (nm2) nm2.textContent = f.tile;
                        if (tg2) tg2.textContent = f.tag;
                    }
                    /* (re)insert in order: reverse iteration keeps positions
                       stable without touching the first-tile tb-feat class */
                    bento.insertBefore(tile, ref);
                    ref = tile;
                })(d.pricing.featured[i]);
            }
            /* 3. +N count + morelist from the non-featured services */
            if (more) {
                var rest = d.services.filter(function (s) {
                    return !d.pricing.featured.some(function (f) { return f.key === s.key; });
                });
                var plus = more.querySelector('.tb-plus');
                var list = more.querySelector('.tb-morelist');
                if (plus) plus.textContent = '+' + rest.length;
                if (list) list.textContent = rest.map(function (s) { return s.shortName; }).join(' · ');
            }
        }).catch(function () { /* static bento stands */ });
    })();

    /* === Editorial tiles adopt service names from data (about + index) ======
       The "replaces" analysis tiles (about) and garden card names (index)
       carry user-dictated prose that stays in markup; the SERVICE NAMES are
       facts and follow site-data.json (adopt-by-existing-text, never
       rewritten prose). */
    (function syncEditorialNames() {
        if (!window.MSP) return;
        window.MSP.data().then(function (d) {
            if (!d || !d.services) return;
            /* about: .about-x-ana-to tiles adopt the shortName of the service
               whose tile text already matches a known name (renames only) */
            var byLeaf = {};
            d.services.forEach(function (s) { byLeaf[s.name.split('/').pop().trim().toLowerCase()] = s.shortName; });
            document.querySelectorAll('.about-x-ana-to').forEach(function (el) {
                var cur = el.textContent.trim().toLowerCase();
                if (byLeaf[cur]) el.textContent = byLeaf[cur];
            });
            /* index garden: .g-name + .g-side-name + .g-altname "replaces"
               adopt when the garden copy exists in the data */
            var gByName = {};
            d.services.forEach(function (s) {
                if (!s.garden) return;
                /* match by full display name OR ANY '/' segment ("Jellyfin /
                   Moonfin" cards may say just "Jellyfin"). The card NAME is
                   editorial — only tagline + replaces follow the data. */
                gByName[s.name.toLowerCase()] = s;
                s.name.split('/').forEach(function (seg) {
                    gByName[seg.trim().toLowerCase()] = s;
                });
            });
            document.querySelectorAll('.g-name').forEach(function (el) {
                var cur = el.textContent.trim().toLowerCase();
                var s = gByName[cur];
                if (!s) return;
                var row = el.closest('.garden-row');
                if (s.garden.line && row) {
                    var line = row.querySelector('.g-line');
                    if (line) line.textContent = s.garden.line;
                }
                if (s.garden.replaces && row) {
                    var alt = row.querySelector('.g-altname');
                    if (alt) alt.textContent = s.garden.replaces;
                }
            });
        }).catch(function () { });
    })();

    var heartbeatPromise = (function () {
        if (!window.MSP) {
            /* site-data.js missing (defensive — every page loads it before
               premium.js): fall back to the legacy direct fetch so widgets
               still work, with NO monitor map (dots go unknown, honestly). */
            var base = (window.MSP && window.MSP.bakedConfig && window.MSP.bakedConfig().statusApiBase) || 'https://status.mysweetpea.cc';
            return fetch(base + '/api/status-page/heartbeat/public')
                .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
                .then(function (data) {
                    var hb = data && data.heartbeatList;
                    if (!hb) throw new Error('no heartbeatList');
                    applyHeartbeat(hb, data && data.uptimeList, null);
                })
                .catch(function () { markAllUnknown(); });
        }
        return Promise.all([window.MSP.heartbeat(), window.MSP.monitors()])
            .then(function (r) {
                applyHeartbeat(r[0].heartbeatList, r[0].uptimeList, r[1].byKey || {});
            })
            .catch(function () { markAllUnknown(); });
    })();

})();
