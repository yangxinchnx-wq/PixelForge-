//! Windows 11 圆角窗口：为无边框（`decorations: false`）窗口的四个角
//! 设置系统级圆角。
//!
//! 问题：`decorations: false` 时 Windows 11 的 DWM 不会自动为窗口
//! 添加圆角，窗口四个角为直角（失去 Win11 原生的圆角外观）。
//!
//! 方案：调用 `DwmSetWindowAttribute` 设置
//! `DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND`
//! （Windows 11 build 22000+ 支持，使用系统默认圆角半径，
//! 与资源管理器等系统应用一致）。Windows 10 及更早版本会忽略
//! 该属性（返回 E_INVALIDARG），窗口保持直角，不影响使用。
//!
//! 与 `win_maximize_fix` 的 NC 边框归零方案兼容：DWM 圆角作用于
//! 窗口外轮廓，客户区铺满窗口矩形后由 DWM 裁切出圆角轮廓；
//! 最大化时系统自动取消圆角，无需额外处理。

use raw_window_handle::{HasWindowHandle, RawWindowHandle};

// ─── Windows API 原始类型 ───────────────────────────────────
type HWND = isize;

// ─── DWM 常量 ───────────────────────────────────────────────
/// DWM 属性索引：窗口圆角偏好（Windows 11 build 22000+）。
const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;

/// 圆角偏好值：系统默认圆角。
const DWMWCP_ROUND: u32 = 2;

// ─── 外部函数声明 ────────────────────────────────────────────
#[link(name = "dwmapi")]
extern "system" {
    fn DwmSetWindowAttribute(
        hwnd: HWND,
        dw_attribute: u32,
        pv_attribute: *const u32,
        cb_attribute: u32,
    ) -> i32; // HRESULT，S_OK = 0
}

/// 为给定窗口启用 Windows 11 圆角。
///
/// 在 `tauri::Builder::setup` 中调用，窗口创建后立即设置。
/// 属性持续生效，窗口缩放/移动后无需重新设置。
/// Windows 10 及以下调用会失败并打印提示，不影响窗口使用。
pub fn apply(window: &tauri::WebviewWindow) {
    // 通过 raw-window-handle 获取原始 HWND（与 Tauri 内部 windows crate 版本解耦）
    let handle = match window.window_handle() {
        Ok(h) => h,
        Err(e) => {
            eprintln!("[WinRoundedCorners] 获取窗口句柄失败: {:?}", e);
            return;
        }
    };

    let hwnd = match handle.as_raw() {
        RawWindowHandle::Win32(win32) => win32.hwnd.get(),
        _ => {
            eprintln!("[WinRoundedCorners] 非 Win32 窗口平台，跳过");
            return;
        }
    };

    unsafe {
        let preference = DWMWCP_ROUND;
        let hr = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &preference,
            std::mem::size_of::<u32>() as u32,
        );
        if hr != 0 {
            eprintln!(
                "[WinRoundedCorners] DwmSetWindowAttribute 失败 (HRESULT 0x{:08X})，当前系统可能不支持圆角属性",
                hr
            );
        }
    }
}
