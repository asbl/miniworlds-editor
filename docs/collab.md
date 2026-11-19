# Gemeinsam arbeiten (Mehrspieler-Modus)

Mehrere Personen bearbeiten **dasselbe Projekt live**: jede sieht den Code, die Cursor und die Dateien der anderen. Jede Person startet das Programm auf dem **eigenen** Gerät (die Welt wird nicht geteilt).

## Bedienung

- Menüpunkt **👥 Gemeinsam** in der oberen Leiste → *Gemeinsam starten* → Einladungslink (und QR-Code) weitergeben.
- Wer den Link öffnet, wird nach einem Namen gefragt und bekommt ein **neues Projekt** „Gemeinsam arbeiten abcd-efgh“ auf dem eigenen Gerät; die anderen Projekte bleiben unberührt.
- Der Raum merkt sich das Projekt: nach einem Neuladen verbindet es sich selbst wieder.
- *Gemeinsames Arbeiten beenden* trennt nur die Verbindung; das Projekt bleibt als Kopie auf dem Gerät.
- Der Verlauf („Versionen“) bleibt pro Gerät.

### Nur-Lesen-Link (Lehrkräfte)

Im Dialog steht neben dem Einladungslink ein zweiter, **Nur-Lesen-Link** (`#watch=…`). Wer ihn öffnet, sieht alles live (Code, Cursor, Dateien), kann aber nichts ändern: der Editor ist gesperrt, und der Relay verwirft Änderungen von Lese-Verbindungen. Der Nur-Lesen-Link enthält den Schreibschlüssel nicht. Was die Lehrkraft auf dem eigenen Gerät tut (z. B. das Programm laufen lassen), erreicht den Raum nicht.

### Folgen

Im Dialog gibt es neben jeder Person **Folgen**. Der Editor zeigt dann die Datei und Zeile, in der diese Person gerade arbeitet, bis man selbst tippt oder in der Leiste „Beenden“ wählt (oder die Person geht).

### Zu zweit programmieren (optional)

*Ich fahre* im Dialog macht eine Person zur **Fahrerin**: nur sie tippt, die anderen sehen zu (ihr Editor ist gesperrt, ein Hinweis in der Leiste bietet „Ich fahre“ zum Übernehmen an). *Alle dürfen tippen* hebt das auf; verlässt die Fahrerin den Raum, endet es von selbst. Das ist eine Absprache in der Oberfläche (jede Person kann übernehmen), kein Zugriffsschutz; den gibt es nur beim Nur-Lesen-Link.

### Wiederverbinden und gelöschte Dateien

- Beim (Wieder-)Beitritt gilt der Stand des Raums. Dateien, die es nur lokal gibt, kommen in den Raum, **außer** der Raum hatte sie bei der letzten Verbindung noch und jemand hat sie inzwischen gelöscht: dann werden sie auch lokal gelöscht (mit Hinweis, welche). Ein Raum, der leer ankommt (der Relay hat ihn vergessen), gilt als neu: dann löscht nichts, alles lokal wird übernommen.
- Fällt die Verbindung weg, zeigt eine Leiste es an; man arbeitet weiter, die Änderungen werden nachgeholt.
- Verweigert der Server, sagt der Dialog warum: Raum voll (20), Server voll, Link passt nicht (mehr), Raum existiert nicht (Nur-Lesen-Link, bevor die einladende Person verbunden war), zu viele Verbindungen, Netz blockiert WebSockets.

### Große Dateien

Alle, die beitreten, laden das ganze Projekt. Deshalb: Bilder (PNG, JPEG, WebP) über **800 KB** werden für das Teilen auf höchstens **1280 Pixel** Kantenlänge verkleinert (das Original bleibt auf dem Gerät der Person; sie bekommt einen Hinweis). Eine Datei über **3 MB** (nach dem Verkleinern) und alles, was das Projekt über **24 MB** brächte, wird nicht geteilt und bleibt nur lokal, ebenfalls mit Hinweis. Messung mit lokalem Relay: 12 MB kommen in etwa 0,1 s an, ein später Beitretender lädt 24 MB in etwa 0,15 s (im Schulnetz entsprechend länger); 5000 einzelne Tastendrücke wachsen den Zustand um 5 KB; ein zehnmal ersetztes 1-MB-Bild kostet 1 MB, nicht 10.

Wer den Link kennt, kann **mitlesen und mitschreiben** (Nur-Lesen-Link: nur mitlesen), und der Code läuft bei jeder Person lokal. Den Link nur an die weitergeben, die dabei sein sollen.

## Technik

Yjs (CRDT) im Browser (wird erst beim ersten „Gemeinsam“ nachgeladen, ein eigener Baustein von etwa 100 KB); Text­dateien als `Y.Text`, Bilder und Sonstiges als Bytes (`src/collab/`). Der Editor-Dateizugriff läuft durch `Collab.join()`: Änderungen der anderen werden in das normale Projekt-Dateisystem geschrieben, das Automatische Speichern bleibt wie es ist. Als Verbindung dient ein kleiner **WebSocket-Relay** (y-websocket-Protokoll, `deploy/collab/relay.mjs`), der pro Raum ein Dokument im Arbeitsspeicher hält und einen Raum einen Tag nach dem Weggang der letzten Person vergisst. Nichts wird auf Platte geschrieben.

## Der Relay ist optional – und gehört dem, der ihn betreibt

Im Quellcode steht **keine Relay-Adresse**. Die Funktion ist aus, solange `config.json` kein `collabUrl` enthält, und sie bleibt unsichtbar, wenn der Relay nicht antwortet (`<collabUrl>/health`). Ein Fork erbt also keinen fremden Relay.

1. **Relay starten** (Node ≥ 20; Container: `deploy/collab/Dockerfile`):

   ```bash
   cd deploy/collab && npm install && COLLAB_ORIGINS=https://editor.example.org node relay.mjs
   ```

   | Umgebungsvariable | Bedeutung |
   |---|---|
   | `COLLAB_ORIGINS` | **Pflicht.** Kommagetrennte Liste der Seiten (Origins), die sich verbinden dürfen. Browser senden ihren Origin immer mit; alles andere wird mit 403 abgewiesen. `*` schaltet die Prüfung ab (nur lokal testen). |
   | `PORT`, `HOST` | Standard `8787`, `0.0.0.0`. |
   | `COLLAB_TRUST_PROXY=1` | Client-Adresse aus `X-Forwarded-For` (nur hinter einem Proxy, den man selbst betreibt). |
   | `COLLAB_MAX_ROOMS`, `COLLAB_MAX_PER_ROOM`, `COLLAB_ROOM_TTL_HOURS` | Grenzen (Standard 500 Räume, 20 Personen je Raum, 24 h). |

   Ein Raum wird von der ersten Schreib-Verbindung angelegt und mit deren Schlüsseln geschützt (`Sec-WebSocket-Protocol`, damit sie nicht in Server-Logs landen). Der Raumname allein genügt nicht.

   Fest eingebaut: höchstens 16 MB je Nachricht, 48 MB je Projekt, 30 Verbindungen je Adresse, 60 Nachrichten je Sekunde und Verbindung.
2. **Durchreichen**: `deploy/nginx.conf` leitet `/collab/` an den Relay (`collab:8787`) weiter; `deploy/docker-compose.yml` enthält den Dienst.
3. **`config.json`**: `"collabUrl": "/collab"` (relativ zur Seite; `wss://relay.example.org/collab` geht auch, dann `connect-src` der Content-Security-Policy anpassen).

Die Herkunftsprüfung hält fremde Webseiten und Forks zuverlässig fern, ist aber kein Schutz gegen Skripte außerhalb eines Browsers (sie können den Header fälschen). Dagegen helfen die Grenzen oben und, wenn nötig, Sperren in nginx/Traefik.

## Überwachung (Uptime Kuma)

`GET /collab/health` (durch nginx erreichbar) antwortet ohne Anmeldung mit `{"ok":true,"rooms":2,"connections":5,"uptimeSeconds":…,"memoryMb":…}`: nur Zahlen, keine Raumnamen oder Schlüssel. In Uptime Kuma einen „HTTP(s) – Keyword“-Monitor auf `https://editor.opencoding.de/collab/health` mit dem Stichwort `"ok":true` anlegen. Der Container hat zusätzlich einen Docker-Healthcheck. Räume und Verbindungen lassen sich aus dem JSON in ein Diagramm übernehmen.

## Einbetten (Moodle)

Im eingebetteten Editor (`?embed=1`) ist „Gemeinsam arbeiten“ **aus**: dort gehören die Dateien der einbettenden Seite (Abgabe!). Der Relay selbst wäre auch aus einem Moodle-iframe erreichbar, weil die Verbindung zur Editor-Domain geht und nicht zum Moodle.

## Tests

`npx vitest run src/collab` (echter Relay: Sync, Abbruch, Grenzen, Nur-Lesen, Rollen, Folgen, gelöschte Dateien, große Dateien, Health) und `python test/collab.py [chromium|firefox]` (vier Browser: gleichzeitiges Tippen, Cursor, Dateien, Nur-Lesen, Folgen, Fahrer, Bild verkleinern, Neuladen; braucht `npm run build`). Safari/WebKit ist hier nicht startbar und nur auf echten Geräten prüfbar (Plan S6).
