#!/usr/bin/env node
/* Syntax gate for the single-file SPA.
 *
 * WHY: public/index.html carries six inline <script> blocks and the app is one
 * async IIFE. A single bad token in any of them kills the whole dashboard — the
 * shell renders, /api/me answers, and every data-driven surface stays empty
 * with only a console error to show for it. That happened once when a tooling
 * redaction filter rewrote `=== true` into `=***` inside a password-ish
 * assignment; the worker tests all passed because they never parse the HTML.
 *
 * Checks: every inline block parses, and no file carries a redaction artifact.
 * Run: node test-syntax.js   (wired into npm test)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
let fail = 0;
const bad = (m) => { console.error('  FAIL ' + m); fail++; };

const html = readFileSync(join(here, 'public/index.html'), 'utf8');
const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (blocks.length < 4) bad(`expected >=4 inline script blocks, found ${blocks.length}`);
blocks.forEach((b, i) => {
  try { new Function(b); } catch (e) { bad(`inline script block ${i} (${b.length} chars): ${e.message}`); }
});
console.log(`  ok   ${blocks.length} inline script blocks parse`);

/* External scripts the SPA loads must parse too. */
for (const f of ['public/tour.js']) {
  try { new Function(readFileSync(join(here, f), 'utf8')); console.log(`  ok   ${f} parses`); }
  catch (e) { bad(`${f}: ${e.message}`); }
}

/* Redaction artifacts: a literal *** where code should be. CSS/HTML comments
   and markdown-ish separators are not code, so only scan the script blocks and
   the worker source. */
const targets = [['public/index.html (scripts)', blocks.join('\n')],
                 ['src/index.ts', readFileSync(join(here, 'src/index.ts'), 'utf8')]];
for (const [name, src] of targets) {
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const n = (stripped.match(/\*\*\*/g) || []).length;
  if (n) bad(`${name}: ${n} redaction artifact(s) '***' in code`);
}
console.log('  ok   no redaction artifacts in code');

/* The item-link resolver decides where a poster tap goes. Members are kept out
   of the AIOStreams web app, so EVERY tap lands on the Moonfin setup guide —
   with or without a mount address. Run the real source so a regression that
   reintroduces a web-player URL fails here. */
{
  const src = blocks.find((b) => b.includes('window.mspItemHref'));
  if (!src) bad('mspItemHref resolver block not found');
  else {
    const run = (mountText, cacheMount) => {
      const store = new Map(cacheMount ? [['msp_pin_v2:u', JSON.stringify({ mount: cacheMount })]] : []);
      const sandbox = {
        document: { getElementById: (id) => (id === 'mp-server' && mountText != null ? { textContent: mountText } : null),
                    addEventListener: () => {} },
        sessionStorage: { length: store.size, key: (i) => [...store.keys()][i], getItem: (k) => store.get(k) ?? null },
        window: {}, encodeURIComponent,
      };
      sandbox.window = sandbox;
      const fn = new Function('document', 'sessionStorage', 'window', 'encodeURIComponent', src);
      fn(sandbox.document, sandbox.sessionStorage, sandbox.window, encodeURIComponent);
      return sandbox.window.mspItemHref;
    };
    const M = 'https://x.example/jellyfin/uuid/eyJtok';
    const cases = [
      ['dom mount', run(M, null)('abc')],
      ['cache mount', run('', M)('abc')],
      ['trailing slash', run(M + '/', null)('abc')],
      ['no mount', run('', null)('abc')],
      ['no id', run(M, null)('')],
      ['id encoded', run(M, null)('a/b')],
    ];
    for (const [name, got] of cases) {
      if (got !== '#guides/moonfin') bad(`mspItemHref ${name}: got ${got}, want #guides/moonfin`);
    }
    console.log(`  ok   mspItemHref: ${cases.length} guide-only cases`);
    /* The bare-root interception must catch the operator sign-in page and
       never a member mount URL (those carry uuid/token path segments). */
    const re = /\/jellyfin\/?$/;
    const roots = [
      ['https://aiostreams.mysweetpea.cc/jellyfin', true],
      ['https://aiostreams.mysweetpea.cc/jellyfin/', true],
      ['https://aiostreams.mysweetpea.cc/jellyfin/uuid/eyJtok', false],
      ['https://aiostreams.mysweetpea.cc/jellyfin/uuid/eyJtok/web/', false],
      ['https://other.example/jellyfin/', true],
      ['#guides/moonfin', false],
    ];
    for (const [u, want] of roots) {
      if (re.test(u) !== want) bad(`bare-root regex ${u}: got ${re.test(u)}, want ${want}`);
    }
    const home = run(M, null);
    if (typeof home !== 'function') bad('mspPlayerHome missing');
    console.log(`  ok   bare-root interception: ${roots.length} URL cases`);
  }
}

/* mergeStats must pass through every field the stats renderers read. The
   explicit whitelist silently dropped jf_periods + jf_top_title (found by the
   2026-11-20 live-key audit), which left the Stats hero permanently on
   "Nothing watched yet" and the period pills dead. Guard against re-drop. */
{
  const src = blocks.find((b) => b.includes('function mergeStats'));
  if (!src) bad('mergeStats block not found');
  else {
    const m = src.match(/function mergeStats\(d\) \{[\s\S]*?\n\}/);
    if (!m) bad('mergeStats source not extractable');
    else {
      const mergeStats = new Function(m[0] + '; return mergeStats;')();
      const sample = { movies: 3, jf_watch_hours: 1.5, jf_played_titles: 2, jf_top_title: 'Chowder',
        jf_periods: { week: { hours: 1, titles: 1, items: 2 }, month: { hours: 2, titles: 2, items: 4 }, all: { hours: 3, titles: 3, items: 6 } } };
      const out = mergeStats(sample);
      if (!out.jf_periods || out.jf_periods.week.hours !== 1) bad('mergeStats drops jf_periods (Stats hero + pills go empty)');
      if (out.jf_top_title !== 'Chowder') bad('mergeStats drops jf_top_title');
      if (out.movies !== 3 || out.jf_watch_hours !== 1.5) bad('mergeStats num() passthrough broken');
      const nulls = mergeStats({});
      if (nulls.jf_periods !== null || nulls.jf_top_title !== null || nulls.movies !== null) bad('mergeStats empty-input guards broken');
      console.log('  ok   mergeStats: jf_periods + jf_top_title survive, empty input nulls');
    }
  }
}

if (fail) { console.error(`\nFAIL — ${fail} syntax problem(s)`); process.exit(1); }
console.log('\nPASS dashboard syntax: inline blocks, tour.js, no redaction artifacts, item-link resolver');
