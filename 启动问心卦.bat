@echo off
chcp 65001 >nul
title WenXinGua
cd /d "%~dp0"

echo.
echo   问 心 卦  ·  梅 花 易 数 卦 录 台
echo   ============================================
echo.

rem ---- 优先用桌面版（Electron，自带窗口与托盘）----
if exist "desktop\dist\win-unpacked\问心卦.exe" (
  echo   [桌面版] 启动已打包的程序...
  start "" "desktop\dist\win-unpacked\问心卦.exe"
  goto :eof
)

if exist "desktop\node_modules\electron\dist\electron.exe" (
  echo   [桌面版] 启动开发态 Electron...
  rem 环境里若带着 ELECTRON_RUN_AS_NODE，Electron 会退化成纯 Node 而没有窗口
  set ELECTRON_RUN_AS_NODE=
  start "" "desktop\node_modules\electron\dist\electron.exe" "desktop"
  goto :eof
)

rem ---- 没有桌面版就用浏览器窗口模式 ----
where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js not found.
  echo   Please install Node.js 18+ from https://nodejs.org
  echo   Or use the packaged desktop app under desktop\dist\.
  echo.
  pause
  exit /b 1
)

echo   [命令行版] 未找到桌面版，改为浏览器窗口模式。
echo   若要真正的桌面应用，请看 README「桌面版」一节。
echo.
node "server\index.mjs" --open %*
echo.
echo   Server stopped.
pause
