/**
 * 问心卦 · 「卦条」格式
 * ------------------------------------------------------------
 * 这是本项目**保证稳定的对外导入契约**。
 *
 * 为什么另立一种格式：卦录的 JSON 完整但难手写，DeepSeek 的对话文本好粘但没规范。
 * 「卦条」取中间：一行一个字段的纯文本，人三十秒能写完，脚本能生成，AI 能照着写，
 * 而且有版本号、有 schema、有校验器——以后无论谁给你起卦，都能转成卦条录进来。
 *
 * ── 格式（v1）────────────────────────────────────────────
 *   # 卦条 v1
 *   题: 换城之占                 ← 可省
 *   问: 换一座城市重新开始，可行吗？
 *   类: 决策取舍                 ← 可省，省则由程序按「问」猜
 *   时: 2026-10-05 05:20         ← 钟表时间，必填
 *   地: 上海                     ← 可省，省则用配置里的默认地点
 *   经: 121.47                   ← 可省，随「地」自动取
 *   真太阳时: 是                  ← 可省，默认「是」
 *   法: 一数一时辰                ← 一数一时辰 | 两数 | 年月日时 | 已知卦象
 *   数: 63                       ← 「法」不是「已知卦象」时必填；两数写「617 15」
 *   本卦: 泽水困                  ← 「法」为「已知卦象」时必填
 *   动: 4                        ← 动爻（自下而上第几爻）
 *   原文: |                      ← 可省，可多行
 *     原文……
 *   背景: |  问答: |  方案: |  校勘: |   ← 均可省，多行块；用于记「完整占问」
 *   复盘条目: |                  ← 可省，多行块；一行一条，行首可写日期，
 *     2026-12-20 初试过了           如「2026-12-20 初试过了」。最早那条通常是首条复盘，
 *     2026-12-25 复试名单出了         之后是追记；程序只追加、不改写。
 *
 * 多条卦条：用一行 `---` 分隔。
 *
 * ── 小六壬之课（同一份格式的另一个分支，v1.6.0 起）──────
 * 分流只看「法」：写「小六壬报数」或「小六壬月日时辰」就走小六壬分支，
 * 两法的必填完全不同，不需要靠别的字段猜。
 *
 *   法: 小六壬报数                 ← 报数起课：数（1–3 个）＋ 时
 *   数: 3 5 2
 *   法: 小六壬月日时辰              ← 月日时辰起课：时（月与日由时推出）＋ 历
 *   历: 农历                      ← 农历（默认）｜公历；闰月按本月计
 *
 * 三宫**一律由引擎从「数 + 时」重算**；卦条里写了的「三宫／末宫」只用来对校，
 * 与重算不符就记进校勘（与梅花写「互卦／变卦」同一条规矩，见 ADR-0015）。
 * 公共字段（题／问／类／背景／签／标签／复盘／复盘条目／问答／原文／方案／校勘）
 * 两法共用同一套键与别名。
 * ────────────────────────────────────────────────────────
 */

import { isXlrChart, XLR_LABELS, XLR_PALACE_NAMES } from './xiaoliuren.mjs';

export const GUATIAO_VERSION = 1;
export const HEADER = '# 卦条 v1';

/** 字段别名表：左为内部字段，右为该字段可接受的全部键名 */
export const FIELD_ALIASES = {
  title: ['题', '标题', 'title'],
  question: ['问', '所问', '所问之事', '问题', 'question'],
  category: ['类', '类别', 'category'],
  tags: ['标签', 'tags'],
  localTime: ['时', '时间', '起卦时间', '钟表时间', 'time', 'localtime'],
  placeName: ['地', '地点', '城市', 'place'],
  longitude: ['经', '经度', '东经', 'longitude', 'lon'],
  latitude: ['纬', '纬度', '北纬', 'latitude', 'lat'],
  useTrueSolarTime: ['真太阳时', '真太阳', 'truesolar'],
  method: ['法', '起卦法', '方法', 'method'],
  numbers: ['数', '报数', '数字', 'numbers'],
  // 小六壬专用：月日时辰起课按农历还是公历；三宫／末宫只作对校（ADR-0015）
  calendar: ['历', '历法', 'calendar'],
  palaces: ['三宫', '宫', 'palaces'],
  final: ['末宫', '结果宫', 'final'],
  movingFrom: ['动爻取法', 'movingfrom'],
  hexagram: ['本卦', '卦', 'hexagram', 'ben'],
  movingPosition: ['动', '动爻', 'moving'],
  hu: ['互卦', 'hu'],
  bian: ['变卦', 'bian'],
  tiyong: ['体用', 'tiyong'],
  signature: ['签', '谶', 'signature'],
  narrative: ['原文', '原记录', '记录', 'narrative'],
  background: ['背景', '求测人背景', '背景动机', 'background'],
  plan: ['方案', '可执行方案', '行动方案', 'plan'],
  collation: ['校勘', '人工校勘', '勘误', 'collation'],
  qa: ['问答', '原文问答', '问答原文', 'qa'],
  status: ['复盘', '状态', 'status'],
  // 「实况」是 v5 之前的键：那时复盘正文是一个单独字段。现在统一成条目流，
  // 这个键仍然认（老归档文件不能白写），解析后作为**一条没有日期的条目**——
  // 不替用户猜日期，界面上显示「未记时间」，可以自己补。
  result: ['实况', '结果', 'result'],
  reviews: ['复盘条目', '追记', '复盘记录', 'reviews', 'entries'],
};

/** 支持 `键: |` 起多行块的字段。块内容原样保留，不做解析（`reviews` 除外，见下）。 */
export const BLOCK_FIELDS = new Set(['narrative', 'background', 'plan', 'collation', 'qa', 'reviews']);

/** 反向索引：键名（小写去空格）→ 内部字段 */
const KEY_LOOKUP = (() => {
  const m = new Map();
  for (const [field, names] of Object.entries(FIELD_ALIASES)) {
    for (const n of names) m.set(n.toLowerCase(), field);
  }
  return m;
})();

/** 起卦法的中文名 ↔ 内部 id */
export const METHOD_NAMES = {
  一数一时辰: 'numberAndTime',
  一数加时辰: 'numberAndTime',
  数与时: 'numberAndTime',
  两数: 'twoNumbers',
  两数起卦: 'twoNumbers',
  年月日时: 'timeOnly',
  已知卦象: 'manual',
  指定本卦: 'manual',
};
export const METHOD_LABELS = {
  numberAndTime: '一数一时辰',
  twoNumbers: '两数',
  timeOnly: '年月日时',
  manual: '已知卦象',
};

const BOOL_TRUE = new Set(['是', '对', '真', 'true', 'yes', 'y', '1', '用']);
const BOOL_FALSE = new Set(['否', '不', '假', 'false', 'no', 'n', '0', '不用']);

function parseBool(v) {
  const s = String(v).trim().toLowerCase();
  if (BOOL_TRUE.has(s)) return true;
  if (BOOL_FALSE.has(s)) return false;
  return null;
}

/** 把一段文本切成若干条卦条原文 */
export function splitGuaTiao(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n');
  // 以 `---` 或新的 `# 卦条` 头分条
  const chunks = raw
    .split(/\n\s*-{3,}\s*\n/)
    .flatMap((c) => c.split(/(?=^#\s*卦条)/m))
    .map((c) => c.trim())
    .filter(Boolean);
  return chunks.length ? chunks : [raw.trim()].filter(Boolean);
}

/** 判断一段文本是不是卦条（用于导入器自动分流） */
export function looksLikeGuaTiao(text) {
  const t = String(text || '');
  if (/^#\s*卦条/m.test(t)) return true;
  // 至少两个「中文键: 值」行，且其中一个键是卦条专属键
  const lines = t.split('\n').filter((l) => /^\s*[^#\s][^:：]{0,5}\s*[:：]\s*\S/.test(l));
  if (lines.length < 2) return false;
  const keys = lines.map((l) => l.split(/[:：]/)[0].trim().toLowerCase());
  const own = ['问', '时', '本卦', '动', '法', '数', '类', '地', '真太阳时', 'question', 'localtime'];
  return keys.some((k) => own.includes(k));
}

/**
 * 解析动爻：认 `4`、`第4爻`、`第二爻动`、`初爻`、`上爻` 等写法。
 * 中文数字在梅花易数里很常见，不认就太苛刻了。
 */
export function parsePosition(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n >= 1 && n <= 6 ? n : null;
  }
  const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 初: 1, 上: 6 };
  const cn = s.match(/(初|上|[一二三四五六])/);
  if (cn) return CN[cn[1]] || null;
  const digit = s.match(/([1-6])/);
  if (digit) return Number(digit[1]);
  return null;
}

/**
 * 兜底扫读：解析不了「键: 值」的行，试着从自由文本里抠出报数与时间。
 * 例如「报数 45，时间 2026-11-08 19:40」这种混写，用户很可能就这么写。
 */
function scavenge(line, values) {
  let hit = false;
  if (values.localTime === undefined) {
    const t = line.match(/(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})\D{0,3}(\d{1,2})\D{1,3}(\d{1,2})/);
    if (t) {
      values.localTime = `${t[1]}-${t[2].padStart(2, '0')}-${t[3].padStart(2, '0')} ${t[4].padStart(2, '0')}:${t[5]}`;
      hit = true;
    }
  }
  if (values.numbers === undefined) {
    const n = line.match(/(?:报数|数字|数|取数)\s*[:：]?\s*(\d{1,4})/);
    if (n) {
      values.numbers = n[1];
      hit = true;
    }
  }
  return hit;
}

/** 一行 `键: 值` */
function parseLine(line) {
  const m = String(line).match(/^\s*([^:：]+?)\s*[:：]\s*(.*)$/);
  if (!m) return null;
  return { key: m[1].trim().toLowerCase(), value: m[2] };
}

/**
 * 去掉值末尾的行内注释，如 `本卦: 泽水困（已知卦象时填）` → `泽水困`；
 * 若整个值就是一段括号说明，则视为空。
 * 行内注释用「（…）」或「(…)」或「 # …」表示——但 `#` 只在行中而非行首时才算注记。
 */
function stripNote(raw) {
  let v = String(raw).trim();
  v = v.replace(/\s+#\s.*$/, '').trim();
  let prev;
  do {
    prev = v;
    v = v.replace(/[（(][^（()）]*[)）]\s*$/, '').trim();
  } while (v !== prev);
  return v;
}

/**
 * 解析**一条**卦条。
 * @param {string} text
 * @returns {object} 与 core/importer.mjs 的 parseOne 同形，可直接交给 /api/import/commit
 */
export function parseGuaTiao(text) {
  const src = String(text || '').replace(/\r\n/g, '\n');
  const values = {};
  const warnings = [];
  const unknownKeys = [];
  /** 多行块字段 → 正文。原文/背景/方案/校勘/问答共用同一套块规则。 */
  const blockValues = {};
  let inBlock = false;
  let blockField = null;
  let blockIndent = 0;
  let blockLines = [];

  const flushBlock = () => {
    if (inBlock && blockField && blockLines.length) blockValues[blockField] = blockLines.join('\n').trim();
    inBlock = false;
    blockField = null;
    blockLines = [];
  };

  for (const line of src.split('\n')) {
    // 「#」开头的整行都是注释（含 # 卦条 版本头），随便写，不参与解析
    if (/^\s*#/.test(line)) continue;
    if (inBlock) {
      if (!line.trim()) {
        blockLines.push('');
        continue;
      }
      const indent = line.match(/^\s*/)[0].length;
      if (indent >= blockIndent && blockIndent > 0) {
        blockLines.push(line.slice(blockIndent));
        continue;
      }
      flushBlock();
    }
    if (!line.trim()) continue;
    const kv = parseLine(line);
    if (!kv) {
      // 不是「键: 值」，先试着从自由文本里抠报数与时间
      if (!scavenge(line, values)) warnings.push(`无法解析的行（已跳过）：${line.trim().slice(0, 40)}`);
      continue;
    }
    const field = KEY_LOOKUP.get(kv.key);
    if (!field) {
      // 认不出的键名也扫一遍，再记为未知键
      scavenge(line, values);
      unknownKeys.push(kv.key);
      continue;
    }
    // 多行块：`原文: |`、`背景: |`、`方案: |`、`校勘: |`、`问答: |`
    if (BLOCK_FIELDS.has(field) && /^\s*[|>]\s*$/.test(kv.value)) {
      flushBlock();
      inBlock = true;
      blockField = field;
      blockIndent = (src.split('\n').find((l) => l.includes(line.trim())) || '').match(/^\s*/)[0].length + 2;
      continue;
    }
    values[field] = stripNote(kv.value);
  }
  flushBlock();

  /* ---- 归一 ---- */
  const localTime = values.localTime ? normalizeTime(values.localTime) : '';
  const methodRaw = values.method ? values.method.replace(/\s/g, '') : '';

  // 小六壬分支：分流只看「法」（v1.6.0 起，见 ADR-0015）。
  // 从前这里是一句「不支持」的拒收——那是导入层与其余各处（列表、详情、导出、助手工具、
  // schema 双分支）的不对称。现在两法各有各的必填，判据清楚，不需要猜。
  if (/小六壬|六壬|xlr|报数起课|月日时辰起课|三数起课/i.test(methodRaw)) {
    return parseXlrBlock({ values, blockValues, methodRaw, localTime, useTrueSolarTimeOf: (v) => (parseBool(v) ?? true) });
  }

  let method = METHOD_NAMES[methodRaw] || methodRaw || '';

  const numbers = values.numbers
    ? String(values.numbers).split(/[\s,，、/]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  // 「动爻: 第二爻动」这类写法里也含报数线索时不重复计入；报数单独扫过就够了
  if (!numbers.length) {
    const scanned = String(values.numbers || '').match(/\d+/);
    if (scanned) numbers.push(Number(scanned[0]));
  }

  const hexagram = values.hexagram || '';
  const movingPosition = parsePosition(values.movingPosition);

  // 未指定起卦法时按信息推断
  if (!method) {
    if (hexagram) method = 'manual';
    else if (numbers.length >= 2) method = 'twoNumbers';
    else if (numbers.length === 1) method = 'numberAndTime';
    else method = 'timeOnly';
    warnings.push(`未写「法」，已按所给信息推断为「${METHOD_LABELS[method]}」。`);
  }
  if (!['numberAndTime', 'twoNumbers', 'timeOnly', 'manual'].includes(method)) {
    warnings.push(`「法」的值「${values.method}」无法识别，已按所给信息推断。`);
    method = hexagram ? 'manual' : numbers.length >= 2 ? 'twoNumbers' : numbers.length === 1 ? 'numberAndTime' : 'timeOnly';
  }

  const useTrueSolarTime = values.useTrueSolarTime !== undefined
    ? (parseBool(values.useTrueSolarTime) ?? true)
    : true;

  /* ---- 必填与缺失 ---- */
  const missing = [];
  if (!localTime) missing.push('起卦时间');
  if (method === 'manual' && !hexagram) missing.push('本卦');
  if (method !== 'manual' && method !== 'timeOnly' && !numbers.length) missing.push('报数');
  if (method !== 'timeOnly' && !movingPosition) missing.push('动爻');

  const longitude = values.longitude !== undefined && values.longitude !== ''
    ? Number(values.longitude) : null;

  // 只把写了的字段放进 claimed —— 认不准的就不写，免得被当成「原述」而误报校勘
  const claimed = {};
  if (hexagram) claimed.ben = hexagram;
  if (values.hu) claimed.hu = values.hu;
  if (values.bian) claimed.bian = values.bian;
  if (movingPosition) claimed.moving = movingPosition;
  if (values.tiyong) claimed.tiyong = values.tiyong;

  // 卦名做一次宽松校验
  const hints = [];
  if (hexagram && !/^[乾兑离震巽坎艮坤]?[为]?[\u4e00-\u9fa5]{1,3}$/.test(hexagram.trim())) {
    hints.push(`本卦「${hexagram}」写法可疑，请核对（例：泽水困 / 困 / 47 / ䷮）。`);
  }

  const strategy = method === 'manual' ? 'hexagram' : 'cast';
  const known = [localTime, method === 'manual' ? hexagram : numbers.length, movingPosition, values.question, values.placeName || longitude !== null]
    .filter(Boolean).length;

  const block = {
    ok: missing.length === 0,
    source: 'gua-tiao',
    version: GUATIAO_VERSION,
    confidence: Math.round((known / 5) * 100),
    strategy,
    fields: {
      localTime,
      placeName: values.placeName || '',
      longitude,
      latitude: values.latitude !== undefined && values.latitude !== '' ? Number(values.latitude) : null,
      useTrueSolarTime,
      numbers,
      question: values.question || '',
      category: values.category || '',
      notes: [],
      method,
    },
    claimed,
    signature: values.signature || '',
    tags: values.tags ? String(values.tags).split(/[\s,，、|]+/).filter(Boolean) : [],
    review: {
      status: values.status || '待应验',
      log: [
        ...(values.result ? [{ at: '', text: String(values.result) }] : []),
        ...parseReviewEntries(blockValues.reviews),
      ],
    },
    title: values.title || '',
    hexagramText: hexagram,
    movingText: movingPosition ? `第${movingPosition}爻` : '',
    tiyongText: values.tiyong || '',
    detected: { times: localTime ? [localTime] : [], numbers, hexagrams: hexagram ? [hexagram] : [], places: values.placeName ? [values.placeName] : [] },
    warnings,
    unknownKeys,
    hints,
    missing,
    narrative: blockValues.narrative || values.narrative || '',
    background: blockValues.background || values.background || '',
    plan: blockValues.plan || values.plan || '',
    collation: blockValues.collation || values.collation || '',
    qa: blockValues.qa || values.qa || '',
  };

  // 只有卦条里明写了「动爻取法」才带上这个字段——留空才能让入库层按所述动爻反推取法。
  if (values.movingFrom !== undefined) {
    block.fields.movingFrom = /仅报数|number/i.test(values.movingFrom) ? 'number' : 'sum';
  }

  return block;
}

/**
 * 「法」里认出小六壬时走这里（ADR-0015）。
 * 两法的必填完全不同，所以分流只看「法」，不必从别的字段猜：
 *   报数起课（xlrNumbers）：数（1–3 个）＋ 时
 *   月日时辰起课（xlrTime）：时（月与日由时推出）＋ 历（默认农历）
 * 「三宫／末宫」只作对校——结果一律由引擎重算。
 */
function parseXlrBlock({ values, blockValues, methodRaw, localTime, useTrueSolarTimeOf }) {
  const warnings = [];
  const hints = [];

  let method = '';
  if (/报数|三数|数字起课|xlrnumbers/i.test(methodRaw)) method = 'xlrNumbers';
  else if (/月日时|时辰起课|xlrtime/i.test(methodRaw)) method = 'xlrTime';

  const allNumbers = values.numbers
    ? String(values.numbers).split(/[\s,，、/]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  if (!method) {
    method = allNumbers.length ? 'xlrNumbers' : 'xlrTime';
    warnings.push(`「法」没写清是哪种小六壬起课，已按所给信息推断为「${XLR_LABELS[method] || method}」。`);
  }
  if (method === 'xlrNumbers' && allNumbers.length > 3) {
    warnings.push(`报数起课最多三个数，多出的已略去：${allNumbers.slice(3).join(' ')}`);
  }
  const numbers = method === 'xlrNumbers' ? allNumbers.slice(0, 3) : [];

  // 「历」只对月日时辰起课有意义。不写按农历——那是有明确默认值的口径，不是猜，但要说出来。
  let calendarType = '';
  const calRaw = String(values.calendar || '').trim();
  if (method === 'xlrTime') {
    if (/公历|阳历|solar/i.test(calRaw)) calendarType = 'solar';
    else if (/农历|阴历|lunar/i.test(calRaw)) calendarType = 'lunar';
    else {
      calendarType = 'lunar';
      warnings.push('未写「历」，月与日按**农历**算（闰月按本月计）。要按公历数字起课，写一行「历: 公历」。');
    }
  } else if (calRaw) {
    warnings.push('报数起课不看「历」（月日不参与），那一行已忽略。');
  }

  // 写的三宫／末宫只作对校（ADR-0015 第 3 条）——不采信为结果
  const claimed = {};
  const palaceList = values.palaces
    ? String(values.palaces).split(/[\s,，、/]+/).filter(Boolean).slice(0, 3)
    : [];
  if (palaceList.length) claimed.palaces = palaceList;
  if (values.final) claimed.final = String(values.final).trim();
  for (const name of [...palaceList, claimed.final].filter(Boolean)) {
    if (!XLR_PALACE_NAMES.includes(name)) {
      hints.push(`「${name}」不像六宫之一（应为：${XLR_PALACE_NAMES.join('、')}），请核对。`);
    }
  }

  const missing = [];
  if (!localTime) missing.push('起课时间');
  if (method === 'xlrNumbers' && !numbers.length) missing.push('报数');

  const longitude = values.longitude !== undefined && values.longitude !== ''
    ? Number(values.longitude) : null;
  const placeName = values.placeName || '';
  const question = values.question || '';
  const known = [localTime, method === 'xlrNumbers' ? numbers.length : calendarType, question, placeName || longitude !== null]
    .filter(Boolean).length;

  return {
    ok: missing.length === 0,
    source: 'gua-tiao',
    version: GUATIAO_VERSION,
    confidence: Math.round((known / 4) * 100),
    strategy: 'xlr',
    fields: {
      localTime,
      placeName,
      longitude,
      latitude: values.latitude !== undefined && values.latitude !== '' ? Number(values.latitude) : null,
      useTrueSolarTime: values.useTrueSolarTime !== undefined ? useTrueSolarTimeOf(values.useTrueSolarTime) : true,
      numbers,
      question,
      category: values.category || '',
      notes: [],
      method,
      ...(calendarType ? { calendarType } : {}),
    },
    claimed,
    signature: values.signature || '',
    tags: values.tags ? String(values.tags).split(/[\s,，、|]+/).filter(Boolean) : [],
    review: {
      status: values.status || '待应验',
      log: [
        ...(values.result ? [{ at: '', text: String(values.result) }] : []),
        ...parseReviewEntries(blockValues.reviews),
      ],
    },
    title: values.title || '',
    hexagramText: '',
    movingText: '',
    tiyongText: '',
    palaceText: [...palaceList, claimed.final].filter(Boolean).join(' '),
    detected: {
      times: localTime ? [localTime] : [],
      numbers,
      hexagrams: [],
      places: placeName ? [placeName] : [],
    },
    warnings,
    unknownKeys: [],
    hints,
    missing,
    narrative: blockValues.narrative || values.narrative || '',
    background: blockValues.background || values.background || '',
    plan: blockValues.plan || values.plan || '',
    collation: blockValues.collation || values.collation || '',
    qa: blockValues.qa || values.qa || '',
  };
}

/** '2026.10.5 5:20' / '2026年10月5日 5时20分' → '2026-10-05 05:20' */
export function normalizeTime(s) {
  const m = String(s).match(/(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})\D{0,3}(\d{1,2})\D{1,3}(\d{1,2})/);
  if (!m) return '';
  const [, y, mo, d, h, mi] = m;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/** 解析多条卦条 */
export function parseGuaTiaoMany(text) {
  return splitGuaTiao(text).map(parseGuaTiao).filter((b) => b.fields.localTime || b.claimed.ben || b.missing.length === 0 || b.narrative);
}

/** 追加一个 `键: |` 多行块 */
function pushBlock(out, label, text) {
  if (!text) return;
  out.push(`${label}: |`);
  for (const line of String(text).split('\n')) out.push(`  ${line}`);
}

/**
 * 复盘条目块 → `[{at, text}]`。
 * 一行一条；行首写 `YYYY-MM-DD` 就当这一条的日期，没写就留空串。
 * 空行跳过——多行块里夹空行是手写文件常事，不该变成一条空条目。
 */
function parseReviewEntries(text) {
  return String(text || '').split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(\d{4}-\d{2}-\d{2})\s+(.*)$/);
      return m ? { at: m[1], text: m[2] } : { at: '', text: line };
    });
}

/** 复盘条目 → 多行块正文（导出用；一行一条，正文里的换行压成空格） */
function entriesText(log) {
  return (log || [])
    .filter((e) => e && String(e.text || '').trim())
    .map((e) => `${e.at ? `${e.at} ` : ''}${String(e.text).replace(/\n/g, ' ')}`)
    .join('\n');
}

/**
 * 小六壬卦录 → 卦条（导出 → 手改 → 再导入，可往返）。
 * 时／法／数（或历）都要写出来，否则解回来会报缺——它是一条**真卦条**，
 * 不再是 v1.5.x 那种「只作文字存档」的说明（ADR-0015 第 4 条）。
 * 三宫写上是为了对校：重算结果与它不符时会被记进校勘，而不是直接采信。
 */
function xlrToGuaTiao(rec, withNarrative) {
  const c = rec.cast || {};
  const L = [];
  L.push(HEADER);
  if (rec.title) L.push(`题: ${rec.title}`);
  if (rec.question) L.push(`问: ${rec.question}`);
  L.push(`类: ${rec.category || '其他'}`);
  pushBlock(L, '背景', rec.background);
  L.push(`时: ${c.localTime || rec.chart?.calendar?.dateTime || ''}`);
  if (c.placeName) L.push(`地: ${c.placeName}`);
  if (c.longitude !== null && c.longitude !== undefined) L.push(`经: ${c.longitude}`);
  if (c.latitude) L.push(`纬: ${c.latitude}`);
  L.push(`真太阳时: ${c.useTrueSolarTime === false ? '否' : '是'}`);
  L.push(`法: ${XLR_LABELS[c.method] || '小六壬报数'}`);
  if (c.numbers?.length) L.push(`数: ${c.numbers.join(' ')}`);
  if (c.method === 'xlrTime') L.push(`历: ${c.calendarType === 'solar' ? '公历' : '农历'}`);
  const palaces = (rec.chart?.palaces || []).map((p) => p.name).filter(Boolean);
  if (palaces.length) L.push(`三宫: ${palaces.join(' ')}`);
  if (rec.reading?.signature) L.push(`签: ${rec.reading.signature}`);
  if (rec.tags?.length) L.push(`标签: ${rec.tags.join(' ')}`);
  if (rec.review?.status) L.push(`复盘: ${rec.review.status}`);
  pushBlock(L, '复盘条目', entriesText(rec.review?.log));
  pushBlock(L, '问答', rec.qa);
  if (withNarrative) pushBlock(L, '原文', rec.narrative);
  pushBlock(L, '方案', rec.plan);
  pushBlock(L, '校勘', rec.collation);
  return L.join('\n');
}

/**
 * 由卦录生成卦条（导出 → 手改 → 再导入，可往返）。
 * @param {object} rec 卦录
 * @param {object} [opts] { withNarrative=true }
 */
export function toGuaTiao(rec, opts = {}) {
  const withNarrative = opts.withNarrative !== false;
  if (isXlrChart(rec.chart)) return xlrToGuaTiao(rec, withNarrative);
  const c = rec.cast || {};
  const L = [];
  const block = (out, label, text) => pushBlock(out, label, text);
  L.push(HEADER);
  if (rec.title) L.push(`题: ${rec.title}`);
  if (rec.question) L.push(`问: ${rec.question}`);
  L.push(`类: ${rec.category || '其他'}`);
  block(L, '背景', rec.background);
  L.push(`时: ${c.localTime || rec.chart?.calendar?.dateTime || ''}`);
  if (c.placeName) L.push(`地: ${c.placeName}`);
  if (c.longitude !== null && c.longitude !== undefined) L.push(`经: ${c.longitude}`);
  if (c.latitude) L.push(`纬: ${c.latitude}`);
  L.push(`真太阳时: ${c.useTrueSolarTime === false ? '否' : '是'}`);
  L.push(`法: ${METHOD_LABELS[c.method] || c.method || '已知卦象'}`);
  if (c.numbers?.length) L.push(`数: ${c.numbers.join(' ')}`);
  if (c.movingFrom === 'number') L.push('动爻取法: 仅报数');
  if (rec.chart?.ben) L.push(`本卦: ${rec.chart.ben.fullName}`);
  if (rec.chart?.moving) L.push(`动: ${rec.chart.moving.position}`);
  if (rec.chart?.hu) L.push(`互卦: ${rec.chart.hu.fullName}`);
  if (rec.chart?.bian) L.push(`变卦: ${rec.chart.bian.fullName}`);
  if (rec.chart?.tiyong) {
    const t = rec.chart.tiyong;
    L.push(`体用: 体${t.ti.name}${t.ti.element}，用${t.yong.name}${t.yong.element}，${t.relation.label}`);
  }
  if (rec.reading?.signature) L.push(`签: ${rec.reading.signature}`);
  if (rec.tags?.length) L.push(`标签: ${rec.tags.join(' ')}`);
  if (rec.review?.status) L.push(`复盘: ${rec.review.status}`);
  block(L, '复盘条目', entriesText(rec.review?.log));
  block(L, '问答', rec.qa);
  if (withNarrative) block(L, '原文', rec.narrative);
  block(L, '方案', rec.plan);
  block(L, '校勘', rec.collation);
  return L.join('\n');
}

/**
 * 模板：给「新建一条卦条」用。`#` 开头的整行是注释，删掉不影响解析。
 * @param {'meihua'|'xlr'} [kind='meihua'] 两法各一套（ADR-0015 第 6 条）——界面只展示，不硬编码。
 */
export function template(kind = 'meihua') {
  if (kind === 'xlr') return xlrTemplate();
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const t = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
  return `${HEADER}
# ── 用法 ──────────────────────────────────────────────
# 一行一个字段，写成「键: 值」。# 开头的整行是注释，随便写，删掉也行。
# 多条卦条用单独一行 --- 分隔。
# 必填只有「时」；「法」为已知卦象时再填「本卦」与「动」；
# 其余起卦法要填「数」与「动」。认不准的会报缺，程序不会替你猜。
# ─────────────────────────────────────────────────
题: 换城之占
问: 换一座城市重新开始，可行吗？
类: 决策取舍
时: ${t}
地: 兰州
经: 103.83
真太阳时: 是
法: 一数一时辰
数: 1
动: 3
# 若「法」写「已知卦象」，则删掉上面「数」那一行，改用下面两行：
# 本卦: 泽水困
# 动: 4
# 可选：互卦 / 变卦 / 体用 —— 写了就与重算结果对校，不符则记入校勘
# 互卦: 风山渐
# 变卦: 天雷无妄
# 签: 谶语，写了就覆盖引擎生成的
# 标签: 主线之始 真太阳时
# ── 补充存录（都可省，用于「完整占问」，都支持「键: |」多行块）──
# 背景: |   求测人的背景、动机、几件事各占几分
# 问答: |   当初的原文问答，约定以「问：」「答：」起行
# 方案: |   可执行方案
# 校勘: |   人工校勘说明（与引擎自动算出的 corrections 分开）
# 复盘条目: |   一行一条：最早那条通常是首条复盘，之后是追记；行首可写日期
#   2026-12-20 初试过了
原文: |
  （可省。把当初的解读全文粘在这里，多行不限。）
`;
}

/** 小六壬的模板：两种起课法的必填不同，模板里把两条路都写出来（注释着的那条照抄即可）。 */
function xlrTemplate() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const t = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
  return `${HEADER}
# ── 用法（小六壬之课）──────────────────────────────────
# 与梅花卦条同一份格式，只是「法」不同。分流只看「法」，两法的必填不一样：
#   报数起课：法 写「小六壬报数」，再写「数」（1–3 个，空格分开）＋「时」
#   月日时辰起课：法 写「小六壬月日时辰」，只要「时」（月与日由时推出）＋「历」
# 三宫**一律由程序从「数 + 时」重算**——你写了「三宫／末宫」只用来对校，
# 与重算不符会记进校勘，不会直接采信。
# 「历」写 农历（默认，闰月按本月计）或 公历；不写按农历，并会在提示里说明。
# ─────────────────────────────────────────────────
题: 出门之课
问: 明天出门办事顺不顺？
类: 出行
时: ${t}
地: 兰州
经: 103.83
真太阳时: 是
法: 小六壬报数
数: 3 5 2
# 若走「月日时辰起课」，把上面「法」与「数」两行换成这两行（月与日由「时」推出）：
# 法: 小六壬月日时辰
# 历: 农历
# 可选：三宫 / 末宫 —— 写了就与重算结果对校，不符则记入校勘
# 三宫: 大安 留连 速喜
# 末宫: 速喜
# 签: 谶语，写了就覆盖引擎生成的
# 标签: 出行 报数起课
# ── 补充存录（与梅花卦条同一套键，都可省，都支持「键: |」多行块）──
# 背景: |   求测人的背景、动机、几件事各占几分
# 问答: |   当初的原文问答，约定以「问：」「答：」起行
# 方案: |   可执行方案
# 校勘: |   人工校勘说明（与引擎自动算出的 corrections 分开）
# 复盘条目: |   一行一条：最早那条通常是首条复盘，之后是追记；行首可写日期
#   2026-12-20 初试过了
原文: |
  （可省。把当初的断课全文粘在这里，多行不限。）
`;
}
