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
        var SERVICES = {
            vaultwarden: { name:'Vaultwarden', icon:'/assets/icons/vaultwarden.svg', iconAlt:'Vaultwarden', shot:'/assets/screenshots/vaultwarden.webp', github:'https://github.com/dani-garcia/vaultwarden', tier:'sweetpea', tierLabel:'Sweet Pea', plain:'A safe place to store all your passwords — like a locked drawer for your digital life.', replaces:'Think of it like LastPass or 1Password.', desc:'Vaultwarden is a password manager that remembers all your passwords so you do not have to. It creates strong, unique passwords for every website and fills them in automatically. Your vault is encrypted end-to-end — even we cannot see your passwords.', url:'https://vault.mysweetpea.cc' },
            matrix: { name:'Matrix / Element', icon:'/assets/icons/matrix.svg', iconAlt:'Matrix', shot:'/assets/screenshots/element.webp', github:'https://github.com/element-hq/element-web', tier:'sweetpea', tierLabel:'Sweet Pea', plain:'A private chat app for messaging friends — nobody else can read your messages.', replaces:'Think of it like Discord or Slack, but private.', desc:'Matrix is a private, encrypted chat system. Element is the app you use to access it. Create rooms, send messages, share files, all encrypted.', url:'https://chat.mysweetpea.cc' },
            affine: { name:'AFFiNE', icon:'/assets/icons/affine2.svg', iconAlt:'AFFiNE', shot:'/assets/screenshots/affine.webp', github:'https://github.com/toeverything/AFFiNE', tier:'sweetpea', tierLabel:'Sweet Pea', plain:'A place to write notes, build wikis, and sketch ideas — all kept private.', replaces:'Think of it like Notion and Miro in one.', desc:'AFFiNE is a free alternative to Notion. Create documents, wikis, whiteboards, and knowledge bases. All your notes are stored privately on our server.', url:'https://notes.mysweetpea.cc' },
            koalasync: { name:'KoalaSync', icon:'/assets/icons/koalasync.svg', iconAlt:'KoalaSync logo', shot:'/assets/screenshots/koalasync.webp', github:'https://github.com/Shik3i/KoalaSync', tier:'sweetpea', tierLabel:'Sweet Pea', plain:'Watch movies and shows together with friends in real-time — everyone sees the same scene.', replaces:'Think of it like a shared remote for your watch party.', desc:'KoalaSync lets you watch movies and shows together with friends in real-time. Works with Jellyfin, YouTube, and other video sites.', url:'https://sync.mysweetpea.cc' },
            jellyfin: { name:'Jellyfin / Moonfin', icon:'/assets/icons/jellyfin.svg', iconAlt:'Jellyfin', shot:'/assets/screenshots/jellyfin.webp', github:'https://github.com/jellyfin/jellyfin', tier:'sweetpea', tierLabel:'Sweet Pea', plain:'Watch any shows, movies, or animes anytime', replaces:'Think of it like Netflix, but it is your own collection.', desc:'Jellyfin is your own private Netflix — a free, open-source media server that streams your movie and TV collection to any device. Moonfin is a premium web interface that runs on top of Jellyfin.', url:'https://media.mysweetpea.cc/Moonfin/Web/' },
            seerr: { name:'Seerr', icon:'/assets/icons/seerr.svg', iconAlt:'Seerr logo', shot:'/assets/screenshots/seerr.webp', github:'https://github.com/seerr-team/seerr', tier:'sweetpea', tierLabel:'Sweet Pea', plain:'A wish list for movies and shows — request anything you want to watch.', replaces:'Think of it like a request box for your media library.', desc:'Seerr is like a wish list for movies and shows. Browse what is trending, see what is already available, and request anything you want to watch. Your request is processed automatically and the content appears in Jellyfin.', url:'https://request.mysweetpea.cc' },
            nextcloud: { name:'Nextcloud', icon:'/assets/icons/nextcloud.svg', iconAlt:'Nextcloud', shot:'/assets/screenshots/nextcloud.webp', github:'https://github.com/nextcloud/server', tier:'sweetpea', tierLabel:'Sweet Pea', plain:'Your private place for files, calendar, and contacts — like a personal Google Workspace.', replaces:'Think of it like Google Drive, but private.', desc:'Nextcloud is your private Google Workspace replacement. Sync files across devices, share documents, manage your calendar and contacts — all stored on our own hardware.', url:'https://cloud.mysweetpea.cc' },
            immich: { name:'Immich', icon:'/assets/icons/immich.svg', iconAlt:'Immich', shot:'/assets/screenshots/immich.webp', github:'https://github.com/immich-app/immich', tier:'sweetpea', tierLabel:'Sweet Pea', plain:'Back up your photos and videos privately — search them and keep them safe.', replaces:'Think of it like Google Photos, but private.', desc:'Immich is a self-hosted photo and video backup, like Google Photos without the tracking. Back up your memories, search them with AI, and keep them private on our own server.', url:'https://photos.mysweetpea.cc' },
            openwebui: { name:'Open WebUI', icon:'/assets/icons/openwebui.svg', iconAlt:'Open WebUI', shot:'/assets/screenshots/openwebui.webp', github:'https://github.com/open-webui/open-webui', tier:'sweetpea', tierLabel:'Sweet Pea', plain:'A private AI chat assistant — your conversations aren\'t logged or trained on.', replaces:'Think of it like ChatGPT, but private.', desc:'Open WebUI is a private AI chat interface running entirely on our own hardware. Chat with open-source models without your conversations ever leaving our servers.', url:'https://ai.mysweetpea.cc' },
        };

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
            /* Open button now deep-links to the dashboard Services tab
               (static, in the markup) - per-service s.url no longer wired. */
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

