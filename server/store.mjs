/**
 * 问心卦 · 卦录存储
 * ------------------------------------------------------------
 * 一条卦录一个 JSON 文件，放在 data/records/ 下。
 * 之所以不用数据库：卦录是「要陪几十年」的东西，纯文本 JSON 最耐久——
 * 可以直接看、直接改、直接备份、直接 git，也不怕哪天这个程序跑不起来。
 */

import fs from 'node:fs';
import path from 'node:path';

export class Store {
  /**
   * @param {string} rootDir data/ 目录
   * @param {object} [opts]
   * @param {(rec:object)=>{record:object,from:number,to:number,applied:number[],error?:string}} [opts.migrator]
   *        迁移函数（由 server 注入 core/migrate.mjs 的 migrate）。迁移原文会先备份。
   */
  constructor(rootDir, opts = {}) {
    this.root = rootDir;
    this.recordsDir = path.join(rootDir, 'records');
    this.trashDir = path.join(rootDir, 'trash');
    this.backupDir = path.join(rootDir, 'backups');
    this.configFile = path.join(rootDir, 'config.json');
    this.migrator = opts.migrator || null;
    this.migrations = [];
    this.ensure();
    this.cache = new Map();
    this.loadAll();
  }

  ensure() {
    for (const d of [this.root, this.recordsDir, this.trashDir, this.backupDir]) {
      fs.mkdirSync(d, { recursive: true });
    }
    if (!fs.existsSync(this.configFile)) {
      fs.writeFileSync(this.configFile, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
    }
  }

  loadAll() {
    this.cache.clear();
    this.migrations = [];
    for (const f of fs.readdirSync(this.recordsDir)) {
      if (!f.endsWith('.json')) continue;
      const full = path.join(this.recordsDir, f);
      try {
        let rec = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (!rec || !rec.id) continue;

        // 版本迁移：先备份原文，再迁移落盘
        if (this.migrator) {
          const out = this.migrator(rec);
          if (out.error) {
            console.warn(`[store] ${f} 迁移失败，按原样载入：${out.error}`);
          } else if (out.applied.length) {
            const dir = path.join(this.backupDir, 'pre-migration');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(
              path.join(dir, `${rec.id}-v${out.from}-${Date.now()}.json`),
              JSON.stringify(rec, null, 2),
              'utf8',
            );
            rec = out.record;
            fs.writeFileSync(full, JSON.stringify(rec, null, 2), 'utf8');
            this.migrations.push({ id: rec.id, from: out.from, to: out.to });
            console.log(`[store] ${rec.id} 已自 v${out.from} 迁移到 v${out.to}`);
          }
        }
        this.cache.set(rec.id, rec);
      } catch (err) {
        console.warn(`[store] 跳过损坏的卦录文件 ${f}：${err.message}`);
      }
    }
    this.markDir();
    return this.cache.size;
  }

  /** 记下 records/ 目录的修改时间，供 maybeRescan 判断是否需要重扫 */
  markDir() {
    try {
      this.dirMtime = fs.statSync(this.recordsDir).mtimeMs;
    } catch {
      this.dirMtime = 0;
    }
  }

  /**
   * 若 data/records/ 被本进程之外的东西改动过（例如命令行 `tools/import.mjs`
   * 在服务运行期间导入了卦录），就重扫一次。
   * 只做一次 statSync，开销可忽略；不重扫则运行中的服务会看不到新文件。
   */
  maybeRescan() {
    try {
      const m = fs.statSync(this.recordsDir).mtimeMs;
      if (m !== this.dirMtime) {
        const before = this.cache.size;
        this.loadAll();
        return { rescanned: true, before, after: this.cache.size };
      }
    } catch {
      /* 目录暂时读不到就跳过 */
    }
    return { rescanned: false, before: this.cache.size, after: this.cache.size };
  }

  fileOf(id) {
    return path.join(this.recordsDir, `${safeId(id)}.json`);
  }

  list() {
    return [...this.cache.values()].sort((a, b) => String(b.cast?.localTime || b.createdAt).localeCompare(String(a.cast?.localTime || a.createdAt)));
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

  save(record) {
    if (!record?.id) throw new Error('卦录缺少 id');
    const tmp = `${this.fileOf(record.id)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
    fs.renameSync(tmp, this.fileOf(record.id));
    this.cache.set(record.id, record);
    this.markDir();
    return record;
  }

  remove(id, hard = false) {
    const rec = this.cache.get(id);
    if (!rec) return false;
    if (hard) {
      fs.rmSync(this.fileOf(id), { force: true });
    } else {
      fs.mkdirSync(this.trashDir, { recursive: true });
      fs.writeFileSync(
        path.join(this.trashDir, `${safeId(id)}-${Date.now()}.json`),
        JSON.stringify(rec, null, 2),
        'utf8',
      );
      fs.rmSync(this.fileOf(id), { force: true });
    }
    this.cache.delete(id);
    this.markDir();
    return true;
  }

  getConfig() {
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(this.configFile, 'utf8')) };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  setConfig(patch) {
    const next = { ...this.getConfig(), ...patch };
    fs.writeFileSync(this.configFile, JSON.stringify(next, null, 2), 'utf8');
    return next;
  }

  /** 备份：整包导出 */
  backup() {
    return {
      meta: {
        app: '问心卦',
        schema: 1,
        exportedAt: new Date().toISOString(),
        count: this.cache.size,
      },
      config: this.getConfig(),
      records: this.list(),
    };
  }

  restore(pack, { merge = true } = {}) {
    const recs = Array.isArray(pack) ? pack : pack?.records || [];
    let added = 0;
    let updated = 0;
    for (const rec of recs) {
      if (!rec?.id || !rec.chart) continue;
      if (this.cache.has(rec.id)) {
        if (!merge) continue;
        this.save({ ...this.cache.get(rec.id), ...rec });
        updated += 1;
      } else {
        this.save(rec);
        added += 1;
      }
    }
    if (pack?.config) this.setConfig(pack.config);
    return { added, updated, total: this.cache.size };
  }

  stats() {
    const all = this.list();
    const by = (fn) => all.reduce((acc, r) => {
      const k = fn(r) || '未定';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    return {
      total: all.length,
      byCategory: by((r) => r.category),
      byGrade: by((r) => r.reading?.grade?.label),
      byBen: by((r) => r.chart?.ben?.fullName),
      byRelation: by((r) => r.chart?.tiyong?.relation?.label),
      byReview: by((r) => r.review?.status),
      corrections: all.filter((r) => (r.corrections || []).length).length,
      first: all.length ? all[all.length - 1].cast?.localTime : null,
      last: all.length ? all[0].cast?.localTime : null,
    };
  }
}

const DEFAULT_CONFIG = {
  schema: 1,
  appName: '问心卦',
  defaultPlace: '兰州',
  defaultLongitude: 103.83,
  useTrueSolarTimeByDefault: true,
  movingFromByDefault: 'sum',
  theme: 'ink',
  plugins: {},
  backupDir: 'backups',
  /** AI 助手配置。apiKey 以明文存在本机 data/config.json 里——这是本地程序，
   *  但请勿把该文件提交到公开仓库，也不要放在同步盘上。 */
  agent: {
    enabled: false,
    provider: 'deepseek',
    baseUrl: '',
    apiKey: '',
    model: '',
    temperature: 0.6,
    /** 单次回复上限：0 = 不带 max_tokens，交给服务商默认（发小值会把长回答拦腰截断） */
    maxTokens: 0,
    maxRounds: 6,
    useNativeTools: true,
    /** 联网工具（见 ADR-0013）：默认在工具表里，但**每次调用都要用户确认**。
     *  allow / deny 默认都空 = 不按域名预筛，只靠逐次确认。内网与保留地址另有一道硬拦。 */
    web: { enabled: true, timeoutMs: 10000, maxBytes: 524288, allow: [], deny: [] },
  },
};

function safeId(id) {
  return String(id).replace(/[^\w.-]/g, '_');
}
