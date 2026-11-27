# Media servers: Jellyfin, Plex and Emby

StreamForge works with Jellyfin, Plex or Emby. Each install watches **one**
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

| | Jellyfin | Emby | Plex |
| --- | --- | --- | --- |
| Health checks and alerts | ✓ | ✓ | ✓ |
| Now Playing | ✓ | ✓ | ✓ |
| Stop a stream | ✓ | ✓ | ✓ (needs Plex Pass) |
| Pause or message a stream | ✓ | ✓ | — |
| Libraries, users, recently added | ✓ | ✓ | ✓ |
| Activity log | ✓ | ✓ | Watch history instead |
| Library scans | ✓ | ✓ | ✓ |
| Copies on title pages (quality, size, tracks) | ✓ | ✓ | ✓ |
| Older plays filled into Watch history | ✓ | ✓ | ✓ |
| Watched ticks on episodes (you and others) | ✓ | ✓ | ✓ |
| Watched by everyone (Library health) | ✓ | — | — |
| Single sign-on | ✓ | — | — |
| Kometa collections | develop build | develop build | ✓ |

## How titles are matched with your apps

Title pages bring together what your media server, Sonarr/Radarr and Seerr
know about a title. They're matched by **TMDb, TVDB and IMDb ids**, which
each app reads from its metadata. File names and folder layout don't matter.

If a title isn't matched, check that it's identified correctly (Jellyfin and
Emby: **Identify**; Plex: **Fix Match**).

## Troubleshooting

- **Find on network doesn't find your server:** in Plex, turn on **Enable
  local network discovery (GDM)** (Settings → Network); in Jellyfin, **Enable
  auto discovery** (Dashboard → Networking). In Docker, discovery needs
  `network_mode: host`. You can always type the address.
- **A Plex server shows no streams or history:** the token belongs to a shared
  user. Use the owner's token.
- **"Re-enter the API key when changing the server address":** a saved key is
  never sent to a new address. Paste the key again with the new address.
