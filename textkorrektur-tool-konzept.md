# Textkorrektur-Tool – Konzept & Entscheidungen

Lokales Tool zum Korrigieren von Texten via Ollama. Stand: Konzeptphase.

## User Flow

1. Text kopieren, globalen Shortcut drücken.
2. Kleines Fenster öffnet sich (quasi instant) und zeigt den korrigierten Text.
3. Fehler/Änderungen sind hervorgehoben.
4. Enter → korrigierter Text landet im Clipboard, Fenster schließt sich.

## Tech-Stack-Entscheidung

### Framework: Tauri (v2)

Gewählt wegen leichtem, instant öffnendem UI bei minimalem Footprint.

- Nutzt den System-Webview statt gebündeltem Chromium → Binaries im einstelligen MB-Bereich, niedriger RAM-Verbrauch.
- Frontend ist normales HTML/CSS/JS (React/Svelte/Vanilla frei wählbar) → Diff-Highlighting ist damit einfach umsetzbar.
- Rust-Anteil bleibt minimal: nur Tray, Shortcut-Registrierung, Window show/hide, Ollama-Prozess spawnen.

Benötigte Tauri-Bausteine:

- Tray ist im Core (`TrayIconBuilder`)
- `tauri-plugin-global-shortcut`
- `tauri-plugin-clipboard-manager`
- `tauri-plugin-autostart`

### Verworfene Alternativen

- **Electron**: schnellste Iteration, aber das Gegenteil von leicht (150+ MB Binaries, hoher RAM). Passt nicht zum „leicht/schnell"-Ziel.
- **Avalonia (C#)**: native, cross-platform, gute Performance bei einer Codebase. Aber Diff-Rendering und UI-Iteration sind in Web-Tech angenehmer. Performance-Gewinn in dieser App nicht spürbar.
- **Echtes Nativ (Swift/AppKit + WinUI/WPF)**: bedeutet zwei Codebases. Aufwand lohnt sich für dieses Tool nicht.

## Performance: Tauri vs. nativ

Fazit: Der Unterschied wäre **nicht spürbar**, weil der UI-Framework-Anteil gegenüber der LLM-Inferenz irrelevant ist.

- **Fenster zeigen** (warm vorgeladen, `show()` + `set_focus()`): einstelliger bis niedriger zweistelliger ms-Bereich → unter der Wahrnehmungsschwelle. Nativ wäre evtl. 2–5 ms schneller, nicht merkbar.
- **LLM-Inferenz** (qwen2.5:3b): der eigentliche Zeitfresser, komplett framework-unabhängig (Ollama läuft als eigener Prozess).
- **Diff-Rendering** (paar hundert Spans): für jeden Webview trivial.

Wo der Unterschied real, aber hier irrelevant ist:

- **Cold Start**: nativ startet schneller, passiert bei einer Tray-App aber nur einmal beim Login.
- **RAM**: Tauri ~30–80 MB, nativ ~10–30 MB. Für ein Hintergrund-Tool kein Thema.
- **Rendering-heavy UIs** (60 fps, riesige Listen, Canvas): nicht der Anwendungsfall.

## Wichtige Implementierungs-Details

### „Instant öffnen"-Trick

Fenster **nicht** beim Shortcut-Druck erzeugen (Webview-Cold-Start = spürbare Verzögerung). Stattdessen:

- Fenster beim App-Start einmal versteckt erzeugen (warm halten).
- Beim Shortcut nur `show()` + `set_focus()`.
- Bei Enter: Ergebnis ins Clipboard, dann `hide()` statt destroy.

Auf macOS `ActivationPolicy::Accessory` setzen → reine Menübar-App, kein Dock-Icon.

### Diff-Highlighting

- Modell gibt **nur den korrigierten Text** aus.
- Diff wird **client-seitig** berechnet (z. B. `jsdiff` mit `diffWords`). Robuster, als ein 3B-Modell Änderungen selbst markieren zu lassen.
- Wort-Level-Diff → Spans als `<span class="added/removed">` rendern.
- Streaming (`stream: true`) für besseres Gefühl: Tokens live einlaufen lassen, finales Diff nach Stream-Ende rendern.

### Ollama

- Server wird beim App-Start im Hintergrund gestartet.
- Modell `qwen2.5:3b` (schnell, klein, läuft auf fast jeder Hardware), Laden < 1 s.
- `keep_alive`-Parameter steuern: `keep_alive: 0` zum sofortigen Entladen nach Korrektur, oder z. B. `"5m"` damit es während aktiver Session warm bleibt und nur bei Inaktivität rausfliegt.
- System-Prompt fürs Korrigieren ist vorhanden, noch zu tweaken.

## Zukunft: Eigennamen-Datenbank

Kombinierter Ansatz empfohlen:

1. **Glossar in den System-Prompt injizieren** („schreibe folgende Namen immer exakt so: …").
2. **Deterministischer Post-Replace** nach der Korrektur (case-insensitiv) als Sicherheitsnetz, da der Prompt-Weg bei 3B nicht garantiert ist.

UI-Idee: bei einem markierten Wort einen „als Eigenname speichern"-Button anbieten.

## Offene Punkte / Nächste Schritte

- Frontend-Wahl festlegen (Svelte / React / Vanilla).
- System-Prompt für Korrektur weiter tweaken.
- Minimales Tauri-v2-Scaffold: Global-Shortcut, Tray-Menü, versteckt vorgeladenes Fenster, Ollama-Streaming-Call.
- UI-Integration der Eigennamen-DB ausarbeiten.
