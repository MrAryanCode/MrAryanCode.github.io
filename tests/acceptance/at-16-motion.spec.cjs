// AT-16: reduced motion, the fallbacks and the pause control (B-08, D-023, D-038, CR1-B1).
// Every context presets sessionStorage `motion-level-pin` = 0 by an init script (algorithms.md A-3 (c), (d); CR4-O2).
const { test, expect } = require('@playwright/test');
const { mockGithub } = require('./github-mock.cjs');
const { ROUTES, hydrated, newContext, watchConsole } = require('./helpers.cjs');

const pinLevel = () => {
  try {
    window.sessionStorage.setItem('motion-level-pin', '0');
  } catch {
    // Storage may be blocked; nothing to pin then.
  }
};

const runningAnimations = (page) =>
  page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
const canvasCount = (page) => page.evaluate(() => document.querySelectorAll('canvas').length);
const tierOf = (page) => page.evaluate(() => document.documentElement.dataset.tier || '');

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const route of ROUTES) {
    test(`AT-16 reduce on ${route}`, async ({ page }) => {
      await page.addInitScript(pinLevel);
      await mockGithub(page);
      await page.goto(route);
      await hydrated(page);
      await page.waitForTimeout(1000);

      expect(await runningAnimations(page), 'no animation may run with reduced motion').toBe(0);
      expect(page.workers().length, 'no worker may exist with reduced motion').toBe(0);
      expect(await canvasCount(page), 'no <canvas> element of any kind, hidden or not (D-038)').toBe(0);
    });
  }
});

test.describe('reduced motion with JavaScript off', () => {
  test.use({ reducedMotion: 'reduce', javaScriptEnabled: false });

  for (const route of ROUTES) {
    test(`AT-16 no canvas without JavaScript on ${route}`, async ({ page }) => {
      await page.goto(route);
      expect(await page.locator('canvas').count(), 'no <canvas> element in the prerendered HTML').toBe(0);
    });
  }
});

test('AT-16 no preference: content, tier and the pause control', async ({ browser, baseURL }) => {
  const context = await newContext(browser, baseURL, { reducedMotion: 'no-preference' });
  try {
    await context.addInitScript(pinLevel);
    const page = await context.newPage();
    await mockGithub(page);
    const logs = watchConsole(page);
    await page.goto('/');
    await hydrated(page);

    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('main')).toBeVisible();
    await expect.poll(() => tierOf(page), { message: 'document.documentElement.dataset.tier must name the tier reached' }).not.toBe('');
    expect(logs.errors, 'no console error').toEqual([]);
    expect(logs.pageErrors, 'no page error').toEqual([]);

    // Press the pause button by keyboard: Tab to it, then Enter.
    const button = page.getByRole('button', { name: /^(Pause|Play) motion$/ });
    await expect(button).toHaveText('Pause motion');
    let focused = false;
    for (let i = 0; i < 12 && !focused; i += 1) {
      await page.keyboard.press('Tab');
      focused = await button.evaluate((el) => el === document.activeElement);
    }
    expect(focused, 'Tab must reach the pause button').toBe(true);
    await page.keyboard.press('Enter');
    await expect(button).toHaveText('Play motion');
    await expect(button).toHaveAttribute('aria-pressed', 'true');

    await page.waitForTimeout(1000);
    expect(await runningAnimations(page), 'no animation runs after Pause').toBe(0);
    expect(page.workers().length, 'no worker exists after Pause').toBe(0);
    expect(await page.locator('canvas:visible').count(), 'no canvas is visible after Pause').toBe(0);

    // Pressing it again plays again and sets dataset.tier again (CR1-B1).
    await page.keyboard.press('Enter');
    await expect(button).toHaveText('Pause motion');
    await expect.poll(() => tierOf(page), { message: 'dataset.tier must be set again after Play' }).not.toBe('');

    // Carry (D-023): pause, then follow the footer link in the same tab.
    await page.keyboard.press('Enter');
    await expect(button).toHaveText('Play motion');
    await page.locator('footer').getByRole('link', { name: 'Engineering report' }).click();
    await expect(page).toHaveURL(/\/report\/$/);
    await hydrated(page);
    const carried = page.getByRole('button', { name: /^(Pause|Play) motion$/ });
    await expect(carried).toHaveText('Play motion');
    await expect(carried).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(1000);
    expect(await runningAnimations(page), 'no animation runs on the next page after Pause').toBe(0);
    expect(page.workers().length, 'no worker exists on the next page after Pause').toBe(0);
  } finally {
    await context.close();
  }

  // A new page in a new browser context starts with Pause motion.
  const fresh = await newContext(browser, baseURL, { reducedMotion: 'no-preference' });
  try {
    await fresh.addInitScript(pinLevel);
    const page = await fresh.newPage();
    await mockGithub(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: /^(Pause|Play) motion$/ })).toHaveText('Pause motion');
  } finally {
    await fresh.close();
  }
});
