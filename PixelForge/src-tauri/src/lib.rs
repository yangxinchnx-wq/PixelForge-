#![cfg_attr(not(debug_assertions), warn(unused_crate_dependencies))]

mod db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // 初始化 L3 持久化数据库（redb）
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match db::init_db(&app_handle) {
                    Ok(database) => {
                        app_handle.manage(db::DbState(std::sync::Mutex::new(database)));
                        println!("[L3] redb 数据库初始化成功");
                    }
                    Err(e) => {
                        eprintln!("[L3] redb 数据库初始化失败: {}", e);
                    }
                }
            });
            // DevTools 默认不自动打开，需要时按 F12 手动打开
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
