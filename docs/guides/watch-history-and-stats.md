# Watch history and stats

StreamForge records who watched what, where and how, and turns it into a
**Watch history** page, a **Stats** page and **Who's watched it** on title
pages.

- [How plays are recorded](#how-plays-are-recorded)
- [Watch history](#watch-history)
- [Stats](#stats)
- [Who's watched it](#whos-watched-it)
- [Privacy](#privacy)

## How plays are recorded

StreamForge checks what's playing on your **media server** every 30 seconds
and records each play: the person, the title and episode, the app and device,
whether it played directly or transcoded, and how long they
actually watched (paused time isn't counted). Plays under a minute are treated
as someone browsing and left out.

To record in the background, StreamForge needs:

- **Jellyfin:** a Jellyfin API key under **Settings → Services → Jellyfin**
  (Dashboard → API Keys in Jellyfin).
- **Plex or Emby:** nothing extra; the key from setup is used.

**Before StreamForge was installed.** The recorder only knows plays from the
day you install StreamForge. Older plays are filled in from the media server's
own record, so the pages aren't empty on day one:

- **Jellyfin:** the last time each person finished each movie and episode.
  Rewatches before StreamForge aren't known.
- **Plex:** Plex's watch history.
- **Emby:** not available, so history starts when StreamForge was installed.

These older plays show the title and date, but not the device or how long was
watched. Nothing is listed twice: the server's record only fills in the time
before StreamForge's first play for that person.

## Watch history

**Watch history** in the sidebar (admins only) shows every play by everyone.

- **People:** pick **Everyone** or one person. Each shows how many plays they
  have in the range and when they last watched.
- **Time range:** 7 days, 30 days, 90 days, a year, or all time.
- **Find a title:** narrows the list to matching titles.
- **Summary:** plays (movies and episodes), time watched, different titles,
  share transcoded, most-watched titles and, for one person, the device they
  usually use.
- **The list:** grouped by day. Each play shows the poster, time, person,
  title and episode, server, app and device, how long they watched, and a
  **Transcode** tag where it applies. Click a play to open the title's page.

Links keep your filters, so you can bookmark "Sam's last 90 days" or share it
with another admin.

## Stats

**Stats** in the sidebar shows:

- Plays, watch time, viewers and share transcoded for 7 days, 30 days, 90
  days or a year.
- Plays per day, split into direct play and transcode.
- **Top viewers**, **Most watched** and **Clients**. Click a viewer to open
  their watch history for the same range (admins), or a title to open its page.
- A weekday-by-hour heatmap of when people watch.

Without a Jellyfin API key, figures come from Jellyfin's activity log, which
has plays but no watch time or transcode details. A note on the page says so.

## Who's watched it

Admins see **Who's watched it** on a title's page: each person who has watched
it, how far they got (or Finished), when, how many times, and on which
device. Click a name to open their watch history.

## Privacy

- **Watch history** and **Who's watched it** are for **admins only**.
- Everyone gets their own history on **their own page** (click your name in
  the sidebar). Members only ever see their own.
- **Stats** is visible to whoever can see the Stats page (set under
  **Settings → Access**).
- Play records stay in StreamForge's database on your server. Nothing is sent
  anywhere.
