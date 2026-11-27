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
import { startClientSampler } from './services/clients/index.js';
import { startPlaybackGuard } from './services/playbackGuard.js';
import { hooksRouter } from './hooks.js';
import { startDigest } from './services/digest.js';
import { startRules } from './services/rules.js';
import { startDiagnosisRecorder } from './services/diagnosis/index.js';
import { startUpdateCheck } from './services/updates.js';
import { resetByName } from './services/mfa.js';
import { VERSION } from './version.js';
import { dbPath } from './lib/db.js';
import { resolve, SERVICE_IDS, SERVICE_NAMES } from './settings.js';
import { mainExtra, mediaReady } from './services/mainServer.js';
import { MEDIA_SERVER_NAMES } from './services/mediaServers.js';

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
// Backups can be large (they may include play history); everything else is small.
const smallJson = express.json({ limit: '32kb' });
const largeJson = express.json({ limit: '50mb' });
// Kometa webhooks parse their own (possibly large) bodies, after the address is checked.
app.use((req, res, next) => (req.path.startsWith('/api/hooks/') ? next() : (req.path === '/api/settings/backup/restore' ? largeJson : smallJson)(req, res, next)));

app.get('/healthz', (_req, res) => res.json({ ok: true, version: VERSION }));
// Webhooks from Kometa: no session or CSRF header (Kometa can't send one); the address's token is the credential.
app.use('/api/hooks', hooksRouter);
app.use('/api', requireCsrfHeader);
app.use('/api/auth', authRouter);
app.use('/api', api);
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

// In production the backend also serves the built frontend.
const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '..', 'dist');
if (existsSync(webDist)) {
  // The service worker and manifest must always be revalidated, or updates never arrive.
  app.get(['/sw.js', '/manifest.webmanifest'], (req, res, next) => {
    res.set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
    if (req.path.endsWith('.webmanifest')) res.type('application/manifest+json');
    next();
  });
  app.use(
    express.static(webDist, {
      index: false,
      setHeaders: (res, file) => {
        // Only Vite's hashed bundles are safe to cache forever.
        res.set('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );
  // A missing bundle (e.g. an old tab after an upgrade) must be a 404, not the
  // app shell: browsers and the service worker would otherwise keep HTML under
  // a .js name and the page would never load again without a hard refresh.
  app.use(['/assets', '/icons'], (_req, res) => res.status(404).set('Cache-Control', 'no-store').end());
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.set('Cache-Control', 'no-cache').sendFile(path.join(webDist, 'index.html'));
  });
}

app.listen(config.port, config.host, () => {
  console.log(`\n  ▲ StreamForge v${VERSION} listening on http://${config.host}:${config.port}`);
  // The media server first: Jellyfin from its settings, or the Plex/Emby server chosen at setup.
  const extra = mainExtra();
  if (extra) console.log(`    ${MEDIA_SERVER_NAMES[extra.type].padEnd(11)}→ ${extra.url}  [media server]`);
  for (const id of SERVICE_IDS) {
    if (id === 'jellyfin' && extra) continue;
    const r = resolve(id);
    const s = r.settings;
    const target = [s.url, ...(s.mounts ?? [])].filter(Boolean).join(' + ');
    const where = r.source === 'none' ? '(not configured)' : `${target}  [${r.source}]`;
    console.log(`    ${SERVICE_NAMES[id].padEnd(11)}→ ${where}`);
  }
  console.log(`    Settings DB → ${dbPath}\n`);
  if (process.env.STREAMFORGE_RESET_2FA) {
    const n = resetByName(process.env.STREAMFORGE_RESET_2FA);
    console.log(`  ! Two-factor sign-in reset for ${n} account(s) named "${process.env.STREAMFORGE_RESET_2FA}". Remove STREAMFORGE_RESET_2FA now.\n`);
  }
  if (!mediaReady()) console.log('  ! No media server yet — open the app to choose Jellyfin, Plex or Emby.\n');
  startMonitors();
  void startHostMetrics();
  startAutoImport();
  startCleanup();
  startSeerrWatch();
  startPlaybackRecorder();
  startStorageSampler();
  startClientSampler();
  startPlaybackGuard();
  startDigest();
  startRules();
  startDiagnosisRecorder();
  startUpdateCheck();
});
