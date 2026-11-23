/* Evals the REAL syncCounts() from assets/js/home-page.js against stubbed
   MSP promises. Fails if the live-Kuma pill stops reflecting real uptime. */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'assets/js/home-page.js'), 'utf8');
const start = src.indexOf('  function syncCounts(){');
if (start < 0) throw new Error('syncCounts() not found');
let depth = 0, end = -1;
for (let i = src.indexOf('{', start); i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
}
const fnSrc = src.slice(start, end);

async function pillWith(heartbeat, monitors) {
  const pill = { textContent: '9/9 services live', attrs: {},
    getAttribute(n) { return this.attrs[n] === undefined ? null : this.attrs[n]; },
    setAttribute(n, v) { this.attrs[n] = v; if (n === 'title') this.title = v; } };
  pill.attrs['data-pill'] = 'services-live';
  const doc = {
    querySelectorAll(sel) {
      if (sel === '.proof-stat') return [];           // skip the count-up branch
      if (sel === '.what-pill') return [];
      return [];
    },
    querySelector(sel) { return sel === '[data-pill="services-live"]' || sel === '.what-pill' ? pill : null; },
  };
  const MSP = {
    data: () => Promise.resolve({ services: [{ key: 'a' }, { key: 'b' }, { key: 'c' }], siteFacts: {} }),
    monitors: () => Promise.resolve(monitors || { byKey: { a: 1, b: 2, c: 3 } }),
    heartbeat: () => heartbeat,
  };
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', fnSrc + '\n syncCounts();')({ MSP }, doc);
  for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0));
  return pill;
}

function beats(statuses) {
  const hb = {};
  statuses.forEach((s, i) => { hb[String(i + 1)] = [{ status: s }]; });
  return { heartbeatList: hb };
}

(async () => {
  const allUp = await pillWith(Promise.resolve(beats([1, 1, 1])));
  if (allUp.textContent !== '3/3 services live') throw new Error('all-up: ' + allUp.textContent);

  const oneDown = await pillWith(Promise.resolve(beats([1, 0, 1])));
  if (oneDown.textContent !== '2/3 services live') throw new Error('one-down: ' + oneDown.textContent);

  const maintenance = await pillWith(Promise.resolve(beats([1, 3, 1])));
  if (maintenance.textContent !== '2/3 services live') throw new Error('maintenance: ' + maintenance.textContent);

  const feedDown = await pillWith(Promise.reject(new Error('status API down')));
  if (feedDown.textContent !== '9/9 services live' || feedDown.title !== 'Live status temporarily unavailable')
    throw new Error('feed-failure: ' + JSON.stringify(feedDown));

  const noBeats = await pillWith(Promise.resolve({ heartbeatList: {} }));
  if (noBeats.textContent !== '9/9 services live') throw new Error('empty-heartbeat: ' + noBeats.textContent);

  console.log('PASS home-pill: 5 cases (all-up, down, maintenance, feed-failure, empty-heartbeat)');
})().catch(e => { console.error('FAIL home-pill:', e.message); process.exit(1); });
