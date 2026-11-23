# Optionaler Git-Modus

Unter **⚙ → Git-Modus aktivieren (erweitert)** einschalten. Erst dann erscheint
oben das Menü **Git**. Die Einstellung gilt für diesen Browser, nicht für geteilte
Projekte oder eingebettete Editoren. Deaktivieren blendet die Werkzeuge wieder aus;
vorhandene Commits bleiben erhalten.

Während einer gemeinsamen Sitzung sind die Git-Werkzeuge ausgeblendet. Nach
**Multiplayer verlassen** stehen sie für die gespeicherte Projektkopie
wieder zur Verfügung.

## Repository laden

1. **Git → Repository klonen …** öffnen.
2. Die HTTPS-Klon-URL von GitHub, GitLab, Codeberg oder einem anderen Server mit
   Git Smart HTTP eintragen. Optional einen Branch angeben, sonst wird der
   Standardbranch geladen.
3. Falls erforderlich, einen Git-CORS-Proxy und unter **Zugangsdaten** den
   Benutzernamen sowie ein Access-Token mit den benötigten Repository-Rechten
   eintragen. Beispielsweise nutzt GitLab für OAuth-Tokens `oauth2` als Benutzername.
4. **Repository klonen …** erstellt ein neues Projekt. Ein vorhandenes Projekt
   wird dabei nicht ersetzt. Bei einem Fehler wird das neue Projekt wieder entfernt.

Der Editor erwartet ein direkt ausführbares Python-/Miniworlds-Projekt. Er führt
keine Installationsskripte aus einem Repository aus. SSH, Git LFS, Submodule und
symbolische Links werden nicht unterstützt.

## Änderungen speichern und synchronisieren

**Git → Git: Änderungen und Synchronisation** zeigt die geänderten Dateipfade.
Beim Öffnen werden vorher alle offenen Editor-Dateien gespeichert.

- **Commit** speichert alle hinzugefügten, geänderten und gelöschten Dateien mit
  Nachricht, Autorenname und E-Mail lokal. `.gitignore` wird berücksichtigt.
- **Push** überträgt lokale Commits zum Remote. Force-Push wird nicht angeboten.
- **Pull** übernimmt neue Commits nur bei sauberem Arbeitsstand und nur als
  Fast-Forward. Bei auseinanderlaufenden Branches muss der Merge außerhalb des
  Editors gelöst werden. Nach erfolgreichem Pull lädt der Editor die Dateien neu.
  Ändert ein weiterer Tab oder ein laufendes Programm während des Ladens Dateien,
  wird die Übernahme abgebrochen; diese Änderungen bleiben erhalten. Die eigentliche
  Dateiübernahme ist gegen parallele Projektschreiber gesperrt. Für Pull im
  OPFS-Speicher muss der Browser Web Locks unterstützen.
- Vor der Dateiübernahme wird eine ZIP-Sicherung inklusive Binärdateien gespeichert.
  **Sicherung vor dem letzten Pull herunterladen** lädt diesen Stand herunter, auch
  nach einem Neuladen des Editors. Bei einem Speicherfehler während der Übernahme
  kann die Sicherung als separates Projekt importiert werden. Reicht der Speicher
  bereits für die Sicherung nicht aus, bleiben die Projektdateien unverändert.
- **Abbrechen und schließen** oder Escape bricht laufende Netzwerkoperationen ab.
  Die Bereinigung wird vor dem Schließen abgeschlossen; ein abgebrochener Klon
  hinterlässt kein neues Projekt. Netzwerkoperationen haben ein Zeitlimit von
  30 Sekunden. Eine bereits begonnene lokale Dateiübernahme wird sicher zu Ende
  geführt; bereits vom Server angenommene Pushes lassen sich nicht zurücknehmen.
- Unter **Verbindung bearbeiten** lassen sich Repository- und Proxy-URL korrigieren.

Ein vorhandenes Browser-Projekt kann über **Dieses Projekt mit Git verbinden**
ein lokales Repository erhalten. Es startet auf dem angegebenen Branch (sonst
`main`). Der erste Push ist für ein leeres Remote gedacht. Ein bereits gefülltes
Remote sollte zuerst geklont werden.

Access-Tokens und Passwörter werden weder in Projekteinstellungen noch in
Git-Konfiguration oder Browser-Storage geschrieben. Die Zugangsfelder werden beim
Schließen des Dialogs verworfen. Die Git-Bibliothek wird erst beim Öffnen der
Git-Oberfläche geladen. Git-Objekte und Konfiguration liegen getrennt von den
Projektdateien im lokalen Projektspeicher. Sie werden beim Umbenennen mitgenommen
und beim Löschen entfernt. ZIP-Export, Teilen und Duplizieren übertragen nur die
Projektdateien, ohne Git-Verbindung oder Commit-Verlauf.

## Hosting und CORS

Viele Plattformen, insbesondere GitHub, erlauben Git-Zugriffe aus dem Browser nicht
direkt. Dafür muss ein kompatibler Git-CORS-Proxy bereitstehen; der Editor nutzt
**keinen vorgegebenen öffentlichen Proxy**. Informationen zur Implementierung:
[isomorphic-git CORS-Proxy](https://github.com/isomorphic-git/cors-proxy).

Empfohlen ist ein selbst betriebener Proxy unter derselben Origin wie der Editor,
z. B. `https://editor.example/git-cors`. Bei einem externen Proxy muss dessen
Origin in `connect-src` der Content-Security-Policy erlaubt sein
(siehe `deploy/nginx.conf`). Bei direktem Zugriff ohne Proxy gilt das auch für die
Repository-Origin. Die ausgelieferte CSP erlaubt zunächst nur die bisher benötigten
Origins; externe Git-Zugriffe müssen beim Hosting gezielt freigegeben werden.

Der Proxy muss Smart-HTTP-GET/POST, Streaming und den Authorization-Header
unterstützen und sollte auf die benötigten Git-Hosts begrenzt sein. Er sieht
Repository-Inhalte und gegebenenfalls Zugangsdaten. Die URL wird deshalb bewusst
im Git-Dialog konfiguriert. Repository- und Proxy-URLs mit eingebetteten Passwörtern,
Query-Parametern oder Fragmenten werden abgelehnt. HTTP ist nur für lokale
Entwicklung auf `localhost` / `127.0.0.1` erlaubt.

## Prüfung

`npm test` enthält Tests für lokale Commits, Binärdateien, Löschungen,
`.gitignore`, getrennte Speicherung, Wiederöffnen/Umbenennen und deaktivierte
Git-Voreinstellungen. Ein Integrationstest startet einen lokalen Git-Smart-HTTP-Server
mit `git http-backend` und prüft Klonen, Push, Pull, divergierende Branches und
Rollback bei nicht unterstützten symbolischen Links. Dafür muss `git` installiert
sein. `npm run build` prüft zusätzlich die Typen und den Browser-Build.

Browser-Regressionen gegen den Produktionsbuild: `python3 test/git.py` (Chromium)
oder `python3 test/git.py firefox`. Sie benötigen Python mit Playwright und prüfen
OPFS-Commits, Wiederöffnen, optionale Oberfläche und Abbruch samt Bereinigung.
Die Sicherheitsregressionen unter `src/git/safety.test.ts`, `network.test.ts` und
`transport.test.ts` prüfen parallele Änderungen, Netzwerkfehler, Timeout,
Abbruchsignale und die dauerhafte Sicherung bei Speicherfehlern.
