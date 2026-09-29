/* form.html — Get Access form logic (moved verbatim from inline script; CSP-hash friendly).
   Additions (v108): panel .revealed toggle for CSS reveal animation, submit success state. */
(function () {
    var WEBHOOK_BASE = 'https://subscribe.mysweetpea.cc/webhook';
    var ENDPOINTS = { donationRequest: WEBHOOK_BASE + '/donation-request', sweetPeaRequest: WEBHOOK_BASE + '/sweetpea-request' };
    var WALLETS = { monero: 'Coming Soon', bitcoin: 'Coming Soon' };
    var chosenCrypto = '';
    function valid(type, value) {
        value = value.trim();
        if (type === 'name') return value.length >= 2;
        if (type === 'why') return value.length >= 20; /* 'why you' note: a real sentence, not a shrug */
        if (type === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
        if (type === 'username') return /^[A-Za-z0-9_]{3,}$/.test(value);
        if (type === 'tx') {
            /* Chain-aware: XMR + BTC txids are 64 hex chars; accept either
               but reject obvious garbage. Unknown future chains: >=16 alnum. */
            var v = value.trim();
            if (/^[0-9a-fA-F]{64}$/.test(v)) return true;
            return /^[0-9a-zA-Z]{16,}$/.test(v);
        }
        return false;
    }
    var fields = { 'ga-name':'name', 'ga-email':'email', 'ga-username':'username', 'ga-txhash':'tx', 'sp-name':'name', 'sp-email':'email', 'sp-message':'why' };
    function validateField(id) {
        var input = document.getElementById(id), ok = valid(fields[id], input.value);
        input.classList.toggle('valid', ok); input.classList.toggle('invalid', input.value.trim().length > 0 && !ok);
        var icon = document.getElementById(id + '-icon');
        if (icon) { icon.classList.toggle('show', input.value.trim().length > 0); icon.classList.toggle('valid', ok); icon.classList.toggle('invalid', input.value.trim().length > 0 && !ok); icon.textContent = ok ? '✓' : '×'; }
        updateUsernameChecks(id); updateButtons(); return ok;
    }
    function updateUsernameChecks(id) {
        if (id !== 'ga-username') return;
        var v = document.getElementById(id).value;
        var checks = document.querySelectorAll('#ga-username-checks .uc-item');
        if (!checks.length) return;
        var rules = { len: v.length >= 3, alnum: /[A-Za-z0-9]/.test(v), underscore: /^[A-Za-z0-9_]+$/.test(v) };
        checks.forEach(function (c) {
            var k = c.getAttribute('data-uc');
            var ok = rules[k];
            c.classList.toggle('ok', ok);
            var icon = c.querySelector('.uc-icon');
            if (icon) icon.textContent = ok ? '✓' : '×';
        });
    }
    Object.keys(fields).forEach(function (id) { document.getElementById(id).addEventListener('input', function(){ validateField(id); }); document.getElementById(id).addEventListener('blur', function(){ validateField(id); }); });
    function allValid(ids) { return ids.every(function(id){ return valid(fields[id], document.getElementById(id).value); }); }
    function updateButtons() {
        var gaVerify = document.getElementById('ga-verify');
        var spVerify = document.getElementById('sp-verify');
        document.getElementById('ga-submit').disabled = !(allValid(['ga-name','ga-email','ga-username','ga-txhash']) && !!chosenCrypto && gaVerify && gaVerify.checked);
        document.getElementById('sp-submit').disabled = !(allValid(['sp-name','sp-email','sp-message']) && spVerify && spVerify.checked);
    }
    ['ga-verify','sp-verify'].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener('change',updateButtons);});
    var spMsg = document.getElementById('sp-message');
    if (spMsg) spMsg.addEventListener('input', function(){ validateField('sp-message'); });
    document.querySelectorAll('.access-choice-card').forEach(function (card) {
        card.addEventListener('click', function () {
            var tier = card.getAttribute('data-tier');
            /* Seedling is a "coming soon" placeholder until crypto donations are
               wired up — clicking it must NOT reveal the dead donation form. */
            if (card.classList.contains('coming-soon')) {
                /* Keyboard users activate this real <button> with Enter/Space —
                   give them the same feedback pointer users get from the
                   COMING SOON badge instead of a silent no-op. */
                if (typeof window.showToast === 'function') {
                    window.showToast('The Seedling Tier is coming soon — requests open at launch.', 'info');
                }
                return;
            }
            document.querySelectorAll('.access-choice-card').forEach(function(c){var picked=c===card;c.classList.toggle('selected',picked);c.setAttribute('aria-pressed',String(picked));});
            // Reveal the panel first so the form exists, then smooth-scroll to it.
            ['seedling','sweetpea'].forEach(function(name){var panel=document.getElementById('panel-'+name),active=name===tier;panel.hidden=!active;panel.classList.toggle('active',active);panel.classList.toggle('revealed',active);});
            var formSection = document.querySelector('.tier-form-section');
            if (formSection) {
                var target = formSection.getBoundingClientRect().top + window.pageYOffset - 90;
                var startY = window.pageYOffset;
                var dist = target - startY;
                var dur = Math.min(700, Math.max(350, Math.abs(dist) * 0.5));
                var startT = null;
                function step(ts) {
                    if (!startT) startT = ts;
                    var p = Math.min(1, (ts - startT) / dur);
                    var ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
                    window.scrollTo(0, startY + dist * ease);
                    if (p < 1) requestAnimationFrame(step);
                }
                requestAnimationFrame(step);
            }
            /* Update progress indicator: step 1 done, step 2 active */
            var steps = document.querySelectorAll('.form-progress .step');
            var connectors = document.querySelectorAll('.form-progress .connector');
            if (steps.length >= 3) {
                steps[0].classList.remove('active'); steps[0].classList.add('done');
                steps[1].classList.remove('done'); steps[1].classList.add('active');
                steps[2].classList.remove('active','done');
            }
            if (connectors.length >= 2) { connectors[0].classList.add('done'); connectors[1].classList.remove('done'); }
        });
    });
    document.querySelectorAll('.crypto-option').forEach(function(button){
        var type=button.getAttribute('data-type');
        if(!WALLETS[type] || WALLETS[type]==='Coming Soon'){button.disabled=true;button.classList.add('unavailable');var label=document.createElement('span');label.className='crypto-soon';label.textContent='Coming soon';button.appendChild(label);return;}
        button.addEventListener('click',function(){chosenCrypto=type;document.querySelectorAll('.crypto-option').forEach(function(b){b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',b===button?'true':'false');});var display=document.getElementById('wallet-display'),address=document.getElementById('wallet-addr');address.textContent=WALLETS[type];address.setAttribute('aria-label','Copy donation address '+WALLETS[type]);display.hidden=false;renderQR(WALLETS[type]);updateButtons();});
    });
    /* QR code for the selected wallet (renders once a real address exists) */
    function renderQR(text) {
        var wrap = document.getElementById('qr-wrap');
        if (!wrap || !text || text === 'Coming Soon') { if (wrap) wrap.hidden = true; return; }
        if (typeof qrcode === 'undefined') { wrap.hidden = true; return; }
        var canvas = document.getElementById('wallet-qr');
        canvas.width = 160; canvas.height = 160;
        var qr = qrcode(0, 'M');
        qr.addData(text);
        qr.make();
        var ctx = canvas.getContext('2d');
        var cells = qr.getModuleCount();
        var size = 160 / cells;
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 160, 160);
        ctx.fillStyle = '#000';
        for (var r = 0; r < cells; r++) {
            for (var c = 0; c < cells; c++) {
                if (qr.isDark(r, c)) ctx.fillRect(c * size, r * size, size, size);
            }
        }
        wrap.hidden = false;
    }
    document.getElementById('wallet-addr').addEventListener('click',function(){var b=this;navigator.clipboard.writeText(b.textContent).then(function(){var x=b.textContent;b.textContent='Copied!';setTimeout(function(){b.textContent=x;},1600);});});
    function post(endpoint,data,btn,defaultLabel,successUrl,overlayId){btn.disabled=true;btn.classList.add('loading');btn.textContent='Submitting…';var overlay=document.getElementById(overlayId);if(overlay)overlay.classList.add('active');fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.text().then(function(t){if(t){try{return JSON.parse(t);}catch(e){return {ok:r.ok};}}return {ok:r.ok};});}).then(function(result){if(!result.ok)throw new Error(result.msg||'Submission failed');if(overlay)overlay.classList.remove('active');btn.classList.add('success');btn.textContent='Request sent';if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches){window.location.href=successUrl;return;}setTimeout(function(){window.location.href=successUrl;},900);}).catch(function(e){btn.disabled=false;btn.classList.remove('loading');btn.textContent=e.message||'Try again';if(overlay)overlay.classList.remove('active');if(typeof showToast==='function')showToast(e.message||'Submission failed — please try again','error');setTimeout(function(){btn.textContent=defaultLabel;updateButtons();},3000);});}
    ['ga-submit','sp-submit'].forEach(function(id){
        var f=document.getElementById(id).closest('form');
        if(!f)return;
        f.addEventListener('submit',function(e){e.preventDefault();document.getElementById(id).click();});
    });
    document.getElementById('ga-submit').addEventListener('click',function(){if(this.disabled)return;post(ENDPOINTS.donationRequest,{name:document.getElementById('ga-name').value.trim(),email:document.getElementById('ga-email').value.trim(),username:document.getElementById('ga-username').value.trim(),crypto_type:chosenCrypto,tx_hash:document.getElementById('ga-txhash').value.trim()},this,'Submit Seedling Request','/success.html?type=seedling','seedling-overlay');});
    document.getElementById('sp-submit').addEventListener('click',function(){if(this.disabled)return;post(ENDPOINTS.sweetPeaRequest,{name:document.getElementById('sp-name').value.trim(),email:document.getElementById('sp-email').value.trim(),message:document.getElementById('sp-message').value.trim(),tier:'sweetpea'},this,'Submit Sweet Pea Request','/success.html?type=sweetpea-request','sweetpea-overlay');});
    var requested = new URLSearchParams(location.search).get('tier'); if(requested==='sweetpea'){var card=document.querySelector('.access-choice-card[data-tier="sweetpea"]');if(card)card.click();}
    updateButtons();
    /* ==== v109 addition — Conservatory Night-Bloom wiring (bloom + vine rail +
       submit .ready). Presentation-only: reuses the exact predicates defined
       above (valid()/allValid()/chosenCrypto/checkbox state); adds no new
       validation rules and does not touch submit gating (the disabled attr
       stays owned by updateButtons()). ==== */
    var bloomPanels = [
        { panelId: 'panel-sweetpea', bloomId: 'sp-bloom', btnId: 'sp-submit',
          isReady: function () { return allValid(['sp-name', 'sp-email']) && !!(document.getElementById('sp-verify') || {}).checked; },
          nodeOk: [null,
            function () { return valid('name', document.getElementById('sp-name').value); },
            function () { return valid('email', document.getElementById('sp-email').value); },
            function () { return allValid(['sp-name', 'sp-email']) && !!(document.getElementById('sp-verify') || {}).checked; }] },
        { panelId: 'panel-seedling', bloomId: 'ga-bloom', btnId: 'ga-submit',
          isReady: function () { return allValid(['ga-name', 'ga-email', 'ga-username', 'ga-txhash']) && !!chosenCrypto && !!(document.getElementById('ga-verify') || {}).checked; },
          nodeOk: [null,
            function () { return valid('name', document.getElementById('ga-name').value); },
            function () { return valid('email', document.getElementById('ga-email').value); },
            function () { return valid('username', document.getElementById('ga-username').value); },
            function () { return !!chosenCrypto; },
            function () { return valid('tx', document.getElementById('ga-txhash').value) && !!(document.getElementById('ga-verify') || {}).checked; }] }
    ];
    function syncBloomAndRail() {
        bloomPanels.forEach(function (p) {
            var ready = p.isReady();
            var bloom = document.getElementById(p.bloomId);
            if (bloom) bloom.classList.toggle('open', ready);
            var btn = document.getElementById(p.btnId);
            if (btn) btn.classList.toggle('ready', ready);
            var rail = document.querySelector('#' + p.panelId + ' .rail');
            if (!rail) return;
            var nodes = rail.querySelectorAll('.node');
            var done = 0;
            for (var i = 0; i < nodes.length; i++) {
                var ok = i === 0 || !!(p.nodeOk[i] && p.nodeOk[i]());
                nodes[i].classList.toggle('done', ok);
                if (ok) done++;
            }
            var vine = rail.querySelector('.vine');
            if (vine) vine.style.setProperty('--growth', Math.round((done / nodes.length) * 100) + '%');
        });
    }
    ['sp-name', 'sp-email', 'sp-verify', 'ga-name', 'ga-email', 'ga-username', 'ga-txhash', 'ga-verify'].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', syncBloomAndRail);
        el.addEventListener('change', syncBloomAndRail);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.crypto-option'), function (b) {
        b.addEventListener('click', syncBloomAndRail);
    });
    syncBloomAndRail();

    /* ==== Polish r4 — anchored spine: pin each rail node vertically to its
       field row. Uses offsetTop walks (layout boxes, immune to the reveal
       transition's transform) + double-rAF re-run after each trigger. ==== */
    function offsetWithin(el, ancestor) {
        var t = 0, n = el;
        while (n && n !== ancestor) { t += n.offsetTop; n = n.offsetParent; }
        return t;
    }
    function alignRailToRows() {
        ['panel-sweetpea', 'panel-seedling'].forEach(function (pid) {
            var panel = document.getElementById(pid);
            var rail = panel && panel.querySelector('.rail');
            if (!panel || !rail) return;
            var card = panel.querySelector('.form-card');
            if (!card) return;
            var railH = rail.offsetHeight || 1;
            var rows = Array.prototype.slice.call(panel.querySelectorAll('.srow'))
                .filter(function (r) { return r.offsetParent !== null; });
            var cov = panel.querySelector('.covenant');
            var btn = panel.querySelector('.form-submit');
            var centers = rows.map(function (r) {
                return offsetWithin(r, card) + r.offsetHeight / 2;
            });
            if (cov && cov.offsetParent) centers.push(offsetWithin(cov, card) + Math.min(40, cov.offsetHeight / 2));
            if (btn && btn.offsetParent) centers.push(offsetWithin(btn, card) + btn.offsetHeight / 2);
            var nodes = rail.querySelectorAll('.node');
            for (var i = 0; i < nodes.length && i < centers.length; i++) {
                /* rail spans its own box; convert card-y to rail-y */
                var railTop = offsetWithin(rail, card);
                var y = centers[i] - railTop - 13; /* 13 = half node */
                nodes[i].style.top = Math.max(-2, Math.min(railH - 24, Math.round(y))) + 'px';
            }
        });
    }
    function alignRailSoon() {
        requestAnimationFrame(function () { requestAnimationFrame(alignRailToRows); });
    }
    window.addEventListener('resize', alignRailSoon);
    document.fonts && document.fonts.ready && document.fonts.ready.then(alignRailSoon);
    ['panel-sweetpea', 'panel-seedling'].forEach(function (pid) {
        var p = document.getElementById(pid);
        if (!p) return;
        new MutationObserver(alignRailSoon).observe(p, { attributes: true, attributeFilter: ['hidden', 'class'] });
        p.addEventListener('transitionend', alignRailSoon);
    });
    setTimeout(alignRailSoon, 350);
    setTimeout(alignRailSoon, 1200);
})();
