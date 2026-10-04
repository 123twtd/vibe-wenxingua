/**
 * 问心卦 · 会话存储
 * ------------------------------------------------------------
 * 一个 AI 对话会话一个 JSON，放在 data/chats/ 下；附件放 data/chats/<id>/files/。
 * 与 `store.mjs` 同一套纪律：原子写（.tmp + rename）、删除只进 data/trash/、
 * 载入时按版本迁移且迁移前先备份。
 *
 * ## 为什么一个会话要双存 trace 与 messages
 *
 * `trace` 给界面画轨迹（沿用界面上 4000 字符的截断），`messages` 是模型侧消息，
 * **存完整值**（含成对的 assistant.tool_calls 与 tool 结果）。
 *
 * 只存 trace 的话，回推给模型的历史里工具结果是截断过的半截 JSON——
 * 模型会据此重复调工具，或者干脆按半截内容编造卦象。两样都存，
 * 界面与模型各取所需：界面要的是好看好读，模型要的是完整可信。
 *
 * ## 会话版本
 *
 * 会话有自己的 schema 版本（`CHAT_SCHEMA`），与卦录的 `SCHEMA_VERSION` 各走各的：
 * 两者实体不同、演进节奏也不同，混在一张迁移表里只会让两边都难改。
 */

import fs from 'node:fs';
import path from 'node:path';

export const CHAT_SCHEMA = 1;

/** 附件上限。会话附件只存不解析（零依赖前提），但也不该让人往数据目录里塞大文件 */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** 会话开头的默认标题；用户没改过标题时，用首条用户消息替换它 */
export const DEFAULT_TITLE = '新会话';

const safeName = (s) => String(s || '').replace(/[^\w.\u4e00-\u9fa5-]/g, '_').slice(0, 80) || 'file';

export class ChatStore {
  /**
   * @param {string} rootDir data/ 目录
   * @param {object} [opts]
   * @param {(chat:object)=>{ok:boolean,applied:number[],error?:string}} [opts.migrator]
   * @param {object} [opts.logger]
   */
  constructor(rootDir, opts = {}) {
    this.root = rootDir;
    this.dir = path.join(rootDir, 'chats');
    this.trashDir = path.join(rootDir, 'trash');
    this.backupDir = path.join(rootDir, 'backups');
    this.logger = opts.logger || console;
    this.migrator = opts.migrator || null;
    this.cache = new Map();
    this.ensure();
    this.loadAll();
  }

  ensure() {
    for (const d of [this.dir, this.trashDir, this.backupDir]) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  loadAll() {
    this.cache.clear();
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      const full = path.join(this.dir, f);
      try {
        let chat = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (!chat || !chat.id) continue;
        chat = this.migrateOrKeep(chat, full, f);
        this.cache.set(chat.id, this.normalize(chat));
      } catch (err) {
        this.logger.warn?.(`[chats] 跳过损坏的会话文件 ${f}：${err.message}`);
      }
    }
    this.markDir();
    return this.cache.size;
  }

  /**
   * 版本迁移：先备份原文，再迁移落盘。
   * 会话是「自己的对话历史」，同样属于用户数据，所以纪律与卦录完全一致。
   */
  migrateOrKeep(chat, full, fileName) {
    // 没有版本号一律当 v0 —— 与卦录同一套判断，不能把「没写版本」当成「已是最新」
    const from = typeof chat.schema === 'number' ? chat.schema : 0;
    if (from >= CHAT_SCHEMA || !this.migrator) {
      return { schema: CHAT_SCHEMA, ...chat };
    }
    const out = this.migrator({ ...chat, schema: from });
    if (out.error || !out.applied?.length) {
      if (out.error) this.logger.warn?.(`[chats] ${fileName} 迁移失败，按原样载入：${out.error}`);
      return { schema: CHAT_SCHEMA, ...chat };
    }
    const dir = path.join(this.backupDir, 'pre-migration');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${safeName(chat.id)}-chat-v${from}-${Date.now()}.json`),
      JSON.stringify(chat, null, 2),
      'utf8',
    );
    const next = out.record || out.chat || { ...chat, schema: CHAT_SCHEMA };
    fs.writeFileSync(full, JSON.stringify(next, null, 2), 'utf8');
    this.logger.log?.(`[chats] ${chat.id} 已自 v${from} 迁移到 v${CHAT_SCHEMA}`);
    return next;
  }

  /** 补齐字段，读进来的旧文件也不会让界面炸 */
  normalize(chat) {
    return {
      schema: CHAT_SCHEMA,
      id: String(chat.id),
      title: String(chat.title || DEFAULT_TITLE),
      createdAt: chat.createdAt || new Date().toISOString(),
      updatedAt: chat.updatedAt || chat.createdAt || new Date().toISOString(),
      provider: chat.provider || '',
      model: chat.model || '',
      permission: chat.permission || '',
      trace: Array.isArray(chat.trace) ? chat.trace : [],
      messages: Array.isArray(chat.messages) ? chat.messages : [],
      files: Array.isArray(chat.files) ? chat.files : [],
    };
  }

  /**
   * 外部改动指纹。
   *
   * 为什么不能只比目录 mtime：Windows 上往**刚建好的**目录里写第一个文件，
   * 目录 mtime 不变（实测如此）——只比 mtime 会漏掉「第一条会话是别处建的」这种情形。
   * 所以指纹由三样拼成：文件数 + 文件名集合 + 各文件最新 mtime。
   * 后两样还能盖住「就地改已有文件」——那改的是文件 mtime，目录 mtime 也不动。
   *
   * 成本是一次 readdirSync 加每个文件一次 statSync，只在 /api/chats 上跑，可接受。
   */
  fingerprint() {
    try {
      const names = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')).sort();
      let newest = 0;
      for (const n of names) {
        try { newest = Math.max(newest, fs.statSync(path.join(this.dir, n)).mtimeMs); } catch { /* 单个读不到就跳过 */ }
      }
      return `${names.length}|${names.join(',')}|${newest}`;
    } catch {
      return '0||0';
    }
  }

  markDir() {
    this.dirMark = this.fingerprint();
  }

  /** 与 Store 同样的外部改动探测：命令行或别处写了会话，运行中的服务要看得见 */
  maybeRescan() {
    if (this.fingerprint() !== this.dirMark) {
      const before = this.cache.size;
      this.loadAll();
      return { rescanned: true, before, after: this.cache.size };
    }
    return { rescanned: false, before: this.cache.size, after: this.cache.size };
  }

  fileOf(id) {
    return path.join(this.dir, `${safeName(id)}.json`);
  }

  filesDir(id) {
    return path.join(this.dir, safeName(id));
  }

  /** 会话摘要：列表只给这些，不带 trace/messages（可能很长） */
  summary(chat) {
    return {
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      model: chat.model,
      turns: chat.trace.filter((t) => t.role === 'user').length,
      entries: chat.trace.length,
      files: chat.files.length,
    };
  }

  list() {
    return [...this.cache.values()]
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map((c) => this.summary(c));
  }

  get(id) {
    return this.cache.get(id) || null;
  }

  has(id) {
    return this.cache.has(id);
  }

  ids() {
    return [...this.cache.keys()];
  }

  /**
   * 存档里的模型侧消息还能不能直接回推给模型？
   *
   * 判据是「成对」：`assistant.tool_calls` 与它对应的 `tool` 结果必须配齐，且整段以用户消息开头
   * ——原生 function calling 的端点见到悬空的 `tool_calls`（或没有来处的 `tool` 结果）会直接 400。
   * 早先版本的存档是「只存增量、且不含用户那一轮」，所以老会话多数不满足，只能退回界面送来的历史。
   */
  static replayable(messages) {
    if (!Array.isArray(messages) || !messages.length) return false;
    if (messages[0].role !== 'user') return false;
    let pending = new Set();
    for (const m of messages) {
      if (m.role === 'assistant') {
        if (pending.size) return false;     // 上一批 tool_calls 还没等到结果，又来了新的一条
        pending = new Set((m.tool_calls || []).map((c) => c.id).filter(Boolean));
      } else if (m.role === 'tool') {
        if (!pending.has(m.tool_call_id)) return false;
        pending.delete(m.tool_call_id);
      } else if (m.role === 'user') {
        if (pending.size) return false;     // 上一轮的工具调用没收完就换人说话 = 悬空
      }
    }
    return pending.size === 0;
  }

  /**
   * 交给模型的这一轮历史。**优先用后端存档**，界面只需要送「本轮新说的话」。
   *
   * 为什么必须由服务端给：界面手里只有展示用的 `trace`，里面**没有工具返回**（工具结果在
   * trace 里是给人看的卡片）。若让界面拿 trace 重拼历史，模型下一轮就看不到自己算过的卦、
   * 查过的爻辞——它会凭记忆编一个，然后被你当面戳穿（真发生过：模型自述「历史里没有任何一行
   * 工具返回」）。存档里的 `messages` 才是完整的模型侧对话，含成对的 tool_calls 与结果。
   *
   * 窗口：从最新一轮往回装到**字符预算**（默认 60000）或**轮数上限**（默认 40）为止，且
   * **按用户消息整轮切**——按条数切会把 tool_calls 与它的结果切开，那种残句会被端点拒。
   * 不写死「最近 12 轮」：用户会指着很久以前那句问（「最开始那卦」），切太狠模型就翻不到，
   * 只能否认自己写过的东西（真发生过，见 agent/loop.mjs 的「一之二」）。
   *
   * @returns {{messages: Array, source: 'store'|'trace'|'client'}}
   */
  static historyFor(chat, incoming = [], { maxTurns = 40, budget = 60000 } = {}) {
    const fromClient = (Array.isArray(incoming) ? incoming : [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-20);

    // 按可信度依次尝试：存档（完整） → 由轨迹重塑（老会话没有可用的存档，见 fromTrace）→ 界面送的。
    // 第二层写成取值函数：存档够用时不白构造一份（长会话的轨迹不小）。
    const tiers = [
      { pick: () => chat?.messages, source: 'store' },
      { pick: () => ChatStore.fromTrace(chat?.trace), source: 'trace' },
    ];
    for (const c of tiers) {
      const stored = c.pick();
      if (!ChatStore.replayable(stored)) continue;
      const messages = [...stored];
      const lastUser = fromClient.filter((m) => m.role === 'user').pop();
      const tail = messages[messages.length - 1];
      // 新客户端只送这一句；老客户端会送整段，所以只取末尾那条用户消息，且不与末条重复
      if (lastUser && !(tail?.role === 'user' && tail.content === lastUser.content)) {
        messages.push({ role: 'user', content: lastUser.content });
      }
      /* 往回装多少：**按字符预算**（外加一个轮数上限），而不是写死「最近 12 轮」。
         为什么改：用户会指着很久以前那句话问（「最开始那卦是什么」），切太狠就答不上来——
         实测那段会话里，早先写下的一个卦名正好落在 12 轮之外，模型于是矢口否认它存在过。
         现在只要总量装得下就一直往回带（中文约 1 字 ≈ 1 token，6 万字约 2~3 万 token），
         装不下就在**整轮边界**上截断——绝不切开一轮里 tool_calls 与结果的配对。 */
      const userAt = [];
      messages.forEach((m, i) => { if (m.role === 'user') userAt.push(i); });
      const size = (m) => String(m.content || '').length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
      let start = userAt.length ? userAt[userAt.length - 1] : 0;   // 兜底：至少留最后一轮
      let used = 0;
      let turns = 0;
      for (let k = userAt.length - 1; k >= 0; k -= 1) {
        const from = userAt[k];
        const to = k + 1 < userAt.length ? userAt[k + 1] : messages.length;
        const cost = messages.slice(from, to).reduce((n, m) => n + size(m), 0);
        if (turns >= maxTurns || used + cost > budget) break;
        used += cost;
        turns += 1;
        start = from;
      }
      return { messages: messages.slice(start), source: c.source };
    }
    return { messages: fromClient, source: 'client' };
  }

  /**
   * 把**展示用的 trace** 重塑成模型侧历史（老会话的兜底）。
   *
   * 为什么需要它：存档里的 `messages` 只在「增量里带着用户那一轮」之后才可回推；
   * 早先版本存出来的那份缺用户消息，永远不可回推——于是老会话只能退到界面那份
   * （只有 user/assistant 文本，**没有工具结果**），模型下一轮就看不到自己算过的卦，
   * 只能从自己写过的散文里「引」数字，越引越离谱（用户的原话：它自述「100 和 10:43 是我编的」）。
   *
   * trace 里其实什么都在：`role:'tool'` 的条目带着真实的 `args` 与 `result`（切到 4000 字符）。
   * 这里把每个工具条目还原成一对 `assistant.tool_calls` + `tool`，模型就能看到
   * 「我当初用什么参数调了什么、拿回了什么」。它是重塑，不是补写：内容全来自真实记录。
   */
  static fromTrace(trace, { resultLimit = 1500 } = {}) {
    const out = [];
    let n = 0;
    for (const e of Array.isArray(trace) ? trace : []) {
      if ((e.role === 'user' || e.role === 'assistant') && typeof e.content === 'string' && e.content.trim()) {
        out.push({ role: e.role, content: e.content });
      } else if (e.role === 'tool') {
        n += 1;
        const id = `t${n}`;
        out.push({
          role: 'assistant', content: '',
          tool_calls: [{ id, type: 'function', function: { name: e.name || 'tool', arguments: JSON.stringify(e.args || {}) } }],
        });
        const text = e.ok
          ? String(e.result ?? '').slice(0, resultLimit)
          : `（调用失败）${e.error || ''}`;
        out.push({ role: 'tool', tool_call_id: id, content: text });
      }
    }
    return out;
  }

  /** 从首条用户消息里取一个像样的标题 */
  static titleFrom(entries) {
    const first = (entries || []).find((e) => e?.role === 'user' && String(e.content || '').trim());
    if (!first) return DEFAULT_TITLE;
    const one = String(first.content).replace(/\s+/g, ' ').trim();
    return one.length > 24 ? `${one.slice(0, 24)}…` : one;
  }

  save(chat) {
    if (!chat?.id) throw new Error('会话缺少 id');
    const next = this.normalize({ ...chat, updatedAt: new Date().toISOString() });
    const tmp = `${this.fileOf(next.id)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, this.fileOf(next.id));
    this.cache.set(next.id, next);
    this.markDir();
    return next;
  }

  create({ id, title } = {}) {
    if (!id) throw new Error('会话缺少 id');
    if (this.cache.has(id)) throw new Error(`会话已存在：${id}`);
    this.ensure();
    return this.save({
      id,
      title: title || DEFAULT_TITLE,
      createdAt: new Date().toISOString(),
      trace: [],
      messages: [],
      files: [],
    });
  }

  /**
   * 追加一轮对话。界面把这一轮的展示条目与模型侧消息一起交上来，
   * 服务端不参与循环、也不推断内容——它只负责存。
   */
  append(id, { trace = [], messages = [], provider, model, permission } = {}) {
    const chat = this.cache.get(id);
    if (!chat) return null;
    chat.trace = [...chat.trace, ...(Array.isArray(trace) ? trace : [])];
    chat.messages = [...chat.messages, ...(Array.isArray(messages) ? messages : [])];
    if (provider) chat.provider = provider;
    if (model) chat.model = model;
    if (permission) chat.permission = permission;
    // 标题还是默认值（用户没改过）时，拿首条用户消息顶上
    if (chat.title === DEFAULT_TITLE) chat.title = ChatStore.titleFrom(chat.trace);
    return this.save(chat);
  }

  rename(id, title) {
    const chat = this.cache.get(id);
    if (!chat) return null;
    chat.title = String(title || '').trim() || DEFAULT_TITLE;
    return this.save(chat);
  }

  /** 删除只进 trash——与卦录同一条纪律 */
  remove(id, hard = false) {
    const chat = this.cache.get(id);
    if (!chat) return false;
    if (hard) {
      fs.rmSync(this.fileOf(id), { force: true });
      fs.rmSync(this.filesDir(id), { recursive: true, force: true });
    } else {
      fs.mkdirSync(this.trashDir, { recursive: true });
      fs.writeFileSync(
        path.join(this.trashDir, `${safeName(id)}-chat-${Date.now()}.json`),
        JSON.stringify(chat, null, 2),
        'utf8',
      );
      fs.rmSync(this.fileOf(id), { force: true });
    }
    this.cache.delete(id);
    this.markDir();
    return true;
  }

  /* ---------- 附件：只存、只列、可下载；不解析内容 ---------- */

  addFile(id, name, buf, mime = '') {
    const chat = this.cache.get(id);
    if (!chat) return null;
    if (buf.length > MAX_FILE_BYTES) {
      throw new Error(`附件超过上限（${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB）`);
    }
    const dir = this.filesDir(id);
    fs.mkdirSync(dir, { recursive: true });
    const safe = safeName(name);
    fs.writeFileSync(path.join(dir, safe), buf);
    chat.files = [...chat.files.filter((f) => f.name !== safe), {
      name: safe, size: buf.length, mime: String(mime || ''), at: new Date().toISOString(),
    }];
    return { chat: this.save(chat), name: safe };
  }

  /** 取附件绝对路径；越界一律拒绝 */
  filePath(id, name) {
    const dir = path.resolve(this.filesDir(id));
    const abs = path.resolve(path.join(dir, safeName(name)));
    if (!abs.startsWith(dir + path.sep)) return null;
    return fs.existsSync(abs) ? abs : null;
  }

  /** 整包导出用：会话连同附件清单一并给出 */
  exportAll() {
    return this.list().map((s) => this.get(s.id));
  }
}
