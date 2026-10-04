# ADR-0009：用 MCP 作为外部 agent 的接入面

| 项 | 内容 |
|---|---|
| 状态 | 已接受 |
| 日期 | 2026-10-03 |
| 决策者 | 项目维护者 |
| 影响的模块 | `agent/mcp-server.mjs`、`agent/tools.mjs`、`agent/loop.mjs`、`agent/provider.mjs`、`server/store.mjs`、`server/index.mjs`、`tools/check-mcp.mjs` |

## 背景

`agent/mcp-server.mjs` 是一个 JSON-RPC 2.0 over stdio 的 MCP 服务：`readline` 按行读 stdin，`process.stdout.write(JSON.stringify(obj) + '\n')` 逐行写 stdout。它声明 `PROTOCOL_VERSION = '2024-11-05'`，`SERVER_INFO` 的版本号从 `package.json` 读取（「免得与 HTTP 服务、README 漂移」）。

它实现的方法与暴露的能力是明确的一份清单：

| 类别 | 内容 |
|---|---|
| 方法 | `initialize`、`notifications/initialized`、`ping`、`tools/list`、`tools/call`、`resources/list`、`resources/read`、`prompts/list`、`prompts/get` |
| 工具 | 21 个（`cast`、`save_record`、`save_gua_tiao`、`list_records`、`get_record`、`update_record`、`update_review`、`trend`、`stats`、`hexagram_lookup`、`parse_import`、`format_spec`） |
| 资源 | `wenxingua://records`（全部卦录摘要）、`wenxingua://spec/gua-tiao`（卦条模板）、`wenxingua://stats`（统计）；另支持 `wenxingua://record/<id>` 读单条 Markdown |
| 提示模板 | `divine`（按梅花易数起一卦并给出有卦象气质的解读）、`review_due`（检查哪些卦该复盘了） |
| 错误码 | `-32700` JSON 解析失败、`-32601` 不支持的方法、`-32602` 缺少参数／未找到资源、`-32603` 内部错误 |

工具定义**只有一份**：`agent/tools.mjs` 的 `createToolkit({ store, core })`，同时提供 `openaiTools()`（给 `agent/loop.mjs` 的 function calling 用）与 `mcpTools()`（给 MCP 的 `tools/list` 用）。MCP 侧的 `makeRuntime()` 与服务端共用同一份内核载入清单与同一个 `Store`。

接入方式是每个宿主各写一段配置——Codex 写进 `~/.codex/config.toml` 的 `[mcp_servers.wenxingua]`，Claude Code / DeepSeek Harness 写进 `.mcp.json` 的 `mcpServers.wenxingua`：

```toml
[mcp_servers.wenxingua]
command = "node"
args = ["<项目绝对路径>/agent/mcp-server.mjs"]
```

同一套能力在 HTTP 侧也有一份等价入口：`GET /api/agent/tools` 列工具与接入片段，`POST /api/agent/tool/:name` **直接执行任一工具**（不经过模型，便于脚本与调试）。`initialize` 的 `instructions` 里写明了使用顺序与那条硬约束：「卦象由本服务依正法算出，勿自行编造卦名爻辞」。

一条生死线：**stdout 只允许出现 JSON-RPC 消息，任何日志一律走 stderr**。就绪提示写的是 `process.stderr.write('[问心卦 MCP] 已就绪，共 N 个工具，M 条卦录\n')`。违反这条会让 Codex／Claude 直接解析失败。`tools/check-mcp.mjs`（14 项）就是为此存在的——它**真起一个子进程走 stdio**，「进程内调用测不出这一点」。

## 决策

对外接入**必须**以 MCP 为一等接口，**必须**是 JSON-RPC 2.0 over stdio。MCP 服务**不得**在 stdout 输出任何非 JSON-RPC 内容，所有日志与诊断**必须**走 stderr。工具定义**必须**只保留 `agent/tools.mjs` 一处，HTTP／MCP／助手页**不得**各写一套。工具集对外的行为**必须**与内核一致——**不得**在 MCP 侧自行计算卦象或改写断语。

## 理由

1. **与主流编码 agent 直接互通。** Codex CLI、Claude Code、DeepSeek Harness 都支持 MCP，接进去只要一段配置。用户因此可以在自己常用的 agent 里说「帮我起一卦」「我上次那卦怎么说的」，而不必切到问心卦的界面。
2. **stdio 是最小信任面。** 服务是宿主按配置拉起的子进程，不监听端口、不需要鉴权、不需要在网络上暴露任何东西。这与 [ADR-0006](./ADR-0006-本地优先默认不出网.md) 的本地优先取向一致：外发只在「用户显式把问心卦接进自己的 agent」时发生。
3. **一次实现，三处复用。** 工具集只有一份，加一个工具就自动出现在 HTTP 接口、MCP 服务与助手页三处（`AGENTS.md` 的扩展点速查把这条写成了「加完自动出现在 HTTP、MCP、助手页三处」）。这是本项目「一处实现，多处复用」在接口层的落地。
4. **协议与传输解耦。** stdio 上的 JSON-RPC 不需要 HTTP 框架（零依赖前提），也不需要处理跨域、端口、证书。`tools/check-mcp.mjs` 可以在不联网、不起服务的环境里完整验证往返。
5. **契约可被机器读。** 资源与提示模板让外部 agent 能自助拿到格式规范（`wenxingua://spec/gua-tiao`）与统计，而不必先读文档；这降低了「让别的 agent 替你录卦」的门槛。

## 后果

### 正面

- 外部 agent 可以直接驱动：起卦、批量录入（`save_gua_tiao` 走的是与界面、命令行同一套解析器）、写复盘、看走势、查卦典。
- 21 个工具与 3 个资源的能力面固定且可枚举，集成方不必试探。
- 提示模板把「起卦」与「查应复盘」两条典型流程固化成可复用的一问一答，避免每次临时写提示词。
- 同一套工具也能被脚本直接调用（`POST /api/agent/tool/:name`），便于做批处理与回归。
- `SERVER_INFO.version` 取自 `package.json`，避免了「MCP 报的版本与程序版本不一致」这类漂移。

### 负面

- **stdout 纯净性是一条脆弱约束。** 任何一处 `console.log`、任何被引入的库在初始化时打印一行 banner，都会破坏协议。若将来引入模型网关之类的中间层，必须确保它也不往 stdout 写东西。`tools/check-mcp.mjs` 只能守住当前这一份实现，守不住未来新增的依赖。
- **stdio 形态不适合长驻服务。** 每个宿主各自拉起一个子进程，各自持有一份 `Store` 缓存。若宿主长期不关，而用户同时在桌面版里改了卦录，MCP 侧的缓存会滞后（`maybeRescan()` 只在读取时比对目录 mtime，能缓解但不能消除）。
- **没有鉴权与权限分级。** 一旦某个 agent 被接上，它就能改卦录、写复盘、删除（默认入 trash）。工具集里没有「只读模式」这一档。
- **协议版本要跟。** `2024-11-05` 是写死的字符串；MCP 规范演进时需要同步升级并按新规范补齐能力声明。
- **能力边界靠约定传达。** 「卦象必须由工具算出」写进了 `initialize` 的 `instructions`、工具描述与 `agent/loop.mjs` 的 `SYSTEM_PROMPT`，但那是**对模型的请求**，不是强制。真正的事实来源仍是：断语由工具返回、模型只负责转述。
- **多协议适配尚未收敛到一处。** 目前 HTTP 侧与 MCP 侧各自把工具结果包一层（`tools/call` 包成 `content[]`，`/api/agent/tool/:name` 直接返回 JSON），模型侧还有原生 function calling 与文本协议降级两条路径（`agent/provider.mjs` 的 `mode` 为 `native-tools`／`text-protocol`／`plain`）。把「模型与协议的不一致」收敛到一层处理是已定的方向，设计见 [Hermes 网关与路由设计](../06-Hermes网关与路由设计.md)，其代码位于 `hermes/`。

## 备选方案与为何不选

| 方案 | 为什么没选 |
|---|---|
| 只提供 HTTP 接口，让宿主自己适配 | 每个宿主都要写胶水代码，且要处理端口发现与鉴权；MCP 已经是几大 agent 的公共约定，直接实现它更省事。 |
| 自研一套 JSON-RPC 约定（非 MCP） | 生态成本全落在集成方；MCP 的方法集（tools／resources／prompts）恰好覆盖本项目需要暴露的三类能力。 |
| 把 MCP 服务做成常驻 HTTP 服务（SSE／Streamable HTTP 传输） | 需要在网络上监听并处理会话与鉴权，与本地优先取向冲突；stdio 的隔离性更好。 |
| 让每个工具各自复制一份实现给 MCP 用 | 会立刻产生行为漂移，违反「一处实现，多处复用」，`check-mcp.mjs` 也失去意义。 |
| 允许 MCP 侧自行计算卦象（图省事） | 直接违反 [ADR-0003](./ADR-0003-断语用规则引擎.md) 的核心结论：卦象只能由引擎算，模型与外部接口都不许编。 |

## 相关

- [ADR-0003：断语用规则引擎而不是让 LLM 写](./ADR-0003-断语用规则引擎.md) —— 同一条硬约束在外部接口上的延续。
- [ADR-0005：卦条 v1 作为稳定导入契约](./ADR-0005-卦条v1导入契约.md) —— `save_gua_tiao` 与 `wenxingua://spec/gua-tiao` 背后的格式。
- [ADR-0006：本地优先、默认不出网](./ADR-0006-本地优先默认不出网.md) —— 为什么选择 stdio 而非网络传输。
- [Agent 设计文档](../05-Agent设计文档.md)、[Hermes 网关与路由设计](../06-Hermes网关与路由设计.md)、[接口文档](../03-接口文档.md)、[接口控制文档 ICD](../04-接口控制文档-ICD.md)
