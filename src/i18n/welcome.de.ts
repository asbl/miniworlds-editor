/** Texts of the first-run experience: welcome card, import hints, backup hints, start-up progress. Merged into `de`. */
export const welcomeDe = {
  // ---- welcome card ----
  'welcome.title': 'Womit möchtest du anfangen?',
  'welcome.empty': 'Eigene Welt',
  'welcome.empty.text': 'Eine blaue Figur bewegt sich und lässt sich mit den Pfeiltasten drehen.',
  'welcome.import': 'Projekt importieren …',
  'welcome.reopen': 'Erste Schritte …',
  // ---- import hints ----
  'import.title': 'Projekt importieren',
  'import.intro': 'Aus jedem Import entsteht ein neues Projekt – nichts Vorhandenes wird überschrieben.',
  'import.drop': 'Ordner, ZIP- oder Python-Dateien hierher ziehen',
  'import.folder.button': 'Ordner auswählen …',
  'import.zip.button': 'ZIP-Datei auswählen …',
  'import.files.button': 'Python-Dateien auswählen …',
  'project.importHelp': 'Importieren …',
  // ---- backup ----
  'share.legacyFailed': 'Der Projektlink ist unvollständig, ungültig oder zu groß. Bitte den vollständigen Link noch einmal kopieren oder das Projekt als ZIP übertragen.',
  'backup.full': 'Der Speicher dieses Browsers ist fast voll. Lade dein Projekt als ZIP-Datei herunter, damit nichts verloren geht.',
  'backup.button': 'ZIP herunterladen',
  'backup.title': 'Projekt als ZIP-Datei herunterladen',
  'backup.hint': 'Dein Projekt ist nur auf diesem Gerät gespeichert. Lade eine ZIP-Datei als Sicherung herunter.',
  'backup.hint.now': 'ZIP herunterladen',
  'backup.hint.later': 'Später',
  // ---- start-up progress ----
  'run.queued': '⏳ Startet gleich …',
  'run.queued.title': 'Dein Programm startet, sobald Python bereit ist.',
  'boot.what.pyodide': 'Python wird geladen',
  'boot.what.packages': 'Grundpakete werden geladen',
  'boot.what.miniworlds': 'miniworlds wird installiert',
  'boot.what.extra': 'Zusatzpakete werden installiert',
  'loading.compact': 'Python wird geladen …',
  'loading.canEdit': 'Du kannst bereits Code schreiben.',
} as const
