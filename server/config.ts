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

  JELLYFIN_URL: url,
  JELLYFIN_API_KEY: optionalString,

  SONARR_URL: optionalUrl,
  SONARR_API_KEY: optionalString,
  RADARR_URL: optionalUrl,
  RADARR_API_KEY: optionalString,
  PROWLARR_URL: optionalUrl,
  PROWLARR_API_KEY: optionalString,
  SEERR_URL: optionalUrl,
  SEERR_API_KEY: optionalString,

  INFINIDISK_URL: optionalUrl,
  INFINIDISK_API_KEY: optionalString,
  INFINIDISK_AUTH_HEADER: z.string().default('X-Api-Key'),
  INFINIDISK_STATUS_PATH: z.string().default('/api/status'),
  INFINIDISK_HEALTH_PATH: optionalString,
  INFINIDISK_MOUNTS: optionalString,

  HEALTH_INTERVAL_SECONDS: int(30, 5),
  DEGRADED_LATENCY_MS: int(1500, 50),
  REQUEST_TIMEOUT_MS: int(8000, 500),
  HOST_METRICS: bool(true),
  HOST_METRICS_INTERVAL_SECONDS: int(5, 1),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('\n✖ Invalid StreamForge configuration:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  • ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\nCopy .env.example to .env and fill in your values.\n');
  process.exit(1);
}

const env = parsed.data;

function pair(baseUrl?: string, apiKey?: string) {
  return baseUrl && apiKey ? { baseUrl, apiKey } : undefined;
}

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
  hostMetricsIntervalMs: env.HOST_METRICS_INTERVAL_SECONDS * 1000,

  jellyfin: { baseUrl: env.JELLYFIN_URL, apiKey: env.JELLYFIN_API_KEY },
  sonarr: pair(env.SONARR_URL, env.SONARR_API_KEY),
  radarr: pair(env.RADARR_URL, env.RADARR_API_KEY),
  prowlarr: pair(env.PROWLARR_URL, env.PROWLARR_API_KEY),
  seerr: pair(env.SEERR_URL, env.SEERR_API_KEY),
  infinidisk: {
    baseUrl: env.INFINIDISK_URL,
    apiKey: env.INFINIDISK_API_KEY,
    authHeader: env.INFINIDISK_AUTH_HEADER,
    statusPath: env.INFINIDISK_STATUS_PATH,
    healthPath: env.INFINIDISK_HEALTH_PATH,
    mounts: (env.INFINIDISK_MOUNTS ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
  },
} as const;

export type Config = typeof config;
