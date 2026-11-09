import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

/* Same assertions as dashboard.e2e.ts, but /api/me is answered from a fixture
   so the run needs no member session. Every other /api/* request still goes to
   the network and fails the way it does for any headless browser behind
   Cloudflare — which is exactly what the Statistics step is written to accept
   (missing data must be explained, never silently blank). */
const USER = {
  username: 'e2e',
  name: 'E2E Render',
  email: 'e2e@example.com',
  groups: ['sweetpea'],
  tier: 'sweetpea',
  has_avatar: false,
  avatar_ts: 0,
};

test.beforeEach(async ({ browser }) => {
  await browser.route('**/api/me', (route) => route.fulfill({ json: USER }));
});

test('home renders its rails, not just the banner', async ({ app, browser }) => {
  await app.open('/');
  await expect(browser.locator('#hm-services-sec')).toBeVisible();
  const cards = await browser.evaluate(
    () => document.querySelectorAll('.hm-svc-row, .hm-svcrow, #hm-svc-rail a').length,
  );
  expect(cards).toBeGreaterThan(3);
  await expect(browser.locator('#hm-svc-rail')).toBeVisible();
});

test('moonfin links land on its setup guide, never the AIOStreams login', async ({ app, browser }) => {
  await app.open('/');
  const hrefs = await browser.evaluate(() => {
    const rail = [...document.querySelectorAll('#hm-svc-rail .hm-svcrow')];
    const moon = rail.find((a) => /Moonfin/.test(a.textContent || ''));
    const other = rail.find((a) => /Nextcloud/.test(a.textContent || ''));
    return {
      moonfin: moon ? moon.getAttribute('href') : null,
      nextcloud: other ? other.getAttribute('href') : null,
    };
  });
  expect(hrefs.moonfin).toBe('#guides/moonfin');
  expect(String(hrefs.nextcloud || '')).toContain('https://');
});

test('deep link #guides/vaultwarden opens that guide and keeps its key', async ({ app, browser }) => {
  await app.open('/#guides/vaultwarden');
  const state = await browser.evaluate(async () => {
    for (let i = 0; i < 40; i++) {
      const body = document.getElementById('guide-body');
      if (body && /Vaultwarden/.test(body.textContent || '')) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    return {
      tab: window.currentTab,
      hash: location.hash,
      head: (document.getElementById('guide-body')?.textContent || '').slice(0, 40),
    };
  });
  expect(state.tab).toBe('guides');
  expect(state.hash).toBe('#guides/vaultwarden');
  expect(state.head).toContain('Vaultwarden');
  expect(state.head).not.toContain('Moonfin');
});

test('agent drives the tabs and reports what it sees', async ({ app, agent }) => {
  await app.open('/');
  await agent.act('Open the Guides tab from the navigation.');
  await agent.assert('A list of services to choose from is visible, and choosing one shows step-by-step instructions.');
  await agent.act('Open the Statistics tab.');
  await agent.assert('The Statistics tab is open with a Week / Month / All time switch. Any missing data is explained by a visible notice, and there is no "NaN" or "undefined" text anywhere.');
});
