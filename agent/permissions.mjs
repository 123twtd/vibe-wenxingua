/**
 * 问心卦 · Agent 权限
 * ------------------------------------------------------------
 * 为什么不给「全开」：工具集里既有 `list_records` 这种看一眼的，
 * 也有 `delete_record` 这种删东西的。混在一起给模型，等于把库房钥匙
 * 连同账本一起交出去。所以按**能造成多大后果**分级，默认停在「可写」。
 *
 * 四个等级是累加的（高等级包含低等级的全部能力）：
 *
 *   read    只读   看一眼：查卦录、起卦看结果、算走势、查卦典
 *   write   可写   动手记：起卦存档、改卦录、写复盘          ← 默认
 *   delete  可删   能删东西：把卦录移入回收目录（可恢复）
 *   full    全权   管程序：热载插件、跑数据自检、改默认设置
 *
 * 两条额外纪律，与等级无关：
 *   1. **删除永远是软删**（进 `data/trash/`），工具层面不接受硬删参数。
 *   2. **破坏性操作要二次确认**：模型第一次调用只会拿到「待确认」，
 *      必须由人（界面确认框，或调用方显式传 `confirm: true`）放行。
 */

export const LEVELS = [
  {
    id: 'read',
    name: '只读',
    rank: 0,
    desc: '只能查看：读卦录、起卦看结果（不存档）、算走势、查卦典。不会改动任何数据。',
  },
  {
    id: 'write',
    name: '可写',
    rank: 1,
    desc: '在只读基础上，可以起卦并存档、修改卦录与原文、写复盘。日常够用。',
  },
  {
    id: 'delete',
    name: '可删',
    rank: 2,
    desc: '在可写基础上，可以把卦录移入回收目录。**是软删，可从「回收」里恢复**，但界面上会先要你确认。',
  },
  {
    id: 'full',
    name: '全权',
    rank: 3,
    desc: '在可删基础上，可以热载插件、跑数据自检、改默认地点与经度之类的设置。仍**不能**改模型密钥与权限等级本身。',
  },
];

export const LEVEL_IDS = LEVELS.map((l) => l.id);
export const DEFAULT_LEVEL = 'write';
export const levelById = (id) => LEVELS.find((l) => l.id === id) || LEVELS[1];
export const rankOf = (id) => levelById(id).rank;

/** 当前等级够不够做需要 `needed` 的事 */
export function allows(level, needed) {
  return rankOf(level) >= rankOf(needed);
}

/** 归一化：认不得的一律回落到默认等级，不静默放行 */
export function normalizeLevel(v) {
  return LEVEL_IDS.includes(v) ? v : DEFAULT_LEVEL;
}

/** 给界面用的一组说明 */
export function describeLevels() {
  return LEVELS.map(({ id, name, desc }) => ({ id, name, desc }));
}

/**
 * 拒绝时的统一文案。要点：说清「现在是什么等级」「这条需要什么等级」
 * 「去哪儿改」——模型会把这句话照念给用户，所以它得是一句人话。
 */
export function denyMessage(tool, current, needed) {
  const c = levelById(current);
  const n = levelById(needed);
  return `当前助手权限是「${c.name}」，而 ${tool} 属于「${n.name}」级别，因此我没有执行。`
    + `要放开的话，去「设置 → AI 助手 → 权限等级」调到「${n.name}」或更高。`;
}
