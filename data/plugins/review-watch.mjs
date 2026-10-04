/**
 * 插件：应期提醒（review-watch）
 * ------------------------------------------------------------
 * 这是一个可直接使用的插件，同时也是一份教学样例。它演示了：
 *   ctx.registerPage     —— 往侧栏加一个页面
 *   ctx.registerPanel    —— 在每条卦录详情页加一块
 *   ctx.on               —— 监听宿主事件
 *   ctx.store / ctx.core —— 直接使用宿主的存储与内核
 *
 * 作用：按「动爻之位」推出的应期窗口，把「时间该到了、还没复盘」的卦挑出来。
 */

/** 动爻之位 → 应期窗口天数（与断语引擎的口径一致，取上限） */
const WINDOW_DAYS = { 1: 10, 2: 30, 3: 90, 4: 120, 5: 180, 6: 365 };
const WINDOW_TEXT = { 1: '旬日之内', 2: '一月之内', 3: '一季之内', 4: '三四个月之内', 5: '半载之内', 6: '逾年之外' };

function daysSince(localTime) {
  const m = String(localTime || '').match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  if (!m) return null;
  const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.floor((Date.now() - then.getTime()) / 86400000);
}

function due(record) {
  const pos = record.chart?.moving?.position;
  const d = daysSince(record.cast?.localTime);
  if (!pos || d === null) return null;
  const limit = WINDOW_DAYS[pos] || 90;
  // 体旺则其应提前（与断语引擎同一取舍）
  const tiState = record.chart?.tiyong?.wang?.ti?.state;
  const factor = ['旺', '相'].includes(tiState) ? 0.6 : 1;
  const effective = Math.round(limit * factor);
  return {
    limit: effective,
    limitText: WINDOW_TEXT[pos],
    elapsed: d,
    remaining: effective - d,
    overdue: d > effective,
    ratio: Math.min(1, d / Math.max(1, effective)),
  };
}

export default {
  id: 'review-watch',
  name: '应期提醒',
  version: '1.0.0',
  author: '问心卦内置样例',
  description: '按动爻之位推算应期窗口，把「时间该到了、还没复盘」的卦挑出来，提醒你回头看。',

  activate(ctx) {
    ctx.registerPage({
      id: 'due',
      label: '应期提醒',
      icon: '⏳',
      order: 20,
      render: ({ store }) => {
        const rows = store.list()
          .filter((r) => ['待应验', '应验中'].includes(r.review?.status))
          .map((r) => ({ r, d: due(r) }))
          .filter((x) => x.d)
          .sort((a, b) => b.d.ratio - a.d.ratio);

        const overdue = rows.filter((x) => x.d.overdue);
        const soon = rows.filter((x) => !x.d.overdue && x.d.ratio >= 0.7);
        const wait = rows.filter((x) => !x.d.overdue && x.d.ratio < 0.7);

        const line = (x) => {
          const tag = x.d.overdue
            ? `<span class="tag bad">已过 ${x.d.elapsed - x.d.limit} 天</span>`
            : `<span class="tag warn">还剩 ${x.d.remaining} 天</span>`;
          return `<div class="classic">
            <div class="t"><a href="#/record/${encodeURIComponent(x.r.id)}">${esc(x.r.title)}</a>
              <span class="dim small">　${esc(x.r.chart?.ben?.fullName || '')}${esc(x.r.chart?.ben?.symbol || '')}　动${esc(x.r.chart?.moving?.yaoTitle || '')}　${esc(x.r.category)}</span></div>
            <span class="s">${tag}　起卦 ${esc(x.r.cast?.localTime || '')}　应期本主「${esc(x.d.limitText)}」（按体气折为 ${x.d.limit} 天）　状态 ${esc(x.r.review?.status || '')}</span>
          </div>`;
        };

        const section = (title, list, hint) => list.length
          ? `<div class="card"><div class="card-title">${title}（${list.length}）</div>
             <div class="small dim" style="margin-bottom:10px">${hint}</div>${list.map(line).join('')}</div>`
          : '';

        return {
          html: `
            ${section('应期已至，宜即复盘', overdue, '卦象所主的时间已经到了。是否应验、如何应验、何处不合——趁还记得，记下来。复盘才是卦录最值钱的部分。')}
            ${section('应期将近', soon, '还有不多的时间，可以提前留意事态的走向，作个预判。')}
            ${section('尚在期中', wait, '卦气未至，安心做该做的事，不必反复叩问。')}
            ${rows.length ? '' : '<div class="empty"><div class="big">⏳</div>没有在等待应验的卦。要么都已复盘，要么还没起卦。</div>'}
            <div class="card tight"><div class="small dim">
              本页由插件 <span class="mono">review-watch</span> 提供。窗口取法：动爻之位的常期，遇体卦旺、相则折为六成——
              体气得令者，其应不至久留。
            </div></div>`,
        };
      },
    });

    ctx.registerPanel({
      id: 'due',
      label: '应期',
      order: 30,
      render: ({ record }) => {
        const d = due(record);
        if (!d) return { html: '<p class="dim small">此卦缺少起卦时间或动爻，无法推算应期。</p>' };
        const pct = Math.round(d.ratio * 100);
        return {
          html: `<div class="small muted">起卦至今 <b class="gold">${d.elapsed}</b> 天；应期本主「${esc(d.limitText)}」，按体气折为 <b class="gold">${d.limit}</b> 天。</div>
            <div class="bar-row" style="margin-top:10px"><div class="bl">${d.overdue ? '已过' : '已历'}</div>
              <div class="bt"><i style="width:${pct}%;background:${d.overdue ? 'linear-gradient(90deg,#7d2a20,var(--cinnabar-2))' : 'linear-gradient(90deg,#8b6f22,var(--gold-2))'}"></i></div>
              <div class="bv">${pct}%</div></div>
            <div class="small ${d.overdue ? 'err' : 'dim'}" style="margin-top:6px">
              ${d.overdue ? `已过应期 ${d.elapsed - d.limit} 天，建议复盘：实际如何？卦在何处应了、何处没应？` : `距应期约还有 ${d.remaining} 天。`}
            </div>`,
        };
      },
    });

    ctx.on('record.created', (rec) => {
      const d = due(rec);
      if (d) ctx.log(`新卦录 ${rec.id}，应期窗口约 ${d.limit} 天。`);
    });

    function esc(s) {
      return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
  },
};
