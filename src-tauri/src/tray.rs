use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Runtime,
};

/// Builds the system tray icon and its menu (used on both macOS and Windows).
pub fn create_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let correct_i = MenuItem::with_id(app, "correct", "Korrigieren", true, None::<&str>)?;
    let settings_i = MenuItem::with_id(app, "settings", "Einstellungen", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&correct_i, &settings_i, &quit_i])?;

    let _tray = TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("TypIx")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "correct" => crate::trigger_correction(app),
            "settings" => crate::open_settings(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}
