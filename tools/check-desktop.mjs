/**
 * 问心卦 · 桌面版自检
 * ------------------------------------------------------------
 * 用法：node tools/check-desktop.mjs
 *
 * 真起一个 Electron 进程，在**真实窗口**里跑一组断言：
 * 桌面桥、侧栏「桌面版」标记、桌面专属按钮、逐页路由渲染、
 * 卦录详情七段定调。跑完自动退出。
 *
 * 为什么必须真起 Electron：网页自检（check-web.mjs）用的是 DOM 桩，
 * 测不到 preload 桥、测不到 Electron 的渲染结果，也测不到「窗口到底有没有出现」。
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP = path.join(ROOT, 'desktop');

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${name}${detail ? `　${detail}` : ''}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? `　${detail}` : ''}`); }
};

/* ---------- 前置检查 ---------- */
console.log('\n【一】桌面外壳就位');
const pkgFile = path.join(DESKTOP, 'package.json');
check('desktop/package.json 存在', fs.existsSync(pkgFile));
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
check('已声明 electron 与 electron-builder', !!pkg.devDependencies?.electron && !!pkg.devDependencies?.['electron-builder'],
  `electron ${pkg.devDependencies?.electron} / builder ${pkg.devDependencies?.['electron-builder']}`);
check('main 指向 main.mjs 且 type=module', pkg.main === 'main.mjs' && pkg.type === 'module');
check('打包配置齐备（nsis + 图标 + 中文）',
  pkg.build?.win?.target?.[0]?.target === 'nsis' && !!pkg.build?.win?.icon && pkg.build?.nsis?.shortcutName === '问心卦',
  `productName=${pkg.build?.productName}　shortcut=${pkg.build?.nsis?.shortcutName}`);

const iconIco = path.join(DESKTOP, 'build', 'icon.ico');
const iconPng = path.join(DESKTOP, 'build', 'icon.png');
const trayPng = path.join(DESKTOP, 'build', 'tray.png');
check('应用图标已生成（ico/png/tray）',
  fs.existsSync(iconIco) && fs.existsSync(iconPng) && fs.existsSync(trayPng),
  fs.existsSync(iconIco) ? `icon.ico ${Math.round(fs.statSync(iconIco).size / 1024)} KB` : '缺 icon.ico');

const electronExe = path.join(DESKTOP, 'node_modules', 'electron', 'dist', 'electron.exe');
const hasElectron = fs.existsSync(electronExe);
check('Electron 运行时已就位', hasElectron, hasElectron ? electronExe.replace(ROOT + path.sep, '') : '未安装（npm install）');

for (const f of ['main.mjs', 'preload.cjs', 'build/make-icon.py']) {
  check(`desktop/${f} 存在`, fs.existsSync(path.join(DESKTOP, f)));
}
// preload 必须是 CJS：Electron 默认 sandbox: true，沙箱化的 preload 不能是 ES 模块
check('preload 用 CommonJS（沙箱要求）',
  !fs.existsSync(path.join(DESKTOP, 'preload.mjs'))
  && fs.readFileSync(path.join(DESKTOP, 'preload.cjs'), 'utf8').includes("require('electron')"),
  'preload.cjs + require');
check('主进程没有顶层 await app.whenReady()（会死锁）',
  !/^\s*await\s+electronApp\.whenReady\(\)/m.test(fs.readFileSync(path.join(DESKTOP, 'main.mjs'), 'utf8'))
  && /electronApp\.whenReady\(\)\.then/.test(fs.readFileSync(path.join(DESKTOP, 'main.mjs'), 'utf8')),
  'whenReady().then(main)');
/* 打包后的模块布局与开发态**不一样**，这条断言就是为那次事故立的：
   打包后 `main.mjs` 在 `resources/app.asar` 内（由 build.files 收入），
   而 `core/ server/ web/ …` 在 `resources/app/`（extraResources，asar 外）。
   于是 `main.mjs` 里任何 `from '../…'` 的相对 import 都会被解析到 `resources/<…>`——
   那里没有东西，程序启动即抛 ERR_MODULE_NOT_FOUND（v1.6.0 就这么发出去过，
   开发态自检全绿也照不出来，因为源码树下两者本来就相邻）。
   两条规矩：main.mjs 不许 `../` 相对 import；`./` 形式的目标必须进 build.files 白名单。 */
{
  const mainSrc = fs.readFileSync(path.join(DESKTOP, 'main.mjs'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8'));
  const listed = (pkg.build?.files || []).filter((f) => !f.startsWith('!'));
  const specs = [...mainSrc.matchAll(/^\s*import[^'"]*from\s+'(\.[^']*)'/gm)].map((m) => m[1]);
  const escaping = specs.filter((s) => s.startsWith('../'));
  const missingFile = specs.filter((s) => s.startsWith('./'))
    .map((s) => s.replace(/^\.\//, ''))
    .filter((f) => !listed.includes(f) || !fs.existsSync(path.join(DESKTOP, f)));
  check('main.mjs 只 import asar 内的同目录模块（不许相对跳出去）',
    escaping.length === 0 && missingFile.length === 0,
    escaping.length ? `越出 asar：${escaping.join('、')}`
      : (missingFile.length ? `未进 build.files：${missingFile.join('、')}` : `同目录 import：${specs.join('、') || '（无）'}`));
}

check('IPC 处理器在 loadURL 之前注册',
  fs.readFileSync(path.join(DESKTOP, 'main.mjs'), 'utf8').indexOf('registerIpc();')
    < fs.readFileSync(path.join(DESKTOP, 'main.mjs'), 'utf8').indexOf('await mainWindow.loadURL'), '');

if (!hasElectron) {
  console.log('\n  Electron 未安装，跳过真实窗口自检。装法（国内走镜像）：');
  console.log('    cd desktop');
  console.log('    set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/');
  console.log('    npm install\n');
  console.log(`\n———— 通过 ${pass} 项，失败 ${fail} 项 ————\n`);
  process.exit(fail ? 1 : 0);
}

/* ---------- 真起 Electron 跑断言 ---------- */
console.log('\n【二】真实窗口内断言（起一个 Electron 进程）');

// 环境里若带着 ELECTRON_RUN_AS_NODE，Electron 会退化成纯 Node 而没有窗口，必须清掉
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

/**
 * 用**独立的** user-data-dir 跑自检。
 * 理由：Electron 的单实例锁是按 user-data-dir 记的——若用户桌面上正开着装好的
 * 问心卦，自检进程会因抢不到锁而直接退出，表现为「没有任何输出」。隔离之后
 * 两者互不干扰，自检也不会污染用户真实的窗口位置与配置。
 */
const profileDir = path.join(os.tmpdir(), `qxg-selftest-${process.pid}`);
fs.mkdirSync(profileDir, { recursive: true });

const child = spawn(electronExe, ['.', '--selftest', `--user-data-dir=${profileDir}`], {
  cwd: DESKTOP,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => { stdout += d.toString(); });
child.stderr.on('data', (d) => { stderr += d.toString(); });

const code = await new Promise((resolve) => {
  const t = setTimeout(() => { child.kill(); resolve('timeout'); }, 90000);
  child.on('exit', (c) => { clearTimeout(t); resolve(c); });
});

if (code === 'timeout') {
  check('Electron 自检在 90 秒内完成', false, '超时（可能又死锁了：检查主进程有没有顶层 await app.whenReady()）');
} else {
  const line = stdout.split('\n').find((l) => l.startsWith('[selftest]'));
  if (!line) {
    check('Electron 输出自检结果', false,
      (stderr || stdout).trim().split('\n').slice(-4).join(' | ').slice(0, 300)
      || `进程退出码 ${code} 却没有任何输出——多半是抢不到单实例锁（用户桌面正开着问心卦？）`);
  } else {
    const data = JSON.parse(line.slice('[selftest]'.length));
    for (const r of data.results) {
      const v = typeof r.value === 'object' ? JSON.stringify(r.value) : String(r.value);
      check(r.name, r.ok, r.ok ? v.slice(0, 90) : `实际：${v.slice(0, 160)}`);
    }
    check('Electron 进程以成功码退出', code === 0, `exit ${code}`);
  }
}

console.log(`\n———— 通过 ${pass} 项，失败 ${fail} 项 ————`);
try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* 清理不掉也无妨 */ }

// 把本套项数写进 docs/.counts.json，供 tools/check-docs.mjs 校验文档是否跟上
try {
  const f = path.join(ROOT, 'docs', '.counts.json');
  const m = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  m['check-desktop.mjs'] = pass;
  fs.writeFileSync(f, `${JSON.stringify(m, null, 2)}\n`, 'utf8');
} catch { /* 写不了不影响自检本身 */ }

if (fail) {
  console.log('\n若失败集中在「渲染进程拿到桌面桥」，先确认 desktop/preload.mjs 存在且被 main.mjs 引用。');
  console.log('若整个自检超时，八成是主进程里用了顶层 await app.whenReady()——那会死锁。\n');
  process.exit(1);
}
console.log('桌面版正常。\n');
