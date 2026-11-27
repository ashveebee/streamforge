# StreamForge

A modern control centre for a **Jellyfin, Plex, Emby or Silo** media server and the
services around it: **Sonarr, Radarr, Lidarr, Readarr, Bazarr, Prowlarr, Seerr,
Infinidisk, Kometa and your download clients** (qBittorrent, Transmission, SABnzbd,
NZBGet). Each install watches one media server, chosen on first run; then
StreamForge finds your apps on the network so you only paste their keys.
Using Plex, Emby or Silo? See [Plex, Emby and Silo households](#plex-emby-and-silo-households).

Built with React, Vite, TypeScript and Tailwind CSS, with a small Node/Express
backend that handles authentication and keeps every service credential on the
server.

[**Website**](https://ashveebee.github.io/streamforge/) · [**Guides**](docs/guides/README.md) · [Install](#installation) · [Screenshots](#screenshots) · [Demo](#demo-mode) · [License](#license)

![StreamForge dashboard: the stream playing now, health of every service, download activity and storage](docs/screenshots/dashboard.jpg)

<sub>Screenshots use the built-in demo data. All titles, people and artwork are fictional.</sub>

## Screenshots

<table>
  <tr>
    <td width="50%"><a href="docs/screenshots/now-playing.jpg"><img src="docs/screenshots/now-playing.jpg" alt="Now Playing: every active stream with artwork, progress and playback details"></a><br><b>Now Playing.</b> Every stream on your media server, with direct play or transcode details.</td>
    <td width="50%"><a href="docs/screenshots/system.jpg"><img src="docs/screenshots/system.jpg" alt="System Status: health, response time and uptime for each service"></a><br><b>System Status.</b> Health, response times and issues for each service.</td>
  </tr>
  <tr>
    <td><a href="docs/screenshots/jellyfin.jpg"><img src="docs/screenshots/jellyfin.jpg" alt="Jellyfin: libraries, server details and recently added items"></a><br><b>Jellyfin.</b> Libraries, users, server details and new additions.</td>
    <td><a href="docs/screenshots/sonarr.jpg"><img src="docs/screenshots/sonarr.jpg" alt="Sonarr: download queue, airing soon, auto-import and missing episodes"></a><br><b>Sonarr and Radarr.</b> Queues with actions, auto-import, missing items and what's airing.</td>
  </tr>
  <tr>
    <td><a href="docs/screenshots/emby.jpg"><img src="docs/screenshots/emby.jpg" alt="Emby: libraries, users, server details and recently added items for an Emby server"></a><br><b>Emby.</b> Its own page, with a tab per Emby server.</td>
    <td><a href="docs/screenshots/plex.jpg"><img src="docs/screenshots/plex.jpg" alt="Plex: libraries, server details and recently added items for a Plex server"></a><br><b>Plex.</b> Its own page, with a tab per Plex server.</td>
  </tr>
  <tr>
    <td><a href="docs/screenshots/seerr.jpg"><img src="docs/screenshots/seerr.jpg" alt="Seerr: requests awaiting approval and recent requests"></a><br><b>Seerr.</b> Pending approvals and recent requests.</td>
    <td><a href="docs/screenshots/infinidisk.jpg"><img src="docs/screenshots/infinidisk.jpg" alt="Infinidisk: storage capacity and drive health"></a><br><b>Infinidisk.</b> Capacity, drive health and temperatures.</td>
  </tr>
  <tr>
    <td><a href="docs/screenshots/stats.jpg"><img src="docs/screenshots/stats.jpg" alt="Stats: plays per day by direct play and transcode, top viewers, titles and clients"></a><br><b>Stats.</b> Watch time, direct play vs transcode and who watches what.</td>
    <td><a href="docs/screenshots/library.jpg"><img src="docs/screenshots/library.jpg" alt="Library health: incomplete series, upgrades available and mismatches with Jellyfin"></a><br><b>Library health.</b> Missing episodes, upgrades and items out of sync with Jellyfin.</td>
  </tr>
  <tr>
    <td><a href="docs/screenshots/downloads.jpg"><img src="docs/screenshots/downloads.jpg" alt="Downloads: live speeds and every download in qBittorrent and SABnzbd"></a><br><b>Downloads.</b> Real speeds and controls for your download clients.</td>
    <td><a href="docs/screenshots/search.jpg"><img src="docs/screenshots/search.jpg" alt="Search: results from Jellyfin, Sonarr and Seerr with a Request button"></a><br><b>Search.</b> ⌘K searches everything and requests what's missing.</td>
  </tr>
  <tr>
    <td><a href="docs/screenshots/me.jpg"><img src="docs/screenshots/me.jpg" alt="Personal page: continue watching, next up, requests, history and devices"></a><br><b>Your page.</b> Continue watching, requests, history and devices.</td>
    <td><a href="docs/screenshots/digest.jpg"><img src="docs/screenshots/digest.jpg" alt="Weekly digest: new movies and episodes and the most watched titles"></a><br><b>Weekly digest.</b> What's new and what got watched.</td>
  </tr>
  <tr>
    <td><a href="docs/screenshots/rules.jpg"><img src="docs/screenshots/rules.jpg" alt="Rules: automations such as pausing downloads when a disk is almost full"></a><br><b>Rules.</b> If this happens, do that.</td>
    <td><a href="docs/screenshots/audit.jpg"><img src="docs/screenshots/audit.jpg" alt="Audit log: changes, approvals and sign-ins with who made them"></a><br><b>Audit log.</b> Who changed what, and when.</td>
  </tr>
  <tr>
    <td><a href="docs/screenshots/bazarr.jpg"><img src="docs/screenshots/bazarr.jpg" alt="Bazarr: episodes and movies missing subtitles"></a><br><b>Bazarr.</b> Missing subtitles with search buttons.</td>
    <td><a href="docs/screenshots/settings.jpg"><img src="docs/screenshots/settings.jpg" alt="Settings: connect each service with an address and API key, and test the connection"></a><br><b>Settings.</b> Connect services, download clients, SSO and backups from the UI.</td>
  </tr>
  <tr>
    <td><a href="docs/screenshots/history.jpg"><img src="docs/screenshots/history.jpg" alt="Watch history: people on the left, and each play with its poster, server, device and time watched"></a><br><b>Watch history.</b> Everyone's plays, with their device and time watched.</td>
    <td><a href="docs/screenshots/title.jpg"><img src="docs/screenshots/title.jpg" alt="A movie page with its details, files, cast and who has watched it"></a><br><b>Title pages.</b> Details, files and audio tracks, who has watched it, and more like this.</td>
  </tr>
  <tr>
    <td colspan="2"><a href="docs/screenshots/buffering.jpg"><img src="docs/screenshots/buffering.jpg" alt="Buffering diagnosis: a stream that stalled, the likely cause with evidence, and what to try"></a><br><b>Why did it buffer?</b> Spots streams that stalled and explains the likely cause, from the transcoder to your upload.</td>
  </tr>
</table>

## Features

- **Jellyfin, Plex, Emby or Silo sign-in.** Users sign in with their account on your
  media server: a Jellyfin or Emby username and password, or **Sign in with
  Plex**. The server keeps the token, and the browser only holds an opaque
  HttpOnly session cookie. The user's profile and avatar come from that server.
- **Multiple languages.** English, Español, Français, Deutsch and Português
  (Brasil). StreamForge follows the browser's language, and anyone can change it
  on the sign-in screen or on **My activity**; the choice is saved per device.
  The whole interface is translated, and dates and numbers follow the chosen
  language. Text that comes from the server or your apps (error messages, audit
  log entries, buffering findings, notifications, Sonarr warnings and so on)
  stays in English.
- **Now playing.** Every active stream is shown with backdrop, poster, logo,
  title, season/episode, year, live progress, elapsed and remaining time, user,
  device and client. Each stream also shows direct play or transcode details:
  codecs, bitrate, hardware acceleration and transcode reasons. Admins can
  pause or resume a stream, send the viewer a message, or stop it with a reason.
- **Service integrations**
  - *Jellyfin:* server info, sessions, users, library statistics, recently added
    items, daily plays and the activity log.
  - *Two-step setup with discovery:* on first run you choose Jellyfin, Plex or
    Emby. **Find on network** lists the servers on your local network so you
    can pick one instead of typing its address. It uses each server's own
    discovery: UDP port 7359 for Jellyfin and Emby, and Plex's GDM (UDP port
    32414, "Enable local network discovery" in Plex → Settings → Network). In
    Docker it only works with `network_mode: host`, because broadcasts don't
    leave a bridge network.

    Step 2, **Set up your apps**, looks for Sonarr, Radarr, Seerr, Prowlarr,
    Bazarr, Lidarr and Readarr: by Docker service name (`http://sonarr:8989`),
    on this machine, the Docker host and the media server's machine at their
    usual ports, and at subdomains next to the media server's
    (`sonarr.example.com`). Found apps have their address filled in; paste the
    API key to connect. Once Seerr or Prowlarr is connected, StreamForge
    offers to connect the Sonarr and Radarr they already know, keys copied on
    the server. It's at `/setup`, linked from Settings → Services.
  - *One media server per install:* the server chosen on first run stays.
    Settings → Services lets you change its address and key, not swap it.
    Jellyfin and Emby streams can be paused, messaged and stopped. Plex
    streams can only be stopped, with a reason the viewer sees (stopping
    needs Plex Pass). Plex has no activity log, so its page shows recent
    plays from Plex's watch history instead. Running two media servers? Run
    a StreamForge for each; they can share the same Sonarr, Radarr and Seerr.
  - *Sonarr:* series stats, queue, airing calendar and disk space, plus a
    missing-episodes list with search buttons.
  - *Radarr:* movie stats, queue, cinema/digital/physical release dates,
    quality breakdown and disk space, plus a missing-movies list with search
    buttons.
  - *Sonarr and Radarr queues:* admins can blocklist and search again,
    blocklist, remove (with or without deleting the download) or grab a
    delayed release now. Queue rows show how long a download has been stalled.
  - *Multiple instances:* add extra Sonarr/Radarr instances (a 4K Radarr, an
    anime Sonarr) under the main service in Settings. Each gets its own tab,
    health check and place in the queues, calendar and download charts.
  - *Adding titles:* admins add a movie or show from its title page, or many
    at once from a Kometa collection's missing titles. Pick the instance,
    quality profile, root folder (with free space), minimum availability or
    which seasons to monitor, and whether to search now and tag it
    `streamforge`. Titles already in any instance are skipped, searches go out
    one after another, and your choices are remembered for next time.
  - *Prowlarr:* health, query/grab/failure stats and response time for each
    indexer, plus connected apps.
  - *Seerr:* request counts by status, pending approvals and recent requests,
    with TMDB artwork. Admins can approve or decline requests from the Seerr
    page or the dashboard.
  - *Infinidisk:* drives, capacity, usage, temperature and health.
  - *Lidarr and Readarr:* library stats, download queue (remove and
    blocklist), upcoming releases, and missing albums or books with search
    buttons.
  - *Bazarr:* episodes and movies missing subtitles, with per-title and bulk
    searches, plus recent subtitle activity.
  - *Jellyfin maintenance:* admins can scan all libraries or one, refresh a
    library's metadata, and run or stop Jellyfin's scheduled tasks.
- **System status.** A background monitor checks every service on an interval
  and records:
  - healthy, degraded or offline status;
  - response time and its history;
  - uptime over the recent checks;
  - the last successful check;
  - issues the service reports about itself.

  It also shows host CPU, RAM, network and filesystems, computes download
  throughput, and forecasts storage: disk usage is recorded hourly and a trend
  through the last 30 days estimates when each volume will be full.
- **Playback stats.** A Stats page shows plays per day split by direct play vs
  transcode, watch time, top viewers, titles and clients, and a weekday-by-hour
  heatmap. Viewer names open their watch history and
  titles open their pages. Watch time and transcode figures need a Jellyfin API
  key (see *Notes on data sources*).
- **Library health.** Cross-checks Sonarr, Radarr and Jellyfin by TVDB/TMDB/IMDb
  id. It lists monitored series with missing episodes, files that could be
  upgraded (with a search button), downloads Jellyfin doesn't have, and Jellyfin
  items no Sonarr/Radarr instance manages.
- **Customisable dashboard.** Drag widgets to reorder them, resize them (⅓, ½, ⅔
  or full width), or hide them. The layout is saved per user on each device.
- **Settings in the UI.** Connect services from a Settings page with a
  connection test for each one. Changes apply instantly and are stored in a
  local SQLite database. No config files to edit. Services you don't use can
  be switched off; they're hidden from the sidebar and dashboard and never
  contacted, and their settings are kept for later.
- **Auto-import (Sonarr and Radarr).** Finds finished downloads that couldn't
  be imported (for example "Unknown Series", "Unable to parse" or "matched by
  ID") and imports them. For each file it uses the first answer it can get:
  - **Series or movie:** the app's own match, then what the release was grabbed
    for, then the app's release-name parser, then a strict title match against
    your library (including alternate titles). Movies must also match on year.
  - **Episodes:** season and episode, absolute or air-date numbering.

  It skips a file when the signals conflict, when the file is a sample, when a
  movie download holds several video files, or when the app would still reject
  it (for example "not an upgrade"). It runs on a schedule, shortly after a
  download gets stuck, or when you press **Run now**. **Preview** shows what it
  would do without changing anything. It is off by default; turn it on from
  the Sonarr or Radarr page.
- **Stalled download cleanup.** When turned on (System page), downloads with no
  progress for a chosen time, and optionally ones the client reports as failed,
  are removed, blocklisted and searched for again. At most 10 per sweep.
- **Notifications.** Send alerts to Discord, ntfy, Pushover, any webhook
  (optionally HMAC-signed) or straight to your phone or browser with web push.
  Pick events per channel: service offline or back, disk almost full, imports
  done or failed, stalled downloads removed, and new requests to approve.
- **Member access.** Let non-admin Jellyfin users sign in and choose which
  pages they see. Access is enforced by the server, and every action stays
  admin-only.
- **Download clients.** Connect qBittorrent, Transmission, SABnzbd or NZBGet
  for real transfer speeds and a Downloads page listing everything in each
  client. Admins can pause and resume, remove (with or without files) and set
  speed limits.
- **Global search.** Press ⌘K / Ctrl+K (or `/`) to search Jellyfin, every
  Sonarr/Radarr instance, Lidarr and Readarr at once, and jump to any page.
  New titles come from Seerr, where people can request them in their own
  name; admins can also add a title straight to Sonarr or Radarr.
- **Watch history for every user.** Admins get a **Watch history** page:
  pick a person (or everyone) and a time range to see each play with its
  poster, the time, episode, app, device, how long they watched and whether
  it transcoded, plus their most-watched titles and usual device. Older
  plays, from before StreamForge was installed, are filled in from
  Jellyfin's own record (the last time each user finished each movie and
  episode), Emby's activity log or Plex's watch history, so it isn't empty on
  day one.
- **Your own page.** Everyone gets a page (click your name in the sidebar)
  with continue watching, next up, watch history, their Seerr requests,
  signed-in devices and two-factor settings.
- **Weekly digest.** A "This week" page shows what was added and what got
  watched. Admins can send it every week through the notification channels.
- **Will it play on your devices?** Every play teaches StreamForge what
  that device can handle: which file types, video and audio formats, HDR
  and subtitles it plays directly, and which make Jellyfin convert (from
  Jellyfin's own transcode reasons). From that it predicts, for any file,
  whether a device plays it directly, needs it repackaged, converts the
  audio, or converts the video (the heavy one).
  - Title pages show **Will it play?** for each device people watch on,
    with the reason and, for movies with several versions, which version
    to use.
  - Library health shows how the whole library plays on each device: how
    much plays directly, what makes the rest convert ("Dolby TrueHD audio:
    21 files") and which titles are affected.
  Profiles build up from new plays (a few plays per device is enough to
  start). Admins only; needs a Jellyfin API key.
- **Cleanup suggestions.** Library health lists big movies and series nobody
  has watched in 3–24 months, with the space each would free. Keep, stop
  monitoring, or delete them from there.
- **Watched by everyone.** Library health also lists the movies and series
  every Jellyfin user has finished, biggest first, so you can free space
  without removing something someone still means to watch. Choose who counts
  (leave out an admin or test account that never watches anything), tick
  titles, and delete them or stop monitoring them through Sonarr or Radarr in
  one go, so they aren't downloaded again. A series counts once every episode
  is watched. This needs Jellyfin as your media server, because it uses
  Jellyfin's watched state for each user.
- **Transcode and bandwidth alerts.** Get alerted when too many streams
  transcode at once, total bandwidth passes a limit, or a 4K file is being
  transcoded (optionally messaging the viewer).
- **Buffering diagnosis.** StreamForge records every stream, the host's CPU
  and network, download client speeds and Jellyfin's response time every 15
  seconds, and keeps three days. It spots streams that fell behind real time
  while not paused and explains the likely cause, with evidence and what to
  try:
  - Jellyfin converting slower than real time (with its transcode reasons
    and whether hardware acceleration is on);
  - a maxed-out CPU;
  - a full internet upload for viewers away from home, split into streams
    and torrent seeding;
  - a video bitrate the connection can't carry;
  - downloads running flat out, or Jellyfin slow or not responding.
  When nothing on the server stands out, it says so: the cause is then the
  viewer's Wi-Fi, connection or device. When someone reports buffering, pick
  their stream and roughly when, and StreamForge finds the nearest stall.
  Open it from **Why did it buffer?** on the Now Playing page (admins only;
  needs a Jellyfin API key). Set your upload speed on the page for
  sharper results (otherwise the highest upload seen is used).
- **Rules.** Simple automations: if a disk is nearly full, pause the download
  clients; if downloads stall, run the cleanup; if a service stays down,
  notify; and more. Rules never delete anything.
- **Audit log.** Every change made through StreamForge — settings, approvals,
  stream controls, queue actions, sign-ins — with who did it and from where.
- **Single sign-on and two-factor.** Sign in through any OpenID Connect
  provider (Authentik, Authelia, Keycloak, Pocket ID, …), and turn on
  two-factor sign-in with an authenticator app.
- **Update notices.** Admins see when a new StreamForge release is out, with
  what changed since their version and how to update.
- **Backup and restore.** Download all settings as one encrypted file and
  restore it on another server from Settings.
- **Installable.** StreamForge is a progressive web app: install it on a phone
  or desktop, and the app shell opens offline. Web push needs HTTPS.
- **Real-time updates.** Each endpoint is polled at a cadence that suits its
  data. Playback progress advances every second between polls. The backend
  de-duplicates upstream calls across clients.

## Installation

StreamForge runs as a single Docker container (images for `amd64` and `arm64`).
All you need is Docker and a Jellyfin, Plex, Emby or Silo server it can reach.

> **Guides:** the [install and configure guide](docs/guides/install.md) walks
> through everything below in more detail, including reverse proxies and
> Tailscale. There are also guides for
> [media servers](docs/guides/media-servers.md), [Kometa](docs/guides/kometa.md),
> [Sonarr and Radarr](docs/guides/sonarr-radarr.md),
> [watch history and stats](docs/guides/watch-history-and-stats.md) and
> [notifications](docs/guides/notifications.md). They're also on the
> [website](https://ashveebee.github.io/streamforge/guides/).

### 1. Start the container

**Docker Compose** (recommended). Save this as `docker-compose.yml`, or download
[`docker-compose.example.yml`](docker-compose.example.yml):

```yaml
services:
  streamforge:
    image: ghcr.io/ashveebee/streamforge:latest
    container_name: streamforge
    ports:
      - "4000:4000"
    volumes:
      - streamforge-data:/data
    restart: unless-stopped

volumes:
  streamforge-data:
```

```bash
docker compose up -d
```

**Or with `docker run`:**

```bash
docker run -d --name streamforge \
  -p 4000:4000 \
  -v streamforge-data:/data \
  --restart unless-stopped \
  ghcr.io/ashveebee/streamforge:latest
```

The `/data` volume holds the settings database. Keep it, or you'll need to set
everything up again after an upgrade.

### 2. Choose your media server

Open **http://your-server:4000**. On first launch StreamForge asks which media
server you use. People sign in to StreamForge with their account on it.

- **Plex:** click **Sign in with Plex** and approve it in the Plex window
  that opens, using the account that owns your server. Pick the server, and
  you're in. StreamForge finds the server's address itself, preferring the
  local one. Everyone you share the server with can then sign in with their
  own Plex account.
- **Jellyfin:** enter your Jellyfin server address (for example
  `https://jellyfin.example.com` or `http://192.168.1.10:8096`), or click
  **Find servers on my network** to pick one. Then sign in with a **Jellyfin
  administrator** account.
- **Emby:** enter your Emby server address (or find it on the network) and
  sign in with an **Emby administrator** account. StreamForge creates its own
  API key on the server for background features, and everyone else signs in
  with their Emby account.
- **Silo:** enter your Silo server's web address (port 8090 by default) and
  sign in with a **Silo admin** account. StreamForge creates its own admin API
  key on Silo for background features, and everyone else signs in with their
  Silo account. Silo is pre-release; StreamForge uses its native `/api/v2`.
  When Silo's own requests are switched on, StreamForge uses them instead of
  Seerr for the Requests page, Request buttons and approvals, with each
  request's download progress. Silo sends approved requests through its
  request servers, such as the community Sonarr & Radarr or Seerr plugins.

Each install watches the one media server you choose. Running two? Run a
StreamForge for each.

<a href="docs/screenshots/setup.jpg"><img src="docs/screenshots/setup.jpg" width="32%" alt="First-run setup: pick Plex, Jellyfin, Emby or Silo"></a>
<a href="docs/screenshots/setup-plex.jpg"><img src="docs/screenshots/setup-plex.jpg" width="32%" alt="After signing in with Plex: pick which of your Plex servers to use"></a>
<a href="docs/screenshots/setup-emby.jpg"><img src="docs/screenshots/setup-emby.jpg" width="32%" alt="Emby setup: the server address, servers found on the network, and an administrator sign-in"></a>

### 3. Set up your apps

After you sign in, StreamForge opens **Set up your apps** and looks for Sonarr,
Radarr, Seerr, Prowlarr, Bazarr, Lidarr and Readarr: by Docker service name,
on this machine and the media server's machine at their usual ports, and at
subdomains next to your media server's. Found apps have their address filled
in; paste each API key and click **Test and connect**. Once Seerr or Prowlarr
is connected, StreamForge offers to connect the Sonarr and Radarr they already
know. Apps you skip are switched off; turn them on any time in Settings.

<a href="docs/screenshots/setup-apps.jpg"><img src="docs/screenshots/setup-apps.jpg" width="60%" alt="Set up your apps: Sonarr and Seerr connected, Radarr, Prowlarr and Bazarr found with their addresses filled in, and an offer to connect Radarr using Seerr's details"></a>

### Plex, Emby and Silo households

With Plex, Emby or Silo as your media server, the whole app runs on it. Jellyfin isn't
needed at all. **Emby** works almost exactly like Jellyfin (it has the same
API): pausing and messaging streams, the activity log and scans all work. The
notes below are mostly about **Plex**.

<a href="docs/screenshots/plex-only.jpg"><img src="docs/screenshots/plex-only.jpg" alt="The dashboard of a Plex-only install: Plex streams, a Plex sidebar entry and service health"></a>

- **Emby sign-in:** username and password, like Jellyfin. Emby
  administrators are StreamForge administrators; other Emby users are members.
  Cleanup suggestions use the plays StreamForge records, because Emby's
  per-user watch data needs each user's own token.
- **Plex sign-in:** **Sign in with Plex**. The server's owner is an administrator.
  People the server is shared with are members, and can sign in when Settings
  → Access allows it. Two-factor sign-in works as usual. StreamForge never
  sees anyone's Plex password; plex.tv handles the sign-in.
- **Works the same:** dashboard, Now Playing (with stop), the Plex page with
  libraries, users, recently added and scans, Stats, your page (On Deck from
  Plex), ⌘K search, Library health, cleanup suggestions, the weekly digest,
  rules, playback alerts and the buffering diagnosis. Seerr requests are
  matched to Plex accounts.
- **Plex differences:** Plex streams can be stopped (with a reason, needs Plex
  Pass) but not paused or messaged, so the 4K alert only notifies you. Stats
  for the time before StreamForge started recording come from Plex's watch
  history, which has no watch time or transcode details. Title pages show
  details from Seerr and the *arr apps, without per-episode file info. Single
  sign-on and Moonfin are Jellyfin features and are hidden (with Emby too).
- **Needs:** the StreamForge server must be able to reach `plex.tv` (for
  sign-in) and your Plex server.

**Silo** (pre-release) is read through its own API (`/api/v2`), with an admin
API key StreamForge creates at setup.

<a href="docs/screenshots/silo-only.jpg"><img src="docs/screenshots/silo-only.jpg" width="49%" alt="The dashboard of a Silo install: Silo streams, Requests in the menu with three waiting, and service health"></a>
<a href="docs/screenshots/requests-silo.jpg"><img src="docs/screenshots/requests-silo.jpg" width="49%" alt="Silo's requests in StreamForge: three awaiting approval, and recent requests with download progress"></a>

- **Silo sign-in:** username and password. Silo admins are StreamForge
  administrators; other Silo users are members.
- **Works the same:** dashboard, Now Playing (pause, message and stop), the
  Silo page with libraries, users, recently added and scans, Stats and Watch
  history (with watch time and direct play vs transcode, from Silo's playback
  history), title pages, ⌘K search, cleanup suggestions, the weekly digest and
  episode watched ticks.
- **Requests:** when Silo's own requests are switched on, StreamForge uses them
  instead of Seerr. **Requests** moves into the main menu with a count of
  what's waiting; people request in their own Silo account (an admin's own
  requests are approved straight away); and each request shows where Silo sent
  it and how its download is going. To send requests to Sonarr and Radarr,
  install Silo's community Sonarr & Radarr (or Seerr) requests plugin and add
  your servers in Silo; see the [media server guide](docs/guides/media-servers.md).
- **Not for Silo:** Kometa, continue watching on your page, and finding the
  server on the network.

### 4. Change them later in Settings

Go to **Settings** in the sidebar. Services are grouped: media server, library
managers, indexers and downloads, requests, metadata and subtitles, and
storage. For each service you use, enter its address and API key, click
**Test connection**, then **Save**. Changes apply
immediately; no restart is needed. Skip any service you don't run.

| Service | Where to find the API key |
| --- | --- |
| Jellyfin | Dashboard → API Keys (optional; enables server-wide stats and update warnings) |
| Emby | Emby → Settings → Advanced → API Keys (on the Emby card in Settings) |
| Plex | The server owner's Plex token (on the Plex card in Settings) |
| Sonarr / Radarr / Prowlarr | Settings → General → Security → API Key |
| Seerr | Settings → General → API Key |
| Lidarr / Readarr / Bazarr | Settings → General → Security → API Key |
| qBittorrent / Transmission / NZBGet | Your web UI username and password (Settings → Download clients) |
| SABnzbd | Config → General → API Key (Settings → Download clients) |
| Infinidisk | Your Infinidisk settings (optional if its status endpoint is public) |

> **Addresses are resolved from inside the container.** `localhost` means the
> StreamForge container itself, not your host. Use your server's LAN IP or
> domain name, `http://host.docker.internal:<port>` for services on the same
> host (Docker Desktop; on Linux add `--add-host=host.docker.internal:host-gateway`),
> or the container name (e.g. `http://sonarr:8989`) if the services share a
> Docker network with StreamForge.

### Updating

```bash
docker compose pull && docker compose up -d
```

Your settings are kept in the `streamforge-data` volume. See
[Releases and image tags](#releases-and-image-tags) to pin a version instead of
following `latest`.

StreamForge tells admins when a new release is out: the sidebar shows the new
version, and **Settings → Updates & backup** lists what changed since your version and
the command to update. It asks GitHub's public API every 6 hours, sending
nothing but its version number. Pick **StreamForge update available** on a
notification channel to hear about it there too, or set `UPDATE_CHECK=false`
to turn the check off.

### Backing up

The easiest way is **Settings → Backup & restore**: it downloads every setting
as one file encrypted with a passphrase, and restores it on any StreamForge
server (in Docker, StreamForge restarts itself to apply it).

Everything StreamForge stores is in `/data/streamforge.db`. To back up the whole
volume instead:

```bash
docker run --rm -v streamforge-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/streamforge-data.tgz -C /data .
```

The file contains your service API keys, so keep backups private.

### Public addresses

StreamForge usually reaches your services on internal addresses such as
`http://jellyfin:8096`, which don't work from your phone. Set a **Public
address** on a service in Settings (or `JELLYFIN_PUBLIC_URL`,
`SONARR_PUBLIC_URL` and so on) to the address you open it at in a browser,
for example `https://jellyfin.example.com`. Links such as **Play in
Jellyfin** and **Open in Sonarr** then use it.

### Kometa

> The [Kometa guide](docs/guides/kometa.md) has the full step-by-step setup,
> every collection option and troubleshooting.

[Kometa](https://kometa.wiki) (previously Plex Meta Manager) builds collections,
overlays and playlists on a schedule. It has no API, but it can send webhooks,
and StreamForge can receive them:

1. In StreamForge, go to **Settings → Services → Kometa** and switch on
   **Receive Kometa webhooks**.
2. Copy the `webhooks:` block it shows into Kometa's `config.yml`. If you
   already have a `webhooks:` section (for Discord or Notifiarr, say), turn
   each entry into a list and add StreamForge's address to it:

   ```yaml
   webhooks:
     error:
       - notifiarr
       - http://streamforge:4000/api/hooks/kometa/<your code>
     run_end: http://streamforge:4000/api/hooks/kometa/<your code>
   ```

3. Use an address Kometa can reach. In Docker that's usually StreamForge's
   container name or LAN IP, not `localhost`.

After Kometa's next run, **System Status** shows a Kometa card: whether it's
running, the last run's time and counts (collections created, updated and
removed, items added and removed), a strip of recent runs, errors with the
library and collection they came from, a notice when a newer Kometa is out,
and recent collection changes. Under **Settings → Notifications** you can
subscribe a channel to **Kometa errors** and **Kometa run finished**.

The long code at the end of the address is what lets Kometa in, because Kometa
can't send a password. Keep it private; **New address** replaces it if it
leaks. StreamForge keeps the last 1,000 Kometa events and drops the poster
images Kometa sometimes includes.

#### Making collections from StreamForge

The **Kometa** page (in the sidebar once Kometa is set up) lists the
collections on every Plex, Jellyfin and Emby server, and admins can add their
own: from a TMDb, IMDb or Trakt list, TMDb trending or popular, a TMDb
keyword, or titles picked by hand. Each can be shown all year or only between
two dates (a Christmas collection in December), ordered like the list, by
release date or A–Z, and can send missing titles to Radarr or Sonarr. Opening
a collection shows what's on the list, what you have, what's missing (tick
them and add them to Sonarr or Radarr in one go), its run history and the
Kometa config StreamForge wrote.

StreamForge doesn't run Kometa. It writes its collections to its own files, and
Kometa builds them on its next run:

1. Mount Kometa's config folder into StreamForge **read-write**:

   ```yaml
   volumes:
     - /opt/kometa/config:/kometa
   ```

2. Under **Settings → Services → Kometa → Collections from StreamForge**, enter
   the folder (`/kometa`) and the times Kometa runs, so StreamForge can say
   when a change will show up. The TMDb key is read from Kometa's
   `config.yml`; enter one only if it isn't there.
3. Add the `- file:` line Settings shows to each library's `collection_files`
   in Kometa's `config.yml`, for example:

   ```yaml
   libraries:
     Movies:
       collection_files:
         - file: config/streamforge/plex-cabin-movies.yml
   ```

StreamForge only writes files in a `streamforge` folder inside the config
folder, and never touches your own Kometa files. Jellyfin and Emby libraries
need Kometa's develop (nightly) build for now; the stable release is Plex-only.
StreamForge can show what's on TMDb lists before Kometa builds them, but not
IMDb or Trakt lists, so those show what's in the collection on the server.
To make collections on your main Jellyfin server, give it an API key under
**Settings → Jellyfin**.

### Moonfin

If you use [Moonfin](https://github.com/Moonfin-Client), switch it on in
**Settings → Moonfin**. Play buttons then offer to open titles in the Moonfin
app (`moonfin://` links) or the Moonfin web app that its Jellyfin plugin serves
at `/Moonfin/Web/`. Each device asks once and can remember the answer, and the
arrow next to Play lets anyone pick again. The web app uses Jellyfin's public
address.

### Optional: configure with environment variables

Everything can also be set with environment variables, which is handy for
infrastructure-as-code. Copy [`.env.example`](.env.example) to `.env`, fill in
what you need and pass it with `--env-file .env` (Compose picks up `.env`
automatically if you use the example file). Settings saved in the UI take
precedence. **Use environment** on a service in Settings removes the saved
copy and falls back to the variables.

Server options such as `PORT`, `TRUST_PROXY` (set when behind a reverse proxy)
and `SESSION_TTL_HOURS` are environment-only. `ALLOW_NON_ADMIN` sets the
default for **Member access** in Settings. See `.env.example` for the full list.

### Troubleshooting

- **"Jellyfin server unreachable" or a failed connection test:** check the
  address from inside the container:
  `docker exec streamforge wget -qO- <url>/System/Info/Public`.
- **"Unauthorised — check API key":** the key is wrong or was regenerated.
  Paste it again in Settings. For Plex, use the token of the account that owns
  the server: a shared user's token can't see sessions or history.
- **Plex says "Plex can only stop streams":** Plex doesn't let a server pause
  a stream or send the viewer a message. Stopping works with Plex Pass.
- **"Find on network" doesn't find Plex or Emby:** turn on "Enable local
  network discovery (GDM)" in Plex (Settings → Network). In Docker, use
  `network_mode: host`. You can always add a server by its address.
- **"Re-enter the API key when changing the server address":** a saved key is
  never sent to a new address. Paste the key again along with the new address.
- **Locked out after changing the Jellyfin server:** this is expected, because
  everyone is signed out. Sign in again with an administrator account on the
  new server.
- **Lost your two-factor device and recovery codes:** another admin can reset
  it under Settings → Sign-in security. If you're the only admin, start the
  container once with `STREAMFORGE_RESET_2FA=<your Jellyfin user name>`, sign
  in, and remove the variable again.
- **"Sign in with Plex" says your account doesn't have access:** the account
  must own the server or have it shared with it. Sharing happens in Plex
  (Settings → Users & Sharing). If it's shared, check that member sign-in is
  on under Settings → Access.
- **Plex setup says it can't reach the server:** StreamForge tries every
  address plex.tv lists for the server, local ones first. In Docker, make sure
  the container can reach the server's LAN address (or use host networking).
- **Single sign-on says there's no Jellyfin user:** the username claim
  (`preferred_username` by default) must match a Jellyfin user name. Change the
  claim under Settings → Sign-in security if your provider sends something else.
- **Logs:** `docker logs streamforge`. The startup banner lists every service
  and where its settings come from.

## Development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev               # API on :4000, UI on :5173 (proxied)
```

Settings are stored in `./data` (git-ignored).

### Demo mode

To try the UI without any media services:

```bash
npm run demo              # UI on http://localhost:5173, already signed in
```

This runs a mock API (`scripts/demo-server.ts`) with fictional streams,
libraries, queues and requests, and generated artwork. To re-create the README
screenshots after changing the UI, keep the demo running and run
`./scripts/screenshots.sh` (needs Google Chrome).

The demo shows a household with a main Jellyfin server plus an Emby and a Plex
server. Other set-ups:

| Variable | Shows |
| --- | --- |
| `DEMO_SINGLE=1` | One Jellyfin server and nothing else |
| `DEMO_MAIN=plex` / `DEMO_MAIN=emby` | A Plex-only or Emby-only household |
| `DEMO_SETUP=1` | The first-run setup screen |
| `DEMO_SIGNED_OUT=1` | The sign-in screen |

For example `DEMO_SINGLE=1 npm run demo`.

To preview the guides as website pages, run
`node scripts/build-guides.mjs` (they're written to `_site/guides`).

### Production build

For a production build without Docker:

```bash
npm run build
npm start                 # serves UI + API on :4000
```

## Releases and image tags

StreamForge follows [Semantic Versioning](https://semver.org). Releases are
automated from [Conventional Commits](https://www.conventionalcommits.org/)
(see [CONTRIBUTING.md](CONTRIBUTING.md)), and each one is published as a
[GitHub Release](../../releases) with a changelog.

| Tag | Updated when | Use it for |
| --- | --- | --- |
| `1.2.3` | never (immutable) | exact, reproducible deployments |
| `1.2` | every patch release of 1.2 | bug fixes only |
| `1` | every 1.x release (from 1.0.0) | **recommended** once 1.0 is out: features and fixes, no breaking changes |
| `latest` | every release | always the newest stable release |
| `edge` | every commit to `main` | testing unreleased changes |
| `sha-abc1234` | that commit only | debugging a specific build |

Every image ships with an SBOM and a signed build-provenance attestation. To
verify an image:

```bash
gh attestation verify oci://ghcr.io/ashveebee/streamforge:1 --repo ashveebee/streamforge
```

The running version appears in the sidebar and at `/healthz`.

## Architecture

```
browser ──(session cookie)──▶ StreamForge server ──(API keys / Jellyfin token)──▶ services
         /api/*                 server/                                     Jellyfin, *arr, Seerr, Infinidisk
```

```
server/
  index.ts            Express app, security headers, static hosting
  config.ts           zod-validated environment configuration
  settings.ts         runtime service settings (SQLite, falling back to env)
  settingsRoutes.ts   admin Settings API: view, test, save, reset
  auth.ts             Jellyfin login/logout, first-run setup, session middleware, CSRF guard
  routes.ts           /api routes and image proxies
  health.ts           health monitor and download-throughput sampler
  host.ts             host CPU / RAM / network / filesystem metrics
  services/           one module per integration (normalises upstream data)
  lib/                http client, TTL cache, session store, SQLite database
src/
  pages/              one page per route
  components/widgets  dashboard widgets and widget registry
  components/ui       design-system primitives (cards, gauges, states, charts)
  components/layout   shell, collapsible sidebar, headers
  hooks/              react-query hooks, auth context, persisted state
  lib/                API client, formatters, shared types
```

To add an integration:

1. Add a module in `server/services/` that reads its client via `derived()` from
   `server/settings.ts`, and add the service to `SERVICE_IDS` and the Settings page.
2. Register its probe in `server/health.ts`.
3. Expose a route in `server/routes.ts`.
4. Add a hook in `src/hooks/queries.ts`.
5. Add a widget to `src/components/widgets/registry.tsx`.

## Security

- API keys stay on the server, in the environment or the settings database
  (`chmod 600`, in an owner-only directory). The Settings page shows only the
  last four characters of a saved key, and only administrators can open it.
- A saved API key is never sent to a new server address: changing a service's
  address requires entering its key again.
- First-run setup (choosing the Jellyfin server) is only available while no
  Jellyfin server is configured. Changing the Jellyfin server later signs
  everyone out.
- Artwork is streamed through validated proxy routes, so the browser never
  contacts internal services. Item IDs, image types and cover filenames are
  checked against allow-lists to prevent SSRF.
- Session cookies are random 256-bit IDs, `HttpOnly` and `SameSite=Strict`.
  They are `Secure` when the request arrives over HTTPS.
- Jellyfin tokens are re-checked every 5 minutes. Revoking a device or demoting
  a user in Jellyfin ends their StreamForge session.
- State-changing requests require a custom header, which acts as CSRF
  protection. Login is rate-limited, and Helmet sets the CSP and other headers.
- Only Jellyfin administrators can sign in by default. Turn on **Member access**
  in Settings (or set `ALLOW_NON_ADMIN=true`) to let other users in. Members
  only reach the pages you allow, checked on the server, and can't change
  anything.
- Notification secrets (webhook URLs, tokens) are stored on the server and
  never sent back to the browser.
- Sessions are stored in the settings database, so restarts and upgrades keep
  people signed in. Everyone can see and sign out their own devices.
- Two-factor sign-in uses standard authenticator-app codes with ten
  single-use recovery codes. Codes can't be reused, and attempts are
  rate-limited.
- Single sign-on uses the OpenID Connect code flow with PKCE and checks the ID
  token's signature against the provider's keys. It needs a Jellyfin API key,
  because there is no Jellyfin password to sign in with.
- Backups are encrypted with your passphrase (scrypt and AES-256-GCM) and never
  include sign-in sessions.
- Every change and sign-in is recorded in the audit log for 180 days.

## Notes on data sources

- **Features that need the Jellyfin API key.** Transcode alerts, the weekly
  digest notification, single sign-on, the active-streams and ended-series
  rules, and watch history all work in the background, so they use the
  Jellyfin API key (Settings → Jellyfin).
- **Cleanup suggestions** count a title as watched when it was played on any
  media server: any Jellyfin user played or started it on the main Jellyfin
  server, any account watched it on a Plex server (from Plex's watch history),
  or StreamForge recorded a play on any server. Results are cached for ten
  minutes.
- **Playback stats.** A recorder samples active sessions on your media
  server every 30 seconds and stores each play, including watch time and
  whether it transcoded. Jellyfin needs a Jellyfin API key for this
  (Settings → Jellyfin); Plex and Emby already have one from setup. Without a key, or for days
  before recording started, the Stats page uses Jellyfin's activity log, which
  has plays but no watch time or transcode data.
- **Storage forecast.** Usage is sampled hourly from Infinidisk, the host and
  Sonarr/Radarr; volumes seen by several of them are counted once. A forecast
  appears after a day of history.

- **Download speeds.** Sonarr and Radarr don't report a live speed, so
  StreamForge works it out from how much each queue item's remaining size drops
  between samples, taken every 5 seconds.
- **Playback activity chart.** This is built from Jellyfin's activity log
  (`VideoPlayback` and `AudioPlayback` entries). No plugin is needed.
- **Extra Emby and Plex servers.** Emby shares Jellyfin's API, so StreamForge
  reads it the same way (under Emby's `/emby` path, with the `X-Emby-Token`
  header). Plex is read through its own API (`server/services/plex.ts`): active
  streams from `/status/sessions`, libraries and counts from
  `/library/sections`, users from `/accounts`, recent plays from
  `/status/sessions/history/all` and artwork through Plex's photo transcoder.
  Plex user avatars live on plex.tv, so Plex users show initials instead.
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

## License

StreamForge is free and open source software, licensed under the
[GNU General Public License v2.0](LICENSE), the same license as Jellyfin.

- ✅ Use it for anything, at home or at work, commercially or not
- ✅ Study it, change it and share your changes
- 📄 If you distribute StreamForge or a modified version, you must make the
  source code available under the same license

```
StreamForge
Copyright (C) 2026 ashveebee and contributors

This program is free software; you can redistribute it and/or modify it under
the terms of the GNU General Public License version 2 as published by the Free
Software Foundation.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU General Public License for more details.
```
