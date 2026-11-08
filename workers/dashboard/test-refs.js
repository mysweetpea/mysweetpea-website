#!/usr/bin/env node
/* Every app-prefixed helper identifier referenced in the SPA must be defined
   in it. An uncaught ReferenceError inside a boot function aborts everything
   after it, which is how hmAcctTiles/hmPosterCard/hmSvcOrb/hmWideCard
   silently killed the home tab's rails and hero. Bare references (passed to
   .map) count too, which a call-only check misses. */
const fs = require('fs');
let html;
try {
  html = fs.readFileSync(__dirname + '/public/index.html', 'utf8');
} catch (e) {
  console.error('FAIL - cannot read public/index.html: ' + e.message);
  process.exit(1);
}
const js = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

/* One small scanner instead of chained regexes: comments and string bodies are
   blanked, template `${...}` bodies are KEPT (a helper used only inside an
   interpolation is still a live reference), and an apostrophe in prose can no
   longer pair with one across a whole function and delete live code.
   ponytail: regex literals containing quotes are not modelled; add if one
   ever lands in the page. */
function strip(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; i++;
      out.push(' ');
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') { i += 2; continue; }
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          let depth = 1; i += 2; let inner = '';
          while (i < src.length && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') { depth--; if (!depth) { i++; break; } }
            inner += src[i++];
          }
          out.push(' ' + inner + ' ');
          continue;
        }
        i++;
      }
      i++;
      out.push(' ');
      continue;
    }
    out.push(c); i++;
  }
  return out.join('');
}

const code = strip(js);
if (!code.trim()) { console.error('FAIL - no inline script found (page restructured?)'); process.exit(1); }

/* Definitions are read from the RAW source on purpose: the scanner below is
   lossless for references but can swallow a run of code when a regex literal
   contains a quote, and a missed definition here fails a good deploy. Erring
   permissive is the safe direction: a commented-out definition can hide a real
   regression, a lost one blocks every deploy. */
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
// The app block is one async IIFE that suspends on /api/me, so a helper it
// defines below its first await does not exist when the LATER <script> blocks
// run — exactly how "apiGet is not defined @5816" shipped. Shared helpers must
// be defined in a block that precedes the block calling them.
{
  const blocks = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const defAt = blocks.findIndex((b) => /window\.apiGet\s*=/.test(b));
  const useAt = blocks.findIndex((b) => /\bapiGet\(/.test(b.replace(/window\.apiGet[\s\S]*?\n\s*\};/, '')));
  if (defAt < 0 || useAt < 0 || defAt > useAt) {
    console.error('FAIL window.apiGet must be defined before first use (def@' + defAt + ', use@' + useAt + ')');
    process.exitCode = 1;
  }
}

console.log('PASS - every app-prefixed identifier is defined (' + defined.size + ' definitions scanned)');
