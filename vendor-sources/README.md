# Vendored bundle sources

This directory is the readable source record for the third-party code in
`src/chrome/assets/jszip.min.js`. It is included in the corresponding source
archive for a Chrome release.

## Provenance

The root `package-lock.json` pins the inspected npm packages and their
integrity hashes:

- `jszip` 3.10.1
- `pako` 1.0.11
- `lie` 3.3.0
- `immediate` 3.0.6
- `setimmediate` 1.0.5

The normalized text of both checked-in JSZip bundles matches
`node_modules/jszip/dist/jszip.min.js` from the pinned `jszip` 3.10.1 package.
The checked-in Chrome bundle is that exact npm distribution file. The release
packaging step verifies byte equality before archiving it. Its SHA-256 is
`acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e`.

## Contents and rebuilding boundary

Each package directory contains its readable runtime source, `package.json`,
and its license text. Generated `dist/` copies, tests, and unrelated package
assets are intentionally omitted to keep the corresponding source archive
small. JSZip's npm package does not include its upstream `Gruntfile` or the
development-only toolchain needed to regenerate its published minified file.
Accordingly, this directory records the preferred editable source and exact
package provenance; it does not claim a byte-for-byte local rebuild command.

JSZip is used under its MIT option. The extension's GPL-3.0 source release is
the same Git revision of this repository, including `src/chrome/`, this
directory, `LICENSE.txt`, `MODIFICATIONS.md`, and
`THIRD_PARTY_NOTICES.txt`.
