# ADR-0004：cast / chart / reading 三段式与「cast 是唯一真源」

| 项 | 内容 |
|---|---|
| 状态 | 已接受 |
| 日期 | 2026-10-03 |
| 决策者 | 项目维护者 |
| 影响的模块 | `core/record.mjs`、`core/divination.mjs`、`core/verdict.mjs`、`core/migrate.mjs`、`server/store.mjs`、`server/index.mjs`、`schema/record.schema.json`、`tools/validate.mjs` |

## 背景

一条卦录的结构由 `core/record.mjs` 的 `normalizeRecord()` 定型，其中三个字段分工明确：

| 字段 | 角色 | 内容 |
|---|---|---|
| `cast` | **唯一真源** | 起卦输入：`method`、`numbers`、`localTime`、`useTrueSolarTime`、`movingFrom`、`longitude`／`latitude`／`placeName`、`hexagram`／`movingPosition`、`question`、`category`、`notes` |
| `chart` | 卦局快照 | 本卦／互卦／变卦、六爻、动爻、体用、旺衰、评分与逐项权衡、历法、起卦推演步骤 |
| `reading` | 断语快照 | `signature` ＋ 七段 `tone` ＋ `classical` ＋ `plain` ＋ `grade` |

`cast` 的取值来自 `core/divination.mjs` 的 `cast()` 返回值里的 `chart.inputs`——也就是说，**引擎自己原样回吐它据以计算的输入**，落盘的就是这一份。`buildRecord()` 的顺序是：

```js
let castInput = p.cast;
if (castInput && castInput.method !== 'manual' && p.claimed?.moving && !castInput.movingFrom) {
  const mf = inferMovingFrom(castInput, p.claimed.moving);
  if (mf !== castInput.movingFrom) castInput = { ...castInput, movingFrom: mf };
}
const chart = castInput ? cast(castInput) : buildChart(p.chartInput);
const reading = interpret(chart);
```

第一段是「动爻取法反推」：别人给的卦往往只写「报数、时间、动爻」而不说用哪一路取法，`inferMovingFrom()` 拿所述动爻去比对「仅以报数除六」与「数与时之和除六」两路，只有前者能对上时才改用前者——**忠实复现原卦，而不是误记成校勘**。这个逻辑被默认值挡住过一次，导致误报校勘，被 `tools/check.mjs` 抓出。

重算是一条**显式**路径，只有两个入口：`core/record.mjs` 的 `recompute(record)`（HTTP 侧是 `POST /api/records/:id/recompute`，界面上是详情页的「重算断语」按钮）。它的实现只替换三样东西：

```js
return normalizeRecord({
  ...record,
  chart,                                                    // 新引擎算的卦局
  reading,                                                  // 新引擎出的断语
  corrections: audit(record.claimed, chart),                // 校勘随重算结果更新
  updatedAt: new Date().toISOString(),
  revisionCount: (record.revisionCount || 0) + 1,
});
```

`cast`、`narrative`、`claimed`、`review`、`tags`、`createdAt` 都不动。`revisionCount` 是重算的计数器，界面上显示为「第 N 次重算」。

`docs/规范.md` 对这三段的分工有一句总结：「断语引擎一定会改，但**你已经存下的卦不能因为引擎改了而变样**。」

## 决策

卦录**必须**分为 `cast`（唯一真源）、`chart`（卦局快照）、`reading`（断语快照）三部分。`cast` **必须**完整到足以让 `cast(record.cast)` 重算出同一条卦局，**不得**省略或只存摘要。引擎升级后，已落盘记录的 `chart` 与 `reading` **必须**保持不动；要用新引擎看旧卦，**必须**经由显式重算，且重算**必须**只替换 `chart`／`reading`／`corrections` 三样并递增 `revisionCount`，**不得**顺手改动 `narrative`／`claimed`／`review`。

## 理由

1. **引擎一定会改。** 评分权重会被校准，词库会被扩写，历法精度会提高——这些改动都会改变 `chart` 与 `reading` 的内容。若卦录只存计算结果，改一次引擎就等于把用户全部历史卦录改写一遍，而用户当初正是照着旧断语做的决定。用快照把「当时的卦」冻住，是与历史对话的唯一办法。
2. **唯一真源使重算成为可能。** 只要有完整输入，任何一条卦录都能重算出同一卦局——`tools/check.mjs` 里就有一条断言：六条历史起卦的卦象与记录必须一致。这条能力同时是数据完整性的自检手段。
3. **快照使长期可读成为可能。** 用户十年后打开一条卦录，看到的应当是他当年看到的那段话。快照让「十年后读到的卦」不取决于那时的程序是什么版本。
4. **重算必须是显式操作。** 隐式重算（例如启动时统一刷新）会让「卦录在自己不知道的时候变了」。显式重算把决定权交给用户，同时把 `revisionCount` 作为看得见的痕迹留在记录里。
5. **三段式让校勘有对照物。** `claimed` 存「当初别人是怎么说的」，`corrections` 存它与重算结果的差异——两边的对照要有稳定的「正确一侧」，那一侧就是 `chart`，而 `chart` 的唯一来源是 `cast`。

## 后果

### 正面

- 引擎可安全升级：改词库、调权重、修历法都不会动到旧卦录，风险被限制在「新录入」与「用户主动重算」两处。
- 数据可自证：任一条卦录都能重新算出卦局与逐项评分，与存档比对即可发现损坏或误改。
- 卦录结构稳定，`schema/record.schema.json` 的根级 `additionalProperties: false` 能抓出写错的字段名，`tools/validate.mjs` 还能验七段顺序、六爻长度、动爻阴阳与六爻数据是否一致。
- 迁移与重算解耦：`core/migrate.mjs` 只管结构搬家（先备份到 `data/backups/pre-migration/` 再落盘），不改卦局内容；重算只管卦局与断语。两件事互不干扰。
- 旧卦录可以在不联网、不装模型的机器上完整读出（`reading` 已是成品，不必现算）。

### 负面

- **单条卦录体积不小。** 六条历史卦录的 JSON 各约 500 行、20–28 KB，因为 `chart` 与 `reading` 都是全文快照而非引用。这是刻意的冗余，代价是目录体积随卦数线性增长。
- **同一份信息存了两遍。** `chart` 里的卦名既可从 `cast` 推得，也在 `reading` 的文本里出现；改动只能靠重算同步。若有人手改 `cast` 而忘了重算，`cast` 与 `chart` 会不一致——程序不会自动发现这一点，只能靠用户点重算。
- **重算会覆盖旧断语。** 显式重算一旦执行，原来的 `reading` 就被替换，只留下 `revisionCount` 作为「曾经重算过」的痕迹，旧文本本身不归档。想要留下旧文本，只能在重算前自行导出（单条 Markdown／卦签／JSON）。
- **`cast` 的字段一旦遗漏就无法补救。** 例如某条早期记录若没存 `movingFrom`，重算只能走常法，反推信息已经丢失。这正是「`cast` 必须完整」被写成硬要求的原因。

## 备选方案与为何不选

| 方案 | 为什么没选 |
|---|---|
| 只存 `cast`，每次打开现算 | 体积最小、绝无漂移，但引擎一改，十年后看到的卦就不是当年那条，直接违反长期可读的目标。 |
| 只存 `chart` + `reading`（存结果不存输入） | 无法重算，也无法在引擎修 bug 后修正历史卦局；校勘失去对照物。 |
| 存 `cast` + 每次打开现算 + 归档旧引擎版本 | 要为每个历史版本保留一份旧代码，长期不可维护；且旧版本迟早跑不起来。 |
| 快照加内容指纹，变更时提醒用户 | 增加一层需要维护的指纹逻辑，而收益只是「提醒已经发生的变化」；显式重算已经让变化可控。 |
| 重算时把旧 `reading` 存进 `review.log` 之类的地方 | 会把复盘区变成版本仓库，语义混乱；用户真要留旧文本，用导出更干净。 |

## 相关

- [ADR-0002：一卦一个 JSON 文件而不是数据库](./ADR-0002-一卦一个JSON文件.md) —— 三段式落盘的物理形态。
- [ADR-0003：断语用规则引擎而不是让 LLM 写](./ADR-0003-断语用规则引擎.md) —— 快照里冻结的正是规则引擎的输出。
- [ADR-0011：校勘存而不改](./ADR-0011-校勘存而不改.md) —— `claimed` 与 `corrections` 的用法。
- [数据模型与存储设计](../07-数据模型与存储设计.md)、[规范.md](../规范.md) 第 3.1 节、[接口文档](../03-接口文档.md)、[接口控制文档 ICD](../04-接口控制文档-ICD.md)
