## Unreleased

- Range “Yesterday” next to Today/7/30 days, CSV export of the current view, a click on a page or a 404 entry opens that address on the site (when one site is chosen) / Bereich „Gestern“ neben Heute/7/30 Tage, CSV-Export der aktuellen Ansicht, Klick auf eine Seite oder einen 404-Eintrag öffnet die Adresse auf der Website (wenn eine Website gewählt ist)
- Damaged or cut-off .gz logs are marked under “Logs read” instead of being skipped silently, and no longer stop the other logs / Beschädigte oder abgeschnittene .gz-Protokolle stehen unter „Gelesene Protokolle“ statt still übersprungen zu werden und halten die übrigen nicht mehr auf
- Fixes: Hostwerk’s “vcombined” log lines and its rotation into logs/archiv are read; left-out paths also hold for the counter script; “Keep days” could never be saved; 404 paths are shown decoded like pages; numbers and dates follow Hostwerk’s language; the tile says “Could not load” instead of dots forever; long paths show in full on hover; long site names no longer widen the site picker / Fehlerbehebungen: Hostwerks „vcombined“-Zeilen und die Rotation nach logs/archiv werden gelesen; ausgelassene Pfade gelten auch fürs Zählskript; „Tage aufbewahren“ ließ sich nie speichern; 404-Pfade dekodiert wie Seiten; Zahlen und Datum in Hostwerks Sprache; die Kachel zeigt „Konnte nicht laden“ statt endloser Punkte; lange Pfade beim Überfahren ganz lesbar; lange Website-Namen machen die Auswahl nicht mehr breit
- Manifest: sdkVersion 3.16 / Manifest: sdkVersion 3.16

## 1.2.2

- New animated icon and banner in the common Hostwerk style (isometric block). / Neues animiertes Symbol und Banner im gemeinsamen Hostwerk-Stil (isometrischer Block).

## 1.2.1

- The lists that scroll inside can be reached with the keyboard, with a visible focus (WCAG) / Die Listen, die in sich scrollen, sind per Tastatur erreichbar, mit sichtbarem Fokus (WCAG)

## 1.2.0

- Numbers first: settings, counter script and the list of logs moved into “Set up …” (side sheet in newer Hostwerk, dialog before); the six lists stand three per row with equal height and scroll inside, the key figures of a row are equally high; without visitors only the empty state with “Set up …” / Zahlen zuerst: Einstellungen, Zählskript und gelesene Protokolle stehen unter „Einrichten …“ (in neueren Hostwerk-Versionen als Seitenblatt, sonst als Dialog); die sechs Listen stehen zu dritt, gleich hoch und scrollen in sich, die Kennzahlen einer Reihe sind gleich hoch; ohne Besucher nur der Leerzustand mit „Einrichten …“

## 1.1.0

- Lives where it belongs: Web servers → Visitors and the dashboard tile – no own sidebar entry any more (Hostwerk 3.0+); the full page stays under Extensions → Open and can be pinned in the sidebar settings. / Steckt jetzt dort, wo sie hingehört: Webserver → Besucher und Übersichtskachel – kein eigener Seitenleisten-Eintrag mehr (Hostwerk 3.0+); die ganze Seite bleibt unter Erweiterungen → Öffnen und lässt sich in den Seitenleisten-Einstellungen anheften.

## 1.0.0

- First release: cookie-free visitor stats from the access logs of Hostwerk's web servers (Apache/nginx combined, Caddy JSON, rotated and gzipped files), pages, sources, devices, browsers, systems, 404s, bots filtered out, today/7/30 days, optional counter script, overview tile. / Erste Fassung: cookiefreie Besucher-Statistik aus den Zugriffsprotokollen der Hostwerk-Webserver (Apache/nginx Combined, Caddy JSON, rotierte und gepackte Dateien), Seiten, Herkunft, Geräte, Browser, Systeme, 404-Fehler, Bots herausgefiltert, Heute/7/30 Tage, optionales Zählskript, Kachel für die Übersicht.
