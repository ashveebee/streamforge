import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { authRouter, requireCsrfHeader } from './auth.js';
import { api } from './routes.js';
import { startMonitors } from './health.js';
import { startHostMetrics } from './host.js';
import { startAutoImport } from './services/autoImport.js';
import { startCleanup } from './services/cleanup.js';
import { startSeerrWatch } from './services/seerr.js';
import { startPlaybackRecorder } from './services/playStats.js';
import { startStorageSampler } from './services/storage.js';
import { VERSION } from './version.js';
import { dbPath } from './lib/db.js';
import { isConfigured, resolve, SERVICE_IDS, SERVICE_NAMES } from './settings.js';

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) {
  const v = config.trustProxy;
  app.set('trust proxy', v === 'true' ? true : /^\d+$/.test(v) ? Number(v) : v);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'img-src': ["'self'", 'data:', 'blob:', 'https://image.tmdb.org', 'https:'],
        'connect-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'font-src': ["'self'", 'data:'],
        'upgrade-insecure-requests': null,
      },
    },
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: config.cookieSecure === 'true',
  }),
);
app.use(express.json({ limit: '32kb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true, version: VERSION }));
app.use('/api', requireCsrfHeader);
app.use('/api/auth', authRouter);
app.use('/api', api);
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

// In production the backend also serves the built frontend.
const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '..', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist, { index: false, maxAge: '1y', immutable: true }));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.set('Cache-Control', 'no-cache').sendFile(path.join(webDist, 'index.html'));
  });
}

app.listen(config.port, config.host, () => {
  console.log(`\n  ▲ StreamForge v${VERSION} listening on http://${config.host}:${config.port}`);
  for (const id of SERVICE_IDS) {
    const r = resolve(id);
    const s = r.settings;
    const target = [s.url, ...(s.mounts ?? [])].filter(Boolean).join(' + ');
    const where = r.source === 'none' ? '(not configured)' : `${target}  [${r.source}]`;
    console.log(`    ${SERVICE_NAMES[id].padEnd(11)}→ ${where}`);
  }
  console.log(`    Settings DB → ${dbPath}\n`);
  if (!isConfigured('jellyfin')) console.log('  ! Jellyfin is not configured — open the app to set it up.\n');
  startMonitors();
  void startHostMetrics();
  startAutoImport();
  startCleanup();
  startSeerrWatch();
  startPlaybackRecorder();
  startStorageSampler();
});
