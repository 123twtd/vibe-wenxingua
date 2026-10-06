/**
 * 问心卦 · 校验器
 * ------------------------------------------------------------
 * 用法：
 *   node tools/validate.mjs                 校验 data/records/ 下全部卦录
 *   node tools/validate.mjs 文件.json       校验指定的卦录 JSON（或备份包）
 *   node tools/validate.mjs 文件.txt        把文件当「卦条」解析并校验解析结果
 *   node tools/validate.mjs --json          以 JSON 输出结果（便于机器读）
 *
 * 通过返回 0，失败返回 1。改了内核或手改了卦录，跑一遍最稳。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const { validate, firstError } = await load('core/schema.mjs');
const guaTiao = await load('core/guaTiao.mjs');
const migrate = await load('core/migrate.mjs');

const RECORD_SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', 'record.schema.json'), 'utf8'));
const GUA_SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', 'gua-tiao.schema.json'), 'utf8'));
const CHAT_SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', 'chat.schema.json'), 'utf8'));
const { CHAT_SCHEMA: CHAT_SCHEMA_VERSION } = await load('server/chatStore.mjs');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const targets = args.filter((a) => !a.startsWith('--'));

const results = [];
const push = (name, valid, errors, extra = {}) => {
  results.push({ name, valid, errors, ...extra });
};

/** 一条卦录（含备份包里的） */
function checkRecord(rec, name) {
  const m = migrate.migrate(rec);
  if (m.error) return push(name, false, [{ path: '(迁移)', message: m.error }]);
  const r = validate(m.record, RECORD_SCHEMA, { strict: true });
  // 结构之外，再查几处「语义」约定。两种占法的约定各自成套，不混用。
  const semantic = [];
  if (m.record.chart?.kind === 'xlr') {
    semantic.push(...checkXlrSemantics(m.record));
  } else {
    if (m.record.reading?.tone) {
      const labels = m.record.reading.tone.map((t) => t.label).join('');
      if (labels !== '主互变断宜忌应期') semantic.push({ path: 'reading.tone', message: `七段顺序应为 主·互·变·断·宜·忌·应期，实际为 ${labels}` });
    }
    if (m.record.chart?.lines && m.record.chart.lines.length !== 6) {
      semantic.push({ path: 'chart.lines', message: `六爻应为 6 个元素，实际 ${m.record.chart.lines.length}` });
    }
    if (m.record.chart?.moving?.position && m.record.chart?.lines) {
      const isYang = m.record.chart.lines[m.record.chart.moving.position - 1] === 1;
      if (isYang !== m.record.chart.moving.isYang) {
        semantic.push({ path: 'chart.moving.isYang', message: '动爻阴阳与六爻数据不一致' });
      }
    }
  }
  return push(name, r.valid && !semantic.length, [...r.errors, ...semantic], {
    migratedFrom: m.applied.length ? m.from : undefined,
  });
}

/**
 * 小六壬记录的语义约定：
 *   宫位段与起课方式对应（月日时辰恒三宫；报数有几数显几宫）、
 *   末四段恒为 断·宜·忌·应期、结果宫与末宫一致。
 */
function checkXlrSemantics(record) {
  const out = [];
  const tone = record.reading?.tone || [];
  const palaceLabels = tone.slice(0, Math.max(0, tone.length - 4)).map((t) => t.label);
  const method = record.cast?.method;
  const n = Array.isArray(record.cast?.numbers) ? record.cast.numbers.length : 0;
  const expected = method === 'xlrTime'
    ? ['月宫', '日宫', '时宫']
    : n === 1 ? ['末宫'] : n === 2 ? ['初宫', '末宫'] : ['初宫', '次宫', '末宫'];
  const labels = tone.map((t) => t.label).join('');
  if (tone.length && tone.slice(-4).map((t) => t.label).join('') !== '断宜忌应期') {
    out.push({ path: 'reading.tone', message: `小六壬断课末四段应为 断·宜·忌·应期，实际为 ${labels}` });
  }
  if (palaceLabels.join('') !== expected.join('')) {
    out.push({ path: 'reading.tone', message: `宫位段应为 ${expected.join('·')}，实际为 ${palaceLabels.join('·') || '（空）'}` });
  }
  const palaces = record.chart?.palaces || [];
  if (palaces.length !== expected.length) {
    out.push({ path: 'chart.palaces', message: `三宫应与起课方式对应（${expected.length} 项），实际 ${palaces.length} 项` });
  }
  const last = palaces[palaces.length - 1];
  if (last && record.chart?.result && last.name !== record.chart.result.name) {
    out.push({ path: 'chart.result', message: `结果宫应为末宫「${last.name}」，实际为「${record.chart.result.name}」` });
  }
  if (!palaces.every((p) => p.grade?.label)) {
    out.push({ path: 'chart.palaces', message: '各宫都应带吉凶（grade.label）' });
  }
  return out;
}

/** 一个 AI 会话。除了结构，再查两处语义：版本对不对、附件清单有没有重复 */
function checkChat(chat, name) {
  const r = validate(chat, CHAT_SCHEMA, { strict: true });
  const semantic = [];
  if (chat?.schema !== CHAT_SCHEMA_VERSION) {
    semantic.push({ path: 'schema', message: `会话结构版本应为 ${CHAT_SCHEMA_VERSION}，实际为 ${chat?.schema}` });
  }
  const names = (chat?.files || []).map((f) => f.name);
  if (new Set(names).size !== names.length) {
    semantic.push({ path: 'files', message: '附件清单里有重名' });
  }
  return push(name, r.valid && !semantic.length, [...r.errors, ...semantic], {
    turns: (chat?.trace || []).filter((t) => t.role === 'user').length,
  });
}

if (!targets.length) {
  const dir = path.join(ROOT, 'data', 'records');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  if (!files.length) {
    console.error('data/records/ 下没有卦录文件。');
    process.exit(1);
  }
  for (const f of files) {
    const full = path.join(dir, f);
    try {
      checkRecord(JSON.parse(fs.readFileSync(full, 'utf8')), `data/records/${f}`);
    } catch (e) {
      push(`data/records/${f}`, false, [{ path: '(解析)', message: e.message }]);
    }
  }
  // 会话是同等级的用户数据，一并校验；一条都没有时不报错（新装就是空的）
  const chatDir = path.join(ROOT, 'data', 'chats');
  const chatFiles = fs.existsSync(chatDir) ? fs.readdirSync(chatDir).filter((f) => f.endsWith('.json')).sort() : [];
  for (const f of chatFiles) {
    try {
      checkChat(JSON.parse(fs.readFileSync(path.join(chatDir, f), 'utf8')), `data/chats/${f}`);
    } catch (e) {
      push(`data/chats/${f}`, false, [{ path: '(解析)', message: e.message }]);
    }
  }
} else {
  for (const t of targets) {
    const full = path.resolve(t);
    if (!fs.existsSync(full)) {
      push(t, false, [{ path: '(文件)', message: '文件不存在' }]);
      continue;
    }
    const text = fs.readFileSync(full, 'utf8');
    const ext = path.extname(full).toLowerCase();
    if (ext === '.json') {
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        push(t, false, [{ path: '(解析)', message: `JSON 解析失败：${e.message}` }]);
        continue;
      }
      const list = Array.isArray(data) ? data : data.records || [data];
      list.forEach((rec, i) => checkRecord(rec, list.length > 1 ? `${t} #${i + 1}` : t));
    } else {
      // 当卦条解析
      const blocks = guaTiao.looksLikeGuaTiao(text) || ext === '.gt' || ext === '.guatiao'
        ? guaTiao.parseGuaTiaoMany(text)
        : guaTiao.parseGuaTiaoMany(text);
      if (!blocks.length) {
        push(t, false, [{ path: '(卦条)', message: '没能解析出任何卦条' }]);
        continue;
      }
      blocks.forEach((b, i) => {
        const name = blocks.length > 1 ? `${t} #${i + 1}` : t;
        const r = validate(b, GUA_SCHEMA, { strict: true });
        const problems = [...r.errors];
        if (!b.ok) problems.push({ path: 'missing', message: `信息不完整，缺：${b.missing.join('、')}` });
        if (b.unknownKeys?.length) problems.push({ path: 'unknownKeys', message: `认不出的键名：${b.unknownKeys.join('、')}` });
        for (const hint of b.hints || []) problems.push({ path: 'hints', message: hint });
        push(name, problems.length === 0, problems, { parsed: { ben: b.claimed.ben, moving: b.claimed.moving, time: b.fields.localTime } });
      });
    }
  }
}

const failed = results.filter((r) => !r.valid);

if (asJson) {
  console.log(JSON.stringify({ ok: !failed.length, checked: results.length, failed: failed.length, results }, null, 2));
} else {
  console.log('');
  for (const r of results) {
    if (r.valid) {
      console.log(`  ✓ ${r.name}${r.parsed ? `　${r.parsed.ben || ''} 动${r.parsed.moving ?? ''} ${r.parsed.time || ''}` : ''}${r.migratedFrom !== undefined ? `　（自 v${r.migratedFrom} 迁移）` : ''}`);
    } else {
      console.log(`  ✗ ${r.name}`);
      for (const e of r.errors) console.log(`      · ${e.path}：${e.message}`);
    }
  }
  console.log(`\n———— 校验 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length} ————`);
  if (!failed.length) console.log('结构合法。\n');
}

process.exit(failed.length ? 1 : 0);
