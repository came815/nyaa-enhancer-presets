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
