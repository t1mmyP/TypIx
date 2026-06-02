import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface AppSettings {
  shortcut: string;
  model: string;
  autostart: boolean;
}

const MOD_SYMBOLS: Record<string, string> = {
  Control: "⌃",
  Ctrl: "⌃",
  Alt: "⌥",
  Option: "⌥",
  Shift: "⇧",
  Super: "⌘",
  Cmd: "⌘",
  Command: "⌘",
  Meta: "⌘",
  CommandOrControl: "⌘",
};

/** Renders an accelerator like "Control+Alt+Shift+Super+S" as "⌃ ⌥ ⇧ ⌘ S". */
function prettyShortcut(accel: string): string {
  if (!accel) return "—";
  const parts = accel.split("+");
  const key = parts.pop() ?? "";
  const mods = parts.map((p) => MOD_SYMBOLS[p] ?? p).join(" ");
  return mods ? `${mods} ${key}` : key;
}

/**
 * Translates a KeyboardEvent into a Tauri accelerator key token. Limited to
 * letters / digits / function keys — the common, reliably registrable cases.
 * Returns null for modifier-only or unsupported keys (keep listening).
 */
function eventKeyToken(e: KeyboardEvent): string | null {
  const code = e.code;
  if (code.startsWith("Key")) return code.slice(3); // KeyS -> S
  if (code.startsWith("Digit")) return code.slice(5); // Digit1 -> 1
  if (/^F([1-9]|1[0-2])$/.test(code)) return code; // F1..F12
  return null;
}

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    invoke<AppSettings>("get_settings")
      .then(setSettings)
      .catch((e) => setStatus(String(e)));
  }, []);

  // While recording, capture the next key combo and turn it into an accelerator.
  useEffect(() => {
    if (!recording) return;
    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      if (e.key === "Escape") {
        setRecording(false);
        return;
      }
      const key = eventKeyToken(e);
      if (!key) return; // modifier-only / unsupported: keep waiting

      const mods: string[] = [];
      if (e.ctrlKey) mods.push("Control");
      if (e.altKey) mods.push("Alt");
      if (e.shiftKey) mods.push("Shift");
      if (e.metaKey) mods.push("Super");
      if (mods.length === 0) {
        setStatus("Mindestens eine Modifier-Taste verwenden (⌃⌥⇧⌘)");
        return;
      }

      setSettings((s) => (s ? { ...s, shortcut: [...mods, key].join("+") } : s));
      setRecording(false);
      setStatus("");
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording]);

  async function save() {
    if (!settings) return;
    setStatus("Speichere …");
    try {
      await invoke("set_settings", { settings });
      setStatus("Gespeichert ✓");
    } catch (e) {
      setStatus(String(e));
    }
  }

  if (!settings) {
    return (
      <div className="settings">
        <p className="muted">Lade …</p>
      </div>
    );
  }

  return (
    <div className="settings">
      <h1>Einstellungen</h1>

      <div className="field">
        <span className="flabel">Globaler Shortcut</span>
        <div className="shortcut-row">
          <code className="shortcut">{prettyShortcut(settings.shortcut)}</code>
          <button
            onClick={() => {
              setStatus("");
              setRecording(true);
            }}
          >
            {recording ? "Tasten drücken …" : "Ändern"}
          </button>
        </div>
      </div>

      <label className="field">
        <span className="flabel">Modell</span>
        <input
          className="text"
          value={settings.model}
          spellCheck={false}
          onChange={(e) => setSettings({ ...settings, model: e.target.value })}
        />
      </label>

      <label className="field row">
        <input
          type="checkbox"
          checked={settings.autostart}
          onChange={(e) =>
            setSettings({ ...settings, autostart: e.target.checked })
          }
        />
        <span className="flabel plain">Beim Anmelden automatisch starten</span>
      </label>

      <div className="actions">
        <span className="status">{status}</span>
        <button onClick={() => getCurrentWindow().close()}>Schließen</button>
        <button className="primary" onClick={save}>
          Speichern
        </button>
      </div>
    </div>
  );
}
