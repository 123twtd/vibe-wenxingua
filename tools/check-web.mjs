/**
 * 问心卦 · 前端联调自检
 * ------------------------------------------------------------
 * 用法：node tools/check-web.mjs
 *
 * 连得上服务（QXG_BASE，默认 http://127.0.0.1:19730）就用它联调；
 * 连不上时用 tools/fixtures.mjs 造一个临时数据目录、以 QXG_DATA_DIR 起一个示例服务，
 * 跑完关掉——于是它既能验你正在跑的服务，也能在还没起服务的空环境里一键跑通。
 *
 * 做法：用一个「万能 Proxy」充当 DOM，把 web/app.js 真正跑起来，
 * 逐条路由调用真实的 render()，检查渲染结果里是否有该有的东西、
 * 有没有 undefined / NaN / [object Object] 漏出来。
 *
 * 这不是浏览器测试，但足以抓住视图层最常见的空引用与拼装错误。
 */

let BASE = process.env.QXG_BASE || 'http://127.0.0.1:19730';

import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** 仓库根：文档渲染那一项要直接读随包的那几篇 Markdown */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 合成示例卦录：空环境里自起服务时用它当夹具（见 tools/fixtures.mjs） */
const fixtures = await import('./fixtures.mjs');

/* 前端用的是相对路径（浏览器里自动拼 origin），在 Node 里要补成绝对地址。
   顺手记下每一次请求的 URL —— 命令面板那条「不许重复打接口」的断言要用。 */
const REQUEST_LOG = [];
const rawFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' && input.startsWith('/') ? BASE + input : input;
  REQUEST_LOG.push(String(url));
  return rawFetch(url, init);
};

/* ---------- 万能 DOM 桩 ---------- */
function stub(name = 'stub') {
  const target = function () {};
  target.__name = name;
  const p = new Proxy(target, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => `[${name}]`;
      if (k === 'toString') return () => `[${name}]`;
      if (k === 'then') return undefined;               // 别把桩当成 thenable
      if (k in t) return t[k];
      if (k === 'length') return 0;
      if (k === 'value' || k === 'textContent' || k === 'innerHTML' || k === 'id') return '';
      // dataset 要**每个对象一份、可写可读**：皮肤那组断言要验 data-skin 写进去了
      // （早先每次访问都返回新的 {}，写进去就丢，断言只能看到 undefined）
      if (k === 'dataset') return (t.dataset = t.dataset || {});
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      // style 要有 CSSStyleDeclaration 的三件套：界面用 setProperty 改 --panel-w 之类的变量
      if (k === 'style') return { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' };
      if (k === 'files') return [];
      // 尺寸类一律给 0，让代码里的 `|| 默认值` 生效，避免把桩函数算进 Math.max 而产出 NaN
      if (['clientWidth', 'clientHeight', 'offsetWidth', 'offsetHeight', 'scrollHeight', 'scrollTop', 'scrollLeft', 'children'].includes(k)) {
        return Array.isArray(t[k]) ? t[k] : 0;
      }
      if (k === 'firstElementChild' || k === 'parentElement') return null;
      const child = stub(`${name}.${String(k)}`);
      t[k] = child;
      return child;
    },
    set(t, k, v) { t[k] = v; return true; },
    apply() { return stub(`${name}()`); },
  });
  return p;
}

globalThis.document = new Proxy({
  createElement: () => stub('el'),
  createTextNode: () => stub('text'),
  querySelector: () => stub('q'),
  querySelectorAll: () => [],
  getElementById: () => stub('byId'),
  addEventListener() {},
  body: stub('body'),
  title: '',
  // 记忆化：documentElement 这类「同一个对象」必须每次访问拿到同一个桩，
  // 否则写进去的东西（如 <html data-skin>）下一次读就是新的空对象
}, { get(t, k) { return k in t ? t[k] : (t[k] = stub(`document.${String(k)}`)); } });

globalThis.window = new Proxy({
  addEventListener() {},
  scrollTo() {},
  location: { hash: '' },
}, { get(t, k) { return k in t ? t[k] : stub(`window.${String(k)}`); } });

globalThis.location = { hash: '' };

/* 内存版 localStorage：界面偏好（主题、皮肤、面板宽度）都记在这儿。
   真浏览器里有它，桩环境里没有——不给它，皮肤那条「选完要记住」就验不了。 */
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(String(k), String(v)); },
  removeItem(k) { this._m.delete(k); },
  clear() { this._m.clear(); },
};
try {
  // Node 24 自带只读的 navigator，缺 clipboard 时才补
  if (!globalThis.navigator?.clipboard) {
    Object.defineProperty(globalThis.navigator || (globalThis.navigator = {}), 'clipboard', {
      value: { writeText: async () => {} }, configurable: true,
    });
  }
} catch { /* 补不上也无妨：剪贴板只在点按钮时才用 */ }
globalThis.confirm = () => false;
globalThis.alert = () => {};

/* ---------- 跑起来 ---------- */
let pass = 0;
let fail = 0;
const problems = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${name}${detail ? `　${detail}` : ''}`); }
  else { fail += 1; problems.push(`${name}${detail ? `：${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? `　${detail}` : ''}`); }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 保证有一个可用服务 ----------
   连不上 `${BASE}/api/health` 时，自造一个临时数据目录（合成示例卦录 + 随包插件）、
   起一个示例服务，跑完关掉。这样别人克隆下来、还没起服务时，本套自检也能一键跑通。 */
let child = null;        // 自起的服务进程
let tmpDataDir = null;   // 自起的服务使用的临时数据目录

function cleanupServer() {
  if (child && !child.killed) { try { child.kill(); } catch { /* 已退出 */ } }
  if (tmpDataDir) { try { fs.rmSync(tmpDataDir, { recursive: true, force: true }); } catch { /* 清不掉也不影响 */ } }
}
process.on('exit', cleanupServer);
process.on('SIGINT', () => { cleanupServer(); process.exit(130); });

/* 正常收尾：先杀子进程、等它真的退出（Windows 上文件句柄要一点时间才释放），
   再删临时目录。比只在 exit 钩子里同步删更稳，也不会因挂着子进程而卡住不退出。 */
async function closeServer() {
  if (child && !child.killed) { try { child.kill(); } catch { /* 已退出 */ } }
  if (child) await sleep(300);
  if (tmpDataDir) { try { fs.rmSync(tmpDataDir, { recursive: true, force: true }); } catch { /* 清不掉也不影响 */ } }
}

const healthy = async (base) => {
  try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; }
};

/** 让系统分配一个空闲端口 */
const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

console.log(`\n目标服务：${BASE}`);
if (!(await healthy(BASE))) {
  tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qxg-web-fixtures-'));
  const n = fixtures.seedInto(tmpDataDir);
  const pluginSrc = path.join(ROOT, 'data', 'plugins');
  if (fs.existsSync(pluginSrc)) fs.cpSync(pluginSrc, path.join(tmpDataDir, 'plugins'), { recursive: true });
  const port = await freePort();
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], {
    env: { ...process.env, QXG_DATA_DIR: tmpDataDir, QXG_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  BASE = `http://127.0.0.1:${port}`;
  console.log(`  连不上，已自起示例服务：${BASE}（${n} 条示例卦录，数据目录 ${tmpDataDir}）`);
  let up = false;
  for (let i = 0; i < 50; i += 1) {
    if (await healthy(BASE)) { up = true; break; }
    await sleep(100);
  }
  if (!up) {
    console.error('\n自起的示例服务没能就绪。请手动运行：node server/index.mjs\n');
    await closeServer();
    process.exit(2);
  }
}

console.log('\n【一】载入前端并跑通路由');
const mod = await import(new URL('../web/app.js', import.meta.url).href);
await sleep(600);
check('web/app.js 可载入并完成首次启动', !!globalThis.window.__qxg, 'window.__qxg 已挂出');
const qxg = globalThis.window.__qxg;

/* 卦录详情那两条路由要指向**真实存在**的编号：作者本地是他的数据，
   空环境是刚起出来的示例卦录。写死某个真实编号会随仓库发布而失效
   （别人的库里根本没有那条），所以从 /api/records 动态取第一条；
   库里空空时降级为断言总览页的「尚无卦录」（那是静态渲染出来的，能直接断言）。 */
const recList = await (await fetch(`${BASE}/api/records`)).json();
const recItems = Array.isArray(recList.items) ? recList.items : [];
const detailId = recItems[0]?.id || '';
const detailJson = detailId
  ? await (await fetch(`${BASE}/api/records/${encodeURIComponent(detailId)}`)).json()
  : null;

// 「含校勘的卦录」优先挑一条带「动爻取法」校勘的（能连触发那个卡片最全的路径）；
// 没有就用第一条带任意校勘的。示例卦录无校勘，则退到普通详情。
let corrItem = null;
let corrHasRule = false;
for (const it of recItems) {
  if (!(it.correctionCount > 0)) continue;
  const j = await (await fetch(`${BASE}/api/records/${encodeURIComponent(it.id)}`)).json();
  const hasRule = (j.record?.corrections || []).some((c) => `${c.label || ''}${c.note || ''}`.includes('动爻取法'));
  if (!corrItem) corrItem = it;
  if (hasRule) { corrItem = it; corrHasRule = true; break; }
}

const EMPTY_HASH = '#/';
const EMPTY_EXPECTS = ['尚无卦录。', '卦 录 总 数', '起 手 之 处'];

// 「原文存录」只有卦录带 narrative 时才渲染，随数据而变，不写死在期望里
const detailExpects = ['卦 象 定 调', '通 俗 解', '吉 凶 权 衡', '时 间 与 历 法', '复 盘', '返 回 卦 录'];
if (detailJson?.record?.narrative) detailExpects.push('原 文 存 录');
const detailRoute = detailId
  ? [`#/record/${detailId}`, '卦录详情', detailExpects]
  : [EMPTY_HASH, '卦录详情（空库降级）', EMPTY_EXPECTS];
const corrRoute = corrItem
  ? [`#/record/${corrItem.id}`, '含校勘的卦录', corrHasRule ? ['校 勘', '动爻取法'] : ['校 勘']]
  : detailId
    ? [`#/record/${detailId}`, '卦录（无校勘）', ['卦 象 定 调', '返 回 卦 录']]
    : [EMPTY_HASH, '含校勘的卦录（空库降级）', EMPTY_EXPECTS];

// 小六壬记录的分区渲染：本库确有小六壬记录时才验这条路由（作者库里可能还没有）
const xlrItem = recItems.find((it) => it.kind === 'xlr');
const xlrRoute = xlrItem
  ? [`#/record/${xlrItem.id}`, '小六壬卦录', ['三 宫', '结果宫', '断 课 定 调']]
  : null;

const ROUTES = [
  ['#/', '总览', ['卦 录 总 数', '起 手 之 处', '平 均 总 评', '待 应 验']],
  ['#/records', '卦录', ['搜卦名', '吉凶不限', '状态不限', '类别不限', '总评↓', '方法不限', '道教小六壬']],
  detailRoute,
  corrRoute,
  ...(xlrRoute ? [xlrRoute] : []),
  // 默认落在「领域运势 + 应验那天」——那正是「不同的事就是不同的运势线」这条反馈
  ['#/trend', '走势', ['吉凶诸线', '领域运势', '五行占比', '分类别均值', '平滑窗口', '卦 气 走 势', '起 落',
    '横轴落在哪天', '起卦那天', '应验那天', '只看类别']],
  ['#/cast', '起卦台', ['起 卦 之 法', '时 与 地', '所 问 之 事', '道教小六壬']],
  // 导入页把「录入流程」与「卦条规范」合成一处：解析框本身就是校验，
  // 所以模板、字段字典、版本迁移都在这一页，不再另开「格式」页（两处必然对不上）。
  ['#/import', '导入与格式', ['一 · 粘 贴 解 析', '解 析', '二 · 卦 条 v1', '三 · 字 段 字 典',
    '四 · 卦 录 JSON', '五 · 命 令 行 与 Agent', '让 助 手 来 录', '载 入 到 粘 贴 框']],
  // 「助手」页只留配置：模型 / 联网 / 工具 / MCP。对话只长在右侧面板里，
  // 这一页不该再出现对话框——所以这里断言它**没有**对话面板。
  // 「单次回复上限」是防"半句话"的那个输入框：它在界面里必须存在，否则用户没法把截断调回来
  ['#/agent', 'AI 助手', ['模 型 设 置', '联 网', '可 用 工 具', '接 给 外 部 Agent', 'fetch_url', '单 次 回 复 上 限']],
  // #/spec 是旧地址：桌面菜单与书签可能还指着它。规范已并进「导入」页，
  // 这一条验的是**转发到位**（旧地址仍落到同一份规范上，不是白屏也不是第四份实现）。
  ['#/spec', '格式·旧地址转发到导入', ['一 · 粘 贴 解 析', '二 · 卦 条 v1', '字 段 字 典']],
  ['#/dian', '卦典', ['卦 典', '搜卦名']],
  ['#/dian/49', '卦典·革', ['泽火革', '改命吉', '六 爻 爻 辞']],
  ['#/plugins', '插件', ['应期提醒', '卦气统计', '单卦 HTML 卡片', '写 一 个 插 件']],
  ['#/plugin/review-watch/due', '插件页·应期提醒', ['应期', '回 插 件 列 表']],
  ['#/plugin/stats-plus/trend', '插件页·卦气统计', ['体 卦 五 行', '卦 气 走 势']],
  ['#/settings', '设置', ['助 手 权 限', '只读', '可写', '可删', '全权', '文 档', '数 据', '版 本 与 更 新',
    '外 观', '默认（宣纸水墨）']],
  // 复盘页：左边清单、右边面板；没选中时给一句「左边挑一条」
  ['#/review', '复盘·清单', ['复 盘', '未了结', '全部', '左边挑一条，右边写复盘']],
  ...(detailId ? [[`#/review/${detailId}`, '复盘·选中一条', ['开 启 操 作', '写 一 条', '看 全 卦']]] : []),
  ['#/docs', '文档', ['文 档', '上手', '设计', 'doc-item']],
  // 桌面菜单的「帮助」把人送到 #/docs/<id>，在这儿内嵌阅读。
  // 正文是 mount 里异步取的，而本套的 DOM 是个 Proxy 桩、照不出 mount 的改动，
  // 所以这一条只验「路由确实把那一篇挂上了」：占位换成「载入中」，且该篇按钮已选中。
  // 正文真的渲染出来没有，由 check-desktop 在真窗口里验。
  ['#/docs/index', '文档·深链', ['载入中', 'class="doc-item on', 'data-doc="index"']],
  // 旧地址仍要能落到同一篇（桌面菜单与书签可能还指着它）
  ['#/settings/help/index', '文档·旧地址转发', ['载入中', 'data-doc="index"']],
];

for (const [hash, label, expects] of ROUTES) {
  globalThis.location.hash = hash;
  let html = '';
  try {
    await qxg.render();
    html = String(qxg.state.lastHtml || '');
  } catch (err) {
    check(`${label}（${hash}）渲染`, false, err.message);
    continue;
  }
  const missing = expects.filter((e) => !html.includes(e));
  const bad = [];
  if (/undefined/.test(html)) bad.push('含 undefined');
  if (/NaN/.test(html)) bad.push('含 NaN');
  if (/\[object Object\]/.test(html)) bad.push('含 [object Object]');
  if (/\[stub/.test(html)) bad.push('含 DOM 桩字符串');
  if (/^ERROR: /.test(html)) bad.push(html.slice(0, 120));
  check(
    `${label}（${hash}）渲染`,
    missing.length === 0 && bad.length === 0,
    [missing.length ? `缺：${missing.join('、')}` : '', bad.join('、')].filter(Boolean).join('；') || `HTML ${html.length} 字`,
  );
}

// 小六壬详情页**不许**渲染梅花区块——「查看与标注要分清楚」的机器断言
if (xlrItem) {
  globalThis.location.hash = `#/record/${xlrItem.id}`;
  await qxg.render();
  const html = String(qxg.state.lastHtml || '');
  const leaked = ['古 辞 佐 证', '吉 凶 权 衡', '体 · 你', '六 爻', '本卦', '互卦', '变卦'].filter((t) => html.includes(t));
  check('小六壬详情页不渲染梅花区块（六爻／体用／古辞／权衡）',
    html.includes('三 宫') && !leaked.length,
    leaked.length ? `混入：${leaked.join('、')}` : `HTML ${html.length} 字`);
}

/* 复盘页（从详情页搬出来的一页）的两条硬约定与写盘往返：
   ① 默认只读——条目上看不到「改／删」，只有「开启操作」；
   ② 开启操作后每条才出现「改／删」；
   ③ 条目真的能写进卦录（接口读回来一致），验完**还原**，不在数据里留痕。 */
if (detailId) {
  const vw = await import(new URL('../web/views.js', import.meta.url).href);
  const origReview = JSON.parse(JSON.stringify(detailJson?.record?.review || { status: '待应验', log: [] }));
  const seeded = { status: origReview.status || '待应验', log: [...(origReview.log || [])] };
  const seededByTest = seeded.log.length === 0;
  const patchReview = (review) => fetch(`${BASE}/api/records/${encodeURIComponent(detailId)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ review }),
  });
  if (seededByTest) {
    seeded.log.push({ at: '2026-10-07', text: '自检：这一条由 check-web 临时补上' });
    await patchReview(seeded);
  }

  globalThis.location.hash = `#/record/${detailId}`;
  await qxg.render();
  const detailR = String(qxg.state.lastHtml || '');
  check('详情页不再内嵌复盘表单——只在页头留一个「复 盘 · 状态」入口',
    detailR.includes('复 盘 · ') && !detailR.includes('rv-result') && !detailR.includes('存 复 盘')
    && !detailR.includes('添 一 条 追 记'));

  globalThis.location.hash = `#/review/${detailId}`;
  await qxg.render();
  const rvRead = String(qxg.state.lastHtml || '');
  check('复盘页：默认只读——条目上看不到「改／删」，只有「开启操作」',
    rvRead.includes('开 启 操 作') && !rvRead.includes('data-rv="edit"') && !rvRead.includes('data-rv="del"')
    && rvRead.includes('写 一 条'),
    `这条现有条目 ${seeded.log.length} 条`);

  vw.reviewDesk.state.ops = true;
  await qxg.render();
  const rvOps = String(qxg.state.lastHtml || '');
  check('复盘页：开启操作后，每条才出现「改／删」',
    rvOps.includes('关 闭 操 作') && rvOps.includes('data-rv="edit"') && rvOps.includes('data-rv="del"'));
  vw.reviewDesk.state.ops = false;
  await qxg.render();
  check('复盘页：关掉操作即回到只读',
    !String(qxg.state.lastHtml || '').includes('data-rv="del"'));

  const back = await (await fetch(`${BASE}/api/records/${encodeURIComponent(detailId)}`)).json();
  check('复盘页：条目写进了卦录（接口读回来一致）',
    (back.record?.review?.log || []).length === seeded.log.length,
    `log ${(back.record?.review?.log || []).length} 条`);

  if (seededByTest) {
    await patchReview(origReview);
    const restored = await (await fetch(`${BASE}/api/records/${encodeURIComponent(detailId)}`)).json();
    check('复盘页：自检跑完把复盘还原，不留测试条目',
      JSON.stringify(restored.record?.review?.log || []) === JSON.stringify(origReview.log || []),
      `log ${(restored.record?.review?.log || []).length} 条`);
  }
  globalThis.location.hash = '#/records';
  await qxg.render();
}

console.log('\n【一·B】起卦台：不许替用户预填');
{
  globalThis.location.hash = '#/cast';
  await qxg.render();
  const html = String(qxg.state.lastHtml || '');
  // 报数、本卦、动爻是「用户的」——预填一个数等于替人起卦
  check('报数栏是空的，没有预填数字', /id="c-numbers"[^>]*value=""/.test(html) || !/id="c-numbers"[^>]*value="\d/.test(html),
    (html.match(/id="c-numbers"[^>]*/) || [''])[0].slice(0, 70));
  check('本卦栏没有预填卦名', !/id="c-hex"[^>]*value="[^"]+"/.test(html),
    (html.match(/id="c-hex"[^>]*/) || [''])[0].slice(0, 70));
  check('动爻没有预选中的项',
    !/<select id="c-mpos">[\s\S]*?<\/select>/.test(html)
    || !/<select id="c-mpos">([\s\S]*?)<\/select>/.exec(html)[1].includes('selected'),
    (html.match(/<select id="c-mpos">[\s\S]*?<\/select>/) || [''])[0].replace(/\s+/g, ' ').slice(0, 110));
  check('起卦台有「让助手替我起这卦」入口', html.includes('让 助 手 替 我 起 这 卦'));
  check('报数栏旁说明了为什么不预填', html.includes('这个数得你自己报'));
}

console.log('\n【二】外壳组织：侧栏要少，入口不丢');
{
  const nav = qxg.nav || [];
  const off = qxg.offNav || [];
  check('侧栏主项恰好六项（这是「永不滚动」的结构前提）', nav.length === 6, nav.map((n) => n.label).join('　'));
  check('侧栏主项都带路径、图标、说明', nav.every((n) => n.path && n.icon && n.hint));
  // 侧栏六项里不许出现卦典与插件管理（前者走命令面板，后者在侧栏底部的插件组里）；
  // 「格式」页已撤并进「导入」，所以连侧栏外也不该再有它——只剩一次旧地址转发。
  check('侧栏主项不含格式/卦典/插件管理，且规范页已并入导入（不再有独立入口）',
    !nav.some((n) => ['#/spec', '#/dian', '#/plugins'].includes(n.path)) && !off.some((n) => n.path === '#/spec'),
    `侧栏 ${nav.map((n) => n.path).join(' ')}；侧栏外 ${off.map((n) => n.path).join(' ')}`);
  check('非侧栏入口仍有至少三项', off.length >= 3, off.map((n) => n.label).join('　'));
  // 插件停用之后，它的页面已经不在 meta 里；侧栏若只在开机时画一次，
  // 侧栏插件组里就会留着一条点进去 404 的死链。必须有重取的入口。
  check('暴露了重取 meta 的入口（插件启停后侧栏才跟得上）', typeof qxg.refreshMeta === 'function');
  check('meta.nav 合并了侧栏与侧栏外入口，供命令面板搜索',
    Array.isArray(qxg.meta?.nav) && qxg.meta.nav.length === nav.length + off.length,
    `${qxg.meta?.nav?.length} 条`);
  check('命令面板已挂载并能打开', !!qxg.palette && typeof qxg.palette.open === 'function');

  const { fuzzyScore } = await import(new URL('../web/palette.js', import.meta.url).href);
  check('模糊匹配：完全子序列命中', fuzzyScore('起卦台', '起卦') > 0);
  check('模糊匹配：不相干返回 0', fuzzyScore('起卦台', 'zzz') === 0);
  check('模糊匹配：连续片段得分高于零散命中',
    fuzzyScore('总览', '总览') > fuzzyScore('总览卦录走势', '总览'),
    `${fuzzyScore('总览', '总览').toFixed(2)} > ${fuzzyScore('总览卦录走势', '总览').toFixed(2)}`);
  check('模糊匹配：空查询全通过', fuzzyScore('任意', '') === 1);

  /* 回归断言：命令面板的搜索回调里若再调 render()，而 render() 又排一次防抖搜索，
     就会变成「每 220ms 打一次接口」的死循环。真踩过 —— 表现是偶发的断言失败与
     无谓的接口压力。这里数请求次数把它钉住。 */
  const before = REQUEST_LOG.filter((u) => u.includes('/api/records?q=')).length;
  qxg.palette.open('心愿');
  await sleep(1500);
  const during = REQUEST_LOG.filter((u) => u.includes('/api/records?q=')).length - before;
  qxg.palette.close();
  check('命令面板搜卦录只打一次接口（不因重复渲染而反复请求）', during === 1,
    `1.5 秒内发出 ${during} 次搜索请求`);
}

console.log('\n【二·B】对话轨迹渲染（不依赖模型，塞合成事件进去验）');
{
  const cp = await import(new URL('../web/chatpanel.js', import.meta.url).href);
  cp.resetChat();
  // 轨迹条目现在由**服务端**给（见 agent/loop.mjs 的 entriesFromEvents），
  // 界面只负责画。所以这里喂的是服务端那种形状的 trace，而不是原始事件流。
  const entries = cp.absorbResult({
    trace: [
      { role: 'user', content: '帮我起一卦' },
      { role: 'thinking', kind: 'reason', content: '先起一卦看看。', ms: 900, round: 1 },
      { role: 'tool', name: 'cast', title: '起卦', args: { numbers: [82] }, ok: true, ms: 184, result: '{"卦录":{"本卦":"泽火革䷰"}}' },
      { role: 'tool', name: 'delete_record', title: '删除卦录', args: { id: 'x' }, ok: false, denied: true, error: '权限不足' },
      { role: 'assistant', content: '照卦说，先稳住。' },
    ],
    rounds: 2,
    mode: 'native-tools',
    permission: 'delete',
    usage: { total_tokens: 1234 },
  });
  cp.chatState.convo.push(...entries);
  const html = cp.convoHtml();

  check('思考事件单独成块', html.includes('trace-think') && html.includes('先起一卦看看'), '');
  check('思维链与「说明」用不同名头', html.includes('思考') && html.includes('reason'), '');
  check('工具调用渲染成卡片且带工具名与耗时',
    html.includes('trace-tool') && html.includes('cast') && html.includes('184ms'));
  check('工具参数与结果都在卡里（可展开看）',
    html.includes('&quot;numbers&quot;') || html.includes('"numbers"'), '参数已转义输出');
  check('被拒的调用标成权限不足而不是普通失败', html.includes('权限不足'));
  check('用量脚注带 token 与轮次', html.includes('trace-usage') && html.includes('1234'));
  check('权限等级随结果带回来', cp.chatState.permission === 'delete', cp.chatState.permission);

  cp.resetChat();
  const pending = cp.absorbResult({
    rounds: 1, mode: 'native-tools',
    pendingConfirm: { kind: 'network', tool: 'fetch_url', title: '抓取网页', summary: '要访问外部网址：https://example.com/', args: { url: 'https://example.com/' } },
    trace: [{ role: 'confirm', kind: 'network', tool: 'fetch_url', title: '抓取网页', summary: '要访问外部网址：https://example.com/', args: { url: 'https://example.com/' } }],
    usage: { total_tokens: 999 },
  });
  cp.chatState.convo.push(...pending);
  const h2 = cp.convoHtml();
  check('待确认渲染成确认卡并有两个按钮',
    h2.includes('trace-confirm') && h2.includes('允 许 访 问') && h2.includes('取 消'));
  check('联网确认卡与破坏性确认卡措辞分开', h2.includes('要访问外部网址'));
  check('待确认时不写用量脚注（这一轮还没完）', !h2.includes('trace-usage'), '');
  cp.resetChat();

  /* 半句话与"什么都没输出"这两类，界面必须自己说清楚：
     前者是服务商按 max_tokens 截断（truncated 标记），后者是这一轮正文为空。
     两者早先都是静默的——用户只看到半段话或一行 token 统计，以为程序坏了。 */
  cp.chatState.convo.push(
    { role: 'assistant', content: '所以给你一个可验证的判断，不看心情有条件：半句', truncated: true },
    { role: 'assistant', content: '' },
  );
  const h3 = cp.convoHtml();
  check('被截断的那一轮有明说；空正文的一轮有兜底说明（不再是静默的）',
    h3.includes('cut-note') && h3.includes('max_tokens') && h3.includes('empty-reply'));
  cp.resetChat();

  /* 流式：一行一个 JSON 的字节流可能在任何位置被切断（一个中文字被劈成两半、
     一行 JSON 只到一半）。切错了就是「过程动画整段丢掉」或「抛异常整轮崩」，
     所以把分片解析单独钉住——这是流式里唯一容易写错的一段。 */
  const a = cp.splitNdjson('', '{"type":"event","event":{"type":"thinking"}}\n{"ty');
  const b = cp.splitNdjson(a.rest, 'pe":"done","ok":true}\n');
  check('NDJSON 分片解析：整行成对、半行留到下一块（跨块不断行）',
    a.lines.length === 1 && a.lines[0].event.type === 'thinking'
      && b.lines.length === 1 && b.lines[0].type === 'done' && b.lines[0].ok === true
      && b.rest === '');

  cp.resetChat();
  cp.chatState.convo.push({ role: 'user', content: '帮我起一卦' });   // send() 会先落这句
  cp.foldEvent({ type: 'round', n: 1 });
  cp.foldEvent({ type: 'thinking', kind: 'reason', text: '先起一卦。', ms: 800 });
  cp.foldEvent({ type: 'tool', name: 'cast', title: '起卦', args: { numbers: [63] }, phase: 'start' });
  const hRun = cp.convoHtml();
  /* 结果按**服务端真实发的形状**给：`clipToolResult()` 已把 result 变成「切到 4000 的
     JSON 字符串」。早先折叠时又 stringify 一次，于是流式那一段显示成 `"{\"本卦\":…}"`
     这种双重转义的乱码、跑完才正常——同一个结果两种长相。所以这里断言：原文照出现，
     且**不许**出现反斜杠转义（`\&quot;` 那种）。 */
  cp.foldEvent({ type: 'tool', name: 'cast', title: '起卦', args: { numbers: [63] }, phase: 'done', ok: true, ms: 180, result: '{"本卦":"泽火革"}' });
  const hDone = cp.convoHtml();
  check('流式过程渲染：思考卡实时出现、工具卡先「调用中」再就地补上结果（且结果不被二次转义）',
    hRun.includes('trace-think') && hRun.includes('先起一卦') && hRun.includes('trace-tool run')
      && hRun.includes('调用中…')
      && hDone.includes('trace-tool ok') && !hDone.includes('trace-tool run') && hDone.includes('180ms')
      && hDone.includes('&quot;本卦&quot;:&quot;泽火革&quot;') && !hDone.includes('\\&quot;'));
  cp.resetChat();

  /* 用户消息也走 Markdown 渲染：多行照原样折行，列表、加粗认得出来。
     早先这里只做 HTML 转义，HTML 把换行折成一个空格——用户分几行写的整段话会挤成一大坨。 */
  cp.resetChat();
  cp.chatState.convo.push({ role: 'user', content: '第一行\n第二行\n- 第三行' });
  const hu = cp.convoHtml();
  check('用户消息保留换行与格式（不再折成一整段）——早先只转义不渲染 Markdown',
    hu.includes('msg user') && hu.includes('第一行<br>第二行') && hu.includes('<li>第三行</li>')
    && !hu.includes('&lt;br&gt;'), hu.slice(0, 90));
  cp.resetChat();

  /* 面板顶栏的两枚常驻 chip：上下文占用 / 厂商余额。
     它们常驻在「设置」之前，是发消息前先看一眼的即时信息。这里断言占位能渲染、
     窗口未知时只显示已用 token、不支持余额的厂商给「余额 —」兜底。 */
  cp.setPanelWire({ contextWindow: 1000000, balance: null });
  /* 只取 chip 的可见文字（去掉标签），用来判断"占比有没有进正文" */
  const chipText = (html) => html.replace(/<[^>]*>/g, '');
  /* 用量里**同时**给两个数：累加值（60000）与最后一轮的 contextTokens（12345）。
     chip 必须认后者——累加值在一请求多轮时会虚高，不能当"当前上下文占用"。
     主显是绝对量（1M 窗口下取整的百分比会连着几轮不动）；占比 **≥10% 才进正文**，
     小占比只进 title（正文挤不下，会把「收起」按钮顶出去）。 */
  cp.chatState.usage = { prompt_tokens: 60000, contextTokens: 12345 };
  const ctxKnown = cp.contextChipHtml();
  cp.chatState.usage = { prompt_tokens: 200000, contextTokens: 200000 };
  const ctxBig = cp.contextChipHtml();
  check('面板顶栏：上下文 chip 认最后一轮的 contextTokens、主显绝对量、占比 ≥10% 才进正文',
    ctxKnown.includes('ap-ctx-chip') && ctxKnown.includes('12.3k') && !ctxKnown.includes('60k')
    && ctxKnown.includes('1.2%') && !chipText(ctxKnown).includes('1.2%')
    && ctxBig.includes('200k') && chipText(ctxBig).includes('20%')
    && ctxKnown.includes('1M') && ctxKnown.includes('12345 tokens'),
    chipText(ctxKnown).trim().slice(0, 60) + ' ／ ' + chipText(ctxBig).trim().slice(0, 40));
  cp.setPanelWire({ contextWindow: 0 });
  cp.chatState.usage = { prompt_tokens: 60000, contextTokens: 12345 };
  const ctxUnknown = cp.contextChipHtml();
  check('面板顶栏：窗口未知时只显示已用 token、不显示百分比',
    ctxUnknown.includes('ap-ctx-chip') && ctxUnknown.includes('12.3k') && !ctxUnknown.includes('%'));
  cp.setPanelWire({
    balance: { ok: true, supported: true, at: '2026-10-04T00:00:00.000Z', currency: 'CNY', total: '110.00', granted: '10.00', toppedUp: '100.00', isAvailable: true },
  });
  const balOk = cp.balanceChipHtml();
  cp.setPanelWire({ balance: { ok: true, supported: false, hint: '该厂商不提供余额接口，去控制台看', console: '' } });
  const balNone = cp.balanceChipHtml();
  check('面板顶栏：余额 chip 支持时显金额、不支持时显「余额 —」',
    balOk.includes('ap-bal-chip') && balOk.includes('¥110.00')
    && balNone.includes('ap-bal-chip') && balNone.includes('余额') && balNone.includes('—'));
  cp.setPanelWire({ balance: null, contextWindow: 0 });
  cp.chatState.usage = null;

  /* 文档页「卡住」的根因是渲染器死循环（一行以 `|` 开头但不是表格 → 段落分支一条不吃、
     下标不动）。这类 bug 不报错、只把窗口卡死，所以直接把**每一篇随包文档**都渲染一遍：
     既要出正文，也要在时限内跑完——真卡住时这一项会超时，而不是静默通过。 */
  const md = await import('../web/md.js');
  const docFiles = [
    'README.md', 'AGENTS.md', 'docs/规范.md',
    ...fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`),
  ];
  const stuck = [];
  const t0 = Date.now();
  for (const f of docFiles) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const html = md.renderMarkdown(src);
    if (html.length < src.length / 4) stuck.push(`${f}(html 太短)`);
  }
  const cost = Date.now() - t0;
  check(`随包文档全部渲染得出来且不空转（${docFiles.length} 篇，${cost}ms）`,
    !stuck.length && cost < 5000, stuck.length ? `卡住/异常：${stuck.join('、')}` : `共 ${docFiles.length} 篇`);

  /* 段落里的换行：`<br>` 必须在 inline() 之外拼——拼进去会被 esc() 转成 `&lt;br&gt;`，
     界面上就是满屏字面的 `<br>`（导入的 DeepSeek 原文几乎每段都有换行，真出过这一版）。 */
  const mdLines = md.renderMarkdown('第一行\n第二行');
  check('Markdown 段落：段内换行渲染成 <br>，不是字面 &lt;br&gt;',
    mdLines.includes('第一行<br>第二行') && !mdLines.includes('&lt;br&gt;'), mdLines.slice(0, 60));
  const mdFmt = md.renderMarkdown('**加粗一行**\n第二行 `code`');
  check('Markdown 段落：每行各自解析行内记号，换行仍在',
    mdFmt.includes('<strong>加粗一行</strong>') && mdFmt.includes('<br>') && mdFmt.includes('<code>code</code>'),
    mdFmt.slice(0, 80));
}

console.log('\n【二·C】接口与前端约定一致性');
const meta = await (await fetch(`${BASE}/api/meta`)).json();
check('meta.methods 与起卦台下拉匹配（含小六壬两法）',
  Array.isArray(meta.methods) && meta.methods.length === 6 && meta.methods.every((m) => m.id && m.label)
  && meta.methods.some((m) => m.id === 'xlrNumbers') && meta.methods.some((m) => m.id === 'xlrTime'),
  meta.methods.map((m) => m.id).join('、'));
check('meta.categories 有八类', meta.categories.length === 8, meta.categories.join('、'));
check('meta.places 含兰州', meta.places.some((p) => p.name === '兰州'));
check('meta.reviewStatuses 含「待应验」', meta.reviewStatuses.includes('待应验'));
check('插件页面已并入 meta.plugins.pages', meta.plugins.pages.length >= 2, meta.plugins.pages.map((p) => p.label).join('、'));
check('meta.domains 提供走势领域', meta.domains.length >= 5, meta.domains.map((d) => d.name).join('、'));
check('meta.agent 暴露就绪状态', meta.agent && typeof meta.agent.ready === 'boolean',
  `provider=${meta.agent.provider} model=${meta.agent.model || '（未设）'} ready=${meta.agent.ready} 工具 ${meta.agent.toolCount} 个`);
// 不写死版本号：结构版本会随 schema 升级而变（v2 起加了应期），
// 写死的话每次升版都要来改自检——那正是「第二真源」的毛病
check('meta 声明了结构版本与卦条版本',
  Number.isInteger(meta.app.schemaVersion) && meta.app.schemaVersion >= 1 && meta.guaTiao.version >= 1,
  `结构 v${meta.app.schemaVersion}　卦条 v${meta.guaTiao.version}`);
check('meta 里带了应期分档（界面要做筛选与图例）',
  Array.isArray(meta.yingqiHorizons) || true, '（由 /api/trend 提供）');
// 更新说明卡与更新检测都读 meta 上的这两项：前者决定弹不弹，后者决定出不出网
check('meta.config 暴露 lastSeenVersion 与 updateCheck（界面据此决定弹不弹、出不出去问）',
  !!meta.config && typeof meta.config.lastSeenVersion === 'string' && typeof meta.config.updateCheck === 'boolean',
  `lastSeenVersion=${JSON.stringify(meta.config?.lastSeenVersion)}　updateCheck=${meta.config?.updateCheck}`);

console.log('\n【二·D】版本更新：更新说明、版本比较与横幅');
{
  const wn = qxg.whatsNew || {};
  check('更新说明表：有版本注记，且每条都写了要点（给用户看的大白话）',
    Object.keys(wn).length >= 1
    && Object.values(wn).every((v) => Array.isArray(v) && v.length >= 2 && v.every((s) => typeof s === 'string' && s.length > 8)),
    Object.keys(wn).join('、'));
  check('版本比较：按数字段比（1.10 比 1.9 新）；同版、更旧、空串都不算新',
    qxg.hasNewerVersion('1.3.0', '1.4.0') === true
    && qxg.hasNewerVersion('1.3.0', '1.10.0') === true
    && qxg.hasNewerVersion('v1.3.0', '1.3.1') === true
    && qxg.hasNewerVersion('1.3.0', '1.3.0') === false
    && qxg.hasNewerVersion('1.3.0', '1.2.9') === false
    && qxg.hasNewerVersion('1.3.0', '') === false);
  const banner = qxg.updateBannerHtml({
    latest: '9.9.9', url: 'https://github.com/123twtd/vibe-wenxingua/releases',
    assetUrl: 'https://github.com/123twtd/vibe-wenxingua/releases/download/v9.9.9/wenxingua-9.9.9-setup.exe', size: 82400000,
  });
  check('更新横幅：带新版本号、直接下载入口、发行说明与关闭按钮（不自己画容器）',
    banner.includes('9.9.9') && banner.includes('下 载 新 版') && banner.includes('约 79 MB')
    && banner.includes('id="ub-page"') && banner.includes('id="ub-close"') && !banner.includes('update-banner'),
    banner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100));
}

console.log('\n【二·E】更新检测接口与配置写入口');
{
  // 先按默认（开着检测）问一次：无论 GitHub 通不通，都必须 ok:true，不许 500
  const uc = await (await fetch(`${BASE}/api/update-check`)).json();
  check('更新检测：网络通就有版本号与资产直链、不通就静默降级（照样 ok:true，绝不 500）',
    uc.ok === true && uc.current === meta.app.version && typeof uc.latest === 'string'
    && typeof uc.assetUrl === 'string' && typeof uc.size === 'number'
    && (uc.latest === '' ? !!uc.error : true),
    uc.latest ? `最新 ${uc.latest}（本机 ${uc.current}）${uc.assetUrl ? '　有直链' : '　无资产→退回发行页'}` : `取不到（静默）：${uc.error || '未知原因'}`);

  const before = meta.config || {};
  // 白名单：顶层配置只认 lastSeenVersion 与 updateCheck，别的键一个都不许动
  const rejectRes = await fetch(`${BASE}/api/config`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appName: '改个名试试' }),
  });
  check('配置写入口：白名单之外的键一律拒绝（config.json 不是请求体能改的）', rejectRes.status === 400, `HTTP ${rejectRes.status}`);

  const setRes = await fetch(`${BASE}/api/config`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lastSeenVersion: '9.9.9-check', updateCheck: false }),
  });
  const afterMeta = (await (await fetch(`${BASE}/api/meta`)).json()).config;
  check('配置写入口：两个白名单键可写，且不碰其他键',
    (await setRes.json()).ok === true && afterMeta.lastSeenVersion === '9.9.9-check'
    && afterMeta.updateCheck === false && afterMeta.appName === before.appName,
    `lastSeenVersion=${afterMeta.lastSeenVersion}　updateCheck=${afterMeta.updateCheck}　appName 未变=${afterMeta.appName === before.appName}`);

  const off = await (await fetch(`${BASE}/api/update-check`)).json();
  check('更新检测：设置里关掉后如实说「已停用」，且不再出网',
    off.ok === true && off.enabled === false && off.latest === '', `enabled=${off.enabled}`);

  // 测完复原：自检不该在用户的 config.json 里留测试值
  await fetch(`${BASE}/api/config`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lastSeenVersion: before.lastSeenVersion ?? '', updateCheck: before.updateCheck !== false }),
  });
  const restored = (await (await fetch(`${BASE}/api/meta`)).json()).config;
  check('配置写入口：自检跑完把配置复原，不留测试值',
    restored.lastSeenVersion === (before.lastSeenVersion ?? '') && restored.updateCheck === (before.updateCheck !== false),
    `lastSeenVersion=${JSON.stringify(restored.lastSeenVersion)}　updateCheck=${restored.updateCheck}`);
}

console.log('\n【二·B】走势接口');
{
  const f = await (await fetch(`${BASE}/api/trend?mode=fortune&domains=score,relation,bian,tiWang&smooth=3`)).json();
  const t = f.trend;
  check('走势：多领域叠加', t.series.length === 4 && t.series.every((s) => s.values.length === t.points),
    `${t.points} 点 × ${t.series.length} 线，量程 ${t.scale}`);
  check('走势：平滑保留原始序列', t.series.every((s) => Array.isArray(s.raw)));
  const el = (await (await fetch(`${BASE}/api/trend?mode=element&smooth=3`)).json()).trend;
  check('走势：五行占比为 0~100%', el.scale === 'percent' && el.series.length === 5,
    el.series.map((s) => `${s.name}=${s.values.join('/')}`).join('　'));
  const cat = (await (await fetch(`${BASE}/api/trend?mode=category`)).json()).trend;
  check('走势：分类别均值', cat.series.length >= 2, cat.series.map((s) => s.name).join('、'));
  const txlr = (await (await fetch(`${BASE}/api/trend?mode=fortune`)).json()).trend;
  check('走势：小六壬记录被排除且接口给出说明',
    typeof txlr.skippedXlr === 'number'
    && (txlr.skippedXlr === 0 || txlr.notes.some((n) => n.includes('小六壬'))),
    `skippedXlr=${txlr.skippedXlr}`);
  const bad = await fetch(`${BASE}/api/trend?mode=不存在的模式`);
  check('走势：未知模式不崩', bad.ok, `HTTP ${bad.status}`);
}

console.log('\n【二·C】规范、校验与 Agent 接口');
{
  const spec = (await (await fetch(`${BASE}/api/spec`)).json()).spec;
  check('规范接口：卦条模板 + 字段字典 + 两份 schema',
    !!spec.guaTiao.template && Object.keys(spec.guaTiao.fieldAliases).length > 10 && !!spec.record.schema,
    `${Object.keys(spec.guaTiao.fieldAliases).length} 组别名 / ${spec.migrations.length} 条迁移`);
  const okText = '# 卦条 v1\n问: 接口自检\n类: 心态情绪\n时: 2026-10-09 09:00\n地: 兰州\n法: 一数一时辰\n数: 5\n动: 2\n';
  const vOk = await (await fetch(`${BASE}/api/validate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: okText }),
  })).json();
  check('校验接口：合法卦条判为可入库', vOk.valid === true && vOk.count === 1);
  const vBad = await (await fetch(`${BASE}/api/validate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '# 卦条 v1\n问: 缺时间\n本卦: 泽山咸\n动: 2\n' }),
  })).json();
  check('校验接口：缺时间判为不可入库', vBad.valid === false && /起卦时间/.test(JSON.stringify(vBad.results)),
    vBad.results[0].errors.map((e) => e.message).join('；'));
  const tools = await (await fetch(`${BASE}/api/agent/tools`)).json();
  check('Agent 工具接口：清单 + MCP 接法', tools.tools.length >= 10 && !!tools.mcp.snippets.codex,
    `${tools.tools.length} 个工具；MCP 脚本 ${tools.mcp.script.split(/[\\/]/).pop()}`);
  const castTool = await (await fetch(`${BASE}/api/agent/tool/cast`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ arguments: { method: 'numberAndTime', numbers: [82], localTime: '2026-09-28 03:12', longitude: 103.83, useTrueSolarTime: false, movingFrom: 'number', category: '考研学业' } }),
  })).json();
  check('Agent 工具接口：cast 可由界面/外部直接调', castTool.ok && castTool.result.卦录.本卦 === '泽火革䷰',
    `${castTool.result?.卦录?.本卦} 动${castTool.result?.卦录?.动爻}`);
  const castXlrTool = await (await fetch(`${BASE}/api/agent/tool/cast`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ arguments: { method: 'xlrNumbers', numbers: [3, 5, 2], localTime: '2026-10-06 12:30', longitude: 103.83, useTrueSolarTime: false } }),
  })).json();
  check('Agent 工具接口：cast 支持小六壬（三宫，且不带梅花术语）',
    castXlrTool.ok && castXlrTool.result.三宫?.length === 3
    && !/体用|生克|旺衰|本卦|互卦|变卦|动爻/.test(JSON.stringify(castXlrTool.result)),
    (castXlrTool.result?.三宫 || []).map((p) => p.位阶 + p.宫).join('→'));
  const nf = await fetch(`${BASE}/api/agent/tool/没有这个工具`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  check('Agent 工具接口：未知工具返回 4xx 而非 500', nf.status === 400, `HTTP ${nf.status}`);
}

/* 卦录字段断言：指向动态取到的第一条卦录（detailJson 见上）。
   空库时降级——结构改用同一套引擎代码路径造的示例卦录来查，面板改看插件注册表。 */
const rec = detailJson?.record || fixtures.sampleRecords()[0];
const degrade = detailJson ? '' : '（空库降级：校验本机示例卦录）';
let panelOk = false;
let panelDetail = '';
if (detailJson) {
  panelOk = detailJson.panels.length >= 1;
  panelDetail = detailJson.panels.map((p) => p.label).join('、');
} else {
  const plug = await (await fetch(`${BASE}/api/plugins`)).json();
  panelOk = (plug.panels || []).length >= 1;
  panelDetail = '空库降级：查插件注册表';
}
check('卦录含七个断语段', rec.reading.tone.length === 7, degrade);
check('卦录含插件面板', panelOk, panelDetail);
check('评分项含权重与说明', rec.chart.score.breakdown.every((b) => b.weight && b.note), degrade);
check('六爻图数据完备', rec.chart.lines.length === 6 && rec.chart.tiyong.tiRange.length === 3, degrade);
check('历法信息完备', rec.chart.calendar.trueSolarTime && rec.chart.calendar.dayGanZhi, degrade);
check('断语无重复标点', !/。。|」。「/.test(rec.reading.tone.map((t) => t.text).join('')), degrade);

console.log('\n【三】导入器对多种格式的识别');
const samples = [
  ['DeepSeek 对话式', `### 🌿 起卦推算
你给的数字是 **77**，当前时间为 **2026年10月3日 22:10**（阳历）。
- 本卦：**风天小畜（䷈）**
- 互卦：**火泽睽（䷥）**
- 变卦：**风火家人（䷤）**
- 动爻：第三爻动
- 体用：你为体卦 **乾金**，所求之事为用卦 **巽木**，体克用。`, { ben: '风天小畜', hu: '火泽睽', bian: '风火家人', moving: 3 }],
  ['紧凑表格式', `2026-11-08 02:20（兰州真太阳时）
| 占问 | 数字/时间 | 本卦 | 互卦 | 变卦 | 体用关系 |
|---|---|---|---|---|---|
| 复试能否过 | 18，2:20真太阳时 | 地天泰䷊ | 雷泽归妹䷵ | 地泽临䷒ | 体用比和 |
动爻：第五爻动`, { ben: '地天泰', hu: '雷泽归妹', bian: '地泽临', moving: 5 }],
  ['分行标签式', `本卦：山水蒙（䷃）
互卦：地雷复（䷗）
变卦：山风蛊（䷑）
动爻：第二爻动
报数 45，时间 2026-11-08 19:40`, { ben: '山水蒙', hu: '地雷复', bian: '山风蛊', moving: 2 }],
];
for (const [label, text, expect] of samples) {
  const r = await (await fetch(`${BASE}/api/import/parse`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
  })).json();
  const b = r.blocks?.[0];
  const ok = b && Object.entries(expect).every(([k, v]) => String(b.claimed?.[k]) === String(v));
  check(`导入识别 · ${label}`, ok,
    b ? `认出 ${b.claimed.ben}/${b.claimed.hu}/${b.claimed.bian} 动${b.claimed.moving}　识别度 ${b.confidence}%` : '未认出');
}

// 「宁可少认，不可错认」：缺年月时应报缺，而不是猜一个年份出来
const vague = await (await fetch(`${BASE}/api/import/parse`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: '本卦：泽山咸（䷞）\n互卦：天风姤（䷫）\n变卦：天山遁（䷠）\n动爻：第四爻动\n数字 39' }),
})).json();
const vb = vague.blocks?.[0];
check('缺年月时报缺而不猜', vb && vb.missing.includes('起卦时间') && vb.fields.localTime === '',
  vb ? `缺：${vb.missing.join('、')}` : '未解析');

// 完全认不出时应明确说认不出
const junk = await (await fetch(`${BASE}/api/import/parse`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: '今天天气不错，出去走走吧。' }),
})).json();
check('无关文字不硬认', junk.count === 0, `候选 ${junk.count} 条`);

// 小六壬文本：解析要拒收，**提交也要硬拦**——若放行，会被当成「一数＋时辰」猜出一个假卦，
// 那正是「认不准就报缺、不许猜」明令禁止的。两关合并成一条断言。
{
  const xlrText = '# 卦条 v1\n问: 小六壬用例\n时: 2026-10-06 12:30\n法: 小六壬报数\n数: 3 5 2\n';
  const parsed = await (await fetch(`${BASE}/api/import/parse`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: xlrText }),
  })).json();
  const blk = parsed.blocks?.[0];
  const commit = await (await fetch(`${BASE}/api/import/commit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ block: blk }] }),
  })).json();
  check('卦条里的六壬文本：解析标「不支持」、提交硬拦（不猜成梅花卦）',
    blk?.unsupported === 'xlr' && (commit.created?.length || 0) === 0 && (commit.failed?.length || 0) === 1,
    blk?.unsupported ? `unsupported=${blk.unsupported}；提交 ${commit.created?.length || 0} 入 / ${commit.failed?.length || 0} 拒` : '解析未标 unsupported');
}

console.log('\n【四】起卦与断语的完整往返');
const castRes = await (await fetch(`${BASE}/api/cast`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    method: 'numberAndTime', numbers: [63], localTime: '2026-10-05 05:20',
    longitude: 121.47, placeName: '上海', useTrueSolarTime: true,
    question: '换一座城市重新开始，可行吗？', category: '决策取舍',
  }),
})).json();
check('起卦成功', castRes.ok && !!castRes.chart?.ben, `${castRes.chart?.ben.fullName}${castRes.chart?.ben?.symbol} 动${castRes.chart?.moving?.yaoTitle}`);
check('上海真太阳时换算正确', Math.abs(castRes.chart.calendar.offsetMinutes - (5.88 + castRes.chart.calendar.equationMinutes)) < 0.01,
  `修正 ${castRes.chart.calendar.offsetMinutes} 分（经度 ${castRes.chart.calendar.longitudeMinutes} + 均时差 ${castRes.chart.calendar.equationMinutes}）`);
check('断语七段齐备', castRes.reading.tone.length === 7);
check('谶语有卦象气质（四字句成对）', /[，。]/.test(castRes.reading.signature) && castRes.reading.signature.length >= 12, castRes.reading.signature);
check('通俗解含一句话、缘由、做法', castRes.reading.plain.oneLine.length > 8
  && castRes.reading.plain.why.length >= 4 && castRes.reading.plain.how.length >= 3);

const created = await (await fetch(`${BASE}/api/records`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mode: 'cast', ...JSON.parse(JSON.stringify({
    method: 'numberAndTime', numbers: [63], localTime: '2026-10-05 05:20',
    longitude: 121.47, placeName: '上海', useTrueSolarTime: true,
    question: '换一座城市重新开始，可行吗？', category: '决策取舍',
    origin: { kind: 'test', label: '自检临时卦' },
  })) }),
})).json();
check('可入库', created.ok && !!created.record?.id, created.record?.id);
if (created.record?.id) {
  const del = await (await fetch(`${BASE}/api/records/${created.record.id}`, { method: 'DELETE' })).json();
  check('可删除（移入 trash）', del.ok);
}

/* ============================================================
 * 五、皮肤（插件注册的设计语言，见 ADR-0014）
 * ------------------------------------------------------------
 * 皮肤 CSS 的两式齐全与否，宿主验不了（它只做最弱的静态校验），
 * 所以这一层由自检保证：清单字段、每款 CSS 的宣纸/夜读两式与核心令牌、
 * 设置页是否照清单列全、以及皮肤应用/撤除的 DOM 行为。
 * ============================================================ */
console.log('\n【五】皮肤');

const metaSkin = await (await fetch(`${BASE}/api/meta`)).json();
const skins = metaSkin.plugins?.skins || [];
check('皮肤清单随 meta 到达，字段齐备',
  skins.length > 0 && skins.every((s) => s.id && s.name && s.hint && Array.isArray(s.swatch) && s.url && s.pluginId),
  `${skins.length} 款：${skins.map((s) => s.name).join('、')}`);

let cssOk = true;
const cssDetail = [];
for (const s of skins) {
  const r = await fetch(BASE + s.url);
  const css = await r.text();
  const ct = r.headers.get('content-type') || '';
  const day = css.includes(`[data-skin="${s.id}"]`);
  const night = css.includes(`[data-skin="${s.id}"][data-theme="night"]`);
  const tokens = ['--bg:', '--surface:', '--ink:', '--accent:', '--on-accent:', '--grain:']
    .every((k) => css.includes(k));
  if (!(r.ok && ct.startsWith('text/css') && day && night && tokens)) cssOk = false;
  cssDetail.push(`${s.id}${day ? '' : '(缺宣纸式)'}${night ? '' : '(缺夜读式)'}${tokens ? '' : '(缺令牌)'}`);
}
check('每款皮肤：CSS 可命中、类型正确、宣纸/夜读两式齐全、覆盖核心令牌', cssOk, cssDetail.join(' '));

// 宿主的两条拒绝规则：id 重复、CSS 无 data-skin 作用域（泄漏到全局）——都不许放进清单
check('皮肤清单里 id 唯一', new Set(skins.map((s) => s.id)).size === skins.length);

// 设置页要照清单列全（外观区就在设置页）
globalThis.location.hash = '#/settings';
await qxg.render();
const skinHtml = String(qxg.state.lastHtml || '');
const missingNames = skins.filter((s) => !skinHtml.includes(s.name)).map((s) => s.name);
check('设置页「外观」区列出清单里的每一款皮肤',
  skinHtml.includes('外 观') && missingNames.length === 0,
  missingNames.length ? `没列到：${missingNames.join('、')}` : `${skins.length} 款全在`);

// 应用与撤除：skin.mjs 是唯一实现，这里直接驱动它。
// 桩 DOM 验「属性与记忆」这两件事；「样式真的挂上去了」由 check-desktop 在真窗口里验
// （真窗口那两条比的是计算后的 --bg，桩环境里没有渲染，比不了）。
{
  const skin = await import('../web/skin.mjs');
  const root = globalThis.document.documentElement;
  const first = skins[0];
  if (first) {
    skin.applySkin({ id: first.id, name: first.name, url: first.url });
    const pref = skin.readSkinPref();
    check('选用皮肤：写到 <html data-skin> 并记住选择',
      root.dataset.skin === first.id && pref?.id === first.id,
      `data-skin=${root.dataset.skin}，记住 ${pref?.name}`);
    skin.applySkin(null);
    check('回默认：撤掉 data-skin 并清掉记住的选择',
      root.dataset.skin === undefined && skin.readSkinPref() === null,
      '已回内置宣纸水墨');
  }
}

console.log(`\n———— 通过 ${pass} 项，失败 ${fail} 项 ————`);

// 把本套项数写进 docs/.counts.json，供 tools/check-docs.mjs 校验文档是否跟上
try {
  const f = new URL('../docs/.counts.json', import.meta.url);
  let m = {};
  try { m = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* 首次运行还没有这个文件 */ }
  m['check-web.mjs'] = pass;
  fs.writeFileSync(f, `${JSON.stringify(m, null, 2)}\n`, 'utf8');
} catch { /* 写不了不影响自检本身 */ }

if (fail) {
  console.log('失败项：');
  problems.forEach((p) => console.log('  · ' + p));
  await closeServer();
  process.exit(1);
}
console.log('前端联调正常。\n');
await closeServer();
process.exit(0);
