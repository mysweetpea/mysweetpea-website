/* seal-field.png is the black-ink cat on a teal rounded SQUARE. Inside a
   circular medallion it reads as a square badge floating in a ring (the ink
   reaches r=287/512 of its own box, so a circular crop clips the ears instead
   of fixing it). seal-ink.png is the same art keyed to transparent ink and is
   what any circular container must use. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SITE = process.env.MSP_SITE_DIR || __dirname;
const read = f => fs.readFileSync(path.join(SITE, f), 'utf8');

const circles = [
  ['index.html', '.gk-seal', '05 The Gardener medallion'],
  ['services.html', '.so-core', 'services orbit centre disc'],
];

for (const [page, cls, label] of circles) {
  test(`${label} uses the transparent seal, not the stamp`, () => {
    const html = read(page);
    const m = html.match(new RegExp(`class="${cls.replace('.', '')}"[\\s\\S]{0,200}?<img[^>]*>`));
    assert.ok(m, `${cls} markup not found in ${page}`);
    assert.match(m[0], /seal-ink\.png/, `${cls} must use seal-ink.png`);
    assert.doesNotMatch(m[0], /seal-field\.png/, `${cls} must not use the square stamp`);
  });
}

test('the cutout asset exists and the stylesheet sizes it relative to the disc', () => {
  assert.ok(fs.existsSync(path.join(SITE, 'assets/icons/seal-ink.png')), 'seal-ink.png missing');
  const css = read('assets/css/premium.css') + read('assets/css/home.css');
  const gk = css.match(/\.gk-seal img\s*\{[^}]*width:\s*72%/);
  const so = css.match(/\.so-core img\s*\{[^}]*width:\s*75%/);
  assert.ok(gk, 'gardener medallion must size the ink as a % of the disc');
  assert.ok(so, 'services disc must size the ink as a % of the disc');
});
