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

Der Server betreibt den Editor als nginx-Container hinter dem nginx des Hosts (TLS). Die Container laufen rootless unter einem
eigenen Benutzer; `html/` gehört diesem Benutzer. Maßgeblich ist die Compose-Datei auf dem Server; `deploy/` enthält die Vorlagen
(`nginx.conf` unterscheidet sich dort nur im Port).

**Update einspielen über GitHub** (von jedem Rechner, ohne SSH-Zugang): auf GitHub unter *Actions → Deploy → Run workflow*
(Branch `main`) oder `gh workflow run deploy.yml`. Der Workflow testet, baut, prüft die Verträglichkeit mit dem Klassen-Backend,
schickt die fertige Seite an den Server und vergleicht danach die veröffentlichte Revision. Die vorherige Seite bleibt auf dem
Server als `html.previous/` liegen, `release.json` nennt den Stand. `nginx.conf` und Compose-Datei ändert der Workflow nicht.

Einrichtung (einmalig):

- Server: `deploy/server/receive-editor.py` nach `/usr/local/lib/miniworlds-deploy/` kopieren (root, 755). Ein eigener Benutzer ohne
  weitere Rechte bekommt den öffentlichen Schlüssel mit festem Befehl in `authorized_keys`:
  `restrict,command="sudo -n -H -u <container-benutzer> /usr/local/lib/miniworlds-deploy/receive-editor.py <projektordner>/editor" ssh-ed25519 …`
  und eine sudo-Regel für genau diesen Befehl. Bei `AllowUsers` in der SSH-Konfiguration den Benutzer ergänzen.
- GitHub: Environment `production` (nur Branch `main`) mit den Secrets `DEPLOY_SSH_KEY`, `DEPLOY_USER`, `DEPLOY_HOST`, `DEPLOY_PORT`,
  `DEPLOY_KNOWN_HOSTS` (Hostschlüssel wie in `known_hosts`) und `EDITOR_CONFIG` (vollständige `config.json`).
  Nach Änderungen an der lokalen Konfiguration: `gh secret set EDITOR_CONFIG --env production < deploy/config.local.json`.

**Von Hand per SSH** (Tests, Build, Größenprüfung, Selbst-Hosting, Upload; der Container muss nicht neu starten):

```bash
DEPLOY_TARGET=<user>@<server>:<projektordner>/editor DEPLOY_SSH_PORT=<port> \
  DEPLOY_RSYNC_PATH="sudo -n -u <container-benutzer> rsync" scripts/deploy.sh   # DEPLOY_RSYNC_PATH nur bei fremdem Eigentümer
python test/live.py https://editor.opencoding.de/ chromium     # Kontrolle der veröffentlichten Seite
```

**Erstmalig:** Ordner anlegen, `deploy/docker-compose.yml` und `deploy/nginx.conf` hineinkopieren, `deploy/collab/` daneben legen (Relay für „Multiplayer“, optional), `docker compose up -d --build`; das Zertifikat holt Traefik beim ersten Aufruf.

Die gemeinsame Compose-Datei verwendet `nginx:stable-alpine` und die Standard-Runtime von Docker.
Abweichende Images oder Runtimes gehören in `deploy/docker-compose.override.yml`; diese Datei wird
nicht versioniert. Als Vorlage dient `deploy/docker-compose.override.example.yml` mit Platzhaltern.
Die lokale Override-Datei bei Bedarf neben `docker-compose.yml` auf den Server kopieren;
`docker compose` berücksichtigt sie dort automatisch. Bei einer bestehenden Installation mit
spezieller Runtime oder lokalem Image die Override-Datei vor dem Austausch der gemeinsamen
Compose-Datei bereitstellen.

`deploy/config.production.json` ist die neutrale Vorlage. Für das Impressum des Betreibers eine
nicht versionierte `deploy/config.local.json` mit der vollständigen Konfiguration anlegen. Das Deploy-Skript
verwendet diese Datei automatisch; `DEPLOY_CONFIG=/pfad/config.json` wählt ausdrücklich eine andere Datei.
Die gewählte Datei wird beim Deploy zur `config.json` (`embedOrigins` = `https://www.opencoding.de`);
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
| `imprint` | Impressum des Betreibers als Klartext mit Zeilenumbrüchen (`\n`). Die neutrale Vorlage muss für den eigenen Betrieb ersetzt werden. Sichtbar in den Einstellungen, zusammen mit dem vollständigen MIT-Lizenztext des Editors. |
| `lowMemory` | `"auto"` (Vorgabe), `true` oder `false`. Auf Geräten mit höchstens 4 GB RAM (`navigator.deviceMemory`, nur Chromium; sonst gilt das Gerät als geräumig) läuft das zweite Python der Editor-Hilfen nur, solange jemand tippt; es startet beim ersten Tippen, bei Vervollständigung oder Klick auf die Statusanzeige und schläft nach 5 Minuten ohne Nutzung wieder ein. Spart etwa 130 MB. |
| `collabUrl` | Adresse des Relays für „Multiplayer“ (relativ zur Seite, z. B. `/collab`, oder `wss://…`). **Ohne Eintrag ist die Funktion aus** (kein Menüpunkt), siehe `docs/collab.md`. |
| `embedOrigins` | Seiten, die den Editor einbetten dürfen, siehe `docs/embed.md`. **Ohne Eintrag darf niemand**; `["*"]` erlaubt alle. |

## Offline und Updates

- Beim ersten Besuch lädt der Service Worker die App-Dateien (ca. 0,7 MB, dazu die ruff-WASM mit 3,5 MB gzip). Pyodide und die benutzten miniworlds-Versionen kommen beim ersten Start dazu
  und liegen dann im Cache (ca. 17 MB, 0,3 MB je weitere Version). Danach startet der Editor ohne Netz; nicht geladene Versionen sind dann unter „Projekt → Python …“ gesperrt (die Liste fragt den Cache selbst, nicht eine Merkliste).
- Eine neue Veröffentlichung wird im Hintergrund geladen, aber **nicht** mitten in der Arbeit aktiviert: Der Editor zeigt „Eine neue Version ist bereit“, ein Klick auf „Neu laden“ wechselt.
  Vor dem Wechsel werden Eingaben gespeichert; andere offene Tabs werden zum Neuladen aufgefordert. Offene Tabs prüfen stündlich. Der Cache der App-Dateien enthält einen Hash, der Laufzeit-Cache (Pyodide, Wheels, PyPI) trägt die Pyodide-Version im Namen; Veraltetes wird beim Wechsel gelöscht, Antworten, die HTML statt einer Datei sind, werden nicht gespeichert, und es bleiben höchstens 40 Wheels.
- Ein Schulnetz, das `cdn.jsdelivr.net` sperrt, braucht `npm run selfhost`. Dann kommt Pyodide samt numpy, pygame-ce, jedi und micropip vom eigenen Server (11 Dateien, ca. 16 MB).
  Die miniworlds-Wheels kommen weiterhin von PyPI (`pypi.org`, `files.pythonhosted.org`); auch dafür gilt der Cache nach dem ersten Laden.

## Alte Einstiege (abgelöst am 2026-11-26)

- `https://miniworlds.opencoding.de/` leitet (302) auf `https://editor.opencoding.de/` um. Die alten H5P-Varianten bleiben mit
  `?ide=python`, `?ide=miniworlds`, `?ide=java` (und `…Blocks`) erreichbar; dort im Browser gespeicherter Code bleibt erhalten.
  Die Regel steht in der nginx-Konfiguration dieser Seite auf dem Server (`location = /`). Zurücknehmen: die Regel entfernen, nginx neu laden
  und den Server-Check für `/` wieder auf Status 200 stellen.
- Der alte Greenfoot-Client (`miniworlds-moodle-web-player/greenfoot/`) ist aus dem Repo entfernt. Seine Projektdatei `greenfoot.json`
  liest der Editor weiter (und ersetzt sie beim Speichern durch `miniworlds.json`).
- Die Einbindung in Moodle per `<iframe src=".../?embed=1">` (`docs/embed.md`) ist noch nicht umgesetzt.

## Überwachung und Sicherung

- Der Server prüft Startseite und Relay des Editors, die Versionsabfrage des Klassen-Backends sowie Umleitung und alte Varianten
  unter `miniworlds.opencoding.de`; Fehler werden gemeldet.
- Das Klassen-Backend wird täglich gesichert (mit Wiederherstellungsprüfung durch die Anwendung) und verschlüsselt außer Haus kopiert.
  Wöchentlich wird zusätzlich die Sicherung samt Schlüssel **aus der Offsite-Kopie** ohne Netz probeweise wiederhergestellt.
  Stand 2026-11-26: bestanden (die Datenbank enthielt noch keine Projekte).

Sprache (Deutsch/Englisch), Darstellungsmodus (System/Hell/Dunkel) und CodeMirror-Theme
(Standard/Solarized Light/Solarized Dark/Dracula) stehen im Einstellungsdialog oben rechts.
Die Wahl wird lokal im Browser gespeichert und mit OK sofort angewendet.
Das Standard-Theme folgt dem Darstellungsmodus; die anderen Editor-Paletten sind unabhängig davon.


The optional backend is maintained in its own `miniworlds-editor-backend` repository.
Before uploading a backend-enabled configuration, `scripts/deploy.sh` checks the live API
against `public/compatibility.json`; standalone configurations do not contact a backend.
`DEPLOY_NGINX_CONTAINER` (CSP zusammen mit dem Build neu laden) passt nur zum alten Aufbau mit direkt beschreibbarem Projektordner;
beim rootless Betrieb `nginx.conf` bei Änderungen von Hand übernehmen.
The production `embedOrigins` and CSP allow the backend origin to show read-only snapshot
previews through this editor, without sharing teacher cookies.
