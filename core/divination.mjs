/**
 * 问心卦 · 起卦与卦局
 * ------------------------------------------------------------
 * 依梅花易数正法起卦，并把一卦之「全息」一次算齐：
 *   起卦推演 → 本卦 → 互卦 → 变卦 → 动爻 → 体用 → 变卦对体 → 旺衰 → 吉凶评分
 */

import {
  TRIGRAMS, trigramByRemainder, wuxingRelation, wangShuai, WANG_SHUAI_SCORE,
  WANG_SHUAI_PHRASE, yaoTitle, YAO_POSITION_SYMBOL,
} from './bagua.mjs';
import {
  sixLines, mutualLines, changedLines, tiYongOfLines, trigramsOfLines, library,
} from './hexagram.mjs';
import { calendarInfo, zhiNumber, PLACES } from './calendar.mjs';
import { XLR_METHODS, isXlrMethod, castXlr } from './xiaoliuren.mjs';

/** 梅花易数起卦法一览（前端下拉用） */
const MEIHUA_METHODS = [
  {
    id: 'numberAndTime',
    label: '一数 + 时辰（先报数，最常用）',
    hint: '上卦取数除以八之余，下卦取时辰数除以八之余，动爻取两数之和除以六之余。',
    needs: ['number', 'time'],
    group: '梅花易数',
  },  {
    id: 'twoNumbers',
    label: '两数（先报数，后报数）',
    hint: '先报之数为上卦，后报之数为下卦，两数之和除以六取动爻。',
    needs: ['number2', 'time'],
    group: '梅花易数',
  },
  {
    id: 'timeOnly',
    label: '年月日时（不报数）',
    hint: '年支数加月数加日数除以八为上卦，再加时辰数除以八为下卦，总和除以六取动爻。',
    needs: ['time'],
    group: '梅花易数',
  },
  {
    id: 'manual',
    label: '已知卦象（直接指定本卦与动爻）',
    hint: '用于把别人替你起的卦（或旧卦）录入，互卦、变卦、体用由本程序推算。',
    needs: ['hexagram', 'moving'],
    group: '梅花易数',
  },
];

/**
 * 起卦法总表：梅花在前（meta.methods[0] 与前端默认值都锚在它），小六壬在后。
 * 两种占法同录一库，靠 chart.kind 分派；判别只走 kindOf()，不许别处自建枚举表。
 */
export const METHODS = [...MEIHUA_METHODS, ...XLR_METHODS];

/** 起卦法 → 占法类别：'meihua' | 'xlr' */
export function kindOf(method) {
  return isXlrMethod(method) ? 'xlr' : 'meihua';
}

function remainderOr(n, base, fallback) {
  const r = ((n % base) + base) % base;
  return r === 0 ? fallback : r;
}

/**
 * 起卦主函数。
 * @param {object} input
 * @param {string} input.method        METHODS 中的 id
 * @param {number[]} [input.numbers]   报数
 * @param {string} input.localTime     'YYYY-MM-DD HH:mm' 钟表时间
 * @param {boolean} [input.useTrueSolarTime=true] 是否换真太阳时定时辰
 * @param {number} [input.longitude]   东经
 * @param {string} [input.placeName]
 * @param {string} [input.hexagram]    manual 模式下的本卦（卦名或卦序）
 * @param {number} [input.movingPosition] manual 模式下的动爻
 * @param {string} [input.question]    所问之事
 * @param {string} [input.category]    分类
 * @param {string[]} [input.notes]     备注
 */
export function cast(input = {}) {
  const method = input.method || 'numberAndTime';
  const useTrue = input.useTrueSolarTime !== false;
  const numbers = (Array.isArray(input.numbers) ? input.numbers : [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!input.localTime) throw new Error('起卦需要时间（精确到分钟）。');

  const cal = calendarInfo({
    localTime: input.localTime,
    longitude: input.longitude,
    latitude: input.latitude,
    placeName: input.placeName,
  });
  const hourNumber = useTrue ? cal.trueHourNumber : cal.clockHourNumber;
  const hourZhi = useTrue ? cal.trueHourZhi : cal.clockHourZhi;

  // 小六壬：时间与时辰的解析同样只此一处；起课本体在 core/xiaoliuren.mjs
  if (isXlrMethod(method)) {
    return castXlr({ input, cal, hourNumber, hourZhi, useTrue, method });
  }

  const steps = [];
  let upperName;
  let lowerName;
  let movingNumber;

  if (method === 'manual') {
    const lib = library();
    const h = lib.find(input.hexagram);
    if (!h) throw new Error(`无法识别卦名：${input.hexagram}`);
    const pos = Number(input.movingPosition);
    if (!(pos >= 1 && pos <= 6)) throw new Error('动爻须为 1-6（自下而上第六爻写作 6）。');
    upperName = h.upper;
    lowerName = h.lower;
    movingNumber = pos;
    steps.push(`本卦指定为 ${h.fullName}${h.symbol}（上${h.upper}下${h.lower}）`);
    steps.push(`动爻指定为第 ${pos} 爻（自下而上）`);
  } else if (method === 'timeOnly') {
    const yearZhiNum = zhiNumber(cal.yearGanZhi.slice(-1)) ?? 1;
    const monthNum = cal.monthIndex + 1;
    const dayNum = Number(cal.localTime.slice(8, 10));
    const base = yearZhiNum + monthNum + dayNum;
    const upperRem = remainderOr(base, 8, 8);
    const lowerRem = remainderOr(base + hourNumber, 8, 8);
    upperName = trigramByRemainder(upperRem);
    lowerName = trigramByRemainder(lowerRem);
    movingNumber = remainderOr(base + hourNumber, 6, 6);
    steps.push(
      `年月日时起卦：年支「${cal.yearGanZhi.slice(-1)}」${yearZhiNum} + 月${monthNum} + 日${dayNum} = ${base}`,
      `上卦：${base} ÷ 8 余 ${upperRem} → ${upperName} ${TRIGRAMS[upperName].symbol}`,
      `${base} + 时辰「${hourZhi}」${hourNumber} = ${base + hourNumber}`,
      `下卦：${base + hourNumber} ÷ 8 余 ${lowerRem} → ${lowerName} ${TRIGRAMS[lowerName].symbol}`,
      `动爻：${base + hourNumber} ÷ 6 余 ${movingNumber} → 第${movingNumber}爻动`,
    );
  } else if (method === 'twoNumbers' && numbers.length >= 2) {
    const [a, b] = numbers;
    const upperRem = remainderOr(a, 8, 8);
    const lowerRem = remainderOr(b, 8, 8);
    upperName = trigramByRemainder(upperRem);
    lowerName = trigramByRemainder(lowerRem);
    movingNumber = remainderOr(a + b, 6, 6);
    steps.push(
      `先报之数 ${a} 为上卦：${a} ÷ 8 余 ${upperRem} → ${upperName} ${TRIGRAMS[upperName].symbol}`,
      `后报之数 ${b} 为下卦：${b} ÷ 8 余 ${lowerRem} → ${lowerName} ${TRIGRAMS[lowerName].symbol}`,
      `动爻：(${a} + ${b}) = ${a + b} ÷ 6 余 ${movingNumber} → 第${movingNumber}爻动`,
    );
    if (input.useHourInMoving) {
      movingNumber = remainderOr(a + b + hourNumber, 6, 6);
      steps.push(`（加时辰）(${a} + ${b} + ${hourNumber}) ÷ 6 余 ${movingNumber} → 第${movingNumber}爻动`);
    }
  } else {
    const num = numbers[0] ?? 1;
    const upperRem = remainderOr(num, 8, 8);
    const lowerRem = remainderOr(hourNumber, 8, 8);
    upperName = trigramByRemainder(upperRem);
    lowerName = trigramByRemainder(lowerRem);
    // 动爻取法：sum = 数与时辰之和（梅花易数常法，默认）；number = 仅以报数取（旧稿偶见）
    const movingFrom = input.movingFrom === 'number' ? 'number' : 'sum';
    const movingBase = movingFrom === 'number' ? num : num + hourNumber;
    movingNumber = remainderOr(movingBase, 6, 6);
    steps.push(
      `报数 ${num} 为上卦：${num} ÷ 8 余 ${upperRem} → ${upperName} ${TRIGRAMS[upperName].symbol}`,
      `${useTrue ? '真太阳时' : '钟表时间'}「${hourZhi}时」取数 ${hourNumber} 为下卦：${hourNumber} ÷ 8 余 ${lowerRem} → ${lowerName} ${TRIGRAMS[lowerName].symbol}`,
      movingFrom === 'number'
        ? `动爻：${num} ÷ 6 余 ${movingNumber} → 第${movingNumber}爻动（仅以报数取）`
        : `动爻：(${num} + ${hourNumber}) = ${num + hourNumber} ÷ 6 余 ${movingNumber} → 第${movingNumber}爻动`,
    );
  }

  return buildChart({
    method,
    inputs: {
      method,
      numbers,
      localTime: input.localTime,
      useTrueSolarTime: useTrue,
      movingFrom: input.movingFrom === 'number' ? 'number' : 'sum',
      longitude: input.longitude ?? null,
      latitude: input.latitude ?? null,
      placeName: input.placeName || '',
      hexagram: input.hexagram || '',
      movingPosition: input.movingPosition ?? null,
      question: input.question || '',
      category: input.category || '',
      notes: Array.isArray(input.notes) ? input.notes : [],
    },
    calendar: cal,
    casting: { steps, upperName, lowerName, movingNumber, hourZhi, hourNumber },
    lines: sixLines(upperName, lowerName),
    movingPosition: movingNumber,
  });
}

/** 由「本卦 + 动爻」组装完整卦局（导入旧卦时也走这里） */
export function buildChart({ method, inputs, calendar, casting, lines, movingPosition }) {
  const lib = library();
  const ben = lib.resolve(lines);
  const hu = lib.resolve(mutualLines(lines));
  const bian = lib.resolve(changedLines(lines, movingPosition));
  const ty = tiYongOfLines(lines, movingPosition);
  const tiTri = TRIGRAMS[ty.ti];
  const yongTri = TRIGRAMS[ty.yong];

  const relation = wuxingRelation(tiTri.element, yongTri.element);
  const wangTi = {
    ...wangShuai(tiTri.element, calendar.monthZhi),
    element: tiTri.element,
    tri: tiTri.name,
  };
  const wangYong = {
    ...wangShuai(yongTri.element, calendar.monthZhi),
    element: yongTri.element,
    tri: yongTri.name,
  };
  wangTi.phrase = WANG_SHUAI_PHRASE[wangTi.state];
  wangYong.phrase = WANG_SHUAI_PHRASE[wangYong.state];

  // 变卦：取变卦中与「用位」同侧的那一卦，与体卦论生克，看事之结局
  const bianTriName = ty.movingInUpper ? bian.upper : bian.lower;
  const bianTri = TRIGRAMS[bianTriName];
  const bianRelation = wuxingRelation(tiTri.element, bianTri.element);

  // 互卦：取互卦中与「用位」同侧的那一卦，看事之中段
  const huTriName = ty.movingInUpper ? hu.upper : hu.lower;
  const huTri = TRIGRAMS[huTriName];
  const huRelation = wuxingRelation(tiTri.element, huTri.element);

  const movingYang = lines[movingPosition - 1] === 1;
  const moving = {
    position: movingPosition,
    isYang: movingYang,
    yaoTitle: yaoTitle(movingPosition, movingYang),
    yaoText: lib.yaoText(ben.id, movingPosition),
    positionSymbol: YAO_POSITION_SYMBOL[movingPosition],
    positionName: ['初', '二', '三', '四', '五', '上'][movingPosition - 1],
    inUpper: ty.movingInUpper,
  };

  const score = scoreChart({ relation, bianRelation, huRelation, wangTi, wangYong, ben, bian, moving });

  return {
    kind: 'meihua',
    method,
    inputs,
    calendar,
    casting,
    lines: [...lines],
    ben,
    hu,
    bian,
    moving,
    tiyong: {
      ti: { ...tiTri, position: ty.movingInUpper ? '下卦' : '上卦' },
      yong: { ...yongTri, position: ty.movingInUpper ? '上卦' : '下卦' },
      relation,
      huTri: { ...huTri },
      huRelation,
      bianTri: { ...bianTri },
      bianRelation,
      wang: {
        ti: { ...wangTi },
        yong: { ...wangYong },
      },
      /** 原卦中「用位」所对应的三爻（供六爻图标注） */
      tiRange: ty.movingInUpper ? [1, 2, 3] : [4, 5, 6],
      yongRange: ty.movingInUpper ? [4, 5, 6] : [1, 2, 3],
    },
    score,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * 吉凶评分：以「加权归一」为法，而非简单加减——
 * 体用生克（本卦）为骨，变卦结局为归，互卦中途为参，体用旺衰为气，
 * 本卦／变卦之卦德为体，动爻得位为应。
 *
 * 各项先化为 [−1, 1] 的归一值，再按权重求加权平均，得 −100 ~ +100 的总分。
 * 权重经过校准：使「体克用而结局受制、卦德又不吉」（如归妹）落于小凶，
 * 而「体克用、结局来生、卦德亦吉」（如革之变既济）落于中吉。
 */
function scoreChart({ relation, bianRelation, huRelation, wangTi, wangYong, ben, bian, moving }) {
  const FORTUNE = { 大吉: 4, 吉: 2, 中吉: 1, 平: 0, 小凶: -2, 凶: -4 };
  const WANG = { 旺: 2, 相: 1, 休: 0, 囚: -1, 死: -2 };
  const POS = { 1: 0, 2: 1, 3: -0.5, 4: -0.5, 5: 1, 6: 0 };

  const items = [
    { label: '体用生克', w: 3.0, v: relation.grade / 3, note: `${relation.label}（${relation.detail}）` },
    { label: '变卦结局', w: 2.2, v: bianRelation.grade / 3, note: `变卦对体：${bianRelation.label}` },
    { label: '互卦中途', w: 1.0, v: huRelation.grade / 3, note: `互卦对体：${huRelation.label}` },
    { label: '体卦旺衰', w: 1.4, v: (WANG[wangTi.state] ?? 0) / 2, note: `体${wangTi.element}于${wangTi.season}月为「${wangTi.state}」` },
    { label: '用卦旺衰', w: 0.6, v: -(WANG[wangYong.state] ?? 0) / 2, note: `用${wangYong.element}于${wangYong.season}月为「${wangYong.state}」` },
    { label: '本卦卦德', w: 3.2, v: (FORTUNE[ben.fortune] ?? 0) / 4, note: `${ben.fullName}：${ben.fortune}（${ben.coreMeaning || ''}）` },
    { label: '变卦卦德', w: 2.2, v: (FORTUNE[bian.fortune] ?? 0) / 4, note: `${bian.fullName}：${bian.fortune}（${bian.coreMeaning || ''}）` },
    { label: '动爻得位', w: 1.0, v: (POS[moving.position] ?? 0) / 2, note: `${moving.yaoTitle}：${moving.positionSymbol}` },
  ];

  const totalW = items.reduce((s, i) => s + i.w, 0);
  const sum = items.reduce((s, i) => s + i.w * i.v, 0);
  const pct = Math.round((sum / totalW) * 1000) / 10;

  const breakdown = items.map((i) => ({
    label: i.label,
    weight: i.w,
    value: Math.round(i.w * i.v * 100) / 100,
    pct: Math.round(i.v * 1000) / 10,
    note: i.note,
  }));

  return { total: pct, grade: gradeOf(pct), breakdown };
}

function gradeOf(pct) {
  if (pct >= 55) return { key: 'daji', label: '大吉', tone: 'good', desc: '势顺而气足，上下皆应，谋之必成；惟当守正勿骄。' };
  if (pct >= 25) return { key: 'ji', label: '吉', tone: 'good', desc: '大体可成，事有曲折而不失其正。' };
  if (pct >= 0) return { key: 'zhongji', label: '中吉', tone: 'good', desc: '可成而须力，得之在勤，失之在怠。' };
  if (pct >= -8) return { key: 'ping', label: '平', tone: 'neutral', desc: '成败在人，卦无所偏；宜谨守而徐图。' };
  if (pct >= -40) return { key: 'xiaoxiong', label: '小凶', tone: 'warn', desc: '势有阻格，强争则损；宜退守待时，另辟一径。' };
  return { key: 'xiong', label: '凶', tone: 'bad', desc: '境压其身，妄动则伤；宜止宜避，别图他策。' };
}

/** 由城市名取经纬度 */
export function placeByName(name) {
  return PLACES.find((p) => p.name === name) || null;
}

/**
 * 反推动爻取法：别人给你的卦里往往只写「报数、时间、动爻」而不说用哪一路取法。
 * 若所述动爻恰好等于「仅以报数除六」的结果，而不同于「数与时之和除六」，
 * 就断定当初用的是前者，从而**忠实复现原卦**，不误记成校勘。
 *
 * @param {object} input   传给 cast() 的输入（不含 movingFrom）
 * @param {number} target  所记述的动爻（1-6）
 * @returns {'sum'|'number'} 匹配的取法；两者都不匹配时返回 'sum'（常法），差异留给校勘记录
 */
export function inferMovingFrom(input, target) {
  // 小六壬没有「动爻取法」这回事——别把它喂进梅花的试探
  if (isXlrMethod(input?.method)) return input.movingFrom || 'sum';
  const want = Number(target);
  if (!(want >= 1 && want <= 6)) return input.movingFrom || 'sum';
  if (input.movingFrom) return input.movingFrom;
  const hits = [];
  for (const mf of ['number', 'sum']) {
    try {
      const c = cast({ ...input, movingFrom: mf });
      if (c.moving.position === want) hits.push(mf);
    } catch {
      /* 这一路取法算不出来就跳过 */
    }
  }
  if (!hits.length) return 'sum';
  // 两者都能得到同一个动爻时，从常法；只有前者能对上的才取前者
  return hits.includes('sum') ? 'sum' : hits[0];
}

export { PLACES, trigramsOfLines };
