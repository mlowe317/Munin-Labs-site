# Munin Labs website

Company website for **Munin Labs**: the most secure OCR, the most capable and fastest
go-to-market AI call agents, and the most secure web application development.

The site is a single static page served by a small Node/Express app. The app also
backs the two forms on the page:

- **Schedule a tailored demo** (`POST /api/demo`)
- **Contact us** (`POST /api/contact`)

Submissions are validated, written to append-only JSON Lines files, and optionally
forwarded by webhook and/or email. There is no database and no third-party
JavaScript.

## Running locally

Requires Node 20 or newer.

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # restarts on file changes
npm test           # API and security-header tests
```

## Configuration

Copy `.env.example` to `.env` (or set the variables in your host) and export them
before starting the server. Everything is optional; with no configuration the site
runs and stores submissions on disk.

| Variable | Purpose |
| --- | --- |
| `PORT` | Port to listen on. Default `3000`. |
| `DATA_DIR` | Directory for `demo-submissions.jsonl` and `contact-submissions.jsonl`. Default `./data`. |
| `TRUST_PROXY` | Set to `true` (or a hop count) when behind a reverse proxy so rate limiting and HSTS see the real client. |
| `NOTIFY_WEBHOOK_URL` | If set, every submission is POSTed as JSON to this URL (Slack, Zapier, Make, a CRM, ...). |
| `NOTIFY_EMAIL` | If set together with `SMTP_HOST`, every submission is emailed here with the visitor as reply-to. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | SMTP transport for the email notifier. |

Submissions are always written to disk first, so a failed webhook or email never
loses a lead. Check the JSONL files or the server log if a notification channel
misbehaves.

## Project layout

```
server.js            Express app: security headers, static files, form endpoints
lib/validate.js      Field validation and allow-lists for both forms
lib/store.js         Append-only JSONL storage
lib/notify.js        Webhook and SMTP notifications
lib/rate-limit.js    Per-IP rate limiting for the form endpoints
public/index.html    The site
public/css/styles.css
public/js/app.js     Mobile nav, inline validation, form submission
public/404.html
test/api.test.js     node:test suite
```

## Editing the content

All copy lives in `public/index.html`. Things you will probably want to change
before launch:

- The founder section (`#founder`) is written without a name; add one if you want it public.
- Contact email addresses in the `#contact` section and in `public/js/app.js` error messages
  (`hello@muninlabs.com`, `security@muninlabs.com`).
- Demo length and business hours in the `#demo` and `#contact` sections.

## Security notes

- Strict Content Security Policy: scripts and connections are same-origin only; the
  only external resources are Google Fonts stylesheets and fonts.
- `X-Frame-Options: DENY`, `nosniff`, referrer and permissions policies on every response,
  and HSTS when served over HTTPS.
- JSON bodies are capped at 32 KB. Every field is length-limited and allow-listed.
- A honeypot field and a per-IP rate limit (10 submissions per 15 minutes) blunt spam.
- Submission files are created with owner-only permissions (`0600`).

## Deploying

Any host that runs Node works (Render, Fly.io, Railway, a VPS behind nginx or Caddy).
Set `NODE_ENV=production` to enable static asset caching, set `TRUST_PROXY=true` behind
a proxy, and point `DATA_DIR` at a persistent volume so submissions survive deploys.
