/**
 * 问心卦 · 自检夹具（合成示例卦录的唯一真源）
 * ------------------------------------------------------------
 * 为什么要有这个文件：
 *   本仓库**不发布 `data/`**（`.gitignore` 已把作者的 6 条真实卦录、会话、回收站
 *   全部排除）。自检若直接读 `data/records/` 或写死某个真实编号，别人克隆下来
 *   必然失败——他们的 `data/records/` 是空的。
 *
 * 所以自检需要一批「引擎自造的示例卦录」当夹具。它们：
 *   · 用**真代码路径**算出来（core/divination.cast ＋ core/record.buildRecord），
 *     不是手写的 JSON —— 因而必然通过 schema/record.schema.json，也随着引擎演进；
 *   · 与作者的真实数据**毫无关系**：虚构的时间／报数／地点／所问，一眼看得出是示例，
 *     绝不含任何真实编号或可能撞上隐私的措辞。
 *
 * 夹具只在这里定义一次，三套自检（check.mjs / check-validate.mjs / check-web.mjs）
 * 都从这里取，不再各抄一份。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const recordMod = await load('core/record.mjs');

/** 虚构地点：不指向任何真实城市，免得与作者数据产生联想 */
const SAMPLE_PLACE = { placeName: '示例城', longitude: 113.0 };

/**
 * 六条合成起卦输入。刻意覆盖四种起卦法中的三种与两种动爻取法
 * （numberAndTime 的 number/sum、twoNumbers、manual），
 * 好让走势、校勘、迁移等自检拿到与真实数据同构的样本。
 *
 * 时间全部落在同一天：走势自检要验「只按起卦时间看，长期之事会挤成一团」，
 * 真实数据正是同一天连续起卦，这里对齐这个特征。
 * 类别刻意让「心态情绪」出现两卦，走势自检要验「同领域多卦综合成一条基准」。
 */
export const SAMPLE_CASTS = [
  {
    title: '示例·一数一卦：按次序推进可行否',
    category: '求职事业',
    question: '示例：把手上这件事按既定次序推进，可行吗？',
    cast: {
      method: 'numberAndTime', numbers: [7], localTime: '2024-03-15 08:00',
      ...SAMPLE_PLACE, useTrueSolarTime: false, movingFrom: 'sum', category: '求职事业',
    },
  },
  {
    title: '示例·报数取动：眼下心绪如何',
    category: '心态情绪',
    question: '示例：眼下这阵心绪，是宜静还是宜动？',
    cast: {
      method: 'numberAndTime', numbers: [19], localTime: '2024-03-15 10:20',
      ...SAMPLE_PLACE, useTrueSolarTime: true, movingFrom: 'number', category: '心态情绪',
    },
  },
  {
    title: '示例·一数一卦：钱物出入之缓急',
    category: '财运生计',
    question: '示例：这一笔收支的缓急，何时见分晓？',
    cast: {
      method: 'numberAndTime', numbers: [33], localTime: '2024-03-15 12:40',
      ...SAMPLE_PLACE, useTrueSolarTime: false, movingFrom: 'sum', category: '财运生计',
    },
  },
  {
    title: '示例·两数起卦：另一桩心事',
    category: '心态情绪',
    question: '示例：另一桩悬着的心事，走向如何？',
    cast: {
      method: 'twoNumbers', numbers: [26, 41], localTime: '2024-03-15 15:10',
      ...SAMPLE_PLACE, useTrueSolarTime: false, category: '心态情绪',
    },
  },
  {
    title: '示例·已知卦象：人与人之间的分寸',
    category: '人际情感',
    question: '示例：与人相处该进还是该退？',
    cast: {
      method: 'manual', hexagram: '泽山咸', movingPosition: 2, localTime: '2024-03-15 17:30',
      ...SAMPLE_PLACE, useTrueSolarTime: true, category: '人际情感',
    },
  },
  {
    title: '示例·已知卦象：取舍二字',
    category: '决策取舍',
    question: '示例：两难之间，取还是舍？',
    cast: {
      method: 'manual', hexagram: '山水蒙', movingPosition: 5, localTime: '2024-03-15 19:50',
      ...SAMPLE_PLACE, useTrueSolarTime: false, category: '决策取舍',
    },
  },
];

/**
 * 用真代码路径把上面这批输入构造成完整卦录（含 chart / reading / yingqi）。
 * 编号由 makeId 从起卦时间生成，因此稳定、唯一，且一眼看出是示例而非作者数据。
 * @returns {object[]}
 */
export function sampleRecords() {
  // makeId 有一个模块级的序号缓存；先清掉，保证本函数可重复调用而编号不变
  recordMod.resetSeqCache();
  const ids = [];
  return SAMPLE_CASTS.map((s) => {
    const id = recordMod.makeId(s.cast.localTime, ids);
    ids.push(id);
    return recordMod.buildRecord({
      id,
      title: s.title,
      category: s.category,
      question: s.question,
      cast: s.cast,
      origin: { kind: 'sample', label: '示例卦录（自检夹具）' },
    });
  });
}

/**
 * 把示例卦录写进 `<dir>/records/*.json`（目录不存在就建）。
 * **已经非空就不重复写**——免得覆盖掉调用方自己的数据。
 * @param {string} dir
 * @returns {number} 实际写入的条数（目录非空时为 0）
 */
export function seedInto(dir) {
  const recordsDir = path.join(dir, 'records');
  const existing = fs.existsSync(recordsDir)
    ? fs.readdirSync(recordsDir).filter((f) => f.endsWith('.json'))
    : [];
  if (existing.length) return 0;
  fs.mkdirSync(recordsDir, { recursive: true });
  const recs = sampleRecords();
  for (const rec of recs) {
    fs.writeFileSync(path.join(recordsDir, `${rec.id}.json`), JSON.stringify(rec, null, 2), 'utf8');
  }
  return recs.length;
}
