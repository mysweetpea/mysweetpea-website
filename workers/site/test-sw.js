const assert = require('node:assert/strict');
const fs = require('node:fs');
const src = fs.readFileSync('sw.js', 'utf8');
const handlers = {};
const self = { location: new URL('https://mysweetpea.cc/'), addEventListener: (n, fn) => { handlers[n] = fn; }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
const store = new Map();
const cache = { put: async (req, res) => { store.set(req.url, res); }, match: async (req) => store.get(typeof req === 'string' ? new URL(req, self.location).href : req.url) };
const caches = { open: async () => cache, match: cache.match, keys: async () => [], delete: async () => true };
let upstreamCalls = 0;
const fetchMock = async (req) => { upstreamCalls++; return new Response('fresh-' + upstreamCalls, { status: 200, headers: { 'content-type': 'text/plain' } }); };
new Function('self', 'caches', 'fetch', src)(self, caches, fetchMock);

(async () => {
  let responded = false;
  handlers.fetch({ request: new Request('https://mysweetpea.cc/api/auth/state'), respondWith: () => { responded = true; }, waitUntil: () => {} });
  assert.equal(responded, false, '/api/auth/state must bypass the service-worker cache');
  assert.equal(upstreamCalls, 0, 'the SW must not consume private API traffic');

  store.set('https://mysweetpea.cc/assets/js/site.js', new Response('old'));
  const waits = [];
  let responsePromise;
  handlers.fetch({ request: new Request('https://mysweetpea.cc/assets/js/site.js'), respondWith: p => { responsePromise = p; }, waitUntil: p => waits.push(Promise.resolve(p)) });
  const response = await responsePromise;
  assert.equal(await response.text(), 'old', 'cached asset should serve immediately');
  await Promise.all(waits);
  assert.equal(upstreamCalls, 1);
  assert.equal(await (await cache.match('https://mysweetpea.cc/assets/js/site.js')).text(), 'fresh-1', 'background revalidation must be kept alive');
  console.log('PASS private APIs bypass SW caching; static SWR revalidation is awaited');
})().catch(e => { console.error(e); process.exit(1); });
