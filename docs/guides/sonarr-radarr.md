# Sonarr and Radarr

StreamForge shows your Sonarr and Radarr queues, calendars and disk space, and
lets admins add titles, clear stuck downloads and free up space.

- [Connecting](#connecting)
- [More than one instance (4K, anime)](#more-than-one-instance-4k-anime)
- [Adding a title](#adding-a-title)
- [Adding many titles at once](#adding-many-titles-at-once)
- [The add options explained](#the-add-options-explained)
- [Freeing up space](#freeing-up-space)
- [Stuck downloads and auto-import](#stuck-downloads-and-auto-import)

## Connecting

1. In Sonarr or Radarr, go to **Settings → General → Security** and copy the
   **API Key**.
2. In StreamForge, go to **Settings → Services → Sonarr** (or Radarr), enter
   the address (for example `http://sonarr:8989` or
   `http://192.168.1.10:7878`) and the key.
3. Click **Test connection**, then **Save**.
4. Optionally set **Public address**, the address you open it at in a
   browser, so **Open in Sonarr** links work from your phone.

See the [install guide](install.md#4-docker-networking-which-address-to-use)
if the test can't reach it.

## More than one instance (4K, anime)

Running a second Radarr for 4K, or a separate Sonarr for anime? Add it under
the main Sonarr or Radarr card in Settings: **Add instance**, give it a name
(such as "4K"), then its address and key.

Each instance gets its own tab, health check, and place in the queues,
calendar and download charts. When you add a title you choose which instance
it goes to.

## Adding a title

Admins can add a movie or series from its page in StreamForge (open it from
⌘K search, a Kometa collection, Seerr or anywhere else):

1. Click **Add to Radarr…** (or **Add to Sonarr…**).
2. Pick the options (explained below). The dialog starts with what you chose
   last time for that instance.
3. Click **Add**.

Titles already in any instance of that kind are skipped, so you won't end up
with the same movie in Radarr and Radarr 4K by accident. Everyone else can
request titles through Seerr instead, if it's connected (or through Silo's own
requests, when Silo is your media server and they're switched on).

## Adding many titles at once

On a [Kometa collection's](kometa.md#a-collections-page) **Missing** tab:

1. Tick the titles you want, or click **Select all**.
2. Click **Add N to Radarr…** (or Sonarr).
3. The dialog lists each title with **Will add** or **Already in … ·
   skipped**. Pick the options and click **Add N movies**.
4. Each title then shows **Added**, **Skipped** or **Failed** with the reason,
   such as "Radarr couldn't find it".

Searches go out one after another, so your indexers aren't flooded.

## The add options explained

| Option | What it does |
| --- | --- |
| **Instance** | Which Radarr or Sonarr to add to, when you have more than one |
| **Quality profile** | The profile from that instance, such as HD-1080p or Ultra-HD |
| **Root folder** | Where files go, with the free space on each. Folders the app can't reach are greyed out |
| **Minimum availability** (Radarr) | When Radarr starts looking: **Announced**, **In cinemas** or **Released** |
| **Monitor** (Sonarr) | Which episodes to monitor: all, future, missing, existing, first season, latest season, pilot only, or none |
| **Monitor** | Whether the title is monitored at all. Unmonitored titles are added but not searched for or upgraded |
| **Search now** | Start a search as soon as it's added. Needs Monitor on |
| **Add tag "streamforge"** | Tags it in Radarr or Sonarr so you can see what came from StreamForge |

Your choices are remembered per instance for next time.

## Freeing up space

**Library health** (in the sidebar) has two cards that help you clear space.

**Cleanup suggestions** lists big movies and series nobody has watched in 3
months, 6 months, 1 year or 2 years, biggest first, with the space each would
free. Every play on your media server counts. Titles added recently are never
suggested.

**Watched by everyone** lists movies and series that every person you choose
has finished, biggest first. A series counts once every episode is watched.

1. Under **Who counts**, click to leave out accounts that never watch
   anything, such as an admin or test account. Otherwise nothing will ever
   count as watched by everyone.
2. Tick titles, or **Select all**.
3. Click **Stop monitoring** (keeps the files, stops upgrades and new
   episodes) or **Delete** (removes the title and its files from disk).

On both cards, the bookmark button on a row means **Keep**: the title is
never suggested again. Removing always goes through Sonarr or Radarr, so
nothing gets downloaded again. **Watched by everyone** needs Jellyfin as your
media server, because it uses Jellyfin's watched status for each user.

## Stuck downloads and auto-import

- **Queue actions:** on the Sonarr and Radarr pages admins can blocklist and
  search again, remove a download (with or without deleting it), or grab a
  delayed release now. Rows show how long a download has been stalled.
- **Stalled download cleanup** (on the **System Status** page): handles
  downloads stuck for a set number of hours, by blocklisting and searching
  again or by removing them, across every Sonarr and Radarr instance.
- **Auto-import:** finds finished downloads that couldn't be imported (often
  because of a name mismatch) and imports them when it can match the title.
