=== Integrum Security Scanner ===
Contributors: wpchefgadget, nikitaglobal
Tags: security, malware, scanner, antivirus, files
Requires at least: 6.0
Tested up to: 7.1
Stable tag: 0.1.1
Requires PHP: 8.1
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Scan your WordPress files for malicious code. Pick the folders, start a scan, and review suspicious files right inside wp-admin.

== Description ==

**Integrum Security Scanner** checks your site's files for malware and suspicious code, directly from the WordPress dashboard.

Choose exactly what to scan with a folder tree and include/exclude masks, start the scan, and watch the live progress. When it finishes, suspicious files are listed per folder with a severity label so you know where to look first.

Malware scanning is provided by Limit Login Attempts Reloaded in partnership with **Imunify by CloudLinux**.

= What it does =

* **Scans files for malware.** Detects malicious and suspicious code across your WordPress installation.
* **You choose the scope.** Select folders in a tree and narrow the scan with include and exclude masks (exclude always wins).
* **Live progress.** A progress bar shows the scan as it runs, right on the plugin page.
* **Clear results.** Suspicious files are grouped by folder and marked with a severity (critical, medium, low, info).
* **Simple connection.** Register with your email to get a site key, or paste an existing key.

Brought to you by the team behind **Limit Login Attempts Reloaded**.

== External services ==

This plugin uses external services to register the site and scan the files selected by the site administrator. Requests are sent only when the administrator registers the site, uses an existing site key, or starts and monitors a scan.

= Limit Login Attempts Reloaded =

The plugin connects to the Limit Login Attempts Reloaded API to register the site and obtain a site key. During registration, it sends the site's domain and the registration email address. An existing site key is not sent to this API for registration; it is used to authenticate the scanning requests described below.

This service is provided by Atlantic Silicon Inc. See the [Terms of Service](https://www.limitloginattempts.com/terms/) and [Privacy Policy](https://www.limitloginattempts.com/privacy-policy/).

= Imunify Connect =

The plugin connects to Imunify Connect to scan the files selected by the site administrator for malware and suspicious code. When a scan starts, it sends the selected files' relative paths, sizes, and modification times. During the scan, it may send SHA-256 hashes and, when requested by the scanning service for further analysis, the contents of selected files. File contents may include personal, confidential, or other protected information. The site key is sent to authenticate these requests. The plugin sends data only for the selected files and only while the scan is running.

This service is provided by Imunify by CloudLinux. See the [Imunify Terms of Use](https://imunify360.com/legal/terms-of-use/), [CloudLinux Privacy Policy](https://cloudlinux.com/clients-privacy-policy/), and [Imunify legal documentation](https://imunify360.com/legal/).

== Installation ==

1. Upload the plugin folder to the `/wp-content/plugins/` directory, or install it through the **Plugins → Add New** screen in WordPress.
2. Activate the plugin through the **Plugins** menu.
3. Open **Site Security** in the admin menu, register to get a site key, then start your first scan.

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

= 0.1.1 =
* Improved site registration flow, API error handling, consent text, and sensitive response logging.

= 0.1.0 =
* Initial release: file selection tree, include/exclude masks, live scan progress, and per-folder results with severity.
