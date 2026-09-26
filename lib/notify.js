// Outbound notifications for new submissions.
// Both channels are optional and configured purely through environment
// variables. Failures are logged and never surfaced to the visitor: the
// submission is already persisted by the time notify() runs.

import { SERVICES } from './validate.js';

function formatSubmission(entry) {
  const lines = [`New ${entry.type} submission (${entry.id})`, `Received: ${entry.receivedAt}`, ''];
  lines.push(`Name: ${entry.name}`, `Email: ${entry.email}`);
  if (entry.company) lines.push(`Company: ${entry.company}`);
  if (entry.type === 'demo') {
    if (entry.role) lines.push(`Role: ${entry.role}`);
    lines.push(`Services: ${entry.services.map((s) => SERVICES[s] || s).join(', ')}`);
    lines.push(`Preferred date: ${entry.preferredDate} (${entry.timeWindow}${entry.timezone ? `, ${entry.timezone}` : ''})`);
    if (entry.notes) lines.push('', 'Notes:', entry.notes);
  } else {
    if (entry.subject) lines.push(`Subject: ${entry.subject}`);
    lines.push('', 'Message:', entry.message);
  }
  return lines.join('\n');
}

export function createNotifier(env, { logger = console } = {}) {
  const webhookUrl = env.NOTIFY_WEBHOOK_URL || '';
  const notifyEmail = env.NOTIFY_EMAIL || '';
  let transportPromise = null;

  async function getTransport() {
    if (!notifyEmail || !env.SMTP_HOST) return null;
    if (!transportPromise) {
      transportPromise = import('nodemailer').then((nodemailer) =>
        nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: Number(env.SMTP_PORT || 587),
          secure: env.SMTP_SECURE === 'true',
          auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } : undefined,
        }),
      );
    }
    return transportPromise;
  }

  async function sendWebhook(entry, text) {
    if (!webhookUrl) return;
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, submission: entry }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
  }

  async function sendEmail(entry, text) {
    const transport = await getTransport();
    if (!transport) return;
    const subject =
      entry.type === 'demo'
        ? `Demo request: ${entry.company} (${entry.name})`
        : `Contact: ${entry.subject || entry.name}`;
    await transport.sendMail({
      from: env.SMTP_FROM || notifyEmail,
      to: notifyEmail,
      replyTo: entry.email,
      subject: `[Munin Labs] ${subject}`,
      text,
    });
  }

  async function notify(entry) {
    const text = formatSubmission(entry);
    const results = await Promise.allSettled([sendWebhook(entry, text), sendEmail(entry, text)]);
    for (const r of results) {
      if (r.status === 'rejected') logger.error('[notify] delivery failed:', r.reason?.message || r.reason);
    }
  }

  return { notify, formatSubmission };
}
