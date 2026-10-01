import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createNotifier, resolveSmtp, DEFAULT_NOTIFY_EMAIL } from '../lib/notify.js';
import { createApp } from '../server.js';
import { tmpdir } from 'node:os';

const quiet = { info() {}, error() {} };
const demo = {
  id: 'abc', receivedAt: '2026-10-01T10:00:00.000Z', type: 'demo', name: 'Ada Lovelace', email: 'ada@example.com',
  company: 'Analytical Engines', role: 'CTO', services: ['ocr', 'call-agents'], preferredDate: '2026-10-09',
  timeWindow: 'morning', timezone: 'Europe/London', notes: 'Bring <sample> docs & forms',
};
const contact = {
  id: 'def', receivedAt: '2026-10-01T10:00:00.000Z', type: 'contact', name: 'Grace Hopper', email: 'grace@example.com',
  company: '', subject: 'Partnership', message: 'Let us talk.',
};

function stubTransport() {
  const sent = [];
  return { sent, sendMail: async (msg) => { sent.push(msg); return { messageId: 'x' }; } };
}

test('Gmail variables resolve to Gmail SMTP with the recipient defaulting to the site owner', () => {
  const smtp = resolveSmtp({ GMAIL_USER: 'me@gmail.com', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop' });
  assert.equal(smtp.host, 'smtp.gmail.com');
  assert.equal(smtp.port, 465);
  assert.equal(smtp.secure, true);
  assert.equal(smtp.auth.pass, 'abcdefghijklmnop');
  const n = createNotifier({ GMAIL_USER: 'me@gmail.com', GMAIL_APP_PASSWORD: 'x' }, { logger: quiet, transport: stubTransport() });
  assert.deepEqual(n.channels, ['email:gmail']);
  assert.equal(n.recipient, DEFAULT_NOTIFY_EMAIL);
});

test('nothing is configured without credentials', () => {
  const n = createNotifier({}, { logger: quiet });
  assert.equal(n.configured, false);
  assert.deepEqual(n.channels, []);
});

test('demo requests are emailed with reply-to set to the visitor', async () => {
  const t = stubTransport();
  const n = createNotifier({ GMAIL_USER: 'me@gmail.com', GMAIL_APP_PASSWORD: 'x' }, { logger: quiet, transport: t });
  assert.equal(await n.notify(demo), true);
  assert.equal(t.sent.length, 1);
  const m = t.sent[0];
  assert.equal(m.to, DEFAULT_NOTIFY_EMAIL);
  assert.equal(m.replyTo, 'Ada Lovelace <ada@example.com>');
  assert.equal(m.subject, '[Munin Labs] Demo request: Analytical Engines (Ada Lovelace)');
  assert.match(m.text, /Services: Secure OCR, AI Call Agents/);
  assert.match(m.text, /Preferred date: 2026-10-09 \(morning, Europe\/London\)/);
  assert.match(m.html, /Bring &lt;sample&gt; docs &amp; forms/, 'html body is escaped');
});

test('contact messages are emailed with the subject line', async () => {
  const t = stubTransport();
  const n = createNotifier({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u', SMTP_PASS: 'p', NOTIFY_EMAIL: 'owner@example.com' }, { logger: quiet, transport: t });
  assert.deepEqual(n.channels, ['email:smtp']);
  assert.equal(await n.notify(contact), true);
  assert.equal(t.sent[0].to, 'owner@example.com');
  assert.equal(t.sent[0].subject, '[Munin Labs] Contact: Partnership');
  assert.match(t.sent[0].text, /Message:\nLet us talk\./);
});

test('a failing transport reports no delivery', async () => {
  const n = createNotifier({ GMAIL_USER: 'me@gmail.com', GMAIL_APP_PASSWORD: 'x' }, {
    logger: quiet, transport: { sendMail: async () => { throw new Error('535 auth failed'); } },
  });
  assert.equal(await n.notify(contact), false);
});

test('health endpoint reports configured channels without secrets', async () => {
  const app = createApp({ env: { DATA_DIR: tmpdir(), GMAIL_USER: 'me@gmail.com', GMAIL_APP_PASSWORD: 'secret' }, logger: quiet });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    const body = await (await fetch(`http://127.0.0.1:${server.address().port}/api/health`)).json();
    assert.deepEqual(body.notifications, ['email:gmail']);
    assert.equal(body.recipient, DEFAULT_NOTIFY_EMAIL);
    assert.ok(!JSON.stringify(body).includes('secret'));
  } finally {
    server.close();
  }
});
