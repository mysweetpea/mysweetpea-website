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
      var current = parseFloat(el.getAttribute('data-count'));
      if (!isFinite(current)) return;
      target = current;
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

  /* === Dynamic service count (home proof-stat + what-pill) ================
     Markup ships data-count="9" / "9/9 services live" as the SEO static. At
     runtime we re-aim them at the validated service list so adding a service
     never requires editing index.html numbers again. */
  function syncCounts(){
    if (!window.MSP) return;
    window.MSP.data().then(function(d){
      if (!d || !d.services) return;
      var n = d.services.length;
      var tiles = Array.prototype.slice.call(document.querySelectorAll('.proof-stat'));
      tiles.forEach(function (tile) {
        var nine = tile.querySelector('.proof-value[data-count]');
        var lab = tile.querySelector('.proof-label');
        if (!nine || !lab) return;
        if (!/public services/i.test(lab.textContent)) return;
        nine.setAttribute('data-count', String(n));
        /* if the count-up already fired (text is a finished number, not the
           initial 0), repaint directly — data-count alone won't re-run it */
        var t = parseFloat(nine.textContent);
        if (isFinite(t) && t > 0) nine.textContent = String(n);
      });
      var pill = document.querySelector('.what-pill');
      if (pill && pill.textContent.indexOf('services live') !== -1) {
        pill.textContent = n + '/' + n + ' services live';
      }
      var nr = (d.siteFacts && d.siteFacts.publicRepos) || (d.repos || []).length || 0;
      if (nr) {
        var rp = Array.prototype.slice.call(document.querySelectorAll('.what-pill')).find(function (p2) {
          return p2.textContent.indexOf('public repos') !== -1;
        });
        if (rp) rp.textContent = nr + ' public repos you can see for yourself';
      }
    }).catch(function(){});
  }
  syncCounts();
})();
