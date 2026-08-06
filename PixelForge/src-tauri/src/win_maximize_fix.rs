//! Windows 平台修复：无边框窗口移除白色调整大小边框（NC 边框）。
//!
//! 问题：当 `decorations: false` 且 `resizable: true` 时，Windows 会在窗口
//! 周围保留一个非客户区（NC）调整大小边框。这个边框在窗口正常状态下
//! 表现为边缘（特别是四角）的浅白色长方形条/指示器；最大化后则覆盖
//! 整个屏幕边缘。
//!
//! 方案：通过 `SetWindowSubclass` 子类化窗口，拦截 `WM_NCCALCSIZE` 消息。
//! **始终返回 0**，将窗口客户区矩形设为完整窗口矩形（最大化时调整为
//! 显示器工作区 `rcWork`，排除任务栏），从而使非客户区归零，消除白色边框。
//!
//! 窗口调整大小功能不受影响：Tauri（tao）通过 `WM_NCHITTEST` 独立处理
//! 无边框窗口的边缘拖拽调整大小，不依赖 NC 边框。
//!
//! 最大化检测采用双重判定（用于决定是否将客户区调整为工作区）：
//! 1. `IsZoomed()` — Windows 原生最大化状态检测（主判定）
//! 2. 窗口矩形与显示器矩形对比 — 兜底：当窗口通过非标准方式
//!    （如 Tauri 的 SetWindowPos 拉伸、Aero Snap）填满屏幕时也能触发

use raw_window_handle::{HasWindowHandle, RawWindowHandle};

// ─── Windows API 原始类型 ───────────────────────────────────
type HWND = isize;
type WPARAM = usize;
type LPARAM = isize;
type LRESULT = isize;
type BOOL = i32;
type HMONITOR = isize;

// ─── 常量 ──────────────────────────────────────────────────
const WM_NCCALCSIZE: u32 = 0x0083;
const MONITOR_DEFAULTTONEAREST: u32 = 0x00000002;

/// 窗口矩形与显示器矩形对比时的容差（像素）。
/// 最大化时 Windows 会把窗口尺寸撑到略大于屏幕（NC 边框延伸到屏幕外），
/// 用容差避免精确匹配问题。
const SIZE_TOLERANCE: i32 = 2;

// ─── 结构体 ─────────────────────────────────────────────────
#[repr(C)]
#[derive(Clone, Copy)]
struct RECT {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

impl RECT {
    fn width(&self) -> i32 {
        self.right - self.left
    }
    fn height(&self) -> i32 {
        self.bottom - self.top
    }
}

#[repr(C)]
struct MONITORINFO {
    cb_size: u32,
    rc_monitor: RECT,
    rc_work: RECT,
    dw_flags: u32,
}

/// `WM_NCCALCSIZE` 的 `lParam`（当 `wParam == TRUE` 时）。
///
/// 包含 3 个 RECT：
///   - `rgrc[0]`：窗口的新矩形（输入/输出）
///   - `rgrc[1]`：旧窗口矩形
///   - `rgrc[2]`：旧客户区矩形
#[repr(C)]
struct NcCalcSizeParams {
    rgrc: [RECT; 3],
    lppos: *mut u8, // WINDOWPOS* — 不需要使用
}

// ─── 子类化函数指针类型 ──────────────────────────────────────
type SubclassProc = Option<
    unsafe extern "system" fn(
        hwnd: HWND,
        umsg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        uid_subclass: usize,
        dw_ref_data: usize,
    ) -> LRESULT,
>;

// ─── 外部函数声明 ────────────────────────────────────────────

#[link(name = "user32")]
extern "system" {
    fn IsZoomed(hwnd: HWND) -> BOOL;
    fn MonitorFromWindow(hwnd: HWND, dw_flags: u32) -> HMONITOR;
}

#[link(name = "gdi32")]
extern "system" {
    fn GetMonitorInfoW(hmonitor: HMONITOR, lpmi: *mut MONITORINFO) -> BOOL;
}

#[link(name = "comctl32")]
extern "system" {
    fn SetWindowSubclass(
        hwnd: HWND,
        pfn_subclass: SubclassProc,
        uid_subclass: usize,
        dw_ref_data: usize,
    ) -> BOOL;
    fn DefSubclassProc(hwnd: HWND, umsg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT;
}

// ─── 子类化 ID（任意唯一值） ─────────────────────────────────
const SUBCLASS_ID: usize = 0x4000_0001;

// ─── 辅助函数 ────────────────────────────────────────────────

/// 判断窗口矩形是否大致填满整个显示器（即处于最大化或近似最大化状态）。
///
/// 最大化时 Windows 把窗口尺寸撑到略大于屏幕（NC 边框延伸到屏幕外），
/// 所以只要窗口宽高 >= 显示器宽高 - 容差，就认为窗口填满了屏幕。
fn is_window_filling_monitor(window_rect: &RECT, monitor_rect: &RECT) -> bool {
    let monitor_w = monitor_rect.width();
    let monitor_h = monitor_rect.height();
    let window_w = window_rect.width();
    let window_h = window_rect.height();

    window_w >= monitor_w - SIZE_TOLERANCE && window_h >= monitor_h - SIZE_TOLERANCE
}

// ─── 子类化过程 ──────────────────────────────────────────────
/// 拦截 `WM_NCCALCSIZE`：始终将非客户区归零，消除白色 NC 边框。
///
/// **最大化时**：将客户区矩形设为显示器工作区（`rcWork`，排除任务栏），
/// 防止最大化后窗口覆盖任务栏。
///
/// **非最大化时**：保持客户区矩形为完整窗口矩形（`rgrc[0]` 不修改），
/// 非客户区为零，消除正常状态下的浅白色 NC 边框/调整大小指示器。
///
/// 最大化检测采用双重判定：
/// - `IsZoomed()` 检测 Windows 原生最大化状态
/// - 窗口矩形 vs 显示器矩形对比，兜底非标准最大化路径
///
/// 窗口调整大小功能不受影响：Tauri（tao）通过 `WM_NCHITTEST` 独立处理
/// 无边框窗口的边缘拖拽调整大小，不依赖 NC 边框。
unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _ref_data: usize,
) -> LRESULT {
    if msg == WM_NCCALCSIZE && wparam == 1 {
        let params = &mut *(lparam as *mut NcCalcSizeParams);
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut mi: MONITORINFO = std::mem::zeroed();
        mi.cb_size = std::mem::size_of::<MONITORINFO>() as u32;

        if GetMonitorInfoW(monitor, &mut mi) != 0 {
            // 双重判定：IsZoomed 或 窗口矩形填满显示器
            let is_zoomed = IsZoomed(hwnd) != 0;
            let is_filling = is_window_filling_monitor(&params.rgrc[0], &mi.rc_monitor);

            if is_zoomed || is_filling {
                // 最大化时：将客户区矩形设置为显示器工作区（排除任务栏）
                params.rgrc[0] = mi.rc_work;
            }
        }

        // 始终返回 0：将 rgrc[0] 作为客户区，非客户区为零 → 无浅白色边框
        // Tauri（tao）的 WM_NCHITTEST 处理仍然提供边缘调整大小功能
        return 0;
    }
    // 所有其他消息：正常传递给下一个子类化过程或原始窗口过程
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

/// 为给定窗口应用 NC 边框修复。
///
/// 在 `tauri::Builder::setup` 中调用，窗口创建后立即子类化。
pub fn apply(window: &tauri::WebviewWindow) {
    // 通过 raw-window-handle 获取原始 HWND（与 Tauri 内部 windows crate 版本解耦）
    let handle = match window.window_handle() {
        Ok(h) => h,
        Err(e) => {
            eprintln!("[WinMaximizeFix] 获取窗口句柄失败: {:?}", e);
            return;
        }
    };

    let hwnd = match handle.as_raw() {
        RawWindowHandle::Win32(win32) => win32.hwnd.get(),
        _ => {
            eprintln!("[WinMaximizeFix] 非 Win32 窗口平台，跳过");
            return;
        }
    };

    unsafe {
        if SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0) == 0 {
            eprintln!("[WinMaximizeFix] SetWindowSubclass 调用失败");
        }
    }
}
