/**
 * 问心卦 · 对话面板（只此一处）
 * ------------------------------------------------------------
 * 对话只长在一个地方：右侧那个常驻的助手面板（见 index.html 的 .agent-panel）。
 * 以前「助手」页里也内嵌一份，两处共用同一份状态——那是重复，已经去掉。
 *
 * 三件事在这里：
 *   1. **会话**：一段会话一个 id，存在 data/chats/ 下；面板顶上可切换、新建、重命名、删除。
 *   2. **轨迹**：思考 → 工具 → 回答，逐步显示。轨迹条目由**服务端**给
 *      （`r.trace`），因为只有它握着未截断的工具结果；这里只负责画。
 *   3. **附件**：只存不解析；文本类的在发送时读出来内联进提示词。
 */

import { api, h, attr, toast } from './api.js';
import { renderMarkdown } from './md.js';

/* ============================================================
 * 一、状态（模块级，切页不丢）
 * ========================================================== */
const state = {
  /** 当前会话的轨迹条目，条目类型见下方 entryHtml */
  convo: [],
  busy: false,
  /** 上一次请求带回的权限等级，显示在面板上 */
  permission: null,
  permissionName: '',
  /** 正在请求中时，界面上先占位的「思考中」 */
  pending: false,
  /** 流式进行中的**临时**条目：服务端边跑边推，跑完由权威 trace 顶掉（见 foldEvent） */
  live: [],
  /** 当前在干什么（思考中／正在调用 cast…），显示在占位行上 */
  phase: '',
  /** 这一轮开始的时刻，用来数秒 */
  startedAt: 0,
  /** 会话列表（摘要），与当前会话 id */
  sessions: [],
  sessionId: null,
  /** 当前会话的附件清单 */
  files: [],
  /** 最近一轮返回的用量。`prompt_tokens` 用来算面板顶栏的上下文占用 */
  usage: null,
};

export const chatState = state;

export function resetChat() {
  state.convo.length = 0;
  state.live.length = 0;
  state.pending = false;
  state.phase = '';
  state.usage = null;   // 用量属于「上一次跑过的那一轮」，清屏就该一起清
}

/**
 * 工具结果落成卡片正文要用的文本。
 *
 * **两种形状都要认**：正式轨迹（`entriesFromEvents`）里 `result` 已经是「切到 4000 的 JSON
 * 字符串」，流式事件的 `result` 也被 `server/index.mjs` 的 `clipToolResult` 变成同一种字符串。
 * 早先这里无条件再 `JSON.stringify` 一次，于是**流式那一段**的工具卡显示成
 * `"{\"已入库\":…}"` 这种双重转义的乱码，跑完被正式轨迹顶掉才恢复正常——
 * 同一个结果，跑的过程中和跑完长得不一样，这是「两处实现」的典型后遗症。
 * 与 `toolCard()` 里那条判断保持同一口径：字符串就直接用，对象才序列化。
 */
const asBodyText = (v) => (v === undefined ? undefined : (typeof v === 'string' ? v : JSON.stringify(v)));

/**
 * 把服务端推来的一条事件折进「流式临时条目」。
 *
 * 形状刻意与 `agent/loop.mjs` 的 `entriesFromEvents()` 一一对应：
 * 思考 → `thinking`、工具 → `tool`（start 先占一格「调用中」，done 就地补上结果）、
 * 回答 → `assistant`。这样跑完用权威 trace 顶掉临时条目时，画面是连续的，不闪。
 */
export function foldEvent(ev) {
  if (!ev || typeof ev !== 'object') return;
  if (ev.type === 'round') { state.phase = `第 ${ev.n} 轮`; return; }
  if (ev.type === 'thinking') {
    state.phase = ev.kind === 'reason' ? '正在思考…' : '正在说明…';
    state.live.push({ role: 'thinking', kind: ev.kind || 'remark', content: ev.text, ms: ev.ms, round: ev.round });
    return;
  }
  if (ev.type === 'tool' && ev.phase === 'start') {
    state.phase = `正在调用 ${ev.title || ev.name}…`;
    state.live.push({ role: 'tool', name: ev.name, title: ev.title, args: ev.args, ms: 0, ok: true, result: '', running: true });
    return;
  }
  if (ev.type === 'tool' && ev.phase === 'done') {
    // 就地补上结果：把最后一条同名且还在跑的卡片换掉（待确认的那张不换，它有单独的卡）
    for (let k = state.live.length - 1; k >= 0; k -= 1) {
      const m = state.live[k];
      if (m.role === 'tool' && m.running && m.name === ev.name) {
        if (ev.needsConfirm) state.live.splice(k, 1);
        else {
          state.live[k] = {
            role: 'tool', name: ev.name, title: ev.title, args: ev.args,
            ok: ev.ok, ms: ev.ms, denied: !!ev.denied,
            result: asBodyText(ev.result),
            error: ev.error,
          };
        }
        break;
      }
    }
    state.phase = '正在想下一步…';
    return;
  }
  if (ev.type === 'confirm') { state.live.push({ role: 'confirm', ...ev.confirm }); state.phase = '等你确认'; return; }
  if (ev.type === 'assistant') {
    state.phase = '正在收尾…';
    state.live.push({ role: 'assistant', content: ev.text, truncated: ev.truncated || undefined });
    return;
  }
  if (ev.type === 'error') { state.live.push({ role: 'tool', name: '内部', ok: false, ms: 0, error: ev.text }); return; }
}

/**
 * 把 NDJSON 的字节流切成一行行 JSON（导出来是为了能在自检里单独测「分片切断」）。
 * @returns {{lines: any[], rest: string}} rest 是还没收到换行的那半行，留到下一块
 */
export function splitNdjson(buffer, chunk) {
  const text = `${buffer}${chunk}`;
  const parts = text.split('\n');
  const rest = parts.pop() ?? '';
  const lines = [];
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    try { lines.push(JSON.parse(s)); } catch { /* 半行/坏行跳过，宁可少画一条也不整轮崩 */ }
  }
  return { lines, rest };
}

/* ============================================================
 * 二、会话
 * ------------------------------------------------------------
 * 服务端不推断内容，它只管存；这一段负责「切换 / 新建 / 改名 / 删除」。
 * ========================================================== */

export async function loadSessions() {
  const r = await api.get('/api/chats');
  state.sessions = r.chats || [];
  return state.sessions;
}

export async function openSession(id) {
  const r = await api.get(`/api/chats/${encodeURIComponent(id)}`);
  state.sessionId = r.chat.id;
  state.convo = [...(r.chat.trace || [])];
  state.live = [];   // 上一段会话的流式残留不能跟着串台
  state.files = r.chat.files || [];
  state.permission = r.chat.permission || state.permission;
  /* 用量同理不能串台：不清掉的话，换到另一段会话后顶栏还挂着上一段的上下文占比
     （用户会在新会话里看到「怎么还是 3%」）。清空后顶栏显示「—」，跑完下一轮就有了。 */
  state.usage = null;
  return r.chat;
}

export async function newSession() {
  const r = await api.post('/api/chats', {});
  state.sessionId = r.chat.id;
  state.convo = [];
  state.live = [];
  state.files = [];
  state.usage = null;
  await loadSessions();
  return r.chat;
}

export async function renameSession(id, title) {
  const r = await api.patch(`/api/chats/${encodeURIComponent(id)}`, { title });
  await loadSessions();
  return r.chat;
}

export async function deleteSession(id) {
  const r = await api.del(`/api/chats/${encodeURIComponent(id)}`);
  if (state.sessionId === id) {
    state.sessionId = null;
    state.convo = [];
    state.files = [];
    state.usage = null;
  }
  await loadSessions();
  return r;
}

/** 保证有一段当前会话：没有就新建一段，免得用户第一句话落不到任何地方 */
export async function ensureSession() {
  await loadSessions();
  if (state.sessionId && state.sessions.some((s) => s.id === state.sessionId)) return state.sessionId;
  if (state.sessions.length) {
    await openSession(state.sessions[0].id);
    return state.sessionId;
  }
  await newSession();
  return state.sessionId;
}

/* ============================================================
 * 三、附件
 * ------------------------------------------------------------
 * 只存不解析：二进制不碰，文本类的在发送时读出来内联进提示词。
 * 上限由服务端把关（server/chatStore.mjs 的 MAX_FILE_BYTES）。
 * ========================================================== */

const TEXTY = /\.(txt|md|markdown|json|csv|tsv|log|ya?ml|ini|html?|xml)$/i;

export async function addAttachment(file) {
  const id = await ensureSession();
  const buf = await file.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  const r = await api.post(`/api/chats/${encodeURIComponent(id)}/files`, {
    name: file.name, mime: file.type || '', base64,
  });
  const chat = await api.get(`/api/chats/${encodeURIComponent(id)}`);
  state.files = chat.chat.files || [];
  return r;
}

/** 把文本类附件读出来，拼成一段附在提示词后面。取不到就跳过，不因为附件失败而挡住对话 */
async function attachmentText() {
  const parts = [];
  for (const f of state.files.slice(0, 5)) {
    if (!TEXTY.test(f.name)) continue;
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(state.sessionId)}/files/${encodeURIComponent(f.name)}`);
      if (!res.ok) continue;
      const text = (await res.text()).slice(0, 8000);
      parts.push(`【附件：${f.name}】\n${text}`);
    } catch { /* 取不到就不内联 */ }
  }
  return parts.join('\n\n');
}

/* ============================================================
 * 四、把一轮的返回并进对话
 * ------------------------------------------------------------
 * 轨迹由服务端给（`r.trace`），这里不再自己从事件流拼一遍——
 * 那样会存下被截断的半截结果，也让「怎么画」有两份实现。
 * ========================================================== */

export function absorbResult(r) {
  const out = Array.isArray(r.trace) ? [...r.trace] : [];
  // 面板顶栏的上下文占用按本轮 prompt tokens 显示（历史是发出去的那部分）。
  // 即便这一轮停在待确认，用量也已产生，照样记下来。
  if (r.usage) state.usage = r.usage;
  if (!r.pendingConfirm && r.usage?.total_tokens && !out.some((e) => e.role === 'usage')) {
    out.push({
      role: 'usage', tokens: r.usage.total_tokens, rounds: r.rounds,
      mode: r.mode, permission: r.permission,
      protocol: r.protocol, history: r.historySource,
    });
  }
  state.permission = r.permission || state.permission;
  if (r.session) {
    const i = state.sessions.findIndex((s) => s.id === r.session.id);
    if (i >= 0) state.sessions[i] = r.session;
    else state.sessions.unshift(r.session);
  }
  return out;
}

/* ============================================================
 * 五、渲染
 * ========================================================== */

/* 「模式」的三种取值说的是**这一轮有没有调工具**，不是「工具协议开没开」。
   plain 早先直接印成 plain，用户看到就以为助手被降级成纯聊天了（真发生过）。 */
/* 这一轮的历史是哪来的：存档最全（含工具结果），轨迹重塑次之（老会话），
   界面兜底最弱（只有文本，模型看不到工具返回）。写清楚是为了排障时一眼看懂。 */
const HIST_LABEL = { store: '存档', trace: '由轨迹重塑', client: '仅界面文本' };

const MODE_LABEL = {
  'native-tools': '本轮调了工具（原生）',
  'hermes-xml': '本轮调了工具（Hermes 文本）',
  'text-fence': '本轮调了工具（围栏文本）',
  plain: '本轮未调工具',
};

function fmtArgs(args) {
  if (!args || !Object.keys(args).length) return '';
  return JSON.stringify(args, null, 1);
}

function toolCard(m) {
  // 流式进行中的那张：正在跑，先占一格，跑完就地补结果（见 foldEvent）
  if (m.running) {
    return `<div class="trace-tool run">
      <div class="th" data-fold>
        <span class="badge">⚙</span>
        <b>${h(m.title || m.name)}</b>
        <span class="nm mono">${h(m.name || '')}</span>
        <span class="sp"></span>
        <span class="tone">调用中…</span>
        <span class="caret">▾</span>
      </div>
      <div class="tb">
        ${fmtArgs(m.args) ? `<div class="lbl">参数</div><pre class="code">${h(fmtArgs(m.args))}</pre>` : ''}
        <div class="lbl">结果</div>
        <pre class="code">（正在执行…）</pre>
      </div>
    </div>`;
  }
  const tone = m.needsConfirm ? 'warn' : (m.ok ? 'ok' : (m.denied ? 'warn' : 'bad'));
  const label = m.denied ? '权限不足' : (m.ok ? `${m.ms}ms` : '失败');
  const body = m.ok
    ? (typeof m.result === 'string' ? m.result : JSON.stringify(m.result, null, 1))
    : (m.error || JSON.stringify(m.result || {}, null, 1));
  return `<div class="trace-tool ${tone}">
    <div class="th" data-fold>
      <span class="badge">${m.denied ? '⊘' : (m.ok ? '⚙' : '✕')}</span>
      <b>${h(m.title || m.name)}</b>
      <span class="nm mono">${h(m.name || '')}</span>
      <span class="sp"></span>
      <span class="tone">${h(String(label))}</span>
      <span class="caret">▾</span>
    </div>
    <div class="tb">
      ${fmtArgs(m.args) ? `<div class="lbl">参数</div><pre class="code">${h(fmtArgs(m.args))}</pre>` : ''}
      <div class="lbl">${m.ok ? '结果' : '错误'}</div>
      <pre class="code">${h(String(body || '').slice(0, 4000))}</pre>
    </div>
  </div>`;
}

/** 待确认卡：**联网**与**破坏性**是两种后果，措辞与配色都不该混为一谈 */
function confirmCard(m) {
  const net = m.kind === 'network';
  return `<div class="trace-confirm ${net ? 'net' : ''}" data-tool="${attr(m.tool)}">
    <div class="ch">${net ? '⚠ 要访问外部网址' : '⚠ 需要你确认'}</div>
    <div class="cb">${h(m.summary || m.title || m.tool)}</div>
    <div class="chips">
      <button class="btn primary sm" data-act="confirm">${net ? '允 许 访 问' : '确 认 执 行'}</button>
      <button class="btn sm ghost" data-act="cancel">取 消</button>
    </div>
  </div>`;
}

function entryHtml(m) {
  if (m.role === 'user') {
    /* 用户自己打的字也走 Markdown 渲染。早先这里只做 HTML 转义（h()），
       HTML 会把换行折成一个空格——用户分五行写的整段话，屏幕上挤成一大坨，
       换行、列表、加粗全没了。renderMarkdown 本身会转义，不会漏出标签。 */
    return `<div class="msg user">${renderMarkdown(m.content)}</div>`;
  }
  if (m.role === 'thinking') {
    // 思维链与「调工具前的交代」分两种名头：前者是模型的推理过程，后者是它的说明。
    const isReason = m.kind === 'reason';
    return `<div class="trace-think${isReason ? ' reason' : ''}">
      <div class="th" data-fold><span class="badge">✻</span><b>${isReason ? '思考' : '说明'}</b>
        <span class="nm">${m.ms ? `${(m.ms / 1000).toFixed(1)}s` : ''}</span>
        <span class="sp"></span><span class="caret">▾</span></div>
      <div class="tb"><div class="tx">${renderMarkdown(m.content)}</div></div>
    </div>`;
  }
  if (m.role === 'tool') return toolCard(m);
  if (m.role === 'confirm') return confirmCard(m);
  if (m.role === 'usage') {
    return `<div class="trace-usage">共 ${m.tokens} tokens · ${m.rounds} 轮 · <span class="mono">${h(MODE_LABEL[m.mode] || m.mode || '')}</span>${
      m.protocol ? ` · 协议 ${h(m.protocol)}` : ''}${
      m.history ? ` · 历史 ${h(HIST_LABEL[m.history] || m.history)}` : ''}${
      m.permission ? ` · 权限 ${h(m.permission)}` : ''}</div>`;
  }
  // 被服务商按 max_tokens 截断：正文是半句话，必须明说，否则用户只会觉得程序坏了。
  const cut = m.truncated
    ? `<div class="cut-note">⚠ 这一轮被服务商的 max_tokens 截断了，上面的话是半截。
       到「助手」页把「单次回复上限」调大，或置 0 交给服务商默认，再问一次。</div>`
    : '';
  // 模型回了空正文：不能就这么留白（用户会以为界面坏了）。三种常见原因直接说清。
  const text = String(m.content || '').trim();
  if (!text) {
    return `<div class="msg empty-reply">（这一轮没有正文）常见三种原因：模型名写错、密钥／额度有问题；
      或这一轮它只出了思维链、一个字没写（把「单次回复上限」调大或置 0 常有帮助）。
      到「助手」页核对模型名（DeepSeek 的官方名是 <span class="mono">deepseek-chat</span>）与上限，再点一次「测连通」。</div>${cut}`;
  }
  return `<div class="msg ai">${renderMarkdown(text)}</div>${cut}`;
}

export function convoHtml() {
  // 空态只在「真的一条都没有」时出现：流式跑起来时 convo 里至少已有本轮那句用户消息
  if (!state.convo.length && !state.live.length) {
    return `<div class="empty"><div class="big">☯</div>
      试试问它：<br><span class="small">「我 82 报数，2026-09-28 03:12，兰州。考研这条路该怎么走？」<br>
      「我最近这一段的卦气走势如何？」<br>「把这个链接里的内容读一下：https://…」</span></div>`;
  }
  // 占位行：既说「在干什么」，也数着秒——干等一行字最让人怀疑程序死了
  const row = state.pending
    ? `<div class="trace-think pending"><div class="th"><span class="badge">✻</span>
         <b data-chat-phase>${h(state.phase || '思考中…')}</b>
         <span class="sp"></span><span class="nm" data-chat-elapsed></span></div></div>`
    : '';
  return state.convo.map(entryHtml).join('')
    + state.live.map(entryHtml).join('')
    + row;
}

/* ============================================================
 * 六·A、面板顶栏的两枚常驻 chip：上下文占用 / 厂商余额
 * ------------------------------------------------------------
 * 为什么常驻在顶栏：这两件事回答的是「这一轮还发得出去吗」「这个月还有没有钱」，
 * 是**发消息之前**就要看的信息——藏进设置页等于每次多点两下。
 * 这里只负责画 HTML（可单测），点击行为（刷新、开控制台）由外壳 app.js 绑。
 * ========================================================== */

/** 外壳注入的两样东西：生效的上下文窗口、最近一次余额查询结果 */
const panelWire = { contextWindow: 0, balance: null };
export function setPanelWire(patch = {}) { Object.assign(panelWire, patch); }
export function getPanelWire() { return panelWire; }

/** 12345 → 12.3k，1000000 → 1M；0/非数 → 空串（显示成「—」由调用方决定） */
const fmtNum = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v >= 1000000) return `${(v / 1000000).toFixed(v % 1000000 ? 1 : 0)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k`;
  return String(Math.round(v));
};

/**
 * 上下文占用 chip。
 *
 * **主显绝对量、副显占比**，这是被用户当场问出来的取舍：窗口是 1M，一轮只涨一两千 token，
 * 取整的百分比会连着好几轮都停在「3%」——看着像"卡住了"，其实是刻度太粗。
 * 所以拿**绝对量**（每轮都在变）当主显，占比放副显（<10% 保留一位小数）并驱动配色；
 * 完整的「占多少 / 窗口多大」进 title。
 *
 * 用量取 `contextTokens`（服务端给的**最后一轮** prompt tokens）优先，退回 `prompt_tokens`：
 * 后者是**一请求内逐轮累加**的和（多轮工具调用时会虚高），不能当"当前上下文占用"用。
 */
export function contextChipHtml() {
  const used = Number(state.usage?.contextTokens ?? state.usage?.prompt_tokens) || 0;
  const win = Number(panelWire.contextWindow) || 0;
  const pct = win && used ? (used / win) * 100 : 0;
  const pctTxt = win && used ? `${pct < 10 ? pct.toFixed(1) : String(Math.round(pct))}%` : '';
  const tone = pct > 95 ? ' bad' : (pct > 80 ? ' warn' : '');
  const note = pct > 80 ? '　该开新会话了。' : '';
  /* 占比 ≥10% 才进 chip 正文：面板顶栏那一排本来就挤（会话下拉 + 四个按钮 + 两枚 chip），
     而 1M 窗口下小占比长时间是个位数，挤进去只会把「收起」顶出去。 */
  const pctInline = pct >= 10 ? `${String(Math.round(pct))}%` : '';
  const title = used
    ? `上下文 ${used} tokens${win ? ` / 窗口 ${fmtNum(win)}` : ''}`
      + `${pctTxt ? `（占 ${pctTxt}）` : '（窗口未知，不显示占比）'}。${note}`
    : '这一段还没跑过一轮，暂不知道上下文占用。';
  return `<button class="ap-chip${tone}" id="ap-ctx-chip" type="button" title="${attr(title)}">
    <span class="ap-chip-k">上下文</span>◔ ${used ? fmtNum(used) : '—'}${pctInline ? ` <span class="ap-chip-k">${pctInline}</span>` : ''}</button>`;
}

/** 厂商余额 chip：不支持余额接口的厂商显示「余额 —」，点击去控制台 */
export function balanceChipHtml() {
  const b = panelWire.balance;
  if (!b) {
    return `<button class="ap-chip" id="ap-bal-chip" type="button" title="点一下查询厂商余额">
      <span class="ap-chip-k">余额</span>…</button>`;
  }
  if (!b.ok) {
    return `<button class="ap-chip bad" id="ap-bal-chip" type="button"
      title="${attr(`余额查询失败：${b.error || '未知原因'}（点一下重试）`)}">
      <span class="ap-chip-k">余额</span>?</button>`;
  }
  if (!b.supported) {
    return `<button class="ap-chip" id="ap-bal-chip" type="button"
      title="${attr(`${b.hint || '该厂商不提供余额接口'}${b.console ? `：${b.console}` : ''}`)}">
      <span class="ap-chip-k">余额</span>—</button>`;
  }
  const sym = b.currency === 'USD' ? '$' : (b.currency === 'CNY' || !b.currency ? '¥' : `${b.currency} `);
  const amount = `${sym}${b.total ?? ''}`;
  const when = b.at ? new Date(b.at).toLocaleString('zh-CN') : '';
  const title = `赠金 ${sym}${b.granted ?? '—'} · 充值 ${sym}${b.toppedUp ?? '—'} · 合计 ${amount}`
    + `${b.isAvailable ? '' : '（账户余额不可用）'} · 查询于 ${when}`;
  return `<button class="ap-chip${b.isAvailable ? '' : ' warn'}" id="ap-bal-chip" type="button" title="${attr(title)}">
    <span class="ap-chip-k">余额</span>${h(amount)}</button>`;
}

/* ============================================================
 * 六、面板
 * ========================================================== */

/**
 * @param {object} p
 * @param {() => void} [p.onChanged] 对话有更新时的回调（外壳用来滚到底、刷会话下拉）
 * @returns {{html:Function, bind:Function, send:Function, repaint:Function}}
 */
export function createChatPanel({ onChanged } = {}) {
  let root = null;
  /** 思维链默认折叠（面板密度靠它撑着）：这个开关一键铺开/收起全部「思考」 */
  let thinkOpen = false;

  /** 把「展开全部思考」的状态刷到当前这批条目上，并同步按钮文案 */
  const applyThinkOpen = (log) => {
    log?.querySelectorAll('.trace-think').forEach((n) => n.classList.toggle('open', thinkOpen));
    // 正在跑的时候，**把最新那条思考自动摊开**：让人看得见它在想什么；
    // 一轮跑完就回到默认（折叠），不会把一屏都占满
    if (state.busy) {
      const all = log?.querySelectorAll('.trace-think:not(.pending)');
      all?.[all.length - 1]?.classList.add('open');
    }
    const btn = root?.querySelector('[data-chat-think]');
    if (btn) btn.textContent = thinkOpen ? '收起全部思考' : '展开全部思考';
  };

  /** 占位行上的秒表：只改那一处的文字，不整块重画（重画会打断滚动与动画） */
  let tick = null;
  const stopTick = () => { if (tick) { clearInterval(tick); tick = null; } };
  const startTick = () => {
    stopTick();
    const paint = () => {
      const el = root?.querySelector('[data-chat-elapsed]');
      if (!el) return;
      const s = Math.max(0, (Date.now() - state.startedAt) / 1000);
      el.textContent = s < 60 ? `${s.toFixed(0)}s` : `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
    };
    paint();
    tick = setInterval(paint, 500);
  };

  const repaint = () => {
    const log = root?.querySelector('[data-chat-log]');
    if (log) {
      log.innerHTML = convoHtml();
      applyThinkOpen(log);
      log.scrollTop = log.scrollHeight;
    }
    if (state.busy) startTick(); else stopTick();
    const badge = root?.querySelector('[data-chat-status]');
    if (badge) {
      badge.textContent = state.busy ? (state.phase || '思考中…') : (state.permissionName ? `权限 ${state.permissionName}` : '');
    }
    const files = root?.querySelector('[data-chat-files]');
    if (files) {
      files.innerHTML = state.files.length
        ? state.files.map((f) => `<span class="f" title="${attr(f.name)}">📎 ${h(f.name)}</span>`).join('')
        : '';
      files.style.display = state.files.length ? '' : 'none';
    }
    const input = root?.querySelector('[data-chat-input]');
    if (input && state.busy) input.setAttribute('disabled', 'disabled');
    else if (input) input.removeAttribute('disabled');
    onChanged?.();
  };

  function html() {
    return `<div class="chatpanel">
      <div class="cp-head">
        <span class="dim small" data-chat-status></span>
        <span class="sp" style="flex:1"></span>
        <button class="btn sm ghost" data-chat-think title="思维链默认折叠；这里一键铺开或收起，方便回看推理过程">展开全部思考</button>
        <button class="btn sm ghost" data-chat-clear>清 空显示</button>
      </div>
      <div class="chat-log" data-chat-log></div>
      <div class="cp-input">
        <div class="ap-files" data-chat-files style="display:none"></div>
        <textarea data-chat-input placeholder="说点什么…（Ctrl/⌘ + Enter 发送）"></textarea>
        <div class="chips">
          <button class="btn primary sm" data-chat-send>发 送</button>
          <span class="dim tiny" style="align-self:center">模型会自己调工具，过程会一步步显示在上面。</span>
        </div>
      </div>
    </div>`;
  }

  /**
   * 发一轮对话，**流式**接服务端推来的事件（NDJSON，一行一个 JSON）。
   *
   * 为什么不用 api.post：它等整个响应体读完才 resolve，那样「过程」还是看不见。
   * 这里用浏览器原生的 fetch + ReadableStream 逐块读，`onProgress` 每来一块就重画一次。
   * 服务端若因为任何原因回的不是 NDJSON（老服务、代理改写了响应），就退回整包解析，
   * 行为与从前一致——流式只是把过程提前显示，不是新的一条数据通路。
   *
   * @returns {Promise<object>} 与服务端 `done` 那行同形（含 trace / usage / session…）
   */
  async function streamChat(body, onProgress) {
    const res = await fetch('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const type = res.headers.get('Content-Type') || '';
    if (!res.ok || !type.includes('ndjson')) {
      const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder('utf-8');
    let buf = '';
    let done = null;
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      const { lines, rest } = splitNdjson(buf, dec.decode(value, { stream: true }));
      buf = rest;
      for (const line of lines) {
        if (line.type === 'event') { foldEvent(line.event); onProgress?.(); }
        else if (line.type === 'done') { done = line; }
        else if (line.type === 'error') { throw new Error(line.error || '助手这一轮出错了'); }
      }
    }
    if (!done) throw new Error('连接中断：这一轮没有跑完');
    return done;
  }

  async function send(prefill) {
    const input = root?.querySelector('[data-chat-input]');
    const text = String(prefill ?? input?.value ?? '').trim();
    if (!text || state.busy) return;
    state.busy = true;
    if (input && prefill === undefined) input.value = '';
    try {
      await ensureSession();
    } catch (err) {
      state.busy = false;
      toast(`打不开会话：${err.message}`);
      return;
    }

    // 附件只进提示词、不进气泡：界面保持干净，存档里留着完整内容
    const extra = await attachmentText();
    const shown = text;
    const sent = extra ? `${text}\n\n${extra}` : text;

    state.convo.push({ role: 'user', content: shown });
    state.pending = true;
    state.live = [];
    state.phase = '正在唤醒…';
    state.startedAt = Date.now();
    repaint();

    // 这一轮归属哪一段会话。跑的过程中用户随时可以换会话（下拉就长在面板头上、
    // 没有锁），所以收尾时**必须**按这个 id 认领，见下面两处 `state.sessionId !== sid`。
    const sid = state.sessionId;

    try {
      /* 历史**以服务端存档为准**（`messages` 含成对的 tool_calls 与工具结果），这里送的
         只是**兜底**：存档不可回推的老会话（早先的增量里没有用户那一轮）才会用到它。
         为什么不能让这份兜底挑大梁：界面手里只有展示用的 trace，里面没有工具返回——
         拿它当历史，模型下一轮就看不到自己算过的卦、查过的爻辞，只能凭记忆复述，
         复述错了就变成「编卦象」（真发生过）。所以：能回推就用存档，不能才用这份。 */
      const fallback = state.convo
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m) => ({ role: m.role, content: m.content }));
      if (fallback.length) fallback[fallback.length - 1] = { role: 'user', content: sent };
      const body = {
        messages: fallback.length ? fallback : [{ role: 'user', content: sent }],
        sessionId: state.sessionId,
        stream: true,
      };
      const r = await streamChat(body, () => repaint());
      state.pending = false;
      state.live = [];
      state.phase = '';
      state.permissionName = r.permission ? (state.permissionName || r.permission) : state.permissionName;
      if (r.permission) {
        const meta = await api.get('/api/meta').catch(() => null);
        state.permissionName = meta?.agent?.permissionName || state.permissionName;
      }
      /* 跑到一半用户换了会话：这一轮的轨迹属于 `sid`（存档服务端已写进那一段），
         不能画到眼前这一段身上——否则新会话的对话流里会冒出一段别人家的思考与工具卡，
         看着就是「串台」。这里只把当前会话的显示恢复成它自己的存档，本轮的卡片不呈现。 */
      if (state.sessionId !== sid) {
        await openSession(state.sessionId).catch(() => null);
        return;
      }
      // 服务端给的 trace 里**含用户那一轮**（回看历史时要有它），可界面上刚刚已经
      // 乐观回显过一条了——照单全收就会把同一句话显示两遍。所以吸收时只取模型侧条目：
      // 用户消息的去处是上面那次 push（存档里仍有完整的一份，来自 trace）。
      state.convo.push(...absorbResult(r).filter((e) => e.role !== 'user'));
    } catch (err) {
      // 断了也把已经跑到的那些卡留在屏幕上——「跑到哪一步断的」本身就是线索。
      // 它们在下一轮 send() 或换会话时会被清掉（那些地方都会重置 state.live）。
      state.pending = false;
      state.phase = '';
      // 换过会话就别把这条报错塞进别人的对话流；报错仍是这一轮的事，切回去看不到它，
      // 但「串台」比「少一条报错」更糟（少报错重问一次即可，串台会让人以为是新会话在报错）。
      if (state.sessionId === sid) {
        state.convo.push({ role: 'assistant', content: `**出错**：${err.message}` });
      }
    } finally {
      state.busy = false;
      repaint();
    }
  }

  /** 用户点了「确认执行」：先真正执行那个工具，再把结果喂回模型继续 */
  async function doConfirm(card, approve) {
    const tool = card.dataset.tool;
    const entry = state.convo.find((m) => m.role === 'confirm' && m.tool === tool);
    if (!entry) return;
    state.convo = state.convo.filter((m) => m !== entry);

    if (!approve) {
      const note = { role: 'assistant', content: '（已取消，没有执行。）' };
      state.convo.push(note);
      repaint();
      await appendTrace([note]).catch(() => {});
      return;
    }

    state.busy = true;
    state.pending = true;
    repaint();
    try {
      // confirm: true 是放行标记；删除类工具只会软删，联网工具另有 SSRF 守卫，所以这一步可回退
      const r = await api.post(`/api/agent/tool/${encodeURIComponent(tool)}`, {
        arguments: { ...(entry.args || {}), confirm: true },
      });
      const card2 = {
        role: 'tool', name: tool, title: entry.title, args: entry.args,
        ok: true, ms: r.ms || 0, result: JSON.stringify(r.result || '').slice(0, 4000),
      };
      state.convo.push(card2);
      // 这一条也要进存档，否则「确认过什么」在历史里查不到
      await appendTrace([card2]).catch(() => {});
      state.pending = false;
      repaint();
      // 把执行结果作为新一轮的输入交回模型，让它接着说。
      // 这一句必须真的**发出去**：早先写成 send('')，而 send() 见到空文本直接 return，
      // 于是「确认之后」这一步从来没真正续上过——模型停在那里等，用户以为它坏了。
      const cont = `（用户已确认执行 ${tool}，结果：${JSON.stringify(r.result).slice(0, 600)}。请据此继续。）`;
      await send(cont);
      state.convo = state.convo.filter((m) => !(m.role === 'user' && m.content === cont));
    } catch (err) {
      state.pending = false;
      state.convo.push({ role: 'assistant', content: `**执行失败**：${err.message}` });
      repaint();
    } finally {
      state.busy = false;
      repaint();
    }
  }

  /** 把若干条展示条目补进当前会话存档 */
  async function appendTrace(entries) {
    if (!state.sessionId || !entries.length) return null;
    const r = await api.post(`/api/chats/${encodeURIComponent(state.sessionId)}/append`, { trace: entries });
    return r.chat;
  }

  function bind(node) {
    root = node;
    root.querySelector('[data-chat-send]')?.addEventListener('click', () => send());
    root.querySelector('[data-chat-think]')?.addEventListener('click', () => {
      thinkOpen = !thinkOpen;
      applyThinkOpen(root.querySelector('[data-chat-log]'));
    });
    root.querySelector('[data-chat-clear]')?.addEventListener('click', () => {
      // 「清空显示」只清这一屏，不删存档里的会话——删会话是面板头上那个 ✕ 的事
      resetChat();
      repaint();
      toast('已清空显示；这段会话仍存在会话列表里');
    });
    const input = root.querySelector('[data-chat-input]');
    input?.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send(); }
    });

    root.addEventListener('click', (e) => {
      const fold = e.target.closest('[data-fold]');
      if (fold && !e.target.closest('button')) {
        fold.parentElement.classList.toggle('open');
        return;
      }
      const act = e.target.closest('[data-act]');
      if (act) {
        const card = act.closest('.trace-confirm');
        doConfirm(card, act.dataset.act === 'confirm');
      }
    });

    repaint();
  }

  return { html, bind, send, repaint, get root() { return root; } };
}
