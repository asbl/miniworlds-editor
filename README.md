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

Browsertests (brauchen Netz für Pyodide und PyPI; Python mit Playwright): `npm run build`, dann
- gegen `npx vite preview --port 4173`: Editor-Kern `test/smoke.py`, Python-Laufzeit `test/run.py`, miniworlds-Ansicht `test/miniworlds.py`, Vorlagen und Bilder `test/templates.py`, Editor-Hilfen `test/assist.py`;
- mit eigenem Server (kein Preview nötig): PWA und Offline `test/pwa.py`, Einbetten `test/embed.py`, Selbst-Hosting `test/selfhost.py`.

Aufruf: `python test/<name>.py [chromium|firefox]`. Die CI (`.github/workflows/ci.yml`) führt Unit-Tests, Build, Größenbudget und alle Browsertests in Chromium aus.

Lizenz: MIT.
