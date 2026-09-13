# Modifications

## Nyaa Enhancer Presets

This repository is a public fork, **Nyaa Enhancer Presets**, of [Arad119/Nyaa-Enhancer](https://github.com/Arad119/Nyaa-Enhancer), based on upstream commit `01dad601fe346fcb36178ed9a5fddc5aca7a56dc`.

The upstream project is distributed under GPL-3.0; this fork retains `LICENSE.txt` and distributes covered work under the same license. Upstream acknowledgements remain in `README.md` and `docs/UPSTREAM-README.md`. See [docs/LICENSE-NOTES.md](docs/LICENSE-NOTES.md) for the bundled-library notice identified in this source tree.

## Changes — 2026-09-13

The fork changes cover Chrome-oriented preset search behavior and release packaging:

- relative upload-time presets: 24 hours, 7 days, 30 days (default), 90 days, and 365 days;
- fixed search-start timestamp, descending seeder order, and URL-persisted conditions;
- incremental `Show more` loading with progress, cancellation, and resume; and
- a Chrome-only release ZIP with `manifest.json` at the selected folder root, plus corresponding source and attribution materials.

See docs/QA.md for the recorded verification and its limits. The fork does not claim Firefox support; the original Firefox implementation remains upstream.

The fork also improves narrow-screen toolbar wrapping, adds release attribution to About/Changelog, and supplies pinned third-party notices and readable vendor sources.

## Version 1.16.0 — 2026-09-13

- Automatically load results near the bottom of the list, using the same sequential request spacing, date filters, and duplicate removal as manual loading.
- Add sticky date controls, visible loading state, and a remembered auto-loading on/off choice with Pause / Resume controls.
- Require explicit resume after errors, rate limits, timeouts, or ten pages without visible matches; start no new page requests while the tab is hidden.
- Extend localhost browser checks and update the usage documentation and screenshots. License and upstream attribution are retained.

## Version 1.16.1 — 2026-09-14

- Enable the Chrome extension on `sukebei.nyaa.si` by adding the exact host to host permissions, both content-script matches, and module resource matches.
- Retain the current site's origin for presets, navigation, and settings; add offline regression checks for the activation requirements and site routing.
- Update installation guidance. License and upstream attribution are retained; live-site operation remains unverified.

## Version 1.17.0 — 2026-09-14

- Add Japanese as the initial Chrome interface language, with a persisted Japanese / English selector in the list, settings page, and extension popup. A successful change reloads only the current page; other tabs apply it on their next reload.
- Translate extension controls, settings, help, notifications, loading states, and integration labels while preserving native site text, user input, external content, URL parameters, and stored option values. Historical upstream changelog text remains in English.
- Add localization regression checks and refresh the Japanese usage screenshots and instructions. The GPL license, attribution, and corresponding-source release are retained.
- Add a cancel control to ZIP and individual torrent-file batches, abort active body reads and queued requests, prevent concurrent batches, and bound each file request to 20 seconds. Cancellation keeps already saved individual files and suppresses unfinished ZIP output.
- Preserve unchanged non-list link hrefs so native view-title extraction and settings navigation continue to work after preset initialization.

## Version 1.18.0 — 2026-09-14

- Rework table observation and feature lifecycle dispatch so initial/runtime row changes, replaced table bodies, and toolbar re-enabling retain filtering and selection without accumulating listeners. Isolate feature hook failures.
- Preserve newer local preferences when retrying legacy sync migration, retain readable legacy data when migration fails, and only run save-success callbacks after successful persistence. Restore failed settings/filter toggles instead of claiming success.
- Add the missing standalone extension settings page, reuse the existing settings UI, and relay content-script settings notifications through the service worker. Match site routing by parsed hostname.
- Validate qBittorrent and Deluge add acknowledgements, deduplicate canonical infohash sends, and restrict metadata proxy fetches to supported hosts with bounded response waits.
- Expand local regression coverage for legacy functionality. Retain GPL-3.0, upstream attribution, corresponding-source distribution and the Chrome-only support scope.
