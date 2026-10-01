// Outbound notifications for new submissions.
// Channels are configured through environment variables and are optional.
// Failures are logged and never surfaced to the visitor.
//
// Email, simplest setup (Gmail):
//   GMAIL_USER=you@gmail.com  GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
// Email, any SMTP server:
//   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
// Recipient: NOTIFY_EMAIL (defaults to the site's contact address below).
// Webhook: NOTIFY_WEBHOOK_URL (Slack, Zapier, Make, a CRM, ...).

import { SERVICES } from './validate.js';

export const DEFAULT_NOTIFY_EMAIL = 'lowematthew7@gmail.com';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function summarise(entry) {
  const rows = [['Name', entry.name], ['Email', entry.email]];
  if (entry.company) rows.push(['Company', entry.company]);
  if (entry.type === 'demo') {
    if (entry.role) rows.push(['Role', entry.role]);
    rows.push(['Services', entry.services.map((s) => SERVICES[s] || s).join(', ')]);
    rows.push(['Preferred date', `${entry.preferredDate} (${entry.timeWindow}${entry.timezone ? `, ${entry.timezone}` : ''})`]);
  } else if (entry.subject) {
    rows.push(['Subject', entry.subject]);
  }
  const body = entry.type === 'demo' ? entry.notes : entry.message;
  const bodyLabel = entry.type === 'demo' ? 'Notes' : 'Message';
  return { rows, body, bodyLabel };
}

export function formatSubmission(entry) {
  const { rows, body, bodyLabel } = summarise(entry);
  const lines = [`New ${entry.type} submission (${entry.id})`, `Received: ${entry.receivedAt}`, ''];
  for (const [k, v] of rows) lines.push(`${k}: ${v}`);
  if (body) lines.push('', `${bodyLabel}:`, body);
  return lines.join('\n');
}

export function formatSubmissionHtml(entry) {
  const { rows, body, bodyLabel } = summarise(entry);
  const title = entry.type === 'demo' ? 'New demo request' : 'New contact message';
  const tr = rows
    .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#6f6f6f;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td><td style="padding:6px 0">${escapeHtml(v)}</td></tr>`)
    .join('');
  const bodyHtml = body
    ? `<p style="margin:18px 0 6px;color:#6f6f6f">${bodyLabel}</p><div style="white-space:pre-wrap;border-left:3px solid #e60012;padding:8px 12px;background:#f8f8f8">${escapeHtml(body)}</div>`
    : '';
  return `<div style="font-family:Inter,Arial,sans-serif;color:#484848;max-width:640px">
<h2 style="color:#1f1f1f;margin:0 0 4px">${title}</h2>
<p style="margin:0 0 16px;color:#6f6f6f;font-size:13px">Received ${escapeHtml(entry.receivedAt)} &middot; ref ${escapeHtml(entry.id)}</p>
<table style="border-collapse:collapse;font-size:15px">${tr}</table>
${bodyHtml}
<p style="margin:24px 0 0;font-size:13px;color:#6f6f6f">Reply to this email to answer ${escapeHtml(entry.name)} directly.</p>
</div>`;
}

function emailSubject(entry) {
  return entry.type === 'demo'
    ? `[Munin Labs] Demo request: ${entry.company} (${entry.name})`
    : `[Munin Labs] Contact: ${entry.subject || entry.name}`;
}

// Resolve SMTP settings from either the Gmail shortcut or generic SMTP variables.
export function resolveSmtp(env) {
  if (env.GMAIL_USER && env.GMAIL_APP_PASSWORD) {
    return {
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD.replace(/\s+/g, '') },
      from: env.SMTP_FROM || `Munin Labs Website <${env.GMAIL_USER}>`,
      provider: 'gmail',
    };
  }
  if (env.SMTP_HOST) {
    return {
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT || 587),
      secure: env.SMTP_SECURE === 'true',
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } : undefined,
      from: env.SMTP_FROM || env.SMTP_USER || env.NOTIFY_EMAIL || DEFAULT_NOTIFY_EMAIL,
      provider: 'smtp',
    };
  }
  return null;
}

export function createNotifier(env, { logger = console, transport = null } = {}) {
  const webhookUrl = env.NOTIFY_WEBHOOK_URL || '';
  const notifyEmail = env.NOTIFY_EMAIL || DEFAULT_NOTIFY_EMAIL;
  const smtp = resolveSmtp(env);
  const emailEnabled = Boolean(smtp && notifyEmail);
  let transportPromise = transport ? Promise.resolve(transport) : null;

  async function getTransport() {
    if (!emailEnabled) return null;
    if (!transportPromise) {
      transportPromise = import('nodemailer').then((nodemailer) =>
        nodemailer.createTransport({
          host: smtp.host,
          port: smtp.port,
          secure: smtp.secure,
          auth: smtp.auth,
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 15000,
        }),
      );
    }
    return transportPromise;
  }

  async function sendWebhook(entry, text) {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, submission: entry }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
  }

  async function sendEmail(entry, text) {
    const t = await getTransport();
    await t.sendMail({
      from: smtp.from,
      to: notifyEmail,
      replyTo: `${entry.name} <${entry.email}>`,
      subject: emailSubject(entry),
      text,
      html: formatSubmissionHtml(entry),
    });
  }

  const channels = [];
  if (emailEnabled) channels.push(`email:${smtp.provider}`);
  if (webhookUrl) channels.push('webhook');
  const configured = channels.length > 0;

  // Resolves true when at least one configured channel delivered.
  async function notify(entry) {
    if (!configured) return false;
    const text = formatSubmission(entry);
    const attempts = [];
    if (webhookUrl) attempts.push(sendWebhook(entry, text).then(() => 'webhook'));
    if (emailEnabled) attempts.push(sendEmail(entry, text).then(() => 'email'));
    const results = await Promise.allSettled(attempts);
    let delivered = false;
    for (const r of results) {
      if (r.status === 'rejected') logger.error('[notify] delivery failed:', r.reason?.message || r.reason);
      else {
        delivered = true;
        logger.info(`[notify] ${entry.type} ${entry.id} delivered via ${r.value}`);
      }
    }
    return delivered;
  }

  return { notify, formatSubmission, configured, channels, recipient: notifyEmail };
}
