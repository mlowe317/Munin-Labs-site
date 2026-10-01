# Munin Labs website

Company website for **Munin Labs**: the most secure OCR, the most capable and fastest
go-to-market AI call agents, and the most secure web application development.

The site is a static marketing page served by a small Node/Express app, plus a
free in-browser OCR tool at `/free-ocr`. The app backs the two forms on the homepage:

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

## Free OCR page

`/free-ocr` runs [Tesseract.js](https://github.com/naptha/tesseract.js) entirely in the
visitor's browser. Nothing is uploaded: the WebAssembly engine, the English model and
[pdf.js](https://mozilla.github.io/pdf.js/) (used to rasterise PDF pages) are all served from
`public/vendor/`, so the page works under the site's same-origin Content Security Policy
and keeps working offline once cached.

The vendored files are copied from `node_modules` by `npm run vendor` (see
`scripts/vendor.mjs`) and committed. After upgrading `tesseract.js`, `tesseract.js-core`,
`@tesseract.js-data/eng` or `pdfjs-dist`, run the script again and commit the result. A
test compares `public/vendor/VERSIONS.json` with the installed versions so a stale copy
fails the suite.

Only the two LSTM cores (SIMD and a non-SIMD fallback) and the quantised "best" English
model are shipped. To add languages, copy the matching `<lang>.traineddata.gz` from an
`@tesseract.js-data/<lang>` package into `public/vendor/tesseract/lang/` and add the option
in `public/js/ocr.js`.

## Configuration

Copy `.env.example` to `.env` (or set the variables in your host) and export them
before starting the server. Everything is optional; with no configuration the site
runs and stores submissions on disk.

### Getting form submissions by email

Every demo request and contact message is emailed to `NOTIFY_EMAIL`, which defaults
to `lowematthew7@gmail.com`. Email is sent only when credentials are configured.

**Gmail (two variables):**

1. Turn on 2-Step Verification for the Google account.
2. Create an App Password at <https://myaccount.google.com/apppasswords>.
3. Set `GMAIL_USER` to the Gmail address and `GMAIL_APP_PASSWORD` to the 16-character
   password (spaces are fine). On Vercel: Project → Settings → Environment Variables,
   then redeploy.
4. Check `/api/health`: it lists `"notifications": ["email:gmail"]` when the variables
   are picked up. Then submit the contact form once to confirm delivery.

Emails arrive with the visitor as reply-to, so replying from your inbox answers them
directly.

| Variable | Purpose |
| --- | --- |
| `PORT` | Port to listen on. Default `3000`. |
| `DATA_DIR` | Directory for `demo-submissions.jsonl` and `contact-submissions.jsonl`. Default `./data`. |
| `TRUST_PROXY` | Set to `true` (or a hop count) when behind a reverse proxy so rate limiting and HSTS see the real client. |
| `NOTIFY_EMAIL` | Recipient for submissions. Default `lowematthew7@gmail.com`. |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Send through Gmail. Easiest option. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Any other SMTP provider (used when `GMAIL_*` is not set). |
| `NOTIFY_WEBHOOK_URL` | If set, every submission is also POSTed as JSON to this URL (Slack, Zapier, Make, a CRM, ...). |

Submissions are always written to disk first where the filesystem allows it, so a
failed email never loses a lead. Check the JSONL files or the server log if a
notification channel misbehaves.

## Project layout

```
server.js            Express app: security headers, static files, form endpoints
api/index.js         Vercel serverless entry point (re-exports the app)
vercel.json          Vercel routing: static public/ first, then the app
lib/validate.js      Field validation and allow-lists for both forms
lib/store.js         Append-only JSONL storage
lib/notify.js        Webhook and SMTP notifications
lib/rate-limit.js    Per-IP rate limiting for the form endpoints
public/index.html    The site
public/free-ocr.html Free in-browser OCR tool
public/css/styles.css
public/js/app.js     Mobile nav, inline validation, form submission
public/js/ocr.js     Browser OCR: Tesseract worker, PDF rasterising, copy/download
public/vendor/       Self-hosted Tesseract.js, cores, English model, pdf.js (npm run vendor)
scripts/vendor.mjs   Copies the OCR dependencies from node_modules into public/vendor
public/404.html
test/                node:test suites (API, headers, serverless behaviour)
```

## Editing the content

All copy lives in `public/index.html`. Things you will probably want to change
before launch:

- The founder section (`#founder`) is written without a name; add one if you want it public.
- Contact email address in the `#contact` section and in `public/js/app.js` error messages
  (currently `lowematthew7@gmail.com`).
- Demo length and business hours in the `#demo` and `#contact` sections.

## Security notes

- Strict Content Security Policy: scripts and connections are same-origin only; the
  only external resources are Google Fonts stylesheets and fonts. `'wasm-unsafe-eval'` is
  allowed so the free OCR page can compile WebAssembly; it does not permit `eval()`.
- The same headers are applied to CDN-served static files on Vercel through `vercel.json`.
- `X-Frame-Options: DENY`, `nosniff`, referrer and permissions policies on every response,
  and HSTS when served over HTTPS.
- JSON bodies are capped at 32 KB. Every field is length-limited and allow-listed.
- A honeypot field and a per-IP rate limit (10 submissions per 15 minutes) blunt spam.
- Submission files are created with owner-only permissions (`0600`).

## Deploying

### Vercel

The repository is ready to deploy on Vercel as-is: import the repo and deploy. Vercel
detects Express automatically. `public/` is served from the CDN and everything else is
routed to the Express app through `api/index.js` (see `vercel.json`). The Node runtime is
pinned to 22.x through `engines` in `package.json`; bump it deliberately after testing.

Vercel deploys whatever commit is on the production branch. The dashboard's **Redeploy**
button rebuilds the *same* commit, so after pushing a fix make sure the newest production
deployment is the new commit, not a redeploy of the old one.

Vercel functions cannot write to the project directory, so on Vercel the JSONL files
land in `/tmp` and are discarded when the function is recycled. **Set `GMAIL_USER` and
`GMAIL_APP_PASSWORD` (or another channel, see above) in the project's environment
variables**, otherwise demo requests will only ever appear in the function logs. A submission is acknowledged to the visitor once it is either
written to disk or delivered to a configured channel.

The per-IP rate limit is per function instance on Vercel, so it is a softer guard there.
Enable Vercel's attack challenge mode or a WAF rule if the forms start attracting spam.

### Long-running Node hosts

Any host that runs Node works (Render, Fly.io, Railway, a VPS behind nginx or Caddy).
Set `NODE_ENV=production` to enable static asset caching, set `TRUST_PROXY=true` behind
a proxy, and point `DATA_DIR` at a persistent volume so submissions survive deploys.
