=== Site Integrity Scanner ===
Contributors: wpchefgadget, nikitaglobal
Tags: security, malware, scanner, antivirus, files
Requires at least: 6.0
Tested up to: 7.1
Stable tag: 0.1.0
Requires PHP: 8.1
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Scan your WordPress files for malicious code. Pick the folders, start a scan, and review suspicious files right inside wp-admin.

== Description ==

**Site Integrity Scanner** checks your site's files for malware and suspicious code, directly from the WordPress dashboard.

Choose exactly what to scan with a folder tree and include/exclude masks, start the scan, and watch the live progress. When it finishes, suspicious files are listed per folder with a severity label so you know where to look first.

Malware scanning is provided by Limit Login Attempts Reloaded in partnership with **Imunify by CloudLinux**.

= What it does =

* **Scans files for malware.** Detects malicious and suspicious code across your WordPress installation.
* **You choose the scope.** Select folders in a tree and narrow the scan with include and exclude masks (exclude always wins).
* **Live progress.** A progress bar shows the scan as it runs, right on the plugin page.
* **Clear results.** Suspicious files are grouped by folder and marked with a severity (critical, medium, low, info).
* **Simple connection.** Register with your email to get a site key, or paste an existing key.

Brought to you by the team behind **Limit Login Attempts Reloaded**.

== Installation ==

1. Upload the plugin folder to the `/wp-content/plugins/` directory, or install it through the **Plugins → Add New** screen in WordPress.
2. Activate the plugin through the **Plugins** menu.
3. Open **Site Integrity** in the admin menu, register to get a site key, then start your first scan.

== Frequently Asked Questions ==

= Do I need an account? =

You register once with your email to receive a site key. You can also paste a key you already have.

= Which files are scanned? =

Only the folders you select, filtered by your include and exclude masks. By default the WordPress root, wp-admin, wp-includes, and wp-content are selected.

= Where is the scanning done? =

Scanning is powered by Imunify by CloudLinux through the Limit Login Attempts Reloaded service.

= What WordPress and PHP versions are required? =

WordPress 6.0 or later and PHP 8.1 or later.

== Changelog ==

= 0.1.0 =
* Initial release: file selection tree, include/exclude masks, live scan progress, and per-folder results with severity.
