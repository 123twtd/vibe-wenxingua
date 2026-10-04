/**
 * 问心卦 · 卦象导入解析器
 * ------------------------------------------------------------
 * 把「粘贴进来的 DeepSeek 起卦文本」解析成结构化字段，供一键入库。
 *
 * 支持三种来源：
 *   1. 对话式起卦（「### 🌿 起卦推算」+「### 🔮 卦象解读」那种长文）；
 *   2. 对照表式（「| 占问 | 数字/时间 | 本卦 | 互卦 | 变卦 | 体用关系 |」，一行一卦）；
 *   3. 本程序自己导出的卦录 JSON。
 *
 * 解析原则：**宁可少认，不可错认**。认出的字段进 fields，认不准的进 missing，
 * 原文一律整段存入 narrative，人工复核时再改。
 */

import { library } from './hexagram.mjs';
import { PLACES } from './calendar.mjs';
import { looksLikeGuaTiao, parseGuaTiaoMany } from './guaTiao.mjs';

const TRIGRAM_CHARS = '乾兑离震巽坎艮坤';
const YAO_WORD = { 初: 1, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 上: 6, 六: 6 };

/* ============================================================
 * 一、单块解析
 * ========================================================== */

/**
 * 解析一段文本为一个候选卦录。
 * @param {string} text
 * @returns {object}
 */
export function parseOne(text) {
  const src = String(text || '').replace(/\r\n/g, '\n');
  const warnings = [];
  const missing = [];

  const time = findTime(src);
  const place = findPlace(src);
  const numbers = findNumbers(src);
  const hexes = findHexagrams(src);
  const moving = findMoving(src);
  const tiyong = findTiyong(src);
  const question = findQuestion(src);

  if (!hexes.ben) missing.push('本卦');
  if (!moving) missing.push('动爻');
  if (numbers.length === 0) missing.push('报数');
  if (!time.localTime) missing.push('起卦时间');

  const claimed = {
    ben: hexes.ben || null,
    hu: hexes.hu || null,
    bian: hexes.bian || null,
    moving: moving || null,
    tiyong: tiyong.text || null,
  };

  const known = [hexes.ben, moving, time.localTime, numbers.length ? 'n' : null, place?.name]
    .filter(Boolean).length;

  const strategy = hexes.ben && moving
    ? 'hexagram'          // 有本卦与动爻 → 直接立卦
    : numbers.length && time.localTime
      ? 'cast'            // 有报数与时间 → 按原法重起
      : 'incomplete';

  return {
    ok: strategy !== 'incomplete',
    confidence: Math.round((known / 5) * 100),
    strategy,
    fields: {
      localTime: time.localTime || '',
      timeRaw: time.raw || '',
      placeName: place?.name || '',
      longitude: place?.longitude ?? null,
      useTrueSolarTime: time.useTrueSolar === true ? true : time.useTrueSolar === false ? false : true,
      numbers,
      question,
      category: '',
      notes: [],
    },
    claimed,
    hexagramText: hexes.raw,
    movingText: moving ? `第${moving}爻` : '',
    tiyongText: tiyong.text || '',
    detected: { times: time.all, numbers, hexagrams: hexes.all, places: place ? [place.name] : [] },
    warnings,
    missing,
    narrative: src.trim(),
  };
}

/* ============================================================
 * 二、分块
 * ========================================================== */

/**
 * 把一大段粘贴内容切成若干候选卦录。
 * 切分依据：起卦小标题、「## 用户」段、Markdown 表格行、空行分隔的独立段落。
 */
export function parseMany(text) {
  const src = String(text || '').replace(/\r\n/g, '\n');

  // 0) 卦条：本项目保证稳定的导入契约，优先级最高
  if (looksLikeGuaTiao(src)) {
    const blocks = parseGuaTiaoMany(src);
    if (blocks.length) return blocks;
  }

  // 纯 JSON（本程序导出）
  const asJson = tryJson(src);
  if (asJson) return [{ kind: 'json', records: asJson }];

  const blocks = [];
  const lines = src.split('\n');

  // 表格行式：以 | 开头且含 卦名 的行，各自成块
  const tableRows = lines.filter((l) => /^\s*\|/.test(l) && countHexNames(l) >= 1);
  if (tableRows.length >= 2 && countHexNames(src) >= 4) {
    for (const row of tableRows) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(row)) continue;
      const b = parseOne(row);
      if (b.ok) blocks.push(b);
    }
  }
  if (blocks.length) return dedupeBlocks(blocks);

  // 起卦小标题式：以标题为界切段，并把「上一段的用户提问」并入本段，便于提取所问
  const headRe = /^#{2,4}\s*.*(起卦|推算|占卜|卦象解读)/m;
  if (headRe.test(src)) {
    const idx = [];
    const allHeadRe = /^#{2,4}\s*(?:🌿|🔮|📜|🌟|🌙)?\s*.*$/gm;
    let m;
    while ((m = allHeadRe.exec(src)) !== null) idx.push(m.index);
    idx.push(src.length);
    for (let i = 0; i < idx.length - 1; i += 1) {
      const seg = src.slice(idx[i], idx[i + 1]);
      if (!/起卦|推算|本卦/.test(seg)) continue;
      const prevStart = i > 0 ? idx[i - 1] : 0;
      const context = src.slice(prevStart, idx[i]);        // 上一段：多半含用户提问
      const b = parseOne(seg);
      if (!b.fields.question && context) {
        const q = findQuestion(context);
        if (q) b.fields.question = q;
      }
      b.narrative = (context + seg).trim();
      if (b.ok) blocks.push(b);
    }
  }

  // 「## 用户」对话式
  if (!blocks.length) {
    const parts = src.split(/^#{2,4}\s*用户\s*$/m).slice(1);
    for (const part of parts) {
      const seg = part.split(/^#{2,4}\s*用户\s*$/m)[0];
      const b = parseOne(seg);
      if (b.ok) blocks.push(b);
    }
  }

  // 兜底：整段当一个
  if (!blocks.length) {
    const b = parseOne(src);
    if (b.ok) blocks.push(b);
  }
  return dedupeBlocks(blocks);
}

function dedupeBlocks(blocks) {
  // 同一卦（本卦 + 动爻）在多处被引述时，只留信息最全的那一条
  const best = new Map();
  for (const b of blocks) {
    const key = b.claimed?.ben && b.claimed?.moving
      ? `${b.claimed.ben}|${b.claimed.moving}`
      : `t:${b.fields.localTime}|${b.fields.numbers.join(',')}`;
    const prev = best.get(key);
    if (!prev || b.confidence > prev.confidence) best.set(key, b);
  }
  return [...best.values()];
}

function tryJson(src) {
  const t = src.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return null;
  try {
    const data = JSON.parse(t);
    const arr = Array.isArray(data) ? data : data.records ? data.records : [data];
    const recs = arr.filter((x) => x && (x.chart || x.cast));
    return recs.length ? recs : null;
  } catch {
    return null;
  }
}

/* ============================================================
 * 三、字段识别
 * ========================================================== */

const DATE_PATTERNS = [
  // 2026年9月28日 3:12 ／ 2026.9.28 3:12 ／ 2026-09-28 03:12
  /(\d{4})\s*[年.\-/]\s*(\d{1,2})\s*[月.\-/]\s*(\d{1,2})\s*日?[^\d\n]{0,10}?(\d{1,2})\s*[:：]\s*(\d{2})/,
  // 3:12 with 阳历 label and date elsewhere
  /(?:阳历|北京时间|钟表时间|时间|此刻)[^\d\n]{0,8}(\d{4})\s*[年.\-/]\s*(\d{1,2})\s*[月.\-/]\s*(\d{1,2})[^\d\n]{0,8}(\d{1,2})\s*[:：]\s*(\d{2})/,
];

function findTime(src) {
  const all = [];
  let localTime = '';
  let raw = '';
  let useTrueSolar = null;

  for (const re of DATE_PATTERNS) {
    const m = src.match(re);
    if (m) {
      const [, y, mo, d, h, mi] = m;
      localTime = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:${mi}`;
      raw = m[0];
      break;
    }
  }

  // 只有「3:50」而没有年份时，尝试从文中其他位置补年份
  if (!localTime) {
    const yearMatch = src.match(/(20\d{2})\s*年/);
    const hm = src.match(/(?:时间|此刻|当前时间|北京时间)[^\d\n]{0,6}(\d{1,2})\s*[:：]\s*(\d{2})/)
      || src.match(/\b(\d{1,2})\s*[:：]\s*(\d{2})\b/);
    if (hm) {
      const h = String(hm[1]).padStart(2, '0');
      const mi = hm[2];
      // 优先用同段里出现的「月日」
      const md = src.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
      if (yearMatch && md) {
        localTime = `${yearMatch[1]}-${String(md[1]).padStart(2, '0')}-${String(md[2]).padStart(2, '0')} ${h}:${mi}`;
      } else if (yearMatch) {
        const dm = src.match(/(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})/);
        if (dm) localTime = `${dm[1]}-${String(dm[2]).padStart(2, '0')}-${String(dm[3]).padStart(2, '0')} ${h}:${mi}`;
      }
      if (!raw && hm) raw = hm[0];
    }
  }

  for (const m of src.matchAll(/\d{4}\s*[年.\-/]\s*\d{1,2}\s*[月.\-/]\s*\d{1,2}[^\n]{0,10}?\d{1,2}\s*[:：]\s*\d{2}/g)) {
    all.push(m[0].trim());
  }

  if (/真太阳时|真太阳/.test(src)) {
    const hasTrue = true;
    const hasClock = /钟表时间|按[^\n]{0,8}时辰取数|点为[子丑寅卯辰巳午未申酉戌亥]时/.test(src);
    if (hasTrue && !hasClock) useTrueSolar = true;
    else if (hasClock && !hasTrue) useTrueSolar = false;
    else useTrueSolar = null; // 两者并存，交由人工在预览里选定
  } else if (/钟表时间|按[^\n]{0,8}时辰取数|点为[子丑寅卯辰巳午未申酉戌亥]时/.test(src)) {
    useTrueSolar = false;
  }
  return { localTime, raw, all, useTrueSolar };
}

function findPlace(src) {
  for (const p of PLACES) {
    if (src.includes(p.name)) return p;
  }
  const lon = src.match(/东经\s*([\d.]+)/);
  if (lon) {
    return { name: `东经${lon[1]}°`, longitude: Number(lon[1]), latitude: null };
  }
  return null;
}

function findNumbers(src) {
  const out = [];
  const patterns = [
    /(?:你提供的?数字是|数字是|报数|取数|给出的数字是|用你提供的?)\s*[*\s]*?(\d{1,4})/g,
    /(?:^|\n)\s*(?:数字|数)\s*[:：]?\s*[*\s]*(\d{1,4})\b/gm,
    /(?:现金|金额|金额为)\s*(\d{1,4})/g,
    // 表格里的「数字/时间」单元格：18，2:20真太阳时
    /(\d{1,4})\s*[，,、]\s*\d{1,2}\s*[:：]\s*\d{2}/g,
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      const n = Number(m[1]);
      if (n > 0 && n < 100000 && !out.includes(n)) out.push(n);
    }
  }
  if (!out.length) {
    const m = src.match(/^\s*(\d{1,4})\s*$/m);
    if (m) out.push(Number(m[1]));
  }
  return out.slice(0, 4);
}

function countHexNames(text) {
  const lib = library();
  let n = 0;
  for (const h of lib.all()) {
    const re = new RegExp(h.fullName, 'g');
    const c = (text.match(re) || []).length;
    n += c;
    if (!c) {
      const re2 = new RegExp(`(?<![一-龥])${h.name}(?=卦|䷀-䷿|\\s|$|）|\\))`, 'g');
      n += (text.match(re2) || []).length;
    }
  }
  return n;
}

/** 从一段文字里取出卦名（用于「本卦：泽火革」这类局部片段） */
function pickHex(fragment) {
  if (!fragment) return null;
  const lib = library();
  const cleaned = fragment.replace(/[（(]\s*\d+\s*[)）]/g, '');
  const h = lib.find(cleaned);
  if (!h) return null;
  // 取局部片段里最先出现的那一卦
  let best = null;
  let bestAt = Infinity;
  for (const cand of lib.all()) {
    for (const key of [cand.fullName, cand.name]) {
      const at = cleaned.indexOf(key);
      if (at >= 0 && at < bestAt) {
        bestAt = at;
        best = cand;
      }
    }
  }
  return best || h;
}

function findHexagrams(src) {
  const out = { ben: null, hu: null, bian: null, raw: {}, all: [] };
  const labels = [
    ['ben', /(?:本卦|正卦|得卦)[^\n]{0,14}/g],
    ['hu', /(?:互卦|互体)[^\n]{0,14}/g],
    ['bian', /(?:变卦|之卦)[^\n]{0,14}/g],
  ];
  for (const [key, re] of labels) {
    for (const m of src.matchAll(re)) {
      const h = pickHex(m[0]);
      if (h) {
        out[key] = h.fullName;
        out.raw[key] = m[0].trim();
        break;
      }
    }
  }
  // 「**本卦**：天泽履（䷉）」这类加粗写法
  if (!out.ben) {
    const m = src.match(/\*{0,2}本卦\*{0,2}\s*[:：]?\s*([^\n]{2,16})/);
    const h = m && pickHex(m[1]);
    if (h) {
      out.ben = h.fullName;
      out.raw.ben = m[0];
    }
  }
  if (!out.hu) {
    const m = src.match(/\*{0,2}互卦\*{0,2}\s*[:：]?\s*([^\n]{2,16})/);
    const h = m && pickHex(m[1]);
    if (h) out.hu = h.fullName;
  }
  if (!out.bian) {
    const m = src.match(/\*{0,2}变卦\*{0,2}\s*[:：]?\s*([^\n]{2,16})/);
    const h = m && pickHex(m[1]);
    if (h) out.bian = h.fullName;
  }
  // 表格行：「| 考研为主+少量精投 | 01，3:38真太阳时 | 天泽履䷉ | 风火家人䷤ | 乾为天䷀ |」
  if (!out.ben && /^\s*\|/m.test(src)) {
    for (const line of src.split('\n')) {
      if (!/^\s*\|/.test(line)) continue;
      const cells = line.split('|').map((s) => s.trim()).filter(Boolean);
      const hexCells = cells.filter((cell) => /[䷀-䷿]/.test(cell) || /^[乾兑离震巽坎艮坤][为]/.test(cell));
      if (hexCells.length >= 2) {
        out.ben = pickHex(hexCells[0])?.fullName || out.ben;
        out.hu = pickHex(hexCells[1])?.fullName || out.hu;
        out.bian = pickHex(hexCells[hexCells.length - 1])?.fullName || out.bian;
        out.raw.table = line.trim();
        break;
      }
    }
  }
  const lib = library();
  const seen = new Set();
  for (const h of lib.all()) {
    if (src.includes(h.fullName) || new RegExp(`${h.symbol}`).test(src)) {
      if (!seen.has(h.fullName)) {
        seen.add(h.fullName);
        out.all.push(h.fullName);
      }
    }
  }
  return out;
}

function findMoving(src) {
  const direct = src.match(/第\s*([一二三四五六])\s*爻\s*动/);
  if (direct) return YAO_WORD[direct[1]] || null;
  const titled = src.match(/(?:^|[\s（(])(初|上|[九六][二三四五])\s*[：:]/);
  if (titled) {
    const t = titled[1];
    if (t.startsWith('初')) return 1;
    if (t.startsWith('上')) return 6;
    const map = { 二: 2, 三: 3, 四: 4, 五: 5 };
    return map[t[1]] || null;
  }
  const simple = src.match(/(初|上|[一二三四五六])\s*爻\s*动/);
  if (simple) return YAO_WORD[simple[1]] || null;
  const rem = src.match(/动爻[^\n]{0,40}?余\s*(\d)/);
  if (rem) {
    const n = Number(rem[1]);
    return n === 0 ? 6 : n;
  }
  return null;
}

function findTiyong(src) {
  const tri = `([${TRIGRAM_CHARS}])`;
  // 写法一：「体卦 离火」「用卦 兑金」（严格用「体卦／用卦」二字，避免「体用：体卦…」误配）
  let ti = src.match(new RegExp(`体卦[^${TRIGRAM_CHARS}\\n]{0,4}${tri}`));
  let yong = src.match(new RegExp(`用卦[^${TRIGRAM_CHARS}\\n]{0,4}${tri}`));
  // 写法二：「上卦 震木为用，下卦 兑金为体」
  if (!ti) ti = src.match(new RegExp(`${tri}[木火土金水]?为体`));
  if (!yong) yong = src.match(new RegExp(`${tri}[木火土金水]?为用`));
  // 写法三：「你为体卦 离火，所求之事为用卦 兑金」——已被写法一覆盖
  const rel = src.match(/(体克用|用克体|用生体|体生用|体用比和|比和)/);
  const text = [ti ? `体${ti[1]}` : '', yong ? `用${yong[1]}` : '', rel ? rel[1] : ''].filter(Boolean).join('，');
  return { ti: ti ? ti[1] : null, yong: yong ? yong[1] : null, relation: rel ? rel[1] : null, text };
}

function findQuestion(src) {
  const candidates = [];
  // 「请问：……？」「我能否……？」
  for (const m of src.matchAll(/[^\n。！]*[？?]/g)) {
    const s = m[0].trim().replace(/^[>*\s-]+/, '');
    if (s.length >= 12 && s.length <= 300) candidates.push(s);
  }
  // 「所问」「问：」
  const labeled = src.match(/(?:所问|问卦|问)[：:]\s*([^\n]{8,200})/);
  if (labeled) candidates.unshift(labeled[1].trim());
  // 「我想问」「我想再问」「帮我算」
  const wish = src.match(/(我(?:想问|想再问|要问|想占|能够|能否)[^\n]{8,200})/);
  if (wish) candidates.unshift(wish[1].trim());
  if (!candidates.length) return '';
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0].replace(/[*_`]/g, '').slice(0, 300);
}

/* ============================================================
 * 四、辅助
 * ========================================================== */

/** 由解析结果推断入库策略 */
export function suggestImport(parsed) {
  const f = parsed.fields;
  const mode = parsed.claimed?.ben && parsed.claimed?.moving
    ? 'hexagram'
    : f.numbers?.length && f.localTime
      ? 'cast'
      : 'manual-required';
  const castInput = mode === 'cast'
    ? {
      method: f.numbers.length >= 2 ? 'twoNumbers' : 'numberAndTime',
      numbers: f.numbers,
      localTime: f.localTime,
      longitude: f.longitude,
      placeName: f.placeName,
      useTrueSolarTime: f.useTrueSolarTime,
      question: f.question,
      category: f.category,
    }
    : null;
  return { mode, castInput };
}

export { pickHex };
