' ============================================================
'  问心卦 · 桌面窗口启动器（零安装）
' ------------------------------------------------------------
'  作用：不用装 Electron 也能得到一个「桌面应用」般的体验——
'    1. 后台静默启动本地服务（不弹黑色控制台窗口）
'    2. 用系统自带的 Edge/Chrome 以 --app 模式打开
'       —— 独立窗口、无地址栏、无标签页、任务栏有独立图标
'    3. 关掉窗口后自动停掉后台服务
'
'  这是兜底方案。正规的桌面版是 desktop/ 里那个 Electron 应用
'  （双击「问心卦.exe」或安装包），窗口、托盘、菜单都是自己的。
' ============================================================

Option Explicit

Dim sh, fso, root, nodeExe, port, url, serverCmd, browser, tries, i
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
port = 19730
url  = "http://127.0.0.1:" & port & "/"

' ---- 1. 找 Node ----
nodeExe = ""
If fso.FileExists("C:\Program Files\nodejs\node.exe") Then
  nodeExe = "C:\Program Files\nodejs\node.exe"
ElseIf fso.FileExists(sh.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")) Then
  nodeExe = sh.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")
ElseIf fso.FileExists(sh.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\nodejs\node.exe")) Then
  nodeExe = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\nodejs\node.exe")
End If

If nodeExe = "" Then
  MsgBox "没找到 Node.js。" & vbCrLf & vbCrLf & _
         "请先装 Node.js 18+（https://nodejs.org），" & vbCrLf & _
         "或改用 desktop 目录里的桌面版（那个自带运行时，不需要 Node）。", _
         16, "问心卦"
  WScript.Quit 1
End If

' ---- 2. 找浏览器（用系统自带的 Edge/Chrome 做窗口外壳）----
browser = ""
Dim cands, c
cands = Array( _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Google\Chrome\Application\chrome.exe" )
For Each c In cands
  If browser = "" And fso.FileExists(c) Then browser = c
Next

' ---- 3. 起服务：0 = 隐藏窗口，False = 不等待 ----
serverCmd = """" & nodeExe & """ """ & root & "\server\index.mjs"" --port " & port
sh.CurrentDirectory = root
sh.Run serverCmd, 0, False

' ---- 4. 等服务就绪（最多 30 秒）----
Dim http
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
tries = 0
Do While tries < 60
  On Error Resume Next
  http.open "GET", url & "api/health", False
  http.send
  If Err.Number = 0 Then
    If http.Status = 200 Then Exit Do
  End If
  Err.Clear
  On Error GoTo 0
  WScript.Sleep 500
  tries = tries + 1
Loop

If tries >= 60 Then
  MsgBox "服务启动超时。" & vbCrLf & vbCrLf & _
         "可以手动在命令行里跑：" & vbCrLf & serverCmd, 48, "问心卦"
  WScript.Quit 1
End If

' ---- 5. 开独立窗口 ----
If browser = "" Then
  ' 没有 Edge/Chrome 就退回默认浏览器（会有地址栏，但功能一样）
  sh.Run url, 1, False
Else
  Dim profileDir, appCmd
  ' 独立 user-data-dir：让这个窗口有自己的任务栏图标与进程，不和日常浏览器混在一起
  profileDir = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\问心卦\窗口配置"
  appCmd = """" & browser & """ --app=" & url & _
           " --user-data-dir=""" & profileDir & """" & _
           " --window-size=1320,900 --no-first-run --no-default-browser-check"
  sh.Run appCmd, 1, True   ' True = 等窗口关闭
End If

' ---- 6. 窗口关了，停掉服务 ----
tries = 0
Do While tries < 20
  On Error Resume Next
  http.open "POST", url & "api/shutdown", False
  http.send
  If Err.Number = 0 Then Exit Do
  Err.Clear
  On Error GoTo 0
  WScript.Sleep 300
  tries = tries + 1
Loop
