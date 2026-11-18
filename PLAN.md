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
3. **Greenfoot-Ansicht** als Panel (Port von `gf-host`, `gf-uml`, `gf-assist`, `gf-images`, `gf-journal`); **umgesetzt (2026-11-17)** bis auf `gf-assist` (gehört zu Meilenstein 4), siehe „Stand Meilenstein 3“.
4. **Language Service** (jedi, miniworlds-Hinweise, ruff): **umgesetzt (2026-11-17)**, siehe „Stand Meilenstein 4“. Ein Typprüfer (ty/Pyrefly/basedpyright) bleibt zurückgestellt.
5. **Release:** PWA, Hosting (statisch), CI mit Tests, Moodle-iframe; der Editor ersetzt die `miniworlds-ide`-Startseite
   (Deployment unter miniworlds.opencoding.de); danach Migration des alten Greenfoot-Clients. **Technik umgesetzt (2026-11-18)**, siehe „Stand Meilenstein 5“; Deployment und Ablösung der alten Seiten stehen noch aus (`docs/deploy.md`).
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
- **Sound:** Ein Worker hat keinen AudioContext; zuerst war `pygame.mixer` dort stumm geschaltet (Hinweis einmal pro Lauf). Inzwischen spielt die Seite den Ton, siehe „Nächste Schritte nach der Praxisrückmeldung“.
  Ohne diese Attrappen meldet miniworlds irreführend „File … does not exist“.
- Pyodide-Adresse per `VITE_PYODIDE_BASE` änderbar (Selbst-Hosting).

Bekannte Lücken:
- **Audio-Ausgabe** (Brücke zum Hauptthread über Web Audio) fehlt.
- **`input()`** gab zuerst eine erklärende Fehlermeldung; inzwischen funktioniert es ohne `SharedArrayBuffer`, siehe „Nächste Schritte nach der Praxisrückmeldung“.
- **Offline/PWA:** Service Worker und Manifest (Prototyp in `spikes/s5`) kommen mit Meilenstein 5; bis dahin braucht der Start Netz.
- **Windows-Projekte mit anderer Groß-/Kleinschreibung** (`Images/Player.PNG`): der alte Web-Player legt dafür kleingeschriebene Aliase an, hier noch nicht.
- Schreibt ein hart beendetes Programm Dateien, gehen sie verloren; große Projekte werden bei jedem Lauf komplett übertragen (10 MB: ~0,2 s), inkrementell erst bei Bedarf.
- Firefox: Pyodide-Start deutlich langsamer als Chromium (S6 mit echten Geräten messen).

### Stand Meilenstein 3 (2026-11-17)

Umgesetzt und getestet (151 Vitest-Tests; Browsertests `test/miniworlds.py` und `test/templates.py` in Chromium und Firefox; App 207 KB gzip):
- **Ansicht „Greenfoot“** (Umschalter neben „Programm“, pro Projekt gemerkt; braucht miniworlds ≥ 4.4.0.15): Der Runner startet die Welt pausiert unter dem `ScenarioHost`
  (`run { scenario: true }`), Befehle laufen als Request/Reply zum Worker (`rpc`, typisiert in `ScenarioClient`). Act, Run/Pause, Tempo (1/8×…8×), Reset, Schrittzähler.
- **Welt-Interaktion** (nur pausiert; läuft die Welt, gehören Maus und Tastatur dem Programm): Figur platzieren (Klasse „bewaffnen“, Shift = mehrfach, Esc = abbrechen; Konstruktor-Werte werden einmal abgefragt),
  auswählen und ziehen, Rechtsklick → Methoden aufrufen (Argumente nur als Python-Literale), Inspizieren, Löschen, „Neu: Klasse“ an der Klickstelle, „Welt speichern“ (Code kopieren oder in den Editor einfügen).
- **Startaufstellung** (Journal, Datei `greenfoot.json`, kompatibel zum alten Web-Client): Alles, was vor dem ersten Schritt von Hand passiert, wird nach Reset und Auto-Reload wieder abgespielt; „Als Start merken“, „Aufstellung leeren“,
  Hinweis bei Änderungen nach dem ersten Schritt.
- **Auto-Reload:** Nach einer Tipp-Pause (0,9 s) prüft `compile()` im Worker alle Dateien. Ein Syntaxfehler lässt die Welt stehen und zeigt eine Meldung mit Sprung zur Zeile, sonst lädt die Welt neu (Startaufstellung inklusive). Abschaltbar.
- **Klassendiagramm** (Seitenleiste „Klassen“, `class_model.analyze` im Worker, nur `ast`, Modell lebt auch bei Syntaxfehlern in einer Datei): Kästen mit Attributen und Methoden, Vererbungspfeile bis zu den miniworlds-Klassen (gestrichelt),
  Zähler lebender Objekte, schraffiert = seit dem Start geändert. Verknüpfungen: Diagramm → Code (Klasse oder Member anklicken), Cursor im Editor → Klasse markiert, ausgewählte Figur → Klasse markiert (orange),
  Kontextmenü: „Neu X()“, Quelltext, **Bild festlegen** (Bibliothek, Projekt, Upload; schreibt `self.add_costume(...)` und Größe in `on_setup`), **Neue Unterklasse** (Datei in `classes/` plus Import in `main.py`).
- **Vorlagen mit Aufgaben:** Krabbe, Münzen sammeln und Pong (aus den Szenarien des alten Clients per `scripts/split_scenarios.py` in eine Klasse pro Datei zerlegt, DE und EN); Aufgabenliste mit Haken im Projekt (`greenfoot.json`).

Hinweise und Grenzen:
- Die Welt sieht nur **Klassen, deren Modul geladen wurde**: `main.py` muss jede Klasse importieren. „Neue Klasse“ und die Vorlagen tun das; bei Hand-Anlage muss man den Import selbst schreiben (ein Hinweis im Diagramm wäre eine Idee).
- Ein Wechsel der Version setzt die Welt zurück; die Greenfoot-Ansicht ist bei `basic`-Versionen gesperrt (Tooltip erklärt warum).
- **Noch offen für Funktionsgleichheit mit dem alten Client:** Autovervollständigung und Hinweise (Meilenstein 4), Offline/Service Worker und Einbetten in Moodle per `postMessage` (Meilenstein 5). Danach kann der Client aus `miniworlds-moodle-web-player/greenfoot/` abgelöst werden.
- „Klasse umbenennen“ als Refactoring fehlt weiterhin (Meilenstein 1 vermerkt).

### Stand Meilenstein 4 (2026-11-17)

Umgesetzt und getestet (164 Vitest-Tests; Browsertest `test/assist.py` in Chromium und Firefox; Shell 219 KB gzip, dazu **lazy** das ruff-WASM mit 3,5 MB gzip; `scripts/size.mjs` prüft beides getrennt: Shell ≤ 2 MB, Lazy ≤ 5 MB):
- **Eigener Language-Worker** (`src/language/`), getrennt von der Welt: ein zweites, leichtes Pyodide (nur `jedi`, miniworlds-Wheel ohne Abhängigkeiten; Heap 24 → 42 MB) plus ruff-WASM.
  Er startet nach dem Welt-Worker (sonst konkurrieren beide um das Netz), spätestens nach 6 s, und startet bei einem Versionswechsel neu (Hinweise und API sind versionsabhängig). Jede Anfrage antwortet im Fehlerfall mit „nichts“, nie mit einer Ausnahme.
  Ein Test (`completion still works while the world is stuck`) beweist: Auch bei einer Endlosschleife im Programm bleibt die Hilfe schnell.
- **Autovervollständigung** (jedi, CodeMirror `autocompletion`): Basisklassen aus miniworlds, eigene Klassen, Importe zwischen Dateien (die Projektdateien werden gespiegelt), Präfix-Rangfolge, Methoden bekommen Klammern (`self.move()`, mit überschreibbarer schließender Klammer).
  `self.world.` kann jedi nicht herleiten: Die Liste kommt wie im alten Client aus dem **API-Index** von miniworlds, den der Welt-Worker berechnet (der Light-Worker kann pygame nicht importieren) und an den Language-Worker weiterreicht.
- **Hinweise:** Die miniworlds-Hinweise (`code_hints`: Tippfehler wie `self.mov`, vergessenes `self`, fehlendes `run()`, Deutsch, mit „Übernehmen“-Aktion) und **ruff** (undefinierte Namen, ungenutzte Importe und Variablen, Syntaxfehler) erscheinen als Unterstreichung, Rand-Symbol, Panel
  (Klick auf den Zähler in der Statusleiste) und Fix-Aktionen. Überschneiden sich beide, gewinnt der miniworlds-Hinweis. Die häufigsten ruff-Regeln sind ins Deutsche übersetzt; `from classes.X import X` in `main.py` wird **nicht** als „ungenutzt“ gemeldet (die miniworlds-Ansicht braucht diese Importe).
- **Hover** zeigt Signatur und Dokumentation (jedi); **Formatieren** (ruff, Alt+Umschalt+F oder Knopf) formatiert die Datei.
- **Namensänderung:** In der Oberfläche heißt die frühere „Greenfoot-Ansicht“ jetzt **miniworlds-Ansicht** (im Singular „miniworld“ für die laufende Welt). Die Projektdatei heißt `miniworlds.json`; die alte `greenfoot.json` wird weiter gelesen und beim nächsten Speichern ersetzt. Intern heißt jetzt alles „miniworlds“ (Ordner `src/miniworlds`, `MiniworldsController`, i18n-Schlüssel `miniworlds.*`, CSS-Präfix `mw-`); der gespeicherte Ansichtswert „greenfoot“ früherer Versionen wird weiter erkannt. „Greenfoot“ bleibt in diesem Plan der Name des Vorbilds und des alten Clients.

Grenzen und Ideen:
- Die miniworlds-Hinweise sind nur deutsch (Upstream), ruff nur teilweise übersetzt; ein Typprüfer fehlt.
- Keine Signaturhilfe beim Tippen von `(` (jedi könnte `get_signatures`).
- Der API-Index kommt noch vom Welt-Worker; upstream wäre ein je Version veröffentlichter Index besser (siehe Anforderungen an miniworlds in S2). Gleiches gilt für `miniworlds.tools` ohne pygame importierbar (statt Stub-Modul in `assist.py`).
- Für Versionen vor 4.4.0.15 (ohne `code_hints`) gibt es nur jedi und ruff.
- Das ruff-WASM wird beim ersten Start geladen (3,5 MB); für Offline muss es der Service Worker (Meilenstein 5) mitcachen.

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

### Stand Meilenstein 5 (2026-11-18)

Umgesetzt und getestet (191 Vitest-Tests; Browsertests `test/pwa.py`, `test/embed.py`, `test/selfhost.py` und alle älteren in Chromium, die neuen auch in Firefox; Shell 265 KB gzip inkl. Icons, Hintergrund-WASM 3,5 MB):
- **Audit der Meilenstein-4-Änderungen** (vorab, 9 Funde, alle behoben und getestet): Worker-Nachrichtenkette überlebt Fehler in `sync`/`api`; ruff bleibt nutzbar, wenn der Python-Teil nicht lädt (offline; Statusleiste „nur Grundprüfung“, automatischer neuer Versuch bei `online`);
  `saveMeta` schreibt `miniworlds.json` vor dem Löschen der alten Datei; Umlaute und Emojis in Vervollständigung und Hover (Unicode-Wortmuster, jedi zählt Codepunkte); überholte Anfragen werden im Worker nicht mehr gerechnet, Timer werden beim Verwerfen gelöscht;
  Format, Vervollständigung, Hover und Statusanzeige nur für `.py`; kein Neustart eines laufenden „neueste Version“-Boots, wenn die Welt später eine konkrete Version meldet (der Worker meldet die installierte Version); Pfadprüfung beim Spiegeln des Projekts in den Language-Worker;
  unveränderte Projekte werden nicht erneut gesendet und nicht neu geschrieben; Größenbudget heißt jetzt ehrlich „Hintergrund“ (ruff lädt direkt nach dem Start, nicht erst bei Gebrauch).
- **Interne Umbenennung:** Ordner `src/miniworlds`, `MiniworldsController`/`MiniworldsMeta`/…, i18n-Schlüssel `miniworlds.*`, CSS-Präfix `mw-`, Testskript `test/miniworlds.py`. Der gespeicherte Ansichtswert „greenfoot“ und die Datei `greenfoot.json` werden weiter gelesen.
- **PWA:** `manifest.webmanifest`, Icons (SVG, PNG 192/512, maskable), Service Worker `src/pwa/sw.js` mit Build-Plugin (`scripts/pwaPlugin.ts`: Liste aller Dateien + Hash als Version). App-Dateien werden vorab gecacht (cache-first), Pyodide und Wheels zur Laufzeit (cache-first), PyPI-Metadaten und `config.json` network-first.
  Eine neue Version wartet, bis der Nutzer „Neu laden“ wählt (kein Wechsel unter laufender Arbeit); alte Caches werden gelöscht; offene Tabs prüfen stündlich. Getestet: Start und Programmlauf **ohne Server** (Chromium und Firefox), Update-Ablauf.
  Im Versionsmenü sind ohne Netz die nicht geladenen Versionen gesperrt („offline nicht verfügbar“); installierte Versionen merkt sich `src/pwa/offline.ts`.
- **Laufzeit-Konfiguration** `config.json` (`pyodideBase`, `links` für „Weitere Editoren“, `embedOrigins`), tolerant gelesen, nur http(s)-Links. Build mit relativer Basis (läuft in jedem Ordner).
- **Selbst-Hosting:** `npm run selfhost` lädt Pyodide-Kern und die vom Editor benutzten Pakete (micropip, numpy, pygame-ce, jedi, parso; 11 Dateien) mit Prüfsummen, legt sie nach `dist/pyodide/…` und stellt `config.json` um. Test: mit Selbst-Hosting kein einziger Aufruf von jsDelivr.
- **Einbetten per postMessage** (`?embed=1`, `docs/embed.md`): `load` / `get-files` hinein, `ready` / `loaded` / `files` / `change` / `error` hinaus; Projekt nur im Arbeitsspeicher (kein Zugriff auf die gespeicherten Projekte des Besuchers), Antworten nur an den Ursprung des Absenders, optionale Liste erlaubter Seiten, Pfad- und Größenprüfung. Getestet über zwei Ursprünge.
- **Doku und CI:** `docs/deploy.md`, `docs/embed.md`, `.github/workflows/ci.yml` (Unit, Build, Größe, Browsertests in Chromium).

**Audit von Meilenstein 5 (2026-11-18), alle Funde behoben:**
- Service Worker: HTML-Antworten (Fehlerseiten, SPA-Fallback) werden nicht gecacht; `put` blockiert die Antwort nicht mehr und scheitert nicht an Quota (`waitUntil`, `try/catch`); Laufzeit-Cache trägt die Pyodide-Version im Namen, Veraltetes wird gelöscht, höchstens 40 Wheels;
  `networkFirst` wartet bei leerem Cache auf das Netz statt nach dem Timeout zu scheitern; der `index.html`-Fallback gilt nur noch offline (andere Seiten auf demselben Host, z. B. `/ide/`, bleiben erreichbar).
- Update: Eingaben werden vor dem Neuladen gespeichert; andere offene Tabs bekommen einen Hinweis, statt mit gelöschtem Cache weiterzulaufen.
- „Offline verfügbar“ fragt den Cache (nicht `localStorage`); auch „Neueste (auto)“ wird geprüft.
- Einbetten ist freigabepflichtig (`embedOrigins` fehlt oder ist kaputt = niemand; `["*"]` ausdrücklich für alle); `load` ist alles oder nichts (Base64 vorab geprüft, schreiben vor löschen, `Set` statt `in`), Nachrichten laufen nacheinander;
  `change` meldet nur Pfade (Inhalt per `get-files`, das auch ungespeicherte Eingaben übernimmt); die Seitensprache wird nicht als Besucher-Einstellung gespeichert. Grenze bleibt: Python der einbettenden Seite läuft mit den Rechten des Editor-Ursprungs, Schutz der Projekte beruht auf Storage-Partitionierung (`docs/embed.md`).
- `selfhost`: Version und Paketlisten aus `src/runtime/config.ts`, Downloads auf Länge, WASM-Kennung und Prüfsumme geprüft, atomar abgelegt, beschädigter Cache wird erneuert.

**Deployment (2026-11-18):** Der Editor läuft unter **https://editor.opencoding.de/** (eigene Subdomain = eigener Ursprung; nginx-Container hinter Traefik, `~/projects/editor/` auf dem Server; Pyodide selbst gehostet, `embedOrigins`/`frame-ancestors` nur `https://www.opencoding.de`).
`scripts/deploy.sh` baut, prüft und lädt hoch, `test/live.py` prüft die veröffentlichte Seite (Chromium und Firefox bestanden). Die Serverdateien liegen in `deploy/`. Ein Container-Healthcheck oder Monitoring (Uptime Kuma) ist noch nicht eingerichtet.

Noch offen: Moodle-Einbindung (Testaktivität) und Anpassung der Repos `miniworlds-ide` und `miniworlds-moodle-web-player` (Schritte in `docs/deploy.md`, bewusst nicht angefasst); Embed ohne Lauf-/Konsolen-Nachrichten und ohne Service Worker; S6 (Safari/Chromebook auf echten Geräten); miniworlds-Wheels spiegeln (voll offline ohne PyPI-Erstzugriff); Audio, `input()`.

### Stand nach Meilenstein 5: Tablets und Barrierefreiheit (2026-11-18)

Anlass: Überprüfung der Live-Seite (Tablet 820 px: Editor nur 250 px breit, Handy: Editor unsichtbar; axe: 6 Verstöße). Umgesetzt und getestet (`test/responsive.py`, `test/a11y.py`; Chromium und Firefox):
- **Schmale Bildschirme (≤ 900 px, auch kleine iframes):** ein Bereich nach dem anderen (Tabs „Dateien · Editor · Welt“). Start (Strg+Enter oder Knopf) zeigt die Welt mit Konsole, ein Datei-Klick oder ein Link in der Konsole zeigt den Editor; Rückkehr zu breit stellt die Spalten wieder her. Werkzeugleisten brechen um, Zeichenfläche passt in den Bildschirm, bei Touch (`pointer: coarse`) mindestens 40 px hohe Ziele.
- **Barrierefreiheit:** axe-core meldet in Hell und Dunkel, breit und schmal, mit Menü, Dialog, Klassenansicht und laufender miniworlds-Ansicht keine Verstöße mehr. Dafür: `h1`, Landmarks (`header`, `section` mit Namen, ein `main`), korrekte Tab-Listen (Dateileiste, Seitenleiste, Bereiche), Editor mit Namen „Quelltext von …“, Überschriftenebenen.
  Der Schließen-Knopf der Dateitabs ist kein eigenes Bedienelement mehr (verschachtelt war nicht erlaubt): Entf schließt den fokussierten Tab, das ×, der Mittelklick und das Menü bleiben für Maus und Touch.
- **Dunkles Schema:** CodeMirrors Standardfarben fielen im Dunkeln durch den Kontrasttest; Syntaxfarben und Editorfläche folgen jetzt Variablen (`--tok-*`) beider Schemata.
- Nicht berührt: Safari/Chromebook auf echten Geräten (S6), `input()`.

### Speicherbedarf (2026-11-18)

Gemessen mit `test/memory.py` (PSS aller Chromium-Prozesse, Mittel mehrerer Läufe, Schwankung bis etwa ±50 MB zwischen Läufen; Chromium unter Linux): Der Editor belegt nach dem Start ca. **450–470 MB über dem leeren Browser**: Seite und Oberfläche 120–140 MB, Welt-Python (CPython, numpy, pygame, SDL, Zeichenfläche) ca. 300 MB, Editor-Hilfen (zweites Python mit jedi und ruff) ca. 130 MB. ruff allein ca. 25 MB, die jedi-Aufwärmung ca. 20 MB, beides im Rauschen; also gibt es dort wenig zu holen.
- **Niedrig-Speicher-Modus** (`lowMemory` in `config.json`, automatisch ab `deviceMemory` ≤ 4): Das zweite Python startet erst beim ersten Tippen (oder Vervollständigung, Hover, Klick auf die Statusanzeige) und schläft nach 5 Minuten ohne Nutzung wieder ein; Dateien nur ansehen und Programme starten braucht es nicht. Gemessen **327 statt 461 MB** ohne Tippen (−29 %), nach dem Tippen 421 statt 469 MB. Hinweise erscheinen in diesem Modus erst nach der ersten Eingabe.
- **Verworfen:** Vorab-Download von numpy, pygame und der miniworlds-Wheels parallel zu Pyodide für den Kaltstart. Messung (3 Läufe je Variante, lokales Netz): 13,0/13,0/12,4 s mit gegenüber 14,3/12,8/13,2 s ohne, also kein belastbarer Gewinn; der Kaltstart (ca. 13 s, warm ca. 3 s) ist CPU-gebunden (Kompilieren von Pyodide, Importe), nicht Netz-gebunden. Auf einem langsamen Schulnetz kann das anders sein; ohne Messung dort bleibt der Code draußen.
- Noch nicht gemessen: Chromebook mit 4 GB (S6).

### Verlauf (2026-11-18)

Ziel: Schüler können zu einem früheren Stand zurück (Code überschrieben, „vorhin ging es noch“). Umgesetzt und getestet (`src/history/`, 24 Vitest-Tests, `test/history.py` in Chromium und Firefox):
- **Stände** (Schnappschüsse der Textdateien, ohne Bilder und ohne `miniworlds.json`) entstehen von selbst: beim Öffnen, **vor jedem Start**, alle 3 Minuten bei Änderungen, vor dem Löschen einer Datei, vor jedem Zurücksetzen; dazu „Stand merken …“ mit Namen. Gleicher Stand wie der neueste wird nicht doppelt gespeichert (außer benannt).
- **Ablage:** eigener Bereich `history/<Projekt>` im Browser-Speicher (nicht in den Projektdateien: kein Eintrag im Dateibaum, in der Suche, im Lauf oder ZIP-Export). `index.json` plus inhaltsadressierte Texte `objects/<hash>`: jeder verschiedene Text einmal, auch bei hunderten Ständen klein. Grenzen: 150 Stände und 6 Mio. Zeichen; zuerst fliegen die ältesten automatischen raus, benannte bleiben. Umbenennen eines Projekts nimmt den Verlauf mit, Löschen löscht ihn, Duplizieren beginnt neu.
- **Oberfläche:** Seitenleisten-Tab „Verlauf“ (nach Tagen gruppiert); Klick öffnet einen Dialog mit Dateiliste (geändert / fehlt jetzt / neuer / gleich) und Unterschied (rot = verschwindet, grün = kommt zurück, mit 3 Zeilen Kontext, auch für Screenreader beschriftet). Aktionen: einzelne Datei zurückholen, alles auf den Stand setzen (entfernt neuere Dateien, mit Bestätigung), Namen vergeben, Stand löschen. **Jedes Zurücksetzen merkt vorher den jetzigen Stand** („Vor dem Zurücksetzen“), also ist es selbst rückgängig zu machen (getestet).
- Die Hilfsfunktionen `diffLines` (kürzester Unterschied über längste gemeinsame Teilfolge, bei riesigen Texten Rückfall auf „ersetzt“) und `History` sind UI-frei; Verlauf funktioniert auch im Speicher-Fallback und im Embed (dann nur bis zum Schließen).
- Grenzen: Der Verlauf liegt im selben Browser-Speicher wie das Projekt, löscht jemand die Websitedaten, ist beides weg (der ZIP-Export bleibt die Sicherung). Bilder werden nicht versioniert. Kein Zusammenführen von Ständen, nur Zurückholen.


### Oberfläche aufgeräumt: Welt-Panel, Einstellungen, Welt in Fenster/Vollbild/Tab (2026-11-18)

Rückmeldung aus dem Einsatz: weißer Zeilennummernstreifen im Dark Mode, Klassendiagramm soll zuerst kommen, rechtes Panel zu unübersichtlich, Welt soll auch groß zu sehen sein.
- **Zeilennummern:** CodeMirrors eigenes Theme hatte gleiche Spezifität und kam später; die Regeln stehen jetzt unter `.editor .cm-editor …` (Streifen, aktive Zeile, Faltmarke). `test/world.py` prüft die Helligkeit im Dark Mode.
- **Einstellungen (⚙ oben):** erster Eintrag „Seitenleiste beim Öffnen“ (Klassen oder Dateien), gespeichert im Browser (`src/ui/preferences.ts`, Schlüssel `miniworlds-editor.prefs`). Standard ist **Klassen**; Projekte ohne `miniworlds.json` (Einzeldatei, Importe) zeigen weiter zuerst die Dateien.
- **Welt-Panel in drei Zonen statt fünf Blöcken:** Kopfzeile (Zustand · Schritt · Figuren, rechts das Menü „Welt anzeigen“), Welt, eine Steuerzeile (Act, Run/Pause, Reset, Tempo, „Mehr ▾“). Darunter nur noch eine Zeile „Figur hinzufügen: + Figur + Wurm“ (nur wenn es Figuren-Klassen gibt) und die Konsole. Startaufstellung („Als Start merken“, „Aufstellung leeren“, „Welt speichern …“) wohnt im Menü „Mehr“; Hinweise (Klick in die Welt, Änderungen zählen nicht dazu) erscheinen nur, wenn sie gelten.
- **Welt anzeigen:** im Editor (wie bisher, mit allen Werkzeugen), **Vollbild** (nur die Welt, Esc beendet), **eigenes Fenster** oder **neuer Tab**. Der Canvas wird in die andere Seite verschoben (er gehört dem Worker und zeichnet weiter); schließt man das Fenster, kommt die Welt zurück ins Panel. Ein Neustart des Programms zeichnet im Fenster weiter. Außerhalb des Panels gehört die Maus dem Programm (Platzieren, Auswählen, Kontextmenü gibt es nur im Editor); Act/Run/Reset bedient man im Editorfenster.
- Grenzen: Pop-up-Blocker und iframes ohne `allowfullscreen` verhindern Fenster bzw. Vollbild; dann erscheint ein Hinweis. In Fenster und Tab fehlt der Auswahlrahmen.

### Nächste Schritte nach der Praxisrückmeldung (2026-11-18)

Umgesetzt und getestet (Vitest 266 Tests; Browser: `test/input.py`, `launch.py`, `sound.py`, `rename.py`, `csp.py`, erweiterte `assist.py`, `embed.py`, `run.py`):
- **`input()` und `sys.stdin`:** Das Programm blockiert, die Konsole zeigt ein Eingabefeld (Fokus, Prompt als Beschriftung, Echo mit Prompt, auf schmalen Bildschirmen springt die Ansicht zur Konsole). Ohne `SharedArrayBuffer` (das bräuchte COOP/COEP und würde das Einbetten in Moodle verhindern) gibt es zwei Wege: **JSPI** (`pyodide.ffi.run_sync`, Chromium/Chrome/Edge/Chromebooks: Python wird angehalten, der Worker bleibt ansprechbar) und sonst ein **synchroner Request, den der Service Worker offen hält**, bis die Seite die Zeile per POST schickt (Firefox, Safari; getestet in Firefox). „Stopp“ während `input()` beendet das Programm ohne Fehlermeldung. Grenze: Beim allerersten Besuch muss der Service Worker die Seite schon kontrollieren (einmal neu laden); sonst erklärt eine Meldung das. Ob eine Eingabe sehr lange (viele Minuten) warten darf, ist beim Service-Worker-Weg ungetestet.
- **Aufgaben verteilen und einsammeln:** Links `?template=…` und `?zip=…` (siehe `docs/embed.md`), Rückfrage bei fremden Servern, derselbe Link öffnet das Projekt wieder; im Embed erscheint mit `&submit=1` ein Knopf „Abgeben“, der alle Dateien als `submit`-Nachricht an die Seite schickt.
- **Fehlermeldungen in einfachen Worten:** `src/runtime/hints.ts` erklärt 40 häufige Fehler (NameError, SyntaxError, AttributeError, TypeError …) auf Deutsch und Englisch als „Tipp“ unter dem Traceback; ohne sichere Regel kein Tipp.
- **Ton:** Die Seite spielt Sound und Musik mit Web Audio. `pygame.mixer` ist im Worker durch Aufrufe an die Seite ersetzt (Dateien werden einmal übertragen und dort dekodiert; Schleifen, Lautstärke, Pause, Fade-in). Ein Knopf 🔊/🔇 erscheint nur, wenn ein Programm Ton abspielt; die Wahl wird gemerkt; Stopp beendet allen Ton. Grenzen: `get_busy()` rechnet für WAV mit der Länge, bei MP3/OGG gilt ein Stück bis zum Stopp als laufend; `get_pos()` und `set_pos()` fehlen.
- **Klasse umbenennen** (Menü im Klassendiagramm): Definition, Datei (`classes/Alt.py` → `classes/Neu.py`), Importe und alle Verwendungen, per Python-Parser (Lezer): Strings, Kommentare und Attribute bleiben. Davor wird ein Stand im Verlauf gemerkt, danach die handplatzierten Figuren der Startaufstellung umbenannt. Grenze: `import classes.Alt` und `classes.Alt.Alt` im Code werden nicht vollständig nachgezogen; Dateien, die den Namen aus einem anderen Modul importieren, bleiben unberührt.
- **Signaturhilfe:** Beim Tippen von `(` und `,` zeigt ein Tooltip die Parameter des Aufrufs (jedi), der aktuelle ist fett; Esc schließt. Im Sparmodus wird die Hilfe dafür nicht geweckt.
- **„Bericht kopieren“** in der Konsole: Versionen, Dateiliste, Startdatei und letzte Konsolenzeilen als Text für die Lehrkraft; wo die Zwischenablage gesperrt ist, erscheint der Text zum Kopieren von Hand.
- **Content-Security-Policy** in `deploy/nginx.conf`: Skripte/Worker nur vom eigenen Ursprung, `'unsafe-eval'` (nötig für pygame-ce; `'wasm-unsafe-eval'` allein lässt die Welt nicht starten), Netz nur für PyPI; `test/csp.py` startet den selbst gehosteten Editor genau darunter (Programm mit numpy und `input()`, Vervollständigung, Service Worker) in Chromium und Firefox und prüft, dass ein Inline-Skript nicht läuft.
- Nicht umgesetzt: Debugging (Haltepunkte, Einzelschritt; Pyodide bietet nur mit großem Aufwand Hooks), Variablenansicht für normale Programme.

### Audit der Änderungen seit fcf4adb (2026-11-18)

Gefunden und behoben:
- **Run-Knopf unlesbar beim Darüberfahren (hell):** `button:hover` (Spezifität 0,2,1) überschrieb den Hintergrund von `.toolbar .run` (0,2,0), weiß auf hellgrau. Die Hover-Regel steht jetzt unter `:where()`; Knöpfe mit eigenem Hintergrund behalten ihn. Betrifft auch ausgewählte Figuren-Chips.
- **Stopp-Knopf im Dunkelmodus (Kontrast ~2,6:1):** neue Variablen `--danger-bg`/`--danger-fg` (auch für gefüllte Gefahr-Knöpfe in Dialogen). Zuvor nie mit axe geprüft, weil kein Test ein laufendes Programm hatte.
- **`package-lock.json` kannte `@lezer/python` nicht:** `npm ci` (CI) wäre fehlgeschlagen.
- **Audio-Speicher:** dekodierte Töne blieben nach einem Worker-Neustart im Speicher (Schlüssel sind pro Worker verschieden). Der Neustart leert sie jetzt (`reset()`).
- **`?lang=` im Link** speicherte die Sprache dauerhaft; gilt jetzt nur für den Besuch.
- Service Worker: unbeantwortete Eingabezeilen werden gedeckelt.
- axe-Test deckt jetzt Eingabefeld, Mute-Knopf, Fehlertipp, Signatur-Tooltip, Welt- und Mehr-Menü und Einstellungen ab (hell/dunkel).

Geprüft ohne Befund: `input()` in einem Welt-Callback (`on_mouse_left`) in Chromium und Firefox; Welt in Fenster und Vollbild unter der echten CSP auf editor.opencoding.de.

Offen / bewusst nicht geändert:
- Lange Zeilen: `.cm-scroller` wird von axe als „scrollbarer Bereich nicht fokussierbar“ gemeldet (CodeMirror-Standard, schon vorher). Abhilfe wäre Zeilenumbruch oder ein zusätzlicher Tab-Stopp.
- Signaturhilfe: Die erste jedi-Anfrage einer Sitzung kann länger als 8 s dauern (v. a. Firefox); dann erscheint der Tooltip erst nach der nächsten Taste.
- Klasse umbenennen prüft nicht, ob der neue Name schon als Variable im Code vorkommt.
- Die Seitenleiste „Klassen zuerst“ gilt auch im Embed, sobald die Seite ein Projekt mit `project.toml` lädt.
### Hilfen für Schüler (2026-11-18, Branch `student-experience`)

Sieben Neuerungen, alle ohne neue Dauer-Schaltflächen: ein Menüpunkt, ein Reiter oder eine Zeile, die nur erscheint, wenn sie gebraucht wird. Tests: `test/student.py` (Chromium), `test/share.py`, dazu Vitest.
- **Fehler in Klartext** (`src/runtime/explain.ts`, nach dem Merge mit `hints.ts` aus `main`): Die Regeltabelle in `hints.ts` antwortet zuerst, `explain.ts` ergänzt, was dort fehlt (fehlendes `self`, Schlüsselwort-Argumente, zirkuläre Importe, unpassende Klammern …); die Konsolenzeile heißt `hint` („Tipp: …“). Liest nur die letzte Zeile des Tracebacks (Python 3.13 liefert „Did you mean“ gleich mit) und erklärt ca. 35 häufige Fälle (NameError, AttributeError/None, fehlendes `self`, Argumente, Typen, Einrückung, Doppelpunkt, Klammern, Importe/`classes/`, Dateien/Bilder, Rekursion …) auf Deutsch und Englisch. Unbekannte Fehler bekommen nichts.
- **Hilfslinien** im Menü ⤢ („Ansicht“): Koordinaten und Raster (mit Mausposition in der Kopfzeile), Blickrichtungen, Umrandungen der Figuren. Eine Zeichenfläche über der Welt (`GuidesOverlay`), nur im Panel; die Wahl bleibt im Browser. Die Figurenliste holt der Controller nur, solange Richtungen oder Umrandungen an sind.
- **Live-Inspektor** (`Inspector`): Figur anklicken (pausiert) → unter der Welt erscheinen Position, Richtung und eigene Attribute und aktualisieren sich weiter, auch während die Welt läuft. Ersetzt den Dialog „Inspizieren“. Nebenbei: Ein Tipp, der losgelassen wird, bevor `pick` antwortet, hinterlässt keinen hängenden Zieh-Zustand mehr; das Welt-Panel schrumpft die Welt nicht mehr, wenn unten etwas dazukommt.
- **Bausteine** (`src/blocks`): Menü „＋ Baustein“ in der Dateileiste (nur bei `.py`), 19 Stücke in fünf Gruppen. Anweisungen kommen an den Cursor, Methoden ans Ende der Klasse, nötige Importe (`random`) oben; Tab springt durch die Felder (CodeMirror-Snippets). Alle Stücke wurden gegen miniworlds ausgeführt.
- **Aufgaben mit Selbstprüfung** (`src/tasks`): Eine Aufgabe kann eine Prüfung tragen (`actors`, `gone`, `fewer`, `moved`, `selected`, `called`, `frames`, `output`, `class`, `method`, `image`, `changed`, `all`), als Daten in `scenario.*.json` bzw. `miniworlds.json`. Der Controller sammelt Fakten über die laufende Welt (`FactTracker`); eine erfüllte Aufgabe wird abgehakt (✦ kennzeichnet geprüfte Aufgaben). Nie automatisch zurückgenommen; wer von Hand abhakt-entfernt, wird in dieser Sitzung nicht wieder abgehakt. `changed` vergleicht mit dem Hash der Vorlagendatei.
- **Bibliothek und Zeichnen**: 27 selbst gezeichnete Bilder in vier Reitern (Figuren, Tiere, Dinge, Hintergründe), alle im Code gezeichnet (`imageLibrary.ts`: eigenes Werk, MIT). Hintergründe lassen sich für die Welt-Klasse setzen („Hintergrund festlegen“). Kleine Zeichenfläche (16×16 oder 32×32, 16 Farben, Stift/Radierer/Füllen/Rückgängig). Welt-Klassen bekommen `self.add_background("…")`.
- **Teilen als Link** (`src/share`, `src/play`): Projektmenü → „Teilen als Link …“. Das Projekt steckt komprimiert im Teil nach `#` (geht nie an einen Server; nichts wird gespeichert), plus QR-Code (bis 1200 Zeichen). Öffnen zeigt die Spielseite (`PlayApp`): nur Welt, Neustart, „Im Editor öffnen“ (eigene Kopie), auf Touch-Geräten ein Steuerkreuz mit Aktionstaste.
  **Urheberrecht:** Jedes Bild hat eine Herkunft (`miniworlds.json` → `images`): *Bibliothek* (nur die ID reist, das Bild wird beim Öffnen neu gezeichnet), *selbst gezeichnet* (reist mit), *hochgeladen/hineingezogen/unbekannt*. Hochgeladene Bilder reisen **nur**, wenn die Schülerin oder der Schüler im Teilen-Dialog je Bild bestätigt, dass sie selbst gemacht oder frei weitergebbar sind (standardmäßig nicht); sonst steht im geteilten Spiel ein graues Feld mit „?“. Beim ersten Hochladen steht ein Hinweis (kein Google-Bilderklau, CC0 nutzen). Die Spielseite nennt unten, welche Bildarten im Spiel sind. Links/Dateien enthalten nie ein Bild, dessen Herkunft nicht geklärt ist. Grenzen: Die Zusicherung ist eine Selbstauskunft; ein Link über 6000 Zeichen wird gewarnt, über 200 000 abgelehnt (dann ZIP); entpackt höchstens 40 MB.
- Noch nicht: Sounds in der Bibliothek (Audio ist im Editor noch stumm), Bearbeiten gezeichneter Bilder, QR-Code als Bild speichern.

### Layout: Splitter, ProjectView aufgeteilt, Fehlerhinweis im Editor (2026-11-18, Branch `student-experience`)

Tests: `test/layout.py` (Chromium, Firefox), Vitest `src/ui/project/layout.test.ts`, `src/runtime/explain.test.ts` (`errorNote`).
- **Splitter** zwischen Seitenleiste | Editor | Welt (`src/ui/project/Splitter.tsx`, `usePanelWidths.ts`, `layout.ts`). Maus, Touch und Stift ziehen; mit der Tastatur Pfeiltasten (±16 px, mit Umschalt ±64), Pos1 oder Doppelklick setzt die Standardbreite zurück (`role="separator"`, `aria-valuenow`). Die Breiten stehen als CSS-Variablen (`--sidebar-w`, `--world-w`) auf `.body`, der Editor behält mindestens 320 px; in einem kleineren Fenster werden die gewählten Breiten nur *angezeigt* verkleinert (`effectiveWidths`), die Wahl bleibt gespeichert. Gespeichert im Browser unter `miniworlds-editor.layout` (getrennt von den Einstellungen). Auf schmalen Bildschirmen (≤ 900 px) gibt es keine Splitter. Die Welt skaliert mit dem Panel, also macht ein breiteres Panel auch die Welt größer.
- **`ProjectView.tsx` aufgeteilt** (894 → ca. 300 Zeilen Verdrahtung), Teile in `src/ui/project/`: `ProjectToolbar` (Start, Ansicht, Version, Pakete, Hinweise, Bereichs-Tabs), `Sidebar` (Reiter), `ClassPanel` (Klassendiagramm mit Bild- und Unterklassen-Aktionen), `EditorPane` (Dateitabs, Editor, Statuszeile) und Hooks `useEditorSession`, `useFileOps`, `useHistoryActions`, `useStaleClasses`, `useSessionState`. Verhalten unverändert.
- **Fehler am Code:** Schlägt ein Lauf fehl, steht unter der Zeile, in der das Programm gescheitert ist, ein Kasten mit der Ausnahme (`NameError: …`) und dem Klartext-Tipp (💡 aus `explain.ts`); × oder Esc schließt ihn, jede Änderung am Text entfernt ihn, ein neuer Lauf setzt ihn neu. Ein Klick auf einen Link in der Konsole markiert nur die Zeile (ohne Kasten), weil dort nicht klar ist, welcher Rahmen des Tracebacks gemeint ist.

### Erster Start für Schüler (2026-11-18, Branch `welcome-first-run`, von `student-experience`)

Ausgangspunkt war ein Selbstversuch mit leerem Browser (Desktop und Telefon): ca. 25–30 MB bis zum ersten „Starten“, schwarze Welt während des Ladens, die Starterfigur flog nach 2 s aus dem Bild, kein Hinweis, was man tun soll, kein Hinweis, wie man ein vorhandenes Programm mitbringt. Tests: `test/welcome.py` (Chromium), Vitest (`firstRun`, `backup`, `prefetch`, `loading`, `projectOps.import`, `project`).
- **Willkommen-Karte** (`src/ui/welcome/`): erscheint **einmal** (Flag `miniworlds-editor.welcomed`), nur wenn der Browser noch kein Projekt hat und der Aufruf kein Aufgabenlink ist. Dahinter existiert schon das Startprojekt, Python lädt im Hintergrund. Wahl: „Eigene Welt“ (behält das Startprojekt), Vorlagen mit Aufgaben (Krabbe, Münzen, Pong; ersetzen das **unberührte** Startprojekt, das ist nur dann der Fall, solange der Besucher nichts gewählt hat) oder „Programm importieren“. Später im Menü Projekt: „Erste Schritte …“ und „Programm importieren – wie? …“. Tests schalten sie mit `SEEN_WELCOME` (in `test/support.py`) ab.
- **Import-Hilfe** (`ImportWays`): vier Wege mit Schaltflächen — Ordner, ZIP, einzelne Python-Dateien (neu: `importProjectFiles`; eine einzelne `.py` wird `main.py`, mehrere behalten ihre Namen; nie Überschreiben, immer neues Projekt), Code kopieren — plus Ablagefläche zum Hineinziehen. Neu: eine **ZIP-Datei**, die irgendwo auf das Fenster gezogen wird, wird ein Projekt (vorher wanderte sie als Datei ins offene Projekt).
- **Starterfigur**: Kreis (Radius 20) mit Kommentaren in der Sprache der Oberfläche; läuft mit `act`, prallt am Rand ab (`on_detecting_borders` → `bounce_from_border`), dreht sich mit ←/→. Nur Startprojekt (`starterActorSource`), „Neue Klasse“ bleibt unverändert.
- **Laden**: (a) `src/runtime/prefetch.ts` holt schon in `main.tsx` Pyodide-Kern und die Pakete des Welt-Workers (aus `pyodide-lock.json`, samt Abhängigkeiten) in den HTTP-Cache, während die Seite noch startet; (b) der Editor-Hilfe-Worker (zweites Python) startet erst, wenn die Welt bereit ist oder ihr Start gescheitert ist — früher nach 6 s auch bei langsamer Welt, was beide Starts verdoppelte; Rückfall jetzt 60 s. Produktiv wird Pyodide schon über `scripts/selfhost.mjs` vom eigenen Server geliefert (`scripts/deploy.sh`).
- **Ladeanzeige**: Platzhalter statt schwarzer Welt („Schritt 2 von 3: Grundpakete werden geladen“ mit Balken, `BootPlaceholder`), „▶ Starten“ vor dem Laden zeigt „⏳ Startet gleich …“ (deaktiviert; Strg+Enter bricht den Start nicht mehr ab), auf Telefonen ist die Ladekarte nur noch eine schmale Leiste.
- **Sichern**: Schaltfläche „💾 Sichern“ in der Kopfzeile (ZIP-Download), Statuszeile „Nur auf diesem Gerät gespeichert“ statt „dauerhaft im Browser“, nach 4 Minuten Arbeit ein Hinweis (Schulrechner setzen sich zurück), danach frühestens nach 7 Tagen wieder (`backup.ts`, `miniworlds-editor.backup`).
- **Messung**: Zahlen mit Netz-Drosselung konnten nicht belastbar gewonnen werden (der Rechner war durch andere Arbeiten mit Last 30 überlastet); gemessen wurde nur die Reihenfolge der Anfragen. `scripts/selfhost.mjs` bricht mit Node 26 ab („incomplete download“, weil `content-length` die komprimierte Größe ist, `fetch` aber entpackt liest); ohne Cache `.cache/pyodide` nicht lauffähig.
- **Aufgeräumt**: Die drei roten Tests in `explain.test.ts` aus dem Merge erwarteten alten Wortlaut und sind angepasst. Dabei kam ein echter Fehler ans Licht: Bei „No file 'images/x.png' found in working directory '/project'“ nannte der Tipp den Ordner statt der Datei (`hints.ts`, Regel für `FileNotFoundError`). `test/student.py` sucht jetzt `.line.hint` statt `.line.help`. `src/share/payload.test.ts` („explodiert“) braucht unter hoher Last > 5 s und läuft dann ins Zeitlimit; allein grün.
