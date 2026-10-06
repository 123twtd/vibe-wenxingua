/**
 * 插件：单卦 HTML 卡片（html-card）
 * ------------------------------------------------------------
 * 演示 ctx.registerExporter——给卦录加一种全新的导出格式。
 * 加了之后，卦录详情页的「导出」链接即可用 ?format=html-card，
 * 得到一份**自带样式、可离线打开、可直接发给别人**的单文件 HTML。
 *
 * 这份 HTML 不依赖本程序、不依赖网络（字体走系统字体栈），
 * 存十年也还能打开——作为「卦录要陪几十年」这一取向的兜底。
 */

const ESC = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 六爻图（HTML 版） */
function liuyaoHtml(chart) {
  const { lines, moving, tiyong } = chart;
  const rows = [];
  for (let i = 6; i >= 1; i -= 1) {
    const isYang = lines[i - 1] === 1;
    const isMoving = moving.position === i;
    const isTi = (tiyong.tiRange || []).includes(i);
    const isYong = (tiyong.yongRange || []).includes(i);
    const name = i === 1 ? `初${isYang ? '九' : '六'}` : i === 6 ? `上${isYang ? '九' : '六'}` : `${isYang ? '九' : '六'}${['', '初', '二', '三', '四', '五', '上'][i]}`;
    const bar = isYang
      ? '<i style="flex:1"></i>'
      : '<i style="flex:1"></i><i style="flex:1"></i>';
    const cls = [isMoving ? 'mv' : '', isTi ? 'ti' : '', isYong ? 'yg' : ''].filter(Boolean).join(' ');
    const mark = [isTi ? '<b class="ti">体</b>' : '', isYong ? '<b class="yg">用</b>' : '', isMoving ? '<b class="mv">◉动</b>' : ''].join('');
    rows.push(`<div class="ly ${cls}"><span class="pos">${['初', '二', '三', '四', '五', '上'][i - 1]}</span>`
      + `<span class="bar">${bar}</span><span class="nm">${name}${mark}</span></div>`);
  }
  return rows.join('');
}

function hexBox(role, hx) {
  return `<div class="box"><div class="role">${role}</div><div class="sym">${ESC(hx.symbol)}</div>
    <div class="nm">${ESC(hx.fullName)}</div><div class="mn">${ESC(hx.coreMeaning || '')}</div>
    <div class="ft">${ESC(hx.fortune || '')}</div></div>`;
}

const REL_GLYPH = {
  ti_ke_yong: '体 ▸克▸ 用', yong_ke_ti: '用 ▸克▸ 体', yong_sheng_ti: '用 ▸生▸ 体',
  ti_sheng_yong: '体 ▸生▸ 用', bihe: '体 ≡ 用',
};

/**
 * 小六壬卦录的离线卡片：三宫版式。
 * 小六壬的 chart 里没有六爻与体用——直接取那些字段会抛，所以单独走这一路；
 * 版式与梅花的卡片同气（同一套色），但内容只讲六宫、六神与末宫断辞。
 */
function buildXlrHtml(rec) {
  const c = rec.chart;
  const r = rec.reading;
  const cal = c.calendar || {};
  const tone = (r?.tone || []).map((x) => `<div class="tone${x.key === 'ji' ? ' warn' : ''}">
      <div class="lb">${ESC(x.label)}</div><div class="tx">${ESC(x.text)}</div></div>`).join('');
  const plain = r?.plain ? `
    <section><h2>通 俗 解</h2>
      <p class="one">${ESC(r.plain.oneLine)}</p>
      <p class="lbl">要旨</p><p>${ESC(r.plain.focus)}</p>
      <p class="lbl">为什么这样说</p><ul>${r.plain.why.map((w) => `<li>${ESC(w)}</li>`).join('')}</ul>
      <p class="lbl">怎么做</p><ul>${r.plain.how.map((w) => `<li>${ESC(w)}</li>`).join('')}</ul>
    </section>` : '';
  const review = (rec.review?.result || rec.review?.log?.length) ? `
    <section><h2>复 盘</h2>
      <p>状态：<b>${ESC(rec.review.status)}</b>${rec.review.reviewedAt ? `　复盘于 ${ESC(rec.review.reviewedAt)}` : ''}</p>
      ${rec.review.result ? `<p>${ESC(rec.review.result)}</p>` : ''}
      ${(rec.review.log || []).map((e) => `<blockquote>${ESC(e.text)}<cite>${ESC(e.at || '')}</cite></blockquote>`).join('')}
    </section>` : '';
  const palaces = (c.palaces || []).map((p, i, arr) => `<div class="pal${i === arr.length - 1 ? ' last' : ''}">
      <div class="role">${ESC(p.role)}${i === arr.length - 1 ? '　结果宫' : ''}</div>
      <div class="nm">${ESC(p.name)}</div>
      <div class="mn">${ESC(p.deity)}　${ESC(p.element)}　${ESC(p.direction)}　神数 ${ESC(p.spiritText)}</div>
      <div class="ft">${ESC(p.grade?.label || '')}</div>
      <div class="kj">${ESC(p.koujue)}</div></div>`).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${ESC(rec.title)} · 问心卦（小六壬）</title>
<style>
:root{--ink:#0b0e13;--card:#161c26;--gold:#c9a227;--gold2:#e8c86a;--gold3:#f6e3a8;
--red:#d8604a;--az:#5b8cc7;--tx:#e9e3d6;--tx2:#a79e8d;--tx3:#6f6759;--ln:#2a3341}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--ink);background-image:radial-gradient(1100px 600px at 12% -8%,rgba(201,162,39,.07),transparent 62%);
color:var(--tx);font-family:"Noto Serif SC","Source Han Serif SC","Songti SC",SimSun,Georgia,serif;
font-size:15px;line-height:1.9;padding:34px 18px 70px}
.wrap{max-width:760px;margin:0 auto}
h1{font-size:26px;letter-spacing:4px;color:var(--gold3);font-weight:500;line-height:1.5}
.sub{color:var(--tx2);font-size:13px;margin-top:8px;letter-spacing:.6px}
section{background:linear-gradient(158deg,var(--card),#11151d);border:1px solid var(--ln);
border-radius:14px;padding:22px 24px;margin-top:18px}
h2{font-size:15px;letter-spacing:3px;color:var(--gold2);font-weight:500;margin-bottom:14px}
h2::before{content:"◆";font-size:8px;color:var(--gold);margin-right:9px;vertical-align:2px}
.sig{font-size:19px;letter-spacing:5px;color:var(--gold3);text-align:center;padding:24px 18px;line-height:2.1;
background:linear-gradient(150deg,rgba(201,162,39,.1),rgba(178,58,44,.05));border:1px solid rgba(201,162,39,.28);
border-radius:14px;margin-top:18px;text-shadow:0 0 24px rgba(201,162,39,.28)}
.sig::before{content:"谶";display:block;font-size:11px;letter-spacing:6px;color:var(--gold);margin-bottom:8px}
.palrow{display:flex;gap:14px;flex-wrap:wrap}
.pal{flex:1 1 190px;padding:15px 16px;border:1px solid #364152;border-radius:12px;
background:linear-gradient(160deg,rgba(201,162,39,.06),transparent)}
.pal.last{border-color:rgba(201,162,39,.45);box-shadow:0 0 22px rgba(201,162,39,.12)}
.pal .role{font-size:11px;letter-spacing:3.4px;color:var(--gold)}
.pal .nm{font-size:24px;letter-spacing:4px;color:var(--gold3);margin:4px 0 2px}
.pal .mn{font-size:12px;color:var(--tx2)}
.pal .ft{font-size:12px;color:var(--az);margin-top:3px}
.pal .kj{font-size:12px;color:var(--tx3);margin-top:9px;border-top:1px dashed var(--ln);padding-top:8px}
.tone{display:grid;grid-template-columns:52px 1fr;gap:12px;padding:13px 0;border-bottom:1px dashed var(--ln)}
.tone:last-child{border-bottom:0}
.tone .lb{font-size:15px;letter-spacing:3px;color:var(--gold2);text-align:center;border-right:1px solid #364152;padding-right:8px}
.tone.warn .lb{color:var(--red)}
.tone .tx{color:#ded7c8;font-size:15px;line-height:2.05}
.one{font-size:15.5px;color:#dfe7f0}
.lbl{font-size:12px;letter-spacing:2.4px;color:var(--az);margin:14px 0 4px}
ul{margin-left:20px}li{color:var(--tx2);font-size:14px}
blockquote{padding:11px 14px;border-radius:0 10px 10px 0;background:rgba(201,162,39,.055);
border-left:3px solid var(--gold);margin-bottom:9px;color:#cfc5b0;font-size:14.5px}
blockquote cite{display:block;text-align:right;font-size:11.5px;color:var(--tx3);font-style:normal;margin-top:3px}
dl{display:grid;grid-template-columns:96px 1fr;gap:5px 12px;font-size:13.5px}
dt{color:var(--tx3)}dd{color:var(--tx)}
footer{text-align:center;margin-top:34px;font-size:11.5px;color:var(--tx3);letter-spacing:2px}
</style></head><body><div class="wrap">
<h1>${ESC(rec.title)}</h1>
<div class="sub">小六壬 · ${ESC(c.chainText || '')}　末宫 ${ESC(c.result?.name || '')}　${ESC(c.result?.grade?.label || '')}
　·　${ESC(rec.category)}　·　编号 ${ESC(rec.id)}<br>
起课 ${ESC(cal.dateTime || rec.cast?.localTime || '')}${c.lunar ? `　·　农历 ${ESC(c.lunar.year)}年${ESC(c.lunar.monthName)}${ESC(c.lunar.dayName)}` : ''}${cal.placeName ? `　·　${ESC(cal.placeName)}` : ''}
　·　真太阳时 ${ESC(cal.trueSolarTime || '')}　${ESC(cal.trueHourZhi || '')}时（取数 ${ESC(cal.trueHourNumber ?? '')}）</div>

${rec.question ? `<section><h2>所 问 之 事</h2><p>${ESC(rec.question)}</p></section>` : ''}

<section><h2>三 宫</h2><div class="palrow">${palaces}</div></section>

${r ? `<div class="sig">${ESC(r.signature)}</div>
<section><h2>断 课 定 调</h2>${tone}</section>
${plain}` : ''}
${review}

<section><h2>起 课 推 演 与 历 法</h2>
  <ol style="margin-left:20px;color:var(--tx2);font-size:13.5px">${(c.casting?.steps || []).map((s) => `<li>${ESC(s)}</li>`).join('')}</ol>
  <dl style="margin-top:14px">
    <dt>钟表时间</dt><dd>${ESC(cal.dateTime || '')}</dd>
    <dt>真太阳时</dt><dd>${ESC(cal.trueSolarTime || '')}　${ESC(cal.trueHourZhi || '')}时（取数 ${ESC(cal.trueHourNumber ?? '')}）</dd>
    <dt>农历</dt><dd>${ESC(c.lunar ? `${c.lunar.year}年${c.lunar.monthName}${c.lunar.dayName}${c.lunar.isLeap ? '（闰月按本月计）' : ''}` : '（按公历月日起课）')}</dd>
    <dt>总断</dt><dd>${ESC(r?.grade?.label || '')}— ${ESC(r?.grade?.desc || '')}</dd>
  </dl>
</section>

<footer>问心卦 · 卦录 ${ESC(rec.id)} · 录于 ${ESC(rec.createdAt)}<br>小六壬之课仅供参考，决断在己。</footer>
</div></body></html>`;
}

function buildHtml(rec, core) {
  const isXlr = core?.xiaoliuren?.isXlrChart ? core.xiaoliuren.isXlrChart(rec.chart) : rec.chart?.kind === 'xlr';
  if (isXlr) return buildXlrHtml(rec);
  const c = rec.chart;
  const r = rec.reading;
  const cal = c.calendar || {};
  const t = c.tiyong;

  const tone = (r?.tone || []).map((x) => `<div class="tone${x.key === 'ji' ? ' warn' : ''}">
      <div class="lb">${ESC(x.label)}</div><div class="tx">${ESC(x.text)}</div></div>`).join('');

  const plain = r?.plain ? `
    <section><h2>通 俗 解</h2>
      <div class="plain">
        <p class="one">${ESC(r.plain.oneLine)}</p>
        <p class="lbl">要旨</p><p>${ESC(r.plain.focus)}</p>
        <p class="lbl">为什么这样说</p><ul>${r.plain.why.map((w) => `<li>${ESC(w)}</li>`).join('')}</ul>
        <p class="lbl">怎么做</p><ul>${r.plain.how.map((w) => `<li>${ESC(w)}</li>`).join('')}</ul>
      </div></section>` : '';

  const cls = r?.classical || {};
  const classics = ['guaci', 'xiang', 'yaoci', 'huXiang', 'bianXiang']
    .filter((k) => cls[k])
    .map((k) => `<blockquote>「${ESC(cls[k].text)}」<cite>${ESC(cls[k].source)}</cite></blockquote>`).join('');

  const corrections = (rec.corrections || []).length ? `
    <section><h2>校 勘</h2>
      ${rec.corrections.map((x) => `<blockquote class="fix">${ESC(x.label)}：原述「${ESC(x.stated)}」→ 正法「${ESC(x.computed)}」<cite>${ESC(x.note)}</cite></blockquote>`).join('')}
    </section>` : '';

  const review = (rec.review?.result || rec.review?.log?.length) ? `
    <section><h2>复 盘</h2>
      <p>状态：<b>${ESC(rec.review.status)}</b>${rec.review.reviewedAt ? `　复盘于 ${ESC(rec.review.reviewedAt)}` : ''}</p>
      ${rec.review.result ? `<p>${ESC(rec.review.result)}</p>` : ''}
      ${(rec.review.log || []).map((e) => `<blockquote>${ESC(e.text)}<cite>${ESC(e.at || '')}</cite></blockquote>`).join('')}
    </section>` : '';

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${ESC(rec.title)} · 问心卦</title>
<style>
:root{--ink:#0b0e13;--card:#161c26;--gold:#c9a227;--gold2:#e8c86a;--gold3:#f6e3a8;
--red:#d8604a;--jade:#4f9d78;--az:#5b8cc7;--tx:#e9e3d6;--tx2:#a79e8d;--tx3:#6f6759;--ln:#2a3341}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--ink);background-image:radial-gradient(1100px 600px at 12% -8%,rgba(201,162,39,.07),transparent 62%);
color:var(--tx);font-family:"Noto Serif SC","Source Han Serif SC","Songti SC",SimSun,Georgia,serif;
font-size:15px;line-height:1.9;padding:34px 18px 70px}
.wrap{max-width:760px;margin:0 auto}
h1{font-size:26px;letter-spacing:4px;color:var(--gold3);font-weight:500;line-height:1.5}
.sub{color:var(--tx2);font-size:13px;margin-top:8px;letter-spacing:.6px}
section{background:linear-gradient(158deg,var(--card),#11151d);border:1px solid var(--ln);
border-radius:14px;padding:22px 24px;margin-top:18px}
h2{font-size:15px;letter-spacing:3px;color:var(--gold2);font-weight:500;margin-bottom:14px}
h2::before{content:"◆";font-size:8px;color:var(--gold);margin-right:9px;vertical-align:2px}
.sig{font-size:19px;letter-spacing:5px;color:var(--gold3);text-align:center;padding:24px 18px;line-height:2.1;
background:linear-gradient(150deg,rgba(201,162,39,.1),rgba(178,58,44,.05));border:1px solid rgba(201,162,39,.28);
border-radius:14px;margin-top:18px;text-shadow:0 0 24px rgba(201,162,39,.28)}
.sig::before{content:"谶";display:block;font-size:11px;letter-spacing:6px;color:var(--gold);margin-bottom:8px}
.hexrow{display:flex;gap:16px;flex-wrap:wrap}
.box{flex:1 1 150px;text-align:center;padding:16px 10px;border:1px solid #364152;border-radius:12px;
background:linear-gradient(160deg,rgba(201,162,39,.07),transparent)}
.box .role{font-size:11px;letter-spacing:3.4px;color:var(--gold)}
.box .sym{font-size:40px;line-height:1.25;color:var(--gold3)}
.box .nm{font-size:16px;letter-spacing:2.6px}
.box .mn{font-size:12px;color:var(--tx2);margin-top:5px}
.box .ft{font-size:11.5px;color:var(--tx3);margin-top:3px}
.ly{display:flex;align-items:center;gap:14px;justify-content:center;margin:7px 0}
.ly .pos{width:26px;text-align:right;font-size:12px;color:var(--tx3)}
.ly .bar{width:150px;display:flex;gap:11px}
.ly .bar i{display:block;height:11px;border-radius:2px;background:linear-gradient(90deg,var(--gold),#8b6f22)}
.ly.mv .bar i{background:linear-gradient(90deg,var(--red),#b23a2c);box-shadow:0 0 14px rgba(216,96,74,.5)}
.ly .nm{width:150px;font-size:12.5px;color:var(--tx2);text-align:left}
.ly .nm b{font-size:11px;font-weight:400;margin-left:5px}
.ly .nm b.ti{color:var(--gold2)}.ly .nm b.yg{color:var(--az)}.ly .nm b.mv{color:var(--red)}
.tiyong{display:grid;grid-template-columns:1fr auto 1fr;gap:10px 18px;align-items:center;margin-top:14px;
padding:15px 20px;border-radius:12px;background:rgba(201,162,39,.05);border:1px solid rgba(201,162,39,.18)}
.tiyong .cell{text-align:center}.tiyong .cell .l{font-size:11px;letter-spacing:2px;color:var(--tx3)}
.tiyong .cell .v{font-size:17px;color:var(--gold3)}
.tiyong .rel{font-size:14px;letter-spacing:2.5px;color:var(--gold2);padding:0 12px;
border-left:1px solid #364152;border-right:1px solid #364152}
.tiyong .sp{grid-column:1/-1;text-align:center;font-size:12.5px;color:var(--tx2);
padding-top:10px;border-top:1px dashed var(--ln)}
.tone{display:grid;grid-template-columns:52px 1fr;gap:12px;padding:13px 0;border-bottom:1px dashed var(--ln)}
.tone:last-child{border-bottom:0}
.tone .lb{font-size:15px;letter-spacing:3px;color:var(--gold2);text-align:center;border-right:1px solid #364152;padding-right:8px}
.tone.warn .lb{color:var(--red)}
.tone .tx{color:#ded7c8;font-size:15px;line-height:2.05}
.plain{background:rgba(91,140,199,.05);border-left:3px solid var(--az);border-radius:0 10px 10px 0;padding:15px 18px}
.plain .one{font-size:15.5px;color:#dfe7f0}
.plain .lbl{font-size:12px;letter-spacing:2.4px;color:var(--az);margin:14px 0 4px}
.plain ul{margin-left:20px}.plain li{color:var(--tx2);font-size:14px}
blockquote{padding:11px 14px;border-radius:0 10px 10px 0;background:rgba(201,162,39,.055);
border-left:3px solid var(--gold);margin-bottom:9px;color:#cfc5b0;font-size:14.5px}
blockquote cite{display:block;text-align:right;font-size:11.5px;color:var(--tx3);font-style:normal;margin-top:3px}
blockquote.fix{border-left-color:var(--red)}
dl{display:grid;grid-template-columns:96px 1fr;gap:5px 12px;font-size:13.5px}
dt{color:var(--tx3)}dd{color:var(--tx)}
footer{text-align:center;margin-top:34px;font-size:11.5px;color:var(--tx3);letter-spacing:2px}
@media(max-width:640px){.tiyong{grid-template-columns:1fr}.tiyong .rel{border:0}.ly .nm{width:auto}}
</style></head><body><div class="wrap">
<h1>${ESC(rec.title)}</h1>
<div class="sub">${ESC(c.ben.fullName)}${ESC(c.ben.symbol)}　动${ESC(c.moving.yaoTitle)}　${ESC(t.relation.label)}　${ESC(r?.grade?.label || '')}
　·　${ESC(rec.category)}　·　编号 ${ESC(rec.id)}<br>
起卦 ${ESC(c.calendar?.dateTime || rec.cast?.localTime || '')}${cal.placeName ? `　·　${ESC(cal.placeName)}（东经 ${ESC(cal.longitude)}°）` : ''}
　·　真太阳时 ${ESC(cal.trueSolarTime || '')}　${ESC(cal.trueHourZhi || '')}时（取数 ${ESC(cal.trueHourNumber ?? '')}）</div>

${rec.question ? `<section><h2>所 问 之 事</h2><p>${ESC(rec.question)}</p></section>` : ''}

<section><h2>卦 象</h2>
  <div class="hexrow">${hexBox('本卦', c.ben)}${hexBox('互卦', c.hu)}${hexBox('变卦', c.bian)}</div>
  <div style="margin-top:18px">${liuyaoHtml(c)}</div>
  <div class="tiyong">
    <div class="cell"><div class="l">体 · 你（${ESC(t.ti.position)}）</div><div class="v">${ESC(t.ti.name)} ${ESC(t.ti.symbol)} ${ESC(t.ti.element)}</div></div>
    <div class="rel">${ESC(REL_GLYPH[t.relation.key] || '')}</div>
    <div class="cell"><div class="l">用 · 事（${ESC(t.yong.position)}）</div><div class="v">${ESC(t.yong.name)} ${ESC(t.yong.symbol)} ${ESC(t.yong.element)}</div></div>
    <div class="sp">${ESC(t.relation.label)}　·　变卦对体 ${ESC(t.bianRelation.label)}　·　互卦对体 ${ESC(t.huRelation.label)}　·　体${ESC(t.wang.ti.element)}${ESC(t.wang.ti.state)}／用${ESC(t.wang.yong.element)}${ESC(t.wang.yong.state)}</div>
  </div>
</section>

${r ? `<div class="sig">${ESC(r.signature)}</div>
<section><h2>卦 象 定 调</h2>${tone}</section>
${plain}` : ''}

${classics ? `<section><h2>古 辞 佐 证</h2>${classics}</section>` : ''}
${corrections}
${review}

<section><h2>起 卦 推 演 与 历 法</h2>
  <ol style="margin-left:20px;color:var(--tx2);font-size:13.5px">${(c.casting?.steps || []).map((s) => `<li>${ESC(s)}</li>`).join('')}</ol>
  <dl style="margin-top:14px">
    <dt>钟表时间</dt><dd>${ESC(cal.dateTime || '')}</dd>
    <dt>钟表时辰</dt><dd>${ESC(cal.clockHourZhi || '')}时（取数 ${ESC(cal.clockHourNumber ?? '')}）</dd>
    <dt>真太阳时</dt><dd>${ESC(cal.trueSolarTime || '')}　${ESC(cal.trueHourZhi || '')}时（取数 ${ESC(cal.trueHourNumber ?? '')}）</dd>
    <dt>修正</dt><dd>经度 ${ESC(cal.longitudeMinutes ?? '')} 分 ＋ 均时差 ${ESC(cal.equationMinutes ?? '')} 分 ＝ ${ESC(cal.offsetMinutes ?? '')} 分</dd>
    <dt>四柱参考</dt><dd>${ESC(cal.yearGanZhi || '')}年　${ESC(cal.monthZhi || '')}月（${ESC(cal.jie || '')}后）　${ESC(cal.dayGanZhi || '')}日</dd>
    <dt>节气</dt><dd>${ESC(cal.term || '')}</dd>
    <dt>总评</dt><dd>${ESC(r?.grade?.label || '')}（${ESC(c.score?.total ?? '')}）— ${ESC(r?.grade?.desc || '')}</dd>
  </dl>
</section>

<footer>问心卦 · 卦录 ${ESC(rec.id)} · 录于 ${ESC(rec.createdAt)}<br>卦象仅供参考，决断在己。</footer>
</div></body></html>`;
}

export default {
  id: 'html-card',
  name: '单卦 HTML 卡片',
  version: '1.0.0',
  author: '问心卦内置样例',
  description: '给卦录加一种离线单文件 HTML 导出：自带样式、不依赖本程序与网络，可直接发给别人或存十年。',

  activate(ctx) {
    ctx.registerExporter({
      id: 'html-card',
      label: '单卦 HTML 卡片（离线单文件）',
      ext: 'html',
      mime: 'text/html; charset=utf-8',
      render: (rec) => buildHtml(rec, ctx.core),
    });

    ctx.on('record.created', (rec) => ctx.log(`卦录 ${rec.id} 可导出为 HTML 卡片`));
  },
};
