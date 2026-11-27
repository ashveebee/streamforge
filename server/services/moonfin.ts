import { readPref, writePref } from '../lib/db.js';
import { cache } from '../lib/cache.js';
import { UpstreamError } from '../lib/http.js';
import { publicUrl } from '../settings.js';
import { jf, type JfCtx } from './jellyfin.js';
import { notJellyfinMain } from './mainServer.js';

/*
 * Moonfin (https://github.com/Moonfin-Client) is a Jellyfin client. Its
 * server plugin serves the Moonfin web app at <jellyfin>/Moonfin/Web/ and the
 * apps register moonfin:// links. When it's switched on, StreamForge offers
 * to open titles in Moonfin instead of Jellyfin's own web client.
 */

export type MoonfinTarget = 'web' | 'app';

export interface MoonfinSettings {
  enabled: boolean;
  /** Where "Play in Moonfin" opens by default: the web app or the installed app. */
  openIn: MoonfinTarget;
}

const PREF = 'moonfin';
const DEFAULTS: MoonfinSettings = { enabled: false, openIn: 'web' };

let settings: MoonfinSettings = { ...DEFAULTS, ...readPref<Partial<MoonfinSettings>>(PREF, {}) };

export const moonfinSettings = () => settings;

export function saveMoonfin(patch: Partial<MoonfinSettings>) {
  settings = { ...settings, ...patch };
  writePref(PREF, settings);
  cache.delete('moonfin:');
  return settings;
}

/** The Moonfin web app on the Jellyfin server people open in their browser. */
export function moonfinWebUrl() {
  const base = publicUrl('jellyfin');
  return base ? `${base}/Moonfin/Web/` : undefined;
}

/** What the browser needs to build Moonfin links; undefined when switched off. */
export function moonfinClientConfig() {
  // Moonfin is a Jellyfin plugin: nothing to open when Plex is the sign-in server.
  if (!settings.enabled || notJellyfinMain()) return undefined;
  return { openIn: settings.openIn, web: moonfinWebUrl() };
}

/**
 * Whether the Moonfin plugin is installed on the Jellyfin server, via its
 * authenticated GET /Moonfin/Ping. A 404 means it isn't installed.
 */
export async function moonfinStatus(ctx: JfCtx) {
  return cache.get(`moonfin:status:${ctx.userId}`, 60_000, async () => {
    try {
      const r = await jf<Record<string, unknown> | null>('/Moonfin/Ping', ctx.token, ctx.deviceId);
      const v = r?.version ?? r?.Version ?? r?.pluginVersion;
      return { installed: true, version: typeof v === 'string' || typeof v === 'number' ? String(v) : undefined };
    } catch (err) {
      if (err instanceof UpstreamError && err.status === 404) return { installed: false };
      return { installed: false, error: (err as Error).message };
    }
  });
}
