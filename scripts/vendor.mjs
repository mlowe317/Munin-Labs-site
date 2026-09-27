// Copies the browser OCR dependencies from node_modules into public/vendor so
// the free OCR page is fully self-hosted (the site's CSP allows same-origin only).
// Run `npm run vendor` after upgrading tesseract.js, tesseract.js-core,
// @tesseract.js-data/eng or pdfjs-dist, then commit the result.

import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = path.join(root, 'node_modules');
const out = path.join(root, 'public', 'vendor');

const versions = {
  'tesseract.js': require('tesseract.js/package.json').version,
  'tesseract.js-core': require('tesseract.js-core/package.json').version,
  '@tesseract.js-data/eng': require('@tesseract.js-data/eng/package.json').version,
  'pdfjs-dist': require('pdfjs-dist/package.json').version,
};

const files = [
  // Tesseract.js browser bundle, worker, and the two LSTM-only cores (SIMD + fallback).
  ['tesseract.js/dist/tesseract.min.js', 'tesseract/tesseract.min.js'],
  ['tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js'],
  ['tesseract.js/LICENSE.md', 'tesseract/LICENSE.md'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract/tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract/tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/LICENSE', 'tesseract/LICENSE-core'],
  // English model: integer-quantised "best" set, the tesseract.js default for LSTM-only cores.
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'tesseract/lang/eng.traineddata.gz'],
  // pdf.js (legacy build for wider browser support) for rendering PDF pages before OCR.
  ['pdfjs-dist/legacy/build/pdf.min.mjs', 'pdfjs/pdf.min.mjs'],
  ['pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'pdfjs/pdf.worker.min.mjs'],
  ['pdfjs-dist/LICENSE', 'pdfjs/LICENSE'],
  ['pdfjs-dist/standard_fonts', 'pdfjs/standard_fonts'],
  ['pdfjs-dist/wasm', 'pdfjs/wasm'],
];

await rm(out, { recursive: true, force: true });
for (const [from, to] of files) {
  const dest = path.join(out, to);
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(path.join(nm, from), dest, { recursive: true });
}
await writeFile(path.join(out, 'VERSIONS.json'), `${JSON.stringify(versions, null, 2)}\n`);
console.log('Vendored:', versions);
