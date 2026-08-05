import { type Page } from '@playwright/test';

/**
 * Base URL for the test-helper.php script on the WordPress site.
 */
const HELPER_URL = 'https://llar-imunify.ddev.site/test-helper.php';

/**
 * Admin page slug for the File Security Scanner plugin.
 */
const ADMIN_URL = '/wp-admin/admin.php?page=security-scanner';

/**
 * WP admin credentials for the test environment.
 */
const ADMIN = { user: 'admin', pass: 'admin' };

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

/**
 * Displays a scenario banner before test execution.
 */
export async function showScenario(page: Page, text: string): Promise<void> {
  await page.goto(`${HELPER_URL}?action=echo&message=${encodeURIComponent(text)}`);
  await page.waitForTimeout(1500);
}

/**
 * Resets plugin state (transients, credentials) to a clean slate.
 * Uses fetch() inside the page context so it hits the server-side.
 */
export async function cleanupState(page: Page): Promise<void> {
  await page.goto(`${HELPER_URL}?action=cleanup`, { waitUntil: 'commit' });
  await page.waitForTimeout(300);
}

/**
 * Imports a SQL dump into the database.
 * Uses fetch() via page context to hit the local DDEV test-helper.
 */
export async function importDump(page: Page, name: 'has-key' | 'no-key'): Promise<void> {
  await page.goto(`${HELPER_URL}?action=import-${name}`, { waitUntil: 'commit' });
  await page.waitForTimeout(1000);
}

/**
 * Returns the current site_key from wp_options.
 */
export async function getSiteKey(page: Page): Promise<string> {
  const resp = await page.goto(`${HELPER_URL}?action=get-site-key`, { waitUntil: 'commit' });
  const body = await resp?.text();
  return (body ?? '').trim();
}

/**
 * Sets an invalid site_key (for S6: invalid key scenario).
 */
export async function setSiteKey(page: Page, key: string): Promise<void> {
  await page.goto(`${HELPER_URL}?action=set-key-${encodeURIComponent(key)}`, { waitUntil: 'commit' });
  await page.waitForTimeout(300);
}

/**
 * Creates a small test directory with PHP files and registers it
 * as a scan-able directory via WordPress option.
 */
export async function createTestDir(page: Page): Promise<void> {
  await page.goto(`${HELPER_URL}?action=create-test-dir`, { waitUntil: 'commit' });
  await page.waitForTimeout(500);
}

/**
 * Resets the E2E mock server state (clears all sites and jobs).
 */
export async function resetMock(page: Page): Promise<void> {
  await page.goto(`${HELPER_URL}?action=reset-mock`, { waitUntil: 'commit' });
  await page.waitForTimeout(200);
}

/**
 * Enables mock mode: the mu-plugin redirects the plugin's API calls to
 * the local mock server. Also resets the mock state.
 */
export async function enableMock(page: Page): Promise<void> {
  await page.goto(`${HELPER_URL}?action=enable-mock`, { waitUntil: 'commit' });
  await page.waitForTimeout(300);
}

/**
 * Disables mock mode: the plugin reverts to the real API URLs.
 */
export async function disableMock(page: Page): Promise<void> {
  await page.goto(`${HELPER_URL}?action=disable-mock`, { waitUntil: 'commit' });
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * Logs into WordPress as admin.
 *
 * WP login page JS races with Playwright `fill()` and sometimes leaves
 * `#user_pass` empty; HTML5 validation then blocks submit. We click each
 * field, type the value, assert it stuck, then submit the form via native
 * `HTMLFormElement.submit()` (bypasses the flaky submit-button click).
 */
export async function login(page: Page): Promise<void> {
  await page.goto('/wp-login.php', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginform', { timeout: 15_000 });

  await page.locator('#user_login').click();
  await page.locator('#user_login').fill(ADMIN.user);
  await page.locator('#user_pass').click();
  await page.locator('#user_pass').fill(ADMIN.pass);

  // Re-fill password if WP login JS cleared it during focus shuffle.
  const passValue = await page.locator('#user_pass').inputValue();
  if (passValue !== ADMIN.pass) {
    await page.locator('#user_pass').fill(ADMIN.pass);
  }

  await page.waitForFunction(
    ([user, pass]) => {
      const u = document.getElementById('user_login') as HTMLInputElement | null;
      const p = document.getElementById('user_pass') as HTMLInputElement | null;
      return !!u && !!p && u.value === user && p.value === pass;
    },
    [ADMIN.user, ADMIN.pass],
    { timeout: 5_000 },
  );

  await Promise.all([
    page.waitForURL('**/wp-admin/**', { timeout: 30_000 }),
    page.locator('#loginform').evaluate((form: HTMLFormElement) => form.submit()),
  ]);
}

// ---------------------------------------------------------------------------
// Plugin page navigation
// ---------------------------------------------------------------------------

/**
 * Opens the File Security Scanner admin page and waits for it to render.
 */
export async function openPluginPage(page: Page): Promise<void> {
  await page.goto(ADMIN_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.security-scanner h1', { timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Key registration
// ---------------------------------------------------------------------------

/**
 * Fills the email field and submits the "Get site key" form.
 *
 * @returns true when the form was submitted successfully.
 */
export async function getSiteKeyViaForm(page: Page, email: string, options?: { clearKey?: boolean }): Promise<boolean> {
  const form = page.locator('form').filter({ has: page.locator('input[name="security_scanner_action"][value="get_key"]') });
  await form.locator('input[name="security_scanner_email"]').fill(email);

  // When testing re-registration the key field must be empty so the plugin
  // calls the API instead of saving the existing key manually.
  if (options?.clearKey) {
    await form.locator('#llar-key').fill('');
  }

  // Submit the form.
  await form.locator('button[type="submit"]').click({ force: true });

  // Wait for the PRG redirect to finish.
  await page.waitForLoadState('load', { timeout: 15_000 });
  return true;
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

/**
 * Clicks the "Scan" button and waits for the progress section to appear.
 *
 * @returns true if the scan started (progress bar is visible).
 */
export async function startScan(page: Page): Promise<boolean> {
  const scanForm = page.locator('form').filter({ has: page.locator('input[name="security_scanner_action"][value="start_scan"]') });
  
  // Submit the form.
  await scanForm.locator('button[type="submit"]').click({ force: true });

  // Wait for the PRG redirect to finish.
  await page.waitForLoadState('load', { timeout: 15_000 });

  // The .llar-status section starts with hidden attribute; JS removes it.
  // Wait for the section to become present and visible (JS-triggered).
  try {
    const status = page.locator('.llar-status');
    await status.waitFor({ state: 'attached', timeout: 5000 });
    // JS sets hidden=false after load — give it a moment.
    // The script runs on DOMContentLoaded and may need a tick.
    await page.waitForTimeout(500);
    const isVisible = await page.evaluate(
      () => !!(document.querySelector('.llar-status') as HTMLElement)?.offsetParent
    );
    if (isVisible) return true;
  } catch {
    const notice = page.locator('.notice-error');
    if (await notice.count() > 0) {
      console.log('scan blocked:', await notice.textContent());
    }
    return false;
  }

  // Status section attached but not visible (scan may have completed instantly
  // or been blocked by a notice without the .notice-error class).
  return false;
}

/**
 * Checks/unchecks a directory checkbox.
 */
export async function toggleDirectory(page: Page, slug: string, checked: boolean): Promise<void> {
  const cb = page.locator(`input[name="security_scanner_directories[]"][value="${slug}"]`);
  if (checked) {
    await cb.check({ force: true });
  } else {
    await cb.uncheck({ force: true });
  }
}

/**
 * Selects only the specified directories for scanning (unchecks all others).
 */
export async function selectOnlyDirectories(page: Page, slugs: string[]): Promise<void> {
  const allSlugs = ['root', 'wp-admin', 'wp-includes', 'wp-content'];
  for (const slug of allSlugs) {
    await toggleDirectory(page, slug, slugs.includes(slug));
  }
  // Also check any custom slugs (like e2e-test).
  for (const slug of slugs) {
    if (!allSlugs.includes(slug)) {
      await toggleDirectory(page, slug, true);
    }
  }
}

/**
 * Sets the include masks field.
 */
export async function setIncludeMasks(page: Page, masks: string): Promise<void> {
  await page.locator('#llar-include').fill(masks);
}

/**
 * Sets the exclude masks field.
 */
export async function setExcludeMasks(page: Page, masks: string): Promise<void> {
  await page.locator('#llar-exclude').fill(masks);
}

/**
 * Reads the current value of the include masks field.
 */
export async function getIncludeMasks(page: Page): Promise<string> {
  return (await page.locator('#llar-include').inputValue()) ?? '';
}

/**
 * Reads the current value of the exclude masks field.
 */
export async function getExcludeMasks(page: Page): Promise<string> {
  return (await page.locator('#llar-exclude').inputValue()) ?? '';
}

/**
 * Returns true when the directory checkbox for the given slug is checked.
 */
export async function isDirectoryChecked(page: Page, slug: string): Promise<boolean> {
  return page.locator(`input[name="security_scanner_directories[]"][value="${slug}"]`).isChecked();
}

/**
 * Fills the site key field with a manual value (used by S18).
 */
export async function fillSiteKeyField(page: Page, key: string): Promise<void> {
  await page.locator('#llar-key').fill(key);
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

/**
 * Waits for the scan progress to reach "completed" or "failed".
 *
 * @returns 'completed' | 'failed' | 'timeout'
 */
export async function waitForScanCompletion(page: Page): Promise<'completed' | 'failed' | 'timeout'> {
  try {
    // The JS poller hides the status section and reveals the results section
    // when the scan finishes, so wait for .llar-results to become visible.
    // (The progress label is set to a percentage string, not the word
    // "completed", so we cannot match on its text.)
    await page.locator('.llar-results').waitFor({ state: 'visible', timeout: 180_000 });

    // Distinguish completed vs failed by checking for an error label in the
    // (now-hidden) status section. If the results section is visible without
    // an error marker, treat it as completed.
    const errorLabel = page.locator('.llar-progress__label').filter({ hasText: /failed|error/i });
    if (await errorLabel.count() > 0) {
      return 'failed';
    }
    return 'completed';
  } catch {
    return 'timeout';
  }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * Returns the number of files visible in the results tree.
 */
export async function countVisibleFiles(page: Page): Promise<number> {
  return page.locator('.llar-tree__file').count();
}

/**
 * Returns true when the "Show suspicious only" checkbox is checked.
 */
export async function isSuspiciousOnlyChecked(page: Page): Promise<boolean> {
  return page.locator('#llar-only-suspicious').isChecked();
}

/**
 * Toggles the "Show suspicious only" checkbox.
 */
export async function toggleSuspiciousOnly(page: Page): Promise<void> {
  await page.locator('#llar-only-suspicious').click({ force: true });
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

/**
 * Returns the text content of the admin notice.
 */
export async function getNoticeText(page: Page): Promise<string> {
  return (await page.locator('.notice p').textContent()) ?? '';
}

/**
 * Returns the notice class (notice-success, notice-error, etc).
 */
export async function getNoticeType(page: Page): Promise<string> {
  const cls = (await page.locator('.notice').first().getAttribute('class')) ?? '';
  if (cls.includes('notice-success')) return 'success';
  if (cls.includes('notice-error')) return 'error';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------

/**
 * Returns true when the scan button is disabled (no site key).
 */
export async function isScanDisabled(page: Page): Promise<boolean> {
  const btn = page.locator('button[type="submit"]').filter({ hasText: /scan/i });
  return btn.isDisabled();
}

// ---------------------------------------------------------------------------
// Progress label inspection
// ---------------------------------------------------------------------------

/**
 * Reads the current text of the progress label (.llar-progress__label).
 * Returns an empty string when the element is absent or hidden.
 */
export async function getProgressLabel(page: Page): Promise<string> {
  const el = page.locator('.llar-progress__label');
  if ((await el.count()) === 0) {
    return '';
  }
  return (await el.textContent()) ?? '';
}

/**
 * Parses the "scanned / total" byte pair from a progress label.
 *
 * Expected format: "42% · 3/5 · 1.2 KB / 2.8 MB"
 * Returns null when no byte pair is found.
 */
export function parseProgressBytes(label: string): { scanned: number; total: number } | null {
  // Match the last number+unit / number+unit pair in the label.
  const m = label.match(/([\d.]+)\s*(B|KB|MB|GB|TB)\s*\/\s*([\d.]+)\s*(B|KB|MB|GB|TB)/i);
  if (!m) return null;

  const units: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  const scanned = parseFloat(m[1]) * (units[m[2].toUpperCase()] ?? 1);
  const total = parseFloat(m[3]) * (units[m[4].toUpperCase()] ?? 1);
  return { scanned, total };
}

/**
 * Parses the "completed / total" file-count pair from a progress label.
 *
 * Expected format: "42% · 3/5 · 1.2 KB / 2.8 MB"
 * Returns null when no file-count pair is found.
 */
export function getProgressFileCount(label: string): { completed: number; total: number } | null {
  // The file-count pair is the single "N/M" (digits only, no unit) in the label.
  // It appears after the percentage and a middle-dot separator, before any
  // byte-size pair (which includes a space and unit letter).
  const m = label.match(/·\s*(\d+)\s*\/\s*(\d+)\s*(?:·|\s+[BKMG])/);
  if (!m) return null;
  return { completed: parseInt(m[1], 10), total: parseInt(m[2], 10) };
}
