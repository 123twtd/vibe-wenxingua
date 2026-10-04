/**
 * 问心卦 · 走势聚合引擎
 * ------------------------------------------------------------
 * 把「一卦一条记录」聚合成「一条或多条时间序列」，供走势图叠加显示。
 *
 * 设计要点：
 *   1. 每个「领域」(domain) 是一个可由卦录算出的数值序列；
 *   2. 除五行占比外，所有领域都归一到同一量程 −100 ~ +100，因此可以叠在同一张图里；
 *   3. 五行占比是 0~100% 量程，单独成模式，不与其他线混量程；
 *   4. 移动平均只影响显示，原始值一并返回（图上以淡线示之）。
 */

import { TRIGRAMS } from './bagua.mjs';

/** 量程说明：吉凶诸线共用量程 −100~100；五行占比为 0~100 */
export const SCALE = { signed: [-100, 100], percent: [0, 100] };

/** 体用生克 → 归一值（用生体最吉，用克体最凶） */
const RELATION_VALUE = {
  yong_sheng_ti: 100,
  bihe: 60,
  ti_ke_yong: 20,
  ti_sheng_yong: -40,
  yong_ke_ti: -100,
  unknown: 0,
};

/** 旺衰 → 归一值 */
const WANG_VALUE = { 旺: 100, 相: 50, 休: 0, 囚: -50, 死: -100 };

/** 吉凶等级 → 归一值（用于兜底与分面均值） */
const GRADE_VALUE = { 大吉: 100, 吉: 60, 中吉: 20, 平: 0, 小凶: -60, 凶: -100 };

/** 五行配色，与界面一致 */
export const ELEMENT_COLORS = { 木: '#4a9e6e', 火: '#c0392b', 土: '#a9865b', 金: '#d4a843', 水: '#5b8cc7' };
export const ELEMENTS = ['木', '火', '土', '金', '水'];

/** 领域定义表 */
export const DOMAINS = [
  {
    id: 'score', name: '总评分', scale: 'signed', color: '#e8c86a', mode: 'fortune',
    desc: '断语引擎给出的八项加权总分（−100 ~ +100）',
    pick: (r) => r.chart?.score?.total ?? null,
  },
  {
    id: 'relation', name: '体用生克', scale: 'signed', color: '#5b8cc7', mode: 'fortune',
    desc: '用生体 +100 / 比和 +60 / 体克用 +20 / 体生用 −40 / 用克体 −100',
    pick: (r) => RELATION_VALUE[r.chart?.tiyong?.relation?.key] ?? null,
  },
  {
    id: 'bian', name: '变卦对体', scale: 'signed', color: '#d8604a', mode: 'fortune',
    desc: '结局之象：变卦与体卦的生克（归宿）',
    pick: (r) => RELATION_VALUE[r.chart?.tiyong?.bianRelation?.key] ?? null,
  },
  {
    id: 'tiWang', name: '体卦旺衰', scale: 'signed', color: '#4f9d78', mode: 'fortune',
    desc: '月令之下体卦之气：旺 +100 相 +50 休 0 囚 −50 死 −100',
    pick: (r) => WANG_VALUE[r.chart?.tiyong?.wang?.ti?.state] ?? null,
  },
  {
    id: 'grade', name: '吉凶等级', scale: 'signed', color: '#b09a6d', mode: 'fortune',
    desc: '等级折算：大吉 +100 … 凶 −100（与总评分同向，可作校验线）',
    pick: (r) => GRADE_VALUE[r.reading?.grade?.label] ?? null,
  },
  {
    id: 'tiYangRatio', name: '体卦刚柔', scale: 'signed', color: '#c9a227', mode: 'fortune',
    desc: '体卦属阳（乾震坎艮）记 +100，属阴（坤巽离兑）记 −100；平滑后即一段时期的刚柔之比',
    pick: (r) => {
      const t = r.chart?.tiyong?.ti?.name;
      if (!t || !TRIGRAMS[t]) return null;
      return TRIGRAMS[t].yin ? -100 : 100;
    },
  },
];

/** 移动平均（尾随窗口）：空值不参与平均，但仍占窗口位置 */
function movingAverage(values, window) {
  if (!window || window <= 1) return values.slice();
  const out = [];
  const q = [];
  let sum = 0;
  let n = 0;
  for (const v of values) {
    q.push(v);
    if (v !== null && v !== undefined) {
      sum += v;
      n += 1;
    }
    if (q.length > window) {
      const drop = q.shift();
      if (drop !== null && drop !== undefined) {
        sum -= drop;
        n -= 1;
      }
    }
    out.push(n ? Math.round((sum / n) * 10) / 10 : null);
  }
  return out;
}

/** 滚动占比（用于五行分布） */
function rollingShare(flags, window) {
  const out = [];
  const q = [];
  for (const f of flags) {
    q.push(f);
    if (q.length > window) q.shift();
    out.push(Math.round((q.filter(Boolean).length / q.length) * 1000) / 10);
  }
  return out;
}

function tsOf(localTime) {
  const m = String(localTime || '').match(/(\d{4})\D(\d{1,2})\D(\d{1,2})\D(\d{1,2})\D(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
}

/** 时间衰减半衰期（天）：算领域基准时，越近的卦权重越大 */
export const DOMAIN_HALF_LIFE_DAYS = 90;

/** 领域配色 */
const DOMAIN_PALETTE = ['#e8c86a', '#5b8cc7', '#d8604a', '#4f9d78', '#b09a6d', '#9b7fd4', '#4aa3a3', '#c96a9b'];

/**
 * 生成走势数据。
 * @param {object[]} records 全部卦录
 * @param {object} opts
 * @param {string[]} [opts.domains]   要显示的领域 id（默认 fortune 模式下全部 signed 领域）
 * @param {string}   [opts.mode]      'fortune' | 'element' | 'category' | 'domain'
 * @param {string[]} [opts.categories] 只统计这些类别（空＝全部）
 * @param {number}   [opts.rangeDays]  只取最近 N 天（0＝全部）
 * @param {string}   [opts.xMode]     'index'（按卦序）| 'time'（按时间比例）
 * @param {string}   [opts.axis]      'cast'（按起卦时间）| 'due'（按应验时间）
 * @param {number}   [opts.smooth]    移动平均窗口（1＝不平滑）
 * @returns {object}
 */
export function buildTrend(records, opts = {}) {
  const mode = opts.mode || 'fortune';
  const smooth = Math.max(1, Number(opts.smooth) || 1);
  const xMode = opts.xMode === 'time' ? 'time' : 'index';
  const axis = opts.axis === 'due' ? 'due' : 'cast';
  const categories = Array.isArray(opts.categories) && opts.categories.length ? opts.categories : null;

  /**
   * 每条卦录落在横轴上的位置由 `axis` 决定。
   * 按「应验时间」看时，长期之事会排到右侧的未来区间去——
   * 这正是原先只看起卦时间做不到的事：所有卦都挤在起卦那一天。
   */
  const castTs = (r) => tsOf(r.cast?.localTime);
  const dueTs = (r) => (r.yingqi?.to ? tsOf(`${r.yingqi.to} 12:00`) : null);
  const atOf = axis === 'due' ? (r) => dueTs(r) ?? castTs(r) : castTs;
  const usedFallback = axis === 'due'
    ? records.filter((r) => r.chart?.ben && dueTs(r) === null && castTs(r) !== null).length
    : 0;

  // 1) 取数、排序（长期之事按应验时间会排到后面；缺时间的排最后并标注）
  let list = records
    .filter((r) => r.chart?.ben)
    .map((r) => ({ r, ts: atOf(r), castAt: castTs(r) }))
    .sort((a, b) => (a.ts ?? Infinity) - (b.ts ?? Infinity) || String(a.r.id).localeCompare(String(b.r.id)));

  if (categories) list = list.filter((x) => categories.includes(x.r.category));

  const rangeDays = Number(opts.rangeDays) || 0;
  if (rangeDays > 0 && list.length) {
    const last = list[list.length - 1].ts;
    if (last) list = list.filter((x) => x.ts !== null && last - x.ts <= rangeDays * 86400000);
  }

  const recs = list.map((x) => x.r);
  const points = recs.length;

  if (!points) {
    return { mode, xMode, smooth, points: 0, xLabels: [], series: [], records: [], notes: ['尚无卦录，先在「起卦台」起一卦，或在「导入」里录旧卦。'] };
  }

  // 2) 按模式选系列
  let series = [];
  const notes = [];
  /** 同领域内每卦相对基准的偏离（只有 domain 模式会填） */
  const deviations = [];

  if (mode === 'element') {
    // 五行占比：五条线叠加（滚动占比，量程 0~100%）
    const win = Math.max(smooth, 1);
    for (const el of ELEMENTS) {
      const flags = recs.map((r) => r.chart?.tiyong?.ti?.element === el);
      const raw = flags.map((f) => (f ? 100 : 0));
      series.push({
        id: `el:${el}`, name: `${el}（体卦）`, color: ELEMENT_COLORS[el], scale: 'percent',
        values: win > 1 ? rollingShare(flags, win) : raw,
        raw: win > 1 ? raw : null,
        hint: `体卦属${el}的卦在窗口内所占比例`,
      });
    }
    if (win > 1) notes.push(`五行占比为 ${win} 卦滚动窗口内的比例。`);
    else notes.push('五行占比为逐卦 0/100 开关量；把「平滑窗口」调到 3 以上可看出此消彼长。');
  } else if (mode === 'category') {
    // 每个类别一条线：该类别此前所有卦的累计平均分
    const cats = [...new Set(recs.map((r) => r.category).filter(Boolean))];
    const palette = ['#e8c86a', '#5b8cc7', '#d8604a', '#4f9d78', '#b09a6d', '#9b7fd4', '#4aa3a3', '#c96a9b'];
    const signedIds = opts.domains && opts.domains.length ? opts.domains : ['score'];
    const baseId = signedIds[0];
    const base = DOMAINS.find((d) => d.id === baseId) || DOMAINS[0];
    const rawVals = recs.map((r) => base.pick(r));
    cats.forEach((cat, i) => {
      // 该类别至今的累计均值；非本类别的点留空（线断开）
      let sum = 0;
      let n = 0;
      const vals = recs.map((r, k) => {
        if (r.category === cat) {
          const v = base.pick(r);
          if (v !== null && v !== undefined) {
            sum += v;
            n += 1;
          }
        }
        return n ? Math.round((sum / n) * 10) / 10 : null;
      });
      series.push({
        id: `cat:${cat}`, name: cat, color: palette[i % palette.length], scale: 'signed',
        values: smooth > 1 ? movingAverage(vals, smooth) : vals,
        raw: smooth > 1 ? vals : null,
        dashed: false,
        sparse: true,
        hint: `${cat}：以「${base.name}」计的累计均值`,
      });
    });
    if (cats.length) notes.push(`每条线是一个类别的累计均值（基数：${base.name}）；未出现该类别的卦处线断开。原序列：${base.name}。`);
    else notes.push('尚无分类别的卦录。');
    // 也把总序列放进来做基准
    series.push({
      id: `all:${base.id}`, name: `全体·${base.name}`, color: '#6f6759', scale: 'signed',
      values: smooth > 1 ? movingAverage(rawVals, smooth) : rawVals, raw: rawVals, dashed: true,
      hint: '所有类别的总体序列，作基准线',
    });
  } else if (mode === 'domain') {
    /* 按**领域**（类别）分别成线：一个领域一条运势线。
       同一个领域里若起过好几卦，就把它们**综合**成一条基准——
       用时间衰减的加权累计均值：越近的卦权重越大（半衰期 90 天），
       于是这条线既记得旧事，又跟得上近况。
       每条卦对基准的**偏离**单独返回，界面上可以标出来：偏得越多越值得看。 */
    const cats = [...new Set(recs.map((r) => r.category).filter(Boolean))];
    const baseId = (opts.domains && opts.domains.length) ? opts.domains[0] : 'score';
    const base = DOMAINS.find((d) => d.id === baseId) || DOMAINS[0];
    const refTs = Math.max(...list.map((x) => x.ts ?? 0)) || Date.now();

    const round1 = (v) => Math.round(v * 10) / 10;

    cats.forEach((cat, i) => {
      let wsum = 0;
      let vsum = 0;
      const vals = recs.map((r, k) => {
        if (r.category !== cat) return wsum ? round1(vsum / wsum) : null;
        const v = base.pick(r);
        if (v === null || v === undefined) return wsum ? round1(vsum / wsum) : null;
        const dt = Math.max(0, (refTs - (list[k]?.ts ?? refTs)) / 86400000);
        const w = 0.5 ** (dt / DOMAIN_HALF_LIFE_DAYS);
        wsum += w;
        vsum += v * w;
        // 这一卦相对「此刻基准」偏了多少——同领域内的背离
        const avg = wsum ? vsum / wsum : v;
        deviations.push({ 卦: r.id, 领域: cat, 本卦: v, 基准: round1(avg), 偏离: round1(v - avg) });
        return round1(avg);
      });
      const count = recs.filter((r) => r.category === cat).length;
      series.push({
        id: `dom:${cat}`,
        name: `${cat}（${count} 卦）`,
        color: DOMAIN_PALETTE[i % DOMAIN_PALETTE.length],
        scale: 'signed',
        values: vals,
        raw: null,
        sparse: true,
        hint: `${cat} 这条线的基准：以「${base.name}」计、按时间衰减加权的累计均值（半衰期 ${DOMAIN_HALF_LIFE_DAYS} 天）；本领域没起过卦的位置线断开。`,
      });
    });

    // 全体基准作对照：所有领域合起来的那条
    const allVals = recs.map((r, k) => {
      const v = base.pick(r);
      if (v === null || v === undefined) return null;
      const dt = Math.max(0, (refTs - (list[k]?.ts ?? refTs)) / 86400000);
      return round1(v * (0.5 ** (dt / DOMAIN_HALF_LIFE_DAYS)));
    });
    series.push({
      id: `all:${base.id}`,
      name: `全体基准·${base.name}`,
      color: '#6f6759',
      scale: 'signed',
      values: smooth > 1 ? movingAverage(allVals, smooth) : allVals,
      raw: allVals,
      dashed: true,
      hint: '所有领域合起来的对照线（时间衰减加权）；用来比出某个领域是在上还是在下。',
    });

    if (cats.length) {
      notes.push(`每条线是一个**领域**（类别）的运势基准（基数：${base.name}，时间衰减半衰期 ${DOMAIN_HALF_LIFE_DAYS} 天）；同领域起过多卦就已综合进这条线，未起过卦的位置线断开。`);
      notes.push('虚线是全体基准：某条线在它之上则该领域偏顺，之下则偏难。');
    } else {
      notes.push('卦录还没有类别，先给卦录标上类别再看领域走势。');
    }
  } else {
    // fortune 模式：自由勾选任意 signed 领域叠加
    const ids = Array.isArray(opts.domains) && opts.domains.length
      ? opts.domains
      : DOMAINS.filter((d) => d.mode === 'fortune' && d.scale === 'signed').map((d) => d.id);
    for (const id of ids) {
      const d = DOMAINS.find((x) => x.id === id);
      if (!d) continue;
      const vals = recs.map((r) => d.pick(r));
      series.push({
        id: d.id, name: d.name, color: d.color, scale: d.scale,
        values: smooth > 1 ? movingAverage(vals, smooth) : vals,
        raw: smooth > 1 ? vals : null,
        hint: d.desc,
      });
    }
    notes.push('各线已归一到同一量程（−100 ~ +100），可直接叠看：同向＝彼此印证，背离＝卦气与结论有张力。');
  }

  // 3) 坐标
  const times = list.map((x) => x.ts);
  const hasAllTimes = times.every((t) => t !== null);
  const spanDays = hasAllTimes && times.length > 1
    ? (Math.max(...times) - Math.min(...times)) / 86400000
    : 0;
  const useTimeAxis = xMode === 'time' && hasAllTimes && spanDays >= 1;
  const xs = points === 1
    ? [0.5]
    : useTimeAxis
      ? times.map((t) => (t - Math.min(...times)) / (Math.max(...times) - Math.min(...times) || 1))
      : recs.map((_, i) => i / (points - 1));

  if (xMode === 'time' && !useTimeAxis) {
    notes.push(spanDays > 0
      ? `所选卦录的时间跨度不足一日（${Math.round(spanDays * 24)} 小时），时间轴已退化为等距；如需按时间比例，请选更长跨度。`
      : '部分卦录缺少起卦时间，时间轴已退化为等距。');
  }

  // 同一分钟内可能起好几卦（例如一口气连占），轴上标签会重复到毫无信息量，
  // 故对重复时刻附上该时刻内的序号：09-28 03:12·2
  const shortOf = (r) => (axis === 'due'
    ? String(r.yingqi?.to || r.cast?.localTime || r.createdAt || '').slice(5, 16)
    : String(r.cast?.localTime || r.createdAt || '').slice(5, 16));
  const dupCount = recs.reduce((acc, r) => {
    const t = shortOf(r);
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  const seenAt = {};
  const xLabels = recs.map((r) => {
    const t = shortOf(r);
    seenAt[t] = (seenAt[t] || 0) + 1;
    const due = r.yingqi?.to ? `　应期至 ${r.yingqi.to}` : '';
    return {
      text: dupCount[t] > 1 ? `${t}·${seenAt[t]}` : t,
      full: `${r.cast?.localTime || ''}　${r.chart?.ben?.fullName || ''}${r.chart?.ben?.symbol || ''}　${r.reading?.grade?.label || ''}${due}`,
      id: r.id,
      title: r.title,
    };
  });

  const scales = [...new Set(series.map((s) => s.scale))];
  return {
    mode, xMode, axis, smooth, points,
    useTimeAxis,
    spanDays: Math.round(spanDays * 100) / 100,
    scale: scales.length === 1 ? scales[0] : 'mixed',
    xValues: xs,
    xLabels,
    series,
    deviations,
    /** 按应验时间看时，有多少条缺应期、退回按起卦时间排 */
    dueFallback: usedFallback,
    categories: [...new Set(records.map((r) => r.category).filter(Boolean))],
    domains: DOMAINS.map(({ id, name, color, scale, mode: m, desc }) => ({ id, name, color, scale, mode: m, desc })),
    records: recs.map((r) => ({
      id: r.id,
      title: r.title,
      localTime: r.cast?.localTime || '',
      category: r.category,
      ben: r.chart?.ben?.fullName || '',
      symbol: r.chart?.ben?.symbol || '',
      grade: r.reading?.grade?.label || '',
      score: r.chart?.score?.total ?? null,
      relation: r.chart?.tiyong?.relation?.label || '',
      tiElement: r.chart?.tiyong?.ti?.element || '',
      tiState: r.chart?.tiyong?.wang?.ti?.state || '',
      review: r.review?.status || '',
      yingqi: r.yingqi
        ? { to: r.yingqi.to, days: r.yingqi.maxDays, horizon: r.yingqi.horizonName, source: r.yingqi.source }
        : null,
    })),
    notes,
  };
}

/** 走势摘要：给助手与总览用的一句话统计 */
export function trendSummary(records) {
  const t = buildTrend(records, { mode: 'fortune', domains: ['score'], smooth: 1 });
  const vals = t.series[0]?.values.filter((v) => v !== null) ?? [];
  if (!vals.length) return { count: 0 };
  const first = vals.slice(0, Math.max(1, Math.ceil(vals.length / 3)));
  const last = vals.slice(-Math.max(1, Math.ceil(vals.length / 3)));
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  return {
    count: vals.length,
    earliest: Math.round(avg(first) * 10) / 10,
    latest: Math.round(avg(last) * 10) / 10,
    delta: Math.round((avg(last) - avg(first)) * 10) / 10,
    peak: Math.max(...vals),
    trough: Math.min(...vals),
  };
}
