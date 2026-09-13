// Build from a clean, committed source tree; no credentials or browser profiles enter releases.
import { execFileSync } from 'node:child_process';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const root = process.cwd();
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Commit reviewed changes before packaging.');
const manifest = JSON.parse(await readFile('src/chrome/manifest.json', 'utf8'));
const vendoredZip = await readFile('src/chrome/assets/jszip.min.js');
const officialZip = await readFile('node_modules/jszip/dist/jszip.min.js');
if (!vendoredZip.equals(officialZip)) throw new Error('Vendored JSZip differs from the pinned official package.');
const name = `nyaa-enhancer-presets-${manifest.version}`;
const commit = git('rev-parse', 'HEAD');
await mkdir('dist', { recursive: true });
const zip = new JSZip();
const fixedDate = new Date(git('show', '-s', '--format=%cI', 'HEAD'));
async function addTree(dir, prefix = '') {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const source = path.join(dir, entry.name);
    const dest = prefix + entry.name;
    if (entry.isDirectory()) await addTree(source, dest + '/');
    else if (entry.isFile()) zip.file(dest, await readFile(source), { date: fixedDate });
    else throw new Error(`Unexpected entry: ${source}`);
  }
}
await addTree('src/chrome');
for (const file of ['LICENSE.txt', 'MODIFICATIONS.md', 'THIRD_PARTY_NOTICES.txt']) {
  zip.file(file, await readFile(file), { date: fixedDate });
}
for (const file of ['INSTALL.md', 'LICENSE-NOTES.md', 'QA.md', 'REBUILD.md']) {
  zip.file(`docs/${file}`, await readFile(`docs/${file}`), { date: fixedDate });
}
zip.file('SOURCE.txt', `Nyaa Enhancer Presets ${manifest.version}\nCommit: ${commit}\nGPL-3.0\nCorresponding source: ${name}-source.zip in the same release.\nhttps://github.com/came815/nyaa-enhancer-presets/releases/tag/v${manifest.version}\n`, { date: fixedDate });
const chromeFile = `dist/${name}-chrome.zip`;
const sourceFile = `dist/${name}-source.zip`;
await writeFile(chromeFile, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
execFileSync('git', ['archive', '--format=zip', `--prefix=${name}-source/`, `--output=${path.resolve(sourceFile)}`, 'HEAD'], { cwd: root });
const sums = [];
for (const file of [chromeFile, sourceFile]) {
  const bytes = await readFile(file);
  sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${path.basename(file)}`);
}
await writeFile('dist/SHA256SUMS.txt', sums.join('\n') + '\n');
console.log(JSON.stringify({ commit, version: manifest.version, files: [chromeFile, sourceFile, 'dist/SHA256SUMS.txt'] }, null, 2));
