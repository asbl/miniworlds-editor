# miniworlds-editor

Leichtgewichtiger, miniworlds-first Editor im Browser (Pyodide-first). Siehe [PLAN.md](PLAN.md).

```sh
npm install
npm run dev        # Entwicklungsserver
npm test           # Unit-Tests (Vitest)
npm run build      # Typecheck + Produktions-Build nach dist/ (inkl. Service Worker)
npm run size       # Größenbudget prüfen (Shell ≤ 2 MB gzip, Hintergrund-WASM ≤ 5 MB gzip)
npm run selfhost   # Pyodide nach dist/pyodide/ legen (Schulnetze ohne CDN)
```

Weiterführend: [Veröffentlichen, Offline, config.json](docs/deploy.md) · [Einbetten in Moodle per postMessage](docs/embed.md).

## Projekte per Link teilen

Im Projektmenü **Als Link teilen …** wählen und den Projektlink kopieren. Er enthält einen komprimierten Stand aller Projektdateien, einschließlich eingebetteter Bilder und Sounds sowie der Projektkonfiguration. Ungespeicherte Editoränderungen werden vorher gespeichert. Verlauf und Cache-Dateien werden nicht geteilt.

Im selben Dialog lässt sich über **QR-Code anzeigen** ein QR-Code zum Scannen oder Speichern als PNG erstellen. Das geschieht vollständig lokal, ohne externen QR-Dienst. Ein QR-Code enthält den vollständigen Link und hat deutlich weniger Platz als ein normaler Projektlink. Passt das Projekt nicht hinein, bleibt der Link kopierbar und der Dialog zeigt einen Hinweis. Die Lesbarkeit vor dem Unterricht mit einem Smartphone testen.

Der Inhalt liegt ausschließlich im URL-Fragment (`#project=v1.…`); es gibt keinen Upload und keinen Speicherdienst. Beim Öffnen entsteht eine neue lokale Kopie, vorhandene Projekte bleiben erhalten. Das Programm startet erst per Start-Schaltfläche. Nach dem Import wird der Fragmentinhalt aus der Adresszeile entfernt; Neuladen öffnet die lokale Kopie. Änderungen werden erst mit einem neuen Link weitergegeben. Jeder mit dem Link kann den Inhalt lesen; verteilte Links lassen sich nicht zurückrufen.

Grenzen: 64 KiB für den gesamten erzeugten Link, 5 MiB Dateiinhalt und 100 Dateien. Ab 8.000 Zeichen erscheint ein Hinweis, weil Moodle, Messenger oder QR-Codes eigene Grenzen haben können. Große Medien verkleinern oder das Projekt als ZIP verteilen. Links vor dem Unterricht über den tatsächlichen Verteilweg testen. Das Fragment wird beim normalen HTTP-Aufruf nicht an den Server übertragen; Hosting und externe Bibliotheksdownloads bleiben davon unabhängig.

Browsertests (brauchen Netz für Pyodide und PyPI; Python mit Playwright): `npm run build`, dann
- gegen `npx vite preview --port 4173`: Editor-Kern `test/smoke.py`, Python-Laufzeit `test/run.py`, miniworlds-Ansicht `test/miniworlds.py`, Vorlagen und Bilder `test/templates.py`, Editor-Hilfen `test/assist.py`, schmale Bildschirme `test/responsive.py`, Verlauf `test/history.py`, Welt in Fenster/Vollbild/Tab `test/world.py`, `input()` `test/input.py`, Links für Aufgaben `test/launch.py`, Ton `test/sound.py`, Klasse umbenennen `test/rename.py`, Content-Security-Policy `test/csp.py`, Speicher (Linux) `test/memory.py`, Barrierefreiheit (axe) `test/a11y.py`;
- mit eigenem Server (kein Preview nötig): PWA und Offline `test/pwa.py`, Einbetten `test/embed.py`, Selbst-Hosting `test/selfhost.py`.

Aufruf: `python test/<name>.py [chromium|firefox]`. Die CI (`.github/workflows/ci.yml`) führt Unit-Tests, Build, Größenbudget und alle Browsertests in Chromium aus.

Lizenz: MIT.
