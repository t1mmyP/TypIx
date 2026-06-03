import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface ModelConfig {
  name: string;
  system_prompt: string;
}

interface AppSettings {
  shortcut: string;
  models: ModelConfig[];
  selected_model: string;
  autostart: boolean;
  whitelist: string[];
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
  const [manualInput, setManualInput] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [status, setStatus] = useState("");
  const [whitelistInput, setWhitelistInput] = useState("");

  // Apply dark theme class to body for this window.
  useEffect(() => {
    document.body.classList.add("settings-page");
    return () => document.body.classList.remove("settings-page");
  }, []);

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
              setManualInput(false);
            }}
          >
            {recording ? "Tasten drücken …" : "Aufnehmen"}
          </button>
          <button
            onClick={() => {
              setManualInput((v) => !v);
              setManualValue(settings.shortcut);
              setRecording(false);
              setStatus("");
            }}
          >
            Manuell
          </button>
        </div>
        {manualInput && (
          <div className="shortcut-manual">
            <input
              className="text"
              value={manualValue}
              spellCheck={false}
              placeholder="z.B. Control+Alt+Shift+S"
              onChange={(e) => setManualValue(e.target.value)}
            />
            <button
              onClick={() => {
                if (!manualValue.trim()) return;
                setSettings({ ...settings, shortcut: manualValue.trim() });
                setManualInput(false);
                setStatus("");
              }}
            >
              Übernehmen
            </button>
          </div>
        )}
      </div>

      <div className="field">
        <span className="flabel">Modell</span>
        <div className="shortcut-row">
          <select
            className="text"
            value={settings.selected_model}
            onChange={(e) =>
              setSettings({ ...settings, selected_model: e.target.value })
            }
          >
            {settings.models.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              const name = prompt("Modell-Name (z.B. mistral:7b)");
              if (!name?.trim()) return;
              if (settings.models.find((m) => m.name === name.trim())) return;
              setSettings({
                ...settings,
                models: [
                  ...settings.models,
                  { name: name.trim(), system_prompt: "" },
                ],
                selected_model: name.trim(),
              });
            }}
          >
            +
          </button>
          <button
            disabled={settings.models.length <= 1}
            onClick={() => {
              const remaining = settings.models.filter(
                (m) => m.name !== settings.selected_model
              );
              setSettings({
                ...settings,
                models: remaining,
                selected_model: remaining[0].name,
              });
            }}
          >
            −
          </button>
        </div>
      </div>

      <div className="field">
        <span className="flabel">System-Prompt</span>
        <textarea
          className="text prompt-textarea"
          value={
            settings.models.find((m) => m.name === settings.selected_model)
              ?.system_prompt ?? ""
          }
          spellCheck={false}
          onChange={(e) =>
            setSettings({
              ...settings,
              models: settings.models.map((m) =>
                m.name === settings.selected_model
                  ? { ...m, system_prompt: e.target.value }
                  : m
              ),
            })
          }
        />
      </div>

      <div className="field">
        <span className="flabel">Whitelist</span>
        <div className="whitelist-input-row">
          <input
            className="text"
            value={whitelistInput}
            placeholder="z.B. iPhone, OpenAI, Tim …"
            spellCheck={false}
            onChange={(e) => setWhitelistInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                const word = whitelistInput.trim().replace(/,+$/, "");
                if (
                  word &&
                  !settings.whitelist.includes(word)
                ) {
                  setSettings({
                    ...settings,
                    whitelist: [...settings.whitelist, word],
                  });
                }
                setWhitelistInput("");
              }
            }}
          />
          <button
            onClick={() => {
              const word = whitelistInput.trim().replace(/,+$/, "");
              if (word && !settings.whitelist.includes(word)) {
                setSettings({
                  ...settings,
                  whitelist: [...settings.whitelist, word],
                });
              }
              setWhitelistInput("");
            }}
          >
            +
          </button>
        </div>
        {settings.whitelist.length > 0 && (
          <div className="whitelist-tags">
            {settings.whitelist.map((word) => (
              <span key={word} className="whitelist-tag">
                {word}
                <button
                  className="whitelist-tag-remove"
                  onClick={() =>
                    setSettings({
                      ...settings,
                      whitelist: settings.whitelist.filter((w) => w !== word),
                    })
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

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
