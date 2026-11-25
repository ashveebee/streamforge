import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { buildUrl, requestJson } from '../lib/http.js';
import type { MediaServerType } from './mediaServers.js';

/*
 * Media server discovery on the local network.
 *
 * - Jellyfin answers a UDP broadcast of "Who is JellyfinServer?" on port 7359,
 *   and Emby answers "who is EmbyServer?" on the same port, each with a small
 *   JSON document naming the server and its address.
 * - Plex answers GDM: an "M-SEARCH" sent to port 32414 (multicast group
 *   239.0.0.250 and the broadcast addresses), with HTTP-style headers giving
 *   its name, port and identifier.
 *
 * We ask every local network at once, collect answers for a moment, then
 * confirm each server over HTTP so we can show its version and tell Jellyfin
 * and Emby apart (they share a port and answer format).
 *
 * Broadcasts don't leave the local network, and don't cross Docker's default
 * bridge network: in a container, discovery needs `network_mode: host`.
 */

const MB_PORT = 7359;
const MB_QUESTIONS = ['Who is JellyfinServer?', 'who is EmbyServer?'];
const GDM_PORT = 32414;
const GDM_GROUP = '239.0.0.250';
const GDM_QUESTION = 'M-SEARCH * HTTP/1.1\r\n\r\n';
const MAX_SERVERS = 32;

interface MbReply {
  Address?: string;
  Id?: string;
  Name?: string;
  EndpointAddress?: string | null;
}

export interface DiscoveredServer {
  id: string;
  type: MediaServerType;
  name: string;
  /** The address the server advertised, normalised to an origin. */
  url: string;
  /** Where the answer came from, in case the advertised address is unreachable. */
  from: string;
  version?: string;
  /** False when the server answered the broadcast but not over HTTP. */
  reachable: boolean;
}

/** Broadcast addresses for each IPv4 network this machine is on. */
function broadcastAddresses() {
  const out = new Set<string>(['255.255.255.255']);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const ip = a.address.split('.').map(Number);
      const mask = a.netmask.split('.').map(Number);
      if (ip.length !== 4 || mask.length !== 4) continue;
      out.add(ip.map((o, i) => (o | (~mask[i]! & 255)) & 255).join('.'));
    }
  }
  return [...out];
}

/** Turns an advertised address into a clean origin, or undefined if it isn't one. */
function origin(raw: string | undefined) {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    if (u.username || u.password) return undefined;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return undefined;
  }
}

/** Sends each question to `port` on every address, and collects raw answers until the timeout. */
function ask(questions: string[], port: number, addresses: string[], timeoutMs: number): Promise<{ msg: string; from: string }[]> {
  return new Promise((resolve) => {
    const answers: { msg: string; from: string }[] = [];
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve(answers);
    };
    const timer = setTimeout(finish, timeoutMs);

    socket.on('error', finish);
    socket.on('message', (msg, rinfo) => {
      if (answers.length >= MAX_SERVERS * 2 || msg.length > 4096) return;
      answers.push({ msg: msg.toString('utf8'), from: rinfo.address });
    });
    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
      } catch {
        finish();
        return;
      }
      for (const q of questions) {
        const msg = Buffer.from(q);
        // Unreachable networks are expected (e.g. a VPN interface); ignore them.
        for (const addr of addresses) socket.send(msg, port, addr, () => undefined);
      }
    });
  });
}

interface PublicInfo {
  ServerName?: string;
  Version?: string;
  Id?: string;
  ProductName?: string;
}

/** Jellyfin and Emby: answers to the 7359 broadcast, confirmed over HTTP. */
async function findMediaBrowser(timeoutMs: number): Promise<DiscoveredServer[]> {
  const answers = await ask(MB_QUESTIONS, MB_PORT, broadcastAddresses(), timeoutMs);
  const byId = new Map<string, DiscoveredServer>();
  for (const { msg, from } of answers) {
    let reply: MbReply;
    try {
      reply = JSON.parse(msg) as MbReply;
    } catch {
      continue;
    }
    if (!reply || typeof reply !== 'object') continue;
    const id = typeof reply.Id === 'string' ? reply.Id.slice(0, 64) : undefined;
    // Prefer the advertised address; fall back to where the answer came from.
    const url = origin(reply.Address) ?? (from ? `http://${from}:8096` : undefined);
    if (!id || !url || byId.has(id)) continue;
    // Only Jellyfin sends EndpointAddress; the HTTP check below settles it either way.
    const type: MediaServerType = 'EndpointAddress' in reply ? 'jellyfin' : 'emby';
    const name = typeof reply.Name === 'string' && reply.Name.trim() ? reply.Name.trim().slice(0, 80) : type === 'emby' ? 'Emby' : 'Jellyfin';
    byId.set(id, { id, type, name, url, from, reachable: false });
  }

  await Promise.all(
    [...byId.values()].map(async (s) => {
      const candidates = [s.url, `http://${s.from}:8096`].filter((u, i, a) => a.indexOf(u) === i);
      for (const url of candidates) {
        const info = await requestJson<PublicInfo>(buildUrl(url, '/System/Info/Public'), { service: 'jellyfin', timeoutMs: 3000 }).catch(
          () => undefined,
        );
        if (info?.Version) {
          const type: MediaServerType = info.ProductName?.toLowerCase().includes('jellyfin') ? 'jellyfin' : info.ProductName ? 'emby' : s.type;
          Object.assign(s, { url, type, version: info.Version, reachable: true, name: info.ServerName?.trim() || s.name });
          return;
        }
      }
    }),
  );
  return [...byId.values()];
}

/** Reads GDM's "Header: value" lines. */
function gdmHeaders(msg: string) {
  const out: Record<string, string> = {};
  for (const line of msg.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

/** Plex: answers to GDM, confirmed with `/identity` (which needs no token). */
async function findPlex(timeoutMs: number): Promise<DiscoveredServer[]> {
  const answers = await ask([GDM_QUESTION], GDM_PORT, [GDM_GROUP, ...broadcastAddresses()], timeoutMs);
  const byId = new Map<string, DiscoveredServer>();
  for (const { msg, from } of answers) {
    if (!/^HTTP\/1\.[01] 200/.test(msg)) continue;
    const h = gdmHeaders(msg);
    if (h['content-type'] && h['content-type'] !== 'plex/media-server') continue;
    const id = h['resource-identifier']?.slice(0, 64);
    const port = Number(h.port) || 32400;
    if (!id || byId.has(id) || port < 1 || port > 65535) continue;
    const name = h.name?.slice(0, 80) || 'Plex';
    byId.set(id, { id, type: 'plex', name, url: `http://${from}:${port}`, from, version: h.version?.slice(0, 40), reachable: false });
  }

  await Promise.all(
    [...byId.values()].map(async (s) => {
      const ident = await requestJson<{ MediaContainer?: { version?: string; machineIdentifier?: string } }>(buildUrl(s.url, '/identity'), {
        headers: { Accept: 'application/json' },
        service: 'jellyfin',
        timeoutMs: 3000,
      }).catch(() => undefined);
      if (ident?.MediaContainer?.machineIdentifier) Object.assign(s, { reachable: true, version: ident.MediaContainer.version ?? s.version });
    }),
  );
  return [...byId.values()];
}

/**
 * Finds Jellyfin, Emby and Plex servers on the local network. Resolves within
 * roughly `timeoutMs` plus a few seconds to confirm each server.
 */
export async function discoverMediaServers(timeoutMs = 2500): Promise<DiscoveredServer[]> {
  const [mb, px] = await Promise.all([findMediaBrowser(timeoutMs), findPlex(timeoutMs)]);
  return [...mb, ...px]
    .slice(0, MAX_SERVERS)
    .sort((a, b) => Number(b.reachable) - Number(a.reachable) || a.name.localeCompare(b.name));
}
