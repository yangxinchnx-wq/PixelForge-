//! PixelForge L3 持久化存储层
//!
//! 使用 redb 嵌入式 KV 数据库（纯 Rust，mmap 内存级读）。
//! 用途：元数据索引、项目状态、prompt 历史、WGSL 代码版本。
//!
//! 大块二进制（图片视频帧）由前端 L2 OPFS 处理，这里只存小文本/JSON。
//!
//! 表设计：
//! - metadata : 项目元数据 (key → JSON string)
//! - prompts  : prompt 历史 (timestamp_ms → text)
//! - shaders  : WGSL 代码版本 (hash → text)
//! - ir       : RenderIR 快照索引 (frame_id → JSON string)
//! - assets   : 资产元数据 (asset_id → JSON string)

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

use redb::{Database, ReadableTable, TableDefinition};

/// 元数据表：通用 KV（项目状态、设置等）
const METADATA_TABLE: TableDefinition<&str, &str> = TableDefinition::new("metadata");
/// Prompt 历史表：timestamp_ms (字符串) → prompt 文本
const PROMPTS_TABLE: TableDefinition<&str, &str> = TableDefinition::new("prompts");
/// WGSL 着色器表：hash → 源码
const SHADERS_TABLE: TableDefinition<&str, &str> = TableDefinition::new("shaders");
/// RenderIR 索引表：frame_id → IR JSON
const IR_TABLE: TableDefinition<&str, &str> = TableDefinition::new("ir");
/// 资产元数据表：asset_id → JSON
const ASSETS_TABLE: TableDefinition<&str, &str> = TableDefinition::new("assets");

/// 全局数据库句柄
pub struct DbState(pub Mutex<Database>);

/// 获取数据库文件路径
/// 优先使用 Tauri 的 app_data_dir，兜底使用当前目录
fn get_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取 app_data_dir: {}", e))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建数据目录: {}", e))?;
    Ok(dir.join("pixelforge.redb"))
}

/// 初始化数据库：创建/打开文件，建表
pub fn init_db(app: &AppHandle) -> Result<Database, String> {
    let path = get_db_path(app)?;
    let db = Database::create(&path).map_err(|e| format!("打开数据库失败: {}", e))?;

    // 建表（幂等）
    let txn = db.begin_write().map_err(|e| format!("开始写事务失败: {}", e))?;
    {
        let _ = txn.open_table(METADATA_TABLE).map_err(|e| format!("建 metadata 表失败: {}", e))?;
        let _ = txn.open_table(PROMPTS_TABLE).map_err(|e| format!("建 prompts 表失败: {}", e))?;
        let _ = txn.open_table(SHADERS_TABLE).map_err(|e| format!("建 shaders 表失败: {}", e))?;
        let _ = txn.open_table(IR_TABLE).map_err(|e| format!("建 ir 表失败: {}", e))?;
        let _ = txn.open_table(ASSETS_TABLE).map_err(|e| format!("建 assets 表失败: {}", e))?;
    }
    txn.commit().map_err(|e| format!("提交事务失败: {}", e))?;

    Ok(db)
}

// ===== Tauri Commands =====

/// 写入元数据 KV
#[tauri::command]
pub fn db_set_metadata(key: String, value: String, state: State<'_, DbState>) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let txn = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut table = txn.open_table(METADATA_TABLE).map_err(|e| e.to_string())?;
        table.insert(key.as_str(), value.as_str()).map_err(|e| e.to_string())?;
    }
    txn.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 读取元数据 KV
#[tauri::command]
pub fn db_get_metadata(key: String, state: State<'_, DbState>) -> Result<Option<String>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let txn = db.begin_read().map_err(|e| e.to_string())?;
    let table = txn.open_table(METADATA_TABLE).map_err(|e| e.to_string())?;
    let v = table
        .get(key.as_str())
        .map_err(|e| e.to_string())?
        .map(|v| v.value().to_string());
    Ok(v)
}

/// 删除元数据 KV
#[tauri::command]
pub fn db_delete_metadata(key: String, state: State<'_, DbState>) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let txn = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut table = txn.open_table(METADATA_TABLE).map_err(|e| e.to_string())?;
        table.remove(key.as_str()).map_err(|e| e.to_string())?;
    }
    txn.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 列出全部元数据键（按字典序）
#[tauri::command]
pub fn db_list_metadata(state: State<'_, DbState>) -> Result<Vec<String>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let txn = db.begin_read().map_err(|e| e.to_string())?;
    let table = txn.open_table(METADATA_TABLE).map_err(|e| e.to_string())?;
    let mut keys = Vec::new();
    for item in table.iter().map_err(|e| e.to_string())? {
        let (k, _) = item.map_err(|e| e.to_string())?;
        keys.push(k.value().to_string());
    }
    Ok(keys)
}

// ===== Prompt 历史 =====

/// 添加 prompt 记录（key = timestamp_ms 字符串）
#[tauri::command]
pub fn db_add_prompt(timestamp_ms: i64, text: String, state: State<'_, DbState>) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let txn = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut table = txn.open_table(PROMPTS_TABLE).map_err(|e| e.to_string())?;
        table
            .insert(timestamp_ms.to_string().as_str(), text.as_str())
            .map_err(|e| e.to_string())?;
    }
    txn.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 列出 prompt 历史（按时间升序）
#[tauri::command]
pub fn db_list_prompts(state: State<'_, DbState>) -> Result<Vec<(i64, String)>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let txn = db.begin_read().map_err(|e| e.to_string())?;
    let table = txn.open_table(PROMPTS_TABLE).map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for item in table.iter().map_err(|e| e.to_string())? {
        let (k, v) = item.map_err(|e| e.to_string())?;
        let ts: i64 = k.value().parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
        result.push((ts, v.value().to_string()));
    }
    Ok(result)
}

/// 按时间范围查询 prompt（包含 [start, end]）
#[tauri::command]
pub fn db_query_prompts(start_ms: i64, end_ms: i64, state: State<'_, DbState>) -> Result<Vec<(i64, String)>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let txn = db.begin_read().map_err(|e| e.to_string())?;
    let table = txn.open_table(PROMPTS_TABLE).map_err(|e| e.to_string())?;
    let start = start_ms.to_string();
    let end = end_ms.to_string();
    let range = table
        .range(start.as_str()..=end.as_str())
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for item in range {
        let (k, v) = item.map_err(|e| e.to_string())?;
        let ts: i64 = k.value().parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
        result.push((ts, v.value().to_string()));
    }
    Ok(result)
}

// ===== WGSL 着色器代码 =====

/// 保存 WGSL 源码（key = 内容 hash）
#[tauri::command]
pub fn db_save_shader(hash: String, code: String, state: State<'_, DbState>) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let txn = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut table = txn.open_table(SHADERS_TABLE).map_err(|e| e.to_string())?;
        table.insert(hash.as_str(), code.as_str()).map_err(|e| e.to_string())?;
    }
    txn.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 按 hash 获取 WGSL 源码
#[tauri::command]
pub fn db_get_shader(hash: String, state: State<'_, DbState>) -> Result<Option<String>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let txn = db.begin_read().map_err(|e| e.to_string())?;
    let table = txn.open_table(SHADERS_TABLE).map_err(|e| e.to_string())?;
    Ok(table
        .get(hash.as_str())
        .map_err(|e| e.to_string())?
        .map(|v| v.value().to_string()))
}

/// 列出所有 shader 的 hash
#[tauri::command]
pub fn db_list_shaders(state: State<'_, DbState>) -> Result<Vec<String>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let txn = db.begin_read().map_err(|e| e.to_string())?;
    let table = txn.open_table(SHADERS_TABLE).map_err(|e| e.to_string())?;
    let mut keys = Vec::new();
    for item in table.iter().map_err(|e| e.to_string())? {
        let (k, _) = item.map_err(|e| e.to_string())?;
        keys.push(k.value().to_string());
    }
    Ok(keys)
}

// ===== RenderIR 索引 =====

/// 保存 RenderIR 快照（key = frame_id 字符串）
#[tauri::command]
pub fn db_save_ir(frame_id: i64, ir_json: String, state: State<'_, DbState>) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let txn = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut table = txn.open_table(IR_TABLE).map_err(|e| e.to_string())?;
        table
            .insert(frame_id.to_string().as_str(), ir_json.as_str())
            .map_err(|e| e.to_string())?;
    }
    txn.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 按 frame_id 获取 RenderIR
#[tauri::command]
pub fn db_get_ir(frame_id: i64, state: State<'_, DbState>) -> Result<Option<String>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let txn = db.begin_read().map_err(|e| e.to_string())?;
    let table = txn.open_table(IR_TABLE).map_err(|e| e.to_string())?;
    Ok(table
        .get(frame_id.to_string().as_str())
        .map_err(|e| e.to_string())?
        .map(|v| v.value().to_string()))
}

// ===== 资产元数据 =====

/// 保存资产元数据（key = asset_id）
#[tauri::command]
pub fn db_save_asset(asset_id: String, meta_json: String, state: State<'_, DbState>) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let txn = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut table = txn.open_table(ASSETS_TABLE).map_err(|e| e.to_string())?;
        table
            .insert(asset_id.as_str(), meta_json.as_str())
            .map_err(|e| e.to_string())?;
    }
    txn.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 列出全部资产元数据
#[tauri::command]
pub fn db_list_assets(state: State<'_, DbState>) -> Result<Vec<(String, String)>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let txn = db.begin_read().map_err(|e| e.to_string())?;
    let table = txn.open_table(ASSETS_TABLE).map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for item in table.iter().map_err(|e| e.to_string())? {
        let (k, v) = item.map_err(|e| e.to_string())?;
        result.push((k.value().to_string(), v.value().to_string()));
    }
    Ok(result)
}

/// 删除资产
#[tauri::command]
pub fn db_delete_asset(asset_id: String, state: State<'_, DbState>) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let txn = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut table = txn.open_table(ASSETS_TABLE).map_err(|e| e.to_string())?;
        table.remove(asset_id.as_str()).map_err(|e| e.to_string())?;
    }
    txn.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 清空数据库（谨慎！用于重置）
#[tauri::command]
pub fn db_clear_all(state: State<'_, DbState>) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let txn = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut t1 = txn.open_table(METADATA_TABLE).map_err(|e| e.to_string())?;
        let mut t2 = txn.open_table(PROMPTS_TABLE).map_err(|e| e.to_string())?;
        let mut t3 = txn.open_table(SHADERS_TABLE).map_err(|e| e.to_string())?;
        let mut t4 = txn.open_table(IR_TABLE).map_err(|e| e.to_string())?;
        let mut t5 = txn.open_table(ASSETS_TABLE).map_err(|e| e.to_string())?;
        t1.retain(|_, _| false).map_err(|e| e.to_string())?;
        t2.retain(|_, _| false).map_err(|e| e.to_string())?;
        t3.retain(|_, _| false).map_err(|e| e.to_string())?;
        t4.retain(|_, _| false).map_err(|e| e.to_string())?;
        t5.retain(|_, _| false).map_err(|e| e.to_string())?;
    }
    txn.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ===== 用于测试/调试：导出数据库路径 =====

#[tauri::command]
pub fn db_get_path(app: AppHandle) -> Result<String, String> {
    let path = get_db_path(&app)?;
    Ok(path.to_string_lossy().to_string())
}

/// 在 Tauri builder 中注册所有命令与状态（备用入口，主流程在 lib.rs 中调用 init_db）
#[allow(dead_code)]
pub fn register(app: AppHandle) -> Result<AppHandle, String> {
    let db = init_db(&app)?;
    app.manage(DbState(Mutex::new(db)));
    Ok(app)
}
