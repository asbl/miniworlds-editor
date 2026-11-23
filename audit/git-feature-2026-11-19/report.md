# Audit des optionalen Git-Modus

Datum: 19.11.2026. Geprüft wurde der aktuelle, noch nicht committete Stand im
Repository `miniworlds-editor`.

**Historisches Audit-Ergebnis vor der Korrektur: nicht freigabereif.** Zwei Befunde mit Priorität P1 und ein
Befund mit Priorität P2 wurden reproduziert. Die anschließenden Korrekturen und deren Validierung stehen in
[fixes.md](fixes.md).
Die untenstehenden Reproduktionen dokumentieren den ursprünglichen Stand.
Die genannten Logs sind lokale, ignorierte Prüfartefakte und gehören nicht zum Repository.

## 1. P1 — Git funktioniert im Produktionsbrowser nicht: `Buffer` fehlt

Fundstellen: [vite.config.ts:9](../../vite.config.ts),
[repository.ts:103](../../src/git/repository.ts),
[GitDialog.tsx:85](../../src/ui/GitDialog.tsx).

Der Alias für das Paket `buffer` ersetzt explizite Modulimporte. Er stellt jedoch
keine globale Variable `Buffer` bereit. Die eingebundene ESM-Version von
`isomorphic-git` verwendet diese globale Variable unter anderem bei der
Index-/Objektverarbeitung. Node stellt sie bereit und verdeckt den Fehler in den
bisherigen Tests.

Reproduktion im unveränderten Produktionsbuild, Chromium mit OPFS:

1. Git-Modus aktivieren und ein vorhandenes Starterprojekt mit einem Repository
   verbinden; dafür ist noch kein Netzwerkzugriff erforderlich.
2. Autorenname, E-Mail und Commit-Nachricht ausfüllen.
3. Der Dialog zeigt `Buffer is not defined`, meldet gleichzeitig fälschlich
   „Keine Änderungen“ und lässt Commit deaktiviert.

Damit ist bereits der grundlegende lokale Git-Ablauf blockiert. Die
Git-Verbindung wurde zu diesem Zeitpunkt schon gespeichert.

Empfehlung: Die von der verwendeten Git-Version benötigte Buffer-Implementierung
auch für freie `Buffer`-Referenzen korrekt bereitstellen. Anschließend einen
Browser-Regressionstest gegen den gebauten Editor ergänzen, der Initialisierung,
Commit und Wiederöffnen mit OPFS prüft.

Beleg: `browser.log`.

## 2. P1 — Fehlgeschlagener Pull löscht zwischenzeitliche lokale Arbeit

Fundstellen: [repository.ts:119](../../src/git/repository.ts),
[repository.ts:132](../../src/git/repository.ts),
[repository.ts:147](../../src/git/repository.ts).

Der saubere Arbeitsstand wird nur vor dem Netzwerkzugriff geprüft. Danach wird
eine Kopie der Dateien im RAM abgelegt. Bei jedem Fehler, auch einem reinen
Netzwerkfehler ohne angewendete Remote-Änderungen, ersetzt der Rollback die
Projektdateien bedingungslos durch diese ältere Kopie. Eine projektweite Sperre
oder Prüfung zwischenzeitlicher Änderungen fehlt.

Reproduktion mit gezielter Transport-Fehlerinjektion:

1. `main.py` mit Inhalt `original` committen und Pull starten.
2. Während des Requests einen zweiten Schreiber simulieren, wie Autosave eines
   weiteren Tabs: `main.py` auf `new student work` ändern und `new.py` anlegen.
3. Den Netzwerkrequest mit `Network disconnected` scheitern lassen.
4. Pull meldet einen Fehler, aber `main.py` enthält wieder `original` und
   `new.py` wurde gelöscht. Beide Änderungen waren nicht committet.

Das modale Fenster sperrt nur die Bedienung des aktuellen Tabs. Auch die
Übernahme von Ergebnissen eines noch laufenden Python-Programms schreibt über
`useProgram.applyChanges` unabhängig vom Git-Dialog in das Projekt.

Empfehlung: Git-Operationen und sonstige Projektschreiber koordinieren, auch über
Tabs hinweg. Vor dem Anwenden von Remote-Dateien Änderungen während der
Netzwerkphase erkennen und schützen. Bei einem reinen Fetch-Fehler keine
Projektdateien zurückschreiben. Für tatsächlich begonnene Dateiersetzungen einen
wiederherstellbaren, persistenten Zustand vorhalten.

Beleg: erster Test in [probes.ts](probes.ts)
und `probes.log`.

## 3. P2 — Hängende Netzwerkoperation blockiert den Editor ohne Abbruch

Fundstellen: [repository.ts:25](../../src/git/repository.ts),
[GitDialog.tsx:58](../../src/ui/GitDialog.tsx),
[GitDialog.tsx:116](../../src/ui/GitDialog.tsx).

Die Requests erhalten weder ein Abbruchsignal noch einen eigenen Timeout.
Gleichzeitig deaktiviert `busy` den Schließen-Button und verhindert Escape.
Ein Proxy, der die Verbindung offen hält und keine Antwort liefert, kann die
modale Oberfläche damit ohne festgelegte zeitliche Grenze blockieren.

Reproduktion: Klonen starten und den Request im Browser kontrolliert offen
halten. Der Schließen-Button ist deaktiviert; Escape schließt den Dialog nicht.
Ein zusätzlicher Transporttest bestätigt `signal === undefined` beim Fetch.

Empfehlung: Einen expliziten Abbruch mit `AbortController` und einen definierten
Netzwerk-Timeout einführen. Die Bereinigung eines abgebrochenen Klons muss das
neu angelegte Projekt und dessen Git-Daten zuverlässig entfernen.

Belege: `browser.log`
und zweiter Test in [probes.ts](probes.ts).

## Prüfungen und Grenzen

- Reguläre Tests: **473 erfolgreich**, 53 Dateien. Die bestehenden Tests erkennen
  die oben beschriebenen Fehler nicht.
- Produktionsbuild einschließlich Typprüfung: erfolgreich. Build-Erfolg prüft
  nicht, ob benötigte Node-Globals im Browser verfügbar sind.
- Chromium/Produktionsbuild: Git-Menü ist standardmäßig verborgen; Aktivierung
  funktioniert. Browserfehler und fehlender Dialogabbruch wurden reproduziert.
- Zwei zusätzliche Audit-Probes bestätigen Datenverlust und fehlendes
  Abbruchsignal. Sie behaupten bewusst das beobachtete Fehlverhalten und laufen
  separat von der regulären Testsuite.
- Bestehender Git-HTTP-Integrationstest: Klonen, Push/Pull, Binärdateien,
  Löschungen, divergierende Branches und Symlink-Rollback bestehen unter Node.
- Zugangsdaten werden nach Codeprüfung nur im Dialogzustand gehalten; es wurde
  kein Live-Test mit echten Zugangsdaten oder einer externen Plattform ausgeführt.
- Keine Prüfung mit Firefox, realem CORS-Proxy, Speicherquotenfehlern oder
  Browserabstürzen. Die mitgelieferte Hosting-Konfiguration benötigt für externe
  Git-Zugriffe weiterhin die dokumentierte Proxy-/CSP-Einrichtung.

Reproduktionsbefehle, jeweils aus dem Editor-Repository:

```sh
npm test
npm run build
npx vitest run --config audit/git-feature-2026-11-19/vitest.config.ts
python3 audit/git-feature-2026-11-19/browser.py
```

Die Browser-Probe verwendet ausschließlich einen lokalen statischen Server und
abgefangene externe Requests. Sie verändert kein externes Repository.
