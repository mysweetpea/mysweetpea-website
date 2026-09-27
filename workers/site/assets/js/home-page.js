/* home-page.js — home runtime: garden live-line, grow lines, count-ups,
   garden exposure accordion.
   JS convention for this file: ES5 only (var + function, no arrow/let/const),
   matching the site's no-build vanilla baseline. */

(function(){
  'use strict';
  function initMotion(){
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* grow-lines: observe vines + eyebrows */
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('visible'); io.unobserve(e.target); } });
  }, {threshold:.2, rootMargin:'0px 0px -8% 0px'});
  document.querySelectorAll('.vine-divider.reveal-grow, .sec-eyebrow.reveal, .step').forEach(function(el){ io.observe(el); });

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
  var cio = new IntersectionObserver(function(entries){
    entries.forEach(function(e){ if(e.isIntersecting){ animateCount(e.target); cio.unobserve(e.target); } });
  }, {threshold:.4});
  document.querySelectorAll('.record .cnt').forEach(function(el){ cio.observe(el); });

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

/* garden live line + uptime tile: paints the shared status line under the
   garden grid AND the "Measured uptime · last 24 hours" record tile.
   Kuma contract: heartbeatList keyed by monitor id (1-9 = our services);
   status===1 means up; uptimeList["<id>_24"] = fraction 0..1.
   Runs inside the same DOM-ready contract as initMotion (defer scripts
   always execute after the DOM is parsed, but this keeps one pattern). */
  function initLive(){
    var live = document.getElementById('gardenLive');
    var recUptime = document.getElementById('recUptime');
    if (!live && !recUptime) return;
    var txt = live ? live.querySelector('.gl-txt') : null;
    var aborter = ('AbortController' in window) ? new AbortController() : null;
    /* timer is cleared on EVERY settle path (success AND failure), not just
       success — a stray timer aborts nothing but was never reaped. */
    var abortTimer = aborter ? setTimeout(function(){ aborter.abort(); }, 10000) : 0;
    function clearAbort(){ if (abortTimer) { clearTimeout(abortTimer); abortTimer = 0; } }
    function paintUnavailable(){
      if (txt) txt.textContent = 'live status unavailable';
      /* honesty rule: the tile must not keep pretending — mark it so the
         count-up never re-aims at the stale 99.9 default. */
      if (recUptime) recUptime.removeAttribute('data-count');
    }
    fetch('https://status.mysweetpea.cc/api/status-page/heartbeat/public', aborter ? { signal: aborter.signal } : {})
      .then(function(r){ clearAbort(); return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function(data){
        var hb = data && data.heartbeatList;
        if (!hb) throw new Error('no heartbeatList');
        var up = 0, seen = 0;
        for (var id = 1; id <= 9; id++) {
          var beats = hb[String(id)];
          if (beats && beats.length) { seen++; if (beats[beats.length - 1].status === 1) up++; }
        }
        if (txt) txt.textContent = seen ? (up + '/' + seen + ' services live') : 'live status unavailable';
        /* gardenLive removed from the page: recUptime tile still needs the fetch result */
        /* real 24h average for the record tile (same math as status page) */
        if (recUptime && data.uptimeList) {
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
        }
      })
      .catch(function(err){ clearAbort(); console.warn('[msp] live status fetch failed:', err && err.message ? err.message : err); paintUnavailable(); });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initLive);
  else initLive();
})();
