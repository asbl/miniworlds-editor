# miniworlds-editor

Leichtgewichtiger, miniworlds-first Editor im Browser (Pyodide-first). Siehe [PLAN.md](PLAN.md).

```sh
npm install
npm run dev        # Entwicklungsserver
npm test           # Unit-Tests (Vitest)
npm run build      # Typecheck + Produktions-Build nach dist/
npm run size       # Größenbudget der App-Shell prüfen (≤ 2 MB gzip)
```

Smoketest im echten Browser: `test/smoke.py` (benötigt Playwright).

Lizenz: MIT.
