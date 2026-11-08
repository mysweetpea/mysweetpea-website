#!/usr/bin/env node
/* Every app-prefixed helper identifier referenced in the SPA must be defined
   in it. An uncaught ReferenceError inside a boot function aborts everything
   after it, which is how hmAcctTiles/hmPosterCard/hmSvcOrb/hmWideCard
   silently killed the home tab's rails and hero. Bare references (passed to
   .map) count too, which a call-only check misses. */
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/public/index.html', 'utf8');
const js = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

// strip string literals first: localStorage keys like 'msp_onboarded' are not
// identifiers, and a quoted name in a comment is not a reference
const code = js.replace(/'(?:[^'\\]|\\.)*'/g, "''")
               .replace(/"(?:[^"\\]|\\.)*"/g, '""')
               .replace(/`(?:[^`\\]|\\.)*`/g, '``');

const defined = new Set([
  ...[...js.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]),
  ...[...js.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]),
  ...[...js.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)].map(m => m[1]),
]);

const PREFIX = /^(hm|rq|sv|st2|mp|rf|msp|gp|acct|ob)[A-Z_]/;
const refs = new Set();
for (const m of code.matchAll(/(?<![\w.$])([A-Za-z_$][\w$]*)(?![\w$])/g)) {
  const n = m[1];
  if (PREFIX.test(n) && !defined.has(n)) refs.add(n);
}

const missing = [...refs].sort();
if (missing.length) {
  console.error('FAIL - referenced but never defined:\n  ' + missing.join('\n  '));
  process.exit(1);
}
console.log('PASS - every app-prefixed identifier is defined (' + defined.size + ' definitions scanned)');
