/* services.html ships the no-JS skeleton: the badge numbers and the status
   labels a crawler (or a failed premium.js) sees are the STATIC markup. Both
   have drifted before — badges said 15 when the grid held 17, and every card
   claimed OPERATIONAL before a single heartbeat arrived. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SITE = process.env.MSP_SITE_DIR || __dirname;
const html = fs.readFileSync(path.join(SITE, 'services.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(SITE, 'assets/site-data.json'), 'utf8'));

const count = re => (html.match(re) || []).length;
const badge = filter => {
  const m = html.match(new RegExp(`data-filter="${filter}"[\\s\\S]{0,400}?class="f-count">(\\d+)<`));
  return m ? Number(m[1]) : null;
};

test('static badge counts match the cards they describe', () => {
  const live = count(/class="service-card/g);
  const soon = count(/class="coming-soon-card/g);
  assert.equal(badge('all'), live + soon, 'All must equal live + coming-soon');
  assert.equal(badge('sweetpea'), live, 'Sweet Pea must equal the live cards');
  assert.equal(badge('coming-soon'), soon, 'Coming Soon must equal its cards');
  const q = html.match(/id="csQueued"[^>]*>([^<]*)</);
  assert.match(q[1], new RegExp(`\\+${soon} queued`), 'queued chip must match the grid');
});

test('no card claims a live state before data arrives', () => {
  assert.equal(count(/Status: operational/g), 0, 'static markup must not assert operational');
  assert.equal(count(/title="Operational"/g), 0);
  assert.equal(count(/>LIVE</g), 0, 'no bare LIVE label in the skeleton');
  assert.equal(count(/class="status-dot status-unknown"/g), count(/class="service-card/g) + 1,
    'every live card plus the lightbox meta row start unknown');
});

test('coming-soon skeleton matches the validated data', () => {
  const names = [...html.matchAll(/coming-soon-card[\s\S]{0,600}?<h3[^>]*>(?:<button[^>]*>)?([^<]+)/g)]
    .map(m => m[1].trim());
  assert.deepEqual(names, data.comingSoon.map(c => c.name),
    'skeleton order/content must match site-data.json comingSoon');
  assert.equal(count(/class="service-card/g), data.services.length,
    'live cards must match site-data.json services');
});
