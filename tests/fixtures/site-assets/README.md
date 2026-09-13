# Pinned Nyaa visual-fixture assets

These assets support local Playwright visual fixtures only. They are not part of the Chrome extension ZIP. They remain in the source archive so fixture rendering does not rely on Nyaa.si or a public CDN.

## Upstream source

The four Nyaa stylesheets were copied byte-for-byte from `nyaadevs/nyaa` commit `4fe0ff5b1aa7ec7c9bb2667d97e10ce2a318c676`.

| Local path | Upstream path | SHA-256 |
| --- | --- | --- |
| `css/bootstrap.min.css` | `nyaa/static/css/bootstrap.min.css` | `77bdb114a47876daba6c12d7a795c7f7a79f0130e6bf9e7288cf7ccd06be9f6a` |
| `css/bootstrap-dark.min.css` | `nyaa/static/css/bootstrap-dark.min.css` | `625fccafc58499ecde97f40374986137759f8514d58c96fd633b8b3f412e0d14` |
| `css/bootstrap-xl-mod.css` | `nyaa/static/css/bootstrap-xl-mod.css` | `8cce8e7f06d51ea8759b5013f0de6abd9f7c7c5f40c215b73bc8a0cd50b145dd` |
| `css/main.css` | `nyaa/static/css/main.css` | `91639d15960e54e8d8fd8b4e68bc0e0240a25ed574b83c7c1376b637b9ca1e17` |

At that commit, `nyaa/templates/layout.html` references Font Awesome 4.7.0 from cdnjs. The fixture replaces the network reference with assets from the official `FortAwesome/Font-Awesome` tag `v4.7.0`.

| Local path | Upstream path | SHA-256 |
| --- | --- | --- |
| `css/font-awesome.min.css` | `css/font-awesome.min.css` | `799aeb25cc0373fdee0e1b1db7ad6c2f6a0e058dfadaa3379689f583213190bd` |
| `fonts/fontawesome-webfont.woff2` | `fonts/fontawesome-webfont.woff2` | `2adefcbc041e7d18fcf2d417879dc5a09997aa64d675b7a3c4b6ce33da13f3fe` |

Only the WOFF2 font is included because the fixture browser is Chrome and the Font Awesome CSS selects it before legacy formats. The CSS retains its upstream fallback URLs; those fallback assets are deliberately absent. No category icon image is included.

## Licenses

- `licenses/NYAA-GPL-3.0.txt`: complete Nyaa GPL-3.0 text for the Nyaa-specific fixture CSS.
- `licenses/BOOTSTRAP-MIT.txt`: complete Bootstrap 3.3.7 MIT text.
- `licenses/NORMALIZE-MIT.txt`: normalize.css 3.0.3 MIT notice embedded in Bootstrap.
- `licenses/FONT-AWESOME-4.7.0-NOTICE.txt`: Font Awesome 4.7.0 CSS MIT and font SIL OFL 1.1 notice.
- `licenses/SIL-OFL-1.1.txt`: complete SIL Open Font License 1.1 for the WOFF2 font.

The files were obtained through public GitHub repository-content APIs, not the live Nyaa site. Refreshing an asset requires a new pinned upstream revision and updated hash here.
