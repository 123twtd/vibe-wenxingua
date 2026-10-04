/**
 * Hermes · 门面
 * ------------------------------------------------------------
 * 对上层只暴露一个 `chat()`：给它统一的消息与工具，它负责
 *   选目标（router）→ 编协议（protocols）→ 发请求 → 解析 → 失败重试 → 降级 → 熔断 → 留痕
 *
 * 上层（agent/loop.mjs、agent/provider.mjs）因此不必知道对面是 DeepSeek 还是本地 Hermes，
 * 也不必自己写重试和降级。
 *
 * 一句话概括这一层存在的理由：
 *   **把「模型会挂、协议会不一致、网络会抖」这三件事，收敛到一个地方处理。**
 */

import { prepare, parse, guessProtocol, PROTOCOLS, protocolById } from './protocols.mjs';
import { selectTargets, explainSelection, normalizeRoutes, DEFAULT_ROUTES } from './router.mjs';
import {
  buildTargets, DEFAULT_POLICY, targetReadiness, markSuccess, markFailure, PRESETS,
} from './targets.mjs';

export { PROTOCOLS, PRESETS, DEFAULT_ROUTES, DEFAULT_POLICY };

/* ============================================================
 * 一、HTTP
 * ========================================================== */

function headersOf(t) {
  const h = { 'Content-Type': 'application/json' };
  if (t.apiKey) h.Authorization = `Bearer ${t.apiKey}`;
  return h;
}

/** 可重试的错误：网络抖动、超时、429、5xx。401/400 这类重试没意义 */
export function isRetryable(err) {
  const m = String(err?.message || '');
  if (err?.name === 'AbortError' || /aborted|timeout|超时/i.test(m)) return true;
  const status = Number((m.match(/返回 (\d{3})/) || [])[1]);
  if (status === 429) return true;
  if (status >= 500) return true;
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up/i.test(m)) return true;
  return false;
}

async function postJson(url, body, { headers, timeoutMs }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: headers || { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const msg = data?.error?.message || data?.message || data?.raw || `HTTP ${res.status}`;
      throw new Error(`模型接口返回 ${res.status}：${String(msg).slice(0, 300)}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================================================
 * 二、门面
 * ========================================================== */

/**
 * @param {object} config 完整的 data/config.json 内容（含 agent 与可选的 hermes）
 */
export function createHermes(config = {}) {
  const targets = buildTargets(config);
  const routes = normalizeRoutes(config.hermes?.routes);
  const policy = { ...DEFAULT_POLICY, ...(config.hermes?.policy || {}) };

  const resolve = (id) => targets.find((t) => t.id === id) || null;
  const firstReady = () => targets.find((t) => targetReadiness(t).ready && t.enabled !== false) || null;

  /**
   * 对某个目标发一次请求（不做重试）。
   * @returns {{ok:boolean, message?:object, usage?:object, protocol:string, ms:number, error?:string, request?:object, response?:object}}
   */
  async function oneShot(target, { messages, tools, temperature, maxTokens } = {}) {
    const protocol = target.protocol === 'auto' ? guessProtocol(target.model, target.baseUrl) : target.protocol;
    const body = prepare({
      protocol,
      model: target.model,
      messages,
      tools,
      temperature: Number.isFinite(temperature) ? temperature : target.temperature,
      maxTokens: Number.isFinite(maxTokens) ? maxTokens : target.maxTokens,
    });
    const t0 = Date.now();
    const data = await postJson(`${target.baseUrl}/chat/completions`, body, {
      headers: headersOf(target),
      timeoutMs: target.timeoutMs || policy.timeoutMs,
    });
    const message = parse(protocol, data);
    return {
      ok: true,
      message,
      usage: data.usage || null,
      protocol,
      ms: Date.now() - t0,
      request: body,
      response: data,
    };
  }

  /**
   * 按路由与策略发一次请求：重试 → 降级 → 熔断。
   * @param {object} p
   * @param {Array}  p.messages
   * @param {Array}  [p.tools]
   * @param {object} [p.route]  { needsTools, preferLocal, tags, minContextTokens, target }
   * @returns {Promise<object>} {ok, message, target, protocol, attempts, usage, trace, error}
   */
  async function chat({ messages, tools, route = {}, temperature, maxTokens } = {}) {
    const req = {
      needsTools: Array.isArray(tools) && tools.length > 0,
      preferLocal: !!route.preferLocal,
      tags: route.tags || [],
      minContextTokens: route.minContextTokens || 0,
      policy,
    };
    if (route.target) req.exclude = [];

    let selection;
    if (route.target) {
      const t = resolve(route.target);
      const r = t ? targetReadiness(t) : { ready: false, reason: `没有 id 为 ${route.target} 的目标` };
      selection = t && r.ready
        ? { chain: [t], picked: t, rule: { name: `显式指定 ${route.target}`, note: '' }, skipped: [] }
        : { chain: [], picked: null, rule: null, skipped: [{ target: route.target, why: r.reason }] };
    } else {
      selection = selectTargets(targets, routes, req);
    }

    const trace = [];
    const attempts = [];
    if (!selection.chain.length) {
      const why = selection.skipped.map((s) => `${s.target}：${s.why}`).join('；') || '没有任何已配置的目标';
      return { ok: false, error: `没有可用的模型目标。${why}`, attempts, trace, selection };
    }

    for (const target of selection.chain) {
      const maxAttempts = 1 + Math.max(0, Number(policy.retries) || 0);
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const out = await oneShot(target, { messages, tools, temperature, maxTokens });
          markSuccess(target, out.ms);
          attempts.push({ target: target.id, attempt, ok: true, ms: out.ms, protocol: out.protocol });
          trace.push(`${target.id} 第 ${attempt} 次成功（${out.ms}ms，协议 ${out.protocol}）`);
          return {
            ok: true,
            message: out.message,
            usage: out.usage,
            target,
            protocol: out.protocol,
            attempts,
            trace,
            selection,
          };
        } catch (err) {
          const retryable = isRetryable(err);
          markFailure(target, err, policy);
          attempts.push({ target: target.id, attempt, ok: false, ms: null, error: err.message, retryable });
          trace.push(`${target.id} 第 ${attempt} 次失败：${err.message}${retryable ? '（可重试）' : '（不重试）'}`);
          if (retryable && attempt < maxAttempts) {
            const wait = (policy.backoffMs || 600) * (2 ** (attempt - 1));
            trace.push(`等待 ${wait}ms 后重试`);
            await sleep(wait);
            continue;
          }
          break; // 换下一个目标
        }
      }
      if (!policy.fallback) {
        trace.push('策略禁止降级，停止');
        break;
      }
      trace.push(`${target.id} 放弃，降级到下一个目标`);
    }

    const last = attempts.filter((a) => !a.ok).slice(-1)[0];
    return {
      ok: false,
      error: last ? `全部目标失败。最后错误：${last.error}` : '全部目标失败',
      attempts,
      trace,
      selection,
    };
  }

  /** 目标健康总览（给界面和运维看） */
  function health() {
    const now = Date.now();
    return targets.map((t) => {
      const r = targetReadiness(t);
      return {
        id: t.id,
        name: t.name,
        kind: t.kind,
        model: t.model,
        protocol: t.protocol,
        protocolName: protocolById(t.protocol).name,
        enabled: t.enabled,
        ready: r.ready,
        reason: r.reason,
        breakerOpen: (t.health.breakerUntil || 0) > now,
        breakerUntil: t.health.breakerUntil || 0,
        fails: t.health.fails || 0,
        lastOkAt: t.health.lastOkAt,
        lastError: t.health.lastError,
        latencyMs: t.health.latencyMs,
      };
    });
  }

  /** 解释一次选择（不真的发请求），用于界面与文档示例 */
  function explain(route = {}) {
    const req = {
      needsTools: !!route.needsTools,
      preferLocal: !!route.preferLocal,
      tags: route.tags || [],
      minContextTokens: route.minContextTokens || 0,
      policy,
    };
    const sel = selectTargets(targets, routes, req);
    return { ...sel, text: explainSelection(sel, targets) };
  }

  /** 拉某目标的模型列表 */
  async function models(targetId) {
    const t = targetId ? resolve(targetId) : firstReady();
    if (!t?.baseUrl) return [];
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(`${t.baseUrl}/models`, { headers: headersOf(t), signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return [];
      const data = await res.json();
      return (data?.data || []).map((m) => m.id).filter(Boolean).sort();
    } catch {
      return [];
    }
  }

  /** 连通性自检：发一句最短的请求 */
  async function ping(targetId, overrides = {}) {
    const t = targetId ? resolve(targetId) : firstReady();
    if (!t) return { ok: false, error: '没有可用的模型目标' };
    const merged = { ...t, ...overrides };
    const t0 = Date.now();
    try {
      const out = await oneShot(merged, {
        messages: [{ role: 'user', content: '只回两个字：可用' }],
        tools: [],
        // 给 64 而不是 16：推理模型会先把额度花在思维链上，太小的话正文是空的，
        // 「测连通」就会显示一个空的返回样本，看着像坏了
        maxTokens: 64,
      });
      return {
        ok: true,
        ms: Date.now() - t0,
        protocol: out.protocol,
        sample: String(out.message?.content || '').slice(0, 40),
      };
    } catch (err) {
      return { ok: false, ms: Date.now() - t0, error: err.message };
    }
  }

  return {
    targets,
    routes,
    policy,
    presets: PRESETS,
    get ready() {
      return targets.some((t) => targetReadiness(t).ready);
    },
    get primary() {
      return firstReady();
    },
    chat,
    oneShot,
    health,
    explain,
    models,
    ping,
    resolve,
    /** 供界面展示的协议表 */
    catalog: () => PROTOCOLS,
  };
}

export default createHermes;
