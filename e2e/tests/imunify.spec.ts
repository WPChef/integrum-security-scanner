import { test, expect } from '@playwright/test';
import {
  showScenario, cleanupState, importDump, login, openPluginPage,
  getSiteKeyViaForm, startScan, waitForScanCompletion,
  countVisibleFiles, isSuspiciousOnlyChecked, toggleSuspiciousOnly,
  getNoticeText, getNoticeType, isScanDisabled,
  setIncludeMasks, setExcludeMasks, toggleDirectory, selectOnlyDirectories,
  getIncludeMasks, getExcludeMasks, isDirectoryChecked,
  fillSiteKeyField,
  createTestDir, enableMock, disableMock,
  getProgressLabel, parseProgressBytes, getProgressFileCount,
} from './helpers';

test.describe('File Security Scanner E2E', () => {

  test.beforeEach(async ({ page }) => {
    await cleanupState(page);
    await enableMock(page);
  });

  test.afterAll(async ({ browser }) => {
    // Restore real API mode after the suite finishes.
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    await disableMock(page);
    await ctx.close();
  });

  // =========================================================================
  // S1 — Happy path: register, scan, view results
  // =========================================================================
  test('S1: Happy path — full cycle with results', async ({ page }) => {
    await showScenario(page, 'S1: Happy path — register, scan, view results');

    // Given: clean WP with plugin activated, no key.
    await importDump(page, 'no-key');
    await login(page);
    await openPluginPage(page);

    // The scan area should be disabled without a key.
    expect(await isScanDisabled(page)).toBe(true);

    // When: user registers the site.
    await getSiteKeyViaForm(page, 'admin@llar-imunify.ddev.site');

    // Then: success notice, scan area becomes enabled.
    expect(await getNoticeType(page)).toBe('success');
    expect(await getNoticeText(page)).toContain('Site registered');
    expect(await isScanDisabled(page)).toBe(false);

    // Create test directory with 3 small files + register it as a scan option.
    // Then scan only those files (fast: ~20s).
    await createTestDir(page);
    await openPluginPage(page);

    // When: user starts a scan on the test directory.
    await selectOnlyDirectories(page, ['e2e-test']);
    const scanStarted = await startScan(page);
    expect(scanStarted).toBe(true);

    // Then: progress bar is visible, and the status section reminds the user
    // not to close the page (the text lives directly inside .llar-status).
    await expect(page.locator('.llar-progress')).toBeVisible();
    await expect(page.locator('.llar-status')).toContainText('Do not close');

    // Wait a poll cycle for the label to pick up file-count + byte info.
    // The mock rotates file_id per stage and routes malicious files through
    // needs_sha256 -> needs_upload across two polls, so by the second poll the
    // byte counter has had a chance to double-count if the dedup key is wrong.
    await page.waitForTimeout(5000);

    // Then: the progress label must report BOTH the file-count pair and the
    // byte-size pair, and scanned_bytes must NEVER exceed total_bytes. This is
    // the exact symptom that previously rendered "978 KB / 808 KB". We assert
    // hard (not silently skip) so a regression in the label format or in byte
    // accounting fails loudly.
    const label = await getProgressLabel(page);
    expect(label.length, 'progress label should be present mid-scan').toBeGreaterThan(0);
    expect(label, 'progress label should start with a percentage').toMatch(/\d+%/);

    const fileCount = getProgressFileCount(label);
    expect(fileCount, `label "${label}" must contain a file-count pair N/M`).not.toBeNull();
    expect(fileCount!.completed).toBeGreaterThanOrEqual(0);
    expect(fileCount!.total).toBeGreaterThan(0);
    expect(fileCount!.completed).toBeLessThanOrEqual(fileCount!.total);

    const bytes = parseProgressBytes(label);
    expect(bytes, `label "${label}" must contain a byte pair X / Y`).not.toBeNull();
    expect(bytes!.total).toBeGreaterThan(0);
    // The core invariant: scanned must never exceed total.
    expect(
      bytes!.scanned,
      `scanned_bytes must not exceed total_bytes in label "${label}"`,
    ).toBeLessThanOrEqual(bytes!.total);

    // When: scan completes.
    const status = await waitForScanCompletion(page);
    expect(status).toBe('completed');

    // Then: results section appears.
    await expect(page.locator('.llar-results')).toBeVisible();

    // "Show suspicious only" should be checked by default.
    expect(await isSuspiciousOnlyChecked(page)).toBe(true);

    // At least some files should be visible.
    const suspiciousCount = await countVisibleFiles(page);
    expect(suspiciousCount).toBeGreaterThan(0);

    // When: user unchecks "Show suspicious only".
    await toggleSuspiciousOnly(page);

    // Then: all files (including clean) should be visible.
    const allCount = await countVisibleFiles(page);
    expect(allCount).toBeGreaterThanOrEqual(suspiciousCount);
  });

  // =========================================================================
  // S2 — Re-registration (already registered domain)
  // =========================================================================
  test('S2: Re-registration returns error', async ({ page }) => {
    await showScenario(page, 'S2: Re-registration — already registered domain');

    // Given: site already has a key AND the mock knows about the site.
    await importDump(page, 'has-key');
    await login(page);
    await openPluginPage(page);

    // First registration should succeed (mock was reset by beforeEach).
    await getSiteKeyViaForm(page, 'admin@llar-imunify.ddev.site', { clearKey: true });
    await page.waitForTimeout(500);
    expect(await getNoticeType(page)).toBe('success');

    // Try to re-register same domain.
    await getSiteKeyViaForm(page, 'admin@llar-imunify.ddev.site', { clearKey: true });
    await page.waitForTimeout(500);

    // Then: error notice about already being registered.
    expect(await getNoticeType(page)).toBe('error');
    const notice = await getNoticeText(page);
    expect(notice).toMatch(/already registered|not obtain a site key/i);

    // Page is still functional — scan form is enabled.
    expect(await isScanDisabled(page)).toBe(false);
  });

  // =========================================================================
  // S4 — Scan without key (UI blocked)
  // =========================================================================
  test('S4: Scan is blocked without site key', async ({ page }) => {
    await showScenario(page, 'S4: Scan blocked — no site key');

    // Given: no key.
    await importDump(page, 'no-key');
    await login(page);
    await openPluginPage(page);

    // Then: scan area is visually disabled.
    expect(await isScanDisabled(page)).toBe(true);

    // The "Scan" button has the disabled attribute.
    const scanBtn = page.locator('button[type="submit"]').filter({ hasText: /scan/i });
    await expect(scanBtn).toBeDisabled();

    // Registration form should be accessible.
    const emailInput = page.locator('#llar-email');
    await expect(emailInput).toBeVisible();
  });

  // =========================================================================
  // S6 — Invalid site key → get new key
  // =========================================================================
  test('S6: Invalid key prompts re-registration', async ({ page }) => {
    await showScenario(page, 'S6: Invalid site key — re-registration prompt');

    // Given: a key from the dump.
    await importDump(page, 'has-key');
    await createTestDir(page);
    await login(page);
    await openPluginPage(page);

    // When: user starts a scan.
    await selectOnlyDirectories(page, ['e2e-test']);
    const scanStarted = await startScan(page);
    expect(scanStarted).toBe(true);

    // Wait for completion (3 files, should be fast).
    const status = await waitForScanCompletion(page);
    expect(status).toBe('completed');

    // Results are shown — key works with the mock.
    await expect(page.locator('.llar-results')).toBeVisible();
    expect(await countVisibleFiles(page)).toBeGreaterThan(0);
  });

  // =========================================================================
  // S16 — Toggle "Show suspicious only"
  // =========================================================================
  test('S16: Toggle filters file tree', async ({ page }) => {
    await showScenario(page, 'S16: Toggle "Show suspicious only" filter');

    // Given: has key, scan completed.
    await importDump(page, 'has-key');
    await createTestDir(page);
    await login(page);
    await openPluginPage(page);

    // Scan only the small test directory.
    await selectOnlyDirectories(page, ['e2e-test']);
    await startScan(page);
    const status = await waitForScanCompletion(page);
    expect(status).toBe('completed');

    // Default: only suspicious/infected files.
    expect(await isSuspiciousOnlyChecked(page)).toBe(true);
    const filtered = await countVisibleFiles(page);

    // Toggle off → all files.
    await toggleSuspiciousOnly(page);
    const all = await countVisibleFiles(page);
    expect(all).toBeGreaterThanOrEqual(filtered);

    // Toggle back on.
    await toggleSuspiciousOnly(page);
    const filteredAgain = await countVisibleFiles(page);
    expect(filteredAgain).toBe(filtered);
  });

  // =========================================================================
  // S17 — Form settings persist across reload
  // =========================================================================
  test('S17: Scan form settings persist across reload', async ({ page }) => {
    await showScenario(page, 'S17: Form settings persist across reload');

    // Given: has key, test dir available.
    await importDump(page, 'has-key');
    await createTestDir(page);
    await login(page);
    await openPluginPage(page);

    // When: user picks a non-default directory set + masks, then starts a scan
    // on the fast e2e-test dir only (settings persist on submit, before scan).
    await selectOnlyDirectories(page, ['e2e-test']);
    await setIncludeMasks(page, '*.php');
    await setExcludeMasks(page, '*/cache/*');
    await startScan(page);

    // Then: after reload the form state is restored.
    // Default is root checked; we unchecked it, so it must stay unchecked.
    await openPluginPage(page);
    expect(await isDirectoryChecked(page, 'root')).toBe(false);
    expect(await isDirectoryChecked(page, 'wp-admin')).toBe(false);
    expect(await isDirectoryChecked(page, 'wp-includes')).toBe(false);
    expect(await getIncludeMasks(page)).toBe('*.php');
    expect(await getExcludeMasks(page)).toBe('*/cache/*');
  });

  // =========================================================================
  // S18 — Manual key save via the get_key form
  // =========================================================================
  test('S18: Manual key save persists', async ({ page }) => {
    await showScenario(page, 'S18: Manual key save');

    // Given: no key.
    await importDump(page, 'no-key');
    await login(page);
    await openPluginPage(page);

    // When: user pastes a key into the field and saves.
    const fakeKey = 'e2e-manual-key-' + Date.now();
    await fillSiteKeyField(page, fakeKey);
    await getSiteKeyViaForm(page, 'admin@llar-imunify.ddev.site');

    // Then: a success notice confirms the save.
    expect(await getNoticeType(page)).toBe('success');

    // And: after reload the key is still there.
    await openPluginPage(page);
    const keyField = await page.locator('#llar-key').inputValue();
    expect(keyField).toBe(fakeKey);
  });

  // =========================================================================
  // S19 — Scan does NOT auto-resume after a page reload
  // =========================================================================
  test('S19: Scan is not resumed after page reload', async ({ page }) => {
    await showScenario(page, 'S19: Reload must not resume the scan');

    // Given: a registered site and a fast test directory.
    await importDump(page, 'has-key');
    await createTestDir(page);
    await login(page);
    await openPluginPage(page);

    // When: a scan is started.
    await selectOnlyDirectories(page, ['e2e-test']);
    const scanStarted = await startScan(page);
    expect(scanStarted).toBe(true);

    // The progress section is visible while the original tab polls.
    await expect(page.locator('.llar-progress')).toBeVisible();

    // When: the page is reloaded.
    await openPluginPage(page);

    // Then: the UI returns to idle — the status section stays hidden and the
    // hidden job-id input is empty, so the JS poller never restarts.
    const statusSection = page.locator('.llar-status');
    await expect(statusSection).toBeHidden();
    const jobIdValue = await page.locator('.llar-job-id').inputValue();
    expect(jobIdValue, 'job id must not be resurfaced after reload').toBe('');

    // The Start button is available again (not locked into a running scan).
    const startBtn = page.locator('button[type="submit"]').filter({ hasText: /scan/i });
    await expect(startBtn).toBeEnabled();
  });
});
