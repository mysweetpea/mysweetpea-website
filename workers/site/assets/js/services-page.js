/* === Coming-soon grid (dynamic, from site-data.json) ======================
   Static cards stay the SEO/no-JS skeleton. At runtime the grid follows the
   validated comingSoon list: cards are adopted by name (never duplicated),
   missing ones appended, retired ones hidden. createElement/textContent only. */
(function reconcileComingSoon() {
    if (!window.MSP) return;
    var grid = document.querySelector('.coming-soon-grid');
    if (!grid) return;
    window.MSP.data().then(function (d) {
        if (!d || !d.comingSoon) return;
        var cards = Array.prototype.slice.call(grid.querySelectorAll('.coming-soon-card'));
        var i, j;
        /* adopt by name match */
        cards.forEach(function (card) {
            var h = card.querySelector('h3');
            var txt = h ? String(h.textContent).trim().toLowerCase() : '';
            var match = null;
            for (j = 0; j < d.comingSoon.length; j++) {
                if (d.comingSoon[j].name.toLowerCase() === txt) { match = d.comingSoon[j]; break; }
            }
            if (match) card.setAttribute('data-cs-key', match.key);
            else card.setAttribute('hidden', ''); /* retired */
        });
        /* append missing */
        var last = null;
        d.comingSoon.forEach(function (cs) {
            var existing = grid.querySelector('.coming-soon-card[data-cs-key="' + cs.key + '"]');
            if (existing) { last = existing; return; }
            var card = document.createElement('div');
            card.className = 'coming-soon-card reveal reveal-delay-1';
            card.setAttribute('data-tier', 'coming-soon');
            card.setAttribute('data-cs-key', cs.key);
            card.setAttribute('data-keywords', cs.keywords);
            var inner = document.createElement('div'); inner.className = 'card-inner';
            var row1 = document.createElement('div'); row1.className = 'row1';
            var si = document.createElement('div'); si.className = 'service-icon';
            var img = document.createElement('img');
            img.src = cs.icon; img.alt = cs.iconAlt || cs.name; img.width = 40; img.height = 40;
            img.loading = 'lazy'; img.decoding = 'async';
            si.appendChild(img);
            var h3 = document.createElement('h3'); h3.textContent = cs.name;
            row1.appendChild(si); row1.appendChild(h3);
            var row2 = document.createElement('div'); row2.className = 'row2';
            var meta = document.createElement('span'); meta.className = 'sp-meta sp-meta-planned';
            meta.textContent = 'PLANNED';
            row2.appendChild(meta);
            var blurb = document.createElement('p'); blurb.className = 'svc-blurb';
            blurb.textContent = cs.blurb;
            var foot = document.createElement('div'); foot.className = 'card-foot';
            var hb = document.createElement('span'); hb.className = 'hb-uptime';
            hb.textContent = 'QUEUED';
            var pill = document.createElement('span'); pill.className = 'tier-pill tier-pill-soon';
            pill.textContent = 'Coming Soon';
            foot.appendChild(hb); foot.appendChild(pill);
            inner.appendChild(row1); inner.appendChild(row2); inner.appendChild(blurb); inner.appendChild(foot);
            card.appendChild(inner);
            if (last && last.nextSibling) grid.insertBefore(card, last.nextSibling);
            else grid.appendChild(card);
            last = card;
        });
        /* re-fill the queued chip now that the grid may have grown */
        var chip = document.getElementById('csQueued');
        if (chip) {
            var n = grid.querySelectorAll('.coming-soon-card:not([hidden])').length;
            if (n > 0) chip.textContent = '+' + n + ' queued';
            else chip.style.display = 'none';
        }
        /* re-derive filter badge counts from the live DOM (the 'All 15'
           static can drift once the grid is dynamic) */
        var counts = document.querySelectorAll('.filter-btn .f-count');
        var nAll = document.querySelectorAll('.service-card').length +
                   document.querySelectorAll('.coming-soon-card:not([hidden])').length;
        counts.forEach(function (el) {
            var btn = el.closest('.filter-btn');
            if (!btn) return;
            if (btn.getAttribute('data-filter') === 'all') el.textContent = String(nAll);
            else if (btn.getAttribute('data-filter') === 'coming-soon') el.textContent = String(document.querySelectorAll('.coming-soon-card:not([hidden])').length);
        });
    }).catch(function () { /* static grid stands */ });
})();

/* === Tier dividers: fill '+N queued' chip from the coming-soon grid */
(function () {
    var chip = document.getElementById('csQueued');
    var grid = document.querySelector('.coming-soon-grid');
    if (!chip || !grid) return;
    var n = grid.querySelectorAll('.coming-soon-card').length;
    if (n > 0) chip.textContent = '+' + n + ' queued';
    else chip.style.display = 'none';
})();

/* === Ticket cards: release the filter-entrance animation after it plays.
   cardIn uses fill-mode:both, which pins transform:translateY(0) forever and
   blocks the :hover lift. Dropping the animation after 'animationend' lets
   the hover transform apply (filters re-add the animation on next shuffle). */
document.querySelectorAll('.services-grid .service-card, .coming-soon-grid .coming-soon-card').forEach(function (card) {
    card.addEventListener('animationend', function (e) {
        if (e.animationName === 'cardIn') card.style.animation = 'none';
    });
});

// Screenshot lightbox
        /* Service catalog comes from MSP (assets/site-data.json, validated +
           frozen; baked fallback embedded in site-data.js at build time).
           Synchronous view: MSP.baked() — available immediately, used for the
           lightbox so clicks never wait on the network. */
        var SERVICES = {};
        if (window.MSP) {
            SERVICES = window.MSP.baked() || {};
            /* keep the live copy warm: if the fetched JSON differs from the
               baked one (a deploy updated the data), swap it in — the data is
               frozen, so any open lightbox keeps its old reference safely. */
            window.MSP.data().then(function (d) {
                if (d && d.services) {
                    var byKey = {};
                    for (var i = 0; i < d.services.length; i++) byKey[d.services[i].key] = d.services[i];
                    SERVICES = byKey;
                }
            }).catch(function () { });
        }


        /* Icon markup is stored as a PATH (not an HTML string) and rendered
           with createElement - removes the innerHTML sink (XSS security). */
        function renderIcon(container, iconPath, altText) {
            if (!container) return;
            container.textContent = '';
            if (!iconPath) return;
            var img = document.createElement('img');
            img.src = iconPath;
            img.alt = altText || '';
            img.width = 40; img.height = 40;
            img.loading = 'lazy'; img.decoding = 'async';
            container.appendChild(img);
        }

        var lastLightboxTrigger = null;
        function getLightboxFocusables(lb) {
            return Array.prototype.slice.call(lb.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')).filter(function(el) {
                return el.offsetParent !== null;
            });
        }
        function openLightbox(serviceId, trigger) {
            var s = SERVICES[serviceId];
            var lb = document.getElementById('serviceLightbox');
            if (!s || !lb) return;
            lastLightboxTrigger = trigger || document.activeElement;
            var img = document.getElementById('lightboxShot');
            if (img) { img.src = s.shot; img.alt = s.name + ' screenshot'; }
            var nameEl = document.getElementById('lightboxName');
            if (nameEl) nameEl.textContent = s.name;
            var plainEl = document.getElementById('lightboxPlain');
            if (plainEl) plainEl.textContent = s.plain || '';
            var icoEl = document.getElementById('lightboxIco');
            renderIcon(icoEl, s.icon, (s.name || '') + ' icon');
            var ghEl = document.getElementById('lightboxGithub');
            if (ghEl) {
                /* scheme guard: only https GitHub URLs from the static data pass */
                var gh = typeof s.github === 'string' && s.github.indexOf('https://') === 0 ? s.github : '';
                ghEl.href = gh || '#';
                ghEl.style.display = gh ? '' : 'none';
            }
            /* Open button deep-links to the dashboard Services tab; the
               origin follows the validated config (data- not hardcoded). */
            var openEl = document.getElementById('lightboxOpen');
            if (openEl && window.MSP) {
                var cfg0 = window.MSP.bakedConfig();
                if (cfg0.dashboardUrl) openEl.href = cfg0.dashboardUrl + '/#services';
            }
            var tierEl = document.getElementById('lightboxTier');
            if (tierEl) tierEl.textContent = String(s.tierLabel || 'Sweet Pea').toUpperCase();
            /* Mirror the card's LIVE Kuma state into the lightbox meta row
               (was hardcoded LIVE/Operational markup — lied when a service
               was down or unknown). The card's .sp-txt is premium.js-driven. */
            var card = document.querySelector('.service-card[data-service="' + serviceId + '"]');
            var liveEl = document.querySelector('#serviceLightbox .lm-live');
            var dotEl = document.querySelector('#serviceLightbox .status-dot');
            var spTxt = card ? card.querySelector('.sp-txt') : null;
            var cardDot = card ? card.querySelector('.status-dot') : null;
            if (liveEl && spTxt) liveEl.textContent = spTxt.textContent;
            if (dotEl && cardDot) {
                dotEl.className = cardDot.className;
                dotEl.title = cardDot.title;
                dotEl.setAttribute('aria-label', cardDot.getAttribute('aria-label') || '');
            }
            lb.setAttribute('aria-label', s.name + ' screenshot');
            lb.classList.add('active'); lb.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            window.setTimeout(function() { var c = lb.querySelector('.lightbox-close'); if (c) c.focus(); }, 0);
        }
        function closeLightbox() {
            var lb = document.getElementById('serviceLightbox');
            if (!lb) return;
            lb.classList.remove('active'); lb.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
            if (lastLightboxTrigger && typeof lastLightboxTrigger.focus === 'function') lastLightboxTrigger.focus();
            lastLightboxTrigger = null;
        }

        var serviceLightbox = document.getElementById('serviceLightbox');
        if (serviceLightbox) {
            serviceLightbox.addEventListener('click', function(e) {
                if (e.target === this) closeLightbox();
            });
            var closeBtn = serviceLightbox.querySelector('.lightbox-close');
            if (closeBtn) closeBtn.addEventListener('click', closeLightbox);
        }
    
        document.querySelectorAll('.service-card[data-service]').forEach(function(card) {
            card.addEventListener('click', function() { openLightbox(card.dataset.service, card); });
            /* Card keydown: Enter/Space on the CARD is legacy mouse-user
               convenience — the accessible trigger is the h3 .svc-open button
               (a real <button>, native keyboard semantics, no role juggling).
               Card-level keydown stays for back-compat with bookmarks/habits
               but a focused button handles its own Enter natively, and the
               card check ignores events originating inside the button. */
            card.addEventListener('keydown', function(e) {
                if (e.target.closest('.svc-open') || e.target.closest('a')) return;
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openLightbox(card.dataset.service, card);
                }
            });
            var openBtn = card.querySelector('.svc-open');
            if (openBtn) openBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                openLightbox(card.dataset.service, openBtn);
            });
        });

        /* GitHub links on cards: navigate in a new tab, but do NOT trigger the card lightbox */
        document.querySelectorAll('.gh-link').forEach(function(a) {
            a.addEventListener('click', function(e) { e.stopPropagation(); });
            a.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); });
        });

        /* === Services filter bar (hides tier dividers + groups, animated) === */
        (function () {
            /* derive tier counts from the DOM so badges can't desync (OCR final audit) */
            (function () {
                function countTier(t) {
                    var g = document.querySelector('[data-tier-group="' + t + '"]');
                    return g ? g.querySelectorAll('.service-card, .coming-soon-card').length : 0;
                }
                var map = { all: countTier('sweetpea') + countTier('coming-soon'), sweetpea: countTier('sweetpea'), 'coming-soon': countTier('coming-soon') };
                document.querySelectorAll('.filter-btn .f-count').forEach(function (el) {
                    var btn = el.closest('.filter-btn'); if (!btn) return;
                    var v = map[btn.getAttribute('data-filter')];
                    if (typeof v === 'number') el.textContent = v;
                });
            })();
            var filterBtns = document.querySelectorAll('.filter-btn');
            var groups = document.querySelectorAll('[data-tier-group]');
            var dividers = document.querySelectorAll('[data-tier-divider]');
            var shuffleTimer = 0;
            function applyFilter(filter) {
                groups.forEach(function (group) {
                    var tier = group.getAttribute('data-tier-group');
                    group.classList.toggle('filter-hidden', filter !== 'all' && tier !== filter);
                });
                dividers.forEach(function (divider) {
                    var tier = divider.getAttribute('data-tier-divider');
                    divider.classList.toggle('filter-hidden', filter !== 'all' && tier !== filter);
                });
            }
            filterBtns.forEach(function (btn) {
                btn.addEventListener('click', function () {
                    filterBtns.forEach(function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); b.classList.remove('active'); });
                    btn.classList.add('active');
                    var filter = btn.getAttribute('data-filter');
                    /* Animate: fade out, apply filter, fade in + re-trigger card animation.
                       Cancel any pending shuffle first — rapid clicks must not let an
                       older timer apply a stale filter after the newer one. */
                    if (shuffleTimer) { clearTimeout(shuffleTimer); shuffleTimer = 0; }
                    groups.forEach(function (g) { g.classList.add('filtering'); });
                    shuffleTimer = setTimeout(function () {
                        try {
                            applyFilter(filter);
                        } finally {
                            /* containment: applyFilter throwing must never leave
                               the page stuck in the fade-out 'filtering' state */
                            groups.forEach(function (g) {
                                g.classList.remove('filtering');
                                Array.prototype.forEach.call(g.querySelectorAll('.service-card, .coming-soon-card'), function (card) {
                                    /* Drop the animationend hook's inline animation:none —
                                       inline styles outrank the .card-anim class, so without
                                       this the filter re-entrance animation can never replay. */
                                    card.style.animation = '';
                                    card.classList.remove('card-anim');
                                    void card.offsetWidth;
                                    card.classList.add('card-anim');
                                });
                            });
                        }
                    }, 150);
                });
            });
        })();
        document.addEventListener('keydown', function(e) {
            var lb = document.getElementById('serviceLightbox');
            if (!lb || !lb.classList.contains('active')) return;
            if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); return; }
            if (e.key === 'Tab') {
                var focusables = getLightboxFocusables(lb);
                if (!focusables.length) return;
                var first = focusables[0], last = focusables[focusables.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        });

