# miniworlds-editor – Plan (Stand v4, 2026-11-17)

Ein leichtgewichtiger, **miniworlds-first** Editor, der im Browser läuft (Zero-Install),
Python über **Pyodide** ausführt und sich an **Greenfoot** orientiert. Mit ihm kann man
„zur Not“ auch anderes Python schreiben, er ist aber auf miniworlds zugeschnitten.

## 1. Entscheidungen

| Thema | Entscheidung |
|---|---|
| Plattform | **Web-App, Pyodide-first.** Kein natives Python, kein uv, kein Rust-Kern, kein Tauri im ersten Schritt. |
| Verteilung | Statische Seite + **PWA** („App installieren“) + Service Worker für Offline. Keine Installer, kein Signing nötig. (Variante A) |
| Lizenz | **Open Source, MIT**, Copyright 2026 Andreas Siebel (siehe `LICENSE`). |
| Startseite | Der Editor **ersetzt** die bestehende `miniworlds-ide`-Startseite (miniworlds.opencoding.de). |
| Greenfoot-Client | Der Client aus `miniworlds-moodle-web-player/greenfoot/` **zieht hierher um**. Das Moodle-Repo bindet später die gebaute App ein. Umzug erst bei Funktionsgleichheit. |
| Editor | CodeMirror **6** (Ablösung von CM5). |
| Sprachen | Deutsch und Englisch von Anfang an (UI, Diagnosen, Hinweise). |
| Projektformen | **Beides.** Altprojekt = eine `main.py`, wird nie automatisch migriert. Neue Projekte: `project.toml` + `classes/<Name>.py` (eine Klasse pro Datei). |
| miniworlds-Version | Schüler wählen sie pro Projekt, der Editor warnt bei Updates und bietet Upgrade mit einem Klick. |
| Pakete („pip“) | `micropip` (reine Python-Wheels von PyPI + Pyodide-Pakete wie numpy, pygame-ce). |
| Zurückgestellt | Tauri-Desktop, nativer Python-Modus, Remote-Server, Debugger, Plugin-API. Eine `Workspace`-Schnittstelle hält die Tür offen. |

Was „fast alles“ in Pyodide **nicht** kann: Subprozesse, echte Threads, rohe Sockets, C-Erweiterungen
außerhalb der Pyodide-Distribution. Für Schul- und miniworlds-Projekte ist das meist unkritisch,
sollte in der UI aber verständlich erklärt werden.

## 2. Architektur

```
Browser (PWA)
├─ UI (TypeScript, Vite, schlankes Framework – im Spike festlegen)
│   Tabs · Dateibaum · CodeMirror 6 · Konsole · Paket-Dialog
│   Greenfoot-Ansicht: Welt · UML · Inspector · Aufgaben · Bilder
├─ Workspace-Schnittstelle (JSON-RPC-artig)   ← UI spricht nur hiermit
│   fs · packages · run · language · scenario
│   └─ BrowserBackend: OPFS (Fallback IndexedDB), ZIP-Import/-Export
├─ Runtime: Pyodide (gepinnt) + pygame-ce + miniworlds (micropip)
│   └─ ScenarioHost (JSON-Kommandos: act/run/pause/place/inspect/call/…)
└─ Language-Worker (leichtes Pyodide: jedi + miniworlds-Hinweise, siehe S2)
```

Regeln:
- Keine direkten Browser- oder Tauri-APIs in UI-Komponenten, nur über `Workspace`.
- Hinweise, Klassenmodell und API-Index kommen aus dem **installierten miniworlds** (`tools/code_hints`,
  `class_model`, `api_index`), damit sie zur gewählten Version passen. Ältere Versionen ohne diese Module
  fallen auf generische Hinweise zurück und lösen die Update-Warnung aus.
- Stoppen ohne SharedArrayBuffer: Cross-Origin-Isolation (COOP/COEP) kollidiert mit dem Einbetten per iframe
  in Moodle. Daher wird kein SAB vorausgesetzt, Stop = Reset bzw. Worker beenden.
- Offline: Service Worker mit versioniertem Cache (Pyodide, Wheels, App-Shell). Pyodide-Version gepinnt.

## 3. Features (Greenfoot-orientiert)

Vorhanden im bestehenden Client, zu portieren: Welt mit Act/Run/Pause/Tempo, UML aus dem Code (`ast`),
Figur erzeugen/verschieben/löschen, Inspector und Methodenaufruf, „Welt speichern“ (`export_code`),
Startaufstellung, Auto-Reload mit Syntaxprüfung, Vorlagen und Aufgaben, Bildwahl, Autovervollständigung
und Hinweise.

Neu: Mehrdatei-Tabs und Dateibaum, beide Projektformen, „Neue Klasse“ legt Datei + Import an (zirkuläre
Importe beachten), Paket-Dialog, Versionswahl + Update-Warnung, DE/EN, ZIP-Import/-Export,
optional Ordnerzugriff per File System Access API (nur Chromium), Embed-API per `postMessage` für Moodle/H5P.

## 4. Spikes (Meilenstein 0) mit Abbruchkriterien

| # | Frage | Erfolgskriterium |
|---|---|---|
| S1 | Vite + TS + CodeMirror 6 mit Python-Modus und den vorhandenen Hints: Bundle-Größe, Start | App-Shell (ohne Pyodide) ≤ 2 MB gzip |
| S2 | **Language Service im Browser:** Kandidaten: (a) nur miniworlds-Tools + `ast`, (b) ruff-WASM für Lint/Format, (c) ty- oder Pyrefly-WASM, (d) jedi in einem zweiten Pyodide-Worker | Completion/Hover/Diagnose auf miniworlds-Code gut genug, Latenz < 200 ms, Zusatzspeicher akzeptabel. ty-WASM: das Playground ist WASM, eine wiederverwendbare Bibliothek habe ich nicht gefunden → ggf. selbst bauen. |
| S3 | **Pyodide im Worker** mit pygame-ce: Canvas/OffscreenCanvas, FPS. Der Pyodide-Pfad lief schon einmal mit 4,9 FPS (behoben). Pyglet verlangt Main-Thread, bei pygame-ce ungeprüft. | 60 FPS mit offenem Editor, oder Beschluss „Main-Thread bleibt“ |
| S4 | Speicher: OPFS-Projekte, Kopie ins Emscripten-FS beim Start vs. `mountNativeFS` | Mehrdatei-Projekt startet in < 2 s (**erfüllt**, siehe unten) |
| S5 | `micropip` + Versionsliste von PyPI, Offline-Cache der Wheels | Version wählen, Update-Warnung, Offline-Start |
| S6 | Safari/Firefox/Chromebook: OPFS, Service Worker, Speicherquote | Liste der Einschränkungen |

### Ergebnisse S1 (2026-11-17)

- Stack: Vite 8, TypeScript 7, **Preact 11**, CodeMirror 6 (Python-Modus), Vitest. Framework-Entscheidung: **Preact** (ca. 4 KB, React-ähnlich, passt zu schrittweisem Port der `gf-*`-Module; CM6 wird imperativ in `EditorHost` gekapselt).
- Größe der App-Shell: **156 KB gzip** (470 KB roh) gegen Budget 2 MB, `npm run size`.
- `Workspace`-Interface (`src/workspace/types.ts`) mit `OpfsFs` und `MemoryFs` (Fallback und Test-Double); die UI importiert nur das Interface.
- Headless-Chromium-Smoketest (`test/smoke.py`): Tabs, Dateibaum, neue Datei, Autosave, Persistenz über Reload in OPFS; JS-Heap ca. 9,5 MB; keine Konsolenfehler.
- Nicht geprüft: Safari/Firefox (S6), Speicher des gesamten Tabs, Pyodide.

### Ergebnisse S3: Pyodide im Worker (2026-11-17)

Aufbau: `spikes/s3/` (Seite mit `mode=main|worker`, `load=<ms UI-Last je 100 ms>`; `run_matrix.py`, `input_test.py`).
Szene: miniworlds-4.4.0.15-Welt, 400x300, 150 bewegte Kreise, `fps=60`; Pyodide 0.29.3. Headless-Chromium mit
Software-Rendering, je 6 s, 3 Läufe. Absolute Werte sind nicht übertragbar, der Vergleich schon.

| | FPS | Frame p95 | UI-Verzögerung p95 | UI blockiert beim Booten |
|---|---|---|---|---|
| Main-Thread, ohne Last | 46 / 60 / 60 | 18–34 ms | 2–13 ms | 1,4–2,5 s |
| Worker, ohne Last | 58 / 60 / 60 | 17–18 ms | 0,1 ms | ca. 0 s |
| Main-Thread, 50 % UI-Last | **26–30** | 65–77 ms | 35–54 ms | 2,5–3,2 s |
| Worker, 50 % UI-Last | **55–59** | 17–32 ms | 38 ms (= die Last selbst) | ca. 0 s |

Befunde:
1. **Der Worker trägt.** Bei hoher UI-Last (stellvertretend für CM6 + Language Service) hält er ~57 FPS, der Main-Thread fällt auf ~28. Zusätzlich blockiert das Pyodide-Booten die UI nicht mehr.
2. **rAF-Pacing von miniworlds funktioniert im Worker** (Chromium: `requestAnimationFrame` im Dedicated Worker), 60 FPS stabil.
3. **Der Worker braucht eine Polyfill-Schicht**, weil SDL/pygame-ce den DOM erwarten: `self.screen`, ein minimales `self.document` (EventTarget), und am OffscreenCanvas `style`, `getBoundingClientRect`, `focus`. Ohne sie bricht `pygame.display.set_mode` ab. Diese Schicht ist an Pyodide/SDL-Versionen gekoppelt und braucht Regressionstests.
4. **Eingabe muss weitergeleitet werden:** Im Worker kommen keine Browser-Ereignisse an. Weitergeleitete Ereignisse per `pygame.event.post` (KEYDOWN/UP, MOUSEBUTTONDOWN/UP) lösen `on_key_down` und `on_mouse_left` aus. Gehalten-Zustand verhält sich wie im Main-Thread (miniworlds führt ihn aus Ereignissen). Nicht geprüft: Mausposition/-bewegung, Mausrad, Touch, Texteingabe, Fokus, Vollbild.
5. **Audio fehlt im Worker:** kein `AudioContext`, und der SDL-Dummy-Treiber scheitert an Threads (`Couldn't create audio thread startup semaphore`). Für den Test wurde der Mixer gestubbt. Nötig: (a) miniworlds soll ohne Audio sauber weiterlaufen (Fehler abfangen, Audio deaktivieren), (b) später eine Audio-Brücke über WebAudio im Main-Thread.
6. **Die Fehler waren hart, nicht weich:** Jede fehlende API führte zu `Pyodide has suffered a fatal error`. Das Debuggen kostete mehrere Schritte.

Entscheidung: **Worker-Runner als Standard, Main-Thread-Runner als Fallback** (z. B. Safari-Versionen ohne passenden
Worker-Support, wird in S6 geprüft). Beide implementieren dasselbe `Runner`-Interface; `ScenarioHost` spricht JSON-Strings
und passt damit direkt auf `postMessage`. Das Language-Service-Pyodide (falls S2 ein zweites braucht) läuft in einem
eigenen Worker. Offene Messungen: Speicher eines zweiten Pyodide, Verhalten in Firefox/Safari, echte Grafikhardware.

### Ergebnisse S2: Language Service im Browser (2026-11-17)

Aufbau: `spikes/s2/` (Node mit derselben V8-Engine wie Chromium; Pyodide 0.29.3, miniworlds 4.4.0.15). Keine Browser-
Messung, Safari/Firefox ungeprüft. Beispielcode mit absichtlichen Anfängerfehlern in `sample.mjs`.

| Kandidat | Größe | Latenz | Befund |
|---|---|---|---|
| **miniworlds `code_hints` + `api_index` + `class_model`** | API-Index 48 KB JSON | Hinweise 1,8 ms warm (erstmals 9 ms), Index bauen 14 ms | Findet `self.mov` → „Meintest du `self.move`?“, undefinierten Namen, `def fressen()` ohne `self`, auf Deutsch, zur Version passend. |
| **jedi 0.19.2 in Pyodide** | 1,6 MB Wheel + 0,1 MB parso; Heap 42 MB (leicht), 61 MB (mit numpy/pygame) | Completion 15–30 ms warm, erstmals 0,5–0,9 s; Signatur/Hover ca. 10 ms | Findet `self.` (187 Treffer), `mw.` (59), eigene Methoden, Präfixe; Signaturen und Docstrings stimmen. **Lücke:** `self.world.` liefert 0 Treffer. Keine Diagnosen. |
| **ruff-wasm-web 0.17.5** | WASM 9,7 MB roh / 3,6 MB gzip | `check` 0,15 ms p50, 681 Zeilen in 7 ms, Init 36 ms | Findet F821 (undefinierter Name), F401 (ungenutzter Import), F841 (ungenutzte Variable); formatiert korrekt. Findet **nicht** `self.mov` und fehlendes `self`. Meldungen englisch. |
| **ty / Pyrefly (WASM)** | – | – | Keine npm-Pakete gefunden (404). Nur selbst bauen. Zurückgestellt. |
| **browser-basedpyright 1.40.2** | 20,7 MB entpackt | nicht gemessen | Echte Typprüfung, aber zu schwer fürs v1-Budget. Zurückgestellt. |

Nachweis „leichter Language-Worker“: Ein zweites Pyodide **ohne** pygame/numpy (nur jedi + miniworlds-Wheel ohne
Abhängigkeiten, vorberechneter API-Index) führt `code_hints.check` (4 ms) und `class_model.analyze` aus; Heap 24 MB nach dem Start.
Dafür muss `miniworlds/__init__` (importiert pygame) umgangen werden: im Spike per Stub-Modul in `sys.modules`.

Entscheidung (Schichten, in dieser Reihenfolge einführen):
1. **miniworlds-Hinweise** (v1-Kern): ms-schnell, deutsch, versionsgenau.
2. **jedi im eigenen Language-Worker** für Completion/Signatur/Hover. `self.world.` ergänzt der `api_index` (wie in `gf-assist`).
   Der Worker ist von der Welt getrennt: In S3 riss ein harter Pyodide-Fehler die ganze Instanz mit, das darf die Editor-Hilfen nicht treffen.
3. **ruff-wasm** später, lazy geladen: Formatieren, „ungenutzt“-Hinweise; die häufigsten Codes ins Deutsche übersetzen.
4. **Typprüfer** (ty/Pyrefly/basedpyright) erst, wenn ein fertiges WASM-Paket existiert oder das Budget es zulässt.

Anforderungen an miniworlds (Upstream): (a) `miniworlds.tools` ohne pygame importierbar machen (lazy `__init__` oder eigenes
Paket), statt Stub-Trick; (b) Audio-Fehler abfangen (aus S3); (c) API-Index je Version als Datei veröffentlichen.

### Ergebnisse S5: Versionen, micropip, Offline (2026-11-17)

Aufbau: `spikes/s2/versions.mjs` (alle Wheels in Pyodide/Node installieren und importieren), `spikes/s5/` (Service Worker,
Playwright-Test), `src/packages/versions.ts` mit Tests (Versionsliste, Update-Status). Offline im Test wird **im Service Worker**
simuliert, weil Playwrights Offline-Modus dessen Anfragen nicht erreicht.

1. **PyPI-Metadaten:** `https://pypi.org/pypi/miniworlds/json` ist 100 KB groß (Simple-API 65 KB), CORS `*`, `max-age=900`.
   Die Schlüssel in `releases` sind **nicht** in Versionsreihenfolge ("4.4.0.9" kommt nach "4.4.0.16"): immer numerisch sortieren.
   Aktuell 65 Versionen, 60 mit reinem Wheel; Abhängigkeiten: `pygame-ce`, `numpy` (beide in der Pyodide-Distribution).
2. **Installierbarkeit:** Alle 38 Wheels von **4.0.0.0 bis 4.4.0.16** lassen sich in Pyodide installieren und importieren,
   alle 22 der 3.x-Reihe nicht (fehlende Pakete wie `easygui`, Syntaxfehler). Es ist nur der Import geprüft, nicht der Weltlauf.
   Stufen: `full` ab 4.4.0.15 (ScenarioHost, `class_model`, `code_hints`), `basic` 4.0.0.0–4.4.0.14 (läuft, ohne Greenfoot-Ansicht und Hinweise), darunter nicht unterstützt.
3. **Offline:** Der Service Worker (Pyodide/jsDelivr und Wheels: cache-first; PyPI-Metadaten: network-first mit 3 s Timeout und Cache-Rückfall;
   eigene Shell: network-first mit Rückfall, Query ignoriert) startet Pyodide und installiert eine zuvor geladene Version ohne Netz.
   Der Update-Check liefert dann den zuletzt bekannten Stand (kein falscher Alarm, im Code als `unknown` bzw. alter Stand behandelt).
   Eine **nicht gecachte** Version scheitert mit `AbortError: Failed to fetch`; die UI muss das als „offline nicht verfügbar“ erklären.
4. **Größe:** Nach dem ersten Start mit zwei miniworlds-Versionen liegen **17 MB** im Cache (16,3 MB jsDelivr, 0,6 MB Wheels, 0,2 MB Metadaten);
   jede weitere miniworlds-Version kostet rund 0,26 MB. Das ist deutlich weniger als die frühere Schätzung von 20–40 MB.
5. **Start:** Pyodide + Pakete brauchen auch aus dem Cache 4–5 s (Headless-Chromium); der Worker-Betrieb (S3) hält die UI dabei frei.

Entscheidungen:
- **Versionswahl:** Liste aus `availableVersions()` (neueste zuerst), `full`-Versionen normal, `basic` mit Hinweis „ohne Greenfoot-Ansicht und Hinweise“.
- **Update-Warnung:** nur bei `update-available`; offline oder bei PyPI-Fehler schweigen.
- **Offline-Verfügbarkeit** pro Version anzeigen (im Cache oder nicht); die Shell wird beim Service-Worker-`install` vorab gecacht (im Spike über einen zweiten Besuch simuliert).
- **CDN-Abhängigkeit:** Pyodide kommt von jsDelivr. Schulnetze können das sperren; Selbst-Hosting der ~16 MB unter der eigenen Origin ist eine einfache Absicherung und wird für das Release vorgesehen (Variante: miniworlds-Wheels spiegeln).

### Ergebnisse S4: Projekt ins Emscripten-FS (2026-11-17)

Aufbau: `spikes/s4/` (`worker.js`, `index.html`, `run.py`, `serve.py`). Synthetische Projekte in OPFS, Pyodide im Worker (warm gebootet);
gemessen wird vom Run-Klick bis „alle Klassen importiert“. Playwright-Chromium und -Firefox 148. WebKit lässt sich auf diesem Rechner nicht starten
(fehlende Host-Bibliotheken) und bleibt für S6 auf echten Geräten offen.

Drei Wege: **A** Worker liest OPFS selbst und kopiert ins FS · **B** `pyodide.mountNativeFS` auf ein OPFS-Verzeichnis · **C** Hauptthread liest über die
`Workspace`-Schnittstelle und schickt `{Pfad: Bytes}` per `postMessage` (Transfer), der Worker schreibt mit `FS.writeFile`.

Gesamtzeit bis zum importierten Projekt (ms, Chromium / Firefox):

| Projekt | Größe | A (kalt) | B | C |
|---|---|---|---|---|
| klein: 5 Klassen, 5 Bilder | 0,1 MB, 13 Dateien | 90 / 243 | 36 / 49 | 23 / 18 |
| typisch: 15 Klassen, 40 Bilder | 1,2 MB, 58 Dateien | 102 / 544 | 59 / 174 | 34 / 74 |
| groß: 40 Klassen, 200 Bilder | 10 MB, 243 Dateien | 279 / 920 | 234 / 584 | 165 / 222 |

(Reihenfolge im Test: A, A erneut, C, B im selben Worker. Nur **A (kalt)** enthält den ersten, kalten Python-Import des Projekts (70–120 ms Chromium, 235–720 ms Firefox);
bei B und C waren die Module schon im Interpreter-Cache, ihr Startanteil ist mit 2–17 ms ein Warmwert. Fairer Vergleich: bei B und C den kalten Import dazurechnen.
Dann liegen alle drei Wege in derselben Größenordnung, C mit Hauptthread-Lesen und Transfer ist kein Geschwindigkeits-, sondern ein Architekturgewinn.)

1. **Das Kriterium (< 2 s) ist mit großem Abstand erfüllt**, auch bei 10 MB und in Firefox (höchstens 0,9 s).
2. **C wird gewählt, weil es zur Architektur passt (nicht wegen der Geschwindigkeit):** Der Worker braucht keinen eigenen OPFS-Zugriff, die UI bleibt hinter `Workspace` (später auch Remote- oder Tauri-Dateien ohne Änderung am Runner).
   Dasselbe Nachrichtenformat trägt „Datei geändert“ (inkrementelles Senden: nur Dateien, die sich seit dem letzten Lauf geändert haben).
3. **B (`mountNativeFS`) funktioniert** (auch Rückschreiben per `syncfs`, 9–45 ms bzw. 27–217 ms), ist aber nicht schneller als A (großes Projekt, Firefox: 343 ms Mount gegenüber 197 ms Kopieren), lädt beim Mounten ohnehin alle Dateien
   und koppelt den Runner an OPFS-Handles. Es wird nicht verwendet.
4. **Rückweg:** Vom Projekt geänderte, neue oder gelöschte Dateien (z. B. „Welt speichern“) werden über ein Manifest (`Pfad → mtime:Größe`) vor und nach dem Lauf verglichen
   (0,6–2 ms) und als Nachricht an den Hauptthread geschickt, der sie über `Workspace.fs` schreibt. Ein Vergleich nur über den Zeitstempel (ohne Vorher-Manifest) war falsch: alle Dateien sahen „neu“ aus.
5. **Erneuter Lauf im selben Worker** sieht Änderungen (11 ms Chromium, 21 ms Firefox), wenn vorher alle Module aus dem Projektordner aus `sys.modules` entfernt und
   `importlib.invalidate_caches()` aufgerufen werden. Ohne das bleiben alte Klassen aktiv, auch nach einem Projektwechsel. Der warme Worker spart damit die ~2 s Pyodide-Start pro Lauf.
   Echten Reset (z. B. nach Endlosschleife) gibt es nur durch Worker-Neustart.
6. **Firefox-Nebenbefund (für S6):** Pyodide-Start im frisch gestarteten Headless-Firefox dauert 6,7–16,5 s statt 1,9–2,2 s in Chromium; OPFS, `createWritable` und Worker-Module laufen.
   Der HTTP/1.0-Server von `python -m http.server` genügt Firefox nicht (Navigation wird abgebrochen); `spikes/s4/serve.py` spricht HTTP/1.1.

Entscheidungen:
- **Runner-Protokoll:** `run { files, entry }` und `sync { changed, deleted }`; Standard ist „alle Dateien beim ersten Lauf, danach nur Änderungen“.
- **Projektordner im FS:** fest `/home/pyodide/project`, vor jedem Lauf Projektmodule aus `sys.modules` entfernen.
- **Dateien, die Python schreibt,** gelangen über das Manifest-Diff zurück; Binärdaten (Bilder) werden mit Transfer verschickt.

## 5. Meilensteine

0. Spikes S1–S6, danach Festlegung von Framework und Language-Service.
1. **Editor-Kern:** Tabs, Dateibaum, CM6, Projektformen, OPFS + ZIP, DE/EN, Suchen/Ersetzen. **Umgesetzt (2026-11-17)**, siehe „Stand Meilenstein 1“.
2. **Run + Konsole + Pakete:** Pyodide-Runner, Fehler → Code-Sprung, `micropip`-Dialog, Versionswahl + Update-Warnung. **Umgesetzt (2026-11-17)**, siehe „Stand Meilenstein 2“.
3. **Greenfoot-Ansicht** als Panel (Port von `gf-host`, `gf-uml`, `gf-assist`, `gf-images`, `gf-journal`);
   das bestehende `test/e2e.py` läuft weiter.
4. **Language Service** nach Ergebnis von S2.
5. **Release:** PWA, Hosting (statisch), CI mit Tests, Moodle-iframe; der Editor ersetzt die `miniworlds-ide`-Startseite
   (Deployment unter miniworlds.opencoding.de); danach Migration des alten Greenfoot-Clients.
6. **Später:** Desktop-Hülle (Tauri), Remote-Dateiablage für Klassen, Debugger, Plugin-API.

### Stand Meilenstein 1 (2026-11-17)

Umgesetzt und getestet (54 Vitest-Tests, `test/smoke.py` in Chromium und Firefox; Bundle 175 KB gzip):
- **Mehrere Projekte** (`ProjectStore`: OPFS, Fallback Speicher mit Warnbanner), Menü: neu, umbenennen, duplizieren, löschen, wechseln, ZIP-Export/-Import. Zuletzt geöffnetes Projekt wird gemerkt.
- **Projektformen:** `project.toml` (Teilmenge von TOML, `[project]` und `[packages]`) + `classes/<Name>.py`; Einzeldatei-Projekte (`main.py`) bleiben unverändert und bekommen nur ein Badge.
- **Neue Klasse** (Figur/Welt/normal) legt `classes/<Name>.py` an und trägt den Import in `main.py` ein (idempotent, kennt Docstrings und mehrzeilige Imports); beim Löschen einer Klassendatei verschwindet die Importzeile wieder.
- **Dateibaum** (Ordner einklappbar, umbenennen/löschen auch für Ordner), **Tabs** mit Ungespeichert-Punkt, Autosave (500 ms), `Session` (testbar, ohne UI-Framework) trägt offene Tabs, Edits und Umbenennen/Löschen.
- **Suchen/Ersetzen:** im Editor (CM6, eingedeutscht) und **projektweit** (Strg+Umschalt+F; Groß-/Kleinschreibung, ganzes Wort, Regex; Ersetzen nur nach Bestätigung).
- **Bilder und Binärdateien:** Hochladen per Dialog oder Drag & Drop (Bilder landen in `images/`), Vorschau; keine Bearbeitung im Textfeld.
- **DE/EN** (Erkennung über Browsersprache, Wahl gemerkt, Tests auf gleiche Schlüssel und Platzhalter), eigene Dialoge statt `window.prompt` (iframes können Modals sperren).
- ZIP: Wrapper-Ordner und Mac-/Git-Müll werden entfernt, `..`-Pfade, mehr als 5000 Dateien oder 150 MB abgelehnt.

Bewusst noch nicht enthalten:
- **Klasse umbenennen als Refactoring** (Datei + Klassenname + Imports); umbenennen verschiebt nur die Datei. Später zusammen mit der UML-Ansicht.
- **Leere Ordner:** nicht darstellbar im Speicher-Fallback; Ordner entstehen über Pfade wie `images/x.png`.
- Ordnerzugriff per File System Access API und Embed-API (`postMessage`) für Moodle.
- Version/Update-Anzeige in der Statusleiste (kommt mit Meilenstein 2, `project.toml` hat das Feld `miniworlds` schon).

### Stand Meilenstein 2 (2026-11-17)

Umgesetzt und getestet (88 Vitest-Tests; `test/run.py` mit echtem Pyodide in Chromium und Firefox, `test/smoke.py`; App 188 KB gzip inkl. Worker):
- **Runner** (`src/runtime/`): Pyodide im Worker (Ergebnis S3) mit OffscreenCanvas; Zustandsmaschine `idle → booting → ready → running → stopping` (`Runner`, mit Fake-Worker getestet);
  Python-Lebenszyklus in `runner.py` (Projekt anlegen, starten, stoppen, Module entfernen, Eingaben einspeisen), Protokoll in `protocol.ts`.
  Das Projekt kommt wie in S4 beschlossen per `postMessage` in den Worker (alle Dateien pro Lauf), Änderungen am Dateisystem kommen per Manifest-Diff zurück
  (beim Programmende und beim Stoppen) und werden über `Workspace` geschrieben.
- **Start/Stopp:** Strg+Enter. Warmstart des zweiten Laufs 0,2 s, Pyodide wird beim Öffnen eines Projekts im Hintergrund vorgeladen (Boot headless: Chromium 3–10 s, Firefox 24 s mit leerem Cache).
  Stopp fragt das Programm freundlich (`app.quit()`, Tasks abbrechen, `App.reset()`); antwortet der Worker nach 1,5 s nicht (Endlosschleife), wird er beendet und beim nächsten Start neu geladen.
- **Konsole:** `print` und Fehler; Tracebacks ohne Runner-Frames, `File "/project/…", line N` ist ein Link. Bei einem Absturz springt der Editor zur Fehlerzeile und markiert sie.
- **Eingabe:** Tastatur (pygame-Keycodes, `KEYDOWN` + `TEXTINPUT`), Maus (Position auf Canvas-Pixel umgerechnet, Pointer Capture), Mausrad; ein Test prüft Klick, Taste und Pfeiltaste in der echten Welt.
- **Pakete:** Dialog installiert per `micropip` in die laufende Umgebung (kein Neustart nötig) und speichert in `[packages] requires` der `project.toml`; Fehlschläge werden erklärt.
- **Versionen:** Versionsmenü (Liste aus PyPI, im Browser zwischengespeichert, offline weiter nutzbar), `basic`-Versionen als „eingeschränkt“ markiert. Neue Projekte pinnen die neueste Version;
  ältere gepinnte Version → Hinweis „Neue Version verfügbar“ mit Aktualisieren-Knopf. Konfigurationswechsel (Version, Paket entfernt) startet den Worker beim nächsten Lauf neu.
  Einstellungen stehen in `project.toml`, bei Einzeldatei-Projekten im Browser-Speicher (nicht im ZIP-Export).
- **Sound:** Ein Worker hat keinen AudioContext; `pygame.mixer` ist dort stumm geschaltet (Sound/Musik laufen ohne Fehler, ein Hinweis erscheint einmal pro Lauf).
  Ohne diese Attrappen meldet miniworlds irreführend „File … does not exist“.
- Pyodide-Adresse per `VITE_PYODIDE_BASE` änderbar (Selbst-Hosting).

Bekannte Lücken:
- **Audio-Ausgabe** (Brücke zum Hauptthread über Web Audio) fehlt.
- **`input()`** gibt eine erklärende Fehlermeldung; echte Eingabe im Worker bräuchte `SharedArrayBuffer` (COOP/COEP, kollidiert mit dem Einbetten in Moodle) oder ein anderes Verfahren.
- **Offline/PWA:** Service Worker und Manifest (Prototyp in `spikes/s5`) kommen mit Meilenstein 5; bis dahin braucht der Start Netz.
- **Windows-Projekte mit anderer Groß-/Kleinschreibung** (`Images/Player.PNG`): der alte Web-Player legt dafür kleingeschriebene Aliase an, hier noch nicht.
- Schreibt ein hart beendetes Programm Dateien, gehen sie verloren; große Projekte werden bei jedem Lauf komplett übertragen (10 MB: ~0,2 s), inkrementell erst bei Bedarf.
- Firefox: Pyodide-Start deutlich langsamer als Chromium (S6 mit echten Geräten messen).

## 6. Risiken

1. FPS-Einbruch, wenn Welt, CM6 und Language Service denselben Thread teilen (in S3 bestätigt: ~28 statt ~57 FPS bei hoher UI-Last) → Worker-Runner. Neues Risiko: Polyfill-Schicht für SDL im Worker ist fragil, Audio fehlt.
2. Language-Service-Qualität im Browser (ty ist Beta, WASM-Wiederverwendbarkeit offen).
3. Safari/iPadOS-Grenzen bei Speicher, OPFS und Service Worker.
4. Pyodide-Größe beim ersten Laden (Schätzung 20–40 MB, messen) in langsamen Schulnetzen.
5. Zirkuläre Importe beim Modell „eine Klasse pro Datei“.
6. Ohne Server kein Speichern in Moodle (nur ZIP) – wie im bestehenden Client.

## 7. Offene Punkte

- Die Java-/Block-Varianten der alten `miniworlds-ide` (H5P-Python-, Miniworlds- und Java-IDEs, jeweils Text und Blocks) bleiben vorerst auf den alten H5P-Seiten erreichbar und werden vom neuen Editor aus **verlinkt**. Andreas zieht sie später auf h5p.opencoding.de oder eine andere URL um; die Link-Ziele sind dann anzupassen (Konfiguration, nicht hartcodieren).
- Framework (Preact, Svelte, Lit, Vanilla) – im Spike S1 entscheiden.
- Schulrechner-Diagnose (Browser, WASM, OPFS, Proxy) – wenn der Test ansteht.
