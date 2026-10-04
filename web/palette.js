/**
 * 问心卦 · 命令面板（Ctrl/⌘ + K）
 * ------------------------------------------------------------
 * 存在的理由：侧栏塞不下所有入口。
 * 插件页面、文档、卦典、AI 设置、各种一次性操作，全都可以从这里进，
 * 所以侧栏可以只留六项（外加一组自滚的插件），永远不出滚动条。
 *
 * 三类结果：页面 / 操作 / 卦录（卦录走接口实时搜）。
 */

import { api, h, attr, toast } from './api.js';

/* ---------- 模糊匹配：子序列 + 连续段加分 ---------- */
export function fuzzyScore(text, query) {
  const t = String(text).toLowerCase();
  const q = String(query).toLowerCase().trim();
  if (!q) return 1;
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at < 0) return 0;
    streak = at === ti ? streak + 1 : 0;
    score += 1 + streak * 2 + (at === 0 ? 3 : 0);
    ti = at + 1;
  }
  // 越短越相关
  return score / (1 + t.length / 24);
}

const KIND_LABEL = { page: '页面', action: '操作', record: '卦录', plugin: '插件页面' };

/**
 * @param {object} p
 * @param {object} p.ctx         路由上下文（navigate / reload）
 * @param {() => object} p.getMeta 取 /api/meta 的结果
 * @returns {{open:Function, close:Function, toggle:Function, isOpen:()=>boolean}}
 */
export function createPalette({ ctx, getMeta }) {
  let root = null;
  let items = [];
  let cursor = 0;
  let searchTimer = null;
  let recordHits = [];
  let lastQuery = '';

  function pageItems() {
    const meta = getMeta() || {};
    const out = [];
    for (const n of meta.nav || []) {
      out.push({ kind: 'page', id: n.path, label: n.label, hint: n.desc || '', icon: n.icon || '·', run: () => ctx.navigate(n.path) });
    }
    for (const pg of meta.plugins?.pages || []) {
      out.push({
        kind: 'plugin', id: `#/plugin/${pg.pluginId}/${pg.id}`, label: pg.label,
        hint: `插件 ${pg.pluginId}`, icon: pg.icon || '◇',
        run: () => ctx.navigate(`#/plugin/${pg.pluginId}/${pg.id}`),
      });
    }
    return out;
  }

  function actionItems() {
    const d = window.__qxgDesktop;
    const actions = [
      { label: '起一卦', hint: '打开起卦台', icon: '☯', run: () => ctx.navigate('#/cast') },
      { label: '导入与格式', hint: '粘贴卦条、字段字典与模板', icon: '⇩', run: () => ctx.navigate('#/import') },
      { label: '看走势', hint: '多领域叠加', icon: '◪', run: () => ctx.navigate('#/trend') },
      { label: '翻卦典', hint: '六十四卦', icon: '䷁', run: () => ctx.navigate('#/dian') },
      { label: '插件管理', hint: '热载 / 启停 / 写插件', icon: '◇', run: () => ctx.navigate('#/plugins') },
      { label: 'AI 助手', hint: '模型设置与对话', icon: '✦', run: () => ctx.navigate('#/agent') },
      { label: '导出全部（Markdown）', hint: '下载 .md', icon: '↓', run: () => { window.location.href = '/api/export?format=md'; } },
      { label: '整包备份（JSON）', hint: '下载 .json', icon: '↓', run: () => { window.location.href = '/api/export?format=json'; } },
      { label: '热载全部插件', hint: '改完插件不用重启', icon: '↻', run: async () => { await api.post('/api/plugins/reload'); toast('已热载'); ctx.reload(); } },
      { label: '刷新元信息', hint: '重取 /api/meta', icon: '↻', run: () => ctx.reload() },
    ];
    if (d) {
      actions.unshift(
        { label: '打开数据目录', hint: '在文件管理器里打开', icon: '📁', run: () => d.openDataDir() },
        { label: '导出备份到…', hint: '弹保存框', icon: '💾', run: () => d.exportBackup() },
        { label: '更换数据目录…', hint: '需要重启', icon: '📁', run: () => d.chooseDataDir() },
      );
    }
    return actions.map((a) => ({ kind: 'action', id: `act:${a.label}`, ...a }));
  }

  function build() {
    root = document.createElement('div');
    root.className = 'palette-mask';
    root.innerHTML = `
      <div class="palette" role="dialog" aria-label="命令面板">
        <div class="pl-input">
          <span class="pl-icon">⌘</span>
          <input type="text" id="pl-q" placeholder="搜页面、操作、卦录……（↑↓ 选择，Enter 打开，Esc 关闭）" autocomplete="off">
        </div>
        <div class="pl-list" id="pl-list"></div>
        <div class="pl-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>Enter</kbd> 打开</span>
          <span><kbd>Esc</kbd> 关闭</span>
          <span class="pl-count" id="pl-count"></span>
        </div>
      </div>`;
    document.body.appendChild(root);
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
    const input = root.querySelector('#pl-q');
    input.addEventListener('input', () => { render(input.value); });
    input.addEventListener('keydown', onKey);
    root.querySelector('#pl-list').addEventListener('click', (e) => {
      const row = e.target.closest('[data-i]');
      if (row) run(Number(row.dataset.i));
    });
    return root;
  }

  /**
   * @param {string} q
   * @param {boolean} scheduleSearch 是否要排下一次防抖搜索。
   *   搜索回调里再调 render 时必须传 false —— 否则 render 又排一次、
   *   那次回来又 render…… 就成了**每 220ms 打一次接口的死循环**（真踩过）。
   */
  function render(q, scheduleSearch = true) {
    lastQuery = q;
    const base = [...actionItems(), ...pageItems()];
    let scored = base
      .map((it) => ({ it, s: Math.max(fuzzyScore(it.label, q), fuzzyScore(it.hint || '', q) * 0.5) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, q.trim() ? 12 : 9)
      .map((x) => x.it);

    // 卦录：有输入词才搜，防抖
    if (recordHits.length && q.trim()) {
      scored = [...scored, ...recordHits];
    }

    // 最上面那条永远是「把这句话交给助手」——这样命令面板同时也是一个
    // 自然语言入口，像搜索框那样：搜不到就走对话。
    const query = q.trim();
    if (query) {
      scored = [{
        kind: 'action',
        id: 'ask',
        label: `问助手：${query.length > 22 ? `${query.slice(0, 22)}…` : query}`,
        hint: '把这句话交给 AI 助手（会打开右侧抽屉）',
        icon: '✦',
        run: () => {
          const fn = getMeta()?.askAssistant;
          if (fn) fn(query);
          else ctx.navigate('#/agent');
        },
      }, ...scored];
    }

    items = scored;
    cursor = 0;
    paint();

    if (!scheduleSearch) return;
    clearTimeout(searchTimer);
    if (q.trim().length >= 1) {
      searchTimer = setTimeout(async () => {
        try {
          const r = await api.get(`/api/records?q=${encodeURIComponent(q.trim())}`);
          if (lastQuery !== q) return; // 输入已变，丢弃
          recordHits = (r.items || []).slice(0, 6).map((x) => ({
            kind: 'record', id: `rec:${x.id}`, label: x.title,
            hint: `${x.ben?.fullName || ''} ${x.moving?.yaoTitle || ''} · ${x.category} · ${x.grade?.label || ''}`,
            icon: x.ben?.symbol || '䷀',
            run: () => ctx.navigate(`#/record/${x.id}`),
          }));
          render(q, false);
        } catch { /* 搜不到就算了，不影响页面/操作的匹配 */ }
      }, 220);
    } else {
      recordHits = [];
    }
  }

  function paint() {
    const list = root.querySelector('#pl-list');
    if (!items.length) {
      list.innerHTML = '<div class="pl-empty">没有匹配。试试「起卦」「导出」「卦典」，或直接输卦录标题。</div>';
    } else {
      list.innerHTML = items.map((it, i) => `
        <div class="pl-row ${i === cursor ? 'on' : ''}" data-i="${i}">
          <span class="pl-ic">${h(it.icon || '·')}</span>
          <span class="pl-lb">${h(it.label)}</span>
          <span class="pl-hint">${h(it.hint || '')}</span>
          <span class="pl-kind">${KIND_LABEL[it.kind] || ''}</span>
        </div>`).join('');
    }
    root.querySelector('#pl-count').textContent = `${items.length} 项`;
    const on = list.querySelector('.pl-row.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault(); cursor = Math.min(items.length - 1, cursor + 1); paint(); return;
    }
    if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault(); cursor = Math.max(0, cursor - 1); paint(); return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (items[cursor]) run(cursor);
    }
  }

  function run(i) {
    const it = items[i];
    if (!it) return;
    close();
    try {
      it.run();
    } catch (err) {
      toast(`执行失败：${err.message}`);
    }
  }

  function open(prefill = '') {
    if (!root) build();
    root.classList.add('on');
    const input = root.querySelector('#pl-q');
    input.value = prefill;
    input.focus();
    input.select();
    recordHits = [];
    render(prefill);
  }

  function close() {
    if (root) root.classList.remove('on');
    clearTimeout(searchTimer);
  }

  const isOpen = () => !!root && root.classList.contains('on');

  // 全局快捷键：Ctrl/⌘ + K 开关；「/」在非输入框里也能开；Esc 无论焦点在哪都关
  window.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (isOpen()) close(); else open();
      return;
    }
    // Esc 不绑在输入框上：焦点可能被别处拿走（比如点了一下结果行之外的区域），
    // 那种情况下也必须能关掉，否则面板会「卡」在屏幕上。
    if (e.key === 'Escape' && isOpen()) {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === '/' && !typing && !isOpen()) {
      e.preventDefault();
      open();
    }
  });

  return { open, close, toggle: () => (isOpen() ? close() : open()), isOpen };
}
