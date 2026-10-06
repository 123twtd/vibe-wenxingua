/**
 * 问心卦 · 文档与代码一致性自检
 * ------------------------------------------------------------
 * 用法：node tools/check-docs.mjs
 *
 * 为什么需要它：这套文档是分头写的，写完一小时内就有 5 处过时——
 * check-web 从 52 变 62 变 63、`.gitignore` 从"没有"变"有"、
 * 「帮助」菜单补了「打开启动日志」、format_spec 改成从 schema 现读……
 * **手改文档是守不住的**。所以把「文档里写的数字必须等于代码的事实」
 * 做成一条可执行的断言。
 *
 * 验两类东西：
 *   一、结构性事实：直接读源码数出来（工具数、端点数、IPC、MCP、侧栏项、文件数…）
 *   二、各套自检的项数：四套快的现场跑；两套慢的（需服务/需 Electron）读
 *       `docs/.counts.json`——那份清单由它们自己跑完写入。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${name}${detail ? `　${detail}` : ''}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? `　${detail}` : ''}`); }
};

/* ============================================================
 * 一、从源码数出事实
 * ========================================================== */
console.log('\n【一】结构事实（直接读源码）');

const toolkit = await import(pathToFileURL(path.join(ROOT, 'agent', 'tools.mjs')).href);
const sourcesMod = await import(pathToFileURL(path.join(ROOT, 'agent', 'sources.mjs')).href);
// 数的是**模型实际看得到的**工具集：内置 + 工具来源贡献的（联网那一个）。
// 只数内置会让文档里的「21 个工具」永远对不上。
const tk = toolkit.createToolkit({
  store: null,
  core: null,
  sources: [sourcesMod.createWebSource({ getConfig: () => ({ agent: { web: { enabled: true } } }) })],
});
const toolNames = tk.tools.map((t) => t.name);
const TOOLS = toolNames.length;
/** 其中内置的那部分——文档里有时要分开说 */
const BUILTIN_TOOLS = toolkit.createToolkit({ store: null, core: null }).tools.length;

const serverSrc = read('server/index.mjs');
const ROUTES = (serverSrc.match(/^\s*route\(/gm) || []).length;

const desktopSrc = read('desktop/main.mjs');
const IPC = (desktopSrc.match(/ipcMain\.handle\(/g) || []).length;
const preloadSrc = read('desktop/preload.cjs');
const PRELOAD_MEMBERS = (preloadSrc.match(/^\s{2}\w+:/gm) || []).length;

const mcpSrc = read('agent/mcp-server.mjs');
const MCP_PROTO = (mcpSrc.match(/PROTOCOL_VERSION\s*=\s*'([^']+)'/) || [])[1] || '?';
const MCP_SWITCH = mcpSrc.slice(mcpSrc.indexOf('switch (method)'));
const MCP_METHODS = new Set([...MCP_SWITCH.matchAll(/case\s+'([^']+)'/g)].map((m) => m[1]));
MCP_METHODS.delete('initialized'); // 与 notifications/initialized 同义，去重
const MCP_TOOLS = TOOLS;
// 资源与提示在 switch 里以内联数组返回，用「该分支里出现了几个 uri:/name:」来数
const mcpBranch = (caseName) => {
  const at = MCP_SWITCH.indexOf(`case '${caseName}'`);
  if (at < 0) return -1;
  const rest = MCP_SWITCH.slice(at);
  const next = rest.indexOf('\n        case ', 1);
  const body = next < 0 ? rest : rest.slice(0, next);
  return body;
};
const MCP_RESOURCES = (mcpBranch('resources/list').match(/uri:/g) || []).length;
/** 数一个数组字面量里**顶层**有几个对象——不能数 `name:`，
 *  因为每个 prompt 的 arguments 里也有 name，会多算 */
const countTopLevelObjects = (src, key) => {
  const at = src.indexOf(`${key}: [`);
  if (at < 0) return -1;
  let depth = 0;
  let n = 0;
  for (let i = src.indexOf('[', at); i < src.length; i += 1) {
    const c = src[i];
    if (c === '[' || c === '{') {
      if (c === '{' && depth === 1) n += 1;
      depth += 1;
    } else if (c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return n;
};
const MCP_PROMPTS = countTopLevelObjects(mcpBranch('prompts/list'), 'prompts');

const appSrc = read('web/app.js');
const navBlock = appSrc.slice(appSrc.indexOf('const NAV = ['), appSrc.indexOf('const OFF_NAV'));
const NAV = (navBlock.match(/path:\s*'#/g) || []).length;
const offBlock = appSrc.slice(appSrc.indexOf('const OFF_NAV'), appSrc.indexOf('let META'));
const OFF_NAV = (offBlock.match(/path:\s*'#/g) || []).length;

const webFiles = fs.readdirSync(path.join(ROOT, 'web')).filter((f) => /\.(js|html|css)$/.test(f));
const docsFiles = fs.readdirSync(DOCS).filter((f) => f.endsWith('.md'));
const adrFiles = fs.readdirSync(path.join(DOCS, 'adr')).filter((f) => f.endsWith('.md'));

const FACTS = {
  TOOLS, ROUTES, IPC, PRELOAD_MEMBERS, MCP_PROTO, MCP_METHODS: MCP_METHODS.size,
  MCP_RESOURCES, MCP_PROMPTS, NAV, OFF_NAV, WEB_FILES: webFiles.length,
  DOCS: docsFiles.length, ADR: adrFiles.length,
};

// 这几条只做「下限与自洽」把关，不做精确断言——
// 精确的那个数交给下方「文档里写的数字 vs 实测」去比。
// （第一版把 12、37 这些写死在这儿，结果工具一扩到 20 就自己红了，
//   等于又多了一处会漂移的第二真源。）
check('agent 工具数达到覆盖内部操作的水准', TOOLS >= 20, `${TOOLS} 个`);
check('每个工具都登记了权限', Object.keys(tk.permissionMap()).length === TOOLS,
  `${Object.keys(tk.permissionMap()).length} 条权限登记 / ${TOOLS} 个工具`);
check('REST 端点数 ≥ 37', ROUTES >= 37, `${ROUTES} 条`);
check('IPC handler 9 个、preload 成员 12 个', IPC === 9 && PRELOAD_MEMBERS === 12, `${IPC} / ${PRELOAD_MEMBERS}`);
check('MCP 协议 = 2024-11-05，方法 9，资源 3，提示 2',
  MCP_PROTO === '2024-11-05' && MCP_METHODS.size === 9 && MCP_RESOURCES === 3 && MCP_PROMPTS === 2,
  `${MCP_PROTO} / ${MCP_METHODS.size} / ${MCP_RESOURCES} / ${MCP_PROMPTS}`);
// 侧栏主项必须**恰好**六项（那是「永不滚动」的结构前提）；
// 侧栏外入口只设下限——以后再加设置、回收站之类是正常的，不该因此报红。
check('侧栏主项 = 6，侧栏外入口 ≥ 3', NAV === 6 && OFF_NAV >= 3, `${NAV} / ${OFF_NAV}`);

/* ============================================================
 * 二、各套自检的真实项数
 * ========================================================== */
console.log('\n【二】各套自检的真实项数');

const parseTotal = (out) => {
  const m = out.match(/通过\s+(\d+)\s*项/) || out.match(/通过\s+(\d+)\s*，/);
  return m ? Number(m[1]) : null;
};

const SUITES = [
  ['check.mjs', 'tools/check.mjs'],
  ['check-validate.mjs', 'tools/check-validate.mjs'],
  ['check-mcp.mjs', 'tools/check-mcp.mjs'],
  ['check-hermes.mjs', 'tools/check-hermes.mjs'],
];
const COUNTS = {};
for (const [name, rel] of SUITES) {
  const r = spawnSync(process.execPath, [path.join(ROOT, rel)], { encoding: 'utf8', timeout: 120000 });
  const total = parseTotal(`${r.stdout || ''}${r.stderr || ''}`);
  COUNTS[name] = total;
  check(`${name} 可跑且报出项数`, total !== null && r.status === 0, `通过 ${total} 项，退出码 ${r.status}`);
}

// 慢的两套：读清单（由它们自己跑完写入），没跑过就只提示
const manifestFile = path.join(DOCS, '.counts.json');
let manifest = {};
try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { /* 还没跑过 */ }
const SLOW = ['check-web.mjs', 'check-desktop.mjs', 'check-docs.mjs'];
for (const name of SLOW) {
  if (typeof manifest[name] === 'number') {
    COUNTS[name] = manifest[name];
    check(`${name} 项数取自 docs/.counts.json`, true, `${manifest[name]} 项`);
  } else {
    COUNTS[name] = null;
    console.log(`  · ${name} 未记录（跑一次 \`node tools/${name}\` 会写入 docs/.counts.json）`);
  }
}
const TOTAL = Object.values(COUNTS).every((v) => typeof v === 'number')
  ? Object.values(COUNTS).reduce((a, b) => a + b, 0)
  : null;
console.log(`  → 实测：${Object.entries(COUNTS).map(([k, v]) => `${k.replace('check', '').replace('.mjs', '')} ${v ?? '?'}`).join('　')}　合计 ${TOTAL ?? '?'}`);

/* ============================================================
 * 三、文档里写的数字是否等于实测
 * ========================================================== */
console.log('\n【三】文档里写的数字 vs 实测');

const docPaths = [
  ...docsFiles.map((f) => path.join(DOCS, f)),
  ...adrFiles.map((f) => path.join(DOCS, 'adr', f)),
  path.join(ROOT, 'README.md'),
  path.join(ROOT, 'AGENTS.md'),
];

/** 找出「<suite 脚本名> … （N 项）」里的 N，与实测比。
 *
 * 只认**带括号**的项数——这是这套文档陈述「总项数」的统一写法
 * （如 `check-web.mjs`（62 项））。
 * 不认裸的 `N 项`，因为文档里还有「12 项静态 + 21 项窗口」这类**子项数**，
 * 把它们当成总数会产生大量误报，而误报比漏报更糟——喊多了就没人看了。
 *
 * 表格行里脚本名与项数常在不同单元格，所以按单元格切开找。
 */
const suiteClaims = new Map();
for (const p of docPaths) {
  const text = fs.readFileSync(p, 'utf8');
  const rel = path.relative(ROOT, p);
  const lines = text.split('\n');

  for (const [name, actual] of Object.entries(COUNTS)) {
    if (actual === null) continue;
    const key = name.replace('.mjs', '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameRe = new RegExp('`?' + key + '\\.mjs`?');
    const numRe = /[（(]\s*(\d+)\s*项/;

    lines.forEach((line, i) => {
      const claim = (n) => {
        if (n !== actual) suiteClaims.set(`${rel}:${i + 1}`, { rel, line: i + 1, name, claimed: n, actual });
      };
      const trimmed = line.trim();

      if (trimmed.startsWith('|')) {
        const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
        const at = cells.findIndex((c) => nameRe.test(c));
        if (at < 0) return;
        // 名字所在单元格之后，逐格找第一个「(N 项」
        for (const cell of cells.slice(at + 1)) {
          const m = cell.match(numRe);
          if (m) { claim(Number(m[1])); return; }
          // 该格有内容但没有括号项数 → 说明这行不是在陈述总数，放弃
          if (cell) return;
        }
        return;
      }

      for (const m of line.matchAll(new RegExp('`?' + key + '\\.mjs`?[^\\d\\n|]{0,30}?' + '[（(]\\s*(\\d+)\\s*项', 'g'))) {
        claim(Number(m[1]));
      }
    });
  }
}
if (!suiteClaims.size) check('各套自检项数在文档中与实测一致', true, `${docPaths.length} 个文件`);
else {
  check('各套自检项数在文档中与实测一致', false, `${suiteClaims.size} 处不符`);
  [...suiteClaims.values()].slice(0, 30).forEach((c) => console.log(`      ${c.rel}:${c.line}　写「${c.name} ${c.claimed} 项」，实测 ${c.actual}`));
}

/** 合计数 */
if (TOTAL !== null) {
  const totalBad = [];
  for (const p of docPaths) {
    const text = fs.readFileSync(p, 'utf8');
    const rel = path.relative(ROOT, p);
    for (const m of text.matchAll(/(\d{3})\s*项(?:全过|自检|$)/gm)) {
      const n = Number(m[1]);
      const line = text.slice(0, m.index).split('\n').pop() + m[0];
      // 只挑看起来像「合计」的那些
      if (/合计|总计|全过|= \*\*|共/.test(line) && n !== TOTAL) {
        totalBad.push(`${rel}　写「${n} 项」，实测合计 ${TOTAL}　（${line.trim().slice(0, 70)}）`);
      }
    }
  }
  check('合计项数在文档中与实测一致', totalBad.length === 0, totalBad.length ? `${totalBad.length} 处不符` : `合计 ${TOTAL}`);
  totalBad.slice(0, 12).forEach((t) => console.log(`      ${t}`));
}

/* ============================================================
 * 四、会过期的「事实性断言」
 * ========================================================== */
console.log('\n【四】容易过期的断言');

const allText = docPaths.map((p) => [path.relative(ROOT, p), fs.readFileSync(p, 'utf8')]);
const claim = (name, ok, detail) => check(name, ok, detail);

// .gitignore
const hasGitignore = fs.existsSync(path.join(ROOT, '.gitignore'));
const saysNoGitignore = allText.filter(([, t]) => /(当前|还|尚)?没有\s*`?\.gitignore`?|不存在该文件/.test(t));
claim('.gitignore 的存在与否，文档说法与实际一致',
  hasGitignore ? saysNoGitignore.length === 0 : true,
  hasGitignore ? (saysNoGitignore.length ? `实际存在，但 ${saysNoGitignore.map(([n]) => n).join('、')} 说没有` : '存在，文档未说没有') : '不存在');

// 帮助菜单里的「打开启动日志」
const hasLogMenu = /label:\s*'打开启动日志'/.test(desktopSrc);
const saysNoLogMenu = allText.filter(([, t]) => /菜单[^\n]{0,20}(并没有|没有)[^\n]{0,20}这一项|当前菜单模板里并没有/.test(t));
claim('「打开启动日志」菜单项，文档说法与实际一致',
  hasLogMenu ? saysNoLogMenu.length === 0 : true,
  hasLogMenu ? (saysNoLogMenu.length ? `实际已加，但 ${saysNoLogMenu.map(([n]) => n).join('、')} 说没有` : '已加，文档一致') : '未加');

// format_spec 是否从 schema 现读
const toolsSrc = read('agent/tools.mjs');
const readsSchema = /recordRequired\(\)/.test(toolsSrc) && /schema', 'record\.schema\.json'/.test(toolsSrc);
const saysMismatch = allText.filter(([, t]) => /format_spec[^\n]{0,80}(漏了|不一致|措辞不一致)/.test(t));
claim('format_spec 的必填字段来源，文档说法与实际一致',
  readsSchema ? saysMismatch.length === 0 : true,
  readsSchema ? (saysMismatch.length ? `实际已改为从 schema 现读，但 ${saysMismatch.map(([n]) => n).join('、')} 仍说漏项` : '从 schema 现读，文档一致') : '仍手写');

/** 工具数在文档里的说法（「12 个工具」「工具恒 12 个」这类） */
{
  const bad = [];
  // 只认「N 个工具」与「工具…N 个」两种写法；中间不许出现 / 或 .mjs——
  // 否则「tools/（9 个 .mjs）」这种**文件数**会被误当成工具数。
  const toolRe = /(?:工具|tools)[^\d\n/]{0,10}?(\d{1,3})\s*个|(\d{1,3})\s*个\s*工具/g;
  for (const [rel, t] of allText) {
    for (const m of t.matchAll(toolRe)) {
      if (m[0].includes('.mjs')) continue;
      const n = Number(m[1] || m[2]);
      if (n >= 5 && n !== TOOLS) {
        const line = t.slice(0, m.index).split('\n').length;
        bad.push(`${rel}:${line}　写「${m[0].trim()}」，实测 ${TOOLS} 个`);
      }
    }
  }
  claim('工具数在文档中与实测一致', bad.length === 0, bad.length ? `${bad.length} 处不符` : `${TOOLS} 个`);
  bad.slice(0, 14).forEach((b) => console.log(`      ${b}`));
}

// 文档里提到的仓库内文件是否真的存在（跳过带 xxx 的模板占位）
const missing = [];
for (const [rel, t] of allText) {
  for (const m of t.matchAll(/`((?:core|server|web|agent|hermes|desktop|schema|knowledge|tools)\/[A-Za-z0-9_./-]+\.(?:mjs|cjs|js|json|css|html))`/g)) {
    if (/xxx/i.test(m[1])) continue;
    if (!fs.existsSync(path.join(ROOT, m[1]))) missing.push(`${rel} → ${m[1]}`);
  }
}
claim('文档引用的源码文件都存在', missing.length === 0,
  missing.length ? `${missing.length} 处不存在：${missing.slice(0, 6).join('；')}` : '');

/* 更新与下载的路径：检测在服务端（程序唯一的**自动**外呼），
   下载在桌面版走主进程通道——不能退回 window.open（那会被 setWindowOpenHandler
   交给系统浏览器，用户点了之后程序没动静，正是被问「不能直接获取下载吗」的原因）。
   这条断言便宜，但少了它，一次随手重构就会把体验悄悄退回浏览器。 */
{
  const appSrcT = read('web/app.js');
  const mainSrcT = desktopSrc;
  const preloadT = preloadSrc;
  claim('「下载新版」在桌面版走主进程通道、不交给浏览器',
    appSrcT.includes("bridge.downloadUpdate({ url, name })")
    && /ipcMain\.handle\('qxg:download-update'/.test(mainSrcT)
    && /downloadUpdate: \(info\)/.test(preloadT)
    && mainSrcT.includes('downloadURL(url)'),
    '抢的是主进程下载通道（setSavePath + 进度事件）');
  claim('下载失败留有「用浏览器下载」的退路',
    appSrcT.includes('用浏览器下载') && appSrcT.includes('openExternal'),
    '网络不通时不至于无路可走');
}

// 文档里提到的自检脚本是否真的存在
const missingScripts = [];
for (const [rel, t] of allText) {
  for (const m of t.matchAll(/tools\/(check[a-z-]*|validate|import|seed)\.mjs/g)) {
    if (!fs.existsSync(path.join(ROOT, 'tools', `${m[1]}.mjs`))) missingScripts.push(`${rel} → tools/${m[1]}.mjs`);
  }
}
claim('文档提到的自检脚本都存在', missingScripts.length === 0,
  missingScripts.length ? missingScripts.slice(0, 6).join('；') : '');

/* ============================================================
 * 四·B、附录 B 那张表与 ADR 编号
 * ------------------------------------------------------------
 * 这两处是上面那套正则的盲区：
 *   · 附录 B 的「套件 → 项数」表，脚本名不在反引号里、项数在另一格里；
 *   · ADR 的编号连续性，没有任何一处会因新增一篇 ADR 而变红。
 * 都是「靠人记」才会对的地方，所以给它们各自一条断言。
 * ========================================================== */
console.log('\n【四·B】附录 B 表与 ADR 编号');

{
  // —— 附录 B 的汇总表 ——
  const sdd = fs.readFileSync(path.join(DOCS, '01-系统设计说明书.md'), 'utf8');
  const tableStart = sdd.indexOf('## 附录 B：自检套件清单');
  const tableEnd = sdd.indexOf('### B.1', tableStart);
  const rows = (tableStart < 0 || tableEnd < 0)
    ? []
    : sdd.slice(tableStart, tableEnd).split('\n').filter((l) => l.trim().startsWith('|'));

  const badAppendix = [];
  let sawTotal = false;
  for (const row of rows) {
    const cells = row.replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
    const nums = cells.map((c) => Number(String(c).replace(/[^\d]/g, '')));
    const scriptCell = cells.find((c) => /\.mjs/.test(c));
    if (scriptCell) {
      const m = scriptCell.match(/tools\/([A-Za-z-]+\.mjs)/);
      const actual = m ? COUNTS[m[1]] : null;
      const claimed = nums.find((n) => Number.isFinite(n) && n > 0);
      if (m && typeof actual === 'number' && claimed !== actual) {
        badAppendix.push(`附录 B：${m[1]} 写 ${claimed}，实测 ${actual}`);
      }
    } else if (/合计/.test(cells[0] || '')) {
      sawTotal = true;
      const claimed = nums.find((n) => n > 100);
      if (TOTAL !== null && claimed !== TOTAL) badAppendix.push(`附录 B 合计：写 ${claimed}，实测 ${TOTAL}`);
    }
  }
  claim('附录 B 的「套件 → 项数」表与实测一致',
    badAppendix.length === 0 && sawTotal,
    badAppendix.length ? badAppendix.join('；') : (sawTotal ? '逐行核对通过' : '没找到合计行'));

  // —— ADR 编号连续，且索引写了最后一篇 ——
  const adrNums = adrFiles
    .map((f) => Number((f.match(/^ADR-(\d{4})/) || [])[1]))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const contiguous = adrNums.every((n, i) => n === adrNums[0] + i && n === i + 1);
  const lastTag = `ADR-${String(adrNums[adrNums.length - 1]).padStart(4, '0')}`;
  const indexed = fs.readFileSync(path.join(DOCS, '00-文档索引.md'), 'utf8').includes(lastTag)
    && fs.readFileSync(path.join(DOCS, 'adr', 'README.md'), 'utf8').includes(lastTag);
  claim('ADR 编号连续且索引写到最后一篇',
    contiguous && indexed,
    `${adrNums.length} 篇，末篇 ${lastTag}${contiguous ? '' : '（编号有断档）'}${indexed ? '' : '（索引没写到它）'}`);
}

/* ============================================================
 * 五、文档自身健康
 * ========================================================== */
console.log('\n【五】文档自身健康');
let broken = 0; let fences = 0; const placeholders = [];
for (const p of docPaths) {
  const t = fs.readFileSync(p, 'utf8');
  const rel = path.relative(ROOT, p);
  if ((t.match(/^```/gm) || []).length % 2 !== 0) fences += 1;
  for (const m of t.matchAll(/(待补充|TODO|TBD|示例待填)/g)) {
    // 允许「不得出现「待补充」」这类规则句
    const line = t.slice(0, m.index).split('\n').pop();
    if (!/不得|禁止|不许|规则/.test(line)) placeholders.push(`${rel}:${t.slice(0, m.index).split('\n').length}`);
  }
  for (const m of t.matchAll(/\]\((\.\/[^)#\s]+\.md)/g)) {
    if (!fs.existsSync(path.resolve(path.dirname(p), m[1]))) { broken += 1; console.log(`      ${rel} → ${m[1]}`); }
  }
}
check('代码围栏全配平', fences === 0, fences ? `${fences} 个文件不配平` : `${docPaths.length} 个文件`);
check('无占位词', placeholders.length === 0, placeholders.slice(0, 5).join('、'));
check('相对链接无失效', broken === 0, broken ? `${broken} 条` : '');
check('docs/ 下无临时文件', fs.readdirSync(DOCS).filter((f) => f.startsWith('_')).length === 0);

console.log(`\n———— 通过 ${pass} 项，失败 ${fail} 项 ————`);

// 把本套自己的项数也记进清单，供下一轮比对——
// 否则「check-docs 自己写在文档里的项数」就成了没人守的那一格。
//
// ⚠️ 这里记的是**总项数（pass + fail）**，不是通过数。
// 因为本套会读自己：若记通过数，失败时通过数变小、写回清单、下轮又报不符，
// 永远收敛不了。总项数与结果无关，才是稳定的那个数。
try {
  const m = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
  m['check-docs.mjs'] = pass + fail;
  fs.writeFileSync(manifestFile, `${JSON.stringify(m, null, 2)}\n`, 'utf8');
} catch { /* 写不了不影响自检本身 */ }

if (fail) {
  console.log('\n文档落后于代码了。改法：把上面每条 `✗` 点名的位置改成实测值，');
  console.log('再跑一次 `npm run check:all`（它会顺带刷新 docs/.counts.json）。\n');
  process.exit(1);
}
console.log('文档与代码一致。\n');
