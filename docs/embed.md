# Editor in eine andere Seite einbetten (Moodle, Kursseite)

Der Editor lässt sich per `<iframe>` einbetten. Die Seite lädt ein Projekt hinein, bekommt Änderungen gemeldet und kann
die Dateien jederzeit abholen, z. B. um sie in Moodle als Abgabe zu speichern.

**Einbetten ist freigabepflichtig:** Der Editor bedient nur Seiten, die in `config.json` unter `embedOrigins` stehen (siehe „Sicherheit“). Ohne Eintrag ignoriert er alle Nachrichten.

```html
<iframe id="editor" src="https://editor.example.org/?embed=1" width="100%" height="700" allow="fullscreen"></iframe>
<script>
  const editor = document.getElementById('editor')
  const origin = 'https://editor.example.org'
  const send = (message) => editor.contentWindow.postMessage({ app: 'miniworlds-editor', ...message }, origin)

  window.addEventListener('message', (event) => {
    if (event.origin !== origin || event.data?.app !== 'miniworlds-editor') return
    const m = event.data
    if (m.type === 'ready') send({ type: 'load', id: 'start', files: { 'main.py': 'print("Hallo")\n' } })
    if (m.type === 'change') console.log('geändert:', m.paths)
    if (m.type === 'files') console.log('Abgabe', m.files)
  })
</script>
```

## Nachrichten

Jede Nachricht ist ein Objekt mit `app: 'miniworlds-editor'` und `type`. Ein optionales `id` (Text, höchstens 100 Zeichen) kommt in der Antwort zurück.

**Seite → Editor**

| `type` | Felder | Wirkung |
|---|---|---|
| `load` | `files`, `lang?` (`'de'`/`'en'`), `mode?` (`'program'`/`'miniworlds'`) | Ersetzt das ganze Projekt. `files` ist `{ Pfad: Inhalt }`; Textdateien als String, Binärdateien (Bilder) als `{ base64: '…' }`. Dateien, die nicht mitgeschickt werden, verschwinden. |
| `get-files` | – | Antwortet mit `files`; ungespeicherte Eingaben werden vorher übernommen. |

`load` ist alles oder nichts: Wird eine Datei abgelehnt (Pfad, Größe, ungültiges Base64), bleibt das bisherige Projekt unverändert. Nachrichten werden nacheinander abgearbeitet.

**Editor → Seite**

| `type` | Felder | Bedeutung |
|---|---|---|
| `ready` | – | Der Editor hört zu (kommt einmal beim Start). Erst danach `load` senden. |
| `loaded` | `id?` | `load` wurde angewendet. |
| `files` | `id?`, `files` | Alle Projektdateien (Antwort auf `get-files`). |
| `submit` | `files` | Die Person hat „Abgeben“ gedrückt (der Knopf erscheint nur mit `?embed=1&submit=1`). Enthält alle Projektdateien wie `files`; ungespeicherte Eingaben sind vorher übernommen. Die Seite speichert sie, z. B. als Moodle-Abgabe. |
| `change` | `paths` | Diese Dateien haben sich geändert. Nur ein Hinweis ohne Inhalt: vor dem Abgeben oder Wegnavigieren immer `get-files` aufrufen. Das übernimmt auch Eingaben, die noch nicht gespeichert sind. |
| `error` | `id?`, `message` | Eine Nachricht wurde abgelehnt (ungültiger Pfad, zu viele oder zu große Dateien, …). |

Grenzen wie beim ZIP-Import: höchstens 5000 Dateien und 150 MB; Pfade ohne `..`. Das Projekt hat keinen Namen und keine Projektverwaltung;
ohne `load` startet der Editor nach 1,5 s mit einem leeren Startprojekt (so funktioniert die URL auch allein).

## Sicherheit

- Der Editor liest nur Nachrichten vom Fenster, das ihn einbettet (nicht von anderen Fenstern oder Tabs).
- Antworten gehen immer an den Ursprung (`event.origin`) der letzten gültigen Nachricht, nie an `*`. Solange die Seite nichts gesendet hat, geht nur `ready` hinaus
  (ohne Daten); `change` wartet, bis die Seite sich gemeldet hat. Ursprung `null` (iframe mit `sandbox` ohne `allow-same-origin`) wird abgelehnt.
- **Erlaubte Seiten:** `"embedOrigins": ["https://moodle.example.org"]` in `config.json`. Nur diese Ursprünge werden bedient, und nur bei ihnen meldet sich der Editor.
  **Ohne Eintrag, bei unlesbarer Datei oder falschem Typ (z. B. ein String statt einer Liste) darf niemand einbetten.** `["*"]` erlaubt jede Seite und muss ausdrücklich gesetzt werden.
- Das eingebettete Projekt liegt **nur im Arbeitsspeicher**, und die Sprache der Seite wird nicht als Einstellung des Besuchers gespeichert.
- **Grenze:** Python, das die einbettende Seite lädt, läuft mit den Rechten des Editor-Ursprungs. Dass es nicht an die gespeicherten Projekte des Besuchers kommt,
  liegt an der Speicher-Partitionierung moderner Browser für Drittanbieter-Frames (Chrome ab 115, Firefox, Safari), nicht an einer Sperre im Editor. Deshalb nur vertrauenswürdige Seiten freigeben,
  und ein Editor-Ursprung, der nichts anderes enthält (z. B. eine eigene Subdomain), ist die sicherste Wahl.
- Der Rahmen braucht keine besonderen Header (kein `COOP`/`COEP`); `Content-Security-Policy: frame-ancestors` auf dem Server des Editors kann die Einbettung zusätzlich auf Moodle beschränken.

## Aufgaben per Link (ohne Einbetten)

Auch ohne iframe lässt sich eine Aufgabe über die Adresse öffnen, z. B. als Link auf einer Kursseite:

| Parameter | Wirkung |
|---|---|
| `?template=krabbe` | legt ein Projekt aus einer mitgelieferten Vorlage an (`krabbe`, `sammler`, `pong`) |
| `?zip=https://…/aufgabe.zip` | lädt ein Projekt-ZIP (relative Adressen gelten ab dem Editor; fremde Server müssen CORS erlauben). Vorher fragt der Editor, ob dem Server vertraut wird |
| `&name=Aufgabe 1` | Name des Projekts |
| `&lang=de` / `en` | Sprache |

Derselbe Link öffnet das schon angelegte Projekt wieder, statt eine Kopie zu machen. Die Parameter verschwinden danach aus der Adresszeile. Nur `http(s)`-Adressen werden angenommen.

## Nicht enthalten (Stand jetzt)

Lauf starten/stoppen von außen, Laufergebnis und Konsole als Nachricht, schreibgeschützte Dateien, Aufgabenvorlagen aus der Seite (außer per `load`). Sie lassen sich in
`src/embed/` ergänzen; Protokoll und Prüfung liegen in `protocol.ts`.
