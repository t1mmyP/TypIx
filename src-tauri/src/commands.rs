use tauri::{Manager, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Writes `text` to the clipboard, hides the main window, and after a short
/// delay simulates a paste so the corrected text replaces the selection in the
/// source app. Called by the frontend when the user presses Enter.
#[tauri::command]
pub fn accept_correction<R: Runtime>(
    app: tauri::AppHandle<R>,
    text: String,
) -> Result<(), String> {
    app.clipboard()
        .write_text(text)
        .map_err(|e| e.to_string())?;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }

    // Paste on the main thread after focus returns to the source app.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(150));
        let _ = app.run_on_main_thread(|| {
            crate::simulate_paste();
        });
    });

    Ok(())
}
