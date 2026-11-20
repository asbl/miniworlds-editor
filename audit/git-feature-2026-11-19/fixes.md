# Korrekturen zum Git-Audit

Die drei reproduzierten Befunde des ursprünglichen Audits sind behoben.
Die historischen Probe-Dateien und Logs bleiben als Nachweis des damaligen
Fehlverhaltens erhalten; für den korrigierten Stand gelten die Regressionstests
unter `src/git/`, `src/workspace/locked.test.ts` und `test/git.py`.

## Browser-Buffer

Das optional geladene Git-Modul stellt die Buffer-Implementierung vor der
Ausführung der Git-Bibliothek bereit. Der Produktionsbrowser kann ein lokales
Repository erstellen, Änderungen erkennen, einen Commit erzeugen und den sauberen
Stand nach Neuladen mit OPFS wieder öffnen. Eine fehlgeschlagene Änderungsabfrage
wird nicht mehr als „Keine Änderungen“ dargestellt.

## Pull und parallele Änderungen

Der Pull erfasst den Ausgangsstand unter einer Projektsperre. Der Netzwerkzugriff
blockiert die Bearbeitung in weiteren Tabs nicht. Vor der Übernahme wird der
Dateistand erneut unter derselben Sperre verglichen; Änderungen führen zu einem
Abbruch mit Erhalt der lokalen Dateien. Dateiübernahme und Rücksetzen bei einem
Übernahmefehler halten die Sperre bis zum Abschluss. Alle regulären Projektschreiber
verwenden dieselbe Sperre, browserübergreifend innerhalb derselben Origin über
Web Locks. Gleichzeitige Git-Operationen werden zusätzlich serialisiert.

Ein reiner Netzwerkfehler setzt ausschließlich den Git-Stand zurück und schreibt
keine Projektdateien. Vor der ersten destruktiven Änderung wird eine dauerhafte
ZIP-Sicherung in den getrennten Git-Daten gespeichert. Der Git-Dialog bietet sie
auch nach einem Neuladen zum Herunterladen an. Bei fehlendem Speicher für diese
Sicherung beginnt keine Dateiübernahme. Falls der Speicher auch das Rücksetzen
verweigert, bleibt die Sicherung zur Wiederherstellung als separates Projekt
verfügbar. Sie enthält Text- und Binärdateien; übliche Export-Junk-Dateien sind wie
beim normalen ZIP-Export ausgenommen.

## Timeout, Abbruch und Klon-Bereinigung

Jede Netzwerkoperation erhält ein AbortSignal und eine Gesamtdauer von höchstens
30 Sekunden für den Netzwerkablauf einschließlich Antwortstream. Der Dialog
bietet währenddessen „Abbrechen und schließen“ an; Escape löst denselben Abbruch
aus. Erst nach Abschluss der Bereinigung wird der Dialog geschlossen. Ein
abgebrochener Klon entfernt das neue Projekt und seine Git-Daten. Verspätete
Speichervorgänge der Git-Dateisystembibliothek werden für diesen Klon deaktiviert.
Bereits angenommene Pushes lassen sich nicht rückgängig machen; eine begonnene
lokale Dateiübernahme wird sicher abgeschlossen.

## Verifikation

- `npm test`: **480 Tests erfolgreich**, 56 Testdateien.
- `npm run build`: Typprüfung und Produktionsbuild erfolgreich.
- `python3 test/git.py`: Chromium/OPFS gegen den gebauten Editor erfolgreich;
  standardmäßig verborgenes Git, verzögertes Laden der Git-Bibliothek, Commit,
  Wiederöffnen, Abbruch per Button und Escape, Entfernung beider Speicherbereiche,
  erneutes Deaktivieren, keine unbehandelten Browserfehler.
- Git-HTTP-Integration: Binärdateien, Löschungen, divergierende Branches,
  nicht unterstützte Symlinks, erfolgreicher Fetch bei parallelen lokalen Änderungen,
  erneuter erfolgreicher Pull, binäre ZIP-Sicherung und Speicherfehlerinjektion.
- Sicherheitsregressionen: Fehlgeschlagener Fetch mit parallelen Änderungen,
  Pull-Abbruch ohne Dateirücksetzung, Klon-Abbruch und Speicherbereinigung,
  automatischer Timeout und bereits abgebrochenes Signal.

Logs: [Tests](fixes-tests.log), [Build](fixes-build.log),
[Chromium](fixes-browser.log).

Es wurde kein echtes Token verwendet und kein externes Repository verändert.
Firefox und reale Git-Hosting-/CORS-Proxy-Kombinationen wurden in dieser
Korrekturrunde nicht geprüft. Für externe Git-Zugriffe gelten weiterhin die
Hosting-Voraussetzungen in `docs/git-mode.md`.
