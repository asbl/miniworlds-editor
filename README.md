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

Weiterführend: [Veröffentlichen, Offline, config.json](docs/deploy.md) · [Einbetten in Moodle per postMessage](docs/embed.md) · [Gemeinsam arbeiten (Relay)](docs/collab.md).

Browsertests (brauchen Netz für Pyodide und PyPI; Python mit Playwright): `npm run build`, dann
- gegen `npx vite preview --port 4173`: Editor-Kern `test/smoke.py`, Python-Laufzeit `test/run.py`, miniworlds-Ansicht `test/miniworlds.py`, Vorlagen und Bilder `test/templates.py`, Editor-Hilfen `test/assist.py`, schmale Bildschirme `test/responsive.py`, Verlauf `test/history.py`, Welt in Fenster/Vollbild/Tab `test/world.py`, `input()` `test/input.py`, Links für Aufgaben `test/launch.py`, Ton `test/sound.py`, Klasse umbenennen `test/rename.py`, Content-Security-Policy `test/csp.py`, Speicher (Linux) `test/memory.py`, Barrierefreiheit (axe) `test/a11y.py`, Angebot des Experimentiermodus `test/experiment.py`;
- mit eigenem Server (kein Preview nötig): PWA und Offline `test/pwa.py`, Einbetten `test/embed.py`, Selbst-Hosting `test/selfhost.py`.

Aufruf: `python test/<name>.py [chromium|firefox]`. Die CI (`.github/workflows/ci.yml`) führt Unit-Tests, Build, Größenbudget und alle Browsertests in Chromium aus.

Lizenz: MIT.

Der [optionale Git-Modus](docs/git-mode.md) bietet Klonen, lokale Commits, Pull und
Push. Aktivierung unter **⚙ → Git-Modus aktivieren (erweitert)**; ohne Aktivierung
bleiben die Git-Werkzeuge ausgeblendet. Für GitHub ist ein vertrauenswürdiger
Git-CORS-Proxy erforderlich (Hosting-Hinweise in der Dokumentation).


Das optionale Unterrichtsbackend liegt separat in
[miniworlds-editor-backend](https://github.com/asbl/miniworlds-editor-backend).
Der Editor lässt sich ohne dieses Repository klonen, bauen und verwenden.
[Backend-Anbindung und Kompatibilitätsprüfung](docs/backend.md).
