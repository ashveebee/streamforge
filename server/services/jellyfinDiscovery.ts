import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { buildUrl, requestJson } from '../lib/http.js';

/*
 * Jellyfin server discovery.
 *
 * Jellyfin answers a UDP broadcast of "Who is JellyfinServer?" on port 7359
 * with a small JSON document naming the server and its address. We send the
 * question to the global broadcast address and to every local network's own
 * broadcast address, collect answers for a moment, then confirm each server
 * over HTTP so we can show its version.
 *
 * Broadcasts don't leave the local network, and don't cross Docker's default
 * bridge network: in a container, discovery needs `network_mode: host`.
 */

const PORT = 7359;
const QUESTION = 'Who is JellyfinServer?';
const MAX_SERVERS = 32;

interface Reply {
  Address?: string;
  Id?: string;
  Name?: string;
  EndpointAddress?: string | null;
}

export interface DiscoveredServer {
  id: string;
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

function listen(timeoutMs: number): Promise<{ reply: Reply; from: string }[]> {
  return new Promise((resolve) => {
    const answers: { reply: Reply; from: string }[] = [];
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
      if (answers.length >= MAX_SERVERS || msg.length > 4096) return;
      try {
        const reply = JSON.parse(msg.toString('utf8')) as Reply;
        if (reply && typeof reply === 'object') answers.push({ reply, from: rinfo.address });
      } catch {
        /* not a Jellyfin answer */
      }
    });
    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
      } catch {
        finish();
        return;
      }
      const msg = Buffer.from(QUESTION);
      for (const addr of broadcastAddresses()) {
        // Unreachable networks are expected (e.g. a VPN interface); ignore them.
        socket.send(msg, PORT, addr, () => undefined);
      }
    });
  });
}

interface PublicInfo {
  ServerName?: string;
  Version?: string;
  Id?: string;
}

/**
 * Finds Jellyfin servers on the local network. Resolves within roughly
 * `timeoutMs` plus a few seconds to confirm each server.
 */
export async function discoverJellyfin(timeoutMs = 2500): Promise<DiscoveredServer[]> {
  const answers = await listen(timeoutMs);
  const byId = new Map<string, DiscoveredServer>();
  for (const { reply, from } of answers) {
    const id = typeof reply.Id === 'string' ? reply.Id.slice(0, 64) : undefined;
    // Prefer the advertised address; fall back to where the answer came from.
    const url = origin(reply.Address) ?? (from ? `http://${from}:8096` : undefined);
    if (!id || !url || byId.has(id)) continue;
    const name = typeof reply.Name === 'string' && reply.Name.trim() ? reply.Name.trim().slice(0, 80) : 'Jellyfin';
    byId.set(id, { id, name, url, from, reachable: false });
  }

  await Promise.all(
    [...byId.values()].map(async (s) => {
      const candidates = [s.url, `http://${s.from}:8096`].filter((u, i, a) => a.indexOf(u) === i);
      for (const url of candidates) {
        const info = await requestJson<PublicInfo>(buildUrl(url, '/System/Info/Public'), { service: 'jellyfin', timeoutMs: 3000 }).catch(
          () => undefined,
        );
        if (info?.Version) {
          Object.assign(s, { url, version: info.Version, reachable: true, name: info.ServerName?.trim() || s.name });
          return;
        }
      }
    }),
  );

  return [...byId.values()].sort((a, b) => Number(b.reachable) - Number(a.reachable) || a.name.localeCompare(b.name));
}
