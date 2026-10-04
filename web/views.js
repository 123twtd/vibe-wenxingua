/**
 * 问心卦 · 界面各页
 * ------------------------------------------------------------
 * 每个视图返回 { html, mount? }：
 *   html  —— 直接塞进主区；
 *   mount —— 绑定事件（在插入 DOM 之后调用）。
 * 路由在 app.js，此处只管画面与交互。
 */

import {
  api, h, attr, toast, modal, debounce, gradeTag, fmtLocal, fmtFull,
  toLocalInput, fromLocalInput, nowLocalInput,
  liuyaoHtml, hexRowHtml, tiyongHtml, readingHtml, calendarHtml, renderMarkdown,
} from './api.js';
import { renderLineChart, legendHtml } from './chart.js';
// 对话只长在右侧那个常驻面板里（web/index.html 的 .agent-panel），
// 所以这里不再引 chatpanel——「助手」页只留配置，两处入口是重复。

/**
 * 行内 Markdown：先转义，再把 **粗体** 变成 <b>。
 * 为什么需要它：像权限说明这类文案由服务端提供（agent/permissions.mjs），
 * 里面本来用 `**` 标重点给文档看；直接塞进 HTML 会原样显示成星号。
 */
function mdInline(s) {
  return h(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}

/* ---------- 模块级缓存 ---------- */
let HEX_CACHE = null;
async function hexagrams() {
  if (!HEX_CACHE) {
    const r = await api.get('/api/knowledge/hexagrams');
    HEX_CACHE = r.items;
  }
  return HEX_CACHE;
}

const TONE_ORDER = { 大吉: 0, 吉: 1, 中吉: 2, 平: 3, 小凶: 4, 凶: 5 };

/* ============================================================
 * 概览
 * ========================================================== */
export const dashboard = {
  title: '卦 录 总 览',
  desc: '一卦一录，久而成史。此处只见轮廓，细读请入卦录。',
  async render(ctx) {
    const [{ stats }, { items }, meta] = await Promise.all([
      api.get('/api/stats'), api.get('/api/records'), api.get('/api/meta'),
    ]);
    const recents = items.slice(0, 7);

    const bars = (obj, total) => Object.entries(obj || {})
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<div class="bar-row"><div class="bl">${h(k)}</div>
        <div class="bt"><i style="width:${Math.round((v / Math.max(1, total)) * 100)}%"></i></div>
        <div class="bv">${v}</div></div>`).join('') || '<div class="dim small">暂无</div>';

    const recentHtml = recents.length
      ? recents.map(recCard).join('')
      : `<div class="empty"><div class="big">☰</div>尚无卦录。<br><span class="small">去「起卦台」起第一卦，或在「导入」里粘贴旧卦。</span></div>`;

    const sigs = items.filter((i) => i.signature).slice(0, 6)
      .map((i) => `<div class="classic"><div class="t">${h(i.signature)}</div><span class="s">${h(fmtLocal(i.localTime))}　${h(i.ben?.fullName || '')}</span></div>`).join('');

    // 侧栏与状态栏已经显示总数，这里只放「需要算一算才知道」的指标
    const today = new Date();
    const span = items.length > 1
      ? Math.round((new Date(items[0].localTime) - new Date(items[items.length - 1].localTime)) / 86400000)
      : 0;
    const pending = items.filter((i) => i.review?.status === '待应验' || i.review?.status === '应验中').length;
    const withCorr = items.filter((i) => (i.corrections || []).length).length;
    const avgScore = items.length
      ? Math.round(items.reduce((s, i) => s + (i.score ?? 0), 0) / items.length) : 0;
    const goodRatio = items.length
      ? Math.round((items.filter((i) => (i.score ?? 0) >= 25).length / items.length) * 100) : 0;

    const stat = (n, l) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`;

    return {
      html: `
      <div class="grid c5" style="margin-bottom:10px">
        ${stat(stats.total, '卦 录 总 数')}
        ${stat(`${avgScore > 0 ? '+' : ''}${avgScore}`, '平 均 总 评')}
        ${stat(`${goodRatio}%`, '吉 以 上 占 比')}
        ${stat(pending, '待 应 验')}
        ${stat(withCorr, '含 校 勘')}
        ${stat(new Set(items.map((i) => i.ben?.name)).size, '出 现 卦 数')}
        ${stat(span, '跨 度（天）')}
        ${stat(meta.knowledge.withYaoci, '卦 典 爻 辞')}
      </div>

      <div class="grid split">
        <div class="card">
          <div class="card-title">最 近 卦 录<span class="sp"><a href="#/records" class="small">全部 →</a></span></div>
          <div class="rec-list">${recentHtml}</div>
        </div>
        <div>
          <div class="card"><div class="card-title">总 评 分 布</div>${bars(stats.byGrade, stats.total)}</div>
          <div class="card"><div class="card-title">体 用 分 布</div>${bars(stats.byRelation, stats.total)}</div>
          <div class="card"><div class="card-title">复 盘 状 态</div>${bars(stats.byReview, stats.total)}</div>
        </div>
      </div>

      <div class="grid c3">
        <div class="card"><div class="card-title">类 别 分 布</div>${bars(stats.byCategory, stats.total)}</div>
        <div class="card"><div class="card-title">卦 象 频 次（前 十）</div>${bars(topN(stats.byBen, 10), stats.total)}</div>
        <div class="card"><div class="card-title">近 期 谶 语</div>
          ${sigs || '<div class="dim small">尚无谶语。</div>'}
        </div>
      </div>

      <div class="card tight">
        <div class="card-title">起 手 之 处</div>
        <div class="chips">
          <button class="btn primary" data-go="#/cast">起 一 卦</button>
          <button class="btn" data-go="#/import">粘 贴 导 入 旧 卦</button>
          <button class="btn ghost" data-go="#/trend">看 走 势</button>
          <button class="btn ghost" data-go="#/dian">翻 卦 典</button>
          <a class="btn ghost" href="/api/export?format=md" download>导出全部（Markdown）</a>
          <a class="btn ghost" href="/api/export?format=json" download>整包备份（JSON）</a>
          ${window.__qxgDesktop ? `
            <button class="btn ghost" id="d-open-data">打开数据目录</button>
            <button class="btn ghost" id="d-export">导出备份到…</button>` : ''}
        </div>
      </div>`,
      mount(root) {
        root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => ctx.navigate(b.dataset.go)));
        const d = window.__qxgDesktop;
        if (d) {
          root.querySelector('#d-open-data')?.addEventListener('click', () => d.openDataDir());
          root.querySelector('#d-export')?.addEventListener('click', async () => {
            const r = await d.exportBackup();
            if (r?.ok) toast(`备份已存到 ${r.filePath}`);
          });
        }
      },
    };
  },
};

function topN(obj, n) {
  const out = {};
  Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, n).forEach(([k, v]) => { out[k] = v; });
  return out;
}

/* ============================================================
 * 卦录列表
 * ========================================================== */
export const records = {
  title: '卦 录',
  desc: '按时间倒序。点开可读全卦、复盘、导出。筛选条件只作用于本页，不占侧栏。',
  async render(ctx) {
    const state = { q: '', category: '', grade: '', review: '', sort: '' };
    const box = document.createElement('div');
    const count = document.createElement('span');

    const load = async () => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(state)) if (v && k !== 'sort') qs.set(k, v);
      const { items, total } = await api.get(`/api/records?${qs}`);
      let list = items;
      if (state.sort === 'score') list = [...items].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      if (state.sort === 'scoreAsc') list = [...items].sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
      count.textContent = `共 ${total} 条`;
      box.innerHTML = list.length
        ? `<div class="rec-list">${list.map(recCard).join('')}</div>`
        : '<div class="empty"><div class="big">☷</div>没有符合条件的卦录。<br><span class="small">试试清掉几个筛选条件。</span></div>';
      box.querySelectorAll('.rec').forEach((el) => el.addEventListener('click', () => ctx.navigate(`#/record/${el.dataset.id}`)));
    };

    const meta = await api.get('/api/meta');
    const html = `
      <div class="toolbar">
        <input type="text" id="fq" placeholder="搜卦名、卦辞、所问、断语、原文……" style="width:250px;flex:0 1 250px">
        <span class="tb-sep"></span>
        <span class="tb-label">类别</span>
        <div class="chips" id="fchips">
          <span class="chip on" data-k="category" data-v="">类别不限</span>
          ${meta.categories.map((c) => `<span class="chip" data-k="category" data-v="${attr(c)}">${h(c)}</span>`).join('')}
        </div>
        <span class="spacer" style="flex:1"></span>
        <span class="muted tiny" id="rcount"></span>
      </div>
      <div class="toolbar">
        <span class="tb-label">吉凶</span>
        <div class="chips" id="fchips2">
          <span class="chip on" data-k="grade" data-v="">吉凶不限</span>
          ${['大吉', '吉', '中吉', '平', '小凶', '凶'].map((c) => `<span class="chip" data-k="grade" data-v="${c}">${h(c)}</span>`).join('')}
        </div>
        <span class="tb-sep"></span>
        <span class="tb-label">状态</span>
        <div class="chips" id="fchips3">
          <span class="chip on" data-k="review" data-v="">状态不限</span>
          ${meta.reviewStatuses.map((c) => `<span class="chip" data-k="review" data-v="${attr(c)}">${h(c)}</span>`).join('')}
        </div>
        <span class="tb-sep"></span>
        <span class="tb-label">排序</span>
        <div class="chips" id="fsort">
          <span class="chip on" data-sort="">按时间</span>
          <span class="chip" data-sort="score">总评↓</span>
          <span class="chip" data-sort="scoreAsc">总评↑</span>
        </div>
      </div>
      <div id="rlist"></div>`;

    return {
      html,
      async mount(root) {
        box.id = 'rlist';
        root.querySelector('#rlist').replaceWith(box);
        count.id = 'rcount';
        root.querySelector('#rcount').replaceWith(count);
        const search = debounce(() => load(), 260);
        root.querySelector('#fq').addEventListener('input', (e) => { state.q = e.target.value.trim(); search(); });
        // 三类筛选：同组内单选、可再点一次取消；空值项代表「不限」
        root.querySelectorAll('.chip[data-k]').forEach((chip) => chip.addEventListener('click', () => {
          const k = chip.dataset.k;
          const v = chip.dataset.v;
          state[k] = state[k] === v ? '' : v;
          root.querySelectorAll(`.chip[data-k="${k}"]`).forEach((x) => {
            x.classList.toggle('on', (state[k] === '' && x.dataset.v === '') || x.dataset.v === state[k]);
          });
          load();
        }));
        root.querySelectorAll('.chip[data-sort]').forEach((chip) => chip.addEventListener('click', () => {
          state.sort = state.sort === chip.dataset.sort ? '' : chip.dataset.sort;
          root.querySelectorAll('.chip[data-sort]').forEach((x) => x.classList.toggle('on', x.dataset.sort === state.sort));
          load();
        }));
        await load();
      },
    };
  },
};

function recCard(item) {
  const g = item.grade;
  const tone = g?.tone || 'neutral';
  return `<div class="rec" data-id="${attr(item.id)}">
    <div class="viz">
      <div class="s">${h(item.ben?.symbol || '䷀')}</div>
      <div class="n">${h(item.ben?.fullName || '')}</div>
    </div>
    <div class="mid">
      <div class="t">${h(item.title || '未题之占')}</div>
      <div class="q">${h(item.question || '')}</div>
      <div class="m">
        ${h(fmtLocal(item.localTime))}　<b>${h(item.category)}</b>　
        互 ${h(item.hu?.fullName || '—')} → 变 ${h(item.bian?.fullName || '—')}　
        ${h(item.tiyong ? `${item.tiyong.ti}／${item.tiyong.yong}·${item.tiyong.relation}` : '')}　
        ${item.moving ? `动 ${h(item.moving.yaoTitle)}` : ''}
        ${item.signature ? `<br><span class="dim">谶　${h(item.signature)}</span>` : ''}
      </div>
    </div>
    <div class="right">
      <span class="tag ${tone}">${h(g?.label || '—')}</span>
      <span class="tag neutral small">${h(item.review?.status || '')}</span>
      ${item.correctionCount ? `<span class="tag warn small">校勘 ${item.correctionCount}</span>` : ''}
    </div>
  </div>`;
}

/* ============================================================
 * 卦录详情
 * ========================================================== */
export const recordDetail = {
  title: '卦 录 · 详 情',
  desc: '全卦与断语。七段定调在上，通俗解与卦典原文在下，末尾可复盘与导出。',
  async render(ctx) {
    const id = ctx.params.id;
    const { record: rec, panels } = await api.get(`/api/records/${encodeURIComponent(id)}`);
    const c = rec.chart;
    const r = rec.reading;
    const meta = await api.get('/api/meta');

    const corrections = (rec.corrections || []).length
      ? `<div class="card"><div class="card-title" style="color:var(--cinnabar-2)">校 勘</div>
          <div class="small muted" style="margin-bottom:10px">以下为当初口头解读与本程序依正法重算之差异——一并存录，不作删改。</div>
          ${rec.corrections.map((x) => `<div class="classic" style="border-left-color:var(--cinnabar)">
            <div class="t"><b>${h(x.label)}</b>　原述「${h(x.stated)}」→ 正法「${h(x.computed)}」</div>
            <span class="s">${h(x.note)}</span></div>`).join('')}
        </div>` : '';

    const review = rec.review || {};
    const reviewHtml = `<div class="card"><div class="card-title">复 盘</div>
      <div class="grid c2">
        <label class="fld"><span>状态</span>
          <select id="rv-status">${meta.reviewStatuses.map((s) => `<option ${s === review.status ? 'selected' : ''}>${h(s)}</option>`).join('')}</select>
        </label>
        <label class="fld"><span>复盘时间</span>
          <input type="text" id="rv-at" value="${attr(review.reviewedAt || '')}" placeholder="如 2026-12-20">
        </label>
      </div>
      <label class="fld"><span>实况如何</span>
        <textarea id="rv-result" placeholder="后来实际发生了什么？与本卦何处相合、何处不合？">${h(review.result || '')}</textarea>
      </label>
      <div class="chips">
        <button class="btn primary sm" id="rv-save">存 复 盘</button>
        <button class="btn sm" id="rv-addlog">添 一 条 追 记</button>
      </div>
      <div style="margin-top:12px">${(review.log || []).map((e) => `<div class="classic"><div class="t">${h(e.text)}</div><span class="s">${h(e.at || '')}</span></div>`).join('') || '<div class="dim small">尚无追记。</div>'}</div>
    </div>`;

    const panelHtml = (panels || []).map((p) => `<div class="card"><div class="card-title">${h(p.label || '插件面板')}</div>
      ${p.html ? p.html : `<pre class="md-code"><code>${h(JSON.stringify(p.data ?? p, null, 2))}</code></pre>`}</div>`).join('');

    // 补充存录：引擎算不出的那些——背景、方案、原文问答、人工校勘。
    // 「原文」另起一卡放解读全文；「人工校勘」与上面引擎自动算出的「校勘」分开，免得混源。
    const suppCard = (label, text, note) => (text
      ? `<div class="card"><div class="card-title">${label}</div>
          ${note ? `<div class="small muted" style="margin-bottom:8px">${note}</div>` : ''}
          <div class="narrative md-body">${renderMarkdown(text)}</div></div>`
      : '');
    const supplementHtml = [
      suppCard('背 景', rec.background, '求测人的处境、动机，几件事各占几分。'),
      rec.narrative ? `<div class="card"><div class="card-title">原 文 存 录</div>
          <div class="narrative md-body">${renderMarkdown(rec.narrative)}</div></div>` : '',
      suppCard('方 案', rec.plan, '断语给的是通则；这里存落到这件事上的具体做法。'),
      suppCard('原 文 问 答', rec.qa, '当初的往来问答，以「问：」「答：」起行。'),
      suppCard('人 工 校 勘', rec.collation, '人对旧解读措辞的更正——与上面引擎自动算出的「校勘」分开。'),
    ].join('');

    return {
      html: `
        <div class="toolbar">
          <span class="gold" style="letter-spacing:1px">${h(rec.title)}</span>
          <span class="tb-sep"></span>
          <span class="muted tiny">${h(fmtFull(rec.cast?.localTime))}　·　${h(rec.category)}　·　编号 <span class="mono">${h(rec.id)}</span></span>
          ${(rec.tags || []).map((t) => `<span class="tag neutral">${h(t)}</span>`).join('')}
          <span style="flex:1"></span>
          <button class="btn sm ghost" data-go="#/records">← 返 回 卦 录</button>
          <button class="btn sm" id="btn-supp">补 充 存 录</button>
          <button class="btn sm" id="btn-recompute">重 算 断 语</button>
          <a class="btn sm ghost" href="/api/records/${encodeURIComponent(rec.id)}/export?format=md" download>导出 Markdown</a>
          <a class="btn sm ghost" href="/api/records/${encodeURIComponent(rec.id)}/export?format=slip" download>导出卦签</a>
          <button class="btn sm danger" id="btn-del">删 除</button>
        </div>

        ${rec.question ? `<div class="card"><div class="card-title">所 问 之 事</div><div style="color:#d8d1c2">${h(rec.question)}</div></div>` : ''}

        <div class="card">
          <div class="card-title">卦 象</div>
          ${hexRowHtml(c)}
          <div class="hr"></div>
          ${liuyaoHtml(c)}
          ${tiyongHtml(c)}
        </div>

        ${r ? readingHtml(r, { chart: c }) : '<div class="card err">此卦录缺少断语，可点「重算断语」生成。</div>'}

        ${corrections}

        <div class="grid c2">
          <div class="card"><div class="card-title">起 卦 推 演</div>
            <ol class="cast-steps">${(c.casting?.steps || []).map((s) => `<li>${h(s)}</li>`).join('')}</ol>
            <div class="hr"></div>
            <div class="small dim">起卦之法：${h(c.method)}　报数：${h((rec.cast?.numbers || []).join(' / ') || '—')}　真太阳时：${rec.cast?.useTrueSolarTime ? '是' : '否'}</div>
          </div>
          <div class="card"><div class="card-title">时 间 与 历 法</div>${calendarHtml(c.calendar)}</div>
        </div>

        ${reviewHtml}
        ${supplementHtml}
        ${panelHtml}

        <div class="card tight"><div class="small dim">
          录于 ${h(rec.createdAt)}　最后更新 ${h(rec.updatedAt)}　第 ${rec.revisionCount || 0} 次重算　
          卦象仅供参考，决断在己。
        </div></div>`,
      mount(root) {
        root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => ctx.navigate(b.dataset.go)));
        root.querySelector('#rv-save').addEventListener('click', async () => {
          const review2 = {
            ...rec.review,
            status: root.querySelector('#rv-status').value,
            result: root.querySelector('#rv-result').value,
            reviewedAt: root.querySelector('#rv-at').value || new Date().toISOString().slice(0, 10),
          };
          await api.patch(`/api/records/${encodeURIComponent(rec.id)}`, { review: review2 });
          toast('复盘已存');
          ctx.reload();
        });
        root.querySelector('#rv-addlog').addEventListener('click', () => {
          modal(`<h3 class="card-title">追 记 一 条</h3>
            <label class="fld"><span>时间</span><input type="text" id="lg-at" value="${new Date().toISOString().slice(0, 10)}"></label>
            <label class="fld"><span>内容</span><textarea id="lg-tx" placeholder="今天此事有何进展？卦象何处应了？"></textarea></label>
            <div class="chips"><button class="btn primary" id="lg-ok">存 下</button></div>`, (m, close) => {
            m.querySelector('#lg-ok').addEventListener('click', async () => {
              const log = [...(rec.review?.log || []), { at: m.querySelector('#lg-at').value, text: m.querySelector('#lg-tx').value }];
              await api.patch(`/api/records/${encodeURIComponent(rec.id)}`, { review: { ...rec.review, log } });
              close(); toast('已追记'); ctx.reload();
            });
          });
        });
        root.querySelector('#btn-supp').addEventListener('click', () => {
          const area = (label, id, val, ph) => `<label class="fld" style="margin-bottom:9px"><span>${label}</span>
            <textarea id="${id}" style="min-height:78px" placeholder="${attr(ph)}">${h(val || '')}</textarea></label>`;
          modal(`<h3 class="card-title">补 充 存 录</h3>
            <div class="small muted" style="margin-bottom:10px">这几项是引擎算不出的：背景、方案、原文问答、人工校勘。都可省。</div>
            ${area('背景', 'sp-bg', rec.background, '求测人的处境、动机，几件事各占几分')}
            ${area('原文（解读全文）', 'sp-narrative', rec.narrative, '当初的完整解读，Markdown 也行')}
            ${area('方案', 'sp-plan', rec.plan, '具体怎么做')}
            ${area('原文问答', 'sp-qa', rec.qa, '问：…（换行）答：…')}
            ${area('人工校勘', 'sp-collation', rec.collation, '如「第四爻阳变阴」应作「六四阴爻动，变阳」')}
            <div class="chips"><button class="btn primary" id="sp-ok">存 下</button></div>`, (m, close) => {
            m.querySelector('#sp-ok').addEventListener('click', async () => {
              await api.patch(`/api/records/${encodeURIComponent(rec.id)}`, {
                background: m.querySelector('#sp-bg').value,
                narrative: m.querySelector('#sp-narrative').value,
                plan: m.querySelector('#sp-plan').value,
                qa: m.querySelector('#sp-qa').value,
                collation: m.querySelector('#sp-collation').value,
              });
              close(); toast('已存补充存录'); ctx.reload();
            });
          });
        });
        root.querySelector('#btn-recompute').addEventListener('click', async () => {
          await api.post(`/api/records/${encodeURIComponent(rec.id)}/recompute`);
          toast('已按当前断语引擎重算'); ctx.reload();
        });
        root.querySelector('#btn-del').addEventListener('click', async () => {
          if (!confirm('删除此卦录？（会先移入 data/trash/，可手工找回）')) return;
          await api.del(`/api/records/${encodeURIComponent(rec.id)}`);
          toast('已删除（已移入 trash）'); ctx.navigate('#/records');
        });
      },
    };
  },
};

/* ============================================================
 * 起卦台
 * ========================================================== */
export const castDesk = {
  title: '起 卦 台',
  desc: '报数、择时、定地，起卦即得断语；满意则录下，不满则重来。',
  async render(ctx) {
    const [meta, hexes] = await Promise.all([api.get('/api/meta'), hexagrams()]);
    const cfg = meta.config || {};
    /**
     * 表单初始值：**凡属「你的」的一律留空**。
     * 报数、本卦、动爻这三样必须由起卦的人给——预填一个数（哪怕是上一个卦的）
     * 等于替人起卦，那是会算错人、也算错事的。
     * 时间与地点不是「你的选择」而是「你此刻在哪」，可以带默认，但要写明。
     */
    const form = {
      method: 'numberAndTime',
      numbers: '',                       // 必须自己报
      localTime: nowLocalInput(),        // 此刻，可改
      placeName: cfg.defaultPlace || '', // 设置里配过才有
      longitude: cfg.defaultLongitude ?? '',
      useTrueSolarTime: cfg.useTrueSolarTimeByDefault !== false,
      movingFrom: cfg.movingFromByDefault || 'sum',
      hexagram: '',                      // 手动起卦时必须自己填
      movingPosition: '',                // 同上
      question: '',
      category: '',
      title: '',
    };

    const html = `
      <div class="desk">
        <div>
          <div class="card">
            <div class="card-title">起 卦 之 法</div>
            <label class="fld"><span>方法</span>
              <select id="c-method">${meta.methods.map((m) => `<option value="${m.id}" ${m.id === form.method ? 'selected' : ''}>${h(m.label)}</option>`).join('')}</select>
              <div class="hint" id="c-hint">${h(meta.methods[0].hint)}</div>
            </label>

            <div id="g-number">
              <label class="fld"><span>报数（1–100，或任意正整数）</span>
                <input type="text" id="c-numbers" value="${attr(form.numbers)}" placeholder="如 82；两数起卦写 617 15">
                <div class="hint">这个数得你自己报——预填或替你猜一个数，卦就算在别人身上了。</div>
                <div class="hint">一数＋时辰：上卦取数除八，下卦取时辰数除八，动爻取二者之和除六。</div>
              </label>
            </div>

            <div id="g-hex" style="display:none">
              <label class="fld"><span>本卦（卦名／卦序／卦符皆可）</span>
                <input type="text" id="c-hex" list="hexlist" value="${attr(form.hexagram)}" placeholder="如 泽火革 / 革 / 49 / ䷰">
                <datalist id="hexlist">${hexes.map((x) => `<option value="${attr(x.fullName)}">${x.id}　${h(x.name)}</option>`).join('')}</datalist>
              </label>
              <label class="fld"><span>动爻（自下而上第几爻）</span>
                <select id="c-mpos">${[1, 2, 3, 4, 5, 6].map((i) => `<option value="${i}" ${i === form.movingPosition ? 'selected' : ''}>第 ${i} 爻（${['初', '二', '三', '四', '五', '上'][i - 1]}）</option>`).join('')}</select>
              </label>
            </div>

            <div style="display:none" id="g-movefrom">
              <label class="fld"><span>动爻取法</span>
                <select id="c-movingfrom">${meta.movingFromOptions.map((o) => `<option value="${o.id}" ${o.id === form.movingFrom ? 'selected' : ''}>${h(o.label)}</option>`).join('')}</select>
              </label>
            </div>
          </div>

          <div class="card">
            <div class="card-title">时 与 地</div>
            <label class="fld"><span>起卦时间（钟表时间）</span>
              <input type="datetime-local" id="c-time" value="${attr(form.localTime)}">
            </label>
            <label class="fld"><span>地点</span>
              <select id="c-place">${meta.places.map((p) => `<option value="${p.name}" ${p.name === form.placeName ? 'selected' : ''}>${h(p.name)}（东经 ${p.longitude}°）</option>`).join('')}<option value="__custom">自定义经度…</option></select>
            </label>
            <label class="fld"><span>经度（东经）</span>
              <input type="number" step="0.01" id="c-lon" value="${attr(form.longitude)}">
            </label>
            <label class="fld"><span>定时辰之法</span>
              <select id="c-true">
                <option value="1" ${form.useTrueSolarTime ? 'selected' : ''}>按真太阳时定时辰（推荐）</option>
                <option value="0" ${!form.useTrueSolarTime ? 'selected' : ''}>按钟表时间定时辰</option>
              </select>
              <div class="hint">真太阳时 = 钟表时间 + 经度时差 + 均时差。兰州与北京时间相差约一小时，时辰常因此改换。</div>
            </label>
          </div>

          <div class="card">
            <div class="card-title">所 问 之 事</div>
            <label class="fld"><span>问（一事一占，单一、具体、可验证）</span>
              <textarea id="c-question" placeholder="例：我以备考××大学研究生为唯一主线，正常完成课程设计，仅用少量时间精投数家保底，请问能否在××年初试过线、复试后被录取？">${h(form.question)}</textarea>
            </label>
            <label class="fld"><span>类别</span>
              <div class="chips" id="c-cats">
                <span class="chip on" data-v="">不分类</span>
                ${meta.categories.map((c) => `<span class="chip" data-v="${attr(c)}">${h(c)}</span>`).join('')}
              </div>
            </label>
            <label class="fld"><span>标题（留空则取所问前段）</span>
              <input type="text" id="c-title" placeholder="如：考研主线之占">
            </label>
            <div class="chips">
              <button class="btn sm" id="c-ask" title="把报数、时间与所问交给助手，由它起卦、断语并填好整条卦录">✦ 让 助 手 替 我 起 这 卦</button>
              <span class="dim tiny" style="align-self:center">报数仍须你自己给——那是你的数，别人替不了</span>
            </div>
          </div>
        </div>

        <div class="preview" id="c-preview">
          <div class="empty"><div class="big">䷀</div>填好左侧，卦象与断语即时显现。<br>
            <span class="small">懒得填？在「所问之事」里点「✦ 让助手替我起这卦」——你只给报数和所问，剩下的它来。</span></div>
        </div>
      </div>`;

    let current = null;

    async function refresh() {
      const prev = document.getElementById('c-preview');
      prev.innerHTML = '<div class="empty"><div class="big">☯</div>推演中…</div>';
      try {
        const payload = collect();
        const { chart, reading } = await api.post('/api/cast', payload);
        current = { chart, reading, payload };
        prev.innerHTML = `
          <div class="card tight">
            <div class="chips" style="justify-content:space-between">
              <span class="gold" style="letter-spacing:3px">${h(chart.ben.fullName)}${h(chart.ben.symbol)}　动 ${h(chart.moving.yaoTitle)}</span>
              ${gradeTag(chart.score.grade)}
            </div>
            <div class="hr"></div>
            ${hexRowHtml(chart)}
            <div class="hr"></div>
            ${liuyaoHtml(chart)}
            ${tiyongHtml(chart)}
            <div class="hr"></div>
            <ol class="cast-steps">${(chart.casting.steps || []).map((s) => `<li>${h(s)}</li>`).join('')}</ol>
            <div class="small dim">真太阳时 ${h(chart.calendar.trueSolarTime)}　${h(chart.calendar.trueHourZhi)}时（取数 ${chart.calendar.trueHourNumber}）　${h(chart.calendar.yearGanZhi)}年 ${h(chart.calendar.monthZhi)}月 ${h(chart.calendar.dayGanZhi)}日</div>
            <div class="chips" style="margin-top:14px">
              <button class="btn primary" id="c-save">录 下 此 卦</button>
              <button class="btn ghost sm" id="c-copy">复制卦签</button>
            </div>
          </div>
          <div style="margin-top:6px">${readingHtml(reading, { chart, score: false })}</div>`;
        prev.querySelector('#c-save').addEventListener('click', save);
        prev.querySelector('#c-copy').addEventListener('click', async () => {
          await navigator.clipboard.writeText(`${chart.ben.fullName}${chart.ben.symbol} 动${chart.moving.yaoTitle}｜${reading.signature}`);
          toast('卦签已复制');
        });
      } catch (err) {
        // 「还缺什么」不是错误，是提示——用中性样式，别吓人
        prev.innerHTML = err.missing
          ? `<div class="empty"><div class="big">䷀</div>还差：<span class="gold">${h(err.missing.join('、'))}</span><br>
              <span class="small">这三样不能替你猜——报数是你的数，卦才算在你身上。</span></div>`
          : `<div class="card err">起卦失败：${h(err.message)}</div>`;
      }
    }

    /**
     * 收表单。**缺什么就报什么，不替你补默认值。**
     * 报数、本卦、动爻是「你的」——预填或兜底等于替人起卦，会把卦算到别人身上。
     */
    function collect() {
      const method = document.getElementById('c-method').value;
      const raw = String(document.getElementById('c-numbers').value || '').trim();
      const nums = raw
        .split(/[\s,，、/]+/).map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0);
      const placeSel = document.getElementById('c-place').value;
      const p = meta.places.find((x) => x.name === placeSel);
      const lonRaw = document.getElementById('c-lon').value;
      const hex = String(document.getElementById('c-hex').value || '').trim();
      const mposRaw = document.getElementById('c-mpos').value;

      const missing = [];
      if (!fromLocalInput(document.getElementById('c-time').value)) missing.push('起卦时间');
      if (method === 'manual') {
        if (!hex) missing.push('本卦');
        if (!mposRaw) missing.push('动爻');
      } else if (!nums.length) {
        missing.push('报数');
      }
      if (lonRaw === '' || !Number.isFinite(Number(lonRaw))) missing.push('经度');
      if (p === null && placeSel !== '__custom' && !missing.includes('经度')) {
        // 内置地点里没有这个值，可能是「自定义经度」但没填数
        missing.push('地点（选了自定义却没填经度）');
      }
      if (missing.length) {
        const err = new Error(`还缺：${missing.join('、')}。起卦这三样不能替你猜，填上再起。`);
        err.missing = missing;
        throw err;
      }

      return {
        method,
        numbers: nums,
        localTime: fromLocalInput(document.getElementById('c-time').value),
        placeName: placeSel === '__custom' ? '' : placeSel,
        longitude: Number(lonRaw),
        useTrueSolarTime: document.getElementById('c-true').value === '1',
        movingFrom: document.getElementById('c-movingfrom').value,
        hexagram: hex,
        movingPosition: mposRaw ? Number(mposRaw) : undefined,
        question: document.getElementById('c-question').value,
        category: document.querySelector('#c-cats .chip.on')?.dataset.v || '',
        _place: p,
      };
    }

    async function save() {
      if (!current) return;
      const p = collect();
      const body = {
        mode: p.method === 'manual' ? 'hexagram' : 'cast',
        method: p.method,
        numbers: p.numbers,
        localTime: p.localTime,
        placeName: p.placeName,
        longitude: p.longitude,
        useTrueSolarTime: p.useTrueSolarTime,
        movingFrom: p.movingFrom,
        hexagram: p.hexagram,
        movingPosition: p.movingPosition,
        question: p.question,
        category: p.category,
        title: document.getElementById('c-title').value,
        origin: { kind: 'cast', label: '本机起卦' },
      };
      const { record } = await api.post('/api/records', body);
      toast('已录下此卦');
      ctx.navigate(`#/record/${record.id}`);
    }

    return {
      html,
      mount(root) {
        const syncGroups = () => {
          const m = root.querySelector('#c-method').value;
          root.querySelector('#g-number').style.display = m === 'manual' || m === 'timeOnly' ? 'none' : '';
          root.querySelector('#g-hex').style.display = m === 'manual' ? '' : 'none';
          root.querySelector('#g-movefrom').style.display = m === 'numberAndTime' ? '' : 'none';
          const hint = meta.methods.find((x) => x.id === m)?.hint || '';
          root.querySelector('#c-hint').textContent = hint;
        };
        syncGroups();
        const deb = debounce(refresh, 420);
        root.querySelector('#c-method').addEventListener('change', () => { syncGroups(); deb(); });
        root.querySelectorAll('input, select, textarea').forEach((el) => {
          el.addEventListener('input', deb);
          el.addEventListener('change', deb);
        });
        root.querySelector('#c-place').addEventListener('change', (e) => {
          const p = meta.places.find((x) => x.name === e.target.value);
          if (p) root.querySelector('#c-lon').value = p.longitude;
          deb();
        });
        root.querySelectorAll('#c-cats .chip').forEach((c) => c.addEventListener('click', () => {
          root.querySelectorAll('#c-cats .chip').forEach((x) => x.classList.toggle('on', x === c));
          deb();
        }));

        // —— 交给助手：它起卦、断语，并把整条卦录填好（第 5 条） ——
        root.querySelector('#c-ask')?.addEventListener('click', () => {
          const ask = ctx.meta?.askAssistant;
          if (!ask) return;
          const num = String(root.querySelector('#c-numbers').value || '').trim();
          const q = String(root.querySelector('#c-question').value || '').trim();
          const when = root.querySelector('#c-time').value;
          const place = root.querySelector('#c-place').value;
          const cat = root.querySelector('#c-cats .chip.on')?.dataset.v || '';
          ask([
            '请替我完整起一卦并存进卦录。要求：',
            num ? `- 报数：${num}` : '- 报数：**我还没给，先问我要**（这个数必须我来定，你不能替我编）',
            `- 起卦时间：${when || '（没填，用此刻并说明）'}`,
            `- 地点：${place === '__custom' ? '自定义经度' : place}`,
            cat ? `- 类别：${cat}` : '- 类别：你看所问替我判断',
            q ? `- 所问：${q}` : '- 所问：**我还没写，先问我**',
            '',
            '其余的都你来：用 cast 或 save_record 拿卦象（**卦象必须由工具算出，不许自己编**），',
            '然后替我写好标题、把所问补成一句可验证的话、给出七段定调与通俗解，最后存下来并告诉我卦录 id。',
          ].join('\n'));
        });

        // 一进来字段是空的，不必先跑一次；用户一填就会 deb() 触发
      },
    };
  },
};

/* ============================================================
 * 导入
 * ========================================================== */
export const importDesk = {
  title: '导 入 与 格 式',
  desc: '把别处的起卦文本整段粘进来，自动认出卦、爻、时、数、体用，逐条复核后入库；卦条规范、字段字典与版本迁移也在这里——规范只此一份。',
  async render(ctx) {
    // 规范与导入库是同一件事的两面：粘进来的东西要按卦条规范认，认完就入库。
    // 所以模板、字段字典、版本迁移都并到这一页，不再另开「格式」页（两处必然对不上）。
    const [meta, { spec }] = await Promise.all([api.get('/api/meta'), api.get('/api/spec')]);
    await hexagrams(); // 预热卦典，供 blockHtml 取卦符
    let blocks = [];

    const aliasRows = Object.entries(spec.guaTiao.fieldAliases)
      .map(([field, names]) => `<tr><td class="mono gold">${h(field)}</td><td>${names.map((n) => `<span class="chip static">${h(n)}</span>`).join(' ')}</td></tr>`)
      .join('');

    const html = `
      <div class="card">
        <div class="card-title">一 · 粘 贴 解 析</div>
        <textarea id="i-text" style="min-height:200px" placeholder="把整段起卦对话粘在这里（含「### 🌿 起卦推算 / 本卦：… / 动爻：… / 体用：…」最好；对照表、单行也行）"></textarea>
        <div class="chips" style="margin-top:12px">
          <button class="btn primary" id="i-parse">解 析</button>
          <label class="btn ghost" style="cursor:pointer">读取文本文件<input type="file" id="i-file" accept=".md,.txt,.json" style="display:none"></label>
          <label class="btn ghost" style="cursor:pointer">恢复 JSON 备份<input type="file" id="i-restore" accept=".json" style="display:none"></label>
          <button class="btn ghost" id="i-clear">清 空</button>
          <span style="flex:1"></span>
          <button class="btn sm" id="i-ask" title="把这段交给助手，让它整理成卦条并逐条核对">✦ 让 助 手 来 录</button>
        </div>
        <div class="hint" style="margin-top:8px">解析原则：宁可少认，不可错认。认不准的会标红，原文一律整段存录，复核后即可入库。</div>
      </div>

      <div id="i-result"></div>

      <div class="card">
        <div class="card-title">二 · 卦 条 v1（手 写 的 导 入 格 式）</div>
        <div class="small muted" style="margin-bottom:8px">
          一行一个字段的纯文本，人三十秒能写完，脚本能生成，AI 能照着写。多条用一行
          <span class="mono">---</span> 分隔；字段名可用中文全称或简写，见下面的字段字典。
          认不准的会报缺，不会瞎猜。
        </div>
        <pre class="md-code" id="i-template"><code>${h(spec.guaTiao.template)}</code></pre>
        <div class="chips">
          <button class="btn primary sm" id="i-tpl-copy">复 制 模 板</button>
          <button class="btn sm" id="i-tpl-load">载 入 到 粘 贴 框</button>
          <button class="btn sm ghost" id="i-tpl-download">下载模板文件</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">三 · 字 段 字 典（卦 条）</div>
        <div style="overflow-x:auto"><table class="md-table">
          <thead><tr><th style="width:170px">内部字段</th><th>可写的键名（任选其一）</th></tr></thead>
          <tbody>${aliasRows}</tbody></table></div>
        <div class="hr"></div>
        <div class="grid c2">
          <div><div class="small gold" style="margin-bottom:6px">起卦法的中文名</div>
            ${Object.entries(spec.guaTiao.methodLabels).map(([k, v]) => `<div class="small muted"><span class="mono gold">${h(v)}</span> → ${h(k)}</div>`).join('')}</div>
          <div><div class="small gold" style="margin-bottom:6px">必填</div>
            <div class="small muted">时（起卦时间）必填。<br>
            「法」为已知卦象时须填「本卦」与「动」；<br>
            其余起卦法须填「数」与「动」。<br>
            缺什么就报什么——解析器宁可报缺，也不猜。</div></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">四 · 卦 录 JSON：版 本 与 迁 移</div>
        <div class="grid c3">
          <div class="stat"><div class="n">v${spec.schemaVersion}</div><div class="l">当 前 结 构 版 本</div></div>
          <div class="stat"><div class="n">${spec.migrations.length}</div><div class="l">已 登 记 迁 移</div></div>
          <div class="stat"><div class="n">${spec.record.required.length}</div><div class="l">根 级 必 填 字 段</div></div>
        </div>
        <div class="small muted" style="margin:12px 0">
          每条卦录带 <span class="mono">schema</span> 号。载入时若版本低于当前，按登记顺序逐级迁移；
          <b>迁移前原件自动备份到 <span class="mono">data/backups/pre-migration/</span></b>，可回退。
          迁移登记表见 <span class="mono">core/migrate.mjs</span>。
        </div>
        <div class="chips">
          <a class="btn sm ghost" href="/api/schema/record" target="_blank">看卦录 schema</a>
          <a class="btn sm ghost" href="/api/schema/gua-tiao" target="_blank">看卦条 schema</a>
          <a class="btn sm ghost" href="/api/export?format=json" download>整包备份（JSON）</a>
        </div>
      </div>

      <div class="card">
        <div class="card-title">五 · 命 令 行 与 Agent</div>
        <div class="small muted" style="margin-bottom:8px">同样的解析器，三个入口，行为一致：</div>
        <pre class="md-code"><code>${h(`# 命令行
node tools/import.mjs --template > 我的卦条.txt     # 生成模板
node tools/import.mjs 我的卦条.txt --dry            # 先看认得对不对
node tools/import.mjs 我的卦条.txt                  # 真入库
node tools/validate.mjs                            # 校验全部卦录
node tools/validate.mjs 我的卦条.txt                # 只校验这个文件

# 让 AI 直接录（AI 助手页 / MCP）：工具 save_gua_tiao，参数 { text: "卦条文本" }`)}</code></pre>
        <div class="small dim">可用类别：${spec.categories.map((c) => `<span class="chip static">${h(c)}</span>`).join(' ')}</div>
        <div class="small dim" style="margin-top:6px">复盘状态：${spec.reviewStatuses.map((c) => `<span class="chip static">${h(c)}</span>`).join(' ')}</div>
      </div>`;

    const box = document.createElement('div');

    function blockHtml(b, i) {
      const f = b.fields || {};
      const cl = b.claimed || {};
      const conf = b.confidence ?? 0;
      const tone = conf >= 80 ? 'good' : conf >= 50 ? 'warn' : 'bad';
      const mode = (cl.ben && cl.moving) ? 'hexagram' : (f.numbers?.length && f.localTime ? 'cast' : '');
      return `<div class="import-block" data-i="${i}">
        <div class="hd">
          <span class="sym">${h(hexSymbolOf(cl.ben))}</span>
          <b>${h(cl.ben || '未认出本卦')}</b>
          ${cl.hu ? `<span class="dim small">互 ${h(cl.hu)}</span>` : ''}
          ${cl.bian ? `<span class="dim small">变 ${h(cl.bian)}</span>` : ''}
          ${cl.moving ? `<span class="tag warn">动第${cl.moving}爻</span>` : '<span class="tag bad">未认出动爻</span>'}
          <span class="tag ${tone}">识别度 ${conf}%</span>
          ${b.missing?.length ? `<span class="tag bad">缺：${h(b.missing.join('、'))}</span>` : ''}
          <span style="flex:1"></span>
          <button class="btn primary sm" data-act="one" data-i="${i}">入 库</button>
        </div>
        <div class="fv">
          <div><label>起卦时间</label><input type="text" data-f="localTime" data-i="${i}" value="${attr(f.localTime || '')}" placeholder="2026-09-28 03:12"></div>
          <div><label>地点</label><input type="text" data-f="placeName" data-i="${i}" value="${attr(f.placeName || '')}"></div>
          <div><label>经度</label><input type="text" data-f="longitude" data-i="${i}" value="${attr(f.longitude ?? '')}"></div>
          <div><label>报数</label><input type="text" data-f="numbers" data-i="${i}" value="${attr((f.numbers || []).join(' '))}"></div>
          <div><label>本卦</label><input type="text" data-f="hexagram" data-i="${i}" value="${attr(cl.ben || '')}"></div>
          <div><label>动爻</label><input type="text" data-f="movingPosition" data-i="${i}" value="${attr(cl.moving || '')}"></div>
          <div><label>类别</label><select data-f="category" data-i="${i}">
            <option value="">自动</option>
            ${meta.categories.map((c) => `<option value="${attr(c)}" ${c === (f.category || '') ? 'selected' : ''}>${h(c)}</option>`).join('')}
          </select></div>
          <div><label>定时辰</label><select data-f="useTrueSolarTime" data-i="${i}">
            <option value="">自动（${f.useTrueSolarTime === false ? '钟表' : '真太阳'}）</option>
            <option value="1">真太阳时</option><option value="0">钟表时间</option>
          </select></div>
          <div><label>入库方式</label><select data-f="mode" data-i="${i}">
            <option value="hexagram" ${mode === 'hexagram' ? 'selected' : ''}>指定本卦＋动爻（忠于原卦）</option>
            <option value="cast" ${mode === 'cast' ? 'selected' : ''}>按报数＋时间重起</option>
          </select></div>
        </div>
        <div style="margin-top:10px"><label class="fld" style="margin:0"><span>所问之事</span>
          <textarea data-f="question" data-i="${i}" style="min-height:60px">${h(f.question || '')}</textarea></label></div>
        <details class="fmt" style="margin-top:8px">
          <summary>补充存录（背景／原文／方案／问答／人工校勘，都可省）</summary>
          <div style="margin-top:9px">
            <label class="fld" style="margin-bottom:8px"><span>背景</span><textarea data-bf="background" data-i="${i}" style="min-height:60px">${h(b.background || '')}</textarea></label>
            <label class="fld" style="margin-bottom:8px"><span>原文（解读全文）</span><textarea data-bf="narrative" data-i="${i}" style="min-height:80px">${h(b.narrative || '')}</textarea></label>
            <label class="fld" style="margin-bottom:8px"><span>方案</span><textarea data-bf="plan" data-i="${i}" style="min-height:60px">${h(b.plan || '')}</textarea></label>
            <label class="fld" style="margin-bottom:8px"><span>原文问答</span><textarea data-bf="qa" data-i="${i}" style="min-height:60px">${h(b.qa || '')}</textarea></label>
            <label class="fld" style="margin-bottom:0"><span>人工校勘</span><textarea data-bf="collation" data-i="${i}" style="min-height:60px">${h(b.collation || '')}</textarea></label>
          </div>
        </details>
        <div class="small dim" style="margin-top:8px">识别到：时间 ${h((b.detected?.times || []).join(' ; ') || '—')}　卦名 ${h((b.detected?.hexagrams || []).join('、') || '—')}　体用 ${h(b.tiyongText || '—')}</div>
      </div>`;
    }

    function hexSymbolOf(name) {
      if (!name) return '䷀';
      const found = (HEX_CACHE || []).find((x) => x.fullName === name || x.name === name);
      return found?.symbol || '䷀';
    }

    function renderBlocks() {
      box.innerHTML = blocks.length
        ? `<div class="card tight"><div class="chips" style="justify-content:space-between">
             <span class="muted small">解析出 ${blocks.length} 个候选卦录</span>
             <span class="chips"><button class="btn primary sm" id="i-all">全 部 入 库</button>
             <button class="btn sm" id="i-invert">反 选</button></span>
           </div></div>
           ${blocks.map(blockHtml).join('')}`
        : '';
      if (!blocks.length) return;
      box.querySelector('#i-all')?.addEventListener('click', () => commit(blocks.map((_, i) => i)));
      box.querySelectorAll('[data-act="one"]').forEach((b) => b.addEventListener('click', () => commit([Number(b.dataset.i)])));
      box.querySelectorAll('input[data-f], select[data-f], textarea[data-f]').forEach((el) => {
        el.addEventListener('change', () => applyField(el));
        el.addEventListener('input', () => { if (el.tagName !== 'SELECT') applyField(el); });
      });
      // 补充存录写在块的顶层（与 narrative 同处），不是 fields 里
      box.querySelectorAll('textarea[data-bf]').forEach((el) => {
        el.addEventListener('input', () => { blocks[Number(el.dataset.i)][el.dataset.bf] = el.value; });
      });
    }

    function applyField(el) {
      const i = Number(el.dataset.i);
      const f = el.dataset.f;
      const b = blocks[i];
      if (f === 'numbers') b.fields.numbers = el.value.split(/[\s,，、/]+/).map(Number).filter(Boolean);
      else if (f === 'longitude') b.fields.longitude = el.value === '' ? null : Number(el.value);
      else if (f === 'movingPosition') b.claimed.moving = Number(el.value) || b.claimed.moving;
      else if (f === 'hexagram') b.claimed.ben = el.value || b.claimed.ben;
      else if (f === 'useTrueSolarTime') b.fields.useTrueSolarTime = el.value === '' ? b.fields.useTrueSolarTime : el.value === '1';
      else if (f === 'mode') b._mode = el.value;
      else b.fields[f] = el.value;
    }

    async function commit(indexes) {
      const items = indexes.map((i) => {
        const b = blocks[i];
        const el = box.querySelector(`.import-block[data-i="${i}"]`);
        return {
          block: b,
          overrides: {
            localTime: b.fields.localTime,
            placeName: b.fields.placeName,
            longitude: b.fields.longitude,
            numbers: b.fields.numbers,
            useTrueSolarTime: b.fields.useTrueSolarTime,
            category: b.fields.category,
            question: b.fields.question,
            hexagram: b.claimed.ben,
            movingPosition: b.claimed.moving,
            forceCast: b._mode === 'cast',
            forceHexagram: b._mode === 'hexagram',
            origin: { kind: 'import', label: '粘贴导入' },
            title: '',
          },
        };
      });
      try {
        const r = await api.post('/api/import/commit', { items });
        if (r.failed?.length) {
          toast(`入库 ${r.created.length} 条，失败 ${r.failed.length} 条`);
          console.warn(r.failed);
        } else {
          toast(`已入库 ${r.created.length} 条`);
        }
        ctx.reload();
      } catch (err) {
        toast(`入库失败：${err.message}`);
      }
    }

    return {
      html,
      mount(root) {
        box.id = 'i-result';
        root.querySelector('#i-result').replaceWith(box);
        root.querySelector('#i-parse').addEventListener('click', async () => {
          const text = root.querySelector('#i-text').value;
          if (!text.trim()) return toast('先粘一段东西进来');
          box.innerHTML = '<div class="card">解析中…</div>';
          try {
            const r = await api.post('/api/import/parse', { text });
            blocks = r.blocks || [];
            if (!blocks.length) {
              box.innerHTML = '<div class="card err">没能从中认出任何卦。请确认文本里含「本卦：×××」这样的字样，或直接到「起卦台」用「指定本卦与动爻」录入。</div>';
              return;
            }
            renderBlocks();
          } catch (err) {
            box.innerHTML = `<div class="card err">解析失败：${h(err.message)}</div>`;
          }
        });
        root.querySelector('#i-file').addEventListener('change', async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          root.querySelector('#i-text').value = await file.text();
          toast(`已读入 ${file.name}`);
        });
        root.querySelector('#i-restore').addEventListener('change', async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            const pack = JSON.parse(await file.text());
            const r = await api.post('/api/restore', pack);
            toast(`恢复完成：新增 ${r.added}，更新 ${r.updated}`);
            ctx.reload();
          } catch (err) {
            toast(`恢复失败：${err.message}`);
          }
        });
        root.querySelector('#i-clear').addEventListener('click', () => {
          root.querySelector('#i-text').value = '';
          blocks = [];
          box.innerHTML = '';
        });

        // —— 卦条模板：复制 / 载入到粘贴框 / 下载，三个入口都只对着上面那个粘贴框 ——
        const ta = root.querySelector('#i-text');
        root.querySelector('#i-tpl-copy').addEventListener('click', async () => {
          await navigator.clipboard.writeText(spec.guaTiao.template);
          toast('模板已复制');
        });
        root.querySelector('#i-tpl-load').addEventListener('click', () => {
          ta.value = spec.guaTiao.template;
          toast('已载入粘贴框，照着自己的情况改');
        });
        root.querySelector('#i-tpl-download').addEventListener('click', () => {
          const blob = new Blob([spec.guaTiao.template], { type: 'text/plain;charset=utf-8' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = '卦条-模板.txt';
          a.click();
        });

        // —— 交给助手：粘一大段懒得自己核对时走这条（与全局抽屉同一条通路） ——
        root.querySelector('#i-ask')?.addEventListener('click', () => {
          const text = ta.value.trim();
          const ask = ctx.meta?.askAssistant;
          if (!ask) return;
          ask(text
            ? `把下面这段起卦文本整理成「卦条 v1」并入库，逐条核对卦名、动爻与时间；认不准的先问我，不要猜。\n\n\`\`\`\n${text}\n\`\`\``
            : '我想录入一条旧卦，该怎么写卦条？');
        });
      },
    };
  },
};

/* ============================================================
 * 卦典
 * ========================================================== */
export const dian = {
  title: '卦 典',
  desc: '六十四卦全表：卦辞、大象、卦德、六爻爻辞。写作与断语皆可取材于此。',
  async render(ctx) {
    const hexes = await hexagrams();
    const state = { q: '' };
    const list = (q) => hexes.filter((x) => !q
      || `${x.id}${x.name}${x.fullName}${x.coreMeaning}${(x.keywords || []).join('')}`.includes(q));

    return {
      html: `
        <div class="card tight"><input type="text" id="d-q" placeholder="搜卦名、卦序、卦德，如 革 / 49 / 改命"></div>
        <div id="d-grid"></div>`,
      mount(root) {
        const grid = document.createElement('div');
        root.querySelector('#d-grid').replaceWith(grid);
        const paint = (q) => {
          grid.innerHTML = `<div class="grid c3">${list(q).map((x) => `
            <div class="card tight" data-id="${x.id}" style="cursor:pointer">
              <div style="display:flex;gap:14px;align-items:center">
                <div style="font-size:36px;color:var(--gold-3);line-height:1">${h(x.symbol)}</div>
                <div>
                  <div style="font-size:16px;letter-spacing:2px">${h(x.fullName)}</div>
                  <div class="small dim">${x.id}　${h(x.upper)}上${h(x.lower)}下　${h(x.fortune)}</div>
                  <div class="small muted">${h(x.coreMeaning)}</div>
                </div>
              </div>
            </div>`).join('')}</div>`;
          grid.querySelectorAll('[data-id]').forEach((el) => el.addEventListener('click', () => ctx.navigate(`#/dian/${el.dataset.id}`)));
        };
        paint('');
        root.querySelector('#d-q').addEventListener('input', debounce((e) => paint(e.target.value.trim()), 200));
      },
    };
  },
};

export const dianDetail = {
  title: '卦 典 · 详 情',
  async desc(ctx) {
    try {
      const { hexagram: g } = await api.get(`/api/knowledge/hexagrams/${encodeURIComponent(ctx.params.id)}`);
      return `${g.symbol} ${g.fullName}　第 ${g.id} 卦　${g.upper}上${g.lower}下　${g.palace || ''}　${g.fortune || ''}　——卦辞、大象、卦德与六爻爻辞。`;
    } catch {
      return '六十四卦之一：卦辞、大象、卦德与六爻爻辞。';
    }
  },
  async render(ctx) {
    const { hexagram: g, yaoci, yong } = await api.get(`/api/knowledge/hexagrams/${encodeURIComponent(ctx.params.id)}`);
    const lines = [];
    const tri = { 乾: [1, 1, 1], 兑: [1, 1, 0], 离: [1, 0, 1], 震: [1, 0, 0], 巽: [0, 1, 1], 坎: [0, 1, 0], 艮: [0, 0, 1], 坤: [0, 0, 0] };
    const six = [...(tri[g.lower] || []), ...(tri[g.upper] || [])];
    const fromKw = (kw) => kw;
    for (let i = 6; i >= 1; i -= 1) {
      const isYang = six[i - 1] === 1;
      lines.push(`<div class="row"><div class="pos">${['初', '二', '三', '四', '五', '上'][i - 1]}</div>
        <div class="bar${isYang ? '' : ' break'}">${isYang ? '<i></i>' : '<i></i><i></i>'}</div>
        <div class="t" style="width:auto;max-width:520px;text-align:left">${h(yaoci[i - 1]?.text || '')}</div></div>`);
    }
    const back = await hexagrams();
    const idx = back.findIndex((x) => x.id === g.id);
    const prev = back[(idx - 1 + 64) % 64];
    const next = back[(idx + 1) % 64];

    return {
      html: `
        <div class="toolbar">
          <span class="gold" style="font-size:15px;letter-spacing:1.5px">${h(g.fullName)} <span class="mono">${h(g.symbol)}</span></span>
          <span class="tb-sep"></span>
          <span class="muted tiny">第 ${g.id} 卦　${h(g.upper)}上${h(g.lower)}下　${h(g.palace || '')}　${h(g.fortune)}</span>
          <span style="flex:1"></span>
          <button class="btn sm ghost" data-go="#/dian/${prev.id}">← ${h(prev.fullName)}</button>
          <button class="btn sm ghost" data-go="#/dian/${next.id}">${h(next.fullName)} →</button>
          <button class="btn sm ghost" data-go="#/dian">全 表</button>
        </div>

        <div class="card">
          <div class="card-title">卦 德</div>
          <div style="font-size:17px;color:var(--gold-3);letter-spacing:2px">${h(g.coreMeaning)}</div>
          <div class="chips" style="margin-top:10px">${(g.keywords || []).map((k) => `<span class="chip static">${h(fromKw(k))}</span>`).join('')}</div>
          <div class="hr"></div>
          <div class="classic"><div class="t">「${h(g.guaci)}」</div><span class="s">《${h(g.name)}·卦辞》</span></div>
          <div class="classic"><div class="t">「${h(g.xiang)}」</div><span class="s">《${h(g.name)}·象传》</span></div>
          <div class="muted small" style="margin-top:10px">用世之道：${h(g.advice || '—')}</div>
        </div>

        <div class="card"><div class="card-title">六 爻 爻 辞</div>
          <div class="liuyao">${lines.join('')}</div>
          ${yong ? `<div class="hr"></div><div class="classic"><div class="t">「${h(yong)}」</div><span class="s">《${h(g.name)}·用》</span></div>` : ''}
        </div>`,
      mount(root) {
        root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => ctx.navigate(b.dataset.go)));
      },
    };
  },
};

/* ============================================================
 * 插件
 * ========================================================== */
export const pluginsView = {
  title: '插 件',
  desc: '一个插件就是一个 .mjs 文件，放在 data/plugins/ 下；改完点「热载」即可生效，不必重启。',
  async render(ctx) {
    const p = await api.get('/api/plugins');
    return {
      html: `
        <div class="card">
          <div class="card-title">已 装 插 件（${p.plugins.length}）</div>
          <div class="rec-list">${p.plugins.map((x) => `
            <div class="card tight" style="margin:0">
              <div class="chips" style="justify-content:space-between">
                <span><b>${h(x.name)}</b> <span class="dim mono small">v${h(x.version)}</span>
                  ${x.loaded ? '<span class="tag good">已载入</span>' : '<span class="tag bad">未载入</span>'}</span>
                <span class="chips">
                  ${x.pages.map((pg) => `<button class="btn sm" data-page="${attr(x.id)}/${attr(pg.id)}">${h(pg.icon || '◇')} ${h(pg.label)}</button>`).join('')}
                  <button class="btn sm ${x.enabled ? 'danger' : 'primary'}" data-toggle="${attr(x.id)}" data-on="${x.enabled ? '0' : '1'}">${x.enabled ? '停 用' : '启 用'}</button>
                </span>
              </div>
              <div class="small muted" style="margin-top:6px">${h(x.description || '（无说明）')}</div>
              ${x.panels.length ? `<div class="small dim">卦录详情面板：${x.panels.map((pp) => h(pp.label)).join('、')}</div>` : ''}
              ${x.exporters.length ? `<div class="small dim">导出格式：${x.exporters.map((e) => h(e.label)).join('、')}</div>` : ''}
              ${x.routes.length ? `<div class="small dim mono">${x.routes.map((r) => h(r)).join('　')}</div>` : ''}
            </div>`).join('') || '<div class="empty"><div class="big">◇</div>data/plugins/ 目录是空的。</div>'}
          </div>
          <div class="chips" style="margin-top:14px">
            <button class="btn primary" id="p-reload">热 载 全 部 插 件</button>
            <span class="dim small" style="align-self:center">插件目录：<span class="mono">${h(p.dir)}</span></span>
          </div>
          ${p.errors?.length ? `<div class="hr"></div><div class="card-title" style="color:var(--cinnabar-2)">载入错误</div>
            ${p.errors.map((e) => `<div class="classic" style="border-left-color:var(--cinnabar)"><div class="t err">${h(e)}</div></div>`).join('')}` : ''}
        </div>
        <div class="card">
          <div class="card-title">写 一 个 插 件</div>
          <pre class="md-code"><code>${h(`// data/plugins/my-plugin.mjs
export default {
  id: 'my-plugin',
  name: '我的插件',
  version: '1.0.0',
  description: '一句话说明',

  activate(ctx) {
    // 1) 加接口：GET /api/plugins/my-plugin/hello
    ctx.registerRoute('GET', 'hello', ({ json }) => json({ ok: true, hi: '你好' }));

    // 2) 加一个侧栏页面
    ctx.registerPage({
      id: 'main', label: '我的面板', icon: '◆',
      render: ({ store, core }) => ({
        html: '<p>共 ' + store.list().length + ' 条卦录</p>',
      }),
    });

    // 3) 在每条卦录详情页加一块
    ctx.registerPanel({
      id: 'note', label: '我的批注',
      render: ({ record }) => ({ html: '<p>本卦 ' + record.chart.ben.fullName + '</p>' }),
    });

    // 4) 加一种导出格式：/api/records/<id>/export?format=my-fmt
    ctx.registerExporter({
      id: 'my-fmt', label: '我的格式', ext: 'txt',
      render: (rec, { core }) => core.render.toSlip(rec),
    });

    // 5) 监听事件
    ctx.on('record.created', (rec) => ctx.log('新卦录', rec.id));

    // ctx.store / ctx.core / ctx.config / ctx.log 随取随用
  },
};`)}</code></pre>
        </div>`,
      mount(root) {
        root.querySelector('#p-reload').addEventListener('click', async () => {
          const r = await api.post('/api/plugins/reload');
          toast(`已热载：${r.plugins.filter((x) => x.loaded).length} 个`);
          // 先重取 meta：插件页面与「N 插件」计数挂在侧栏上，不重取就还是旧的
          await ctx.refreshMeta?.();
          ctx.reload();
        });
        root.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => {
          const [pid, pageId] = b.dataset.page.split('/');
          ctx.navigate(`#/plugin/${pid}/${pageId}`);
        }));
        root.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
          const on = b.dataset.on === '1';
          const id = b.dataset.toggle;
          // 停用是「入口会消失」的操作，先问一句——不然用户点了才发现页面不见了
          if (!on) {
            const yes = await new Promise((res) => {
              modal(`<div class="card-title">停用插件「${h(id)}」？</div>
                <div class="small" style="margin-bottom:8px">它的页面会从侧栏「更多」里撤掉，接口与面板一并失效；
                  插件文件本身不动，随时可以再启用。</div>
                <div class="chips"><button class="btn primary sm" id="pl-ok">停 用</button>
                  <button class="btn sm ghost" id="pl-no">取 消</button></div>`, (r2) => {
                r2.querySelector('#pl-ok').addEventListener('click', () => { r2.closest('.modal-mask')?.remove(); res(true); });
                r2.querySelector('#pl-no').addEventListener('click', () => { r2.closest('.modal-mask')?.remove(); res(false); });
              });
            });
            if (!yes) return;
          }
          try {
            await api.post(`/api/plugins/${encodeURIComponent(id)}/toggle`, { enabled: on });
            toast(on ? '已启用' : '已停用');
            await ctx.refreshMeta?.();
            ctx.reload();
          } catch (err) {
            toast(`切换失败：${err.message}`);
          }
        }));
      },
    };
  },
};

export const pluginPage = {
  title: '插 件 页 面',
  desc: (ctx) => `来自插件 ${ctx.params.pid} 的自定义页面。插件页面也在命令面板里可以直接搜到。`,
  async render(ctx) {
    const { pid, pageId } = ctx.params;
    const out = await api.get(`/api/plugins/${encodeURIComponent(pid)}/page/${encodeURIComponent(pageId)}`);
    const page = out.page || out;
    return {
      html: `<div class="toolbar">
          <span class="tb-label">插件</span><span class="mono small">${h(pid)}</span>
          <span class="tb-sep"></span><span class="muted small">${h(page.label || pageId)}</span>
          <span style="flex:1"></span>
          <button class="btn sm ghost" data-go="#/plugins">← 回 插 件 列 表</button>
        </div>
        <div class="card">${page.html || `<pre class="md-code"><code>${h(JSON.stringify(page.data ?? page, null, 2))}</code></pre>`}</div>`,
      mount(root) {
        root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => ctx.navigate(b.dataset.go)));
      },
    };
  },
};

/* ============================================================
 * 走势（多领域多线叠加）
 * ========================================================== */
export const trendView = {
  title: '走 势',
  desc: '把卦录按时间铺开，多个领域叠在同一张图里：同向是彼此印证，背离是卦气与结论有张力。点图上任一处可跳回那一卦。',
  async render(ctx) {
    const meta = await api.get('/api/meta');
    const state = {
      // 默认就是「领域运势 + 应验那天」：不同的事本来就是不同的运势线，
      // 而只看起卦那天会把半年后的事和今天的事挤在同一个点上。
      // 想看「我当时都问了什么」，一键切回「吉凶诸线 + 起卦那天」。
      mode: 'domain',
      domains: meta.domains.filter((d) => d.mode === 'fortune' && d.scale === 'signed').map((d) => d.id),
      rangeDays: 0,
      smooth: 1,
      xMode: 'index',
      /** 横轴：按起卦时间，还是按应验时间（长期之事会排到右侧未来） */
      axis: 'due',
      categories: [],
      hidden: new Set(),
    };
    let chart = null;
    let last = null;

    const MODES = [
      { id: 'fortune', label: '吉凶诸线' },
      { id: 'domain', label: '领域运势' },
      { id: 'element', label: '五行占比' },
      { id: 'category', label: '分类别均值' },
    ];
    const RANGES = [
      { v: 0, label: '全部' }, { v: 365, label: '一年' },
      { v: 90, label: '90 天' }, { v: 30, label: '30 天' }, { v: 7, label: '7 天' },
    ];
    const SMOOTHS = [1, 3, 5, 10];

    async function load() {
      const qs = new URLSearchParams({
        mode: state.mode,
        xMode: state.xMode,
        axis: state.axis,
        smooth: String(state.smooth),
        rangeDays: String(state.rangeDays),
      });
      if (state.mode === 'fortune' && state.domains.length) qs.set('domains', state.domains.join(','));
      if (state.categories.length) qs.set('categories', state.categories.join(','));
      const { trend } = await api.get(`/api/trend?${qs}`);
      last = trend;

      const sum = trend.series.find((s) => s.id === 'score') || trend.series[0];
      const vals = (sum?.values || []).filter((v) => v !== null && v !== undefined);
      const head = vals.length ? vals.slice(0, Math.max(1, Math.ceil(vals.length / 3))) : [];
      const tail = vals.length ? vals.slice(-Math.max(1, Math.ceil(vals.length / 3))) : [];
      const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);

      return {
        trend,
        head: avg(head),
        tail: avg(tail),
      };
    }

    function shell(trend, head, tail) {
      const fortuneMode = state.mode === 'fortune';
      return `
        <div class="card tight">
          <div class="grid c2" style="align-items:center;gap:14px">
            <div class="seg" id="t-mode">
              ${MODES.map((m) => `<button data-v="${m.id}" class="${state.mode === m.id ? 'on' : ''}">${m.label}</button>`).join('')}
            </div>
            <div class="chips" style="justify-content:flex-end">
              <span class="dim small" style="align-self:center">时间范围</span>
              ${RANGES.map((r) => `<span class="chip ${state.rangeDays === r.v ? 'on' : ''}" data-range="${r.v}">${r.label}</span>`).join('')}
            </div>
          </div>
          ${fortuneMode ? `
          <div class="hr"></div>
          <div class="chips" id="t-domains">
            <span class="dim small" style="align-self:center">叠加领域</span>
            ${meta.domains.filter((d) => d.mode === 'fortune').map((d) => `
              <span class="chip ${state.domains.includes(d.id) ? 'on' : ''}" data-domain="${attr(d.id)}" title="${attr(d.desc)}">
                <i style="display:inline-block;width:11px;height:3px;border-radius:2px;background:${d.color};margin-right:5px;vertical-align:2px"></i>${h(d.name)}</span>`).join('')}
          </div>` : ''}
          <div class="hr"></div>
          <div class="grid c2" style="gap:14px">
            <div class="chips">
              <span class="dim small" style="align-self:center">横轴落在哪天</span>
              <span class="chip ${state.axis === 'cast' ? 'on' : ''}" data-axis="cast">起卦那天</span>
              <span class="chip ${state.axis === 'due' ? 'on' : ''}" data-axis="due">应验那天</span>
            </div>
            <div class="chips" style="justify-content:flex-end">
              <span class="dim small" style="align-self:center">平滑窗口</span>
              ${SMOOTHS.map((s) => `<span class="chip ${state.smooth === s ? 'on' : ''}" data-smooth="${s}">${s === 1 ? '不平滑' : `${s} 卦`}</span>`).join('')}
            </div>
          </div>
          <div class="chips" style="margin-top:8px">
            <span class="dim small" style="align-self:center">横轴间距</span>
            <span class="chip ${state.xMode === 'index' ? 'on' : ''}" data-x="index">按卦序</span>
            <span class="chip ${state.xMode === 'time' ? 'on' : ''}" data-x="time">按时间比例</span>
            <span class="dim tiny" style="align-self:center">
              ${state.axis === 'due'
    ? '长期的事排在右侧未来；缺应期的卦退回按起卦时间放'
    : '所有卦都落在起卦那天；想看长期之事请切到「应验那天」'}
            </span>
          </div>
          ${trend.categories?.length ? `<div class="hr"></div>
          <div class="chips" id="t-cats">
            <span class="dim small" style="align-self:center">只看类别</span>
            ${trend.categories.map((c) => `<span class="chip ${state.categories.includes(c) ? 'on' : ''}" data-cat="${attr(c)}">${h(c)}</span>`).join('')}
          </div>` : ''}
        </div>

        <div class="card">
          <div class="card-title">卦 气 走 势
            <span class="sp dim small" style="letter-spacing:0;font-weight:400">${trend.points} 个点${trend.spanDays ? `　跨度 ${trend.spanDays} 天` : ''}${trend.useTimeAxis ? '　（横轴按时间比例）' : ''}${trend.dueFallback ? `　（${trend.dueFallback} 条缺应期，按起卦时间放）` : ''}</span>
          </div>
          <div class="chips" id="t-legend" style="margin-bottom:12px">${legendHtml(trend, state.hidden)}</div>
          <div id="t-chart"></div>
          <div class="hr"></div>
          <div class="grid c3">
            <div class="stat"><div class="n">${head ?? '—'}</div><div class="l">前 三 分 之 一 均 值</div></div>
            <div class="stat"><div class="n">${tail ?? '—'}</div><div class="l">后 三 分 之 一 均 值</div></div>
            <div class="stat"><div class="n" style="color:${head !== null && tail !== null && tail >= head ? 'var(--jade)' : 'var(--cinnabar-2)'}">
              ${head !== null && tail !== null ? (tail - head >= 0 ? '+' : '') + (Math.round((tail - head) * 10) / 10) : '—'}</div>
              <div class="l">起 落</div></div>
          </div>
          ${(trend.notes || []).length ? `<div class="small dim" style="margin-top:12px">${trend.notes.map((n) => `· ${h(n)}`).join('<br>')}</div>` : ''}
        </div>

        <div class="card">
          <div class="card-title">各 点 明 细</div>
          <div style="overflow-x:auto">
            <table class="md-table"><thead><tr>
              <th>#</th><th>起卦时间</th><th>卦</th><th>动</th><th>体用</th><th>类别</th><th>体五行</th><th>旺衰</th><th>总评</th><th>复盘</th>
            </tr></thead><tbody>
              ${trend.records.map((r, i) => `<tr data-id="${attr(r.id)}" style="cursor:pointer">
                <td>${i + 1}</td><td>${h(r.localTime)}</td>
                <td>${h(r.symbol)} ${h(r.ben)}</td><td>${h(r.grade)}</td>
                <td>${h(r.relation)}</td><td>${h(r.category)}</td>
                <td>${h(r.tiElement)}</td><td>${h(r.tiState)}</td>
                <td>${r.score === null ? '' : r.score}</td><td>${h(r.review)}</td></tr>`).join('')}
            </tbody></table>
          </div>
        </div>`;
    }

    function paint(box, trend) {
      if (chart) { chart.destroy(); chart = null; }
      chart = renderLineChart(box, trend, {
        height: 400,
        hidden: state.hidden,
        onPick: (id) => ctx.navigate(`#/record/${id}`),
      });
    }

    /** 重取数据、重绘整页。控件与图都在这一个函数里重建，状态只有一个来源。 */
    async function paintAll(root) {
      const { trend, head, tail } = await load();
      last = trend;
      if (chart) { chart.destroy(); chart = null; }
      root.innerHTML = shell(trend, head, tail);
      const box = root.querySelector('#t-chart');
      paint(box, trend);
      bind(root, () => paintAll(root), box);
    }

    const first = await load();
    last = first.trend;

    return {
      html: shell(first.trend, first.head, first.tail),
      mount(root) {
        const box = root.querySelector('#t-chart');
        paint(box, first.trend);
        bind(root, () => paintAll(root), box);
      },
    };

    /** 把控件与数据点都接上事件。函数声明会提升，故可写在 return 之后。 */
    function bind(root, repaint, box) {
      root.querySelectorAll('#t-mode button').forEach((b) => b.addEventListener('click', async () => {
        state.mode = b.dataset.v;
        state.hidden = new Set();
        await repaint();
      }));
      root.querySelectorAll('[data-range]').forEach((c) => c.addEventListener('click', async () => {
        state.rangeDays = Number(c.dataset.range);
        await repaint();
      }));
      root.querySelectorAll('[data-smooth]').forEach((c) => c.addEventListener('click', async () => {
        state.smooth = Number(c.dataset.smooth);
        await repaint();
      }));
      root.querySelectorAll('[data-x]').forEach((c) => c.addEventListener('click', async () => {
        state.xMode = c.dataset.x;
        await repaint();
      }));
      // 横轴落在起卦那天还是应验那天——长期与当下的事因此能分开看
      root.querySelectorAll('[data-axis]').forEach((c) => c.addEventListener('click', async () => {
        state.axis = c.dataset.axis;
        await repaint();
      }));
      root.querySelectorAll('[data-domain]').forEach((c) => c.addEventListener('click', async () => {
        const id = c.dataset.domain;
        const next = state.domains.includes(id) ? state.domains.filter((x) => x !== id) : [...state.domains, id];
        if (!next.length) { toast('至少留一个领域'); return; }
        state.domains = next;
        await repaint();
      }));
      root.querySelectorAll('[data-cat]').forEach((c) => c.addEventListener('click', async () => {
        const v = c.dataset.cat;
        state.categories = state.categories.includes(v) ? state.categories.filter((x) => x !== v) : [...state.categories, v];
        await repaint();
      }));
      // 图例点选：只重画图，不重取数
      root.querySelectorAll('#t-legend .chip.lg').forEach((c) => c.addEventListener('click', () => {
        const id = c.dataset.s;
        if (state.hidden.has(id)) state.hidden.delete(id);
        else if (state.hidden.size < (last?.series.length || 1) - 1) state.hidden.add(id);
        else { toast('至少留一条线'); return; }
        c.classList.toggle('off', state.hidden.has(id));
        paint(box, last);
      }));
      root.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => ctx.navigate(`#/record/${tr.dataset.id}`)));
    }
  },
};

/* ============================================================
 * AI 助手
 * ========================================================== */
export const agentView = {
  title: 'AI 助 手',
  desc: '能真正动手的助手：它自己调工具起卦、存档、写复盘、看走势——卦象一律由引擎算出，模型不许编。',
  async render(ctx) {
    let cfg = await api.get('/api/agent/config');
    let mcp = (await api.get('/api/agent/tools')).mcp;

    const provOpts = (sel) => cfg.config.providers
      .map((p) => `<option value="${attr(p.id)}" ${p.id === sel ? 'selected' : ''}>${h(p.name)}</option>`).join('');

    function settingsHtml() {
      const c = cfg.config;
      return `
        <div class="card">
          <div class="card-title">模 型 设 置
            <span class="sp tag ${c.ready ? 'good' : 'bad'}">${c.ready ? '已就绪' : h(c.reason || '未配置')}</span>
          </div>
          <div class="grid c2">
            <label class="fld"><span>服务商</span>
              <select id="a-provider">${provOpts(c.provider)}</select>
              <div class="hint" id="a-note">${h(c.providers.find((p) => p.id === c.provider)?.note || '')}</div>
            </label>
            <label class="fld"><span>模型名</span>
              <input type="text" id="a-model" value="${attr(c.model || '')}" placeholder="如 deepseek-chat">
            </label>
          </div>
          <label class="fld"><span>接口地址（OpenAI 兼容，留空用服务商默认）</span>
            <input type="text" id="a-base" value="${attr(c.baseUrl || '')}" placeholder="https://api.deepseek.com/v1">
          </label>
          <div class="grid c2">
            <label class="fld"><span>API Key ${c.apiKeySet ? '<span class="ok">（已保存）</span>' : '<span class="dim">（未设）</span>'}</span>
              <input type="password" id="a-key" placeholder="${c.apiKeySet ? '留空则不改动；输入新值即覆盖' : 'sk-…'}">
              <div class="hint">只存在本机 <span class="mono">data/config.json</span>，程序不会把它发往除该接口之外的任何地方。</div>
            </label>
            <label class="fld"><span>温度 / 最多工具轮数</span>
              <div style="display:flex;gap:8px">
                <input type="number" step="0.1" min="0" max="2" id="a-temp" value="${attr(c.temperature ?? 0.6)}">
                <input type="number" step="1" min="1" max="12" id="a-rounds" value="${attr(c.maxRounds ?? 6)}">
              </div>
            </label>
          </div>
          <label class="fld"><span>单 次 回 复 上 限（token，<span class="mono">0</span> = 交给服务商默认）</span>
            <input type="number" step="256" min="0" max="65536" id="a-maxtok" value="${attr(c.maxTokens ?? 0)}">
            <div class="hint">
              这一项<b>直接决定回答会不会被截成半句</b>：设小了，服务商会在写到一半时停住并回一个
              「length」的收尾原因，界面上就只剩半段话。不确定就填 <span class="mono">0</span>
              ——不发这个参数，用服务商自己的默认上限。
            </div>
          </label>
          <label class="fld"><span>工具调用方式</span>
            <select id="a-native">
              <option value="1" ${c.useNativeTools !== false ? 'selected' : ''}>原生 function calling（首选）</option>
              <option value="0" ${c.useNativeTools === false ? 'selected' : ''}>文本协议降级（本地小模型用这个）</option>
            </select>
          </label>
          <div class="chips">
            <button class="btn primary sm" id="a-save">保 存</button>
            <button class="btn sm" id="a-ping">测 连 通</button>
            <button class="btn sm ghost" id="a-models">拉 模 型 列 表</button>
            ${c.apiKeySet ? '<button class="btn sm danger" id="a-clearkey">清 除 Key</button>' : ''}
          </div>
          <div class="small dim" id="a-result" style="margin-top:10px"></div>
        </div>`;
    }

    /* ---------- 联网（工具来源：web） ---------- */
    function webHtml() {
      const w = cfg.config.web || {};
      return `<div class="card">
        <div class="card-title">联 网
          <span class="sp tag ${w.enabled ? 'warn' : 'neutral'}">${w.enabled ? '已开启' : '已停用'}</span>
        </div>
        <div class="small dim" style="margin-bottom:8px">
          助手可以按你给的链接抓一篇网页读回来（工具 <span class="mono">fetch_url</span>）。
          <b>每次调用都会先弹确认</b>，你点了才真去抓；内网、本机与云元数据地址一律拒绝。
          请求由这台机器发出，抓到的正文会离开本机——这一点请自行判断。
        </div>
        <label class="fld"><span>开关</span>
          <select id="w-on">
            <option value="1" ${w.enabled ? 'selected' : ''}>开启（每次调用仍需确认）</option>
            <option value="0" ${!w.enabled ? 'selected' : ''}>停用（工具从模型清单里消失）</option>
          </select>
        </label>
        <div class="grid c2">
          <label class="fld"><span>超时（毫秒）</span>
            <input type="number" min="1000" max="60000" step="1000" id="w-timeout" value="${attr(w.timeoutMs ?? 10000)}"></label>
          <label class="fld"><span>单页上限（字节）</span>
            <input type="number" min="4096" max="8388608" step="4096" id="w-max" value="${attr(w.maxBytes ?? 524288)}"></label>
        </div>
        <div class="grid c2">
          <label class="fld"><span>只允许这些域名（留空 = 不按域名预筛）</span>
            <input type="text" id="w-allow" value="${attr((w.allow || []).join(' '))}" placeholder="如 example.com"></label>
          <label class="fld"><span>拒绝这些域名</span>
            <input type="text" id="w-deny" value="${attr((w.deny || []).join(' '))}" placeholder="一般不填"></label>
        </div>
        <div class="chips"><button class="btn primary sm" id="w-save">保 存 联 网 设 置</button></div>
        <div class="small dim" id="w-out" style="margin-top:8px"></div>
      </div>`;
    }

    /** 工具按**来源**分组：内置的是这个程序自己的本事，联网是外面来的能力，两者不该混着看 */
    function toolListHtml() {
      const groups = new Map();
      for (const t of cfg.tools) {
        const k = t.sourceName || '内置';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(t);
      }
      return `<div class="card"><div class="card-title">可 用 工 具（${cfg.tools.length}）
        <span class="sp dim tiny">按来源分组；够不着的工具不会给模型</span></div>
        ${[...groups.entries()].map(([name, list]) => `
          <div class="small dim" style="margin:10px 0 6px;letter-spacing:1.5px">${h(name)}　${list.length} 个</div>
          <div class="grid c2">
            ${list.map((t) => `<div class="classic"><div class="t"><b>${h(t.name)}</b>　<span class="dim">${h(t.title)}</span>
              ${t.destructive ? '<span class="tag bad">执行前需确认</span>' : ''}${t.requireConfirm && !t.destructive ? `<span class="tag ${t.confirmKind === 'network' ? 'warn' : ''}">每次需确认</span>` : ''}
              ${t.allowed ? '' : '<span class="tag neutral">当前等级够不着</span>'}</div>
              <span class="s" style="text-align:left">${h(t.description)}</span></div>`).join('')}
          </div>`).join('')}
        <div class="hr"></div>
        <div class="card-title">接 给 外 部 Agent（MCP）</div>
        <div class="small dim" style="margin-bottom:8px">同一个工具集也走 MCP，Codex CLI / Claude Code / DSH 可直接驱动本程序：
          脚本 <span class="mono">${h(mcp.script)}</span>，工具 ${mcp.toolCount} 个。</div>
        <pre class="md-code"><code>${h(mcp.snippets.codex)}</code></pre>
        <pre class="md-code"><code>${h(mcp.snippets.claude)}</code></pre>
        <div class="chips"><button class="btn sm ghost" data-copy="${attr(mcp.snippets.codex)}">复制 Codex 配置</button>
          <button class="btn sm ghost" data-copy="${attr(mcp.snippets.claude)}">复制 MCP JSON</button></div>
      </div>`;
    }

    /**
     * 这一页**只留配置**，不放对话。
     *
     * 以前这里内嵌一个对话框，与右侧面板共用同一份状态——同一件事有两处入口，
     * 用户会问「侧栏那个对话还不够吗」。现在对话只长在右侧面板里（见 web/index.html
     * 的 .agent-panel），这一页只回答「模型怎么配、工具给了哪些、联网开不开」。
     */
    const fullHtml = () => settingsHtml() + webHtml() + toolListHtml();

    /** 设置改动后整页重绘（配置是唯一状态源，重绘比局部改写可靠） */
    async function repaint(root) {
      cfg = await api.get('/api/agent/config');
      root.innerHTML = fullHtml();
      bindAll(root);
    }

    function bindAll(root) {
      // —— 模型设置 ——
      root.querySelector('#a-provider')?.addEventListener('change', (e) => {
        const p = cfg.config.providers.find((x) => x.id === e.target.value);
        const note = root.querySelector('#a-note');
        if (note) note.textContent = p?.note || '';
        if (p?.baseUrl) root.querySelector('#a-base').value = p.baseUrl;
        if (p?.defaultModel) root.querySelector('#a-model').value = p.defaultModel;
      });
      root.querySelector('#a-save')?.addEventListener('click', async () => {
        const payload = {
          provider: root.querySelector('#a-provider').value,
          model: root.querySelector('#a-model').value.trim(),
          baseUrl: root.querySelector('#a-base').value.trim(),
          temperature: Number(root.querySelector('#a-temp').value) || 0.6,
          maxRounds: Number(root.querySelector('#a-rounds').value) || 6,
          // 0 是合法值（= 不发 max_tokens，交给服务商默认），所以不能用 `|| 默认值` 覆盖掉它
          maxTokens: Math.max(0, Number(root.querySelector('#a-maxtok').value) || 0),
          useNativeTools: root.querySelector('#a-native').value === '1',
        };
        const key = root.querySelector('#a-key').value.trim();
        if (key) payload.apiKey = key;
        try {
          const r = await api.post('/api/agent/config', payload);
          cfg.config = r.config;
          toast('已保存');
          await repaint(root);
        } catch (err) {
          toast(`保存失败：${err.message}`);
        }
      });
      root.querySelector('#a-clearkey')?.addEventListener('click', async () => {
        const r = await api.post('/api/agent/config', { clearApiKey: true });
        cfg.config = r.config;
        toast('已清除 Key');
        await repaint(root);
      });
      root.querySelector('#a-ping')?.addEventListener('click', async () => {
        const box = root.querySelector('#a-result');
        box.textContent = '测试中…';
        try {
          const r = await api.post('/api/agent/ping', {});
          box.innerHTML = r.ok
            ? `<span class="ok">连通正常</span>　${r.ms}ms　模式 ${h(r.mode)}　返回「${h(r.sample)}」`
            : `<span class="err">失败：${h(r.error)}</span>`;
        } catch (err) {
          box.innerHTML = `<span class="err">${h(err.message)}</span>`;
        }
      });
      root.querySelector('#a-models')?.addEventListener('click', async () => {
        const box = root.querySelector('#a-result');
        box.textContent = '拉取中…';
        try {
          const r = await api.get('/api/agent/models');
          box.innerHTML = r.models.length
            ? `可用模型（${r.models.length}）：${r.models.slice(0, 40).map((m) => `<span class="chip static">${h(m)}</span>`).join(' ')}`
            : '<span class="dim">该端点没有返回模型列表（不少兼容端点不支持 /models，直接手填模型名即可）。</span>';
        } catch (err) {
          box.innerHTML = `<span class="err">${h(err.message)}</span>`;
        }
      });

      // —— 联网设置 ——
      root.querySelector('#w-save')?.addEventListener('click', async () => {
        const box = root.querySelector('#w-out');
        const split = (v) => String(v || '').split(/[\s,，、]+/).map((s) => s.trim()).filter(Boolean);
        box.textContent = '保存中…';
        try {
          const r = await api.post('/api/agent/config', {
            web: {
              enabled: root.querySelector('#w-on').value === '1',
              timeoutMs: Number(root.querySelector('#w-timeout').value),
              maxBytes: Number(root.querySelector('#w-max').value),
              allow: split(root.querySelector('#w-allow').value),
              deny: split(root.querySelector('#w-deny').value),
            },
          });
          cfg.config = r.config;
          toast('联网设置已保存');
          await repaint(root);
        } catch (err) {
          box.innerHTML = `<span class="err">${h(err.message)}</span>`;
        }
      });

      // —— 工具清单与 MCP 配置 ——
      root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
        await navigator.clipboard.writeText(b.dataset.copy);
        toast('已复制');
      }));
    }

    return {
      html: fullHtml(),
      mount(root) {
        bindAll(root);
        if (!cfg.config.ready) toast('先把模型配好，助手才能动起来');
      },
    };
  },
};

/* ============================================================
 * 设置
 * ------------------------------------------------------------
 * 对齐 DSH 桌面端那种「一页把该配的都配完」的做法：
 * 助手权限、模型状态、数据位置，全在这一页。
 * 文档不在这儿读——它有自己的「文档」页，这里只留一个入口。
 * ========================================================== */
export const settingsView = {
  title: '设 置',
  desc: '助手权限、模型、数据位置与文档入口。这一页不开助手抽屉——在这儿配的就是它。',
  async render(ctx) {
    let cfg = await api.get('/api/agent/config');
    // meta 必须在**生成 HTML 之前**取好：放在 mount 里就晚了，
    // 那时 innerHTML 已经拼完，页面上会留下「? 条」这种空档
    let META_APP = ctx.meta?.app || {};
    let META_COUNTS = ctx.meta?.counts || {};
    let META_AGENT = ctx.meta?.agent || null;

    const c = () => cfg.config;

    /* ---------- 助手权限 ---------- */
    function permHtml() {
      const cur = c().permission;
      const counts = c().toolCounts || {};
      return `<div class="card">
        <div class="card-title">助 手 权 限
          <span class="sp tag ${cur === 'read' ? 'neutral' : 'warn'}">当前：${h(c().permissionLevels.find((l) => l.id === cur)?.name || cur)}</span>
        </div>
        <div class="small dim" style="margin-bottom:8px">
          助手能做什么，由这一档决定。给模型的工具清单会<b>按这一档裁剪</b>——够不着的工具它根本看不到，
          也不会去调。内置助手与外部 agent（MCP）受同一档管辖。
        </div>
        <div class="grid c2" id="s-perms">
          ${cfg.permissions.map((l) => `
            <div class="perm ${l.id === cur ? 'on' : ''}" data-perm="${attr(l.id)}">
              <div class="ph"><b>${h(l.name)}</b><span class="sp dim tiny">${counts[l.id] ?? '?'} 个工具</span></div>
              <div class="pd">${mdInline(l.desc)}</div>
            </div>`).join('')}
        </div>
        <div class="hr"></div>
        <div class="small dim">
          破坏性操作（<span class="mono">${h(META_AGENT?.destructiveTools?.join('、') || 'delete_record、update_config')}</span>）
          即使权限够，也会<b>先停下等你确认</b>才执行；删除一律是软删，可从回收目录恢复。
        </div>
      </div>`;
    }

    /* ---------- 模型 ---------- */
    function modelHtml() {
      const x = c();
      return `<div class="card">
        <div class="card-title">模 型
          <span class="sp tag ${x.ready ? 'good' : 'bad'}">${x.ready ? '已就绪' : h(x.reason || '未配置')}</span>
        </div>
        <dl class="kv">
          <dt>服务商</dt><dd>${h(x.providers.find((p) => p.id === x.provider)?.name || x.provider)}</dd>
          <dt>模型</dt><dd class="mono">${h(x.model || '（未设）')}</dd>
          <dt>接口</dt><dd class="mono small">${h(x.baseUrl || '（用服务商默认）')}</dd>
          <dt>协议</dt><dd class="mono small">${h(x.protocol || 'auto')}</dd>
          <dt>密钥</dt><dd>${x.apiKeySet ? '<span class="ok">已保存</span>' : '<span class="dim">未设</span>'}</dd>
        </dl>
        <div class="chips" style="margin-top:8px">
          <button class="btn sm" data-go="#/agent">到「助手」页改模型设置</button>
          <button class="btn sm ghost" id="s-ping">测 连 通</button>
        </div>
        <div class="small dim" id="s-ping-out" style="margin-top:8px"></div>
      </div>`;
    }

    /* ---------- 数据 ---------- */
    function dataHtml() {
      const d = window.__qxgDesktop;
      return `<div class="card">
        <div class="card-title">数 据</div>
        <dl class="kv">
          <dt>数据目录</dt><dd class="mono small" style="word-break:break-all">${h((META_APP || {}).dataDir || '')}</dd>
          <dt>位置类型</dt><dd>${h(((META_APP || {}).dataMode) === 'appdata' ? '用户目录（安装态）' : '项目目录（开发态）')}</dd>
          <dt>卦录</dt><dd>${(META_COUNTS || {}).total ?? '?'} 条</dd>
        </dl>
        <div class="chips" style="margin-top:8px">
          ${d ? '<button class="btn sm" id="s-opendata">打开数据目录</button>'
    + '<button class="btn sm ghost" id="s-backup">导出整包备份到…</button>'
    + '<button class="btn sm ghost" id="s-changedir">更换数据目录…</button>'
    + '<button class="btn sm ghost" id="s-opentrash">打开回收目录</button>' : '<span class="dim small">（桌面版可在此直接打开数据目录）</span>'}
          <a class="btn sm ghost" href="/api/export?format=md" download>导出全部 Markdown</a>
        </div>
        <div class="small dim" style="margin-top:8px">
          卦录在 <span class="mono">data/records/</span> 下一个卦一个 JSON；删除先进
          <span class="mono">data/trash/</span>，迁移前原件备份在 <span class="mono">data/backups/pre-migration/</span>。
        </div>
      </div>`;
    }

    /* ---------- 文档入口 ---------- */
    function docsEntryHtml() {
      return `<div class="card">
        <div class="card-title">文 档</div>
        <div class="small dim" style="margin-bottom:8px">
          使用说明、文档索引、设计与运维文档都在「文档」页里读——左侧目录、右侧正文，
          不必再去文件管理器里翻 README。
        </div>
        <div class="chips"><button class="btn sm" data-go="#/docs">打 开 文 档</button></div>
      </div>`;
    }

    const fullHtml = () => permHtml() + modelHtml() + dataHtml() + docsEntryHtml();

    return {
      html: fullHtml(),
      async mount(root) {
        // 权限：点一下就存，不用按保存（这一档改的是「助手现在能做什么」，越直接越好）
        root.querySelectorAll('[data-perm]').forEach((el) => el.addEventListener('click', async () => {
          const id = el.dataset.perm;
          if (id === c().permission) return;
          if (id === 'delete' || id === 'full') {
            const ok = await new Promise((res) => {
              modal(`<div class="card-title">把助手提到「${h(id === 'delete' ? '可删' : '全权')}」？</div>
                <div class="small" style="margin-bottom:8px">${h(cfg.permissions.find((x) => x.id === id)?.desc || '')}</div>
                <div class="chips"><button class="btn primary sm" id="p-ok">确 认 提 权</button>
                  <button class="btn sm ghost" id="p-no">再 想 想</button></div>`, (r2) => {
                r2.querySelector('#p-ok').addEventListener('click', () => { r2.closest('.modal-mask')?.remove(); res(true); });
                r2.querySelector('#p-no').addEventListener('click', () => { r2.closest('.modal-mask')?.remove(); res(false); });
              });
            });
            if (!ok) return;
          }
          try {
            const r = await api.post('/api/agent/config', { permission: id });
            cfg.config = r.config;
            toast(`助手权限已改为「${r.config.permissionLevels.find((x) => x.id === id)?.name}」`);
            root.innerHTML = fullHtml();
            await this.mount(root);
          } catch (err) {
            toast(`改权限失败：${err.message}`);
          }
        }));

        root.querySelector('#s-ping')?.addEventListener('click', async () => {
          const box = root.querySelector('#s-ping-out');
          box.textContent = '测试中…';
          try {
            const r = await api.post('/api/agent/ping', {});
            box.innerHTML = r.ok ? `<span class="ok">连通正常</span>　${r.ms}ms　返回「${h(r.sample)}」` : `<span class="err">失败：${h(r.error)}</span>`;
          } catch (err) {
            box.innerHTML = `<span class="err">${h(err.message)}</span>`;
          }
        });

        const d = window.__qxgDesktop;
        root.querySelector('#s-opendata')?.addEventListener('click', () => d.openDataDir());
        root.querySelector('#s-backup')?.addEventListener('click', async () => {
          const r = await d.exportBackup();
          if (r?.ok) toast(`备份已存到 ${r.filePath}`);
        });
        root.querySelector('#s-changedir')?.addEventListener('click', () => d.chooseDataDir());
        root.querySelector('#s-opentrash')?.addEventListener('click', () => d.openBackups());

        // 页内跳转按钮：「打开文档」、模型卡上的「到助手页改模型设置」
        root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => ctx.navigate(b.dataset.go)));
      },
    };
  },
};

/* ============================================================
 * 文档
 * ------------------------------------------------------------
 * 随包文档的阅读器：左侧目录、右侧正文。
 * 目录来自 /api/help 的白名单（只读，不做任何拼接）。
 * 「格式规范」不在这里再渲染一份——它并进了「导入与格式」页（模板＋字段字典＋版本迁移），
 * 目录里只留一个跳过去的入口，免得同一份规范出现两种呈现。
 * ========================================================== */
export const docsView = {
  title: '文 档',
  desc: '使用说明、文档索引、设计与运维文档。左侧目录，右侧正文，不必去文件管理器里翻。',
  async render(ctx) {
    const { docs } = await api.get('/api/help');
    const readable = docs.filter((d) => !d.link);
    const wanted = ctx.params?.doc;
    const opened = readable.some((d) => d.id === wanted) ? wanted : (readable[0]?.id || null);

    const groups = [...new Set(docs.map((d) => d.group || '其他'))];
    const listHtml = groups.map((g) => `
      <div class="doc-group">
        <div class="doc-group-title">${h(g)}</div>
        ${docs.filter((d) => (d.group || '其他') === g).map((d) => (d.link
          ? `<button class="doc-item jump" data-go="${attr(d.link)}">
              <b>${h(d.title)}<span class="dim"> ↗</span></b><span>${h(d.desc)}</span>
            </button>`
          : `<button class="doc-item ${d.id === opened ? 'on' : ''}" data-doc="${attr(d.id)}"${d.exists ? '' : ' disabled'}>
              <b>${h(d.title)}</b><span>${h(d.desc)}</span>
            </button>`)).join('')}
      </div>`).join('');

    return {
      html: `
        <div class="docs-wrap">
          <aside class="docs-nav">
            <div class="docs-nav-head">随包 ${readable.length} 篇　<span class="dim">只读</span></div>
            ${listHtml}
          </aside>
          <section class="docs-body" id="d-body">
            ${opened ? '<div class="empty">载入中…</div>'
    : '<div class="empty">这份版本里没有随包文档。</div>'}
          </section>
        </div>`,
      mount(root) {
        const box = root.querySelector('#d-body');
        root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => ctx.navigate(b.dataset.go)));
        async function open(id) {
          root.querySelectorAll('[data-doc]').forEach((b) => b.classList.toggle('on', b.dataset.doc === id));
          box.innerHTML = '<div class="empty">载入中…</div>';
          try {
            const r = await api.get(`/api/help/${encodeURIComponent(id)}`);
            box.innerHTML = `<div class="help-head small dim">
                <span class="mono">${h(r.file)}</span>
                <span style="flex:1"></span>
                <span class="tiny">外链会先问你，不会直接打开</span>
              </div>
              <div class="narrative md-body" id="d-md">${renderMarkdown(r.markdown)}</div>`;
            guardLinks(box);
          } catch (err) {
            box.innerHTML = `<div class="card err">读不到这篇：${h(err.message)}</div>`;
          }
        }
        root.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', () => open(b.dataset.doc)));
        if (opened) open(opened);
      },
    };
  },
};

/**
 * 外链先问再开。
 * 随包文档里会引用外部网址；直接打开等于让一份本地文档把浏览器带走——先问一句更稳妥。
 */
function guardLinks(scope) {
  scope.querySelectorAll('a[href^="http"]').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const url = a.getAttribute('href');
      modal(`<div class="card-title">要打开外部网页吗</div>
        <div class="small" style="margin-bottom:8px">这个链接指向程序之外：</div>
        <pre class="md-code"><code>${h(url)}</code></pre>
        <div class="small dim">会在系统默认浏览器里打开。本程序之外的内容不由它负责。</div>
        <div class="chips" style="margin-top:10px">
          <button class="btn primary sm" id="ext-go">用浏览器打开</button>
          <button class="btn sm ghost" id="ext-copy">只复制网址</button>
        </div>`, (root2) => {
        root2.querySelector('#ext-go').addEventListener('click', () => {
          window.open(url, '_blank', 'noopener');
          root2.closest('.modal-mask')?.remove();
        });
        root2.querySelector('#ext-copy').addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(url); toast('网址已复制'); } catch { toast('复制失败'); }
          root2.closest('.modal-mask')?.remove();
        });
      });
    });
  });
}

export { TONE_ORDER };
