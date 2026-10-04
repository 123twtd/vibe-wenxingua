/**
 * 问心卦 · 工具注册表
 * ------------------------------------------------------------
 * 一份工具定义，三处复用：
 *   - AI Agent（agent/loop.mjs）—— 让模型自己起卦、查卦、存档、复盘；
 *   - MCP 服务（agent/mcp-server.mjs）—— 让 Codex / Claude / DSH 等外部 agent 直接驱动问心卦；
 *   - HTTP 接口（/api/agent/tools）—— 供界面展示与调试。
 *
 * 每个工具都只有一份实现，避免「界面一套、agent 一套」的分叉。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATEGORIES } from '../core/verdict.mjs';
import { METHOD_LABELS } from '../core/guaTiao.mjs';
import { DEFAULT_LEVEL, LEVEL_IDS, allows, denyMessage, levelById, normalizeLevel } from './permissions.mjs';

const S = (o) => o; // 仅为可读性
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 卦录必填字段**从 schema 现读**，不手抄。
 * 手抄过一版，漏了 `review`，与 schema/record.schema.json 对不上——
 * 这种「两处各写一份」的漂移正是硬规矩第 5 条要防的。
 */
function recordRequired() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', 'record.schema.json'), 'utf8'));
    return Array.isArray(s.required) ? s.required : [];
  } catch {
    // schema 读不到也不该让工具挂掉，给一份保守的兜底
    return ['schema', 'id', 'title', 'category', 'cast', 'chart', 'reading', 'review', 'createdAt', 'updatedAt'];
  }
}

/** 把卦局 + 断语压成适合模型阅读的紧凑结构 */
function chartBrief(chart, reading, { withTone = true } = {}) {
  const c = chart;
  return {
    卦录: {
      本卦: `${c.ben.fullName}${c.ben.symbol}`,
      互卦: `${c.hu.fullName}${c.hu.symbol}`,
      变卦: `${c.bian.fullName}${c.bian.symbol}`,
      动爻: `${c.moving.yaoTitle}（第${c.moving.position}爻）`,
      爻辞: c.moving.yaoText || '',
      体卦: `${c.tiyong.ti.name}${c.tiyong.ti.element}（${c.tiyong.ti.position}）`,
      用卦: `${c.tiyong.yong.name}${c.tiyong.yong.element}（${c.tiyong.yong.position}）`,
      体用关系: c.tiyong.relation.label,
      体卦旺衰: c.tiyong.wang.ti.state,
      变卦对体: c.tiyong.bianRelation.label,
      互卦对体: c.tiyong.huRelation.label,
      总评: `${c.score.grade.label}（${c.score.total}）`,
      月建: `${c.calendar.monthZhi}月（${c.calendar.jie}后）`,
    },
    起卦推演: c.casting.steps || [],
    时间: {
      钟表时间: c.calendar.dateTime,
      真太阳时: `${c.calendar.trueSolarTime}（${c.calendar.trueHourZhi}时，取数 ${c.calendar.trueHourNumber}）`,
      四柱参考: `${c.calendar.yearGanZhi}年 ${c.calendar.monthZhi}月 ${c.calendar.dayGanZhi}日`,
    },
    断语: withTone && reading ? {
      谶: reading.signature,
      定调: Object.fromEntries(reading.tone.map((t) => [t.label, t.text])),
      通俗解: reading.plain,
    } : undefined,
  };
}

function recordBrief(r) {
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    起卦时间: r.cast?.localTime || '',
    本卦: r.chart?.ben ? `${r.chart.ben.fullName}${r.chart.ben.symbol}` : '',
    动爻: r.chart?.moving?.yaoTitle || '',
    体用: r.chart?.tiyong ? `体${r.chart.tiyong.ti.name}${r.chart.tiyong.ti.element}／用${r.chart.tiyong.yong.name}${r.chart.tiyong.yong.element}·${r.chart.tiyong.relation.label}` : '',
    总评: r.reading?.grade?.label || '',
    分数: r.chart?.score?.total ?? null,
    谶: r.reading?.signature || '',
    复盘: r.review?.status || '',
    校勘数: (r.corrections || []).length,
  };
}

/**
 * 建工具集。
 * @param {object} p
 * @param {object} p.store server/store.mjs 的实例
 * @param {object} p.core  内核模块集合 { calendar, bagua, hexagram, divination, verdict, record, render, importer, trend, guaTiao, schema, migrate }
 * @param {object} [p.plugins] PluginHost 实例（`reload_plugins` 要用）
 * @param {string|Function} [p.permission] 权限等级，见 agent/permissions.mjs
 * @param {Array} [p.sources] 工具来源，见 agent/sources.mjs。
 *        每个来源形如 `{ id, name, tools() }`；来源贡献的工具**同样**走这一份
 *        权限表与确认闸门，不许绕过去。默认空数组（自检与不联网的场景就该只有内置工具）。
 */
export function createToolkit({ store, core, plugins = null, permission = DEFAULT_LEVEL, sources = [] }) {
  /** 工具自己检查依赖，缺了就报一句人话，而不是把栈丢给模型 */
  const requireStore = () => {
    if (!store) throw new Error('当前没有可用的卦录存储，这条操作做不了。');
  };
  const castOf = (a) => core.divination.cast({
    method: a.method || (a.hexagram ? 'manual' : 'numberAndTime'),
    numbers: a.numbers,
    localTime: a.localTime,
    longitude: a.longitude,
    latitude: a.latitude,
    placeName: a.placeName,
    useTrueSolarTime: a.useTrueSolarTime,
    movingFrom: a.movingFrom,
    hexagram: a.hexagram,
    movingPosition: a.movingPosition,
    question: a.question,
    category: a.category,
  });

  const CAST_PROPS = S({
    method: { type: 'string', enum: ['numberAndTime', 'twoNumbers', 'timeOnly', 'manual'], description: `起卦之法。numberAndTime＝一数＋时辰（默认）；twoNumbers＝两数；timeOnly＝年月日时；manual＝已知本卦与动爻。` },
    numbers: { type: 'array', items: { type: 'integer', minimum: 1 }, description: '报数。一数一时辰给 1 个；两数给 2 个；timeOnly 不用。' },
    localTime: { type: 'string', description: '起卦的钟表时间，格式 YYYY-MM-DD HH:mm。必填。' },
    placeName: { type: 'string', description: '地点名（如 兰州、上海）。用于取经度算真太阳时。' },
    longitude: { type: 'number', description: '东经度数。给了就以它为准，否则按 placeName 查表。' },
    useTrueSolarTime: { type: 'boolean', description: '是否按真太阳时定时辰。默认 true（推荐）。' },
    movingFrom: { type: 'string', enum: ['sum', 'number'], description: '动爻取法。sum＝数与时之和除六（常法，默认）；number＝仅以报数除六。' },
    hexagram: { type: 'string', description: 'method=manual 时的本卦，如「泽水困」「困」「47」「䷮」皆可。' },
    movingPosition: { type: 'integer', minimum: 1, maximum: 6, description: '动爻（自下而上第几爻）。' },
    question: { type: 'string', description: '所问之事。一事一占，单一、具体、可验证。' },
    category: { type: 'string', enum: CATEGORIES, description: '类别。' },
  });

  const tools = [
    {
      name: 'cast',
      title: '起卦（只看不入库）',
      description: '按梅花易数正法起一卦，返回卦象、体用生克、月令旺衰、吉凶评分与完整断语（谶／主／互／变／断／宜／忌／应期 + 通俗解）。不写入卦录。',
      parameters: { type: 'object', properties: CAST_PROPS, required: ['localTime'] },
      async handler(a) {
        const chart = castOf(a);
        const reading = core.verdict.interpret(chart);
        return chartBrief(chart, reading);
      },
    },
    {
      name: 'save_record',
      title: '起卦并存入卦录',
      description: '起一卦并落盘为一条卦录。参数与 cast 相同，另可给 title／narrative（原文）／tags，以及 background／plan／collation／qa 四项补充存录。返回值含新卦录 id。',
      parameters: S({
        type: 'object',
        properties: {
          ...CAST_PROPS,
          title: { type: 'string', description: '标题，可省。' },
          narrative: { type: 'string', description: '当初的解读原文，可省。' },
          background: { type: 'string', description: '求测人背景／动机／几件事的轻重，可省。' },
          plan: { type: 'string', description: '可执行方案，可省。' },
          collation: { type: 'string', description: '人工校勘说明（引擎算不出的措辞更正等），可省。' },
          qa: { type: 'string', description: '原文问答，约定以「问：」「答：」起行，可省。' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签。' },
          claimed: { type: 'object', description: '当初别人口头所述的卦（用于校勘），如 {ben,hu,bian,moving,tiyong}。', additionalProperties: true },
        },
        required: ['localTime'],
      }),
      async handler(a) {
        const id = core.record.makeId(a.localTime, store.ids());
        const mode = (a.method === 'manual' || a.hexagram) ? 'hexagram' : 'cast';
        const base = {
          id,
          title: a.title || '',
          category: a.category || '',
          question: a.question || '',
          narrative: a.narrative || '',
          background: a.background || '',
          plan: a.plan || '',
          collation: a.collation || '',
          qa: a.qa || '',
          claimed: a.claimed || null,
          tags: a.tags || [],
          origin: { kind: 'agent', label: 'AI 助手录入' },
        };
        const rec = mode === 'hexagram'
          ? core.record.buildFromHexagram({
            ...base, hexagram: a.hexagram, movingPosition: Number(a.movingPosition),
            localTime: a.localTime, longitude: a.longitude, placeName: a.placeName,
            useTrueSolarTime: a.useTrueSolarTime, numbers: a.numbers,
          })
          : core.record.buildRecord({
            ...base,
            cast: {
              method: a.method || 'numberAndTime', numbers: a.numbers, localTime: a.localTime,
              longitude: a.longitude, placeName: a.placeName, useTrueSolarTime: a.useTrueSolarTime,
              movingFrom: a.movingFrom, question: a.question, category: a.category,
            },
          });
        store.save(rec);
        return { 已入库: rec.id, ...recordBrief(rec) };
      },
    },
    {
      name: 'save_gua_tiao',
      title: '用「卦条」文本入库',
      description: '把一段符合「卦条 v1」格式的纯文本解析并入库，支持一次多条（用 --- 分隔）。卦条格式见 format_spec 工具。这是最稳妥的批量录入方式。',
      parameters: S({
        type: 'object',
        properties: { text: { type: 'string', description: '一段或多段卦条文本。' } },
        required: ['text'],
      }),
      async handler(a) {
        const blocks = core.guaTiao.parseGuaTiaoMany(a.text);
        const created = [];
        const failed = [];
        for (const b of blocks) {
          try {
            if (!b.ok) {
              failed.push({ 所缺: b.missing.join('、'), 卦: b.claimed.ben || '未定', 原因: '卦条信息不完整' });
              continue;
            }
            const id = core.record.makeId(b.fields.localTime, store.ids());
            const useHex = b.fields.method === 'manual' || !!b.claimed.ben;
            const base = {
              id,
              title: b.title || '',
              category: b.fields.category || '',
              question: b.fields.question || '',
              narrative: b.narrative || '',
              background: b.background || '',
              plan: b.plan || '',
              collation: b.collation || '',
              qa: b.qa || '',
              claimed: b.claimed,
              tags: b.tags,
              review: { status: b.review.status || '待应验', result: b.review.result || '', reviewedAt: null, log: [] },
              origin: { kind: 'gua-tiao', label: '卦条导入' },
            };
            const rec = useHex
              ? core.record.buildFromHexagram({
                ...base, hexagram: b.claimed.ben, movingPosition: Number(b.claimed.moving),
                localTime: b.fields.localTime, longitude: b.fields.longitude, placeName: b.fields.placeName,
                useTrueSolarTime: b.fields.useTrueSolarTime, numbers: b.fields.numbers,
              })
              : core.record.buildRecord({
                ...base,
                cast: {
                  method: b.fields.method, numbers: b.fields.numbers, localTime: b.fields.localTime,
                  longitude: b.fields.longitude, placeName: b.fields.placeName,
                  useTrueSolarTime: b.fields.useTrueSolarTime, movingFrom: b.fields.movingFrom,
                  question: b.fields.question, category: b.fields.category,
                },
              });
            store.save(rec);
            created.push(recordBrief(rec));
          } catch (err) {
            failed.push({ 卦: b.claimed.ben || '未定', 原因: err.message });
          }
        }
        return { 共解析: blocks.length, 已入库: created, 未入库: failed };
      },
    },
    {
      name: 'list_records',
      title: '列出卦录',
      description: '按关键词、类别、吉凶、复盘状态筛选卦录，返回摘要列表（按起卦时间倒序）。',
      parameters: S({
        type: 'object',
        properties: {
          q: { type: 'string', description: '关键词，搜标题／所问／原文／断语。' },
          category: { type: 'string', enum: CATEGORIES },
          grade: { type: 'string', enum: ['大吉', '吉', '中吉', '平', '小凶', '凶'] },
          review: { type: 'string', description: '复盘状态：待应验／应验中／已应验／未应验／已过期／无需应验。' },
          limit: { type: 'integer', minimum: 1, maximum: 100, description: '最多返回几条，默认 20。' },
        },
      }),
      async handler(a) {
        let items = store.list();
        if (a.category) items = items.filter((r) => r.category === a.category);
        if (a.grade) items = items.filter((r) => r.reading?.grade?.label === a.grade);
        if (a.review) items = items.filter((r) => r.review?.status === a.review);
        if (a.q) {
          const q = String(a.q).toLowerCase();
          items = items.filter((r) => JSON.stringify({
            t: r.title, q: r.question, n: r.narrative, c: r.chart, g: r.reading,
            bg: r.background, p: r.plan, col: r.collation, qa: r.qa,
          }).toLowerCase().includes(q));
        }
        const limit = Math.min(100, Number(a.limit) || 20);
        return { 总数: items.length, 返回: Math.min(limit, items.length), 卦录: items.slice(0, limit).map(recordBrief) };
      },
    },
    {
      name: 'get_record',
      title: '读一条卦录',
      description: '按 id 读取一条卦录的全部内容：卦象、断语、通俗解、校勘、复盘、原文、补充存录。',
      parameters: S({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }),
      async handler(a) {
        const r = store.get(a.id);
        if (!r) throw new Error(`未找到卦录 ${a.id}`);
        return {
          ...recordBrief(r),
          所问: r.question,
          背景: r.background || '',
          校勘: (r.corrections || []).map((x) => `${x.label}：原述「${x.stated}」→ 正法「${x.computed}」`),
          人工校勘: r.collation || '',
          断语: r.reading ? Object.fromEntries(r.reading.tone.map((t) => [t.label, t.text])) : null,
          谶: r.reading?.signature || '',
          通俗解: r.reading?.plain || null,
          方案: r.plan || '',
          复盘: r.review,
          原文: String(r.narrative || '').slice(0, 6000),
          原文问答: r.qa || '',
        };
      },
    },
    {
      name: 'update_record',
      title: '改卦录的元信息',
      description: '改标题、类别、所问、原文、补充存录（背景／方案／人工校勘／问答）、标签。不重算卦象。',
      parameters: S({
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          category: { type: 'string', enum: CATEGORIES },
          question: { type: 'string' },
          narrative: { type: 'string' },
          background: { type: 'string' },
          plan: { type: 'string' },
          collation: { type: 'string' },
          qa: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['id'],
      }),
      async handler(a) {
        const r = store.get(a.id);
        if (!r) throw new Error(`未找到卦录 ${a.id}`);
        const next = { ...r };
        for (const k of ['title', 'category', 'question', 'narrative', 'background', 'plan', 'collation', 'qa', 'tags']) {
          if (a[k] !== undefined) next[k] = a[k];
        }
        next.updatedAt = new Date().toISOString();
        store.save(core.record.normalizeRecord(next));
        return recordBrief(next);
      },
    },
    {
      name: 'update_review',
      title: '写复盘',
      description: '给一条卦录写复盘：状态、实况、追记。这是长期用下去最要紧的一步——卦准不准，全靠事后回看。',
      parameters: S({
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['待应验', '应验中', '已应验', '未应验', '已过期', '无需应验'] },
          result: { type: 'string', description: '实际发生了什么、卦在何处应了、何处没应。' },
          logText: { type: 'string', description: '追加一条追记。' },
          logAt: { type: 'string', description: '追记时间，如 2026-12-20。' },
        },
        required: ['id'],
      }),
      async handler(a) {
        const r = store.get(a.id);
        if (!r) throw new Error(`未找到卦录 ${a.id}`);
        const review = { ...(r.review || {}) };
        if (a.status) review.status = a.status;
        if (a.result !== undefined) review.result = a.result;
        if (a.status && ['已应验', '未应验', '已过期', '无需应验'].includes(a.status) && !review.reviewedAt) {
          review.reviewedAt = a.logAt || new Date().toISOString().slice(0, 10);
        }
        if (a.logText) {
          review.log = [...(review.log || []), { at: a.logAt || new Date().toISOString().slice(0, 10), text: a.logText }];
        }
        store.save(core.record.normalizeRecord({ ...r, review }));
        return { id: r.id, 复盘: review };
      },
    },
    {
      name: 'trend',
      title: '取走势数据',
      description: '返回卦气走势的时间序列（多领域叠加）：总评分、体用生克、变卦对体、体卦旺衰、体卦刚柔，或五行占比、分类别均值。用于回答「我最近运气走势如何」。',
      parameters: S({
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['fortune', 'element', 'category'], description: 'fortune＝吉凶诸线叠加；element＝五行占比；category＝各类别累计均值。' },
          domains: { type: 'array', items: { type: 'string', enum: ['score', 'relation', 'bian', 'tiWang', 'grade', 'tiYangRatio'] }, description: 'mode=fortune 时选哪些线。' },
          smooth: { type: 'integer', minimum: 1, maximum: 12, description: '移动平均窗口，1＝不平滑。' },
          rangeDays: { type: 'integer', minimum: 0, description: '只取最近 N 天，0＝全部。' },
          categories: { type: 'array', items: { type: 'string' }, description: '只看这些类别。' },
        },
      }),
      async handler(a) {
        const t = core.trend.buildTrend(store.list(), a);
        return {
          点位数: t.points,
          时间跨度天数: t.spanDays,
          是否时间轴: t.useTimeAxis,
          说明: t.notes,
          时间点: t.xLabels.map((x) => x.full),
          系列: t.series.map((s) => ({ 名称: s.name, 量程: s.scale, 数值: s.values })),
          卦录: t.records,
          摘要: core.trend.trendSummary(store.list()),
        };
      },
    },
    {
      name: 'stats',
      title: '总览统计',
      description: '卦录总数、类别分布、吉凶分布、体用分布、卦象频次、复盘状态分布，以及走势摘要。',
      parameters: S({ type: 'object', properties: {} }),
      async handler() {
        return { ...store.stats(), 走势摘要: core.trend.trendSummary(store.list()) };
      },
    },
    {
      name: 'hexagram_lookup',
      title: '查卦典',
      description: '查六十四卦的卦辞、大象辞、卦德、六爻爻辞。可传卦名、卦序、卦符或关键词。',
      parameters: S({
        type: 'object',
        properties: { query: { type: 'string', description: '如「革」「49」「泽火革」「䷰」「改命」' } },
        required: ['query'],
      }),
      async handler(a) {
        const lib = core.hexagram.library();
        const q = String(a.query).trim();
        let g = lib.find(q);
        if (!g) {
          // 全文检索：卦辞、大象辞、卦德、关键词、六爻爻辞都算
          const yaoOf = (x) => Array.from({ length: 6 }, (_, i) => lib.yaoText(x.id, i + 1)).join('');
          const hits = lib.all().filter((x) => `${x.guaci}${x.xiang}${x.coreMeaning}${(x.keywords || []).join('')}${yaoOf(x)}`.includes(q));
          if (hits.length === 1) g = hits[0];
          else if (hits.length > 1) {
            return {
              匹配多卦: hits.map((x) => `${x.id} ${x.fullName}`),
              提示: '关键词命中多卦，请改用卦名或卦序再查。',
            };
          }
        }
        if (!g) throw new Error(`卦典里找不到「${q}」（卦名、卦序、卦符、卦辞、爻辞、卦德都可以搜）`);
        const yaoci = [];
        for (let i = 1; i <= 6; i += 1) yaoci.push(lib.yaoText(g.id, i));
        return {
          卦序: g.id, 卦名: g.fullName, 卦符: g.symbol, 上卦: g.upper, 下卦: g.lower,
          卦宫: g.palace, 卦德: g.coreMeaning, 吉凶: g.fortune,
          卦辞: g.guaci, 大象辞: g.xiang, 用世之道: g.advice,
          爻辞: yaoci, 用: lib.yongText(g.id) || undefined,
        };
      },
    },
    {
      name: 'parse_import',
      title: '解析任意起卦文本',
      description: '把一段非结构化的起卦文本（例如从别处复制的对话）解析成候选卦录，返回识别到的卦、爻、时间、报数。用于确认能否入库，不落盘。',
      parameters: S({ type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }),
      async handler(a) {
        const blocks = core.importer.parseMany(a.text);
        return {
          候选数: blocks.length,
          候选: blocks.map((b) => ({
            本卦: b.claimed.ben, 互卦: b.claimed.hu, 变卦: b.claimed.bian, 动爻: b.claimed.moving,
            起卦时间: b.fields.localTime, 地点: b.fields.placeName, 报数: b.fields.numbers,
            体用: b.tiyongText, 识别度: `${b.confidence}%`, 所缺: b.missing,
          })),
        };
      },
    },
    {
      name: 'format_spec',
      title: '读格式规范',
      description: '返回「卦条 v1」的完整格式说明与示例，以及卦录 JSON 的字段要求。写新导入之前先读这个。',
      parameters: S({ type: 'object', properties: {} }),
      async handler() {
        return {
          卦条格式: {
            说明: '一行一个字段的纯文本；多条用一行 --- 分隔。这是保证稳定的导入契约。',
            示例: core.guaTiao.template(),
            字段别名: core.guaTiao.FIELD_ALIASES,
            起卦法中文名: core.guaTiao.METHOD_LABELS,
          },
          卦录JSON: {
            版本: core.migrate.CURRENT_SCHEMA,
            说明: '完整结构见 schema/record.schema.json；用 tools/validate.mjs 校验。',
            必填: recordRequired(),
          },
          类别取值: CATEGORIES,
          复盘状态: ['待应验', '应验中', '已应验', '未应验', '已过期', '无需应验'],
        };
      },
    },

    /* ============================================================
     * 以下让助手够得着「程序自己能做的事」——
     * 删、恢复、导出、校勘、看插件、热载、改设置。
     * 权限不够时会在 call() 里被拦，不会走到 handler。
     * ========================================================== */

    {
      name: 'delete_record',
      title: '删除卦录（移入回收目录）',
      description: '把一条卦录移入回收目录。**这是软删，可以用 list_trash + restore_record 恢复**，不会真的抹掉内容。第一次调用只会拿到「待确认」，需要人来放行。',
      parameters: S({
        type: 'object',
        properties: { id: { type: 'string', description: '卦录 id（先用 list_records 拿）。' } },
        required: ['id'],
      }),
      destructive: true,
      confirmText: (a) => `把卦录「${a.id}」移入回收目录（可恢复，不是彻底删除）`,
      async handler(a) {
        requireStore();
        const rec = store.get(a.id);
        if (!rec) throw new Error(`没有 id 为「${a.id}」的卦录。先用 list_records 看一遍。`);
        // 永远软删：这个工具**不接受** hard 参数，硬删只能由用户在界面上主动做
        store.remove(a.id, false);
        return {
          已移入回收目录: a.id,
          标题: rec.title || '',
          可恢复: true,
          怎么恢复: '用 list_trash 拿到文件名，再用 restore_record 恢复。',
        };
      },
    },
    {
      name: 'list_trash',
      title: '看回收目录',
      description: '列出被删掉的卦录。删除是软删——它们进了回收目录，没有真的消失。返回文件名、标题与所问。',
      parameters: S({ type: 'object', properties: {} }),
      async handler() {
        requireStore();
        const dir = store.trashDir;
        if (!dir || !fs.existsSync(dir)) return { 回收条目: 0, 条目: [] };
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse();
        const items = files.map((f) => {
          try {
            const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
            return { 文件: f, 标题: r.title || '', 所问: r.cast?.question || '' };
          } catch {
            // 坏文件也列出来，让用户知道它坏了，而不是静默跳过
            return { 文件: f, 标题: '（这份读不出来，可能已损坏）', 所问: '' };
          }
        });
        return { 回收条目: items.length, 条目: items.slice(0, 50) };
      },
    },
    {
      name: 'restore_record',
      title: '从回收目录恢复卦录',
      description: '把回收目录里的某条卦录恢复回卦录台。参数 file 用 list_trash 给出的文件名。',
      parameters: S({
        type: 'object',
        properties: { file: { type: 'string', description: 'list_trash 返回的「文件」字段。' } },
        required: ['file'],
      }),
      async handler(a) {
        requireStore();
        // 只取 basename，杜绝 ../ 之类跑到回收目录外面去
        const name = path.basename(String(a.file || ''));
        const src = path.join(store.trashDir, name);
        if (!name || !fs.existsSync(src)) throw new Error(`回收目录里没有「${name}」。先用 list_trash 看一遍。`);
        const rec = JSON.parse(fs.readFileSync(src, 'utf8'));
        if (!rec?.id) throw new Error('这份回收文件缺少 id，恢复不了。');
        if (store.has(rec.id)) throw new Error(`卦录 ${rec.id} 已经存在，先处理重复再恢复。`);
        store.save(rec); // 原样写回，不做归一化——用户的原文不动
        fs.rmSync(src, { force: true });
        return { 已恢复: rec.id, 标题: rec.title || '' };
      },
    },
    {
      name: 'audit_records',
      title: '通盘校勘',
      description: '把卦录逐条用引擎重算，列出「当初记的卦象」与「正法算出的卦象」不一致之处。纯只读，不改任何数据。',
      parameters: S({
        type: 'object',
        properties: { id: { type: 'string', description: '只看某一条，可省。' } },
      }),
      async handler(a) {
        requireStore();
        const list = a.id ? [store.get(a.id)].filter(Boolean) : store.list();
        if (a.id && !list.length) throw new Error(`没有 id 为「${a.id}」的卦录。`);
        const rows = list.map((r) => ({
          id: r.id,
          标题: r.title || '',
          差异: core.record.audit(r.claimed, r.chart),
        }));
        return {
          检查条数: list.length,
          有差异条数: rows.filter((x) => x.差异.length).length,
          明细: rows.filter((x) => x.差异.length) || rows.slice(0, 1),
        };
      },
    },
    {
      name: 'check_data',
      title: '检查数据健康',
      description: '逐条按 schema 校验卦录、检查卦典与爻辞是否齐全、统计回收与备份占用。纯只读，用来回答「我的数据还好吗」。',
      parameters: S({ type: 'object', properties: {} }),
      async handler() {
        requireStore();
        // 用 schema 的 required 现读出来的那份必填表做检查，
        // 不引第三方校验器，也不指望 server 那一层的 schema 对象在这儿可用
        const required = recordRequired();
        const problems = [];
        let ok = 0;
        for (const r of store.list()) {
          const miss = required.filter((k) => r[k] === undefined || r[k] === null);
          if (miss.length) problems.push({ id: r.id, 问题: `缺字段：${miss.join('、')}` });
          else if (!r.chart?.ben?.fullName) problems.push({ id: r.id, 问题: '卦象不完整（少了本卦）' });
          else if (r.schema !== core.migrate.CURRENT_SCHEMA) problems.push({ id: r.id, 问题: `结构版本是 v${r.schema}，当前是 v${core.migrate.CURRENT_SCHEMA}（跑一次迁移即可）` });
          else ok += 1;
        }
        const lib = core.hexagram.library();
        const dirCount = (d) => (d && fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).length : 0);
        const trashDir = store.trashDir;
        return {
          格式正确: ok,
          格式有问题: problems.length,
          问题明细: problems.slice(0, 20),
          卦典: { 卦数: lib.all().length, 爻辞卦数: core.hexagram.library().withYaoci ? core.hexagram.library().withYaoci() : undefined },
          回收条目: dirCount(trashDir),
          备份条目: dirCount(path.join(path.dirname(trashDir || '.'), 'backups')),
        };
      },
    },
    {
      name: 'list_plugins',
      title: '看已装插件',
      description: '列出 data/plugins/ 下的插件及其状态（是否载入、启停、有没有报错）。',
      parameters: S({ type: 'object', properties: {} }),
      async handler() {
        if (!plugins) return { 说明: '当前环境没有插件宿主（命令行工具里不带插件）。' };
        const m = plugins.manifest ? plugins.manifest() : [];
        return {
          插件数: m.length,
          插件: m.map((p) => ({ id: p.id, 名称: p.name, 版本: p.version, 已载入: p.loaded, 启用: p.enabled })),
          错误: (plugins.errors?.() || []).map((e) => `${e.plugin || ''}: ${e.message || e}`),
        };
      },
    },
    {
      name: 'reload_plugins',
      title: '热载插件',
      description: '重新载入 data/plugins/ 下的全部插件，改完插件代码不用重启程序。',
      parameters: S({ type: 'object', properties: {} }),
      async handler() {
        if (!plugins) throw new Error('当前环境没有插件宿主，热载不了。');
        await plugins.loadAll();
        const m = plugins.manifest ? plugins.manifest() : [];
        return { 已热载: m.filter((p) => p.loaded).length, 插件: m.map((p) => `${p.id}${p.loaded ? '' : '（未载入）'}`) };
      },
    },
    {
      name: 'update_config',
      title: '改默认设置',
      description: '改「默认地点、默认经度纬度、默认类别、是否用真太阳时」这类起卦默认值。**不能**改模型密钥、权限等级与插件开关。',
      parameters: S({
        type: 'object',
        properties: {
          defaultPlace: { type: 'string', description: '默认地点名（须是内置地点之一）。' },
          defaultLongitude: { type: 'number', description: '默认经度（东经为正）。' },
          defaultLatitude: { type: 'number', description: '默认纬度（北纬为正）。' },
          defaultCategory: { type: 'string', enum: CATEGORIES, description: '默认类别。' },
          useTrueSolarTime: { type: 'boolean', description: '起卦时是否默认按真太阳时校正。' },
        },
      }),
      destructive: true,
      confirmText: (a) => `修改默认设置：${Object.entries(a).map(([k, v]) => `${k}=${v}`).join('、')}`,
      async handler(a) {
        requireStore();
        // 白名单：只允许这几个键。**绝不能**让模型摸到 agent/apiKey/plugins/permission——
        // 那等于让它自己给自己提权。
        const ALLOWED = ['defaultPlace', 'defaultLongitude', 'defaultLatitude', 'defaultCategory', 'useTrueSolarTime'];
        const patch = {};
        const rejected = [];
        for (const [k, v] of Object.entries(a || {})) {
          if (ALLOWED.includes(k)) patch[k] = v;
          else rejected.push(k);
        }
        if (!Object.keys(patch).length) {
          throw new Error(`没有可改的字段。允许改的只有：${ALLOWED.join('、')}。${rejected.length ? `你给的 ${rejected.join('、')} 不在其中。` : ''}`);
        }
        store.setConfig(patch);
        return { 已改: patch, 被拒: rejected.length ? `${rejected.join('、')} 不允许由助手修改` : undefined };
      },
    },
  ];

  /**
   * 工具 → 所需权限。**集中一张表**，好处是一眼能审完整个暴露面：
   * 谁只读、谁能写、谁能删，全在这儿，不用翻二十个工具定义。
   *
   * 新加工具若忘了登记，会落到 'full'（最保守的方向），并被 check.mjs 断言抓出来。
   * **来源贡献的工具不走这张表**——它们必须自己声明 `permission`，见下方 sourceTools()。
   */
  const TOOL_PERMISSION = {
    // 只读：看一眼，不改任何东西
    cast: 'read',
    list_records: 'read',
    get_record: 'read',
    trend: 'read',
    stats: 'read',
    hexagram_lookup: 'read',
    format_spec: 'read',
    parse_import: 'read',
    audit_records: 'read',
    check_data: 'read',
    list_plugins: 'read',
    // 可写：动手记
    save_record: 'write',
    save_gua_tiao: 'write',
    update_record: 'write',
    update_review: 'write',
    // 可删：能删东西（都是软删或可撤回）
    delete_record: 'delete',
    list_trash: 'delete',
    restore_record: 'delete',
    // 全权：管程序本身
    reload_plugins: 'full',
    update_config: 'full',
  };

  for (const t of tools) {
    t.permission = TOOL_PERMISSION[t.name] || 'full';
    t.destructive = !!t.destructive;
    t.source = 'builtin';
    t.sourceName = '内置';
  }

  /**
   * 来源工具：**每次取用时现算**。
   *
   * 为什么不定死成一个数组：来源可以按当前配置决定「现在有没有这个工具」——
   * 比如联网工具在设置里被停用后，它就该从模型看到的清单里**消失**，
   * 而不是留在那儿、等到调用时才报一句「已停用」。模型看不到，就不会去调。
   */
  const sourceTools = () => sources.flatMap((s) => {
    let list = [];
    try {
      list = typeof s.tools === 'function' ? s.tools() : (s.tools || []);
    } catch (err) {
      // 来源自己出错不该拖垮整个工具集
      console.warn?.(`[tools] 来源 ${s.id} 取工具失败：${err.message}`);
      return [];
    }
    return (list || []).map((t) => ({
      ...t,
      // 来源**必须**自己声明权限；没声明就按最保守的 full 处理
      permission: t.permission || 'full',
      destructive: !!t.destructive,
      requireConfirm: !!t.requireConfirm,
      confirmKind: t.confirmKind || (t.destructive ? 'destructive' : 'confirm'),
      source: s.id,
      sourceName: s.name || s.id,
    }));
  });

  const allTools = () => [...tools, ...sourceTools()];
  const byNameOf = () => new Map(allTools().map((t) => [t.name, t]));

  /**
   * 权限等级**惰性读**。因为设置页可以随时改等级，
   * 若在构造时烧死，用户改完得重启才生效——那是 bug 不是特性。
   * `permission` 既可传字符串，也可传 () => string。
   */
  const level = () => normalizeLevel(typeof permission === 'function' ? permission() : permission);

  /** 还需不需要用户点头：破坏性（会改数据）与联网（会出网）是两回事，名头也分开 */
  const confirmSuffix = (t) => {
    if (t.destructive) return '（执行前需要用户确认）';
    if (t.requireConfirm) return '（每次调用都需要用户确认）';
    return '';
  };

  return {
    get tools() { return allTools(); },
    get byName() { return byNameOf(); },
    /** 当前权限等级 */
    get permission() { return level(); },
    /** 工具 → 权限 的完整映射（界面与自检要看）。
     *  内置工具取自 TOOL_PERMISSION，来源工具取自它们自己的声明——
     *  两边合成一张表，才能保证「工具集里有谁，表里就有谁」。 */
    permissionMap: () => ({
      ...TOOL_PERMISSION,
      ...Object.fromEntries(sourceTools().map((t) => [t.name, t.permission])),
    }),
    /** OpenAI function calling 格式。只把**当前等级够得着**的工具给模型——
     *  够不着的压根不出现，模型就不会去调、也就不会念一堆「我没权限」。 */
    openaiTools() {
      return allTools().filter((t) => allows(level(), t.permission)).map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: `【${t.title}】${t.description}${confirmSuffix(t)}`,
          parameters: t.parameters,
        },
      }));
    },
    /** MCP tools/list 格式 */
    mcpTools() {
      return allTools().filter((t) => allows(level(), t.permission)).map((t) => ({
        name: t.name,
        description: `【${t.title}】${t.description}${confirmSuffix(t)}`,
        inputSchema: t.parameters,
      }));
    },
    /** 给界面看的清单（带上权限、来源与要不要确认，界面据此分组显示） */
    describe() {
      return allTools().map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        permission: t.permission,
        permissionName: levelById(t.permission).name,
        destructive: t.destructive,
        requireConfirm: !!t.requireConfirm,
        confirmKind: t.confirmKind || null,
        source: t.source || 'builtin',
        sourceName: t.sourceName || '内置',
        allowed: allows(level(), t.permission),
      }));
    },
    /**
     * 执行一个工具。任何失败都返回 {ok:false}，不抛异常——
     * 调用方（模型／MCP／界面）都要能拿到结构化错误。
     *
     * 两道闸门：
     *   1. **权限**：等级不够直接拒，并把「怎么放开」写进错误里（模型会照念给用户）。
     *   2. **二次确认**：破坏性工具第一次调用只返回 needsConfirm，不执行。
     *      由人放行（界面确认框）或调用方显式传 `confirm: true` 才真做。
     */
    async call(name, args = {}) {
      const map = byNameOf();
      const t = map.get(name);
      if (!t) {
        return {
          ok: false, tool: name, ms: 0,
          error: `没有名为「${name}」的工具。可用工具：${[...map.keys()].join('、')}`,
        };
      }

      if (!allows(level(), t.permission)) {
        return {
          ok: false, tool: name, ms: 0, denied: true,
          needsPermission: t.permission,
          error: denyMessage(t.name, level, t.permission),
        };
      }

      // 两道确认来源合并在这一处：破坏性（会改你的数据）与 requireConfirm（比如联网会出网）。
      // 但 `kind` 要分开带出去——界面上「会改动数据」和「会访问外部网址」是两种后果，
      // 混成一个「危险操作」会让用户误以为联网也能撤回。
      if ((t.destructive || t.requireConfirm) && args.confirm !== true) {
        return {
          ok: false, tool: name, ms: 0, needsConfirm: true,
          confirm: {
            kind: t.confirmKind || (t.destructive ? 'destructive' : 'confirm'),
            tool: t.name,
            title: t.title,
            summary: t.confirmText ? t.confirmText(args) : `${t.title}：${JSON.stringify(args)}`,
            args,
          },
          error: `「${t.title}」需要用户确认后才执行。已经向用户发起确认，请不要重复调用，改为告诉用户你在等他确认。`,
        };
      }

      const t0 = Date.now();
      try {
        const clean = { ...(args || {}) };
        delete clean.confirm; // 确认标记只是闸门，不往 handler 里传
        const result = await t.handler(clean);
        return { ok: true, tool: name, ms: Date.now() - t0, result, permission: t.permission };
      } catch (err) {
        return { ok: false, tool: name, ms: Date.now() - t0, error: err.message, permission: t.permission };
      }
    },
  };
}
