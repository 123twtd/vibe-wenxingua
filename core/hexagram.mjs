/**
 * 问心卦 · 六十四卦核心
 * ------------------------------------------------------------
 * 职责：
 *   1. 加载 knowledge/64gua.json（卦典）与 yaoci.json（爻辞），缺失时退化为内置卦表；
 *   2. 由上下卦合成六爻、由六爻取互卦／变卦／体用；
 *   3. 提供按卦名、全称、上下卦、卦序的多种检索。
 *
 * 约定：六爻数组一律「自下而上」[初,二,三,四,五,上]，1 为阳、0 为阴。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRIGRAMS, trigramByLines } from './bagua.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.resolve(HERE, '..', 'knowledge');

/**
 * 内置卦表（卦序 / 卦名 / 通行全称 / 上卦 / 下卦）。
 * 这份表同时用作知识库文件的完整性校验基准。
 */
export const BUILTIN_TABLE = [
  [1, '乾', '乾为天', '乾', '乾'], [2, '坤', '坤为地', '坤', '坤'],
  [3, '屯', '水雷屯', '坎', '震'], [4, '蒙', '山水蒙', '艮', '坎'],
  [5, '需', '水天需', '坎', '乾'], [6, '讼', '天水讼', '乾', '坎'],
  [7, '师', '地水师', '坤', '坎'], [8, '比', '水地比', '坎', '坤'],
  [9, '小畜', '风天小畜', '巽', '乾'], [10, '履', '天泽履', '乾', '兑'],
  [11, '泰', '地天泰', '坤', '乾'], [12, '否', '天地否', '乾', '坤'],
  [13, '同人', '天火同人', '乾', '离'], [14, '大有', '火天大有', '离', '乾'],
  [15, '谦', '地山谦', '坤', '艮'], [16, '豫', '雷地豫', '震', '坤'],
  [17, '随', '泽雷随', '兑', '震'], [18, '蛊', '山风蛊', '艮', '巽'],
  [19, '临', '地泽临', '坤', '兑'], [20, '观', '风地观', '巽', '坤'],
  [21, '噬嗑', '火雷噬嗑', '离', '震'], [22, '贲', '山火贲', '艮', '离'],
  [23, '剥', '山地剥', '艮', '坤'], [24, '复', '地雷复', '坤', '震'],
  [25, '无妄', '天雷无妄', '乾', '震'], [26, '大畜', '山天大畜', '艮', '乾'],
  [27, '颐', '山雷颐', '艮', '震'], [28, '大过', '泽风大过', '兑', '巽'],
  [29, '坎', '坎为水', '坎', '坎'], [30, '离', '离为火', '离', '离'],
  [31, '咸', '泽山咸', '兑', '艮'], [32, '恒', '雷风恒', '震', '巽'],
  [33, '遁', '天山遁', '乾', '艮'], [34, '大壮', '雷天大壮', '震', '乾'],
  [35, '晋', '火地晋', '离', '坤'], [36, '明夷', '地火明夷', '坤', '离'],
  [37, '家人', '风火家人', '巽', '离'], [38, '睽', '火泽睽', '离', '兑'],
  [39, '蹇', '水山蹇', '坎', '艮'], [40, '解', '雷水解', '震', '坎'],
  [41, '损', '山泽损', '艮', '兑'], [42, '益', '风雷益', '巽', '震'],
  [43, '夬', '泽天夬', '兑', '乾'], [44, '姤', '天风姤', '乾', '巽'],
  [45, '萃', '泽地萃', '兑', '坤'], [46, '升', '地风升', '坤', '巽'],
  [47, '困', '泽水困', '兑', '坎'], [48, '井', '水风井', '坎', '巽'],
  [49, '革', '泽火革', '兑', '离'], [50, '鼎', '火风鼎', '离', '巽'],
  [51, '震', '震为雷', '震', '震'], [52, '艮', '艮为山', '艮', '艮'],
  [53, '渐', '风山渐', '巽', '艮'], [54, '归妹', '雷泽归妹', '震', '兑'],
  [55, '丰', '雷火丰', '震', '离'], [56, '旅', '火山旅', '离', '艮'],
  [57, '巽', '巽为风', '巽', '巽'], [58, '兑', '兑为泽', '兑', '兑'],
  [59, '涣', '风水涣', '巽', '坎'], [60, '节', '水泽节', '坎', '兑'],
  [61, '中孚', '风泽中孚', '巽', '兑'], [62, '小过', '雷山小过', '震', '艮'],
  [63, '既济', '水火既济', '坎', '离'], [64, '未济', '火水未济', '离', '坎'],
];

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 六十四卦符号：U+4DC0 起连续对应卦序 1..64 */
export function hexagramSymbol(id) {
  return String.fromCodePoint(0x4dc0 + id - 1);
}

/** 由上下卦名取爻数组（自下而上六爻） */
export function sixLines(upper, lower) {
  const u = TRIGRAMS[upper];
  const l = TRIGRAMS[lower];
  if (!u || !l) throw new Error(`未知卦名：${upper} / ${lower}`);
  return [...l.lines, ...u.lines];
}

/** 由六爻（自下而上）反推上下卦 */
export function trigramsOfLines(lines) {
  const lower = trigramByLines(lines.slice(0, 3));
  const upper = trigramByLines(lines.slice(3, 6));
  return { upper, lower };
}

/** 互卦：二三四爻为下卦，三四五爻为上卦 */
export function mutualLines(lines) {
  return [lines[1], lines[2], lines[3], lines[2], lines[3], lines[4]];
}

/** 变卦：动爻（1-6，自下而上）变反 */
export function changedLines(lines, movingPosition) {
  const out = [...lines];
  const i = movingPosition - 1;
  out[i] = out[i] ? 0 : 1;
  return out;
}

/**
 * 体用判定（梅花易数正法）：**动爻所在的卦为用，另一卦为体**。
 * 动爻在下卦（1-3）→ 下卦为用、上卦为体；动爻在上卦（4-6）→ 上卦为用、下卦为体。
 */
export function tiYongOfLines(lines, movingPosition) {
  const { upper, lower } = trigramsOfLines(lines);
  const movingInUpper = movingPosition >= 4;
  return {
    ti: movingInUpper ? lower : upper,
    yong: movingInUpper ? upper : lower,
    movingInUpper,
    movingPosition,
  };
}

class HexagramLibrary {
  constructor() {
    this.byId = new Map();
    this.byName = new Map();
    this.byFullName = new Map();
    this.byTrigrams = new Map();
    this.lines = new Map();
    this.yong = new Map();
    this.source = 'builtin';
    this.warnings = [];
    this.load();
  }

  load() {
    // 1) 基础表：以内置表为准（已人工核对），知识库只作补充与校验
    for (const [id, name, fullName, upper, lower] of BUILTIN_TABLE) {
      const entry = {
        id,
        name,
        fullName,
        upper,
        lower,
        symbol: hexagramSymbol(id),
        upperNature: TRIGRAMS[upper].nature,
        lowerNature: TRIGRAMS[lower].nature,
        palace: '',
        coreMeaning: TRIGRAMS[upper].image,
        keywords: [],
        guaci: '',
        xiang: '',
        fortune: '平',
        advice: '',
        known: false,
      };
      this.byId.set(id, entry);
    }

    // 2) 合并 knowledge/64gua.json
    const gua = readJsonSafe(path.join(KNOWLEDGE_DIR, '64gua.json'));
    if (gua && Array.isArray(gua.hexagrams)) {
      this.source = 'knowledge';
      for (const h of gua.hexagrams) {
        const base = this.byId.get(h.id);
        if (!base) continue;
        // 上/下卦与内置表不一致时保留内置值并记录告警（内置表已人工核验）
        if ((h.upper && h.upper !== base.upper) || (h.lower && h.lower !== base.lower)) {
          this.warnings.push(
            `第${h.id}卦「${base.name}」上下卦与内置表不符：文件为 ${h.upper}/${h.lower}，采用 ${base.upper}/${base.lower}`,
          );
        }
        Object.assign(base, {
          palace: h.palace || '',
          coreMeaning: h.coreMeaning || base.coreMeaning,
          keywords: Array.isArray(h.keywords) ? h.keywords : [],
          guaci: h.guaci || '',
          xiang: h.xiang || '',
          fortune: h.fortune || '平',
          advice: h.advice || '',
          known: true,
        });
      }
    } else {
      this.warnings.push('未找到 knowledge/64gua.json，已退化为内置卦表（卦辞、象辞为空）。');
    }

    // 3) 爻辞
    const yao = readJsonSafe(path.join(KNOWLEDGE_DIR, 'yaoci.json'));
    if (yao && yao.lines) {
      for (const [k, arr] of Object.entries(yao.lines)) {
        if (Array.isArray(arr) && arr.length === 6) this.lines.set(Number(k), arr);
      }
      if (yao.yong) for (const [k, v] of Object.entries(yao.yong)) this.yong.set(Number(k), v);
    } else {
      this.warnings.push('未找到 knowledge/yaoci.json，爻辞将留空。');
    }

    // 4) 索引
    for (const e of this.byId.values()) {
      this.byName.set(e.name, e);
      this.byFullName.set(e.fullName, e);
      this.byTrigrams.set(`${e.upper}|${e.lower}`, e);
    }
  }

  /** 重新加载知识库（插件或用户替换文件后调用） */
  reload() {
    this.byId.clear();
    this.byName.clear();
    this.byFullName.clear();
    this.byTrigrams.clear();
    this.lines.clear();
    this.yong.clear();
    this.warnings = [];
    this.load();
    return { source: this.source, warnings: this.warnings, count: this.byId.size };
  }

  get(id) {
    return this.byId.get(Number(id)) || null;
  }

  byNames(upper, lower) {
    return this.byTrigrams.get(`${upper}|${lower}`) || null;
  }

  /** 宽松检索：支持「革」「泽火革」「䷰」「49」 */
  find(input) {
    if (input === null || input === undefined) return null;
    const raw = String(input).trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) return this.get(Number(raw)) || null;
    const cp = [...raw].find((ch) => ch.codePointAt(0) >= 0x4dc0 && ch.codePointAt(0) <= 0x4dff);
    if (cp) return this.get(cp.codePointAt(0) - 0x4dc0 + 1) || null;
    const cleaned = raw.replace(/[（(].*?[)）]/g, '').replace(/[卦䷀-䷿\s]/g, '');
    if (this.byFullName.has(cleaned)) return this.byFullName.get(cleaned);
    if (this.byName.has(cleaned)) return this.byName.get(cleaned);
    // 末字为卦名（如「泽火革」→「革」）
    for (let len = 3; len >= 1; len -= 1) {
      const tail = cleaned.slice(-len);
      if (this.byName.has(tail)) return this.byName.get(tail);
    }
    // 名称包含匹配（取最长者）
    let best = null;
    for (const e of this.byId.values()) {
      if (cleaned.includes(e.name) && (!best || e.name.length > best.name.length)) best = e;
    }
    return best;
  }

  /** 取爻辞 */
  yaoText(id, position) {
    const arr = this.lines.get(Number(id));
    if (!arr) return '';
    return arr[position - 1] || '';
  }

  yongText(id) {
    return this.yong.get(Number(id)) || '';
  }

  /** 由六爻数组得到完整卦对象 */
  resolve(lines) {
    const { upper, lower } = trigramsOfLines(lines);
    const entry = this.byNames(upper, lower);
    return { ...entry, upper, lower, lines: [...lines] };
  }

  all() {
    return [...this.byId.values()].sort((a, b) => a.id - b.id);
  }

  stats() {
    return {
      source: this.source,
      count: this.byId.size,
      withGuaci: [...this.byId.values()].filter((e) => e.guaci).length,
      withYaoci: this.lines.size,
      warnings: this.warnings,
    };
  }
}

let singleton = null;
export function library() {
  if (!singleton) singleton = new HexagramLibrary();
  return singleton;
}

/** 便捷：取卦对象（含知识库字段） */
export function hexagram(input) {
  return library().find(input);
}
