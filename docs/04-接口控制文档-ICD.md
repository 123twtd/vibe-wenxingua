# 问心卦 · 接口控制文档（ICD）
| 项 | 内容 |
|---|---|
| 文档编号 | 04 |
| 标题 | 问心卦 · 接口控制文档（ICD） |
| 版本 | 1.0 |
| 状态 | 已发布 |
| 适用产品版本 | v1.4.1 |
| 最后更新 | 2026-10-07 |
| 读者 | 接口责任人、插件作者、外部 agent 集成者、变更评审人、维护者 |
| 关联文档 | [00-文档索引.md](00-文档索引.md)、[01-系统设计说明书.md](01-系统设计说明书.md)、[02-架构与框图.md](02-架构与框图.md)、[03-接口文档.md](03-接口文档.md)、[05-Agent设计文档.md](05-Agent设计文档.md)、[06-Hermes网关与路由设计.md](06-Hermes网关与路由设计.md)、[07-数据模型与存储设计.md](07-数据模型与存储设计.md)、[11-安全与隐私设计.md](11-安全与隐私设计.md)、[12-插件与扩展开发指南.md](12-插件与扩展开发指南.md)、[规范.md](规范.md) |
本文是**控制性文档**：管的是「接口的契约怎么定、谁能改、改了要同步什么、破坏契约的后果」。字段级细节见 [03-接口文档.md](03-接口文档.md)。规范强度用 RFC2119 中文：**必须**／**应当**／**可以**／**不得**。

---

## 一、适用范围与控制级别

### 1.1 受管辖的接口
| 类别 | 标识前缀 | 数量 | 受控 |
|---|---|---|---|
| 本地 HTTP 服务（REST） | `IF-REST-*` | 37 | **是** |
| 插件派生 REST 接口 | `IF-PLUG-*` | 5（只控机制，不控单个插件实现） | **是** |
| Electron 桌面桥（IPC） | `IF-IPC-*` | 7 | **是** |
| MCP stdio 服务 | `IF-MCP-*` | 9 | **是** |
| 文件系统契约 | `IF-FS-*` | 9 | **是** |
| 进程内插件事件钩子 | `IF-EVT-*` | 6 | **是** |
| 内核模块导出函数 | — | — | 否（内部实现） |
| 界面 DOM 的 `id`/`class` | — | — | 否（仅测试选择器，不作对外承诺） |
**受控接口合计 73 个**（37＋5＋7＋9＋9＋6）。

### 1.2 控制级别
| 级别 | 含义 | 适用 |
|---|---|---|
| **冻结** | 路径、字段名、枚举取值、语义**不得**变更；只能新增可选字段 | 全部 `IF-REST-*`、`IF-FS-*`、`IF-MCP-*`、卦录 schema v1 |
| **受控** | 可以新增；删改**必须**走变更流程并升版本 | `IF-PLUG-*`、`IF-EVT-*`、`IF-IPC-*` |

### 1.3 变更控制流程
对受控接口的**删除、重命名、语义改变、枚举收窄**必须走以下流程：

1. **提案**：提交说明中写明「接口 ID ＋ 变更类型 ＋ 兼容性影响 ＋ 受影响消费方」。
2. **同步改动清单**（缺一不可）：

| 变更内容 | 必须同步改 |
|---|---|
| REST 路径/字段/枚举 | `server/index.mjs`、[03-接口文档.md](03-接口文档.md)、本 ICD 对应条目 |
| 卦录字段 | `schema/record.schema.json`、`core/record.mjs` 的 `normalizeRecord`、`core/migrate.mjs` 的 `CURRENT_SCHEMA` 与 `MIGRATIONS`、[规范.md](规范.md)、本 ICD 第 5 节 |
| 卦条字段/别名 | `core/guaTiao.mjs`、`schema/gua-tiao.schema.json`、[规范.md](规范.md)、本 ICD 第 5 节 |
| agent 工具 | `agent/tools.mjs`（一处改，HTTP/MCP/助手页三处生效）、[03-接口文档.md](03-接口文档.md) 附录 A、[05-Agent设计文档.md](05-Agent设计文档.md) |
| MCP 方法 | `agent/mcp-server.mjs`、[03-接口文档.md](03-接口文档.md) 第六节、本 ICD 第 4 节 |
| IPC 通道 | `desktop/main.mjs` 的 `registerIpc`、`desktop/preload.cjs`、[03-接口文档.md](03-接口文档.md) 第五节、本 ICD 第 4 节 |
| 文件目录约定 | `server/store.mjs`、[07-数据模型与存储设计.md](07-数据模型与存储设计.md)、本 ICD 第 7 节 |
3. **自检**：**必须**通过 `check.mjs`、`check-validate.mjs`、`check-mcp.mjs`、`check-hermes.mjs`、`check-web.mjs`；动了 `desktop/` 还**必须**通过 `check-desktop.mjs`。
4. **升版本**：破坏向后兼容的变更**必须**升产品次版本号，并在 [规范.md](规范.md) 的版本历史中记一笔。

### 1.4 硬性禁令
- **不得**删除或改名 `data/records/*.json` 中任何已有字段；只**可以**新增字段并升 `schema` 号**不得**删除或改名卦条 v1 的任何已有键名与别名；只**可以**新增别名；**不得**让 `GET`/`POST /api/agent/config` 回显 `apiKey` 原文；**不得**在任何导出接口中默认包含 `apiKey`（整包备份是既有例外，见 `IF-REST-036`）；**不得**让 MCP 服务的任何非 JSON-RPC 内容进入 stdout；**不得**让 `DELETE /api/records/:id` 在未显式传 `hard=1` 时真删文件；**不得**在迁移落盘之前跳过 `data/backups/pre-migration/` 备份；**不得**允许插件注册 `/api/` 之外的路径，或允许 `/plugin-assets/` 逃出 `data/plugins/<id>/`

---

## 二、接口标识规则
格式 `IF-<域>-<三位序号>`。域取 `REST`／`PLUG`／`IPC`／`MCP`／`FS`／`EVT`；序号从 `001` 起、十进制、零填充，**一经分配永不回收**，删除接口时保留号位并标注「已废止」。

| 规则 | 内容 |
|---|---|
| 分配顺序 | 按**首次发布顺序**，不按字母序，不重排 |
| 方法区分 | 同一路径的不同方法各自独立编号（`GET /api/records` 与 `POST /api/records` 是两个接口） |
| 参数化端点 | 路径参数化的端点整体算**一个**接口（`GET /api/records/:id`），不按取值拆号 |
| 插件接口 | 派生接口**不逐个编号**，只对**机制**编号（`IF-PLUG-001`…`005`） |
| 文件接口 | 按**目录或文件**编号，不按操作编号 |
| 域 | 号段规划 |
|---|---|
| `REST` | 001–099 内置端点；100–199 预留 |
| `PLUG` | 001–019 机制；020–099 预留 |
| `IPC` / `MCP` / `FS` / `EVT` | 001–019 |
---

## 三、接口总表

### 3.1 REST（50）
「超时」为「无内置」表示服务端不设超时，由消费方自行决定；服务端唯一主动设限的是 `readBody` 的 32 MiB 上限。

| ID | 名称 | 提供方 | 消费方 | 方向 | 协议 | 触发条件 | 幂等 | 超时 | 版本 |
|---|---|---|---|---|---|---|---|---|---|
| IF-REST-001 | 健康检查 `GET /api/health` | 本地服务 | 界面、脚本、外部程序 | ← | HTTP/1.1 | 需要探活 | 是 | 无内置 | v1.1.0 |
| IF-REST-002 | 元信息 `GET /api/meta` | 本地服务 | 界面 | ← | HTTP/1.1 | 界面启动 | 是 | 无内置 | v1.1.0 |
| IF-REST-003 | 卦录列表 `GET /api/records` | 本地服务 | 界面、脚本 | ← | HTTP/1.1 | 打开「卦录」页或筛选 | 是 | 无内置 | v1.1.0 |
| IF-REST-004 | 新增卦录 `POST /api/records` | 本地服务 | 界面、脚本 | ← | HTTP/1.1 | 用户点「录下此卦」 | 否 | 无内置 | v1.1.0 |
| IF-REST-005 | 卦录详情 `GET /api/records/:id` | 本地服务 | 界面、脚本 | ← | HTTP/1.1 | 打开某条卦录 | 是 | 无内置 | v1.1.0 |
| IF-REST-006 | 改卦录 `PATCH /api/records/:id` | 本地服务 | 界面、脚本 | ← | HTTP/1.1 | 用户改元信息 | 是（`updatedAt` 除外） | 无内置 | v1.1.0 |
| IF-REST-007 | 删卦录 `DELETE /api/records/:id` | 本地服务 | 界面、脚本 | ← | HTTP/1.1 | 用户点删除 | 否 | 无内置 | v1.1.0 |
| IF-REST-008 | 重算断语 `POST /api/records/:id/recompute` | 本地服务 | 界面、脚本 | ← | HTTP/1.1 | 用户点「重算断语」 | 否 | 无内置 | v1.1.0 |
| IF-REST-009 | 单条导出 `GET /api/records/:id/export` | 本地服务 | 界面、外部程序 | ← | HTTP/1.1 | 用户点导出 | 是 | 无内置 | v1.1.0 |
| IF-REST-010 | 全录导出/备份 `GET /api/export` | 本地服务 | 界面、桌面主进程 | ← | HTTP/1.1 | 用户点整包备份 | 是 | 无内置 | v1.1.0 |
| IF-REST-011 | 试起卦 `POST /api/cast` | 本地服务 | 界面、脚本 | ← | HTTP/1.1 | 起卦台改参数 | 是 | 无内置 | v1.1.0 |
| IF-REST-012 | 解析导入文本 `POST /api/import/parse` | 本地服务 | 界面、脚本 | ← | HTTP/1.1 | 用户点「解析」 | 是 | 无内置 | v1.1.0 |
| IF-REST-013 | 批量入库 `POST /api/import/commit` | 本地服务 | 界面、脚本 | ← | HTTP/1.1 | 用户点「入库」 | 否 | 无内置 | v1.1.0 |
| IF-REST-014 | 卦典全表 `GET /api/knowledge/hexagrams` | 本地服务 | 界面 | ← | HTTP/1.1 | 打开「卦典」页 | 是 | 无内置 | v1.1.0 |
| IF-REST-015 | 单卦详情 `GET /api/knowledge/hexagrams/:id` | 本地服务 | 界面 | ← | HTTP/1.1 | 点开某一卦 | 是 | 无内置 | v1.1.0 |
| IF-REST-016 | 统计 `GET /api/stats` | 本地服务 | 界面、脚本 | ← | HTTP/1.1 | 打开「总览」页 | 是 | 无内置 | v1.1.0 |
| IF-REST-017 | 走势 `GET /api/trend` | 本地服务 | 界面、脚本、agent | ← | HTTP/1.1 | 打开「走势」页或调 tool | 是 | 无内置 | v1.1.0 |
| IF-REST-018 | 格式规范 `GET /api/spec` | 本地服务 | 界面 | ← | HTTP/1.1 | 打开「导入与格式」页（模板／字段字典／版本迁移区块） | 是 | 无内置 | v1.1.0 |
| IF-REST-019 | 取 schema `GET /api/schema/:name` | 本地服务 | 界面、外部程序 | ← | HTTP/1.1 | 需要契约原文 | 是 | 无内置 | v1.1.0 |
| IF-REST-020 | 校验 `POST /api/validate` | 本地服务 | 界面、脚本、agent | ← | HTTP/1.1 | 用户点「校验」 | 是 | 无内置 | v1.1.0 |
| IF-REST-021 | 卦条模板 `GET /api/guatiao/template` | 本地服务 | 界面、脚本 | ← | HTTP/1.1 | 用户点「取模板」 | 无副作用（内容含时间戳） | 无内置 | v1.1.0 |
| IF-REST-022 | 卦条解析 `POST /api/guatiao/parse` | 本地服务 | 界面、脚本、agent | ← | HTTP/1.1 | 用户粘卦条 | 是 | 无内置 | v1.1.0 |
| IF-REST-023 | 读助手配置 `GET /api/agent/config` | 本地服务 | 界面 | ← | HTTP/1.1 | 打开「助手」页 | 是 | 无内置 | v1.1.0 |
| IF-REST-024 | 写助手配置 `POST /api/agent/config` | 本地服务 | 界面 | ← | HTTP/1.1 | 用户点保存 | 是 | 无内置 | v1.1.0 |
| IF-REST-025 | 工具清单 `GET /api/agent/tools` | 本地服务 | 界面、脚本 | ← | HTTP/1.1 | 打开「助手」页 | 是 | 无内置 | v1.1.0 |
| IF-REST-026 | 直接执行工具 `POST /api/agent/tool/:name` | 本地服务 | 脚本、调试 | ← | HTTP/1.1 | 脚本显式调用 | 视工具 | 无内置 | v1.1.0 |
| IF-REST-027 | 模型连通自检 `POST /api/agent/ping` | 本地服务 | 界面 | ← | HTTP/1.1 | 用户点「测连通」 | 否 | 上游 120 s | v1.1.0 |
| IF-REST-028 | 模型列表 `GET /api/agent/models` | 本地服务 | 界面 | ← | HTTP/1.1 | 用户点「拉模型列表」 | 是 | 上游 120 s | v1.1.0 |
| IF-REST-029 | 助手对话 `POST /api/agent/chat` | 本地服务 | 界面 | ← | HTTP/1.1 | 用户发消息 | 否 | 上游 120 s × 轮数 | v1.1.0 |
| IF-REST-030 | MCP 接入信息 `GET /api/agent/mcp` | 本地服务 | 界面 | ← | HTTP/1.1 | 打开「助手」页底部 | 是 | 无内置 | v1.1.0 |
| IF-REST-031 | 插件清单 `GET /api/plugins` | 本地服务 | 界面 | ← | HTTP/1.1 | 打开「插件」页 | 是 | 无内置 | v1.1.0 |
| IF-REST-032 | 热载插件 `POST /api/plugins/reload` | 本地服务 | 界面、脚本 | ← | HTTP/1.1 | 用户点「热载全部插件」 | 是 | 无内置 | v1.1.0 |
| IF-REST-033 | 启停插件 `POST /api/plugins/:id/toggle` | 本地服务 | 界面 | ← | HTTP/1.1 | 用户切开关 | 是 | 无内置 | v1.1.0 |
| IF-REST-034 | 插件页面 `GET /api/plugins/:pid/page/:pageId` | 本地服务 | 界面 | ← | HTTP/1.1 | 用户点插件页 | 视插件 | 无内置 | v1.1.0 |
| IF-REST-035 | 插件面板 `GET /api/plugins/:pid/panel/:panelId` | 本地服务 | 界面 | ← | HTTP/1.1 | 打开卦录详情 | 视插件 | 无内置 | v1.1.0 |
| IF-REST-036 | 恢复备份 `POST /api/restore` | 本地服务 | 界面、脚本 | ← | HTTP/1.1 | 用户点「恢复备份」 | 是 | 无内置 | v1.1.0 |
| IF-REST-037 | 停止服务 `POST /api/shutdown` | 本地服务 | 界面、脚本 | ← | HTTP/1.1 | 用户点停止 | 否 | 200 ms 后退出 | v1.1.0 |
| IF-REST-038 | 厂商余额 `GET /api/agent/balance` | 本地服务 🡒 厂商余额接口 | 界面 | ← | HTTP/1.1 | 打开助手面板／点击余额 chip／每 5 分钟自动刷新 | 是 | 上游 8 s | v1.1.0 |
| IF-REST-039 | 会话列表 `GET /api/chats` | 本地服务 | 界面 | ← | HTTP/1.1 | 打开助手面板／一轮结束后刷下拉 | 是 | 无内置 | v1.1.0 |
| IF-REST-040 | 新建会话 `POST /api/chats` | 本地服务 | 界面 | ← | HTTP/1.1 | 用户点面板头上的「＋」 | 否 | 无内置 | v1.1.0 |
| IF-REST-041 | 会话详情 `GET /api/chats/:id` | 本地服务 | 界面 | ← | HTTP/1.1 | 切换会话 | 是 | 无内置 | v1.1.0 |
| IF-REST-042 | 改会话标题 `PATCH /api/chats/:id` | 本地服务 | 界面 | ← | HTTP/1.1 | 用户点「✎」 | 是 | 无内置 | v1.1.0 |
| IF-REST-043 | 追加一轮 `POST /api/chats/:id/append` | 本地服务 | 界面 | ← | HTTP/1.1 | 一轮跑完／用户点了「确认执行」 | 否 | 无内置 | v1.1.0 |
| IF-REST-044 | 删会话 `DELETE /api/chats/:id` | 本地服务 | 界面 | ← | HTTP/1.1 | 用户点「✕」（默认软删） | 否 | 无内置 | v1.1.0 |
| IF-REST-045 | 上传会话附件 `POST /api/chats/:id/files` | 本地服务 | 界面 | ← | HTTP/1.1 | 用户点「📎」选文件 | 否 | 无内置 | v1.1.0 |
| IF-REST-046 | 取回会话附件 `GET /api/chats/:id/files/:name` | 本地服务 | 界面 | ← | HTTP/1.1 | 发送时内联文本类附件 | 是 | 无内置 | v1.1.0 |
| IF-REST-047 | 随包文档清单 `GET /api/help` | 本地服务 | 界面 | ← | HTTP/1.1 | 打开「文档」页 | 是 | 无内置 | v1.1.0 |
| IF-REST-048 | 读随包文档 `GET /api/help/:id` | 本地服务 | 界面、桌面主进程 | ← | HTTP/1.1 | 点开某一篇（桌面菜单「帮助」也走它） | 是 | 无内置 | v1.1.0 |
| IF-REST-049 | 更新检测 `GET /api/update-check` | 本地服务 🡒 GitHub 发行版接口 | 界面 | ← | HTTP/1.1 | 界面启动后约 1.5 秒（设置里可关） | 是 | 上游 **4 s** | v1.3.0 |
| IF-REST-050 | 写顶层配置 `POST /api/config` | 本地服务 | 界面 | ← | HTTP/1.1 | 关闭更新说明卡／切换更新检测 | 是 | 无内置 | v1.3.0 |

### 3.2 插件机制（5）
| ID | 名称 | 提供方 | 消费方 | 方向 | 协议 | 触发条件 | 幂等 | 超时 | 版本 |
|---|---|---|---|---|---|---|---|---|---|
| IF-PLUG-001 | 插件路由注册 `ctx.registerRoute` | 插件宿主 | 插件 | — | 进程内 | 插件 `activate()` 执行 | — | — | v1.1.0 |
| IF-PLUG-002 | 插件页面注册 `ctx.registerPage` | 插件宿主 | 插件 | — | 进程内 | 同上 | — | — | v1.1.0 |
| IF-PLUG-003 | 插件面板注册 `ctx.registerPanel` | 插件宿主 | 插件 | — | 进程内 | 同上 | — | — | v1.1.0 |
| IF-PLUG-004 | 插件导出器注册 `ctx.registerExporter` | 插件宿主 | 插件 | — | 进程内 | 同上 | — | — | v1.1.0 |
| IF-PLUG-005 | 插件静态资源 `GET /plugin-assets/<pid>/<rest>` | 插件宿主 | 界面、浏览器 | ← | HTTP/1.1 | 插件页引用资源 | 是 | 无内置 | v1.1.0 |

### 3.3 Electron IPC（7）
| ID | 通道名 | 提供方 | 消费方 | 方向 | 协议 | 触发条件 | 幂等 | 超时 | 版本 |
|---|---|---|---|---|---|---|---|---|---|
| IF-IPC-001 | `qxg:info` | 主进程 | 渲染进程 | ← | Electron IPC invoke | 界面启动 | 是 | 无 | v1.1.0 |
| IF-IPC-002 | `qxg:open-data-dir` | 主进程 | 渲染进程 | ← | invoke | 用户点「打开数据目录」 | 是 | 无 | v1.1.0 |
| IF-IPC-003 | `qxg:open-backups` | 主进程 | 渲染进程 | ← | invoke | 用户点「打开备份目录」 | 是（目录不存在则创建） | 无 | v1.1.0 |
| IF-IPC-004 | `qxg:export-backup` | 主进程 | 渲染进程 | ← | invoke | 用户点「导出整包备份」 | 否（每次弹保存框） | 无 | v1.1.0 |
| IF-IPC-005 | `qxg:reveal-record-file` | 主进程 | 渲染进程 | ← | invoke | 用户点「定位文件」 | 是 | 无 | v1.1.0 |
| IF-IPC-006 | `qxg:choose-data-dir` | 主进程 | 渲染进程 | ← | invoke | 用户点「更换数据目录」 | 否（改偏好，可能重启） | 无 | v1.1.0 |
| IF-IPC-007 | `qxg:navigate` | 主进程 | 渲染进程 | → | Electron IPC send/on | 菜单或托盘点击 | — | 无 | v1.1.0 |

### 3.4 MCP（9）
| ID | 方法名 | 提供方 | 消费方 | 方向 | 协议 | 触发条件 | 幂等 | 超时 | 版本 |
|---|---|---|---|---|---|---|---|---|---|
| IF-MCP-001 | `initialize` | MCP 服务 | 外部 agent 宿主 | ← | JSON-RPC 2.0 / stdio | 会话建立 | 是 | 无 | 2024-11-05 |
| IF-MCP-002 | `notifications/initialized` | MCP 服务 | 外部 agent 宿主 | ← | JSON-RPC 通知 | 会话建立后 | 是 | 无 | 2024-11-05 |
| IF-MCP-003 | `ping` | MCP 服务 | 外部 agent 宿主 | ← | JSON-RPC 2.0 | 保活 | 是 | 无 | 2024-11-05 |
| IF-MCP-004 | `tools/list` | MCP 服务 | 外部 agent | ← | JSON-RPC 2.0 | 工具发现 | 是 | 无 | 2024-11-05 |
| IF-MCP-005 | `tools/call` | MCP 服务 | 外部 agent | ← | JSON-RPC 2.0 | 执行工具 | 视工具 | 无 | 2024-11-05 |
| IF-MCP-006 | `resources/list` | MCP 服务 | 外部 agent | ← | JSON-RPC 2.0 | 资源发现 | 是 | 无 | 2024-11-05 |
| IF-MCP-007 | `resources/read` | MCP 服务 | 外部 agent | ← | JSON-RPC 2.0 | 读资源 | 是 | 无 | 2024-11-05 |
| IF-MCP-008 | `prompts/list` | MCP 服务 | 外部 agent | ← | JSON-RPC 2.0 | 提示发现 | 是 | 无 | 2024-11-05 |
| IF-MCP-009 | `prompts/get` | MCP 服务 | 外部 agent | ← | JSON-RPC 2.0 | 取提示 | 是 | 无 | 2024-11-05 |

### 3.5 文件系统（9）
| ID | 路径 | 提供方 | 消费方 | 方向 | 协议 | 触发条件 | 幂等 | 超时 | 版本 |
|---|---|---|---|---|---|---|---|---|---|
| IF-FS-001 | `data/records/<id>.json` | 存储层 | 存储层、外部工具、用户 | 双向 | JSON 文件 | 任一写入型端点 | 视调用方 | 无 | v1 |
| IF-FS-002 | `data/trash/<id>-<ts>.json` | 存储层 | 用户、外部工具 | ← | JSON 文件 | 软删除 | 否（时间戳不同） | 无 | v1 |
| IF-FS-003 | `data/backups/pre-migration/<id>-v<旧版本>-<ts>.json` | 存储层 | 用户、迁移回退 | ← | JSON 文件 | 版本迁移前 | 否（时间戳不同） | 无 | v1 |
| IF-FS-004 | `data/backups/` | 存储层、桌面主进程 | 用户 | 双向 | 目录 | 用户导出备份 | — | 无 | v1 |
| IF-FS-005 | `data/config.json` | 存储层 | 存储层、用户 | 双向 | JSON 文件 | 配置变更 | 是 | 无 | v1 |
| IF-FS-006 | `data/plugins/<id>.mjs` | 插件宿主 | 插件作者 | ← | ES 模块 | `loadAll()` | — | 无 | v1 |
| IF-FS-007 | `data/plugins/<id>/` | 插件宿主 | 插件静态资源 | ← | 目录 | `/plugin-assets/` | — | 无 | v1 |
| IF-FS-008 | `knowledge/64gua.json`、`knowledge/yaoci.json` | 卦典库 | 内核 | ← | JSON 文件 | 进程启动 | — | 无 | v1 |
| IF-FS-009 | `schema/*.schema.json` | 契约目录 | 服务、校验器、外部程序 | ← | JSON Schema | 进程启动或按需读 | — | 无 | v1 |

### 3.6 插件事件（6）
| ID | 事件名 | 提供方 | 消费方 | 方向 | 协议 | 触发条件 | 幂等 | 超时 | 版本 |
|---|---|---|---|---|---|---|---|---|---|
| IF-EVT-001 | `app.start` | 插件宿主 | 插件 | → | 进程内同步回调 | 每次插件加载完成 | — | 无（不阻塞） | v1.1.0 |
| IF-EVT-002 | `record.created` | 插件宿主 | 插件 | → | 同上 | `IF-REST-004`、`IF-REST-013` | — | 无 | v1.1.0 |
| IF-EVT-003 | `record.updated` | 插件宿主 | 插件 | → | 同上 | `IF-REST-006`、`IF-REST-008` | — | 无 | v1.1.0 |
| IF-EVT-004 | `record.deleted` | 插件宿主 | 插件 | → | 同上 | `IF-REST-007` | — | 无 | v1.1.0 |
| IF-EVT-005 | `cast.preview` | 插件宿主 | 插件 | → | 同上 | `IF-REST-011` | — | 无 | v1.1.0 |
| IF-EVT-006 | `agent.reply` | 插件宿主 | 插件 | → | 同上 | `IF-REST-029` | — | 无 | v1.1.0 |
---

## 四、逐接口 ICD 条目

### 4.0 通用条款（适用于全部 `IF-REST-*` 与 `IF-PLUG-005`）
| 栏 | 内容 |
|---|---|
| **前置条件** | 服务已 `listen()`；`data/` 的 `records`/`trash`/`backups` 三个子目录已确保存在；`config.json` 已确保存在 |
| **数据格式** | 请求体 UTF-8 JSON（除注明外）；响应按各自声明的 Content-Type |
| **正常流** | 设 CORS 头 → `maybeRescan()` → 插件路由 → 插件静态 → 内置路由 → 处理器 → `json()`/`send()` 结束 |
| **异常流** | 处理器抛错 → 主 `try/catch` → `console.error` 记完整栈 → 响应未结束则 `fail(res, err, 500)`；已结束则不重复写 |
| **时序约束** | 无跨请求时序要求；单请求内严格串行 |
| **重试策略** | 幂等接口可无限制重试；非幂等接口（004/007/008/013/037）**不得**自动重试，须由用户重新发起 |
| **幂等性说明** | 见总表；`GET` 全部幂等（`IF-REST-021` 例外：内容含当前时间戳，但无副作用） |
| **返回码** | `200` 成功、`204` 预检、`400` 参数/业务错误、`403` 静态越界、`404` 不存在、`500` 未捕获异常 |
| **兼容性说明** | 响应**只可以**新增字段，**不得**删除或改名；`ok` 恒为首字段且恒存在 |

### 4.1 健康与元信息
| 条目 | 内容 |
|---|---|
| **IF-REST-001 健康检查** | 双方：本地服务 → 界面/脚本。入参：无。响应 `{ok,app,version,at}`。正常流：路由直出，不触碰磁盘。异常流：无——`package.json` 不可读时 `version` 为 `0.0.0`，仍返回 `200`。时序：可在 `listen()` 回调前被排队，但不保证成功，消费方**应当**先确认端口已监听。幂等：完全幂等，可用作心跳。兼容性：**不得**改变 `ok`/`app`/`version` 三键；`at` 的格式冻结为 ISO 8601 UTC。 |
| **IF-REST-002 元信息** | 双方：本地服务 → 界面。前置条件：插件已 `loadAll()` 完成（服务启动时同步 await），否则 `plugins` 为空表。正常流：读卦典 `stats()`、读配置、读插件 api、读存储 stats，一次性组装。异常流：任一子读取失败（如卦典文件缺失）不抛错，对应字段降级为空表或默认值。时序：**必须**在插件加载完成后调用才有完整插件清单。幂等：幂等。兼容性：`config.agent` 被显式剔除的约定冻结；新增枚举时**应当**同时出现在 `methods`/`categories`/`reviewStatuses`/`domains` 中。 |

### 4.2 卦录增删改查
| 条目 | 内容 |
|---|---|
| **IF-REST-003 卦录列表** | 双方：本地服务 → 界面/脚本。数据格式：查询参数 `q`/`category`/`grade`/`review`/`method`/`school`；响应 `{ok,total,items[]}`，`items[]` 元素为 `summarize()` 的十四个键。正常流：`store.list()`（已按 `cast.localTime` 倒序）→ 五路精确筛选（`category`/`grade`/`review`/`method` 精确比 `cast.method`；`school` 取 `meihua`/`xlr`，按 `chart.kind` 分梅花的正反）→ 关键词全字段匹配 → 逐条 `summarize()`。异常流：无参数错误路径；无结果时 `total:0`、`items:[]`。时序：`store.maybeRescan()` 在**本请求受理时**执行，故外部工具刚写入的文件在下一次请求即可见。重试：可自由重试。幂等：纯读，幂等。兼容性：`items[].origins`（值取 `origin.kind`）**不得**改名，历史消费方已依赖。 |
| **IF-REST-004 新增卦录** | 双方：界面/脚本 → 本地服务。前置条件：`localTime` 可被 `calendarInfo` 解析；`manual` 时 `hexagram` 可在卦典中解析且 `movingPosition` 在 1–6。正常流：`readBody` → `newRecordFromBody`（分流 `cast`/`hexagram`）→ `buildRecord`/`buildFromHexagram` → `interpret` → `audit` → `store.save` → 触发事件。异常流：引擎抛错 → `400 {ok:false,error}`；文件系统失败 → `400`；**不得**产生半写文件（`save()` 先写 `.tmp` 再 `rename`）。时序：**必须**先于任何引用该 id 的读写；id 由 `makeId()` 依 `localTime` 生成，同分钟序号由 `store.ids()` 与进程内 `seqCache` 共同保证唯一。重试：**不得**自动重试——会生成新 id 并产生重复卦录；消费方若需「只录一次」，**应当**在失败后先 `IF-REST-003` 确认。幂等：非幂等。返回码：`200`、`400`。兼容性：`record` 字段集受 `schema/record.schema.json` 约束；新增字段**必须**同步升 `schema` 号。 |
| **IF-REST-005 卦录详情** | 前置条件：id 存在。数据格式：响应 `{ok,record,panels[]}`。正常流：取记录 → 逐个插件面板 `render`。异常流：id 不存在 → `404 未找到该卦录`；单个面板渲染抛错被**就地捕获**并降级为含错误文案的 `html`，不影响整体 `200`。时序：面板渲染同步执行，慢插件会拉长响应时间，插件作者**应当**避免阻塞 IO。幂等：幂等（面板若自身有副作用则属插件责任）。兼容性：`panels[]` 元素允许携带插件自定义键（宿主会把渲染结果展开到顶层）。 |
| **IF-REST-006 改卦录** | 前置条件：id 存在。数据格式：白名单 8 键；响应 `{ok,record}`。正常流：读原记录 → 覆盖白名单字段 → `updatedAt` 置当前 → `normalizeRecord` → `store.save` → 触发事件。异常流：`404`；非白名单键被**静默忽略**（不报错，这是既有契约）。时序：`updatedAt` **必须**晚于或等于 `createdAt`。重试：幂等，可重试，但每次重试都会刷新 `updatedAt`。幂等：数据结果幂等，时间戳不幂等。兼容性：白名单**只可以**扩充，**不得**收窄；已发布的 8 个键永久有效。 |
| **IF-REST-007 删卦录** | 前置条件：id 存在。数据格式：查询参数 `hard`；响应 `{ok}`。正常流：软删 → 写入 `data/trash/` → 删除正式文件 → 从缓存移除 → 触发事件。异常流：`404`；写垃圾桶失败时抛出异常 → `400`。时序：垃圾桶写入**必须**先于正式文件删除。重试：**不得**自动重试（第二次必然 `404`）。幂等：非幂等。返回码：`200`、`400`、`404`。兼容性：`hard=1` 的语义冻结；**不得**把默认行为改为硬删。 |
| **IF-REST-008 重算断语** | 前置条件：id 存在；`record.cast` 完整到可被 `cast()` 接受。正常流：读记录 → `core.record.recompute` → 保留原 `id`/`createdAt` → `store.save` → 触发事件。异常流：`404`；`cast` 不完整 → `400`（错误来自引擎）。时序：**必须**由用户显式触发；**不得**在加载或迁移时自动执行。重试：可重试，但每次使 `revisionCount` ＋1。幂等：非幂等（`revisionCount` 与 `updatedAt` 变化）；`chart`/`reading` 内容对同一引擎幂等。兼容性：这是**唯一**允许改写既有 `reading` 快照的接口；`createdAt` 与 `id` 的保护不可移除。 |

### 4.3 起卦与推演
| 条目 | 内容 |
|---|---|
| **IF-REST-011 试起卦** | 双方：界面/脚本 → 本地服务。前置条件：`localTime` 存在；`manual` 时 `hexagram` 与 `movingPosition` 有效。正常流：`cast()` 组装卦局 → `interpret()` 出断语 → 触发 `cast.preview`。异常流：`400`，文案为 `起卦需要时间（精确到分钟）。`、`无法识别卦名：<输入>`、`动爻须为 1-6（自下而上第六爻写作 6）。`。时序：无；纯计算，不写盘。重试：可自由重试。幂等：**完全幂等**——同一输入的 `chart` 除 `generatedAt` 外逐字节相同；断语按「卦局指纹」散列选词，同卦同答。兼容性：`chart` 与 `reading` 结构随内核演进，schema 对 `chart` 用 `additionalProperties: true`，消费方**不得**假设键集固定；已发布的稳定键见 [03-接口文档.md](03-接口文档.md) 附录 B。 |

### 4.4 导入与卦条
| 条目 | 内容 |
|---|---|
| **IF-REST-012 解析导入文本** | 前置条件：无（空文本返回 `count:0`）。数据格式：`{text}` 或非 JSON 原文；响应 `{ok,count,blocks[]}`，每块多一个 `suggestion`。正常流：`importer.parseMany` → 判定是否卦条 → 逐块 `suggestImport`。异常流：解析抛错 → `400`；**信息不全不报错**，体现在 `missing[]`/`unknownKeys[]`/`warnings[]`。时序：无。幂等：幂等，纯函数式解析。兼容性：解析原则「宁可报缺，不许猜」是**契约的一部分**——**不得**为了让某类文本能过而放宽为猜测。 |
| **IF-REST-013 批量入库** | 前置条件：`items` 每条含足够信息；`useHex` 判定所需字段齐备。正常流：逐条判定分支 → 构造记录 → `store.save` → 触发 `record.created` → 累积 `created[]`。异常流：**逐条容错**——单条失败进 `failed[]`，HTTP 仍 `200`；仅 `readBody` 失败返回 `400`。时序：条目**按数组顺序串行**处理；同批次内 `makeId` 依赖 `seqCache` 递增，顺序影响 id 序号但不影响结果集。重试：**不得**整体自动重试（会产生重复）；**可以**只对 `failed[]` 重发。幂等：非幂等。兼容性：`overrides` 键集**只可以**扩充；`forceCast`/`forceHexagram` 的优先级（`forceCast` 先判）冻结。 |
| **IF-REST-014/015 卦典** | 前置条件：`knowledge/64gua.json` 与 `knowledge/yaoci.json` 可读（进程启动时载入单例）。正常流：读内存中的卦典单例。异常流：`015` 解析不出卦 → `404 未找到该卦`。时序：卦典为**进程内单例**，改文件**必须**重启进程才生效。幂等：幂等。兼容性：`014` 的 `q` 只搜 `id`/`name`/`fullName`/`keywords`（**不含**卦辞与爻辞），`015` 走宽松解析；二者能力差异冻结，**不得**悄悄扩大 `014` 的搜索面。 |
| **IF-REST-021 卦条模板** | 数据格式：`text/plain; charset=utf-8`，**无信封**，**无** `Content-Disposition`。时序：无。幂等：无副作用，但内容含当前时间戳，逐次不同。兼容性：模板是**人写的范本**，注释行可自由增删；解析器**必须**始终忽略 `#` 开头的整行。 |
| **IF-REST-022 卦条解析** | 数据格式：`{text}`；响应 `{ok,count,blocks[]}`，**不含** `suggestion`（与 `012` 的差异冻结）。异常流：`400`（`readBody` 失败）。幂等：幂等。兼容性：`blocks[]` 受 [schema/gua-tiao.schema.json](../schema/gua-tiao.schema.json) 约束；`fields.movingFrom` **只在**明文写了「动爻取法」时出现——这一「键可缺省」行为冻结。 |

### 4.5 走势
| 条目 | 内容 |
|---|---|
| **IF-REST-017 走势** | 前置条件：无（空库返回 `points:0` 的精简结构）。数据格式：查询参数 `mode`/`domains`/`categories`/`rangeDays`/`xMode`/`smooth`；响应 `{ok,trend}`。正常流：`store.list()` → `buildTrend` → 三模式分支 → 坐标与标签。异常流：参数非法**不**报错，按默认值处理；仅 `buildTrend` 意外抛错时 `400`。时序：无。重试：可自由重试。幂等：完全幂等（`rangeDays` 以**数据中最后一条**的时间为基准，不依赖当前时刻，故结果可复现）。兼容性：量程约定冻结——`signed` 为 −100～100，`percent` 为 0～100，**不得**混画在一根轴上；跨度不足一日时 `useTimeAxis:false` 且 `notes[]` 说明，**不得**假装真时间轴。 |

### 4.6 规范与校验
| 条目 | 内容 |
|---|---|
| **IF-REST-018/019 规范与 schema** | 前置条件：`schema/` 目录存在。异常流：`019` 找不到文件 → `404 没有名为 <name> 的 schema`；`018` 的 `schema` 字段降级为 `null`。时序：进程启动时**不**预读 schema，每次请求现读——改 schema 文件无需重启。幂等：幂等（`018` 的 `template` 含时间戳）。兼容性：`018` 的 `record.required` 是硬编码字面量，**必须**与 `record.schema.json` 的 `required` 保持一致；两者不一致即为缺陷。 |
| **IF-REST-020 校验** | 前置条件：`core/schema.mjs` 支持的 JSON Schema 子集（**不支持** `$ref`/`allOf`/`not`/`if-then-else`/`dependentSchemas`/`patternProperties`）。数据格式：`body.text !== undefined` 进入文本分支（空串也算）；否则取 `body.record ?? body` 进入卦录分支。正常流：文本分支＝逐块解析 ＋ schema 校验 ＋ 注入 `missing`/`unknownKeys` 合成错误；卦录分支＝单次 schema 校验。异常流：`400`（`readBody` 失败）。**校验不通过不是 HTTP 错误**。时序：无。幂等：幂等。兼容性：校验器**必须**能抓出错误（`tools/check-validate.mjs` 为负向测试网）；**不得**为了让某个文件通过而放宽 schema。 |

### 4.7 插件
| 条目 | 内容 |
|---|---|
| **IF-REST-031…035** | 前置条件：插件已加载；对 `034`/`035`，对应页面/面板已注册。正常流：见 [03-接口文档.md](03-接口文档.md) H1–H5。异常流：`032` 单插件失败进 `errors[]` 且 HTTP 为 `200`；`034`/`035` 渲染抛错冒泡为 `500`。时序：`032` **必须**在插件文件写完并保存后再调用；调用期间路由表被整体替换，**不得**假定旧的插件路由仍然有效。重试：`031`/`032`/`033` 可自由重试（重复提交结果相同）。幂等：`031` 幂等；`032` 幂等（但会重建全部插件实例、清空模块缓存）；`033` 幂等；`034`/`035` 视插件实现。兼容性：**插件路由优先于内置路由**的优先级冻结；`ctx` 的成员**只可以**新增。 |
| **IF-PLUG-001 插件路由注册** | 双方：插件宿主 ↔ 插件。前置条件：`activate(ctx)` 执行中。数据格式：`method`（会被大写化）、`subPath`（前导 `/` 被剥离）、`handler(ctx)`。正常流：宿主拼接 `/api/plugins/<id>/<subPath>` → 入路由表 → 排序。异常流：注册重复路径不报错，同长度时保持插入顺序。时序：**必须**在 `activate()` 同步阶段或 `await` 完成前注册完毕。幂等：`loadAll()` 会清空路由表，重复加载不累积。兼容性：前缀固定，**不得**允许注册 `/api/` 之外的路径。 |

### 4.8 Agent 与工具
| 条目 | 内容 |
|---|---|
| **IF-REST-023/024 助手配置** | 前置条件：`data/config.json` 可写（`024`）。异常流：`400`（写入失败）。时序：`024` 生效后立即影响 `027`/`028`/`029` 的行为，无需重启。幂等：`024` 幂等（同值重复提交结果相同）。兼容性：`apiKey` 永不回显的约定**不得**破坏；`clearApiKey` 语义（清空）冻结。 |
| **IF-REST-026 直接执行工具** | 前置条件：工具名存在于 21 个工具中。数据格式：`{arguments}` 或请求体即参数；响应 `{ok,result,ms}` 或 `{ok:false,error}`。正常流：`toolkit.call(name, args)` → 返回结果与耗时。异常流：工具不存在或抛错 → **`400`** ＋ `{ok:false,error}`（不是 500）。时序：无。重试：视所调工具而定；`cast`/`stats`/`trend`/`hexagram_lookup`/`format_spec`/`parse_import`/`list_records`/`get_record` 可重试，写盘类工具**不得**自动重试。幂等：**不统一**——`toolkit.call` 的契约是「任何失败都返回 `{ok:false}`，不抛异常」，幂等性由具体工具决定。兼容性：工具数量与名字是**对外契约**；增删工具**必须**同步 [03-接口文档.md](03-接口文档.md) 附录 A、[05-Agent设计文档.md](05-Agent设计文档.md)。 |
| **IF-REST-027/028/029 模型类** | 前置条件：`resolveConfig()` 的 `ready` 为真（`baseUrl`、`model`、`needsKey` 三项满足）。异常流：未配置好或上游失败 → `400`；`029` 另有 `messages 为空` 的 `400`。时序：`029` 的 `messages` 只取**最后 21 条**，且只接受 `role` 为 `user`/`assistant` 且 `content` 为字符串的项——**应当**在客户端就截断。重试：**可以**重试 `027`/`028`；`029` **不得**自动重试（可能重复写盘且消耗配额）。幂等：`027`/`028` 对外部模型有读副作用（计费），`029` 可能经工具写盘，三者均**不应**视为幂等。超时：`postJson` 内置 **120 秒** `AbortController`；`029` 多轮时每轮各自计时。兼容性：`events[]` 的 `type` 取值 `assistant`/`tool`/`error` 冻结；`phase` 取值 `start`/`done` 冻结；HTTP 层对 `phase=done` 的 `result` 做 4000 字符截断这一行为冻结。 |
| **IF-REST-038 厂商余额** | 前置条件：`balanceProfile(provider, baseUrl)` 给出非空 `url`（当前仅 DeepSeek 系）；否则**不发任何请求**，直接回 `{ok:true, supported:false, hint, console}`。数据格式：成功 `{ok:true, supported:true, at, isAvailable, currency, total, granted, toppedUp}`；失败 `{ok:false, supported:true, error}`——**失败也返回 HTTP 200**，`error` 恒为字符串且**不得**含 API Key。时序：请求前**必须**先过 `agent/sources.mjs` 的私网/保留地址守卫；成功结果缓存 **60 秒**（`?force=1` 绕过），失败不缓存。重试：界面**可以**重试（点击 chip 即重查）。幂等：对厂商侧为只读，对外表现为幂等。超时：**8 秒** `AbortController`。兼容性：**API Key 只进 `Authorization` 头，不得出本机、不得出现在响应或错误文案里**；`total`/`granted`/`toppedUp` 为**字符串金额**（厂商原样），不得转成数字后回传。 |

### 4.9 导出与备份
| 条目 | 内容 |
|---|---|
| **IF-REST-009/010 导出** | 数据格式：**无信封**，直接返回文件内容；头含 RFC 5987 双文件名。异常流：`009` 的 id 不存在 → `404`；`010` 无错误路径。时序：无。幂等：幂等（文件内容只取决于当前数据）。兼容性：`009` 的**分派顺序**（插件导出器 → `json` → `slip` → 其余按 `md`）与 `format` 缺省为 `md` 冻结；内置格式名 `md`/`json`/`slip` 的语义**不得**改变。 |
| **IF-REST-036 恢复备份** | 前置条件：请求体可 `JSON.parse`；`records[]` 或请求体本身为数组。正常流：逐条判存/合并 → `save` → 若含 `config` 则 `setConfig`。异常流：`400`（`readBody` 失败）；缺 `id` 或 `chart` 的记录被**静默跳过**。时序：**必须**先用 `IF-REST-020` 校验备份包结构，再调用本接口；本接口不做结构校验。重试：幂等，可重试。兼容性：**本接口会覆盖 `config`，包含 `apiKey`**；消费方在导入他人备份前**必须**提示用户；`merge=false` 只跳已存在 id 的语义冻结。 |

### 4.10 系统控制
| 条目 | 内容 |
|---|---|
| **IF-REST-037 停止服务** | 前置条件：服务在运行。正常流：先写响应，再 `setTimeout(process.exit(0), 200)`。异常流：无。时序：响应**必须**先于退出发出（200 ms 缓冲）；桌面版**不得**调用本接口代替关闭窗口。重试：**不得**重试。幂等：非幂等。 |

### 4.11 插件机制与事件
| 条目 | 内容 |
|---|---|
| **IF-PLUG-002/003/004 注册** | 数据格式：`registerPage({id,label,icon='◇',order=100,render})`、`registerPanel({id,label,order=100,render})`、`registerExporter({id,label,ext,mime='text/plain; charset=utf-8',render})`。前置条件：`activate(ctx)` 执行中。异常流：缺少 `id` 或 `render` 不抛错，但后续渲染会失败（面板降级、页面 `500`）。时序：同 `IF-PLUG-001`。幂等：`loadAll()` 会清空注册表。兼容性：`order` 默认值 100 冻结；页面按 `order` 升序，面板不排序。 |
| **IF-PLUG-005 插件静态资源** | 数据格式：`GET /plugin-assets/<pid>/<rest>`；响应为文件字节，MIME 按扩展名映射。前置条件：`data/plugins/<pid>/` 存在。异常流：路径越出该目录 → `403 forbidden`；文件不存在 → `404 not found`（裸文本）。时序：无。幂等：幂等。兼容性：**只**暴露 `data/plugins/<pid>/` 之内；**不得**扩展为可访问 `data/` 其他位置。 |
| **IF-EVT-001…006** | 数据格式：各事件载荷见 [03-接口文档.md](03-接口文档.md) 第 4.4 节。正常流：宿主 `emit(event, payload)` → 顺序调用全部登记处理器。异常流：处理器抛错 → 记 `warn` 日志，**不**中断后续处理器，**不**影响发起事件的主请求。时序：**必须**在对应主操作（如 `store.save`）**之后**触发；异步处理器的 Promise **不**被 await。重试：无重试机制；处理器如需可靠投递，**应当**自行落盘。幂等：事件不保证只投递一次（如 `record.created` 在批量入库时逐条触发）。兼容性：事件名冻结；新增事件**必须**登记在本 ICD 与 [12-插件与扩展开发指南.md](12-插件与扩展开发指南.md)。 |

### 4.12 IPC
| 条目 | 内容 |
|---|---|
| **IF-IPC-001…006（invoke 类）** | 双方：渲染进程 ↔ 主进程。前置条件：`ipcMain.handle` **已注册**（**必须**早于 `mainWindow.loadURL()`）；`contextIsolation: true`、`nodeIntegration: false`。数据格式：入参为可结构化克隆的值，返回为普通对象。正常流：`window.__qxgDesktop.<fn>()` → `ipcRenderer.invoke(channel, …)` → 主进程处理器 → 返回。异常流：通道未注册 → 渲染侧 Promise 拒绝，文案 `No handler registered for '<channel>'`；用户取消对话框 → `{ok:false,canceled:true}`。时序：注册早于 `loadURL`；`004` 内部 `fetch` 当前监听地址，故**必须**在服务 `listen()` 成功之后调用。重试：`001`/`002`/`003`/`005` 可重试；`004`/`006` 涉及用户交互，**不得**自动重试。幂等：`001`/`002`/`003`/`005` 幂等；`003` 首次调用会创建 `backups/` 目录；`004`/`006` 非幂等。兼容性：通道名冻结；新增返回字段**可以**，改名**不得**；preload **必须**是 `.cjs` 且用 `require`（沙箱化 preload 不能是 ES 模块，写成 `.mjs` 会**静默失败**）。 |
| **IF-IPC-007（事件类）** | 双方：主进程 → 渲染进程。数据格式：单个字符串参数 `hash`（如 `#/cast`）。正常流：菜单/托盘 `click` → `showWindow(hash)` → `webContents.send('qxg:navigate', hash)` → `onNavigate` 回调。异常流：窗口不存在或已销毁时 `showWindow` 直接返回，**不**发送。时序：**必须**在窗口创建之后；窗口最小化时先 `restore()` 再发送。幂等：事件式接口，不保证不丢——窗口未就绪时该次跳转丢失。兼容性：`hash` 取值集合与界面路由一致；新增路由**不**影响本通道。 |

### 4.13 MCP
| 条目 | 内容 |
|---|---|
| **IF-MCP-001 `initialize`** | 双方：MCP 服务 ↔ 外部 agent 宿主。前置条件：进程已启动且 `makeRuntime()` 完成（载入全部内核、`Store`、`toolkit`）。正常流：收到请求 → 返回固定结构 `{protocolVersion,capabilities,serverInfo,instructions}`。异常流：无。时序：**应当**是会话第一条消息；服务端不强制。幂等：幂等。兼容性：`protocolVersion` 固定为 `2024-11-05`；`capabilities` 中 `listChanged` 均为 `false`（服务**不**在运行中推送列表变更）。 |
| **IF-MCP-002 `notifications/initialized`** | 数据格式：无 `id` 的 JSON-RPC 消息。正常流：返回 `null`，**不写任何响应**。幂等：幂等。兼容性：别名 `initialized` 同样被接受，二者**必须**保持等价。 |
| **IF-MCP-003 `ping`** | 正常流：返回 `result: {}`。幂等：幂等。兼容性：返回空对象是既有契约。 |
| **IF-MCP-004 `tools/list`** | 数据格式：`{tools:[{name,description,inputSchema}]}`，恒 21 项。异常流：无。幂等：幂等。兼容性：`description` 为 `【<title>】<description>` 的拼接形态，与 `GET /api/agent/tools` 的分离形态**不同**，两者都要保留；`inputSchema` 与 `agent/tools.mjs` 的 `parameters` **必须**逐字一致。 |
| **IF-MCP-005 `tools/call`** | 前置条件：`params.name` 非空。数据格式：`{name,arguments}`；响应 `{content:[{type:'text',text}],isError,_meta}`。正常流：`toolkit.call` → 成功则 `JSON.stringify(result, null, 2)` 作为文本。异常流：缺 `name` → JSON-RPC `-32602`；工具失败 → **JSON-RPC 层成功**，`isError: true`，文本为 `工具执行失败：<error>`。重试：**不得**自动重试写盘类工具；只读工具可重试。幂等：由被调工具决定。兼容性：错误承载方式（`isError` 而非 JSON-RPC error）冻结——**不得**改为抛 JSON-RPC 错误，否则宿主会误判为协议故障。 |
| **IF-MCP-006 `resources/list`** | 数据格式：恒 3 个资源；`wenxingua://records` 的 `description` 含动态条数。幂等：幂等（`description` 随数据变化）。兼容性：三个 URI **不得**删除；新增资源**可以**。 |
| **IF-MCP-007 `resources/read`** | 前置条件：URI 在四类可读形态之中。数据格式：`{uri}`；响应 `{contents:[{uri,mimeType,text}]}`。异常流：未知 URI → `-32602 未知资源 <uri>`；`wenxingua://record/<id>` 不存在 → `-32602 未找到卦录 <id>`。幂等：幂等（`spec/gua-tiao` 含当前时间戳）。兼容性：`wenxingua://record/<id>` 是**模板 URI**，不出现在 `resources/list`——这一不对称冻结。 |
| **IF-MCP-008/009 `prompts/list` / `prompts/get`** | 数据格式：恒 2 个提示 `divine`、`review_due`。异常流：未知 prompt → `-32602 未知 prompt <name>`。幂等：幂等（`divine` 的文本随入参变化）。兼容性：提示模板文本**可以**演进；`name` 与 `arguments` 的键名冻结。 |

### 4.14 MCP 全局时序与约束
- 服务启动时**必须**先向 stderr 写就绪行（含工具数与卦录数），**不得**写 stdout；stdout **只允许**出现 JSON-RPC 消息，每条一行，`JSON.stringify` 无缩进；stdin 关闭即退出（`readline` 迭代结束）；请求体为数组时**并发**处理并在全部完成后逐条写出响应；因此数组内的写操作顺序**不保证**；`JSON.parse` 失败 → `{jsonrpc:'2.0',id:null,error:{code:-32700,message:'JSON 解析失败'}}`，随后继续读下一行；数据目录固定为 `<代码根>/data`，**不读** `QXG_DATA_DIR`——与 HTTP 服务可能指向不同目录，属已知设计取舍

### 4.15 会话、文档与版本更新
| 条目 | 内容 |
|---|---|
| **IF-REST-039…046 会话存储** | 前置条件：`data/chats/` 可写（写类接口）。数据格式：一段会话双存**模型侧 `messages`** 与**展示用 `trace`**；`append` 的请求体原样交给 `ChatStore.append`，服务端**只存不推断**。正常流：见 [03-接口文档.md](03-接口文档.md) L 节。异常流：`404`（`未找到该会话`／`未找到该附件`）；`040` 的 id 由服务端按当前时间生成，客户端**不得**自带 id。时序：`043` **必须**在一轮真正结束（或用户确认执行）之后调用——一轮进行中的中间态不进存档。重试：`039`／`041`／`046` 可自由重试；`040`／`043`／`045` **不得**自动重试（会多出一段会话／重复计一轮／重复占附件名）。幂等：读类幂等；`042` 幂等；`044` 默认软删（进 `data/trash/`），`?hard=1` 才真删。兼容性：`messages` 的成对约定（`assistant.tool_calls` 与 `tool` 结果必须成对）是**历史能否回推的判据**，**不得**在写入路径上打散或截断。 |
| **IF-REST-047/048 随包文档** | 前置条件：条目在 `HELP_DOCS` 白名单里。数据格式：`047` 回目录（含 `exists`／`bytes`），`048` 回 `{markdown}` 原文。异常流：不在白名单 → `404`；该条是跳转条目（`link`）→ `400`；解析出的路径越出代码根目录 → `400 路径越界`（白名单被改坏时的双保险）。幂等：幂等（`bytes` 随文件变化）。兼容性：白名单是唯一真源，**不得**改成按请求路径拼文件。 |
| **IF-REST-049/050 更新检测与顶层配置** | 前置条件：`049` 仅在 `config.updateCheck !== false` 时才出网。数据格式：`049` 回 `{enabled,current,latest,url,asset,assetUrl,size,name,publishedAt}`，失败时 `latest:''` ＋ `error`；`050` 只认 `lastSeenVersion`（≤32 字符）与 `updateCheck`（布尔）。正常流：`049` = 固定域名 GET → 取 `tag_name` 去掉前缀 `v`、从 `assets[]` 里挑首选资产（`*.exe`，没有则第一个）→ 成功结果缓存 6 小时；`050` = 白名单过滤 → `store.setConfig` → 只回这两项。异常流：**出网失败一律静默**（HTTP `200` ＋ `ok:true`，不重试、不 500、不打扰用户）；`050` 一个键都不认 → `400`，`config.json` 一字不动。时序：`049` 在界面启动后约 1.5 秒发一次，**不得**阻塞启动；版本比较在界面侧（`hasNewerVersion`），服务端只回事实。重试：`049` 可自由重试（有缓存兜着）；`050` 幂等可重试。兼容性：**这是本程序唯一的主动外呼**（见 [11-安全与隐私设计.md](11-安全与隐私设计.md) §6.3.3），固定域名与「关掉即不出网」的语义冻结；顶层白名单**不得**为了省事扩成整份覆盖；`assetUrl` 为空串时界面主按钮退回发行页（老发行版没传资产）。 |

---

## 五、全量数据字典（字段级）
类型记法：`string`／`int`／`num`／`bool`／`obj`／`arr`／`null`。路径中 `[]` 表示数组元素。

### 5.1 卦录根级 `data/records/<id>.json`
| 字段路径 | 类型 | 必填 | 取值范围/枚举 | 默认 | 语义 | 出现在哪些接口 |
|---|---|---|---|---|---|---|
| `schema` | int | **是** | ≥1 | — | 结构版本号，当前 `4` | REST-004/005/006/008/009、MCP-007 |
| `id` | string | **是** | `^[0-9]{12}-[0-9]{2}$` | — | 编号 `YYYYMMDDHHmm`＋两位序号；一经生成不再更改 | 同上 |
| `title` | string | **是** | ≤200 字 | 由 `question` 截 24 字，或 `<本卦>之占`，或 `未题之占` | 标题 | 同上 |
| `category` | string | **是** | 8 类枚举 | `其他` | 类别，决定宜/忌取向 | 同上 |
| `question` | string | 否 | ≤2000 字 | `''` | 所问之事 | 同上 |
| `cast` | obj | **是** | 见 5.2 | `{}` | **起卦输入，唯一真源** | 同上 |
| `chart` | obj | **是** | 见 5.3 | `null` | 卦局快照；引擎升级后旧快照不动 | 同上 |
| `reading` | obj | **是** | 见 5.4 | `null` | 断语快照；同上 | 同上 |
| `narrative` / `narrativeHtml` ／ `origin` | string ／ obj | 否 ／ 否 | 任意 ／ `{kind,label,url?}` | `''` ／ `{kind:'cast',label:'本机起卦'}` | 当初的完整解读原文及其 HTML 化缓存 ／ 来源标记 | 同上 ／ 同上 |
| `background` / `plan` / `collation` / `qa` | string | 否 | 任意 | `''` | 补充存录（v3 新增，均可省）：求测人背景／可执行方案／**人工**校勘（人对旧解读措辞的更正，与程序自动算的 `corrections` 分属两源）／原文问答（以「问：」「答：」起行） | 同上 |
| `origin.kind` | string | 否 | 见 6.12 | `cast` | 来源类别 | REST-003（映射为 `origins`） |
| `claimed` | obj\|null | 否 | 见 5.5 | `null` | 当初别人所述的卦 | REST-004/005/009 |
| `corrections` | arr | 否 | 见 5.6 | `[]` | 校勘：原述与重算不符处 | REST-003/005/009 |
| `review` | obj | **是** | 见 5.7 | `{status:'待应验',log:[]}` | 复盘：状态 + 条目流 | REST-004/005/006/009 |
| `tags` | string[] | 否 | 任意 | `[]` | 标签 | REST-003/005/009 |
| `source` | obj\|null | 否 | 任意 | `null` | 外部来源 | REST-005/009 |
| `createdAt` / `updatedAt` ／ `revisionCount` | string ／ int | **是** ／ 否 | ISO 8601 ／ ≥0 | 首次落盘时间 ／ `0` | 录入时间 / 最后修改时间 ／ 重算次数 | REST-003/005/006/008 ／ REST-005/008 |
根级 `additionalProperties: false`——**不得**出现未声明字段。

### 5.2 起卦输入 `cast`
| 字段路径 | 类型 | 必填 | 取值范围/枚举 | 默认 | 语义 | 出现在哪些接口 |
|---|---|---|---|---|---|---|
| `cast.method` | string | **是** | `numberAndTime`/`twoNumbers`/`timeOnly`/`manual`/`xlrNumbers`/`xlrTime`（六法：前四梅花、后二小六壬） | `numberAndTime` | 起卦法 | REST-004/005/011/013、MCP-005 |
| `cast.localTime` | string | **是** | `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$` | — | 钟表时间 | 同上 |
| `cast.numbers` | int[] | 视起卦法 | 每项 ≥1 | `[]` | 报数 | 同上 |
| `cast.useTrueSolarTime` | bool | 否 | — | `true` | 是否按真太阳时定时辰 | 同上 |
| `cast.calendarType` | string | 否 | `lunar`/`solar` | `lunar` | 仅小六壬 `xlrTime` 用：月与日按农历（闰月按本月计）或公历 | 同上 |
| `cast.movingFrom` | string | 否 | `sum`/`number`/`manual` | `sum`（`manual` 模式为 `manual`） | 动爻取法 | 同上 |
| `cast.longitude` / `cast.latitude` | num\|null | 否 | −180～180 / −90～90 | `null` | 经纬度（纬度目前只存档） | 同上 |
| `cast.placeName` | string | 否 | 内置 10 城或自定义 | `''` | 地点名 | 同上 |
| `cast.hexagram` | string | `manual` 必填 | 卦名/卦序/卦符 | `''` | 本卦 | 同上 |
| `cast.movingPosition` | int\|null | `manual` 必填 | 1–6 | `null` | 动爻（自下而上） | 同上 |
| `cast.question` / `cast.category` | string | 否 | 任意 / 8 类或空串 | `''` | 所问与类别的副本 | 同上 |
| `cast.notes` | string[] | 否 | 任意 | `[]` | 备注 | 同上 |
`cast` 的 `additionalProperties: true`。

### 5.3 卦局 `chart`
| 字段路径 | 类型 | 取值 | 语义 |
|---|---|---|---|
| `chart.method` | string | 同 `cast.method` | 起卦法 |
| `chart.inputs` | obj | 同 5.2 | 输入归一化副本 |
| `chart.calendar` | obj | 见 5.3.1 | 历法 |
| `chart.casting` | obj | `{steps[],upperName,lowerName,movingNumber,hourZhi,hourNumber}` | 起卦推演步骤与中间量 |
| `chart.lines` | int[] | 长度 6，元素 `0`/`1` | 六爻（自下而上，1 为阳） |
| `chart.ben` / `chart.hu` / `chart.bian` | obj | 卦对象 | 本卦 / 互卦 / 变卦 |
| `chart.moving` | obj | 见 5.3.2 | 动爻 |
| `chart.tiyong` | obj | 见 5.3.3 | 体用生克 |
| `chart.score` | obj | 见 5.3.4 | 吉凶评分 |
| `chart.generatedAt` | string | ISO 8601 | 本快照生成时间 |
`chart` 的 `additionalProperties: true`——结构随内核演进，消费方**不得**假定键集固定。

#### 5.3.1 `chart.calendar`
| 字段路径 | 类型 | 语义 |
|---|---|---|
| `localTime` / `dateTime` | string | 钟表时间 `YYYY-MM-DD HH:mm` |
| `placeName` / `longitude` / `latitude` | string / num\|null / num\|null | 地点与经纬度 |
| `julianDay` | num | 儒略日（含日内小数） |
| `trueSolarTime` / `trueSolarHour` | string / num | 真太阳时 `HH:mm` 与其小数小时 |
| `equationMinutes` / `longitudeMinutes` / `offsetMinutes` | num | 均时差、经度时差、总修正（分） |
| `clockHourZhi` / `clockHourNumber` | string / int | 钟表时辰地支与其取数（子=1…亥=12） |
| `trueHourZhi` / `trueHourNumber` ／ `monthZhi` / `monthIndex` / `jie` / `term` / `nextJie` | string / int ／ string / int / string ×3 | 真太阳时辰地支与其取数 ／ 月建地支、月建序号、所在节气、当前节气、下一节气 |
| `sunLongitude` | num | 太阳视黄经（度） |
| `yearGanZhi` / `dayGanZhi` / `dayGanZhiIndex` ／ `summary` | string / string / int ／ string | 年干支、日干支、日干支序号 ／ 一句话历法摘要 |

#### 5.3.2 `chart.moving`
| 字段路径 | 类型 | 取值 | 语义 |
|---|---|---|---|
| `position` | int | 1–6 | 动爻位数（自下而上） |
| `isYang` | bool | — | 动爻阴阳 |
| `yaoTitle` | string | 如 `九四`/`六三`/`初九`/`上六` | 爻题 |
| `yaoText` | string | 爻辞原文（**含**爻题前缀） | 爻辞 |
| `positionSymbol` | string | 任意 | 爻位断语（如 `外卦之始，近君多惧`） |
| `positionName` | string | `初`/`二`/`三`/`四`/`五`/`上` | 爻位名 |
| `inUpper` | bool | — | 动爻是否在上卦 |

#### 5.3.3 `chart.tiyong`
| 字段路径 | 类型 | 取值 | 语义 |
|---|---|---|---|
| `ti` / `yong` | obj | `{name,element,nature,symbol,direction,…,position}` | 体卦（**我**）/ 用卦（**事**）；`position` 为 `上卦`/`下卦` |
| `relation` | obj | 见 6.3 | 体用生克 |
| `huTri` / `huRelation` | obj | 三画卦对象 / 见 6.3 | 互卦中与「用位」同侧的那一卦及其对体关系 |
| `bianTri` / `bianRelation` | obj | 三画卦对象 / 见 6.3 | 变卦中与「用位」同侧的那一卦及其对体关系 |
| `wang.ti` / `wang.yong` | obj | `{season,state,element,tri,phrase}` | 体卦 / 用卦的旺衰 |
| `tiRange` / `yongRange` | int[] | `[1,2,3]` 或 `[4,5,6]` | 原卦中体卦 / 用卦所占爻位 |
体用之法定「动爻所在之卦为用，另一卦为体」——**不得**在别处另立口径。

#### 5.3.4 `chart.score`
| 字段路径 | 类型 | 取值范围 | 语义 |
|---|---|---|---|
| `total` | num | −100～+100，一位小数 | 八项加权总分 |
| `grade` | obj | 见 5.4.4 | 吉凶等级 |
| `breakdown[]` | arr | 8 项 | 逐项明细 |
| `breakdown[].label` | string | `体用生克`/`变卦结局`/`互卦中途`/`体卦旺衰`/`用卦旺衰`/`本卦卦德`/`变卦卦德`/`动爻得位` | 项名 |
| `breakdown[].weight` | num | `3.0`/`2.2`/`1.0`/`1.4`/`0.6`/`3.2`/`2.2`/`1.0` | 权重 |
| `breakdown[].value` | num | — | `weight × 归一值` |
| `breakdown[].pct` | num | −100～+100 | 该归一值的百分数 |
| `breakdown[].note` | string | 任意 | 人话说明 |

### 5.4 断语 `reading`
| 字段路径 | 类型 | 必填 | 取值范围 | 语义 |
|---|---|---|---|---|
| `reading.signature` | string | **是** | 任意 | 谶语：一卦气质最重处 |
| `reading.tone` | arr | **是** | **恰好 7 项**，顺序固定 | 七段定调 |
| `reading.tone[].key` | string | **是** | `main`/`hu`/`bian`/`duan`/`yi`/`ji`/`yingqi` | 段键 |
| `reading.tone[].label` | string | **是** | `主`/`互`/`变`/`断`/`宜`/`忌`/`应期` | 段名 |
| `reading.tone[].text` | string | **是** | ≥4 字 | 段文 |
| `reading.classical` | obj | 否 | `{guaci,xiang,yaoci,huXiang,bianXiang}` | 古辞佐证，每项 `{text,source}`，缺失项为 `null` |
| `reading.plain` | obj | **是** | `{oneLine,focus,why[],how[]}` | 通俗解 |
| `reading.grade` | obj | **是** | 见 5.4.4 | 吉凶等级 |
| `reading.category` | string | 否 | 8 类枚举 | 断语所依据的类别 |
| `reading.generatedBy` | string | 否 | `问心卦·断语引擎 v1` | 引擎标识，供判断是否需重算 |
`reading.tone[].additionalProperties: false`（只有 `key`/`label`/`text` 三键）。七段顺序 `主`→`互`→`变`→`断`→`宜`→`忌`→`应期` **不可变**；要改顺序就必须升 `schema` 版本。出现接口：REST-003/004/005/009/011。

#### 5.4.4 吉凶等级 `reading.grade`
| `key` | `label` | 分数区间 | `tone` | `desc` 摘要 |
|---|---|---|---|---|
| `daji` | 大吉 | ≥ 55 | `good` | 势顺而气足，上下皆应 |
| `ji` | 吉 | 25 ～ 54 | `good` | 大体可成，事有曲折而不失其正 |
| `zhongji` | 中吉 | 0 ～ 24 | `good` | 可成而须力 |
| `ping` | 平 | −8 ～ −1 | `neutral` | 成败在人，卦无所偏 |
| `xiaoxiong` | 小凶 | −40 ～ −9 | `warn` | 势有阻格，强争则损 |
| `xiong` | 凶 | < −40 | `bad` | 境压其身，妄动则伤 |

### 5.5 校勘输入 `claimed`
| 字段路径 | 类型 | 取值范围 | 语义 |
|---|---|---|---|
| `claimed.ben` / `claimed.hu` / `claimed.bian` | string\|null | 卦名 | 原述本卦 / 互卦 / 变卦 |
| `claimed.moving` | int\|null | 1–6 | 原述动爻 |
| `claimed.tiyong` | string\|null | 任意文本 | 原述体用 |
`additionalProperties: true`。**只填认得出的字段**——认不准就省略，免得被当成「原述」而误报校勘。出现接口：REST-004/005/009/012/013/022、MCP-005。

### 5.6 校勘结果 `corrections[]`
| 字段路径 | 类型 | 必填 | 取值范围 | 语义 |
|---|---|---|---|---|
| `corrections[].field` | string | 否 | `ben`/`hu`/`bian`/`moving`/`tiyong`/`movingRule` | 差异字段 |
| `corrections[].label` | string | **是** | `本卦`/`互卦`/`变卦`/`动爻`/`体用`/`动爻取法` | 差异字段中文名 |
| `corrections[].stated` | string | 否 | 任意 | 原述 |
| `corrections[].computed` | string | 否 | 任意 | 正法重算结果 |
| `corrections[].note` | string | **是** | 任意 | 说明与取舍 |
`additionalProperties: true`。校勘**一律存录，不删改原述**。

### 5.7 复盘 `review`
| 字段路径 | 类型 | 必填 | 取值范围/枚举 | 默认 | 语义 |
|---|---|---|---|---|---|
| `review.status` | string | **是** | 6 状态枚举 | `待应验` | 复盘状态（改它不动任何条目） |
| `review.log[]` | arr | **是** | 元素 `{at,text}` | `[]` | 复盘条目流：最早那条通常是最初写的复盘，之后是追记 |
| `review.log[].at` / `.text` | string | 否 | 日期串（**可为空串**） / 任意 | — | 这一条的日期 / 正文 |
`review.additionalProperties: false`（只有 `status`/`log` 两键）。v5 之前还有 `result`／`reviewedAt` 两键，已由 4→5 迁移并入首条条目——见 [07-数据模型与存储设计.md](07-数据模型与存储设计.md) 与 [core/migrate.mjs](../core/migrate.mjs)。出现接口：REST-003/004/005/006/009。

### 5.8 卦条解析结果（REST-012/022、`save_gua_tiao`）
| 字段路径 | 类型 | 必填 | 取值范围 | 语义 |
|---|---|---|---|---|
| `ok` | bool | **是** | — | 信息是否齐全到可入库 |
| `source` | string | **是** | 常量 `gua-tiao` | 来源标识 |
| `version` | int | **是** | 常量 `1` | 卦条格式版本 |
| `confidence` | int | 否 | 0–100 | 识别度百分比 |
| `strategy` | string | 否 | `hexagram`/`cast`/`incomplete` | 入库方式 |
| `fields` | obj | **是** | 见下 | 归一后的字段 |
| `fields.localTime` | string | **是** | 空串或 `YYYY-MM-DD HH:mm` | 起卦时间；缺失时为空串并进 `missing` |
| `fields.placeName` | string | 否 | 任意 | 地点名 |
| `fields.longitude` / `fields.latitude` | num\|null | 否 | −180～180 / −90～90 | 经纬度 |
| `fields.useTrueSolarTime` | bool | **是** | — | 默认 `true` |
| `fields.numbers` | int[] | **是** | 每项 ≥1 | 报数（空数组表示未给） |
| `fields.question` / `fields.category` | string | 否 | 任意 / 8 类或空串 | 所问 / 类别 |
| `fields.notes` | string[] | 否 | — | 备注 |
| `fields.method` | string | **是** | 4 种起卦法 | 起卦法 |
| `fields.movingFrom` | string | 否 | `sum`/`number` | **只在卦条明写「动爻取法」时才出现** |
| `fields.timeRaw` | string | 否 | 任意 | 仅对话文本路径有 |
| `claimed` | obj | **是** | 见 5.5 | 卦条里写的卦 |
| `signature` | string | 否 | 任意 | 写了「签」则覆盖引擎谶语 |
| `tags` | string[] | 否 | 任意 | 标签 |
| `review` | obj | 否 | `{status,result}` | 复盘初值；`status` 默认 `待应验`，可为空串 |
| `title` / `hexagramText` / `movingText` / `tiyongText` | string | 否 | 任意 / 如 `第4爻` | 标题、原文本卦串、动爻文本、体用文本 |
| `detected` | obj | 否 | `{times[],numbers[],hexagrams[],places[]}` | 识别到的线索 |
| `missing` | string[] | **是** | `起卦时间`/`本卦`/`报数`/`动爻` | 缺项 |
| `warnings` / `unknownKeys` / `hints` | string[] | 否 | 任意 | 提示 / 认不出的键名 / 写法可疑提示 |
| `narrative` | string | 否 | 任意 | 「原文: \|」块内容 |
| `background` / `plan` / `collation` / `qa` | string | 否 | 任意 | 多行块字段，与 `narrative` 同一套块规则：「背景: \|」「方案: \|」「校勘: \|」「问答: \|」（键别名见 6.9） |
| `suggestion` | obj | 否 | `{mode,castInput}` | **仅 REST-012 注入**；`mode` ∈ `hexagram`/`cast`/`manual-required` |

### 5.9 走势响应 `trend`（REST-017、tool `trend`）
| 字段路径 | 类型 | 取值范围 | 语义 |
|---|---|---|---|
| `trend.mode` / `trend.xMode` / `trend.smooth` ／ `trend.points` / `trend.spanDays` / `trend.useTimeAxis` | string / string / num ／ int / num / bool | `fortune`/`element`/`category`；`index`/`time`；≥1 ／ ≥0；两位小数 | 模式、横轴模式、平滑窗口 ／ 点位数、时间跨度（天）、是否真用时间轴 |
| `trend.scale` | string | `signed`/`percent`/`mixed` | 量程并集 |
| `trend.xValues[]` / `trend.xLabels[]` | num[] / arr | 0–1；`{text,full,id,title}` | 归一横坐标与轴标签 |
| `trend.series[]` | arr | 见下 | 数据系列 |
| `trend.series[].id` | string | 领域 id 或 `el:<五行>` 或 `cat:<类别>` 或 `all:<领域>` | 系列 id |
| `trend.series[].name` / `.color` / `.hint` | string | 任意 / `#RRGGBB` / 任意 | 名称、线色、说明 |
| `trend.series[].scale` | string | `signed`/`percent` | 该系列量程 |
| `trend.series[].values[]` | num[]\|null[] | 见 6.7 | 平滑后数值，空值表示断线 |
| `trend.series[].raw[]` | num[]\|null | `smooth=1` 时为 `null` | 原始序列 |
| `trend.series[].dashed` / `.sparse` | bool | — | 是否虚线（基准线）/ 是否稀疏（类别线） |
| `trend.categories[]` | string[] | 8 类 | 数据中出现的类别 |
| `trend.domains[]` | arr | `{id,name,color,scale,mode,desc}` | 全部领域定义 |
| `trend.records[]` | arr | `{id,title,localTime,category,ben,symbol,grade,score,relation,tiElement,tiState,review}` | 逐卦投影 |
| `trend.notes[]` | string[] | 任意 | 说明（含时间轴退化提示） |

### 5.10 Agent 工具入参（21 个工具的并集）
| 字段路径 | 类型 | 必填 | 取值范围/枚举 | 默认 | 语义 | 出现在哪些工具 |
|---|---|---|---|---|---|---|
| `localTime` | string | **是** | `YYYY-MM-DD HH:mm` | — | 起卦钟表时间 | `cast`、`save_record` |
| `method` | string | 否 | 6 种起卦法（梅花四种＋`xlrNumbers`/`xlrTime`） | `numberAndTime` | 起卦法／筛选 | `cast`、`save_record`（起卦）；`list_records`（只看某一起卦法） |
| `numbers` | int[] | 否 | 每项 ≥1 | — | 报数（小六壬 `xlrNumbers` 给 1–3 个） | `cast`、`save_record` |
| `placeName` / `longitude` | string / num | 否 | 任意 / 东经度数 | — | 地点名 / 经度 | `cast`、`save_record` |
| `useTrueSolarTime` | bool | 否 | — | `true` | 真太阳时开关 | `cast`、`save_record` |
| `calendarType` | string | 否 | `lunar`/`solar` | `lunar` | 仅小六壬 `xlrTime` 用：月与日按农历（闰月按本月计）或公历 | `cast`、`save_record` |
| `movingFrom` | string | 否 | `sum`/`number` | `sum` | 动爻取法 | `cast`、`save_record` |
| `hexagram` | string | 否 | 卦名/卦序/卦符 | — | `manual` 时的本卦 | `cast`、`save_record` |
| `movingPosition` | int | 否 | 1–6 | — | 动爻 | `cast`、`save_record` |
| `question` | string | 否 | 任意 | — | 所问之事 | `cast`、`save_record` |
| `category` | string | 否 | 8 类枚举 | — | 类别 | `cast`、`save_record`、`list_records`、`update_record` |
| `title` / `narrative` ／ `tags` | string ／ string[] | 否 ／ 否 | 任意 ／ 任意 | — ／ — | 标题 / 原文 ／ 标签 | `save_record`、`update_record` ／ `save_record`、`update_record` |
| `background` / `plan` / `collation` / `qa` | string | 否 | 任意 | — | 补充存录：背景／方案／人工校勘／原文问答 | `save_record`、`update_record` |
| `claimed` | obj | 否 | `{ben,hu,bian,moving,tiyong}`，`additionalProperties: true` | — | 原述之卦 | `save_record` |
| `text` | string | 视工具 | 任意 | — | 待解析文本 | `save_gua_tiao`、`parse_import` |
| `id` | string | 视工具 | 卦录 id | — | 目标卦录 | `get_record`、`update_record`、`update_review` |
| `q` | string | 否 | 任意 | — | 关键词 | `list_records` |
| `grade` / `review` ／ `limit` | string ／ int | 否 ／ 否 | 6 个吉凶等级 / 6 个复盘状态 ／ 1–100 | — ／ `20` | 吉凶 / 复盘状态筛选 ／ 返回条数 | `list_records` ／ `list_records` |
| `status` / `text` / `at` ／ `mode` / `domains` / `smooth` / `rangeDays` / `categories` | string / string / string ／ string / string[] / int / int / string[] | 否 ／ 否 | 6 状态 / 任意 / 日期串（可为空串） ／ 3 模式 / 6 个 `signed` 领域 / 1–12 / ≥0 / 8 类 | `at` 默认当天 ／ `fortune` / 全部 fortune 领域 / `1` / `0` / — | 复盘状态、新写的一条复盘／追记、这一条的日期 ／ 走势参数 | `update_review` ／ `trend` |
| `query` | string | **是**（`hexagram_lookup`） | 卦名/卦序/卦符/关键词 | — | 卦典查询 | `hexagram_lookup` |
`stats` 与 `format_spec` 无入参（`properties: {}`）。

---

## 六、枚举总表

### 6.1 类别 `category`（8）
| 取值 | 语义 | 断语取向 |
|---|---|---|
| `考研学业` | 学业进取 | 要旨在「恒」不在「猛」 |
| `求职事业` | 出处进退 | 要旨在「辨上下、定民志」 |
| `财运生计` | 财用盈缩 | 要旨在「纪律」，进不如守 |
| `心态情绪` | 心之安否 | 要旨在「心不受境转」 |
| `作息健康` | 身体作息 | 要旨在「顺身体之自然」 |
| `人际情感` | 人我之间 | 要旨在「同气」与「留余」 |
| `决策取舍` | 取舍抉择 | 要旨在「不满为吉、孤注为凶」 |
| `其他` | 未归类 | 守常道而行 |
留空时由 `normalizeCategory()` 按关键词自动归类，匹配不上回落 `其他`。`record.schema.json` 的 `enum` 与 `CATEGORIES` **必须**始终一致；取值域**不可扩展而不升版本**。

### 6.2 复盘状态 `review.status`（6）
| 取值 | 语义 |
|---|---|
| `待应验` | 默认值；卦已录，事未到 |
| `应验中` | 已有部分迹象 |
| `已应验` | 卦已应 |
| `未应验` | 应期已过而卦未应 |
| `已过期` | 观察窗口关闭 |
| `无需应验` | 该问已作废 |
非法值经 `normalizeRecord()` 回落 `待应验`。`agent/tools.mjs` 的 `format_spec` 输出中同为此 6 项。

### 6.3 体用关系 `relation.key` / `bianRelation.key` / `huRelation.key`（6）
| 取值 | `label` | `grade` | 走势归一值 | 白话取向 |
|---|---|---|---|---|
| `yong_sheng_ti` | 用生体 | 3 | +100 | 最吉：事来就我 |
| `bihe` | 体用比和 | 0 | +60 | 吉：同气相求 |
| `ti_ke_yong` | 体克用 | 1 | +20 | 可成而耗 |
| `ti_sheng_yong` | 体生用 | −1 | −40 | 小耗：力出功归 |
| `yong_ke_ti` | 用克体 | −3 | −100 | 最凶：势在人不在己 |
| `unknown` | 体用未明 | — | 0 | 平看 |

### 6.4 吉凶等级 `reading.grade.label`（6）
`大吉` ≥55｜`吉` 25～54｜`中吉` 0～24｜`平` −8～−1｜`小凶` −40～−9｜`凶` <−40（总分 −100～+100）。`key`／`tone` 对应见 §5.4.4。

### 6.5 起卦法 `cast.method`（6）
两种占法、六种起卦法：前四为**梅花易数**，后二为**道教小六壬**。
| 内部 id | 占法 | 中文名 | 需要的输入 | 推演要点 |
|---|---|---|---|---|
| `numberAndTime` | 梅花易数 | 一数一时辰 | 数 + 时 + 动 | 上卦取数除八，下卦取时辰数除八，动爻取二者之和除六 |
| `twoNumbers` | 梅花易数 | 两数 | 数(2) + 时 + 动 | 先报数为上卦，后报数为下卦，两数之和除六取动爻 |
| `timeOnly` | 梅花易数 | 年月日时 | 时 | 年支＋月＋日为上卦，再加时辰为下卦，总和除六取动爻；**动爻可省** |
| `manual` | 梅花易数 | 已知卦象 | 本卦 + 动 | 互卦、变卦、体用由引擎推算 |
| `xlrNumbers` | 道教小六壬 | 报数起课 | 数(1–3) + 时 | 自大安起顺数，每落一宫下一数自该宫续数；三宫全显，末宫为主断 |
| `xlrTime` | 道教小六壬 | 月日时辰起课 | 时（＋`calendarType`） | 大安起月、月上起日、日上起时；月与日按农历（默认，闰月按本月计）或公历 |
`METHOD_NAMES` 是**卦条**用的梅花方法别名表，另接受中文别名：`一数一时辰`、`一数加时辰`、`数与时` → `numberAndTime`；`两数`、`两数起卦` → `twoNumbers`；`年月日时` → `timeOnly`；`已知卦象`、`指定本卦` → `manual`。小六壬没有卦条格式，其方法中文名见 `core/xiaoliuren.mjs` 的 `XLR_LABELS`（`xlrNumbers`＝「小六壬 · 报数起课」、`xlrTime`＝「小六壬 · 月日时辰起课」）。

### 6.6 动爻取法 `movingFrom`（3）
| 取值 | 语义 | 默认 |
|---|---|---|
| `sum` | 数与时辰之和除六（梅花易数常法） | **是** |
| `number` | 仅以报数除六（旧稿偶见） | 否 |
| `manual` | 由 `manual` 起卦法直接指定动爻，不涉及取法 | 否 |
`cast()` 内部把非 `number` 的值一律归一为 `sum`；`cast.movingFrom` 的 schema 允许这三个值，但 `cast()` 输出只会是 `sum` 或 `number`（`manual` 经 `buildFromHexagram` 写入 `chartInput.inputs.movingFrom`）。

### 6.7 走势领域 id 与量程（6）
| id | 名称 | `scale` | `mode` | 归一规则 |
|---|---|---|---|---|
| `score` | 总评分 | `signed` | `fortune` | `chart.score.total` 原值（−100～+100） |
| `relation` | 体用生克 | `signed` | `fortune` | 见 6.3 归一值列 |
| `bian` | 变卦对体 | `signed` | `fortune` | 同上（取 `bianRelation.key`） |
| `tiWang` | 体卦旺衰 | `signed` | `fortune` | 旺 +100／相 +50／休 0／囚 −50／死 −100 |
| `grade` | 吉凶等级 | `signed` | `fortune` | 大吉 +100／吉 +60／中吉 +20／平 0／小凶 −60／凶 −100 |
| `tiYangRatio` | 体卦刚柔 | `signed` | `fortune` | 体卦属阳 +100，属阴 −100 |
量程常量：`signed = [−100, 100]`，`percent = [0, 100]`。`mode=element` 产出的五行系列（`el:木`…`el:水`）与 `mode=category` 产出的类别系列（`cat:<类别>`、`all:<领域>`）**不出现在** `DOMAINS` 表中，其 `id` 由代码拼装。**除五行占比外，各线均归一到 `signed`**，故可叠在同一量程里比较；量程不同的线**不得**硬画在一根轴上。

### 6.8 插件注册类型（5）
| 注册方法 | 产出 | 必填字段 | 可选字段与默认 |
|---|---|---|---|
| `registerRoute(method, subPath, handler)` | 路由 | `method`、`subPath`、`handler` | — |
| `registerPage({…})` | 侧栏页面 | `id`、`label`、`render` | `icon='◇'`、`order=100` |
| `registerPanel({…})` | 卦录面板 | `id`、`label`、`render` | `order=100` |
| `registerExporter({…})` | 导出格式 | `id`、`label`、`ext`、`render` | `mime='text/plain; charset=utf-8'` |
| `on(event, fn)` | 事件钩子 | `event`、`fn` | — |
插件对象字段：`id`（缺省取文件名）、`name`（缺省取 `id`）、`version`（缺省 `0.0.0`）、`description`（缺省 `''`）、`author`（缺省 `''`）、`activate(ctx)`（**必需**，缺则跳过并记入 `errors[]`）。

### 6.9 卦条字段别名（25 组，共 88 个别名）
| 内部字段 | 全部可写键名 |
|---|---|
| `title` | 题、标题、title |
| `question` | 问、所问、所问之事、问题、question |
| `category` | 类、类别、category |
| `tags` | 标签、tags |
| `localTime` | 时、时间、起卦时间、钟表时间、time、localtime |
| `placeName` | 地、地点、城市、place |
| `longitude` | 经、经度、东经、longitude、lon |
| `latitude` | 纬、纬度、北纬、latitude、lat |
| `useTrueSolarTime` | 真太阳时、真太阳、truesolar |
| `method` | 法、起卦法、方法、method |
| `numbers` | 数、报数、数字、numbers |
| `movingFrom` | 动爻取法、movingfrom |
| `hexagram` | 本卦、卦、hexagram、ben |
| `movingPosition` | 动、动爻、moving |
| `hu` / `bian` ／ `tiyong` | 互卦、hu ／ 变卦、bian ／ 体用、tiyong |
| `signature` | 签、谶、signature |
| `narrative` | 原文、原记录、记录、narrative |
| `background` | 背景、求测人背景、背景动机、background |
| `plan` | 方案、可执行方案、行动方案、plan |
| `collation` | 校勘、人工校勘、勘误、collation |
| `qa` | 问答、原文问答、问答原文、qa |
| `status` / `result` / `reviews` | 复盘、状态、status ／ 实况、结果、result（**旧键，兼容**）／ 复盘条目、追记、复盘记录、reviews、entries（多行块） |
匹配规则：键名**小写化**后查表（`localtime` 与 `localTime` 等价）。别名**只增不减**。

### 6.10 内置城市 `places`（10）
| 名称 | 经度 | 纬度 | 名称 | 经度 | 纬度 |
|---|---|---|---|---|---|
| 兰州 | 103.83 | 36.06 | 北京 | 116.41 | 39.90 |
| 上海 | 121.47 | 31.23 | 长沙 | 112.94 | 28.23 |
| 成都 | 104.07 | 30.57 | 苏州 | 120.58 | 31.30 |
| 杭州 | 120.15 | 30.27 | 深圳 | 114.06 | 22.55 |
| 天津 | 117.20 | 39.13 | 石家庄 | 114.51 | 38.04 |
中国标准时区中央经线为 **120°E**（`CHINA_STANDARD_MERIDIAN`）。

### 6.11 数据目录模式 `dataMode`（5）
| 取值 | 语义 |
|---|---|
| `env` | 由 `QXG_DATA_DIR` 指定（服务层） |
| `portable` | 代码目录下的 `data/` 可写 |
| `appdata` | 回落到 `%APPDATA%\问心卦\data` |
| `chosen` | 桌面版用户显式选过（仅 `IF-IPC-001` 的 `dataMode`） |
| `dev` | 桌面版开发态，项目目录下的 `data/`（仅 `IF-IPC-001`） |

### 6.12 来源类别 `origin.kind`
`cast`（本机起卦，`IF-REST-004` 缺省）、`import`（粘贴导入，`IF-REST-013` 缺省）、`gua-tiao`（卦条导入，`save_gua_tiao` 工具）、`agent`（AI 助手录入，`save_record` 工具）；其他字符串为外部来源自定义（备份包或脚本）。`record.schema.json` 对 `origin.kind` **不设 `enum`**，故新增来源无需升版本。

### 6.13 卦条专属判定键
`looksLikeGuaTiao()` 认定一段文本是卦条的两个条件之一：以 `# 卦条` 开头，或「至少两个 `键: 值` 行且其中一个键属于 `问`/`时`/`本卦`/`动`/`法`/`数`/`类`/`地`/`真太阳时`/`question`/`localtime`」。

---

## 七、文件系统接口
文件系统是本项目**最耐久的一层接口**：程序跑不起来时，卦录依然可读，因此约束比 HTTP 更严。

| ID | 约定与不可破坏的规则 |
|---|---|
| **IF-FS-001** `data/records/<id>.json` | 方向：双向（程序读写；用户与外部工具可读可写）。命名 `<id>.json`，文件名对 id 做安全化（非 `[\w.-]` 替换为 `_`）。UTF-8，**不得**带 BOM；缩进 `JSON.stringify(rec, null, 2)`。写入**必须**先写 `<id>.json.tmp` 再 `renameSync` 覆盖，**不得**原地截断写入。迁移前**必须**先写 `IF-FS-003`。服务每个请求前 `statSync` 一次目录 mtime，变了就整目录重扫，故**可以**由外部工具直接写入。不可破坏：① 一条卦录一个文件；② `cast` 是唯一真源，**不得**为了展示而改写；③ 已发布字段**不得**删除或改名；④ 文件名与 `id` **必须**一致；⑤ 迁移**必须**先备份后落盘。 |
| **IF-FS-002** `data/trash/` | 命名 `<id>-<毫秒时间戳>.json`；触发于 `IF-REST-007` 未传 `hard=1` 时。不可破坏：① 默认删除**必须**先进这里；② 垃圾桶内容**不得**由程序自动清理；③ `hard=1` 的硬删**必须**只由用户主动触发。 |
| **IF-FS-003** `data/backups/pre-migration/` | 命名 `<id>-v<旧版本>-<毫秒时间戳>.json`；内容是迁移**前**的原件完整副本；触发于 `Store.loadAll()` 检测到 `schema` 低于 `CURRENT_SCHEMA` 且迁移函数存在时。不可破坏：① 写备份**必须**先于迁移落盘；② 迁移函数抛错或返回非对象时**必须**放弃迁移、按原样载入、只告警，**不得**丢数据；③ 缺迁移函数时**必须**按原样载入并告警。 |
| **IF-FS-004** `data/backups/` | 备份目录根；`IF-IPC-003` 会确保其存在。**不得**在程序启动时自动清空该目录。 |
| **IF-FS-005** `data/config.json` | 结构 `{schema,appName,defaultPlace,defaultLongitude,useTrueSolarTimeByDefault,movingFromByDefault,theme,plugins,backupDir,agent}`。写入口：`IF-REST-024`（`agent` 段）、`IF-REST-033`（`plugins` 段）、`IF-REST-036`（备份包中的 `config` 整段覆盖）。读语义：`getConfig()` 为浅合并 `{...默认值, ...磁盘值}`，缺字段自动补默认。不可破坏：① `agent.apiKey` 明文存储——**不得**提交公开仓库、**不应当**放同步盘；② **不得**用按 ANSI 读写的工具（如 PowerShell `Set-Content`）往返改此文件；③ 写配置**必须**先读后合并，**不得**整体覆盖为只含改动项的窄对象。 |
| **IF-FS-006** `data/plugins/<id>.mjs` | UTF-8 ES 模块；载入用 ``import(`${pathToFileURL(file).href}?t=${Date.now()}`)``，**带时间戳查询串破除模块缓存**；导出 `default`（或 `plugin`）对象，含 `activate(ctx)`。不可破坏：① **不得**缓存模块而不加时间戳（热载会失效）；② 载入失败**不得**中断其余插件；③ 插件**不得**直接写 `data/records/`（**应当**经 `store.save()`）。 |
| **IF-FS-007** `data/plugins/<id>/` | HTTP 映射 `/plugin-assets/<id>/<相对路径>`。**不得**允许路径逃出本目录（`serveStatic` 的前缀校验**不得**移除）。 |
| **IF-FS-008** `knowledge/64gua.json`、`knowledge/yaoci.json` | 内核只读；进程启动时构建**单例**。结构：64 卦对象（`id`/`name`/`fullName`/`upper`/`lower`/`symbol`/`palace`/`coreMeaning`/`keywords`/`guaci`/`xiang`/`fortune`/`advice`）；爻辞表按卦序组织，另含用九用六。不可破坏：① 卦辞、大象辞、爻辞**必须**是古籍原文；② `coreMeaning`/`keywords`/`advice`/`fortune` 是**编写的释义**，**不得**标注为原文；③ 改文件后**必须**重启进程才生效；④ **不得**手写卦象到计算路径。 |
| **IF-FS-009** `schema/*.schema.json` | 现有 `record.schema.json`、`gua-tiao.schema.json`；每次请求现读（`IF-REST-018`/`019`），改文件无需重启。支持子集：`type`、`enum`、`const`、`properties`、`required`、`additionalProperties`、`items`、`minItems`、`maxItems`、`minimum`、`maximum`、`exclusiveMinimum`、`exclusiveMaximum`、`minLength`、`maxLength`、`pattern`、`oneOf`、`anyOf`；**不支持** `$ref`、`allOf`、`not`、`if/then/else`、`dependentSchemas`、`patternProperties`——遇到即**报错**，**不得**静默放过。不可破坏：① `record.schema.json` 根级 `additionalProperties: false` **不得**改为 `true`；② 两份 schema 与 [规范.md](规范.md) 的字段字典**必须**同步。 |
---

## 八、版本与兼容策略

### 8.1 卦条 v1 的兼容承诺
- 已发布的 **25 组字段名与全部别名不得删改**，只**可以**新增别名；旧卦条文件**永远**能被后来的版本读入**不得**在 v1 内新增**必填**字段（视为破坏性变更）；确需时**必须**升 `GUATIAO_VERSION` 并同步更新 `schema/gua-tiao.schema.json`；「认不准就报缺，不许猜」是契约：**不得**为了让更多文本能过而放宽为猜测；`parseGuaTiao()` 返回结构的既有键（见 5.8）**不得**删除；`fields.movingFrom` 的「可缺省」行为冻结

### 8.2 卦录 schema 的迁移承诺
| 项 | 承诺 |
|---|---|
| 当前版本 | `CURRENT_SCHEMA = 4` |
| 迁移方向 | **只向前**，不做破坏性重写 |
| 迁移前 | **必须**备份到 `IF-FS-003` |
| 迁移失败 / 缺迁移函数 | 按原样载入并告警，**不得**丢数据 |
| 迁移函数性质 | **必须**是纯函数（旧记录 → 新记录），可单独测试 |
| 快照稳定性 | 引擎升级后旧卦录的 `chart` 与 `reading` 快照**保持不动**；只有新录入与显式「重算」才用新引擎 |
| 加新版本的步骤 | ① `CURRENT_SCHEMA` ＋1；② `MIGRATIONS[旧版本]` 写转换函数；③ 同步 `schema/record.schema.json`；④ [规范.md](规范.md) 版本历史记一笔；⑤ 跑 `tools/validate.mjs` 与 `tools/check.mjs` |
| 数据可脱离程序 | 纯文本 JSON，不依赖本程序也能读 |

### 8.3 REST 的向后兼容规则
| 允许 | 禁止 |
|---|---|
| 响应中**新增**字段 | 删除或改名已有字段 |
| 请求体白名单**扩充** | 收窄现有白名单 |
| 新增端点（使用未占用的号位） | 改变已有端点的路径、方法、语义 |
| 枚举**新增**取值（若消费方按未知值容错） | 枚举**收窄**或改名 |
| 错误 `error` 文案的措辞调整 | 删除 `ok` 字段或改变信封结构 |
| 新增插件导出格式 | 改变内置 `md`/`json`/`slip` 的分派优先级 |
| 新增可选查询参数 | 让已有参数由可选变为必填 |
破坏向后兼容的变更**必须**：升产品次版本号；在 [03-接口文档.md](03-接口文档.md) 与本 ICD 同步；必要时提供过渡期。

### 8.4 MCP 的协议版本
| 项 | 承诺 |
|---|---|
| 协议版本 | `2024-11-05`，至本版本未变 |
| 版本协商 | 服务端**不**校验客户端版本，回自己的版本号；客户端**应当**自行判断兼容性 |
| 能力变更 | `capabilities.tools.listChanged` 与 `resources.listChanged` 均为 `false`；改为 `true` 需在运行中推送 `notifications/tools/list_changed` |
| 工具集 | 21 个工具的 `name` 与 `inputSchema` 是契约；新增工具**必须**同步三处文档 |
| 工具数量变化 | 客户端**不得**硬编码 12；**应当**以 `tools/list` 为准 |
| 错误承载 | `tools/call` 的工具级失败用 `isError:true`，**不得**改为 JSON-RPC error |
| stdout 纯净性 | **不得**有任何非 JSON-RPC 内容进入 stdout |
| 数据目录 | 固定 `<代码根>/data`，**不**读 `QXG_DATA_DIR` |

### 8.5 IPC 的兼容承诺
- 通道名冻结；新增通道**可以**，改名与删除**不得**。返回对象**可以**新增字段，已有字段的类型与语义冻结「`ipcMain.handle` 必须在 `loadURL` 之前注册」是**契约性时序要求**，**不得**因重构而违反；preload **必须**是 `.cjs` 且用 `require`

---

## 九、时序与约束

### 9.1 启动时序
| # | 步骤 | 约束 |
|---|---|---|
| 1 | 解析数据目录（`QXG_DATA_DIR` → 便携 `data/` → `%APPDATA%`） | **必须**早于服务模块被 `import`（桌面版），否则服务会挑到安装目录里的 `data/` |
| 2 | `Store` 构造 → `ensure()` 建目录 → `loadAll()` | `loadAll()` 内含**先备份后迁移**（见 9.2） |
| 3 | `PluginHost.loadAll()` | **必须**在 `Store` 就绪之后（插件要用 `store`） |
| 4 | `core.record.resetSeqCache()` | **必须**在插件加载之后（插件**可以**录卦，会影响序号） |
| 5 | `createToolkit({store, core})` | **必须**在 `Store` 与 `core` 就绪之后 |
| 6 | `server.listen()` | — |
| 7 | Electron `registerIpc()` | **必须**早于 `mainWindow.loadURL()` |
| 8 | `mainWindow.loadURL(APP_URL)` | — |
| 9 | 建菜单、建托盘、注册 `before-quit` | 在 `loadURL` 之后（非阻塞） |

### 9.2 迁移时序（硬性）
```text
读文件 → JSON.parse → 检测 schema 版本
  → 若低于当前且迁移函数存在：
       写 data/backups/pre-migration/<id>-v<旧>-<ts>.json   ← 必须先行
       执行迁移函数（纯函数）→ 写回 data/records/<id>.json → 记入 store.migrations
  → 若迁移函数缺失或抛错：按原样载入 + 告警，不落盘
```
**备份先于落盘**是**不得**违反的次序。

### 9.3 请求处理时序
| 次序 | 步骤 | 约束 |
|---|---|---|
| 1 | 设 CORS 头 | 每一个响应都要有，含错误响应 |
| 2 | `OPTIONS` → `204` | **必须**早于路由匹配 |
| 3 | `store.maybeRescan()` | 在路由匹配之前，保证外部写入可见 |
| 4 | 插件路由匹配 | **优先于**内置路由 |
| 5 | 插件静态资源 | 早于内置路由 |
| 6 | 内置路由线性匹配 | 按注册顺序 |
| 7 | `/api/` 未命中 → 404 | — |
| 8 | 静态界面 → 回落 `index.html` | — |

### 9.4 写入时序
| 操作 | 次序约束 |
|---|---|
| 新增/更新卦录 | 先构造完整记录 → `normalizeRecord` → 写 `.tmp` → `rename` → 更新内存缓存 → 触发事件 |
| 软删除 | 先写 `trash/` → 再删 `records/` → 再清缓存 → 触发事件 |
| 迁移 | 先写 `pre-migration/` → 再写 `records/` |
| 配置变更 | 先 `getConfig()` 浅合并 → 再整体写回 |
| 插件热载 | 先 `reset()` 清空全部注册 → 再逐个 `import` → 最后 `emit('app.start')` |
| 批量入库 | 逐条串行；单条失败不回滚已成功者 |

### 9.5 运行时约束
- **卦象只能由引擎算**：任何路径都**不得**手写卦名、卦符、爻辞、体用生克、动爻、旺衰**一处实现，多处复用**：解析器（`core/importer.mjs` ＋ `core/guaTiao.mjs`）与工具集（`agent/tools.mjs`）各只有一份实现；HTTP、MCP、助手页三处**必须**共用；**零第三方依赖**：`package.json` 的 `dependencies` **必须**永远为空；**UTF-8**：**不得**用按 ANSI 读写的工具往返修改含中文的文件；**密钥**：`apiKey` **不得**经 HTTP 响应回显（整包备份例外），**不得**经 `Authorization` 等自定义请求头传递

---

## 十、未定义行为与边界条件
下表为**源码当前行为**。标注「未定义」的项**不得**被消费方依赖。

| 场景 | 当前行为 | 可否依赖 |
|---|---|---|
| `cast` 传 `method=twoNumbers` 而 `numbers.length < 2` | 落入默认分支，等价 `numberAndTime` | **未定义** |
| `cast` 传 `method=numberAndTime` 而 `numbers` 为空 | 报数按 `1` 处理 | **未定义** |
| `cast` 传 `useTrueSolarTime: null` | 按 `true` 处理（严格 `!== false` 才为假） | 可依赖 |
| `cast` 想用 `useHourInMoving` | HTTP 层**不透传**该字段，从 REST 无法开启 | 可依赖 |
| `cast` 传 `method=xlrNumbers` 而 `numbers` 为 0 个 / 超过 3 个 | 抛错「小六壬报数起课至少报一个数…」／「小六壬报数最多三个数…」→ `400` | 可依赖 |
| `cast` 传 `method=xlrTime` 而未给 `calendarType` | 默认按 `lunar`（农历，闰月按本月计）；显式 `solar` 则取公历月／日 | 可依赖 |
| `cast` 小六壬农历起课而 `localTime` 年份越出 1900–2100 | 抛错而不静默算错 → `400` | 可依赖 |
| `POST /api/records` 的 `movingPosition` 传非数字 / 传 `"3"` | `NaN` → 引擎报错 `400` ／ `Number("3")` 得 `3`，正常接受 | 可依赖 |
| `PATCH /api/records/:id` 传非白名单键 / 非法 `category` / 非法 `review.status` | 静默忽略 ／ 回落 `其他` ／ 回落 `待应验`，均不报错 | 可依赖 |
| `DELETE /api/records/:id?hard=true` | 只有严格 `"1"` 才硬删，`true` 按软删 | 可依赖 |
| `GET /api/trend?mode=乱写` / `?rangeDays=abc` / 跨度 < 1 天 / 无卦录 | 按 `fortune` ／ 按 `0` ／ 退化为等距并在 `notes` 说明 ／ 返回缺 `domains`、`categories`、`scale`、`xValues` 的**精简结构** | 可依赖（**必须**判 `points === 0`） |
| `GET /api/records?q=` 与 `GET /api/knowledge/hexagrams?q=` 的大小写 | 前者**不区分**（两侧都小写化）；后者**区分**（直接 `includes`） | 可依赖（两者不一致，属已知差异） |
| `POST /api/validate` 传 `{"text": ""}` / 传 JSON 数组作请求体 | 进文本分支，返回 `count:0`、`valid:true` ／ 按 schema 校验数组（`type:'object'` 会报错） | 可依赖 ／ **未定义** |
| `POST /api/import/commit` 的 `items` 传非数组 / 单条失败 | 按空数组处理 ／ 进 `failed[]`，HTTP 仍 `200` | 可依赖 |
| `POST /api/restore` 记录缺 `id` 或 `chart` / 重复恢复同包 | **静默跳过**，不计入计数 ／ 结果相同（幂等） | 可依赖 |
| 请求体 > 32 MiB / 非 JSON / 为空 | 抛 `请求体过大` → `400` ／ 返回 `{_raw}` ／ 返回 `{}` | 可依赖 |
| 未知 `/api/xxx` / 静态路径越界 / 静态文件不存在 | `404 {"ok":false,"error":"未知接口 /api/xxx"}` ／ `403` 裸文本 `forbidden` ／ `404` `not found`（根路径回落 `index.html`） | 可依赖 |
| 插件路由处理器返回 `false` / 未结束响应 | 宿主不补发任何内容 ／ 宿主补发 `{"ok":true}` | 可依赖 |
| 插件面板渲染抛错 / 插件页面渲染抛错 | 降级为含错误文案的 `html`，整体仍 `200` ／ 冒泡 → `500` | 可依赖 |
| 同时注册同长度插件路由 / 两个插件注册同一路径 | 先注册者优先（排序稳定） ／ **不确定** | 可依赖 ／ **未定义** |
| `GET /api/plugins/:pid/panel/:panelId` 无 `recordId` / 面板返回对象的 `label` | `store.get(null)` → `null` → `404 未找到该卦录` ／ 覆盖注册时声明的 `label`（页面反之：`id`/`label` 后写） | 可依赖 |
| MCP `tools/call` 缺 `name` / 工具失败 | `-32602 缺少参数 name` ／ JSON-RPC 成功 ＋ `isError:true` | 可依赖 |
| MCP `resources/read` 未知 URI / 收到非 JSON 行 / 未知方法 | `-32602 未知资源 <uri>` ／ `-32700`（`id` 为 `null`）并继续读下一行 ／ `-32601 不支持的方法：<method>` | 可依赖 |
| MCP 收到数组请求 | 并发执行，逐条写响应；**写操作顺序不确定** | **未定义**，不得依赖顺序 |
| MCP 服务运行中 `data/records/` 被外部改动 | **不**自动重扫（无 `maybeRescan` 调用），需重启 MCP 进程 | 可依赖 |
| `IF-IPC-004` 在服务未监听时调用 / `IF-IPC-007` 在窗口未就绪时发送 | `fetch` 失败，Promise 拒绝 ／ 该次跳转丢失 | **未定义** |
| `IF-REST-027` 传 `stream:true` | 响应改为 `application/x-ndjson`：逐行 `{"type":"event",…}`，末行 `{"type":"done",…}`（载荷同非流式）；出错发 `{"type":"error",…}` 后结束，**状态码仍是 200**（头已发出，改不了） | 可依赖 |
| `IF-REST-029` 带 `sessionId` 且存档可回推 / 存档不可用 / 历史超过窗口（60000 字符或 40 轮）/ `maxRounds` 传 `0` | 历史 = 存档 + 本轮那句 ／ 退回请求里的 `messages`（只收 `user`／`assistant`，最多 20 条） ／ 从最新一轮往回装到预算或轮数上限为止（按用户消息整轮切） ／ 回落配置值（`\|\|` 语义） | 可依赖 |
| `IF-REST-027/028` 模型端错误 / `IF-REST-009` `format` 未识别 | 也返回 `400`（需解析 `error` 文案区分「配置错」） ／ 按 `md` 返回，不报错 | 可依赖 |
| `IF-REST-037` 调用后立即再请求 | 200 ms 后进程退出，第二次请求可能失败 | **未定义** |
| `GET /api/spec` 的 `record.required` 与 schema 不一致 | 目前一致；不一致即为缺陷 | 可依赖（应当一致） |
| 同名 `.mjs` 插件覆盖写入后调 reload / 卦典文件运行中被改 / 卦录 JSON 损坏 / 卦录缺 `id` | **必然**重新载入（带 `?t=`） ／ 单例已建，**不生效**，需重启 ／ 跳过该文件并 `console.warn` ／ 该文件被跳过 | 可依赖 |
---

## 十一、附录：接口数量核对表
| 类别 | 数量 | 核对方式 |
|---|---|---|
| REST 端点 | **50** | `server/index.mjs` 中 `route('METHOD', '/path', handler)` 形式的调用数 |
| 插件机制接口 | **5** | `server/plugins.mjs` 的注册方法 4 个 ＋ `/plugin-assets/` 1 个 |
| IPC 通道 | **7** | `desktop/main.mjs` 的 `ipcMain.handle` 6 个 ＋ `qxg:navigate` 1 个 |
| MCP 方法 | **9** | `agent/mcp-server.mjs` 的 `switch (method)` 分支 8 个 ＋ 通知别名 1 个（`notifications/initialized` 与 `initialized` 等价，计 1） |
| 文件系统接口 | **9** | 第 7 节条目数 |
| 插件事件 | **6** | `server/index.mjs` 中 `emit` 的调用点 |
| **合计** | **73** | — |
---

*卦象仅供参考，决断在己。*
