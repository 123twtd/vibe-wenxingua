# 问心卦 · 创建桌面快捷方式
# ------------------------------------------------------------
# 在桌面与开始菜单各建一个带图标（卦符）的快捷方式：
#   · 优先指向桌面版（desktop 目录里的 electron.exe，前提是已装依赖 / 已打包）
#   · 否则指向「问心卦(桌面窗口).vbs」（零安装兜底，用 Edge/Chrome 做独立窗口）
#
# 用法：右键本文件 → 使用 PowerShell 运行
#   或在 PowerShell 里：  powershell -ExecutionPolicy Bypass -File .\创建快捷方式.ps1

$ErrorActionPreference = 'Stop'

$root    = Split-Path -Parent $MyInvocation.MyCommand.Path
$iconIco = Join-Path $root 'desktop\build\icon.ico'
$vbs     = Join-Path $root '问心卦(桌面窗口).vbs'
$elec    = Join-Path $root 'desktop\node_modules\electron\dist\electron.exe'
$packed  = Join-Path $root 'desktop\dist\win-unpacked\问心卦.exe'

function New-Lnk {
    param($Path, $Target, $Args, $WorkDir, $Desc)
    $sh = New-Object -ComObject WScript.Shell
    $lnk = $sh.CreateShortcut($Path)
    $lnk.TargetPath       = $Target
    $lnk.Arguments        = $Args
    $lnk.WorkingDirectory = $WorkDir
    $lnk.Description      = $Desc
    if (Test-Path $iconIco) { $lnk.IconLocation = $iconIco }
    $lnk.Save()
    Write-Host ("  ✓ " + $Path)
}

$desktop  = [Environment]::GetFolderPath('Desktop')
$programs = [Environment]::GetFolderPath('Programs')
$startDir = Join-Path $programs '问心卦'
New-Item -ItemType Directory -Force -Path $startDir | Out-Null

Write-Host ''
if (Test-Path $packed) {
    Write-Host '  用已打包的桌面版（推荐）'
    New-Lnk (Join-Path $desktop '问心卦.lnk') $packed '' (Split-Path $packed) '问心卦 · 梅花易数卦录台'
    New-Lnk (Join-Path $startDir '问心卦.lnk') $packed '' (Split-Path $packed) '问心卦 · 梅花易数卦录台'
}
elseif (Test-Path $elec) {
    Write-Host '  用开发态的桌面版（Electron 已就绪）'
    New-Lnk (Join-Path $desktop '问心卦.lnk') $elec '.' (Join-Path $root 'desktop') '问心卦 · 梅花易数卦录台'
    New-Lnk (Join-Path $startDir '问心卦.lnk') $elec '.' (Join-Path $root 'desktop') '问心卦 · 梅花易数卦录台'
}
elseif (Test-Path $vbs) {
    Write-Host '  未找到 Electron，改用零安装的桌面窗口（Edge/Chrome --app）'
    New-Lnk (Join-Path $desktop '问心卦.lnk') 'wscript.exe' ('"' + $vbs + '"') $root '问心卦 · 梅花易数卦录台'
    New-Lnk (Join-Path $startDir '问心卦.lnk') 'wscript.exe' ('"' + $vbs + '"') $root '问心卦 · 梅花易数卦录台'
}
else {
    Write-Host '  ✗ 既没有桌面版也没有兜底脚本，请检查文件是否完整' -ForegroundColor Red
}

Write-Host ''
Write-Host '  完成。桌面与开始菜单里都应出现「问心卦」。' -ForegroundColor Green
Write-Host '  （若图标没立刻刷新，注销一次或重启资源管理器即可）'
Write-Host ''
