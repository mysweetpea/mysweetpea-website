/* ==========================================================================
   MySweetPea — Shared Site Script (site.js)
   Handles: scroll progress bar, nav shrink, reveal animations,
            glow-card tracking, and falling frost-petal canvas.
   ========================================================================== */
(function () {
    'use strict';

    /* Mark html as JS-enabled so reveal animations only hide content
       when JS is actually running (prevents blank/unfinished pages).
       If the early-paint watchdog already fired (site.js arrived >6s
       late on a slow connection), content is visible and must STAY
       visible — re-adding html.js here would snap it back to opacity:0
       and fade it in again (the exact "static screen" regression the
       bootstrap was written to fix). */
    if (!window.__mspWatchdogFired) {
        document.documentElement.classList.add('js');
    }

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

    function requestFrameOnce(callback) {
        var queued = false;
        return function () {
            if (queued) return;
            queued = true;
            requestAnimationFrame(function () {
                queued = false;
                callback();
            });
        };
    }

    /* === Scroll progress bar === */
    var progress = document.getElementById('scrollProgress');
    if (progress) {
        var updateProgress = requestFrameOnce(function () {
            var max = document.documentElement.scrollHeight - window.innerHeight;
            progress.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + '%';
        });
        updateProgress();
        window.addEventListener('scroll', updateProgress, { passive: true });
        window.addEventListener('resize', updateProgress, { passive: true });
    }

    /* === Nav shrink on scroll === */
    var nav = document.querySelector('.top-nav');
    if (nav) {
        var updateNav = requestFrameOnce(function () {
            nav.classList.toggle('nav-scrolled', window.scrollY > 40);
        });
        updateNav();
        window.addEventListener('scroll', updateNav, { passive: true });
    }

    /* Signal the early-paint watchdog that the reveal system is live, so it
       does not drop the html.js class (which would disable reveal styling).
       Inverse race: if the watchdog ALREADY fired (site.js loaded >6s late),
       do not add html.js now — that would snap visible content back to
       opacity:0 and fade it in again. Leave content permanently visible. */
    if (!window.__mspWatchdogFired) {
        window.__mspRevealInit = true;
    }

    /* === Scroll reveal animations === */
    var revealEls = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

    function forceRevealAll() {
        revealEls.forEach(function (el) {
            el.classList.add('visible');
        });
    }

    if (revealEls.length) {
        if (reduceMotion.matches || !('IntersectionObserver' in window)) {
            forceRevealAll();
        } else {
            var revealObserver = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('visible');
                        revealObserver.unobserve(entry.target);
                    }
                });
            }, { threshold: 0.1, rootMargin: '0px 0px -10% 0px' });

            revealEls.forEach(function (el) {
                revealObserver.observe(el);
            });
        }
    }

    /* === Smooth auto-grow textareas ===
       Grows the textarea height smoothly as the user types, so it never
       shows a scrollbar and feels elegant. Respects reduced-motion. */
    var autoGrow = reduceMotion.matches ? false : true;
    var growTais = [];
    document.querySelectorAll('textarea').forEach(function (ta) {
        if (!autoGrow) return;
        ta.style.overflow = 'hidden';
        ta.style.resize = 'none';
        ta.style.transition = 'height .18s ease';
        function grow() {
            ta.style.height = 'auto';
            ta.style.height = ta.scrollHeight + 'px';
        }
        grow();
        ta.addEventListener('input', grow);
        growTais.push(grow);
    });
    /* One shared resize listener instead of one per textarea (N reflows per
       resize event on form-heavy pages). */
    if (growTais.length) {
        var growRaf = 0;
        window.addEventListener('resize', function () {
            if (growRaf) return;
            growRaf = requestAnimationFrame(function () {
                growRaf = 0;
                growTais.forEach(function (g) { g(); });
            });
        }, { passive: true });
    }

    /* === Glow-card mouse tracking === */
    if (finePointer.matches && !reduceMotion.matches) {
        document.querySelectorAll('.glow-card').forEach(function (card) {
            var rafId = null;
            var mouseX = 0;
            var mouseY = 0;

            card.addEventListener('pointermove', function (event) {
                var rect = card.getBoundingClientRect();
                mouseX = event.clientX - rect.left;
                mouseY = event.clientY - rect.top;

                if (rafId !== null) return;
                rafId = requestAnimationFrame(function () {
                    card.style.setProperty('--mouse-x', mouseX + 'px');
                    card.style.setProperty('--mouse-y', mouseY + 'px');
                    rafId = null;
                });
            }, { passive: true });
        });
    }


    /* === Mobile hamburger navigation === */
    var navToggle = document.querySelector('.nav-toggle');
    var navLinks = document.getElementById('nav-links');
    if (navToggle && navLinks) {
        navToggle.addEventListener('click', function () {
            var open = navLinks.classList.toggle('nav-open');
            navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });

        /* Close menu when a link is chosen */
        navLinks.addEventListener('click', function (event) {
            if (event.target.closest('a')) {
                navLinks.classList.remove('nav-open');
                navToggle.setAttribute('aria-expanded', 'false');
            }
        });

        /* Close on Escape and return focus to the toggle */
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && navLinks.classList.contains('nav-open')) {
                navLinks.classList.remove('nav-open');
                navToggle.setAttribute('aria-expanded', 'false');
                navToggle.focus();
            }
        });

        /* Focus trap: keep Tab cycling within the open mobile menu */
        navLinks.addEventListener('keydown', function (event) {
            if (!navLinks.classList.contains('nav-open')) return;
            if (event.key !== 'Tab') return;
            var focusables = Array.prototype.slice.call(navLinks.querySelectorAll('a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'));
            if (!focusables.length) return;
            var first = focusables[0];
            var last = focusables[focusables.length - 1];
            var active = document.activeElement;
            var inside = navLinks.contains(active);
            if (!inside) {
                /* Focus escaped the drawer (or started outside): pull it back
                   to the first item so Tab never lands in page content while
                   the menu is visually open. */
                event.preventDefault(); first.focus();
            } else if (event.shiftKey && active === first) {
                event.preventDefault(); last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault(); first.focus();
            }
        });

        /* Move focus into the menu when it opens */
        navToggle.addEventListener('click', function () {
            if (navLinks.classList.contains('nav-open')) {
                var firstLink = navLinks.querySelector('a[href], button:not([disabled]), summary');
                if (firstLink) firstLink.focus();
            }
        });

        /* Light dismiss: a click outside both the menu and the toggle closes
           the drawer (standard dialog behavior; also stops Tab from wandering
           into page content behind an open menu). */
        document.addEventListener('click', function (event) {
            if (!navLinks.classList.contains('nav-open')) return;
            var tgt = event.target;
            if (!tgt || typeof tgt.closest !== 'function') return;
            if (tgt.closest('#nav-links') || tgt.closest('.nav-toggle')) return;
            navLinks.classList.remove('nav-open');
            navToggle.setAttribute('aria-expanded', 'false');
        });

        /* Reset state if resized back to desktop.
           Threshold tracks the drawer breakpoint (nav v3 = 1024px). Before
           that the nav switched at 768px; now the drawer owns everything up
           to 1023px, so resizing 900 -> 1100px must NOT close an open menu. */
        window.addEventListener('resize', function () {
            if (window.innerWidth >= 1024 && navLinks.classList.contains('nav-open')) {
                /* If keyboard focus was inside the menu it is about to become
                   display:none — park it on the toggle instead of <body>. */
                var hadFocus = navLinks.contains(document.activeElement);
                navLinks.classList.remove('nav-open');
                navToggle.setAttribute('aria-expanded', 'false');
                if (hadFocus) {
                    /* At desktop width the toggle is display:none and cannot
                       take focus — park keyboard focus on the first inline
                       link instead of dropping it to <body>. */
                    var fallback = navToggle.offsetParent !== null ? navToggle
                        : navLinks.querySelector('a[href]');
                    if (fallback) fallback.focus();
                }
            }
        }, { passive: true });
    }

    /* === Falling frost petals canvas === */
    var canvas = document.getElementById('petalCanvas');
    if (!canvas) return;

    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var petals = [];
    var width = 0;
    var height = 0;
    var dpr = 1;
    var rafId = null;
    var resizeTimer = null;
    var lastViewportWidth = 0;
    var lastViewportHeight = 0;
    var PETAL_COUNT = 22;
    var gradientCache = {};
    var petalThemeLight = false;
    function refreshPetalTheme() { petalThemeLight = document.documentElement.getAttribute('data-theme') === 'light'; }
    refreshPetalTheme();
    /* The theme-color block (later IIFE) calls this through the window hook
       whenever data-theme changes — keeps cached gradients in sync. */
    window.__mspPetalThemeRefresh = refreshPetalTheme;

    function resize(force) {
        var nextWidth = window.innerWidth;
        var nextHeight = window.innerHeight;

        /* Ignore mobile browser-chrome height jitter unless the viewport truly
           changed. Height is tracked too: a desktop height-only resize (devtools
           open, window snapped) must still resize the canvas backing store. */
        if (!force && nextWidth === lastViewportWidth && nextHeight === lastViewportHeight) return;

        width = nextWidth;
        height = nextHeight;
        lastViewportWidth = nextWidth;
        lastViewportHeight = nextHeight;
        dpr = Math.min(window.devicePixelRatio || 1, 2);

        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function createPetal() {
        return {
            x: Math.random() * width,
            y: -20,
            size: 3 + Math.random() * 6,
            speedY: 0.35 + Math.random() * 0.9,
            speedX: -0.3 + Math.random() * 0.6,
            rotation: Math.random() * Math.PI * 2,
            rotSpeed: -0.012 + Math.random() * 0.024,
            opacity: 0.08 + Math.random() * 0.16,
            sway: Math.random() * Math.PI * 2,
            swaySpeed: 0.008 + Math.random() * 0.014,
            tone: Math.random() // 0 = frost/ice, 1 = sage/green
        };
    }

    function drawPetal(petal) {
        ctx.save();
        ctx.translate(petal.x, petal.y);
        ctx.rotate(petal.rotation);
        ctx.globalAlpha = petal.opacity;

        var light = petalThemeLight;
        /* Gradients are cached per (tone x size x theme): sizes are immutable
           per petal and the theme only changes on toggle, so re-reading
           data-theme and re-allocating 22 gradients per frame is pure waste. */
        var key = (petal.tone > 0.5 ? 's' : 'f') + petal.size + (light ? 'L' : 'D');
        var gradient = gradientCache[key];
        if (!gradient) {
            gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, petal.size);
            if (petal.tone > 0.5) {
                /* sage/green tone */
                gradient.addColorStop(0, light ? '#7EAD93' : '#C4E1CC');
                gradient.addColorStop(0.5, light ? '#5D8D72' : '#A3C9B6');
                gradient.addColorStop(1, light ? 'rgba(64, 105, 81, 0.24)' : 'rgba(93, 122, 110, 0.28)');
            } else {
                /* frost/ice tone */
                gradient.addColorStop(0, light ? '#A9C4C9' : '#DDE6E8');
                gradient.addColorStop(0.5, light ? '#7E9FA8' : '#B8CDD2');
                gradient.addColorStop(1, light ? 'rgba(94, 130, 145, 0.22)' : 'rgba(143, 175, 181, 0.26)');
            }
            gradientCache[key] = gradient;
        }
        ctx.fillStyle = gradient;

        ctx.beginPath();
        ctx.moveTo(0, -petal.size);
        ctx.bezierCurveTo(petal.size * 0.6, -petal.size * 0.5, petal.size * 0.6, petal.size * 0.5, 0, petal.size);
        ctx.bezierCurveTo(-petal.size * 0.6, petal.size * 0.5, -petal.size * 0.6, -petal.size * 0.5, 0, -petal.size);
        ctx.fill();
        ctx.restore();
    }

    function animate() {
        ctx.clearRect(0, 0, width, height);

        for (var i = 0; i < petals.length; i++) {
            var petal = petals[i];
            petal.sway += petal.swaySpeed;
            petal.x += petal.speedX + Math.sin(petal.sway) * 0.4;
            petal.y += petal.speedY;
            petal.rotation += petal.rotSpeed;

            if (petal.y > height + 20) petals[i] = createPetal();
            if (petal.x < -20) petal.x = width + 20;
            if (petal.x > width + 20) petal.x = -20;

            drawPetal(petals[i]);
        }

        rafId = requestAnimationFrame(animate);
    }

    function start() {
        if (rafId !== null || reduceMotion.matches || document.hidden) return;

        resize(true);
        petals.length = 0;

        for (var i = 0; i < PETAL_COUNT; i++) {
            var petal = createPetal();
            petal.y = Math.random() * height;
            petals.push(petal);
        }

        animate();
    }

    function stop() {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }

        petals.length = 0;
        ctx.clearRect(0, 0, width, height);
    }

    window.addEventListener('resize', function () {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(function () {
            if (window.innerWidth !== lastViewportWidth || window.innerHeight !== lastViewportHeight) resize(false);
        }, 150);
    }, { passive: true });

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) stop();
        else start();
    });

    var onReduceChange = function (event) {
        if (event.matches) {
            stop();
            forceRevealAll();
        } else {
            start();
        }
    };
    if (reduceMotion.addEventListener) reduceMotion.addEventListener('change', onReduceChange);
    else if (reduceMotion.addListener) reduceMotion.addListener(onReduceChange); /* old Safari <=13 */

    start();
    window.addEventListener('load', function () {
        if (rafId === null) start();
    }, { once: true });
})();


/* ==========================================================================
   Premium pack: theme toggle, back-to-top, magnetic CTAs, counters,
   command palette (Ctrl+K)
   ========================================================================== */
(function () {
    'use strict';

    var reduceMotionPm = window.matchMedia('(prefers-reduced-motion: reduce)');

    /* === Theme: load saved or system preference === */
    var root = document.documentElement;
    var saved = null;
    try { saved = localStorage.getItem('msp-theme'); } catch (e) {}
    if (saved) root.setAttribute('data-theme', saved);
    else if (window.matchMedia('(prefers-color-scheme: light)').matches) root.setAttribute('data-theme', 'light');

    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
            root.setAttribute('data-theme', next);
            try { localStorage.setItem('msp-theme', next); } catch (e) {}
        });
    });

    /* === Back to top === */
    var btt = document.querySelector('.back-to-top');
    if (btt) {
        var bttTick = false;
        window.addEventListener('scroll', function () {
            if (bttTick) return;
            bttTick = true;
            requestAnimationFrame(function () {
                btt.classList.toggle('visible', window.scrollY > 600);
                bttTick = false;
            });
        }, { passive: true });
    }

    /* === Magnetic CTAs (fine pointers only) === */
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches && !reduceMotionPm.matches) {
        document.querySelectorAll('.hero-btn-primary, .cta-btn, .form-submit, .nav-cta, .compare-cta').forEach(function (btn) {
            var raf = null;
            btn.addEventListener('pointermove', function (e) {
                if (raf !== null) return;
                raf = requestAnimationFrame(function () {
                    var r = btn.getBoundingClientRect();
                    var dx = (e.clientX - r.left - r.width / 2) / r.width;
                    var dy = (e.clientY - r.top - r.height / 2) / r.height;
                    btn.style.transform = 'translate(' + (dx * 6) + 'px,' + (dy * 4 - 2) + 'px)';
                    raf = null;
                });
            }, { passive: true });
            btn.addEventListener('pointerleave', function () {
                btn.style.transform = '';
            });
        });
    }

    /* === Command palette (Ctrl+K / Cmd+K) — dynamic index ===
       Pages are discovered from the nav links (present on every page) and
       services from the services page DOM — new pages or service cards
       appear in search automatically, no code changes needed. */
    var CMDK_ITEMS = [];
    var CMDK_SERVICES_LOADED = false;
    var CMDK_SERVICES_FETCHING = null;   /* in-flight fetch promise (null = idle) */
    var CMDK_SERVICES_FAILURES = 0;      /* cap: give up after 3 failed loads per page */
    var CMDK_SERVICE_ITEMS = [];         // parsed once, reused on every open
    var CMDK_LAST_SCORED = [];           /* [{item,s}] from the latest filter */
    var SERVICES_URL = '/services.html';

    function cmdkLoadServices() {
        /* Exactly ONE in-flight fetch of services.html per page load (the
           per-keystroke rebuild used to refire it until the first resolved). */
        if (CMDK_SERVICES_LOADED || CMDK_SERVICES_FETCHING) return;
        if (CMDK_SERVICES_FAILURES >= 3) return;   /* nav-only index is fine; stop hammering */
        CMDK_SERVICES_FETCHING = fetch(SERVICES_URL)
            .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)); })
            .then(function (html) {
                CMDK_SERVICES_LOADED = true;
                var parsed = cmdkParseCards(new DOMParser().parseFromString(html, 'text/html'));
                CMDK_SERVICE_ITEMS = parsed;
                CMDK_ITEMS = (cmdkBuildIndex._pages || []).concat(parsed);
                /* Re-render only if the palette is open AND the query is empty —
                   a user mid-keystroke or mid-arrow-selection keeps their
                   state; an empty query has no state to clobber. */
                if (backdrop.classList.contains('open') && !cmdkInput.value) {
                    cmdkFiltered = cmdkApplyFilter('');
                    cmdkActive = 0;
                    cmdkRender();
                }
            })
            .catch(function (err) {
                CMDK_SERVICES_FAILURES++;
                console.warn('[msp] cmdk services fetch failed (' + CMDK_SERVICES_FAILURES + '/3):', err && err.message ? err.message : err);
            })
            .then(function () { CMDK_SERVICES_FETCHING = null; });
    }

    function cmdkBuildIndex() {
        var items = [];
        var seen = {};

        // 1. Pages from nav links + footer columns (skip external links like
        //    GitHub and mailto:). The footer is the canonical page index now:
        //    the nav "More" dropdown was removed in the minimal-nav pass, so
        //    anything it used to contribute (Changelog, Donate, Suggest,
        //    Contact, About) must still be reachable from the palette.
        document.querySelectorAll('.nav-btn, .footer-col a').forEach(function (a) {
            var href = a.getAttribute('href');
            if (!href || href.indexOf('http') === 0 || href.indexOf('mailto:') === 0) return;
            var label = a.textContent.trim();
            if (!label || seen[href]) return;
            seen[href] = true;
            items.push({ label: label, url: href, kind: 'page',
                         keywords: (a.getAttribute('data-keywords') || '').trim().toLowerCase() });
        });

        // 1b. Home = wherever the brand logo points (dynamic, not assumed).
        //     Keywords come from the markup's data-keywords (single source of
        //     truth); the literal below is only a fallback.
        var logo = document.querySelector('.nav-logo[href]');
        if (logo) {
            var lhref = logo.getAttribute('href');
            if (lhref && lhref !== '#') {
                if (!seen[lhref]) {
                    seen[lhref] = true;
                    items.unshift({ label: 'Home', url: lhref, kind: 'page',
                                    keywords: ((logo.getAttribute('data-keywords') || '') + ' mysweetpea my sweet pea start front landing brand').trim().toLowerCase() });
                }
            }
        }

        // 1c. Any other INTERNAL anchor that carries data-keywords gets
        //     indexed too (nav CTA, breadcrumbs, in-body contextual links).
        //     This keeps the keywords contract honest: wherever an author
        //     writes data-keywords on a same-site link, search finds it.
        //     Only internal hrefs, and de-duped against earlier entries.
        document.querySelectorAll('a[data-keywords][href]').forEach(function (a) {
            var href = a.getAttribute('href');
            if (!href || seen[href]) return;
            if (/^(https?:)?\/\//i.test(href) || href.indexOf('mailto:') === 0) return;
            if (href.charAt(0) !== '/' && href.charAt(0) !== '#') return;
            var label = a.textContent.trim();
            if (!label) return;
            seen[href] = true;
            items.push({ label: label, url: href, kind: 'page',
                         keywords: a.getAttribute('data-keywords').trim().toLowerCase() });
        });

        // 2. Services parsed from the services page. When services.html itself
        //    is open we re-parse the LIVE DOM on every palette open (cheap —
        //    ~15 cards), so cards added/renamed even at runtime are picked up.
        //    On every other page we fetch services.html once per page load and
        //    latch on success (a transient fetch failure must not wipe service
        //    entries for the page lifetime). Either way the index tracks the
        //    markup — no hardcoded service list anywhere.
        cmdkBuildIndex._pages = items.slice();   /* pages-only snapshot for async rebuilds */
        var localDoc = document.querySelector('.service-card[data-service], .coming-soon-card[data-tier]') ? document : null;
        if (localDoc) {
            CMDK_SERVICE_ITEMS = cmdkParseCards(localDoc);
            CMDK_SERVICES_LOADED = true;
        } else {
            cmdkLoadServices();
        }
        items = items.concat(CMDK_SERVICE_ITEMS);
        CMDK_ITEMS = items;
        return items;
    }

    /* Resolves when the index is complete (services fetched or already
       present). MSPSearch consumers await this before trusting results. */
    function cmdkReady() {
        if (CMDK_SERVICES_LOADED) return Promise.resolve();
        cmdkLoadServices();
        return CMDK_SERVICES_FETCHING ? CMDK_SERVICES_FETCHING.then(function () {}) : Promise.resolve();
    }

    /* Card → index-entry parser shared by the live-DOM path and the fetched
       services.html path (identical shapes, one implementation). */
    function cmdkParseCards(root) {
        var parsed = [];
        root.querySelectorAll('.service-card[data-service], .coming-soon-card[data-tier]').forEach(function (card) {
            var h3 = card.querySelector('h3');
            if (!h3) return;
            var nameEl = h3.cloneNode(true);
            nameEl.querySelectorAll('.live-badge, .status-dot, .acct-pill, .sp-meta').forEach(function (n) { n.remove(); });
            var soon = card.hasAttribute('data-tier') && card.getAttribute('data-tier') === 'coming-soon';
            var name = nameEl.textContent.trim();
            var icon = card.querySelector('.icon-chip img') || card.querySelector('.service-icon img');
            var desc = card.querySelector('p');
            var kw = (card.getAttribute('data-keywords') || '').trim();
            parsed.push({
                label: name,
                url: SERVICES_URL,
                kind: soon ? 'coming soon' : 'service',
                icon: icon ? icon.getAttribute('src') : '',
                desc: desc ? desc.textContent.trim() : '',
                keywords: kw ? kw.toLowerCase() : ''
            });
        });
        return parsed;
    }

    /* Shared filter so the live input handler and the async refresh agree.
       Scoring keeps results coherent for vague/ambiguous input:
         100 exact/prefix · 80 word-start · 60 substring · 30 fuzzy
       Keywords and desc rank below the name so the title wins ties.
       Multi-word queries ("private netflix", "photo backup") require every
       word to hit somewhere; single-word typo matches count, but very short
       needles (1-2 chars) do NOT fuzzy-match — 'x' must not open Nextcloud. */
    function cmdkScore(hay, needle) {
        if (!hay) return -1;
        var idx = hay.indexOf(needle);
        if (idx === 0) return 100;          /* exact == prefix here */
        if (idx > 0) {
            /* right after a space/punct = word start */
            if (/[\s\-\/·—]/.test(hay.charAt(idx - 1))) return 80;
            return 60;
        }
        if (needle.length < 3) return -1;   /* too short to fuzzy-trust */
        /* fuzzy: all chars of needle in order inside hay (typo/partial class) */
        var hi = 0;
        for (var i = 0; i < needle.length; i++) {
            hi = hay.indexOf(needle.charAt(i), hi);
            if (hi === -1) return -1;
            hi++;
        }
        return 30;
    }
    function cmdkApplyFilter(rawQuery) {
        var q = (rawQuery || '').trim().toLowerCase();
        CMDK_LAST_SCORED = [];
        if (!q) return CMDK_ITEMS.slice();
        /* Stopwords carry no meaning for navigation - requiring them to match
           turns natural queries like "who runs this" into fuzzy noise. */
        var STOP = ['the','a','an','of','to','and','or','is','are','for','on','in','it','this','that','my','me','i','how','do','does','what','where','which','who','why','when','can','you','your'];
        var words = q.split(/\s+/).filter(function (w) {
            return w && STOP.indexOf(w) === -1;
        });
        /* de-dupe ("runs runs", "pricing pricing") so repeats don't double-count */
        words = words.filter(function (w, i) { return words.indexOf(w) === i; });
        if (!words.length) return CMDK_ITEMS.slice();
        var scored = [];
        CMDK_ITEMS.forEach(function (item) {
            var label = (item.label || '').toLowerCase();
            var kw = (item.keywords || '');
            var desc = (item.desc || '').toLowerCase();
            var total = 0, ok = true;
            for (var w = 0; w < words.length; w++) {
                var word = words[w];
                var best = cmdkScore(label, word);
                var kScore = cmdkScore(kw, word);
                if (kScore > best) best = Math.min(kScore + 5, 85); /* synonyms help, never beat the name */
                if (best < 0 && desc) {
                    var dScore = cmdkScore(desc, word);
                    /* desc hits qualify an item but rank below any name or
                       keyword hit — "Jellyfin library" in a tab description
                       must not outrank the actual Jellyfin service. */
                    if (dScore > 0) best = 10;
                }
                if (best < 0) { ok = false; break; }
                total += best;
            }
            if (ok) scored.push({ item: item, s: total });
        });
        scored.sort(function (a, b) { return b.s - a.s; });
        CMDK_LAST_SCORED = scored;
        return scored.map(function (x) { return x.item; });
    }

    var backdrop = document.createElement('div');
    backdrop.className = 'cmdk-backdrop';
    backdrop.innerHTML =
        '<div class="cmdk" role="dialog" aria-modal="true" aria-label="Quick navigation">' +
            '<input class="cmdk-input" type="text" placeholder="Jump to a page or service..." aria-label="Search pages and services">' +
            '<div class="cmdk-list" role="listbox"></div>' +
            '<div class="cmdk-hint"><span><kbd>&#x2191;&#x2193;</kbd> navigate</span><span><kbd>&#x23CE;</kbd> open</span><span><kbd>esc</kbd> close</span></div>' +
        '</div>';
    document.body.appendChild(backdrop);

    var cmdkInput = backdrop.querySelector('.cmdk-input');
    var cmdkList = backdrop.querySelector('.cmdk-list');
    var cmdkActive = 0;
    var cmdkFiltered = [];

    function cmdkRender() {
        if (!cmdkFiltered.length) {
            cmdkList.innerHTML = '<div class="cmdk-empty">No matches found.</div>';
            return;
        }
        function esc(s) {
            return String(s).replace(/[&<>"']/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
        }
        function safeUrl(u) {
            /* data is dev/DOM-scraped, but a javascript: URL in an href would
               execute on click - whitelist http(s) and relative paths. */
            var s = String(u || '#');
            return /^(https?:|\/|#)/i.test(s) ? s : '#';
        }
        cmdkList.innerHTML = cmdkFiltered.map(function (item, i) {
            var icon = item.icon ? '<img src="' + esc(item.icon) + '" alt="" loading="lazy">' : '';
            var desc = item.desc ? '<span class="cmdk-desc">' + esc(item.desc) + '</span>' : '';
            return '<a class="cmdk-item' + (i === cmdkActive ? ' active' : '') + '" href="' + esc(safeUrl(item.url)) + '" role="option" data-i="' + i + '">' +
                icon + '<span class="cmdk-label">' + esc(item.label) + desc + '</span><span class="cmdk-kind">' + esc(item.kind) + '</span></a>';
        }).join('');
    }

    var cmdkLastTrigger = null;
    function cmdkOpen() {
        cmdkLastTrigger = document.activeElement;
        backdrop.classList.add('open');
        cmdkInput.value = '';
        cmdkFiltered = cmdkBuildIndex();
        cmdkActive = 0;
        cmdkRender();
        cmdkInput.focus();
    }
    function cmdkClose() {
        if (!backdrop.classList.contains('open')) return;
        backdrop.classList.remove('open');
        /* Return focus to the invoking control (nav search button / Cmd+K
           context) so keyboard users are not dropped at <body>. */
        if (cmdkLastTrigger && typeof cmdkLastTrigger.focus === 'function') cmdkLastTrigger.focus();
        cmdkLastTrigger = null;
    }

    document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            backdrop.classList.contains('open') ? cmdkClose() : cmdkOpen();
            return;
        }
        if (!backdrop.classList.contains('open')) return;
        if (e.key === 'Escape') cmdkClose();
        else if (e.key === 'ArrowDown') { if (cmdkFiltered.length) { e.preventDefault(); cmdkActive = Math.min(cmdkActive + 1, cmdkFiltered.length - 1); cmdkRender(); } }
        else if (e.key === 'ArrowUp') { e.preventDefault(); cmdkActive = Math.max(cmdkActive - 1, 0); cmdkRender(); }
        else if (e.key === 'Enter' && cmdkFiltered[cmdkActive]) { window.location.href = cmdkFiltered[cmdkActive].url; }
        else if (e.key === 'Tab') {
            /* Minimal focus trap: the backdrop is aria-modal - keep Tab cycling
               inside the palette instead of leaking to the page behind. */
            var f = backdrop.querySelectorAll('input, a.cmdk-item, button');
            if (f.length) {
                var first = f[0], last = f[f.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        }
    });

    cmdkInput.addEventListener('input', function () {
        /* Re-scan before filtering: the index is cheap to rebuild (a couple of
           querySelectorAll passes), and this keeps results correct even if the
           underlying pages/markup changed while the palette is open. */
        cmdkBuildIndex();
        cmdkFiltered = cmdkApplyFilter(cmdkInput.value);
        cmdkActive = 0;
        cmdkRender();
    });


    /* === Search trigger buttons open the palette === */
    document.querySelectorAll('.nav-search').forEach(function (btn) {
        btn.addEventListener('click', cmdkOpen);
    });

    backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop) cmdkClose();
    });

    /* Public search API — other pages (e.g. the 404 search box) reuse the
       same dynamic index + fuzzy scorer instead of keeping their own copy. */
    window.MSPSearch = {
        query: function (q) { cmdkBuildIndex(); return cmdkApplyFilter(q); },
        /* Navigate to the best match. Single-word queries: typo/fuzzy-only
           hits (score 30) still go — one-char-off intent ("jelyfin") beats
           a dead end on a dedicated search box. Multi-word queries: every
           word must have matched (filter guarantees it), so trust the top. */
        goto: function (q) {
            cmdkBuildIndex();
            cmdkApplyFilter(q);
            var top = CMDK_LAST_SCORED[0];
            /* Filtered matches are always >=30 (substring floor); the real
               junk guard is the filter itself — 1-2 char needles can't
               fuzzy-match, so "x" produces zero scored results. */
            if (top) { window.location.href = top.item.url; return true; }
            return false;
        },
        /* Resolves when the full index (pages + services) is ready —
           consumers should await this before trusting query()/goto(). */
        ready: function () { return cmdkReady(); },
        /* Pre-warms the service index (call once on page load). */
        warm: function () { cmdkBuildIndex(); }
    };
})();

/* === Global copy-email buttons (class="copy-email-btn" data-copy="...") ===
   Copies the address and shows "Copied!" feedback so users know it worked. */
(function() {
    document.addEventListener('click', function(e) {
        var btn = e.target.closest('.copy-email-btn');
        if (!btn) { return; }
        var text = btn.getAttribute('data-copy') || btn.getAttribute('data-email') || '';
        if (!text) { return; }
        /* Swap ONLY a dedicated .copy-label text node when present (buttons
           may contain icons - textContent nuked them permanently); show
           'Copied!' on real success, 'Copy failed' on real failure. */
        var label = btn.querySelector('.copy-label');
        var savedLabel = label ? label.textContent : null;
        var busy = btn.classList.contains('copied') || btn.classList.contains('copy-failed');
        if (busy) return;
        function feedback(cls, msg) {
            btn.classList.add(cls);
            if (label) label.textContent = msg;
            else if (btn.children.length === 0) btn.textContent = msg;
            setTimeout(function() {
                btn.classList.remove(cls);
                if (label) label.textContent = savedLabel;
                else if (btn.children.length === 0) btn.textContent = savedLabel;
            }, 2000);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(
                function() { feedback('copied', 'Copied!'); },
                function() { feedback('copy-failed', 'Copy failed'); }
            );
        } else {
            var ta = document.createElement('textarea');
            ta.value = text; document.body.appendChild(ta); ta.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (err) {}
            document.body.removeChild(ta);
            feedback(ok ? 'copied' : 'copy-failed', ok ? 'Copied!' : 'Copy failed');
        }
    });
})();

/* ==========================================================================
   v35: Scroll-linked hero fade, welcome modal, card stagger, auto theme
   ========================================================================== */
(function () {
    'use strict';

    /* === Scroll-linked hero fade ===
       Only fade the hero once the user has scrolled past most of it,
       so the headline, buttons, and steps stay readable while on screen. */
    var hero = document.querySelector('.hero');
    if (hero) {
        var heroTick = false;
        function heroFadeThreshold() {
            return Math.max(hero.offsetHeight * 0.85, window.innerHeight * 0.6);
        }
        window.addEventListener('scroll', function () {
            if (heroTick) return;
            heroTick = true;
            requestAnimationFrame(function () {
                hero.classList.toggle('hero-faded', window.scrollY > heroFadeThreshold());
                heroTick = false;
            });
        }, { passive: true });
        window.addEventListener('resize', function () { hero.classList.toggle('hero-faded', window.scrollY > heroFadeThreshold()); });
    }

    /* === Card entrance stagger (index-based) === */
    var grids = document.querySelectorAll('.features-grid, .services-grid, .coming-soon-grid, .testimonials-grid, .members-teaser-grid');
    var staggerReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    grids.forEach(function (grid) {
        Array.prototype.forEach.call(grid.children, function (card, i) {
            if (staggerReduced) return;
            var delay = Math.min(i * 0.08, 0.5);
            card.style.transitionDelay = delay + 's';
            /* Clear after the entrance so hover/press transitions are not
               delayed by up to 0.5s for the life of the page. transitionend
               is NOT guaranteed (offscreen cards, backgrounded tabs, reduced
               motion) — the timeout is the safety net. */
            var cleared = false;
            function clearDelay() {
                if (cleared) return;
                cleared = true;
                card.style.transitionDelay = '';
                card.removeEventListener('transitionend', onEnd);
                clearTimeout(timer);
            }
            function onEnd(e) {
                if (e.target !== card) return;
                clearDelay();
            }
            var timer = setTimeout(clearDelay, (delay + 1.2) * 1000);
            card.addEventListener('transitionend', onEnd);
        });
    });

    /* === Auto theme from OS preference (only if no saved choice) === */
    var root = document.documentElement;
    var savedTheme = null;
    try { savedTheme = localStorage.getItem('msp-theme'); } catch (e) {}
    if (!savedTheme && window.matchMedia('(prefers-color-scheme: light)').matches) {
        root.setAttribute('data-theme', 'light');
    }
    /* Live OS-theme sync (only while no explicit saved choice exists -
       a saved msp-theme always wins until the user clears it). */
    if (window.matchMedia) {
        var osScheme = window.matchMedia('(prefers-color-scheme: light)');
        var schemeHandler = function (e) {
            var saved = null;
            try { saved = localStorage.getItem('msp-theme'); } catch (err) {}
            if (saved) return;
            root.setAttribute('data-theme', e.matches ? 'light' : 'dark');
        };
        if (typeof osScheme.addEventListener === 'function') osScheme.addEventListener('change', schemeHandler);
        else if (typeof osScheme.addListener === 'function') osScheme.addListener(schemeHandler);
    }

    /* === First-visit welcome modal — removed per request === */
})();

/* ==========================================================================
   v37: Garden pollen particles + vine dividers
   ========================================================================== */
(function () {
    'use strict';
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduceMotion.matches) return;


    document.querySelectorAll('.vine-divider').forEach(function (el) { el.innerHTML = '<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        /* main stems */
        '<path d="M32 6C22 10 16 20 18 32c2 12 12 20 14 26" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M32 6c10 4 16 14 14 26-2 12-12 20-14 26" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".5"/>' +
        /* leaves along left stem */
        '<path d="M20 18c-4-1-7-5-6-9 4 0 7 4 6 9Z" fill="currentColor" opacity=".6"/>' +
        '<path d="M19 26c-4-1-7-5-6-9 4 0 7 4 6 9Z" fill="currentColor" opacity=".5"/>' +
        '<path d="M19 34c-4-1-7-5-6-9 4 0 7 4 6 9Z" fill="currentColor" opacity=".4"/>' +
        /* leaves along right stem */
        '<path d="M44 18c4-1 7-5 6-9-4 0-7 4-6 9Z" fill="currentColor" opacity=".6"/>' +
        '<path d="M45 26c4-1 7-5 6-9-4 0-7 4-6 9Z" fill="currentColor" opacity=".5"/>' +
        '<path d="M45 34c4-1 7-5 6-9-4 0-7 4-6 9Z" fill="currentColor" opacity=".4"/>' +
        /* tendrils (curls) */
        '<path d="M18 32c-5-1-8-5-7-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".6"/>' +
        '<path d="M46 32c5-1 8-5 7-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".6"/>' +
        /* center bloom */
        '<circle cx="32" cy="32" r="3" fill="currentColor" opacity=".8"/>' +
        '<circle cx="32" cy="32" r="5.5" fill="none" stroke="currentColor" stroke-width="1" opacity=".4"/>' +
        '</svg>'; });

    /* === Floating garden pollen particles (motion-gated, mid-session aware) === */
    var pollen = document.createElement('div');
    pollen.className = 'garden-pollen';
    pollen.setAttribute('aria-hidden', 'true');
    document.body.appendChild(pollen);

    var COUNT = 14;
    function pollenSet(on) {
        /* display:none kills the CSS animation without rebuilding spans —
           and a mid-session OS reduced-motion flip is honored live. */
        pollen.style.display = on ? '' : 'none';
    }
    for (var i = 0; i < COUNT; i++) {
        var span = document.createElement('span');
        var size = 3 + Math.random() * 5;
        span.style.width = size + 'px';
        span.style.height = size + 'px';
        span.style.left = (Math.random() * 100) + '%';
        span.style.animationDuration = (12 + Math.random() * 14) + 's';
        span.style.animationDelay = (Math.random() * 12) + 's';
        pollen.appendChild(span);
    }
    pollenSet(!reduceMotion.matches);
    if (typeof reduceMotion.addEventListener === 'function') {
        reduceMotion.addEventListener('change', function (e) { pollenSet(!e.matches); });
    } else if (typeof reduceMotion.addListener === 'function') {
        reduceMotion.addListener(function (e) { pollenSet(!e.matches); });
    }

    /* (vine injection moved above the motion gate — static decoration) */
})();

/* ==========================================================================
   v40: Live status, notify buttons, dashboard teaser, redeem live check
   ========================================================================== */
(function () {
    'use strict';

    /* === Live service status pill (home page) ===
       Shows REAL data from Uptime Kuma. Never claims "all operational"
       when the API is unreachable — that would hide real outages. */
    var homeStatus = document.getElementById('homeStatus');
    var homeStatusText = document.getElementById('homeStatusText');
    /* The dot's color is driven by .home-status.online/.degraded/.offline via
       CSS (site.css) — no per-dot JS state needed. */
    if (homeStatus && homeStatusText) {
        var STATUS_NAMES = {
            1: 'Vaultwarden', 2: 'Matrix', 3: 'AFFiNE', 4: 'KoalaSync',
            5: 'Jellyfin', 6: 'Seerr', 7: 'Nextcloud', 8: 'Immich', 9: 'Open WebUI'
        };
        var STATUS_TOTAL = Object.keys(STATUS_NAMES).length; /* single source of truth */
        /* A hung connection must degrade to the honest catch path like any
           other failure — race the request against a 10s timeout. */
        var aborter = ('AbortController' in window) ? new AbortController() : null;
        var abortTimer = aborter ? setTimeout(function () { aborter.abort(); }, 10000) : 0;
        function clearAbortTimer() { if (abortTimer) { clearTimeout(abortTimer); abortTimer = 0; } }
        fetch('https://status.mysweetpea.cc/api/status-page/heartbeat/public', aborter ? { signal: aborter.signal } : {})
            .then(function (r) { clearAbortTimer(); return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
            .then(function (data) {
                var hb = data && data.heartbeatList;
                if (!hb) throw new Error('no data');
                var down = [], seen = 0;
                // Count only our known service monitors — the public page
                // also includes the mysweetpea.cc website itself.
                Object.keys(STATUS_NAMES).forEach(function (id) {
                    var list = hb[id];
                    if (!list || !list.length) return; /* counted below as not reporting */
                    seen++;
                    var last = list[list.length - 1];
                    /* Kuma: 0=down, 1=up, 2=pending, 3=maintenance — only a
                       confirmed 0 counts as down (binary display per user call). */
                    if (last.status === 0) {
                        down.push(STATUS_NAMES[id] || ('Service ' + id));
                    }
                });
                var notReporting = STATUS_TOTAL - seen;
                if (seen === 0) {
                    /* Payload with data for NONE of our monitors (malformed
                       response or Kuma renumbering): claiming "all
                       operational" here would be a lie. */
                    homeStatusText.textContent = 'Status unavailable — check the status page';
                    homeStatus.classList.remove('online', 'offline');
                    homeStatus.classList.add('degraded');
                } else if (notReporting > 0) {
                    /* Monitors missing/empty from the payload are UNKNOWN,
                       not healthy — a service that stopped reporting must not
                       silently count as operational. */
                    homeStatusText.textContent = down.length + ' of ' + STATUS_TOTAL + ' down · ' + notReporting + ' not reporting';
                    homeStatus.classList.remove('online');
                    homeStatus.classList.add(down.length > 0 ? 'offline' : 'degraded');
                } else if (down.length === 0) {
                    homeStatusText.textContent = 'All systems operational';
                    homeStatus.classList.remove('degraded', 'offline');
                    homeStatus.classList.add('online');
                } else {
                    homeStatusText.textContent = down.length + ' of ' + STATUS_TOTAL + ' services down: ' + down.join(', ');
                    homeStatus.classList.remove('online');
                    homeStatus.classList.add('offline');
                }
            })
            .catch(function (err) {
                clearAbortTimer();
                // API unreachable — say so honestly instead of faking "operational".
                console.warn('[msp] home status fetch failed:', err && err.message ? err.message : err);
                homeStatusText.textContent = 'Status unavailable — check the status page';
                homeStatus.classList.remove('online');
                homeStatus.classList.add('degraded');
            });
    }

    /* === Notify-me buttons (coming-soon services) — removed per request === */

    /* === Redeem: live invite-code check (webhook) ===
       MOVED into assets/js/redeem-page.js (single owner — this block ran BEFORE
       the dynamically-created #rc-code input existed, so it never attached after
       the script was externalized; every edit now re-checks from there). */
    

    })();

/* === Update meta theme-color on theme change ===
       Observes data-theme on <html> instead of guessing from .theme-toggle
       clicks: deterministic, covers OS-preference flips and any other script
       that changes the theme, no 50ms race. */
(function () {
    /* Pages ship TWO media-scoped metas (dark + light); the browser picks the
       right one per OS scheme, so each only ever needs its OWN color. Legacy
       single-meta pages (no media attr) get both values written as before. */
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    if (!metas.length) return;
    function update() {
        var light = document.documentElement.getAttribute('data-theme') === 'light';
        var COLORS = { dark: '#0C1316', light: '#D8E1DD' };
        var active = light ? COLORS.light : COLORS.dark;
        var sawMedia = false;
        metas.forEach(function (m) {
            var media = m.getAttribute('media') || '';
            if (media.indexOf('light') !== -1) { sawMedia = true; if (light) m.setAttribute('content', COLORS.light); }
            else if (media.indexOf('dark') !== -1) { sawMedia = true; if (!light) m.setAttribute('content', COLORS.dark); }
        });
        if (!sawMedia) {
            /* single unscoped meta: write the active color */
            metas[0].setAttribute('content', active);
        }
        if (typeof window.__mspPetalThemeRefresh === 'function') window.__mspPetalThemeRefresh();
    }
    update();
    new MutationObserver(update).observe(document.documentElement, { attributeFilter: ['data-theme'] });
})();

/* ==========================================================================
   v42: View-switcher (no-scroll tabs) — pricing + services
   ========================================================================== */
(function () {
    'use strict';
    document.querySelectorAll('.view-switcher').forEach(function (switcher) {
        /* WAI-ARIA tabs wiring: give each tab its panel relationship
           (aria-controls ↔ id/aria-labelledby) once at init. Panels get
           tabindex="0" when active so keyboard users can reach scrolled
           panel content. */
        switcher.querySelectorAll('.view-tab').forEach(function (tab, ti) {
            if (!tab.id) tab.id = switcher.id ? switcher.id + '-tab-' + ti : 'vw-tab-' + ti;
        });
        switcher.querySelectorAll('.view-panel').forEach(function (panel, pi) {
            if (!panel.id) panel.id = switcher.id ? switcher.id + '-panel-' + pi : 'vw-panel-' + pi;
        });
        switcher.querySelectorAll('.view-tab').forEach(function (tab) {
            var view = tab.getAttribute('data-view');
            /* attribute comparison instead of a selector built from the raw
               value — a data-view containing quotes/brackets would throw a
               SyntaxError and abort wiring for every later switcher. */
            var panel = null;
            switcher.querySelectorAll('.view-panel').forEach(function (p) {
                if (p.getAttribute('data-view') === view) panel = p;
            });
            if (panel) {
                tab.setAttribute('aria-controls', panel.id);
                panel.setAttribute('aria-labelledby', tab.id);
            }
        });
        var tabs = switcher.querySelectorAll('.view-tab');
        var panels = switcher.querySelectorAll('.view-panel');

        function activate(view) {
            tabs.forEach(function (t) {
                var active = t.getAttribute('data-view') === view;
                t.classList.toggle('active', active);
                t.setAttribute('aria-selected', active ? 'true' : 'false');
                /* Roving tabindex: exactly one tab per switcher stays in the
                   Tab order (WAI-ARIA tabs pattern). */
                t.tabIndex = active ? 0 : -1;
            });
            panels.forEach(function (p) {
                var active = p.getAttribute('data-view') === view;
                p.classList.toggle('active', active);
                /* Active panel is focusable so keyboard users can scroll it
                   (WAI-ARIA tabs pattern requires a focusable panel). */
                p.tabIndex = active ? 0 : -1;
                /* CSS-only hiding breaks when the stylesheet is late or off:
                   the hidden attribute keeps panels out of the a11y tree and
                   layout regardless. */
                if (p.hasAttribute('hidden') !== !active) {
                    if (active) p.removeAttribute('hidden');
                    else p.setAttribute('hidden', '');
                }
                // Reveal any .reveal elements inside the now-active panel so
                // FAQ/content isn't stuck hidden when switching tabs.
                if (active) {
                    p.querySelectorAll('.reveal').forEach(function (el) {
                        el.classList.add('visible');
                    });
                }
            });
        }

        tabs.forEach(function (tab, idx) {
            tab.addEventListener('click', function () {
                activate(tab.getAttribute('data-view'));
                tab.focus();
            });
            tab.addEventListener('keydown', function (e) {
                var dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
                    : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
                if (!dir) return;
                e.preventDefault();
                var n = tabs.length;
                var next = tabs[((idx + dir) % n + n) % n];
                activate(next.getAttribute('data-view'));
                next.focus();
            });
        });

        /* Normalize on load: sync hidden attrs + roving tabindex for the
           initially-active view (markup may omit hidden; CSS-only hiding
           breaks when the stylesheet is late or off). */
        tabs.forEach(function (tab) {
            if (tab.classList.contains('active')) { activate(tab.getAttribute('data-view')); }
        });

        // Support deep-linking: ?view=services opens that tab.
        // Only activate a view this switcher actually owns — an unknown value
        // (stale link, typo) must keep the default panel, not blank the page.
        var params = new URLSearchParams(window.location.search);
        var initial = params.get('view');
        if (initial) {
            var valid = false;
            tabs.forEach(function (tab) { if (tab.getAttribute('data-view') === initial) valid = true; });
            if (valid) activate(initial);
        }
    });
})();

/* ==========================================================================
   v45: Global click delegation — CSP-safe replacement for inline onclick
   handlers. The worker's strict CSP (script-src nonce-only) blocks inline
   event handler attributes, so every page's onclick=... is bound here via
   data-action attributes. Keep this in sync with the pages.
   ========================================================================== */
(function () {
    'use strict';

    document.addEventListener('click', function (event) {
        /* event.target can be document/documentElement/text (synthetic
           dispatch) — guard before dereferencing .closest. */
        var tgt = event.target;
        if (!tgt || typeof tgt.closest !== 'function') return;
        var el = tgt.closest('[data-action]');
        if (!el) return;
        var action = el.getAttribute('data-action');

        if (action === 'close-portal') {
            // The v46 easter-egg block owns the portal state machine; ask it
            // to close so its armed/open flags stay consistent.
            document.dispatchEvent(new CustomEvent('portal-close-request'));
            return;
        }
        if (action === 'back-to-top') {
            event.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }
        if (action === 'toggle-faq') {
            var item = el.parentElement;
            if (!item) return; /* malformed branch must not kill the shared bus */
            var open = item.classList.toggle('open');
            el.setAttribute('aria-expanded', String(open));
            return;
        }
        if (action === 'close-modal') {
            if (typeof closeModal === 'function') closeModal();
            return;
        }
        if (action === 'select-crypto') {
            if (typeof selectCrypto === 'function') selectCrypto(el, el.getAttribute('data-type'));
            return;
        }
        if (action === 'copy-wallet') {
            if (typeof copyWallet === 'function') copyWallet();
            return;
        }
    });
})();

/* ==========================================================================
   v47: Hermes-style portal easter egg — click "Support the Project" on
   about.html ARMS the reveal: a "keep scrolling…" hint appears above the
   trigger text, and the girl fades in as the footer scrolls past, blending
   into the page background (like hermes-agent.nousresearch.com). Scrolling
   back up conceals her. The footer-bottom line stays visible on top.
   Close via × / Escape.
   ========================================================================== */
(function () {
    'use strict';
    var supportTrigger = document.getElementById('supportTrigger');
    var portal = document.getElementById('portalReveal');
    var hint = document.getElementById('portalHint');
    if (!supportTrigger || !portal) return;

    var armed = false;
    var open = false;
    var video = portal.querySelector('video');
    var spacer = document.getElementById('portalSpacer');
    /* Keep the MediaQueryList and read .matches at use time so a mid-session
       OS reduced-motion change is honored (a load-time snapshot goes stale). */
    var reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    function setOpacity(o) {
        // Gradual fade: opacity ramps 0→1 with scroll (Hermes-style), so the
        // girl fades in as the cover lifts instead of popping in.
        portal.style.opacity = String(o);
        if (o > 0.98 && !open) {
            open = true;
            portal.classList.add('open');
            portal.setAttribute('aria-hidden', 'false');
            if (hint) hint.classList.remove('visible');
            if (video && video.paused) { video.play().catch(function (err) { console.warn('[msp] portal video blocked:', err && err.name ? err.name : err); }); }
        } else if (o <= 0.98 && open) {
            open = false;
            portal.classList.remove('open');
            portal.setAttribute('aria-hidden', 'true');
            if (video) video.pause();
        }
    }

    function onScroll() {
        if (!armed) return;
        var vh = window.innerHeight;
        var o = 0;
        if (spacer) {
            var top = spacer.getBoundingClientRect().top;
            // The spacer is 100vh tall when armed. Opacity ramps 0→1 as the
            // spacer's top travels from the viewport bottom up to the top —
            // the girl is fully revealed exactly at the page end.
            o = (vh - top) / vh;
        } else {
            // Fallback: last 45% of the page.
            var doc = document.documentElement;
            var max = doc.scrollHeight - vh;
            if (max > 0) o = (vh * 0.45 - (max - (window.scrollY || doc.scrollTop || 0))) / (vh * 0.45);
        }
        o = Math.max(0, Math.min(1, o));
        setOpacity(o);
    }

    function close() {
        if (!armed && !open) return;
        armed = false;
        open = false;
        portal.classList.remove('open', 'armed');
        portal.setAttribute('aria-hidden', 'true');
        portal.style.opacity = '';
        if (spacer) spacer.classList.remove('armed');
        if (hint) hint.classList.remove('visible');
        if (video) video.pause();
        document.removeEventListener('scroll', onScroll, { passive: true });
        window.removeEventListener('resize', onScroll);
    }

    supportTrigger.addEventListener('click', function (e) {
        // Never interfere with the Donate Now button — this is the h2 text only.
        e.preventDefault();
        if (armed || open) { close(); return; }
        armed = true;
        portal.classList.add('armed');
        /* aria-hidden stays true until the portal is actually perceivable
           (setOpacity flips it when opacity > 0.98) — otherwise its content
           sits in the accessibility tree while still invisible. */
        portal.setAttribute('aria-hidden', 'true');
        if (spacer) spacer.classList.add('armed');
        if (hint) hint.classList.add('visible');
        // Start the video on arm so she's already animating when the cover lifts.
        if (video && video.paused) { video.play().catch(function (err) { console.warn('[msp] portal video blocked:', err && err.name ? err.name : err); }); }
        if (reduceMotionQuery.matches) {
            // Reduced motion: reveal immediately instead of scroll-ramping.
            setOpacity(1);
        } else {
            document.addEventListener('scroll', onScroll, { passive: true });
            window.addEventListener('resize', onScroll);
            onScroll();
        }
    });
    /* Mid-session OS reduced-motion flips must re-evaluate an armed portal:
       ramps start (listeners attach) or collapse to the instant reveal. */
    function onReduceChange(e) {
        if (!armed) return;
        if (e.matches) {
            document.removeEventListener('scroll', onScroll, { passive: true });
            window.removeEventListener('resize', onScroll);
            setOpacity(1);
        } else {
            document.addEventListener('scroll', onScroll, { passive: true });
            window.addEventListener('resize', onScroll);
            onScroll();
        }
    }
    if (typeof reduceMotionQuery.addEventListener === 'function') {
        reduceMotionQuery.addEventListener('change', onReduceChange);
    } else if (typeof reduceMotionQuery.addListener === 'function') {
        reduceMotionQuery.addListener(onReduceChange);
    }

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && (open || armed)) close();
    });
    document.addEventListener('portal-close-request', close);
})();

/* ==========================================================================
   v44: Home value-tabs (Privacy / Ownership / Community)
   ========================================================================== */
(function () {
    'use strict';
    var tabs = document.querySelectorAll('.value-tab');
    var cards = document.querySelectorAll('.features-grid .feature-card');
    if (!tabs.length || !cards.length) return;

    function show(value) {
        tabs.forEach(function (t) {
            var on = t.getAttribute('data-value') === value;
            t.classList.toggle('active', on);
            t.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        cards.forEach(function (c) {
            var on = c.getAttribute('data-value') === value;
            c.classList.toggle('show', on);
            // Reveal may never have fired for cards that were display:none when the
            // IntersectionObserver scanned — mark them visible as they are shown.
            if (on) c.classList.add('visible');
        });
    }

    tabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
            var v = tab.getAttribute('data-value');
            if (v) show(v);
        });
    });

    // Show the first value's cards by default
    var initial = tabs[0].getAttribute('data-value');
    show(initial);
})();

/* === Nav: reflect the signed-in state (nav v3) ===
   The account chip's inline script swaps its label to the user's first name once
   /api/auth/state reports a session; we watch for that and tag the nav so the
   stylesheet can promote the chip to the primary action and hide "Get Access".
   Pure CSS would need :has(), which the user's iOS Safari does not support
   reliably; a class set here avoids both that and any new inline script (the
   CSP is a sha256 allowlist).

   The LABEL alone is the signal, deliberately. The chip rewrites it away from
   "Sign in" only after auth/state reports logged_in, so it cannot fire for a
   signed-out visitor. Watching the avatar instead would be wrong: /api/avatar
   is a proxy and avatars are optional, so a signed-in user without one takes
   the chip's onerror path (display:none, hidden stays true) and would never be
   promoted — leaving "Get Access" beside their own name. */
(function () {
    'use strict';
    var nav = document.querySelector('.top-nav');
    var label = document.getElementById('nav-account-label');
    if (!nav || !label) return;

    function sync() {
        var name = (label.textContent || '').trim();
        nav.classList.toggle('nav-signed-in', name !== '' && name !== 'Sign in');
    }

    new MutationObserver(sync).observe(label, { childList: true, characterData: true, subtree: true });
    sync();
})();

/* ==========================================================================
   v109: Theme-aware logo + icon swap (light theme gets the polished
   light-variant files). Assets on this site are served from the domain
   root — the SWAPS table keys on the pathname, so this module depends on
   that (any base-path/CDN rewrite would break the match).
   Rule: light variant filename = dark filename with '-light' before the
   extension. Add a DARK path here and the light one is derived.
   ========================================================================== */
    (function () {
    'use strict';
    var SWAPS = [
        '/logo.svg',
        '/assets/icons/affine2.svg',
        '/assets/icons/feature-open-v2.svg',
        '/assets/icons/feature-free-v2.svg',
        '/assets/icons/feature-private.svg',
        '/assets/icons/feature-community-v2.svg',
        '/assets/icons/feature-selfhosted-v2.svg',
        '/assets/icons/feature-experimental.svg'
    ];
    function lightPath(p) {
        var slash = p.lastIndexOf('/');
        var dot = p.lastIndexOf('.');
        if (dot <= slash + 1) return null;   /* no extension (or dot at dir start) — not swappable */
        return p.slice(0, dot) + '-light' + p.slice(dot);
    }
    function applyThemeAssets() {
        var light = document.documentElement.getAttribute('data-theme') === 'light';
        document.querySelectorAll('img').forEach(function (img) {
            var raw = img.getAttribute('src') || '';
            if (!raw || raw.indexOf('data:') === 0) return;
            var path;
            try { path = new URL(raw, location.href).pathname; } catch (e) { return; }
            for (var i = 0; i < SWAPS.length; i++) {
                var dark = SWAPS[i];
                var lit = lightPath(dark);
                if (!lit) continue;   /* extensionless entry can never swap */
                if (path === lit && !light) { img.setAttribute('src', dark); return; }
                if (path === dark && light) { img.setAttribute('src', lit); return; }
            }
        });
    }
    applyThemeAssets();
    new MutationObserver(applyThemeAssets).observe(document.documentElement, { attributeFilter: ['data-theme'] });
    /* premium.js injects the ascii-logo <img> after this script runs (both
       are defer, premium.js is later in the DOM). premium.js sets the
       theme-correct src itself at creation; the load sweep + short timer
       below cover any other late-injected themed images. */
    window.addEventListener('load', applyThemeAssets);
    setTimeout(applyThemeAssets, 300);
})();
