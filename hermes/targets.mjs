/**
 * Hermes · 目标（Targets）
 * ------------------------------------------------------------
 * 一个 target = 一个可以对话的模型端点 + 它的协议与策略。
 * 这里也是「服务商预设」的唯一真源——agent/provider.mjs 从这里取，避免两处漂移。
 */

/** 服务商预设。新接一家，在这里加一条即可 */
export const PRESETS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'cloud',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    needsKey: true,
    protocol: 'openai-native',
    tags: ['强', '工具', '便宜'],
    note: '与 OpenAI 兼容；deepseek-chat 支持 function calling。',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'cloud',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    needsKey: true,
    protocol: 'openai-native',
    tags: ['强', '工具'],
    note: '',
  },
  {
    id: 'hermes',
    name: 'Hermes 系（本地或自建）',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:8000/v1',
    defaultModel: 'NousResearch/Hermes-3-Llama-3.1-8B',
    needsKey: false,
    protocol: 'hermes-xml',
    tags: ['工具', '本地', 'Hermes'],
    note: 'Hermes 系开源模型用 <tool_call> 标签表达工具调用，与 OpenAI 的 function calling 不同，故默认走 hermes-xml 协议。',
  },
  {
    id: 'ollama',
    name: '本地 Ollama',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'qwen2.5:7b',
    needsKey: false,
    protocol: 'text-fence',
    tags: ['本地', '离线', '弱'],
    note: '完全离线。多数本地小模型不支持 function calling，默认走文本协议降级。',
  },
  {
    id: 'custom',
    name: '自定义（任一 OpenAI 兼容端点）',
    kind: 'cloud',
    baseUrl: '',
    defaultModel: '',
    needsKey: false,
    protocol: 'auto',
    tags: [],
    note: '填 baseUrl 与模型名即可；协议留 auto 会按模型名猜。',
  },
];

export const presetById = (id) => PRESETS.find((p) => p.id === id) || PRESETS[0];

export const DEFAULT_POLICY = {
  /** 单个目标的超时（毫秒） */
  timeoutMs: 120000,
  /** 单个目标的重试次数（不含首次） */
  retries: 1,
  /** 重试退避基数（毫秒），实际等待 base * 2^n */
  backoffMs: 600,
  /** 连续失败多少次后熔断 */
  breakerThreshold: 3,
  /** 熔断后冷却多久（毫秒） */
  breakerCooldownMs: 60000,
  /** 是否允许降级到链上的下一个目标 */
  fallback: true,
};

/** 单个 target 的默认形状 */
export function normalizeTarget(raw) {
  const preset = presetById(raw.preset || raw.id);
  const baseUrl = String(raw.baseUrl ?? preset.baseUrl ?? '').replace(/\/+$/, '');
  const model = raw.model || preset.defaultModel || '';
  const protocol = !raw.protocol || raw.protocol === 'auto' ? preset.protocol : raw.protocol;
  return {
    id: raw.id || preset.id,
    name: raw.name || preset.name,
    kind: raw.kind || preset.kind,
    preset: preset.id,
    baseUrl,
    apiKey: raw.apiKey ?? '',
    model,
    protocol,
    tags: Array.isArray(raw.tags) ? raw.tags : preset.tags,
    weight: Number.isFinite(raw.weight) ? raw.weight : 100,
    temperature: Number.isFinite(raw.temperature) ? raw.temperature : 0.6,
    // 0 = 不在请求里带 max_tokens，交给服务商默认（见 protocols.prepare 的说明）
    maxTokens: Number.isFinite(raw.maxTokens) ? raw.maxTokens : 0,
    timeoutMs: Number.isFinite(raw.timeoutMs) ? raw.timeoutMs : DEFAULT_POLICY.timeoutMs,
    enabled: raw.enabled !== false,
    note: raw.note || preset.note || '',
    // 运行期状态，不落盘
    health: { lastOkAt: null, lastError: null, latencyMs: null, fails: 0, breakerUntil: 0 },
  };
}

/** 目标是否配置完整、可以真的发请求 */
export function targetReadiness(t) {
  const problems = [];
  if (!t.baseUrl) problems.push('未填 baseUrl');
  if (!t.model) problems.push('未填模型名');
  if (!t.enabled) problems.push('已停用');
  const preset = presetById(t.preset);
  if (preset.needsKey && !t.apiKey) problems.push(`${preset.name} 需要 API Key`);
  return { ready: problems.length === 0, problems, reason: problems.join('；') };
}

export function breakerOpen(t, now = Date.now()) {
  return (t.health?.breakerUntil || 0) > now;
}

export function markSuccess(t, latencyMs) {
  t.health.lastOkAt = new Date().toISOString();
  t.health.latencyMs = latencyMs;
  t.health.fails = 0;
  t.health.breakerUntil = 0;
  t.health.lastError = null;
}

export function markFailure(t, err, policy = DEFAULT_POLICY) {
  t.health.fails = (t.health.fails || 0) + 1;
  t.health.lastError = err?.message || String(err);
  if (t.health.fails >= (policy.breakerThreshold || DEFAULT_POLICY.breakerThreshold)) {
    t.health.breakerUntil = Date.now() + (policy.breakerCooldownMs || DEFAULT_POLICY.breakerCooldownMs);
  }
}

/**
 * 由配置得到目标表。
 * 兼容旧配置：若没有 hermes.targets，就用 agent 里的单目标合成一条，
 * 这样老用户的 data/config.json 不用改也能继续用。
 */
export function buildTargets(config = {}) {
  const h = config.hermes || {};
  if (Array.isArray(h.targets) && h.targets.length) {
    return h.targets.map(normalizeTarget);
  }
  const a = config.agent || {};
  if (!a.provider && !a.baseUrl && !a.model) return [];
  return [normalizeTarget({
    id: a.provider || 'deepseek',
    preset: a.provider || 'deepseek',
    baseUrl: a.baseUrl,
    apiKey: a.apiKey,
    model: a.model,
    protocol: a.protocol || 'auto',
    temperature: a.temperature,
    maxTokens: a.maxTokens,
  })];
}
