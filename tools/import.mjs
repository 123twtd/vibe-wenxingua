/**
 * 问心卦 · 命令行导入
 * ------------------------------------------------------------
 * 用法：
 *   node tools/import.mjs --template            吐一份卦条模板，照着填
 *   node tools/import.mjs 卦条.txt              导入一个文件（卦条 / 对话文本 / JSON 均可）
 *   node tools/import.mjs a.txt b.txt --dry     只解析不落盘，先看认得对不对
 *   node tools/import.mjs backup.json           导入整包备份
 *   node tools/import.mjs 卦条.txt --export md  顺便把入库的卦导出成 Markdown
 *
 * 自动分流：卦条 → 走卦条解析；JSON → 走备份/卦录；其余 → 走对话文本解析。
 * 本工具与界面上的「导入」页、以及 AI agent 的 save_gua_tiao 走的是**同一套解析器**，
 * 所以在这里认得出的，在别处也认得出。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const core = {
  divination: await load('core/divination.mjs'),
  verdict: await load('core/verdict.mjs'),
  hexagram: await load('core/hexagram.mjs'),
  record: await load('core/record.mjs'),
  render: await load('core/render.mjs'),
  importer: await load('core/importer.mjs'),
  guaTiao: await load('core/guaTiao.mjs'),
  migrate: await load('core/migrate.mjs'),
};
const { Store } = await load('server/store.mjs');

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const valueOf = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--export'].includes(args[i - 1])));

if (flag('template')) {
  process.stdout.write(core.guaTiao.template());
  process.exit(0);
}
if (flag('help') || !files.length) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').trim());
  process.exit(files.length ? 0 : 1);
}

const store = new Store(path.join(ROOT, 'data'));
const dry = flag('dry');
const exportAs = valueOf('export', '');

/** 把一个候选块落盘 */
function commitBlock(b, originLabel) {
  const useHex = b.fields?.method === 'manual' || (b.claimed?.ben && b.claimed?.moving && b.source === 'gua-tiao');
  const id = core.record.makeId(b.fields?.localTime, store.ids());
  const base = {
    id,
    title: b.title || '',
    category: b.fields?.category || '',
    question: b.fields?.question || '',
    narrative: b.narrative || '',
    background: b.background || '',
    plan: b.plan || '',
    collation: b.collation || '',
    qa: b.qa || '',
    claimed: b.claimed || null,
    tags: b.tags || [],
    origin: { kind: b.source === 'gua-tiao' ? 'gua-tiao' : 'cli-import', label: originLabel },
  };
  const rec = useHex
    ? core.record.buildFromHexagram({
      ...base,
      hexagram: b.claimed.ben,
      movingPosition: Number(b.claimed.moving),
      localTime: b.fields.localTime,
      longitude: b.fields.longitude,
      placeName: b.fields.placeName,
      useTrueSolarTime: b.fields.useTrueSolarTime,
      numbers: b.fields.numbers,
    })
    : core.record.buildRecord({
      ...base,
      cast: {
        method: b.fields?.method || b.suggestion?.castInput?.method || 'numberAndTime',
        numbers: b.fields?.numbers,
        localTime: b.fields?.localTime,
        longitude: b.fields?.longitude,
        placeName: b.fields?.placeName,
        useTrueSolarTime: b.fields?.useTrueSolarTime,
        movingFrom: b.fields?.movingFrom,
        question: b.fields?.question,
        category: b.fields?.category,
      },
    });
  if (b.signature) rec.reading.signature = b.signature;
  if (b.review && (b.review.status !== '待应验' || b.review.log?.length)) {
    // 复盘在 v5 之后是「状态 + 条目流」：卦条里写了什么就接在已有条目后面
    rec.review = {
      status: b.review.status || rec.review.status,
      log: [...(rec.review.log || []), ...(Array.isArray(b.review.log) ? b.review.log : [])],
    };
  }
  if (!dry) store.save(rec);
  return rec;
}

const created = [];
const skipped = [];

for (const f of files) {
  const full = path.resolve(f);
  if (!fs.existsSync(full)) {
    skipped.push({ file: f, reason: '文件不存在' });
    continue;
  }
  const text = fs.readFileSync(full, 'utf8');
  const label = `命令行导入：${path.basename(f)}`;

  // 1) JSON：备份包或单条卦录
  if (path.extname(full).toLowerCase() === '.json' && text.trim().startsWith('{')) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      skipped.push({ file: f, reason: `JSON 解析失败：${e.message}` });
      continue;
    }
    if (data.records || Array.isArray(data)) {
      const r = dry ? { added: (data.records || data).length, updated: 0 } : store.restore(data, { merge: true });
      console.log(`  ${f}：备份包，${dry ? '将新增' : '新增'} ${r.added} 条，更新 ${r.updated} 条`);
      continue;
    }
    const m = core.migrate.migrate(data);
    if (m.error) {
      skipped.push({ file: f, reason: m.error });
      continue;
    }
    if (!dry) store.save(m.record);
    created.push(m.record);
    continue;
  }

  // 2) 卦条
  const isGuaTiao = core.guaTiao.looksLikeGuaTiao(text);
  const blocks = isGuaTiao ? core.guaTiao.parseGuaTiaoMany(text) : core.importer.parseMany(text);
  if (!blocks.length) {
    skipped.push({ file: f, reason: '没能从中认出任何卦' });
    continue;
  }
  for (const b of blocks) {
    if (b.ok === false) {
      skipped.push({ file: f, reason: `卦「${b.claimed?.ben || '未定'}」信息不完整，缺：${(b.missing || []).join('、')}` });
      continue;
    }
    try {
      created.push(commitBlock(b, label));
    } catch (e) {
      skipped.push({ file: f, reason: e.message });
    }
  }
}

console.log('');
if (created.length) {
  console.log(`  ${dry ? '将入库' : '已入库'} ${created.length} 条：`);
  for (const r of created) {
    console.log(`    ${r.id}　${r.chart.ben.fullName}${r.chart.ben.symbol}　动${r.chart.moving.yaoTitle}　${r.chart.tiyong.relation.label}　${r.reading.grade.label}　校勘 ${r.corrections.length} 处`);
    if (exportAs) {
      const ext = exportAs === 'md' ? 'md' : exportAs === 'slip' ? 'txt' : 'md';
      const body = exportAs === 'slip' ? core.render.toSlip(r) : core.render.toMarkdown(r);
      const out = path.join(path.dirname(path.resolve(files[0])), `${r.id}.${ext}`);
      fs.writeFileSync(out, body, 'utf8');
      console.log(`      → ${out}`);
    }
  }
}
if (skipped.length) {
  console.log(`\n  跳过 ${skipped.length} 项：`);
  for (const s of skipped) console.log(`    ${s.file}：${s.reason}`);
}
console.log(`\n  卦录总数：${store.list().length}${dry ? '（--dry 未落盘）' : ''}\n`);
process.exit(skipped.length && !created.length ? 1 : 0);
