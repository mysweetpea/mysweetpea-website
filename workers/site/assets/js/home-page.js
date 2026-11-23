/* home-page.js — home runtime: garden live-line, grow lines, count-ups,
   garden exposure accordion.
   JS convention for this file: ES5 only (var + function, no arrow/let/const),
   matching the site's no-build vanilla baseline. */

(function(){
  'use strict';
  function initMotion(){
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var hasIO = 'IntersectionObserver' in window;

  /* garden film: reduced-motion users get a settled frame, never the loop */
  var film = document.querySelector('.pl-disc video');
  if (film && reduce) {
    film.removeAttribute('autoplay');
    film.setAttribute('preload', 'auto');
    film.addEventListener('loadeddata', function(){ try { film.pause(); film.currentTime = 4; } catch(e){} });
    try { film.pause(); } catch(e){}
  }

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

  /* count-ups live in premium.js (.proof-value[data-count]); the .record/.cnt
     block that used to sit here observed markup no page contains. */

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
        if (tile.getAttribute('data-proof') !== 'services' && !/public services/i.test(lab.textContent)) return;
        nine.setAttribute('data-count', String(n));
        /* if the count-up already fired (text is a finished number, not the
           initial 0), repaint directly — data-count alone won't re-run it.
           Keep the tile's suffix: a bare String(n) turned "9+" into "12". */
        var t = parseFloat(nine.textContent);
        if (isFinite(t) && t > 0) nine.textContent = String(n) + (nine.getAttribute('data-suffix') || '');
      });
      var pill = document.querySelector('[data-pill="services-live"]') || document.querySelector('.what-pill');
      if (pill && (pill.getAttribute('data-pill') === 'services-live' || pill.textContent.indexOf('services live') !== -1)) {
        /* Reuse the page's shared monitors/heartbeat promises — no extra fetch.
           Status 1 = confirmed up; 0 down, 2 pending, 3 maintenance. */
        if (!window.MSP.monitors || !window.MSP.heartbeat) return;
        Promise.all([window.MSP.monitors(), window.MSP.heartbeat()]).then(function (r) {
          var byKey = (r[0] && r[0].byKey) || {};
          var hb = (r[1] && r[1].heartbeatList) || {};
          if (!Object.keys(byKey).length || !Object.keys(hb).length) return;
          var up = 0;
          d.services.forEach(function (svc) {
            var id = byKey[svc.key];
            var beats = (id === null || id === undefined) ? null : hb[String(id)];
            if (beats && beats.length && beats[beats.length - 1].status === 1) up++;
          });
          pill.textContent = up + '/' + n + ' services live';
        }).catch(function () {
          pill.setAttribute('title', 'Live status temporarily unavailable');
        });
      }
      var nr = (d.siteFacts && d.siteFacts.publicRepos) || (d.repos || []).length || 0;
      if (nr) {
        var rp = document.querySelector('[data-pill="repos"]');
        if (rp) rp.textContent = nr + ' public repos you can see for yourself';
      }
    }).catch(function(){});
  }
  syncCounts();
})();
