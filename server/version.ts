import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The release version, read from package.json (kept in sync by release-please).
 * Resolves from both `server/` (dev) and `dist-server/` (prod), which sit at the
 * same depth below the project root.
 */
function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const VERSION = process.env.STREAMFORGE_VERSION || readVersion();
