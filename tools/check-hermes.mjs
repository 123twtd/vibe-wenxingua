/**
 * 问心卦 · Hermes 网关自检
 * ------------------------------------------------------------
 * 用法：node tools/check-hermes.mjs
 *
 * 验四件事：
 *   1. 协议适配——同一段模型输出，四种协议各自能不能正确还原出工具调用；
 *   2. 请求编织——非原生协议下，工具说明有没有被正确注入、历史里的 tool 消息有没有被压平；
 *   3. 路由——能力筛选、优先本地、显式指定、降级链、跳过原因；
 *   4. 策略——超时/4xx/5xx 的可重试判定、熔断计数、目标就绪判定。
 *
 * 全部离线，不发真实网络请求（除了一个必然失败的本地端口，用来验降级）。
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const P = await load('hermes/protocols.mjs');
const T = await load('hermes/targets.mjs');
const R = await load('hermes/router.mjs');
const H = await load('hermes/index.mjs');

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${name}${detail ? `　${detail}` : ''}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? `　实际：${detail}` : ''}`); }
};

const wrap = (content) => ({ choices: [{ message: { role: 'assistant', content } }] });

console.log('\n【一】协议适配：模型输出 → 统一工具调用');
{
  check('协议表有四种', P.PROTOCOL_IDS.length === 4, P.PROTOCOL_IDS.join('、'));

  const xml = '好的\n<tool_call>\n{"name":"cast","arguments":{"numbers":[82]}}\n</tool_call>\n完事';
  const a = P.parse('hermes-xml', wrap(xml));
  check('hermes-xml：<tool_call> 能解析', a.tool_calls.length === 1 && a.tool_calls[0].function.name === 'cast',
    `${a.tool_calls.length} 个调用`);
  check('hermes-xml：参数被规范化成 JSON 字符串',
    JSON.parse(a.tool_calls[0].function.arguments).numbers[0] === 82, a.tool_calls[0].function.arguments);
  check('hermes-xml：标签从正文里清干净', !a.content.includes('tool_call'), JSON.stringify(a.content));

  const xml2 = '<tool_call>{"name":"cast","arguments":{}}</tool_call><tool_call>{"name":"stats","arguments":{}}</tool_call>';
  const a2 = P.parse('hermes-xml', wrap(xml2));
  check('hermes-xml：支持一次多个调用', a2.tool_calls.length === 2, a2.tool_calls.map((c) => c.function.name).join('+'));

  const xmlLoose = '<tool_call>{"name":"cast","arguments":{"numbers":[7]}}';
  const a3 = P.parse('hermes-xml', wrap(xmlLoose));
  check('hermes-xml：漏闭合标签也认', a3.tool_calls.length === 1, `${a3.tool_calls.length} 个`);

  const fence = '先调两个\n```json\n[{"tool":"cast","args":{"numbers":[7]}},{"tool":"stats","args":{}}]\n```';
  const b = P.parse('text-fence', wrap(fence));
  check('text-fence：围栏 JSON 数组能解析', b.tool_calls.length === 2, b.tool_calls.map((c) => c.function.name).join('+'));
  check('text-fence：围栏从正文里移除', !b.content.includes('```'), JSON.stringify(b.content));

  const fenceOne = '```json\n{"tool":"list_records","args":{"limit":3}}\n```';
  const b2 = P.parse('text-fence', wrap(fenceOne));
  check('text-fence：单个对象也认', b2.tool_calls.length === 1 && b2.tool_calls[0].function.name === 'list_records');

  const native = P.parse('openai-native', {
    choices: [{ message: { content: '', tool_calls: [{ id: 'x1', function: { name: 'stats', arguments: '{}' } }] } }],
  });
  check('openai-native：原生 tool_calls 直通', native.tool_calls.length === 1 && native.tool_calls[0].id === 'x1');

  const degraded = P.parse('openai-native', wrap('```json\n{"tool":"stats","args":{}}\n```'));
  check('openai-native：端点退化成文本时仍能兜住', degraded.tool_calls.length === 1, `${degraded.tool_calls.length} 个`);

  const plainText = P.parse('openai-native', wrap('就是一卦，不必调工具。'));
  check('纯文本不被误判成工具调用', plainText.tool_calls.length === 0 && plainText.content.includes('一卦'));

  // 推理模型的思维链要原样带出来：漏掉它，界面上就没有「思考」可显示，
  // 而推理模型常常一句正文都没有，全靠这段。
  const rs = P.parse('openai-native', {
    choices: [{ message: { role: 'assistant', content: '', reasoning_content: '先看体用，再取动爻。' } }],
  });
  check('推理模型的思维链被解析出来（reasoning_content）', rs.reasoning === '先看体用，再取动爻。', JSON.stringify(rs.reasoning));

  const rs2 = P.parse('openai-native', {
    choices: [{ message: { role: 'assistant', content: '好的', reasoning: '别名也认' } }],
  });
  check('reasoning 这个别名同样认', rs2.reasoning === '别名也认', JSON.stringify(rs2.reasoning));

  const rs3 = P.parse('openai-native', wrap('普通回答'));
  check('没有思维链时给空串而不是 undefined', rs3.reasoning === '', JSON.stringify(rs3.reasoning));

  check('模型名能猜协议', P.guessProtocol('NousResearch/Hermes-3-Llama-3.1-8B') === 'hermes-xml'
    && P.guessProtocol('deepseek-chat') === 'openai-native'
    && P.guessProtocol('qwen2.5:7b', 'http://127.0.0.1:11434/v1') === 'text-fence',
    `hermes→${P.guessProtocol('Hermes-3-8B')} deepseek→${P.guessProtocol('deepseek-chat')} local→${P.guessProtocol('qwen2.5:7b', 'http://127.0.0.1:11434/v1')}`);
}

console.log('\n【二】请求编织：统一请求 → 各协议要的 HTTP 体');
{
  const tools = [{
    type: 'function',
    function: {
      name: 'cast', description: '起一卦',
      parameters: { type: 'object', properties: { numbers: { type: 'array', description: '报数' }, localTime: { type: 'string' } }, required: ['numbers'] },
    },
  }];
  const messages = [
    { role: 'system', content: '你是助手' },
    { role: 'user', content: '起一卦' },
    { role: 'tool', name: 'cast', tool_call_id: 't1', content: '{"本卦":"泽火革"}' },
    { role: 'user', content: '那是什么意思' },
  ];

  const nat = P.prepare({ protocol: 'openai-native', model: 'm', messages, tools });
  check('openai-native：带 tools 数组与 tool_choice', !!nat.tools && nat.tool_choice === 'auto' && nat.messages.length === messages.length);

  const hx = P.prepare({ protocol: 'hermes-xml', model: 'm', messages, tools });
  const sys = hx.messages.find((m) => m.role === 'system').content;
  check('hermes-xml：工具目录注入 system', sys.includes('可用工具') && sys.includes('### cast'), `${sys.length} 字`);
  check('hermes-xml：调用格式注入 system', sys.includes('<tool_call>'));
  check('hermes-xml：必填/可选标注正确', sys.includes('必填') && sys.includes('可选'));
  check('hermes-xml：tool 消息被压成普通文本', !hx.messages.some((m) => m.role === 'tool')
    && hx.messages.some((m) => m.role === 'user' && String(m.content).includes('cast 的执行结果')));
  check('hermes-xml：不带 tools 字段', hx.tools === undefined);

  const tf = P.prepare({ protocol: 'text-fence', model: 'm', messages, tools });
  check('text-fence：注入的是围栏格式', tf.messages[0].content.includes('```json'));

  const pl = P.prepare({ protocol: 'plain', model: 'm', messages, tools });
  check('plain：完全不注入工具', !pl.messages[0].content.includes('可用工具') && pl.tools === undefined);

  const noTools = P.prepare({ protocol: 'hermes-xml', model: 'm', messages, tools: [] });
  check('无工具时不注入说明', !noTools.messages[0].content.includes('可用工具'));

  const asst = P.prepare({
    protocol: 'hermes-xml', model: 'm', tools,
    messages: [{ role: 'assistant', content: '', tool_calls: [{ id: 'a', function: { name: 'cast', arguments: '{"numbers":[1]}' } }] }],
  });
  check('历史里的 tool_calls 被还原成 XML 文本', String(asst.messages[0].content).includes('<tool_call>'));

  /* 长回答不许被我们自己截断：不发 max_tokens 时请求体里就不该有这个键；
     真被服务商截断时（finish_reason='length'）界面得知道，所以必须把它留住。
     这两条一起守「半句话」那类问题：一处是原因，一处是症状的可见性。 */
  const noCap = P.prepare({ protocol: 'openai-native', model: 'm', messages, tools });
  const capped = P.prepare({ protocol: 'openai-native', model: 'm', messages, tools, maxTokens: 800 });
  const parsedLength = P.parse('openai-native', {
    choices: [{ finish_reason: 'length', message: { role: 'assistant', content: '半句话' } }],
  });
  check('不设上限就不发 max_tokens；真被截断时 finish_reason 被留住',
    !('max_tokens' in noCap) && capped.max_tokens === 800 && parsedLength.finish_reason === 'length'
      && parsedLength.content === '半句话',
    `noCap=${JSON.stringify(noCap.max_tokens)} capped=${capped.max_tokens} finish=${parsedLength.finish_reason}`);
}

console.log('\n【三】路由：决定交给谁');
{
  const mk = (targets, routes) => H.createHermes({ hermes: { targets, ...(routes ? { routes } : {}) } });
  const two = mk([
    { id: 'local', preset: 'ollama', model: 'qwen2.5:7b', weight: 50 },
    { id: 'cloud', preset: 'deepseek', apiKey: 'sk-test', model: 'deepseek-chat', weight: 100 },
  ]);

  const h = two.health();
  check('健康总览：本地与云端都就绪', h.length === 2 && h.every((x) => x.ready), h.map((x) => `${x.id}=${x.ready}`).join(' '));
  check('健康总览：带协议与协议中文名', h.every((x) => x.protocol && x.protocolName), h.map((x) => `${x.id}:${x.protocolName}`).join(' '));

  const anyChain = two.explain({ needsTools: true }).chain.map((t) => t.id);
  check('要工具：按权重降序', anyChain[0] === 'cloud', anyChain.join(' → '));

  const localChain = two.explain({ needsTools: true, preferLocal: true }).chain.map((t) => t.id);
  check('优先本地：本地排第一', localChain[0] === 'local', localChain.join(' → '));

  const noToolsChain = two.explain({}).chain.map((t) => t.id);
  check('不要工具：全部可用目标入链', noToolsChain.length === 2, noToolsChain.join(' → '));

  const none = mk([{ id: 'plainonly', preset: 'custom', baseUrl: 'http://x/v1', model: 'm', protocol: 'plain' }]);
  const sel = none.explain({ needsTools: true });
  check('要工具但没有支持工具的目标：链为空且有原因', sel.chain.length === 0 && sel.skipped.length === 1,
    sel.skipped.map((s) => s.why).join('；'));

  const withDead = mk([
    { id: 'dead', preset: 'custom', baseUrl: 'http://127.0.0.1:1/v1', model: 'none', protocol: 'plain', weight: 999 },
    { id: 'live', preset: 'deepseek', apiKey: 'sk-test', model: 'deepseek-chat', weight: 1 },
  ]);
  const dsel = withDead.explain({});
  // 配置层面的「就绪」不等于网络可达——Hermes 不预先探测，让它在链上跑，失败再降级。
  // 这条断言要保的是「即便高权重目标连不上，它也排在链首、后面的目标仍在链上」。
  check('权重高的目标排链首，后续目标仍在链上',
    dsel.chain.length === 2 && dsel.chain[0].id === 'dead' && dsel.chain[1].id === 'live',
    dsel.chain.map((t) => t.id).join(' → '));

  const disabled = mk([
    { id: 'off', preset: 'ollama', model: 'm', enabled: false, weight: 999 },
    { id: 'on', preset: 'ollama', model: 'm', weight: 1 },
  ]);
  const offSel = disabled.explain({});
  check('显式停用的目标被跳过', offSel.chain.length === 1 && offSel.chain[0].id === 'on'
    && offSel.skipped.some((s) => s.target === 'off' && /已停用/.test(s.why)),
    `链：${offSel.chain.map((t) => t.id).join(' → ')}｜跳过：${offSel.skipped.map((s) => `${s.target}(${s.why})`).join(',')}`);

  const noKey = mk([{ id: 'd', preset: 'deepseek', model: 'deepseek-chat' }]);
  const nkSel = noKey.explain({});
  check('缺 Key 的目标不入链', nkSel.chain.length === 0 && /API Key/.test(nkSel.skipped[0]?.why || ''),
    nkSel.skipped.map((s) => s.why).join('；'));

  const empty = mk([]);
  check('零目标时 ready=false 且链为空', empty.ready === false && empty.explain({}).chain.length === 0);

  // 自定义路由规则
  const routed = mk(
    [{ id: 'a', preset: 'ollama', model: 'm1', weight: 1 }, { id: 'b', preset: 'ollama', model: 'm2', weight: 2 }],
    [{ id: 'pin-a', name: '指定 a', when: {}, to: ['a'] }],
  );
  check('自定义路由规则生效', routed.explain({}).chain.map((t) => t.id).join() === 'a',
    routed.explain({}).chain.map((t) => t.id).join(' → '));

  const tagged = mk([
    { id: 'x', preset: 'ollama', model: 'm', tags: ['便宜'] },
    { id: 'y', preset: 'ollama', model: 'm', tags: ['强'] },
  ], [{ id: 'tag', name: '按标签', when: { hasTag: '强' }, to: ['#强'] }]);
  check('按标签选目标', tagged.explain({ tags: ['强'] }).chain.map((t) => t.id).join() === 'y',
    tagged.explain({ tags: ['强'] }).chain.map((t) => t.id).join(' → '));

  check('解释文本可读', /命中路由规则|未命中任何规则/.test(two.explain({ needsTools: true }).text),
    two.explain({ needsTools: true }).text.split('\n')[0]);
}

console.log('\n【四】策略：重试判定与熔断');
{
  const sel = (name, ok, detail) => check(name, ok, detail);
  sel('超时可重试', H.isRetryable(new Error('模型接口返回 500：timeout')) === true);
  sel('429 可重试', H.isRetryable(new Error('模型接口返回 429：rate limited')) === true);
  sel('503 可重试', H.isRetryable(new Error('模型接口返回 503：unavailable')) === true);
  sel('网络错误可重试', H.isRetryable(new Error('fetch failed')) === true);
  sel('401 不重试', H.isRetryable(new Error('模型接口返回 401：invalid api key')) === false);
  sel('400 不重试', H.isRetryable(new Error('模型接口返回 400：bad request')) === false);
  sel('普通业务错不重试', H.isRetryable(new Error('工具参数错误')) === false);

  const t = T.normalizeTarget({ id: 'x', preset: 'deepseek', apiKey: 'k', model: 'm' });
  sel('目标默认带协议与权重', t.protocol === 'openai-native' && t.weight === 100 && t.enabled === true,
    `protocol=${t.protocol} weight=${t.weight}`);

  const policy = { breakerThreshold: 2, breakerCooldownMs: 1000 };
  T.markFailure(t, new Error('boom'), policy);
  sel('一次失败不熔断', T.breakerOpen(t) === false, `fails=${t.health.fails}`);
  T.markFailure(t, new Error('boom'), policy);
  sel('达到阈值即熔断', T.breakerOpen(t) === true, `fails=${t.health.fails} until=${t.health.breakerUntil > 0}`);
  T.markSuccess(t, 123);
  sel('成功后熔断解除且延迟被记录', T.breakerOpen(t) === false && t.health.latencyMs === 123 && t.health.fails === 0);

  const bad = T.normalizeTarget({ id: 'y', preset: 'deepseek', model: 'm' });
  sel('缺 Key 判定不就绪', T.targetReadiness(bad).ready === false && /API Key/.test(T.targetReadiness(bad).reason));
}

console.log('\n【五】与旧配置的兼容');
{
  const legacy = H.createHermes({ agent: { provider: 'deepseek', apiKey: 'sk-x', model: 'deepseek-chat', temperature: 0.6 } });
  check('只有 agent 段的旧配置能合成单目标', legacy.targets.length === 1 && legacy.targets[0].id === 'deepseek',
    legacy.targets.map((t) => `${t.id}/${t.model}[${t.protocol}]`).join(' '));
  check('旧配置合成的目标就绪', legacy.ready === true);

  const provider = await load('agent/provider.mjs');
  const cfg = provider.resolveConfig({ provider: 'ollama' });
  check('provider.resolveConfig 形状不变', cfg.ready === true && /11434/.test(cfg.baseUrl) && !!cfg.preset,
    `${cfg.baseUrl} / ${cfg.model} / protocol=${cfg.protocol}`);
  const noKey = provider.resolveConfig({ provider: 'deepseek', apiKey: '' });
  check('provider 仍报缺 Key', noKey.ready === false && /API Key/.test(noKey.reason), noKey.reason);
  check('provider.extractTextToolCalls 仍可用',
    provider.extractTextToolCalls('```json\n{"tool":"cast","args":{"numbers":[7]}}\n```').length === 1);
  check('provider.PROVIDERS 与 Hermes 预设同源', provider.PROVIDERS === H.PRESETS || provider.PROVIDERS.length === H.PRESETS.length,
    `${provider.PROVIDERS.length} 家`);

  const cfgHermes = provider.resolveConfig({ provider: 'hermes', model: 'NousResearch/Hermes-3-Llama-3.1-8B' });
  check('选 Hermes 预设时协议自动变 hermes-xml', cfgHermes.protocol === 'hermes-xml', cfgHermes.protocol);
  const cfgNativeOff = provider.resolveConfig({ provider: 'deepseek', apiKey: 'k', useNativeTools: false });
  check('关掉原生工具调用时协议降级为 text-fence', cfgNativeOff.protocol === 'text-fence', cfgNativeOff.protocol);
}

console.log('\n【六】失败路径：降级到不存在的端点应报错而非抛异常');
{
  const dead = H.createHermes({ hermes: { targets: [{ id: 'dead', preset: 'custom', baseUrl: 'http://127.0.0.1:1/v1', model: 'm', protocol: 'plain', timeoutMs: 1500 }] } });
  const out = await dead.chat({ messages: [{ role: 'user', content: 'hi' }] });
  check('连不上时返回 ok:false 而不是抛异常', out.ok === false, String(out.error).slice(0, 80));
  check('留痕：记录了尝试与降级轨迹', Array.isArray(out.attempts) && out.attempts.length >= 1 && out.trace.length >= 1,
    out.trace[out.trace.length - 1]);
  const none = H.createHermes({});
  const out2 = await none.chat({ messages: [{ role: 'user', content: 'hi' }] });
  check('零目标时给出可读原因', out2.ok === false && /没有可用的模型目标/.test(out2.error), out2.error.slice(0, 60));
}

console.log(`\n———— 通过 ${pass} 项，失败 ${fail} 项 ————`);
if (fail) {
  console.log('\n排查提示：协议解析问题看 hermes/protocols.mjs 的 parse()；');
  console.log('路由问题看 hermes/router.mjs 的 selectTargets() 与 DEFAULT_ROUTES；');
  console.log('目标就绪问题看 hermes/targets.mjs 的 targetReadiness()。\n');
  process.exit(1);
}
console.log('Hermes 网关正常。\n');
