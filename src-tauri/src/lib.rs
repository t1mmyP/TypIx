mod commands;
mod ollama;
mod settings;
mod tray;

use settings::AppState;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Grabs the user's current selection by simulating a copy, reads it from the
/// clipboard, and shows the warm main window with it. Triggered by the global
/// shortcut and the tray menu.
///
/// Runs off-thread so the shortcut handler returns immediately and the copy is
/// sent while the *source* app is still frontmost (before our window appears).
pub fn trigger_correction<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        // Hide the window first so the source app regains keyboard focus
        // before we simulate Cmd+C.
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.hide();
        }
        std::thread::sleep(std::time::Duration::from_millis(150));

        let clipboard = app.clipboard();
        let previous = clipboard.read_text().unwrap_or_default();

        // Clear first so we can tell whether the simulated copy produced text.
        let _ = clipboard.write_text(String::new());

        // TIS (keyboard layout APIs used by enigo) must run on the main thread.
        // Use a channel so the background thread waits for the copy to finish.
        let (tx, rx) = std::sync::mpsc::sync_channel::<()>(0);
        let _ = app.run_on_main_thread(move || {
            simulate_copy();
            let _ = tx.send(());
        });
        let _ = rx.recv_timeout(std::time::Duration::from_secs(2));

        std::thread::sleep(std::time::Duration::from_millis(200));
        let grabbed = clipboard.read_text().unwrap_or_default();
        let text = if grabbed.trim().is_empty() {
            // Nothing selected (or Accessibility permission missing): restore.
            let _ = clipboard.write_text(previous);
            String::new()
        } else {
            grabbed
        };

        // Remember which app was frontmost so we can re-activate it on paste.
        #[cfg(target_os = "macos")]
        {
            let frontmost = std::process::Command::new("osascript")
                .args(["-e", "tell application \"System Events\" to get name of first process whose frontmost is true"])
                .output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            *app.state::<AppState>().last_frontmost_app.lock().unwrap() = frontmost;
        }

        if let Some(window) = app.get_webview_window("main") {
            let _ = window.emit("correct-request", text);
            position_on_cursor_monitor(&app, &window);
            let _ = window.show();
            let _ = window.set_focus();
        }
    });
}

/// Positions `window` in the centre of whichever monitor the mouse cursor is on.
/// Falls back to the primary monitor if detection fails.
fn position_on_cursor_monitor<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
) {
    use tauri::PhysicalPosition;

    let Ok(cursor) = app.cursor_position() else { return; };
    let Ok(monitors) = window.available_monitors() else { return; };

    let monitor = monitors
        .iter()
        .find(|m| {
            let pos = m.position();
            let size = m.size();
            cursor.x >= pos.x as f64
                && cursor.x < pos.x as f64 + size.width as f64
                && cursor.y >= pos.y as f64
                && cursor.y < pos.y as f64 + size.height as f64
        })
        .or_else(|| monitors.first());

    let Some(monitor) = monitor else { return; };

    let mon_pos = monitor.position();
    let mon_size = monitor.size();
    let win_size = window.outer_size().unwrap_or_default();

    let x = mon_pos.x + (mon_size.width as i32 - win_size.width as i32) / 2;
    let y = mon_pos.y + (mon_size.height as i32 - win_size.height as i32) / 2;

    let _ = window.set_position(PhysicalPosition::new(x, y));
}

/// Simulates Cmd+C via enigo on the main thread (required for TIS APIs).
/// Modifier keys are released first so the shortcut doesn't interfere.
#[cfg(target_os = "macos")]
fn simulate_copy() {
    use enigo::{
        Direction::{Click, Press, Release},
        Enigo, Key, Keyboard, Settings,
    };
    let result = std::panic::catch_unwind(|| {
        match Enigo::new(&Settings::default()) {
            Err(_) => {}
            Ok(mut enigo) => {
                let _ = enigo.key(Key::Control, Release);
                let _ = enigo.key(Key::Alt, Release);
                let _ = enigo.key(Key::Shift, Release);
                std::thread::sleep(std::time::Duration::from_millis(20));
                let _ = enigo.key(Key::Meta, Press);
                let _ = enigo.key(Key::Unicode('c'), Click);
                let _ = enigo.key(Key::Meta, Release);
            }
        }
    });
    let _ = result;
}

#[cfg(target_os = "windows")]
fn simulate_copy() {
    use enigo::{
        Direction::{Click, Press, Release},
        Enigo, Key, Keyboard, Settings,
    };
    let Ok(mut enigo) = Enigo::new(&Settings::default()) else {
        return;
    };
    let _ = enigo.key(Key::Shift, Release);
    let _ = enigo.key(Key::Alt, Release);
    let _ = enigo.key(Key::Meta, Release);
    std::thread::sleep(std::time::Duration::from_millis(20));
    let _ = enigo.key(Key::Control, Press);
    let _ = enigo.key(Key::Unicode('c'), Click);
    let _ = enigo.key(Key::Control, Release);
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn simulate_copy() {}

#[cfg(target_os = "macos")]
pub(crate) fn simulate_paste() {
    // Use System Events instead of enigo to avoid CGEvent threading issues on
    // macOS 15+ and to ensure the keystroke reaches the now-frontmost app.
    let _ = std::process::Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to keystroke \"v\" using command down",
        ])
        .output();
}

#[cfg(target_os = "windows")]
pub(crate) fn simulate_paste() {
    use enigo::{
        Direction::{Click, Press, Release},
        Enigo, Key, Keyboard, Settings,
    };
    let Ok(mut enigo) = Enigo::new(&Settings::default()) else {
        return;
    };
    let _ = enigo.key(Key::Control, Press);
    let _ = enigo.key(Key::Unicode('v'), Click);
    let _ = enigo.key(Key::Control, Release);
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) fn simulate_paste() {}

/// Opens (or focuses) the Settings window. Created on demand and routed by its
/// window label in the frontend; it shares the same bundle as the main window.
///
/// While Settings is open the global shortcut is suspended, so recording a new
/// shortcut never triggers a correction. It is restored (from the latest saved
/// settings) once the window is destroyed.
pub fn open_settings<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    match tauri::WebviewWindowBuilder::new(
        app,
        "settings",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("TypIx – Einstellungen")
    .inner_size(440.0, 580.0)
    .min_inner_size(380.0, 480.0)
    .resizable(true)
    .focused(true)
    .center()
    .build()
    {
        Ok(window) => {
            let _ = app.global_shortcut().unregister_all();

            // macOS: become a regular app while Settings is open so the window
            // reliably comes to the front and can take keyboard focus.
            #[cfg(target_os = "macos")]
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);

            let app_handle = app.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Destroyed = event {
                    // Restore menu-bar-only mode and the global shortcut.
                    #[cfg(target_os = "macos")]
                    let _ = app_handle
                        .set_activation_policy(tauri::ActivationPolicy::Accessory);

                    let shortcut = app_handle
                        .state::<AppState>()
                        .settings
                        .lock()
                        .unwrap()
                        .shortcut
                        .clone();
                    if let Ok(sc) = shortcut.parse::<Shortcut>() {
                        let _ = app_handle.global_shortcut().register(sc);
                    }
                }
            });

            let _ = window.set_focus();
        }
        Err(e) => eprintln!("Settings-Fenster konnte nicht geöffnet werden: {e}"),
    }
}

/// Registers `new` and unregisters `old`. New is registered first so that a
/// failure (e.g. an invalid or conflicting combo) leaves the old one intact.
pub fn apply_shortcut<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    old: &str,
    new: &str,
) -> Result<(), String> {
    let new_sc = new
        .parse::<Shortcut>()
        .map_err(|e| format!("Ungültiger Shortcut: {e}"))?;
    app.global_shortcut()
        .register(new_sc)
        .map_err(|e| format!("Shortcut konnte nicht registriert werden: {e}"))?;
    if !old.is_empty() && old != new {
        if let Ok(old_sc) = old.parse::<Shortcut>() {
            let _ = app.global_shortcut().unregister(old_sc);
        }
    }
    Ok(())
}

/// Enables or disables launch-on-login via the autostart plugin.
pub fn apply_autostart<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    enable: bool,
) -> Result<(), String> {
    let manager = app.autolaunch();
    if enable {
        manager.enable().map_err(|e| e.to_string())
    } else {
        manager.disable().map_err(|e| e.to_string())
    }
}

pub fn run() {

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        crate::trigger_correction(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            ollama::correct_text,
            settings::get_settings,
            settings::set_settings,
            commands::accept_correction,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let current = settings::load(&handle);

            // macOS: pure menu-bar app, no dock icon.
            #[cfg(target_os = "macos")]
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Closing the main window must only hide it, not destroy it —
            // otherwise the last-window-closed event quits the app and the tray
            // icon disappears. The window stays warm for instant reopen.
            if let Some(window) = app.get_webview_window("main") {
                let win = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win.hide();
                    }
                });
            }

            tray::create_tray(&handle)?;

            // Register the configured global shortcut (non-fatal: a bad or
            // conflicting shortcut must never prevent the app from starting).
            match current.shortcut.parse::<Shortcut>() {
                Ok(sc) => {
                    if let Err(e) = app.global_shortcut().register(sc) {
                        eprintln!("Shortcut '{}' nicht registrierbar: {e}", current.shortcut);
                    }
                }
                Err(e) => eprintln!("Ungültiger Shortcut '{}': {e}", current.shortcut),
            }

            // Apply the saved autostart preference (best-effort).
            let _ = apply_autostart(&handle, current.autostart);

            // Make sure an Ollama server is running.
            ollama::ensure_server();

            // Expose settings to commands and the Ollama call.
            app.manage(AppState {
                settings: Mutex::new(current),
                last_frontmost_app: Mutex::new(None),
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, event| {
            match &event {
                tauri::RunEvent::ExitRequested { api, .. } => {
                    api.prevent_exit();
                }
                _ => {}
            }
        });
}
