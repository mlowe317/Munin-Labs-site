// The free OCR page is fully self-hosted: the page, the Tesseract worker and
// cores, the English model, and pdf.js must all be served from this origin
// with the right content types, and the CSP must allow WebAssembly.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { createApp } from '../server.js';

let server;
let base;
const quiet = { info() {}, error() {} };

before(async () => {
  const app = createApp({ env: { DATA_DIR: tmpdir() }, logger: quiet });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

test('serves the free OCR page with a WebAssembly-friendly CSP', async () => {
  const res = await fetch(`${base}/free-ocr`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Free OCR that never uploads your document/);
  assert.match(html, /\/vendor\/tesseract\/tesseract\.min\.js/);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(csp, /worker-src 'self'/);
  assert.match(csp, /img-src 'self' data: blob:/);
});

test('homepage links to the free OCR page', async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /href="\/free-ocr"/);
});

const assets = [
  ['/vendor/tesseract/tesseract.min.js', /javascript/],
  ['/vendor/tesseract/worker.min.js', /javascript/],
  ['/vendor/tesseract/tesseract-core-simd-lstm.wasm.js', /javascript/],
  ['/vendor/tesseract/tesseract-core-lstm.wasm.js', /javascript/],
  ['/vendor/tesseract/lang/eng.traineddata.gz', /gzip|octet-stream/],
  ['/vendor/pdfjs/pdf.min.mjs', /javascript/],
  ['/vendor/pdfjs/pdf.worker.min.mjs', /javascript/],
  ['/vendor/pdfjs/wasm/openjpeg.wasm', /wasm/],
  ['/js/ocr.js', /javascript/],
];

for (const [path, type] of assets) {
  test(`serves ${path}`, async () => {
    const res = await fetch(`${base}${path}`, { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', type);
  });
}

test('vendored versions manifest matches installed packages', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/vendor/VERSIONS.json', import.meta.url), 'utf8'));
  for (const pkg of ['tesseract.js', 'tesseract.js-core', '@tesseract.js-data/eng', 'pdfjs-dist']) {
    const installed = JSON.parse(await readFile(new URL(`../node_modules/${pkg}/package.json`, import.meta.url), 'utf8'));
    assert.equal(manifest[pkg], installed.version, `${pkg} vendored copy is out of date; run npm run vendor`);
  }
});

test('the English model is a gzip file', async () => {
  const res = await fetch(`${base}/vendor/tesseract/lang/eng.traineddata.gz`);
  const buf = new Uint8Array(await res.arrayBuffer());
  assert.equal(buf[0], 0x1f);
  assert.equal(buf[1], 0x8b);
});
