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

if (fail) { console.error(`\nFAIL — ${fail} syntax problem(s)`); process.exit(1); }
console.log('\nPASS dashboard syntax: inline blocks, tour.js, no redaction artifacts');
