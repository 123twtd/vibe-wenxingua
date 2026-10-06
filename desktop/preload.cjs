/**
 * 问心卦 · 预加载脚本（CommonJS）
 * ------------------------------------------------------------
 * ⚠️ 为什么是 .cjs 而不是 .mjs：
 * Electron 默认 sandbox: true，**沙箱化的 preload 不能是 ES 模块**，
 * 用了 import 会静默失败——表现是 window.__qxgDesktop 一直是 undefined，
 * 而且控制台不一定报错，很难查。这里用 require 的经典写法最稳。
 *
 * 职责只有一件：把「桌面版才有的能力」安全地递给界面。
 * contextIsolation 开着，渲染进程拿不到 Node，只能走这几个口子。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__qxgDesktop', {
  /** 桌面版标记；界面拿它决定要不要显示桌面专属入口 */
  isDesktop: true,

  /** 版本、平台、数据目录等只读信息 */
  info: () => ipcRenderer.invoke('qxg:info'),

  /** 在文件管理器里打开数据目录 / 备份目录 */
  openDataDir: () => ipcRenderer.invoke('qxg:open-data-dir'),
  openBackups: () => ipcRenderer.invoke('qxg:open-backups'),

  /** 弹保存框导出整包备份 */
  exportBackup: () => ipcRenderer.invoke('qxg:export-backup'),

  /** 在文件管理器里定位某条卦录的 JSON 文件 */
  revealRecordFile: (id) => ipcRenderer.invoke('qxg:reveal-record-file', id),

  /** 更换数据目录（会问是否重启） */
  chooseDataDir: () => ipcRenderer.invoke('qxg:choose-data-dir'),

  /** 订阅来自菜单／托盘的跳转指令，返回取消订阅函数 */
  onNavigate: (fn) => {
    const h = (_e, hash) => fn(hash);
    ipcRenderer.on('qxg:navigate', h);
    return () => ipcRenderer.removeListener('qxg:navigate', h);
  },

  /** 在程序里下载新版安装包（存到系统「下载」目录，不弹保存框）；进度见 onUpdateProgress */
  downloadUpdate: (info) => ipcRenderer.invoke('qxg:download-update', info),

  /** 订阅下载进度与结局（{ pct } / { done, filePath } / { done, failed }），返回取消订阅函数 */
  onUpdateProgress: (fn) => {
    const h = (_e, p) => fn(p);
    ipcRenderer.on('qxg:update-progress', h);
    return () => ipcRenderer.removeListener('qxg:update-progress', h);
  },

  /** 打开一个本地路径：mode='open' 打开它（安装包＝启动安装向导），mode='folder' 在文件管理器里定位 */
  openPath: (p, mode = 'open') => ipcRenderer.invoke('qxg:open-path', { path: p, mode }),

  /** 交给系统浏览器打开一个网址（下载不通时的退路） */
  openExternal: (url) => ipcRenderer.invoke('qxg:open-external', url),
});
