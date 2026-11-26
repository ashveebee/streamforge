import { cache } from '../lib/cache.js';
import { readPref, writePref } from '../lib/db.js';
import { HttpError } from '../lib/handle.js';
import { isConfigured } from '../settings.js';
import { jf, remote, serverToken, type JfCtx } from './jellyfin.js';
import { allLibraryItems, idKeys, mainExtra, type LibraryServer } from './mainServer.js';
import { mediaServer, mediaServers } from './mediaServers.js';
import * as plex from './plex.js';

/*
 * Who's watched what, per media server, and which account on each server is
 * "you". People often have a different name on each server (Plex "ashveebee",
 * Jellyfin "admin"), so accounts can be linked; without a link, a server
 * account with the same name as you counts.
 */

export interface Viewer {
  id: string;
  name: string;
}

/** The person signed in to StreamForge. */
export interface Me {
  userId: string;
  userName: string;
  isAdmin: boolean;
}

type Links = Record<string, Record<string, Viewer>>;
const LINKS = 'accountLinks';

const linksOf = (userId: string) => readPref<Links>(LINKS, {})[userId] ?? {};

/** Links (or, with no account, unlinks) your account on one server. */
export async function setLink(ctx: JfCtx, me: Me, serverId: string, accountId: string | null) {
  const srv = mediaServer(serverId);
  if (!srv || srv.id === mainExtra()?.id) throw new HttpError(404, 'Unknown media server', 'not_found');
  const all = readPref<Links>(LINKS, {});
  const mine = { ...(all[me.userId] ?? {}) };
  if (accountId === null) delete mine[serverId];
  else {
    const account = (await serverUsers(ctx, serverId)).find((u) => u.id === accountId);
    if (!account) throw new HttpError(400, 'That account isn’t on this server', 'invalid');
    mine[serverId] = account;
  }
  writePref(LINKS, { ...all, [me.userId]: mine });
}

/** Accounts on a server ("jellyfin" is the main Jellyfin server). */
export async function serverUsers(ctx: JfCtx, serverId: string): Promise<Viewer[]> {
  return cache.get(`watch:users:${serverId}`, 5 * 60_000, async () => {
    type U = { Id: string; Name: string; Policy?: { IsDisabled?: boolean } };
    const live = (us: U[]) => us.filter((u) => !u.Policy?.IsDisabled).map((u) => ({ id: u.Id, name: u.Name }));
    if (serverId === 'jellyfin') return isConfigured('jellyfin') ? live(await jf<U[]>('/Users', serverToken(ctx), ctx.deviceId)) : [];
    const srv = mediaServer(serverId);
    if (!srv) return [];
    return srv.type === 'plex' ? plex.accountList(srv) : live(await remote<U[]>(srv, '/Users'));
  });
}

/** Your account ids on a server: who you signed in as on the main one, else a link or a name match. */
export async function myIdsOn(ctx: JfCtx, me: Me, server: Pick<LibraryServer, 'id' | 'type' | 'main'>) {
  if (server.main) {
    // A Plex server's owner is account 1 in its own history.
    return new Set(server.type === 'plex' && me.isAdmin ? [me.userId, '1'] : [me.userId]);
  }
  const link = linksOf(me.userId)[server.id];
  if (link) return new Set([link.id]);
  const same = (await serverUsers(ctx, server.id).catch(() => [])).find((u) => u.name.trim().toLowerCase() === me.userName.trim().toLowerCase());
  return new Set(same ? [same.id] : []);
}

/** Every server other than the main one, with your linked (or name-matched) account there. */
export async function myAccounts(ctx: JfCtx, me: Me) {
  const main = mainExtra();
  const links = linksOf(me.userId);
  return Promise.all(
    mediaServers()
      .filter((s) => s.id !== main?.id)
      .map(async (s) => {
        const users = await serverUsers(ctx, s.id).catch(() => undefined);
        const linked = links[s.id];
        const matched = linked ? undefined : users?.find((u) => u.name.trim().toLowerCase() === me.userName.trim().toLowerCase());
        return {
          server: s.id,
          name: s.name,
          type: s.type,
          linked,
          matched,
          // Only admins pick from a server's accounts.
          users: me.isAdmin ? users : undefined,
          reachable: !!users,
        };
      }),
  );
}

/** One server's watch state for one episode. */
export interface EpisodeWatch {
  server: string;
  type: 'jellyfin' | 'plex' | 'emby';
  name: string;
  /** You've watched it on this server. */
  me: boolean;
  /** Your progress when you've started but not finished it. */
  progress?: number;
  /** How many other people have watched it there. */
  others: number;
  /** Their names (admins only). */
  otherNames?: string[];
}

/**
 * Per-episode watch state on every server that has the show, for one season.
 * Admins see everyone; members only see their own.
 */
export async function seasonWatch(ctx: JfCtx, me: Me, ids: { tmdb: number; tvdb?: number }, season: number) {
  const lib = await allLibraryItems(ctx);
  const wanted = new Set(idKeys(ids));
  const copies = lib.items
    .filter((i) => i.type === 'Series' && idKeys(i).some((k) => wanted.has(k)))
    .filter((i, n, all) => all.findIndex((x) => x.server.id === i.server.id) === n);
  const out = new Map<number, EpisodeWatch[]>();
  await Promise.all(
    copies.map(async (copy) => {
      const server = copy.server;
      const [mine, users] = await Promise.all([myIdsOn(ctx, me, server), serverUsers(ctx, server.id).catch(() => [] as Viewer[])]);
      const names = new Map(users.map((u) => [u.id, u.name]));
      if (server.type === 'plex') names.set('1', names.get('1') ?? 'Owner');
      // episode → who watched it, and your progress
      let perEpisode: Map<number, { watched: Set<string>; progress?: number }>;
      if (server.type === 'plex') {
        const srv = mediaServer(server.id);
        if (!srv) return;
        const w = await plex.seasonWatch(srv, copy.id, season);
        perEpisode = new Map([...w].map(([n, x]) => [n, { watched: x.accounts, progress: mine.has('1') ? x.ownerProgress : undefined }]));
      } else {
        // Jellyfin and Emby keep watched state per user: ask for each person who should count.
        const people = me.isAdmin ? users.slice(0, 25).map((u) => u.id) : [...mine];
        const srv = server.id === 'jellyfin' ? undefined : mediaServer(server.id);
        if (server.id !== 'jellyfin' && !srv) return;
        type Ep = { IndexNumber?: number; UserData?: { Played?: boolean; PlayedPercentage?: number } };
        const lists = await Promise.all(
          people.map((userId) => {
            const query = { userId, season, EnableImages: false, Fields: 'UserData' };
            const get = srv ? remote<{ Items: Ep[] }>(srv, `/Shows/${copy.id}/Episodes`, query) : jf<{ Items: Ep[] }>(`/Shows/${copy.id}/Episodes`, serverToken(ctx), ctx.deviceId, query);
            return cache
              .get(`watch:${server.id}:${copy.id}:${season}:${userId}`, 60_000, () => get)
              .then((r) => ({ userId, items: r.Items ?? [] }))
              .catch(() => ({ userId, items: [] as Ep[] }));
          }),
        );
        perEpisode = new Map();
        for (const { userId, items } of lists) {
          for (const e of items) {
            if (e.IndexNumber === undefined) continue;
            const x = perEpisode.get(e.IndexNumber) ?? perEpisode.set(e.IndexNumber, { watched: new Set() }).get(e.IndexNumber)!;
            if (e.UserData?.Played) x.watched.add(userId);
            else if (mine.has(userId) && e.UserData?.PlayedPercentage) x.progress = Math.round(e.UserData.PlayedPercentage);
          }
        }
      }
      for (const [n, x] of perEpisode) {
        const meWatched = [...x.watched].some((id) => mine.has(id));
        const others = [...x.watched].filter((id) => !mine.has(id));
        const visibleOthers = me.isAdmin ? others : [];
        if (!meWatched && !visibleOthers.length && !x.progress) continue;
        const list = out.get(n) ?? out.set(n, []).get(n)!;
        list.push({
          server: server.id,
          type: server.type,
          name: server.name,
          me: meWatched,
          progress: meWatched ? undefined : x.progress,
          others: visibleOthers.length,
          otherNames: me.isAdmin ? [...new Set(visibleOthers.map((id) => names.get(id) ?? 'Someone'))] : undefined,
        });
      }
    }),
  );
  // Main server first, then by name, so the ticks are always in the same order.
  const order = new Map(lib.servers.map((s, i) => [s.id, i]));
  for (const list of out.values()) list.sort((a, b) => (order.get(a.server) ?? 99) - (order.get(b.server) ?? 99));
  return out;
}
