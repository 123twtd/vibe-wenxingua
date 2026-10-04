/**
 * Hermes · 路由器
 * ------------------------------------------------------------
 * 「信使」要干的第二件事：**决定把这句话交给谁**。
 *
 * 本项目现实里通常只配一个模型，所以路由的价值不在「选最便宜的」，
 * 而在三件真事：
 *   1. **能力路由**——要工具就筛掉不支持工具的协议；要长上下文就筛掉小模型。
 *   2. **降级链**——主目标挂了（超时/401/熔断）自动退到下一个，本地兜底。
 *   3. **可解释**——每次为什么选它、为什么跳过它，都留痕，便于排查与写文档。
 *
 * 规则是**声明式**的：`routes` 里一条条写「什么样的活交给谁」，
 * 不必改代码。匹配不到的走默认链（按 weight 排）。
 */

import { breakerOpen, targetReadiness } from './targets.mjs';
import { PROTOCOLS } from './protocols.mjs';

const CAP_OF = Object.fromEntries(PROTOCOLS.map((p) => [p.id, new Set(p.capabilities)]));

/** 一条路由规则 */
function normalizeRoute(r, i) {
  return {
    id: r.id || `route-${i + 1}`,
    name: r.name || r.id || `规则 ${i + 1}`,
    when: r.when || {},
    to: Array.isArray(r.to) ? r.to : [r.to].filter(Boolean),
    enabled: r.enabled !== false,
    note: r.note || '',
  };
}

export function normalizeRoutes(list) {
  if (!Array.isArray(list) || !list.length) return DEFAULT_ROUTES.map(normalizeRoute);
  return list.map(normalizeRoute);
}

/**
 * 内置默认路由。顺序即优先级；第一条匹配上的胜出。
 * 旧配置（只有单目标）时这些规则会自然退化为「只有一条可用链」。
 */
export const DEFAULT_ROUTES = [
  {
    id: 'local-first',
    name: '要工具 · 优先本地',
    when: { needsTools: true, preferLocal: true },
    to: ['$local', '$any'],
    note: '离线或不想把卦录发出去时，优先本地模型；本地不可用再退到云端。',
  },
  {
    id: 'tools-capable',
    name: '要工具 · 任意可用',
    when: { needsTools: true },
    to: ['$any'],
    note: '只要目标协议支持工具即可。',
  },
  {
    id: 'long-context',
    name: '长输入',
    when: { minContextTokens: 8000 },
    to: ['$any'],
    note: '目前不做真正的上下文长度探测，先按 weight 排；留作将来扩展。',
  },
  {
    id: 'default',
    name: '默认链',
    when: {},
    to: ['$any'],
    note: '按 weight 从高到低，全部可用目标依次尝试。',
  },
];

/** when 是否命中 */
export function routeMatches(route, req) {
  const w = route.when || {};
  if (w.needsTools !== undefined && !!req.needsTools !== !!w.needsTools) return false;
  if (w.preferLocal !== undefined && !!req.preferLocal !== !!w.preferLocal) return false;
  if (w.minContextTokens !== undefined && !((req.minContextTokens || 0) >= w.minContextTokens)) return false;
  if (w.hasTag && !(req.tags || []).includes(w.hasTag)) return false;
  return true;
}

/** `$any` / `$local` / `$cloud` / 具体 target id / 标签 `#tag` */
function expandSelector(sel, targets, req) {
  if (sel === '$any') return targets.slice();
  if (sel === '$local') return targets.filter((t) => t.kind === 'local');
  if (sel === '$cloud') return targets.filter((t) => t.kind === 'cloud');
  if (sel.startsWith('#')) return targets.filter((t) => (t.tags || []).includes(sel.slice(1)));
  const one = targets.find((t) => t.id === sel);
  if (one) return [one];
  // 也允许写 preset id（同一个预设可以配多个 target）
  return targets.filter((t) => t.preset === sel);
}

/**
 * 选目标。
 * @param {object[]} targets 全部目标
 * @param {object[]} routes  路由规则
 * @param {object} req       { needsTools, preferLocal, minContextTokens, tags, exclude:[id], policy }
 * @returns {{chain:object[], picked:object|null, rule:object|null, skipped:Array}}
 */
export function selectTargets(targets, routes, req = {}) {
  const skipped = [];
  const policy = req.policy || {};
  const exclude = new Set(req.exclude || []);

  // 第一层筛选：可用性
  const usable = [];
  for (const t of targets) {
    if (exclude.has(t.id)) { skipped.push({ target: t.id, why: '本轮已试过' }); continue; }
    const r = targetReadiness(t);
    if (!r.ready) { skipped.push({ target: t.id, why: r.reason }); continue; }
    if (breakerOpen(t)) { skipped.push({ target: t.id, why: '熔断冷却中' }); continue; }
    if (req.needsTools) {
      const caps = CAP_OF[t.protocol] || new Set();
      if (!caps.has('tools')) { skipped.push({ target: t.id, why: `协议 ${t.protocol} 不支持工具` }); continue; }
    }
    usable.push(t);
  }

  if (!usable.length) return { chain: [], picked: null, rule: null, skipped };

  // 第二层：按规则挑链
  const ordered = [...usable].sort((a, b) => (b.weight || 0) - (a.weight || 0));
  for (const route of routes) {
    if (!route.enabled) continue;
    if (!routeMatches(route, req)) continue;
    const chain = [];
    for (const sel of route.to) {
      for (const t of expandSelector(sel, ordered, req)) {
        if (t && !chain.includes(t)) chain.push(t);
      }
    }
    if (chain.length) return { chain, picked: chain[0], rule: route, skipped };
  }

  return { chain: ordered, picked: ordered[0], rule: null, skipped };
}

/** 给人看的解释：为什么是这条链 */
export function explainSelection({ chain, rule, skipped }, targets) {
  const lines = [];
  lines.push(rule
    ? `命中路由规则「${rule.name}」${rule.note ? `（${rule.note}）` : ''}`
    : '未命中任何规则，按权重降序取全部可用目标');
  lines.push(`候选链（${chain.length}）：${chain.map((t) => `${t.name}/${t.model || '未填模型'}[${t.protocol}]`).join(' → ') || '（空）'}`);
  if (skipped.length) {
    lines.push(`已跳过：${skipped.map((s) => `${s.target}（${s.why}）`).join('；')}`);
  }
  return lines.join('\n');
}
