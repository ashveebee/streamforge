# Media servers: Jellyfin, Plex, Emby and Silo

StreamForge works with Jellyfin, Plex, Emby or Silo. Each install watches **one**
media server, the one you choose on first run, and sticks with it.

- [Choosing your media server](#choosing-your-media-server)
- [Changing the address or key](#changing-the-address-or-key)
- [Running more than one media server](#running-more-than-one-media-server)
- [Finding a Plex token](#finding-a-plex-token)
- [What works on each server](#what-works-on-each-server)
- [How titles are matched with your apps](#how-titles-are-matched-with-your-apps)
- [Troubleshooting](#troubleshooting)

## Choosing your media server

On first run, StreamForge asks which media server you use:

- **Jellyfin:** enter its address (or pick it from **Find on network**), then
  sign in with a Jellyfin administrator account.
- **Plex:** click **Sign in with Plex**, then pick your server. No token to
  copy.
- **Emby:** enter its address and an Emby administrator's username and
  password.
- **Silo:** enter its web address (port 8090 by default) and a Silo admin's
  username and password. StreamForge creates its own admin API key on Silo.
  Silo is pre-release, so its API can still change before 1.0.

  Silo has its own request system. When it's switched on in Silo, StreamForge
  uses it instead of Seerr: the Requests page, Request buttons, approvals and
  your requests all go through Silo, and requests are made in each person's
  own Silo account. An admin's own requests are approved straight away.

  Silo hands approved requests to its **request servers**, which come from
  plugins. To send them to Sonarr and Radarr:

  1. In Silo, open **Admin → Integrations → Plugins → Catalog**, turn on
     **Include approved community plugins**, and install the Sonarr & Radarr
     requests plugin (or the Seerr one, to go through Seerr).
  2. Add your Sonarr and Radarr under **Admin → Requests → Settings →
     Servers**, with a root folder and quality profile for each.
  3. Under **Admin → Autoscan → Sources**, add a **Sonarr/Radarr Webhook**
     source and point Sonarr's and Radarr's webhooks at it, so a finished
     download shows up in Silo, and the request is marked available, straight
     away.

  StreamForge's Requests page then shows where each request went and how its
  download is going. With Silo's requests on, **Requests** sits in the main
  menu (not under Services), with a count of requests waiting for approval.

People then sign in to StreamForge with their account on that server, and its
admins are StreamForge admins. Everything in StreamForge reads it: Now
Playing, stats, watch history, title pages, search, library health, alerts and
your own page.

After that comes step 2, **Set up your apps**: StreamForge looks for Sonarr,
Radarr, Seerr, Prowlarr, Bazarr, Lidarr and Readarr and you paste each API key
to connect. See the [install guide](install.md#step-2-set-up-your-apps).

## Changing the address or key

**Settings → Services** shows your media server first. You can change its
address, key (or Plex token) and public address. A saved key is never sent to
a new address, so paste the key again when the address changes.

You can't switch an install to a different kind of media server, or to a
different server's library. That keeps every page consistent: stats, history
and watched ticks all come from one place.

## Running more than one media server

Run one StreamForge per media server. Each is a small container with its own
data volume and port, for example `streamforge-plex` on port 4000 and
`streamforge-jellyfin` on 4001. They can share the same Sonarr, Radarr and
Seerr.

Upgrading from a version that could watch several servers at once? Your
original sign-in server is kept, and any extra servers you'd added are no
longer watched. Their settings stay in the database, and Settings says which
ones were set aside.

## Finding a Plex token

You only need this to change the token in Settings: **Sign in with Plex**
handles it on first run. StreamForge needs the token of the account that
**owns** the Plex server. A shared user's token can't see sessions or history.

1. Open Plex Web and sign in as the server owner.
2. Open any movie, click **⋯ → Get Info**, then **View XML**.
3. The address of the page that opens ends in `X-Plex-Token=...`. Copy the
   value after the `=`.

Keep it private, because it gives full access to your Plex account.

## What works on each server

| | Jellyfin | Emby | Plex | Silo |
| --- | --- | --- | --- | --- |
| Health checks and alerts | ✓ | ✓ | ✓ | ✓ |
| Now Playing | ✓ | ✓ | ✓ | ✓ |
| Stop a stream | ✓ | ✓ | ✓ (needs Plex Pass) | ✓ |
| Pause or message a stream | ✓ | ✓ | — | ✓ |
| Libraries, users, recently added | ✓ | ✓ | ✓ | ✓ |
| Activity log | ✓ | ✓ | Watch history instead | Playback history instead |
| Library scans | ✓ | ✓ | ✓ | ✓ |
| Copies on title pages (quality, size, tracks) | ✓ | ✓ | ✓ | Quality and size |
| Older plays filled into Watch history | ✓ | ✓ | ✓ | ✓ (with watch time) |
| Watched ticks on episodes (you and others) | ✓ | ✓ | ✓ | ✓ (finished plays) |
| Continue watching on your page | ✓ | ✓ | ✓ | — |
| Watched by everyone (Library health) | ✓ | — | — | — |
| Single sign-on | ✓ | — | — | — |
| Kometa collections | develop build | develop build | ✓ | — |
| Requests | Seerr | Seerr | Seerr | Silo's own, or Seerr |

## How titles are matched with your apps

Title pages bring together what your media server, Sonarr/Radarr and Seerr
know about a title. They're matched by **TMDb, TVDB and IMDb ids**, which
each app reads from its metadata. File names and folder layout don't matter.

If a title isn't matched, check that it's identified correctly (Jellyfin and
Emby: **Identify**; Plex: **Fix Match**).

## Troubleshooting

- **Silo says the key was refused:** StreamForge needs an admin API key.
  Setup creates one; if it was deleted in Silo, create one under Settings →
  API Keys (no scopes) and paste it in Settings → Services.
- **Find on network doesn't find your server:** in Plex, turn on **Enable
  local network discovery (GDM)** (Settings → Network); in Jellyfin, **Enable
  auto discovery** (Dashboard → Networking). In Docker, discovery needs
  `network_mode: host`. You can always type the address.
- **A Plex server shows no streams or history:** the token belongs to a shared
  user. Use the owner's token.
- **"Re-enter the API key when changing the server address":** a saved key is
  never sent to a new address. Paste the key again with the new address.
