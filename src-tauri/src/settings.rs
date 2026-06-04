use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime, State};

const DEFAULT_SYSTEM_PROMPT: &str = "You are a precise text correction tool. \
Correct only spelling, grammar, and punctuation in the following text. \
Preserve meaning, tone, language, and formatting exactly. Do not invent content or shorten anything. \
Output ONLY the corrected text – no explanations, no quotation marks, no introduction.";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub name: String,
    pub system_prompt: String,
}

impl ModelConfig {
    fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            system_prompt: DEFAULT_SYSTEM_PROMPT.to_string(),
        }
    }
}

/// Persisted user settings. `#[serde(default)]` lets partial/older files load.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Global shortcut accelerator, e.g. "Control+Alt+Shift+Super+S" (Hyper+S).
    pub shortcut: String,
    /// Available models with their individual system prompts.
    pub models: Vec<ModelConfig>,
    /// Name of the currently selected model.
    pub selected_model: String,
    /// Launch TypIx on login.
    pub autostart: bool,
    /// Words that must never be altered by the correction (e.g. proper nouns).
    pub whitelist: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            shortcut: "Control+Alt+Shift+Super+S".to_string(),
            models: vec![
                ModelConfig::new("qwen2.5:3b"),
                ModelConfig::new("llama3.2:3b"),
            ],
            selected_model: "qwen2.5:3b".to_string(),
            autostart: false,
            whitelist: Vec::new(),
        }
    }
}

/// App-wide state shared with commands and the Ollama call.
pub struct AppState {
    pub settings: Mutex<Settings>,
    /// The name of the frontmost app just before TypIx's window appeared.
    /// Used to re-activate it before simulating paste.
    pub last_frontmost_app: Mutex<Option<String>>,
}

fn settings_file<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("settings.json"))
        .map_err(|e| e.to_string())
}

/// Loads settings from disk, falling back to defaults on any error.
pub fn load<R: Runtime>(app: &AppHandle<R>) -> Settings {
    settings_file(app)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Persists settings to disk (creating the config dir if needed).
pub fn save<R: Runtime>(app: &AppHandle<R>, settings: &Settings) -> Result<(), String> {
    let path = settings_file(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_settings<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<(), String> {
    let old = state.settings.lock().unwrap().clone();

    // Apply side effects first; if one fails, nothing is persisted.
    if settings.shortcut != old.shortcut {
        crate::apply_shortcut(&app, &old.shortcut, &settings.shortcut)?;
    }
    if settings.autostart != old.autostart {
        crate::apply_autostart(&app, settings.autostart)?;
    }

    save(&app, &settings)?;
    *state.settings.lock().unwrap() = settings;
    Ok(())
}
