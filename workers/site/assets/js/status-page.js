/* === Live status from Uptime Kuma === */
    (function () {
        var summary = document.getElementById('status-summary');
        var summaryText = summary ? summary.querySelector('strong') : null;
        var summaryTime = summary ? summary.querySelector('time') : null;
        var rows = document.querySelectorAll('.status-line[data-service-key]');

        // Map our service keys to Uptime Kuma monitor IDs
        var MONITOR_IDS = {
            vaultwarden: 1, matrix: 2, affine: 3, koalasync: 4,
            jellyfin: 5, seerr: 6, nextcloud: 7, immich: 8, openwebui: 9
        };
        // Reverse map: monitor ID -> service key
        var ID_TO_KEY = {};
        Object.keys(MONITOR_IDS).forEach(function (k) { ID_TO_KEY[MONITOR_IDS[k]] = k; });
        // Status page slug in Uptime Kuma (public URL /status/public)
        var STATUS_SLUG = 'public';

        // 40-tick recent-checks strip, oldest -> newest left -> right.
        // Slots without a beat are padded with t-none on the LEFT.
        var STRIP_TICKS = 40;

        function fmtHM(d) {
            if (!d || isNaN(d.getTime())) return '?';
            var hh = String(d.getHours()).padStart(2, '0');
            var mm = String(d.getMinutes()).padStart(2, '0');
            return hh + ':' + mm;
        }

        function renderStrip(card, list) {
            var strip = card.querySelector('.sc-strip');
            if (!strip) return;
            strip.textContent = '';
            // Kuma returns beats NEWEST-FIRST; normalize to oldest -> newest so
            // slice(-STRIP_TICKS) takes the MOST RECENT checks and ticks run
            // left-to-right = oldest-to-newest (was silently wrong before).
            var all = list.slice().sort(function (a, b) {
                return String(a.time).localeCompare(String(b.time), 'en');
            });
            var beats = all.slice(-STRIP_TICKS);
            var pad = STRIP_TICKS - beats.length;
            var i, tick;
            // Latency scaling: per-service min-max over THIS strip's pings so a
            // quiet 100ms service and a spiky 1s service both use the full band.
            var pings = [];
            for (i = 0; i < beats.length; i++) {
                if (beats[i] && typeof beats[i].ping === 'number' && beats[i].status === 1) pings.push(beats[i].ping);
            }
            var pmin = pings.length ? Math.min.apply(null, pings) : 0;
            var pmax = pings.length ? Math.max.apply(null, pings) : 0;
            var pspan = Math.max(pmax - pmin, 1);
            for (i = 0; i < pad; i++) {
                tick = document.createElement('i');
                tick.className = 't-none';
                strip.appendChild(tick);
            }
            beats.forEach(function (h) {
                tick = document.createElement('i');
                var isDown = h && h.status === 0;
                tick.className = isDown ? 't-down' : '';
                // Height = measured response time (floor 18% so ticks stay
                // visible; down beats stay full-height in error red).
                if (!isDown && h && typeof h.ping === 'number') {
                    var frac = 0.18 + 0.82 * ((h.ping - pmin) / pspan);
                    tick.style.setProperty('--h', Math.round(frac * 100) + '%');
                }
                if (h && h.time) {
                    var tipTime = h.time;
                    var tipState;
                    if (isDown) tipState = 'DOWN';
                    else if (typeof h.ping === 'number') tipState = h.ping + ' ms';
                    else tipState = 'up';
                    tick.setAttribute('data-tip', tipState + ' · ' + tipTime.slice(11, 16) + ' srv');
                }
                strip.appendChild(tick);
            });
        }

        function setRow(row, up, pct, list, unknown) {
            var badge = row.querySelector('.status-badge');
            var label = row.querySelector('.badge-label');
            var dot = row.querySelector('.status-dot');
            var uptimeEl = row.querySelector('.sc-uptime');
            var checksEl = row.querySelector('.sc-checks');
            var pctEl = row.querySelector('.line-pct');
            if (badge) {
                badge.classList.remove('status-online', 'status-down', 'status-unknown');
                badge.classList.add(unknown ? 'status-unknown' : (up ? 'status-online' : 'status-down'));
            }
            if (label) label.textContent = unknown ? 'Not reporting' : (up ? 'Operational' : 'Down');
            if (dot) {
                dot.classList.remove('status-unknown');
                if (unknown) dot.classList.add('status-unknown');
                else dot.classList.toggle('status-down', !up);
            }
            /* UPTIME_WIN is keyed by monitor ID (built from "<id>_<days>"
               uptimeList keys) — translate the row's service key through
               ID_TO_KEY's inverse before lookup (was always null). */
            var rowId = MONITOR_IDS[row.dataset.serviceKey];
            var win = (window.UPTIME_WIN && rowId != null && window.UPTIME_WIN[String(rowId)]) || null;
            if (uptimeEl) uptimeEl.textContent = (pct != null) ? ((win ? win + 'd ' : '') + pct + '%') : 'uptime —';
            if (pctEl) pctEl.textContent = (pct != null) ? pct + '%' : '—';
            if (unknown) {
                if (uptimeEl) uptimeEl.textContent = 'no data';
                if (checksEl) checksEl.textContent = 'not reporting';
            } else if (checksEl && list && list.length) {
                var t = list.slice().sort(function (a, b) {
                    return String(a.time).localeCompare(String(b.time), 'en');
                });
                var h = t[t.length - 1];
                var d = h && h.time ? new Date(String(h.time).replace(' ', 'T')) : null;
                checksEl.textContent = (d && !isNaN(d)) ? ('last ' + fmtHM(d) + ' srv') : 'last —';
                // Avg latency over the STRIP window (up beats only) — matches
                // what the bars encode; inside this branch t is defined.
                var latEl = row.querySelector('.line-lat');
                if (latEl) {
                    var lat = [];
                    for (var li = Math.max(0, t.length - STRIP_TICKS); li < t.length; li++) {
                        var lb = t[li];
                        if (lb && lb.status === 1 && typeof lb.ping === 'number') lat.push(lb.ping);
                    }
                    latEl.textContent = lat.length
                        ? '~' + Math.round(lat.reduce(function (a, b) { return a + b; }, 0) / lat.length) + ' ms'
                        : '— ms';
                }
            }
            row.classList.toggle('is-down', !up);
            renderStrip(row, list || []);
        }

        // Fetch the status page heartbeat (single call, object keyed by monitor ID).
        // Race a hung connection against a 10s timeout so the page degrades to
        // the honest catch path instead of spinning on the static defaults.
        var kumaAborter = ('AbortController' in window) ? new AbortController() : null;
        var kumaAbortTimer = kumaAborter ? setTimeout(function () { kumaAborter.abort(); }, 10000) : 0;
        fetch('https://status.mysweetpea.cc/api/status-page/heartbeat/' + STATUS_SLUG,
              kumaAborter ? { signal: kumaAborter.signal } : {})
            .then(function (r) {
                if (kumaAbortTimer) clearTimeout(kumaAbortTimer);
                return r.ok ? r.json() : Promise.reject();
            })
            .then(function (data) {
                if (!data || !data.heartbeatList) return Promise.reject();
                var hb = data.heartbeatList; // { "<monitorId>": [heartbeats...], ... }
                // uptimeList keys are "<monitorId>_<durationDays>" (e.g. "1_24"),
                // values are fractions 0..1 — normalize to a monitorId -> pct map
                var uptimePct = {}; var uptimeWin = {};
                if (data.uptimeList) {
                    Object.keys(data.uptimeList).forEach(function (k) {
                        var parts = k.split('_');
                        var id = parts[0], days = parts[1] ? parseInt(parts[1], 10) : 0;
                        var v = data.uptimeList[k];
                        if (typeof v === 'number' && (uptimePct[id] == null || days > uptimeWin[id])) {
                            uptimePct[id] = Math.round(v * 1000) / 10; uptimeWin[id] = days;
                        }
                    });
                }
                window.UPTIME_WIN = uptimeWin;
                var upCount = 0, total = 0;
                var uptimeSum = 0, uptimeCount = 0;
                /* Iterate OUR 9 monitor ids (not payload keys): a monitor
                   missing/empty from the payload must count as NOT REPORTING,
                   never silently vanish from the denominator. */
                Object.keys(MONITOR_IDS).forEach(function (k) {
                    var key = k, id = String(MONITOR_IDS[k]);
                    var row = document.querySelector('.status-line[data-service-key="' + key + '"]');
                    if (!row) return;
                    var list = (hb[id] || []).filter(function (b) { return b && typeof b.time === 'string'; });
                    if (!list.length) {
                        /* Not in payload / no beats: unknown, not operational. */
                        setRow(row, false, uptimePct[id] != null ? uptimePct[id] : null, [], true);
                        total++;
                        return;
                    }
                    /* Sort once by time; newest = max timestamp. Order-proof
                       against any future Kuma ordering change. */
                    list.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
                    var h = list[list.length - 1];
                    /* consistent outage semantics: only confirmed 0 is down
                       (pending 2 / maintenance 3 are not outages) */
                    var up = h.status !== 0;
                    if (up) upCount++;
                    total++;
                    var pct = uptimePct[id] != null ? uptimePct[id] : null;
                    if (pct != null) { uptimeSum += pct; uptimeCount++; }
                    setRow(row, up, pct, list);
                });
                var downCount = total - upCount;
                /* Banner class tells the truth: green ONLY when every one of
                   the 9 monitored services reported up. */
                if (summary) {
                    summary.classList.remove('status-all-online', 'status-degraded');
                    /* zero evaluated rows = nothing verified: degraded, never green */
                    summary.classList.add(downCount === 0 && total > 0 ? 'status-all-online' : 'status-degraded');
                }
                if (summaryText) {
                    /* textContent shows entities literally — use a real
                       middle dot. */
                    /* both branches derived from the actual denominator — a
                       missing row can never fabricate an all-green count */
                    summaryText.textContent = downCount === 0
                        ? (total + ' of ' + total + ' operational')
                        : (upCount + ' of ' + total + ' operational \u00B7 ' + downCount + ' down');
                }
                if (summaryTime) {
                    var now = new Date();
                    summaryTime.setAttribute('datetime', now.toISOString());
                    summaryTime.textContent = 'Updated ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                }
                // Connect the metric cards to real data
                if (uptimeCount) {
                    var avg = Math.round((uptimeSum / uptimeCount) * 10) / 10;
                    var wins = Object.keys(uptimeWin).map(function (k) { return uptimeWin[k]; });
                    var win = wins.length ? Math.min.apply(null, wins) : null;
                    var headPct = document.getElementById('summary-pct');
                    if (headPct) headPct.textContent = (win ? win + 'd avg ' : '') + avg + '%';
                }
            })
            .catch(function (err) {
                clearKumaTimer();
                console.warn('[msp] status feed failed:', err && err.message ? err.message : err);
                // Status feed unreachable (network error, CORS, non-OK, or malformed
                // payload). The static markup says "9 of 9 operational" — showing that
                // during a monitoring outage would fabricate an all-green page exactly
                // when accuracy matters most. Mark every card unknown and say so.
                // Strips are left EMPTY — never fake beats.
                if (summaryText) summaryText.textContent = 'Status unavailable';
                if (summaryTime) summaryTime.textContent = 'Live data unreachable';
                if (summary) {
                    summary.classList.remove('status-all-online');
                    summary.classList.add('status-degraded');
                }
                rows.forEach(function (card) {
                    var dot = card.querySelector('.status-dot');
                    if (dot) {
                        dot.classList.add('status-unknown');
                        dot.style.animation = 'none';
                    }
                    var badge = card.querySelector('.status-badge');
                    if (badge) {
                        badge.classList.remove('status-online', 'status-down');
                        badge.classList.add('status-unknown');
                    }
                    var label = card.querySelector('.badge-label');
                    if (label) label.textContent = 'Unknown';
                    var checksEl = card.querySelector('.sc-checks');
                    if (checksEl) checksEl.textContent = 'live data unavailable';
                });
            });
    })();

    /* === Incidents from n8n webhook (Telegram bot /incident command) === */
    (function () {
        var panel = document.querySelector('.incidents-panel');
        if (!panel) return;
        var empty = panel.querySelector('.incidents-empty');

        /* Fetch failure must say so: the static empty-state text was replaced
           with a neutral pending line, and a network error would otherwise
           leave "Checking…" forever — indistinguishable from a real outage
           handling. Show an explicit unavailable line instead. */
        var failEl = document.createElement('p');
        failEl.className = 'incidents-empty';
        failEl.textContent = 'Incident feed unavailable.';
        failEl.hidden = true;
        panel.appendChild(failEl);
        var aborter = ('AbortController' in window) ? new AbortController() : null;
        var abortTimer = aborter ? setTimeout(function () { aborter.abort(); }, 10000) : 0;
        function clearAbortTimer() { if (abortTimer) { clearTimeout(abortTimer); abortTimer = 0; } }
        fetch('https://subscribe.mysweetpea.cc/webhook/incidents', aborter ? { signal: aborter.signal } : {})
            .then(function (r) {
                clearAbortTimer();
                /* Non-2xx must hit the catch path: a 502 from the webhook is
                   NOT "no incidents" — that false all-clear is the worst thing
                   a status page can show. */
                if (!r.ok) return Promise.reject(new Error('HTTP ' + r.status));
                return r.text().then(function (t) {
                    if (!t) return [];                       /* truly empty body = empty feed */
                    var parsed = JSON.parse(t);              /* garbage body THROWS -> unavailable */
                    return parsed;
                });
            })
            .then(function (data) {
                var list = Array.isArray(data) ? data : (data && data.incidents) || [];
                if (!list.length) {
                    if (empty) { empty.textContent = 'No active incidents. All systems operational.'; empty.hidden = false; }
                    return;
                }
                if (empty) empty.hidden = true;
                if (failEl) failEl.hidden = true;
                list.filter(function (inc) { return inc && typeof inc === 'object'; }).forEach(function (inc) {
                    var item = document.createElement('div');
                    item.className = 'incident-item ' + (inc.status === 'resolved' ? 'incident-resolved' : 'incident-active');
                    var date = document.createElement('div');
                    date.className = 'incident-date';
                    date.textContent = inc.date || new Date().toLocaleDateString();
                    var body = document.createElement('div');
                    body.className = 'incident-body';
                    var strong = document.createElement('strong');
                    strong.textContent = inc.title || 'Incident';
                    body.appendChild(strong);
                    if (inc.description) body.appendChild(document.createTextNode(' — ' + inc.description));
                    var badge = document.createElement('span');
                    badge.className = 'incident-badge';
                    badge.textContent = inc.status === 'resolved' ? 'Resolved' : 'Active';
                    body.appendChild(badge);
                    item.appendChild(date);
                    item.appendChild(body);
                    panel.appendChild(item);
                });
            })
            .catch(function (err) {
                clearAbortTimer();
                console.warn('[msp] incident feed failed:', err && err.message ? err.message : err);
                /* Feed unreachable (network/CORS/timeout/malformed): say so —
                   the old comment claimed a "static fallback" but the static
                   item is deleted at init, so this used to render NOTHING. */
                if (empty) empty.hidden = true;
                if (failEl) failEl.hidden = false;
            });
    })();
