# AGENTS.md — 给编码 agent 的项目说明

> 这份文件是给 **Codex CLI / Claude Code / DeepSeek Harness / Cursor** 之类编码 agent 看的。
> 人看的说明书是 [README.md](README.md)；格式规范是 [docs/规范.md](docs/规范.md)。
> 若你是 agent：**动手前先读完这一页，尤其是「硬规矩」那节。**

---

## 一、这是什么

「问心卦」是一个**单机、零依赖、长期使用**的梅花易数卦录程序。形态是本地服务 + 网页界面。

```
问心卦/
├─ core/          纯计算内核（不碰网络、不碰 DOM）
├─ server/        本地 HTTP 服务 + 存储（卦录与会话）+ 插件宿主
├─ web/           界面（原生 ES 模块，无构建步骤）
├─ desktop/       Electron 桌面外壳（窗口 / 托盘 / 菜单 / 打包）
├─ hermes/        信使层：统一模型接入 + 协议适配 + 规则路由 + 降级熔断
├─ agent/         AI Agent 循环、工具集、工具来源（含受控联网）、MCP 服务
├─ schema/        JSON Schema（对外契约）
├─ knowledge/     64 卦卦典与 384 爻辞
├─ tools/         命令行工具与自检
├─ data/          用户数据：卦录、配置、插件   ← 不要提交到公开仓库
└─ docs/          规范、设计文档（00–13、adr/）与截图
```

## 二、硬规矩（违反即视为改坏）

1. **零第三方依赖。** `package.json` 的 `dependencies` 必须永远是空的。只用 Node 内置模块与浏览器原生 API。十年后还要能跑起来，这是本项目的立项前提。想加功能就自己写三十行，不要引库。

2. **卦象只能由引擎算。** 任何地方都不许手写卦名、卦符、爻辞、体用生克、动爻、旺衰。必须经 `core/divination.mjs` 的 `cast()`（或 `buildChart()`）。LLM 会记错卦，引擎不会——这条同时是 `agent/loop.mjs` 的 system prompt 里最硬的一条。

3. **用户数据不可删改。** `data/records/*.json` 是用户几十年的东西。
   - 迁移必须**先备份到 `data/backups/pre-migration/`** 再落盘；
   - 删除只允许移入 `data/trash/`（`?hard=1` 才真删，且只应由用户主动触发）；
   - 断语引擎升级后，**旧卦录的 `reading` 快照保持不动**，只在新录入与「重算」时用新引擎。

4. **正文一律 UTF-8。**
   ⚠️ **不要用 PowerShell 的 `Get-Content -Raw` / `Set-Content` 往返改含中文的文件**——它按 ANSI 读、按 UTF-8 写，会把中文变成乱码（本项目开发中真踩过一次，`tools/seed.mjs` 整个被写坏）。要改文件用 edit/write 工具，或用 Node 的 `fs.readFileSync(p,'utf8')` + `writeFileSync`。

   ⚠️ **还有一次更阴的**：`npx asar extract-file <asar> <内部路径>` **会把文件写到「当前工作目录」**，用的是内部路径的 basename。当时为了研究 DSH 的界面，在 `desktop/` 目录下执行 `asar extract-file … "dsh/package.json"`，结果 **`desktop/package.json` 被 DSH 自己的清单覆盖**（成了 `@deepseek-ai/dsh-desktop-runtime`）。症状是「Electron 进程退出码 1 且没有任何输出」——因为 `main` 字段没了。**用 asar 抽文件前，先 `cd` 到一个临时目录。**

5. **一处实现，多处复用。** 起卦、断语、解析、走势各只有一份实现：
   - 解析器：`core/importer.mjs` + `core/guaTiao.mjs`，界面「导入」页、`tools/import.mjs`、agent 的 `save_gua_tiao` 全走它；
   - 工具集：`agent/tools.mjs`，HTTP `/api/agent/tool/*`、MCP 服务、AI 助手页全走它。
   不许为了某个入口另写一套。

## 三、怎么跑

```bash
node server/index.mjs --open        # 起服务（默认 127.0.0.1:19730）
node agent/mcp-server.mjs           # 起 MCP 服务（stdio，给外部 agent 用）
cd desktop && npm start             # 起桌面版（Electron）

node tools/check.mjs                # 内核自检（260 项，不需服务）
node tools/check-validate.mjs       # 校验器负向测试（10 项）
node tools/check-mcp.mjs            # MCP stdio 自检（14 项）
node tools/check-hermes.mjs         # Hermes 协议/路由/策略自检（63 项，全离线）
node tools/check-desktop.mjs        # 桌面版自检（55 项，真起 Electron 窗口）
node tools/check-web.mjs            # 前端联调自检（123 项，连不上服务时自起示例服务）
node tools/check-docs.mjs           # 文档与代码一致性（30 项）
node tools/validate.mjs             # 按 schema 校验全部卦录与会话
node tools/import.mjs --template    # 吐一份卦条模板
npm run check:all                   # 七套一起跑
```

**改完代码必须跑 `check.mjs`、`check-validate.mjs`、`check-mcp.mjs`、`check-hermes.mjs`、
`check-web.mjs`（连不上服务时会自己起一个示例服务）；动了 `desktop/` 还要跑 `check-desktop.mjs`；
改了任何会写进文档的事实还要跑 `check-docs.mjs`。全部要过。**
这些自检是回归网，不是装饰——它们在开发中真抓出过 bug。

### 文档必须跟着代码走（`check-docs.mjs` 守这条）

**改了会写进文档的事实，就同步改文档，然后跑 `check-docs.mjs`。**
它会当场报出「文档里写的项数与实测不符」这种漂移，并点名文件与行号。

它验五类东西：

1. **结构事实**——从源码数出：agent 工具数、REST 端点数、IPC handler 数与 preload 成员数、
   MCP 协议/方法/工具/资源/提示数、侧栏主项数、web 源文件数。
2. **各套自检项数**——四套快的现场跑；`check-web` / `check-desktop` 两套慢的读
   `docs/.counts.json`（清单由它们自己跑完写入，所以**要先把那两套跑过一遍**）。
3. **文档里写的数字** vs 上面的实测值。只认带括号的写法（形如 `` `脚本名.mjs`（<数字> 项）``）；
   裸的「N 项」不认——文档里有「12 项静态 + 21 项窗口」这类**子项数**，当真会误报。
   （这一条刻意不举例某个具体数字：举例即等于又写死一个会过期的事实。）
4. **容易过期的断言**：`.gitignore` 到底有没有、「帮助 → 打开启动日志」菜单加没加、
   `format_spec` 的必填是手写还是从 schema 现读、文档引用的源码文件是否存在。
   加一条这类断言很便宜，但**每加一条就少一类「文档悄悄骗人」**。
5. **文档自身健康**：围栏配平、无占位词、相对链接不失效、`docs/` 下无临时文件。

> 为什么要有这一套：这套文档是分头写的，写完**一小时内**就攒出 10 处过时
> （check-web 52→62→63、合计 193→270→301、`.gitignore` 从「没有」变「有」、
> 帮助菜单补了「打开启动日志」、`format_spec` 改成从 schema 现读）。
> **手改文档是守不住的**，只能让机器每次替你盯。

> `check-desktop.mjs` 会**用独立的 user-data-dir** 起 Electron。原因是 Electron 的单实例锁
> 是按 user-data-dir 记的：你桌面上如果正开着装好的问心卦，自检进程抢不到锁会**静默退出**
> （退出码 1、零输出）。隔离之后互不干扰，也不会污染你真实的窗口位置。

## 四、扩展点速查

| 想加什么 | 改哪里 | 注意 |
|---|---|---|
| 一个功能插件 | 新增 `data/plugins/<id>.mjs`，导出 `{id,name,version,activate(ctx)}` | 不用重启，`POST /api/plugins/reload` 热载；`ctx` 上有 route/page/panel/exporter/on |
| 一个新的走势领域 | `core/trend.mjs` 的 `DOMAINS` 加一项 | 量程必须是 `signed`(−100~100) 或 `percent`(0~100)，不要混 |
| 一个新的起卦法 | `core/divination.mjs` 的 `METHODS` + `cast()` 分支 | 同时更新 `docs/规范.md` 与 `core/guaTiao.mjs` 的 `METHOD_NAMES`。若是小六壬这类**另一种占法**（不是梅花的新起卦法），还要同时定义 `chart.kind` 与 `reading` 形态，并同步 `schema/record.schema.json` 里 `chart`／`reading` 的 `oneOf` 双分支；若该占法也要走卦条，还要同步 `core/guaTiao.mjs` 的卦条分支与**两套模板**、`schema/gua-tiao.schema.json` 的 `method` 枚举与 `claimed`（`palaces`／`final`），以及导入页的分栏文案 |
| 断语措辞 | `core/verdict.mjs` 顶部的词库常量 | 保底要保留「七段」的顺序：主·互·变·断·宜·忌·应期，`check.mjs` 会验 |
| 一种新导入格式 | `core/guaTiao.mjs` 加别名，或 `core/importer.mjs` 的 `parseMany` 加分支 | 认不准就报缺，**不许猜** |
| 卦录结构升级 | `core/migrate.mjs`：`CURRENT_SCHEMA` +1，`MIGRATIONS` 加函数 | 同时改 `schema/record.schema.json` 与 `docs/规范.md` 的版本历史 |
| 一个 agent 工具 | `agent/tools.mjs` 加一项（并在 `TOOL_PERMISSION` 登记权限） | 加完自动出现在 HTTP、MCP、助手页三处 |
| 一类**外来的**工具（联网、搜索、各家 SDK） | 新增一个「工具来源」：导出 `{id, name, tools()}`，由 `server/index.mjs` 传进 `createToolkit({ sources })` | 见 `agent/sources.mjs`。来源工具**必须自己声明 `permission`**；要用户点头就加 `requireConfirm: true` 与 `confirmKind`（联网用 `'network'`，与破坏性分开）。出网能力受 [ADR-0013](docs/adr/ADR-0013-受控联网工具.md) 约束：SSRF 守卫在内核、逐跳校验，`check.mjs` 第十三节守它 |
| 一个界面页 | `web/views.js` 加视图 + `web/app.js` 的 `NAV`（六个主项）**或 `OFF_NAV`**（走命令面板）`/VIEWS/parseHash` | 无构建步骤，原生 ES 模块。侧栏主项**恒为六项**，新入口默认放 `OFF_NAV` |

## 五、桌面版（Electron）

`desktop/` 是桌面外壳，对齐 DeepSeek Harness 的形态。**内核一行没改**，
只是多了一层壳：`main.mjs` 直接 `import` `server/index.mjs`，
在**同一个进程里**起服务——不 spawn 子进程、不弹控制台、不依赖用户装 Node。

```
desktop/
├─ main.mjs            主进程：起服务、建窗口、托盘、菜单、IPC、--selftest / --shot
├─ preload.cjs         预加载（必须是 CJS，见下）
├─ build/make-icon.py  图标生成（icon.ico / icon.png / tray.png）
├─ dist/               打包产物（win-unpacked 与 NSIS 安装包）
└─ package.json        electron + electron-builder 配置
```

### 四个必须知道的坑（都真踩过，别再踩）

1. **主进程不能写顶层 `await app.whenReady()`。** Electron 的 ready 事件要等主模块
   求值完成后才发出；在顶层 await 它，模块求值被挂起、ready 永不发出 —— **直接死锁**。
   现象是「进程在跑、没有窗口、日志停在某一行」。正确写法：
   `app.whenReady().then(main)`，模块本身同步求值完。
2. **preload 必须是 `.cjs` + `require`。** Electron 默认 `sandbox: true`，沙箱化的
   preload **不能是 ES 模块**；写成 `.mjs` + `import` 会**静默失败**，
   `window.__qxgDesktop` 永远是 undefined 却不报错。
3. **`ipcMain.handle` 必须在 `loadURL` 之前注册。** 页面一加载完就可能来调，
   注册晚了报 `No handler registered for 'qxg:info'`。
4. **环境里若带着 `ELECTRON_RUN_AS_NODE=1`，Electron 会退化成纯 Node、没有窗口。**
   本项目开发环境就有这个变量（DSH 设的）。启动前清掉：
   `Remove-Item Env:\ELECTRON_RUN_AS_NODE`（`tools/check-desktop.mjs` 已自动清）。

### 打包注意

Windows 上 `winCodeSign` 那个 7z 里有 macOS dylib 的**符号链接**，解压需要
开发者模式或管理员权限，否则构建直接失败。本项目在 `build.win` 里设了
`signAndEditExecutable: false` 绕开它——代价是 exe 文件本身不带我们的图标，
但**窗口图标、托盘、快捷方式图标都是对的**。要恢复 exe 内嵌图标，
先开启 Windows 开发者模式，再把这一项去掉。

`createDesktopShortcut` 必须写 `"always"` 而不是 `true`：`oneClick: false` 的安装器
会把它做成完成页的勾选项，**静默安装时就跳过不建**。

**打包输出目录会被锁住，这是常态，不是疑难杂症**：`desktop/dist/`（老输出）与
`desktop/dist-fresh/` 都出现过 `remove …\resources\app.asar: The process cannot access
the file because it is being used by another process` —— 现象是 electron-builder 卡在
`building target=nsis` 或直接 ERR_ELECTRON_BUILDER_CANNOT_EXECUTE，而此时**任务管理器里
找不到持有者、Restart Manager 也报 no process holds it**（是文件系统过滤驱动那一层，
杀软/索引器）。**别在这上面耗**：
- 换一个没用过的输出目录再打一次，例如
  `npm --prefix desktop run dist -- "-c.directories.output=dist-build"`；
- 打之前先确认没有开着的**安装向导**（它自己就占着 `问心卦-安装包-<版本>.exe`），
  也没有在跑的 `electron`／`app-builder` 进程。

Electron 二进制走镜像（GitHub 常连不上）：
```
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
```

**改桌面外壳后必须跑 `node tools/check-desktop.mjs`** —— 它会真起一个 Electron
进程，在真实窗口里断言桌面桥、各页路由、断语七段。

## 六、AI 与 MCP

- 模型接入：`agent/provider.mjs`，OpenAI 兼容，支持 DeepSeek / OpenAI / Ollama / 任意自建端点。
- 循环：`agent/loop.mjs`，`SYSTEM_PROMPT` 里有「卦象必须由工具算出」的硬约束。
- MCP：`agent/mcp-server.mjs`，JSON-RPC 2.0 over stdio。
  **stdout 只允许 JSON-RPC，任何日志必须走 stderr。** 违反了会让 Codex/Claude 直接解析失败。
- 工具定义只有一份（`agent/tools.mjs`），三处复用。

接入 Codex：

```toml
# ~/.codex/config.toml
[mcp_servers.wenxingua]
command = "node"
args = ["<项目绝对路径>/agent/mcp-server.mjs"]
```

## 七、代码风格

- 注释与界面文案用中文；标识符用英文。
- 注释解释**为什么**，不复述代码在做什么。
- 断语、卦条、报错等面向用户的文字要有分寸：不用「能量」「磁场」这类含糊词，不用绝对断言。
- 函数保持纯逻辑的尽量纯（`core/` 里不要出现 `Date.now()` 之外的隐式状态），便于自检断言。

## 八、提交前自检清单

- [ ] `node tools/check.mjs` 全过
- [ ] `node tools/check-validate.mjs` 全过（校验器必须抓得出错）
- [ ] `node tools/check-mcp.mjs` 全过（stdout 必须是纯 JSON-RPC）
- [ ] `node tools/check-hermes.mjs` 全过（动了 `hermes/` 或协议适配时必跑）
- [ ] `node tools/check-web.mjs` 全过（连不上服务时会自己起一个示例服务）
- [ ] `node tools/check-desktop.mjs` 全过（动了 desktop/ 就必须跑）
- [ ] **`node tools/check-docs.mjs` 全过**（改了任何会写进文档的事实，就必须同步文档）
- [ ] `node tools/validate.mjs` 全过
- [ ] 新增/改动的模块 `node --check` 无语法错
- [ ] `dependencies` 仍是空的（`desktop/` 的 electron 是 **devDependencies**，不算破例）
- [ ] 没有手写卦象（搜一下有没有裸的 `䷀`、`乾为天` 出现在计算路径里）
- [ ] 改了几个入口共用的东西（解析器、工具集、走势领域）时，四处入口都验过
- [ ] 若动了 `data/` 下的东西：确认只是测试残留，且已清理
- [ ] 若改了 `schema/*.json`：同步改 `docs/规范.md` 的字段字典与版本历史
