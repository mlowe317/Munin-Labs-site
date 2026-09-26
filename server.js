// Munin Labs website server.
// Serves the static marketing site from ./public and exposes two JSON
// endpoints that back the "Schedule a demo" and "Contact" forms.

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateDemo, validateContact } from './lib/validate.js';
import { createStore } from './lib/store.js';
import { createNotifier } from './lib/notify.js';
import { createRateLimiter } from './lib/rate-limit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ env = process.env, logger = console } = {}) {
  const app = express();
  const store = createStore(path.resolve(__dirname, env.DATA_DIR || 'data'));
  const notifier = createNotifier(env, { logger });

  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', env.TRUST_PROXY === 'true' ? 1 : env.TRUST_PROXY);

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
      try {
        const entry = await store.save(data);
        logger.info(`[submission] ${entry.type} ${entry.id} from ${entry.email}`);
        // Fire and forget: the visitor should not wait on SMTP or a webhook.
        notifier.notify(entry).catch((err) => logger.error('[notify]', err));
        return res.status(201).json({ ok: true, id: entry.id });
      } catch (err) {
        logger.error('[submission] failed to persist:', err);
        return res.status(500).json({ ok: false, error: 'We could not save your request. Please email us directly.' });
      }
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
  app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));

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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, () => {
    console.log(`Munin Labs site listening on http://localhost:${port}`);
  });
}
