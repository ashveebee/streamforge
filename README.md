# StreamForge

A modern control centre for a Jellyfin media server and the services around it:
**Jellyfin, Sonarr, Radarr, Prowlarr, Seerr and Infinidisk**.

Built with React, Vite, TypeScript and Tailwind CSS, with a small Node/Express
backend that handles authentication and keeps every service credential on the
server.

## Features

- **Jellyfin sign-in.** Users sign in with their Jellyfin account. The server
  keeps the Jellyfin token, and the browser only holds an opaque HttpOnly session
  cookie. The user's profile and avatar come from Jellyfin.
- **Now playing.** Every active stream is shown with backdrop, poster, logo,
  title, season/episode, year, live progress, elapsed and remaining time, user,
  device and client. Each stream also shows direct play or transcode details:
  codecs, bitrate, hardware acceleration and transcode reasons.
- **Service integrations**
  - *Jellyfin:* server info, sessions, users, library statistics, recently added
    items, daily plays and the activity log.
  - *Sonarr:* series stats, missing episodes, queue, airing calendar and disk space.
  - *Radarr:* movie stats, missing movies, queue, cinema/digital/physical release
    dates, quality breakdown and disk space.
  - *Prowlarr:* health, query/grab/failure stats and response time for each
    indexer, plus connected apps.
  - *Seerr:* request counts by status, pending approvals and recent requests,
    with TMDB artwork.
  - *Infinidisk:* drives, capacity, usage, temperature and health.
- **System status.** A background monitor checks every service on an interval
  and records:
  - healthy, degraded or offline status;
  - response time and its history;
  - uptime over the recent checks;
  - the last successful check;
  - issues the service reports about itself.

  It also shows host CPU, RAM, network and filesystems, and computes download
  throughput.
- **Customisable dashboard.** Drag widgets to reorder them, resize them (⅓, ½, ⅔
  or full width), or hide them. The layout is saved per user on each device.
- **Real-time updates.** Each endpoint is polled at a cadence that suits its
  data. Playback progress advances every second between polls. The backend
  de-duplicates upstream calls across clients.

## Quick start

```bash
cp .env.example .env      # fill in URLs and API keys
npm install
npm run dev               # API on :4000, UI on :5173 (proxied)
```

Production:

```bash
npm run build
npm start                 # serves UI + API on :4000
```

Docker:

```bash
cp .env.example .env
docker compose -f docker-compose.example.yml up -d --build
```

Only `JELLYFIN_URL` is required. Any service without a URL and API key is shown
as *Not configured*, and its widgets are hidden.

## Architecture

```
browser ──(session cookie)──▶ StreamForge server ──(API keys / Jellyfin token)──▶ services
         /api/*                 server/                                     Jellyfin, *arr, Seerr, Infinidisk
```

```
server/
  index.ts            Express app, security headers, static hosting
  config.ts           zod-validated environment configuration
  auth.ts             Jellyfin login/logout, session middleware, CSRF guard
  routes.ts           /api routes and image proxies
  health.ts           health monitor and download-throughput sampler
  host.ts             host CPU / RAM / network / filesystem metrics
  services/           one module per integration (normalises upstream data)
  lib/                http client, TTL cache, session store
src/
  pages/              one page per route
  components/widgets  dashboard widgets and widget registry
  components/ui       design-system primitives (cards, gauges, states, charts)
  components/layout   shell, collapsible sidebar, headers
  hooks/              react-query hooks, auth context, persisted state
  lib/                API client, formatters, shared types
```

To add an integration:

1. Add a module in `server/services/`.
2. Register its probe in `server/health.ts`.
3. Expose a route in `server/routes.ts`.
4. Add a hook in `src/hooks/queries.ts`.
5. Add a widget to `src/components/widgets/registry.tsx`.

## Security

- API keys and service URLs live only in the server environment.
- Artwork is streamed through validated proxy routes, so the browser never
  contacts internal services. Item IDs, image types and cover filenames are
  checked against allow-lists to prevent SSRF.
- Session cookies are random 256-bit IDs, `HttpOnly` and `SameSite=Strict`.
  They are `Secure` when the request arrives over HTTPS.
- Jellyfin tokens are re-checked every 5 minutes. Revoking a device or demoting
  a user in Jellyfin ends their StreamForge session.
- State-changing requests require a custom header, which acts as CSRF
  protection. Login is rate-limited, and Helmet sets the CSP and other headers.
- Only Jellyfin administrators can sign in by default. Set `ALLOW_NON_ADMIN=true`
  to open access to other users.
- Sessions are held in memory, so restarting the server signs everyone out.

## Notes on data sources

- **Download speeds.** Sonarr and Radarr don't report a live speed, so
  StreamForge works it out from how much each queue item's remaining size drops
  between samples, taken every 5 seconds.
- **Playback activity chart.** This is built from Jellyfin's activity log
  (`VideoPlayback` and `AudioPlayback` entries). No plugin is needed.
- **CPU, RAM and network.** These figures come from the machine running the
  StreamForge server. Run it on the media server, with host networking in
  Docker, to see that server's figures.
- **Infinidisk.** The adapter in `server/services/infinidisk.ts` accepts either
  or both of these sources:
  - a JSON status endpoint (`INFINIDISK_URL` + `INFINIDISK_STATUS_PATH`). It reads
    the common response shapes: a `drives`, `disks`, `mounts`, `volumes` or
    `pools` array whose entries have size, used and free values in bytes, plus a
    health or status field;
  - local mount points, listed in `INFINIDISK_MOUNTS`, which it measures directly.

  If your Infinidisk API uses different field names, extend `normaliseRemote()`.
- **Self-signed TLS.** If a service uses a self-signed certificate, point
  `NODE_EXTRA_CA_CERTS` at your CA bundle.
