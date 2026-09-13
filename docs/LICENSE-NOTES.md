# ライセンスと配布に関する注記

このリポジトリの `LICENSE.txt` は GNU General Public License version 3 (GPL-3.0) の全文である。上流の `README.md` はプロジェクト全体を GPLv3 と明記し、Nyaa AnimeTosho Extender (ION Fork) と NyaaBlue / releases.moe を謝辞として掲載している。フォークの公開時も、これらの既存の表記を保持する。

## Chrome リリースに同梱する通知

`src/chrome/assets/jszip.min.js` に含まれる第三者コードの完全な通知は、リポジトリ直下の [THIRD_PARTY_NOTICES.txt](../THIRD_PARTY_NOTICES.txt) に置く。Chrome 用リリース ZIP と対応ソース ZIP の両方に、次を含める。

- `LICENSE.txt`
- `MODIFICATIONS.md`
- `THIRD_PARTY_NOTICES.txt`

対象 bundle は JSZip 3.10.1 を名乗り、JSZip、pako、lie、immediate、setimmediate の実装を含む。`readable-stream` は Node 向けの `stream` 参照として残るが、Chrome bundle にはその実装は含まれない。pako の zlib ポート部分には zlib ライセンスも適用されるため、MIT 表記だけでは足りない。

JSZip は MIT または GPL-3.0-or-later のデュアルライセンスである。このフォークの第三者 bundle については、`THIRD_PARTY_NOTICES.txt` で MIT を選択している。したがって、JSZip/pako の外部ソース URL を「GPL の対応ソース」として案内する運用にはしない。

## GPL 対応ソースのリリース方法

Chrome 用の展開 ZIP は実行可能な配布物であるため、同じリリース画面で、同じ Git revision から作成したソース ZIP を無償で取得できるようにする。ソース ZIP には、Chrome 展開 ZIP の生成元となる `src/chrome/`、`manifest.json`、フォークの変更、`LICENSE.txt`、帰属・第三者通知を含める。展開 ZIP の構成を `src/chrome/` から平坦化またはコピーで変える場合は、その生成スクリプトまたは再現手順も対応ソースに含める。

Chrome 拡張機能は、ソース ZIP 内の `src/chrome/` を直接「パッケージ化されていない拡張機能」として読み込める形を維持する。配布リリース用に別の生成物を導入するまでは、これを最小の再現可能な配布方法とする。

## bundle の来歴と対応ソース

ローカルの Chrome / Firefox の `jszip.min.js` は、改行を LF に正規化して末尾空白を除いた比較で、`package-lock.json` が固定する `jszip@3.10.1` の `dist/jszip.min.js` と一致した。以前の SHA-256 の差は改行・末尾空白によるものだった。Chrome側はnpm配布物のファイルをそのまま保存しており、リリース作成時にバイト一致を検証する。その SHA-256 `acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e` をリリース検証値とする。

対応ソースには `vendor-sources/` を含める。同ディレクトリは、実行 bundle に使われる JSZip 3.10.1、pako 1.0.11、lie 3.3.0、immediate 3.0.6、setimmediate 1.0.5 の読みやすい runtime source、`package.json`、ライセンス本文を固定する。package-lock の integrity と同梱範囲・再構築の境界は [vendor-sources/README.md](https://github.com/came815/nyaa-enhancer-presets/blob/main/vendor-sources/README.md) に記録する。

JSZip の npm package は、公開済み minified file を再生成する上流の `Gruntfile` と開発用 toolchain を含まない。このため `vendor-sources/` は編集可能な対応ソースと正確な npm provenance を提供するが、ローカルで byte-for-byte 再生成できると主張しない。JSZip には MIT を選択しており、フォーク自身の GPL-3.0 対応ソースは、同じ Git revision の `src/chrome/` とこのリポジトリの追跡済みファイルである。
