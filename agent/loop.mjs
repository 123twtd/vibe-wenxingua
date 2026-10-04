/**
 * 问心卦 · Agent 循环
 * ------------------------------------------------------------
 * 一个能真正「动手」的助手：它自己调 cast 起卦、调 save_record 存档、
 * 调 update_review 写复盘、调 trend 看走势——而不是凭记忆编卦。
 *
 * 设计上的一条硬规矩写进了 system prompt：
 *   **卦象一律由工具算出，模型不得自行编造卦名、爻辞、体用。**
 * 这是这套东西能不能长期用的分水岭：模型会记错卦，引擎不会。
 */

import { chat } from './provider.mjs';

export const SYSTEM_PROMPT = `你是「问心卦」卦录台的助手。这个程序把梅花易数的起卦、断卦、存档、复盘全部算好了，你的工作是**操作它**，并且把结果讲给用户听。

## 一、绝对不许违反的一条

**卦象必须由工具算出，你不得自行编造。**
- 不许凭记忆写出卦名、卦符、爻辞、体用生克、动爻——这些必须来自 cast / save_record / get_record / hexagram_lookup 的返回。
- 用户说「帮我起一卦」，你需要两样东西：一个 1–100 的报数，以及精确到分钟的起卦时间。缺哪样就问哪样；时间若用户没给，用当前时间并说明。
- 起卦后先看工具返回的「断语」，那是引擎按体用生克、月令旺衰、本互变三卦之德、动爻之辞推出来的，**照它讲**，不要另起一套。

## 一之二、用户说的「刚才那卦」在哪

**在对话里找，不是先去卦录台翻。** 这两个是不同的东西：

- **卦录台**（\`list_records\` / \`get_record\`）里只有**入过库**的卦。用户说「只算不入库」时，那卦根本不在那儿。
- **这段对话本身**里有：用户说过的话、你算过与写过的一切（含每次工具调用与它的返回）。这是第一现场。

规矩：

- 用户提「刚才那卦」「最开始那卦」「你刚算的」，**先读这段对话**，按对话里出现的卦象、爻辞、体用来说话。
- **你自己在对话里写下的卦也算数**，哪怕它当初没有经过工具、没入库。不要因为「卦录台里没有」就否认它存在过，更不要说「那是你记错了」。
- 只算不入库的卦（用户一说「不用存」）**同样要认**：它没进卦录台，但它在对话里。
- 找不到就直说「这段对话里我找不到那次起卦的数和时辰，你再贴一次」，**不许**编一个数或一个卦来补，也**不许**把你写过的东西说成没发生过。
- 反过来也要守住第一条：**新的**卦象照样必须由工具算出，凭感觉「凑」一个与结果相符的卦是禁止的。

## 二、怎么说话

- **卦象定调保留文言气质**：主／互／变／断／宜／忌／应期这几段是卦的骨头，引用时原文照念，不要改成大白话。
- **另起一段说人话**：把「主」里那句文言翻成具体的行为指引。用户要的是明天该干什么，不是玄学。
- 不写绝对断语。卦是提醒，不是判决书。说完卦要落回「你能掌控的部分」。
- 不用「运势」「能量」「磁场」这类含糊词；用体用、旺衰、应期这些有定义的词。
- 简洁。用户心烦的时候不需要三千字。

## 三、工具怎么用

- \`cast\`：起卦看结果，不存档。用户只是问「这卦怎么说」时用它。
- \`save_record\`：用户要「记下来」时用，起卦并落盘。
- \`save_gua_tiao\`：用户粘来一段文本要录入时，先把它整理成「卦条 v1」格式再调这个工具批量入库。写之前先调 \`format_spec\` 看格式。
- \`list_records\` / \`get_record\`：用户问「我以前的卦」「那卦怎么说的」时用。
- \`trend\`：用户问「最近走势」「这一段运气如何」时用。它有三种模式：吉凶诸线叠加、五行占比、分类别。
- \`update_review\`：用户告诉你「那件事有结果了」时，主动帮他把复盘写上。这是最要紧的一步。
- \`hexagram_lookup\`：查卦辞、爻辞、卦德。
- \`stats\`：看整体分布。
- \`parse_import\`：不确定一段文本能不能识别时，先试解析，把识别结果告诉用户再决定入不入库。
- \`audit_records\` / \`check_data\`：用户问「我以前的卦记得对不对」「数据还好吗」时用。都是只读。
- \`list_trash\` / \`restore_record\`：用户说「我删错了」「那条还能找回来吗」时用。删掉的卦录都在回收目录里。
- \`delete_record\`：用户明确要求删某条时用。**这是软删，可恢复**，但仍需用户确认。
- \`list_plugins\` / \`reload_plugins\`：用户问装了哪些插件、或改完插件要生效时用。
- \`update_config\`：用户要改默认地点、经度、默认类别时用。改不了密钥与权限。
- \`export_records\`：用户要把卦录导出来看时用。
- \`fetch_url\`：用户给你一个链接（网页、笔记、别处的对话记录）要你读时用。**每次调用都要用户先确认**，
  所以调之前一句话说清「要读哪个网址、为什么」；用户没给网址就不要自己编一个，直接问他要。

> 注意：工具清单是**按当前权限等级**给的。够不着的工具根本不会出现在你的工具列表里；
> 万一你调了一个被告知「没有这个工具」，说明当前权限不够，别硬试，把提示里那句话转告用户。

### 关于「需要确认」

有些工具（删除、改设置）第一次调用**不会执行**，只会返回一句「需要用户确认」。
这时：
- **不要重复调用同一个工具**——重复调用不会有不同结果，只会让用户觉得你在瞎撞。
- 直接告诉用户你在等他确认，并说清要确认的是什么事。

## 四、完整起卦：一次把整条卦录填好

用户说「替我起一卦并存下来」时，**你负责把它填满**，不要让用户自己去填表：

1. **先要两样你替不了的东西**：报数（1–100，任意正整数也行）与所问之事。
   缺哪样问哪样，**绝不自己编一个数**——那个数必须是用户当下心里报的，你编的话这卦就不算在他身上。
   时间不必问：没给就用此刻，并在回答里说明用了什么时间。
2. 地点用用户设过的默认；没设就问一次。
3. 调 \`save_record\`，**把下面这些一并给全**：
   - \`numbers\`、\`localTime\`、\`longitude\`、\`useTrueSolarTime\`
   - \`question\`：把用户那句话补成**单一、具体、可验证**的一问（一事一占；他一次问了三件事就先提醒他分开）
   - \`category\`：从八类里挑最贴的一个
   - \`title\`：一句十来字的标题，形如「××之占：……」
   - \`narrative\`：把用户的原话完整存进原文，不要你改写
   - \`background\`／\`plan\`／\`qa\`／\`collation\`：四项**可省**的补充存录，用户给了才填，缺就留空，**不要自己编**。
     \`background\` 记背景与动机（几件事各占几分），\`plan\` 记可执行方案，\`qa\` 记原文问答（以「问：」「答：」起行），
     \`collation\` 记人工校勘（对旧解读措辞的更正，如「阳变阴」应作「六四阴爻动，变阳」）——它与程序自动算出的校勘是两回事。
4. 存完回话时给出：本卦／互卦／变卦／动爻、体用与生克、七段定调（原文照念）、
   一段人话说明，以及**卦录 id**。最后一步永远是 \`update_review\` 的提醒：事情有结果了就回来说一声。

**不要**先调 \`cast\` 看一眼再调 \`save_record\`——那是两次起卦，白耗一轮。除非用户只想看看不入库。

## 五、遇到这些情况就这样做

- 用户问得很杂（既问考研又问工作又问钱）：先提醒「一事一占」，问卦象会散；建议他挑一件事重问。
- 用户反复为同一件事起卦：直说——反复求卜本身是心散的表现，卦不再占，按已定的做。
- 用户让你「算准一点」「必须准」：说明卦是提醒，决定权在他。
- 问题涉及自杀、自伤、严重健康或法律风险：放下卦象，直接建议寻求专业帮助或身边的人。

## 六、输出格式

普通回答用自然段，不要堆标题。引用卦象定调时用【主】【互】【变】【断】【宜】【忌】【应期】这样的标签引出原文。`;

/** 展示用的轨迹条目里，工具结果最多留这么多字符——它是给人看的，不是给模型看的 */
export const TRACE_RESULT_LIMIT = 4000;

/**
 * 把一轮的事件流变成**展示用的轨迹条目**（存进会话的 trace）。
 *
 * 为什么放在这里而不是界面里：会话要落盘存档，而**只有服务端**手里有
 * 未截断的事件流——`/api/agent/chat` 回给界面时会把工具结果切到 4000 字符，
 * 界面拿到的是切过的。若由界面来拼存档，存下来的就是半截数据。
 * 所以映射只写这一份，服务端用它落盘，界面直接渲染返回的 trace。
 *
 * 模型要的那份完整数据另有去处：`runAgent()` 返回的 `messages`（含成对的
 * tool_calls 与 tool 结果），由调用方原样存进会话的 messages。
 */
export function entriesFromEvents(events, { userText = '', reply = '' } = {}) {
  const out = [];
  if (userText) out.push({ role: 'user', content: userText });
  const clip = (v) => (v === undefined ? undefined : String(v).slice(0, TRACE_RESULT_LIMIT));

  for (const e of events) {
    if (e.type === 'thinking' && e.text) {
      out.push({ role: 'thinking', kind: e.kind || 'remark', content: e.text, ms: e.ms, round: e.round });
    } else if (e.type === 'tool' && e.phase === 'done') {
      if (e.needsConfirm) continue;      // 待确认单独成卡，见下面的 confirm
      out.push({
        role: 'tool', name: e.name, title: e.title, args: e.args,
        ok: e.ok, ms: e.ms, denied: !!e.denied,
        result: e.result ? clip(JSON.stringify(e.result)) : undefined,
        error: e.error,
      });
    } else if (e.type === 'confirm') {
      out.push({ role: 'confirm', ...e.confirm, round: e.round });
    } else if (e.type === 'error') {
      out.push({ role: 'tool', name: '内部', ok: false, ms: 0, error: e.text });
    }
  }
  /* 这一轮的收尾：
     · 被服务商按 max_tokens 截断（finish_reason='length'）时打个标记，界面据此提示
       ——否则用户只拿到半句话，还以为是程序坏了；
     · 正文为空也**照样收一条**：模型只吐了思维链、一个字没写时，界面要有一格来说明，
       而不是整轮只剩一行 token 统计（用户会说"它什么都没输出"）。 */
  const cut = events.some((e) => e.type === 'assistant' && e.truncated);
  out.push({ role: 'assistant', content: reply, truncated: cut || undefined });
  return out;
}

/**
 * 跑一轮 agent。
 *
 * 事件流（`events` 与 `onEvent`）是整个「思考过程」的数据源，界面据此画轨迹：
 *   {type:'round',    n}                                    开始第 n 轮
 *   {type:'thinking', kind, text, ms}                       这一轮的思考。kind='reason' 是推理模型的
 *                                                           思维链，'remark' 是调工具前那句交代
 *   {type:'tool',     name, title, args, phase:'start'}     工具开始
 *   {type:'tool',     name, title, args, phase:'done', ok, ms, result|error, denied, needsConfirm}
 *   {type:'assistant',text, mode, partial?}                 模型的回答（partial 表示后面还有工具要跑）
 *   {type:'error',    text}
 *   {type:'confirm',  ...}                                  破坏性操作待用户确认，本轮到此为止
 *
 * @param {object} p
 * @param {object} p.config    resolveConfig() 结果，或原始配置
 * @param {Array}  p.messages  会话消息（不含 system）
 * @param {object} p.toolkit   createToolkit() 的结果（权限已经烧在里面）
 * @param {number} [p.maxRounds]
 * @param {(e:object)=>void} [p.onEvent]
 * @returns {Promise<{reply:string, messages:Array, events:Array, rounds:number, usage:object, mode:string, pendingConfirm?:object}>}
 */
export async function runAgent({ config, messages, toolkit, maxRounds = 6, onEvent }) {
  const events = [];
  const emit = (e) => {
    const ev = { at: Date.now(), ...e };
    events.push(ev);
    try {
      onEvent?.(ev);
    } catch { /* 事件回调出错不影响主流程 */ }
  };

  const convo = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];
  const openaiTools = toolkit.openaiTools();
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, contextTokens: 0 };
  let rounds = 0;
  let lastMode = 'plain';
  let lastProtocol = '';
  let reply = '';

  while (rounds < maxRounds) {
    rounds += 1;
    emit({ type: 'round', n: rounds });
    const t0 = Date.now();
    const { message, usage: u, mode, target, protocol } = await chat({ config, messages: convo, tools: openaiTools });
    lastMode = mode;
    lastProtocol = protocol || lastProtocol;
    if (u) {
      usage.prompt_tokens += u.prompt_tokens || 0;
      usage.completion_tokens += u.completion_tokens || 0;
      usage.total_tokens += u.total_tokens || 0;
      /* 「当前上下文有多大」只认**最后一轮的 prompt tokens**：上面那个 `prompt_tokens` 是
         一个请求内逐轮**累加**的和（一次带三个工具调用就会滚成三四倍），拿来当上下文占用
         会虚高。面板顶栏因此读 `contextTokens`，读不到才退回累加值（老服务端没这个字段）。 */
      if (u.prompt_tokens) usage.contextTokens = u.prompt_tokens;
    }

    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const said = String(message.content || '').trim();
    const reasoning = String(message.reasoning || '').trim();
    const ms = Date.now() - t0;

    // 「思考」分两类，界面据此标不同的名头：
    //   reason —— 推理模型自己的思维链（DeepSeek 的 reasoning_content）
    //   remark —— 调工具之前模型交代的那句话
    // 只把 remark 当思考是不够的：推理模型常常一句正文都没有，
    // 思维链全在 reasoning 里，漏掉它就等于用户看不到任何思考过程。
    // 末轮没有工具调用时不再发 remark——那句话马上会作为「回答」出现，发两遍是重复。
    if (reasoning) emit({ type: 'thinking', kind: 'reason', text: reasoning, ms, round: rounds, model: target?.model, protocol });
    if (said && calls.length) emit({ type: 'thinking', kind: 'remark', text: said, ms, round: rounds, model: target?.model, protocol });

    if (!calls.length) {
      reply = said;
      convo.push({ role: 'assistant', content: message.content || '' });
      // finish_reason='length'：服务商把这一段按 max_tokens 截断了，正文是半句话。
      // 交给界面标出来，见 entriesFromEvents 与 assign 后的 assistant 条目。
      emit({ type: 'assistant', text: reply, mode, ms: Date.now() - t0, truncated: message.finish_reason === 'length' });
      break;
    }

    convo.push({
      role: 'assistant',
      content: message.content || '',
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.function?.name, arguments: c.function?.arguments || '{}' },
      })),
    });

    let stopForConfirm = null;
    for (const call of calls) {
      const name = call.function?.name;
      const tool = toolkit.byName.get(name);
      let args = {};
      try {
        args = typeof call.function?.arguments === 'string'
          ? JSON.parse(call.function.arguments || '{}')
          : (call.function?.arguments || {});
      } catch (err) {
        args = {};
        emit({ type: 'error', text: `工具 ${name} 的参数不是合法 JSON：${err.message}` });
      }

      emit({ type: 'tool', name, title: tool?.title || name, args, phase: 'start' });
      const out = await toolkit.call(name, args);

      // 破坏性操作：不执行，把确认请求交回给界面。停在这里等用户点头，
      // 而不是让模型自己再调一次——那样确认就成了摆设。
      if (out.needsConfirm) {
        emit({ type: 'tool', name, title: tool?.title || name, args, phase: 'done', needsConfirm: true, ok: false });
        emit({ type: 'confirm', ...out.confirm, round: rounds });
        stopForConfirm = out.confirm;
        break;
      }

      const payload = out.ok ? out.result : { 错误: out.error };
      emit({
        type: 'tool', name, title: tool?.title || name, args, phase: 'done',
        ok: out.ok, ms: out.ms, denied: !!out.denied,
        result: out.ok ? payload : undefined, error: out.ok ? undefined : out.error,
      });
      convo.push({
        role: 'tool',
        tool_call_id: call.id,
        name,
        content: JSON.stringify(payload, null, 1).slice(0, 20000),
      });
    }

    if (stopForConfirm) {
      // 停在这里等用户点头。**要把刚推进去的 assistant(tool_calls) 摘掉**——
      // 否则会话里会留下「有 tool_calls 却没有对应 tool 结果」的悬空消息，
      // 下次带着它去请求原生 function calling 的端点会被直接拒。
      // 确认之后由界面单独执行那个工具，再把结果作为新一轮的输入带回来。
      if (convo[convo.length - 1]?.role === 'assistant' && convo[convo.length - 1].tool_calls) {
        convo.pop();
      }
      return {
        reply: reply || '我需要你先确认一件事再往下做。',
        messages: convo, events, rounds, usage, mode: lastMode, protocol: lastProtocol,
        pendingConfirm: stopForConfirm,
      };
    }
  }

  if (!reply) {
    reply = rounds >= maxRounds
      ? `（已连续调用 ${maxRounds} 轮工具仍未收束，先停在这里。你可以把问题说得更具体些，或到「卦录」页直接看。）`
      : '';
  }

  return { reply, messages: convo, events, rounds, usage, mode: lastMode, protocol: lastProtocol };
}
