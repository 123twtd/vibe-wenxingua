/**
 * 问心卦 · 道教传统小六壬
 * ------------------------------------------------------------
 * 六宫：大安 → 留连 → 速喜 → 赤口 → 小吉 → 空亡（循环）。
 * 起课两路：
 *   · 报数起课——报一至三数，自大安起顺数；每落一宫，下一数即从该宫续数（该宫记作一）。
 *   · 月日时辰起课——大安起月，月上起日，日上起时；月与日默认农历（闰月按本月计），也可公历。
 * 三宫全显、**末宫为主断**。
 *
 * 本模块是六宫数据的唯一真源：断课、导出、助手简报都从它取，
 * 不许在别处再写一份宫名、口诀或吉凶表。
 */

import { lunarInfo } from './lunar.mjs';
import { horizonFor } from './yingqi.mjs';

/** 起课法一览（并入 core/divination.mjs 的 METHODS） */
export const XLR_METHODS = [
  {
    id: 'xlrNumbers',
    label: '小六壬 · 报数起课（一至三数）',
    hint: '报一至三个数，自大安起顺数；每落一宫，下一数即从该宫续数（该宫记作一）。三数最全，末宫为主断。',
    needs: ['number', 'time'],
    group: '道教小六壬',
  },
  {
    id: 'xlrTime',
    label: '小六壬 · 月日时辰起课',
    hint: '月宫、日宫、时宫依次顺数：大安起月，月上起日，日上起时；月与日默认按农历（闰月按本月计），也可按公历。末宫为主断。',
    needs: ['time'],
    group: '道教小六壬',
  },
];

export const XLR_METHOD_IDS = new Set(XLR_METHODS.map((m) => m.id));

export const XLR_LABELS = {
  xlrNumbers: '小六壬 · 报数起课',
  xlrTime: '小六壬 · 月日时辰起课',
};

/**
 * 六宫表（掌诀位自寅起：寅大安、卯留连、辰速喜、巳赤口、午小吉、未空亡）。
 * 断辞为通行口诀；释义、宜忌按本程序「不用绝对断言、不用含糊词」的文字分寸写成。
 * 各师承在五行、方位上或有小异——要改就只改这一张表。
 */
export const XLR_PALACES = [
  {
    index: 1,
    key: 'daan',
    name: '大安',
    deity: '青龙',
    element: '木',
    direction: '东',
    zhi: '寅',
    spiritNumbers: [1, 5, 7],
    spiritText: '一·五·七',
    koujue: '大安事事昌，求财在坤方，失物去不远，宅舍保安康。行人身未动，病者主无妨，将军回田野，仔细好推详。',
    meaning: '安稳守常之象：事体多在原地，尚未起变。宜谋定而后动，不宜轻举远求。',
    signature: '事在近处，安稳无虞；守常则吉，妄动则迁。',
    yi: '宜守旧、宜近处求、宜谋定后动；所问之事多可从容图之。',
    ji: '忌轻动、忌远行求财、忌改弦更张。',
    grade: { key: 'ji', label: '吉', tone: 'good', desc: '安稳无事，主动权多在己手；守常则吉，躁进则平平。' },
  },
  {
    index: 2,
    key: 'liulian',
    name: '留连',
    deity: '玄武',
    element: '水',
    direction: '北',
    zhi: '卯',
    spiritNumbers: [2, 8, 10],
    spiritText: '二·八·十',
    koujue: '留连事难成，求谋日未明，官事只宜缓，去者未回程。失物南方见，急讨方称心，更须防口舌，人口且平平。',
    meaning: '迟滞缠绕之象：事多迁延反复，一时难见分晓。宜缓图细理，不宜催促强求。',
    signature: '事多缠手，来路未明；缓之有绪，急则愈乱。',
    yi: '宜缓办、宜细究根由、宜托可信之人代为周旋。',
    ji: '忌催促、忌强求速成、忌在信息不足时下决断。',
    grade: { key: 'xiaoxiong', label: '小凶', tone: 'warn', desc: '事多迁延难决，急则生变；宜退一步，理清头绪再行。' },
  },
  {
    index: 3,
    key: 'suxi',
    name: '速喜',
    deity: '朱雀',
    element: '火',
    direction: '南',
    zhi: '辰',
    spiritNumbers: [3, 6, 9],
    spiritText: '三·六·九',
    koujue: '速喜喜来临，求财向南行，失物申未午，逢人路上寻。官事有福德，病者无祸侵，田宅六畜吉，行人有信音。',
    meaning: '迅捷喜信之象：消息与机会来得快。宜乘时而动，主动去问、去看、去接。',
    signature: '喜信在途，来势正速；乘时则得，坐待则失。',
    yi: '宜速办、宜主动问信、宜趁势推进；所问之事多有回音。',
    ji: '忌拖延观望、忌错过窗口、忌因小疑而失大事。',
    grade: { key: 'ji', label: '吉', tone: 'good', desc: '有信有喜，来势速而不虚；宜趁早行之，迟则力减。' },
  },
  {
    index: 4,
    key: 'chikou',
    name: '赤口',
    deity: '白虎',
    element: '金',
    direction: '西',
    zhi: '巳',
    spiritNumbers: [4, 7, 10],
    spiritText: '四·七·十',
    koujue: '赤口主口舌，官非切要防，失物急去寻，行人有惊慌。六畜多作怪，病者出西方，更须防咒诅，恐怕染瘟殃。',
    meaning: '口舌争执之象：是非易起，言语易失。宜谨言避争，宜以凭据文书为重。',
    signature: '口舌当前，是非易起；谨言避争，以和为贵。',
    yi: '宜少说多做、宜留好凭据、宜请中人居间调停。',
    ji: '忌当面争执、忌意气用事、忌轻信传言。',
    grade: { key: 'xiong', label: '凶', tone: 'bad', desc: '易起口舌是非，争则两伤；宜谨言慎行，退一步自安。' },
  },
  {
    index: 5,
    key: 'xiaoji',
    name: '小吉',
    deity: '六合',
    element: '木',
    direction: '东南',
    zhi: '午',
    spiritNumbers: [1, 5, 7],
    spiritText: '一·五·七',
    koujue: '小吉最吉昌，路上好商量，阴人来报喜，失物在坤方。行人即便至，交易甚是强，凡事皆和合，病者祈上苍。',
    meaning: '和合顺遂之象：凡事有人商量，彼此可成。宜托人、宜合作、宜结善缘。',
    signature: '凡事和合，商量得宜；人和为贵，独断则失。',
    yi: '宜与人合谋、宜托可信之人、宜循人情之常而行。',
    ji: '忌独断专行、忌失约失信、忌得陇望蜀。',
    grade: { key: 'daji', label: '大吉', tone: 'good', desc: '和合之象，谋事多谐；得人之助，事半功倍。' },
  },
  {
    index: 6,
    key: 'kongwang',
    name: '空亡',
    deity: '勾陈',
    element: '土',
    direction: '中',
    zhi: '未',
    spiritNumbers: [3, 6, 9],
    spiritText: '三·六·九',
    koujue: '空亡事不祥，阴人多乖张，求财无利益，行人有灾殃。失物寻不见，官事有刑伤，病人逢暗鬼，祈解保安康。',
    meaning: '落空少实之象：消息不实，用力多虚。宜核实止损，另图他策，不宜再添投入。',
    signature: '事多落空，音信不实；及早回头，另图他策。',
    yi: '宜核实、宜止损、宜保守观望；先把已投入的守住。',
    ji: '忌轻信、忌加注投入、忌把希望押在不确定的人事上。',
    grade: { key: 'xiong', label: '凶', tone: 'bad', desc: '事落空亡，劳而少功；宜收束止损，静待局面转实。' },
  },
];

export const XLR_PALACE_NAMES = XLR_PALACES.map((p) => p.name);

/**
 * 起课要旨：卦典页「怎么数」那一段。
 * 与六宫表同源放在内核里，界面只渲染不另写一份（ADR-0015 第 8 条）——
 * 术数口径写在界面里，迟早与引擎算的东西对不上。
 */
export const XLR_GUIDE = {
  order: XLR_PALACES.map((p) => p.name),
  items: [
    {
      title: '掌上六宫',
      text: '六宫依掌诀环列：大安 → 留连 → 速喜 → 赤口 → 小吉 → 空亡，循环不绝；数到空亡再往下，即回到大安。',
    },
    {
      title: '报数起课',
      text: '自大安起顺数。报第一个数，落在哪一宫就是初宫；下一个数从那一宫重新算一，继续顺数；有几个数就显几宫，末宫为主断。报一个数也可起课，只是信息少些。',
    },
    {
      title: '月日时辰起课',
      text: '大安起月：顺数到当月之数，落在月宫；自月宫起日：顺数到当日之数，落在日宫；自日宫起时：顺数到当前时辰，落在时宫。末宫（时宫）为主断。',
    },
    {
      title: '月与日按什么算',
      text: '默认按农历（闰月按本月计），也可按公历数字起课——起课时选「历」，卦条里写「历: 公历」。两种口径可能落在不同的宫，选哪种就当起课之初定下；程序不替你改口径。',
    },
    {
      title: '与梅花易数的不同',
      text: '小六壬只有三宫，没有六爻与体用，也不进走势诸线（那些线是体用生克与旺衰的语义）；吉凶取自六宫断辞与主断之宫，应期按末宫神数推算。',
    },
  ],
};

const DAY = 86400000;

export function isXlrMethod(id) {
  return XLR_METHOD_IDS.has(String(id || ''));
}

export function isXlrChart(chart) {
  if (!chart) return false;
  return chart.kind === 'xlr' || (chart.kind === undefined && isXlrMethod(chart.method));
}

/**
 * 累计顺数：N 个数落宫的宫序（1-6）。
 * 自大安起，每落一宫下一数从该宫续数，故等于「各数减一之和」对六取余再加一。
 */
export function palaceIndexFromCounts(counts) {
  const sum = (counts || []).reduce((s, n) => s + (Math.max(1, Math.floor(Number(n) || 1)) - 1), 0);
  return ((sum % 6) + 6) % 6;
}

export function palaceOfCounts(counts) {
  return XLR_PALACES[palaceIndexFromCounts(counts)];
}

/** 顺数轨迹的文字表示（步数多时省略中段，避免 steps 臃肿） */
function traceText(fromIdx, n) {
  const seq = [];
  for (let s = 0; s < n; s += 1) seq.push(XLR_PALACES[(fromIdx + s) % 6].name);
  if (seq.length <= 12) return seq.join(' → ');
  return `${seq.slice(0, 6).join(' → ')} → ……（共 ${n} 步）→ ${seq[seq.length - 1]}`;
}

function rolesFor(kind, n) {
  if (kind === 'time') return ['月宫', '日宫', '时宫'];
  if (n === 1) return ['末宫'];
  if (n === 2) return ['初宫', '末宫'];
  return ['初宫', '次宫', '末宫'];
}

/**
 * 起课（只经 core/divination.cast() 调用，不许别处直呼）。
 * @param {object} p
 * @param {object} p.input       原始起卦输入（method/numbers/localTime/calendarType/…）
 * @param {object} p.cal         calendarInfo() 的结果
 * @param {number} p.hourNumber  时辰取数（子1…亥12），已按真太阳时/钟表时间定妥
 * @param {string} p.hourZhi     时辰地支
 * @param {boolean} p.useTrue    是否按真太阳时定时辰
 * @param {string} p.method      xlrNumbers | xlrTime
 */
export function castXlr({ input, cal, hourNumber, hourZhi, useTrue, method }) {
  if (!isXlrMethod(method)) throw new Error(`不是小六壬起课法：${method}`);
  const numbers = (Array.isArray(input.numbers) ? input.numbers : [])
    .map((n) => Math.floor(Number(n)))
    .filter((n) => Number.isFinite(n) && n > 0);
  const calendarType = input.calendarType === 'solar' ? 'solar' : 'lunar';
  const steps = [];
  let counts = [];
  let countLabels = [];
  let lunar = null;
  let castingKind;

  if (method === 'xlrNumbers') {
    if (!numbers.length) throw new Error('小六壬报数起课至少报一个数（一至三数均可）。');
    if (numbers.length > 3) throw new Error('小六壬报数最多三个数（一至三数均可）。');
    castingKind = 'numbers';
    counts = numbers.slice(0, 3);
    countLabels = counts.map((_, i) => ['第一数', '第二数', '第三数'][i]);
    steps.push(`起课之法：道教小六壬 · 报数起课（${counts.length} 数）`);
  } else {
    castingKind = 'time';
    if (calendarType === 'lunar') {
      lunar = lunarInfo({ localTime: input.localTime });
      counts = [lunar.castingMonth, lunar.day, hourNumber];
      steps.push('起课之法：道教小六壬 · 月日时辰起课（农历）');
      steps.push(`农历：${lunar.year}年 ${lunar.monthName}${lunar.dayName}`);
      if (lunar.isLeap) {
        steps.push(`本月为闰月，起课按本月（${lunar.month} 月）计，月序取 ${lunar.castingMonth}`);
      }
    } else {
      counts = [
        Number(String(input.localTime).slice(5, 7)),
        Number(String(input.localTime).slice(8, 10)),
        hourNumber,
      ];
      steps.push('起课之法：道教小六壬 · 月日时辰起课（公历）');
      steps.push(`公历：${String(input.localTime).slice(0, 10)} 月取 ${counts[0]}、日取 ${counts[1]}`);
    }
    countLabels = ['月数', '日数', '时数'];
    steps.push(`时辰：${hourZhi}时取数 ${hourNumber}（${useTrue ? '真太阳时' : '钟表时间'}）`);
  }

  // 逐数顺数：每落一宫，下一数自该宫续数（该宫记作一）
  const idxSeq = [];
  counts.forEach((n, i) => {
    const fromIdx = i === 0 ? 0 : idxSeq[i - 1];
    const toIdx = (fromIdx + n - 1) % 6;
    idxSeq.push(toIdx);
    const fromName = XLR_PALACES[fromIdx].name;
    steps.push(`${countLabels[i]} ${n} 自${fromName}起顺数：${traceText(fromIdx, n)} → 落${XLR_PALACES[toIdx].name}（第 ${toIdx + 1} 宫）`);
  });

  const roles = rolesFor(castingKind, counts.length);
  const palaces = idxSeq.map((idx, i) => {
    const p = XLR_PALACES[idx];
    return {
      index: i + 1,
      role: roles[i],
      palaceNumber: idx + 1,
      key: p.key,
      name: p.name,
      deity: p.deity,
      element: p.element,
      direction: p.direction,
      zhi: p.zhi,
      spiritNumbers: [...p.spiritNumbers],
      spiritText: p.spiritText,
      koujue: p.koujue,
      meaning: p.meaning,
      signature: p.signature,
      yi: p.yi,
      ji: p.ji,
      grade: { ...p.grade },
    };
  });
  const result = palaces[palaces.length - 1];
  const chain = palaces.map((p) => p.name);
  steps.push(
    `${palaces.map((p) => `${p.role}${p.name}`).join('，')}；末宫${result.name}为主断（${result.grade.label}）`,
  );

  return {
    method,
    kind: 'xlr',
    inputs: {
      method,
      numbers: method === 'xlrNumbers' ? counts.slice() : [],
      localTime: input.localTime,
      useTrueSolarTime: useTrue,
      calendarType,
      longitude: input.longitude ?? null,
      latitude: input.latitude ?? null,
      placeName: input.placeName || '',
      hexagram: '',
      movingPosition: null,
      question: input.question || '',
      category: input.category || '',
      notes: Array.isArray(input.notes) ? input.notes : [],
    },
    calendar: cal,
    lunar,
    casting: {
      kind: castingKind,
      counts,
      countLabels,
      calendarType,
      palaceNumbers: idxSeq.map((i) => i + 1),
      hourZhi,
      hourNumber,
      steps,
    },
    palaces,
    result,
    chain,
    chainText: chain.join(' → '),
    generatedAt: new Date().toISOString(),
  };
}

/** 末宫神数 → 应期区间（断语与量化共用，免得两处口径不一） */
function rangeOfPalace(p) {
  const nums = p.spiritNumbers || [1, 5, 7];
  const minDays = Math.max(1, nums[0]);
  const maxDays = Math.max(minDays + 1, nums[nums.length - 1]);
  return {
    minDays,
    maxDays,
    hint: `神数在${p.spiritText}：约 ${minDays} 至 ${maxDays} 日内见分晓；远事则以旬、月计。`,
  };
}

/**
 * 断课。与梅花 interpret() 同构（signature/tone/plain/grade），
 * 但**术语隔离**：只说六宫、六神、三宫、末宫——不出现体用、生克、卦名、爻辞、互变。
 */
export function interpretXlr(chart) {
  const { palaces, result, chainText } = chart;
  const range = rangeOfPalace(result);

  const tone = palaces.map((p, i) => ({
    key: `palace${i + 1}`,
    label: p.role,
    text: `${p.role}${p.name}（${p.deity}·${p.element}·${p.direction}）：${p.meaning}`,
  }));
  tone.push(
    { key: 'duan', label: '断', text: `末宫落${result.name}（${result.deity}·${result.element}·${result.direction}），总断为「${result.grade.label}」：${result.grade.desc}口诀曰「${result.koujue}」` },
    { key: 'yi', label: '宜', text: result.yi },
    { key: 'ji', label: '忌', text: result.ji },
    { key: 'yingqi', label: '应期', text: range.hint },
  );

  return {
    signature: result.signature,
    tone,
    plain: {
      oneLine: `小六壬落宫${result.name}（${result.role}）：${result.grade.label}——${result.grade.desc}`,
      focus: `三宫为「${chainText}」，以末宫${result.name}为主断。`,
      why: [
        `按起课之数顺数，末宫落${result.name}（${result.deity}·${result.element}·${result.direction}）。`,
        `宫诀曰「${result.koujue}」`,
        `总断「${result.grade.label}」：${result.grade.desc}`,
      ],
      how: [result.yi, `同时避开：${result.ji}`],
    },
    grade: { ...result.grade },
    category: chart.inputs?.category || '',
    generatedBy: '问心卦·小六壬断课引擎 v1',
  };
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

/**
 * 应期区间：以末宫神数（如小吉一·五·七）取首末为区间。
 * 形状与 core/yingqi.mjs 的 computeYingqi 同构，走势图与详情页可同样消费。
 */
export function computeXlrYingqi(chart, opts = {}) {
  const result = chart?.result;
  if (!result) return null;
  const range = rangeOfPalace(result);
  const from = opts.from || chart?.inputs?.localTime || chart?.calendar?.localTime || '';
  const fromTs = tsOf(from);
  const horizon = horizonFor(range.maxDays);
  return {
    minDays: range.minDays,
    maxDays: range.maxDays,
    from: fromTs ? fmtDate(fromTs) : '',
    to: fromTs ? fmtDate(fromTs + range.maxDays * DAY) : '',
    horizon: horizon.id,
    horizonName: horizon.name,
    unit: '以日计',
    hint: range.hint,
    basis: {
      palace: result.name,
      role: result.role,
      spiritNumbers: [...result.spiritNumbers],
      note: `末宫${result.name}之神数${result.spiritText}，取首末为区间`,
    },
    reason: `小六壬以末宫${result.name}之神数定应期：神数在${result.spiritText}，约 ${range.minDays} 至 ${range.maxDays} 日内见分晓；远事则以旬、月计之。`,
    source: 'computed',
  };
}

/** 助手简报：小六壬的紧凑结构（agent/tools.mjs 的 chartBrief 分支用） */
export function xlrBriefOf(chart, reading) {
  return {
    方法: XLR_LABELS[chart.method] || '道教小六壬',
    三宫: (chart.palaces || []).map((p) => ({
      位阶: p.role,
      宫: p.name,
      六神: p.deity,
      五行: p.element,
      方位: p.direction,
      神数: p.spiritText,
      口诀: p.koujue,
    })),
    结果宫: chart.result ? {
      宫: chart.result.name,
      位阶: chart.result.role,
      吉凶: chart.result.grade?.label || '',
      释义: chart.result.meaning,
      宜: chart.result.yi,
      忌: chart.result.ji,
    } : null,
    起课推演: chart.casting?.steps || [],
    时间: {
      钟表时间: chart.calendar?.dateTime || '',
      真太阳时: `${chart.calendar?.trueSolarTime || ''}（${chart.calendar?.trueHourZhi || ''}时，取数 ${chart.calendar?.trueHourNumber ?? ''}）`,
      农历: chart.lunar ? `${chart.lunar.year}年${chart.lunar.monthName}${chart.lunar.dayName}` : '（按公历月日起课）',
    },
    断语: reading ? {
      谶: reading.signature,
      定调: Object.fromEntries(reading.tone.map((t) => [t.label, t.text])),
      通俗解: reading.plain,
    } : undefined,
    提示: '小六壬论课只用六宫、六神、三宫与末宫断辞；不要搬用梅花易数的术语与断法。',
  };
}