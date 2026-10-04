/**
 * Hermes · 协议适配器
 * ------------------------------------------------------------
 * 「信使」要干的第一件事：**听得懂各家模型说的话**。
 *
 * 同样是「让模型调工具」，不同模型族的表达方式并不一样：
 *   · openai-native —— 请求里带 tools，响应里给 message.tool_calls（DeepSeek / OpenAI / vLLM 多数如此）
 *   · hermes-xml    —— Hermes 系开源模型：工具写进提示词，模型吐 <tool_call>{"name":…}</tool_call>
 *   · text-fence    —— 更弱的小模型：让它吐 ```json {"tool":…,"args":…}``` 再从文本里抠
 *   · plain         —— 不带工具，纯对话
 *
 * 每个适配器只做两件事：`prepare()` 把统一请求编成该协议要的 HTTP 体；
 * `parse()` 把该协议的响应还原成统一的「文本 + 工具调用」。
 * 上层（router / loop）因此不必知道对面是哪种模型。
 */

/** 协议清单。capabilities 用于路由时筛选 */
export const PROTOCOLS = [
  {
    id: 'openai-native',
    name: 'OpenAI 原生 function calling',
    capabilities: ['tools', 'streaming', 'multi-tool'],
    description: '请求带 tools 数组，响应给 message.tool_calls。DeepSeek、OpenAI、多数兼容端点走这条。',
  },
  {
    id: 'hermes-xml',
    name: 'Hermes XML 工具调用',
    capabilities: ['tools', 'xml-tags'],
    description: '工具说明写进 system 提示，模型以 <tool_call>{"name":…,"arguments":{…}}</tool_call> 形式调用。',
  },
  {
    id: 'text-fence',
    name: '文本协议（围栏 JSON）降级',
    capabilities: ['tools'],
    description: '让模型吐 ```json {"tool":…,"args":{…}}```，再从文本里解析。本地小模型的兜底路线。',
  },
  {
    id: 'plain',
    name: '纯对话',
    capabilities: [],
    description: '不带任何工具，只做文本生成。',
  },
];

export const PROTOCOL_IDS = PROTOCOLS.map((p) => p.id);
export const protocolById = (id) => PROTOCOLS.find((p) => p.id === id) || PROTOCOLS[0];

/* ============================================================
 * 一、工具说明的文本化（给非原生协议用）
 * ========================================================== */

/** 把 OpenAI 风格的 tools 数组渲染成一段人能读、模型也能照做的说明 */
export function renderToolCatalog(tools) {
  const lines = [];
  for (const t of tools || []) {
    const fn = t.function || t;
    lines.push(`### ${fn.name}`);
    if (fn.description) lines.push(fn.description);
    const params = fn.parameters || fn.inputSchema || {};
    const props = params.properties || {};
    const required = new Set(params.required || []);
    const rows = Object.entries(props).map(([k, v]) => {
      const type = v.type || (v.enum ? 'enum' : 'any');
      const enumText = v.enum ? `　取值：${v.enum.join(' / ')}` : '';
      const req = required.has(k) ? '必填' : '可选';
      const desc = v.description ? `　${v.description}` : '';
      return `  - ${k}（${type}，${req}）${desc}${enumText}`;
    });
    if (rows.length) lines.push('参数：', ...rows);
    else lines.push('参数：无');
    lines.push('');
  }
  return lines.join('\n');
}

/* ============================================================
 * 二、协议适配器
 * ========================================================== */

const TOOL_PROTOCOL_BODY = `你可以调用工具来完成任务。需要调用时，**只输出下面这一种格式**，不要额外解释：

<tool_call>
{"name": "工具名", "arguments": {"参数": "值"}}
</tool_call>

需要一次调用多个工具时，连续写多个 <tool_call> 块。
不需要工具时，直接用自然语言回答。**不要臆造工具名与参数。**`;

const TOOL_PROTOCOL_FENCE = `你可以调用工具来完成任务。需要调用时，**只输出一段 JSON 代码块**，不要额外解释：

\`\`\`json
{"tool": "工具名", "args": {"参数": "值"}}
\`\`\`

需要一次调用多个工具时，输出一个 JSON 数组。不需要工具时，直接用自然语言回答。**不要臆造工具名与参数。**`;

/**
 * 把统一请求编成某协议下的 HTTP 请求体。
 * @param {object} p
 * @param {string} p.protocol    协议 id
 * @param {string} p.model
 * @param {Array}  p.messages    统一消息 [{role, content, tool_calls?, tool_call_id?, name?}]
 * @param {Array}  [p.tools]     OpenAI 风格 tools
 * @param {number} [p.temperature]
 * @param {number} [p.maxTokens] 正数才发（0/未设 = 交给服务商默认）
 * @param {boolean}[p.stream]
 */
export function prepare({ protocol, model, messages, tools, temperature = 0.6, maxTokens = 0, stream = false }) {
  const body = { model, temperature };
  /* max_tokens 只在**显式设了正数**时才发出去。
     为什么不是给个"合理的小值"：中文回答很容易越过 1600 token，越过就被服务商
     拦腰截断（finish_reason='length'），界面上只看到半句话——用户要的是一段完整的
     话，不是省 token。不设则用服务商自己的默认上限（DeepSeek 官方默认 4K）。 */
  if (Number.isFinite(maxTokens) && maxTokens > 0) body.max_tokens = maxTokens;
  if (stream) body.stream = true;

  if (protocol === 'openai-native') {
    body.messages = messages;
    if (tools?.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    return body;
  }

  if (protocol === 'plain' || !tools?.length) {
    // 把历史里的 tool 消息折叠成人可读的文本，避免协议不认
    body.messages = messages.map(flattenToolMessages);
    return body;
  }

  // hermes-xml / text-fence：工具说明注入 system，历史里的 tool 结果转成普通文本
  const catalog = renderToolCatalog(tools);
  const rule = protocol === 'hermes-xml' ? TOOL_PROTOCOL_BODY : TOOL_PROTOCOL_FENCE;
  const injected = `\n\n## 可用工具\n\n${catalog}\n## 调用格式\n\n${rule}\n`;

  const out = [];
  let injectedIntoSystem = false;
  for (const m of messages) {
    if (m.role === 'system' && !injectedIntoSystem) {
      out.push({ role: 'system', content: `${m.content}${injected}` });
      injectedIntoSystem = true;
      continue;
    }
    out.push(flattenToolMessages(m));
  }
  if (!injectedIntoSystem) out.unshift({ role: 'system', content: injected.trim() });
  body.messages = out;
  return body;
}

/** 把带 tool_calls / tool 角色的消息压成纯文本，供不支持这些角色的端点使用 */
function flattenToolMessages(m) {
  if (m.role === 'tool') {
    const name = m.name || '工具';
    return { role: 'user', content: `【${name} 的执行结果】\n${String(m.content ?? '').slice(0, 20000)}` };
  }
  if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
    const calls = m.tool_calls
      .map((c) => `<tool_call>\n${JSON.stringify({ name: c.function?.name, arguments: safeJson(c.function?.arguments) })}\n</tool_call>`)
      .join('\n');
    const text = [m.content || '', calls].filter(Boolean).join('\n\n');
    return { role: 'assistant', content: text };
  }
  return { role: m.role, content: m.content ?? '' };
}

function safeJson(s) {
  if (s && typeof s === 'object') return s;
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}

/* ============================================================
 * 三、响应解析
 * ========================================================== */

/**
 * 把模型响应还原成统一结构。
 * @param {string} protocol
 * @param {object} data 原始响应 JSON
 * @returns {object} 统一消息 {role, content, reasoning, tool_calls, finish_reason, raw}
 */
export function parse(protocol, data) {
  const message = data?.choices?.[0]?.message
    || data?.message
    || (data?.choices?.[0]?.text !== undefined ? { role: 'assistant', content: data.choices[0].text } : null);
  /* 收尾原因必须留住：'length' 表示被 max_tokens 截断，正文是半句话。
     早先整条丢掉，界面就永远不知道自己拿到的是残句——用户只会觉得"程序坏了"。 */
  const finish = data?.choices?.[0]?.finish_reason || '';
  if (!message) {
    return { role: 'assistant', content: '', reasoning: '', tool_calls: [], finish_reason: finish, raw: data, empty: true };
  }

  const out = {
    role: 'assistant',
    content: typeof message.content === 'string' ? message.content : (message.content ?? ''),
    finish_reason: finish,
    /* 推理模型的思维链。DeepSeek 叫 reasoning_content，另有些端点叫 reasoning。
       早先只取 content，思维链整段被丢掉——纯推理时 content 还是空的，
       界面上就只剩「没有思考记录」。它只用于显示，不参与工具调用解析。 */
    reasoning: typeof message.reasoning_content === 'string' ? message.reasoning_content
      : (typeof message.reasoning === 'string' ? message.reasoning : ''),
    tool_calls: [],
    raw: data,
  };

  // 原生
  if (Array.isArray(message.tool_calls) && message.tool_calls.length && protocol === 'openai-native') {
    out.tool_calls = message.tool_calls.map((c, i) => normalizeCall(c, i));
    return out;
  }

  // 非原生：从文本里抠
  if (protocol !== 'openai-native') {
    const stripped = protocol === 'hermes-xml' ? stripHermesXml(out.content) : stripAllFences(out.content);
    out.content = stripped.text;
    out.tool_calls = stripped.calls.map((c, i) => normalizeCall(c, i));
    if (out.tool_calls.length && !out.content) out.content = '';
    return out;
  }

  // 原生协议但没给 tool_calls：仍试一次文本兜底（有些端点会退化）
  const fb = extractTextCalls(out.content);
  if (fb.length) {
    out.tool_calls = fb.map((c, i) => normalizeCall(c, i));
    out.content = stripAllFences(out.content).text;
  }
  return out;
}

function normalizeCall(c, i) {
  const fn = c.function || c;
  let args = fn.arguments ?? fn.args ?? {};
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args || '{}');
    } catch {
      args = { _raw: String(args) };
    }
  }
  return {
    id: c.id || `call_${Date.now().toString(36)}_${i}`,
    type: 'function',
    function: { name: fn.name || fn.tool || '', arguments: JSON.stringify(args ?? {}) },
  };
}

/** 从 <tool_call>…</tool_call> 里取调用；顺手把标签从正文里去干净 */
export function stripHermesXml(text) {
  const src = String(text || '');
  const calls = [];
  const re = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    collectCalls(m[1], calls);
  }
  // 有些模型把工具名写在 <tool_call> 属性里，或漏了闭合标签，兜一手
  if (!calls.length) {
    const loose = src.match(/<tool_call>([\s\S]*)$/i);
    if (loose) collectCalls(loose[1], calls);
  }
  return { text: src.replace(re, '').replace(/<tool_call>[\s\S]*$/i, '').trim(), calls };
}

/** 从 ```json 围栏里取调用 */
export function stripAllFences(text) {
  const src = String(text || '');
  let rest = src;
  const calls = [];
  const re = /```(?:json|tool_call)?\s*([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (collectCalls(m[1], calls)) rest = rest.replace(m[0], '');
  }
  return { text: rest.trim(), calls };
}

/** 无围栏时也试一次（整段就是 JSON 的情况） */
export function extractTextCalls(text) {
  const calls = [];
  const src = String(text || '').trim();
  const fenced = stripAllFences(src);
  if (fenced.calls.length) return fenced.calls;
  if (src.startsWith('{') || src.startsWith('[')) collectCalls(src, calls);
  return calls;
}

/** 把一段文本解析成调用数组；认不出返回 false */
function collectCalls(chunk, into) {
  const raw = String(chunk).trim();
  if (!raw) return false;
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return false;
  }
  const arr = Array.isArray(obj) ? obj : [obj];
  let n = 0;
  for (const o of arr) {
    if (!o || typeof o !== 'object') continue;
    if (typeof o.tool === 'string') {
      into.push({ name: o.tool, arguments: o.args ?? o.arguments ?? {} });
      n += 1;
    } else if (typeof o.name === 'string') {
      into.push({ name: o.name, arguments: o.arguments ?? o.args ?? {} });
      n += 1;
    } else if (o.function && typeof o.function.name === 'string') {
      into.push({ name: o.function.name, arguments: o.function.arguments ?? {} });
      n += 1;
    }
  }
  return n > 0;
}

/* ============================================================
 * 四、协议推断
 * ========================================================== */

/** 从模型名猜协议——猜不中也不致命，路由表里可以显式指定 */
export function guessProtocol(model = '', baseUrl = '') {
  const m = String(model).toLowerCase();
  const u = String(baseUrl).toLowerCase();
  if (/hermes/.test(m)) return 'hermes-xml';
  if (/ollama|127\.0\.0\.1|localhost/.test(u + m)) return 'text-fence';
  if (/deepseek|gpt-|o[1-4]|claude|qwen|glm|moonshot|kimi|grok/.test(m)) return 'openai-native';
  return 'openai-native';
}

export { flattenToolMessages };
