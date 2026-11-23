import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { readPref, writePref } from './lib/db.js';

/*
 * What non-admin Jellyfin users ("members") can see.
 *
 * Admins see everything. Members can only sign in when allowed (the
 * ALLOW_NON_ADMIN environment variable is the default), and then only see
 * the areas an admin picked. Areas are enforced on the API — not just
 * hidden in the UI — and every action (approving, removing, stopping, …)
 * is admin-only regardless.
 */

export const AREAS = ['now-playing', 'stats', 'library', 'system', 'jellyfin', 'sonarr', 'radarr', 'prowlarr', 'seerr', 'infinidisk'] as const;
export type Area = (typeof AREAS)[number];

interface MemberAccess {
  signIn: boolean;
  areas: Area[];
}

const DEFAULT_AREAS: Area[] = ['now-playing', 'jellyfin', 'seerr', 'stats'];

let access: MemberAccess = {
  signIn: config.allowNonAdmin,
  areas: DEFAULT_AREAS,
  ...readPref<Partial<MemberAccess>>('memberAccess', {}),
};

export const memberAccess = () => access;
export const membersCanSignIn = () => access.signIn;

export function setMemberAccess(patch: Partial<MemberAccess>) {
  access = { ...access, ...patch, areas: (patch.areas ?? access.areas).filter((a) => (AREAS as readonly string[]).includes(a)) };
  writePref('memberAccess', access);
  return access;
}

/** The areas a request's user may see, or null for "everything" (admins). */
export function allowedAreas(req: Request): Set<Area> | null {
  return req.session?.isAdmin ? null : new Set(access.areas);
}

export function canSee(req: Request, area: Area) {
  const allowed = allowedAreas(req);
  return !allowed || allowed.has(area);
}

/** API path (below /api) → the areas that use it. Unlisted paths are open to any signed-in user. */
function areasFor(path: string): Area[] | undefined {
  if (path.startsWith('/jellyfin/image/')) return undefined;
  if (path.startsWith('/jellyfin/now-playing')) return ['now-playing'];
  if (path.startsWith('/jellyfin/stats')) return ['stats'];
  if (path.startsWith('/jellyfin/')) return ['jellyfin'];
  if (path.startsWith('/library/')) return ['library'];
  if (path.startsWith('/system/') || path.startsWith('/downloads') || path.startsWith('/storage/')) return ['system'];
  for (const a of ['sonarr', 'radarr', 'prowlarr', 'seerr', 'infinidisk'] as const) if (path.startsWith(`/${a}/`)) return [a];
  return undefined;
}

/** Blocks members from areas they haven't been given. Use after requireAuth. */
export function requireArea(req: Request, res: Response, next: NextFunction) {
  const allowed = allowedAreas(req);
  const areas = allowed ? areasFor(req.path) : undefined;
  if (allowed && areas && !areas.some((a) => allowed.has(a))) {
    res.status(403).json({ error: 'forbidden', message: 'This page isn’t available to your account.' });
    return;
  }
  next();
}
