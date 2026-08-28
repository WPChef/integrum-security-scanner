import { test, expect } from '@playwright/test';
import { cleanupState, enableMock, expectNoPhpErrors, seedPhpWarning, isPhpCaptureEnabled } from './helpers';

/**
 * Harness self-check for the PHP error capture pipeline
 * (security-scanner-php-error-capture mu-plugin + afterEach debug.log
 * assertion in expectNoPhpErrors).
 *
 * The test seeds an artificial PHP warning via test-helper.php, loads a WP
 * page so the warning is written to wp-content/debug.log, and then relies on
 * the afterEach hook to fail the test on the captured log entry. test.fail()
 * marks that failure as expected: green = capture works. If the pipeline ever
 * stops catching PHP errors, this spec goes red.
 *
 * Skipped with a reason when the site has no capture mu-plugin deployed
 * (e.g. a DDEV runtime without local-env/php-error-capture.php copied into
 * wp-content/mu-plugins) — check that test-helper.php?action=get-debug-log
 * reports CAPTURE=on after deploying it.
 */
test.describe('PHP error capture harness', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupState(page);
    await enableMock(page);
  });

  test.afterEach(async ({ page }, testInfo) => {
    await expectNoPhpErrors(page, testInfo);
  });

  // Scan scenarios take minutes; the self-check keeps the default 300s budget.
  test.describe.configure({ timeout: 60_000 });

  test.fail('artificial PHP warning fails the test (debug.log capture)', async ({ page }) => {
    // Skip cleanly when the capture mu-plugin is not deployed on this site.
    const captureOn = await isPhpCaptureEnabled(page);
    if (captureOn !== true) {
      test.skip(true, 'php-error-capture mu-plugin not deployed on this site');
    }

    // Seed AFTER the beforeEach cleanup: the cleanup wipes both the log and
    // the trigger option, so seeding must happen inside the test body.
    await seedPhpWarning(page);

    // Any full WP request now emits the artificial E_USER_WARNING.
    await page.goto('/wp-login.php', { waitUntil: 'domcontentloaded' });

    // No explicit assertion here: the afterEach debug.log check is expected
    // to fail this test. Keep the page alive briefly for the trace.
    await expect(page.locator('#loginform')).toBeVisible();
  });
});
