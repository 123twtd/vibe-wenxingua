#!/usr/bin/env node
/**
 * 问心卦 · MCP 服务（stdio）
 * ------------------------------------------------------------
 * 让 Codex CLI、Claude Code、DeepSeek Harness 等支持 MCP 的 agent
 * **直接驱动问心卦**：起卦、存档、复盘、看走势、查卦典。
 *
 * 协议：JSON-RPC 2.0，换行分隔（MCP 的 stdio transport）。
 * 注意：stdout 只允许出现 JSON-RPC 消息，任何日志一律走 stderr。
 *
 * 单独运行：
 *   node agent/mcp-server.mjs
 *
 * 在 Codex config.toml 里接进来：
 *   [mcp_servers.wenxingua]
 *   command = "node"
 *   args = ["F:\\...\\问心卦\\agent\\mcp-server.mjs"]
 *
 * 在 Claude Code / DSH 里接进来（.mcp.json）：
 *   { "mcpServers": { "wenxingua": { "command": "node",
 *     "args": ["F:\\...\\问心卦\\agent\\mcp-server.mjs"] } } }
 */

import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

/** 版本号只从 package.json 取一处，免得与 HTTP 服务、README 漂移 */
const PKG_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

export const SERVER_INFO = { name: 'wenxingua', title: '问心卦 · 卦录台', version: PKG_VERSION };
export const PROTOCOL_VERSION = '2024-11-05';

/** 组装运行环境（MCP 与 HTTP 共用） */
export async function makeRuntime() {
  const core = {
    calendar: await load('core/calendar.mjs'),
    bagua: await load('core/bagua.mjs'),
    hexagram: await load('core/hexagram.mjs'),
    divination: await load('core/divination.mjs'),
    verdict: await load('core/verdict.mjs'),
    record: await load('core/record.mjs'),
    render: await load('core/render.mjs'),
    importer: await load('core/importer.mjs'),
    trend: await load('core/trend.mjs'),
    guaTiao: await load('core/guaTiao.mjs'),
    migrate: await load('core/migrate.mjs'),
  };
  const { Store } = await load('server/store.mjs');
  const { createToolkit } = await load('agent/tools.mjs');
  const store = new Store(path.join(ROOT, 'data'));
  // 权限等级跟界面里设的是同一个值：外部 agent（Codex/Claude/DSH）与内置助手
  // 受同一把尺子管。默认「可写」——够它们起卦存档，但删不了东西。
  // 这比给 MCP 开全权安全得多，也比另设一套开关更不容易被误解。
  const toolkit = createToolkit({
    store,
    core,
    permission: () => {
      try {
        return store.getConfig().agent?.permission;
      } catch {
        return undefined; // 让 createToolkit 回落到 DEFAULT_LEVEL
      }
    },
  });
  return { store, core, toolkit, root: ROOT };
}

/**
 * 处理一条 JSON-RPC 请求。
 * @returns {object|null} 响应对象；通知（无 id）返回 null
 */
export async function handleRpc(req, runtime) {
  const { id, method, params } = req || {};
  const isNotification = id === undefined || id === null;

  const ok = (result) => (isNotification ? null : { jsonrpc: '2.0', id, result });
  const err = (code, message) => (isNotification ? null : { jsonrpc: '2.0', id, error: { code, message } });

  try {
    switch (method) {
      case 'initialize':
        return ok({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            '问心卦：梅花易数卦录台。用 tools/call 调 cast 起卦（卦象由本服务依正法算出，勿自行编造卦名爻辞）、'
            + 'save_gua_tiao 批量录入、list_records／get_record 查旧卦、update_review 写复盘、trend 看走势、'
            + 'hexagram_lookup 查卦典。先调 format_spec 了解「卦条」导入格式。',
        });

      case 'notifications/initialized':
      case 'initialized':
        return null;

      case 'ping':
        return ok({});

      case 'tools/list':
        return ok({ tools: runtime.toolkit.mcpTools() });

      case 'tools/call': {
        const name = params?.name;
        const args = params?.arguments || {};
        if (!name) return err(-32602, '缺少参数 name');
        const out = await runtime.toolkit.call(name, args);
        const text = out.ok
          ? JSON.stringify(out.result, null, 2)
          : `工具执行失败：${out.error}`;
        return ok({
          content: [{ type: 'text', text }],
          isError: !out.ok,
          _meta: { tool: name, ms: out.ms },
        });
      }

      case 'resources/list': {
        const recs = runtime.store.list();
        return ok({
          resources: [
            {
              uri: 'wenxingua://records',
              name: '全部卦录',
              title: '全部卦录（摘要）',
              mimeType: 'application/json',
              description: `当前共 ${recs.length} 条卦录的摘要清单`,
            },
            {
              uri: 'wenxingua://spec/gua-tiao',
              name: '卦条格式规范',
              title: '卦条 v1 格式',
              mimeType: 'text/plain',
              description: '导入卦象的稳定文本格式',
            },
            {
              uri: 'wenxingua://stats',
              name: '总览统计',
              title: '卦录统计',
              mimeType: 'application/json',
            },
          ],
        });
      }

      case 'resources/read': {
        const uri = params?.uri || '';
        if (uri === 'wenxingua://records') {
          return ok({
            contents: [{
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(runtime.store.list().map((r) => ({
                id: r.id, title: r.title, category: r.category, localTime: r.cast?.localTime,
                ben: r.chart?.ben?.fullName, grade: r.reading?.grade?.label, review: r.review?.status,
              })), null, 2),
            }],
          });
        }
        if (uri === 'wenxingua://spec/gua-tiao') {
          return ok({
            contents: [{ uri, mimeType: 'text/plain', text: runtime.core.guaTiao.template() }],
          });
        }
        if (uri === 'wenxingua://stats') {
          return ok({
            contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(runtime.store.stats(), null, 2) }],
          });
        }
        if (uri.startsWith('wenxingua://record/')) {
          const id = decodeURIComponent(uri.slice('wenxingua://record/'.length));
          const rec = runtime.store.get(id);
          if (!rec) return err(-32602, `未找到卦录 ${id}`);
          return ok({
            contents: [{
              uri,
              mimeType: 'text/markdown',
              text: runtime.core.render.toMarkdown(rec),
            }],
          });
        }
        return err(-32602, `未知资源 ${uri}`);
      }

      case 'prompts/list':
        return ok({
          prompts: [
            {
              name: 'divine',
              description: '按梅花易数起一卦并给出有卦象气质的解读',
              arguments: [
                { name: 'question', description: '所问之事', required: true },
                { name: 'number', description: '1–100 的报数', required: false },
                { name: 'time', description: '起卦时间 YYYY-MM-DD HH:mm', required: false },
              ],
            },
            {
              name: 'review_due',
              description: '检查哪些卦该复盘了',
              arguments: [],
            },
          ],
        });

      case 'prompts/get': {
        const name = params?.name;
        const a = params?.arguments || {};
        if (name === 'divine') {
          return ok({
            description: '起卦',
            messages: [{
              role: 'user',
              content: {
                type: 'text',
                text: `请为我起一卦。\n所问：${a.question || '（未填）'}\n报数：${a.number || '（未给，请先问我）'}\n时间：${a.time || '（未给，用当前时间）'}\n`
                  + '请先调 cast 工具取得卦象与断语，再按【主】【互】【变】【断】【宜】【忌】【应期】原文引述，最后用白话告诉我该做什么。',
              },
            }],
          });
        }
        if (name === 'review_due') {
          return ok({
            description: '应复盘的卦',
            messages: [{
              role: 'user',
              content: { type: 'text', text: '请调 list_records（review=待应验 或 应验中），再结合每条卦的起卦时间与动爻位置，告诉我哪些卦的应期已经到了、该复盘了。' },
            }],
          });
        }
        return err(-32602, `未知 prompt ${name}`);
      }

      default:
        return err(-32601, `不支持的方法：${method}`);
    }
  } catch (e) {
    return err(-32603, `内部错误：${e.message}`);
  }
}

/** 启动 stdio 服务 */
export async function serveStdio(runtime) {
  const rt = runtime || await makeRuntime();
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const write = (obj) => {
    if (obj) process.stdout.write(`${JSON.stringify(obj)}\n`);
  };

  process.stderr.write(`[问心卦 MCP] 已就绪，共 ${rt.toolkit.tools.length} 个工具，${rt.store.list().length} 条卦录\n`);

  for await (const line of rl) {
    const text = String(line).trim();
    if (!text) continue;
    let req;
    try {
      req = JSON.parse(text);
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON 解析失败' } });
      continue;
    }
    if (Array.isArray(req)) {
      const out = await Promise.all(req.map((r) => handleRpc(r, rt)));
      for (const o of out) write(o);
    } else {
      write(await handleRpc(req, rt));
    }
  }
  process.stderr.write('[问心卦 MCP] stdin 关闭，退出\n');
}

// 直接运行时才启动（被 import 测试时不启动）
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  serveStdio().catch((e) => {
    process.stderr.write(`[问心卦 MCP] 启动失败：${e.stack || e.message}\n`);
    process.exit(1);
  });
}
