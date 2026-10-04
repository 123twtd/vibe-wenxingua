/**
 * 问心卦 · 应用外壳与路由
 * ------------------------------------------------------------
 * 信息组织原则（对齐 DeepSeek Harness 那一档的密度）：
 *   · 侧栏常驻**六个主项**，永远不出现滚动条；
 *   · 侧栏底部的「插件」组单列插件管理与各插件页面，**组内自己滚**
 *     ——插件页面是用户数据，装一个多一个，数量不由我们定；
 *   · 其余入口（文档、卦典、设置、各种一次性操作）走
 *     **命令面板**（Ctrl/⌘K，或按「/」）与侧栏底部的「更多」浮层；
 *   · 当前打开的侧栏外页面在侧栏补一格「临」时项，切走即撤；
 *   · 每一页自己的筛选与操作放在**页内工具栏**，不往侧栏塞；
 *   · 全局的散信息压进**底部状态栏**一行。
 */

import { api, h, attr, toast, modal } from './api.js';
import {
  dashboard, records, recordDetail, castDesk, importDesk,
  dian, dianDetail, pluginsView, pluginPage,
  trendView, agentView, settingsView, docsView,
} from './views.js';
import { createPalette } from './palette.js';
import {
  createChatPanel, chatState, ensureSession, openSession, newSession,
  renameSession, deleteSession, addAttachment, loadSessions,
  setPanelWire, contextChipHtml, balanceChipHtml,
} from './chatpanel.js';

/** 侧栏可见的主项 */
const NAV = [
  { path: '#/', label: '总 览', icon: '☰', view: dashboard, hint: '统计、最近卦录、谶语' },
  { path: '#/records', label: '卦 录', icon: '䷀', view: records, hint: '全部卦录，可筛可搜' },
  { path: '#/trend', label: '走 势', icon: '◪', view: trendView, hint: '多领域叠加的时间线' },
  { path: '#/cast', label: '起 卦', icon: '☯', view: castDesk, hint: '报数择时，即时出卦与断语' },
  { path: '#/import', label: '导 入', icon: '⇩', view: importDesk, hint: '粘贴文本或卦条' },
  { path: '#/agent', label: '助 手', icon: '✦', view: agentView, hint: '会调工具的 AI 助手' },
];

/** 不占侧栏常驻位、也不进插件组的入口：走命令面板与「更多」 */
const OFF_NAV = [
  { path: '#/docs', label: '文 档', icon: '☰', view: docsView, hint: '使用说明、文档索引与设计文档' },
  { path: '#/dian', label: '卦 典', icon: '䷁', view: dian, hint: '六十四卦全表' },
  { path: '#/settings', label: '设 置', icon: '⚙', view: settingsView, hint: '助手权限、模型、数据目录' },
];

let META = null;
let palette = null;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const seg = raw.split('/').filter(Boolean);
  if (!seg.length) return { name: 'dashboard', params: {} };
  const [a, b, c] = seg;
  if (a === 'records') return { name: 'records', params: {} };
  if (a === 'record') return { name: 'record', params: { id: decodeURIComponent(b || '') } };
  if (a === 'trend') return { name: 'trend', params: {} };
  if (a === 'cast') return { name: 'cast', params: {} };
  if (a === 'import') return { name: 'import', params: {} };
  if (a === 'agent') return { name: 'agent', params: {} };
  // #/spec 是旧地址：规范并进「导入」页之后撤销了这一页。
  // 桌面菜单、书签与旧文档里可能还指着它，这里只做一次转发，不再留两个入口。
  if (a === 'spec') return { name: 'import', params: {} };
  if (a === 'docs') return { name: 'docs', params: { doc: b ? decodeURIComponent(b) : '' } };
  // #/settings/help/<id> 是旧地址：桌面菜单与书签都可能还指着它。
  // 文档已经搬到独立的「文档」页，这里只做一次转发，不给两处入口。
  if (a === 'settings') return b === 'help' && c
    ? { name: 'docs', params: { doc: decodeURIComponent(c) } }
    : { name: 'settings', params: {} };
  if (a === 'dian') return b ? { name: 'dianDetail', params: { id: decodeURIComponent(b) } } : { name: 'dian', params: {} };
  if (a === 'plugins') return { name: 'plugins', params: {} };
  if (a === 'plugin') return { name: 'pluginPage', params: { pid: b, pageId: c } };
  return { name: 'dashboard', params: {} };
}

const VIEWS = {
  dashboard, records, record: recordDetail, cast: castDesk, import: importDesk,
  dian, dianDetail, plugins: pluginsView, pluginPage,
  trend: trendView, agent: agentView, settings: settingsView, docs: docsView,
};

const ctx = {
  params: {},
  meta: null,
  navigate(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  },
  reload() { render(); },
  /** 视图改了「会写进 meta 的事实」（插件启停/热载）之后调它，见下方说明 */
  refreshMeta,
};

/**
 * 重取 meta，并重画**靠 meta 才能画出来**的那几处：侧栏六项与插件组、更多浮层、
 * 侧栏底部计数、状态栏、抽屉脚注。
 *
 * 为什么必须有这个：这些地方只在 boot() 里画一次，而 `reload()` 只重渲染主区。
 * 插件停用之后，它的页面已经不在 /api/meta 里了，可侧栏插件组里还挂着那一项
 * ——点进去才 404。顺手一起重画，入口就不会赖着不走。
 */
async function refreshMeta() {
  try {
    META = await api.get('/api/meta');
  } catch {
    return;   // 取不到就维持现状，总比重画成空白强
  }
  META.nav = [...NAV, ...OFF_NAV].map(({ path, label, icon, hint }) => ({ path, label, icon, hint }));
  META.askAssistant = askAssistant;
  paintNav();
  await paintFoot();
  paintStatus();
  paintPanelFoot();
  // 上下文窗口从 /api/meta 来（生效值：配置优先、否则模型预设），前端不另抄一份
  setPanelWire({ contextWindow: META.agent?.contextWindow || 0 });
  paintPanelChips();
}

/** 记录最近一次渲染的 HTML，供自检脚本核对（浏览器里无关紧要） */
const state = { lastHtml: '' };

/** 最近一次渲染的路由名——侧栏的「临时项」靠它判断当前页是不是侧栏外页面 */
let CURRENT_NAME = 'dashboard';

/** 详情类路由归到它所属的侧栏外入口（侧栏临时项按这个找图标与名字） */
const TEMP_ALIAS = { dianDetail: '#/dian' };

/**
 * 当前页若**不在常驻侧栏里**，就给它一个临时项。
 *
 * 为什么要有：从命令面板钻进「文档」「设置」「卦典」之后，侧栏一片安静，
 * 看不出自己在哪，也没有回去的路。临时项补上这一格，切走即消失——
 * 它不占常驻位，也就不会把「六项永不滚动」这条前提撑破。
 *
 * 插件页面不走这条：它们在侧栏底部的插件组里**本来就有自己的一格**，
 * 再补一个「临」项就成了同一页两处入口。
 */
function tempNavEntry() {
  const path = TEMP_ALIAS[CURRENT_NAME]
    || OFF_NAV.find((n) => n.view === VIEWS[CURRENT_NAME])?.path;
  const entry = path ? OFF_NAV.find((n) => n.path === path) : null;
  return entry ? { path: entry.path, label: entry.label, icon: entry.icon } : null;
}

/** 当前路由对应的侧栏高亮键 */
function activeKey(name) {
  if (name === 'record') return '#/records';
  if (name === 'dianDetail') return '#/dian';
  if (name === 'pluginPage') return '#/plugins';
  return location.hash || '#/';
}

async function render() {
  const { name, params } = parseHash();
  const view = VIEWS[name] || dashboard;
  const main = document.getElementById('main');
  ctx.params = params;
  ctx.meta = META;
  CURRENT_NAME = name;

  const key = activeKey(name);
  // 临时项要跟着当前页走，所以每换一页重画一次侧栏
  paintNav();
  document.querySelectorAll('.nav a:not(.temp)').forEach((a) => a.classList.toggle('on', a.dataset.path === key));
  closeMore();
  // 面板是停靠的一栏、不是弹层，所以切页**不关它**——
  // 主区换页、对话留着，这才是 IDE 里 agent 面板该有的样子。

  main.innerHTML = '<div class="empty"><div class="big">☯</div>载入中…</div>';
  try {
    const out = await view.render(ctx);
    // desc 可以是字符串，也可以是 (ctx) => string | Promise<string>，便于按当前条目写副标题
    const descRaw = typeof view.desc === 'function' ? await view.desc(ctx) : view.desc;
    const desc = h(descRaw || '');
    const wrapper = `<div class="page-head"><h1>${h(view.title || '')}</h1><div class="desc">${desc}</div></div>`;
    main.innerHTML = `<div class="main-inner">${wrapper}<div class="fade" id="view-root"></div></div>`;
    const root = main.querySelector('#view-root');
    root.innerHTML = out.html || '';
    state.lastHtml = wrapper + (out.html || '');
    await out.mount?.(root);
    state.lastHtml += typeof root.innerHTML === 'string' ? root.innerHTML : '';
    document.title = `${view.title || '问心卦'} · 问心卦`;
    main.scrollTop = 0;
  } catch (err) {
    main.innerHTML = `<div class="main-inner"><div class="card err"><div class="card-title">出错了</div>
      <div>${h(err.message)}</div>
      <div class="small dim" style="margin-top:8px">若提示接口不存在，试试刷新页面；若提示数据损坏，检查 data/records/ 下的 JSON。</div></div></div>`;
    state.lastHtml = `ERROR: ${err.message}`;
  }
  paintStatus();
}

/* ============================================================
 * 侧栏、更多、顶栏、状态栏
 * ========================================================== */

/**
 * 侧栏底部的「插件」分组：插件管理 + 每个插件页面。
 *
 * 为什么单起一组、而且自带滚动容器：插件页面是**用户数据**，装一个多一个，
 * 数量不由我们定。它们若混进那六项常驻主项里，「六项一屏放得下、侧栏永不出滚动条」
 * 这条前提立刻被撑破（自检断言守着这条）。所以这一组单独滚：侧栏整体仍然不滚。
 *
 * 它必须是独立的容器（#nav-extra），而不是塞进 .nav —— `.nav a` 就是「常驻主项」
 * 的几何口径，桌面自检按它数六项、量末项底边，混进来会把那条断言打成假红。
 */
function paintPluginGroup() {
  const box = document.getElementById('nav-extra');
  if (!box) return;
  const pages = META?.plugins?.pages || [];
  const cur = CURRENT_NAME === 'pluginPage' ? `#/plugin/${ctx.params.pid}/${ctx.params.pageId}` : '';
  const rows = [
    { path: '#/plugins', icon: '◇', label: '插 件 管 理', hint: '热载 / 启停 / 写插件', on: CURRENT_NAME === 'plugins' },
    ...pages.map((p) => ({
      path: `#/plugin/${p.pluginId}/${p.id}`, icon: p.icon || '◇', label: p.label,
      hint: `来自插件 ${p.pluginId}`,
      on: cur === `#/plugin/${p.pluginId}/${p.id}`,
    })),
  ];
  box.innerHTML = `<div class="nav-sep"></div>
    <div class="nav-grp">插 件</div>
    <div class="nav-scroll">${rows.map((r) => `
      <a href="${attr(r.path)}" data-path="${attr(r.path)}" class="${r.on ? 'on' : ''}" title="${attr(r.hint)}">
        <span class="ic">${h(r.icon)}</span>${h(r.label)}</a>`).join('')}</div>`;
}

function paintNav() {
  const nav = document.getElementById('nav');
  const temp = tempNavEntry();
  nav.innerHTML = NAV.map((n) => `
    <a href="${attr(n.path)}" data-path="${attr(n.path)}" title="${attr(n.hint || '')}">
      <span class="ic">${n.icon}</span>${h(n.label)}</a>`).join('')
    + (temp ? `
    <a href="${attr(temp.path)}" class="temp on" data-path="${attr(temp.path)}"
       title="当前打开的页面——它不在常驻栏里，离开这一页就消失">
      <span class="ic">${temp.icon}</span>${h(temp.label)}<span class="tmp">临</span></a>` : '');

  paintPluginGroup();

  const hidden = document.getElementById('more-panel');
  hidden.innerHTML = `
    <div class="grp">工 具</div>
    ${OFF_NAV.map((n) => `<a href="${attr(n.path)}" title="${attr(n.hint || '')}">
      <span class="ic">${n.icon}</span>${h(n.label)}<span class="hint">${h((n.hint || '').slice(0, 8))}</span></a>`).join('')}
    <div class="grp">操 作</div>
    <button data-act="palette"><span class="ic">⌘</span>命令面板<span class="hint">Ctrl K</span></button>
    <button data-act="reload-plugins"><span class="ic">↻</span>热载插件</button>
    <button data-act="export-md"><span class="ic">↓</span>导出全部 Markdown</button>
    <button data-act="export-json"><span class="ic">↓</span>整包备份 JSON</button>
    ${window.__qxgDesktop ? `
      <button data-act="open-data"><span class="ic">📁</span>打开数据目录</button>
      <button data-act="backup-to"><span class="ic">💾</span>导出备份到…</button>` : ''}`;

  hidden.querySelectorAll('button[data-act]').forEach((b) => b.addEventListener('click', async () => {
    closeMore();
    const a = b.dataset.act;
    if (a === 'palette') palette.open();
    else if (a === 'reload-plugins') { await api.post('/api/plugins/reload'); toast('已热载'); await refreshMeta(); ctx.reload(); }
    else if (a === 'export-md') window.location.href = '/api/export?format=md';
    else if (a === 'export-json') window.location.href = '/api/export?format=json';
    else if (a === 'open-data') window.__qxgDesktop.openDataDir();
    else if (a === 'backup-to') window.__qxgDesktop.exportBackup();
  }));
}

function toggleMore() {
  const panel = document.getElementById('more-panel');
  const btn = document.getElementById('more-btn');
  const on = !panel.classList.contains('on');
  panel.classList.toggle('on', on);
  btn.classList.toggle('on', on);
}
function closeMore() {
  document.getElementById('more-panel')?.classList.remove('on');
  document.getElementById('more-btn')?.classList.remove('on');
}

/** 侧栏底部只放两行摘要，其余进状态栏 */
async function paintFoot() {
  const foot = document.getElementById('meta-line');
  const loaded = META.plugins.plugins.filter((p) => p.loaded).length;
  const warn = (META.knowledge.warnings || []).length;
  foot.innerHTML = `<span><b>${META.counts.total}</b> 卦</span><span><b>${META.knowledge.count}</b> 卦典</span>`
    + `<span><b>${loaded}</b> 插件</span>`
    + `<span class="${warn ? 'err' : 'dot'}">${warn ? '⚠ 卦典告警' : '● 本地'}</span>`;
}

/** 底部状态栏：把散信息压成一行 */
function paintStatus() {
  const el = document.getElementById('status');
  if (!el) return;
  const d = window.__qxgDesktop;
  const agent = META.agent || {};
  const items = [
    `<span class="it">卦录 <b>${META.counts.total}</b></span>`,
    `<span class="it">含校勘 <b>${META.counts.corrections}</b></span>`,
    `<span class="it">插件 <b>${META.plugins.plugins.filter((p) => p.loaded).length}</b></span>`,
    `<span class="it">工具 <b>${agent.toolCount ?? 0}</b></span>`,
    `<span class="it"><span class="dot ${agent.ready ? '' : 'off'}" style="${agent.ready ? '' : 'background:var(--text-3)'}"></span>助手 ${agent.ready ? '就绪' : '未配置'}</span>`,
    `<span class="spacer"></span>`,
    `<span class="it">结构 v${META.app.schemaVersion}　卦条 v${META.guaTiao.version}</span>`,
    `<span class="it">v${h(META.app.version)}${d ? '　桌面版' : ''}</span>`,
    `<span class="it path" title="${attr(META.app.dataDir || '')}">${h(META.app.dataDir || '')}</span>`,
  ];
  el.innerHTML = items.join('');
}

/** 顶栏健康灯：服务活着就行，顺带显示数据位置 */
async function paintHealth() {
  const box = document.getElementById('top-health');
  const txt = document.getElementById('top-health-text');
  try {
    const hh = await api.get('/api/health');
    box.className = 'hdot';
    txt.textContent = `本地 v${hh.version}`;
    box.title = `本地服务正常　${META?.app?.dataDir || ''}`;
  } catch (err) {
    box.className = 'hdot bad';
    txt.textContent = '服务离线';
    box.title = err.message;
  }
}

/** 桌面版专属：菜单跳转、桌面标记 */
function wireDesktop() {
  const d = window.__qxgDesktop;
  if (!d) return;
  d.onNavigate((hash) => { if (hash) ctx.navigate(hash); });
}

/* ============================================================
 * 助手面板
 * ------------------------------------------------------------
 * 停靠在右侧的一栏，范式取自 IDE 里的 agent 面板（Trae／Qoder／Codex）：
 * 主区永远是卦，助手是配角。它是**停靠**而不是**弹层**——打开时主区让出宽度，
 * 而且默认就是打开的（用户要的就是「随时能问」）。
 *
 * 开合与宽度都记在 localStorage：这是纯粹的界面偏好，不属于用户数据，
 * 没必要为它进 config.json、更没必要进 schema。
 * ========================================================== */
let agentPanel = null;
const LS_OPEN = 'qxg.agentPanel';
const LS_WIDTH = 'qxg.agentPanelW';
const PANEL_MIN = 300;
const PANEL_MAX = 640;
const PANEL_DEFAULT = 380;

/**
 * localStorage 的小兜底：面板偏好丢了不算事，但读不到就崩会拖垮整个界面。
 * （自检用的 DOM 桩里就没有 localStorage；隐私模式下写入也会抛。）
 */
const ls = (() => {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    localStorage.setItem('__qxg_probe__', '1');
    localStorage.removeItem('__qxg_probe__');
    return localStorage;
  } catch {
    return null;
  }
})();
const lsGet = (k) => { try { return ls ? ls.getItem(k) : null; } catch { return null; } };
const lsSet = (k, v) => { try { ls?.setItem(k, v); } catch { /* 存不了就算了 */ } };

/* 主题：**宣纸**（默认）与**夜读**，同一套设计语言、同一批令牌、两组取值（见 style.css 顶部）。
   尽早套在 <html> 上——晚了夜读用户会先闪一下白纸。按钮文案说的是"点了会变成什么"，
   与下面 wireChrome 里的切换逻辑一致。 */
const LS_THEME = 'qxg.theme';
function applyTheme(name) {
  const night = name === 'night';
  const root = document.documentElement;
  if (night) root.dataset.theme = 'night';
  else if (root.dataset) delete root.dataset.theme;
  const btn = document.getElementById('top-theme');
  if (btn) btn.textContent = night ? '宣 纸' : '夜 读';
}
applyTheme(lsGet(LS_THEME) === 'night' ? 'night' : 'paper');

function storedPanelWidth() {
  const w = Number(lsGet(LS_WIDTH));
  return Number.isFinite(w) && w >= PANEL_MIN && w <= PANEL_MAX ? w : PANEL_DEFAULT;
}

function applyPanelWidth(w) {
  const clamped = Math.max(PANEL_MIN, Math.min(PANEL_MAX, Math.round(w)));
  document.documentElement.style.setProperty('--panel-w', `${clamped}px`);
  lsSet(LS_WIDTH, String(clamped));
  return clamped;
}

function panelOpen() {
  return document.body.classList.contains('agent-open');
}

/** 面板脚注：权限、模型、可用工具数——用户得知道助手现在有多大权。
 *  跟 meta 一起变：设置页改了权限、插件启停改了工具清单，都得重画。 */
function paintPanelFoot() {
  const el = document.getElementById('ap-foot');
  if (!el) return;
  const meta = META || {};
  const sid = chatState.sessionId || '（未开）';
  el.innerHTML = `会话 <b class="mono">${h(sid)}</b>　`
    + `权限 <b>${h(meta.agent?.permissionName || '—')}</b>　`
    + `模型 <b>${h(meta.agent?.model || '未配置')}</b>　`
    + `工具 <b>${meta.agent?.allowedTools ?? 0}/${meta.agent?.toolCount ?? 0}</b>`;
}

/* 面板顶栏两枚常驻 chip：上下文占用（数据来自对话用量）+ 厂商余额（来自 /api/agent/balance）。
   余额 5 分钟自动刷一次，面板收起或页面隐藏时停表——不在后台无谓地打厂商接口。 */
let balanceState = null;
let balanceTimer = null;
const BALANCE_REFRESH_MS = 5 * 60 * 1000;

function paintPanelChips() {
  const el = document.getElementById('ap-chips');
  if (!el) return;
  el.innerHTML = contextChipHtml() + balanceChipHtml();
}

async function refreshBalance({ force = false } = {}) {
  try {
    balanceState = await api.get(`/api/agent/balance${force ? '?force=1' : ''}`);
  } catch (err) {
    balanceState = { ok: false, error: err.message };
  }
  setPanelWire({ balance: balanceState });
  paintPanelChips();
}

function stopBalanceTimer() {
  if (balanceTimer) { clearInterval(balanceTimer); balanceTimer = null; }
}

function startBalanceTimer() {
  stopBalanceTimer();
  balanceTimer = setInterval(() => {
    if (!panelOpen() || document.hidden) return;
    refreshBalance();
  }, BALANCE_REFRESH_MS);
}

/** 会话下拉：id 只显示中段（20261003**2134**-01），标题才是人认的那部分 */
function paintSessions() {
  const sel = document.getElementById('ap-sessions');
  if (!sel) return;
  const list = chatState.sessions || [];
  sel.innerHTML = list.length
    ? list.map((s) => `<option value="${attr(s.id)}"${s.id === chatState.sessionId ? ' selected' : ''}>${
      h(`${s.id.slice(8, 12)} ${s.title}`)}${s.turns ? `（${s.turns} 轮）` : ''}</option>`).join('')
    : '<option value="">（还没有会话）</option>';
}

function confirmModal(title, body, okLabel = '删 除') {
  return new Promise((resolve) => {
    modal(`<div class="card-title">${h(title)}</div>
      <div class="small" style="margin-bottom:8px">${h(body)}</div>
      <div class="chips"><button class="btn primary sm" id="cf-ok">${h(okLabel)}</button>
        <button class="btn sm ghost" id="cf-no">取 消</button></div>`, (r) => {
      r.querySelector('#cf-ok').addEventListener('click', () => { r.closest('.modal-mask').remove(); resolve(true); });
      r.querySelector('#cf-no').addEventListener('click', () => { r.closest('.modal-mask').remove(); resolve(false); });
    });
  });
}

function promptModal(title, value) {
  return new Promise((resolve) => {
    modal(`<div class="card-title">${h(title)}</div>
      <input type="text" id="pm-v" value="${attr(value || '')}" style="width:100%">
      <div class="chips" style="margin-top:10px"><button class="btn primary sm" id="pm-ok">保 存</button>
        <button class="btn sm ghost" id="pm-no">取 消</button></div>`, (r) => {
      const input = r.querySelector('#pm-v');
      input.focus();
      input.select();
      r.querySelector('#pm-ok').addEventListener('click', () => { const v = input.value; r.closest('.modal-mask').remove(); resolve(v); });
      r.querySelector('#pm-no').addEventListener('click', () => { r.closest('.modal-mask').remove(); resolve(null); });
    });
  });
}

/** 面板只建一次；它挂在 .app 之外，所以切页重绘碰不到它 */
function ensurePanel() {
  const body = document.getElementById('ap-body');
  if (!body) return null;
  if (!agentPanel) {
    agentPanel = createChatPanel({ onChanged: () => { paintPanelFoot(); paintSessions(); paintPanelChips(); } });
    body.innerHTML = agentPanel.html();
    agentPanel.bind(body);
    wirePanelHead();
  }
  return agentPanel;
}

function wirePanelHead() {
  document.getElementById('ap-close')?.addEventListener('click', () => setPanelOpen(false));
  document.getElementById('ap-open-page')?.addEventListener('click', () => ctx.navigate('#/agent'));

  // 两枚常驻 chip：上下文只作说明；余额点击即刷新，不支持的厂商则去控制台
  document.getElementById('ap-chips')?.addEventListener('click', (e) => {
    if (e.target.closest('#ap-ctx-chip')) {
      toast('上下文占用按本轮 prompt tokens 估算；窗口未知时只显示已用 token');
      return;
    }
    if (e.target.closest('#ap-bal-chip')) {
      if (balanceState && balanceState.ok === true && balanceState.supported === false) {
        if (balanceState.console) window.open(balanceState.console, '_blank', 'noopener');
        else toast('该厂商不提供余额接口，也没有已知的控制台地址');
        return;
      }
      refreshBalance({ force: true });
    }
  });

  document.getElementById('ap-sessions')?.addEventListener('change', async (e) => {
    if (!e.target.value) return;
    try {
      await openSession(e.target.value);
      ensurePanel().repaint();
    } catch (err) {
      toast(`打不开会话：${err.message}`);
    }
  });

  document.getElementById('ap-new')?.addEventListener('click', async () => {
    try {
      await newSession();
      ensurePanel().repaint();
      toast('已开一段新会话');
    } catch (err) {
      toast(`新建失败：${err.message}`);
    }
  });

  document.getElementById('ap-rename')?.addEventListener('click', async () => {
    const id = chatState.sessionId;
    if (!id) return toast('还没有会话');
    const cur = chatState.sessions.find((s) => s.id === id)?.title || '';
    const next = await promptModal('重命名这段会话', cur);
    if (next === null) return;
    await renameSession(id, next);
    paintSessions();
  });

  document.getElementById('ap-del')?.addEventListener('click', async () => {
    const id = chatState.sessionId;
    if (!id) return toast('还没有会话');
    const yes = await confirmModal('删除这段会话？', '会话文件会移入 data/trash/，不是彻底删除；要真删得去回收目录里清。');
    if (!yes) return;
    await deleteSession(id);
    await ensureSession();
    await openSession(chatState.sessionId);
    ensurePanel().repaint();
    paintSessions();
    toast('已移入回收目录');
  });

  const file = document.getElementById('ap-file');
  document.getElementById('ap-attach')?.addEventListener('click', () => file?.click());
  file?.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      await addAttachment(f);
      ensurePanel().repaint();
      toast(`已附上 ${f.name}`);
    } catch (err) {
      toast(`附件失败：${err.message}`);
    }
    file.value = '';
  });

  // 拖宽：只改 --panel-w 一个变量，主区跟着自适应
  const grip = document.getElementById('ap-resize');
  grip?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = storedPanelWidth();
    const move = (ev) => applyPanelWidth(startW + (startX - ev.clientX));
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
}

async function setPanelOpen(open, { persist = true } = {}) {
  document.body.classList.toggle('agent-open', open);
  document.getElementById('top-ai')?.classList.toggle('on', open);
  if (persist) lsSet(LS_OPEN, open ? 'open' : 'closed');
  if (!open) {
    // 收起即停余额定时器——面板看不见时不该继续打厂商接口
    stopBalanceTimer();
    return;
  }
  const p = ensurePanel();
  paintPanelFoot();
  paintPanelChips();
  // 打开时查一次余额，之后每 5 分钟自动刷一次
  refreshBalance();
  startBalanceTimer();
  try {
    // 只**载入**已有的会话，不在这里新建：一段会话应当在用户真的说了第一句话时才存在。
    // 否则每次开面板（乃至每次自检）都会在 data/chats/ 里多出一个空壳。
    await loadSessions();
    if (chatState.sessions.length) await openSession(chatState.sessions[0].id);
    else { chatState.sessionId = null; chatState.convo = []; chatState.live = []; chatState.files = []; }
    p?.repaint();
    paintSessions();
  } catch (err) {
    // 会话打不开不该让面板变成空白：把它写在脚注里，用户知道出了什么事
    const foot = document.getElementById('ap-foot');
    if (foot) foot.innerHTML = `<span class="err">会话读不出来：${h(err.message)}</span>`;
  }
}

async function togglePanel() {
  await setPanelOpen(!panelOpen());
}

/** 命令面板与起卦台的「交给助手」走这里：确保面板打开，再把话递进去 */
async function askAssistant(text) {
  await setPanelOpen(true);
  if (text) ensurePanel()?.send(text);
  else setTimeout(() => document.querySelector('[data-chat-input]')?.focus(), 60);
}

/* ============================================================
 * 启动
 * ========================================================== */

function wireChrome() {
  document.getElementById('top-search').addEventListener('click', () => palette.open());
  document.getElementById('top-cast').addEventListener('click', () => ctx.navigate('#/cast'));
  document.getElementById('top-ai').addEventListener('click', () => { togglePanel(); });
  document.getElementById('top-theme')?.addEventListener('click', () => {
    const night = document.documentElement.dataset.theme !== 'night';
    applyTheme(night ? 'night' : 'paper');
    lsSet(LS_THEME, night ? 'night' : 'paper');
  });
  document.getElementById('more-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleMore(); });
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('more-panel');
    if (!panel.classList.contains('on')) return;
    if (panel.contains(e.target) || document.getElementById('more-btn').contains(e.target)) return;
    closeMore();
  });
  window.addEventListener('keydown', (e) => {
    // Alt+1..6 直跳侧栏主项
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const i = Number(e.key) - 1;
      if (i >= 0 && i < NAV.length) { e.preventDefault(); ctx.navigate(NAV[i].path); return; }
    }
    // Ctrl/⌘ + J 随时开合助手面板
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      togglePanel();
      return;
    }
    // Esc 收面板；但焦在输入框里时不抢——正打字时按 Esc 多半是想干别的
    if (e.key === 'Escape' && panelOpen() && !e.target.matches?.('[data-chat-input]')) {
      setPanelOpen(false);
    }
  });
  window.addEventListener('blur', closeMore);
  // 页面切到后台就停余额定时器，切回来再补一次——后台页面不该继续打厂商接口
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopBalanceTimer();
    else if (panelOpen()) { refreshBalance(); startBalanceTimer(); }
  });
}

async function boot() {
  try {
    META = await api.get('/api/meta');
  } catch (err) {
    document.getElementById('main').innerHTML = `<div class="card err"><div class="card-title">无法连接本地服务</div>
      <div>${h(err.message)}</div></div>`;
    return;
  }
  palette = createPalette({ ctx, getMeta: () => META });
  // 侧栏、更多浮层、底部计数、状态栏、面板脚注都靠 meta 画；
  // 走同一个 refreshMeta，免得开机与「插件启停之后」两套画法漂移。
  await refreshMeta();
  wireChrome();
  paintHealth();
  wireDesktop();
  window.addEventListener('hashchange', () => render());
  await render();

  // 面板：宽度与开合从 localStorage 恢复；**默认开**——用户要的就是随时能问
  applyPanelWidth(storedPanelWidth());
  await setPanelOpen(lsGet(LS_OPEN) !== 'closed', { persist: false });
}

window.__qxg = {
  ctx, render, api, toast, state,
  /** 暴露导航表给自检用：侧栏主项必须少而稳，其余入口走命令面板 */
  nav: NAV,
  offNav: OFF_NAV,
  /** 助手面板：命令面板、起卦台与自检都要用它 */
  askAssistant,
  chatState,
  openPanel: () => setPanelOpen(true),
  closePanel: () => setPanelOpen(false),
  togglePanel,
  panelOpen,
  setPanelWidth: applyPanelWidth,
  /** 面板与命令面板都要用的会话操作 */
  newSession,
  openSession,
  renameSession,
  deleteSession,
  loadSessions,
  /** 插件启停/热载之后要调它，侧栏入口才会跟着 meta 一起变 */
  refreshMeta,
  get panel() { return agentPanel; },
  get palette() { return palette; },
  get meta() { return META; },
};
boot();
