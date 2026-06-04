use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Runtime,
};

/// Builds the system tray icon and its menu (used on both macOS and Windows).
pub fn create_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let correct_i = MenuItem::with_id(app, "correct", "Correct", true, None::<&str>)?;
    let settings_i = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&correct_i, &settings_i, &quit_i])?;

    let png_bytes = include_bytes!("../icons/32x32.png");
    let img = image::load_from_memory_with_format(png_bytes, image::ImageFormat::Png)
        .expect("failed to load tray icon");
    let icon = tauri::image::Image::new_owned(
        img.to_rgba8().into_raw(),
        img.width(),
        img.height(),
    );

    let _tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("TypIx")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "correct" => crate::trigger_correction(app),
            "settings" => crate::open_settings(app),
            "quit" => std::process::exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}
