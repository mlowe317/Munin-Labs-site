// Vercel serverless entry point. Every request that is not a static file in
// ./public is rewritten here (see vercel.json) and handled by the Express app.
import app from '../server.js';

export default app;
