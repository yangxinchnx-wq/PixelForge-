#![cfg_attr(not(debug_assertions), warn(unused_crate_dependencies))]

use tauri::Manager;

mod db;

#[cfg(target_os = "windows")]
mod win_maximize_fix;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // 初始化 L3 持久化数据库（redb）— 同步执行，确保命令可调用前 DbState 已 manage
            match db::init_db(app.handle()) {
                Ok(database) => {
                    app.manage(db::DbState(std::sync::Mutex::new(database)));
                    println!("[L3] redb 数据库初始化成功");
                }
                Err(e) => {
                    eprintln!("[L3] redb 数据库初始化失败: {}", e);
                }
            }
            // DevTools 默认不自动打开，需要时按 F12 手动打开

            // Windows 平台：修复无边框窗口最大化时的白色边框
            #[cfg(target_os = "windows")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    win_maximize_fix::apply(&window);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 元数据
            db::db_set_metadata,
            db::db_get_metadata,
            db::db_delete_metadata,
            db::db_list_metadata,
            // Prompt 历史
            db::db_add_prompt,
            db::db_list_prompts,
            db::db_query_prompts,
            // WGSL 着色器
            db::db_save_shader,
            db::db_get_shader,
            db::db_list_shaders,
            // RenderIR 索引
            db::db_save_ir,
            db::db_get_ir,
            // 资产元数据
            db::db_save_asset,
            db::db_list_assets,
            db::db_delete_asset,
            // 维护
            db::db_clear_all,
            db::db_get_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
