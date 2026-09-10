#Requires -Version 5.1
<#
    PixelForge 新环境一键搭建脚本 (Windows)

    用法:
        powershell -ExecutionPolicy Bypass -File setup.ps1

    可选参数:
        -SkipInstall   只做环境检查, 不执行 npm install
        -SkipChecks    装完依赖后跳过自检 (vue-tsc / vitest)

    脚本会自动定位工程目录: 无论放在仓库根还是 PixelForge/ 子目录下都能跑。
#>

param(
    [switch]$SkipInstall,
    [switch]$SkipChecks
)

$ErrorActionPreference = 'Stop'

function Write-Step { param($m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "    [OK] $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "    [!]  $m" -ForegroundColor Yellow }
function Write-Err  { param($m) Write-Host "    [X]  $m" -ForegroundColor Red }

Write-Host ''
Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  PixelForge 新环境搭建' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan

# ---------- 0. 定位工程目录 ----------
Write-Step '定位工程目录'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$subDir    = Join-Path $scriptDir 'PixelForge'

if (Test-Path (Join-Path $subDir 'package.json')) {
    $projectDir = $subDir
} elseif (Test-Path (Join-Path $scriptDir 'package.json')) {
    $projectDir = $scriptDir
} else {
    Write-Err '找不到 package.json。请把本脚本放在仓库根目录或 PixelForge/ 目录下。'
    exit 1
}

Write-Ok "工程目录: $projectDir"
Set-Location $projectDir

# ---------- 1. Node.js ----------
Write-Step '检查 Node.js'

# 某些环境下 PATHEXT 被改坏, Get-Command node 会漏判, 所以显式带 .exe / .cmd 再试一次
function Resolve-Tool {
    param([string[]]$Names)
    foreach ($n in $Names) {
        $c = Get-Command $n -ErrorAction SilentlyContinue
        if ($c) { return $c }
    }
    return $null
}

$node = Resolve-Tool @('node.exe', 'node')

if (-not $node) {
    $hints = @('C:\Program Files\nodejs\node.exe', 'C:\nodejs\node.exe')
    $hit   = $hints | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($hit) {
        Write-Err "在 $hit 发现了 Node.js, 但它不在 PATH 里。请把它所在目录加入 PATH 后重跑本脚本。"
    } else {
        Write-Err '未检测到 Node.js。请先安装 Node 22: https://nodejs.org'
    }
    exit 1
}

# 个别环境里 node 被包装脚本代理, -v 可能拿不到输出, 这里容错跳过而不是直接中断
$nodeVer   = ''
$nodeMajor = 0
try {
    $raw = (& $node.Source -v 2>&1 | Out-String).Trim()
    if ($raw -match 'v?(\d+)\.(\d+)\.(\d+)') {
        $nodeVer   = $raw.TrimStart('v')
        $nodeMajor = [int]$Matches[1]
    }
} catch { }

if ($nodeVer -eq '') {
    Write-Warn "找到 Node ($($node.Source)), 但读不到版本号, 继续执行"
} elseif ($nodeMajor -lt 22) {
    Write-Warn "当前 Node $nodeVer, 推荐 22.x (CI 使用的版本)"
} else {
    Write-Ok "Node $nodeVer"
}

# ---------- 2. npm ----------
Write-Step '检查 npm'

$npm = Resolve-Tool @('npm.cmd', 'npm')
if (-not $npm) {
    Write-Err '未检测到 npm, 通常随 Node.js 一起安装, 请检查安装。'
    exit 1
}
$npmVer = ''
try { $npmVer = ((& $npm.Source -v) 2>&1 | Out-String).Trim() } catch { }
if ($npmVer -eq '') { Write-Ok 'npm 已就绪' } else { Write-Ok "npm $npmVer" }

# ---------- 3. Rust ----------
Write-Step '检查 Rust 工具链'

$cargo = Get-Command cargo -ErrorAction SilentlyContinue
if (-not $cargo) {
    Write-Warn '未检测到 cargo。运行桌面端 (npm run tauri dev) 需要 Rust: https://rustup.rs'
    Write-Warn '只跑前端界面的话可以忽略此项。'
    $rustOk = $false
} else {
    $cargoVer = ''
    try { $cargoVer = ((& $cargo.Source --version) 2>&1 | Out-String).Trim() } catch { }
    if ($cargoVer -eq '') { Write-Ok 'cargo 已就绪' } else { Write-Ok $cargoVer }
    $rustOk = $true
}

# ---------- 4. WebView2 ----------
Write-Step '检查 WebView2 Runtime'

$wv2Paths = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
)

$wv2Found = $false
foreach ($p in $wv2Paths) {
    if (Test-Path $p) { $wv2Found = $true; break }
}

if ($wv2Found) {
    Write-Ok 'WebView2 Runtime 已安装'
} else {
    Write-Warn '未检测到 WebView2 Runtime。桌面端启动若白屏, 请安装: https://developer.microsoft.com/microsoft-edge/webview2/'
}

# ---------- 5. 安装依赖 ----------
if ($SkipInstall) {
    Write-Step '跳过依赖安装 (-SkipInstall)'
} else {
    Write-Step '安装前端依赖 (npm install)'
    Write-Host '    首次安装需要几分钟, 请耐心等待...' -ForegroundColor Gray
    & $npm.Source install
    if ($LASTEXITCODE -ne 0) {
        Write-Err "npm install 失败 (退出码 $LASTEXITCODE)"
        exit 1
    }
    Write-Ok '依赖安装完成'
}

# ---------- 6. 自检 ----------
if ($SkipChecks -or $SkipInstall) {
    Write-Step '跳过自检'
} else {
    $npx = Resolve-Tool @('npx.cmd', 'npx')

    Write-Step '类型检查 (vue-tsc)'
    if ($npx) {
        & $npx.Source vue-tsc --noEmit
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "vue-tsc 报出错误 (退出码 $LASTEXITCODE)"
        } else {
            Write-Ok '类型检查通过'
        }
    } else {
        Write-Warn '未找到 npx, 跳过类型检查'
    }

    Write-Step '运行测试 (vitest)'
    & $npm.Source test
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "测试存在失败 (退出码 $LASTEXITCODE)"
    } else {
        Write-Ok '测试全部通过'
    }
}

# ---------- 7. 收尾提示 ----------
Write-Host ''
Write-Host '========================================' -ForegroundColor Green
Write-Host '  环境搭建完成' -ForegroundColor Green
Write-Host '========================================' -ForegroundColor Green
Write-Host ''
Write-Host '启动命令:' -ForegroundColor Cyan
if ($rustOk) {
    Write-Host '    npm run tauri dev     桌面应用 (首次编译 Rust 约 10-30 分钟)' -ForegroundColor White
    Write-Host '    npm run tauri build   打包安装包' -ForegroundColor White
} else {
    Write-Host '    npm run tauri dev     桌面应用 (需先安装 Rust)' -ForegroundColor DarkGray
}
Write-Host '    npm run dev           仅前端, 浏览器打开 (Tauri 能力不可用)' -ForegroundColor White
Write-Host ''
Write-Host '换机后记得手动补两件事:' -ForegroundColor Yellow
Write-Host '    1. 在应用「设置」里重新填写 LLM API key (存在 localStorage, 不随仓库同步)' -ForegroundColor White
Write-Host '    2. 若要迁移旧作品数据, 拷贝 %APPDATA%\com.pixelforge.app\ 目录到本机相同位置' -ForegroundColor White
Write-Host ''
