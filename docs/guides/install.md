# Install and configure StreamForge

This guide takes you from nothing to a working StreamForge: the container,
your media server, your other services, and getting to it from outside your
home. It takes about 15 minutes.

**You need:** Docker (with Compose), and a Jellyfin, Plex or Emby server that
the machine running StreamForge can reach.

- [1. Start the container](#1-start-the-container)
- [2. First run, step 1: choose your media server](#2-first-run-step-1-choose-your-media-server)
- [3. First run, step 2: set up your apps](#3-first-run-step-2-set-up-your-apps)
- [4. Docker networking: which address to use](#4-docker-networking-which-address-to-use)
- [5. Reach it from outside: reverse proxy or Tailscale](#5-reach-it-from-outside-reverse-proxy-or-tailscale)
- [6. Who can sign in](#6-who-can-sign-in)
- [7. Updating, backups and environment variables](#7-updating-backups-and-environment-variables)
- [Troubleshooting](#troubleshooting)

## 1. Start the container

Create a folder, save this as `docker-compose.yml` in it, and adjust the
commented lines you need:

```yaml
services:
  streamforge:
    image: ghcr.io/ashveebee/streamforge:latest
    container_name: streamforge
    ports:
      - "4000:4000"
    volumes:
      # Settings (SQLite). Keep this so they survive upgrades.
      - streamforge-data:/data
      # Optional: Kometa's config folder, read-write, to make collections
      # from StreamForge. See docs/guides/kometa.md.
      # - /opt/kometa/config:/kometa
      # Optional: storage to measure (Infinidisk → Advanced → Local mount paths).
      # - /mnt/media:/mnt/media:ro
    environment:
      # Set this when StreamForge is behind a reverse proxy (step 5).
      # - TRUST_PROXY=1
      - TZ=Europe/London
    restart: unless-stopped

volumes:
  streamforge-data:
```

Start it:

```bash
docker compose up -d
```

Open **http://your-server-ip:4000**. If the page doesn't load, check the logs
with `docker logs streamforge`; the startup banner lists every service and
where its settings come from.

> **Tip:** if your media server and *arr apps already run in Docker Compose,
> add StreamForge to the same file (or the same Docker network). Then it can
> reach them by container name, such as `http://sonarr:8989`.

## 2. First run, step 1: choose your media server

On first launch StreamForge asks which media server you use: Jellyfin, Plex
or Emby. People sign in to StreamForge with their account on it, and admins on
it are admins in StreamForge.

Each install watches **one** media server and sticks with it; you can change
its address later, but not swap it for another. Running two media servers?
Run a StreamForge for each (see the
[media servers guide](media-servers.md#running-more-than-one-media-server)).

### Jellyfin

1. Choose **Jellyfin**.
2. Enter the server address, for example `http://192.168.1.10:8096`, or click
   **Find servers on my network** and pick it.
3. Sign in with a **Jellyfin administrator** account.

Then add a Jellyfin API key (Jellyfin → Dashboard → API Keys → **+**) under
**Settings → Services → Jellyfin**. It's optional but recommended: it lets
StreamForge record plays in the background, read server-wide stats and every
user's watch history, and warn you about pending restarts.

### Plex

1. Choose **Plex** and click **Sign in with Plex**.
2. A plex.tv window opens. Approve it with the **account that owns your Plex
   server**.
3. Pick the server. StreamForge finds its address itself, preferring the local
   one.

StreamForge never sees your Plex password. The machine running StreamForge
needs to reach `plex.tv` (for sign-in) and your Plex server.

### Emby

1. Choose **Emby**.
2. Enter the server address (or find it on the network).
3. Sign in with an **Emby administrator** account. StreamForge creates its own
   API key on the server for background features.

## 3. First run, step 2: set up your apps

<a id="step-2-set-up-your-apps"></a>

After you sign in for the first time, StreamForge opens **Set up your apps**
and starts looking for Sonarr, Radarr, Seerr, Prowlarr, Bazarr, Lidarr and
Readarr. It checks:

- **Docker service names** on their usual ports, such as `http://sonarr:8989`,
  when StreamForge runs in the same Compose project;
- **this machine, the Docker host and your media server's machine** on those
  ports;
- **subdomains next to your media server's**, such as
  `https://sonarr.example.com` when Jellyfin is at `jellyfin.example.com`.

Each app it finds has its address filled in: paste the API key and click
**Test and connect**. Apps it doesn't find can be added by address.

**Already use Seerr or Prowlarr?** Connect it first. Seerr knows your Sonarr
and Radarr, and Prowlarr knows all its apps, so StreamForge offers to connect
those with the same address and key, testing each one. The keys are copied on
the server and never shown in your browser.

Skip any app you don't use, then click **Finish setup**. You can come back
later from the link at the bottom of **Settings → Services**, or connect apps
there directly: enter the address and API key, click **Test connection**, then
**Save**. Changes apply straight away, with no restart. Switch off the ones
you don't use and they disappear from the sidebar.

| Service | Where to find the API key |
| --- | --- |
| Sonarr, Radarr, Lidarr, Readarr, Prowlarr | Settings → General → Security → API Key |
| Bazarr | Settings → General → Security → API Key |
| Seerr (Overseerr / Jellyseerr) | Settings → General → API Key |
| qBittorrent, Transmission, NZBGet | Your web UI username and password (**Settings → Download clients**) |
| SABnzbd | Config → General → API Key (**Settings → Download clients**) |
| Infinidisk | Your Infinidisk settings (optional if its status endpoint is public) |

**More than one Sonarr or Radarr?** (a 4K Radarr, an anime Sonarr) Add the
extra ones under the main Sonarr or Radarr card. See the
[Sonarr and Radarr guide](sonarr-radarr.md).

**Public addresses.** StreamForge often reaches services on internal addresses
such as `http://sonarr:8989`, which won't work from your phone. Set **Public
address** on a service (for example `https://sonarr.example.com`) and links
such as **Open in Sonarr** and **Play in Jellyfin** use it.

## 4. Docker networking: which address to use

Addresses are resolved from **inside the StreamForge container**, so
`localhost` means the container itself, not your server.

| Where the service runs | Address to use |
| --- | --- |
| Same Docker network as StreamForge | The container name: `http://sonarr:8989` |
| Same machine, not in the same network | Your server's LAN IP: `http://192.168.1.10:8989` |
| Same machine, Docker Desktop | `http://host.docker.internal:8989` |
| Same machine, Linux, want the host name | Add `extra_hosts: ["host.docker.internal:host-gateway"]` to StreamForge, then `http://host.docker.internal:8989` |
| Another machine | Its LAN IP or domain name |

To check an address from inside the container:

```bash
docker exec streamforge wget -qO- http://sonarr:8989/ping
```

**Find on network** (for Jellyfin, Emby and Plex) uses UDP broadcasts, which
don't cross Docker's bridge network. Use `network_mode: host` if you want it,
or just type the address.

## 5. Reach it from outside: reverse proxy or Tailscale

StreamForge works fine at `http://ip:4000` at home. To use it from anywhere,
put it behind a reverse proxy with HTTPS, or reach it over Tailscale.

**Whichever you use, behind a proxy set `TRUST_PROXY`**, so StreamForge sees
the real client address and knows the request arrived over HTTPS (which marks
the sign-in cookie Secure):

```yaml
    environment:
      - TRUST_PROXY=1   # one proxy in front of StreamForge
```

`1` means "trust one proxy hop". Use `2` if there are two (Cloudflare in front
of your proxy, say). HTTPS also lets you install StreamForge as an app and get
browser push notifications.

### Nginx Proxy Manager

1. **Hosts → Proxy Hosts → Add Proxy Host.**
2. **Domain:** `streamforge.example.com`. **Scheme:** `http`. **Forward
   hostname/IP:** `streamforge` (if NPM shares a Docker network with it) or
   the server's LAN IP. **Port:** `4000`.
3. Turn on **Websockets Support** and **Block Common Exploits**.
4. **SSL** tab: request a certificate, and turn on **Force SSL** and **HTTP/2**.
5. Set `TRUST_PROXY=1` on StreamForge and run `docker compose up -d`.

### Caddy

```caddy
streamforge.example.com {
    reverse_proxy streamforge:4000
}
```

### Traefik

```yaml
    labels:
      - traefik.enable=true
      - traefik.http.routers.streamforge.rule=Host(`streamforge.example.com`)
      - traefik.http.routers.streamforge.entrypoints=websecure
      - traefik.http.routers.streamforge.tls.certresolver=letsencrypt
      - traefik.http.services.streamforge.loadbalancer.server.port=4000
```

### Tailscale

With Tailscale on the server, open `http://<tailnet-ip>:4000` or
`http://<machine-name>:4000` from any device on your tailnet. No proxy is
needed, so leave `TRUST_PROXY` unset. If you put a proxy on your tailnet in
front of StreamForge (for a nicer name or HTTPS through `tailscale serve`),
set `TRUST_PROXY=1`.

## 6. Who can sign in

By default only **admins** on your main media server can sign in. To let
everyone else in, go to **Settings → Access** and turn on member sign-in, then
choose which pages members can see.

From the same page you can set up:

- **Single sign-on** through any OpenID Connect provider (Authentik, Authelia,
  Keycloak, Pocket ID). This is for Jellyfin installs only.
- **Two-factor sign-in** with an authenticator app.

## 7. Updating, backups and environment variables

**Update:**

```bash
docker compose pull && docker compose up -d
```

Admins see a notice in the sidebar when a new release is out, and **Settings
→ Updates & backup** lists what changed.

**Back up:** **Settings → Updates & backup → Backup** downloads every setting
as one file, encrypted with a passphrase you choose. Restore it on any
StreamForge server from the same page.

**Environment variables:** every service can also be configured with
variables, which is handy for infrastructure as code. Copy
[`.env.example`](../../.env.example) to `.env` next to your compose file and
fill in what you need. Settings saved in the UI take precedence, and **Use
environment** on a service in Settings goes back to the variables. Server
options are environment only:

| Variable | What it does |
| --- | --- |
| `PORT` | Port to listen on (default `4000`) |
| `TRUST_PROXY` | Set behind a reverse proxy (see step 5) |
| `COOKIE_SECURE` | `auto` (default) marks the sign-in cookie Secure over HTTPS |
| `SESSION_TTL_HOURS` | How long a sign-in lasts (default `12`) |
| `ALLOW_NON_ADMIN` | Default for member sign-in under Settings → Access |
| `UPDATE_CHECK` | `false` turns off the new-release check |
| `TZ` | Time zone for schedules and the weekly digest |

## Troubleshooting

- **A connection test fails:** check the address from inside the container
  with `docker exec streamforge wget -qO- <address>`. See
  [Docker networking](#4-docker-networking-which-address-to-use).
- **"Unauthorised — check API key":** the key is wrong or was regenerated.
  Paste it again.
- **Sign-in works at home but not through the proxy:** set `TRUST_PROXY`, and
  make sure the proxy passes `X-Forwarded-Proto`.
- **Locked out after changing the media server's address:** expected when it
  points at a different server, because that signs everyone out. Sign in again
  with an admin account on it.
- **Lost your two-factor device:** another admin can reset it under Settings →
  Access. If you're the only admin, start the container once with
  `STREAMFORGE_RESET_2FA=<your user name>`, sign in, then remove the variable.
- **Logs:** `docker logs streamforge`.

Next: [add more media servers](media-servers.md), [set up Kometa](kometa.md),
or [connect Sonarr and Radarr](sonarr-radarr.md).
