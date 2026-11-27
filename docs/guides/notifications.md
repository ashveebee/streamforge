# Notifications

StreamForge can tell you when something needs attention: a service goes down,
a disk fills up, a request is waiting, Kometa fails, and more.

## Add a channel

Go to **Settings → Notifications**, click **Add a channel**, and pick a type:

| Channel | What you need |
| --- | --- |
| **Discord** | A webhook URL: in Discord, Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL |
| **ntfy** | A topic name, such as `streamforge-alerts`. Optionally your own server (default `https://ntfy.sh`) and an access token for protected topics |
| **Pushover** | Your user key, and an application token (create an application at pushover.net) |
| **Webhook** | Any URL that accepts a JSON `POST`. Optionally a signing secret, which adds an `X-StreamForge-Signature` HMAC header |
| **Push** | Nothing: click **Push to this device** in the browser or installed app you want alerts on. Needs HTTPS |

Then tick the events that channel should hear about, and save. Each channel
has its own events, so you can send outages to ntfy and the weekly digest to
Discord, say. Use the switch to pause a channel without deleting it.

Webhook URLs, tokens and keys stay on the server. The browser only ever sees
that one is saved.

## Events

| Event | Sent when |
| --- | --- |
| **Service goes offline** | A service or media server stops answering |
| **Service back online** | It recovers |
| **Disk almost full** | A disk passes the alert level (set on the storage forecast card on **System Status**) |
| **Auto-import succeeded** | A stuck download was imported |
| **Import failed or gave up** | An import failed, or auto-import gave up |
| **Stalled download removed** | Stalled download cleanup removed something |
| **New request to approve** | Someone made a request in Seerr (or in Silo, when Silo's own requests are on) |
| **Transcode and bandwidth alerts** | Too many transcodes, too much bandwidth, or a 4K file transcoding |
| **Weekly digest** | Every week: what was added and what people watched |
| **StreamForge update available** | A new release is out |
| **Kometa errors** | A Kometa run hit an error (needs [Kometa webhooks](kometa.md#part-1-run-reports-webhooks)) |
| **Kometa run finished** | A Kometa run ended, with what changed |
| **Rule alerts** | A rule you made under **Rules** fired with a "notify" action |

## Push notifications on your phone

1. Open StreamForge over **HTTPS** (see the
   [install guide](install.md#5-reach-it-from-outside-reverse-proxy-or-tailscale)).
2. On iPhone and iPad, add it to the Home Screen first (Share → Add to Home
   Screen) and open it from there.
3. Go to **Settings → Notifications** and click **Push to this device**.
4. Choose the events in the **Push** channel.
