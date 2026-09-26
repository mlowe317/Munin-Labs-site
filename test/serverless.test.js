// Behaviour on hosts like Vercel where the bundle is read-only and the
// function is frozen after responding: notifications must be awaited and a
// failed disk write must not lose a submission that a webhook delivered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createApp } from '../server.js';

const quiet = { info() {}, error() {} };
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const demo = {
  name: 'Test Person', email: 'test@example.com', company: 'Example Corp',
  services: ['ocr'], preferredDate: tomorrow, timeWindow: 'morning',
};

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

// A regular file where a directory is expected: mkdir/appendFile fail with
// ENOTDIR for every user, including root, which mimics a read-only bundle.
async function unwritableDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'munin-ro-'));
  const file = path.join(dir, 'blocker');
  await writeFile(file, '');
  return { dir, dataDir: path.join(file, 'nested') };
}

test('vercel entry point exports the app as a request handler', async () => {
  const mod = await import('../api/index.js');
  assert.equal(typeof mod.default, 'function');
  assert.equal(typeof mod.default.handle, 'function');
});

test('serverless env trusts the proxy so rate limiting is per client', () => {
  const app = createApp({ env: { VERCEL: '1', DATA_DIR: tmpdir() }, logger: quiet });
  assert.equal(app.get('trust proxy'), 1);
});

test('unwritable data dir still succeeds when a webhook delivers', async () => {
  const received = [];
  const hook = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { received.push(JSON.parse(body)); res.end('ok'); });
  });
  await new Promise((r) => hook.listen(0, r));
  const { dir, dataDir } = await unwritableDir();
  const app = createApp({
    env: { VERCEL: '1', DATA_DIR: dataDir, NOTIFY_WEBHOOK_URL: `http://127.0.0.1:${hook.address().port}/` },
    logger: quiet,
  });
  const server = await listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/demo`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(demo),
    });
    assert.equal(res.status, 201);
    assert.equal(received.length, 1, 'webhook was delivered before the response');
    assert.equal(received[0].submission.email, 'test@example.com');
  } finally {
    server.close(); hook.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('unwritable data dir with no notifier configured returns 500', async () => {
  const { dir, dataDir } = await unwritableDir();
  const app = createApp({ env: { VERCEL: '1', DATA_DIR: dataDir }, logger: quiet });
  const server = await listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/contact`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A', email: 'a@example.com', message: 'Hello there, this is a test.' }),
    });
    assert.equal(res.status, 500);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
