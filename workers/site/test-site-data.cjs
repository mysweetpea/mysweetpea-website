/* Regression guard for assets/js/site-data.js.
 *
 * Why this exists: validateService() used to REQUIRE `github`. One service
 * without a repo (moonfin) failed validation, so validateRoot() returned null
 * for BOTH the fetched JSON and the baked copy, MSP.data() resolved null, and
 * every data-driven surface died silently — the status page rendered
 * "0 of 0 operational" with no error anywhere. This test loads the real file
 * and fails if the baked copy (or a github-less variant) stops validating.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SITE = process.env.MSP_SITE_DIR || __dirname;
const SRC = fs.readFileSync(path.join(SITE, 'assets/js/site-data.js'), 'utf8');

function load(fetchImpl) {
  const sandbox = {
    console: { warn() {} },
    setTimeout, clearTimeout, AbortController,
    fetch: fetchImpl,
    document: {
      body: { getAttribute: () => 'status' },
      documentElement: { getAttribute: () => 'dark' },
      querySelector: () => null,
      querySelectorAll: () => []
    },
    localStorage: { getItem: () => null, setItem() {} },
    URL
  };
  sandbox.window = sandbox;
  sandbox.window.location = { href: 'https://mysweetpea.cc/' };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox.window.MSP;
}

/* Every fetch the module makes, minus what each test wants to break:
   status-page JSON is irrelevant here, heartbeat just needs a valid shape so
   its eager promise does not surface as an unhandled rejection. */
const offline = async (url) => {
  if (String(url).includes('site-data.json')) throw new Error('offline');
  return { ok: true, json: async () => ({ heartbeatList: {}, uptimeList: {} }) };
};

test('baked copy validates: every service reaches MSP.data()', async () => {
  const MSCP = load(offline);
  const d = await MSCP.data();
  assert.ok(d, 'MSP.data() resolved null — site-data validation failed');
  const json = JSON.parse(fs.readFileSync(path.join(SITE, 'assets/site-data.json'), 'utf8'));
  assert.equal(d.services.length, json.services.length, 'baked copy drifted from site-data.json — re-run deploy.py');
  const bakedMoonfin = d.services.find(s => s.key === 'moonfin');
  assert.ok(bakedMoonfin, 'baked copy is missing moonfin');
  /* hints only matter when the live fetch fails, i.e. exactly this path */
  assert.equal(bakedMoonfin.monitorHint, 65, 'baked monitorHint is stale — re-run deploy.py');
});

test('a service without a github url does not invalidate the whole payload', async () => {
  const json = JSON.parse(fs.readFileSync(path.join(SITE, 'assets/site-data.json'), 'utf8'));
  json.services.forEach(s => { delete s.github; });
  const MSCP = load(async (url) => (String(url).includes('site-data.json')
    ? { ok: true, json: async () => json }
    : { ok: true, json: async () => ({ heartbeatList: {}, uptimeList: {} }) }));
  const d = await MSCP.data();
  assert.ok(d, 'github must be optional — one repo-less service killed every widget');
  assert.equal(d.services.length, json.services.length);
});

/* Both github tests stamp a marker on the payload, so acceptance is
   observable: the served data carries the marker only if the FETCHED payload
   passed validation; otherwise the baked copy (no marker) is served. */
const fetchJson = (json) => async (url) => (String(url).includes('site-data.json')
  ? { ok: true, json: async () => json }
  : { ok: true, json: async () => ({ heartbeatList: {}, uptimeList: {} }) });

test('an empty github string means "no repo", not invalid', async () => {
  const json = JSON.parse(fs.readFileSync(path.join(SITE, 'assets/site-data.json'), 'utf8'));
  json.services.forEach(s => { s.github = ''; });
  json.services[0].name += ' MARKER';
  const d = await load(fetchJson(json)).data();
  assert.ok(d);
  assert.ok(d.services[0].name.endsWith('MARKER'), 'github:"" must be treated as absent, not as a schema failure');
});

test('a malformed github url still fails validation', async () => {
  const json = JSON.parse(fs.readFileSync(path.join(SITE, 'assets/site-data.json'), 'utf8'));
  json.services[0].github = 'https://evil.example/x';
  json.services[0].name += ' MARKER';
  const d = await load(fetchJson(json)).data();
  assert.ok(d, 'a rejected payload must still fall back to the baked copy');
  assert.ok(!d.services[0].name.endsWith('MARKER'), 'malformed github must reject the payload, not be served');
});

test('moonfin points at its own Kuma monitor, not jellyfin\'s', async () => {
  const json = JSON.parse(fs.readFileSync(path.join(SITE, 'assets/site-data.json'), 'utf8'));
  const byKey = {};
  json.services.forEach(s => { byKey[s.key] = s; });
  assert.equal(byKey.moonfin.monitorHint, 65);
  assert.notEqual(byKey.moonfin.monitorHint, byKey.jellyfin.monitorHint);
});
