# Media servers: Jellyfin, Plex and Emby

StreamForge works with Jellyfin, Plex and Emby, and with as many servers as
you run: a Jellyfin server at home and a Plex server at a holiday cabin, say.

- [The main server and extra servers](#the-main-server-and-extra-servers)
- [Adding another server](#adding-another-server)
- [Finding a Plex token](#finding-a-plex-token)
- [What works on each server](#what-works-on-each-server)
- [How titles are matched across servers](#how-titles-are-matched-across-servers)
- [What changes with more than one server](#what-changes-with-more-than-one-server)
- [Troubleshooting](#troubleshooting)

## The main server and extra servers

**The main server** is the one you picked on first run. People sign in to
StreamForge with their account on it, its admins are StreamForge admins, and
"continue watching", your own page, playback alerts and the buffering
diagnosis use it.

**Extra servers** are monitored alongside it. For each one you get:

- Health checks and outage alerts.
- Its streams on **Now Playing** (with stop, and pause and message on
  Jellyfin and Emby).
- Its own page and sidebar entry, with libraries, users, recently added and
  activity.
- Its plays counted in **Stats**, **Watch history** and the weekly digest.
- Its library checked by title pages, ⌘K search and Library health. A movie
  that's only on your Plex server still counts as "in your library".

To change the main server, open **Settings → Services → Jellyfin** (or the
Plex or Emby card) and change the address. This signs everyone out, so sign
back in with an admin account on the new server.

## Adding another server

1. Go to **Settings → Services**. Emby and Plex each have their own card,
   and extra Jellyfin servers go under **More Jellyfin servers** on the
   Jellyfin card. (With Plex or Emby as the main server, Jellyfin gets its own
   card instead.)
2. Click **Add server**, or **Find on network** to fill in the address for you.
3. Give it a name you'll recognise (it's shown everywhere, such as "Cabin").
4. Enter its address and key:
   - **Jellyfin:** Dashboard → API Keys → **+**.
   - **Emby:** Settings → Advanced → API Keys → **New API Key**.
   - **Plex:** the server owner's Plex token (see below).
5. Optionally set a **Public address**, the one you open the server at in a
   browser. **Open** buttons on title pages use it.
6. Click **Test connection**, then **Save**.

## Finding a Plex token

StreamForge needs the token of the account that **owns** the Plex server. A
shared user's token can't see sessions or history.

1. Open Plex Web and sign in as the server owner.
2. Open any movie, click **⋯ → Get Info**, then **View XML**.
3. The address of the page that opens ends in `X-Plex-Token=...`. Copy the
   value after the `=`.

Keep it private, because it gives full access to your Plex account.

If Plex is your **main** server you don't need a token: **Sign in with Plex**
handles it.

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
| Older plays filled into Watch history | ✓ (main server) | — | ✓ (main server) |
| Watched by everyone (Library health) | ✓ (main server) | — | — |
| Single sign-on | ✓ (main server) | — | — |
| Kometa collections | develop build | develop build | ✓ |

## How titles are matched across servers

StreamForge matches a movie or series across servers by its **TMDb, TVDB and
IMDb ids**, which your servers read from their metadata. File names and folder
layout don't matter, and neither do small title differences.

If a title isn't matched, check that it's identified correctly on that server
(Jellyfin and Emby: **Identify**; Plex: **Fix Match**).

## What changes with more than one server

With a single server StreamForge stays simple; nothing below appears. With two
or more:

- **Title pages** show a chip for every server under the title, with the best
  copy on each (such as "Homelab 4K DV · 1080p" or "Cabin 1080p HDR10"), or
  "not here". The **Where it's available** card lists each server's copies,
  when the title was added there, plays there, and an **Open** link. **Media
  info** has a tab for each copy on each server, and **Other servers** opens
  the title in another server's own app.
- **Watch history** and **Stats** get a **Played on** filter, and each play
  shows the server it was on.
- **Who's watched it** on title pages shows each person's server and device.

## Troubleshooting

- **Find on network doesn't find Plex or Emby:** in Plex, turn on **Enable
  local network discovery (GDM)** (Settings → Network). In Docker,
  discovery needs `network_mode: host`. You can always type the address.
- **A Plex server shows no streams or history:** you're probably using a
  shared user's token. Use the owner's token.
- **"Re-enter the API key when changing the server address":** a saved key is
  never sent to a new address. Paste the key again with the new address.
- **A title shows "not here" on a server that has it:** the server has it
  matched to a different TMDb or IMDb id. Fix the match on that server.
