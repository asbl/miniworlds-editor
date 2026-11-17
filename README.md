# miniworlds-editor

Leichtgewichtiger, miniworlds-first Editor im Browser (Pyodide-first). Siehe [PLAN.md](PLAN.md).

```sh
npm install
npm run dev        # Entwicklungsserver
npm test           # Unit-Tests (Vitest)
npm run build      # Typecheck + Produktions-Build nach dist/
npm run size       # Größenbudget der App-Shell prüfen (≤ 2 MB gzip)
```

Browsertest des Editor-Kerns: `npm run build && npx vite preview --port 4173`, dann `python test/smoke.py [chromium|firefox]` (benötigt Python mit Playwright).

Lizenz: MIT.
