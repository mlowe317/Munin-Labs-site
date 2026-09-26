// Input validation for the demo and contact forms.
// Every field is length-capped and type-checked; nothing reaches storage
// or notifications without passing through here.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const SERVICES = Object.freeze({
  ocr: 'Secure OCR',
  'call-agents': 'AI Call Agents',
  'web-apps': 'Secure Web Application Development',
});

export const TIME_WINDOWS = Object.freeze(['morning', 'midday', 'afternoon', 'flexible']);

function str(value, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > max ? null : trimmed;
}

function isValidDate(value) {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  if (d.toISOString().slice(0, 10) !== value) return false;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return d.getTime() >= today.getTime() - 24 * 60 * 60 * 1000;
}

export function validateDemo(body) {
  const errors = {};
  if (!body || typeof body !== 'object') return { errors: { form: 'Invalid request body.' } };

  const name = str(body.name, 120);
  const email = str(body.email, 254);
  const company = str(body.company, 160);
  const role = str(body.role, 120);
  const preferredDate = str(body.preferredDate, 10);
  const timeWindow = str(body.timeWindow, 20);
  const timezone = str(body.timezone, 80);
  const notes = str(body.notes, 2000);
  const honeypot = str(body.website, 200);

  if (!name) errors.name = 'Please tell us your name.';
  if (!email || !EMAIL_RE.test(email)) errors.email = 'Please enter a valid work email.';
  if (!company) errors.company = 'Please tell us your company.';
  if (role === null) errors.role = 'Role is too long.';
  if (notes === null) errors.notes = 'Notes must be under 2000 characters.';
  if (timezone === null) errors.timezone = 'Timezone is too long.';

  let services = body.services;
  if (typeof services === 'string') services = [services];
  if (!Array.isArray(services) || services.length === 0) {
    errors.services = 'Select at least one service.';
  } else if (services.length > 3 || !services.every((s) => typeof s === 'string' && SERVICES[s])) {
    errors.services = 'Unknown service selection.';
  }

  if (!preferredDate || !isValidDate(preferredDate)) {
    errors.preferredDate = 'Choose a date from today onward.';
  }
  if (!timeWindow || !TIME_WINDOWS.includes(timeWindow)) {
    errors.timeWindow = 'Choose a time window.';
  }
  if (honeypot) errors.form = 'Submission rejected.';

  if (Object.keys(errors).length) return { errors };

  return {
    data: {
      type: 'demo',
      name,
      email: email.toLowerCase(),
      company,
      role: role || '',
      services: [...new Set(services)],
      preferredDate,
      timeWindow,
      timezone: timezone || '',
      notes: notes || '',
    },
  };
}

export function validateContact(body) {
  const errors = {};
  if (!body || typeof body !== 'object') return { errors: { form: 'Invalid request body.' } };

  const name = str(body.name, 120);
  const email = str(body.email, 254);
  const company = str(body.company, 160);
  const subject = str(body.subject, 160);
  const message = str(body.message, 4000);
  const honeypot = str(body.website, 200);

  if (!name) errors.name = 'Please tell us your name.';
  if (!email || !EMAIL_RE.test(email)) errors.email = 'Please enter a valid email.';
  if (company === null) errors.company = 'Company is too long.';
  if (subject === null) errors.subject = 'Subject is too long.';
  if (!message || message.length < 10) errors.message = 'Please include a short message (at least 10 characters).';
  if (honeypot) errors.form = 'Submission rejected.';

  if (Object.keys(errors).length) return { errors };

  return {
    data: {
      type: 'contact',
      name,
      email: email.toLowerCase(),
      company: company || '',
      subject: subject || '',
      message,
    },
  };
}
