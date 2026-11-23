/* Runs the real assets/js/about-page.js with no MSP feed at all (the
   unreachable path) and asserts the uptime tile does not keep showing the
   server-rendered 99.9%. A plausible number next to "LIVE DATA UNREACHABLE"
   is exactly the fake-liveness that file exists to prevent. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(process.env.MSP_SITE_DIR || __dirname, 'assets/js/about-page.js');

function node(cls) {
  const el = {
    className: cls || '', textContent: '', hidden: false, attrs: {}, _q: {},
    classList: { _s: new Set(), add(...x) { x.forEach(v => this._s.add(v)); },
                 remove(...x) { x.forEach(v => this._s.delete(v)); },
                 contains(v) { return this._s.has(v); } },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    querySelector(sel) { return this._q[sel] || null; },
    insertAdjacentText() {},
  };
  return el;
}

test('unreachable uptime prints a dash, not the 99.9 placeholder', async () => {
  const dot = node('about-x-dot');
  const label = node('about-x-live-txt');
  const state = node('about-x-live');
  state._q['.about-x-dot'] = dot;
  state._q['.about-x-live-txt'] = label;

  const ticker = node('about-x-rk');

  const small = node('small');
  const pct = node('about-x-bv');
  pct.textContent = '99.9';
  pct.attrs['data-count'] = '99.9';
  const holder = node('about-x-bv');
  holder._q['small'] = small;
  pct.parentElement = holder;

  const byId = { aboutUptimeState: state, aboutTickerState: ticker, aboutUptimePct: pct };
  const sandbox = {
    console,
    Promise,
    window: { matchMedia: () => ({ matches: false }) },   // no MSP -> feed rejects
    document: {
      getElementById: id => byId[id] || null,
      querySelectorAll: () => [],
    },
    performance: { now: () => 0 },
  };
  sandbox.window.document = sandbox.document;
  sandbox.window.performance = sandbox.performance;

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'about-page.js' });

  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  assert.equal(pct.textContent, '\u2014', 'uptime must be a dash when unreachable');
  assert.equal(pct.getAttribute('data-count'), null, 'data-count must be dropped so a pending count-up cannot repaint it');
  assert.equal(small.hidden, true, 'the % suffix must hide with the number');
  assert.equal(ticker.textContent, 'STATUS UNAVAILABLE');
});
