/**
 * 问心卦 · 卦录（记录）模型
 * ------------------------------------------------------------
 * 一条卦录 = 「起卦输入（可重算）」+「卦局快照」+「断语快照」+「原文」+「复盘」。
 *
 * 设计取向：
 *   - inputs 是唯一真源，任何一条卦录都能被重算；
 *   - chart / reading 是快照，保证旧卦录在断语引擎升级后仍然稳定可读；
 *   - claimed 保存「当初别人是怎么说的」，与重算结果对照即得「校勘」。
 */

import { cast, buildChart, inferMovingFrom } from './divination.mjs';
import { interpret, normalizeCategory, CATEGORIES } from './verdict.mjs';
import { library, sixLines } from './hexagram.mjs';
import { calendarInfo } from './calendar.mjs';
import { computeYingqi } from './yingqi.mjs';

export const SCHEMA_VERSION = 3;

export const REVIEW_STATUS = ['待应验', '应验中', '已应验', '未应验', '已过期', '无需应验'];

/** 'YYYY-MM-DD HH:mm' → 用作 id 前缀 */
export function stampOf(localTime) {
  const m = String(localTime || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `${m[1]}${m[2].padStart(2, '0')}${m[3].padStart(2, '0')}${m[4].padStart(2, '0')}${m[5].padStart(2, '0')}`;
}

let seqCache = new Map();

/** 生成可读 id：YYYYMMDDHHmm-序号 */
export function makeId(localTime, existing = []) {
  const stamp = stampOf(localTime);
  const used = new Set([...existing, ...seqCache.keys()]);
  let n = 1;
  while (used.has(`${stamp}-${String(n).padStart(2, '0')}`)) n += 1;
  const id = `${stamp}-${String(n).padStart(2, '0')}`;
  seqCache.set(id, true);
  return id;
}

export function resetSeqCache() {
  seqCache = new Map();
}

/**
 * 校勘：把「当初所述的卦」与「依正法重算的卦」逐项对照。
 * 这是本程序相对聊天记录最实在的一处增值——历次口头解读里的笔误会被照出来。
 */
export function audit(claimed, chart) {
  const out = [];
  if (!claimed) return out;
  const lib = library();

  /** 以卦典为准比对卦名：认不出的不报，避免误伤 */
  const cmpHex = (field, label, stated, computed, note) => {
    if (!stated) return;
    const a = lib.find(String(stated).replace(/[（(].*?[)）]/g, '').trim());
    const b = lib.find(computed);
    if (!a || !b) return;
    if (a.id !== b.id) out.push({ field, label, stated: String(stated).trim(), computed: b.fullName, note });
  };

  cmpHex('ben', '本卦', claimed.ben, chart.ben.fullName, '本卦与重算不符，请核对起卦之数与时辰。');
  cmpHex('hu', '互卦', claimed.hu, chart.hu.fullName, '互卦取「二三四爻为下、三四五爻为上」，此处原述有误，已按正法改正。');
  cmpHex('bian', '变卦', claimed.bian, chart.bian.fullName, '变卦由动爻反覆而得，此处原述有误，已按正法改正。');

  if (claimed.moving && Number(claimed.moving) !== Number(chart.moving.position)) {
    out.push({
      field: 'moving', label: '动爻', stated: `第${claimed.moving}爻`,
      computed: `第${chart.moving.position}爻`,
      note: '动爻取法不同（有「数与时之和除六」与「仅以报数除六」两说），此处已按所记取法还原。',
    });
  }

  if (claimed.tiyong && chart.tiyong) {
    const stated = String(claimed.tiyong);
    const statedTi = stated.match(/体卦?\s*([乾兑离震巽坎艮坤])/);
    const statedYong = stated.match(/用卦?\s*([乾兑离震巽坎艮坤])/);
    const tiOk = statedTi ? statedTi[1] === chart.tiyong.ti.name : true;
    const yongOk = statedYong ? statedYong[1] === chart.tiyong.yong.name : true;
    if (!tiOk || !yongOk) {
      out.push({
        field: 'tiyong', label: '体用', stated,
        computed: `体${chart.tiyong.ti.name}${chart.tiyong.ti.element}（${chart.tiyong.ti.position}）、用${chart.tiyong.yong.name}${chart.tiyong.yong.element}（${chart.tiyong.yong.position}），${chart.tiyong.relation.label}`,
        note: '体用之法定「动爻所在之卦为用，另一卦为体」；此处原述与正法不同，已按正法改正'
          + '（若两卦同五行，吉凶结论不受影响）。',
      });
    }
  }
  return out;
}

/**
 * 由起卦输入构造完整卦录（未落盘）。
 * @param {object} p
 * @param {object} p.cast      传给 core/divination.cast 的输入
 * @param {object} [p.claimed] 当初所述的卦（用于校勘）
 */
export function buildRecord(p) {
  // 别人给的卦常只写「报数、时间、动爻」而不说用哪一路取法。若所述动爻只与
  // 「仅以报数除六」吻合，就据此反推取法，忠实复现原卦，而不是误记成校勘。
  let castInput = p.cast;
  if (castInput && castInput.method !== 'manual' && p.claimed?.moving && !castInput.movingFrom) {
    const mf = inferMovingFrom(castInput, p.claimed.moving);
    if (mf !== castInput.movingFrom) castInput = { ...castInput, movingFrom: mf };
  }
  const chart = castInput ? cast(castInput) : buildChart(p.chartInput);
  const reading = interpret(chart);
  const localTime = chart.inputs.localTime;
  return normalizeRecord({
    schema: SCHEMA_VERSION,
    id: p.id || null,
    title: p.title || '',
    category: normalizeCategory(p.cast?.category || p.category),
    question: p.cast?.question || p.question || '',
    cast: chart.inputs,
    chart,
    reading,
    // 应期：与断语「应期」那一段同源，但量化成区间，好给走势图落点用
    yingqi: computeYingqi(chart, { from: localTime }),
    narrative: p.narrative || '',
    narrativeHtml: p.narrativeHtml || '',
    background: p.background || '',
    plan: p.plan || '',
    collation: p.collation || '',
    qa: p.qa || '',
    origin: p.origin || { kind: 'cast', label: '本机起卦' },
    claimed: p.claimed || null,
    corrections: audit(p.claimed, chart),
    review: p.review || { status: '待应验', result: '', reviewedAt: null, log: [] },
    tags: p.tags || [],
    source: p.source || null,
  });
}

/** 由「本卦 + 动爻」直接构造（导入旧卦、手工补录都用这条） */
export function buildFromHexagram({ hexagram, movingPosition, ...rest }) {
  const lib = library();
  const h = typeof hexagram === 'object' && hexagram.upper
    ? hexagram
    : lib.find(hexagram);
  if (!h) throw new Error(`无法识别卦名：${hexagram}`);
  const lines = h.lines || sixLines(h.upper, h.lower);
  const cal = rest.calendar || calendarInfo({
    localTime: rest.localTime,
    longitude: rest.longitude,
    latitude: rest.latitude,
    placeName: rest.placeName,
  });
  const chartInput = {
    method: 'manual',
    inputs: {
      method: 'manual',
      numbers: rest.numbers || [],
      localTime: rest.localTime,
      useTrueSolarTime: rest.useTrueSolarTime !== false,
      movingFrom: 'manual',
      longitude: rest.longitude ?? null,
      latitude: rest.latitude ?? null,
      placeName: rest.placeName || '',
      hexagram: h.fullName,
      movingPosition,
      question: rest.question || '',
      category: rest.category || '',
      notes: rest.notes || [],
    },
    calendar: cal,
    casting: {
      steps: [
        `本卦定为 ${h.fullName}${h.symbol}（上${h.upper}下${h.lower}）`,
        `动爻定为第 ${movingPosition} 爻（自下而上）`,
      ],
      upperName: h.upper,
      lowerName: h.lower,
      movingNumber: movingPosition,
      hourZhi: cal?.trueHourZhi || '',
      hourNumber: cal?.trueHourNumber || 0,
    },
    lines,
    movingPosition,
  };
  return buildRecord({ ...rest, chartInput });
}

/** 用 inputs 重算一条卦录（断语引擎升级后可用） */
export function recompute(record) {
  const chart = cast(record.cast);
  const reading = interpret(chart);
  return normalizeRecord({
    ...record,
    chart,
    reading,
    // 重算就是把引擎的当前输出重新定格，应期也是引擎输出的一部分，一并更新。
    // 注意：`reading` 快照被替换是「用户主动点重算」的结果，不是引擎升级时自动改的。
    yingqi: computeYingqi(chart, { from: chart.inputs?.localTime || record.cast?.localTime }),
    corrections: audit(record.claimed, chart),
    updatedAt: new Date().toISOString(),
    revisionCount: (record.revisionCount || 0) + 1,
  });
}

/** 归一化 + 补齐缺省字段，保证落盘的记录结构稳定 */
export function normalizeRecord(raw) {
  const now = new Date().toISOString();
  const rec = {
    schema: SCHEMA_VERSION,
    id: raw.id || '',
    title: raw.title || defaultTitle(raw),
    category: raw.category && CATEGORIES.includes(raw.category) ? raw.category : '其他',
    question: raw.question || '',
    cast: raw.cast || {},
    chart: raw.chart || null,
    reading: raw.reading || null,
    // 应期区间：由 chart 派生，可被用户手改（改过则 source 记为 'manual'）
    yingqi: raw.yingqi || null,
    narrative: raw.narrative || '',
    narrativeHtml: raw.narrativeHtml || '',
    // 补充存录：把「完整占问」里那些引擎算不出的东西存下来（背景、方案、问答、人工校勘）。
    // 与 claimed／corrections 分开——那两项是「自动校勘」，这里是人的话。
    background: raw.background || '',
    plan: raw.plan || '',
    collation: raw.collation || '',
    qa: raw.qa || '',
    origin: raw.origin || { kind: 'cast', label: '本机起卦' },
    claimed: raw.claimed || null,
    corrections: Array.isArray(raw.corrections) ? raw.corrections : [],
    review: {
      status: REVIEW_STATUS.includes(raw.review?.status) ? raw.review.status : '待应验',
      result: raw.review?.result || '',
      reviewedAt: raw.review?.reviewedAt || null,
      log: Array.isArray(raw.review?.log) ? raw.review.log : [],
    },
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    source: raw.source || null,
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
    revisionCount: raw.revisionCount || 0,
  };
  return rec;
}

function defaultTitle(raw) {
  const q = String(raw.question || '').trim();
  if (q) return q.length > 24 ? `${q.slice(0, 24)}…` : q;
  const b = raw.chart?.ben;
  return b ? `${b.fullName}之占` : '未题之占';
}

/** 卦录摘要（列表用，避免整包传输） */
export function summarize(record) {
  const c = record.chart || {};
  return {
    id: record.id,
    title: record.title,
    category: record.category,
    question: record.question,
    localTime: record.cast?.localTime || '',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    grade: record.reading?.grade || c.score?.grade || null,
    score: c.score?.total ?? null,
    signature: record.reading?.signature || '',
    ben: c.ben ? { name: c.ben.name, fullName: c.ben.fullName, symbol: c.ben.symbol } : null,
    hu: c.hu ? { fullName: c.hu.fullName, symbol: c.hu.symbol } : null,
    bian: c.bian ? { fullName: c.bian.fullName, symbol: c.bian.symbol } : null,
    moving: c.moving ? { position: c.moving.position, yaoTitle: c.moving.yaoTitle } : null,
    tiyong: c.tiyong ? {
      ti: `${c.tiyong.ti.name}${c.tiyong.ti.element}`,
      yong: `${c.tiyong.yong.name}${c.tiyong.yong.element}`,
      relation: c.tiyong.relation.label,
    } : null,
    review: record.review,
    origins: record.origin?.kind || 'cast',
    correctionCount: (record.corrections || []).length,
    tags: record.tags,
  };
}
