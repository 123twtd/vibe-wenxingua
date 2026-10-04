/**
 * 问心卦 · 插件宿主
 * ------------------------------------------------------------
 * 可扩展性的落点：一个插件就是一个 .mjs 文件，放在 data/plugins/ 下，
 * 通过 activate(ctx) 拿到这套能力——
 *
 *   ctx.registerRoute(method, path, handler)   加 REST 接口（挂到 /api/plugins/<id>/ 下）
 *   ctx.registerPage({ id, label, render })    加一个侧栏页面
 *   ctx.registerPanel({ id, label, render })   在卦录详情页加一块面板
 *   ctx.registerExporter({ id, label, ext, render })  加一种导出格式
 *   ctx.on(event, handler)                     监听 record.created / updated / deleted / app.start
 *   ctx.store / ctx.core / ctx.config / ctx.log 直接用宿主的存储与全部内核
 *
 * 改完插件不必重启：POST /api/plugins/reload 即可热载。
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export class PluginHost {
  constructor({ dir, store, core, logger = console }) {
    this.dir = dir;
    this.store = store;
    this.core = core;
    this.logger = logger;
    this.plugins = new Map();
    this.routes = [];
    this.pages = [];
    this.panels = [];
    this.exporters = [];
    this.hooks = new Map();
    this.errors = [];
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /** 扫描并加载全部插件 */
  async loadAll() {
    this.reset();
    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.mjs'));
    const cfg = this.store.getConfig();
    for (const file of files) {
      const id = file.replace(/\.mjs$/, '');
      const enabled = cfg.plugins?.[id]?.enabled !== false;
      if (!enabled) {
        this.plugins.set(id, { id, file, name: id, enabled: false, loaded: false });
        continue;
      }
      try {
        const mod = await import(`${pathToFileURL(path.join(this.dir, file)).href}?t=${Date.now()}`);
        const def = mod.default || mod.plugin;
        if (!def || typeof def.activate !== 'function') {
          this.errors.push(`${file}：未导出 default.activate(ctx)，已跳过`);
          continue;
        }
        const meta = {
          id: def.id || id,
          file,
          name: def.name || def.id || id,
          version: def.version || '0.0.0',
          description: def.description || '',
          author: def.author || '',
          enabled: true,
          loaded: true,
          pages: [],
          panels: [],
          exporters: [],
          routes: [],
        };
        const ctx = this.makeContext(meta, def);
        await def.activate(ctx);
        this.plugins.set(meta.id, meta);
        this.logger.log?.(`[plugins] 已载入 ${meta.id}@${meta.version}`);
      } catch (err) {
        this.errors.push(`${file}：${err.message}`);
        this.logger.warn?.(`[plugins] ${file} 载入失败：${err.stack || err.message}`);
      }
    }
    this.routes.sort((a, b) => b.path.length - a.path.length);
    this.emit('app.start', { at: new Date().toISOString() });
    return this.api();
  }

  reset() {
    this.plugins.clear();
    this.routes = [];
    this.pages = [];
    this.panels = [];
    this.exporters = [];
    this.hooks.clear();
    this.errors = [];
  }

  makeContext(meta, def) {
    const host = this;
    return {
      id: meta.id,
      plugin: meta,
      def,
      store: this.store,
      core: this.core,
      config: this.store.getConfig(),
      log: (...a) => this.logger.log?.(`[${meta.id}]`, ...a),
      warn: (...a) => this.logger.warn?.(`[${meta.id}]`, ...a),
      assetsDir: path.join(this.dir, meta.id),
      on(event, fn) {
        if (!host.hooks.has(event)) host.hooks.set(event, []);
        host.hooks.get(event).push({ pluginId: meta.id, fn });
      },
      registerRoute(method, subPath, handler) {
        const full = `/api/plugins/${meta.id}/${String(subPath).replace(/^\/+/, '')}`;
        const entry = { method: method.toUpperCase(), path: full, handler, pluginId: meta.id };
        host.routes.push(entry);
        meta.routes.push(`${entry.method} ${full}`);
      },
      registerPage({ id, label, icon = '◇', order = 100, render }) {
        const page = { id, label, icon, order, render, pluginId: meta.id, url: `/api/plugins/${meta.id}/page/${id}` };
        host.pages.push(page);
        meta.pages.push({ id, label, icon, order });
        return page;
      },
      registerPanel({ id, label, order = 100, render }) {
        const panel = { id, label, order, render, pluginId: meta.id };
        host.panels.push(panel);
        meta.panels.push({ id, label, order, url: `/api/plugins/${meta.id}/panel/${id}` });
        return panel;
      },
      registerExporter({ id, label, ext, mime, render }) {
        const ex = { id, label, ext, mime: mime || 'text/plain; charset=utf-8', render, pluginId: meta.id };
        host.exporters.push(ex);
        meta.exporters.push({ id, label, ext });
        return ex;
      },
    };
  }

  /** 触发事件钩子 */
  emit(event, payload) {
    const list = this.hooks.get(event) || [];
    for (const { pluginId, fn } of list) {
      try {
        const r = fn(payload);
        if (r && typeof r.catch === 'function') r.catch((e) => this.logger.warn?.(`[plugins] ${pluginId}.${event} 出错：${e.message}`));
      } catch (err) {
        this.logger.warn?.(`[plugins] ${pluginId}.${event} 出错：${err.message}`);
      }
    }
  }

  /** 找到匹配的插件路由 */
  matchRoute(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method.toUpperCase()) continue;
      if (pathname === r.path) return { route: r, params: {} };
      if (r.path.endsWith('/*') && pathname.startsWith(r.path.slice(0, -1))) {
        return { route: r, params: { rest: pathname.slice(r.path.length - 1) } };
      }
    }
    return null;
  }

  findPage(pluginId, pageId) {
    return this.pages.find((p) => p.pluginId === pluginId && p.id === pageId) || null;
  }

  findPanel(pluginId, panelId) {
    return this.panels.find((p) => p.pluginId === pluginId && p.id === panelId) || null;
  }

  /** 给前端的插件清单 */
  api() {
    return {
      plugins: [...this.plugins.values()].map((p) => ({
        id: p.id, name: p.name, version: p.version, description: p.description,
        author: p.author, enabled: p.enabled, loaded: p.loaded,
        pages: p.pages || [], panels: p.panels || [], exporters: p.exporters || [], routes: p.routes || [],
      })),
      pages: this.pages.map(({ id, label, icon, order, pluginId, url }) => ({ id, label, icon, order, pluginId, url })).sort((a, b) => a.order - b.order),
      exporters: this.exporters.map(({ id, label, ext, pluginId }) => ({ id, label, ext, pluginId })),
      panels: this.panels.map(({ id, label, order, pluginId }) => ({ id, label, order, pluginId })),
      errors: this.errors,
      dir: this.dir,
    };
  }

  toggle(id, enabled) {
    const cfg = this.store.getConfig();
    cfg.plugins = cfg.plugins || {};
    cfg.plugins[id] = { ...(cfg.plugins[id] || {}), enabled };
    this.store.setConfig({ plugins: cfg.plugins });
    return cfg.plugins[id];
  }
}
