/**
 * 问心卦 · 工具来源
 * ------------------------------------------------------------
 * 一层「工具从哪来」的接口。内置工具仍然写在 `agent/tools.mjs` 里，
 * 而**外来的**工具（联网抓取，将来还有搜索、各家 SDK、更多 MCP 实现）
 * 由「来源」贡献：一个来源导出 `{ id, name, tools() }`，
 * `createToolkit({ sources })` 把它合并进同一份工具集。
 *
 * 为什么单独开一个文件而不是塞进 `agent/tools.mjs`：
 *   `tools.mjs` 的职责是「注册表 + 权限 + 闸门」，它已经够重了；
 *   而网络抓取带着 SSRF 守卫、重定向策略、体积与超时上限——
 *   这是本项目**唯一**的出网实现，也是最需要被单独审计的一段代码。
 *   放在一起只会让两边都难读，所以拆开，但**仍然只由 createToolkit 一处合并**，
 *   不另起一套注册机制（硬规矩：一处实现，多处复用）。
 *
 * 出网边界由 [ADR-0013](../docs/adr/ADR-0013-受控联网工具.md) 定：
 * 默认在工具表里，但**每次调用都要用户确认**；确认语义与「破坏性操作」分开。
 */

import net from 'node:net';
import dns from 'node:dns/promises';

export const SOURCE_ID = 'web';
/** 跟随重定向的跳数上限。每一跳都要重新过守卫——302 跳内网是最常见的绕过手法 */
export const MAX_REDIRECTS = 3;
export const DEFAULT_TIMEOUT_MS = 10000;
export const DEFAULT_MAX_BYTES = 512 * 1024;

/* ============================================================
 * 一、地址判定：SSRF 守卫
 * ------------------------------------------------------------
 * 服务只监听 127.0.0.1，所以「让模型去抓一个网址」等于把这台机器
 * 变成了对外探针。只挡字面量 IP 是不够的，必须**先解析再校验**，
 * 否则 `http://localhost`、十进制 IP、`::ffff:127.0.0.1` 都能溜进来。
 * ========================================================== */

/** 这些 IPv4 段一律拒绝：回环、私有、链路本地（含云元数据）、组播、保留 */
const V4_BLOCKED = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
  '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.168.0.0/16', '198.18.0.0/15',
  '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
];

const v4ToInt = (ip) => ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;

function inCidr4(ip, cidr) {
  const [base, bits] = cidr.split('/');
  const mask = bits === '0' ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
}

export function isBlockedV4(ip) {
  return V4_BLOCKED.some((c) => inCidr4(ip, c));
}

/**
 * IPv6 只按前导 hextet 判段，够覆盖回环、ULA、链路本地与组播；
 * IPv4-mapped（`::ffff:1.2.3.4`）要拆出来按 IPv4 规则判——
 * 这是最容易被忽略的一条绕过路径。
 */
export function isBlockedV6(ip) {
  const s = String(ip).toLowerCase().split('%')[0];
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedV4(mapped[1]);
  if (s === '::' || s === '::1') return true;
  const first = s.split(':')[0];
  if (!first) return true;                 // 形如 ":…" 的异常写法，保守拦掉
  const n = parseInt(first.padStart(4, '0'), 16);
  if (Number.isNaN(n)) return true;
  if (n >= 0xfc00 && n <= 0xfdff) return true;   // fc00::/7 唯一本地
  if (n >= 0xfe80 && n <= 0xfebf) return true;   // fe80::/10 链路本地
  if (n >= 0xff00) return true;                  // ff00::/8 组播
  return false;
}

export function isBlockedAddress(addr) {
  return net.isIPv4(addr) ? isBlockedV4(addr) : isBlockedV6(addr);
}

/**
 * 判定一个地址能不能抓。
 * @returns {Promise<{ok:boolean, url?:string, reason?:string, addresses?:string[]}>}
 */
export async function checkUrl(rawUrl, { allow = [], deny = [] } = {}) {
  let u;
  try {
    u = new URL(String(rawUrl));
  } catch {
    return { ok: false, reason: '不是合法的网址（要带 http:// 或 https://）' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: `只允许 http 与 https，收到的是 ${u.protocol}` };
  }
  const host = u.hostname.toLowerCase();
  if (deny.includes(host)) return { ok: false, reason: `${host} 在拒绝名单里` };
  if (allow.length && !allow.includes(host)) return { ok: false, reason: `${host} 不在允许名单里` };

  if (net.isIP(host)) {
    if (isBlockedAddress(host)) return { ok: false, reason: `拒绝访问内网／保留地址 ${host}` };
    return { ok: true, url: u.href, addresses: [host] };
  }

  // 域名：先解析，再校验解析结果。跳过这一步，localhost 与十进制 IP 都能进来
  let addrs = [];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch (err) {
    return { ok: false, reason: `域名解析失败：${err.message}` };
  }
  if (!addrs.length) return { ok: false, reason: `域名解析不出地址：${host}` };
  const bad = addrs.find((a) => isBlockedAddress(a.address));
  if (bad) return { ok: false, reason: `${host} 解析到内网／保留地址 ${bad.address}，已拒绝` };
  return { ok: true, url: u.href, addresses: addrs.map((a) => a.address) };
}

/* ============================================================
 * 二、把网页变成可读文本
 * ========================================================== */

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
};

/**
 * 极简 HTML → 文本。不引解析库（零依赖），够把正文读出来即可：
 * 去掉 script/style/noscript，把块级标签换成换行，解几个常见实体，压掉空行。
 */
export function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, '\n');
  s = s.replace(/<(p|div|section|article|li|tr|h[1-6]|blockquote|pre)[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
  s = s.replace(/&[a-z]+;|&#39;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
  s = s.replace(/[ \t\f\v]+/g, ' ');
  s = s.replace(/ *\n */g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

export function titleOf(html) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  return m ? htmlToText(m[1]).replace(/\s+/g, ' ').trim() : '';
}

/* ============================================================
 * 三、抓取
 * ========================================================== */

/** content-type 必须是我们能当文本读的；二进制一律不碰（不猜、不解析） */
const TEXTUAL = /^(text\/|application\/(json|xml|xhtml\+xml|rss\+xml|atom\+xml|javascript|ld\+json))/i;

function charsetOf(contentType) {
  const m = /charset=([\w-]+)/i.exec(String(contentType || ''));
  return m ? m[1].toLowerCase() : 'utf-8';
}

function decode(buf, charset) {
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buf);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
  }
}

/** 逐块读并在超上限处截断——不能用 arrayBuffer()，那等于让对方决定我们的内存 */
async function readCapped(res, maxBytes) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();   // eslint-disable-line no-await-in-loop
    if (done) break;
    const room = maxBytes - size;
    if (value.length >= room) {
      chunks.push(value.subarray(0, Math.max(0, room)));
      size += Math.max(0, room);
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    size += value.length;
  }
  return { buf: Buffer.concat(chunks.map((c) => Buffer.from(c))), truncated };
}

/**
 * 抓一个网址并转成可读文本。每一跳都重新过守卫。
 * @returns {Promise<object>} {ok, url, status, title, text, bytes, truncated} 或 {ok:false, error}
 */
export async function fetchReadable(rawUrl, opts = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    allow = [],
    deny = [],
  } = opts;

  let current = String(rawUrl);
  const hops = [];
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const guard = await checkUrl(current, { allow, deny });
    if (!guard.ok) return { ok: false, error: guard.reason, url: current, hops };
    hops.push(guard.url);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(guard.url, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          // 说清自己是谁：被抓的一方有权知道来访者不是浏览器
          'User-Agent': 'wenxingua/1.1 (+local divination record app)',
          Accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.1',
        },
      });

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get('location');
        if (!loc) return { ok: false, error: `HTTP ${res.status} 没有给出跳转目标`, url: guard.url, hops };
        current = new URL(loc, guard.url).href;
        continue;
      }
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, url: guard.url, hops };

      const type = res.headers.get('content-type') || '';
      if (!TEXTUAL.test(type)) {
        return { ok: false, error: `不是文本类内容（${type || '未标明类型'}），本工具只读文本页面`, url: guard.url, hops };
      }

      const { buf, truncated } = await readCapped(res, maxBytes);
      const raw = decode(buf, charsetOf(type));
      const isHtml = /html|xml/i.test(type);
      return {
        ok: true,
        url: guard.url,
        status: res.status,
        contentType: type,
        title: isHtml ? titleOf(raw) : '',
        text: isHtml ? htmlToText(raw) : raw.trim(),
        bytes: buf.length,
        truncated,
        hops,
      };
    } catch (err) {
      const why = err.name === 'AbortError' ? `超过 ${timeoutMs} 毫秒未完成` : err.message;
      return { ok: false, error: `请求失败：${why}`, url: guard.url, hops };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: `跳转超过 ${MAX_REDIRECTS} 次，停止`, url: current, hops };
}

/* ============================================================
 * 四、来源定义
 * ========================================================== */

const DEFAULT_WEB = {
  enabled: true,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxBytes: DEFAULT_MAX_BYTES,
  allow: [],
  deny: [],
};

/** 把 config 里的 agent.web 归一化成抓取参数 */
export function webConfigOf(config) {
  const w = (config && config.agent && config.agent.web) || {};
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    enabled: w.enabled !== false,
    timeoutMs: num(w.timeoutMs, DEFAULT_WEB.timeoutMs),
    maxBytes: num(w.maxBytes, DEFAULT_WEB.maxBytes),
    allow: Array.isArray(w.allow) ? w.allow.map((s) => String(s).toLowerCase()) : [],
    deny: Array.isArray(w.deny) ? w.deny.map((s) => String(s).toLowerCase()) : [],
  };
}

function fetchUrlTool(cfgOf) {
  return {
    name: 'fetch_url',
    title: '抓取网页',
    description: '按网址抓取一篇网页，转成可读文本返回。只支持 http/https 的文本类页面；'
      + '内网与保留地址一律拒绝；每次调用都需要用户确认。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        url: { type: 'string', description: '要抓取的完整网址，必须带 http:// 或 https://' },
        purpose: { type: 'string', description: '为什么要读这篇，一句话；会显示在确认框里给用户看' },
      },
    },
    /** 只读：它不改用户的任何数据。但**每次都要确认**——见 requireConfirm */
    permission: 'read',
    requireConfirm: true,
    confirmKind: 'network',
    confirmText: (args) => `要访问外部网址：${args?.url || ''}`
      + (args?.purpose ? `\n用途：${args.purpose}` : '')
      + '\n请求会从这台机器发出，内容将离开本机。',
    handler: async (args) => {
      const cfg = cfgOf();
      if (!cfg.enabled) {
        throw new Error('联网工具已在设置里停用。要放开的话，去「设置 → AI 助手 → 联网」打开。');
      }
      const out = await fetchReadable(args?.url, cfg);
      if (!out.ok) throw new Error(out.error);
      return {
        网址: out.url,
        标题: out.title || undefined,
        状态: out.status,
        字数: out.text.length,
        截断: out.truncated ? `已截断到 ${out.bytes} 字节` : undefined,
        正文: out.text.slice(0, 20000),
      };
    },
  };
}

/**
 * 内置的联网来源。
 * @param {object} p
 * @param {() => object} [p.getConfig] 惰性读配置——设置页改完立刻生效，不用重启
 */
export function createWebSource({ getConfig } = {}) {
  const cfgOf = () => webConfigOf(typeof getConfig === 'function' ? getConfig() : (getConfig || {}));
  return {
    id: SOURCE_ID,
    name: '联网',
    /** 停用后工具**从清单里消失**，而不是留着再报错——模型看不到就不会去调 */
    tools: () => (cfgOf().enabled ? [fetchUrlTool(cfgOf)] : []),
  };
}
