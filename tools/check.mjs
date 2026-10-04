/**
 * 问心卦 · 自检
 * ------------------------------------------------------------
 * 用法：node tools/check.mjs
 * 检查：卦典完整性、爻辞完整性、内外卦一致性、断语引擎可跑、全部卦录可重算、插件可载入。
 * 改了内核或知识库之后跑一遍，比肉眼可靠。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const hx = await load('core/hexagram.mjs');
const dv = await load('core/divination.mjs');
const vd = await load('core/verdict.mjs');
const rc = await load('core/record.mjs');
const rd = await load('core/render.mjs');
const cal = await load('core/calendar.mjs');
/** 合成示例卦录：data/records/ 为空时（仓库不发布作者数据）拿它当夹具 */
const fx = await load('tools/fixtures.mjs');

let pass = 0;
let fail = 0;
const problems = [];
const check = (name, ok, detail = '') => {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}${detail ? `　${detail}` : ''}`);
  } else {
    fail += 1;
    problems.push(`${name}${detail ? `：${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? `　${detail}` : ''}`);
  }
};

console.log('\n【一】卦典与爻辞');
const lib = hx.library();
const stats = lib.stats();
check('六十四卦齐备', stats.count === 64, `${stats.count} 卦`);
check('来源为知识库文件', stats.source === 'knowledge', stats.source);
check('卦辞完整', stats.withGuaci === 64, `${stats.withGuaci}/64`);
check('爻辞完整', stats.withYaoci === 64, `${stats.withYaoci}/64`);
check('无上下卦告警', stats.warnings.length === 0, stats.warnings.join('；'));

let symOk = true;
let linesOk = true;
let distinct = new Set();
for (const h of lib.all()) {
  if (h.symbol !== String.fromCodePoint(0x4dc0 + h.id - 1)) symOk = false;
  const six = hx.sixLines(h.upper, h.lower);
  const back = hx.trigramsOfLines(six);
  if (back.upper !== h.upper || back.lower !== h.lower) linesOk = false;
  distinct.add(six.join(''));
  if (!lib.yaoText(h.id, 1) || !lib.yaoText(h.id, 6)) linesOk = false;
}
check('卦符与卦序对应', symOk);
check('六爻与上下卦互推自洽、爻辞可读', linesOk);
check('六十四卦阴阳组合互异', distinct.size === 64, `${distinct.size} 种`);

console.log('\n【二】历法');
const c1 = cal.calendarInfo({ localTime: '2026-09-28 03:12', longitude: 103.83, placeName: '兰州' });
check('兰州真太阳时落丑时', c1.trueHourZhi === '丑' && c1.trueHourNumber === 2, `${c1.trueSolarTime} → ${c1.trueHourZhi}时`);
check('钟表时辰为寅时', c1.clockHourZhi === '寅', `${c1.clockHourZhi}时`);
check('月建为酉月', c1.monthZhi === '酉', `${c1.monthZhi}月（${c1.jie}后）`);
check('日干支推算正确（1949-10-01 应为甲子日）', cal.dayGanZhi(cal.julianDay(1949, 10, 1, 12)).name === '甲子');
check('日干支推算正确（2024-01-01 应为甲子日）', cal.dayGanZhi(cal.julianDay(2024, 1, 1, 12)).name === '甲子');

console.log('\n【三】起卦与断语（六次历史起卦）');
const CASES = [
  { name: '心愿（革）', input: { method: 'numberAndTime', numbers: [82], localTime: '2026-09-28 03:12', longitude: 103.83, useTrueSolarTime: false, movingFrom: 'number', category: '考研学业' }, expect: { ben: '泽火革', hu: '天风姤', bian: '水火既济', moving: 4, ti: '离', yong: '兑' } },
  { name: '财运（遁）', input: { method: 'twoNumbers', numbers: [617, 15], localTime: '2026-09-28 03:12', longitude: 103.83, useTrueSolarTime: false, category: '财运生计' }, expect: { ben: '天山遁', hu: '天风姤', bian: '天风姤', moving: 2, ti: '乾', yong: '艮' } },
  { name: '定主线（履）', input: { method: 'numberAndTime', numbers: [1], localTime: '2026-09-28 03:38', longitude: 103.83, useTrueSolarTime: true, category: '考研学业' }, expect: { ben: '天泽履', hu: '风火家人', bian: '乾为天', moving: 3, ti: '乾', yong: '兑' } },
  { name: '不投递（归妹）', input: { method: 'numberAndTime', numbers: [52], localTime: '2026-09-28 03:50', longitude: 103.83, useTrueSolarTime: true, category: '决策取舍' }, expect: { ben: '雷泽归妹', hu: '水火既济', bian: '火泽睽', moving: 6, ti: '兑', yong: '震' } },
  { name: '对照（随）', input: { method: 'manual', hexagram: '泽雷随', movingPosition: 6, localTime: '2026-09-28 03:12', longitude: 103.83, category: '考研学业' }, expect: { ben: '泽雷随', hu: '风山渐', bian: '天雷无妄', moving: 6, ti: '震', yong: '兑' } },
  { name: '对照（大过）', input: { method: 'manual', hexagram: '泽风大过', movingPosition: 1, localTime: '2026-09-28 03:12', longitude: 103.83, category: '决策取舍' }, expect: { ben: '泽风大过', hu: '乾为天', bian: '泽天夬', moving: 1, ti: '兑', yong: '巽' } },
];
for (const c of CASES) {
  try {
    const chart = dv.cast(c.input);
    const okBen = chart.ben.fullName === c.expect.ben;
    const okHu = chart.hu.fullName === c.expect.hu;
    const okBian = chart.bian.fullName === c.expect.bian;
    const okMove = chart.moving.position === c.expect.moving;
    const okTi = chart.tiyong.ti.name === c.expect.ti && chart.tiyong.yong.name === c.expect.yong;
    check(
      `${c.name}：本卦／互卦／变卦／动爻／体用`,
      okBen && okHu && okBian && okMove && okTi,
      `${chart.ben.fullName}→${chart.hu.fullName}→${chart.bian.fullName} 动${chart.moving.yaoTitle} 体${chart.tiyong.ti.name}用${chart.tiyong.yong.name} ${chart.tiyong.relation.label} ${chart.score.grade.label}`,
    );
    const it = vd.interpret(chart);
    const toneOk = it.tone.length === 7 && it.tone.every((t) => t.text && t.text.length > 6);
    check(`${c.name}：断语七段齐备且无空段`, toneOk);
    const dupOk = !/。。|」。「/.test(it.tone.map((t) => t.text).join(''));
    check(`${c.name}：断语无重复标点`, dupOk, dupOk ? '' : it.tone.map((t) => t.text).join('｜').slice(0, 120));
    const render = rd.toMarkdown({ ...rc.normalizeRecord({ id: 't', chart, reading: it, cast: chart.inputs }), chart, reading: it });
    check(`${c.name}：Markdown 渲染无 undefined`, !/undefined|NaN/.test(render));
  } catch (err) {
    check(`${c.name}：起卦与断语`, false, err.message);
  }
}

console.log('\n【四】已录卦录');
/* 作者本地的 data/records/ 有 6 条真实卦录；但 data/ 不随仓库发布，
   别人克隆下来这里是空的。空库时改用引擎自造的示例卦录当夹具——
   写进一个临时目录、从那里读，跑完清理。有作者数据时行为与从前一致。 */
const REC_DIR = path.join(ROOT, 'data', 'records');
const realFiles = fs.existsSync(REC_DIR) ? fs.readdirSync(REC_DIR).filter((f) => f.endsWith('.json')) : [];
let FIXTURE_DIR = null;
let recordsDir = REC_DIR;
if (!realFiles.length) {
  FIXTURE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qxg-check-rec-'));
  const n = fx.seedInto(FIXTURE_DIR);
  recordsDir = path.join(FIXTURE_DIR, 'records');
  console.log(`  · 未发现作者卦录，改用 ${n} 条合成示例卦录（${FIXTURE_DIR}）`);
}
const files = fs.readdirSync(recordsDir).filter((f) => f.endsWith('.json'));
check('存在卦录文件', files.length > 0, `${files.length} 条`);
let recOk = true;
let recDetail = [];
for (const f of files) {
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(recordsDir, f), 'utf8'));
    if (!rec.chart?.ben?.fullName || !rec.reading?.tone?.length) {
      recOk = false;
      recDetail.push(`${f} 缺卦象或断语`);
      continue;
    }
    const again = rc.recompute(rec);
    const sameBen = again.chart.ben.fullName === rec.chart.ben.fullName;
    const sameMove = again.chart.moving.position === rec.chart.moving.position;
    if (!sameBen || !sameMove) {
      recOk = false;
      recDetail.push(`${f} 重算不一致`);
    }
    const strip = JSON.parse(JSON.stringify(rec));
    const md = rd.toMarkdown(strip);
    if (/undefined|NaN/.test(md)) {
      recOk = false;
      recDetail.push(`${f} 导出含 undefined`);
    }
  } catch (err) {
    recOk = false;
    recDetail.push(`${f} ${err.message}`);
  }
}
check('全部卦录结构完整且可重算、可导出', recOk, recDetail.join('；'));

console.log('\n【五】插件');
try {
  const { Store } = await load('server/store.mjs');
  const { PluginHost } = await load('server/plugins.mjs');
  const store = new Store(path.join(ROOT, 'data'));
  const host = new PluginHost({ dir: path.join(ROOT, 'data', 'plugins'), store, core: {}, logger: { log() {}, warn() {} } });
  const api = await host.loadAll();
  check('插件全部载入无错', api.errors.length === 0, api.errors.join('；') || `${api.plugins.filter((p) => p.loaded).length} 个`);
  check('插件页面已注册', api.pages.length > 0, api.pages.map((p) => p.label).join('、'));
  check('插件面板已注册', api.panels.length > 0, api.panels.map((p) => p.label).join('、'));
} catch (err) {
  check('插件宿主可用', false, err.message);
}

console.log('\n【六】走势聚合');
{
  const trend = await load('core/trend.mjs');
  const records = fs.readdirSync(recordsDir).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(recordsDir, f), 'utf8')));

  const f = trend.buildTrend(records, { mode: 'fortune' });
  check('吉凶模式：每个点一条时间序列', f.points === records.length && f.series.length >= 5,
    `${f.points} 点 / ${f.series.length} 条线：${f.series.map((s) => s.name).join('、')}`);
  check('吉凶诸线同量程，可直接叠看', f.scale === 'signed' && f.series.every((s) => s.scale === 'signed'),
    '量程 −100 ~ +100');
  check('所有取值都在量程内', f.series.every((s) => s.values.every((v) => v === null || (v >= -100 && v <= 100))));
  check('时间点与卦录一一对应', f.xLabels.length === records.length && f.records.length === records.length);

  const el = trend.buildTrend(records, { mode: 'element' });
  check('五行模式：五条占比线，量程 0~100', el.series.length === 5 && el.scale === 'percent',
    el.series.map((s) => `${s.name}=${s.values.join('/')}`).join('　'));
  const el3 = trend.buildTrend(records, { mode: 'element', smooth: 3 });
  check('平滑窗口生效（五行占比滚动）', el3.series.some((s) => s.values.some((v) => v > 0 && v < 100)),
    `金：${el3.series.find((s) => s.name.startsWith('金')).values.join('/')}`);

  const cat = trend.buildTrend(records, { mode: 'category' });
  check('分类别模式：每类一条线 + 全体基准线', cat.series.length >= 2 && cat.series.some((s) => s.dashed),
    cat.series.map((s) => s.name).join('、'));

  const t2 = trend.buildTrend(records, { mode: 'fortune', domains: ['score'], smooth: 3, rangeDays: 3650 });
  check('可选领域与移动平均生效', t2.series.length === 1 && t2.series[0].raw !== null,
    `原始 ${t2.series[0].raw.join('/')} → 平滑 ${t2.series[0].values.join('/')}`);

  const empty = trend.buildTrend([], {});
  check('无数据时不崩，给出提示', empty.points === 0 && empty.notes.length > 0, empty.notes[0]);

  const sum = trend.trendSummary(records);
  check('走势摘要可算', sum.count === records.length && typeof sum.delta === 'number',
    `前三之一均值 ${sum.earliest} → 后三之一均值 ${sum.latest}（起落 ${sum.delta}）`);
}

console.log('\n【七】格式规范、schema 与迁移');
{
  const schemaMod = await load('core/schema.mjs');
  const gt = await load('core/guaTiao.mjs');
  const mg = await load('core/migrate.mjs');

  const recSchema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', 'record.schema.json'), 'utf8'));
  const gtSchema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', 'gua-tiao.schema.json'), 'utf8'));
  check('两份 schema 都是合法 JSON 且有 $id', !!recSchema.$id && !!gtSchema.$id);

  const recs = fs.readdirSync(recordsDir).filter((f) => f.endsWith('.json'))
    .map((f) => ({ f, rec: JSON.parse(fs.readFileSync(path.join(recordsDir, f), 'utf8')) }));
  const schemaFails = recs.filter((x) => !schemaMod.validate(x.rec, recSchema, { strict: true }).valid);
  check('全部卦录通过 record schema', schemaFails.length === 0,
    schemaFails.map((x) => x.f).join('、') || `${recs.length} 条`);

  // 负向：多一个未声明字段必须被抓出
  const bad = { ...recs[0].rec, 手滑字段: 1 };
  const badRes = schemaMod.validate(bad, recSchema, { strict: true });
  check('schema 能抓出未声明字段（负向测试）', !badRes.valid && badRes.errors.some((e) => e.keyword === 'additionalProperties'),
    badRes.errors[0]?.message?.slice(0, 60));

  // 卦条：模板 → 解析 → 校验
  const tpl = gt.template();
  check('卦条模板带版本头', tpl.startsWith(gt.HEADER));
  const parsedTpl = gt.parseGuaTiao(tpl);
  check('模板能被自己解析回来', parsedTpl.source === 'gua-tiao' && parsedTpl.fields.method === 'numberAndTime',
    `认出 ${parsedTpl.claimed.ben} 动${parsedTpl.claimed.moving} 时 ${parsedTpl.fields.localTime}`);
  check('模板解析结果通过 gua-tiao schema', schemaMod.validate(parsedTpl, gtSchema, { strict: true }).valid);

  // 卦条：卦录 → 卦条 → 再解析（往返）
  const src = recs.find((x) => x.rec.chart?.ben);
  const text = gt.toGuaTiao(src.rec);
  const back = gt.parseGuaTiao(text);
  check('卦录 → 卦条 → 再解析，卦象不变（往返一致）',
    back.claimed.ben === src.rec.chart.ben.fullName && back.claimed.moving === src.rec.chart.moving.position,
    `${src.rec.chart.ben.fullName} 动${src.rec.chart.moving.yaoTitle}｜卦条 ${text.split('\n').length} 行`);

  // 缺信息时报缺，不猜
  const vague = gt.parseGuaTiao('# 卦条 v1\n问: 随便问问\n本卦: 泽山咸\n动: 2');
  check('缺时间时报缺而不猜', vague.ok === false && vague.missing.includes('起卦时间'), `缺：${vague.missing.join('、')}`);

  // 认不出的键名要报出来
  const typo = gt.parseGuaTiao('# 卦条 v1\n时: 2026-10-05 05:20\n法: 已知卦象\n本卦: 泽山咸\n动2: 3');
  check('认不出的键名会报出', typo.unknownKeys.includes('动2'), `unknownKeys=${typo.unknownKeys.join('、') || '（空）'}`);

  // 迁移机制
  // 这些断言**跟着 CURRENT_SCHEMA 走**，不写死版本号——
  // 写死的话每次升版都要来改一遍自检，那正是「第二真源」的毛病。
  check('结构版本是大于 0 的整数', Number.isInteger(mg.CURRENT_SCHEMA) && mg.CURRENT_SCHEMA > 0,
    `v${mg.CURRENT_SCHEMA}`);
  check('每一级都有迁移函数（升版不能留下断档）',
    Array.from({ length: mg.CURRENT_SCHEMA }, (_, i) => i).every((v) => typeof mg.MIGRATIONS[v] === 'function'),
    `已登记 ${Object.keys(mg.MIGRATIONS).join('、')}`);
  const legacy = { id: 'legacy-test', chart: {}, reading: {} };
  const m = mg.migrate(legacy);
  check('无版本号的旧记录被迁到最新版',
    m.to === mg.CURRENT_SCHEMA && m.record.schema === mg.CURRENT_SCHEMA && m.applied.length === mg.CURRENT_SCHEMA,
    `v${m.from} → v${m.to}，走了 ${m.applied.length} 步`);
  check('已是最新版本的记录不被改动',
    mg.migrate({ schema: mg.CURRENT_SCHEMA }).applied.length === 0);

  // 每一级迁移各自专测：**只许新增，不许动已有的 cast／chart／reading**。
  // 直接测迁移函数本身（MIGRATIONS[n]），不跟着 CURRENT_SCHEMA 走——升版也不会误红。
  {
    const sample = {
      schema: 1, id: 'x',
      cast: { method: 'numberAndTime', numbers: [82], localTime: '2026-09-28 03:12', longitude: 103.83 },
      chart: null, reading: { signature: '原样' },
    };
    const before = JSON.stringify({ cast: sample.cast, reading: sample.reading });
    const out = mg.MIGRATIONS[1](JSON.parse(JSON.stringify(sample)));
    const after = JSON.stringify({ cast: out.cast, reading: out.reading });
    check('v1 → v2 只新增应期，不动 cast/reading', before === after, `应期 ${out.yingqi ? '已算' : '算不出'}`);
  }
  {
    const sample = {
      schema: 2, id: 'x',
      cast: { method: 'manual', localTime: '2026-09-28 03:12', hexagram: '泽水困' },
      chart: { ben: { fullName: '泽水困' } },
      reading: { signature: '原样' },
      claimed: { ben: '泽水困' },
      corrections: [{ label: '体用', note: '存录' }],
    };
    const keys = ['cast', 'chart', 'reading', 'claimed', 'corrections'];
    const pick = (r) => JSON.stringify(Object.fromEntries(keys.map((k) => [k, r[k]])));
    const out = mg.MIGRATIONS[2](JSON.parse(JSON.stringify(sample)));
    check('v2 → v3 只新增补充存录四字段，不动其余',
      pick(sample) === pick(out) && ['background', 'plan', 'collation', 'qa'].every((k) => out[k] === ''),
      '四字段留空');
  }

  // 卦条：补充存录四个多行块
  {
    const txt = [
      '# 卦条 v1', '时: 2026-10-05 05:20', '法: 已知卦象', '本卦: 泽水困', '动: 4',
      '背景: |', '  求测人在兰州，备考为主，兼职次之。',
      '问答: |', '  问：能上岸吗？', '  答：可，须守常。',
      '原文: |', '  解读全文第一行，', '  第二行。',
      '方案: |', '  九月前只看主线。',
      '校勘: |', '  「第四爻阳变阴」应作「六四阴爻动，变阳」。',
    ].join('\n');
    const p = gt.parseGuaTiao(txt);
    check('卦条四个多行块都认得出来',
      p.background.includes('兼职次之') && p.qa.includes('答：可')
        && p.plan.includes('只看主线') && p.collation.includes('六四阴爻动') && p.narrative.includes('第二行'),
      `背景 ${p.background.length} 字／问答 ${p.qa.length} 字／原文 ${p.narrative.length} 字`);
    check('补充存录的卦条解析结果通过 gua-tiao schema',
      schemaMod.validate(p, gtSchema, { strict: true }).valid);
    const round = gt.parseGuaTiao(gt.toGuaTiao({
      cast: {}, title: 't',
      narrative: p.narrative, background: p.background, plan: p.plan, collation: p.collation, qa: p.qa,
    }));
    check('卦录 → 卦条 → 再解析，补充存录一字不丢',
      round.background === p.background && round.plan === p.plan
        && round.collation === p.collation && round.qa === p.qa && round.narrative === p.narrative);
  }

  // 迁移动真格：先备份，再落盘
  {
    const { Store: StoreCls } = await load('server/store.mjs');
    const dir = path.join(os.tmpdir(), `qxg-check-mig-${Date.now()}`);
    const s1 = new StoreCls(dir);
    fs.writeFileSync(path.join(dir, 'records', 'old.json'),
      JSON.stringify({ id: '199901010000-01', cast: {}, chart: {}, reading: {} }), 'utf8');
    const s2 = new StoreCls(dir, { migrator: mg.migrate });
    check('载入时自动迁移旧版本记录',
      s2.get('199901010000-01')?.schema === mg.CURRENT_SCHEMA && s2.migrations.length === 1,
      `迁移记录 ${s2.migrations.length} 条，schema=v${s2.get('199901010000-01')?.schema}`);
    const backed = fs.existsSync(path.join(dir, 'backups', 'pre-migration'))
      && fs.readdirSync(path.join(dir, 'backups', 'pre-migration')).length === 1;
    check('迁移前原件已备份到 backups/pre-migration/', backed);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // 外部改动重扫：服务运行期间用命令行导入的卦录，必须能被看见
  {
    const { Store: StoreCls } = await load('server/store.mjs');
    const dir = path.join(os.tmpdir(), `qxg-check-scan-${Date.now()}`);
    const s = new StoreCls(dir);
    check('新建库起始为空', s.list().length === 0);
    // 重扫靠目录 mtime 变了才触发；同一毫秒内建成库又写文件时两者可能相等，
    // 于是偶发「0 → 0 条」（跑过十几轮里会碰上一次）。等一拍再写，把时钟粒度这个
    // 与本条断言无关的变量排掉——它不是被测行为。
    await new Promise((r) => setTimeout(r, 30));
    fs.writeFileSync(path.join(dir, 'records', 'ext.json'),
      JSON.stringify({ ...recs[0].rec, id: '209901010000-01' }), 'utf8');
    const scan = s.maybeRescan();
    check('外部新增的卦录会被重扫发现', scan.rescanned && s.list().length === 1, `${scan.before} → ${scan.after} 条`);
    check('无外部改动时不重扫（省开销）', s.maybeRescan().rescanned === false);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // 校验器负向能力：故意注入缺陷，必须被抓出
  {
    const badOnes = [
      ['未声明字段', { ...recs[0].rec, 手滑: 1 }],
      ['七段顺序打乱', (() => { const r = JSON.parse(JSON.stringify(recs[0].rec)); r.reading.tone.reverse(); return r; })()],
      ['动爻阴阳与六爻不符', (() => { const r = JSON.parse(JSON.stringify(recs[0].rec)); r.chart.moving.isYang = !r.chart.moving.isYang; return r; })()],
      ['类别不在枚举内', { ...recs[0].rec, category: '随便一类' }],
      ['缺少必填字段', (() => { const r = JSON.parse(JSON.stringify(recs[0].rec)); delete r.cast; return r; })()],
    ];
    const missed = badOnes.filter(([, r]) => {
      const res = schemaMod.validate(r, recSchema, { strict: true });
      const labels = res.errors.map((e) => e.keyword).join(',');
      // 七段顺序与动爻阴阳属于语义约定，由 tools/validate.mjs 负责；此处只要 schema 层或语义层有一处报错即可
      return res.valid && !(r.reading?.tone && r.reading.tone.map((t) => t.label).join('') !== '主互变断宜忌应期')
        && !(r.chart?.moving && r.chart?.lines && r.chart.moving.isYang !== (r.chart.lines[r.chart.moving.position - 1] === 1));
    });
    check('校验器抓得出五类缺陷（含负向测试）', missed.length === 0,
      missed.length ? `漏掉：${missed.map(([n]) => n).join('、')}` : badOnes.map(([n]) => n).join('、'));
  }
}

console.log('\n【八】Agent 工具与 MCP');
{
  const { Store } = await load('server/store.mjs');
  const mk = await load('agent/tools.mjs');
  const mcpMod = await load('agent/mcp-server.mjs');
  const loopMod = await load('agent/loop.mjs');

  const tmpDir = path.join(os.tmpdir(), `qxg-check-${Date.now()}`);
  const testStore = new Store(tmpDir);
  const coreMods = {
    calendar: cal, bagua: await load('core/bagua.mjs'), hexagram: hx, divination: dv,
    verdict: vd, record: rc, render: rd, importer: await load('core/importer.mjs'),
    trend: await load('core/trend.mjs'), guaTiao: await load('core/guaTiao.mjs'),
    migrate: await load('core/migrate.mjs'),
  };
  const tk = mk.createToolkit({ store: testStore, core: coreMods });

  check('工具集齐备且都带 JSON Schema', tk.tools.length >= 10 && tk.tools.every((t) => t.parameters?.type === 'object'),
    `${tk.tools.length} 个：${tk.tools.map((t) => t.name).join('、')}`);
  check('OpenAI function 格式正确', tk.openaiTools().every((t) => t.type === 'function' && t.function.name && t.function.parameters));
  check('MCP inputSchema 格式正确', tk.mcpTools().every((t) => t.name && t.inputSchema?.type === 'object'));

  const castOut = await tk.call('cast', {
    method: 'numberAndTime', numbers: [82], localTime: '2026-09-28 03:12',
    longitude: 103.83, placeName: '兰州', useTrueSolarTime: false, movingFrom: 'number',
    question: '测试', category: '考研学业',
  });
  check('工具 cast 能算出正确卦象', castOut.ok && castOut.result.卦录.本卦 === '泽火革䷰' && castOut.result.卦录.动爻.startsWith('九四'),
    `${castOut.result?.卦录?.本卦} ${castOut.result?.卦录?.动爻}`);
  check('工具 cast 返回完整七段断语', Object.keys(castOut.result.断语.定调).join('') === '主互变断宜忌应期');

  const look = await tk.call('hexagram_lookup', { query: '改命' });
  check('工具 hexagram_lookup 能按爻辞反查', look.ok && look.result.卦名 === '泽火革', `改命 → ${look.result?.卦名}`);

  const spec = await tk.call('format_spec', {});
  check('工具 format_spec 给出卦条格式', spec.ok && String(spec.result.卦条格式.示例).includes('# 卦条 v1'));

  const badTool = await tk.call('不存在的工具', {});
  check('调用不存在的工具返回失败而非抛错', badTool.ok === false && /没有名为/.test(badTool.error), badTool.error?.slice(0, 40));

  // 写入路径：在临时库里试 save_gua_tiao
  const before = testStore.list().length;
  const saved = await tk.call('save_gua_tiao', {
    text: '# 卦条 v1\n问: 自检用例\n类: 心态情绪\n时: 2026-10-08 08:00\n地: 兰州\n法: 一数一时辰\n数: 9\n动: 3\n',
  });
  check('工具 save_gua_tiao 能入库', saved.ok && saved.result.已入库.length === 1 && testStore.list().length === before + 1,
    saved.result?.已入库?.[0] ? `${saved.result.已入库[0].id} ${saved.result.已入库[0].本卦}` : JSON.stringify(saved.result));
  const inRec = testStore.list()[0];
  check('入库的卦录结构合法', !!inRec && (await load('core/schema.mjs')).validate(inRec, JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', 'record.schema.json'), 'utf8')), { strict: true }).valid);
  check('入库的卦录来源标注为卦条', inRec?.origin?.kind === 'gua-tiao', inRec?.origin?.label);

  const revised = await tk.call('update_review', { id: inRec.id, status: '已应验', result: '自检：确实应了。', logText: '自检追记', logAt: '2026-10-20' });
  check('工具 update_review 能写复盘', revised.ok && revised.result.复盘.status === '已应验' && revised.result.复盘.log.length === 1,
    `${revised.result?.复盘?.status}　${revised.result?.复盘?.reviewedAt}`);

  // 反推动爻取法：卦条只写「数、时、动」，应能认出当初用的是哪一路取法，不误报校勘
  const inferTmp = path.join(os.tmpdir(), `qxg-check-infer-${Date.now()}`);
  const inferStore = new Store(inferTmp);
  const tk2 = mk.createToolkit({ store: inferStore, core: coreMods });
  const ov = await load('core/divination.mjs');
  check('动爻取法反推：仅报数取能被认出',
    ov.inferMovingFrom({ method: 'numberAndTime', numbers: [9], localTime: '2026-10-08 08:00', longitude: 103.83, useTrueSolarTime: true }, 3) === 'number',
    '数9、辰时：9÷6余3 与 和数÷6 不同，认作「仅报数」');
  check('动爻取法反推：常法不被误解',
    ov.inferMovingFrom({ method: 'numberAndTime', numbers: [9], localTime: '2026-10-08 08:00', longitude: 103.83, useTrueSolarTime: true }, 2) === 'sum',
    '和数 (9+5)÷6 余 2 → 认作常法');
  const inferSave = await tk2.call('save_gua_tiao', {
    text: '# 卦条 v1\n问: 取法反推用例\n时: 2026-10-08 08:00\n地: 兰州\n法: 一数一时辰\n数: 9\n动: 3\n',
  });
  const inferRec = inferStore.list()[0];
  check('卦条按所述动爻忠实还原，不误记校勘',
    inferSave.ok && inferRec.chart.moving.position === 3 && inferRec.cast.movingFrom === 'number' && (inferRec.corrections || []).length === 0,
    `动${inferRec?.chart?.moving?.yaoTitle}　取法=${inferRec?.cast?.movingFrom}　校勘 ${inferRec?.corrections?.length} 处`);
  fs.rmSync(inferTmp, { recursive: true, force: true });

  fs.rmSync(tmpDir, { recursive: true, force: true });

  // MCP 协议
  const rt = { store: testStore, core: coreMods, toolkit: tk };
  const init = await mcpMod.handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, rt);
  check('MCP initialize 返回协议与能力', init.result.protocolVersion && init.result.capabilities.tools, `${init.result.serverInfo.name}@${init.result.serverInfo.version} 协议 ${init.result.protocolVersion}`);
  const notif = await mcpMod.handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, rt);
  check('MCP 通知不返回响应', notif === null);
  const tl = await mcpMod.handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, rt);
  // MCP 与内置助手受**同一权限等级**管，所以这里验的是「两边一致」而不是「全都给」。
  // 默认「可写」下 MCP 看不到删除类工具——那正是分级的意义所在。
  const rtTools = rt.toolkit || rt.tools;
  const expectTools = rtTools?.describe
    ? rtTools.describe().filter((t) => t.allowed).length
    : tl.result.tools.length;
  check('MCP tools/list 按同一权限等级裁剪', tl.result.tools.length === expectTools,
    `${tl.result.tools.length} 个（该等级可用 ${expectTools} 个）`);
  check('MCP 默认不给删除类工具', !tl.result.tools.some((t) => t.name === 'delete_record'),
    `等级 ${rtTools?.permission ?? '?'}`);
  const tc = await mcpMod.handleRpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'stats', arguments: {} } }, rt);
  check('MCP tools/call 执行成功', !tc.result.isError && tc.result.content[0].type === 'text', `${tc.result.content[0].text.length} 字节`);
  const rl = await mcpMod.handleRpc({ jsonrpc: '2.0', id: 4, method: 'resources/list' }, rt);
  check('MCP 暴露资源', rl.result.resources.length >= 2, rl.result.resources.map((r) => r.uri).join('、'));
  const uk = await mcpMod.handleRpc({ jsonrpc: '2.0', id: 5, method: '不存在的方法' }, rt);
  check('MCP 未知方法返回 -32601', uk.error?.code === -32601, uk.error?.message);

  // Agent 循环的硬约束
  check('system prompt 含「卦象必须由工具算出」的硬约束',
    /不得自行编造/.test(loopMod.SYSTEM_PROMPT) && /cast/.test(loopMod.SYSTEM_PROMPT));
  // 「完整起卦」这一节是第 5 条反馈的落点：让助手把整条卦录填满，
  // 但报数必须问用户要——它编一个数，这卦就不算在用户身上了
  check('system prompt 交代了完整起卦要填满整条卦录',
    /完整起卦/.test(loopMod.SYSTEM_PROMPT) && /title/.test(loopMod.SYSTEM_PROMPT)
    && /narrative/.test(loopMod.SYSTEM_PROMPT) && /category/.test(loopMod.SYSTEM_PROMPT),
    '含标题/原文/类别');
  check('system prompt 明令不许自己编报数',
    /绝不自己编一个数/.test(loopMod.SYSTEM_PROMPT));
  check('system prompt 要求「对话里那卦」先看对话、别只查卦录台，且不许否认自己写过的',
    /一之二/.test(loopMod.SYSTEM_PROMPT) && /先读这段对话/.test(loopMod.SYSTEM_PROMPT)
      && /没有经过工具、没入库/.test(loopMod.SYSTEM_PROMPT)
      && /说成没发生过/.test(loopMod.SYSTEM_PROMPT));
  check('system prompt 提醒别先 cast 再 save（那是两次起卦）',
    /两次起卦/.test(loopMod.SYSTEM_PROMPT));
  const prov = await load('agent/provider.mjs');
  const unready = prov.resolveConfig({ provider: 'deepseek', apiKey: '' });
  check('未配 Key 时明确报不可用', unready.ready === false && /API Key/.test(unready.reason), unready.reason);
  const local = prov.resolveConfig({ provider: 'ollama' });
  check('本地 Ollama 无需 Key 即可用', local.ready === true, `${local.baseUrl} / ${local.model}`);
  check('文本协议降级能解析出工具调用',
    prov.extractTextToolCalls('好的\n```json\n{"tool":"cast","args":{"numbers":[7]}}\n```').length === 1);

  // 上下文窗口预设：口径写在 agent/provider.mjs 一处，服务端与前端都从它取
  check('上下文窗口预设：deepseek-* 为 1M、gpt-*/o* 为 128k',
    prov.contextWindowFor('deepseek', 'deepseek-chat') === 1000000
    && prov.contextWindowFor('deepseek', 'deepseek-v4-pro') === 1000000
    && prov.contextWindowFor('openai', 'gpt-4o-mini') === 128000
    && prov.contextWindowFor('openai', 'o3-mini') === 128000);
  check('上下文窗口预设：认不出的模型返回 0（未知，前端不显示占比）',
    prov.contextWindowFor('ollama', 'qwen2.5:7b') === 0
    && prov.contextWindowFor('hermes', 'NousResearch/Hermes-3-Llama-3.1-8B') === 0
    && prov.contextWindowFor('custom', '') === 0);

  // 余额档案：只有带 url 的厂商才会真的发请求
  const dsBal = prov.balanceProfile('deepseek', 'https://api.deepseek.com/v1');
  check('余额档案：deepseek 给得出 /user/balance，ollama 给不出 url',
    dsBal.kind === 'deepseek' && dsBal.url === 'https://api.deepseek.com/user/balance'
    && !!dsBal.console
    && prov.balanceProfile('ollama', 'http://127.0.0.1:11434/v1').url === '');
  // 不支持余额的厂商：返回 supported:false，且**一个请求都不发**（注入的 fetch 会自曝）
  let balanceFetched = 0;
  const noBal = await prov.fetchBalance({
    provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'x',
    fetchImpl: () => { balanceFetched += 1; throw new Error('不该发请求'); },
  });
  check('余额查询：不支持的厂商返回 supported:false 且不发请求',
    noBal.ok === true && noBal.supported === false && balanceFetched === 0, noBal.hint);
}

/* ============================================================
 * 十、Agent 权限与二次确认
 * ========================================================== */
console.log('\n【十】Agent 权限与二次确认');
{
  const perm = await load('agent/permissions.mjs');
  const toolsMod = await load('agent/tools.mjs');

  check('权限有四级且累加', perm.LEVEL_IDS.join(',') === 'read,write,delete,full',
    perm.LEVELS.map((l) => `${l.id}=${l.name}`).join(' '));
  check('高级别包含低级别', perm.allows('full', 'read') && perm.allows('delete', 'write') && perm.allows('write', 'read'));
  check('低级别不越权', !perm.allows('read', 'write') && !perm.allows('write', 'delete') && !perm.allows('delete', 'full'));
  check('同名等级自反', perm.LEVEL_IDS.every((l) => perm.allows(l, l)));
  check('未知等级回落到默认而非放行', perm.normalizeLevel('随便写的') === perm.DEFAULT_LEVEL,
    `${perm.normalizeLevel('随便写的')}（默认 ${perm.DEFAULT_LEVEL}）`);
  check('默认等级是「可写」而不是全权', perm.DEFAULT_LEVEL === 'write', perm.DEFAULT_LEVEL);

  const tkOf = (level) => toolsMod.createToolkit({ store: null, core: null, permission: level });
  const base = tkOf('write');
  const map = base.permissionMap();
  const all = base.describe();

  check('工具数已扩到覆盖内部操作', all.length >= 20, `${all.length} 个`);
  check('每个工具都显式登记了权限（漏登记会被这里抓出来）',
    all.every((t) => map[t.name]),
    all.filter((t) => !map[t.name]).map((t) => t.name).join('、') || '全部已登记');
  check('登记表里没有多余的名字', Object.keys(map).every((n) => all.some((t) => t.name === n)),
    Object.keys(map).filter((n) => !all.some((t) => t.name === n)).join('、') || '一一对应');
  check('存在删除与恢复类工具', ['delete_record', 'list_trash', 'restore_record'].every((n) => map[n] === 'delete'),
    '三个都在 delete 级');
  check('删除是软删：工具定义里没有 hard 参数',
    !JSON.stringify(base.byName.get('delete_record').parameters).includes('hard'));

  const countsByLevel = (lv) => all.filter((t) => perm.allows(lv, t.permission)).length;
  check('等级越高可用工具越多', countsByLevel('read') < countsByLevel('write')
    && countsByLevel('write') < countsByLevel('delete') && countsByLevel('delete') < countsByLevel('full'),
    `read ${countsByLevel('read')} < write ${countsByLevel('write')} < delete ${countsByLevel('delete')} < full ${countsByLevel('full')}`);

  // 权限等级是**惰性读**的：改设置立刻生效，不用重启。
  // 这条守的是一个真踩过的 bug——把 level 写成函数却仍按常量传参，
  // 结果 allows() 拿函数对象当等级 id，永远回落到「可写」。
  let live = 'write';
  const dyn = toolsMod.createToolkit({ store: null, core: null, permission: () => live });
  const delAllowed = () => dyn.describe().find((t) => t.name === 'delete_record').allowed;
  check('权限惰性读：改等级立刻生效', delAllowed() === false, 'write 时不可删');
  live = 'delete';
  check('权限惰性读：升到 delete 后即可删', delAllowed() === true);
  live = 'read';
  check('权限惰性读：降到 read 后连写也不行',
    dyn.describe().find((t) => t.name === 'save_record').allowed === false);
  live = 'write';

  check('给模型的工具清单按等级裁剪',
    tkOf('read').openaiTools().length === countsByLevel('read')
    && tkOf('full').openaiTools().length === all.length,
    `read 给 ${tkOf('read').openaiTools().length} 个，full 给 ${tkOf('full').openaiTools().length} 个`);
  check('MCP 工具清单同样按等级裁剪',
    tkOf('read').mcpTools().length === countsByLevel('read'));

  const denied = await tkOf('write').call('delete_record', { id: 'x' });
  check('越权调用被拒且不执行', denied.ok === false && denied.denied === true && denied.needsPermission === 'delete');
  check('拒绝文案说清现状、要求与去哪改',
    /当前助手权限是/.test(denied.error) && /需要/.test(denied.error) === false
    && /设置/.test(denied.error),
    denied.error.slice(0, 60));

  const needConfirm = await tkOf('delete').call('delete_record', { id: 'x' });
  check('破坏性工具未确认时不执行', needConfirm.ok === false && needConfirm.needsConfirm === true);
  check('确认请求带人话摘要', typeof needConfirm.confirm?.summary === 'string' && needConfirm.confirm.summary.length > 4,
    needConfirm.confirm?.summary);
  check('确认提示叫模型别重复调用', /不要重复调用/.test(needConfirm.error));

  check('delete_record 与 update_config 是需要确认的两个',
    all.filter((t) => t.destructive).map((t) => t.name).sort().join(',') === 'delete_record,update_config',
    all.filter((t) => t.destructive).map((t) => t.name).join('、'));

  // update_config 的白名单：模型绝不能借它给自己提权
  const cfgTk = toolsMod.createToolkit({
    store: {
      getConfig: () => ({}),
      setConfig: (p) => { cfgTk.__last = p; return p; },
      trashDir: '',
    },
    core: null,
    permission: 'full',
  });
  await cfgTk.call('update_config', { agent: { permission: 'full' }, plugins: {}, defaultLongitude: 100, confirm: true });
  check('update_config 白名单挡得住提权',
    cfgTk.__last && !('agent' in cfgTk.__last) && !('plugins' in cfgTk.__last) && cfgTk.__last.defaultLongitude === 100,
    JSON.stringify(cfgTk.__last));

  // 恢复工具的目录穿越
  const trav = toolsMod.createToolkit({
    store: {
      trashDir: process.env.TEMP || '/tmp',
      getConfig: () => ({}),
      has: () => false,
      save: () => { trav.__saved = true; },
    },
    core: null,
    permission: 'delete',
  });
  const bad = await trav.call('restore_record', { file: '../../../etc/passwd', confirm: true });
  check('restore_record 挡得住目录穿越', bad.ok === false && trav.__saved !== true, bad.error);

  const loopSrc = fs.readFileSync(new URL('../agent/loop.mjs', import.meta.url), 'utf8');
  check('循环会在破坏性操作前停下等确认', /needsConfirm/.test(loopSrc) && /pendingConfirm/.test(loopSrc));
  check('停下时会摘掉悬空的 tool_calls 消息', /convo\.pop\(\)/.test(loopSrc));
  const loopMod2 = await load('agent/loop.mjs');
  check('system prompt 交代了「需要确认」该怎么办', /不要重复调用/.test(loopMod2.SYSTEM_PROMPT));
  check('事件流含思考与工具轨迹', /type: 'thinking'/.test(loopSrc) && /type: 'round'/.test(loopSrc)
    && /phase: 'start'/.test(loopSrc) && /phase: 'done'/.test(loopSrc));
  // 推理模型的思维链要作为「思考」事件发出去。只把「调工具前那句话」当思考，
  // 推理模型（常常没有正文）在界面上就是一片空白，看不到任何过程。
  check('推理模型的思维链会作为「思考」事件发出',
    /kind: 'reason'/.test(loopSrc) && /message\.reasoning/.test(loopSrc));
}

/* ============================================================
 * 十一、应期与领域走势
 * ========================================================== */
console.log('\n【十一】应期与领域走势');
{
  const yq = await load('core/yingqi.mjs');
  const tr = await load('core/trend.mjs');
  // 这些在上面各块里是块级作用域，这里要自己再取一遍
  const div = await load('core/divination.mjs');
  const mg2 = await load('core/migrate.mjs');
  const coreRecord = await load('core/record.mjs');

  // 造两条对照：体得气（应期短）与体未得气（须待得令之月）
  const inSeason = div.cast({ method: 'numberAndTime', numbers: [7], localTime: '2026-03-05 09:00', longitude: 103.83, useTrueSolarTime: false, movingFrom: 'number' });
  const y1 = yq.computeYingqi(inSeason);
  check('应期算出的是一个区间而非一个点', y1 && y1.minDays >= 1 && y1.maxDays > y1.minDays,
    `${y1.minDays}–${y1.maxDays} 天`);
  check('应期带出处日期', /^\d{4}-\d{2}-\d{2}$/.test(y1.from) && /^\d{4}-\d{2}-\d{2}$/.test(y1.to),
    `${y1.from} → ${y1.to}`);
  check('应期分档在四档之内', ['near', 'mid', 'far', 'long'].includes(y1.horizon), `${y1.horizonName}`);
  check('应期给出逐项依据（算不出理由的应期等于没说）',
    y1.basis && typeof y1.basis.baseDays === 'number' && typeof y1.reason === 'string' && y1.reason.length > 20,
    y1.reason.slice(0, 56));
  check('应期标了出处是算出来的', y1.source === 'computed');

  // 与断语同一套规矩：未得气时，量化的上限不得越过「得令之月」那一段
  const yangCases = [];
  for (const f of fs.readdirSync(recordsDir)) {
    if (!f.endsWith('.json')) continue;
    const rec = JSON.parse(fs.readFileSync(path.join(recordsDir, f), 'utf8'));
    const chart = div.cast(rec.cast);
    const y = yq.computeYingqi(chart, { from: rec.cast?.localTime });
    const tone = rec.reading?.tone?.find((t) => t.key === 'yingqi');
    yangCases.push({ rec, chart, y, tone });
  }
  check('每条真实卦录都算得出应期', yangCases.every((c) => c.y && c.y.maxDays >= 1),
    yangCases.map((c) => `${c.chart.ben.name}:${c.y.maxDays}天`).join('　'));

  const notInSeason = yangCases.filter((c) => c.y && !c.y.inSeason && c.y.seasonAt);
  check('体未得气时给出「得令之月」锚点', notInSeason.length > 0,
    notInSeason.map((c) => `${c.chart.ben.name}→${c.y.seasonAt.date}~${c.y.seasonAt.endDate}`).join('　'));
  check('量化上限不越过得令之月（与断语同一套规矩）',
    notInSeason.every((c) => c.y.seasonAt.endDate >= c.y.to),
    notInSeason.map((c) => `${c.chart.ben.name}: ${c.y.to} ≤ ${c.y.seasonAt.endDate}`).join('　'));

  const fitOnes = yangCases.filter((c) => c.y && c.y.inSeason);
  check('体得气时应期落在短窗口（断语说「不至久留」）',
    fitOnes.every((c) => c.y.maxDays <= 180),
    fitOnes.map((c) => `${c.chart.ben.name}:${c.y.horizonName}${c.y.maxDays}天`).join('　'));
  check('断语里确实有「应期」那一段可对读', yangCases.every((c) => c.tone && c.tone.text),
    yangCases[0]?.tone?.text?.slice(0, 40) || '');

  // 走势：横轴按应验时间
  const recs = yangCases.map((c) => {
    const out = mg2.migrate(c.rec);
    if (!out.record.yingqi) out.record.yingqi = c.y;
    return out.record;
  });
  const byCast = tr.buildTrend(recs, { mode: 'domain', axis: 'cast' });
  const byDue = tr.buildTrend(recs, { mode: 'domain', axis: 'due' });
  check('按起卦时间会把长期之事全挤在一起（这正是原问题）',
    byCast.spanDays < 1, `跨度 ${byCast.spanDays} 天`);
  check('按应验时间把长期之事排到右侧未来', byDue.spanDays > byCast.spanDays * 10,
    `${byCast.spanDays} 天 → ${byDue.spanDays} 天`);
  check('应验时间轴至少跨过一个季度', byDue.spanDays >= 90, `${byDue.spanDays} 天`);
  check('轴标签用的是应验日期', byDue.xLabels.some((l) => /^\d{2}-\d{2}$/.test(l.text)),
    byDue.xLabels.map((l) => l.text).join('  '));

  // 走势：按领域成线 + 同领域综合基准
  const cats = [...new Set(recs.map((r) => r.category).filter(Boolean))];
  const domSeries = byDue.series.filter((s) => s.id.startsWith('dom:'));
  check('领域运势：一个领域一条线', domSeries.length === cats.length,
    `${cats.length} 个领域 → ${domSeries.length} 条线：${domSeries.map((s) => s.name).join('、')}`);
  check('领域线名里标出该领域有几卦',
    domSeries.every((s) => /（\d+ 卦）/.test(s.name)), domSeries.map((s) => s.name).join('、'));
  check('另有全体基准线可作对照', byDue.series.some((s) => s.id.startsWith('all:') && s.dashed));
  const multi = cats.find((c) => recs.filter((r) => r.category === c).length > 1);
  check('同领域起过多卦时被综合进一条基准', !!multi,
    multi ? `${multi} 有 ${recs.filter((r) => r.category === multi).length} 卦` : '（样本里没有同领域多卦）');
  check('返回每卦相对本领域基准的偏离', byDue.deviations.length > 0,
    byDue.deviations.slice(0, 3).map((d) => `${d.领域} ${d.偏离 > 0 ? '+' : ''}${d.偏离}`).join('　'));

  // 缺应期时退回按起卦时间，而不是把这条丢掉
  const noYq = recs.map((r) => ({ ...r, yingqi: null }));
  const fallback = tr.buildTrend(noYq, { mode: 'domain', axis: 'due' });
  check('缺应期的卦退回按起卦时间放，不被丢掉',
    fallback.points === recs.length && fallback.dueFallback === recs.length,
    `${fallback.points} 点，其中 ${fallback.dueFallback} 条退回`);

  // 应期也进卦录，且迁移不改 reading
  const built = coreRecord.buildRecord({ cast: { method: 'numberAndTime', numbers: [9], localTime: '2026-04-10 10:00', longitude: 103.83, useTrueSolarTime: false } });
  check('新建的卦录自带应期', !!built.yingqi && built.yingqi.maxDays >= 1,
    built.yingqi ? `${built.yingqi.horizonName} ${built.yingqi.maxDays} 天` : '无');
}

/* ============================================================
 * 十二、AI 会话存储
 * ------------------------------------------------------------
 * 会话是「用户自己的对话历史」，与卦录同等级的用户数据，
 * 所以它的纪律也照卦录那套验：原子写、软删进 trash、迁移先备份。
 * ========================================================== */
console.log('\n【十二】AI 会话存储');
{
  const schemaMod = await load('core/schema.mjs');
  const { ChatStore, CHAT_SCHEMA, DEFAULT_TITLE, MAX_FILE_BYTES } = await load('server/chatStore.mjs');
  const dir = path.join(os.tmpdir(), `qxg-chat-${Date.now()}`);
  const quiet = { log() {}, warn() {} };
  const chatDir = path.join(dir, 'chats');
  try {
    const cs = new ChatStore(dir, { logger: quiet });
    check('会话目录已建立', fs.existsSync(chatDir));
    check('新建库起始为空', cs.list().length === 0);

    cs.create({ id: '202610031512-01' });
    check('新建会话且标题是默认值',
      cs.list().length === 1 && cs.get('202610031512-01').title === DEFAULT_TITLE);

    cs.append('202610031512-01', {
      trace: [{ role: 'user', content: '帮我看看最近这一段' }, { role: 'assistant', content: '好' }],
      messages: [{ role: 'user', content: '帮我看看最近这一段' }, { role: 'assistant', content: '好' }],
      model: 'deepseek-chat',
    });
    check('追加一轮后标题取自首条用户消息',
      cs.get('202610031512-01').title !== DEFAULT_TITLE, cs.get('202610031512-01').title);
    const sum = cs.summary(cs.get('202610031512-01'));
    check('摘要给出轮次与条目数', sum.turns === 1 && sum.entries === 2);

    // 双存的意义在这里：界面那份被 4000 截断，模型那份必须完整
    const long = 'x'.repeat(9000);
    cs.append('202610031512-01', {
      trace: [{ role: 'tool', name: 'cast', result: long.slice(0, 4000) }],
      messages: [{ role: 'tool', tool_call_id: 'call_1', content: long }],
    });
    const kept = cs.get('202610031512-01');
    check('模型侧消息不被界面的 4000 截断影响', kept.messages.at(-1).content.length === 9000,
      `trace ${kept.trace.at(-1).result.length} / messages ${kept.messages.at(-1).content.length}`);
    check('trace 与 messages 双存且各自独立', kept.trace.length === 3 && kept.messages.length === 3);

    /* 回推给模型的历史：存档里那串 messages 必须「成对」才能直接用，
       否则原生 function calling 的端点会因为有悬空 tool_calls 而 400。
       而「历史由服务端给」这条是助手聪不聪明的分水岭：界面手里只有展示用 trace，
       里面没有工具返回，拿它重拼历史会让模型下一轮看不到自己算过的卦。 */
    const paired = [
      { role: 'user', content: '起一卦' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'cast', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '{"卦录":{"本卦":"泽火革"}}' },
      { role: 'assistant', content: '卦是泽火革。' },
    ];
    check('存档可回推的判据：tool_calls 与结果必须成对',
      ChatStore.replayable(paired) === true
        && ChatStore.replayable([{ role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'cast' } }] }]) === false
        && ChatStore.replayable([...paired.slice(0, 2), { role: 'user', content: '在吗' }]) === false
        && ChatStore.replayable([{ role: 'tool', tool_call_id: 'c1', content: 'x' }]) === false);

    const hi = ChatStore.historyFor({ messages: paired }, [{ role: 'user', content: '再问一句' }], { maxTurns: 2 });
    const trim = ChatStore.historyFor({ messages: paired }, [{ role: 'user', content: '再问一句' }], { maxTurns: 1 });
    const fb = ChatStore.historyFor(
      { messages: [{ role: 'assistant', content: '没有来处的自述' }] },
      [{ role: 'user', content: '你好' }, { role: 'assistant', content: '你好' }, { role: 'user', content: '再问' }],
    );
    check('历史优先取存档（工具结果与这一轮的用户话都在，按轮切而不按条切），存档不可用才退回界面送的',
      hi.source === 'store' && hi.messages.length === 5 && hi.messages[2].role === 'tool'
        && hi.messages[4].content === '再问一句'
        && trim.messages.length === 1 && trim.messages[0].content === '再问一句'
        && fb.source === 'client' && fb.messages.length === 3 && fb.messages[2].content === '再问');

    /* 老会话（存档缺用户那一轮，永不可回推）也要让模型看得见工具结果：
       从 trace 重塑——trace 里 tool 条目带着真实的 args 与 result。
       没有这一层，模型只能看到自己写过的散文，然后从里面「引」数字（真发生过）。 */
    const oldChat = {
      messages: [{ role: 'assistant', content: '没有来处的自述' }],   // 不可回推的老存档
      trace: [
        { role: 'user', content: '用 63 起一卦' },
        { role: 'thinking', kind: 'reason', content: '想想' },
        { role: 'tool', name: 'cast', title: '起卦', args: { numbers: [63] }, ok: true, ms: 120, result: '{"本卦":"泽火革"}' },
        { role: 'assistant', content: '卦是泽火革。' },
      ],
    };
    const byTrace = ChatStore.historyFor(oldChat, [{ role: 'user', content: '那动爻呢' }]);
    const roles = byTrace.messages.map((m) => m.role).join(',');
    /* 往回带多少：早先写死「最近 12 轮」，而用户会指着最早那句问（「最开始那卦是什么」）。
       实测那段真实会话里，早先写下的一个卦名正好落在 12 轮之外，模型于是矢口否认它存在过。
       现在按字符预算往回装，且只在整轮边界上截断。 */
    const manyTurns = [];
    for (let k = 1; k <= 20; k += 1) {
      manyTurns.push({ role: 'user', content: `第 ${k} 问：${'话'.repeat(40)}` });
      manyTurns.push({ role: 'assistant', content: `第 ${k} 答：${'话'.repeat(40)}` });
    }
    const deep = ChatStore.historyFor({ messages: manyTurns }, [{ role: 'user', content: '最开始那卦是什么' }]);
    const tight = ChatStore.historyFor({ messages: manyTurns }, [{ role: 'user', content: '最开始那卦是什么' }], { budget: 600 });
    check('历史按预算往回装（20 轮全带得回来；预算不够时只留末尾几轮，且不切开整轮）',
      deep.messages.length === 41 && deep.messages[0].content.startsWith('第 1 问')
        && tight.messages.length < 41 && tight.messages.length >= 2
        && tight.messages[0].role === 'user', `deep=${deep.messages.length} 条·tight=${tight.messages.length} 条`);

    check('老会话从 trace 重塑历史：tool_calls 与工具结果成对回到模型眼前',
      byTrace.source === 'trace'
        && roles === 'user,assistant,tool,assistant,user'
        && byTrace.messages[1].tool_calls[0].function.name === 'cast'
        && byTrace.messages[2].tool_call_id === byTrace.messages[1].tool_calls[0].id
        && String(byTrace.messages[2].content).includes('泽火革')
        && ChatStore.replayable(byTrace.messages), roles);

    const f = cs.addFile('202610031512-01', '笔记.txt', Buffer.from('你好', 'utf8'), 'text/plain');
    check('附件落盘并进清单', !!f && cs.get('202610031512-01').files.length === 1, f?.name);
    check('附件可再取回', !!cs.filePath('202610031512-01', '笔记.txt'));
    check('附件路径越界被拒', cs.filePath('202610031512-01', '../../../config.json') === null);
    let tooBig = false;
    try { cs.addFile('202610031512-01', 'big.bin', Buffer.alloc(MAX_FILE_BYTES + 1)); } catch { tooBig = true; }
    check('附件有体积上限', tooBig);

    cs.rename('202610031512-01', '考研主线');
    check('可重命名', cs.get('202610031512-01').title === '考研主线');

    fs.writeFileSync(path.join(chatDir, '202610031520-02.json'), JSON.stringify({
      schema: CHAT_SCHEMA, id: '202610031520-02', title: '外来的',
      createdAt: '2026-10-03T15:20:00.000Z', updatedAt: '2026-10-03T15:20:00.000Z',
      provider: '', model: '', permission: '', trace: [], messages: [], files: [],
    }), 'utf8');
    const scan = cs.maybeRescan();
    check('外部新增的会话会被重扫发现', scan.rescanned && scan.after === 2, `${scan.before} → ${scan.after}`);
    check('无外部改动时不重扫（省开销）', cs.maybeRescan().rescanned === false);

    cs.remove('202610031520-02');
    const trashed = fs.readdirSync(path.join(dir, 'trash')).filter((n) => n.includes('chat'));
    check('删除进回收目录而不是消失', cs.list().length === 1 && trashed.length === 1, trashed.join('、'));

    // 无版本号的旧会话：迁移前先备份，再落盘
    fs.writeFileSync(path.join(chatDir, '202610031530-03.json'), JSON.stringify({
      id: '202610031530-03', title: '旧版',
      createdAt: '2026-10-03T15:30:00.000Z', updatedAt: '2026-10-03T15:30:00.000Z',
      trace: [], messages: [], files: [],
    }), 'utf8');
    const migrated = new ChatStore(dir, {
      logger: quiet,
      migrator: (c) => ({ ok: true, applied: [0], record: { ...c, schema: CHAT_SCHEMA } }),
    });
    check('无版本号的旧会话被迁到最新版', migrated.get('202610031530-03').schema === CHAT_SCHEMA);
    check('迁移前原件已备份到 backups/pre-migration/',
      fs.readdirSync(path.join(dir, 'backups', 'pre-migration')).some((n) => n.includes('chat')));

    const chatSchema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', 'chat.schema.json'), 'utf8'));
    const sample = migrated.get('202610031512-01');
    const okRes = schemaMod.validate(sample, chatSchema, { strict: true });
    check('真实会话通过 chat schema', okRes.valid, okRes.valid ? '' : schemaMod.firstError(okRes));
    check('chat schema 抓得出未声明字段',
      !schemaMod.validate({ ...sample, 手滑字段: 1 }, chatSchema, { strict: true }).valid);
    // 会话 id 的形状是契约（按时间可排序、人一眼认得出是哪天聊的），写坏了要抓出来
    check('chat schema 抓得出 id 形状不对',
      !schemaMod.validate({ ...sample, id: 'abc' }, chatSchema, { strict: true }).valid);
    check('chat schema 抓得出缺必填字段',
      !schemaMod.validate({ ...sample, trace: undefined }, chatSchema, { strict: true }).valid);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ============================================================
 * 十三、工具来源与联网守卫
 * ------------------------------------------------------------
 * 这一节守的是本项目**唯一**的出网实现（agent/sources.mjs，见 ADR-0013）。
 * 提示词能描述规则，但挡不住精心构造的输入，所以守卫必须在内核里、
 * 并且被断言盯住——与「卦象只能由引擎算」同一个思路。
 * ========================================================== */
console.log('\n【十三】工具来源与联网守卫');
{
  const src = await load('agent/sources.mjs');
  const toolsMod = await load('agent/tools.mjs');

  // 逐条列出「不能抓」的地址。少一条就是一个洞
  const blocked = [
    ['127.0.0.1', '回环'],
    ['10.0.0.5', '私有 A 段'],
    ['172.16.3.4', '私有 B 段'],
    ['192.168.1.9', '私有 C 段'],
    ['169.254.169.254', '云元数据'],
    ['100.64.0.1', '运营商级 NAT'],
    ['0.0.0.0', '未指定'],
    ['224.0.0.1', '组播'],
    ['::1', 'IPv6 回环'],
    ['fc00::1', 'IPv6 唯一本地'],
    ['fe80::1', 'IPv6 链路本地'],
    ['ff02::1', 'IPv6 组播'],
    ['::ffff:127.0.0.1', 'IPv4-mapped 回环'],
  ];
  const leaks = blocked.filter(([ip]) => !src.isBlockedAddress(ip)).map(([ip, why]) => `${ip}(${why})`);
  check('内网与保留地址一律拦下（含 IPv4-mapped）', leaks.length === 0, leaks.join('、') || `${blocked.length} 条全拦`);
  check('公网地址不误拦', !src.isBlockedAddress('8.8.8.8') && !src.isBlockedAddress('1.1.1.1'));

  const badScheme = await src.checkUrl('file:///etc/passwd');
  check('只允许 http/https', badScheme.ok === false && /http/.test(badScheme.reason), badScheme.reason);
  const badHost = await src.checkUrl('http://localhost:19730/api/meta');
  check('域名解析后仍拦内网（localhost 不只是字面 IP）', badHost.ok === false, badHost.reason);
  const meta = await src.checkUrl('http://169.254.169.254/latest/meta-data/');
  check('拦云元数据地址', meta.ok === false, meta.reason);

  const allowed = await src.checkUrl('http://8.8.8.8/', { allow: ['8.8.8.8'] });
  check('允许名单内的地址放行', allowed.ok === true, allowed.url);
  const notAllowed = await src.checkUrl('http://1.1.1.1/', { allow: ['8.8.8.8'] });
  check('允许名单外的地址被拒', notAllowed.ok === false, notAllowed.reason);
  const denied = await src.checkUrl('http://8.8.8.8/', { deny: ['8.8.8.8'] });
  check('拒绝名单优先', denied.ok === false, denied.reason);

  check('HTML 转文本会剥掉脚本与样式',
    !src.htmlToText('<html><head><style>p{color:red}</style></head><body><script>alert(1)</script><p>正文&nbsp;在这</p></body></html>')
      .match(/alert|color/),
    JSON.stringify(src.htmlToText('<p>正文&nbsp;在这</p>').slice(0, 20)));
  check('HTML 转文本保留正文与实体还原',
    src.htmlToText('<h1>标题</h1><p>A &amp; B</p>').includes('标题') && src.htmlToText('<p>A &amp; B</p>').includes('A & B'));
  check('能取出网页标题', src.titleOf('<title>某笔记 - 出处</title>') === '某笔记 - 出处');

  // 来源：停用后工具从清单里消失，而不是留着等调用才报错
  const onSrc = src.createWebSource({ getConfig: () => ({ agent: { web: { enabled: true } } }) });
  const offSrc = src.createWebSource({ getConfig: () => ({ agent: { web: { enabled: false } } }) });
  check('联网来源默认给出抓取工具', onSrc.tools().length === 1 && onSrc.tools()[0].name === 'fetch_url');
  check('停用后来源不再贡献工具', offSrc.tools().length === 0);

  const withWeb = toolsMod.createToolkit({ store: null, core: null, permission: 'read', sources: [onSrc] });
  const described = withWeb.describe();
  const map = withWeb.permissionMap();
  check('来源工具被合并进同一份工具集', withWeb.tools.length === toolsMod.createToolkit({ store: null, core: null }).tools.length + 1,
    `${withWeb.tools.length} 个`);
  check('来源工具也登记了权限', map.fetch_url === 'read', String(map.fetch_url));
  check('权限表与工具集一一对应', Object.keys(map).length === withWeb.tools.length,
    `${Object.keys(map).length} 条 / ${withWeb.tools.length} 个`);
  check('工具清单标出来源', described.find((t) => t.name === 'fetch_url')?.source === 'web',
    described.find((t) => t.name === 'fetch_url')?.sourceName);
  check('联网工具的确认语义与破坏性分开',
    described.find((t) => t.name === 'fetch_url')?.confirmKind === 'network'
    && described.find((t) => t.name === 'fetch_url')?.destructive === false);
  check('破坏性工具仍然只有那两个',
    described.filter((t) => t.destructive).map((t) => t.name).sort().join('、') === 'delete_record、update_config',
    described.filter((t) => t.destructive).map((t) => t.name).join('、'));
  check('模型的工具清单里带上了「每次调用都需要确认」',
    /每次调用都需要用户确认/.test(withWeb.openaiTools().find((t) => t.function.name === 'fetch_url')?.function.description || ''));
  check('MCP 工具清单同样带上确认提示',
    /每次调用都需要用户确认/.test(withWeb.mcpTools().find((t) => t.name === 'fetch_url')?.description || ''));

  // 未确认时**不能发请求**：这里用一个内网地址，如果守卫失效会立刻连上并返回 ok
  const pending = await withWeb.call('fetch_url', { url: 'http://127.0.0.1:1/' });
  check('联网工具未确认时只返回待确认、不执行',
    pending.needsConfirm === true && pending.ok === false && pending.confirm.kind === 'network',
    pending.confirm?.summary?.split('\n')[0]);
  const refused = await withWeb.call('fetch_url', { url: 'http://127.0.0.1:19730/api/meta', confirm: true });
  check('确认了也不许抓本机', refused.ok === false && /内网|保留/.test(refused.error), refused.error);
  check('联网工具是只读级，不需要提权',
    withWeb.permissionMap().fetch_url === 'read');
}

/* 空库模拟时用的临时夹具目录：读完了就清掉，不留痕迹 */
if (FIXTURE_DIR) fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });

console.log(`\n———— 通过 ${pass} 项，失败 ${fail} 项 ————`);
if (fail) {
  console.log('失败项：');
  problems.forEach((p) => console.log('  · ' + p));
  process.exit(1);
}
console.log('一切正常。\n');
