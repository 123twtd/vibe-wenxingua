/**
 * 问心卦 · 八卦基础数据
 * ------------------------------------------------------------
 * 梅花易数取「先天八卦」之数：乾1 兑2 离3 震4 巽5 坎6 艮7 坤8（余0取坤）。
 * 六爻的爻位一律「自下而上」：[初,二,三,四,五,上]，1 为阳爻、0 为阴爻。
 */

/** 八卦：先天数、卦象、五行、方位、卦德、三爻（自下而上） */
export const TRIGRAMS = {
  乾: {
    name: '乾', symbol: '☰', number: 1, nature: '天', element: '金',
    direction: '西北', yin: false, virtue: '健', lines: [1, 1, 1],
    image: '刚健不息', wuxingColor: '#d4a843',
  },
  兑: {
    name: '兑', symbol: '☱', number: 2, nature: '泽', element: '金',
    direction: '西', yin: true, virtue: '悦', lines: [1, 1, 0],
    image: '和悦相说', wuxingColor: '#e0d6b8',
  },
  离: {
    name: '离', symbol: '☲', number: 3, nature: '火', element: '火',
    direction: '南', yin: true, virtue: '丽', lines: [1, 0, 1],
    image: '附丽光明', wuxingColor: '#c0392b',
  },
  震: {
    name: '震', symbol: '☳', number: 4, nature: '雷', element: '木',
    direction: '东', yin: false, virtue: '动', lines: [1, 0, 0],
    image: '奋动而起', wuxingColor: '#4a9e6e',
  },
  巽: {
    name: '巽', symbol: '☴', number: 5, nature: '风', element: '木',
    direction: '东南', yin: true, virtue: '入', lines: [0, 1, 1],
    image: '柔顺渐入', wuxingColor: '#5fa88a',
  },
  坎: {
    name: '坎', symbol: '☵', number: 6, nature: '水', element: '水',
    direction: '北', yin: false, virtue: '陷', lines: [0, 1, 0],
    image: '重险而行', wuxingColor: '#5b8cc7',
  },
  艮: {
    name: '艮', symbol: '☶', number: 7, nature: '山', element: '土',
    direction: '东北', yin: false, virtue: '止', lines: [0, 0, 1],
    image: '止而不迁', wuxingColor: '#a9865b',
  },
  坤: {
    name: '坤', symbol: '☷', number: 8, nature: '地', element: '土',
    direction: '西南', yin: true, virtue: '顺', lines: [0, 0, 0],
    image: '厚德载物', wuxingColor: '#b09a6d',
  },
};

/** 先天八卦数 → 卦名（余 0 视作 8，即坤） */
export const NUMBER_TO_TRIGRAM = ['坤', '乾', '兑', '离', '震', '巽', '坎', '艮'];

/** 由余数（1-8，或 0 代表 8）取卦名 */
export function trigramByRemainder(rem) {
  const n = ((rem % 8) + 8) % 8 || 8;
  return NUMBER_TO_TRIGRAM[n];
}

/** 由三爻（自下而上）取卦名 */
export function trigramByLines(lines) {
  const key = lines.map((n) => (n ? 1 : 0)).join('');
  for (const t of Object.values(TRIGRAMS)) {
    if (t.lines.join('') === key) return t.name;
  }
  throw new Error(`无法识别的三爻：${key}`);
}

/** 五行相生：生我者与被生者 */
export const WUXING_SHENG = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
/** 五行相克 */
export const WUXING_KE = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };

/**
 * 体用生克：以「体」为我、「用」为事。
 * 用生体（吉）> 比和（吉）> 体克用（小吉而耗）> 体生用（耗）> 用克体（凶）
 */
export function wuxingRelation(tiElement, yongElement) {
  if (tiElement === yongElement) {
    return { key: 'bihe', label: '体用比和', grade: 2, auspice: '吉', verb: '同气', detail: '同气相求' };
  }
  if (WUXING_SHENG[yongElement] === tiElement) {
    return { key: 'yong_sheng_ti', label: '用生体', grade: 3, auspice: '吉', verb: '生', detail: '用卦生体卦' };
  }
  if (WUXING_SHENG[tiElement] === yongElement) {
    return { key: 'ti_sheng_yong', label: '体生用', grade: -1, auspice: '小耗', verb: '生', detail: '体卦生用卦' };
  }
  if (WUXING_KE[tiElement] === yongElement) {
    return { key: 'ti_ke_yong', label: '体克用', grade: 1, auspice: '可成而耗', verb: '克', detail: '体卦克用卦' };
  }
  if (WUXING_KE[yongElement] === tiElement) {
    return { key: 'yong_ke_ti', label: '用克体', grade: -3, auspice: '凶', verb: '克', detail: '用卦克体卦' };
  }
  return { key: 'unknown', label: '生克未明', grade: 0, auspice: '平', verb: '—', detail: '' };
}

/** 十二地支（时辰、月建、年支通用） */
export const DIZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
/** 地支五行 */
export const DIZHI_ELEMENT = {
  子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火',
  午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水',
};
/** 地支生肖 */
export const DIZHI_ANIMAL = {
  子: '鼠', 丑: '牛', 寅: '虎', 卯: '兔', 辰: '龙', 巳: '蛇',
  午: '马', 未: '羊', 申: '猴', 酉: '鸡', 戌: '狗', 亥: '猪',
};
export const TIANGAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
export const TIANGAN_ELEMENT = {
  甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土',
  己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水',
};

/**
 * 五行旺衰（以月建论）：旺 → 相 → 休 → 囚 → 死。
 * 四季月（辰未戌丑）土旺；春木、夏火、秋金、冬水。
 */
export const WANG_SHUAI_TABLE = {
  春: { 木: '旺', 火: '相', 水: '休', 金: '囚', 土: '死' },
  夏: { 火: '旺', 土: '相', 木: '休', 水: '囚', 金: '死' },
  秋: { 金: '旺', 水: '相', 土: '休', 火: '囚', 木: '死' },
  冬: { 水: '旺', 木: '相', 金: '休', 土: '囚', 火: '死' },
  四季: { 土: '旺', 金: '相', 火: '休', 木: '囚', 水: '死' },
};

/** 由月支取季节键 */
export function seasonByMonthZhi(zhi) {
  if (['寅', '卯'].includes(zhi)) return '春';
  if (['巳', '午'].includes(zhi)) return '夏';
  if (['申', '酉'].includes(zhi)) return '秋';
  if (['亥', '子'].includes(zhi)) return '冬';
  return '四季';
}

/** 取某五行在某月建的旺衰 */
export function wangShuai(element, monthZhi) {
  const season = seasonByMonthZhi(monthZhi);
  return { season, state: WANG_SHUAI_TABLE[season][element] || '平' };
}

/** 旺衰 → 力量系数（-2 ~ +2），用于吉凶计分 */
export const WANG_SHUAI_SCORE = { 旺: 2, 相: 1, 休: 0, 囚: -1, 死: -2 };

/** 旺衰的文言说法，供断语引擎取用 */
export const WANG_SHUAI_PHRASE = {
  旺: '当令而气盛',
  相: '得时而有辅',
  休: '退气而力闲',
  囚: '失时而受制',
  死: '无气而力竭',
};

/** 爻位名（自下而上） */
export const YAO_POSITION_NAME = ['初', '二', '三', '四', '五', '上'];
/** 爻位象征 */
export const YAO_POSITION_SYMBOL = {
  1: '事之始，务在谨',
  2: '事之中，臣位得中',
  3: '内卦之极，多凶之地',
  4: '外卦之始，近君多惧',
  5: '君位，主事之枢',
  6: '事之终，处穷而变',
};

/** 由爻位与阴阳取爻题，如 3 + 阳 → 「九三」 */
export function yaoTitle(position, isYang) {
  const num = isYang ? '九' : '六';
  if (position === 1) return `初${num}`;
  if (position === 6) return `上${num}`;
  return `${num}${YAO_POSITION_NAME[position - 1]}`;
}
