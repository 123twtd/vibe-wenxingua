/**
 * 问心卦 · 卦录渲染
 * ------------------------------------------------------------
 * 把一条卦录输出为 Markdown（归档、备份、贴回对话都方便），
 * 以及一纸「卦签」纯文本（打印或抄写用）。
 * 两种占法各有各的版式：梅花走六爻／体用，小六壬走三宫／六神——不混排。
 */

import { isXlrChart, XLR_LABELS } from './xiaoliuren.mjs';

const LIUYAO_LABEL = ['上', '五', '四', '三', '二', '初'];

/** 六爻图：自下而上，阳爻 ━━━，阴爻 ━ ━；动爻加 ◉ */
export function drawLines(lines, movingPosition) {
  const rows = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const pos = i + 1;
    const bar = lines[i] ? '━━━━━━━━━' : '━━━━　━━━━';
    const mark = movingPosition === pos ? ' ◉ 动' : '';
    const yang = lines[i] ? '九' : '六';
    const title = pos === 1 ? `初${yang}` : pos === 6 ? `上${yang}` : `${yang}${['', '初', '二', '三', '四', '五', '上'][pos]}`;
    rows.push(`${LIUYAO_LABEL[5 - i]}　${bar}　${title}${mark}`);
  }
  return rows.join('\n');
}

function fmtTime(rec) {
  const c = rec.chart?.calendar;
  if (!c) return rec.cast?.localTime || '';
  const parts = [`阳历 ${c.dateTime}`];
  if (c.placeName) parts.push(`地点 ${c.placeName}（东经 ${c.longitude}°）`);
  parts.push(`真太阳时 ${c.trueSolarTime}（经度差 ${c.longitudeMinutes} 分 + 均时差 ${c.equationMinutes} 分）`);
  parts.push(`钟表时辰 ${c.clockHourZhi}时（数 ${c.clockHourNumber}）／真太阳时辰 ${c.trueHourZhi}时（数 ${c.trueHourNumber}）`);
  parts.push(`四柱参考：${c.yearGanZhi}年 ${c.monthZhi}月（${c.jie}后） ${c.dayGanZhi}日`);
  parts.push(`节气 ${c.term}`);
  return parts.join('\n> - ');
}

/** 卦录 → Markdown */
export function toMarkdown(rec) {
  if (isXlrChart(rec.chart)) return xlrMarkdown(rec);
  const c = rec.chart;
  const r = rec.reading;
  const L = [];
  L.push(`# ${rec.title}`);
  L.push('');
  L.push(`> **卦录编号**　${rec.id}`);
  L.push(`> **类别**　${rec.category}`);
  L.push(`> **起卦时间**`);
  L.push(`> - ${fmtTime(rec)}`);
  L.push(`> **起卦之法**　${methodLabel(rec.cast?.method)}${rec.cast?.numbers?.length ? `（报数 ${rec.cast.numbers.join(' / ')}）` : ''}`);
  L.push('');
  if (rec.question) {
    L.push('## 所问之事');
    L.push('');
    L.push(rec.question);
    L.push('');
  }

  L.push('## 起卦推演');
  L.push('');
  for (const s of c?.casting?.steps || []) L.push(`- ${s}`);
  L.push('');

  L.push('## 卦象');
  L.push('');
  L.push('| 位 | 卦 | 象 | 卦德 | 吉凶 |');
  L.push('|---|---|---|---|---|');
  L.push(`| 本卦 | ${c.ben.fullName} | ${c.ben.symbol} | ${c.ben.coreMeaning || ''} | ${c.ben.fortune || ''} |`);
  L.push(`| 互卦 | ${c.hu.fullName} | ${c.hu.symbol} | ${c.hu.coreMeaning || ''} | ${c.hu.fortune || ''} |`);
  L.push(`| 变卦 | ${c.bian.fullName} | ${c.bian.symbol} | ${c.bian.coreMeaning || ''} | ${c.bian.fortune || ''} |`);
  L.push('');
  L.push('```');
  L.push(drawLines(c.lines, c.moving.position));
  L.push('```');
  L.push('');
  L.push(`**体用**　体卦 ${c.tiyong.ti.name}${c.tiyong.ti.symbol}（${c.tiyong.ti.element}，${c.tiyong.ti.position}）；` +
    `用卦 ${c.tiyong.yong.name}${c.tiyong.yong.symbol}（${c.tiyong.yong.element}，${c.tiyong.yong.position}）；` +
    `**${c.tiyong.relation.label}**（${c.tiyong.relation.detail}）`);
  L.push('');
  L.push(`**月令旺衰**　体${c.tiyong.wang.ti.element}为「${c.tiyong.wang.ti.state}」，用${c.tiyong.wang.yong.element}为「${c.tiyong.wang.yong.state}」（${c.tiyong.wang.ti.season}）`);
  L.push('');
  L.push(`**变卦对体**　${c.tiyong.bianRelation.label}　|　**互卦对体**　${c.tiyong.huRelation.label}`);
  L.push('');
  L.push(`**总评**　${c.score.grade.label}（${c.score.total}）——${c.score.grade.desc}`);
  L.push('');

  L.push('## 卦象定调');
  L.push('');
  L.push(`> **谶**　${r.signature}`);
  L.push('');
  for (const t of r.tone) {
    L.push(`【${t.label}】${t.text}`);
    L.push('');
  }

  L.push('## 通俗解');
  L.push('');
  L.push(`**一句话**　${r.plain.oneLine}`);
  L.push('');
  L.push(`**要旨**　${r.plain.focus}`);
  L.push('');
  L.push('**为什么这样说**');
  L.push('');
  r.plain.why.forEach((w) => L.push(`- ${w}`));
  L.push('');
  L.push('**怎么做**');
  L.push('');
  r.plain.how.forEach((w) => L.push(`- ${w}`));
  L.push('');

  const cls = r.classical || {};
  const anyClassic = cls.guaci || cls.xiang || cls.yaoci || cls.huXiang || cls.bianXiang;
  if (anyClassic) {
    L.push('## 古辞佐证');
    L.push('');
    for (const k of ['guaci', 'xiang', 'yaoci', 'huXiang', 'bianXiang']) {
      if (cls[k]) L.push(`- 「${cls[k].text}」　　<span>${cls[k].source}</span>`);
    }
    L.push('');
  }

  if (rec.corrections?.length) {
    L.push('## 校勘');
    L.push('');
    L.push('> 以下为当初口头解读与本程序依正法重算之差异，一并存录。');
    L.push('');
    for (const x of rec.corrections) {
      L.push(`- **${x.label}**：原述「${x.stated}」→ 正法「${x.computed}」。${x.note}`);
    }
    L.push('');
  }

  if (rec.narrative) {
    L.push('## 原文存录');
    L.push('');
    L.push(rec.narrative);
    L.push('');
  }

  L.push('## 复盘');
  L.push('');
  L.push(`- **状态**　${rec.review.status}`);
  if (rec.review.result) L.push(`- **实况**　${rec.review.result}`);
  if (rec.review.reviewedAt) L.push(`- **复盘时间**　${rec.review.reviewedAt}`);
  for (const e of rec.review.log || []) {
    L.push(`- ${e.at || ''}　${e.text || ''}`);
  }
  L.push('');
  L.push('---');
  L.push('');
  L.push(`*问心卦 · 卦录 ${rec.id} · 录于 ${rec.createdAt} · 卦象仅供参考，决断在己。*`);
  return L.join('\n');
}

/** 小六壬卦录 → Markdown（三宫版式，不掺六爻／体用） */
function xlrMarkdown(rec) {
  const c = rec.chart;
  const r = rec.reading;
  const L = [];
  L.push(`# ${rec.title}`);
  L.push('');
  L.push(`> **卦录编号**　${rec.id}`);
  L.push(`> **占法**　${methodLabel(rec.cast?.method)}`);
  L.push(`> **类别**　${rec.category}`);
  L.push(`> **起课时间**`);
  L.push(`> - ${fmtTime(rec)}`);
  if (c.lunar) {
    L.push(`> **农历**　${c.lunar.year}年${c.lunar.monthName}${c.lunar.dayName}${c.lunar.isLeap ? '（闰月，起课按本月计）' : ''}`);
  }
  L.push('');
  if (rec.question) {
    L.push('## 所问之事');
    L.push('');
    L.push(rec.question);
    L.push('');
  }

  L.push('## 起课推演');
  L.push('');
  for (const s of c?.casting?.steps || []) L.push(`- ${s}`);
  L.push('');

  L.push('## 三宫');
  L.push('');
  L.push('| 位阶 | 宫 | 六神 | 五行 | 方位 | 神数 | 吉凶 |');
  L.push('|---|---|---|---|---|---|---|');
  for (const p of c?.palaces || []) {
    const isResult = p.index === (c?.palaces || []).length;
    L.push(`| ${p.role}${isResult ? '（结果宫）' : ''} | ${p.name} | ${p.deity} | ${p.element} | ${p.direction} | ${p.spiritText} | ${p.grade?.label || ''} |`);
  }
  L.push('');
  if (c?.result) {
    L.push(`**末宫为主**　${c.result.name}（${c.result.deity}·${c.result.element}·${c.result.direction}）——${c.result.grade?.label || ''}：${c.result.grade?.desc || ''}`);
    L.push('');
    L.push(`**断辞**　「${c.result.koujue}」`);
    L.push('');
  }

  L.push('## 断课定调');
  L.push('');
  L.push(`> **谶**　${r.signature}`);
  L.push('');
  for (const t of r.tone) {
    L.push(`【${t.label}】${t.text}`);
    L.push('');
  }

  L.push('## 通俗解');
  L.push('');
  L.push(`**一句话**　${r.plain.oneLine}`);
  L.push('');
  L.push(`**要旨**　${r.plain.focus}`);
  L.push('');
  L.push('**为什么这样说**');
  L.push('');
  r.plain.why.forEach((w) => L.push(`- ${w}`));
  L.push('');
  L.push('**怎么做**');
  L.push('');
  r.plain.how.forEach((w) => L.push(`- ${w}`));
  L.push('');

  if (rec.corrections?.length) {
    L.push('## 校勘');
    L.push('');
    L.push('> 以下为当初所述与本程序依正法重算之差异，一并存录。');
    L.push('');
    for (const x of rec.corrections) {
      L.push(`- **${x.label}**：原述「${x.stated}」→ 正法「${x.computed}」。${x.note}`);
    }
    L.push('');
  }

  if (rec.narrative) {
    L.push('## 原文存录');
    L.push('');
    L.push(rec.narrative);
    L.push('');
  }

  L.push('## 复盘');
  L.push('');
  L.push(`- **状态**　${rec.review.status}`);
  if (rec.review.result) L.push(`- **实况**　${rec.review.result}`);
  if (rec.review.reviewedAt) L.push(`- **复盘时间**　${rec.review.reviewedAt}`);
  for (const e of rec.review.log || []) {
    L.push(`- ${e.at || ''}　${e.text || ''}`);
  }
  L.push('');
  L.push('---');
  L.push('');
  L.push(`*问心卦 · 卦录 ${rec.id} · 录于 ${rec.createdAt} · 小六壬之课仅供参考，决断在己。*`);
  return L.join('\n');
}

/** 卦录 → 卦签（纯文本，便于打印或抄写） */
export function toSlip(rec) {
  if (isXlrChart(rec.chart)) return xlrSlip(rec);
  const c = rec.chart;
  const r = rec.reading;
  const pad = (s, n) => s + '　'.repeat(Math.max(0, n - [...s].length));
  const L = [];
  L.push('　　　　　问　心　卦　签');
  L.push('');
  L.push(`　${pad(rec.id, 32)}${rec.category}`);
  L.push(`　所问：${rec.question || rec.title}`);
  L.push('');
  L.push('　' + '─'.repeat(34));
  L.push(drawLines(c.lines, c.moving.position).split('\n').map((s) => '　' + s).join('\n'));
  L.push('　' + '─'.repeat(34));
  L.push(`　本卦　${c.ben.fullName}${c.ben.symbol}　　${c.ben.coreMeaning || ''}`);
  L.push(`　互卦　${c.hu.fullName}${c.hu.symbol}　　变卦　${c.bian.fullName}${c.bian.symbol}`);
  L.push(`　体用　体${c.tiyong.ti.name}${c.tiyong.ti.element}　用${c.tiyong.yong.name}${c.tiyong.yong.element}　${c.tiyong.relation.label}`);
  L.push(`　断　　${c.score.grade.label}　—— ${c.score.grade.desc}`);
  L.push('');
  L.push(`　谶曰：${r.signature}`);
  L.push('');
  for (const t of r.tone) {
    if (t.key === 'yi' || t.key === 'ji') continue;
    L.push(`　【${t.label}】${wrap(t.text, 30, '　　')}`);
    L.push('');
  }
  L.push(`　【宜】${wrap(r.tone.find((t) => t.key === 'yi')?.text || '', 30, '　　')}`);
  L.push(`　【忌】${wrap(r.tone.find((t) => t.key === 'ji')?.text || '', 30, '　　')}`);
  L.push('');
  L.push('　' + '─'.repeat(34));
  L.push(`　录于 ${rec.cast?.localTime || ''}　${rec.chart?.calendar?.placeName || ''}`);
  return L.join('\n');
}

/** 小六壬卦录 → 卦签 */
function xlrSlip(rec) {
  const c = rec.chart;
  const r = rec.reading;
  const pad = (s, n) => s + '　'.repeat(Math.max(0, n - [...s].length));
  const L = [];
  L.push('　　　　　问　心　卦　签');
  L.push('');
  L.push(`　${pad(rec.id, 32)}${rec.category}`);
  L.push(`　所问：${rec.question || rec.title}`);
  L.push('');
  L.push('　' + '─'.repeat(34));
  L.push(`　占法　小六壬 · ${c?.casting?.kind === 'time' ? '月日时辰起课' : '报数起课'}`);
  L.push(`　三宫　${c?.chainText || ''}`);
  L.push(`　末宫　${c?.result?.name || ''}（${c?.result?.deity || ''}·${c?.result?.element || ''}·${c?.result?.direction || ''}）`);
  L.push(`　断　　${c?.result?.grade?.label || ''}　—— ${c?.result?.grade?.desc || ''}`);
  L.push('　' + '─'.repeat(34));
  L.push('');
  L.push(`　谶曰：${r.signature}`);
  L.push('');
  for (const t of r.tone) {
    if (t.key === 'yi' || t.key === 'ji') continue;
    L.push(`　【${t.label}】${wrap(t.text, 30, '　　')}`);
    L.push('');
  }
  L.push(`　【宜】${wrap(r.tone.find((t) => t.key === 'yi')?.text || '', 30, '　　')}`);
  L.push(`　【忌】${wrap(r.tone.find((t) => t.key === 'ji')?.text || '', 30, '　　')}`);
  L.push('');
  L.push('　' + '─'.repeat(34));
  L.push(`　录于 ${rec.cast?.localTime || ''}　${rec.chart?.calendar?.placeName || ''}`);
  return L.join('\n');
}

function wrap(text, width, indent) {
  const out = [];
  let line = '';
  for (const ch of String(text)) {
    line += ch;
    if ([...line].length >= width || ch === '。') {
      out.push(line);
      line = '';
    }
  }
  if (line) out.push(line);
  return out.join(`\n${indent}`);
}

export function methodLabel(method) {
  return {
    numberAndTime: '一数 + 时辰',
    twoNumbers: '两数起卦',
    timeOnly: '年月日时起卦',
    manual: '指定本卦与动爻',
    ...XLR_LABELS,
  }[method] || method || '';
}

/** 多条卦录 → 一份总览 Markdown */
export function toIndexMarkdown(records) {
  const L = ['# 问心卦 · 卦录总览', '', `> 共 ${records.length} 条`, ''];
  L.push('| 编号 | 起卦时间 | 方法 | 类别 | 卦象 | 互卦 | 变卦 | 体用／末宫 | 总评 | 所问 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of records) {
    const c = r.chart || {};
    const xlr = isXlrChart(c);
    L.push(
      `| ${r.id} | ${r.cast?.localTime || ''} | ${methodLabel(r.cast?.method)} | ${r.category} | ` +
      `${xlr ? (c.chainText || '') : `${c.ben?.fullName || ''}${c.ben?.symbol || ''}`} | ` +
      `${xlr ? '—' : (c.hu?.fullName || '')} | ${xlr ? '—' : (c.bian?.fullName || '')} | ` +
      `${xlr ? (c.result ? `${c.result.name}·${c.result.grade?.label || ''}` : '') : (c.tiyong ? `${c.tiyong.ti.name}${c.tiyong.ti.element}／${c.tiyong.yong.name}${c.tiyong.yong.element}·${c.tiyong.relation.label}` : '')} | ` +
      `${r.reading?.grade?.label || ''} | ${(r.title || '').replace(/\|/g, '｜')} |`,
    );
  }
  L.push('');
  return L.join('\n');
}
