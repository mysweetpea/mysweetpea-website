const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SITE = process.env.MSP_SITE_DIR || __dirname;
const read = name => fs.readFileSync(path.join(SITE, name), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function classList(el) {
  const names = () => el.className.split(/\s+/).filter(Boolean);
  return {
    add(...xs) { el.className = [...new Set(names().concat(xs))].join(' '); },
    remove(...xs) { el.className = names().filter(x => !xs.includes(x)).join(' '); },
    contains(x) { return names().includes(x); },
    toggle(x, force) {
      const on = force === undefined ? !names().includes(x) : !!force;
      if (on) this.add(x); else this.remove(x);
      return on;
    }
  };
}

function element(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(), className: '', attrs: {}, children: [], style: {},
    hidden: false, textContent: '', value: '', listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'hidden') this.hidden = true; },
    getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
    insertBefore(child, before) {
      const i = this.children.indexOf(before);
      this.children.splice(i < 0 ? this.children.length : i, 0, child);
      child.parentElement = this; return child;
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      if (selector === 'h3') {
        const all = [];
        const walk = node => { for (const c of node.children) { if (c.tagName === 'H3') all.push(c); walk(c); } };
        walk(this); return all;
      }
      const key = selector.match(/data-cs-key="([^"]+)"/);
      if (key) return this.children.filter(c => c.getAttribute('data-cs-key') === key[1]);
      if (selector.includes('.service-card') || selector.includes('.coming-soon-card')) {
        return this.children.filter(c => {
          const wanted = c.classList.contains('service-card') || c.classList.contains('coming-soon-card');
          return wanted && (!selector.includes(':not([hidden])') || !c.hidden);
        });
      }
      return [];
    }
  };
  el.classList = classList(el);
  return el;
}

function fakeTimers() {
  let id = 0;
  const pending = new Map();
  return {
    setTimeout(fn, ms) { pending.set(++id, { fn, ms }); return id; },
    clearTimeout(n) { pending.delete(n); },
    fire(ms) {
      const entry = [...pending.values()].find(x => x.ms === ms);
      assert.ok(entry, `expected a ${ms}ms timer`);
      entry.fn();
    }
  };
}

function abortingFetch(calls) {
  return (url, options) => {
    calls.push({ url, options });
    return new Promise((resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  };
}

function response(data) {
  return { ok: true, text: () => Promise.resolve(JSON.stringify(data)) };
}

test('reconciled service cards reveal, join animation cleanup, and update every tier count', async () => {
  const src = read('assets/js/services-page.js');
  const reconcile = src.slice(0, src.indexOf('/* === Tier dividers'));
  const grid = element(); grid.className = 'coming-soon-grid';
  const sweet = element(); sweet.attrs['data-tier-group'] = 'sweetpea';
  const service = element(); service.className = 'service-card'; sweet.appendChild(service);
  grid.attrs['data-tier-group'] = 'coming-soon';
  const existing = element(); existing.className = 'coming-soon-card reveal';
  const heading = element('h3'); heading.textContent = 'Existing'; existing.appendChild(heading); grid.appendChild(existing);
  const counts = ['all', 'sweetpea', 'coming-soon'].map(tier => {
    const btn = element('button'); btn.attrs['data-filter'] = tier;
    const count = element('span'); count.textContent = '0'; count.closest = () => btn;
    return { tier, count };
  });
  const chip = element();
  const document = {
    querySelector(selector) {
      if (selector === '.coming-soon-grid') return grid;
      const tier = selector.match(/data-tier-group="([^"]+)"/);
      return tier ? (tier[1] === 'sweetpea' ? sweet : grid) : null;
    },
    querySelectorAll(selector) {
      if (selector === '.service-card') return sweet.children;
      if (selector === '.coming-soon-card:not([hidden])') return grid.children.filter(c => !c.hidden);
      if (selector === '.filter-btn .f-count') return counts.map(x => x.count);
      return [];
    },
    getElementById: id => id === 'csQueued' ? chip : null,
    createElement: element
  };
  vm.runInNewContext(reconcile, {
    window: { MSP: { data: () => Promise.resolve({ comingSoon: [
      { key: 'existing', name: 'Existing' },
      { key: 'new', name: 'New', icon: '/new.svg', keywords: 'new', blurb: 'New service' }
    ] }) } }, document
  });
  await flush();
  const added = grid.children.find(c => c.getAttribute('data-cs-key') === 'new');
  assert.ok(added.classList.contains('visible'));
  added.style.animation = 'cardIn';
  added.listeners.animationend[0]({ animationName: 'cardIn' });
  assert.equal(added.style.animation, 'none');
  assert.deepEqual(counts.map(x => x.count.textContent), ['3', '1', '2']);
});

async function checkFormPostTimeout() {
  const src = read('assets/js/form-page.js');
  const start = src.indexOf('    function post(');
  const fn = src.slice(start, src.indexOf("    ['ga-submit'", start));
  const timers = fakeTimers(), calls = [];
  const overlay = element();
  const post = new Function('document', 'window', 'fetch', 'setTimeout', 'clearTimeout', 'updateButtons',
    `${fn}; return post;`)(
      { getElementById: () => overlay }, { matchMedia: () => ({ matches: true }) },
      abortingFetch(calls), timers.setTimeout, timers.clearTimeout, () => {}
    );
  const btn = element('button');
  post('/request', {}, btn, 'Try again', '/success', 'overlay');
  assert.ok(calls[0].options.signal, 'POST must receive an AbortSignal');
  timers.fire(15000);
  await flush();
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(btn.disabled, false);
  assert.equal(btn.classList.contains('loading'), false);
  assert.equal(btn.textContent, 'Request timed out — try again');
}
test('access POST aborts and recovers after 15s', checkFormPostTimeout);

test('redemption POST aborts and recovers after 15s', async () => {
  const src = read('assets/js/redeem-page.js');
  const start = src.indexOf(" btn.addEventListener('click',function(){");
  const handler = src.slice(start, src.indexOf('\n paint();', start));
  const timers = fakeTimers(), calls = [];
  const btn = element('button');
  const values = { 'rc-code': 'PEA-ABCDEFGH', 'rc-name': 'Pea', 'rc-email': 'p@example.com', 'rc-username': 'pea' };
  new Function('btn', 'document', 'window', 'fetch', 'setTimeout', 'clearTimeout',
    `var endpoint = '/redeem', posting = false; function update(){} function normCode(v){return v;} ${handler}`
  )(btn, { getElementById: id => ({ value: values[id] }) }, { location: {} },
    abortingFetch(calls), timers.setTimeout, timers.clearTimeout);
  btn.listeners.click[0]();
  assert.ok(calls[0].options.signal, 'POST must receive an AbortSignal');
  timers.fire(15000);
  await flush();
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(btn.disabled, false);
  assert.equal(btn.classList.contains('loading'), false);
  assert.equal(btn.textContent, 'Request timed out — try again');
});

test('submission paths omit the signal when AbortController is unavailable', () => {
  for (const file of ['assets/js/form-page.js', 'assets/js/redeem-page.js', 'suggest.html']) {
    const src = read(file);
    assert.ok(/typeof AbortController\s*!==\s*'undefined'/.test(src), file + ': missing constructor guard');
    assert.ok(src.includes('aborter ? aborter.signal : undefined') || src.includes('aborter?aborter.signal:undefined'), file + ': missing conditional signal');
  }
});

function suggestHarness(fetchImpl) {
  const src = read('suggest.html');
  const start = src.indexOf("        document.getElementById('s-submit').addEventListener('click'");
  const end = src.indexOf('        /* Keep aria-invalid', start);
  const handler = src.slice(start, end);
  const ids = ['s-name', 's-url', 's-category', 's-reason', 's-yourname', 's-youremail'];
  const els = Object.fromEntries(ids.map(id => [id, { value: id === 's-category' ? 'other' : id }]));
  const btn = element('button'), success = element(), card = element();
  success.hidden = true;
  els['s-submit'] = btn; els.successMsg = success;
  const timers = fakeTimers();
  new Function('document', 'window', 'fetch', 'setTimeout', 'clearTimeout', 'lockForm',
    `var submitGeneration = 0; ${handler}`
  )({
    getElementById: id => els[id], querySelector: () => card
  }, { scrollTo() {} }, fetchImpl, timers.setTimeout, timers.clearTimeout, () => {});
  return { btn, success, card, timers, click: () => btn.listeners.click[0].call(btn) };
}

test('suggestion POST aborts and recovers after 15s', async () => {
  const calls = [];
  const h = suggestHarness(abortingFetch(calls));
  h.click();
  assert.ok(calls[0].options.signal, 'POST must receive an AbortSignal');
  h.timers.fire(15000);
  await flush();
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(h.btn.disabled, false);
  assert.equal(h.btn.textContent, 'Timed out — try again.');
});

test('duplicate suggestions stay pending; failure permits one retry', async () => {
  const calls = [];
  const h = suggestHarness((url, options) => new Promise((resolve, reject) => calls.push({ resolve, reject, options })));
  h.click(); h.click();
  assert.equal(calls.length, 1, 'an in-flight submission cannot be duplicated');
  calls[0].resolve(response({ ok: false, msg: 'Retry failed' }));
  await flush(); await flush();
  h.click();
  assert.equal(calls.length, 2, 'a failed submission can be retried');
});

async function shareResult(clipboard, fallbackResult) {
  const script = read('support.html').match(/<script id="shareBtnScript">([\s\S]*?)<\/script>/)[1];
  const btn = element('button'); btn.attrs['data-share'] = 'share this';
  const document = {
    getElementById: () => btn,
    createElement: () => ({ style: {}, select() {}, focus() {}, setSelectionRange() {} }),
    body: { appendChild() {}, removeChild() {} },
    execCommand: () => fallbackResult
  };
  vm.runInNewContext(script, { document, navigator: { clipboard }, setTimeout() {} });
  btn.listeners.click[0]();
  await flush();
  return btn.textContent;
}

test('share copy reports success only after a fulfilled write or verified fallback', async () => {
  assert.equal(await shareResult({ writeText: () => Promise.resolve() }, false), 'Copied!');
  assert.equal(await shareResult({ writeText: () => Promise.reject(new Error('denied')) }, true), 'Copied!');
  assert.equal(await shareResult({ writeText: () => Promise.reject(new Error('denied')) }, false), 'Copy failed');
  assert.equal(await shareResult(null, false), 'Copy failed');
});

test('every FAQ is the shared native-details card', () => {
  const pages = ['index.html', 'services.html', 'support.html'];
  for (const p of pages) {
    const html = read(p);
    assert.ok(html.includes('faq-wrap fq-cards'), p + ': missing shared FAQ wrapper');
    assert.ok(!/faq-item|faq-question|toggle-faq/.test(html), p + ': old accordion markup still present');
    const cards = (html.match(/<details class="reveal"><summary><span class="fq-n">/g) || []).length;
    assert.ok(cards >= 4, p + ': expected numbered detail cards, found ' + cards);
  }
  assert.ok(/\.faq-wrap\.fq-cards summary\{/.test(read('assets/css/premium.css')), 'shared FAQ styles missing from premium.css');
  assert.ok(!read('assets/css/home.css').includes('.fq-cards'), 'home.css must not keep page-scoped FAQ styles');
  assert.ok(!read('assets/js/site.js').includes('toggle-faq'), 'site.js still carries the retired accordion handler');
});
