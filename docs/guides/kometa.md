# Kometa

[Kometa](https://kometa.wiki) (previously Plex Meta Manager) builds
collections, overlays and playlists on your media servers on a schedule.
StreamForge works with it in two ways, and you can use either or both:

1. **Run reports.** Kometa sends StreamForge a webhook at each step of a run.
   StreamForge shows what happened, lists errors, and can notify you when a
   run fails.
2. **Collections from StreamForge.** You create collections in StreamForge.
   StreamForge writes them to its own file in Kometa's config folder, and
   Kometa builds them on its next run.

StreamForge never runs Kometa or changes your own Kometa files.

- [Part 1: Run reports (webhooks)](#part-1-run-reports-webhooks)
- [Part 2: Collections from StreamForge](#part-2-collections-from-streamforge)
  - [Step 1: Share Kometa's config folder](#step-1-share-kometas-config-folder)
  - [Step 2: Point StreamForge at the folder](#step-2-point-streamforge-at-the-folder)
  - [Step 3: Load StreamForge's files in Kometa](#step-3-load-streamforges-files-in-kometa)
  - [Step 4: Make a collection](#step-4-make-a-collection)
- [Collection options explained](#collection-options-explained)
- [A collection's page](#a-collections-page)
- [Jellyfin and Emby](#jellyfin-and-emby)
- [What StreamForge writes](#what-streamforge-writes)
- [Troubleshooting](#troubleshooting)

## Part 1: Run reports (webhooks)

Kometa has no API, but it can send webhooks. StreamForge receives them.

1. In StreamForge, go to **Settings → Services → Kometa** and switch on
   **Receive Kometa webhooks**.
2. Click **Copy config**. You get a block like this:

   ```yaml
   webhooks:
     error: http://streamforge:4000/api/hooks/kometa/k7Qe2mXv9TzLwR4nB8sYc1Pd
     run_start: http://streamforge:4000/api/hooks/kometa/k7Qe2mXv9TzLwR4nB8sYc1Pd
     run_end: http://streamforge:4000/api/hooks/kometa/k7Qe2mXv9TzLwR4nB8sYc1Pd
     version: http://streamforge:4000/api/hooks/kometa/k7Qe2mXv9TzLwR4nB8sYc1Pd
     changes: http://streamforge:4000/api/hooks/kometa/k7Qe2mXv9TzLwR4nB8sYc1Pd
     delete: http://streamforge:4000/api/hooks/kometa/k7Qe2mXv9TzLwR4nB8sYc1Pd
   ```

3. Paste it into Kometa's `config.yml`.
4. **Fix the address** so Kometa can reach StreamForge. In Docker that's
   usually the container name (`http://streamforge:4000`) if both are on the
   same Docker network, or your server's LAN IP (`http://192.168.1.10:4000`).
   It's never `localhost`. Keep the long code at the end.
5. Restart Kometa, or wait for its next run.

**Already sending webhooks to Discord or Notifiarr?** Make each entry a list
and add StreamForge's address to it:

```yaml
webhooks:
  error:
    - notifiarr
    - http://streamforge:4000/api/hooks/kometa/<your code>
  run_end:
    - https://discord.com/api/webhooks/...
    - http://streamforge:4000/api/hooks/kometa/<your code>
```

**What you get:** after the next run, **System Status** shows a Kometa card:
whether Kometa is running, the last run's time and counts (collections
created, updated and removed, items added and removed), a strip of recent
runs, errors with the library and collection they came from, a notice when a
newer Kometa is out, and recent collection changes. Under **Settings →
Notifications**, subscribe a channel to **Kometa errors** and **Kometa run
finished** (see the [notifications guide](notifications.md)).

**Security:** the long code in the address is what lets Kometa in, because
Kometa can't send a password. Keep it private. If it leaks, click **New
address** in Settings; the old one stops working straight away.

## Part 2: Collections from StreamForge

### Step 1: Share Kometa's config folder

StreamForge needs Kometa's config folder mounted **read-write**. If Kometa
keeps its config in `/opt/kometa/config` on your server, mount that same
folder into StreamForge at `/kometa`:

```yaml
services:
  kometa:
    image: kometateam/kometa:latest   # :develop for Jellyfin or Emby, see below
    container_name: kometa
    volumes:
      - /opt/kometa/config:/config
    environment:
      - KOMETA_TIMES=05:00            # when Kometa runs
      - TZ=Europe/London
    restart: unless-stopped

  streamforge:
    image: ghcr.io/ashveebee/streamforge:latest
    container_name: streamforge
    ports:
      - "4000:4000"
    volumes:
      - streamforge-data:/data
      - /opt/kometa/config:/kometa    # the same folder, read-write
    environment:
      - TZ=Europe/London
    restart: unless-stopped

volumes:
  streamforge-data:
```

Then run `docker compose up -d`.

> **Permissions:** StreamForge has to be able to create a `streamforge`
> folder inside the config folder. If Settings says it can't write to the
> folder, make the folder writable by the user StreamForge runs as (for
> example with `chown` or `chmod`), or create `streamforge` inside it yourself
> and make that writable.

### Step 2: Point StreamForge at the folder

Go to **Settings → Services → Kometa → Collections from StreamForge**:

- **Kometa config folder:** `/kometa` (the path inside the StreamForge
  container). The status line should say **Folder found, with Kometa's
  config.yml**.
- **Kometa runs at:** the time or times Kometa runs, matching `KOMETA_TIMES`,
  for example `05:00` or `05:00, 17:00`. StreamForge uses this to tell you
  when a change will appear. It doesn't start Kometa.
- **TMDb API key:** leave it blank if Kometa's `config.yml` has one under
  `tmdb: apikey:`. StreamForge reads it from there. It's used to show what's
  on TMDb lists before Kometa builds them.

Click **Save**. A **Kometa** entry appears in the sidebar.

### Step 3: Load StreamForge's files in Kometa

StreamForge writes one file per library, in
`config/streamforge/<server>-<library>.yml`. Kometa has to be told to load
them. Settings shows the exact lines for your libraries under **Then load
StreamForge's files in Kometa's config.yml**, with a **Copy** button.

Add each `- file:` line to that library's `collection_files` in Kometa's
`config.yml`. Keep your existing entries:

```yaml
libraries:
  Movies:
    collection_files:
      - default: imdb        # your existing entries stay
      - file: config/streamforge/plex-cabin-movies.yml   # add this
  TV Shows:
    collection_files:
      - file: config/streamforge/plex-cabin-tv-shows.yml
```

Library names (`Movies`, `TV Shows`) must match the names in Kometa's config,
which match the library names on your server.

StreamForge creates an empty file for every library as soon as the folder is
set up, so you can add these lines before you've made any collections and
Kometa won't complain about a missing file.

### Step 4: Make a collection

1. Open **Kometa** in the sidebar and click **New collection**.
2. Fill in the form (each option is explained below) and click **Add
   collection**.
3. The page shows **1 change waiting**, with when Kometa runs next.
4. After Kometa's next run the collection appears on your server, and its card
   in StreamForge changes from **Waiting** to **Built** (StreamForge checks
   the server about once a minute). With webhooks set up (part 1), the
   collection's page also shows what the run added and removed.

To change or remove a collection, open it and click **Edit** or **Remove**.
Removing a collection stops Kometa updating it; delete it on the server too
if you no longer want it there.

## Collection options explained

**Name:** what the collection is called on your server. It must be unique
within the library.

**Library:** which library on your media server it goes in.

**Build it from:** where the titles come from.

| Source | What to enter | Example |
| --- | --- | --- |
| **TMDb list** | The list's number or its address | `28` or `https://www.themoviedb.org/list/28` |
| **IMDb list** | The list's address | `https://www.imdb.com/list/ls000096828/` |
| **Trakt list** | The list's address | `https://trakt.tv/users/me/lists/favourites` |
| **Trending on TMDb** | Nothing, or how many titles (limit) | Top 20 this week |
| **Popular on TMDb** | Nothing, or how many titles (limit) | |
| **TMDb keyword** | The keyword's number or address | `207317` (Christmas) |
| **Hand-picked** | TMDb ids, separated by commas | `603, 604, 605` |

**Show it:** **Always**, or only **between two dates** (month and day), such
as 1 December to 31 December for a Christmas collection. Outside the dates
Kometa removes the collection, and puts it back when the dates come round.

**Order:** **Same as the list**, **Release date**, or **Alphabetical**.

**Missing titles:**

- **Leave them out:** only titles you already have go in the collection.
- **Send them to Radarr / Sonarr:** Kometa adds missing titles to Radarr
  (movies) or Sonarr (series). This needs Kometa's own `radarr:` or `sonarr:`
  section filled in in its `config.yml`. You can also add missing titles
  yourself from the collection's page in StreamForge, with your choice of
  quality profile and folder (see below).

**Show on Plex Home** (Plex only): pins the collection to the Home screen.
Needs Plex Pass.

## A collection's page

Open any collection to see:

- **Stats:** titles on the list, how many are in your library, how many are
  missing, and how many are in the collection on the server right now.
- **Titles:** tabs for **All**, **In library** and **Missing**. On the Missing
  tab admins can tick titles, or **Select all**, and **Add to Radarr/Sonarr**
  in one go, choosing the instance, quality profile, root folder and whether
  to search now. See the [Sonarr and Radarr guide](sonarr-radarr.md).
- **Settings:** what StreamForge asked Kometa to do.
- **History:** from Kometa's run reports, such as "Updated · +3 (Velvet
  Static, Iron Bloom, The Last Lighthouse) · −1". Needs webhooks (part 1).
- **Kometa config:** the YAML StreamForge wrote for this collection.
- **Open on Plex** (or Jellyfin or Emby).

StreamForge can only show what's on **TMDb** lists before Kometa builds them.
For **IMDb** and **Trakt** lists, the page shows what's in the collection on
the server.

The Kometa page also lists collections you made yourself in Kometa or on the
server. They're read-only in StreamForge, marked "From your own Kometa files
or the server".

## Jellyfin and Emby

Kometa's support for Jellyfin and Emby is in its **develop** (nightly) build
for now. The stable release is Plex-only. To use Kometa collections on
Jellyfin or Emby:

- Run Kometa's develop build (`kometateam/kometa:develop`) and connect your
  Jellyfin or Emby server in its `config.yml`, following Kometa's
  documentation for that build.
- StreamForge marks Jellyfin and Emby libraries with **needs Kometa develop
  build** in the New collection form.
- To make collections on your **main Jellyfin server**, add a Jellyfin API key
  under **Settings → Services → Jellyfin**. Extra Jellyfin and Emby servers
  already have one.

## What StreamForge writes

Everything goes in a `streamforge` folder inside Kometa's config folder, one
file per library. A file looks like this:

```yaml
# Managed by StreamForge. Changes made here are overwritten; edit these collections in StreamForge.
collections:
  "Oscar Winners":
    tmdb_list: "28"
    collection_order: custom
    sync_mode: sync
    visible_home: true
  "Christmas Movies":
    imdb_list: https://www.imdb.com/list/ls000096828/
    collection_order: release
    sync_mode: sync
    schedule: range(12/01-12/31)
    delete_not_scheduled: true
```

Don't edit these files by hand: StreamForge rewrites them whenever you change
a collection. Your own Kometa files are never touched.

## Troubleshooting

- **"StreamForge can't write to that folder":** mount it read-write (no
  `:ro`), and see the permissions note in
  [step 1](#step-1-share-kometas-config-folder).
- **"Folder found (no config.yml in it — is it the right folder?)":** the
  mount points at the wrong folder. Mount the folder that contains Kometa's
  `config.yml`.
- **A collection stays on Waiting:** check Kometa's log for that library.
  Usually the `- file:` line is missing from the library's `collection_files`
  (step 3), or the library name doesn't match.
- **Kometa says the file isn't found:** the path in `config.yml` must start
  with `config/streamforge/`, exactly as Settings shows it.
- **The Kometa card never updates:** Kometa can't reach the webhook address.
  From the Kometa container, run
  `wget -qO- http://streamforge:4000/ | head -c 100` (it should print the
  start of a web page), and check that StreamForge and Kometa share a Docker
  network.
- **A TMDb list shows no titles in StreamForge:** add a TMDb API key in
  Settings, or put one in Kometa's `config.yml` under `tmdb: apikey:`.
- **"TMDb list 8273 not found":** the list was deleted or made private on
  TMDb. Edit the collection and pick another list.
