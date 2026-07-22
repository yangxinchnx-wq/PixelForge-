#![cfg_attr(not(debug_assertions), warn(unused_crate_dependencies))]

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|_app| {
            // DevTools 默认不自动打开，需要时按 F12 手动打开
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
