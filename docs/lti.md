# LTI-Server: Schüler aus Moodle ins eigene Projekt (Plan)

Stand: 2026-11-28. Entwurf für einen **neuen, kleinen Dienst**, der nur eines tut: aus einem Moodle-Launch
heraus dem Kind den Weg in *sein* miniworlds-Projekt bahnen. **Leitlinie: so wenig Daten wie möglich — im Idealfall
gar keine persistenten.**

## 1. Ziel und Leitlinie

| Ziel | Konsequenz |
|---|---|
| Ein Klick im Moodlekurs → eigenes Projekt | Kein Code-Aufschreiben, keine Zettelwirtschaft |
| Kein Namenregister im neuen Dienst | Kein Datenbankschema für Personen, keine Schülernamen, keine E-Mail |
| Kein Bleiben von Zustand | Kein Volume, kein Backup, keine Löschroutine nötig |
| Datensparsamkeit ist beweisbar | Der Dienst braucht keine AVV mit Personenbezug; Löschkonzept entfällt weitgehend |

Abgrenzung: Der Dienst ist **kein** zweiter Speicher für Projekte und **keine** Moodle-Integration mit
Noten (AGS) oder Kurslisten (Names & Roles). Er ist ein Krypto- und Weiterleitungsdienst.

## 2. Ausgangslage heute

- Codes liegen im **Backend**. `/api/claim` löst einen Code ein und liefert ein Bearer-Token; wird ein
  **Vorlagencode** (`template_once`) eingelöst, entsteht eine eigene Kopie und die Antwort enthält
  `personal_code` ([play_api.py:44](../miniworlds-editor-backend/app/routes/play_api.py:44) i.V.m. dem Fork des Backends;
  die Erzeugung solcher Codes steht in [teacher_api.py:100](../miniworlds-editor-backend/app/routes/teacher_api.py:100)).
- Der Editor kann mit `?project-code=1` direkt den Code-Dialog öffnen
  ([src/ui/App.tsx:424](../../src/ui/App.tsx:424)); ein Code **in** der URL ist heute nicht vorgesehen.
- Eingebettet (`?embed=1`) läuft eine eigene App **ohne Backend/Code-Dialog**
  ([src/embed/EmbedApp.tsx:88](../../src/embed/EmbedApp.tsx:88)); `docs/embed.md` nennt nur `load`, `get-files`, `submit`.
- Die Namenszuordnung (Code ↔ Person) bleibt bewusst **nur im Browser der Lehrkraft**
  ([teacher.js:297](../miniworlds-editor-backend/app/static/teacher.js:297)).

**Wichtige Randbedingung:** Moodle kann benutzerdefinierte Profilfelder bei einem LTI-Launch **nicht**
als `custom`-Parameter einsetzen (offener Moodle-Ticket MDL-69181; im Forum 2025 erneut bestätigt).
Verfügbar sind u. a. `sub` (immer), `$User.id`, `$Person.sourcedId` (= Feld *ID-Nummer*), `$User.username`.
Ein LTI-Server bekommt also von Moodle **kein** „hier ist dein miniworlds-Code“ geschenkt — das ist die
eigentliche Entwurfsfrage und der Grund für die Stufen unten.

**Randbedingung der Schule:** Es können **keine Moodle-Plugins installiert werden** (weder ein
`ltisource`-Plugin noch Filtercodes). Alles Folgende muss mit Moodle-Bordmitteln auskommen; die
Plugin-Variante in Stufe 1 entfällt damit.

## 3. Dateninventar (Entwurf)

| Was | Wo | Bleibt? | Warum unvermeidlich |
|---|---|---|---|
| Tool-Schlüsselpaar (RS256) + Registrierung je Plattform (`iss`, `client_id`, `auth_login_url`, `jwks_url`, `deployment_id`) | Umgebungsvariablen/Datei im Container | Konfiguration | LTI 1.3 verlangt Signatur |
| `state`/`nonce` während des Logins | verschlüsselt **im `state`-Parameter** (AES-GCM, 5 min) | nein | sonst bräuchte es eine Session |
| Öffentliche Schlüssel der Plattform | RAM-Cache | nein | Signaturprüfung |
| `sub`, Name, E-Mail, Kurs | **nie** | nein | in Moodle „Name/E-Mail senden“ abschalten |
| Pseudonym (nur Stufe 2) | Backend, `HMAC(Salz, iss‖deployment‖context‖sub)` | bis Schuljahresende | Projekt ohne Namen wiederfinden |
| Logs | nur Fehlerklasse, `iss`-Kurzform, Request-ID; IPs gehasht | ≤ 24 h | Betrieb |

Ergebnis: **kein Volume, kein Backup, keine Datenbank.** Einzige „Daten“ sind Konfiguration.

## 4. Stufen

### Stufe 0 — Moodle-Bordmittel, kein eigener Dienst (Fallback)

Wenn (noch) kein LTI-Server gebaut werden kann, geht es rein mit Moodle-Bordmitteln — abhängig von den
Rechten im System:

| Weg | Rechte nötig | Ablauf | Nachteil |
|---|---|---|---|
| **Eigenes Profil** | Systemadmin (Profilfelder, „Benutzer hochladen“) | Benutzerdefiniertes Profilfeld `miniworlds_code` anlegen, nur für die Person sichtbar, per CSV je Konto füllen; Kursseite verlinkt `?project-code=1` | Kind muss den Code aus dem eigenen Profil holen und abtippen |
| **Nachricht je Kind** | Kurslehrkraft | Lehrkraft schreibt jedem Kind eine Moodle-Nachricht mit seinem Code | von Hand, bei 30 Kindern mühsam; bei Code-Erneuerung wiederholen |
| **Eine Gruppe je Kind** | Kurslehrkraft | Gruppe pro Kind, ein Material pro Kind mit Zugriffsbeschränkung auf die eigene Gruppe | 30 Gruppen + 30 Materialien, nur mit Mühe pflegbar |

Allen drei Wegen gemeinsam: nichts wird neu gespeichert, kein Code steht öffentlich; der Aufwand liegt
in der Pflege, nicht in der Technik.

### Stufe 1 — Kurier (kein Speicher, kein Backend-Eingriff)

Entfällt weitgehend: der saubere Weg (kleines `ltisource`-Subplugin) ist nicht möglich, und der
verbleibende Weg über das Standardfeld *ID-Nummer* (`code=$Person.sourcedId`) verdrängt den
Schul-Identifier. **Nur als Notlösung vermerkt, nicht weiterverfolgt.**

### Stufe 2 — Pseudonym + wiederverwendbarer Vorlagencode (Empfehlung)

Der Dienst speichert **weiterhin nichts**, Moodle braucht **kein** Profilfeld und **kein** Plugin; im
Moodle-Aktivitäts-Parameter steht nur ein **gemeinsamer Vorlagencode** der Lehrkraft (Konfiguration).

Ablauf beim Launch:

1. Dienst prüft den `id_token` (Abschnitt 5).
2. Er bildet `pseudonym = HMAC-SHA256(schuljahrssalt, iss ‖ deployment_id ‖ context.id ‖ sub)`.
   Stabil über Geräte und Tage; **nicht** rückrechenbar; mit Wegwerfen des Salzes vergessen.
3. Er signiert eine kurze Anfrage (JWS, 60 s) an das Backend: `{ pseudonym, template_code }`.
4. Das Backend (neue Route) sucht das Pseudonym:
   - bekannt → vorhandenes Projekt, Bearer-Token zurück;
   - unbekannt → Kopie der Vorlage anlegen (wie heute beim Vorlagencode) und das Pseudonym am Projekt merken.
5. Der Dienst reicht das Ergebnis ans Browserfenster weiter (Abschnitt 6), nie in eine Abfragezeile.

Nötige neue Bausteine: `Project`/neue Tabelle mit Pseudonym-Spalte im Backend, eine Route mit
gegenseitig signierten Token (wie `make_student_token`), ein **wiederverwendbarer** Vorlagencode statt
`template_once` (dieser verfällt absichtlich beim ersten Einlösen), und im Editor eine winzige
„Austausch-Token“-Annahme. Löschung: Pseudonyme fallen mit dem Schuljahr (`app/yearly.py`) und mit dem Projekt.

Bewertung: **ein Klick, überall dasselbe Projekt, kein Name in irgendeinem System.** Dafür Eingriff ins
Backend und etwa 3–5 Tage Arbeit.

### Stufe 3 — Editor im Moodle-Rahmen (später, optional)

`src/embed/` um eine `claim`-Nachricht erweitern, iframe in Moodle, `embedOrigins` und CSP
`frame-ancestors` ergänzen. Nicht empfohlen als Einstieg: die Embed-App hat heute kein Backend,
der Editor braucht eigenen Platz (eigener Tab), und Storage-Partitionierung macht Third-Party-Frames
zum Sonderfall.

## 5. Prüfschritte des Launches (verbindlich)

| Prüfung | Verhalten bei Fehler |
|---|---|
| `state` entschlüsselbar, nicht älter als 5 min | 400 |
| Signatur über Plattform-JWKS (`kid`) | 401 |
| `iss` bekannt, `aud` = eigener `client_id`, `azp` = `client_id` | 401 |
| `exp`/`iat` plausibel, Uhr toleriert ±5 min | 401 |
| `nonce` gleich dem aus `state` | 401 |
| `deployment_id` in der Freigabeliste der Plattform | 401 |
| `message_type` = `LtiResourceLinkRequest` | 400 |
| Weiterleitung nur auf `target_link_uri` aus dem Token | — |
| `roles`: Lehrkraft → Hinweisseite mit Link ins Backend, kein Projekt | — |
| `sub` fehlt (anonymer Launch) → Code-Dialog statt Projekt | — |

Kein LTI 1.1 (alte Signaturverfahren), keine Cookies, keine Session-Tabelle: alles Nötige steckt im
`state` und im Token.

## 6. Übergabe an den Editor

**Ein Klick (Stufe 2, festgelegter Weg):** Der Dienst antwortet mit `302` auf
`https://editor.opencoding.de/#lti=<Zusicherung>`. Ein **Fragment** geht weder an Server noch in den
`Referer`; `Referrer-Policy: no-referrer` zusätzlich setzen. Der Editor postet die Zusicherung **einmalig
an das Backend** und macht damit den heutigen Bindevorgang. Damit sieht der LTI-Dienst zu keinem Zeitpunkt
einen Projektcode: er hält nur 60 Sekunden lang eine Zusicherung, aus der das Backend das Projekt ableitet.

Verworfen: `/exchange` beim LTI-Dienst (zweiter Endpunkt, der Codes herausgibt) und `#code=…` (der
langfristige Code stünde in der Browserchronik).

## 7. Betrieb, Tests, Datenschutz

- Eigenes kleines Repository, FastAPI (wie das Backend), eigene Domain (z. B. `lti.opencoding.de`),
  Image ohne Volume; Start nur mit Umgebungsvariablen; `/jwks` und ein datenloser Gesundheitspunkt.
- **Kein Backup nötig** — es gibt nichts zu sichern außer dem Schlüsselpaar (das gehört mit den
  Backups der anderen Dienste, aber ohne Personenbezug).
- Moodle: „Startcontainer = Neues Fenster“, „Name/E-Mail senden = nein“, keine Zusatzdienste anhaken.
- Tests: Signatur/`iss`/`aud`/`nonce`/Wiedereinspielung negativ prüfen; ein Plattform-Stub (wie die
  bestehenden Cross-Repo-Tests) spielt Launch, anonymen Launch und Lehrkraft-Launch durch; ein Test
  stellt sicher, dass im Prozess **keine** Personenangabe in eine Datei gelangt.
- Protokollierung: nur Fehlerklasse und gehashter `iss`; Zugriffe nach 24 h weg. Eine Prüfung „keine
  IP, kein `sub`, kein Name im Zugriffsprotokoll“ gehört in die Abnahme.
- Offen zur Entscheidung (bewusst nicht vorweggenommen): ID-Nummer vs. Moodle-Subplugin (Stufe 1);
  ob Pseudonyme je Schuljahr oder je Aktivität gesalzen werden; ob der Dienst in den Cross-Repo-
  Kompatibilitätstest aufgenommen wird (`scripts/check_compatibility.py`).

## 8. Empfehlung

**Stufe 2**, weil sie als einzige Variante ohne Moodle-Plugin auskommt und trotzdem den einen Klick
bringt. Schrittfolge: zuerst den Launch-Prüfer mit einer „zeige nur die Weiterleitung“-Antwort
(beweisbar ohne Speicher), danach das Pseudonym im Backend, zuletzt das Fragment/Exchange für den
einen Klick.

Nicht vergessen: **Stufe 0** ist der verlässliche Rückfallweg, solange Stufe 2 nicht steht oder die
Moodle-Installation LTI nicht hergibt.

---

## 9. Stufe 2 ausgearbeitet (Implementierungsstand)

Festgelegt: Domain **`lti.opencoding.de`**; das Bridging-Secret kennen nur **Backend und LTI-Dienst**
(nicht der Editor); das Schuljahres-Salz wechselt am **31.07.**, identisch mit `yearly_reset_point`.

### 9.1 Gesamtlauf

```
Moodle            LTI-Dienst                  Editor                     Backend
  │ 1 Launch (Form-POST)                                                
  ├──────────────►│ id_token prüfen, kein Speicher                      
  │               │ Pseudonym P = HMAC(Salz_Jahr, iss‖deployment‖context‖sub)
  │               │ Zusicherung Z = JWS{P, link, exp +60s, iss, aud}    
  │ 2 302 auf editor.opencoding.de/#lti=Z                               
  ├──────────────────────────────────────────►│ #lti lesen, Fragment sofort löschen
  │                                           ├────────────────────────►│ 3 POST /api/play/lti-bind
  │                                           │                          │ Z prüfen, P hashen
  │                                           │                          │ Bindung bekannt? → Projekt
  │                                           │                          │ neu? → Vorlage kopieren, Bindung merken
  │                                           │◄────────────────────────┤ 4 {token, project_id, personal_code}
  │                                           │ weiter wie heute        
```

Ergebnis: das Kind ist im eigenen Projekt; sein `personal_code` wird einmalig angezeigt (heutiges
Verhalten beim Vorlagencode), damit es auch ohne Moodle weiterarbeiten kann.

### 9.2 Neues Repository `miniworlds-lti` (oder Ordner im Backend)

Python 3.13, FastAPI (wie das Backend), Abhängigkeiten `PyJWT[crypto]`, `cryptography`, `uvicorn`.
**Kein ORM, kein Volume, keine Migrationen.** Umgebungsvariablen:

| Variable | Inhalt |
|---|---|
| `LTI_PLATFORMS` | JSON je `iss`: `client_id`, `auth_login_url`, `jwks_url`, `deployment_ids` |
| `LTI_TOOL_KEY`, `LTI_TOOL_KID` | eigenes RS256-Schlüsselpaar (Rotation über `kid`) |
| `LTI_STATE_KEY` | AES-GCM-Schlüssel für den `state`-Parameter |
| `LTI_SALT_<jahr>` | Schuljahressalz für Pseudonyme (neues Salz = Vergessen) |
| `EDITOR_URL`, `BACKEND_URL` | Ziele der Weiterleitung und des `aud` |
| `LTI_BRIDGE_SECRET` | HS256-Schlüssel der Zusicherung, nur Dienst und Backend bekannt |

Endpunkte: `GET /jwks` (öffentliche Schlüssel), `GET /lti/login` (OIDC-Start), `POST /lti/launch`
(Form-POST mit `id_token` und `state`), `GET /health`. Sonst nichts.

Zwei Eigenschaften, die Speicher überflüssig machen:

- **`state` trägt seinen Zustand selbst**: verschlüsselt (AES-GCM) mit `nonce`, `iss`, Zieladresse und
  Ablauf; `lti_message_hint` wird durchgereicht. Kein Session-Speicher, kein Cookie.
- **Die Zusicherung ist idempotent**: gleiches Pseudonym ⇒ gleiches Projekt. Ein erneutes Einreichen
  innerhalb der 60 Sekunden öffnet nur dasselbe Projekt, deshalb braucht es **keine** Single-Use-Liste
  und keine Abstimmung zwischen den Diensten. Voraussetzung: Uhren per NTP synchron (±30 s).

### 9.3 Backend (Erweiterung von `miniworlds-editor-backend`)

| Nr. | Änderung | Ort |
|---|---|---|
| 1 | `TemplateCode.reusable` (Standard `False`) und ein neuer `access_mode: "moodle_link"`; der Lehrerbereich gibt dafür **einen** Code aus (wie heute „Vorlagencodes“, aber ohne Verfall beim ersten Einlösen) | `models.py`, `teacher_api.py`, `templates/teacher.html` |
| 2 | Neue Tabelle `ExternalBinding`: `pseudonym_hash` (eindeutig), `project_id`, `link_id`, `created_at` | `models.py`, Migration |
| 3 | Neue Route `POST /api/play/lti-bind`: Zusicherung prüfen → Bindung suchen oder Vorlage kopieren → Antwort **wie `/api/claim`** | `routes/play_api.py` |
| 4 | Den Kopierblock aus `claim_code` in eine Hilfsfunktion ziehen, damit `/claim` und `/lti-bind` denselben Weg nehmen | `routes/play_api.py` |
| 5 | Einweg-Codes (`reusable = False`) bleiben dem alten Weg vorbehalten; `reusable` wird nur über `/lti-bind` angenommen | `routes/play_api.py` |
| 6 | Protokoll: `log_audit(..., "lti_bound", target="project:{id}")` **ohne** Pseudonymwert | `routes/play_api.py` |
| 7 | `compatibility.json` führt die Fähigkeit `lti-bind` **als eigenes Angebot**, nicht als Bedingung: der Editor kann sie abfragen, ein alter Editor wird deshalb nicht abgewiesen | `app/compatibility.json` |

Wichtig für die Sparsamkeit: das Backend speichert **nur den Hash eines Pseudonyms**, kein `sub`,
keinen Namen, keine Moodle-Kennung; die Pseudonyme wechseln mit dem Schuljahr, weil die Salzwerte im
LTI-Dienst wechseln — **keine eigene Löschroutine nötig**. Bestehende Projekte werden wie heute am
31.07. schreibgeschützt (`app/yearly.py`).

### 9.4 Editor (Erweiterung von `miniworlds-editor`)

- **Umgesetzt:** Modul `src/backend/lti.ts` liest beim Start `#lti=` (`ltiAssertion`), entfernt es mit
  `history.replaceState` augenblicklich aus der Adresse (`withoutLti`) und reicht es an
  `BackendProjects.claimExternal` weiter; die Antwort ist identisch mit `/api/claim`, der weitere Weg ist
  derselbe. Schlägt der Austausch fehl (abgelaufene Zusicherung), erscheint der gewohnte Code-Dialog.
  Was nach einem angenommenen Code geschieht — das unberührte Startprojekt entfernen — steckt jetzt in
  einer gemeinsamen Funktion `starterClaimed`, die auch der Start über `?project-code=1` nutzt.
- Kein neuer Dialog: schlägt die Zusicherung fehl, erscheint der heutige Code-Dialog (`?project-code=1`).
- Tests: Vitest für das Modul (Zusicherung vorhanden/abgelaufen/fehlend), dazu ein Durchlauf in
  `test/backend.py` gegen ein lokales Backend.

### 9.5 Moodle einrichten (Bordmittel, Systemadmin)

1. *Site administration → Plugins → Aktivitäten → Externes Tool → Werkzeuge verwalten → Werkzeug hinzufügen*:
   Werkzeug-URL `https://lti.opencoding.de/lti/launch`, Anmelde-URL `…/lti/login`, Schlüsselmenge
   `…/jwks`, LTI 1.3, **keine** Dienste anhaken (kein Noten-Service, keine Mitgliederliste),
   Datenschutz: Name = nein, E-Mail = nein.
2. Kurs → Aktivität *Externes Tool* → vorkonfiguriertes Werkzeug; benutzerdefinierte Parameter:
   `link=<wiederverwendbarer Vorlagencode aus dem Lehrerbereich>`; Startcontainer **Neues Fenster**.
3. Probe mit einem Testkonto: erster Aufruf legt das Projekt an, zweiter öffnet dasselbe; ein zweites
   Konto bekommt ein eigenes.

### 9.6 Reihenfolge und Aufwand

| Schritt | Inhalt | Aufwand | Stand |
|---|---|---|---|
| A | Gerüst + Launch-Prüfer, Antwort ist nur die Weiterleitung (beweisbar speicherfrei) | 1 Tag | **umgesetzt** (`miniworlds-lti`, Start mit Umgebungsvariablen geprüft) |
| B | OIDC-Start mit verschlüsseltem `state`, Schlüssel der Plattform, Prüftests | 1–2 Tage | **umgesetzt** (Tests gegen Plattform-Attrappe) |
| C | Backend: Route, Bindung, wiederverwendbarer Vorlagencode, Migration | 2–3 Tage | **umgesetzt** (`ExternalBinding`, `TemplateCode.reusable`, `/api/play/lti-bind`, 7 Tests) |
| D | Editor: `#lti=` annehmen, Tests | 0,5–1 Tag | **umgesetzt** (`src/backend/lti.ts`, `BackendProjects.claimExternal`, 3 Tests) |
| E | Echte Moodle-Registrierung, Probe mit einer Klasse | 0,5 Tag | offen |

Vor dem Start zu klären: Domain des Dienstes; wem gehört das Bridging-Secret; ab welchem Datum das
Schuljahrssalz wechselt (Vorschlag: 31.07., identisch mit `yearly_reset_point`).
