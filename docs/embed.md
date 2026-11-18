# Editor in eine andere Seite einbetten (Moodle, Kursseite)

Der Editor lässt sich per `<iframe>` einbetten. Die Seite lädt ein Projekt hinein, bekommt Änderungen gemeldet und kann
die Dateien jederzeit abholen, z. B. um sie in Moodle als Abgabe zu speichern.

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
    if (m.type === 'change') console.log('bearbeitet', Object.keys(m.files))
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

**Editor → Seite**

| `type` | Felder | Bedeutung |
|---|---|---|
| `ready` | – | Der Editor hört zu (kommt einmal beim Start). Erst danach `load` senden. |
| `loaded` | `id?` | `load` wurde angewendet. |
| `files` | `id?`, `files` | Alle Projektdateien (Antwort auf `get-files`). |
| `change` | `files` | Der Nutzer hat etwas geändert, 0,5 s nach der letzten Eingabe. |
| `error` | `id?`, `message` | Eine Nachricht wurde abgelehnt (ungültiger Pfad, zu viele oder zu große Dateien, …). |

Grenzen wie beim ZIP-Import: höchstens 5000 Dateien und 150 MB; Pfade ohne `..`. Das Projekt hat keinen Namen und keine Projektverwaltung;
ohne `load` startet der Editor nach 1,5 s mit einem leeren Startprojekt (so funktioniert die URL auch allein).

## Sicherheit

- Der Editor liest nur Nachrichten vom Fenster, das ihn einbettet (nicht von anderen Fenstern oder Tabs).
- Antworten gehen immer an den Ursprung (`event.origin`) der letzten gültigen Nachricht, nie an `*`. Solange die Seite nichts gesendet hat, geht nur `ready` hinaus
  (ohne Daten); `change` wartet, bis die Seite sich gemeldet hat. Ursprung `null` (iframe mit `sandbox` ohne `allow-same-origin`) wird abgelehnt.
- **Erlaubte Seiten:** In `config.json` lässt sich die Liste festlegen: `"embedOrigins": ["https://moodle.example.org"]`. Dann bedient der Editor nur diese Ursprünge
  und meldet sich auch nur bei ihnen. Ohne Eintrag darf jede Seite einbetten – sie sieht dann nur, was sie selbst geladen hat.
- Das eingebettete Projekt liegt **nur im Arbeitsspeicher**. Der Editor greift nie auf die Projekte zu, die jemand in der Vollversion im Browser gespeichert hat.
- Der Rahmen braucht keine besonderen Header (kein `COOP`/`COEP`); `Content-Security-Policy: frame-ancestors` auf dem Server des Editors kann die Einbettung zusätzlich auf Moodle beschränken.

## Nicht enthalten (Stand jetzt)

Lauf starten/stoppen von außen, Laufergebnis und Konsole als Nachricht, schreibgeschützte Dateien, Aufgabenvorlagen aus der Seite. Sie lassen sich in
`src/embed/` ergänzen; Protokoll und Prüfung liegen in `protocol.ts`.
