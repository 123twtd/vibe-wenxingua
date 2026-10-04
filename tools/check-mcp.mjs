/**
 * 问心卦 · MCP 服务自检（真实 stdio 往返）
 * ------------------------------------------------------------
 * 用法：node tools/check-mcp.mjs
 *
 * 为什么单独测这个：MCP 的 stdio 通道有一个致命约束——
 * **stdout 只允许出现 JSON-RPC 消息**，任何一行日志漏到 stdout 都会让
 * Codex / Claude 直接解析失败。进程内调用测不出这一点，必须真起一个子进程。
 */

import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'agent', 'mcp-server.mjs');

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${name}${detail ? `　${detail}` : ''}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? `　${detail}` : ''}`); }
};

console.log(`\n目标：${SCRIPT}\n`);

const child = spawn(process.execPath, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => { stdout += d.toString(); });
child.stderr.on('data', (d) => { stderr += d.toString(); });

const send = (o) => child.stdin.write(`${JSON.stringify(o)}\n`);

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } });
send({ jsonrpc: '2.0', method: 'notifications/initialized' });
send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
send({ jsonrpc: '2.0', id: 3, method: 'resources/list' });
send({ jsonrpc: '2.0', id: 4, method: 'prompts/list' });
send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'stats', arguments: {} } });
send({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'format_spec', arguments: {} } });
send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: '根本没有的工具', arguments: {} } });
send({ jsonrpc: '2.0', id: 8, method: '根本没有的方法' });
send({ jsonrpc: '2.0', id: 9, method: 'resources/read', params: { uri: 'wenxingua://records' } });

await new Promise((r) => setTimeout(r, 3000));
child.stdin.end();
await new Promise((r) => setTimeout(r, 400));
child.kill();

/* ---------- 解析 stdout ---------- */
const rawLines = stdout.split('\n').filter((l) => l.trim());
let parseErrors = 0;
const responses = new Map();
for (const line of rawLines) {
  try {
    const o = JSON.parse(line);
    if (o.id !== undefined && o.id !== null) responses.set(o.id, o);
    else if (!o.method) parseErrors += 1;
  } catch {
    parseErrors += 1;
  }
}

console.log('【一】stdout 纯净性（MCP 的生死线）');
check('stdout 每一行都是合法 JSON-RPC', parseErrors === 0, `${rawLines.length} 行，解析失败 ${parseErrors} 行`);
check('日志确实走了 stderr 而非 stdout', stderr.length > 0 && !stdout.includes('[问心卦 MCP]'),
  `stderr：${stderr.trim().split('\n')[0] || '（空）'}`);

console.log('\n【二】协议往返');
const init = responses.get(1)?.result;
check('initialize 返回协议版本与服务器信息', !!init?.protocolVersion && !!init?.serverInfo,
  `${init?.serverInfo?.name}@${init?.serverInfo?.version}　协议 ${init?.protocolVersion}`);
check('initialize 声明 tools 与 resources 能力', !!init?.capabilities?.tools && !!init?.capabilities?.resources);
check('initialize 带使用说明（instructions）', typeof init?.instructions === 'string' && init.instructions.length > 40);

const tools = responses.get(2)?.result?.tools;
check('tools/list 返回工具且都有 inputSchema',
  Array.isArray(tools) && tools.length >= 10 && tools.every((t) => t.name && t.inputSchema?.type === 'object'),
  `${tools?.length} 个：${tools?.slice(0, 5).map((t) => t.name).join('、')}…`);
check('通知（notifications/initialized）不产生响应', !responses.has(undefined) && rawLines.length === responses.size,
  `${rawLines.length} 行 / ${responses.size} 个响应`);

const res = responses.get(3)?.result?.resources;
check('resources/list 返回资源', Array.isArray(res) && res.length >= 2, res?.map((r) => r.uri).join('、'));

const prompts = responses.get(4)?.result?.prompts;
check('prompts/list 返回提示模板', Array.isArray(prompts) && prompts.length >= 1, prompts?.map((p) => p.name).join('、'));

const stats = responses.get(5)?.result;
check('tools/call stats 返回文本内容且非错误', stats && !stats.isError && stats.content?.[0]?.type === 'text',
  `${stats?.content?.[0]?.text?.length || 0} 字节`);

const spec = responses.get(6)?.result;
const specText = spec?.content?.[0]?.text || '';
check('tools/call format_spec 含卦条模板', specText.includes('# 卦条 v1'), `${specText.length} 字节`);

const badTool = responses.get(7)?.result;
check('未知工具返回 isError 而非崩溃', badTool?.isError === true && /没有名为/.test(badTool.content[0].text),
  badTool?.content?.[0]?.text?.slice(0, 50));

const badMethod = responses.get(8)?.error;
check('未知方法返回 JSON-RPC 错误 -32601', badMethod?.code === -32601, badMethod?.message);

const recRes = responses.get(9)?.result;
check('resources/read 能读卦录清单', /"id"/.test(recRes?.contents?.[0]?.text || ''),
  `${recRes?.contents?.[0]?.text?.length || 0} 字节，mime ${recRes?.contents?.[0]?.mimeType}`);

console.log(`\n———— 通过 ${pass} 项，失败 ${fail} 项 ————`);
if (fail) process.exit(1);
console.log('MCP 服务正常。\n');
