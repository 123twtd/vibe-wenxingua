/** 负向测试：校验器必须抓得出错 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 合成示例卦录：负向用例拿它当基样，不再读作者私人的 data/records/（不随仓库发布） */
const { sampleRecords } = await import('./fixtures.mjs');
const tmp = path.join(ROOT, 'data', 'trash', '_negtest');
fs.mkdirSync(tmp, { recursive: true });

const cases = [];

// 1) 卦条：认不出的键名 + 缺时间
const f1 = path.join(tmp, 'bad1.txt');
fs.writeFileSync(f1, '# 卦条 v1\n问: 试试\n本卦: 泽山咸\n动: 2\n摸鱼: 1\n', 'utf8');
cases.push(['卦条缺时间 + 认不出的键名', f1, true]);

// 2) 卦条：一切正常，应通过
const f2 = path.join(tmp, 'good.txt');
fs.writeFileSync(f2, '# 卦条 v1\n问: 正态测试\n类: 心态情绪\n时: 2026-10-07 09:00\n地: 兰州\n法: 一数一时辰\n数: 8\n动: 5\n', 'utf8');
cases.push(['卦条完整（应通过）', f2, false]);

// 3) 卦录 JSON：根级多了一个未知字段
const rec = sampleRecords()[0];
const bad3 = { ...rec, id: '202601010000-99', 手滑字段: 1 };
const f3 = path.join(tmp, 'bad3.json');
fs.writeFileSync(f3, JSON.stringify(bad3, null, 2), 'utf8');
cases.push(['卦录含未声明字段', f3, true]);

// 4) 卦录 JSON：七段顺序被打乱
const bad4 = JSON.parse(JSON.stringify(rec));
bad4.id = '202601010000-98';
bad4.reading.tone = [...bad4.reading.tone].reverse();
const f4 = path.join(tmp, 'bad4.json');
fs.writeFileSync(f4, JSON.stringify(bad4, null, 2), 'utf8');
cases.push(['断语七段顺序被打乱', f4, true]);

// 5) 卦录 JSON：动爻阴阳与六爻数据不一致
const bad5 = JSON.parse(JSON.stringify(rec));
bad5.id = '202601010000-97';
bad5.chart.moving.isYang = !bad5.chart.moving.isYang;
const f5 = path.join(tmp, 'bad5.json');
fs.writeFileSync(f5, JSON.stringify(bad5, null, 2), 'utf8');
cases.push(['动爻阴阳与六爻不一致', f5, true]);

// 6) 卦录 JSON：类别不在枚举里
const bad6 = JSON.parse(JSON.stringify(rec));
bad6.id = '202601010000-96';
bad6.category = '随便一类';
const f6 = path.join(tmp, 'bad6.json');
fs.writeFileSync(f6, JSON.stringify(bad6, null, 2), 'utf8');
cases.push(['类别不在枚举里', f6, true]);

// —— 小六壬记录（另一种占法）的负向用例 ——
const xlrRec = sampleRecords().find((r) => r.chart?.kind === 'xlr');

// 7) 小六壬断课段顺序被打乱（宫位段与断宜忌应期错位）
const bad7 = JSON.parse(JSON.stringify(xlrRec));
bad7.id = '202601010000-95';
bad7.reading.tone = [...bad7.reading.tone].reverse();
const f7 = path.join(tmp, 'bad7.json');
fs.writeFileSync(f7, JSON.stringify(bad7, null, 2), 'utf8');
cases.push(['小六壬断课段顺序被打乱', f7, true]);

// 8) 小六壬三宫少一项（与起课方式对不上）
const bad8 = JSON.parse(JSON.stringify(xlrRec));
bad8.id = '202601010000-94';
bad8.chart.palaces = bad8.chart.palaces.slice(0, 2);
const f8 = path.join(tmp, 'bad8.json');
fs.writeFileSync(f8, JSON.stringify(bad8, null, 2), 'utf8');
cases.push(['小六壬三宫数与起课方式不符', f8, true]);

// 9) 小六壬删掉结果宫（schema 的 oneOf 两支都不再满足）
const bad9 = JSON.parse(JSON.stringify(xlrRec));
bad9.id = '202601010000-93';
delete bad9.chart.result;
const f9 = path.join(tmp, 'bad9.json');
fs.writeFileSync(f9, JSON.stringify(bad9, null, 2), 'utf8');
cases.push(['小六壬缺结果宫', f9, true]);

// 10) 小六壬宫位段用了梅花的说法（术语混用）
const bad10 = JSON.parse(JSON.stringify(xlrRec));
bad10.id = '202601010000-92';
bad10.reading.tone[0] = { ...bad10.reading.tone[0], key: 'main', label: '主' };
const f10 = path.join(tmp, 'bad10.json');
fs.writeFileSync(f10, JSON.stringify(bad10, null, 2), 'utf8');
cases.push(['小六壬宫位段混入梅花术语文案', f10, true]);

let pass = 0;
let fail = 0;
for (const [label, file, shouldFail] of cases) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/validate.mjs'), file], { encoding: 'utf8' });
  const failed = r.status !== 0;
  const ok = failed === shouldFail;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}　期望${shouldFail ? '失败' : '通过'}，实际${failed ? '失败' : '通过'}`);
  if (!ok) {
    console.log(`      ${(r.stdout || r.stderr || '').split('\n').filter((l) => l.includes('·')).slice(0, 3).join('\n      ')}`);
    fail += 1;
  } else {
    pass += 1;
    const msg = (r.stdout || '').split('\n').filter((l) => l.includes('·')).slice(0, 1)[0];
    if (msg) console.log(`      ${msg.trim()}`);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n  通过 ${pass}，失败 ${fail}（目录已清理）`);
process.exit(fail ? 1 : 0);
