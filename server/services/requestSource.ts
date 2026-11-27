import { isConfigured } from '../settings.js';
import { mainSilo } from './mainServer.js';
import * as silo from './silo.js';

/*
 * Where requests go. Silo has its own request system; when Silo is the media
 * server and its requests are switched on, StreamForge's request features
 * (the Requests page, Request buttons, search, approvals, your requests and
 * new-request alerts) use it. Otherwise they use Seerr, when it's connected.
 */

export type RequestSource = 'seerr' | 'silo' | undefined;

let last: RequestSource;

export async function requestSource(): Promise<RequestSource> {
  const si = mainSilo();
  if (si && (await silo.requestsEnabled(si).catch(() => false))) return (last = 'silo');
  return (last = isConfigured('seerr') ? 'seerr' : undefined);
}

/** The last known source, for synchronous callers (the app config); refreshed by every check. */
export const knownRequestSource = (): RequestSource => last ?? (isConfigured('seerr') ? 'seerr' : undefined);

/** The Silo server when Silo's own requests are in use. */
export async function siloRequests() {
  return (await requestSource()) === 'silo' ? mainSilo() : undefined;
}
