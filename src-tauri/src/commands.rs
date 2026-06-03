use tauri::{Manager, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Writes `text` to the clipboard, hides the main window, explicitly
/// re-activates the source app, and then simulates a paste so the corrected
/// text replaces the selection. Called by the frontend when the user presses Enter.
#[tauri::command]
pub fn accept_correction<R: Runtime>(
    app: tauri::AppHandle<R>,
    text: String,
) -> Result<(), String> {
    app.clipboard()
        .write_text(text)
        .map_err(|e| e.to_string())?;

    // Grab the remembered source app before hiding the window.
    let source_app = app
        .state::<crate::settings::AppState>()
        .last_frontmost_app
        .lock()
        .unwrap()
        .clone();

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }

    std::thread::spawn(move || {
        // Re-activate the source app so the paste lands in the right window.
        #[cfg(target_os = "macos")]
        if let Some(app_name) = &source_app {
            let script = format!(
                "tell application \"{}\" to activate",
                app_name.replace('"', "\\\"")
            );
            let _ = std::process::Command::new("osascript")
                .args(["-e", &script])
                .output();
        }

        std::thread::sleep(std::time::Duration::from_millis(300));
        crate::simulate_paste();
    });

    Ok(())
}
