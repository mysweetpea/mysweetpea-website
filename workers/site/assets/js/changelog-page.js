/* === Changelog page: Highlights + Activity console (C3) ===
   Renders /api/commits into highlight cards + week-grouped rows with
   repo/category chip filters. Vanilla JS, zero deps. Deliberate ES5
   (var + loose == in legacy guards) for max browser reach — per the
   site's no-build/no-transpile policy.
   Honest states: fetch failure = visible error, never fake data.
   All dynamic strings go through textContent - never innerHTML. */
(function () {
    'use strict';

    var pulse = document.getElementById('cl2-pulse');
    var hlList = document.getElementById('cl2-hl-list');
    var feed = document.getElementById('cl2-feed');
    var chipsBox = document.getElementById('cl2-chips');
    if (!feed) return;

    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var CAT_LABEL = { f: 'Feature', i: 'Improvement', d: 'Fix' };
    /* Repo chips derive from MSP repos[] (full owner/name slugs — the same
       values /api/commits items carry in .repo). Kept in sync with the
       fetched data below so a repo list change is a data change. */
    var REPO_SLUGS = (window.MSP && window.MSP.bakedRepos()) || [];
    var REPO_KEYS = REPO_SLUGS.map(function (r) { return 'repo:' + r.key; });
    var CAT_KEYS = ['cat:f', 'cat:i', 'cat:d'];

    function repoKeyOf(slug) {
        /* slug 'mysweetpea/mysweetpea-website' -> key 'website' via repos[];
           match by repo name (owner-agnostic). Falls back to the raw slug. */
        var leaf = String(slug || '').split('/').pop();
        for (var i = 0; i < REPO_SLUGS.length; i++) {
            if (REPO_SLUGS[i].name === leaf) return REPO_SLUGS[i].key;
        }
        return leaf || slug;
    }
    function repoNameOf(keyOrSlug) {
        var leaf = String(keyOrSlug || '').split('/').pop();
        for (var i = 0; i < REPO_SLUGS.length; i++) {
            if (REPO_SLUGS[i].key === leaf || REPO_SLUGS[i].name === leaf) return REPO_SLUGS[i].name;
        }
        return leaf;
    }

    var data = null;
    var active = { all: true };
    REPO_KEYS.forEach(function (k) { active[k] = false; });
    CAT_KEYS.forEach(function (k) { active[k] = false; });

    function el(tag, cls, text) {
        var node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    }

    function txt(s) { return document.createTextNode(s); }

    function dateShort(iso) {
        var d = (iso instanceof Date) ? iso : new Date(iso);
        if (isNaN(d.getTime())) return '';
        return MONTHS[d.getMonth()] + ' ' + d.getDate();
    }

    function cleanTitle(msg) {
        var s = String(msg);
        // strip conventional prefixes: type(scope): and bare scope: — "form: fix x" -> "Fix x"
        /* Strip only KNOWN conventional-commit prefixes (fix/feat/chore/docs/
           refactor/perf/test/build/ci/style/revert + scope forms) — the old
           generic 'any word:' rule mangled legit titles like
           'Add search: results improve'. */
        s = s.replace(/^(fix|feat|chore|docs|refactor|perf|test|build|ci|style|revert)(\([a-z0-9._\/-]+\))?!?:\s+/i, '');
        // sentence-case the first word
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function anyOn(keys) {
        for (var i = 0; i < keys.length; i++) { if (active[keys[i]]) return true; }
        return false;
    }

    function passes(item) {
        if (anyOn(REPO_KEYS) && !active['repo:' + repoKeyOf(item.repo)]) return false;
        if (anyOn(CAT_KEYS) && !active['cat:' + item.cat]) return false;
        return true;
    }

    function renderHighlights() {
        if (!hlList) return;
        hlList.textContent = '';
        var hs = (data && data.highlights) || [];   /* total function: safe even pre-fetch */
        // No highlights this window: hide the section + vine, keep the page honest.
        var hlSection = document.querySelector('.cl2-highlights');
        if (hlSection) hlSection.hidden = hs.length === 0;
        var vine = document.querySelector('.vine-divider.reveal-grow');
        if (vine) vine.hidden = hs.length === 0;
        if (!hs.length) return;
        hs.forEach(function (h, i) {
            var card = el('article', 'cl2-hl');
            // ghost index numeral - the ledger idiom (pricing steps band)
            card.setAttribute('data-idx', '0' + (i + 1));
            var top = el('div', 'cl2-hl-top');
            var dAge = (Date.now() - new Date(h.date).getTime()) / 86400000;
            top.appendChild(el('span', 'cl2-hl-date', dateShort(h.date)));
            if (dAge < 8) {
                var fresh = el('span', 'cl2-hl-fresh');
                fresh.appendChild(el('span', 'cl2-fresh-dot'));
                fresh.appendChild(txt('new'));
                top.appendChild(fresh);
            }
            top.appendChild(el('span', 'cl2-tag n', repoNameOf(h.repo)));
            card.appendChild(top);
            card.appendChild(el('h2', null, cleanTitle(h.message)));
            var meta = el('p', 'cl2-hl-meta');
            meta.appendChild(el('span', null, h.sha));
            // date lives in the top row only - no duplicate
            meta.appendChild(txt(' \u00B7 ' + (repoKeyOf(h.repo) === 'website' ? 'website' : 'infrastructure')));
            card.appendChild(meta);
            var tags = el('div', 'cl2-tags');
            tags.appendChild(el('span', 'cl2-tag ' + (h.cat || 'i'), CAT_LABEL[h.cat] || 'Improvement'));
            card.appendChild(tags);
            hlList.appendChild(card);
        });
    }

    function renderFeed() {
        var weeks = (data && data.weeks) || [];
        var filtering = !active.all;
        var shown = 0;
        feed.textContent = '';
        // Accordion weeks: every week renders as a collapsed header; the two most
        // recent open by default. Filtering opens everything (you're hunting).
        weeks.forEach(function (wk, wi) {
            var rows = wk.items.filter(passes);
            if (!rows.length) return;
            shown += rows.length;
            var open = filtering || wi < 2;
            var block = el('div', 'cl2-wk' + (open ? ' open' : ''));
            block.setAttribute('data-wk', wi);
            var head = el('button', 'cl2-wk-head');
            head.type = 'button';
            head.setAttribute('aria-expanded', open ? 'true' : 'false');
            head.appendChild(el('span', 'cl2-week-label', wk.label));
            var meta = rows.length + (rows.length === 1 ? ' change' : ' changes');
            if (wk.noise > 0) meta += ' \u00B7 ' + wk.noise + ' auto';
            head.appendChild(el('span', 'cl2-wk-meta', meta));
            head.appendChild(el('span', 'cl2-wk-toggle', (open ? 'Hide' : 'Show ' + rows.length)));
            head.appendChild(el('span', 'cl2-wk-caret', '\u25BE'));
            head.addEventListener('click', function () {
                var isOpen = block.classList.toggle('open');
                var tg = head.querySelector('.cl2-wk-toggle');
                if (tg) tg.textContent = isOpen ? 'Hide' : 'Show ' + rows.length;
                head.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
                syncExpandToggle();
            });
            block.appendChild(head);
            var body = el('div', 'cl2-wk-body');
            if (!filtering && wk.noise > 0) {
                body.appendChild(el('div', 'cl2-noise',
                    wk.noise + ' automatic service updates hidden this week'));
            }
            var panel = el('div', 'cl2-panel');
            rows.forEach(function (it) {
                var row = el('div', 'cl2-row');
                row.appendChild(el('span', 'cl2-t', dateShort(it.date)));
                var m = el('span', 'cl2-m');
                m.setAttribute('data-when', dateShort(it.date));
                m.appendChild(el('span', 'cl2-mtxt', cleanTitle(it.message)));
                m.appendChild(el('span', null, ' \u00B7 ' + it.repo));
                row.appendChild(m);
                row.appendChild(el('span', 'cl2-cat ' + (it.cat || 'i'), CAT_LABEL[it.cat] || 'Improvement'));
                panel.appendChild(row);
            });
            body.appendChild(panel);
            block.appendChild(body);
            feed.appendChild(block);
        });
        syncExpandToggle();
        renderGraph();
        if (!shown) {
            feed.appendChild(el('div', 'cl2-empty', 'Nothing matches those filters yet.'));
        }
    }

    /* Expand / collapse all control (lives in the Activity eyebrow row) */
    function syncExpandToggle() {
        var btn = document.getElementById('cl2-expand');
        if (!btn) return;
        var blocks = Array.prototype.slice.call(feed.querySelectorAll('.cl2-wk'));
        if (!blocks.length) { btn.hidden = true; return; }
        var openCount = blocks.filter(function (b) { return b.classList.contains('open'); }).length;
        btn.hidden = false;
        btn.textContent = openCount === blocks.length ? 'Collapse all' : 'Expand all';
    }

    function allWeeksOpen(open) {
        Array.prototype.forEach.call(feed.querySelectorAll('.cl2-wk'), function (b) {
            b.classList.toggle('open', open);
            var h = b.querySelector('.cl2-wk-head');
            if (h) h.setAttribute('aria-expanded', open ? 'true' : 'false');
            var tg = b.querySelector('.cl2-wk-toggle');
            if (tg) {
                var wi = Number(b.getAttribute('data-wk'));
                var wk = (data && data.weeks) ? data.weeks[wi] : null;
                var n = wk ? wk.items.filter(passes).length : 0;
                tg.textContent = open ? 'Hide' : 'Show ' + n;
            }
        });
        syncExpandToggle();
    }

    /* === 30-day stacked activity graph (pure DOM; shares the chip filters) === */
    function dayKey(d) { return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }

    function renderGraph() {
        var g = document.getElementById('cl2-graph');
        var cap = document.getElementById('cl2-graph-cap');
        var totalEl = document.getElementById('cl2-graph-total');
        var legend = document.getElementById('cl2-legend');
        if (!g) return;
        g.textContent = '';
        // NOTE: legend is STATIC in HTML now — do not clear it here.
        var all = [];
        (data.weeks || []).forEach(function (wk) { all = all.concat(wk.items || []); });
        if (!all.length) { g.hidden = true; if (cap) cap.hidden = true; return; }
        g.hidden = false; if (cap) cap.hidden = false;

        var now = new Date();
        var days = [];
        var byKey = {};
        for (var i = 29; i >= 0; i--) {
            var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
            var dy = { date: d, f: 0, i: 0, d: 0, total: 0 };
            days.push(dy);
            byKey[dayKey(d)] = dy;
        }
        var legendCounts = { f: 0, i: 0, d: 0 };
        all.forEach(function (it) {
            var dt = new Date(it.date);
            if (isNaN(dt.getTime())) return;
            /* legend counts honor the SAME 30-day window as the bars/total —
               counting all-time made the chips disagree with the graph */
            var dy = byKey[dayKey(dt)];
            if (!dy) return;
            var c = it.cat || 'i';
            if (c in legendCounts) legendCounts[c]++;
            if (!passes(it)) return;
            if (c in dy) { dy[c]++; dy.total++; }
        });

        var max = 0, grand = 0;
        days.forEach(function (dy) { if (dy.total > max) max = dy.total; grand += dy.total; });
        var H = window.innerWidth <= 768 ? 88 : 128; /* matches the CSS 768 ladder */

        days.forEach(function (dy, idx) {
            var col = el('button', 'cl2-col');
            col.type = 'button';
            var lbl = WEEKDAYS[dy.date.getDay()] + ', ' + dateShort(dy.date);
            col.setAttribute('aria-label', lbl + ': ' + dy.total + (dy.total === 1 ? ' change' : ' changes'));
            col.style.transitionDelay = (idx * 14) + 'ms';
            if (dy.total > 0) {
                var bar = el('span', 'cl2-bar');
                [['f', dy.f], ['d', dy.d], ['i', dy.i]].forEach(function (pair) {
                    var c = pair[0], n = pair[1];
                    if (!n) return;
                    var seg = el('span', 'cl2-seg seg-' + c);
                    seg.style.height = Math.max(3, Math.round(n / max * H)) + 'px';
                    bar.appendChild(seg);
                });
                col.appendChild(bar);
            } else {
                col.appendChild(el('span', 'cl2-bar cl2-bar-zero'));
            }
            col.addEventListener('mouseenter', function () { graphCaption(dy); showTip(col, dy); });
            col.addEventListener('mouseleave', hideTip);
            col.addEventListener('focus', function () { graphCaption(dy); showTip(col, dy); });
            col.addEventListener('blur', hideTip);
            col.addEventListener('click', function () { jumpToDay(dy.date); });
            g.appendChild(col);
        });
        if (cap) {
            cap.textContent = 'Hover a day for detail \u00B7 click it to jump to that week';
            if (!active.all) cap.textContent = 'Filtered view \u2014 graph shows matching changes only. ' + cap.textContent;
            defaultCaption = cap.textContent;   /* restored when a tooltip hides */
        }
        if (totalEl) totalEl.textContent = grand + ' in the last 30 days';
        // Time axis: 5 evenly spaced date ticks under the bars (oldest left, today right)
        var axis = document.getElementById('cl2-axis');
        if (axis) {
            axis.textContent = '';
            [0, 7, 14, 21, 29].forEach(function (back) {
                var d = days[days.length - 1 - back];
                if (!d) return;
                var t = el('span', 'cl2-axis-tick', MONTHS[d.date.getMonth()] + ' ' + d.date.getDate());
                // spread ticks with flex space-between; last one right-aligned
                axis.appendChild(t);
            });
        }
        // the Activity score mirrors the graph's strict 30-day count (API totals include stragglers)
        var scoreEl = document.getElementById('cl2-score');
        if (scoreEl) scoreEl.textContent = grand + (grand === 1 ? ' change' : ' changes') + ' in the last 30 days';
        // Legend is now STATIC in the HTML (two labeled filter groups); here we
        // only keep the counts + on-state in sync (data-count + aria-pressed).
        if (legend) {
            [['f', 'Features'], ['i', 'Improvements'], ['d', 'Fixes']].forEach(function (pair) {
                var key = 'cat:' + pair[0];
                var b = legend.querySelector('[data-f="' + key + '"]');
                if (!b) return;
                b.setAttribute('aria-pressed', active[key] ? 'true' : 'false');
                b.classList.toggle('on', !!active[key]);
                var cnt = b.querySelector('.lg-count');
                if (cnt) cnt.textContent = String(legendCounts[pair[0]]);
            });
        }
    }

    function graphCaption(dy) {
        var cap = document.getElementById('cl2-graph-cap');
        if (!cap) return;
        var parts = [];
        if (dy.f) parts.push(dy.f + ' ' + (dy.f === 1 ? 'feature' : 'features'));
        if (dy.i) parts.push(dy.i + ' ' + (dy.i === 1 ? 'improvement' : 'improvements'));
        if (dy.d) parts.push(dy.d + ' ' + (dy.d === 1 ? 'fix' : 'fixes'));
        cap.textContent = WEEKDAYS[dy.date.getDay()] + ', ' + dateShort(dy.date) +
            ' \u2014 ' + (parts.length ? parts.join(' \u00B7 ') : 'no changes');
    }

    /* Floating tooltip for graph columns (also mirrors into the caption line) */
    var tipEl = null;
    function showTip(col, dy) {
        if (!tipEl) {
            tipEl = el('div', 'cl2-tip');
            tipEl.setAttribute('aria-hidden', 'true');
            document.body.appendChild(tipEl);
        }
        tipEl.textContent = '';
        var s = el('span', 'cl2-tip-day', WEEKDAYS[dy.date.getDay()].slice(0, 3) + ', ' + dateShort(dy.date));
        tipEl.appendChild(s);
        tipEl.appendChild(el('b', null, String(dy.total)));
        tipEl.appendChild(txt(' change' + (dy.total === 1 ? '' : 's')));
        var parts = [];
        if (dy.f) parts.push({ n: dy.f, w: dy.f === 1 ? 'feat' : 'feats', c: 'dot-f' });
        if (dy.i) parts.push({ n: dy.i, w: dy.i === 1 ? 'improvement' : 'improvements', c: 'dot-i' });
        if (dy.d) parts.push({ n: dy.d, w: dy.d === 1 ? 'fix' : 'fixes', c: 'dot-d' });
        parts.forEach(function (p2, i2) {
            if (i2) tipEl.appendChild(txt(' \u00B7 '));
            tipEl.appendChild(el('span', 'cl2-dot cl2-tip-dot ' + p2.c));
            tipEl.appendChild(txt(p2.n + ' ' + p2.w));
        });
        if (!parts.length) tipEl.appendChild(el('span', 'cl2-tip-break', 'no changes'));
        tipEl.hidden = false;
        var r = col.getBoundingClientRect();
        var left = Math.round(r.left + r.width / 2 + window.scrollX);
        tipEl.style.top = Math.round(r.top + window.scrollY - 10) + 'px';
        // clamp to viewport so first/last columns never push the tip off-screen
        tipEl.style.left = '0px';
        var tw = tipEl.offsetWidth;
        if (tw) {
            var minX = window.scrollX + 8;
            var maxX = window.scrollX + document.documentElement.clientWidth - tw - 8;
            tipEl.style.left = Math.min(Math.max(left, minX), Math.max(minX, maxX)) + 'px';
        } else {
            tipEl.style.left = left + 'px';
        }
    }
    var defaultCaption = '';
    function hideTip() {
        if (tipEl) tipEl.hidden = true;
        /* restore the default caption — the last-hovered day's text must not
           stick after mouseleave/blur */
        var cap = document.getElementById('cl2-graph-cap');
        if (cap && defaultCaption) cap.textContent = defaultCaption;
    }

    function jumpToDay(date) {
        var key = dayKey(date);
        var target = null;
        Array.prototype.some.call(feed.querySelectorAll('.cl2-wk'), function (block) {
            var wi = block.getAttribute('data-wk');
            var wk = (data.weeks || [])[Number(wi)];
            if (!wk) return false;
            var hit = wk.items.some(function (it) {
                var dt = new Date(it.date);
                return !isNaN(dt.getTime()) && dayKey(dt) === key && passes(it);
            });
            if (hit) { target = block; return true; }
            return false;
        });
        if (!target) return;
        target.classList.add('open');
        var h = target.querySelector('.cl2-wk-head');
        if (h) h.setAttribute('aria-expanded', 'true');
        var tg = target.querySelector('.cl2-wk-toggle');
        if (tg) tg.textContent = 'Hide';
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        syncExpandToggle();
    }

    /* Vine divider grow-on-scroll (same mechanics as home-page.js) */
    (function () {
        var vines = document.querySelectorAll('.vine-divider.reveal-grow');
        if (!vines.length) return;
        var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce || !('IntersectionObserver' in window)) {
            Array.prototype.forEach.call(vines, function (v) { v.classList.add('visible'); });
            return;
        }
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
            });
        }, { threshold: 0.2, rootMargin: '0px 0px -8% 0px' });
        Array.prototype.forEach.call(vines, function (v) { io.observe(v); });
    })();

    /* Shared filter application: header chips AND graph legend chips */
    /* chip counts — computed from loaded data once */
    function fillCounts() {
        if (!data || !data.weeks) return;
        var counts = {};
        REPO_KEYS.forEach(function (k) { counts[k] = 0; });
        CAT_KEYS.forEach(function (k) { counts[k] = 0; });
        data.weeks.forEach(function (w) {
            (w.items || []).forEach(function (item) {
                if (!item) return;
                var rk = 'repo:' + repoKeyOf(item.repo);
                if (counts[rk] !== undefined) counts[rk]++;
                if (item.cat && counts['cat:' + item.cat] !== undefined) counts['cat:' + item.cat]++;
            });
        });
        Array.prototype.forEach.call(document.querySelectorAll('.cl2-count'), function (c) {
            var k = c.getAttribute('data-count');
            if (k && counts[k] !== undefined) c.textContent = '(' + counts[k] + ')';
        });
    }

    function applyFilter(key) {
        if (!(key in active)) return;
        if (key === 'all') {
            Object.keys(active).forEach(function (k) { active[k] = false; });
            active.all = true;
        } else {
            active[key] = !active[key];
            active.all = !anyOn(REPO_KEYS) && !anyOn(CAT_KEYS);
        }
        // sync every chip surface (header row + graph legend)
        Array.prototype.forEach.call(document.querySelectorAll('.cl2-chip'), function (b) {
            var k = b.getAttribute('data-f');
            if (k in active) {
                b.classList.toggle('on', !!active[k]);
                b.setAttribute('aria-pressed', active[k] ? 'true' : 'false');
            }
        });
        // Reset affordance only while a filter is active
        var resetBtn = document.getElementById('cl2-reset');
        if (resetBtn) resetBtn.hidden = !!active.all;
        // Deep-link state: shareable #repo=...&type=... (f=features, i=improvements, d=fixes)
        try {
            var params = [];
            REPO_KEYS.forEach(function (k) {
                if (active[k]) params.push('repo=' + k.slice(5));
            });
            if (active['cat:f']) params.push('type=f');
            if (active['cat:i']) params.push('type=i');
            if (active['cat:d']) params.push('type=d');
            var h = params.length ? '#' + params.join('&') : '';
            if (location.hash !== h) history.replaceState(null, '', location.pathname + location.search + h);
        } catch (e) { /* history unavailable — never break filtering */ }
        if (data) renderFeed();  // renderFeed re-renders the graph too
    }

    var resetBtn = document.getElementById('cl2-reset');
    if (resetBtn) {
        resetBtn.addEventListener('click', function () { applyFilter('all'); });
    }

    if (chipsBox) {
        chipsBox.addEventListener('click', function (ev) {
            var btn = ev.target && ev.target.closest ? ev.target.closest('.cl2-chip') : null;
            if (!btn) return;
            applyFilter(btn.getAttribute('data-f'));
        });
    }
    var legendBox = document.getElementById('cl2-legend');
    if (legendBox) {
        legendBox.addEventListener('click', function (ev) {
            var btn = ev.target && ev.target.closest ? ev.target.closest('.cl2-chip') : null;
            if (!btn) return;
            applyFilter(btn.getAttribute('data-f'));
        });
    }
    var expandBtn = document.getElementById('cl2-expand');
    if (expandBtn) {
        expandBtn.addEventListener('click', function () {
            var blocks = Array.prototype.slice.call(feed.querySelectorAll('.cl2-wk'));
            var openCount = blocks.filter(function (b) { return b.classList.contains('open'); }).length;
            allWeeksOpen(openCount !== blocks.length);
        });
    }

    function loadFeed() {
        var ctl;
        try { ctl = new AbortController(); } catch (e) { ctl = null; }
        if (ctl) setTimeout(function () { ctl.abort(); }, 10000);
        var timer = null;
        var fail = function (err) {
            if (timer) { clearTimeout(timer); timer = null; }
            console.warn('[cl2] activity feed failed:', err);
            feed.textContent = '';
            var box = el('div', 'cl2-empty', "Couldn't load the activity feed.");
            var retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'cl2-chip cl2-retry';
            retry.textContent = 'Retry';
            retry.addEventListener('click', function () {
                feed.textContent = '';
                feed.appendChild(el('div', 'cl2-skel'));
                loadFeed();
            });
            box.appendChild(retry);
            feed.appendChild(box);
        };
        // belt-and-braces: even without AbortController the pulse can't spin forever
        if (!ctl) timer = setTimeout(function () { fail(new Error('timeout')); }, 12000);
        try {
            fetch('/api/commits', ctl ? { signal: ctl.signal } : undefined)
                .then(function (res) {
                    return res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status));
                })
                .then(function (payload) {
                    var ok = payload && Array.isArray(payload.weeks) && Array.isArray(payload.highlights) &&
                        payload.weeks.every(function (w) { return w && Array.isArray(w.items); });
                    if (!ok) throw new Error('unexpected /api/commits shape');
                    if (timer) { clearTimeout(timer); timer = null; }
                    data = payload;
                    fillCounts();
                    if (pulse) pulse.hidden = false;
                    renderHighlights();
                    renderFeed();
                })
                .catch(fail);
        } catch (syncErr) {
            fail(syncErr);
        }
    }
    loadFeed();

    /* Deep-link state: apply #repo=portfolio&type=fixes on first load. Runs
       before data arrives — chip states sync, feed renders when data lands. */
    (function () {
        var h = (location.hash || '').slice(1);
        if (!h) return;
        h.split('&').forEach(function (pair) {
            var kv = pair.split('=');
            if (kv.length !== 2) return;
            if (kv[0] === 'repo') {
                var want = 'repo:' + kv[1];
                if (REPO_KEYS.indexOf(want) !== -1) applyFilter(want);
            }
            if (kv[0] === 'type' && kv[1] === 'f') applyFilter('cat:f');
            if (kv[0] === 'type' && kv[1] === 'i') applyFilter('cat:i');
            if (kv[0] === 'type' && kv[1] === 'd') applyFilter('cat:d');
        });
    })();
})();
