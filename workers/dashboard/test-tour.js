#!/usr/bin/env node
/* Verifies the dashboard tour's step targets actually exist in index.html.
 * A typo'd selector fails silently in the browser (step renders centred, no
 * spotlight) — this is the check that catches it. Run: node test-tour.js
 */
const fs = require('fs');
const path = require('path');

const tour = fs.readFileSync(path.join(__dirname, 'public/tour.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');

// pull every target: '#x' / '.x' out of the step arrays
const targets = [...tour.matchAll(/target:\s*'([^']+)'/g)].map((m) => m[1]);
if (!targets.length) { console.error('FAIL: no targets found — did the step shape change?'); process.exit(1); }

let bad = 0;
for (const sel of [...new Set(targets)]) {
  const id = sel.startsWith('#') ? sel.slice(1) : null;
  const cls = sel.startsWith('.') ? sel.slice(1) : null;
  const ok = id
    ? new RegExp(`id="${id}"`).test(html)
    : new RegExp(`class="[^"]*\\b${cls}\\b`).test(html);
  console.log(`  ${ok ? 'ok  ' : 'MISS'} ${sel}`);
  if (!ok) bad++;
}

// the tour drives these existing hooks — if they are renamed, the tour dies quietly
const hooks = ['setTab', 'nav-toggle', 'dh-menu', 'dh-lock', 'acct-pop', 'acct-trigger'];
for (const h of hooks) {
  const ok = html.includes(h);
  console.log(`  ${ok ? 'ok  ' : 'MISS'} hook:${h}`);
  if (!ok) bad++;
}

console.log(bad ? `\nFAIL — ${bad} missing` : `\nPASS — ${new Set(targets).size} targets + ${hooks.length} hooks all present`);
process.exit(bad ? 1 : 0);
