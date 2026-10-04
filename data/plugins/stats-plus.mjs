/**
 * 插件：卦气统计（stats-plus）
 * ------------------------------------------------------------
 * 演示 ctx.registerRoute（自己加 REST 接口）与 ctx.registerPage（渲染页面）。
 *
 * 作用：把卦录按「体卦五行」「体用关系」「吉凶」「类别 × 吉凶」做交叉统计，
 * 并给出五行随时间的走势——看久了能看出自己一段时期的「气」在哪里。
 */

const ELEMENTS = ['木', '火', '土', '金', '水'];
const ELEMENT_COLOR = { 木: '#4a9e6e', 火: '#c0392b', 土: '#a9865b', 金: '#d4a843', 水: '#5b8cc7' };
const GRADES = ['大吉', '吉', '中吉', '平', '小凶', '凶'];

function tally(records, pick) {
  const out = {};
  for (const r of records) {
    const k = pick(r);
    if (!k) continue;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function cross(records, rowPick, colPick) {
  const rows = {};
  for (const r of records) {
    const a = rowPick(r);
    const b = colPick(r);
    if (!a || !b) continue;
    rows[a] = rows[a] || {};
    rows[a][b] = (rows[a][b] || 0) + 1;
  }
  return rows;
}

function analyze(store) {
  const recs = store.list();
  const withChart = recs.filter((r) => r.chart?.tiyong?.ti?.element);
  const scoreOf = (r) => r.chart?.score?.total ?? 0;

  return {
    total: recs.length,
    byElement: tally(withChart, (r) => r.chart.tiyong.ti.element),
    byRelation: tally(recs, (r) => r.chart?.tiyong?.relation?.label),
    byGrade: tally(recs, (r) => r.reading?.grade?.label),
    crossElementGrade: cross(recs, (r) => r.chart?.tiyong?.ti?.element, (r) => r.reading?.grade?.label),
    avgByElement: ELEMENTS.map((e) => {
      const sub = withChart.filter((r) => r.chart.tiyong.ti.element === e);
      return {
        element: e,
        count: sub.length,
        avg: sub.length ? Math.round((sub.reduce((s, r) => s + scoreOf(r), 0) / sub.length) * 10) / 10 : null,
      };
    }),
    timeline: recs
      .filter((r) => r.cast?.localTime)
      .slice()
      .sort((a, b) => String(a.cast.localTime).localeCompare(String(b.cast.localTime)))
      .map((r) => ({
        id: r.id,
        time: r.cast.localTime,
        element: r.chart?.tiyong?.ti?.element || '',
        score: scoreOf(r),
        grade: r.reading?.grade?.label || '',
        ben: r.chart?.ben?.fullName || '',
        title: r.title,
      })),
  };
}

export default {
  id: 'stats-plus',
  name: '卦气统计',
  version: '1.0.0',
  author: '问心卦内置样例',
  description: '体卦五行分布、吉凶交叉、以及按时间排列的卦气走势——看看自己这一段的「气」落在哪里。',

  activate(ctx) {
    // 自己的接口：GET /api/plugins/stats-plus/trend
    ctx.registerRoute('GET', 'trend', ({ json, store }) => {
      json({ ok: true, data: analyze(store) });
    });

    ctx.registerPage({
      id: 'trend',
      label: '卦气统计',
      icon: '◈',
      order: 30,
      render: ({ store }) => {
        const a = analyze(store);
        if (!a.total) return { html: '<div class="empty"><div class="big">◈</div>还没有卦录。</div>' };

        const bars = (obj, total, colorFn) => Object.entries(obj)
          .sort((x, y) => y[1] - x[1])
          .map(([k, v]) => `<div class="bar-row"><div class="bl">${esc(k)}</div>
            <div class="bt"><i style="width:${Math.round((v / Math.max(1, total)) * 100)}%;${colorFn ? `background:${colorFn(k)}` : ''}"></i></div>
            <div class="bv">${v}</div></div>`).join('') || '<div class="dim small">无数据</div>';

        const matrix = `<table class="md-table"><thead><tr><th>体卦五行</th>${GRADES.map((g) => `<th>${g}</th>`).join('')}<th>平均分</th></tr></thead><tbody>
          ${ELEMENTS.map((e) => {
    const row = a.crossElementGrade[e] || {};
    const avg = a.avgByElement.find((x) => x.element === e);
    return `<tr><td style="color:${ELEMENT_COLOR[e]}">${e}</td>
              ${GRADES.map((g) => `<td>${row[g] || '·'}</td>`).join('')}
              <td>${avg?.avg ?? '·'}${avg?.count ? `<span class="dim small">（${avg.count}）</span>` : ''}</td></tr>`;
  }).join('')}
        </tbody></table>`;

        const spark = a.timeline.map((t) => {
          const h2 = Math.max(6, Math.round((t.score + 100) / 2)); // -100..100 → 0..100
          const good = t.score >= 0;
          return `<div title="${esc(`${t.time}　${t.ben}　${t.score}　${t.grade}`)}"
            style="display:inline-block;width:22px;text-align:center;margin-right:3px">
            <div style="height:24px;display:flex;align-items:flex-end">
              <i style="display:block;width:100%;height:${h2}%;background:${good ? 'linear-gradient(180deg,var(--gold-2),#7d6418)' : 'linear-gradient(180deg,var(--cinnabar-2),#6d2419)'};border-radius:3px 3px 0 0"></i>
            </div>
            <div class="dim" style="font-size:10px;margin-top:3px">${esc(t.element)}</div>
          </div>`;
        }).join('');

        return {
          html: `
            <div class="grid c3">
              <div class="card"><div class="card-title">体 卦 五 行</div>${bars(a.byElement, a.total, (k) => ELEMENT_COLOR[k])}</div>
              <div class="card"><div class="card-title">体 用 关 系</div>${bars(a.byRelation, a.total)}</div>
              <div class="card"><div class="card-title">总 评 分 布</div>${bars(a.byGrade, a.total)}</div>
            </div>
            <div class="card"><div class="card-title">五 行 × 吉 凶 交 叉</div>${matrix}
              <div class="small dim" style="margin-top:8px">看哪一行的「气」最顺、哪一行总落在小凶——那是你这一段的短板所在。</div></div>
            <div class="card"><div class="card-title">卦 气 走 势</div>
              <div style="overflow-x:auto;padding:8px 0;white-space:nowrap">${spark}</div>
              <div class="small dim">每根柱是一卦（按起卦时间排列），柱高为总评分（−100 ~ +100），柱下字为体卦五行。</div></div>
            <div class="card tight"><div class="small dim">本页由插件 <span class="mono">stats-plus</span> 提供；
              其数据接口为 <span class="mono">GET /api/plugins/stats-plus/trend</span>，可被别的程序取用。</div></div>`,
        };
      },
    });
  },
};

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
