// Munin Labs website server.
// Serves the static marketing site from ./public and exposes two JSON
// endpoints that back the "Schedule a demo" and "Contact" forms.

import express from 'express';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateDemo, validateContact } from './lib/validate.js';
import { createStore } from './lib/store.js';
import { createNotifier } from './lib/notify.js';
import { createRateLimiter } from './lib/rate-limit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Serverless hosts (Vercel, Lambda, Cloud Run) have a read-only bundle and a
// writable /tmp that does not survive between invocations. On those hosts the
// JSONL files are a best-effort log only and NOTIFY_* is the real delivery path.
function isServerless(env) {
  return Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME || env.K_SERVICE);
}

function resolveDataDir(env) {
  if (env.DATA_DIR) return path.resolve(__dirname, env.DATA_DIR);
  if (isServerless(env)) return path.join(os.tmpdir(), 'munin-labs-site');
  return path.resolve(__dirname, 'data');
}

export function createApp({ env = process.env, logger = console } = {}) {
  const app = express();
  const store = createStore(resolveDataDir(env));
  const notifier = createNotifier(env, { logger });
  const serverless = isServerless(env);

  app.disable('x-powered-by');
  // Behind a reverse proxy the client IP arrives in X-Forwarded-For. Vercel and
  // similar hosts always front the app with one, so trust it there by default.
  if (env.TRUST_PROXY) app.set('trust proxy', env.TRUST_PROXY === 'true' ? 1 : env.TRUST_PROXY);
  else if (serverless) app.set('trust proxy', 1);

  // Security headers. The site has no third-party scripts, so the CSP is tight.
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data:",
        "connect-src 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "object-src 'none'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    if (req.secure || req.get('x-forwarded-proto') === 'https') {
      res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  app.use(express.json({ limit: '32kb' }));

  const formLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

  function handleForm(validate) {
    return async (req, res) => {
      const { data, errors } = validate(req.body);
      if (errors) return res.status(400).json({ ok: false, errors });
      const entry = store.prepare(data);
      let persisted = false;
      try {
        await store.save(entry);
        persisted = true;
        logger.info(`[submission] ${entry.type} ${entry.id} from ${entry.email}`);
      } catch (err) {
        logger.error('[submission] failed to persist:', err);
      }

      // Await delivery: on serverless hosts the function is frozen as soon as
      // the response is sent, so a fire-and-forget webhook would never leave.
      const delivered = await notifier.notify(entry);

      if (!persisted && !delivered) {
        return res.status(500).json({ ok: false, error: 'We could not save your request. Please email us directly.' });
      }
      if (!persisted || (serverless && !notifier.configured)) {
        logger.error(`[submission] ${entry.id} was not durably stored; configure NOTIFY_WEBHOOK_URL or SMTP.`);
      }
      return res.status(201).json({ ok: true, id: entry.id });
    };
  }

  app.get('/api/health', (req, res) => res.json({ ok: true, service: 'munin-labs-site' }));
  app.post('/api/demo', formLimiter, handleForm(validateDemo));
  app.post('/api/contact', formLimiter, handleForm(validateContact));

  app.use(
    express.static(path.join(__dirname, 'public'), {
      extensions: ['html'],
      maxAge: env.NODE_ENV === 'production' ? '1h' : 0,
    }),
  );

  app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Not found' }));
  app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'), (err) => {
      // The static 404 page may not be bundled on serverless hosts; never turn that into a 500.
      if (err && !res.headersSent) res.status(404).type('text').send('Not found');
    });
  });

  // Malformed JSON and other errors.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ ok: false, error: 'Invalid JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ ok: false, error: 'Request too large.' });
    logger.error(err);
    return res.status(500).json({ ok: false, error: 'Something went wrong.' });
  });

  return app;
}

// Default export for serverless hosts that import the app as a request handler.
const app = createApp();
export default app;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`Munin Labs site listening on http://localhost:${port}`);
  });
}
