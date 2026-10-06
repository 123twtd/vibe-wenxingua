/**
 * 问心卦 · 应期推算
 * ------------------------------------------------------------
 * 「什么时候见结果」——梅花易数定应期，古人用过好几路办法。
 * 这里把可算的三路合起来，**与断语里「应期」那一段用同一套规矩**，
 * 免得同一卦在详情页说「须待巳午月」、在走势图上又画到别处去。
 *
 * 断语引擎的规矩（core/verdict.mjs 的 timingFor）是两句：
 *   1. **动爻之位定时段**：初爻在旬日，上爻逾年；
 *   2. **体气得令则应提前**：旺相则不至久留，用「提前一档」的窗口；
 *      休囚死则气犹未至，**须待体卦五行得令之月**。
 *
 * 这里照抄这两句，再补两处微调（都是乘性，不做加法——加法会让某一项
 * 在极端值处把其它项吃掉）：
 *   3. **体用生克定顺逆**：用生体来得快，体生用与用克体都要拖；
 *   4. **卦数**：体用先天数之和越大，事体越重，稍缓。
 *
 * 输出的 `basis` 逐项记下依据，界面上摊开给人看——
 * 一个算不出理由的应期，和随口一说没区别。
 */

import { TRIGRAMS } from './bagua.mjs';

/** 体气得令时，动爻之位 → 天数（对应断语的「提前一档」窗口） */
const FIT_DAYS = { 1: 10, 2: 20, 3: 30, 4: 45, 5: 90, 6: 180 };

/** 体气未至时，动爻之位 → 在「得令之月」基础上的伸缩 */
const POSITION_SPAN = { 1: 0.85, 2: 0.9, 3: 1.0, 4: 1.1, 5: 1.25, 6: 1.4 };

/** 体用生克 → 顺逆系数 */
const RELATION_FACTOR = {
  yong_sheng_ti: 0.8,   // 用生体：有人来助，来得顺
  bihe: 0.9,            // 比和：同气相求
  ti_ke_yong: 1.0,      // 体克用：制得住，按常速
  ti_sheng_yong: 1.15,  // 体生用：我在耗，拖着
  yong_ke_ti: 1.3,      // 用克体：受制于人，更慢
  unknown: 1.0,
};

/** 得气之月支（与 verdict.mjs 的 ELEMENT_MONTHS 同一张表） */
const ELEMENT_MONTHS = {
  木: ['寅', '卯'], 火: ['巳', '午'], 土: ['辰', '未', '戌', '丑'],
  金: ['申', '酉'], 水: ['亥', '子'],
};

/** 月支 → 大致对应的阳历月（节气月与阳历月相差不过一句） */
const ZHI_TO_MONTH = {
  寅: 2, 卯: 3, 辰: 4, 巳: 5, 午: 6, 未: 7,
  申: 8, 酉: 9, 戌: 10, 亥: 11, 子: 12, 丑: 1,
};

/** 刻度：把天数说成人话 */
const HORIZONS = [
  { max: 21, id: 'near', name: '近期', unit: '以日计', note: '十天半月之内就有动静。' },
  { max: 70, id: 'mid', name: '中期', unit: '以旬计', note: '一两个月内见分晓。' },
  { max: 200, id: 'far', name: '较远', unit: '以月计', note: '半年上下，须过一两个节令。' },
  { max: Infinity, id: 'long', name: '长期', unit: '以季计', note: '一年上下，非一朝一夕之功。' },
];

const DAY = 86400000;

/** 天数 → 远近分档（小六壬的应期也走这一张表，免得两处口径不一） */
export function horizonFor(maxDays) {
  return HORIZONS.find((h) => maxDays <= h.max) || HORIZONS[HORIZONS.length - 1];
}

function tsOf(localTime) {
  const m = String(localTime || '').match(/(\d{4})\D(\d{1,2})\D(\d{1,2})\D(\d{1,2})\D(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
}

const fmtDate = (ts) => {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** 先天数：乾一兑二离三震四巽五坎六艮七坤八 */
export function innateNumberOf(name) {
  const t = TRIGRAMS[name];
  return t?.number ?? null;
}

/**
 * 从某天起，到「该五行得令的那一段」的起止。
 * 得令之月按阳历月近似（节气月与阳历月相差不过一句，落到走势图上够用）。
 *
 * 返回的是一段而非一点，因为五行得令常跨两三个月（如木在寅卯，火在巳午）。
 * 这一段就是**量化的上限**：断语说「须待寅卯月」，量化结果就不该跑到卯月之后去。
 */
function elementSeasonSpan(element, fromTs) {
  const months = [...new Set((ELEMENT_MONTHS[element] || []).map((z) => ZHI_TO_MONTH[z]).filter(Boolean))]
    .sort((a, b) => a - b);
  if (!months.length) return null;
  const from = new Date(fromTs);
  const cands = [];
  for (const y of [from.getFullYear(), from.getFullYear() + 1, from.getFullYear() + 2]) {
    for (const m of months) {
      const start = new Date(y, m - 1, 1).getTime();
      if (start > fromTs) cands.push({ y, m, start });
    }
  }
  if (!cands.length) return null;
  const first = cands[0];
  // 得令段的末日 = 从首月起、连续且同属该五行的最后一个月的月末
  let end = new Date(first.y, first.m, 1).getTime(); // 下月一号
  for (const c of cands) {
    if (c.start < end + 86400000 * 2) end = new Date(c.y, c.m, 1).getTime();
  }
  return {
    startTs: first.start,
    endTs: end - 86400000,
    startDays: Math.round((first.start - fromTs) / DAY),
    endDays: Math.round((end - 86400000 - fromTs) / DAY),
    firstMonth: first.m,
  };
}

/**
 * 推一个应期区间。
 * @param {object} chart  buildChart() 的结果
 * @param {object} [opts]
 * @param {string} [opts.from]  起点（起卦的钟表时间），缺省取 chart.calendar.localTime
 * @returns {object|null} chart 不完整时返回 null
 */
export function computeYingqi(chart, opts = {}) {
  if (!chart?.tiyong || !chart?.moving) return null;

  const ti = chart.tiyong.ti;
  const yong = chart.tiyong.yong;
  const state = chart.tiyong.wang?.ti?.state;
  const relKey = chart.tiyong.relation?.key || 'unknown';
  const pos = chart.moving.position;
  const posName = ['初', '二', '三', '四', '五', '上'][pos - 1] || '';

  // 体气得令否：旺相为得气（与 verdict 的 STATE_RANK >= 3 同义）
  const inSeason = state === '旺' || state === '相';
  const fromTs = tsOf(opts.from || chart.calendar?.localTime);

  const parts = [];
  let baseDays;
  let anchor = null;
  /** 量化的天花板：断语已经承诺了一个窗口，量化结果不该跑到窗口外面去 */
  let ceilingDays = null;

  if (inSeason) {
    baseDays = FIT_DAYS[pos] ?? 30;
    ceilingDays = baseDays;
    const word = baseDays >= 180 ? '半载' : baseDays >= 90 ? '三四个月' : baseDays >= 45 ? '一至两月' : '一月';
    parts.push(`动在${posName}爻，然体${ti?.name || ''}${ti?.element || ''}${state}，气得其令，故其应不至久留`);
    parts.push(`约在${word}之内见其端`);
  } else {
    // 气犹未至：须待体卦五行得令，得令那一段就是窗口
    anchor = fromTs ? elementSeasonSpan(ti?.element, fromTs) : null;
    const months = (ELEMENT_MONTHS[ti?.element] || []).join('、');
    if (anchor) {
      baseDays = Math.round(anchor.startDays * (POSITION_SPAN[pos] ?? 1));
      ceilingDays = anchor.endDays;
      parts.push(`体${ti?.name || ''}${ti?.element || ''}${state}，气犹未至，事之成须待${months}月${ti?.element || ''}气得令之时`);
      parts.push(`（约 ${anchor.firstMonth} 月起，${anchor.startDays} 日后始见，至 ${anchor.endDays} 日内）`);
    } else {
      // 起点缺失时退化为「按爻位放大」，并注明依据不全
      baseDays = Math.round(({ 1: 30, 2: 45, 3: 60, 4: 90, 5: 120, 6: 180 }[pos] || 60));
      parts.push(`动在${posName}爻而体${ti?.element || ''}未得气，按爻位放大取期（缺起卦时间，未按得令之月校准）`);
    }
  }

  const relF = RELATION_FACTOR[relKey] ?? 1;
  const relText = {
    yong_sheng_ti: '用生体，有人来助，来得顺',
    bihe: '体用比和，同气相应，不疾不徐',
    ti_ke_yong: '体克用，制得住但要出力，按常速',
    ti_sheng_yong: '体生用，我在耗，事拖着',
    yong_ke_ti: '用克体，受制于人，更慢',
  }[relKey] || '生克未明，按常速计';

  const nTi = innateNumberOf(ti?.name);
  const nYong = innateNumberOf(yong?.name);
  const sum = (nTi || 4) + (nYong || 4);
  const numF = Math.round((0.9 + ((sum - 2) / 14) * 0.2) * 1000) / 1000;

  const center = baseDays * relF * numF;
  let max = Math.round(center * 1.35);
  if (ceilingDays !== null) max = Math.min(max, ceilingDays);
  max = Math.max(2, max);
  const min = Math.max(1, Math.min(max - 1, Math.round(max * 0.4)));
  const horizon = horizonFor(max);

  const from = fromTs ? fmtDate(fromTs) : '';
  const to = fromTs ? fmtDate(fromTs + max * DAY) : '';

  parts.push(`${relText}（×${relF}）`);
  parts.push(`体用卦数合${sum}（×${numF}）`);
  if (ceilingDays !== null && Math.round(center * 1.35) > ceilingDays) {
    parts.push(`生克与卦数本欲推得更远，已按断语所示之期收在 ${ceilingDays} 日内`);
  }

  return {
    /** 区间（天），自起卦之日起算 */
    minDays: min,
    maxDays: max,
    from,
    to,
    horizon: horizon.id,
    horizonName: horizon.name,
    unit: horizon.unit,
    hint: horizon.note,
    /** 是否落在「体气得令」的短窗口里 */
    inSeason,
    /** 未得气时的得令锚点（用于解释与图上标注） */
    seasonAt: anchor
      ? { date: fmtDate(anchor.startTs), endDate: fmtDate(anchor.endTs), days: anchor.startDays, month: anchor.firstMonth }
      : null,
    basis: {
      state, inSeason, baseDays, relationFactor: relF, numberFactor: numF, innateSum: sum,
      position: pos, positionSpan: inSeason ? null : (POSITION_SPAN[pos] ?? 1), ceilingDays,
    },
    reason: `${parts.join('；')}。`,
    source: 'computed',
  };
}

/** 分档定义，给界面与文档引用 */
export const YINGQI_HORIZONS = HORIZONS.map(({ id, name, unit, note }) => ({ id, name, unit, note }));

/** 应期区间 → 一句话（断语「应期」那一段的量化补充，不是替代） */
export function describeYingqi(y) {
  if (!y) return '';
  const span = y.from && y.to ? `${y.from} 至 ${y.to}` : `起卦后 ${y.minDays}–${y.maxDays} 天`;
  return `${y.horizonName}（${y.unit}）：${span}。${y.hint}`;
}
