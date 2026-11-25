import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { receive, tokenMatches } from './services/kometa.js';

/*
 * Incoming webhooks. Kometa can't sign in or send headers, so each address
 * carries a long random token, checked before the body is even read.
 */

export const hooksRouter = Router();

const limiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

// "Collection changed" webhooks can carry base64 posters, so allow a larger body here only.
const kometaJson = express.json({ limit: '25mb' });

hooksRouter.post(
  '/kometa/:token',
  limiter,
  (req, res, next) => {
    if (!tokenMatches(String(req.params.token))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    next();
  },
  kometaJson,
  (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object' || !receive(body)) {
      res.status(400).json({ error: 'bad_request', message: 'Not a Kometa webhook' });
      return;
    }
    res.json({ ok: true });
  },
);
