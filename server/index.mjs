/**
 * 问心卦 · 本地服务
 * ------------------------------------------------------------
 * 零依赖：只用 Node 内置模块。启动后在本机开一个网址，
 * 浏览器打开即是完整软件（与 DeepSeek Harness 同一形态：本地服务 + 网页界面）。
 *
 * 启动：  node server/index.mjs  [--port 19730] [--open]
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';

import { Store } from './store.mjs';
import { ChatStore, CHAT_SCHEMA } from './chatStore.mjs';
import { PluginHost } from './plugins.mjs';
import { seedPlugins } from './seed.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const argOf = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const PORT = Number(process.env.QXG_PORT || argOf('port', 19730));
const HOST = process.env.QXG_HOST || argOf('host', '127.0.0.1');
const OPEN = argv.includes('--open');

/** 版本号只从 package.json 取一处，免得两边漂移 */
const APP_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

/* ---------- 内核（动态载入，便于插件共享同一实例） ---------- */
const core = {
  calendar: await import(pathToFileURL(path.join(ROOT, 'core', 'calendar.mjs')).href),
  bagua: await import(pathToFileURL(path.join(ROOT, 'core', 'bagua.mjs')).href),
  hexagram: await import(pathToFileURL(path.join(ROOT, 'core', 'hexagram.mjs')).href),
  divination: await import(pathToFileURL(path.join(ROOT, 'core', 'divination.mjs')).href),
  verdict: await import(pathToFileURL(path.join(ROOT, 'core', 'verdict.mjs')).href),
  record: await import(pathToFileURL(path.join(ROOT, 'core', 'record.mjs')).href),
  render: await import(pathToFileURL(path.join(ROOT, 'core', 'render.mjs')).href),
  importer: await import(pathToFileURL(path.join(ROOT, 'core', 'importer.mjs')).href),
  trend: await import(pathToFileURL(path.join(ROOT, 'core', 'trend.mjs')).href),
  yingqi: await import(pathToFileURL(path.join(ROOT, 'core', 'yingqi.mjs')).href),
  schema: await import(pathToFileURL(path.join(ROOT, 'core', 'schema.mjs')).href),
  guaTiao: await import(pathToFileURL(path.join(ROOT, 'core', 'guaTiao.mjs')).href),
  migrate: await import(pathToFileURL(path.join(ROOT, 'core', 'migrate.mjs')).href),
  lunar: await import(pathToFileURL(path.join(ROOT, 'core', 'lunar.mjs')).href),
  xiaoliuren: await import(pathToFileURL(path.join(ROOT, 'core', 'xiaoliuren.mjs')).href),
};

const agent = {
  provider: await import(pathToFileURL(path.join(ROOT, 'agent', 'provider.mjs')).href),
  tools: await import(pathToFileURL(path.join(ROOT, 'agent', 'tools.mjs')).href),
  loop: await import(pathToFileURL(path.join(ROOT, 'agent', 'loop.mjs')).href),
  permissions: await import(pathToFileURL(path.join(ROOT, 'agent', 'permissions.mjs')).href),
  sources: await import(pathToFileURL(path.join(ROOT, 'agent', 'sources.mjs')).href),
};

/**
 * 数据目录解析（桌面版与命令行版共用一套判断）：
 *   1. QXG_DATA_DIR 环境变量（最高优先）
 *   2. <代码目录>/data 若可写 —— 便携模式：整个文件夹拷走就能走
 *   3. 否则 %APPDATA%/问心卦/data —— 安装到 Program Files 时用这个
 * 首次使用回退目录时，若存在随包附带的 seed-data，会复制进去，
 * 免得装完之后发现卦录是空的。
 */
const CODE_ROOT = path.resolve(HERE, '..');

function resolveDataDir() {
  const env = process.env.QXG_DATA_DIR;
  // 桌面版外壳自己选好了目录（并告诉我们属于哪种落点），照它说的算
  if (env) return { dir: path.resolve(env), mode: process.env.QXG_DATA_MODE || 'env' };

  const portable = path.join(CODE_ROOT, 'data');
  try {
    fs.mkdirSync(portable, { recursive: true });
    fs.accessSync(portable, fs.constants.W_OK);
    return { dir: portable, mode: 'portable' };
  } catch {
    /* 不可写，走用户目录 */
  }

  const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const dir = path.join(base, '问心卦', 'data');
  fs.mkdirSync(dir, { recursive: true });
  seedDataInto(dir);
  return { dir, mode: 'appdata' };
}

/**
 * 落到用户目录时，把随包的示例插件补进去。
 * 规则见 server/seed.mjs：新样例要送到、用户删掉的不复活、用户改过的不覆盖。
 * **卦录不在随包范围内**，所以这里不碰 records/（那是用户的东西）。
 */
function seedDataInto(targetDir) {
  try {
    const r = seedPlugins({
      seedDir: path.join(CODE_ROOT, 'seed-data', 'plugins'),
      targetDir: path.join(targetDir, 'plugins'),
    });
    if (r.seeded.length) console.log(`[store] 已补入随包示例插件：${r.seeded.join('、')}`);
  } catch (err) {
    console.warn(`[store] 补入示例插件失败（不影响启动）：${err.message}`);
  }
}

const DATA = resolveDataDir();
const dataDir = DATA.dir;
/** 'env' | 'portable' | 'appdata' | 'chosen' | 'dev' —— 界面用它说明「数据存在哪」。
 *  后两个由桌面版外壳经 QXG_DATA_MODE 告进来（用户自选目录／开发态项目目录）。 */
export const DATA_MODE = DATA.mode;

const store = new Store(dataDir, { migrator: core.migrate.migrate });
const plugins = new PluginHost({
  dir: path.join(dataDir, 'plugins'),
  store,
  core,
  logger: console,
});
await plugins.loadAll();
core.record.resetSeqCache();

/** AI 对话的会话存储。与卦录同一套纪律：原子写、删除进 trash、载入时迁移。 */
const chats = new ChatStore(dataDir, { logger: console });

/** Agent 工具集：HTTP 接口、MCP 服务、界面共用同一份实现。
 *  权限等级**惰性读**——设置页改完立刻生效，不用重启。 */
const toolkit = agent.tools.createToolkit({
  store,
  core,
  plugins,
  permission: () => store.getConfig().agent?.permission,
  // 联网工具由「工具来源」贡献，而不是塞进内置工具表——见 agent/sources.mjs 与 ADR-0013。
  // 配置惰性读，所以设置里停用后，它会立刻从模型的工具清单里消失。
  sources: [agent.sources.createWebSource({ getConfig: () => store.getConfig() })],
});

/* ---------- 工具 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, code, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
  res.writeHead(code, { 'Content-Length': buf.length, ...headers });
  res.end(buf);
}

function json(res, data, code = 200) {
  send(res, code, JSON.stringify(data, null, 2), { 'Content-Type': 'application/json; charset=utf-8' });
}

function fail(res, err, code = 400) {
  json(res, { ok: false, error: err?.message || String(err) }, code);
}

/**
 * 下载头：HTTP 头只能是 latin-1，中文文件名必须走 RFC 5987 的 filename*。
 * 同时给一个 ASCII 兜底名，老浏览器也不会拿到乱码。
 */
function attachment(filename, asciiFallback = 'wenxingua.txt') {
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function readBody(req, limit = 32 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw };
  }
}

function serveStatic(res, baseDir, relPath, fallbackIndex = false) {
  let rel = decodeURIComponent(relPath).replace(/^\/+/, '');
  if (rel === '' && fallbackIndex) rel = 'index.html';
  const abs = path.resolve(baseDir, rel);
  if (!abs.startsWith(path.resolve(baseDir))) return send(res, 403, 'forbidden');
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    if (fallbackIndex) return serveStatic(res, baseDir, 'index.html', false);
    return send(res, 404, 'not found');
  }
  const ext = path.extname(abs).toLowerCase();
  send(res, 200, fs.readFileSync(abs), {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
}

function newRecordFromBody(body) {
  const mode = body.mode || (body.hexagram ? 'hexagram' : 'cast');
  const base = {
    id: body.id || core.record.makeId(body.localTime || body.cast?.localTime, store.ids()),
    title: body.title,
    category: body.category,
    question: body.question,
    narrative: body.narrative,
    background: body.background,
    plan: body.plan,
    collation: body.collation,
    qa: body.qa,
    claimed: body.claimed,
    origin: body.origin || { kind: 'cast', label: '本机起卦' },
    tags: body.tags,
    review: body.review,
    source: body.source,
  };
  if (mode === 'hexagram') {
    return core.record.buildFromHexagram({
      ...base,
      hexagram: body.hexagram,
      movingPosition: Number(body.movingPosition),
      localTime: body.localTime,
      longitude: body.longitude,
      latitude: body.latitude,
      placeName: body.placeName,
      useTrueSolarTime: body.useTrueSolarTime,
      numbers: body.numbers,
    });
  }
  return core.record.buildRecord({
    ...base,
    cast: {
      method: body.method || body.cast?.method || 'numberAndTime',
      numbers: body.numbers || body.cast?.numbers,
      localTime: body.localTime || body.cast?.localTime,
      longitude: body.longitude ?? body.cast?.longitude,
      latitude: body.latitude ?? body.cast?.latitude,
      placeName: body.placeName || body.cast?.placeName,
      useTrueSolarTime: body.useTrueSolarTime ?? body.cast?.useTrueSolarTime,
      movingFrom: body.movingFrom || body.cast?.movingFrom,
      calendarType: body.calendarType || body.cast?.calendarType,
      question: body.question,
      category: body.category,
    },
  });
}

/* ---------- 路由 ---------- */
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:([A-Za-z]+)/g, (_, k) => {
    keys.push(k);
    return '([^/]+)';
  })}$`);
  routes.push({ method, re, keys, handler });
};

route('GET', '/api/health', (req, res) => json(res, { ok: true, app: '问心卦', version: APP_VERSION, at: new Date().toISOString() }));

route('GET', '/api/meta', (req, res) => {
  const lib = core.hexagram.library();
  const { cfg: acfg, resolved: ares } = agentConfig();
  json(res, {
    ok: true,
    app: {
      name: '问心卦',
      version: APP_VERSION,
      root: ROOT,
      schemaVersion: core.migrate.CURRENT_SCHEMA,
      dataDir,
      dataMode: DATA_MODE,
      desktop: !!process.versions.electron,
    },
    methods: core.divination.METHODS,
    categories: core.verdict.CATEGORIES,
    reviewStatuses: core.record.REVIEW_STATUS,
    places: core.calendar.PLACES,
    movingFromOptions: [
      { id: 'sum', label: '数与时辰之和除六（梅花易数常法）' },
      { id: 'number', label: '仅以报数除六（旧稿偶见）' },
    ],
    domains: core.trend.DOMAINS.map((d) => ({ id: d.id, name: d.name, color: d.color, scale: d.scale, mode: d.mode, desc: d.desc })),
    guaTiao: { version: core.guaTiao.GUATIAO_VERSION, header: core.guaTiao.HEADER },
    agent: {
      enabled: !!acfg.enabled,
      provider: acfg.provider,
      model: ares.model,
      ready: ares.ready,
      reason: ares.reason,
      toolCount: toolkit.tools.length,
      // 当前等级 + 这一等级够得着几个工具（界面显示「可写 · 15/20 个工具」）
      permission: agent.permissions.normalizeLevel(acfg.permission),
      permissionName: agent.permissions.levelById(acfg.permission).name,
      allowedTools: toolkit.tools.filter((t) => agent.permissions.allows(acfg.permission, t.permission)).length,
      destructiveTools: toolkit.tools.filter((t) => t.destructive).map((t) => t.name),
      // 上下文占用（面板顶栏 chip 用）：生效值 = 配置覆盖优先，否则模型预设；
      // 预设值一并给出，界面排障时能看出「这个数是从哪来的」。0 = 未知。
      contextWindow: agentContextWindow(acfg, ares),
      contextWindowPreset: agent.provider.contextWindowFor(ares.provider, ares.model),
    },
    knowledge: lib.stats(),
    config: { ...store.getConfig(), agent: undefined },
    plugins: plugins.api(),
    counts: store.stats(),
    /** AI 会话的概览：界面底部状态栏与「会话」列表要用，不必为此再打一次接口 */
    chats: { count: chats.list().length, schema: CHAT_SCHEMA, dir: chats.dir },
    migrations: store.migrations,
  });
});

/* ---------- 版本更新检测（程序**唯一**的主动外呼） ----------
 * 为什么要有：装完之后没人会天天去发行页翻有没有新版。这里在启动后问一次
 * GitHub 的「最新发行版」接口，有新版本就由界面在顶部挂一条提示。
 * 三条纪律（与 docs/11-安全与隐私设计 一致）：
 *   1. 固定域名 https://api.github.com，只发一个 GET，不带任何本机数据、不带密钥；
 *   2. 4 秒超时 + 响应上限 256KB，失败**静默**（照样返回 ok:true，绝不 500）；
 *   3. 成功结果在内存里缓存 6 小时；设置里可一键关闭（config.updateCheck）。
 */
const UPDATE_REPO = '123twtd/vibe-wenxingua';
const UPDATE_LATEST_API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
const UPDATE_TIMEOUT_MS = 4000;
const UPDATE_MAX_BYTES = 256 * 1024;
const UPDATE_TTL_MS = 6 * 60 * 60 * 1000;
let updateCache = { at: 0, data: null };

async function fetchLatestRelease() {
  if (updateCache.data && Date.now() - updateCache.at < UPDATE_TTL_MS) return updateCache.data;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPDATE_TIMEOUT_MS);
  try {
    const res = await fetch(UPDATE_LATEST_API, {
      signal: ctrl.signal,
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `wenxingua/${APP_VERSION}` },
    });
    if (!res.ok) throw new Error(`GitHub 返回 HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > UPDATE_MAX_BYTES) throw new Error('响应体过大，已忽略');
    const rel = JSON.parse(text);
    const assets = Array.isArray(rel.assets) ? rel.assets : [];
    /* 首选安装包（.exe）。为什么要它：界面上的按钮是「直接下载」——
       只给发行页地址的话，用户还得自己在一堆资产里找那个 exe（真被问过
       「不能直接获取下载吗」）。没有 .exe 就退回第一个资产，再没有就给空串，
       界面会退回打开发行页。 */
    const pick = assets.find((x) => /\.exe$/i.test(String(x.name || ''))) || assets[0] || null;
    const data = {
      // tag 形如 v1.2.0：去掉前缀 v，让界面直接显示数字
      latest: String(rel.tag_name || rel.name || '').replace(/^v/i, ''),
      url: String(rel.html_url || `https://github.com/${UPDATE_REPO}/releases`),
      asset: pick ? String(pick.name || '') : '',
      assetUrl: pick ? String(pick.browser_download_url || '') : '',
      size: pick && Number(pick.size) > 0 ? Number(pick.size) : 0,
      name: String(rel.name || ''),
      publishedAt: String(rel.published_at || ''),
    };
    updateCache = { at: Date.now(), data };
    return data;
  } finally {
    clearTimeout(timer);
  }
}

route('GET', '/api/update-check', async (req, res) => {
  if (store.getConfig().updateCheck === false) {
    return json(res, { ok: true, enabled: false, current: APP_VERSION, latest: '' });
  }
  try {
    const data = await fetchLatestRelease();
    return json(res, { ok: true, enabled: true, current: APP_VERSION, ...data });
  } catch (err) {
    // 断网、被墙、限流都走这里：检测新版本失败**不该打扰使用**——
    // 界面见到 latest 为空就什么都不显示，错误只在需要排障时看得见。
    return json(res, { ok: true, enabled: true, current: APP_VERSION, latest: '', error: err.message });
  }
});

/* 顶层配置的写入口。
 * 为什么只放这两个键：config.json 里还有数据位置、插件注册这类「改了要出事」的项，
 * 从界面来的请求体不该碰得到它们——白名单之外一律忽略，一个都不认就 400。 */
route('POST', '/api/config', async (req, res) => {
  try {
    const body = await readBody(req);
    const patch = {};
    if (body.lastSeenVersion !== undefined) {
      const v = String(body.lastSeenVersion || '').trim();
      if (v.length > 32) return fail(res, new Error('lastSeenVersion 超过 32 字符'));
      patch.lastSeenVersion = v;
    }
    if (body.updateCheck !== undefined) patch.updateCheck = body.updateCheck !== false;
    if (!Object.keys(patch).length) {
      return fail(res, new Error('没有可写的配置项：顶层只接受 lastSeenVersion 与 updateCheck'));
    }
    const next = store.setConfig(patch);
    return json(res, { ok: true, config: { lastSeenVersion: next.lastSeenVersion, updateCheck: next.updateCheck } });
  } catch (err) {
    return fail(res, err);
  }
});

route('GET', '/api/records', (req, res, url) => {
  const q = (url.searchParams.get('q') || '').toLowerCase();
  const category = url.searchParams.get('category') || '';
  const grade = url.searchParams.get('grade') || '';
  const review = url.searchParams.get('review') || '';
  const method = url.searchParams.get('method') || '';
  // school 是「占法」的便捷值（meihua｜xlr）；method 则精确到某一起课法
  const school = url.searchParams.get('school') || '';
  let items = store.list();
  if (category) items = items.filter((r) => r.category === category);
  if (grade) items = items.filter((r) => r.reading?.grade?.label === grade);
  if (review) items = items.filter((r) => r.review?.status === review);
  if (method) items = items.filter((r) => r.cast?.method === method);
  if (school === 'xlr') items = items.filter((r) => core.xiaoliuren.isXlrChart(r.chart));
  if (school === 'meihua') items = items.filter((r) => !core.xiaoliuren.isXlrChart(r.chart));
  if (q) {
    items = items.filter((r) => JSON.stringify({
      t: r.title, q: r.question, n: r.narrative, c: r.chart, g: r.reading,
      bg: r.background, p: r.plan, col: r.collation, qa: r.qa,
    }).toLowerCase().includes(q));
  }
  json(res, { ok: true, total: items.length, items: items.map(core.record.summarize) });
});

route('POST', '/api/records', async (req, res) => {
  try {
    const body = await readBody(req);
    const rec = newRecordFromBody(body);
    store.save(rec);
    plugins.emit('record.created', rec);
    json(res, { ok: true, record: rec });
  } catch (err) {
    fail(res, err);
  }
});

route('GET', '/api/records/:id', (req, res, url, params) => {
  const rec = store.get(params.id);
  if (!rec) return fail(res, new Error('未找到该卦录'), 404);
  const panels = [];
  for (const p of plugins.panels) {
    try {
      const out = p.render({ record: rec, store, core });
      if (out) panels.push({ id: p.id, label: p.label || out.title, pluginId: p.pluginId, ...out });
    } catch (err) {
      panels.push({ id: p.id, label: p.label, pluginId: p.pluginId, html: `<p class="err">插件面板出错：${err.message}</p>` });
    }
  }
  json(res, { ok: true, record: rec, panels });
});

route('PATCH', '/api/records/:id', async (req, res, url, params) => {
  const rec = store.get(params.id);
  if (!rec) return fail(res, new Error('未找到该卦录'), 404);
  const body = await readBody(req);
  const allowed = ['title', 'category', 'question', 'narrative', 'background', 'plan', 'collation', 'qa', 'tags', 'review', 'source', 'origin'];
  const next = { ...rec };
  for (const k of allowed) if (body[k] !== undefined) next[k] = body[k];
  next.updatedAt = new Date().toISOString();
  store.save(core.record.normalizeRecord(next));
  plugins.emit('record.updated', next);
  json(res, { ok: true, record: next });
});

route('DELETE', '/api/records/:id', (req, res, url, params) => {
  const ok = store.remove(params.id, url.searchParams.get('hard') === '1');
  if (!ok) return fail(res, new Error('未找到该卦录'), 404);
  plugins.emit('record.deleted', { id: params.id });
  json(res, { ok: true });
});

route('POST', '/api/records/:id/recompute', (req, res, url, params) => {
  const rec = store.get(params.id);
  if (!rec) return fail(res, new Error('未找到该卦录'), 404);
  try {
    const next = core.record.recompute(rec);
    next.id = rec.id;
    next.createdAt = rec.createdAt;
    store.save(next);
    plugins.emit('record.updated', next);
    json(res, { ok: true, record: next });
  } catch (err) {
    fail(res, err);
  }
});

route('GET', '/api/records/:id/export', (req, res, url, params) => {
  const rec = store.get(params.id);
  if (!rec) return fail(res, new Error('未找到该卦录'), 404);
  const format = url.searchParams.get('format') || 'md';
  const pluginExporter = plugins.exporters.find((e) => e.id === format);
  if (pluginExporter) {
    try {
      const out = pluginExporter.render(rec, { core });
      return send(res, 200, out, {
        'Content-Type': pluginExporter.mime,
        'Content-Disposition': attachment(`${rec.id}.${pluginExporter.ext}`, `${rec.id}.${pluginExporter.ext}`),
      });
    } catch (err) {
      // 插件导出器多按梅花的卦形写（如直接取 c.ben）；遇小六壬记录会抛。
      // 不许因此把导出打成 500——退回核心导出，日志留一句，插件作者可自行修正。
      console.warn(`[plugins] 导出器「${pluginExporter.id}」处理 ${rec.id} 失败，已退回核心 Markdown：${err.message}`);
    }
  }
  if (format === 'json') {
    return send(res, 200, JSON.stringify(rec, null, 2), {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': attachment(`${rec.id}.json`, `${rec.id}.json`),
    });
  }
  if (format === 'slip') {
    return send(res, 200, core.render.toSlip(rec), {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': attachment(`${rec.id}-卦签.txt`, `${rec.id}-qian.txt`),
    });
  }
  send(res, 200, core.render.toMarkdown(rec), {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': attachment(`${rec.id}.md`, `${rec.id}.md`),
  });
});

route('GET', '/api/export', (req, res, url) => {
  const format = url.searchParams.get('format') || 'md';
  if (format === 'json') {
    // 整包备份要连会话一起带走。换机时只搬 records/ 而丢掉对话历史，
    // 是最容易在事后才发现的一类静默损失。
    return send(res, 200, JSON.stringify({ ...store.backup(), chats: chats.exportAll() }, null, 2), {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': attachment('问心卦-整包备份.json', 'wenxingua-backup.json'),
    });
  }
  send(res, 200, core.render.toIndexMarkdown(store.list()), {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': attachment('问心卦-卦录总览.md', 'wenxingua-index.md'),
  });
});

/* ---------- AI 会话 ---------- */

/** 会话 id 与卦录同形（YYYYMMDDHHmm-序号）：按时间排序、人也能一眼认出是哪天聊的 */
function newChatId() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const localTime = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} `
    + `${p(now.getHours())}:${p(now.getMinutes())}`;
  return core.record.makeId(localTime, chats.ids());
}

route('GET', '/api/chats', (req, res) => {
  chats.maybeRescan();
  json(res, { ok: true, chats: chats.list(), dir: chats.dir, schema: CHAT_SCHEMA });
});

route('POST', '/api/chats', (req, res) => {
  const chat = chats.create({ id: newChatId() });
  json(res, { ok: true, chat });
});

route('GET', '/api/chats/:id', (req, res, url, params) => {
  const chat = chats.get(params.id);
  if (!chat) return fail(res, new Error('未找到该会话'), 404);
  json(res, { ok: true, chat });
});

route('PATCH', '/api/chats/:id', async (req, res, url, params) => {
  try {
    const body = await readBody(req);
    const chat = chats.rename(params.id, body.title);
    if (!chat) return fail(res, new Error('未找到该会话'), 404);
    json(res, { ok: true, chat: chats.summary(chat) });
  } catch (err) {
    fail(res, err);
  }
});

/** 追加一轮。界面把展示条目与模型侧消息一起交上来，服务端只存不推断。 */
route('POST', '/api/chats/:id/append', async (req, res, url, params) => {
  try {
    const body = await readBody(req);
    const chat = chats.append(params.id, body);
    if (!chat) return fail(res, new Error('未找到该会话'), 404);
    json(res, { ok: true, chat: chats.summary(chat) });
  } catch (err) {
    fail(res, err);
  }
});

route('DELETE', '/api/chats/:id', (req, res, url, params) => {
  const hard = url.searchParams.get('hard') === '1';
  const ok = chats.remove(params.id, hard);
  if (!ok) return fail(res, new Error('未找到该会话'), 404);
  json(res, { ok: true, hard, message: hard ? '已彻底删除' : '已移入回收目录（data/trash/）' });
});

route('POST', '/api/chats/:id/files', async (req, res, url, params) => {
  try {
    const body = await readBody(req);
    if (!body.base64) return fail(res, new Error('缺少 base64 内容'));
    const out = chats.addFile(params.id, body.name || 'file', Buffer.from(String(body.base64), 'base64'), body.mime);
    if (!out) return fail(res, new Error('未找到该会话'), 404);
    json(res, { ok: true, name: out.name, chat: chats.summary(out.chat) });
  } catch (err) {
    fail(res, err);
  }
});

route('GET', '/api/chats/:id/files/:name', (req, res, url, params) => {
  const abs = chats.filePath(params.id, params.name);
  if (!abs) return fail(res, new Error('未找到该附件'), 404);
  send(res, 200, fs.readFileSync(abs), {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': attachment(params.name, 'attachment.bin'),
  });
});

route('POST', '/api/cast', async (req, res) => {
  try {
    const body = await readBody(req);
    const chart = core.divination.cast({
      method: body.method,
      numbers: body.numbers,
      localTime: body.localTime,
      longitude: body.longitude,
      latitude: body.latitude,
      placeName: body.placeName,
      useTrueSolarTime: body.useTrueSolarTime,
      movingFrom: body.movingFrom,
      hexagram: body.hexagram,
      movingPosition: body.movingPosition,
      calendarType: body.calendarType,
      question: body.question,
      category: body.category,
    });
    const reading = core.verdict.interpret(chart);
    plugins.emit('cast.preview', { chart, reading });
    json(res, { ok: true, chart, reading });
  } catch (err) {
    fail(res, err);
  }
});

route('POST', '/api/import/parse', async (req, res) => {
  try {
    const body = await readBody(req);
    const text = body.text || body._raw || '';
    const blocks = core.importer.parseMany(text);
    const enriched = blocks.map((b) => ({
      ...b,
      suggestion: core.importer.suggestImport(b),
    }));
    json(res, { ok: true, count: enriched.length, blocks: enriched });
  } catch (err) {
    fail(res, err);
  }
});

route('POST', '/api/import/commit', async (req, res) => {
  try {
    const body = await readBody(req);
    const items = Array.isArray(body.items) ? body.items : [];
    const created = [];
    const failed = [];
    for (const item of items) {
      try {
        const b = item.block || item;
        const ov = item.overrides || {};
        const localTime = ov.localTime || b.fields?.localTime;
        const useHex = (ov.hexagram || b.claimed?.ben) && (ov.movingPosition || b.claimed?.moving);
        const base = {
          title: ov.title || '',
          category: ov.category || b.fields?.category || '',
          question: ov.question || b.fields?.question || '',
          narrative: b.narrative || '',
          background: b.background || '',
          plan: b.plan || '',
          collation: b.collation || '',
          qa: b.qa || '',
          claimed: b.claimed || null,
          tags: ov.tags || [],
          origin: ov.origin || { kind: 'import', label: '粘贴导入' },
          source: ov.source || null,
          review: ov.review || undefined,
        };
        let rec;
        if (b.strategy === 'xlr') {
          // 小六壬之课：三宫由引擎按「数＋时」重算（卦条里写的三宫只作对校，见 ADR-0015）
          rec = newRecordFromBody({
            ...base, mode: 'cast',
            method: b.fields.method,
            numbers: b.fields.numbers,
            calendarType: b.fields.calendarType,
            localTime,
            longitude: ov.longitude ?? b.fields?.longitude,
            placeName: ov.placeName || b.fields?.placeName,
            useTrueSolarTime: ov.useTrueSolarTime ?? b.fields?.useTrueSolarTime,
          });
        } else if (ov.forceCast || (!useHex && !ov.forceHexagram)) {
          rec = newRecordFromBody({
            ...base, mode: 'cast',
            method: ov.method || 'numberAndTime',
            numbers: ov.numbers || b.fields?.numbers,
            localTime,
            longitude: ov.longitude ?? b.fields?.longitude,
            placeName: ov.placeName || b.fields?.placeName,
            useTrueSolarTime: ov.useTrueSolarTime ?? b.fields?.useTrueSolarTime,
            movingFrom: ov.movingFrom,
          });
        } else {
          rec = newRecordFromBody({
            ...base, mode: 'hexagram',
            hexagram: ov.hexagram || b.claimed?.ben,
            movingPosition: ov.movingPosition || b.claimed?.moving,
            localTime,
            longitude: ov.longitude ?? b.fields?.longitude,
            placeName: ov.placeName || b.fields?.placeName,
            useTrueSolarTime: ov.useTrueSolarTime ?? b.fields?.useTrueSolarTime,
            numbers: ov.numbers || b.fields?.numbers,
          });
        }
        store.save(rec);
        plugins.emit('record.created', rec);
        created.push(core.record.summarize(rec));
      } catch (err) {
        failed.push({ item: item?.block?.claimed?.ben || item?.claimed?.ben || '未识', error: err.message });
      }
    }
    json(res, { ok: true, created, failed });
  } catch (err) {
    fail(res, err);
  }
});

route('GET', '/api/knowledge/hexagrams', (req, res, url) => {
  const lib = core.hexagram.library();
  const q = url.searchParams.get('q');
  let items = lib.all();
  if (q) items = items.filter((h) => `${h.id}${h.name}${h.fullName}${(h.keywords || []).join('')}`.includes(q));
  json(res, { ok: true, total: items.length, items });
});

/* 小六壬六宫与起课要旨：卦典页「小六壬六宫」那一栏的数据源。
   与 knowledge/hexagrams 并列——两套知识、两个端点，界面按占法分栏。 */
route('GET', '/api/knowledge/xlr', (req, res) => {
  json(res, {
    ok: true,
    palaces: core.xiaoliuren.XLR_PALACES,
    methods: core.xiaoliuren.XLR_METHODS,
    guide: core.xiaoliuren.XLR_GUIDE,
  });
});

route('GET', '/api/knowledge/hexagrams/:id', (req, res, url, params) => {
  const lib = core.hexagram.library();
  const h = lib.find(params.id);
  if (!h) return fail(res, new Error('未找到该卦'), 404);
  const yaoci = [];
  for (let i = 1; i <= 6; i += 1) yaoci.push({ position: i, text: lib.yaoText(h.id, i) });
  json(res, { ok: true, hexagram: h, yaoci, yong: lib.yongText(h.id) });
});

route('GET', '/api/stats', (req, res) => json(res, {
  ok: true,
  stats: store.stats(),
  trend: core.trend.trendSummary(store.list()),
  migrations: store.migrations,
}));

/* ---------- 走势 ---------- */
route('GET', '/api/trend', (req, res, url) => {
  const csv = (k) => (url.searchParams.get(k) || '').split(',').map((s) => s.trim()).filter(Boolean);
  try {
    const trend = core.trend.buildTrend(store.list(), {
      mode: url.searchParams.get('mode') || 'fortune',
      domains: csv('domains'),
      categories: csv('categories'),
      rangeDays: Number(url.searchParams.get('rangeDays')) || 0,
      xMode: url.searchParams.get('xMode') || 'index',
      // 横轴：按起卦时间（cast，原样）还是按应验时间（due，长期之事排到未来）
      axis: url.searchParams.get('axis') || 'cast',
      smooth: Number(url.searchParams.get('smooth')) || 1,
    });
    json(res, { ok: true, trend, yingqiHorizons: core.yingqi.YINGQI_HORIZONS });
  } catch (err) {
    fail(res, err);
  }
});

/* ---------- 格式规范 ---------- */
const SCHEMA_DIR = path.join(ROOT, 'schema');
const readSchema = (name) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, name), 'utf8'));
  } catch {
    return null;
  }
};

/* ---------- 帮助文档：把随包的说明文档嵌进程序里读 ----------
 * 用户不必再去文件管理器里翻 README——「文档」页直接看，左侧目录、右侧正文。
 * 只暴露白名单里的文件，且只读，不做任何拼接。 */
export const HELP_DOCS = [
  { id: 'readme', group: '上手', title: '使用说明', file: 'README.md', desc: '这个程序能做什么、怎么用、数据在哪' },
  { id: 'index', group: '上手', title: '文档索引', file: 'docs/00-文档索引.md', desc: '全套工程文档的入口与四条阅读路径' },
  { id: 'agents', group: '上手', title: '给编码 agent 的说明', file: 'AGENTS.md', desc: '改代码前必读：硬规矩与扩展点' },
  // 规范不在这里再渲染一份——它并进了「导入」页（模板＋字段字典＋版本迁移）。
  // 目录里留一个指向那页的入口，免得同一份规范出现两种呈现。
  { id: 'spec', group: '规范', title: '格式规范（卦条 v1）', link: '#/import', desc: '在「导入与格式」页：模板、字段字典与版本迁移' },
  { id: 'agent-design', group: '设计', title: 'Agent 设计', file: 'docs/05-Agent设计文档.md', desc: '助手是怎么思考和调工具的' },
  { id: 'hermes', group: '设计', title: 'Hermes 网关与路由', file: 'docs/06-Hermes网关与路由设计.md', desc: '接了哪些模型、怎么选、怎么降级' },
  { id: 'ui', group: '设计', title: '前端设计与交互规范', file: 'docs/08-前端设计与交互规范.md', desc: '界面为什么长这样' },
  { id: 'ops', group: '运维与安全', title: '部署与运维手册', file: 'docs/10-部署与运维手册.md', desc: '装、备份、排障' },
  { id: 'security', group: '运维与安全', title: '安全与隐私设计', file: 'docs/11-安全与隐私设计.md', desc: '哪些数据会离开本机' },
];

route('GET', '/api/help', (req, res) => json(res, {
  ok: true,
  docs: HELP_DOCS.map((d) => ({
    id: d.id,
    group: d.group,
    title: d.title,
    desc: d.desc,
    link: d.link || null,
    exists: d.link ? true : fs.existsSync(path.join(ROOT, d.file)),
    bytes: d.link ? 0 : (fs.existsSync(path.join(ROOT, d.file)) ? fs.statSync(path.join(ROOT, d.file)).size : 0),
  })),
}));

route('GET', '/api/help/:id', (req, res, url, params) => {
  const doc = HELP_DOCS.find((d) => d.id === params.id);
  if (!doc) return fail(res, new Error(`没有这份帮助文档：${params.id}`), 404);
  if (doc.link) return fail(res, new Error(`这份不是随包文档，请到 ${doc.link} 看`), 400);
  const abs = path.join(ROOT, doc.file);
  // 双保险：即使白名单被改坏，也不许读到仓库外面去
  if (!path.resolve(abs).startsWith(path.resolve(ROOT))) {
    return fail(res, new Error('路径越界'), 400);
  }
  if (!fs.existsSync(abs)) return fail(res, new Error(`文件不存在：${doc.file}`), 404);
  json(res, { ok: true, id: doc.id, title: doc.title, file: doc.file, markdown: fs.readFileSync(abs, 'utf8') });
});

route('GET', '/api/spec', (req, res) => json(res, {
  ok: true,
  spec: {
    schemaVersion: core.migrate.CURRENT_SCHEMA,
    guaTiao: {
      version: core.guaTiao.GUATIAO_VERSION,
      header: core.guaTiao.HEADER,
      template: core.guaTiao.template('meihua'),
      // 小六壬那一套模板：两法各一份，界面分栏展示（ADR-0015 第 6 条）
      templateXlr: core.guaTiao.template('xlr'),
      fieldAliases: core.guaTiao.FIELD_ALIASES,
      methodNames: core.guaTiao.METHOD_NAMES,
      methodLabels: core.guaTiao.METHOD_LABELS,
      schema: readSchema('gua-tiao.schema.json'),
    },
    record: {
      schema: readSchema('record.schema.json'),
      required: ['schema', 'id', 'title', 'category', 'cast', 'chart', 'reading', 'review', 'createdAt', 'updatedAt'],
    },
    categories: core.verdict.CATEGORIES,
    reviewStatuses: core.record.REVIEW_STATUS,
    methods: core.divination.METHODS,
    domains: core.trend.DOMAINS.map((d) => ({ id: d.id, name: d.name, scale: d.scale, mode: d.mode, desc: d.desc })),
    migrations: Object.keys(core.migrate.MIGRATIONS).map((k) => `v${k} → v${Number(k) + 1}`),
    docs: 'docs/规范.md',
  },
}));

route('GET', '/api/schema/:name', (req, res, url, params) => {
  const s = readSchema(`${params.name}.schema.json`);
  if (!s) return fail(res, new Error(`没有名为 ${params.name} 的 schema`), 404);
  json(res, { ok: true, schema: s });
});

route('POST', '/api/validate', async (req, res) => {
  try {
    const body = await readBody(req);
    if (body.text !== undefined) {
      const blocks = core.importer.parseMany(body.text);
      const results = blocks.map((b) => {
        const r = core.schema.validate(b, readSchema('gua-tiao.schema.json'), { strict: true });
        const extra = [];
        if (b.ok === false) extra.push({ path: 'missing', message: `信息不完整，缺：${(b.missing || []).join('、')}` });
        for (const k of b.unknownKeys || []) extra.push({ path: 'unknownKeys', message: `认不出的键名：${k}` });
        return { ok: b.ok !== false && r.valid && !extra.length, claimed: b.claimed, fields: b.fields, errors: [...r.errors, ...extra], warnings: b.warnings };
      });
      return json(res, { ok: true, count: results.length, valid: results.every((x) => x.ok), results });
    }
    const r = core.schema.validate(body.record ?? body, readSchema('record.schema.json'), { strict: true });
    json(res, { ok: true, valid: r.valid, errors: r.errors });
  } catch (err) {
    fail(res, err);
  }
});

/* ---------- 卦条 ---------- */
route('GET', '/api/guatiao/template', (req, res) => {
  send(res, 200, core.guaTiao.template(), { 'Content-Type': 'text/plain; charset=utf-8' });
});

route('POST', '/api/guatiao/parse', async (req, res) => {
  try {
    const body = await readBody(req);
    const blocks = core.guaTiao.parseGuaTiaoMany(body.text || body._raw || '');
    json(res, { ok: true, count: blocks.length, blocks });
  } catch (err) {
    fail(res, err);
  }
});

/* ---------- Agent ---------- */
const agentConfig = () => {
  const cfg = store.getConfig().agent || {};
  const resolved = agent.provider.resolveConfig(cfg);
  return { cfg, resolved };
};

/** 上下文窗口生效值：配置里给了正数就以它为准，否则用「模型名 → 窗口」预设（0 表示未知） */
const agentContextWindow = (cfg, resolved) => {
  const override = Number(cfg?.contextWindow);
  if (Number.isFinite(override) && override > 0) return Math.floor(override);
  return agent.provider.contextWindowFor(resolved.provider, resolved.model);
};

/** 对外绝不回显 apiKey 原文 */
const maskAgent = (cfg, resolved) => ({
  ...cfg,
  apiKey: undefined,
  apiKeySet: !!cfg.apiKey,
  ready: resolved.ready,
  reason: resolved.reason,
  providers: agent.provider.PROVIDERS,
  // 权限：当前等级 + 全部等级说明 + 各等级能用的工具数，界面据此画设置项
  permission: agent.permissions.normalizeLevel(cfg.permission),
  permissionLevels: agent.permissions.describeLevels(),
  // 联网：归一化后的实际生效值（不是原样回显配置），界面据此画开关与限额
  web: agent.sources.webConfigOf({ agent: cfg }),
  /** 工具来源清单：界面要按来源给工具分组，并把「联网」单独标出来 */
  sources: [{ id: 'builtin', name: '内置' }, { id: 'web', name: '联网' }],
  toolCounts: agent.permissions.LEVELS.reduce((acc, l) => {
    acc[l.id] = toolkit.tools.filter((t) => agent.permissions.allows(l.id, t.permission)).length;
    return acc;
  }, {}),
});

route('GET', '/api/agent/config', (req, res) => {
  const { cfg, resolved } = agentConfig();
  json(res, {
    ok: true,
    config: maskAgent(cfg, resolved),
    tools: toolkit.describe(),
    permissions: agent.permissions.describeLevels(),
  });
});

route('POST', '/api/agent/config', async (req, res) => {
  try {
    const body = await readBody(req);
    const current = store.getConfig().agent || {};
    const next = { ...current };
    for (const k of ['enabled', 'provider', 'baseUrl', 'model', 'temperature', 'maxTokens', 'maxRounds', 'useNativeTools', 'permission', 'contextWindow']) {
      if (body[k] !== undefined) next[k] = body[k];
    }
    // 联网：只认这几个键，且数值有上下界——这是唯一出网的开关，不能由请求体随便发挥
    if (body.web !== undefined && typeof body.web === 'object' && body.web !== null) {
      const cur = next.web || {};
      const w = { ...cur };
      if (body.web.enabled !== undefined) w.enabled = body.web.enabled !== false;
      for (const k of ['timeoutMs', 'maxBytes']) {
        const v = Number(body.web[k]);
        if (Number.isFinite(v) && v > 0) w[k] = Math.min(v, k === 'timeoutMs' ? 60000 : 8 * 1024 * 1024);
      }
      for (const k of ['allow', 'deny']) {
        if (Array.isArray(body.web[k])) {
          w[k] = body.web[k].map((s) => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 200);
        }
      }
      next.web = w;
    }
    // 权限等级只认白名单里的值，写错了一律回落默认——不静默放行
    if (next.permission !== undefined) next.permission = agent.permissions.normalizeLevel(next.permission);
    // 上下文窗口：只收非负整数，写错一律归 0（0 = 用预设，不当成 0 窗口）
    if (next.contextWindow !== undefined) {
      const n = Math.floor(Number(next.contextWindow));
      next.contextWindow = Number.isFinite(n) && n > 0 ? n : 0;
    }
    // 只有明确传了非空 apiKey 才改写；传空串表示「清除」
    if (body.apiKey !== undefined) next.apiKey = String(body.apiKey).trim();
    if (body.clearApiKey) next.apiKey = '';
    store.setConfig({ agent: next });
    const resolved = agent.provider.resolveConfig(next);
    json(res, { ok: true, config: maskAgent(next, resolved), tools: toolkit.describe() });
  } catch (err) {
    fail(res, err);
  }
});

route('GET', '/api/agent/tools', (req, res) => json(res, { ok: true, tools: toolkit.describe(), mcp: mcpInfo() }));

route('POST', '/api/agent/tool/:name', async (req, res, url, params) => {
  try {
    const body = await readBody(req);
    const out = await toolkit.call(params.name, body.arguments || body || {});
    json(res, out.ok ? { ok: true, result: out.result, ms: out.ms } : { ok: false, error: out.error }, out.ok ? 200 : 400);
  } catch (err) {
    fail(res, err);
  }
});

route('POST', '/api/agent/ping', async (req, res) => {
  try {
    const body = await readBody(req);
    const { cfg } = agentConfig();
    const merged = body.overrides ? { ...cfg, ...body.overrides } : cfg;
    const out = await agent.provider.ping(merged);
    json(res, { ok: true, ...out });
  } catch (err) {
    fail(res, err);
  }
});

route('GET', '/api/agent/models', async (req, res) => {
  try {
    const { cfg } = agentConfig();
    const models = await agent.provider.listModels(cfg);
    json(res, { ok: true, models });
  } catch (err) {
    fail(res, err);
  }
});

/* 余额：服务端代理，Key 绝不出本机、也绝不出现在响应或错误文案里。
   · 只认 balanceProfile 里带 url 的厂商；认不出就直接回兜底、一个请求都不发；
   · 成功结果缓存 60 秒（前端连点时不至于把厂商接口打爆）；失败不缓存，改完能立刻重试；
   · `?force=1` 由「点击 chip 手动刷新」传入，绕过缓存。 */
let balanceCache = { at: 0, key: '', data: null };
route('GET', '/api/agent/balance', async (req, res, url) => {
  try {
    const { resolved } = agentConfig();
    const profile = agent.provider.balanceProfile(resolved.provider, resolved.baseUrl);
    if (!profile.url) {
      return json(res, { ok: true, supported: false, hint: '该厂商不提供余额接口，去控制台看', console: profile.console });
    }
    const cacheKey = `${resolved.provider}|${profile.url}|${resolved.apiKey ? 'k1' : 'k0'}`;
    const force = url.searchParams.get('force') === '1';
    if (!force && balanceCache.data && balanceCache.key === cacheKey && Date.now() - balanceCache.at < 60000) {
      return json(res, balanceCache.data);
    }
    const out = await agent.provider.fetchBalance({
      provider: resolved.provider, baseUrl: resolved.baseUrl, apiKey: resolved.apiKey || '',
    });
    if (out.ok && out.supported) balanceCache = { at: Date.now(), key: cacheKey, data: out };
    json(res, out);
  } catch (err) {
    // 余额查不到不该是 500：界面把它标成「余额 ?」让人重试即可
    json(res, { ok: false, error: `余额查询失败：${err?.message || String(err)}` });
  }
});

route('POST', '/api/agent/chat', async (req, res) => {
  try {
    const body = await readBody(req);
    const { cfg, resolved } = agentConfig();
    if (!resolved.ready) {
      return fail(res, new Error(`AI 助手未配置好：${resolved.reason}。到「助手」页填好模型与密钥即可。`), 400);
    }
    /* 历史由**服务端**给：带 sessionId 时优先取会话存档里的模型侧消息（含成对的
       tool_calls 与工具结果），界面只送「本轮新说的话」。早先让界面拿展示用的 trace
       重拼历史，工具结果全被丢掉——模型下一轮看不到自己算过的卦，只能凭记忆编。
       存档不可用（老会话、无会话）时退回界面送来的 messages。 */
    const sessionId = body.sessionId && chats.has(String(body.sessionId)) ? String(body.sessionId) : '';
    const { messages: history, source: historySource } = ChatStore.historyFor(
      sessionId ? chats.get(sessionId) : null,
      Array.isArray(body.messages) ? body.messages : [],
    );
    if (!history.length) return fail(res, new Error('messages 为空'), 400);
    /* body.stream = true 时边走边报：每行一个 JSON（NDJSON），先把 loop 里刚发生的事
       （轮次 / 思考 / 工具起止 / 回答 / 报错）推给界面，最后再推一行 done（载荷与
       非流式响应完全一致）。为什么要有它：不流式的话，界面只能干等一行「思考中…」，
       思考卡、工具卡、回答全在最后一刻一起蹦出来——「过程」是看不见的。 */
    const streaming = body.stream === true;
    let writeLine = null;
    if (streaming) {
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      });
      writeLine = (obj) => { try { res.write(`${JSON.stringify(obj)}\n`); } catch { /* 客户端断了就算了 */ } };
    }

    const out = await agent.loop.runAgent({
      config: resolved,
      messages: history,
      toolkit,
      maxRounds: Number(body.maxRounds) || resolved.maxRounds || 6,
      onEvent: streaming ? (e) => writeLine({ type: 'event', event: clipToolResult(e) }) : undefined,
    });
    plugins.emit('agent.reply', { reply: out.reply, rounds: out.rounds, permission: toolkit.permission });

    // 画面上的轨迹：由**服务端**统一映射（见 loop.entriesFromEvents 的说明），
    // 界面直接渲染它，不再自己拼一遍——一处实现，两处用。
    const userText = history.filter((m) => m.role === 'user').pop()?.content || '';
    const trace = agent.loop.entriesFromEvents(out.events, { userText, reply: out.reply });

    // 带了 sessionId 就落盘：trace 给人回看，messages 给模型（完整值，不截断）。
    // 落盘放在服务端，是因为只有这里握着未截断的工具结果。
    //
    // messages 只留**本轮新增**：out.messages 是「system + 这轮输入的历史 + 本轮新增」的整份，
    // 整段存的话每轮都会把此前历史再抄一遍（文件按轮数平方级膨胀）。增量里**必须带上这一轮的
    // 用户消息**——否则存档只攒下一串 assistant/tool，下一轮回推时模型看不到自己是在回答什么；
    // 而 append 只是往尾部接，所以这里给 [用户那句, ...本轮新条目]。
    let session = null;
    if (body.sessionId && chats.has(String(body.sessionId))) {
      const tail = history[history.length - 1];
      const turnUser = tail?.role === 'user' ? [tail] : [];
      const saved = chats.append(String(body.sessionId), {
        trace,
        messages: [...turnUser, ...out.messages.filter((m) => m.role !== 'system').slice(history.length)],
        provider: cfg.provider,
        model: resolved.model,
        permission: toolkit.permission,
      });
      if (saved) session = chats.summary(saved);
    }

    const payload = {
      ok: true,
      reply: out.reply,
      trace,
      session,
      events: out.events.map(clipToolResult),
      rounds: out.rounds,
      usage: out.usage,
      mode: out.mode,
      protocol: out.protocol || '',
      historySource,
      // 破坏性操作与联网工具停在半路等确认：把待确认的事交回界面。
      // 界面确认后用 /api/agent/tool/<name> 带 confirm:true 执行，
      // 再把结果作为新一轮的输入带回来。
      pendingConfirm: out.pendingConfirm || null,
      permission: toolkit.permission,
    };
    if (streaming) {
      writeLine({ type: 'done', ...payload });
      res.end();
      return;
    }
    json(res, payload);
  } catch (err) {
    // 流式下头已经发出去了，不能再改状态码：用一行 error 收尾，界面照样能显示
    if (res.headersSent) {
      try {
        res.write(`${JSON.stringify({ type: 'error', error: err?.message || String(err) })}\n`);
        res.end();
      } catch { /* 断了就算了 */ }
      return;
    }
    fail(res, err);
  }
});

/** 工具结果回给界面时切到 4000 字符：界面只用来显示轨迹摘要，不需要全量（流式与非流式共用） */
function clipToolResult(e) {
  return e.type === 'tool' && e.phase === 'done' && e.result
    ? { ...e, result: JSON.stringify(e.result).slice(0, 4000) }
    : e;
}

route('GET', '/api/agent/mcp', (req, res) => json(res, { ok: true, ...mcpInfo() }));

function mcpInfo() {
  const script = path.join(ROOT, 'agent', 'mcp-server.mjs');
  return {
    script,
    command: 'node',
    args: [script],
    protocolVersion: '2024-11-05',
    toolCount: toolkit.tools.length,
    snippets: {
      codex: `# ~/.codex/config.toml\n[mcp_servers.wenxingua]\ncommand = "node"\nargs = ["${script.replace(/\\/g, '\\\\')}"]`,
      claude: JSON.stringify({ mcpServers: { wenxingua: { command: 'node', args: [script] } } }, null, 2),
      dsh: JSON.stringify({ mcpServers: { wenxingua: { command: 'node', args: [script] } } }, null, 2),
    },
  };
}

route('GET', '/api/plugins', (req, res) => json(res, { ok: true, ...plugins.api() }));

route('POST', '/api/plugins/reload', async (req, res) => {
  try {
    const api = await plugins.loadAll();
    json(res, { ok: true, ...api });
  } catch (err) {
    fail(res, err);
  }
});

route('POST', '/api/plugins/:id/toggle', async (req, res, url, params) => {
  const body = await readBody(req);
  const cfg = plugins.toggle(params.id, body.enabled !== false);
  await plugins.loadAll();
  json(res, { ok: true, config: cfg, ...plugins.api() });
});

route('GET', '/api/plugins/:pid/page/:pageId', async (req, res, url, params) => {
  const page = plugins.findPage(params.pid, params.pageId);
  if (!page) return fail(res, new Error('未找到该插件页面'), 404);
  try {
    const out = await page.render({ store, core, url });
    if (typeof out === 'string') return send(res, 200, out, { 'Content-Type': 'text/html; charset=utf-8' });
    json(res, { ok: true, page: { id: page.id, label: page.label, ...out } });
  } catch (err) {
    fail(res, err);
  }
});

route('GET', '/api/plugins/:pid/panel/:panelId', (req, res, url, params) => {
  const panel = plugins.findPanel(params.pid, params.panelId);
  if (!panel) return fail(res, new Error('未找到该插件面板'), 404);
  const rec = store.get(url.searchParams.get('recordId'));
  if (!rec) return fail(res, new Error('未找到该卦录'), 404);
  json(res, { ok: true, panel: { id: panel.id, label: panel.label, ...panel.render({ record: rec, store, core }) } });
});

route('POST', '/api/restore', async (req, res) => {
  try {
    const body = await readBody(req);
    const result = store.restore(body, { merge: body.merge !== false });
    // 整包备份里带了会话就一并恢复；没有这条，换机后对话历史会静默消失
    const chatList = Array.isArray(body?.chats) ? body.chats : [];
    let chatAdded = 0;
    for (const c of chatList) {
      if (!c?.id) continue;
      if (chats.has(c.id) && body.merge === false) continue;
      chats.save({ ...(chats.get(c.id) || {}), ...c });
      chatAdded += 1;
    }
    json(res, { ok: true, ...result, chatAdded, chatTotal: chats.list().length });
  } catch (err) {
    fail(res, err);
  }
});

route('POST', '/api/shutdown', (req, res) => {
  json(res, { ok: true, message: '服务即将停止' });
  setTimeout(() => process.exit(0), 200);
});

/* ---------- 主处理 ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return send(res, 204, '');

  try {
    // 若 data/records/ 被本进程之外的东西改过（如命令行 tools/import.mjs 在服务运行期间导入），
    // 这里自动重扫一次，只花一次 statSync
    const scan = store.maybeRescan();
    if (scan.rescanned && scan.before !== scan.after) {
      console.log(`[store] 检测到外部改动，已重扫：${scan.before} → ${scan.after} 条`);
    }

    // 插件路由优先
    const pluginMatch = plugins.matchRoute(req.method, pathname);
    if (pluginMatch) {
      const ctx = {
        req,
        res,
        url,
        params: pluginMatch.params,
        store,
        core,
        plugins,
        // 以下三个已绑定 res，插件里直接 ctx.json(data) 即可
        json: (data, code = 200) => json(res, data, code),
        send: (body, code = 200, headers = {}) => send(res, code, body, headers),
        html: (body, code = 200) => send(res, code, body, { 'Content-Type': 'text/html; charset=utf-8' }),
        text: (body, code = 200) => send(res, code, body, { 'Content-Type': 'text/plain; charset=utf-8' }),
        readBody: (limit) => readBody(req, limit),
        query: (k) => url.searchParams.get(k),
      };
      const handled = await pluginMatch.route.handler(ctx);
      if (handled !== false && !res.writableEnded) json(res, { ok: true });
      return undefined;
    }

    // 插件静态资源
    if (pathname.startsWith('/plugin-assets/')) {
      const rest = pathname.slice('/plugin-assets/'.length);
      const [pid, ...tail] = rest.split('/');
      const base = path.join(dataDir, 'plugins', pid);
      return serveStatic(res, base, tail.join('/'));
    }

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.re);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return await r.handler(req, res, url, params);
    }

    if (pathname.startsWith('/api/')) return fail(res, new Error(`未知接口 ${pathname}`), 404);

    // 静态界面
    return serveStatic(res, path.join(ROOT, 'web'), pathname, true);
  } catch (err) {
    console.error(err);
    if (!res.writableEnded) fail(res, err, 500);
    return undefined;
  }
});

/**
 * 起服务。
 *
 * 这个模块有**两种用法**：
 *   1. 命令行：`node server/index.mjs` —— 见文件末尾的 isMain 分支；
 *   2. 被嵌入：桌面版（Electron）主进程直接 import 本模块，
 *      拿到 `app` 后在**自己进程内**调 `app.listen()`。
 *      不另起子进程，也就不会闪出一个黑色控制台窗口。
 */
export const app = {
  httpServer: server,
  core,
  store,
  plugins,
  toolkit,
  routes,
  root: ROOT,
  dataDir,
  // 桌面菜单的「帮助」用同一份清单建菜单，免得两处各写一遍文档列表
  HELP_DOCS,
  /** 起监听。port 传 0 表示让系统分配一个空闲端口。 */
  listen(port = PORT, host = HOST, { quiet = false, open = false } = {}) {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        const actual = server.address();
        const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actual.port}/`;
        if (!quiet) {
          const lib = core.hexagram.library();
          console.log([
            '',
            '  ┌──────────────────────────────────────────────┐',
            '  │            问  心  卦   ·   卦录台            │',
            '  └──────────────────────────────────────────────┘',
            `   版本      v${APP_VERSION}`,
            `   地址      ${url}`,
            `   数据目录  ${dataDir}`,
            `   卦典      ${lib.stats().count} 卦 / 爻辞 ${lib.stats().withYaoci} 卦`,
            `   卦录      ${store.list().length} 条`,
            `   插件      ${plugins.api().plugins.filter((p) => p.loaded).length} 个已载入`,
            '',
            '   按 Ctrl+C 停止服务',
            '',
          ].join('\n'));
        }
        if (open) {
          const cmd = os.platform() === 'win32' ? 'cmd' : os.platform() === 'darwin' ? 'open' : 'xdg-open';
          const args = os.platform() === 'win32' ? ['/c', 'start', '', url] : [url];
          execFile(cmd, args, () => {});
        }
        resolve({ url, port: actual.port, host });
      });
    });
  },
  close() {
    return new Promise((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
      // 保险：长连接（SSE／保持连接）会让 close 挂着，超时就直接放行
      setTimeout(resolve, 1500);
    });
  },
};

/* ---------- 命令行入口 ---------- */
const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    await app.listen(PORT, HOST, { open: OPEN });
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`\n  端口 ${PORT} 已被占用。换一个：node server/index.mjs --port 19731\n`);
    } else {
      console.error('\n  启动失败：', err?.stack || err?.message || err, '\n');
    }
    process.exit(1);
  }

  process.on('SIGINT', async () => {
    await app.close();
    console.log('\n问心卦已停止。卦录仍在 data/records/ 中，随时可再启。');
    process.exit(0);
  });
}
