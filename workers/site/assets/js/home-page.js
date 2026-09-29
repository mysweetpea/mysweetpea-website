/* home-page.js — home runtime: garden live-line, grow lines, count-ups,
   garden exposure accordion.
   JS convention for this file: ES5 only (var + function, no arrow/let/const),
   matching the site's no-build vanilla baseline. */

(function(){
  'use strict';
  function initMotion(){
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasIO = 'IntersectionObserver' in window;

  /* grow-lines: observe vines + eyebrows (skipped when IO unsupported —
     the accordion below must never depend on animation features) */
  if (hasIO) { var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('visible'); io.unobserve(e.target); } });
  }, {threshold:.2, rootMargin:'0px 0px -8% 0px'});
  document.querySelectorAll('.vine-divider.reveal-grow, .sec-eyebrow.reveal, .step').forEach(function(el){ io.observe(el); });
  } else {
    /* no IO: reveal decorations immediately so nothing stays invisible */
    document.querySelectorAll('.vine-divider.reveal-grow, .sec-eyebrow.reveal, .step, .reveal').forEach(function(el){ el.classList.add('visible'); });
  }

  /* count-up numerals in record tiles */
  function animateCount(el){
    var target = parseFloat(el.getAttribute('data-count'));
    var dec = parseInt(el.getAttribute('data-dec') || '0', 10);
    var suffix = el.getAttribute('data-suffix') || '';
    if (!isFinite(target)) { el.textContent = (el.getAttribute('data-count') || '') + suffix; return; }
    if (reduce || !(target > 0)) { el.textContent = target.toFixed(dec) + suffix; return; }
    var t0 = null, dur = 1100;
    function step(ts){
      if(!t0) t0 = ts;
      var p = Math.min((ts - t0)/dur, 1);
      var eased = 1 - Math.pow(1-p, 4);
      el.textContent = (target*eased).toFixed(dec) + suffix;
      if(p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if (hasIO) {
    var cio = new IntersectionObserver(function(entries){
      entries.forEach(function(e){ if(e.isIntersecting){ animateCount(e.target); cio.unobserve(e.target); } });
    }, {threshold:.4});
    document.querySelectorAll('.record .cnt').forEach(function(el){ cio.observe(el); });
  } else {
    /* paint final values directly when IO is unavailable */
    document.querySelectorAll('.record .cnt').forEach(function(el){ animateCount(el); });
  }

  /* garden exposure rows: one delegated listener, rows toggle independently.
     The head is a real <button> so keyboard (Enter/Space) works natively; the
     hidden attribute flips display and CSS runs the fade-in — no measuring. */
  var rowsBox = document.getElementById('gardenRows');
  if (rowsBox) {
    rowsBox.addEventListener('click', function(ev){
      var t = ev.target;
      if (!t || !t.closest) return;
      var head = t.closest('.g-row-head');
      if (!head || !rowsBox.contains(head)) return;
      var wasOpen = head.getAttribute('aria-expanded') === 'true';
      var panel = document.getElementById(head.getAttribute('aria-controls'));
      if (!panel) return;
      head.setAttribute('aria-expanded', wasOpen ? 'false' : 'true');
      panel.hidden = wasOpen;
      var row = head.closest('.garden-row');
      if (row) {
        if (wasOpen) row.classList.remove('open');
        else row.classList.add('open');
      }
    });
  }
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMotion);
  else initMotion();

/* uptime tile: paints the "Measured uptime · last 24 hours" record tile.
   (The garden live line was removed 2026-09; the Kuma fetch stays because the
   tile still needs it — do not restore a live line without re-adding painters.)
   Kuma contract: uptimeList["<id>_24"] = fraction 0..1 across monitors 1-9.
   Runs inside the same DOM-ready contract as initMotion (defer scripts
   always execute after the DOM is parsed, but this keeps one pattern). */
  function initLive(){
    var recUptime = document.getElementById('recUptime');
    if (!recUptime) return;
    /* 10s budget covers the WHOLE exchange (headers + body). AbortController
       when present; otherwise a losing Promise.race rejects us out of a hung
       fetch — the tile must never silently sit on its static default. */
    var aborter = ('AbortController' in window) ? new AbortController() : null;
    var abortTimer = setTimeout(function(){ if (aborter) aborter.abort(); }, 10000);
    function clearAbort(){ clearTimeout(abortTimer); }
    function paintUnavailable(){
      /* honesty rule: the tile must not keep pretending — mark it so the
         count-up never re-aims at the stale 99.9 default. data-count AND
         textContent both: an animation already in flight re-reads data-count
         on its final frame, and a not-yet-started one reads it at start. */
      recUptime.removeAttribute('data-count');
      recUptime.textContent = '—';
    }
    var p = fetch('https://status.mysweetpea.cc/api/status-page/heartbeat/public', aborter ? { signal: aborter.signal } : {})
      .then(function(r){ clearAbort(); return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function(data){
        if (!data || !data.uptimeList) throw new Error('no uptimeList');
        var sum = 0, n = 0;
        for (var u = 1; u <= 9; u++) {
          var v = data.uptimeList[u + '_24'];
          if (typeof v === 'number' && v >= 0 && v <= 1) { sum += v; n++; }
        }
        if (n === 9) {
          var avg = (Math.round((sum / n) * 1000) / 10).toFixed(1);
          recUptime.setAttribute('data-count', avg);
          recUptime.textContent = avg;   /* paint live value (count-up may re-read data-count on final frame) */
        } else {
          console.warn('[msp] uptime tile: partial monitor set (' + n + '/9) — keeping static value');
        }
      })
      .catch(function(err){ clearAbort(); console.warn('[msp] uptime tile fetch failed:', err && err.message ? err.message : err); paintUnavailable(); });
    /* belt-and-braces: if AbortController is unsupported the fetch itself can
       hang forever — race the chain against a hard 10s timeout. (With
       AbortController the abort already rejects p; this race is harmless.) */
    var timeout = new Promise(function(_, rej){ setTimeout(function(){ rej(new Error('timeout')); }, 10000); });
    Promise.race([p, timeout]).catch(function(err){
      if (err && err.message === 'timeout') paintUnavailable();
    });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initLive);
  else initLive();
})();
