/**
 * 问心卦 · 卦录版本与迁移
 * ------------------------------------------------------------
 * 卦录是要存几十年的东西，结构一定会变。所以从一开始就把「版本 + 迁移」做进去：
 *   - 每条卦录带 `schema` 号；
 *   - 载入时若版本低于当前，按登记的顺序逐级迁移；
 *   - 迁移前的原件自动备份到 data/backups/pre-migration/，迁移失败可回退；
 *   - 迁移函数是纯函数，可单独测试。
 *
 * 怎么加一个新版本（将来会用到）：
 *   1. 把 CURRENT_SCHEMA 加一；
 *   2. 在 MIGRATIONS 里加 `[旧版本]: (rec) => 新记录`；
 *   3. 在 docs/规范.md 的「版本历史」里写清楚改了什么、为什么。
 */

import { computeYingqi } from './yingqi.mjs';

export const CURRENT_SCHEMA = 3;

/**
 * 迁移登记表：键是**源版本**，值把该版本的记录转成下一版本。
 */
export const MIGRATIONS = {
  // 0 表示「早于版本号机制的裸记录」，视同 v1
  0: (rec) => {
    rec.schema = 1;
    rec.review = rec.review || { status: '待应验', result: '', reviewedAt: null, log: [] };
    rec.tags = Array.isArray(rec.tags) ? rec.tags : [];
    rec.corrections = Array.isArray(rec.corrections) ? rec.corrections : [];
    return rec;
  },

  /**
   * v1 → v2：给卦录补上「应期区间」。
   *
   * 为什么加：原先「应期」只是断语里的一段文字，走势图没法用它——
   * 所有卦都挤在起卦那一天，长期的事和当下的事看不出分别。
   * 现在把它量化成 {from, to, days}，走势图才能按**应验时间**落点。
   *
   * 怎么补：**从 `chart` 现算**，不动 `reading` 里那份断语快照。
   *   · `chart` 是引擎的输出，没被改过，所以重算出来的应期与当初同源；
   *   · `reading` 是「当初怎么说」的历史记录，按硬规矩保持不动；
   *   · 所以这一版**只新增字段**，不改任何已有内容。
   *
   * 失败也不阻断：算不出来就留 null，`yingqi.source` 标 'missing'，
   * 界面上显示「缺应期」，而不是让整条记录迁不过去。
   */
  1: (rec) => {
    if (!rec.yingqi) {
      try {
        // 从 chart 现算——chart 是引擎输出、没被改过，所以重算与当初同源
        rec.yingqi = computeYingqi(rec.chart, { from: rec.cast?.localTime }) || null;
      } catch {
        // 算不出来不该让整条记录迁不过去：留 null，界面显示「缺应期」
        rec.yingqi = null;
      }
    }
    return rec;
  },

  /**
   * v2 → v3：补上「补充存录」四个字段（背景／方案／校勘／问答）。
   *
   * 为什么加：卦条原本只够「重算卦象、核对互变体用」，对「完整占问」不够——
   * 求测人背景、可执行方案、原文问答、以及**引擎算不出的人工校勘**（如某爻
   * 「阳变阴」应作「六四阴爻动，变阳」这类措辞更正）都无处安放。
   *
   * 怎么补：一律留空串。**纯新增**，不碰 cast／chart／reading／claimed／corrections
   * 里任何一个字——所以老记录迁移后，重算与校勘的结果不变。
   */
  2: (rec) => {
    if (rec.background === undefined) rec.background = '';
    if (rec.plan === undefined) rec.plan = '';
    if (rec.collation === undefined) rec.collation = '';
    if (rec.qa === undefined) rec.qa = '';
    return rec;
  },
};

/** 这条记录是不是 v1 升上来的、还没补应期 */
export function needsYingqi(record) {
  return !record?.yingqi && !!record?.chart?.tiyong;
}

export function detectVersion(record) {
  const v = Number(record?.schema);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export function needsMigration(record) {
  return detectVersion(record) < CURRENT_SCHEMA;
}

/**
 * 迁移一条卦录。
 * @returns {{record:object, from:number, to:number, applied:number[], error?:string}}
 */
export function migrate(record) {
  const from = detectVersion(record);
  if (from >= CURRENT_SCHEMA) {
    return { record, from, to: from, applied: [] };
  }
  let cur = { ...record };
  const applied = [];
  for (let v = from; v < CURRENT_SCHEMA; v += 1) {
    const step = MIGRATIONS[v];
    if (!step) {
      return { record, from, to: from, applied, error: `缺少 v${v} → v${v + 1} 的迁移函数` };
    }
    try {
      cur = step(cur);
    } catch (err) {
      return { record, from, to: v, applied, error: `v${v} → v${v + 1} 迁移失败：${err.message}` };
    }
    if (!cur || typeof cur !== 'object') {
      return { record, from, to: v, applied, error: `v${v} → v${v + 1} 迁移返回了非对象` };
    }
    cur.schema = v + 1;
    applied.push(v);
  }
  return { record: cur, from, to: CURRENT_SCHEMA, applied };
}

/**
 * 批量迁移；返回明细，调用方决定是否落盘。
 */
export function migrateAll(records) {
  const migrated = [];
  const errors = [];
  for (const r of records) {
    const out = migrate(r);
    if (out.error) errors.push({ id: r?.id, error: out.error });
    else if (out.applied.length) migrated.push({ id: r.id, from: out.from, to: out.to, record: out.record });
  }
  return { migrated, errors, current: CURRENT_SCHEMA };
}
