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
└─ Language Service (Ort offen, siehe Spike S2)
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
| S4 | Speicher: OPFS-Projekte, Kopie ins Emscripten-FS beim Start vs. `mountNativeFS` | Mehrdatei-Projekt startet in < 2 s |
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

## 5. Meilensteine

0. Spikes S1–S6, danach Festlegung von Framework und Language-Service.
1. **Editor-Kern:** Tabs, Dateibaum, CM6, Projektformen, OPFS + ZIP, DE/EN, Suchen/Ersetzen.
2. **Run + Konsole + Pakete:** Pyodide-Runner, Fehler → Code-Sprung, `micropip`-Dialog, Versionswahl + Update-Warnung.
3. **Greenfoot-Ansicht** als Panel (Port von `gf-host`, `gf-uml`, `gf-assist`, `gf-images`, `gf-journal`);
   das bestehende `test/e2e.py` läuft weiter.
4. **Language Service** nach Ergebnis von S2.
5. **Release:** PWA, Hosting (statisch), CI mit Tests, Moodle-iframe; der Editor ersetzt die `miniworlds-ide`-Startseite
   (Deployment unter miniworlds.opencoding.de); danach Migration des alten Greenfoot-Clients.
6. **Später:** Desktop-Hülle (Tauri), Remote-Dateiablage für Klassen, Debugger, Plugin-API.

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
