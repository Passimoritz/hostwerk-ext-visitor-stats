![Visitor stats](banner.svg)

# Visitor stats

How many visitors do your sites get? Reads the access logs of your Hostwerk web servers (Apache, nginx, Caddy) – no cookies, no fingerprinting, IP addresses only shortened. Pages, sources, devices, bots filtered out. Everything stays on this PC.

[Deutsch](README.de.md) · An official [Hostwerk](https://github.com/Passimoritz/hostwerk-public) extension (SDK 2.7, native extension)

## What it does

- Reads the access logs of every Hostwerk web server (Apache and nginx combined format, Caddy JSON) – also rotated and gzipped files
- Pages, sources (referrers), devices, browsers and systems – roughly, no fingerprinting
- Bots, crawlers, uptime checks and files like images or scripts are filtered out
- Today, 7 days, 30 days – per site or all together, plus a tile for the overview
- Optional tiny counter script (no cookies, honours Do Not Track) for single-page apps
- IP addresses are only stored shortened and turned into a daily changing hash – nothing leaves this PC

## How it counts

- **Source:** the access log of every Hostwerk web server (`<Hostwerk>/logs/<server>_access.log`, as set up in the web
  server configuration) plus `CustomLog` / `access_log` / `output file` lines in the server's own settings. Apache and
  nginx write the *combined* format, Caddy JSON – both are read.
- **Only new lines:** each file is recognised by its first line, not its name. When a log is rotated (`access.log.1`,
  `access.log.2.gz`, `access.log-20261021.gz` …) it keeps its read position – gzipped files are unpacked on the fly,
  nothing is counted twice. Every 5 minutes and whenever you open the page.
- **Page views:** `GET` requests with status 2xx/304 for pages – images, scripts, styles, fonts, `favicon.ico`,
  `robots.txt` and `.well-known` are left out. `/index.html` and `/index.php` count as `/`, query strings are dropped.
- **Bots:** empty user agents, crawlers, link previews, monitors (also Hostwerk's own checks), scripts like curl and
  probes such as `/wp-login.php` or `/.env` are counted only as “bots left out”.
- **Visitors:** per day and site a hash of a random daily salt + shortened IP + browser group + system group + device
  type. The salt is thrown away after two days; only the count stays. Visits from this PC (localhost) do not count
  unless you switch that on.
- **Sources:** the host of the referrer (without `www.`); links between your own pages and from localhost are not sources.

## Counter script (optional)

For single-page apps or cached pages, copy the script from the page into your HTML. It sends one tiny request per page
to **your own site** (`/.hostwerk-count?p=/path&r=source&d=m|t|d`) – that request lands in the same access log.
No cookies, no browser storage, nothing about the browser beyond the window width as phone/tablet/computer; with
*Do Not Track* or *Global Privacy Control* it does nothing. On days the script reports, its numbers replace the
page requests of the log for that site (never both). *Put counter file into site folders* creates an empty
`.hostwerk-count` so the server answers 200 instead of 404.

## Install

In Hostwerk: **Extensions → Discover** and click “Install”.

Native extensions run as part of Hostwerk (own server and interface part). That is why Hostwerk only installs them from the official catalogue (with checksum) or in developer mode.

## Data

`<Hostwerk>/data/visitor-stats/` – daily totals per site (kept 400 days by default) and the read position of each log file. The logs themselves stay untouched. Removing the extension deletes nothing.

## Limits

- Apache and nginx write one log per web server without the host name, so the numbers are per web server, not per
  domain (Caddy logs carry the host; it is used to recognise internal links).
- Visitors are counted per day – the same person on two days counts twice in “7 days”. That is the price of not
  recognising anyone.

## Develop

```bash
node --test tests/*.test.js          # tests
node build-native.js .               # build the interface (sdk/build-native.js from hostwerk-public)
node check.js . --strict             # same check as the catalogue (sdk/check.js)
```

Interface source in `ui/src`, server part in `server/`. Texts in the code are English, German is in `locales/de.json`.

## License

MIT
