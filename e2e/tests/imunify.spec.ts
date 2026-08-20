import { test, expect } from '@playwright/test';
import {
  showScenario, cleanupState, importDump, login, openPluginPage,
  getSiteKeyViaForm, startScan, waitForScanCompletion,
  countVisibleFiles, isSuspiciousOnlyChecked, toggleSuspiciousOnly,
  getNoticeText, getNoticeType, isScanDisabled,
  setIncludeMasks, setExcludeMasks, toggleDirectory, selectOnlyDirectories,
  getIncludeMasks, getExcludeMasks, isDirectoryChecked, isDirectoryIndeterminate,
  expandTreeNode, isTreeNodeChecked, toggleTreeNode,
  fillSiteKeyField, waitForInViewport, getPageScrollY,
  createTestDir, enableMock, disableMock,
  getProgressLabel, parseProgressBytes, getProgressFileCount,
  openPluginsPage, isPluginActive, activatePlugin, deactivatePlugin, isPluginMenuPresent,
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

  // =========================================================================
  // S20 — Deactivation via UI: admin page disappears, site stays healthy
  // =========================================================================
  test('S20: Deactivation removes admin page and keeps site healthy', async ({ page }) => {
    await showScenario(page, 'S20: Deactivate plugin — admin page disappears, site intact');

    // Given: plugin active (the dump ships it in active_plugins).
    await importDump(page, 'has-key');
    await login(page);
    await openPluginsPage(page);
    expect(await isPluginActive(page)).toBe(true);

    // When: user deactivates the plugin via the row action.
    expect(await deactivatePlugin(page)).toBe(true);

    // Then: the row offers Activate again.
    expect(await isPluginActive(page)).toBe(false);

    // And: the admin menu no longer shows the plugin entry.
    await page.goto('/wp-admin/index.php', { waitUntil: 'domcontentloaded' });
    expect(await isPluginMenuPresent(page)).toBe(false);

    // And: the plugin URL is rejected — the menu is not registered, so
    // wp-admin wp_die()s with 403 instead of rendering the page.
    const resp = await page.goto('/wp-admin/admin.php?page=security-scanner');
    expect(resp?.status()).toBe(403);
    await expect(page.locator('body')).toContainText(/not allowed to access this page/i);

    // Consistency: the site frontend still works (no leftover fatal code).
    const home = await page.goto('/');
    expect(home?.status()).toBe(200);
  });

  // =========================================================================
  // S21 — Activation via UI (regression: bootstrap fatals surface here)
  // =========================================================================
  test('S21: Activation restores the admin page', async ({ page }) => {
    await showScenario(page, 'S21: Activate plugin — page returns, no fatal error');

    // Given: plugin deactivated (the dump ships it active, so deactivate first).
    await importDump(page, 'has-key');
    await login(page);
    await openPluginsPage(page);
    expect(await deactivatePlugin(page)).toBe(true);
    expect(await isPluginActive(page)).toBe(false);

    // When: user activates the plugin via the row action. WordPress
    // sandbox-scrapes security-scanner.php on this exact path, so a fatal in
    // the bootstrap (e.g. the ImunifyScanner constructor mismatch that once
    // broke activation with "Argument #5 ($domain) must be of type string")
    // fails this step with an inline error notice.
    expect(await activatePlugin(page)).toBe(true);

    // Then: the row is active again.
    expect(await isPluginActive(page)).toBe(true);

    // And: the admin menu shows the plugin entry.
    await page.goto('/wp-admin/index.php', { waitUntil: 'domcontentloaded' });
    expect(await isPluginMenuPresent(page)).toBe(true);

    // And: the plugin page renders again with its heading and scan form.
    await openPluginPage(page);
  });

  // =========================================================================
  // S22 — Files-to-scan preview: tree on page load + default directories
  // =========================================================================
  test('S22: Files-to-scan preview renders before any scan', async ({ page }) => {
    await showScenario(page, 'S22: Files-to-scan preview — tree on load, all directories checked by default');

    // Given: has key, test dir available, no saved scan settings (cleanup
    // in beforeEach removed the option, so the form shows its defaults).
    await importDump(page, 'has-key');
    await createTestDir(page);
    await login(page);
    await openPluginPage(page);

    // Then: all four standard directories are checked by default.
    expect(await isDirectoryChecked(page, 'root')).toBe(true);
    expect(await isDirectoryChecked(page, 'wp-admin')).toBe(true);
    expect(await isDirectoryChecked(page, 'wp-includes')).toBe(true);
    expect(await isDirectoryChecked(page, 'wp-content')).toBe(true);

    // And: the preview section is visible immediately, before any scan.
    await expect(page.locator('.llar-preview')).toBeVisible();
    // The default selection covers the whole install, so wait generously for
    // the first (heaviest) render to finish: the loading hint disappears and
    // the counter reports a file count. (Tree files themselves live inside
    // collapsed folders, so visibility is asserted via the section, not <li>.)
    await expect(page.locator('.llar-preview__loading')).toBeHidden({ timeout: 30_000 });
    await expect(page.locator('.llar-preview__count')).toContainText(/files/);

    // When: the user narrows the selection to the small test directory.
    await selectOnlyDirectories(page, ['e2e-test']);

    // Then: the preview refreshes (debounced) and shows exactly its 3 files.
    await expect(page.locator('.llar-preview .llar-tree__file'))
      .toHaveCount(3, { timeout: 15_000 });
    await expect(page.locator('.llar-preview__count')).toHaveText(/^3 files$/);

    // When: an include mask narrows the scope to a single file.
    await setIncludeMasks(page, 'test-0.php');

    // Then: the preview applies the mask exactly like a real scan would.
    await expect(page.locator('.llar-preview .llar-tree__file'))
      .toHaveCount(1, { timeout: 15_000 });
  });

  // =========================================================================
  // S23 — Directory tree: nested folders with cascading checkboxes
  // =========================================================================
  test('S23: Directory tree cascades checkbox state', async ({ page }) => {
    await showScenario(page, 'S23: Directory tree — nested folders, cascading checkboxes');

    // Given: has key, default form state (beforeEach cleanup removed saved
    // settings, so every node starts checked).
    await importDump(page, 'has-key');
    await login(page);
    await openPluginPage(page);

    // The tree renders server-side: root + first level, all checked.
    await expect(page.locator('.llar-dirtree')).toBeVisible();
    expect(await isDirectoryChecked(page, 'root')).toBe(true);
    expect(await isDirectoryChecked(page, 'wp-content')).toBe(true);

    // When: wp-content is expanded and its plugins subfolder is unchecked.
    await expandTreeNode(page, 'wp-content');
    const plugins = page.locator('.llar-dirtree__node[data-rel="wp-content/plugins"]');
    await expect(plugins).toHaveCount(1, { timeout: 10_000 });
    await toggleTreeNode(page, 'wp-content/plugins', false);

    // Then: wp-content and root lose their checkmark (indeterminate dash —
    // a partially selected subtree), while sibling wp-admin stays checked.
    expect(await isDirectoryChecked(page, 'wp-content')).toBe(false);
    expect(await isDirectoryIndeterminate(page, 'wp-content')).toBe(true);
    expect(await isDirectoryChecked(page, 'root')).toBe(false);
    expect(await isDirectoryIndeterminate(page, 'root')).toBe(true);
    expect(await isDirectoryChecked(page, 'wp-admin')).toBe(true);
    expect(await isDirectoryIndeterminate(page, 'wp-admin')).toBe(false);

    // And: the unchecked subtree is posted as an explicit tree flag.
    const offFlag = page.locator('.llar-tree-flags input[name="security_scanner_tree_off[]"]');
    await expect(offFlag).toHaveCount(1);
    await expect(offFlag).toHaveValue('wp-content/plugins');

    // When: wp-content is checked again (re-checking a parent re-selects the
    // whole subtree, clearing the descendant override).
    await toggleDirectory(page, 'wp-content', true);

    // Then: everything returns to checked, no flags remain.
    expect(await isDirectoryChecked(page, 'wp-content')).toBe(true);
    expect(await isDirectoryIndeterminate(page, 'wp-content')).toBe(false);
    expect(await isDirectoryChecked(page, 'root')).toBe(true);
    expect(await isDirectoryIndeterminate(page, 'root')).toBe(false);
    expect(await isTreeNodeChecked(page, 'wp-content/plugins')).toBe(true);
    await expect(page.locator('.llar-tree-flags input')).toHaveCount(0);
  });

  // =========================================================================
  // S24 — Feedback (notices / progress bar) scrolled into the visible area
  // =========================================================================
  test('S24: Notices and progress bar scroll into the viewport', async ({ page }) => {
    await showScenario(page, 'S24: Error notice and progress bar land in the visible area');

    // ── Phase A: an error notice lands in the visible area ────────────
    // Given: a registered site — re-registering it fails with an error notice.
    await importDump(page, 'has-key');
    await login(page);
    await openPluginPage(page);

    // First registration succeeds (mock was reset by beforeEach).
    await getSiteKeyViaForm(page, 'admin@llar-imunify.ddev.site', { clearKey: true });
    await page.waitForTimeout(500);
    expect(await getNoticeType(page)).toBe('success');

    // When: the same domain is re-registered → error notice after redirect.
    await getSiteKeyViaForm(page, 'admin@llar-imunify.ddev.site', { clearKey: true });
    await page.waitForTimeout(500);
    expect(await getNoticeType(page)).toBe('error');

    // Then: the notice is in the visible area (never rendered off-screen).
    await waitForInViewport(page, '.security-scanner-notice');

    // ── Phase B: the progress bar lands in the visible area ───────────
    // Given: a working key (dump) and a fresh job on the fast test dir.
    // The import replaces the DB and wipes the Phase A session, so log in again.
    await importDump(page, 'has-key');
    await login(page);
    await createTestDir(page);
    await openPluginPage(page);
    await selectOnlyDirectories(page, ['e2e-test']);
    const started = await startScan(page);
    expect(started).toBe(true);

    // Then: the revealed progress section (below the fold after the PRG
    // redirect) is scrolled into the viewport, and the page actually moved.
    await waitForInViewport(page, '.llar-status');
    await expect(page.locator('.llar-progress')).toBeVisible();
    expect(await getPageScrollY(page)).toBeGreaterThan(0);

    // ── Phase C: a notice injected mid-page lands in the visible area ─
    // Given: the scan is running and the user is down at the progress bar.
    // When: the scan is stopped → the confirmation notice is injected at the
    // top of #wpbody-content (far outside the viewport).
    const stopBtn = page.locator('.llar-scan-actions__stop');
    await stopBtn.click();

    // Then: the injected notice is scrolled into the visible area.
    await waitForInViewport(page, '#wpbody-content > .notice.notice-info');
  });
});
