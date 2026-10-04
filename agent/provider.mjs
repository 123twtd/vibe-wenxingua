/**
 * 问心卦 · 模型接入（Hermes 之上的兼容薄层）
 * ------------------------------------------------------------
 * 这一层的职责已经收敛为「配置解析 + 向后兼容」：
 * 真正的协议适配、路由、重试、降级、熔断都在 `hermes/` 里。
 *
 * 保留这层的原因：`agent/loop.mjs`、`/api/agent/*`、界面与自检都在用这几个函数名。
 * 对外形状不变，内部换成 Hermes —— 这样老配置（只有 data/config.json 的 agent 段）
 * 一行不改也能继续用。
 */

import { createHermes, PRESETS, PROTOCOLS, DEFAULT_POLICY } from '../hermes/index.mjs';
import { extractTextCalls } from '../hermes/protocols.mjs';
import { guessProtocol } from '../hermes/protocols.mjs';
// 余额查询要从本机出网，复用联网工具那套「私网/保留地址一律拦下」的守卫——
// 不在这里再写一份判定（硬规矩：一处实现，多处复用）。
import { checkUrl } from './sources.mjs';

/** 服务商预设。真源在 hermes/targets.mjs，这里只做别名以保持向后兼容 */
export const PROVIDERS = PRESETS;

export const DEFAULT_AGENT_CONFIG = {
  enabled: false,
  provider: 'deepseek',
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0.6,
  /** 单次回复上限：0 = 不带 max_tokens，交给服务商默认（发小值会把长回答拦腰截断） */
  maxTokens: 0,
  maxRounds: 6,
  useNativeTools: true,
  /** 'auto' 表示按模型名猜协议；也可显式写 openai-native / hermes-xml / text-fence / plain */
  protocol: 'auto',
  /** 助手权限等级，见 agent/permissions.mjs。默认「可写」——够干日常活，但删不了东西 */
  permission: 'write',
  /** 上下文窗口覆盖值。0 = 用「模型名 → 窗口」预设（见 contextWindowFor）；>0 时以它为准 */
  contextWindow: 0,
};

/** 把用户配置补全成可用的连接参数（形状与旧版一致） */
export function resolveConfig(raw = {}) {
  const cfg = { ...DEFAULT_AGENT_CONFIG, ...(raw || {}) };
  const preset = PROVIDERS.find((p) => p.id === cfg.provider) || PROVIDERS[0];
  const baseUrl = (cfg.baseUrl || preset.baseUrl || '').replace(/\/+$/, '');
  const model = cfg.model || preset.defaultModel || '';
  const apiKey = cfg.apiKey || '';
  const problems = [];
  if (!baseUrl) problems.push('未填 baseUrl');
  if (!model) problems.push('未填模型名');
  if (preset.needsKey && !apiKey) problems.push(`${preset.name} 需要 API Key`);
  const presetProtocol = cfg.protocol && cfg.protocol !== 'auto'
    ? cfg.protocol
    : (preset.protocol && preset.protocol !== 'auto' ? preset.protocol : guessProtocol(model, baseUrl));
  // 「工具调用方式」开关落在这里：关掉原生 function calling 就降到文本协议。
  // 放在 resolveConfig 而不是发请求时才改，是为了让界面与 /api/agent/config
  // 看到的就是**真正会用**的协议——否则开关看起来没生效。
  const protocol = cfg.useNativeTools === false && presetProtocol === 'openai-native'
    ? 'text-fence'
    : presetProtocol;
  return {
    ...cfg,
    baseUrl,
    model,
    apiKey,
    protocol,
    preset,
    ready: problems.length === 0,
    reason: problems.join('；'),
    isLocal: /127\.0\.0\.1|localhost|0\.0\.0\.0/.test(baseUrl),
  };
}

/** 由一份 agent 配置合成一个 Hermes 实例（单目标） */
function hermesOf(config) {
  const cfg = config?.ready !== undefined ? config : resolveConfig(config);
  return createHermes({
    hermes: {
      targets: [{
        id: cfg.provider || 'deepseek',
        preset: cfg.provider || 'deepseek',
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        protocol: cfg.protocol,
        temperature: cfg.temperature,
        maxTokens: cfg.maxTokens,
        timeoutMs: cfg.timeoutMs || DEFAULT_POLICY.timeoutMs,
      }],
    },
  });
}

/**
 * 一次对话补全。
 * @returns {Promise<{message:object, usage:object|null, mode:string, target:object|null, protocol:string, trace:string[]}>}
 */
export async function chat({ config, messages, tools }) {
  const cfg = config?.ready !== undefined ? config : resolveConfig(config);
  if (!cfg.ready) throw new Error(`模型未配置好：${cfg.reason}`);

  const hermes = hermesOf(cfg);
  const out = await hermes.chat({ messages, tools });
  if (!out.ok) throw new Error(out.error);

  const native = out.protocol === 'openai-native' && Array.isArray(out.message.tool_calls) && out.message.tool_calls.length;
  const mode = native ? 'native-tools' : (out.message.tool_calls?.length ? out.protocol : 'plain');
  return {
    message: out.message,
    usage: out.usage,
    mode,
    target: out.target,
    protocol: out.protocol,
    trace: out.trace,
  };
}

/** 从自由文本里提取工具调用（Hermes XML / 围栏 JSON 都认） */
export function extractTextToolCalls(content) {
  return extractTextCalls(content);
}

/** 列出可用模型 */
export async function listModels(config) {
  const cfg = config?.ready !== undefined ? config : resolveConfig(config);
  if (!cfg.baseUrl) return [];
  return hermesOf(cfg).models(cfg.provider);
}

/** 连通性自检 */
export async function ping(config) {
  const cfg = config?.ready !== undefined ? config : resolveConfig(config);
  return hermesOf(cfg).ping(cfg.provider);
}

/** 健康总览：把 Hermes 的目标状态摊平，供界面显示 */
export function health(config) {
  const cfg = config?.ready !== undefined ? config : resolveConfig(config);
  return hermesOf(cfg).health();
}

/** 选择解释：界面上「为什么用这个模型」 */
export function explain(config, route = {}) {
  const cfg = config?.ready !== undefined ? config : resolveConfig(config);
  return hermesOf(cfg).explain(route);
}

/* ============================================================
 * 上下文窗口与厂商余额
 * ------------------------------------------------------------
 * 这两张表**只写在这里**：服务端经 `/api/meta`、`/api/agent/balance` 把它们发出去，
 * 前端只负责显示，不许在 `web/` 里另抄一份预设（硬规矩：一处实现，多处复用）。
 * ========================================================== */

/**
 * 上下文窗口预设（2026 口径）。口径是**模型名前缀**：
 *   · `deepseek-*`（v4 系列与已弃用的 chat/reasoner 同窗口）→ 1,000,000
 *   · `gpt-*` / `o1` / `o3` / `o4` → 128,000
 *   · 其余（ollama、hermes、自建端点…）→ 0 = **未知**
 * 0 的含义是「不知道」，前端据此只显示已用 token、不显示占比——
 * 显示一个编出来的百分比，比不显示更糟。
 */
const CONTEXT_WINDOW_PRESETS = [
  { match: /^deepseek-/i, window: 1000000 },
  { match: /^(gpt-|o1|o3|o4)/i, window: 128000 },
];

/**
 * 取模型名的上下文窗口预设。模型名还没填时退回按服务商判（DeepSeek 系整体 1M）。
 * @returns {number} 窗口 token 数；0 表示未知
 */
export function contextWindowFor(provider, model) {
  const name = String(model || '').trim();
  if (name) {
    for (const p of CONTEXT_WINDOW_PRESETS) if (p.match.test(name)) return p.window;
    return 0;
  }
  return String(provider || '').trim().toLowerCase().startsWith('deepseek') ? 1000000 : 0;
}

/** 各厂商控制台（查用量/余额用）。没有公开余额接口的厂商，界面给一个「去控制台看」的出口 */
const BALANCE_CONSOLES = {
  deepseek: 'https://platform.deepseek.com/usage',
  openai: 'https://platform.openai.com/usage',
};

/**
 * 余额档案：认出厂商就给它的余额接口 url 与控制台地址，认不出 url 为空。
 * **只有 url 非空的厂商才会发请求**——认不出的一个字节都不出网。
 */
export function balanceProfile(provider, baseUrl) {
  const id = String(provider || '').trim().toLowerCase();
  if (id === 'deepseek') {
    let url = '';
    try {
      url = new URL('/user/balance', String(baseUrl || '') || 'https://api.deepseek.com').href;
    } catch { url = ''; }
    return { kind: 'deepseek', url, console: BALANCE_CONSOLES.deepseek };
  }
  return { kind: 'none', url: '', console: BALANCE_CONSOLES[id] || '' };
}

/** 余额查询超时（毫秒）。厂商慢就算了，不能把本地服务拖住 */
export const BALANCE_TIMEOUT_MS = 8000;

/**
 * 查一次厂商余额（服务端代理由此发出）。
 *
 * 安全口径：**Key 只进请求头，绝不进任何返回值**；请求前先过私网/保留地址守卫；
 * 失败一律回 `{ok:false, error:'人话'}`，不抛异常、不回显上游响应体。
 *
 * @param {object} p
 * @param {typeof fetch} [p.fetchImpl] 注入点——自检用它断言「不支持时不发请求」
 * @returns {Promise<object>}
 */
export async function fetchBalance({ provider, baseUrl, apiKey, fetchImpl = fetch } = {}) {
  const profile = balanceProfile(provider, baseUrl);
  // 认不出余额接口：直接给兜底 UI，一个请求都不发
  if (!profile.url) {
    return { ok: true, supported: false, hint: '该厂商不提供余额接口，去控制台看', console: profile.console };
  }
  if (!apiKey) return { ok: false, supported: true, error: '还没填 API Key，查不了余额' };

  const guard = await checkUrl(profile.url);
  if (!guard.ok) return { ok: false, supported: true, error: guard.reason };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), BALANCE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(profile.url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const why = (res.status === 401 || res.status === 403)
        ? '密钥无效或没有余额查询权限'
        : `余额接口返回 HTTP ${res.status}`;
      return { ok: false, supported: true, error: why };
    }
    const data = await res.json().catch(() => null);
    const info = Array.isArray(data?.balance_infos) ? data.balance_infos[0] : null;
    return {
      ok: true,
      supported: true,
      at: new Date().toISOString(),
      isAvailable: data?.is_available === true,
      currency: info?.currency || '',
      total: info?.total_balance ?? '',
      granted: info?.granted_balance ?? '',
      toppedUp: info?.topped_up_balance ?? '',
    };
  } catch (err) {
    const why = err?.name === 'AbortError' ? `超过 ${BALANCE_TIMEOUT_MS} 毫秒未完成` : (err?.message || String(err));
    return { ok: false, supported: true, error: `余额查询失败：${why}` };
  } finally {
    clearTimeout(timer);
  }
}

export { PROTOCOLS, extractTextCalls, guessProtocol };
