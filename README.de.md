![Besucher-Statistik](banner.svg)

# Besucher-Statistik

Wie viele Besucher haben deine Seiten? Liest die Zugriffsprotokolle deiner Hostwerk-Webserver (Apache, nginx, Caddy) aus – ohne Cookies, ohne Fingerabdruck, IP-Adressen nur gekürzt. Seiten, Herkunft, Geräte, Bots herausgefiltert. Alles bleibt auf diesem PC.

[English](README.md) · Eine offizielle [Hostwerk](https://github.com/Passimoritz/hostwerk-public) Erweiterung (SDK 2.7, native Erweiterung)

## Was sie kann

- Liest die Zugriffsprotokolle jedes Hostwerk-Webservers (Apache und nginx im Combined-Format, Caddy als JSON) – auch rotierte und gepackte Dateien
- Seiten, Herkunft (Verweise), Geräte, Browser und Systeme – grob, ohne Fingerabdruck
- Bots, Crawler, Erreichbarkeits-Prüfungen und Dateien wie Bilder oder Skripte werden herausgefiltert
- Heute, 7 Tage, 30 Tage – je Seite oder alle zusammen, dazu eine Kachel für die Übersicht
- Auf Wunsch ein winziges Zählskript (ohne Cookies, achtet auf „Do Not Track“) für Single-Page-Apps
- IP-Adressen werden nur gekürzt verarbeitet und in einen täglich wechselnden Hash verwandelt – nichts verlässt diesen PC

## So wird gezählt

- **Quelle:** das Zugriffsprotokoll jedes Hostwerk-Webservers (`<Hostwerk>/logs/<server>_access.log`, wie in der
  Webserver-Konfiguration eingerichtet) plus `CustomLog`-/`access_log`-/`output file`-Zeilen in den eigenen
  Einstellungen des Servers. Apache und nginx schreiben das *Combined*-Format, Caddy JSON – beides wird gelesen.
- **Nur neue Zeilen:** Jede Datei wird an ihrer ersten Zeile erkannt, nicht am Namen. Wird ein Protokoll rotiert
  (`access.log.1`, `access.log.2.gz`, `access.log-20261021.gz` …), behält es seine Leseposition – gepackte Dateien
  werden beim Lesen entpackt, nichts zählt doppelt. Alle 5 Minuten und immer, wenn du die Seite öffnest.
- **Seitenaufrufe:** `GET`-Anfragen mit Status 2xx/304 auf Seiten – Bilder, Skripte, Stile, Schriften, `favicon.ico`,
  `robots.txt` und `.well-known` bleiben draußen. `/index.html` und `/index.php` zählen als `/`, Parameter fallen weg.
- **Bots:** leere User-Agents, Crawler, Link-Vorschauen, Prüfdienste (auch Hostwerks eigene), Skripte wie curl und
  Angriffsversuche wie `/wp-login.php` oder `/.env` zählen nur als „herausgefilterte Bots“.
- **Besucher:** je Tag und Website ein Hash aus täglich zufälligem Salz + gekürzter IP + Browser-Gruppe + System-Gruppe +
  Geräteart. Das Salz wird nach zwei Tagen weggeworfen, nur die Anzahl bleibt. Besuche von diesem PC (localhost) zählen
  nicht, außer du schaltest das ein.
- **Herkunft:** der Host des Verweises (ohne `www.`); Links zwischen deinen eigenen Seiten und von localhost zählen nicht.

## Zählskript (optional)

Für Single-Page-Apps oder Seiten aus einem Zwischenspeicher das Skript von der Seite in dein HTML kopieren. Es schickt je
Seite eine winzige Anfrage an **deine eigene Website** (`/.hostwerk-count?p=/pfad&r=herkunft&d=m|t|d`) – sie landet im
selben Zugriffsprotokoll. Keine Cookies, kein Browser-Speicher, über den Browser nur die Fensterbreite als
Handy/Tablet/Computer; bei *Do Not Track* oder *Global Privacy Control* tut es nichts. An Tagen, an denen das Skript
meldet, ersetzen seine Zahlen die Seitenaufrufe aus dem Protokoll dieser Website (nie beides). *Zähldatei in die
Website-Ordner legen* legt eine leere `.hostwerk-count` an, damit der Server mit 200 statt 404 antwortet.

## Installieren

In Hostwerk: **Erweiterungen → Entdecken** und „Installieren“ klicken.

Native Erweiterungen laufen als Teil von Hostwerk (eigener Server- und Oberflächen-Teil). Deshalb installiert Hostwerk sie nur aus dem offiziellen Katalog (mit Prüfsumme) oder im Entwickler-Modus.

## Daten

`<Hostwerk>/data/visitor-stats/` – Tagessummen je Seite (standardmäßig 400 Tage) und die Leseposition je Protokolldatei. Die Protokolle selbst bleiben unberührt. Entfernen der Erweiterung löscht nichts.

## Grenzen

- Apache und nginx schreiben ein Protokoll je Webserver ohne Hostnamen – die Zahlen gelten daher je Webserver, nicht je
  Domain (Caddy-Protokolle enthalten den Host; er dient zum Erkennen interner Links).
- Besucher werden je Tag gezählt – dieselbe Person an zwei Tagen zählt bei „7 Tage“ doppelt. Das ist der Preis dafür,
  niemanden wiederzuerkennen.

## Entwickeln

```bash
node --test tests/*.test.js          # Tests
node build-native.js .               # Oberfläche bauen (sdk/build-native.js aus hostwerk-public)
node check.js . --strict             # dieselbe Prüfung wie der Katalog (sdk/check.js)
```

Oberfläche in `ui/src`, Server-Teil in `server/`. Texte im Code sind Englisch, Deutsch steht in `locales/de.json`.

## Lizenz

MIT
