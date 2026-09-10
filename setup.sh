#!/usr/bin/env bash
#
# PixelForge 新环境一键搭建脚本 (macOS / Linux)
#
# 用法:
#   bash setup.sh
#   bash setup.sh --skip-install   只做环境检查
#   bash setup.sh --skip-checks    装完依赖跳过自检
#
# 脚本会自动定位工程目录: 放在仓库根或 PixelForge/ 子目录下都能跑。

set -e

SKIP_INSTALL=0
SKIP_CHECKS=0
for arg in "$@"; do
    case "$arg" in
        --skip-install) SKIP_INSTALL=1 ;;
        --skip-checks)  SKIP_CHECKS=1  ;;
    esac
done

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[32m[OK]\033[0m %s\n' "$1"; }
warn() { printf '    \033[33m[!]\033[0m  %s\n' "$1"; }
err()  { printf '    \033[31m[X]\033[0m  %s\n' "$1"; }

printf '\n\033[36m========================================\033[0m\n'
printf '\033[36m  PixelForge 新环境搭建\033[0m\n'
printf '\033[36m========================================\033[0m\n'

# ---------- 0. 定位工程目录 ----------
step '定位工程目录'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$SCRIPT_DIR/PixelForge/package.json" ]; then
    PROJECT_DIR="$SCRIPT_DIR/PixelForge"
elif [ -f "$SCRIPT_DIR/package.json" ]; then
    PROJECT_DIR="$SCRIPT_DIR"
else
    err '找不到 package.json。请把本脚本放在仓库根目录或 PixelForge/ 目录下。'
    exit 1
fi

ok "工程目录: $PROJECT_DIR"
cd "$PROJECT_DIR"

# ---------- 1. Node.js ----------
step '检查 Node.js'
if ! command -v node >/dev/null 2>&1; then
    err '未检测到 Node.js。请先安装 Node 22: https://nodejs.org'
    exit 1
fi

NODE_VER="$(node -v | sed 's/^v//')"
NODE_MAJOR="${NODE_VER%%.*}"
if [ "$NODE_MAJOR" -lt 22 ]; then
    warn "当前 Node $NODE_VER, 推荐 22.x (CI 使用的版本)"
else
    ok "Node $NODE_VER"
fi

# ---------- 2. npm ----------
step '检查 npm'
if ! command -v npm >/dev/null 2>&1; then
    err '未检测到 npm, 通常随 Node.js 一起安装, 请检查安装。'
    exit 1
fi
ok "npm $(npm -v)"

# ---------- 3. Rust ----------
step '检查 Rust 工具链'
RUST_OK=1
if command -v cargo >/dev/null 2>&1; then
    ok "$(cargo --version)"
    RUST_OK=0
else
    warn '未检测到 cargo。运行桌面端 (npm run tauri dev) 需要 Rust: https://rustup.rs'
    warn '只跑前端界面的话可以忽略此项。'
fi

# ---------- 4. 平台依赖 ----------
step '检查平台依赖'
case "$(uname -s)" in
    Darwin)
        if xcode-select -p >/dev/null 2>&1; then
            ok 'Xcode Command Line Tools 已安装'
        else
            warn '未检测到 Xcode Command Line Tools, 请运行: xcode-select --install'
        fi
        ;;
    Linux)
        if pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
            ok 'webkit2gtk-4.1 已就绪'
        else
            warn '未检测到 webkit2gtk-4.1。Tauri 需要它, 安装参考: https://tauri.app/start/prerequisites/'
        fi
        ;;
esac

# ---------- 5. 安装依赖 ----------
if [ "$SKIP_INSTALL" -eq 1 ]; then
    step '跳过依赖安装 (--skip-install)'
else
    step '安装前端依赖 (npm install)'
    printf '    首次安装需要几分钟, 请耐心等待...\n'
    npm install
    ok '依赖安装完成'
fi

# ---------- 6. 自检 ----------
if [ "$SKIP_CHECKS" -eq 1 ] || [ "$SKIP_INSTALL" -eq 1 ]; then
    step '跳过自检'
else
    step '类型检查 (vue-tsc)'
    if npx vue-tsc --noEmit; then ok '类型检查通过'; else warn 'vue-tsc 报出错误'; fi

    step '运行测试 (vitest)'
    if npm test; then ok '测试全部通过'; else warn '测试存在失败'; fi
fi

# ---------- 7. 收尾提示 ----------
printf '\n\033[32m========================================\033[0m\n'
printf '\033[32m  环境搭建完成\033[0m\n'
printf '\033[32m========================================\033[0m\n\n'
printf '\033[36m启动命令:\033[0m\n'
if [ "$RUST_OK" -eq 0 ]; then
    printf '    npm run tauri dev     桌面应用 (首次编译 Rust 约 10-30 分钟)\n'
    printf '    npm run tauri build   打包安装包\n'
else
    printf '    npm run tauri dev     桌面应用 (需先安装 Rust)\n'
fi
printf '    npm run dev           仅前端, 浏览器打开 (Tauri 能力不可用)\n\n'
printf '\033[33m换机后记得手动补两件事:\033[0m\n'
printf '    1. 在应用「设置」里重新填写 LLM API key (存在 localStorage, 不随仓库同步)\n'
printf '    2. 若要迁移旧作品数据, 拷贝旧机的应用数据目录到本机相同位置:\n'
printf '       macOS ~/Library/Application Support/com.pixelforge.app/\n'
printf '       Linux  ~/.local/share/com.pixelforge.app/\n\n'
