import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

/* Live audit of the public site (no auth needed). The status page is the
   contract that broke once — "0 of 0 operational" — so it asserts real Kuma
   rows, not just that the page loads. DOM reads go through browser.evaluate so
   the suite depends on nothing beyond app.open/evaluate/agent. */

test('home renders the nav and the theme toggle paints a real moon/sun glyph', async ({ app, browser }) => {
  await app.open('/');

  const navOk = await browser.evaluate(() => {
    const h = document.querySelector('nav.top-nav');
    if (!h) return false;
    const r = h.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(h).visibility !== 'hidden';
  });
  expect(navOk).toBe(true);

  const before = await browser.evaluate(() => document.documentElement.getAttribute('data-theme') || 'dark');
  await browser.evaluate(() => document.querySelector('.theme-toggle').click());
  const after = await browser.evaluate(() => document.documentElement.getAttribute('data-theme') || 'dark');
  expect(after === before).toBe(false);

  /* the toggle must show an icon-family glyph, never a service logo
     (the Nov 2026 regression shipped moonfin.svg inside .icon-moon) */
  const src = await browser.evaluate((theme) => {
    const img = document.querySelector(theme === 'light' ? '.icon-sun img' : '.icon-moon img');
    return img ? img.getAttribute('src') : '';
  }, after);
  expect(src).toContain('icon-ui-');
});

test('status page reports real Kuma monitors, never 0 of 0', async ({ app, browser }) => {
  await app.open('/status');

  /* the feed lands a moment after first paint — poll for a real number */
  const summary = await browser.evaluate(async () => {
    const read = () => (document.querySelector('#status-summary strong')?.textContent || '').trim();
    for (let i = 0; i < 60; i++) {
      const t = read();
      if (/operational/.test(t) && !/^0 of 0/.test(t)) return t;
      await new Promise((r) => setTimeout(r, 500));
    }
    return read();
  });
  expect(summary).toMatch(/^([1-9]\d*) of \1 operational$/);

  const rows = await browser.evaluate(() => document.querySelectorAll('.status-line[data-service-key]').length);
  expect(rows >= 9).toBe(true);

  /* rows stuck on the skeleton = the data layer collapsed, even if the summary lies */
  const stuck = await browser.evaluate(
    () => [...document.querySelectorAll('.badge-label')].filter((b) => /Checking/.test(b.textContent || '')).length,
  );
  expect(stuck).toBe(0);
});

test('agent: every service on the services page is named and reachable', async ({ app, agent }) => {
  await app.open('/services');
  await agent.assert('The Services page shows the services MySweetPea offers, each card naming the service and its purpose (for example Moonfin for films and shows, Nextcloud for files). Every card has a visible action. No card shows a placeholder such as "undefined", "NaN" or an empty title.');
});
