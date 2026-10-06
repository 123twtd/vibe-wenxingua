/** 问心卦 · 前端小工具与接口封装 */

async function handle(res) {
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { ok: res.ok, raw: text }; }
  if (!res.ok || data.ok === false) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

const j = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
});

export const api = {
  get: (p) => fetch(p).then(handle),
  post: (p, b) => fetch(p, j(b)).then(handle),
  patch: (p, b) => fetch(p, { ...j(b), method: 'PATCH' }).then(handle),
  del: (p) => fetch(p, { method: 'DELETE' }).then(handle),
};

export const h = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export const attr = (s) => h(s).replace(/'/g, '&#39;');

export function toast(msg, ms = 2200) {
  document.querySelectorAll('.toast').forEach((n) => n.remove());
  const n = document.createElement('div');
  n.className = 'toast';
  n.textContent = msg;
  document.body.appendChild(n);
  setTimeout(() => n.remove(), ms);
}

export function modal(html, onMount) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal">${html}</div>`;
  mask.addEventListener('click', (e) => { if (e.target === mask) mask.remove(); });
  document.body.appendChild(mask);
  onMount?.(mask.querySelector('.modal'), () => mask.remove());
  return mask;
}

export function debounce(fn, ms = 320) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const GRADE_TONE = { 大吉: 'good', 吉: 'good', 中吉: 'good', 平: 'neutral', 小凶: 'warn', 凶: 'bad' };

export function gradeTag(grade) {
  if (!grade) return '';
  const tone = grade.tone || GRADE_TONE[grade.label] || 'neutral';
  return `<span class="tag ${tone}">${h(grade.label)}</span>`;
}

export function fmtLocal(t) {
  if (!t) return '';
  const m = String(t).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return h(t);
  return `${m[1]}.${Number(m[2])}.${Number(m[3])} ${m[4]}:${m[5]}`;
}

export function fmtFull(t) {
  if (!t) return '';
  const m = String(t).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return h(t);
  return `${m[1]} 年 ${Number(m[2])} 月 ${Number(m[3])} 日 ${m[4]}:${m[5]}`;
}

/** 'YYYY-MM-DD HH:mm' → datetime-local 值 */
export function toLocalInput(t) {
  const m = String(t || '').match(/(\d{4})\D(\d{1,2})\D(\d{1,2})\D(\d{1,2})\D(\d{2})/);
  if (!m) return '';
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}T${String(m[4]).padStart(2, '0')}:${m[5]}`;
}

/** datetime-local 值 → 'YYYY-MM-DD HH:mm' */
export function fromLocalInput(v) {
  return String(v || '').replace('T', ' ');
}

export function nowLocalInput() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------- 卦象可视化 ---------- */

/** 六爻图（自下而上），标出体卦／用卦所属三爻与动爻 */
export function liuyaoHtml(chart) {
  const { lines, moving, tiyong, ben } = chart;
  const tiRange = tiyong.tiRange || [];
  const yongRange = tiyong.yongRange || [];
  const rows = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const pos = i + 1;
    const isYang = lines[i] === 1;
    const isMoving = moving.position === pos;
    const isTi = tiRange.includes(pos);
    const isYong = yongRange.includes(pos);
    const cls = ['row'];
    if (isMoving) cls.push('moving');
    if (isTi) cls.push('ti');
    if (isYong) cls.push('yong');
    const yaoName = isYang ? '九' : '六';
    const title = pos === 1 ? `初${yaoName}` : pos === 6 ? `上${yaoName}` : `${yaoName}${['', '初', '二', '三', '四', '五', '上'][pos]}`;
    const marks = [];
    if (isTi) marks.push('<span class="mark ti">体</span>');
    if (isYong) marks.push('<span class="mark yong">用</span>');
    if (isMoving) marks.push('<span class="mark" style="color:var(--cinnabar-2)">◉动</span>');
    rows.push(
      `<div class="${cls.join(' ')}">` +
      `<div class="pos">${['初', '二', '三', '四', '五', '上'][pos - 1]}</div>` +
      `<div class="bar${isYang ? '' : ' break'}">${isYang ? '<i></i>' : '<i></i><i></i>'}</div>` +
      `<div class="t">${title}${marks.join('')}</div>` +
      '</div>',
    );
  }
  const yaoText = moving.yaoText
    ? `<div class="small gold" style="margin-top:12px;text-align:center">${h(moving.yaoTitle)}：「${h(String(moving.yaoText).replace(/^[^：]*：/, ''))}」</div>`
    : '';
  return `<div class="liuyao">${rows.join('')}</div>${yaoText}
    <div class="small dim" style="text-align:center;margin-top:8px">本卦 ${h(ben.fullName)}${h(ben.symbol)}　上${h(ben.upper)}　下${h(ben.lower)}</div>`;
}

/** 三卦一排 */
export function hexRowHtml(chart) {
  const cell = (role, hx) => `<div class="hex-box">
      <div class="role">${role}</div>
      <div class="sym">${h(hx.symbol || '')}</div>
      <div class="nm">${h(hx.fullName || '')}</div>
      <div class="mn">${h(hx.coreMeaning || '')}</div>
      <div class="ft">${h(hx.fortune || '')}</div>
    </div>`;
  return `<div class="hex-row">${cell('本卦', chart.ben)}${cell('互卦', chart.hu)}${cell('变卦', chart.bian)}</div>`;
}

/** 体用生克条 */
export function tiyongHtml(chart) {
  const t = chart.tiyong;
  const tone = t.relation.grade >= 2 ? 'good' : t.relation.grade >= 0 ? 'warn' : 'bad';
  const rel = relationGlyph(t.relation.key);
  return `<div class="tiyong-bar">
    <div class="cell"><div class="l">体 · 你（${h(t.ti.position)}）</div><div class="v">${h(t.ti.name)} ${h(t.ti.symbol)} ${h(t.ti.element)}</div></div>
    <div class="op rel">${h(rel)}</div>
    <div class="cell"><div class="l">用 · 事（${h(t.yong.position)}）</div><div class="v">${h(t.yong.name)} ${h(t.yong.symbol)} ${h(t.yong.element)}</div></div>
    <div class="op split">
      <span class="tag ${tone}">${h(t.relation.label)}</span>
      <span class="small dim">变卦对体 ${h(t.bianRelation.label)}　·　互卦对体 ${h(t.huRelation.label)}　·　体${h(t.wang.ti.element)}${h(t.wang.ti.state)}／用${h(t.wang.yong.element)}${h(t.wang.yong.state)}</span>
    </div>
  </div>`;
}

function relationGlyph(key) {
  return {
    ti_ke_yong: '体 ▸克▸ 用',
    yong_ke_ti: '用 ▸克▸ 体',
    yong_sheng_ti: '用 ▸生▸ 体',
    ti_sheng_yong: '体 ▸生▸ 用',
    bihe: '体 ≡ 用',
  }[key] || '体用未明';
}

/* ---------- 小六壬（三宫版式，与梅花分区渲染） ---------- */

/** 占法徽章：列表与详情头都从这里取，别处不许靠 ben 是否为空去猜 */
export function methodBadge(item) {
  const isXlr = item?.kind === 'xlr' || /^xlr/.test(String(item?.method || ''));
  if (isXlr) return '<span class="tag xlr">道教小六壬</span>';
  if (item?.method !== undefined) return '<span class="tag meihua">梅花易数</span>';
  return '';
}

/** 三宫：月宫／日宫／时宫（或初宫／次宫／末宫），末宫高亮为结果宫 */
export function xlrPalacesHtml(chart) {
  const palaces = chart?.palaces || [];
  const last = palaces.length - 1;
  const cell = (p, i) => `<div class="xlr-box${i === last ? ' result' : ''}">
      <div class="role">${h(p.role)}${i === last ? '　·　结果宫' : ''}</div>
      <div class="nm">${h(p.name)}</div>
      <div class="mn">${h(p.deity)}　${h(p.element)}　${h(p.direction)}　神数 ${h(p.spiritText)}</div>
      <div class="ft">${h(p.grade?.label || '')}</div>
      <div class="kj">${h(p.koujue || '')}</div>
    </div>`;
  return `<div class="xlr-row">${palaces.map(cell).join('')}</div>
    <div class="xlr-chain">三宫顺数　${h(chart?.chainText || '')}　·　以末宫 ${h(chart?.result?.name || '')} 为主断</div>`;
}

/** 小六壬的农历行（详情页与起卦台预览共用） */
export function xlrLunarHtml(chart) {
  const l = chart?.lunar;
  if (!l) return '<div class="small dim">此课按公历月日起课。</div>';
  return `<div class="small dim">农历　${h(l.year)}年${h(l.monthName)}${h(l.dayName)}${l.isLeap ? '（闰月按本月计）' : ''}</div>`;
}

/** 卦象区总调度：梅花走六爻／体用，小六壬走三宫——版式分开，术语才不混 */
export function chartHtml(chart) {
  if (!chart) return '';
  if (chart.kind === 'xlr' || /^xlr/.test(String(chart.method || ''))) return xlrPalacesHtml(chart);
  return `${hexRowHtml(chart)}<div class="hr"></div>${liuyaoHtml(chart)}${tiyongHtml(chart)}`;
}

/** 断语整块（定调 + 通俗 + 古辞） */
export function readingHtml(reading, opts = {}) {
  if (!reading) return '';
  const tone = reading.tone.map((t) => {
    const soft = t.key === 'yi' || t.key === 'ji';
    const warn = t.key === 'ji';
    return `<div class="tone-item${soft ? ' soft' : ''}${warn ? ' warn' : ''}">
      <div class="lb">${h(t.label)}</div><div class="tx">${h(t.text)}</div></div>`;
  }).join('');

  const why = reading.plain.why.filter(Boolean).map((w) => `<li>${h(w)}</li>`).join('');
  const how = reading.plain.how.filter(Boolean).map((w) => `<li>${h(w)}</li>`).join('');

  const cls = reading.classical || {};
  const classical = ['guaci', 'xiang', 'yaoci', 'huXiang', 'bianXiang']
    .map((k) => (cls[k] ? `<div class="classic"><div class="t">「${h(cls[k].text)}」</div><span class="s">${h(cls[k].source)}</span></div>` : ''))
    .join('');

  return `
    <div class="sig">${h(reading.signature)}</div>
    <div class="card" style="margin-top:18px">
      <div class="card-title">${opts.toneTitle || '卦 象 定 调'}</div>
      ${tone}
    </div>
    <div class="card">
      <div class="card-title">通 俗 解</div>
      <div class="plain-box">
        <div class="one">${h(reading.plain.oneLine)}</div>
        <div class="lbl2">要 旨</div>
        <div class="muted small">${h(reading.plain.focus)}</div>
        <div class="lbl2">为 什 么 这 样 说</div>
        <ul>${why}</ul>
        <div class="lbl2">怎 么 做</div>
        <ul>${how}</ul>
      </div>
    </div>
    ${classical ? `<div class="card"><div class="card-title">古 辞 佐 证</div>${classical}</div>` : ''}
    ${opts.score === false ? '' : scoreHtml(opts.chart)}
  `;
}

function scoreHtml(chart) {
  if (!chart?.score) return '';
  const rows = chart.score.breakdown.map((b) => {
    const pos = (b.pct ?? 0) >= 0;
    const w = Math.min(100, Math.abs(b.pct ?? 0));
    const sign = pos ? '+' : '';
    return `<div class="bar-row">
      <div class="bl">${h(b.label)}<span class="dim" style="font-size:11px"> ×${b.weight ?? ''}</span></div>
      <div class="bt"><i style="width:${Math.max(4, w)}%;background:${pos ? 'linear-gradient(90deg,#8b6f22,var(--gold-2))' : 'linear-gradient(90deg,#7d2a20,var(--cinnabar-2))'}"></i></div>
      <div class="bv">${sign}${Math.round(b.value * 100) / 100}</div>
      <div class="bl small dim" style="grid-column:2/4;margin-top:-4px">${h(b.note)}</div>
    </div>`;
  }).join('');
  return `<div class="card"><div class="card-title">吉 凶 权 衡</div>
    <div class="muted small" style="margin-bottom:10px">总评 <b class="gold">${h(chart.score.grade.label)}</b>（${chart.score.total}）—— ${h(chart.score.grade.desc)}
      <span class="dim">　各项已归一到 −100 ~ +100，再按权重加权平均。</span></div>
    ${rows}</div>`;
}

/** 时间与历法信息 */
export function calendarHtml(cal) {
  if (!cal) return '';
  const rows = [
    ['钟表时间', cal.dateTime],
    ['地点', `${cal.placeName || '未记'}`],
    ['经度', `${cal.longitude}° 东经`],
    ['真太阳时', `${cal.trueSolarTime}`],
    ['经度时差', `${cal.longitudeMinutes} 分`],
    ['均时差', `${cal.equationMinutes} 分`],
    ['合计修正', `${cal.offsetMinutes} 分`],
    ['钟表时辰', `${cal.clockHourZhi}时（取数 ${cal.clockHourNumber}）`],
    ['真太阳时辰', `${cal.trueHourZhi}时（取数 ${cal.trueHourNumber}）`],
    ['四柱参考', `${cal.yearGanZhi}年　${cal.monthZhi}月（${cal.jie}后）　${cal.dayGanZhi}日`],
    ['节气', `${cal.term}　下一个节：${cal.nextJie}`],
  ];
  return `<dl class="kv">${rows.map(([k, v]) => `<dt>${h(k)}</dt><dd>${h(v)}</dd>`).join('')}</dl>`;
}

export { renderMarkdown } from './md.js';
