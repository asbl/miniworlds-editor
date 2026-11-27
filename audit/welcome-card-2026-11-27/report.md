# Audit der Willkommenskarte (Lehrercode und Import)

Datum: 27.11.2026. Geprüft wurde der noch nicht committete Stand: die Kacheln „Mit Lehrercode starten“
und „Projekt importieren …“.

**Ergebnis: funktioniert, aber vor dem Commit sollten die Befunde 1 und 2 behoben werden.**

## 1. P2: Nach dem Lehrercode wird das unberührte Startprojekt angeboten

Fundstellen: [App.tsx](../../src/ui/App.tsx) (`onCode`),
[BackendPanel.tsx](../../src/backend/BackendPanel.tsx) (Angebot bei leerem Serverprojekt).

Reproduktion mit echtem lokalem Backend: neuer Besucher, Kachel anklicken, frischen Code eines leeren
Projekts eingeben. Es erscheint „Vorhandenes Projekt übernehmen?“ mit der Auswahl „Mein Projekt“. Das ist
das Startprojekt, das der Besucher nie benutzt hat. Mit „OK“ landet dessen Beispielcode im Projekt der
Lehrkraft. „Mein Projekt“ bleibt außerdem in der Projektliste stehen.

Betroffen sind nur leere Serverprojekte. Der Weg über das Menü hatte das Verhalten schon vorher, die Kachel
führt Erstbesucher jetzt aber direkt hinein.

Vorschlag: Nach erfolgreichem Einlösen über die Kachel das unveränderte Startprojekt entfernen, und zwar vor
dem Angebot. Bei Abbruch oder falschem Code bleibt es erhalten.

## 2. P2: Tastaturfokus auf den neuen Kacheln ist unsichtbar

Fundstelle: [style.css](../../src/style.css), `.welcome-way`.

Der globale Fokusrahmen liegt 2 px innen (`outline-offset: -2px`) und hat die Akzentfarbe. Die Kacheln haben
genau dort einen 2 px breiten Rahmen in derselben Farbe. Im Browser sieht die fokussierte Kachel aus wie die
andere.

Vorschlag: `.welcome-way:focus-visible { outline-offset: 2px; }`.

## 3. P3: Text nennt nur den Lehrercode

Der Dialog dahinter nimmt auch den persönlichen Projektcode an. Wer an einem neuen Gerät weiterarbeiten will,
sieht genau diese Karte, erkennt sich in „den du von deiner Lehrkraft bekommen hast“ aber eventuell nicht.

Vorschlag: Titel beibehalten, Text ergänzen: „… oder zu deinem eigenen Projektcode.“

## 4. P3: Abbrechen führt nicht zur Karte zurück

Nach „Abbrechen“ im Code-Dialog ist die Willkommenskarte weg und nur noch über das Projektmenü
(„Erste Schritte …“) erreichbar. Ein späterer Import ersetzt das Startprojekt dann auch nicht mehr.

## 5. P3: Kein automatischer Test für die Code-Kachel

`test/welcome.py` läuft ohne Server, `test/backend.py` überspringt die Karte (`FILES_FIRST` markiert sie als
gesehen). Fällt die Kachel weg oder öffnet sie nichts mehr, bemerkt das kein Test.

## Geprüft und unauffällig

- Ein echter Code lässt sich über die Kachel einlösen, per Maus und Tastatur steht der Fokus im Codefeld.
- Ohne `backendUrl` erscheint keine Code-Kachel.
- 360×640 und 1366×650: Die Kacheln sind ohne Scrollen sichtbar. Mit aufgeklapptem Import rutscht
  „Eigene Welt“ auf dem Handy unter den sichtbaren Bereich, ist aber durch Scrollen erreichbar.
- `npm run build`, 580 Unit-Tests, `test/welcome.py` und `test/backend.py` (44 Prüfungen) in Chromium.

## Nachtrag: Korrekturen

Befunde 1, 2, 3 und 5 sind behoben; die neuen Prüfungen stehen in `test/backend.py` und `test/welcome.py`.
Befund 1 betraf auch den ersten Besuch über `?project-code=1`; das ist mit behoben.
Befund 4 bleibt bewusst so. Die Beschreibungen oben zeigen den Stand vor der Korrektur.

Nicht geprüft: Firefox, Offline-Betrieb, Screenreader, das produktive Backend.

Gebaut und getestet wurde in einer temporären Kopie beider Repositories mit lokalem, temporärem Server.
