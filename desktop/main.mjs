/**
 * 问心卦 · 桌面版主进程（Electron）
 * ------------------------------------------------------------
 * 与 DeepSeek Harness 同一形态：一个自带 Chromium 的桌面程序，
 * 双击即开，独立窗口、独立任务栏图标、托盘、开始菜单快捷方式。
 *
 * 关键设计：
 *   1. **服务跑在本进程内**——直接 import server/index.mjs，不 spawn 子进程，
 *      所以不会闪出黑色控制台窗口，也不需要用户机器上装 Node。
 *   2. 数据目录在 import 服务**之前**定好（QXG_DATA_DIR），免得服务自己
 *      挑了安装目录里的 data/ ——那样一升级就被覆盖。
 *   3. 窗口尺寸、位置、最大化状态记在 userData 里，下次照原样开。
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import {
  app as electronApp, BrowserWindow, Menu, Tray, shell, dialog,
  nativeImage, ipcMain, screen,
} from 'electron';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IS_DEV = !electronApp.isPackaged;

/**
 * 启动日志。桌面版没有控制台可看，出了问题只能靠它。
 * 位置：<userData>/desktop.log；菜单「帮助 → 打开日志」可以直接打开。
 */
let LOG_FILE = null;
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (typeof a === 'string' ? a : (a?.stack || JSON.stringify(a)))).join(' ')}`;
  try {
    if (!LOG_FILE) {
      LOG_FILE = path.join(electronApp.getPath('userData'), 'desktop.log');
      fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    }
    fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
  } catch { /* 日志写不了也不能因此挂掉 */ }
  // 开发时顺便打到控制台
  if (IS_DEV) process.stdout.write(`${line}\n`);
}
export { log as _log };

process.on('uncaughtException', (err) => log('uncaughtException', err));
process.on('unhandledRejection', (err) => log('unhandledRejection', err));

log('--- main.mjs 启动 ---', {
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  packaged: electronApp.isPackaged,
  resourcesPath: process.resourcesPath,
  argv: process.argv.slice(0, 4),
});

/* ---------- 代码根目录：开发态在项目里，打包后在 resources/app ---------- */
const CODE_ROOT = IS_DEV
  ? path.resolve(HERE, '..')
  : path.join(process.resourcesPath, 'app');
log('代码根目录', CODE_ROOT);

/* ---------- 数据目录 ---------- */
const userDataDir = electronApp.getPath('userData');
const dirPrefFile = path.join(userDataDir, 'data-dir.json');

function readDirPref() {
  try {
    const p = JSON.parse(fs.readFileSync(dirPrefFile, 'utf8'));
    return p?.dataDir && fs.existsSync(p.dataDir) ? p.dataDir : null;
  } catch {
    return null;
  }
}

function writeDirPref(dir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(dirPrefFile, JSON.stringify({ dataDir: dir }, null, 2), 'utf8');
}

/**
 * 桌面版的数据目录：
 *   1. 用户显式选过的（data-dir.json）
 *   2. 开发态：项目里的 data/（就是你现有的六条卦录）
 *   3. 安装态：%APPDATA%\问心卦\data，首次从随包的 seed-data 复制一份
 * 绝不放在安装目录里——升级会覆盖 resources/app。
 */
function resolveDesktopDataDir() {
  const chosen = readDirPref();
  if (chosen) return { dir: chosen, mode: 'chosen' };

  if (IS_DEV) {
    const d = path.join(CODE_ROOT, 'data');
    fs.mkdirSync(d, { recursive: true });
    return { dir: d, mode: 'dev' };
  }

  const d = path.join(electronApp.getPath('appData'), '问心卦', 'data');
  fs.mkdirSync(d, { recursive: true });
  seedIfEmpty(d);
  return { dir: d, mode: 'appdata' };
}

function seedIfEmpty(targetDir) {
  try {
    const records = path.join(targetDir, 'records');
    if (fs.existsSync(records) && fs.readdirSync(records).some((f) => f.endsWith('.json'))) return;
    const seed = path.join(process.resourcesPath, 'seed-data');
    if (!fs.existsSync(seed)) return;
    fs.cpSync(seed, targetDir, { recursive: true });
  } catch (err) {
    console.warn('[desktop] 复制初始数据失败：', err.message);
  }
}

const DATA = resolveDesktopDataDir();
log('数据目录已定', DATA);
// 必须在 import 服务之前设好
process.env.QXG_DATA_DIR = DATA.dir;

/* ---------- 窗口状态 ---------- */
const stateFile = path.join(userDataDir, 'window-state.json');

function loadWindowState() {
  const def = { width: 1320, height: 900, x: undefined, y: undefined, maximized: false };
  try {
    const s = { ...def, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) };
    // 屏幕数变了的话，之前的位置可能已经在屏幕外，此时回到默认
    if (s.x !== undefined && s.y !== undefined) {
      const visible = screen.getAllDisplays().some((d) => {
        const b = d.workArea;
        return s.x < b.x + b.width - 80 && s.x + s.width > b.x + 80
          && s.y < b.y + b.height - 80 && s.y + s.height > b.y + 40;
      });
      if (!visible) { s.x = undefined; s.y = undefined; }
    }
    return s;
  } catch {
    return def;
  }
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getNormalBounds();
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({
      ...b, maximized: win.isMaximized(),
    }, null, 2), 'utf8');
  } catch { /* 记不住就算了，不值得因此报错 */ }
}

/* ---------- 单实例 ----------
 * ⚠️ 这里**不能**用顶层 await。Electron 的 ready 事件要等主模块求值完成后才发出，
 * 若在顶层 await app.whenReady()，模块求值被挂起、ready 永远不发 —— 直接死锁，
 * 表现就是「进程在跑但没有窗口、日志停在某一行为止」。
 * 所以：模块同步求值完毕，再在 whenReady 的回调里跑 main()。
 */
if (!electronApp.requestSingleInstanceLock()) {
  log('已有实例在运行，本实例退出');
  electronApp.quit();
} else {
  electronApp.on('second-instance', () => {
    log('用户再次启动，前置已有窗口');
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  });

  electronApp.whenReady().then(() => {
    log('app ready，开始初始化');
    return main();
  }).catch((err) => {
    log('启动失败', err);
    dialog.showErrorBox('问心卦启动失败', `${err?.stack || err}`);
    electronApp.exit(1);
  });
}

let mainWindow = null;
let tray = null;
let serverHandle = null;
/** 最近一次监听的地址，供 IPC 与菜单里的 fetch 用 */
let currentUrl = '';

async function main() {
  electronApp.setAppUserModelId('local.wenxingua.desktop');

  // 关掉所有窗口不等于退出（有托盘）
  electronApp.on('window-all-closed', () => {
    if (process.platform !== 'darwin') electronApp.quit();
  });

  /* ---------- 1. 起服务（在本进程内） ---------- */
  const serverEntry = path.join(CODE_ROOT, 'server', 'index.mjs');
  if (!fs.existsSync(serverEntry)) {
    dialog.showErrorBox('问心卦启动失败', `找不到服务代码：\n${serverEntry}`);
    electronApp.exit(1);
    return;
  }
  const mod = await import(pathToFileURL(serverEntry).href);
  log('服务模块已载入');
  const srv = mod.app;

  let started;
  try {
    started = await srv.listen(19730, '127.0.0.1', { quiet: true });
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      // 端口被占（可能另开着一个命令行版），换一个空闲端口就是
      started = await srv.listen(0, '127.0.0.1', { quiet: true });
    } else {
      dialog.showErrorBox('问心卦启动失败', err?.stack || String(err));
      electronApp.exit(1);
      return;
    }
  }
  serverHandle = srv;
  const APP_URL = started.url;
  currentUrl = APP_URL;
  log('服务已监听', started);
  console.log(`[desktop] 服务已就绪 ${APP_URL}　数据目录 ${DATA.dir}（${DATA.mode}）`);

  /* ---------- 2. 窗口 ---------- */
  const st = loadWindowState();
  mainWindow = new BrowserWindow({
    width: st.width,
    height: st.height,
    x: st.x,
    y: st.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: '问心卦',
    backgroundColor: '#0b0e13',
    icon: iconPath(),
    autoHideMenuBar: false,
    webPreferences: {
      // ⚠️ preload 必须是 .cjs：Electron 默认 sandbox: true，**沙箱化的 preload 不能是 ES 模块**。
      //    写成 .mjs + import 会静默失败——window.__qxgDesktop 永远是 undefined 却不报错。
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  if (st.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  // 外链一律交给系统浏览器，不在应用里开新窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url) && !url.startsWith(APP_URL)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(APP_URL)) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('close', () => saveWindowState(mainWindow));
  mainWindow.on('closed', () => { mainWindow = null; });

  /* ---------- 3. 渲染进程可调的能力 ----------
   * ⚠️ 必须在 loadURL **之前**注册：页面一加载完就可能来调，
   *    注册晚了会得到 "No handler registered for 'qxg:info'"。
   */
  registerIpc();

  log('窗口已创建，开始 loadURL');
  await mainWindow.loadURL(APP_URL);
  log('loadURL 完成');

  /* ---------- 自查用：--selftest 跑一组断言后退出 ----------
   * 桌面版没法用无头浏览器验，这个开关把「真实窗口里到底成不成」变成可断言的结果。
   * 由 tools/check-desktop.mjs 调用。
   */
  if (process.argv.includes('--selftest')) {
    const results = [];
    const probe = async (name, js, expect) => {
      try {
        const v = await mainWindow.webContents.executeJavaScript(`(async () => { ${js} })()`);
        const ok = typeof expect === 'function' ? expect(v) : v === expect;
        results.push({ name, ok, value: v });
      } catch (err) {
        results.push({ name, ok: false, value: `抛错：${err.message}` });
      }
    };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    await wait(1200);
    await probe('渲染进程拿到桌面桥', 'return !!window.__qxgDesktop && window.__qxgDesktop.isDesktop === true;', true);
    await probe('桌面桥能取版本与数据目录',
      'const i = await window.__qxgDesktop.info(); return { v: i.version, dir: i.dataDir, packaged: i.packaged, chrome: i.chrome };',
      (v) => v && typeof v.v === 'string' && typeof v.dir === 'string' && v.dir.length > 3);
    await probe('状态栏标出这是桌面版', 'return document.getElementById("status").innerText.includes("桌面版");', true);
    await probe('总览有桌面专属按钮',
      'return !!document.querySelector("#d-open-data") && !!document.querySelector("#d-export");', true);
    /* 侧栏的构成：六项常驻主项（不滚动） + 一个**自带滚动**的插件组。
       插件页面是用户数据、数量不定，所以它们不进 .nav：`.nav a` 是「常驻主项」的
       几何口径，下面两条断言（数六项、量末项底边）都按它算，混进来就是假红。 */
    await probe('侧栏＝六项常驻主项 + 自带滚动的插件组（临时项不计）',
      `const main = document.querySelectorAll('.nav a:not(.temp)').length;
       const plug = [...document.querySelectorAll('#nav-extra a')].map(a => a.dataset.path);
       const grp = document.querySelector('#nav-extra .nav-grp');
       const sc = document.querySelector('#nav-extra .nav-scroll');
       return { main, plug, grp: grp ? grp.innerText.replace(/\\s+/g, '') : '',
                scrollsOwn: sc ? getComputedStyle(sc).overflowY : '' };`,
      (v) => v && v.main === 6 && v.plug.includes('#/plugins') && v.plug.length >= 2
        && v.grp === '插件' && v.scrollsOwn === 'auto');

    /* 用户明确抱怨过「侧栏塞太多、要靠滚动条」——这条断言就是在守它 */
    await probe('侧栏不出现滚动条（所有导航项都在视野内）',
      `const s = document.querySelector('.side');
       const nav = document.querySelector('.nav');
       const foot = document.querySelector('.side-foot');
       const overflow = s.scrollHeight - s.clientHeight;
       return { sideScroll: s.scrollHeight, sideClient: s.clientHeight, overflow,
                navBottom: Math.round(nav.getBoundingClientRect().bottom),
                footBottom: Math.round(foot.getBoundingClientRect().bottom),
                sideBottom: Math.round(s.getBoundingClientRect().bottom) };`,
      (v) => v && v.overflow <= 1 && v.footBottom <= v.sideBottom + 1);
    await probe('侧栏六项一屏放得下（末项底边在侧栏底边之上）',
      `const a = document.querySelectorAll('.nav a');
       const last = a[a.length - 1].getBoundingClientRect();
       return { lastBottom: Math.round(last.bottom), sideBottom: Math.round(document.querySelector('.side').getBoundingClientRect().bottom) };`,
      (v) => v && v.lastBottom <= v.sideBottom);

    await probe('顶栏齐备（品牌·搜索·起卦·健康灯）',
      'return !!document.querySelector(".top-brand") && !!document.querySelector("#top-search") && !!document.querySelector("#top-cast") && !!document.querySelector("#top-health");', true);
    await probe('底部状态栏齐备且非空',
      'const s = document.getElementById("status"); return { len: s.innerText.trim().length, hasVer: /v\\d+\\.\\d+/.test(s.innerText), hasDir: s.innerText.includes("问心卦") };',
      (v) => v && v.len > 20 && v.hasVer && v.hasDir);

    // 「默认就开着」要在任何 Esc 之前断言——后面有探针会按 Esc，而 Esc 也会收面板
    await probe('助手面板默认打开（用户要的是随时能问）',
      `return { open: document.body.classList.contains('agent-open'),
                hasSessions: !!document.getElementById('ap-sessions'),
                docked: !!document.getElementById('ap-resize') };`,
      (v) => v && v.open === true && v.hasSessions === true && v.docked === true);

    /* 对话日志里的卡片必须**真的看得见**。这是真出过的 bug（用户的原话：「没有思考过程的
       那个动画」「点展开全部思考也没有任何思维链」）：日志是 flex 竖列 + 滚动，而 flex 子项的
       自动最小高度在它自己的 overflow 不是 visible 时会退化成 0——思考卡与工具卡都写了
       overflow:hidden，于是内容一多就被压成几像素的窄条、正文全被裁掉，日志也不再滚动
       （scrollHeight === clientHeight）。这类 bug 不报错、只是「什么都看不见」，DOM 桩也测不到，
       所以必须在这里量**真实几何**：塞一组卡片进去，量高度与能否滚动，量完撤掉。 */
    await probe('对话日志：思考卡/工具卡不被压扁，日志能滚动',
      `const log = document.querySelector('[data-chat-log]');
       if (!log) return { err: '找不到 [data-chat-log]' };
       const made = [];
       for (let i = 0; i < 12; i += 1) {
         const t = document.createElement('div');
         t.className = 'trace-think open';
         t.innerHTML = '<div class="th"><span class="badge">✻</span><b>思考</b></div>'
           + '<div class="tb"><div class="tx">' + '思维链的一段文字。'.repeat(40) + '</div></div>';
         log.append(t); made.push(t);
         const k = document.createElement('div');
         k.className = 'trace-tool ok';
         k.innerHTML = '<div class="th"><span class="badge">◈</span><b>起卦</b></div>';
         log.append(k); made.push(k);
       }
       const p = document.createElement('div');
       p.className = 'trace-think pending';
       p.innerHTML = '<div class="th"><span class="badge">✻</span><b>正在思考…</b></div>';
       log.append(p); made.push(p);
       await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
       const hs = made.map((e) => Math.round(e.getBoundingClientRect().height));
       const out = { minCard: Math.min(...hs.slice(0, -1)), pending: hs[hs.length - 1],
                     client: log.clientHeight, scroll: log.scrollHeight,
                     canScroll: log.scrollHeight > log.clientHeight + 2 };
       for (const e of made) e.remove();
       return out;`,
      (v) => v && v.minCard >= 20 && v.pending >= 12 && v.canScroll === true);

    /* 命令面板：散杂入口的最终归宿 */
    // 面板里的「页面/操作」是本地匹配，同步就出；「卦录」要走接口，得等。
    // 所以凡涉及后端的断言一律**轮询**，不用固定 sleep——固定 sleep 会在
    // 冷启动时偶发失败（第一版就是栽在这上面，同一断言两次跑一过一败）。
    const waitUntil = (jsCond, timeoutMs = 4000) => `
      for (let i = 0; i < ${Math.ceil(timeoutMs / 100)}; i += 1) {
        if (${jsCond}) return true;
        await new Promise(r => setTimeout(r, 100));
      }
      return false;`;

    /**
     * 与 waitUntil 的区别：这个**不 return**，只是等条件成立，然后继续往下走。
     * 需要先等、再取值的探针必须用它——用 waitUntil 会在条件一成立时
     * 就把整个探针结束掉，后面的取值语句根本轮不到执行（踩过）。
     */
    const waitFor = (jsCond, timeoutMs = 5000) => `
      await (async () => {
        for (let i = 0; i < ${Math.ceil(timeoutMs / 100)}; i += 1) {
          if (${jsCond}) return true;
          await new Promise(r => setTimeout(r, 100));
        }
        return false;
      })();`;

    /* 侧栏的临时项：钻进侧栏外页面时补一格并高亮，离开就消失，且不撑破「六项一屏放得下」 */
    await mainWindow.webContents.executeJavaScript('location.hash = "#/docs";');
    await probe('侧栏外页面对应一个临时项且高亮',
      `${waitFor("!!document.querySelector('#nav a.temp')")}
       const t = document.querySelector('#nav a.temp');
       return { n: document.querySelectorAll('.nav a').length,
                temp: !!t, on: t ? t.classList.contains('on') : false,
                txt: t ? t.innerText.replace(/\\s+/g, '') : '' };`,
      (v) => v && v.n === 7 && v.temp === true && v.on === true);
    await mainWindow.webContents.executeJavaScript('location.hash = "#/records";');
    await probe('离开侧栏外页面后临时项消失；插件页则改在插件组里高亮，不另补「临」项',
      `${waitFor("!document.querySelector('#nav a.temp')")}
       const left = { n: document.querySelectorAll('.nav a').length, temp: !!document.querySelector('#nav a.temp') };
       location.hash = '#/plugin/review-watch/due';
       ${waitFor("!!document.querySelector('#nav-extra a.on')")}
       const on = document.querySelector('#nav-extra a.on');
       const plugPath = on ? on.dataset.path : '';
       const plugTemp = !!document.querySelector('#nav a.temp');
       location.hash = '#/records';
       ${waitFor("!document.querySelector('#nav a.temp')")}
       return { n: left.n, temp: left.temp, plugPath, plugTemp };`,
      (v) => v && v.n === 6 && v.temp === false
        && v.plugPath === '#/plugin/review-watch/due' && v.plugTemp === false);

    await probe('命令面板能打开并列出结果',
      `window.__qxg.palette.open('导出');
       await new Promise(r => setTimeout(r, 200));
       const rows = document.querySelectorAll('.pl-row');
       return { open: document.querySelector('.palette-mask').classList.contains('on'), rows: rows.length };`,
      (v) => v && v.open && v.rows >= 1);
    await probe('命令面板搜得到「格式」「卦典」「插件」这些侧栏外入口',
      `const out = [];
       for (const q of ['格式','卦典','插件']) {
         window.__qxg.palette.open(q);
         await new Promise(r => setTimeout(r, 150));
         out.push(document.querySelectorAll('.pl-row').length);
       }
       window.__qxg.palette.close();
       return out;`,
      (v) => Array.isArray(v) && v.every((n) => n >= 1));
    await probe('命令面板能搜到卦录（走接口）',
      `window.__qxg.palette.open('心愿');
       let apiHit = null;
       try { const r = await fetch('/api/records?q=心愿').then(x => x.json()); apiHit = (r.items || []).length; }
       catch (e) { apiHit = 'fetch 失败：' + e.message; }
       // 注意：面板里第一条永远是「问助手」，所以不能只数行数——
       // 要等到**出现类型为「卦录」的那一行**才算数
       ${waitFor("[...document.querySelectorAll('.pl-row')].some(r => r.innerText.includes('卦录'))")}
       const rows = [...document.querySelectorAll('.pl-row')].map(r => r.innerText);
       window.__qxg.palette.close();
       return { apiHit, n: rows.length, kinds: rows.filter(t => t.includes('卦录')).length, sample: rows.slice(0, 2) };`,
      (v) => v && v.kinds >= 1);
    await probe('按 Esc 能关掉命令面板',
      `const P = window.__qxg.palette;
       P.open(''); await new Promise(r=>setTimeout(r,80));
       const afterOpen = P.isOpen();
       const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
       const dispatched = window.dispatchEvent(ev);
       await new Promise(r=>setTimeout(r,80));
       return { afterOpen, dispatched, defaultPrevented: ev.defaultPrevented, afterEsc: P.isOpen() };`,
      (v) => v && v.afterOpen === true && v.afterEsc === false);

    /* 助手面板：停靠在右侧的一栏，默认就开着（范式取自 IDE 的 agent 面板） */
    await probe('顶栏有「助手」按钮', 'return !!document.querySelector("#top-ai");', true);
    // 注意：这之前有一条「按 Esc 关掉命令面板」的探针，它会把面板一并收起
    // （Esc 现在也收面板）。所以这里先显式打开，再验「停靠」这件事。
    await probe('助手面板可打开，且是停靠而不是弹层',
      `window.__qxg.openPanel();
       ${waitFor('document.body.classList.contains("agent-open")')}
       const p = document.getElementById('agent-panel');
       const app = document.querySelector('.app');
       return {
         open: document.body.classList.contains('agent-open'),
         hasInput: !!p.querySelector('[data-chat-input]'),
         hasLog: !!p.querySelector('[data-chat-log]'),
         hasSessions: !!document.getElementById('ap-sessions'),
         // 停靠：主区让出宽度（.app 的 padding-right 等于面板宽）
         givesWay: getComputedStyle(app).paddingRight !== '0px',
       };`,
      (v) => v && v.open && v.hasInput && v.hasLog && v.hasSessions && v.givesWay);
    await probe('面板脚注显示会话、权限与模型（用户要知道助手现在有多大权）',
      `const t = document.getElementById('ap-foot').innerText;
       return { len: t.trim().length, hasSession: t.includes('会话'), hasPerm: t.includes('权限') };`,
      (v) => v && v.len > 10 && v.hasSession && v.hasPerm);
    await probe('按 Esc 能收起面板',
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
       await new Promise(r=>setTimeout(r,150));
       return document.body.classList.contains('agent-open');`, false);
    await probe('按 Ctrl+J 能把面板再开回来',
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true }));
       ${waitFor('document.body.classList.contains("agent-open")')}
       return document.body.classList.contains('agent-open');`, true);
    await probe('面板宽度可调且改的是 --panel-w 一个变量',
      `window.__qxg.setPanelWidth(460);
       const v = getComputedStyle(document.documentElement).getPropertyValue('--panel-w').trim();
       const w = document.getElementById('agent-panel').getBoundingClientRect().width;
       window.__qxg.setPanelWidth(380);
       return { v, w: Math.round(w) };`,
      (v) => v && v.v === '460px' && Math.abs(v.w - 460) <= 2);
    await probe('命令面板里输自然语言，第一条就是「问助手」',
      `window.__qxg.palette.open('帮我看看最近的走势');
       await new Promise(r=>setTimeout(r,220));
       const first = document.querySelector('.pl-row');
       const txt = first ? first.innerText : '';
       window.__qxg.palette.close();
       return { hit: txt.includes('问助手'), txt: txt.slice(0, 40) };`,
      (v) => v && v.hit);

    await probe('页面标题正确', 'return document.title.includes("问心卦");', true);

    // 菜单/托盘跳转用的通道
    await probe('能响应主进程跳转指令',
      'window.__qxgDesktop.onNavigate(() => {}); return typeof window.__qxgDesktop.onNavigate === "function";', true);

    // 逐页跳一遍，确认桌面窗口里各页都能渲染。
    // 同样**轮询**而不是固定等待：每页都要取接口，冷启动时可能慢过固定值。
    for (const [hash, needle] of [['#/trend', '吉凶诸线'], ['#/cast', '起 卦 之 法'], ['#/agent', '模 型 设 置'], ['#/import', '卦 条 v1'], ['#/records', '吉凶不限']]) {
      await mainWindow.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)};`);
      await probe(`路由 ${hash} 渲染出「${needle}」`,
        `${waitUntil(`document.body.innerText.includes(${JSON.stringify(needle)})`, 5000)}`, true);
    }
    // 回卦录详情，确认断语七段都在
    await mainWindow.webContents.executeJavaScript('location.hash = "#/record/202609280312-01";');
    await probe('卦录详情七段定调俱全',
      `${waitUntil('document.body.innerText.includes("卦 象 定 调") && document.body.innerText.includes("应期")', 5000)}
       const t = document.body.innerText;
       return ["主","互","变","断","宜","忌","应期"].every(k => t.includes(k)) && t.includes("卦 象 定 调");`, true);

    /* 设置页：权限档要能选，帮助要能读 */
    await mainWindow.webContents.executeJavaScript('location.hash = "#/settings";');
    await probe('设置页列出四档权限且可点',
      `${waitFor("document.querySelectorAll('[data-perm]').length === 4")}
       const cards = [...document.querySelectorAll('[data-perm]')].map(c => c.dataset.perm);
       return { n: cards.length, ids: cards.join(','), on: document.querySelectorAll('[data-perm].on').length };`,
      (v) => v && v.n === 4 && v.ids === 'read,write,delete,full' && v.on === 1);
    // 面板不再是「弹层」，所以设置页里也照常开合——旧版那种「这一页禁用抽屉」的特殊规则已去掉
    await probe('设置页里也能开合面板，且不把人弹走',
      `const before = location.hash;
       window.__qxg.closePanel();
       await new Promise(r=>setTimeout(r,120));
       const closed = !document.body.classList.contains('agent-open');
       window.__qxg.openPanel();
       ${waitFor('document.body.classList.contains("agent-open")')}
       return { closed, open: document.body.classList.contains('agent-open'), stayed: location.hash === before };`,
      (v) => v && v.closed === true && v.open === true && v.stayed === true);
    /* 皮肤（ADR-0014）：设置页「外观」区照插件清单列全；点一款即换整套设计语言，
       选回默认即复原。比的是**计算后的 --bg**——这是「整套令牌真的生效」最硬的证据，
       光看属性写成没有用（属性对了、样式没挂上也白搭）。插件被停用时，后一条会跳过。 */
    await probe('设置页「外 观」区与插件注册的皮肤清单一致',
      `${waitFor("document.querySelectorAll('[data-skin-opt]').length >= 1")}
       const opts = [...document.querySelectorAll('[data-skin-opt]')];
       const meta = await fetch('/api/meta').then(r => r.json()).catch(() => ({}));
       const want = (meta.plugins?.skins || []).map(s => s.id);
       return { n: opts.length,
                hasDefault: opts.some(o => o.dataset.skinOpt === ''),
                missing: want.filter(id => !opts.some(o => o.dataset.skinOpt === id)),
                wantN: want.length,
                on: opts.filter(o => o.classList.contains('on')).map(o => o.dataset.skinOpt) };`,
      (v) => v && v.hasDefault && v.missing.length === 0 && v.on.length === 1 && v.on[0] === '');
    await probe('点一款皮肤即换整套令牌，选回默认即复原',
      `const root = document.documentElement;
       const bg0 = getComputedStyle(root).getPropertyValue('--bg').trim();
       const btn = document.querySelector('[data-skin-opt]:not([data-skin-opt=""])');
       if (!btn) return { skip: true, why: '没有可用的皮肤（插件已停用？）' };
       const id = btn.dataset.skinOpt;
       btn.click();
       await new Promise(r => setTimeout(r, 320));
       const link = document.getElementById('skin-css');
       const applied = { attr: root.dataset.skin || '',
                         bg: getComputedStyle(root).getPropertyValue('--bg').trim(),
                         css: link ? link.getAttribute('href') : '' };
       const back = document.querySelector('[data-skin-opt=""]');
       if (back) back.click();
       await new Promise(r => setTimeout(r, 320));
       const restored = { attr: root.dataset.skin || '',
                          hasLink: !!document.getElementById('skin-css'),
                          bg: getComputedStyle(root).getPropertyValue('--bg').trim() };
       return { id, bg0, applied, restored };`,
      (v) => v && (v.skip === true
        || (v.applied.attr === v.id && v.applied.bg !== v.bg0 && v.applied.css.includes('/skin/')
          && v.restored.attr === '' && v.restored.hasLink === false && v.restored.bg === v.bg0)));

    /* 文档页：独立的阅读器（左目录、右正文），文档不挤在设置页里 */
    await mainWindow.webContents.executeJavaScript('location.hash = "#/docs";');
    await probe('文档页能内嵌读文档',
      `${waitFor("!!document.querySelector('[data-doc=\\'index\\']')")}
       const item = document.querySelector('[data-doc="index"]');
       if (!item) return { ok: false, why: '文档目录没渲染出来' };
       item.click();
       ${waitFor("(() => { const m = document.getElementById('d-md'); return m && m.innerText.length > 200; })()")}
       const md = document.getElementById('d-md');
       return { ok: !!md, len: md ? md.innerText.length : 0 };`,
      (v) => v && v.ok && v.len > 200);
    await probe('文档里的外链被拦住，不会直接跳走',
      `const a = document.querySelector('#d-md a[href^="http"]');
       if (!a) return { skip: true, why: '这篇文档里没有外链' };
       a.click();
       await new Promise(r=>setTimeout(r,220));
       const hasDialog = !!document.querySelector('.modal-mask');
       if (hasDialog) document.querySelector('.modal-mask').remove();
       return { hasDialog, href: location.href };`,
      (v) => v && (v.skip === true || v.hasDialog === true));

    /* 文档深链：桌面菜单的「帮助」直接落到某一篇 */
    await mainWindow.webContents.executeJavaScript('location.hash = "#/docs/readme";');
    await probe('文档可深链：路由直达某一篇并内嵌渲染',
      `${waitFor("(() => { const m = document.getElementById('d-md'); return m && m.innerText.length > 200; })()")}
       const m = document.getElementById('d-md');
       return { ok: !!m, len: m ? m.innerText.length : 0 };`,
      (v) => v && v.ok && v.len > 200);

    /* 插件启停后侧栏要跟得上：没有这个入口，侧栏插件组会留着一条点进去 404 的死链 */
    await probe('暴露了重取 meta 的入口，且能重画侧栏插件组',
      `const f = typeof window.__qxg.refreshMeta === 'function';
       const box = document.getElementById('nav-extra');
       const before = box.innerHTML.length;
       await window.__qxg.refreshMeta();
       return { f, before, after: box.innerHTML.length, items: box.querySelectorAll('a').length };`,
      (v) => v && v.f && v.before > 0 && v.after > 0 && v.items >= 2);

    const failed = results.filter((r) => !r.ok);
    console.log(`[selftest]${JSON.stringify({ total: results.length, failed: failed.length, results })}`);
    await serverHandle?.close();
    electronApp.exit(failed.length ? 1 : 0);
    return;
  }

  /* ---------- 自查用：--shot=<png 路径> 截图后退出 ----------
   * 桌面版没法用无头浏览器截，这个开关让「真实窗口里长什么样」可被自动验证。
   * 用法：electron . --shot=out.png [--shot-hash=#/trend] [--shot-delay=3000]
   */
  const shotArg = process.argv.find((a) => a.startsWith('--shot='));
  if (shotArg) {
    const out = shotArg.slice('--shot='.length);
    const hash = (process.argv.find((a) => a.startsWith('--shot-hash=')) || '').slice('--shot-hash='.length);
    const delay = Number((process.argv.find((a) => a.startsWith('--shot-delay=')) || '').slice('--shot-delay='.length)) || 2600;
    if (hash) {
      await mainWindow.webContents.executeJavaScript(
        `location.hash = ${JSON.stringify(hash)}; new Promise(r => setTimeout(r, 900));`,
      );
    }
    await new Promise((r) => setTimeout(r, delay));
    try {
      const img = await mainWindow.webContents.capturePage();
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(path.resolve(out), img.toPNG());
      log('已截图', out, `${img.getSize().width}x${img.getSize().height}`);
      console.log(`[shot] ${out}`);
    } catch (err) {
      log('截图失败', err);
    }
    await serverHandle?.close();
    electronApp.exit(0);
    return;
  }

  /* ---------- 3. 菜单 ---------- */
  buildMenu(APP_URL);

  /* ---------- 4. 托盘 ---------- */
  buildTray();

  electronApp.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = null;
    if (!mainWindow) { mainWindow = BrowserWindow.getAllWindows()[0] || null; }
  });

  // 退出前把服务关干净，避免留下占用的端口
  electronApp.on('before-quit', async () => {
    try { await serverHandle?.close(); } catch { /* 忽略 */ }
  });
}

/**
 * 注册渲染进程可调的能力（preload.cjs 里那几个口子的另一端）。
 * ⚠️ 必须在 loadURL **之前**调用：页面一加载完就可能来调，
 *    注册晚了会得到 "No handler registered for 'qxg:info'"。
 */
function registerIpc() {
  ipcMain.handle('qxg:info', () => ({
    version: electronApp.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    dataDir: DATA.dir,
    dataMode: DATA.mode,
    packaged: electronApp.isPackaged,
    url: currentUrl,
    userDataDir,
  }));

  ipcMain.handle('qxg:open-data-dir', async () => {
    await shell.openPath(DATA.dir);
    return DATA.dir;
  });

  ipcMain.handle('qxg:open-backups', async () => {
    const dir = path.join(DATA.dir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
    return dir;
  });

  ipcMain.handle('qxg:export-backup', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '导出整包备份',
      defaultPath: `问心卦-备份-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    const res = await fetch(`${currentUrl}api/export?format=json`);
    fs.writeFileSync(filePath, await res.text(), 'utf8');
    return { ok: true, filePath };
  });

  ipcMain.handle('qxg:reveal-record-file', async (_e, id) => {
    const f = path.join(DATA.dir, 'records', `${String(id).replace(/[^\w.-]/g, '_')}.json`);
    if (!fs.existsSync(f)) return { ok: false };
    shell.showItemInFolder(f);
    return { ok: true, filePath: f };
  });

  ipcMain.handle('qxg:choose-data-dir', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '选择数据目录（卦录将存在这里）',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: DATA.dir,
    });
    if (canceled || !filePaths?.length) return { ok: false, canceled: true };
    writeDirPref(filePaths[0]);
    const r = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
      message: '数据目录已记录，需要重启后生效。',
      detail: `新目录：${filePaths[0]}\n\n原目录的数据不会自动搬过去；如需搬移，请手动复制 records/ 里的文件。`,
    });
    if (r.response === 0) { electronApp.relaunch(); electronApp.exit(0); }
    return { ok: true, dataDir: filePaths[0] };
  });
}

function iconPath() {
  const p = path.join(HERE, 'build', 'icon.png');
  return fs.existsSync(p) ? p : undefined;
}

function trayIconPath() {
  const p = path.join(HERE, 'build', 'tray.png');
  return fs.existsSync(p) ? p : iconPath();
}

function buildTray() {
  const img = nativeImage.createFromPath(trayIconPath());
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('问心卦 · 卦录台');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开问心卦', click: () => showWindow() },
    { label: '起一卦', click: () => showWindow('#/cast') },
    { label: '走势', click: () => showWindow('#/trend') },
    { type: 'separator' },
    { label: '打开数据目录', click: () => shell.openPath(DATA.dir) },
    { type: 'separator' },
    { label: '退出', click: () => { electronApp.quit(); } },
  ]));
  tray.on('double-click', () => showWindow());
}

function showWindow(hash = '') {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (hash) mainWindow.webContents.send('qxg:navigate', hash);
}

function buildMenu(APP_URL) {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '问心卦',
      submenu: [
        {
          label: '关于问心卦',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '关于问心卦',
            message: `问心卦 · 梅花易数卦录台　v${electronApp.getVersion()}`,
            detail: [
              `Electron ${process.versions.electron}　Chromium ${process.versions.chrome}　Node ${process.versions.node}`,
              '',
              `数据目录：${DATA.dir}`,
              `数据位置：${DATA.mode === 'appdata' ? '用户目录（安装态）' : DATA.mode === 'dev' ? '项目目录（开发态）' : '自选目录'}`,
              '',
              '零第三方依赖（内核）；卦象一律由引擎依正法算出。',
              '卦象仅供参考，决断在己。',
            ].join('\n'),
          }),
        },
        { type: 'separator' },
        { label: '起一卦', accelerator: 'CmdOrCtrl+N', click: () => showWindow('#/cast') },
        { label: '导入卦象', accelerator: 'CmdOrCtrl+I', click: () => showWindow('#/import') },
        { label: '走势', accelerator: 'CmdOrCtrl+T', click: () => showWindow('#/trend') },
        { type: 'separator' },
        { label: '重新加载界面', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.reload() },
        { label: '强制重载', accelerator: 'CmdOrCtrl+Shift+R', click: () => mainWindow?.webContents.reloadIgnoringCache() },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { label: '退出', accelerator: 'Alt+F4', click: () => electronApp.quit() },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '数据',
      submenu: [
        { label: '打开数据目录', click: () => shell.openPath(DATA.dir) },
        {
          label: '打开备份目录',
          click: () => {
            const d = path.join(DATA.dir, 'backups');
            fs.mkdirSync(d, { recursive: true });
            shell.openPath(d);
          },
        },
        {
          label: '打开回收目录（删掉的卦录在这里）',
          click: () => {
            const d = path.join(DATA.dir, 'trash');
            fs.mkdirSync(d, { recursive: true });
            shell.openPath(d);
          },
        },
        { type: 'separator' },
        {
          label: '导出整包备份…',
          click: async () => {
            const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
              title: '导出整包备份',
              defaultPath: `问心卦-备份-${new Date().toISOString().slice(0, 10)}.json`,
              filters: [{ name: 'JSON', extensions: ['json'] }],
            });
            if (canceled || !filePath) return;
            const res = await fetch(`${APP_URL}api/export?format=json`);
            fs.writeFileSync(filePath, await res.text(), 'utf8');
            dialog.showMessageBox(mainWindow, { type: 'info', message: '备份已导出', detail: filePath });
          },
        },
        { type: 'separator' },
        {
          label: '更换数据目录…',
          click: async () => {
            const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
              title: '选择数据目录（卦录将存在这里）',
              properties: ['openDirectory', 'createDirectory'],
              defaultPath: DATA.dir,
            });
            if (canceled || !filePaths?.length) return;
            writeDirPref(filePaths[0]);
            const r = await dialog.showMessageBox(mainWindow, {
              type: 'question',
              buttons: ['立即重启', '稍后'],
              defaultId: 0,
              message: '数据目录已记录，需要重启后生效。',
              detail: `新目录：${filePaths[0]}\n\n原目录的数据不会自动搬过去；如需搬移，请手动复制 records/ 里的文件。`,
            });
            if (r.response === 0) { electronApp.relaunch(); electronApp.exit(0); }
          },
        },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'forceReload', label: '强制刷新' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    {
      role: 'windowMenu',
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '前置全部窗口' },
      ],
    },
    {
      role: 'help',
      label: '帮助',
      submenu: [
        /* 文档一律**在程序里读**：独立的「文档」页，左侧目录、右侧正文，外链还会先问一句。
           文档清单从服务那份白名单现取，免得菜单与界面各写一遍、漏一篇。
           以前这里用 shell.openPath 把 .md 甩给系统默认程序——同一份 README
           两条路、两种排版，还容易跑出程序之外。要外部打开留了一个次级入口。 */
        ...(serverHandle?.HELP_DOCS || []).filter((d) => !d.link)
          .map((d) => ({ label: d.title, click: () => showWindow(`#/docs/${d.id}`) })),
        { type: 'separator' },
        { label: '在界面里看「导入与格式」页', click: () => showWindow('#/import') },
        { label: 'MCP 接入方式', click: () => showWindow('#/agent') },
        { type: 'separator' },
        { label: '用系统程序打开 README', click: () => openDoc('README.md') },
        { type: 'separator' },
        { label: '打开启动日志', click: () => openLog() },
        { label: '在文件管理器里定位日志', click: () => { if (LOG_FILE && fs.existsSync(LOG_FILE)) shell.showItemInFolder(LOG_FILE); } },
        { type: 'separator' },
        {
          label: '打开项目目录',
          click: () => shell.openPath(CODE_ROOT),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** 打开随包的说明文档；打包后 code 在 resources/app 里，用系统默认程序打开 */
function openDoc(rel) {
  const p = path.join(CODE_ROOT, rel);
  if (fs.existsSync(p)) shell.openPath(p);
  else dialog.showMessageBox(mainWindow, { type: 'warning', message: `找不到文档：${p}` });
}

/**
 * 打开启动日志。桌面版没有控制台可看，排障全靠这份日志，
 * 所以「帮助」菜单里必须有一个直接的入口——不然用户只能靠猜路径。
 */
function openLog() {
  if (!LOG_FILE || !fs.existsSync(LOG_FILE)) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      message: '还没有日志文件',
      detail: `日志会在应用产生第一条记录时创建：\n${LOG_FILE || path.join(electronApp.getPath('userData'), 'desktop.log')}`,
    });
    return;
  }
  shell.openPath(LOG_FILE);
}
