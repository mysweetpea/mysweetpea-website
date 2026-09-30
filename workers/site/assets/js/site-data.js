/* ==========================================================================
   MySweetPea — site-data.js (dynamic data layer)
   Single runtime source of truth for: service catalog, coming-soon queue,
   suggest categories, pricing featured order, status/monitor wiring.

   SECURITY MODEL (do not weaken):
   - The fetched JSON is UNTRUSTED until validate() says otherwise: strict
     shape checks, string length caps, key/asset/URL allowlists.
   - service URLs may ONLY point at *.mysweetpea.cc (https);
     github links ONLY at https://github.com/<org>/<repo>;
     asset paths ONLY under /assets/ with no traversal/query/fragment.
   - Consumers render exclusively with createElement/textContent/attr —
     never innerHTML with data-derived strings (site CSP has no
     unsafe-eval / lax script-src; keep it that way).
   - If validation fails for ANY reason we fail CLOSED to the baked
     copy embedded at build time by deploy.py (BAKED marker below).
   - monitor IDs are resolved at runtime from the Kuma public status API
     (name -> id), cached in localStorage for 7 days, with the baked
     extraction-time hints as the last-resort fallback. No consumer
     hardcodes monitor IDs anymore.
   ========================================================================== */
(function () {
    'use strict';
    if (window.MSP) return; /* loaded once */

    /* === BAKED FALLBACK (deploy.py replaces everything between the markers) === */
    /* __MSP_BAKED_START__ */
    var BAKED = {"schema":1,"generated":"extracted from live markup; human-editable source of truth","services":[{"key":"vaultwarden","name":"Vaultwarden","shortName":"Vaultwarden","icon":"/assets/icons/vaultwarden.svg","iconAlt":"Vaultwarden","shot":"/assets/screenshots/vaultwarden.webp","github":"https://github.com/dani-garcia/vaultwarden","url":"https://vault.mysweetpea.cc","tier":"sweetpea","tierLabel":"Sweet Pea","category":"PASSWORDS","keywords":"passwords manager vault credentials passkeys secrets 1password lastpass bitwarden","blurb":"A password manager that keeps your passwords safe and creates strong passwords and fills them in automatically.","plain":"A safe place to store all your passwords \u2014 like a locked drawer for your digital life.","replaces":"Think of it like LastPass or 1Password.","desc":"Vaultwarden is a password manager that remembers all your passwords so you do not have to. It creates strong, unique passwords for every website and fills them in automatically. Your vault is encrypted end-to-end \u2014 even we cannot see your passwords.","monitorHint":1},{"key":"matrix","name":"Matrix / Element","shortName":"Matrix / Element","icon":"/assets/icons/matrix.svg","iconAlt":"Matrix","shot":"/assets/screenshots/element.webp","github":"https://github.com/element-hq/element-web","url":"https://chat.mysweetpea.cc","tier":"sweetpea","tierLabel":"Sweet Pea","category":"ENCRYPTED CHAT","keywords":"chat messaging element calls rooms matrix rooms chat app","blurb":"A private, encrypted chat app. Message friends and create rooms without anyone watching.","plain":"A private chat app for messaging friends \u2014 nobody else can read your messages.","replaces":"Think of it like Discord or Slack, but private.","desc":"Matrix is a private, encrypted chat system. Element is the app you use to access it. Create rooms, send messages, share files, all encrypted.","monitorHint":2},{"key":"affine","name":"AFFiNE","shortName":"AFFiNE","icon":"/assets/icons/affine2.svg","iconAlt":"AFFiNE","shot":"/assets/screenshots/affine.webp","github":"https://github.com/toeverything/AFFiNE","url":"https://notes.mysweetpea.cc","tier":"sweetpea","tierLabel":"Sweet Pea","category":"DOCS & WIKIS","keywords":"notes docs documents wiki knowledge writing notion evernote","blurb":"Create documents, wikis, and whiteboards \u2014 all private.","plain":"A place to write notes, build wikis, and sketch ideas \u2014 all kept private.","replaces":"Think of it like Notion and Miro in one.","desc":"AFFiNE is a free alternative to Notion. Create documents, wikis, whiteboards, and knowledge bases. All your notes are stored privately on our server.","monitorHint":3},{"key":"koalasync","name":"KoalaSync","shortName":"KoalaSync","icon":"/assets/icons/koalasync.svg","iconAlt":"KoalaSync logo","shot":"/assets/screenshots/koalasync.webp","github":"https://github.com/Shik3i/KoalaSync","url":"https://sync.mysweetpea.cc","tier":"sweetpea","tierLabel":"Sweet Pea","category":"WATCH TOGETHER","keywords":"watch together parties friends sync anime anilist","blurb":"Watch movies and shows together with friends in real-time.","plain":"Watch movies and shows together with friends in real-time \u2014 everyone sees the same scene.","replaces":"Think of it like a shared remote for your watch party.","desc":"KoalaSync lets you watch movies and shows together with friends in real-time. Works with Jellyfin, YouTube, and other video sites.","monitorHint":4},{"key":"jellyfin","name":"Jellyfin / Moonfin","shortName":"Jellyfin / Moonfin","icon":"/assets/icons/jellyfin.svg","iconAlt":"Jellyfin","shot":"/assets/screenshots/jellyfin.webp","github":"https://github.com/jellyfin/jellyfin","url":"https://media.mysweetpea.cc/Moonfin/Web/","tier":"sweetpea","tierLabel":"Sweet Pea","category":"MEDIA","keywords":"media server movies tv shows streaming watch netflix video library","blurb":"Your own private Netflix \u2014 stream shows, movies and anime on any device.","plain":"Watch any shows, movies, or animes anytime","replaces":"Think of it like Netflix, but it is your own collection.","desc":"Jellyfin is your own private Netflix \u2014 a free, open-source media server that streams your movie and TV collection to any device. Moonfin is a premium web interface that runs on top of Jellyfin.","monitorHint":5},{"key":"seerr","name":"Seerr","shortName":"Seerr","icon":"/assets/icons/seerr.svg","iconAlt":"Seerr logo","shot":"/assets/screenshots/seerr.webp","github":"https://github.com/seerr-team/seerr","url":"https://request.mysweetpea.cc","tier":"sweetpea","tierLabel":"Sweet Pea","category":"REQUESTS","keywords":"request movies tv shows new content add requests overrides jellyseerr","blurb":"Request any shows, movies and anime \u2014 they appear in Jellyfin automatically.","plain":"A wish list for movies and shows \u2014 request anything you want to watch.","replaces":"Think of it like a request box for your media library.","desc":"Seerr is like a wish list for movies and shows. Browse what is trending, see what is already available, and request anything you want to watch. Your request is processed automatically and the content appears in Jellyfin.","monitorHint":6},{"key":"nextcloud","name":"Nextcloud","shortName":"Nextcloud","icon":"/assets/icons/nextcloud.svg","iconAlt":"Nextcloud","shot":"/assets/screenshots/nextcloud.webp","github":"https://github.com/nextcloud/server","url":"https://cloud.mysweetpea.cc","tier":"sweetpea","tierLabel":"Sweet Pea","category":"FILES","keywords":"files storage cloud drive documents sync share dropbox google drive","blurb":"Files, calendar, and contacts \u2014 your private Google Workspace.","plain":"Your private place for files, calendar, and contacts \u2014 like a personal Google Workspace.","replaces":"Think of it like Google Drive, but private.","desc":"Nextcloud is your private Google Workspace replacement. Sync files across devices, share documents, manage your calendar and contacts \u2014 all stored on our own hardware.","monitorHint":7},{"key":"immich","name":"Immich","shortName":"Immich","icon":"/assets/icons/immich.svg","iconAlt":"Immich","shot":"/assets/screenshots/immich.webp","github":"https://github.com/immich-app/immich","url":"https://photos.mysweetpea.cc","tier":"sweetpea","tierLabel":"Sweet Pea","category":"PHOTOS","keywords":"photos videos pictures backup memories camera google photos","blurb":"Photo and video backup, like Google Photos without the tracking.","plain":"Back up your photos and videos privately \u2014 search them and keep them safe.","replaces":"Think of it like Google Photos, but private.","desc":"Immich is a self-hosted photo and video backup, like Google Photos without the tracking. Back up your memories, search them with AI, and keep them private on our own server.","monitorHint":8},{"key":"openwebui","name":"Open WebUI","shortName":"Open WebUI","icon":"/assets/icons/openwebui.svg","iconAlt":"Open WebUI","shot":"/assets/screenshots/openwebui.webp","github":"https://github.com/open-webui/open-webui","url":"https://ai.mysweetpea.cc","tier":"sweetpea","tierLabel":"Sweet Pea","category":"AI","keywords":"ai chat assistant chatbot llm chatgpt models local","blurb":"A private AI chat interface with multiple available models.","plain":"A private AI chat assistant \u2014 your conversations aren't logged or trained on.","replaces":"Think of it like ChatGPT, but private.","desc":"Open WebUI is a private AI chat interface running entirely on our own hardware. Chat with open-source models without your conversations ever leaving our servers.","monitorHint":9}],"comingSoon":[{"key":"syncthing","name":"Syncthing","icon":"/assets/icons/syncthing.svg","iconAlt":"Syncthing","blurb":"Peer-to-peer file sync across devices.","keywords":"file sync share devices folders backup p2p media movies"},{"key":"stalwartmail","name":"Stalwart Mail","icon":"/assets/icons/stalwart.svg","iconAlt":"Stalwart Mail","blurb":"Self-hosted email with IMAP, JMAP, and SMTP.","keywords":"email mail smtp imap hosting inbox"},{"key":"remux","name":"Remux","icon":"/assets/icons/remux.webp","iconAlt":"Remux","blurb":"Automated media acquisition and library management.","keywords":"video convert encoding files movies formats"},{"key":"obsidian","name":"Obsidian","icon":"/assets/icons/obsidian.svg","iconAlt":"Obsidian","blurb":"Private knowledge base with backlinks and graph view.","keywords":"notes knowledge markdown personal wiki writing"},{"key":"neko","name":"Neko","icon":"/assets/icons/neko.svg","iconAlt":"Neko","blurb":"Virtual browser in the cloud \u2014 watch together.","keywords":"watch together movies friends browser streaming parties"},{"key":"minecraft","name":"Minecraft","icon":"/assets/icons/minecraft.svg","iconAlt":"Minecraft","blurb":"Self-hosted Minecraft server for friends and family.","keywords":"game server gaming play minecraft world multiplayer"}],"suggestCategories":[{"value":"media","label":"Media & Entertainment"},{"value":"productivity","label":"Productivity"},{"value":"communication","label":"Communication"},{"value":"security","label":"Security & Privacy"},{"value":"development","label":"Development"},{"value":"monitoring","label":"Monitoring & Analytics"},{"value":"storage","label":"File Storage & Sync"},{"value":"other","label":"Other"}],"pricing":{"featured":[{"key":"jellyfin","tile":"Jellyfin","tag":"your private Netflix"},{"key":"nextcloud","tile":"Nextcloud","tag":"files"},{"key":"immich","tile":"Immich","tag":"photos"},{"key":"openwebui","tile":"Open WebUI","tag":"AI chat"},{"key":"vaultwarden","tile":"Vaultwarden","tag":"passwords"},{"key":"koalasync","tile":"KoalaSync","tag":"watch parties"}]},"config":{"statusApiBase":"https://status.mysweetpea.cc","statusSlug":"public","monitorStrategy":"kuma-name","monitorGroup":"Visitor Services","orgUrl":"https://github.com/mysweetpea"},"repos":[{"key":"homelab","name":"mysweetpea-homelab","url":"https://github.com/mysweetpea/mysweetpea-homelab","desc":"Every service definition, firewall rule and backup script. The whole garden, as code, exactly as it runs."},{"key":"website","name":"mysweetpea-website","url":"https://github.com/mysweetpea/mysweetpea-website","desc":"The site, the dashboard, the workers behind them \u2014 written in the open."}],"siteFacts":{"publicServices":9,"publicRepos":2}};
    /* __MSP_BAKED_END__ */
    var BAKED_HASH = 'h94fa4f1b'; /* deploy.py sets this to the site-data.json content hash */

    /* ---------------- validation ---------------- */
    var KEY_RE = /^[a-z0-9]{1,24}$/;
    var ASSET_RE = /^\/assets\/[A-Za-z0-9][A-Za-z0-9._\-/]{0,119}$/;
    var SITE_URL_RE = /^https:\/\/([a-z0-9-]+\.)*mysweetpea\.cc(\/[A-Za-z0-9._\-/?=&%]*)?$/;
    var GH_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]{1,60}\/[A-Za-z0-9_.-]{1,80}\/?$/;
    var KEYWORDS_RE = /^[A-Za-z0-9 ._\-/]{0,200}$/;

    function isStr(v, min, max) {
        return typeof v === 'string' && v.length >= min && v.length <= max;
    }
    function safeAsset(p) {
        return typeof p === 'string' && ASSET_RE.test(p) && p.indexOf('..') === -1;
    }
    function safeText(v, min, max) {
        /* printable text: no control chars, no angle brackets (belt and
           braces — even though consumers never innerHTML, keep the class
           of "data that could ever become markup" empty at the source) */
        return isStr(v, min, max) && !/[<>\u0000-\u001f]/.test(v);
    }

    function validateService(s, seen) {
        if (!s || typeof s !== 'object') return false;
        if (!KEY_RE.test(s.key) || seen[s.key]) return false;
        seen[s.key] = 1;
        if (!safeText(s.name, 1, 60)) return false;
        if (!isStr(s.shortName, 1, 40)) return false;
        if (!safeText(s.blurb, 1, 200)) return false;
        if (!safeText(s.desc, 1, 600)) return false;
        if (!safeText(s.plain, 1, 400)) return false;
        if (!safeText(s.replaces, 1, 200)) return false;
        if (!safeText(s.category, 2, 40)) return false;
        if (!safeAsset(s.icon) || !safeAsset(s.shot)) return false;
        if (!isStr(s.iconAlt, 1, 60)) return false;
        if (!isStr(s.url, 10, 200) || !SITE_URL_RE.test(s.url)) return false;
        if (!isStr(s.github, 18, 200) || !GH_RE.test(s.github)) return false;
        if (s.tier !== 'sweetpea') return false;
        if (s.tierLabel !== 'Sweet Pea') return false;
        if (typeof s.keywords !== 'string' || !KEYWORDS_RE.test(s.keywords)) return false;
        if (s.monitorHint != null && (typeof s.monitorHint !== 'number' || s.monitorHint < 1 || s.monitorHint > 999 || Math.floor(s.monitorHint) !== s.monitorHint)) return false;
        return true;
    }

    function validateRoot(root) {
        if (!root || typeof root !== 'object') return null;
        if (root.schema !== 1) return null;
        var i, s;
        if (!Array.isArray(root.services) || root.services.length < 1 || root.services.length > 40) return null;
        var seen = {};
        for (i = 0; i < root.services.length; i++) {
            if (!validateService(root.services[i], seen)) return null;
        }
        if (!Array.isArray(root.comingSoon) || root.comingSoon.length < 1 || root.comingSoon.length > 30) return null;
        for (i = 0; i < root.comingSoon.length; i++) {
            s = root.comingSoon[i];
            if (!s || typeof s !== 'object') return null;
            if (!KEY_RE.test(s.key) || seen[s.key]) return null;
            seen[s.key] = 1;
            if (!safeText(s.name, 1, 60) || !safeText(s.blurb, 1, 200)) return false;
            if (!safeAsset(s.icon) || !isStr(s.iconAlt, 1, 60)) return false;
            if (typeof s.keywords !== 'string' || !KEYWORDS_RE.test(s.keywords)) return false;
        }
        if (!Array.isArray(root.suggestCategories) || root.suggestCategories.length < 4 || root.suggestCategories.length > 16) return null;
        for (i = 0; i < root.suggestCategories.length; i++) {
            var c = root.suggestCategories[i];
            if (!c || typeof c !== 'object') return null;
            if (!KEY_RE.test(c.value) || !safeText(c.label, 2, 60)) return null;
        }
        var p = root.pricing;
        if (!p || typeof p !== 'object' || !Array.isArray(p.featured) || p.featured.length < 1 || p.featured.length > 40) return null;
        for (i = 0; i < p.featured.length; i++) {
            var f = p.featured[i];
            if (!f || typeof f !== 'object' || !seen[f.key]) return null; /* must reference real service keys */
            if (!safeText(f.tile, 1, 40) || !safeText(f.tag, 1, 60)) return null;
        }
        /* repos: site-identity GitHub links (nav/footer/about/support) */
        var reps = root.repos;
        if (!Array.isArray(reps) || reps.length < 1 || reps.length > 10) return null;
        var seenRepo = {};
        for (i = 0; i < reps.length; i++) {
            var rp = reps[i];
            if (!rp || typeof rp !== 'object') return null;
            if (!KEY_RE.test(rp.key) || seenRepo[rp.key]) return null;
            seenRepo[rp.key] = 1;
            if (!safeText(rp.name, 3, 80) || !safeText(rp.desc, 10, 300)) return null;
            if (!isStr(rp.url, 18, 200) || !GH_RE.test(rp.url)) return null;
        }
        var facts = root.siteFacts;
        if (!facts || typeof facts !== 'object') return null;
        if (typeof facts.publicServices !== 'number' || Math.floor(facts.publicServices) !== facts.publicServices || facts.publicServices < 1 || facts.publicServices > 40) return null;
        if (typeof facts.publicRepos !== 'number' || Math.floor(facts.publicRepos) !== facts.publicRepos || facts.publicRepos < 1 || facts.publicRepos > 20) return null;
        var cfg = root.config;
        if (!cfg || typeof cfg !== 'object') return null;
        if (!isStr(cfg.statusApiBase, 12, 80) || !/^https:\/\/([a-z0-9-]+\.)*mysweetpea\.cc$/.test(cfg.statusApiBase)) return null;
        if (!isStr(cfg.statusSlug, 2, 40) || !/^[a-z0-9-]+$/.test(cfg.statusSlug)) return null;
        if (cfg.monitorStrategy !== 'kuma-name') return null;
        if (!isStr(cfg.orgUrl, 18, 200) || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]{1,60}\/?$/.test(cfg.orgUrl)) return null;
        if (!isStr(cfg.monitorGroup, 2, 60)) return null;
        return root;
    }

    function deepFreeze(o) {
        if (o && typeof o === 'object') {
            Object.keys(o).forEach(function (k) { deepFreeze(o[k]); });
            Object.freeze(o);
        }
        return o;
    }

    /* ---------------- data (fetch -> validate -> fallback) ---------------- */
    var bakedData = null; /* validated BAKED copy, set by the dataPromise IIFE */
    var bakedByKey = null; /* key -> service view of bakedData (lazy) */

    var dataPromise = (function () {
        var bakedValid = null;
        try { bakedValid = validateRoot(JSON.parse(JSON.stringify(BAKED))); } catch (e) { bakedValid = null; }
        if (bakedValid) { deepFreeze(bakedValid); bakedData = bakedValid; }

        function useBaked(reason) {
            if (bakedValid) {
                if (window.console) console.warn('[msp] site-data: using baked copy (' + reason + ')');
                return bakedValid;
            }
            /* even the bake failed (should never happen — deploy.py gates it):
               consumers must treat null as "no dynamic data" and keep their
               static markup. Nothing dynamic renders. */
            if (window.console) console.warn('[msp] site-data: NO valid data (' + reason + ')');
            return null;
        }

        return fetch('/assets/site-data.json', { credentials: 'omit', cache: 'no-cache' })
            .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
            .then(function (j) {
                var v = validateRoot(j);
                if (!v) return Promise.reject(new Error('schema validation failed'));
                return deepFreeze(v);
            })
            .catch(function (err) { return useBaked(err && err.message ? err.message : 'fetch failed'); });
    })();

    /* ---------------- monitor id resolution (kuma name -> id) ---------------- */
    var LS_KEY = 'msp.monitors.v1';
    var MON_TTL = 7 * 24 * 60 * 60 * 1000; /* 7 days */

    function readCache() {
        try {
            var j = JSON.parse(localStorage.getItem(LS_KEY));
            if (j && typeof j.t === 'number' && (Date.now() - j.t) < MON_TTL && j.ids && typeof j.ids === 'object') return j.ids;
        } catch (e) { /* private mode / corrupted: ignore */ }
        return null;
    }
    function writeCache(ids) {
        try { localStorage.setItem(LS_KEY, JSON.stringify({ t: Date.now(), ids: ids })); } catch (e) { /* non-fatal */ }
    }

    var monitorsPromise = (function () {
        function fromNames(names, serviceKeys) {
            /* exact, case-insensitive name match; every public service must
               resolve or we fail closed to the next source */
            var ids = {}, n = 0;
            for (var k in names) {
                if (KEY_RE.test(k) && serviceKeys.indexOf(k) !== -1) { ids[k] = names[k]; n++; }
            }
            return n === serviceKeys.length ? ids : null;
        }
        function hintIds(data) {
            if (!data) return null;
            var ids = {};
            for (var i = 0; i < data.services.length; i++) {
                if (typeof data.services[i].monitorHint !== 'number') return null;
                ids[data.services[i].key] = data.services[i].monitorHint;
            }
            return ids;
        }

        return dataPromise.then(function (data) {
            var serviceKeys = data ? data.services.map(function (s) { return s.key; }) : [];
            var cfg = (data && data.config) || { statusApiBase: 'https://status.mysweetpea.cc', statusSlug: 'public' };
            var slug = cfg.statusSlug, base = cfg.statusApiBase;

            var cached = readCache();
            if (cached && fromNames(cached, serviceKeys)) {
                /* still refresh in the background so renumbered monitors heal
                   within a visit, but answer from cache immediately */
                fetch(base + '/api/status-page/' + slug, { credentials: 'omit' })
                    .then(function (r) { return r.ok ? r.json() : null; })
                    .then(function (j) {
                        var names = namesFromPayload(j);
                        if (names) { var live = fromNames(names, serviceKeys); if (live) writeCache(live); }
                    }).catch(function () { });
                return { byKey: fromNames(cached, serviceKeys), source: 'cache' };
            }

            var aborter = ('AbortController' in window) ? new AbortController() : null;
            var t = aborter ? setTimeout(function () { aborter.abort(); }, 8000) : 0;
            return fetch(base + '/api/status-page/' + slug, aborter ? { signal: aborter.signal, credentials: 'omit' } : {})
                .then(function (r) { if (t) clearTimeout(t); return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
                .then(function (j) {
                    var live = fromNames(namesFromPayload(j) || {}, serviceKeys);
                    if (live) { writeCache(live); return { byKey: live, source: 'live' }; }
                    return Promise.reject(new Error('name resolution incomplete'));
                })
                .catch(function (err) {
                    var hints = hintIds(data);
                    if (hints) {
                        if (window.console) console.warn('[msp] monitors: baked hints (' + (err && err.message ? err.message : 'unreachable') + ')');
                        return { byKey: hints, source: 'hint' };
                    }
                    return { byKey: {}, source: 'none' };
                });
        });
    })();

    function namesFromPayload(j) {
        if (!j || !Array.isArray(j.publicGroupList)) return null;
        var out = {};
        for (var g = 0; g < j.publicGroupList.length; g++) {
            var grp = j.publicGroupList[g];
            if (!grp || !Array.isArray(grp.monitorList)) continue;
            for (var m = 0; m < grp.monitorList.length; m++) {
                var mon = grp.monitorList[m];
                if (mon && typeof mon.id === 'number' && isStr(mon.name, 1, 60)) {
                    out[String(mon.name).toLowerCase().trim()] = mon.id;
                }
            }
        }
        return out;
    }

    /* ---------------- shared heartbeat (ONE fetch per page) ---------------- */
    var hbPromise = (function () {
        return dataPromise.then(function (data) {
            var cfg = (data && data.config) || { statusApiBase: 'https://status.mysweetpea.cc', statusSlug: 'public' };
            var aborter = ('AbortController' in window) ? new AbortController() : null;
            var t = aborter ? setTimeout(function () { aborter.abort(); }, 10000) : 0;
            return fetch(cfg.statusApiBase + '/api/status-page/heartbeat/' + cfg.statusSlug, aborter ? { signal: aborter.signal, credentials: 'omit' } : {})
                .then(function (r) { if (t) clearTimeout(t); return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
                .then(function (j) {
                    if (!j || !j.heartbeatList) return Promise.reject(new Error('no heartbeatList'));
                    return j;
                });
        });
    })();

    /* ---------------- derived helpers ---------------- */
    /* uptimeAvg: mean 24h uptime across ALL public services.
       Honesty rule (kept from the old hand-rolled pages): a partial set
       means monitor IDs drifted — return null so callers keep their static
       value / degrade honestly instead of showing a plausible-but-wrong
       average. */
    function uptimeAvg() {
        return Promise.all([hbPromise, monitorsPromise]).then(function (r) {
            var j = r[0], mon = r[1];
            var keys = Object.keys(mon.byKey);
            if (!keys.length || !j.uptimeList) return null;
            var sum = 0, n = 0;
            for (var i = 0; i < keys.length; i++) {
                var v = j.uptimeList[mon.byKey[keys[i]] + '_24'];
                if (typeof v === 'number' && v >= 0 && v <= 1) { sum += v; n++; }
            }
            if (n !== keys.length) return null;
            return Math.round((sum / n) * 1000) / 10; /* one decimal, e.g. 99.9 */
        }).catch(function () { return null; });
    }

    /* ---------------- chrome reconcile (nav/footer repo links + aria-current) ----------------
       Static chrome ships in every page (SEO/no-JS). At runtime:
       - every <a data-gh-repo="<key>"> adopts the validated repo URL from
         site-data.json (repo renames heal on next visit);
       - the nav link matching <body data-nav="..."> gets aria-current="page"
         (markup no longer hardcodes it per page, killing a whole drift class).
       href assignment uses the VALIDATED url (GH_RE-checked upstream). */
    function syncChrome() {
        try {
            var body = document.body;
            /* aria-current from data-nav */
            var navKey = body.getAttribute('data-nav');
            if (navKey && navKey !== 'none') {
                var link = document.querySelector('.top-nav a[href="' + navKey + '.html"], .top-nav a[href="/' + navKey + '"]');
                if (!link && navKey === 'home') link = document.querySelector('.top-nav a[href="/"], .top-nav a[href="/index.html"]');
                if (link && !link.getAttribute('aria-current')) link.setAttribute('aria-current', 'page');
            }
        } catch (e) { /* never block boot */ }
    }
    function applyRepos(repos, orgUrl) {
        try {
            if (orgUrl) {
                var orgs = document.querySelectorAll('a[data-gh-org]');
                for (var k = 0; k < orgs.length; k++) orgs[k].setAttribute('href', orgUrl);
            }
            var nodes = document.querySelectorAll('a[data-gh-repo]');
            var i, a, r;
            for (i = 0; i < nodes.length; i++) {
                a = nodes[i];
                for (var j = 0; j < repos.length; j++) {
                    if (repos[j].key === a.getAttribute('data-gh-repo')) {
                        r = repos[j];
                        break;
                    }
                }
                if (!r) continue;
                a.setAttribute('href', r.url);
                var nm = a.querySelector('.repo');
                if (nm && nm.textContent.trim() !== r.name) nm.textContent = r.name;
                r = null;
            }
        } catch (e) { /* non-fatal */ }
    }

    window.MSP = {
        version: BAKED_HASH,
        data: function () { return dataPromise; },
        syncChrome: function () {
            syncChrome();
            dataPromise.then(function (d) { if (d && d.repos) applyRepos(d.repos, d && d.config && d.config.orgUrl); }).catch(function () { });
        },
        baked: function () {
            /* Synchronous keyed view of the BAKED (validated) copy — for
               consumers that need data before the fetch resolves. Never
               throws; {} when no valid bake exists. */
            if (bakedByKey) return bakedByKey;
            var d = bakedData;
            if (d && d.services) {
                bakedByKey = {};
                for (var i = 0; i < d.services.length; i++) bakedByKey[d.services[i].key] = d.services[i];
                return bakedByKey;
            }
            return {};
        },
        monitors: function () { return monitorsPromise; },
        heartbeat: function () { return hbPromise; },
        uptimeAvg: uptimeAvg
    };
})();
