import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createApp } from '../server.js';

let server;
let base;
let dataDir;
const quiet = { info() {}, error() {} };

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'munin-test-'));
  const app = createApp({ env: { DATA_DIR: dataDir }, logger: quiet });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

const post = (route, body) =>
  fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

test('serves the homepage with security headers', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Munin Labs/);
  assert.ok(res.headers.get('content-security-policy'));
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('health endpoint', async () => {
  const res = await fetch(base + '/api/health');
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'munin-labs-site');
  assert.deepEqual(body.notifications, []);
  assert.equal(body.recipient, null);
});

test('accepts a valid demo request and persists it', async () => {
  const res = await post('/api/demo', {
    name: 'Ada Lovelace',
    email: 'Ada@Example.com',
    company: 'Analytical Engines',
    role: 'CTO',
    services: ['ocr', 'call-agents'],
    preferredDate: tomorrow,
    timeWindow: 'morning',
    timezone: 'Europe/London',
    notes: 'Interested in on-prem OCR.',
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.id);

  const stored = await readFile(path.join(dataDir, 'demo-submissions.jsonl'), 'utf8');
  const record = JSON.parse(stored.trim().split('\n').pop());
  assert.equal(record.id, body.id);
  assert.equal(record.email, 'ada@example.com');
  assert.deepEqual(record.services, ['ocr', 'call-agents']);
});

test('rejects an invalid demo request with field errors', async () => {
  const res = await post('/api/demo', {
    name: '',
    email: 'not-an-email',
    company: 'X',
    services: ['nonsense'],
    preferredDate: '2001-01-01',
    timeWindow: 'midnight',
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  for (const field of ['name', 'email', 'services', 'preferredDate', 'timeWindow']) {
    assert.ok(body.errors[field], `expected error for ${field}`);
  }
});

test('rejects honeypot submissions', async () => {
  const res = await post('/api/contact', {
    name: 'Bot',
    email: 'bot@example.com',
    message: 'Hello there, buying links?',
    website: 'http://spam.example',
  });
  assert.equal(res.status, 400);
});

test('accepts a valid contact message', async () => {
  const res = await post('/api/contact', {
    name: 'Grace Hopper',
    email: 'grace@example.com',
    subject: 'Partnership',
    message: 'We would like to talk about secure web apps.',
  });
  assert.equal(res.status, 201);
  const stored = await readFile(path.join(dataDir, 'contact-submissions.jsonl'), 'utf8');
  assert.match(stored, /grace@example.com/);
});

test('rejects malformed JSON', async () => {
  const res = await fetch(base + '/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(res.status, 400);
});

test('unknown API routes return JSON 404', async () => {
  const res = await fetch(base + '/api/nope');
  assert.equal(res.status, 404);
  assert.equal((await res.json()).ok, false);
});

test('serves the intro video with range support and its poster', async () => {
  const video = await fetch(base + '/media/munin-labs.mp4', { headers: { Range: 'bytes=0-1023' } });
  assert.equal(video.status, 206);
  assert.match(video.headers.get('content-type'), /video\/mp4/);
  assert.equal(video.headers.get('content-length'), '1024');
  assert.equal(video.headers.get('cache-control'), 'public, max-age=86400');
  const poster = await fetch(base + '/media/munin-labs-poster.jpg', { method: 'HEAD' });
  assert.equal(poster.status, 200);
  assert.match(poster.headers.get('content-type'), /image\/jpeg/);
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /<video[^>]*poster="\/media\/munin-labs-poster\.jpg"/);
  assert.match(html, /<video[^>]*\bautoplay\b[^>]*\bmuted\b[^>]*\bloop\b[^>]*\bplaysinline\b/);
  assert.match(html, /<source src="\/media\/munin-labs\.mp4" type="video\/mp4">/);
});
