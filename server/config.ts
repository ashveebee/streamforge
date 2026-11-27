import { z } from 'zod';

/** Strips trailing slashes so paths can be appended safely. */
const url = z
  .string()
  .trim()
  .url()
  .transform((v) => v.replace(/\/+$/, ''));

const optionalUrl = z.preprocess((v) => (v === '' ? undefined : v), url.optional());
const optionalString = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().trim().optional(),
);
const bool = (def: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === '') return def;
    return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
  }, z.boolean());
const int = (def: number, min = 0) =>
  z.preprocess((v) => (v === undefined || v === '' ? def : Number(v)), z.number().int().min(min));

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: int(4000, 1),
  HOST: z.string().default('0.0.0.0'),
  TRUST_PROXY: optionalString,
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  SESSION_TTL_HOURS: int(12, 1),
  ALLOW_NON_ADMIN: bool(false),

  DATA_DIR: z.string().default('./data'),

  // Service settings below are optional fallbacks: anything saved from the
  // Settings page (stored in SQLite under DATA_DIR) takes precedence.
  JELLYFIN_URL: optionalUrl,
  JELLYFIN_PUBLIC_URL: optionalUrl,
  JELLYFIN_API_KEY: optionalString,

  SONARR_URL: optionalUrl,
  SONARR_PUBLIC_URL: optionalUrl,
  SONARR_API_KEY: optionalString,
  RADARR_URL: optionalUrl,
  RADARR_PUBLIC_URL: optionalUrl,
  RADARR_API_KEY: optionalString,
  PROWLARR_URL: optionalUrl,
  PROWLARR_PUBLIC_URL: optionalUrl,
  PROWLARR_API_KEY: optionalString,
  SEERR_URL: optionalUrl,
  SEERR_PUBLIC_URL: optionalUrl,
  SEERR_API_KEY: optionalString,
  BAZARR_URL: optionalUrl,
  BAZARR_PUBLIC_URL: optionalUrl,
  BAZARR_API_KEY: optionalString,
  AUDIOBOOKSHELF_URL: optionalUrl,
  AUDIOBOOKSHELF_PUBLIC_URL: optionalUrl,
  AUDIOBOOKSHELF_API_KEY: optionalString,
  LIDARR_URL: optionalUrl,
  LIDARR_PUBLIC_URL: optionalUrl,
  LIDARR_API_KEY: optionalString,
  READARR_URL: optionalUrl,
  READARR_PUBLIC_URL: optionalUrl,
  READARR_API_KEY: optionalString,

  INFINIDISK_URL: optionalUrl,
  INFINIDISK_PUBLIC_URL: optionalUrl,
  INFINIDISK_API_KEY: optionalString,
  INFINIDISK_AUTH_HEADER: z.string().default('X-Api-Key'),
  INFINIDISK_STATUS_PATH: z.string().default('/api/status'),
  INFINIDISK_HEALTH_PATH: optionalString,
  INFINIDISK_MOUNTS: optionalString,

  HEALTH_INTERVAL_SECONDS: int(30, 5),
  DEGRADED_LATENCY_MS: int(1500, 50),
  REQUEST_TIMEOUT_MS: int(8000, 500),
  HOST_METRICS: bool(true),
  // Ask GitHub every 6 hours whether a newer StreamForge release exists.
  UPDATE_CHECK: bool(true),
  HOST_METRICS_INTERVAL_SECONDS: int(5, 1),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('\n✖ Invalid StreamForge configuration:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  • ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\nCheck your environment variables (see .env.example).\n');
  process.exit(1);
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  port: env.PORT,
  host: env.HOST,
  trustProxy: env.TRUST_PROXY,
  cookieSecure: env.COOKIE_SECURE,
  sessionTtlMs: env.SESSION_TTL_HOURS * 3600_000,
  allowNonAdmin: env.ALLOW_NON_ADMIN,
  requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
  healthIntervalMs: env.HEALTH_INTERVAL_SECONDS * 1000,
  degradedLatencyMs: env.DEGRADED_LATENCY_MS,
  hostMetrics: env.HOST_METRICS,
  updateCheck: env.UPDATE_CHECK,
  hostMetricsIntervalMs: env.HOST_METRICS_INTERVAL_SECONDS * 1000,

  dataDir: env.DATA_DIR,

  /** Service settings from the environment — fallbacks for server/settings.ts. */
  envServices: {
    jellyfin: { url: env.JELLYFIN_URL, publicUrl: env.JELLYFIN_PUBLIC_URL, apiKey: env.JELLYFIN_API_KEY },
    sonarr: { url: env.SONARR_URL, publicUrl: env.SONARR_PUBLIC_URL, apiKey: env.SONARR_API_KEY },
    radarr: { url: env.RADARR_URL, publicUrl: env.RADARR_PUBLIC_URL, apiKey: env.RADARR_API_KEY },
    prowlarr: { url: env.PROWLARR_URL, publicUrl: env.PROWLARR_PUBLIC_URL, apiKey: env.PROWLARR_API_KEY },
    seerr: { url: env.SEERR_URL, publicUrl: env.SEERR_PUBLIC_URL, apiKey: env.SEERR_API_KEY },
    bazarr: { url: env.BAZARR_URL, publicUrl: env.BAZARR_PUBLIC_URL, apiKey: env.BAZARR_API_KEY },
    lidarr: { url: env.LIDARR_URL, publicUrl: env.LIDARR_PUBLIC_URL, apiKey: env.LIDARR_API_KEY },
    readarr: { url: env.READARR_URL, publicUrl: env.READARR_PUBLIC_URL, apiKey: env.READARR_API_KEY },
    audiobookshelf: { url: env.AUDIOBOOKSHELF_URL, publicUrl: env.AUDIOBOOKSHELF_PUBLIC_URL, apiKey: env.AUDIOBOOKSHELF_API_KEY },
    infinidisk: {
      url: env.INFINIDISK_URL,
      publicUrl: env.INFINIDISK_PUBLIC_URL,
      apiKey: env.INFINIDISK_API_KEY,
      authHeader: env.INFINIDISK_AUTH_HEADER,
      statusPath: env.INFINIDISK_STATUS_PATH,
      healthPath: env.INFINIDISK_HEALTH_PATH,
      mounts: (env.INFINIDISK_MOUNTS ?? '')
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
    },
  },
} as const;

export type Config = typeof config;
