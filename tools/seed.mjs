/**
 * 问心卦 · 初始卦录录入
 * ------------------------------------------------------------
 * 把一份「用户／助手」成对的梅花易数对话记录（Markdown）里的起卦录成卦录，
 * 并把当初的原文整段存入「原文存录」。
 *
 * 用法：node tools/seed.mjs <你的语料.md> [--force]
 *   --force  已有同名 id 时覆盖
 *
 * ⚠️ **语料自备**：作者当初用的是自己的一份私人对话记录，它不随仓库发布。
 * 不传路径时按老约定去找工作区上一层的《梅花易数占卜对话全记录.md》；
 * 找不到会直接说清楚该怎么做，而不是抛一段 ENOENT 栈。
 * 没有现成语料也能起手：界面「导入」页粘卦条，或 `node tools/import.mjs --template`。
 *
 * 注：pairs 指的是「用户／助手」成对序号（从 1 起）。
 * 第 1 轮是「请你选择一种占卜方式」的开场，故首次起卦落在第 2 轮。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WORKSPACE = path.resolve(ROOT, '..');
const RECORDS_DIR = path.join(ROOT, 'data', 'records');
const ARG_FILE = process.argv.slice(2).find((a) => !a.startsWith('--'));
const MD_FILE = path.resolve(ARG_FILE || path.join(WORKSPACE, '梅花易数占卜对话全记录.md'));

if (!fs.existsSync(MD_FILE)) {
  console.error(`找不到语料文件：${MD_FILE}

这个脚本是把一份「用户／助手」成对的梅花易数对话记录录成卦录——**语料是作者本人的私人对话，不随仓库发布**。
用法：node tools/seed.mjs <你的语料.md> [--force]

没有现成语料也能用：
  · 在界面「导入」页直接粘卦条（最省事）；
  · 或 node tools/import.mjs --template 拿模板，照着写几条再导入。`);
  process.exit(2);
}

const core = {
  record: await import(pathToFileURL(path.join(ROOT, 'core', 'record.mjs')).href),
};

const FORCE = process.argv.includes('--force');

/* ---------- 一、把对话原文切成「用户／助手」成对 ---------- */
function parsePairs(md) {
  const parts = md.split(/^## (用户|助手)\s*$/m);
  const pairs = [];
  let cur = null;
  for (let i = 1; i < parts.length; i += 2) {
    const role = parts[i];
    const body = (parts[i + 1] || '').replace(/^\s*---\s*$/gm, '').trim();
    if (role === '用户') {
      if (cur) pairs.push(cur);
      cur = { user: body, assistant: '' };
    } else if (cur) {
      cur.assistant = body;
    }
  }
  if (cur) pairs.push(cur);
  return pairs;
}

/** 去掉内嵌的大段 HTML 源码（第 4 轮回复），保留说明文字 */
function stripHtmlBlock(text) {
  return text
    .replace(/```html[\s\S]*?```/g, '（此处为当初生成的网页源码，已略去——它的内容已由本卦录的结构化页面取代。）')
    .trim();
}

function narrativeOf(pairs, indexes, labels) {
  return indexes.map((i, k) => {
    const p = pairs[i - 1];
    if (!p) return '';
    const head = labels?.[k] ? `#### ${labels[k]}\n\n` : '';
    return `${head}**用户**\n\n${p.user}\n\n**助手**\n\n${stripHtmlBlock(p.assistant)}`;
  }).filter(Boolean).join('\n\n---\n\n');
}

/* ---------- 二、六次起卦 ---------- */
const LANZHOU = { placeName: '兰州', longitude: 103.83, latitude: 36.06 };

const SEEDS = [
  {
    id: '202609280312-01',
    title: '心愿之占：求职与考研双求，能否实现心愿与心安',
    category: '考研学业',
    question:
      '我能够实现自己的心愿和心安：也就是在今年阳历下半年找到税前15月薪、正常通勤生活之外一年攒下十万以上、薪资14薪、无坑的工作，'
      + '地点最好在长沙成都上海苏州杭州深圳等地（越靠前越好）；'
      + '要么就是能够在今年年底12月19号开始初始的考研初试中取得成绩成果进入复试线并且期间没有出现不合适或者错误的流程，'
      + '然后在下个学期复试也过了最终获得录取通知书也就是被河北工业大学录取，明年这个时候已经是在河北工业大学读研究生了。',
    cast: {
      method: 'numberAndTime',
      numbers: [82],
      localTime: '2026-09-28 03:12',
      ...LANZHOU,
      useTrueSolarTime: false,   // 原占按钟表时间取寅时（数3）
      movingFrom: 'number',      // 原占以 82 ÷ 6 取动爻（仅报数）
      category: '考研学业',
    },
    claimed: {
      ben: '泽火革', hu: '天风姤', bian: '水火既济', moving: 4,
      tiyong: '体卦离火，用卦兑金，体克用',
    },
    tags: ['主线之始', '钟表取时'],
    extraCorrections: [{
      field: 'movingRule',
      label: '动爻取法',
      stated: '82 ÷ 6 = 13 余 4，第四爻动（仅以报数取）',
      computed: '（82 + 3）÷ 6 余 1，初爻动（数与时之和取）',
      note: '当初以报数单独取动爻，与梅花易数常法「数与时之和除六」不同。本卦录按原卦保留第四爻（即「改命吉」那一爻）；'
        + '若想按常法看，可把「动爻取法」改为「数与时辰之和」，重算即得初九「巩用黄牛之革」。',
    }],
    pairs: [2],
    origin: { kind: 'deepseek-chat', label: 'DeepSeek 起卦对话（首占）' },
  },
  {
    id: '202609280312-02',
    title: '财运之占：下半年现金流，能否攒下四五千',
    category: '财运生计',
    question:
      '我今年下半年［从现在开始到后面］的财运：现在每个月财务压力很大，后面会不会好转甚至能攒下四五千。'
      + '当前下个月要还2100，后面每个月估计都要还800左右，一个月生活费2300，现在这个月只剩下617现金，下个月15号发下个月生活费。',
    cast: {
      method: 'twoNumbers',
      numbers: [617, 15],
      localTime: '2026-09-28 03:12',
      ...LANZHOU,
      useTrueSolarTime: false,
      category: '财运生计',
    },
    claimed: {
      ben: '天山遁', hu: '天风姤', bian: '天风姤', moving: 2,
      tiyong: '体卦乾金，用卦艮土，用生体，吉',
    },
    tags: ['两数起卦', '现金流'],
    pairs: [3],
    origin: { kind: 'deepseek-chat', label: 'DeepSeek 起卦对话（第二占）' },
  },
  {
    id: '202609280312-03',
    title: '重算对照（真太阳时）：泽雷随——不妄动，循序而进',
    category: '考研学业',
    question: '按兰州真太阳时重算首占（82）：以考研为主线、不妄动、按次序来，是否可行？',
    cast: {
      method: 'manual',
      hexagram: '泽雷随',
      movingPosition: 6,
      localTime: '2026-09-28 03:12',
      ...LANZHOU,
      useTrueSolarTime: true,
      category: '考研学业',
    },
    claimed: {
      ben: '泽雷随', hu: '风山渐', bian: '天雷无妄', moving: 6,
      tiyong: '体震木、用兑金，用克体（变卦上乾金仍克下震木）',
    },
    tags: ['真太阳时', '对照卦', '取法存异'],
    extraCorrections: [{
      field: 'castingRule',
      label: '起卦取法',
      stated: '上卦 82÷8 余 2（兑），下卦 (82+2)÷8 余 4（震），动爻 (82+2)÷6 整除取上爻',
      computed: '本程序「一数＋时辰」法为上卦 数÷8、下卦 时辰数÷8、动爻 (数＋时辰数)÷6',
      note: '此卦当初用的是「下卦取数与时之和除八」的另一路取法（与年月日时起卦同例）。'
        + '本卦录以「指定本卦＋动爻」忠实保留原卦象；若按本程序默认取法，同为丑时数2，'
        + '下卦当取兑，则得兑为泽之象，与此卦不同。看卦时以原卦为准。',
    }],
    pairs: [5],
    pairLabels: ['首占按真太阳时重算之解'],
    origin: { kind: 'deepseek-chat', label: 'DeepSeek 起卦对话（重算对照）' },
  },
  {
    id: '202609280312-04',
    title: '重算对照（钟表时间）：泽风大过——负荷过载，必须取舍',
    category: '决策取舍',
    question: '按钟表时间（寅时）重算首占（82）：两条心愿同时全力拉满，能否成立？',
    cast: {
      method: 'manual',
      hexagram: '泽风大过',
      movingPosition: 1,
      localTime: '2026-09-28 03:12',
      ...LANZHOU,
      useTrueSolarTime: false,
      category: '决策取舍',
    },
    claimed: {
      ben: '泽风大过', hu: '乾为天', bian: '泽天夬', moving: 1,
      tiyong: '体兑金、用巽木，体克用；变卦泽天夬金金比和',
    },
    tags: ['钟表取时', '对照卦', '取法存异'],
    extraCorrections: [{
      field: 'castingRule',
      label: '起卦取法',
      stated: '上卦 82÷8 余 2（兑），下卦 (82+3)÷8 余 5（巽），动爻 (82+3)÷6 余 1',
      computed: '本程序「一数＋时辰」法下卦取时辰数÷8',
      note: '同上一卦，此处用的是「下卦取数与时之和除八」的取法。本卦录以「指定本卦＋动爻」保留原卦象。',
    }],
    pairs: [5],
    pairLabels: ['同一轮对照中钟表时间一路之象'],
    origin: { kind: 'deepseek-chat', label: 'DeepSeek 起卦对话（重算对照）' },
  },
  {
    id: '202609280338-01',
    title: '定主线之占：考研为唯一主线＋少量精投，能否上岸河北工大',
    category: '考研学业',
    question:
      '我以备考河北工业大学研究生为唯一主线，正常完成学校课程设计，仅用少量必要时间学习求职并精投几家单位作为保底。'
      + '请问：在此策略下，我能否在2026年12月19日初试中达到复试线，并在2027年复试后被河北工业大学正式录取？',
    cast: {
      method: 'numberAndTime',
      numbers: [1],
      localTime: '2026-09-28 03:38',
      ...LANZHOU,
      useTrueSolarTime: true,   // 真太阳时 2:43，丑时，数2
      movingFrom: 'sum',        // (1+2) ÷ 6 余 3
      category: '考研学业',
    },
    claimed: {
      ben: '天泽履', hu: '风火家人', bian: '乾为天', moving: 3,
      tiyong: '体卦兑金，用卦乾金，体用比和',
    },
    tags: ['定主线', '真太阳时'],
    pairs: [7, 8],
    pairLabels: ['定主线之占', '细节追问（课设、自强不息、饭馆、债务）'],
    origin: { kind: 'deepseek-chat', label: 'DeepSeek 起卦对话（定主线）' },
  },
  {
    id: '202609280350-01',
    title: '对照之占：完全不投递、只考研的结果',
    category: '决策取舍',
    question: '不同路——完全不投递只考研的结果如何？',
    cast: {
      method: 'numberAndTime',
      numbers: [52],
      localTime: '2026-09-28 03:50',
      ...LANZHOU,
      useTrueSolarTime: true,   // 真太阳时 2:55，丑时，数2
      movingFrom: 'sum',        // (52+2) ÷ 6 整除取上爻
      category: '决策取舍',
    },
    claimed: {
      ben: '雷泽归妹', hu: '山火贲', bian: '火泽睽', moving: 6,
      tiyong: '本卦体克用，变卦用克体',
    },
    tags: ['对照卦', '孤注之险'],
    pairs: [10, 11],
    pairLabels: ['完全不投递之占', '为何「少量投递」反比「完全不投递」卦象更好'],
    origin: { kind: 'deepseek-chat', label: 'DeepSeek 起卦对话（对照占）' },
  },
];

/* ---------- 三、执行 ---------- */
const md = fs.readFileSync(MD_FILE, 'utf8');
const pairs = parsePairs(md);
console.log(`对话原文：${pairs.length} 轮（用户／助手）`);
fs.mkdirSync(RECORDS_DIR, { recursive: true });

let created = 0;
let skipped = 0;
const report = [];

for (const s of SEEDS) {
  const file = path.join(RECORDS_DIR, `${s.id}.json`);
  if (fs.existsSync(file) && !FORCE) {
    skipped += 1;
    report.push(`${s.id}　已存在，跳过（--force 可覆盖）`);
    continue;
  }
  const rec = core.record.buildRecord({
    id: s.id,
    title: s.title,
    category: s.category,
    question: s.question,
    cast: s.cast,
    claimed: s.claimed,
    tags: s.tags,
    origin: s.origin,
    narrative: narrativeOf(pairs, s.pairs, s.pairLabels),
    review: { status: '待应验', result: '', reviewedAt: null, log: [] },
  });
  if (s.extraCorrections) rec.corrections = [...(rec.corrections || []), ...s.extraCorrections];
  fs.writeFileSync(file, JSON.stringify(rec, null, 2), 'utf8');
  created += 1;
  report.push(
    `${rec.id}　${rec.chart.ben.fullName}${rec.chart.ben.symbol}　动${rec.chart.moving.yaoTitle}　`
    + `${rec.chart.tiyong.relation.label}　${rec.reading.grade.label}　校勘 ${rec.corrections.length} 处　原文 ${rec.narrative.length} 字`,
  );
}

console.log('\n录入结果：');
report.forEach((r) => console.log('  ' + r));
console.log(`\n新增 ${created} 条，跳过 ${skipped} 条，共 ${fs.readdirSync(RECORDS_DIR).filter((f) => f.endsWith('.json')).length} 条。`);
