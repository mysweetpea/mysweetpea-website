#!/usr/bin/env node
/* Checks for the dashboard tour. Run: node test-tour.js
 *
 * 1. Every step `target` selector exists in index.html — a typo'd selector
 *    fails SILENTLY in the browser (the step just renders centred, no spotlight).
 * 2. The hooks the tour drives still exist.
 * 3. stagePath() never emits a non-finite path. REGRESSION GUARD: emitting
 *    `d="MNaN,…"` makes the SVG invalid, and browsers then KEEP THE PREVIOUS
 *    `d` — which left a stale spotlight box on screen on centred steps.
 */
const fs = require('fs');
const path = require('path');

const tour = fs.readFileSync(path.join(__dirname, 'public/tour.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');

let bad = 0;

/* ── 1. step targets ──────────────────────────────────────────────────── */
const targets = [...tour.matchAll(/target:\s*(['"`])([^'"`]+)\1/g)].map((m) => m[2]);
if (!targets.length) { console.error('FAIL: no targets found — did the step shape change?'); process.exit(1); }
for (const sel of [...new Set(targets)]) {
  const id = sel.startsWith('#') ? sel.slice(1) : null;
  const cls = sel.startsWith('.') ? sel.slice(1) : null;
  if (!id && !cls) { console.error('  FAIL unsupported selector: ' + sel); bad++; continue; }
  const ok = id
    ? html.includes('id="' + id + '"')
    : new RegExp('class="[^"]*\\b' + cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(html);
  console.log(`  ${ok ? 'ok  ' : 'MISS'} ${sel}`);
  if (!ok) bad++;
}

/* ── 2. driven hooks ──────────────────────────────────────────────────── */
const hooks = ['setTab', 'nav-toggle', 'dh-menu', 'acct-pop', 'acct-trigger'];
// dh-lock is a body class the tour toggles, so it is styled in a <style> block
// rather than written in markup — check it against the whole file.
const cssHooks = ['dh-lock'];
const markup = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
for (const h of cssHooks) {
  const ok = html.includes(h);
  console.log(`  ${ok ? 'ok  ' : 'MISS'} css-hook:${h}`);
  if (!ok) bad++;
}
for (const h of hooks) {
  const ok = new RegExp('(id|class)="[^"]*\\b' + h + '\\b|function\\s+' + h + '\\b|window\\.' + h + '\\s*=').test(markup);
  console.log(`  ${ok ? 'ok  ' : 'MISS'} hook:${h}`);
  if (!ok) bad++;
}

/* ── 3. stagePath regression guard ────────────────────────────────────── */
const src = tour.match(/function stagePath\(s\)\s*\{[\s\S]*?\n  \}/);
if (!src) { console.error('FAIL: could not extract stagePath from tour.js'); process.exit(1); }
const radius = (tour.match(/var RADIUS\s*=\s*(\d+(?:\.\d+)?)/) || [])[1];
if (!radius) { console.error('FAIL: could not read RADIUS from tour.js'); process.exit(1); }
const stagePath = new Function(
  'window',
  'const RADIUS = ' + radius + '; ' + src[0] + '; return stagePath;'
)({ innerWidth: 390, innerHeight: 844 });

const cases = [
  ['null (centred step)', null],
  ['zero size', { x: 10, y: 10, w: 0, h: 0 }],
  ['NaN x', { x: NaN, y: 10, w: 100, h: 50 }],
  ['NaN w — the old null-tween bug', { x: 10, y: 10, w: NaN, h: 50 }],
  ['undefined h', { x: 10, y: 10, w: 100, h: undefined }],
  ['negative size', { x: 10, y: 10, w: -50, h: -50 }],
  ['normal box', { x: 20, y: 300, w: 340, h: 60 }],
  ['tiny box', { x: 5, y: 5, w: 2, h: 2 }],
];
for (const [name, s] of cases) {
  const d = stagePath(s);
  const ok = typeof d === 'string' && d.length > 0 && !/NaN|undefined|Infinity/.test(d);
  console.log(`  ${ok ? 'ok  ' : 'MISS'} stagePath: ${name}`);
  if (!ok) bad++;
}

// a real box must produce exactly two subpaths (outer dim + the cutout)
const hasCut = (stagePath({ x: 20, y: 300, w: 340, h: 60 }).match(/M/g) || []).length === 2;
console.log(`  ${hasCut ? 'ok  ' : 'MISS'} stagePath: normal box has a cutout (2 subpaths)`);
if (!hasCut) bad++;

console.log(bad
  ? `\nFAIL — ${bad} problem(s)`
  : `\nPASS — ${new Set(targets).size} targets, ${hooks.length} hooks, ${cases.length + 1} stagePath cases`);
process.exit(bad ? 1 : 0);
