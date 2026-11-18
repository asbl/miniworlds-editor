# Veröffentlichen

Der Editor ist eine **statische Seite**: Inhalt von `dist/` auf einen Webserver kopieren, fertig. Kein Node und kein Python auf dem Server.

```bash
npm ci
npm run build          # Typprüfung + Build nach dist/ (Service Worker inklusive)
npm run size           # Größenbudget: Shell <= 2 MB gzip, Hintergrund-WASM <= 5 MB gzip
npm run selfhost       # optional: Pyodide nach dist/pyodide/ legen und config.json darauf zeigen lassen
                       # (Version und Paketliste stammen aus src/runtime/config.ts, Downloads werden auf Vollständigkeit und Prüfsumme geprüft)
```

Die Seite läuft in jedem Ordner (alle URLs sind relativ). **HTTPS ist nötig** (Service Worker, OPFS); `http://localhost` genügt zum Ausprobieren.

## Betrieb auf editor.opencoding.de

Der Server betreibt jede Seite als eigenen nginx-Container hinter dem gemeinsamen Traefik (Zertifikat über `alpnresolver`). Für den Editor liegt in `~/projects/editor/` auf dem Server:

```
docker-compose.yml   aus deploy/ (Host `editor.opencoding.de`, Labels wie bei den anderen Seiten)
nginx.conf           aus deploy/ (MIME-Typen für .mjs/.webmanifest, Cache-Header, Content-Security-Policy, gzip)
html/                Inhalt des Builds, von scripts/deploy.sh hochgeladen
```

**Update einspielen** (Tests, Build, Größenprüfung, Selbst-Hosting, Upload; der Container muss nicht neu starten):

```bash
DEPLOY_TARGET=<user>@<server>:/home/<user>/projects/editor DEPLOY_SSH_PORT=<port> scripts/deploy.sh
python test/live.py https://editor.opencoding.de/ chromium     # Kontrolle der veröffentlichten Seite
```

**Erstmalig:** Ordner anlegen, `deploy/docker-compose.yml` und `deploy/nginx.conf` hineinkopieren, `docker compose up -d`; das Zertifikat holt Traefik beim ersten Aufruf.

`deploy/config.production.json` wird beim Deploy zur `config.json` (Links zu den anderen IDE-Varianten auf `miniworlds.opencoding.de`, `embedOrigins` = `https://www.opencoding.de`);
`pyodideBase` ergänzt das Skript. Zugangsdaten und Adressen des Servers stehen nicht im Repository, nur in der Umgebung. Wer einbetten darf, steht zweimal:
`embedOrigins` (Editor) und `frame-ancestors` in `deploy/nginx.conf` (Server); beide ändern, wenn sich die Moodle-Adresse ändert.
Rechte: `html/` muss für den Container lesbar sein (das Skript setzt sie).

## Serverhinweise

| Was | Empfehlung |
|---|---|
| `*.wasm` | `Content-Type: application/wasm` |
| `*.webmanifest` | `application/manifest+json` |
| `index.html`, `sw.js`, `config.json` | `Cache-Control: no-cache` (Updates sollen sofort gefunden werden) |
| `assets/*` | dürfen lange gecacht werden (Dateinamen enthalten den Hash) |
| Einbetten | `frame-ancestors` in der Content-Security-Policy begrenzt, wer den Editor einbetten darf |
| Content-Security-Policy | `deploy/nginx.conf` setzt Skripte und Worker nur vom eigenen Ursprung (plus `'unsafe-eval'`: Pyodide baut beim Laden von pygame-ce Funktionen aus Zeichenketten, `'wasm-unsafe-eval'` allein reicht nicht) und das Netz nur für PyPI (`pypi.org`, `files.pythonhosted.org`). `test/csp.py` startet den selbst gehosteten Editor unter genau dieser Zeile (als echter HTTP-Header, damit auch der Worker daran gebunden ist). Wer Pyodide nicht selbst hostet, sondern vom CDN lädt, muss `https://cdn.jsdelivr.net` in `script-src` und `connect-src` ergänzen. |

## Laufzeit-Konfiguration: `config.json`

Liegt neben `index.html` und lässt sich ändern, ohne neu zu bauen (Vorlage: `config.example.json`). Alles ist optional.

| Schlüssel | Bedeutung |
|---|---|
| `pyodideBase` | Wo Pyodide herkommt. Vorgabe: jsDelivr. Mit `npm run selfhost` automatisch `./pyodide/v0.29.3/full/`. |
| `links` | `[{ "label": "…", "url": "https://…" }]`: Menü „Weitere Editoren“ (z. B. die Java- und Block-Varianten der `miniworlds-ide`). Nur `http(s)`. |
| `lowMemory` | `"auto"` (Vorgabe), `true` oder `false`. Auf Geräten mit höchstens 4 GB RAM (`navigator.deviceMemory`, nur Chromium; sonst gilt das Gerät als geräumig) läuft das zweite Python der Editor-Hilfen nur, solange jemand tippt; es startet beim ersten Tippen, bei Vervollständigung oder Klick auf die Statusanzeige und schläft nach 5 Minuten ohne Nutzung wieder ein. Spart etwa 130 MB. |
| `embedOrigins` | Seiten, die den Editor einbetten dürfen, siehe `docs/embed.md`. **Ohne Eintrag darf niemand**; `["*"]` erlaubt alle. |

## Offline und Updates

- Beim ersten Besuch lädt der Service Worker die App-Dateien (ca. 0,7 MB, dazu die ruff-WASM mit 3,5 MB gzip). Pyodide und die benutzten miniworlds-Versionen kommen beim ersten Start dazu
  und liegen dann im Cache (ca. 17 MB, 0,3 MB je weitere Version). Danach startet der Editor ohne Netz; nicht geladene Versionen sind dann im Versionsmenü gesperrt (die Liste fragt den Cache selbst, nicht eine Merkliste).
- Eine neue Veröffentlichung wird im Hintergrund geladen, aber **nicht** mitten in der Arbeit aktiviert: Der Editor zeigt „Eine neue Version ist bereit“, ein Klick auf „Neu laden“ wechselt.
  Vor dem Wechsel werden Eingaben gespeichert; andere offene Tabs werden zum Neuladen aufgefordert. Offene Tabs prüfen stündlich. Der Cache der App-Dateien enthält einen Hash, der Laufzeit-Cache (Pyodide, Wheels, PyPI) trägt die Pyodide-Version im Namen; Veraltetes wird beim Wechsel gelöscht, Antworten, die HTML statt einer Datei sind, werden nicht gespeichert, und es bleiben höchstens 40 Wheels.
- Ein Schulnetz, das `cdn.jsdelivr.net` sperrt, braucht `npm run selfhost`. Dann kommt Pyodide samt numpy, pygame-ce, jedi und micropip vom eigenen Server (11 Dateien, ca. 16 MB).
  Die miniworlds-Wheels kommen weiterhin von PyPI (`pypi.org`, `files.pythonhosted.org`); auch dafür gilt der Cache nach dem ersten Laden.

## `miniworlds-ide`-Startseite ablösen (noch nicht umgesetzt)

Die Startseite `miniworlds.opencoding.de` besteht aus den H5P-Varianten (Python, Miniworlds, Java; Text und Blocks). Der Editor ersetzt die Miniworlds-Text-Variante.
Vorgehen, ohne die anderen zu verlieren:

1. Den Editor unter `https://miniworlds.opencoding.de/` veröffentlichen, die bisherige IDE-Seite nach `/ide/` verschieben.
2. In `config.json` die übrigen Varianten verlinken, z. B. `{ "label": "Miniworlds Blocks", "url": "/ide/?ide=miniworldsBlocks" }`, `{ "label": "Java", "url": "/ide/?ide=java" }`.
3. In `config.json` zusätzlich `embedOrigins` setzen, wenn Moodle einbetten soll.
4. In `miniworlds-ide/app.js` bleibt die Auswahl der Varianten unverändert; nur die Variante „Miniworlds · Text“ verweist auf den neuen Editor.

## Alten Greenfoot-Client ablösen (noch nicht umgesetzt)

`miniworlds-moodle-web-player/greenfoot/` wird überflüssig, sobald der Editor in Moodle eingebunden ist: Seite oder H5P-Inhalt mit `<iframe src=".../?embed=1">` (`docs/embed.md`).
Die Projektdatei `greenfoot.json` des alten Clients liest der Editor weiter (und ersetzt sie beim Speichern durch `miniworlds.json`).
