import { type Page, type TestInfo, expect } from '@playwright/test';

/**
 * Base URL of the WordPress site under test.
 *
 * Inside docker compose the e2e container gets BASE_URL=http://wordpress;
 * locally (DDEV) the default is the *.ddev.site install.
 */
const BASE_URL = (process.env.BASE_URL || 'https://llar-imunify.ddev.site').replace(/\/$/, '');

/**
 * URL of the test-helper.php script on the WordPress site.
 */
const HELPER_URL = `${BASE_URL}/test-helper.php`;

/**
 * Admin page slug for the File Security Scanner plugin.
 */
const ADMIN_URL = '/wp-admin/admin.php?page=security-scanner';

/**
 * WP admin credentials for the test environment.
 */
const ADMIN = {
  user: process.env.ADMIN_USER || 'admin',
  pass: process.env.ADMIN_PASS || 'admin',
};

// ---------------------------------------------------------------------------
// Helper endpoints (state changes via test-helper.php, no SQL dumps)
// ---------------------------------------------------------------------------

/**
 * Calls a test-helper.php action and asserts its completion marker.
 *
 * Uses page.request (shares the browser context, honors ignoreHTTPSErrors)
 * instead of a navigation: the response resolves only when PHP has finished,
 * so no sleeps are needed to "wait for the state change to land".
 *
 * @returns Full plain-text response body.
 */
async function helperAction(page: Page, action: string, marker?: string): Promise<string> {
  const resp = await page.request.get(`${HELPER_URL}?action=${encodeURIComponent(action)}`);
  const body = ((await resp.text()) ?? '').trim();
  if (!resp.ok()) {
    throw new Error(`test-helper action=${action} failed: HTTP ${resp.status()} ${body.slice(0, 120)}`);
  }
  if (marker && !body.includes(marker)) {
    throw new Error(`test-helper action=${action} incomplete: ${body.slice(0, 120)}`);
  }
  return body;
}

/**
 * Displays a scenario banner before test execution (for traces/videos).
 */
export async function showScenario(page: Page, text: string): Promise<void> {
  await page.goto(`${HELPER_URL}?action=echo&message=${encodeURIComponent(text)}`, {
    waitUntil: 'domcontentloaded',
  });
}

/**
 * Resets plugin state (options, transients) and truncates the PHP error log.
 */
export async function cleanupState(page: Page): Promise<void> {
  await helperAction(page, 'cleanup', 'CLEANUP COMPLETE');
}

/**
 * Applies a named site state via test-helper.php (replaces SQL dumps):
 * cleanup + plugin active + credentials present or absent.
 */
export async function applyState(page: Page, state: 'has-key' | 'no-key'): Promise<void> {
  await helperAction(page, `state-${state}`, `STATE=${state}`);
}

/**
 * Registers a fixture folder as the "e2e-test" scan directory.
 *
 * Variants (e2e/fixtures, mounted at /var/www/html/e2e-fixtures in docker):
 *   small   — 3 files: clean, malicious, suspicious (exact verdict counts).
 *   site    — akismet corpus + malware/ subfolder with dangerous files.
 *   akismet — clean corpus only, no dangerous files.
 *   malware — only the dangerous files.
 */
export async function registerScanDir(page: Page, variant: 'small' | 'site' | 'akismet' | 'malware'): Promise<void> {
  await helperAction(page, `register-scan-dir-${variant}`, `SCAN DIR=${variant}`);
}

/**
 * Returns the current site_key from wp_options.
 */
export async function getSiteKey(page: Page): Promise<string> {
  return (await helperAction(page, 'get-site-key')).trim();
}

/**
 * Sets an invalid site_key (for S6: invalid key scenario).
 */
export async function setSiteKey(page: Page, key: string): Promise<void> {
  await helperAction(page, `set-key-${encodeURIComponent(key)}`);
}

/**
 * Resets the E2E mock server state (clears all sites and jobs).
 */
export async function resetMock(page: Page): Promise<void> {
  await helperAction(page, 'reset-mock', 'MOCK RESET');
}

/**
 * Enables mock mode: the mu-plugin redirects the plugin's API calls to
 * the local mock server. Also resets the mock state.
 */
export async function enableMock(page: Page): Promise<void> {
  await helperAction(page, 'enable-mock', 'MOCK ENABLED');
}

/**
 * Disables mock mode: the plugin reverts to the real API URLs.
 */
export async function disableMock(page: Page): Promise<void> {
  await helperAction(page, 'disable-mock', 'MOCK DISABLED');
}

// ---------------------------------------------------------------------------
// PHP error capture (php-error-capture mu-plugin + wp-content/debug.log)
// ---------------------------------------------------------------------------

/**
 * Log lines that are actual PHP diagnostics, e.g.
 * "[28-Aug-2026 10:00:00 UTC] PHP Warning: message in … on line 12".
 * Informational error_log() chatter (no "PHP <level>:" prefix) is ignored.
 */
const PHP_DIAGNOSTIC_RE =
  /^\[[^\]]+\]\s*PHP\s+(?:Warning|Notice|Fatal error|Parse error|Deprecated|Strict standards)/i;

/**
 * Known-benign diagnostics that must not fail a test. Add narrowly-scoped
 * patterns here when a third-party source emits harmless noise.
 */
const PHP_LOG_ALLOWLIST: RegExp[] = [
  // e.g. /PHP Notice: .* in .*akismet.*/i,
];

/**
 * Enables the artificial PHP warning (php-error-capture mu-plugin) so the
 * harness can verify its debug.log capture pipeline.
 */
export async function seedPhpWarning(page: Page): Promise<void> {
  await helperAction(page, 'seed-php-warning', 'PHP WARNING SEEDED');
}

/**
 * Reports whether the php-error-capture mu-plugin is deployed.
 *
 * true  — CAPTURE=on (log endpoint live)
 * false — CAPTURE=off (mu-plugin missing)
 * null  — endpoint unreachable (site down / old helper)
 */
export async function isPhpCaptureEnabled(page: Page): Promise<boolean | null> {
  try {
    const resp = await page.request.get(`${HELPER_URL}?action=get-debug-log`, {
      timeout: 15_000,
    });
    if (!resp.ok()) {
      return null;
    }
    const body = await resp.text();
    const header = (body.split('\n')[0] || '').trim();
    if (header === 'CAPTURE=on') return true;
    if (header === 'CAPTURE=off') return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * Reads wp-content/debug.log via test-helper.php.
 *
 * Returns null when the endpoint is unreachable (site down, old helper) and
 * "" when the capture mu-plugin is not deployed (e.g. a site without the
 * local-env mount) — the harness never fails on its own absence.
 */
export async function fetchPhpDebugLog(page: Page): Promise<string | null> {
  try {
    const resp = await page.request.get(`${HELPER_URL}?action=get-debug-log`, {
      timeout: 15_000,
    });
    if (!resp.ok()) {
      return null;
    }
    const body = await resp.text();
    const newline = body.indexOf('\n');
    const header = (newline === -1 ? body : body.slice(0, newline)).trim();
    if (header !== 'CAPTURE=on') {
      return '';
    }
    return newline === -1 ? '' : body.slice(newline + 1);
  } catch {
    return null;
  }
}

/**
 * afterEach hook: fails the test when PHP diagnostics (warnings, notices,
 * fatals — deprecations excluded) were captured in wp-content/debug.log
 * while it ran. Attaches the filtered log to the test report.
 */
export async function expectNoPhpErrors(page: Page, testInfo: TestInfo): Promise<void> {
  const log = await fetchPhpDebugLog(page);
  if (!log) {
    return; // null: endpoint missing; "": capture mu-plugin not deployed.
  }
  const entries = log
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => PHP_DIAGNOSTIC_RE.test(line))
    .filter((line) => !PHP_LOG_ALLOWLIST.some((re) => re.test(line)));

  if (entries.length === 0) {
    return;
  }
  await testInfo.attach('php-debug.log', {
    body: entries.join('\n'),
    contentType: 'text/plain',
  });
  throw new Error(
    `PHP errors captured in wp-content/debug.log:\n${entries.slice(0, 20).join('\n')}` +
      `${entries.length > 20 ? `\n… (+${entries.length - 20} more)` : ''}`,
  );
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

  await page.locator('#loginform').evaluate((form: HTMLFormElement) => form.submit());

  // Either we land in wp-admin directly, or the admin-email confirmation
  // interstitial shows first (wp-login.php?action=confirm_admin_email).
  await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });
  await dismissAdminEmailConfirmation(page);
  await page.waitForURL('**/wp-admin/**', { timeout: 30_000 });
}

/**
 * Dismisses the WP 6.x admin email confirmation interstitial after login.
 *
 * Shows up on fresh installs when admin_email_lifespan is in the past (e.g.
 * a container provisioned without a proper timestamp). “Remind me later”
 * returns to wp-admin; when the interstitial is absent this is a no-op.
 */
export async function dismissAdminEmailConfirmation(page: Page): Promise<void> {
  if (!page.url().includes('action=confirm_admin_email')) {
    return;
  }
  const remindLater = page.locator('input[name="remind_me_later"]');
  if (await remindLater.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await remindLater.click();
    await page.waitForLoadState('domcontentloaded');
  }
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
// Plugin lifecycle (activation / deactivation)
// ---------------------------------------------------------------------------

/**
 * Row selector of the plugin in the wp-admin/plugins.php table.
 */
const PLUGIN_ROW = 'tr[data-plugin="security-scanner/security-scanner.php"]';

/**
 * Opens wp-admin/plugins.php and waits for the plugins table to render.
 */
export async function openPluginsPage(page: Page): Promise<void> {
  await page.goto('/wp-admin/plugins.php', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#the-list', { timeout: 15_000 });
}

/**
 * Returns true when the plugin row currently offers a "Deactivate" action,
 * i.e. the plugin is active.
 */
export async function isPluginActive(page: Page): Promise<boolean> {
  const row = page.locator(PLUGIN_ROW);
  return (await row.locator('a', { hasText: /^\s*Deactivate\s*$/ }).count()) > 0;
}

/**
 * Returns true when the "File Security" entry is present in the admin menu.
 * Must be called while on a wp-admin page.
 */
export async function isPluginMenuPresent(page: Page): Promise<boolean> {
  return (await page.locator('#adminmenu a[href*="page=security-scanner"]').count()) > 0;
}

/**
 * Activates the plugin via the plugins.php "Activate" row action.
 *
 * This exercises the real activation path: WordPress sandbox-scrapes
 * security-scanner.php (an admin request), so a fatal error in the plugin
 * bootstrap — e.g. a constructor signature mismatch — surfaces here as a
 * failed activation with an inline error notice.
 *
 * @returns true when the plugin ends up active.
 */
export async function activatePlugin(page: Page): Promise<boolean> {
  if (await isPluginActive(page)) {
    return true;
  }

  const row = page.locator(PLUGIN_ROW);
  try {
    await row.locator('a', { hasText: /^\s*Activate\s*$/ }).first().click({ force: true });
    await page.waitForLoadState('load', { timeout: 15_000 });

    // Attached (not visible): row-action links are hover-revealed in some WP versions.
    await row
      .locator('a', { hasText: /^\s*Deactivate\s*$/ })
      .first()
      .waitFor({ state: 'attached', timeout: 10_000 });
    return true;
  } catch {
    // WP renders the sandbox-scrape fatal inline on plugins.php.
    const text = (await page.locator('body').textContent()) ?? '';
    console.log('⚠ Plugin activation failed:', text.replace(/\s+/g, ' ').slice(0, 300));
    return false;
  }
}

/**
 * Deactivates the plugin via the plugins.php "Deactivate" row action.
 *
 * @returns true when the plugin ends up inactive.
 */
export async function deactivatePlugin(page: Page): Promise<boolean> {
  if (!(await isPluginActive(page))) {
    return true;
  }

  const row = page.locator(PLUGIN_ROW);
  try {
    await row.locator('a', { hasText: /^\s*Deactivate\s*$/ }).first().click({ force: true });
    await page.waitForLoadState('load', { timeout: 15_000 });

    await row
      .locator('a', { hasText: /^\s*Activate\s*$/ })
      .first()
      .waitFor({ state: 'attached', timeout: 10_000 });
    return true;
  } catch {
    const text = (await page.locator('body').textContent()) ?? '';
    console.log('⚠ Plugin deactivation failed:', text.replace(/\s+/g, ' ').slice(0, 300));
    return false;
  }
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
 * Clicks the "Scan" button and waits for the scan to actually start.
 *
 * The start is observed, not guessed: the .llar-status section becomes
 * visible when the JS poller kicks in; a blocking error surfaces as an
 * error notice instead.
 *
 * @returns true if the scan started (progress section visible).
 */
export async function startScan(page: Page): Promise<boolean> {
  const scanForm = page.locator('form').filter({ has: page.locator('input[name="security_scanner_action"][value="start_scan"]') });

  // Submit the form.
  await scanForm.locator('button[type="submit"]').click({ force: true });

  // Wait for the PRG redirect to finish.
  await page.waitForLoadState('load', { timeout: 15_000 });

  // The scan UI reveals .llar-status when the job starts. When it never
  // appears, an error notice must explain why the scan was blocked.
  const status = page.locator('.llar-status');
  try {
    await expect(status).toBeVisible({ timeout: 10_000 });
    return true;
  } catch {
    const notice = page.locator('.security-scanner-notice.notice-error');
    if (await notice.count() > 0) {
      console.log('scan blocked:', await notice.textContent());
    }
    return false;
  }
}

/**
 * Waits until the progress label carries BOTH the file-count pair and the
 * byte-size pair ("42% · 3/5 · 1.2 KB / 2.8 MB").
 *
 * Event-driven replacement for a fixed sleep: the label only reaches this
 * shape after the first poll response has been rendered, which is exactly
 * the moment the old waitForTimeout tried to guess.
 */
export async function waitForProgressLabel(page: Page): Promise<string> {
  let label = '';
  await expect
    .poll(
      async () => {
        label = await getProgressLabel(page);
        return getProgressFileCount(label) !== null && parseProgressBytes(label) !== null;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return label;
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
 * Returns true when the directory checkbox for the given slug is in the
 * indeterminate (mixed) state — a checked parent with some unchecked subtree.
 */
export async function isDirectoryIndeterminate(page: Page, slug: string): Promise<boolean> {
  return page.evaluate((slug) => {
    const input = document.querySelector(
      `input[name="security_scanner_directories[]"][value="${slug}"]`,
    ) as HTMLInputElement | null;
    return input ? input.indeterminate : false;
  }, slug);
}

/**
 * Expands a nested directory-tree node by clicking its toggle (lazy-loads its
 * subfolders via the dirchildren endpoint).
 */
export async function expandTreeNode(page: Page, rel: string): Promise<void> {
  await page.locator(`.llar-dirtree__node[data-rel="${rel}"] > .llar-tree__toggle`).click();
}

/**
 * Returns true when the checkbox of the tree node with the given rel path is
 * checked (works for nodes without a legacy slug, e.g. wp-content/plugins).
 */
export async function isTreeNodeChecked(page: Page, rel: string): Promise<boolean> {
  return page.locator(`.llar-dirtree__node[data-rel="${rel}"] input[type="checkbox"]`).isChecked();
}

/**
 * Checks/unchecks the checkbox of the tree node with the given rel path.
 */
export async function toggleTreeNode(page: Page, rel: string, checked: boolean): Promise<void> {
  const cb = page.locator(`.llar-dirtree__node[data-rel="${rel}"] input[type="checkbox"]`);
  if (checked) {
    await cb.check({ force: true });
  } else {
    await cb.uncheck({ force: true });
  }
}

/**
 * Fills the site key field with a manual value (used by S18).
 */
export async function fillSiteKeyField(page: Page, key: string): Promise<void> {
  await page.locator('#llar-key').fill(key);
}

/**
 * Returns the current type of the site key field ('password' = masked).
 */
export async function getKeyFieldType(page: Page): Promise<string> {
  return (await page.locator('#llar-key').getAttribute('type')) ?? '';
}

/**
 * Clicks the eye toggle next to the site key field.
 */
export async function toggleKeyVisibility(page: Page): Promise<void> {
  await page.locator('#llar-key-toggle').click();
}

// ---------------------------------------------------------------------------
// Viewport (S24: notices / progress bar scrolled into the visible area)
// ---------------------------------------------------------------------------

/**
 * Waits until the element matching the selector intersects the viewport.
 *
 * Handles hidden elements (zero rect) and smooth scrolling by polling.
 */
export async function waitForInViewport(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0;
    },
    selector,
    { timeout: 10_000 },
  );
}

/**
 * Returns the current vertical scroll position of the page.
 */
export async function getPageScrollY(page: Page): Promise<number> {
  return page.evaluate(() => window.scrollY);
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
    // The JS poller attaches the per-file verdicts to the directory tree when
    // the scan finishes, marking it with .is-complete. (The progress label is
    // set to a percentage string, not the word "completed", so we cannot match
    // on its text.)
    await page.locator('.llar-dirtree.is-complete').waitFor({ state: 'visible', timeout: 180_000 });

    // Distinguish completed vs failed by checking for an error label in the
    // status block. If the tree is complete without an error marker, treat it
    // as completed.
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
 * Returns the number of VISIBLE file rows attached to the directory tree.
 *
 * Scoped to .llar-dirtree: the page also renders a files-to-scan preview
 * tree that reuses the same .llar-tree__file classes. Hidden rows (clean
 * files under the "suspicious only" filter) are not counted, so filter
 * assertions observe the actual UI state.
 */
export async function countVisibleFiles(page: Page): Promise<number> {
  return page.locator('.llar-dirtree .llar-tree__file:visible').count();
}

/**
 * Returns true when the "Show suspicious only" checkbox is checked.
 */
export async function isSuspiciousOnlyChecked(page: Page): Promise<boolean> {
  return page.locator('#llar-only-suspicious').isChecked();
}

/**
 * Toggles the "Show suspicious only" checkbox.
 *
 * The filter applies synchronously in the change handler — assertions after
 * the toggle use expect.poll where a transition is expected.
 */
export async function toggleSuspiciousOnly(page: Page): Promise<void> {
  await page.locator('#llar-only-suspicious').click({ force: true });
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

/**
 * Waits for an admin notice of the given type to be rendered.
 *
 * The PRG redirect re-renders the page, so the notice arrives with the
 * navigation — waiting on the locator removes any fixed delays.
 */
export async function waitForNotice(page: Page, type?: 'success' | 'error'): Promise<void> {
  const cls = type === 'success' ? '.notice-success' : type === 'error' ? '.notice-error' : '';
  await page.locator(`.security-scanner-notice${cls}`).first().waitFor({ state: 'visible', timeout: 10_000 });
}

/**
 * Returns the text content of the admin notice.
 */
export async function getNoticeText(page: Page): Promise<string> {
  return (await page.locator('.security-scanner-notice p').textContent()) ?? '';
}

/**
 * Returns the notice class (notice-success, notice-error, etc).
 */
export async function getNoticeType(page: Page): Promise<string> {
  const cls = (await page.locator('.security-scanner-notice').first().getAttribute('class')) ?? '';
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
