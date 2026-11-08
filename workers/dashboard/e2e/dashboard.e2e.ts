import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

/* Live audit of the member dashboard. The session cookie is pre-seeded from
   E2E_SESSION (no password is ever typed by the agent). */
const SESSION = process.env.E2E_SESSION as string;

test.beforeEach(async ({ browser }) => {
  await browser.setCookies([
    {
      name: 'msp_dash_session',
      value: SESSION,
      domain: 'dashboard.mysweetpea.cc',
      path: '/',
      secure: true,
      httpOnly: true,
    },
  ]);
});

test('home renders its rails, not just the banner', async ({ app, browser }) => {
  await app.open('/');
  await expect(browser.locator('#hm-services-sec')).toBeVisible();
  // Each rail must carry real cards — an empty rail is the failure the owner saw.
  const cards = await browser.evaluate(
    () => document.querySelectorAll('.hm-svc-row, .hm-svcrow, #hm-svc-rail a').length,
  );
  expect(cards).toBeGreaterThan(3);
  await expect(browser.locator('#hm-svc-rail')).toBeVisible();
});

test('agent drives the tabs and reports what it sees', async ({ app, agent }) => {
  await app.open('/');
  await agent.act('Open the Guides tab from the navigation.');
  await agent.assert('A list of services to choose from is visible, and choosing one shows step-by-step instructions.');
  await agent.act('Open the Statistics tab.');
  // Cloudflare challenges headless XHR, so the API answers 401/403 here. What
  // must hold either way: the tab opens, the period switch works, and missing
  // data is EXPLAINED rather than silently blank.
  await agent.assert('The Statistics tab is open with a Week / Month / All time switch. Any missing data is explained by a visible notice, and there is no "NaN" or "undefined" text anywhere.');
});
