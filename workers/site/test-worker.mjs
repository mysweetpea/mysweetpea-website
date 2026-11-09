import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./src/index.js', import.meta.url), 'utf8');
const { default: worker } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const realFetch = globalThis.fetch;
let calls = 0;
let nowOffset = 0;
const realDateNow = Date.now;
Date.now = () => realDateNow() + nowOffset;
globalThis.fetch = async () => {
  calls++;
  await new Promise(resolve => setTimeout(resolve, 30));
  return Response.json([
    { sha: 'abcdef1234567890', commit: { message: 'feat: add a complete activity feed with every change included', author: { date: new Date().toISOString() } } },
    { sha: '1234567890abcdef', commit: { message: 'fix: test', author: { date: new Date().toISOString() } } },
  ]);
};
const env = {
  COMMITS_REPOS: 'mysweetpea/example',
  ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
};
const healthyFetch = globalThis.fetch;
try {
  const { default: coldWorker } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64') + '#cold-rss');
  globalThis.fetch = async () => Response.json({ message: 'outage' }, { status: 503 });
  const coldFeed = await coldWorker.fetch(new Request('https://mysweetpea.cc/feed.xml'), env);
  assert.equal(coldFeed.status, 503, 'a cold total outage must be retryable, never a fake empty feed');
  assert.equal(coldFeed.headers.get('Retry-After'), '30');
  globalThis.fetch = healthyFetch;
  console.log('PASS cold RSS outage returns a retryable 503');
  const request = () => new Request('https://mysweetpea.cc/api/commits');
  const responses = await Promise.all([worker.fetch(request(), env), worker.fetch(request(), env), worker.fetch(request(), env)]);
  assert.equal(calls, 1, 'three concurrent cold requests must share one upstream fetch');
  const bodies = await Promise.all(responses.map(r => r.json()));
  assert.equal(bodies[0].totals.fixes, 1);
  assert.equal(bodies[0].totals.features, 1);
  assert.equal(responses.every(r => r.headers.get('X-Cache') === 'MISS'), true);
  console.log('PASS concurrent cold /api/commits requests share one upstream fetch');

  const feed = await worker.fetch(new Request('https://mysweetpea.cc/feed.xml'), env);
  const xml = await feed.text();
  assert.equal((xml.match(/<item>/g) || []).length, 2, 'RSS includes highlights AND ordinary changes');
  assert.ok(xml.includes('mysweetpea/example/commit/abcdef1'), 'RSS uses the real GitHub repo slug');

  nowOffset = 301000;
  globalThis.fetch = async () => Response.json({ message: 'outage' }, { status: 500 });
  const stale = await worker.fetch(request(), env);
  const staleBody = await stale.json();
  assert.equal(stale.headers.get('X-Cache'), 'STALE', 'the outage probe must actually exercise the stale branch');
  assert.equal(staleBody.totals.fixes, 1, 'total upstream outage must retain the last good payload');
  assert.equal(staleBody.totals.features, 1);
  console.log('PASS RSS completeness + last-good changelog during GitHub outage');

  let suggested;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/api/me')) return Response.json({ username: 'member', name: 'Member' });
    if (String(url).endsWith('/webhook/suggest')) { suggested = JSON.parse(options.body); return Response.json({ ok: true }); }
    throw new Error('unexpected fetch: ' + url);
  };
  const suggest = body => worker.fetch(new Request('https://mysweetpea.cc/api/suggest', {
    method: 'POST', headers: { Origin: 'https://mysweetpea.cc', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), env);
  const accepted = await suggest({ service_name: 'Example', category: 'tools', reason: 'Useful to members' });
  assert.equal(accepted.status, 200, 'the real /api/me schema must authorize a signed-in member');
  assert.equal(suggested.your_name, 'Member', 'the server derives the member name');
  const oversized = await suggest({ service_name: 'Example', category: 'tools', reason: 'x'.repeat(5000) });
  assert.equal(oversized.status, 413, 'actual body bytes are capped even without a trustworthy Content-Length');
  console.log('PASS authenticated suggestions + actual request-byte limit');
} finally {
  globalThis.fetch = realFetch;
  Date.now = realDateNow;
}
