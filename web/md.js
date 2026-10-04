/**
 * 极简 Markdown 渲染（够用即可，不引依赖）
 * 支持：标题、粗体/斜体/行内码、链接、无序/有序列表、引用、表格、
 *       围栏代码块、水平线、段落。用于把导入的 DeepSeek 原文显示得体面些。
 */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(text) {
  let s = esc(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s（(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return s;
}

export function renderMarkdown(src) {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let listStack = [];

  const closeLists = () => {
    while (listStack.length) out.push(listStack.pop() === 'ol' ? '</ol>' : '</ul>');
  };

  while (i < lines.length) {
    const line = lines[i];

    // 围栏代码块
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1];
      const buf = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      closeLists();
      out.push(`<pre class="md-code"${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // 表格
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      closeLists();
      out.push('<table class="md-table"><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
        + rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('')
        + '</tbody></table>');
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeLists();
      const lvl = Math.min(h[1].length + 1, 6);
      out.push(`<h${lvl} class="md-h">${inline(h[2])}</h${lvl}>`);
      i += 1;
      continue;
    }

    // 水平线
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      closeLists();
      out.push('<hr class="md-hr">');
      i += 1;
      continue;
    }

    // 引用
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      closeLists();
      out.push(`<blockquote class="md-quote">${renderMarkdown(buf.join('\n'))}</blockquote>`);
      continue;
    }

    // 列表
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const want = ol ? 'ol' : 'ul';
      if (!listStack.length || listStack[listStack.length - 1] !== want) {
        closeLists();
        out.push(want === 'ol' ? '<ol class="md-list">' : '<ul class="md-list">');
        listStack.push(want);
      }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      i += 1;
      continue;
    }

    if (!line.trim()) {
      closeLists();
      i += 1;
      continue;
    }

    // 段落
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|\||```)/.test(lines[i])) {
      buf.push(lines[i]);
      i += 1;
    }
    /* 兜底：上面那条循环可能**一条都不吃**——比如一行以 `|` 开头、后面却不是合法表格
       （表头后缺 `|---|` 分隔行），于是 buf 为空、i 不动，最外层 while 成了死循环：
       界面永远停在「载入中…」、内存一路涨、整个窗口卡死。只要没前进，就把这一行
       当普通段落吃掉——渲染器里任何分支都**不许空转**，这是硬规矩。 */
    if (!buf.length) {
      buf.push(lines[i]);
      i += 1;
    }
    closeLists();
    out.push(`<p class="md-p">${inline(buf.join('<br>'))}</p>`);
  }
  closeLists();
  return out.join('\n');
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
}
