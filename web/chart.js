/**
 * 问心卦 · 零依赖 SVG 折线图
 * ------------------------------------------------------------
 * 目标：把「多重领域、多重线」叠在一张图里看清楚。
 * 特性：多系列叠加、原始线（淡）+ 平滑线（实）、虚线与断线、
 *       零轴、网格、图例（可点选隐藏）、十字准星与多值悬浮提示、
 *       点击数据点回调（用来跳回卦录）。
 *
 * 不用任何图表库：SVG 手写，图随容器宽度自适应（ResizeObserver）。
 */

import { h } from './api.js';

const NS = 'http://www.w3.org/2000/svg';

/** 折线路径：跳过空值，形成断线 */
function pathOf(points) {
  let d = '';
  let pen = false;
  for (const p of points) {
    if (p === null || p === undefined) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)} `;
    pen = true;
  }
  return d.trim();
}

/**
 * 渲染折线图。
 * @param {HTMLElement} host 容器
 * @param {object} data core/trend.mjs 的 buildTrend 结果
 * @param {object} [opts]
 * @param {number} [opts.height=380]
 * @param {(id:string)=>void} [opts.onPick]  点击数据点回调（传卦录 id）
 * @returns {{destroy:()=>void, hidden:Set<string>}}
 */
export function renderLineChart(host, data, opts = {}) {
  const height = opts.height || 380;
  const hidden = opts.hidden instanceof Set ? opts.hidden : new Set();
  const pad = { top: 22, right: 18, bottom: 46, left: 52 };
  let destroyed = false;
  let ro = null;

  const percent = data.scale === 'percent';
  const yMin = percent ? 0 : -100;
  const yMax = 100;
  const visible = () => data.series.filter((s) => !hidden.has(s.id));

  function draw() {
    if (destroyed) return;
    const W = Math.max(360, host.clientWidth || 720);
    const H = height;
    const iw = W - pad.left - pad.right;
    const ih = H - pad.top - pad.bottom;

    const sx = (v) => pad.left + v * iw;
    const sy = (v) => pad.top + ih - ((v - yMin) / (yMax - yMin)) * ih;

    const ticksY = percent ? [0, 25, 50, 75, 100] : [-100, -50, 0, 50, 100];
    const xv = data.xValues;

    // 网格 + y 轴刻度
    let grid = '';
    for (const t of ticksY) {
      const y = sy(t);
      const zero = t === 0;
      grid += `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${W - pad.right}" y2="${y.toFixed(1)}"
        stroke="${zero ? '#3a4557' : '#232b38'}" stroke-width="${zero ? 1.2 : 1}"
        ${zero ? '' : 'stroke-dasharray="3 5"'}></line>`;
      grid += `<text x="${pad.left - 9}" y="${(y + 4).toFixed(1)}" text-anchor="end"
        fill="#6f6759" font-size="10.5" font-family="Consolas,monospace">${t}</text>`;
    }

    // x 轴标签：稀疏显示，避免挤在一起
    const maxLabels = Math.max(3, Math.floor(iw / 86));
    const step = Math.max(1, Math.ceil(data.points / maxLabels));
    let xAxis = '';
    data.xLabels.forEach((lab, i) => {
      if (i % step !== 0 && i !== data.points - 1) return;
      const x = sx(xv[i]);
      xAxis += `<line x1="${x.toFixed(1)}" y1="${pad.top + ih}" x2="${x.toFixed(1)}" y2="${pad.top + ih + 4}" stroke="#3a4557"></line>`;
      xAxis += `<text x="${x.toFixed(1)}" y="${pad.top + ih + 17}" text-anchor="middle" fill="#a79e8d" font-size="10.5">${h(lab.text)}</text>`;
    });

    // 数据线
    let lines = '';
    let dots = '';
    for (const s of visible()) {
      const pts = s.values.map((v, i) => (v === null || v === undefined ? null : { x: sx(xv[i]), y: sy(v) }));
      if (s.raw) {
        lines += `<path d="${pathOf(s.raw.map((v, i) => (v === null || v === undefined ? null : { x: sx(xv[i]), y: sy(v) })))}"
          fill="none" stroke="${s.color}" stroke-width="1" opacity="0.22"></path>`;
      }
      lines += `<path d="${pathOf(pts)}" fill="none" stroke="${s.color}" stroke-width="2.1"
        stroke-linejoin="round" stroke-linecap="round" ${s.dashed ? 'stroke-dasharray="7 5"' : ''}
        opacity="${s.sparse ? 0.9 : 1}"></path>`;
      pts.forEach((p, i) => {
        if (!p) return;
        const last = i === pts.length - 1;
        dots += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${last ? 3.6 : 2.6}"
          fill="${last ? s.color : '#0b0e13'}" stroke="${s.color}" stroke-width="1.6"
          class="pt" data-i="${i}" data-id="${h(data.records[i]?.id || '')}"></circle>`;
      });
    }

    host.innerHTML = `
      <div class="chart-wrap">
        <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="卦气走势图">
          ${grid}${xAxis}
          <line x1="${pad.left}" y1="${pad.top + ih}" x2="${W - pad.right}" y2="${pad.top + ih}" stroke="#3a4557"></line>
          ${lines}${dots}
          <g class="guide" style="display:none">
            <line x1="0" y1="${pad.top}" x2="0" y2="${pad.top + ih}" stroke="#c9a227" stroke-width="1" stroke-dasharray="3 3" opacity="0.75"></line>
          </g>
          <rect class="hit" x="${pad.left}" y="${pad.top}" width="${iw}" height="${ih}" fill="transparent" style="cursor:crosshair"></rect>
        </svg>
        <div class="tip" style="display:none"></div>
      </div>`;

    const svg = host.querySelector('svg');
    const guide = host.querySelector('.guide');
    const guideLine = guide.querySelector('line');
    const tip = host.querySelector('.tip');
    const hit = host.querySelector('.hit');

    // 悬浮
    hit.addEventListener('mousemove', (e) => {
      const rect = svg.getBoundingClientRect();
      const scale = W / rect.width;
      const px = (e.clientX - rect.left) * scale;
      const t = Math.max(0, Math.min(1, (px - pad.left) / iw));
      // 取最近的数据点
      let idx = 0;
      let best = Infinity;
      xv.forEach((v, i) => {
        const dd = Math.abs(v - t);
        if (dd < best) { best = dd; idx = i; }
      });
      const x = sx(xv[idx]);
      guide.style.display = '';
      guideLine.setAttribute('x1', x);
      guideLine.setAttribute('x2', x);

      const rec = data.records[idx] || {};
      const rows = visible().map((s) => {
        const v = s.values[idx];
        return `<div class="tr"><i style="background:${s.color}"></i><span class="nm">${h(s.name)}</span>
          <b>${v === null || v === undefined ? '—' : (percent ? `${v}%` : v)}</b></div>`;
      }).join('');
      tip.innerHTML = `<div class="th">${h(data.xLabels[idx]?.full || '')}</div>
        <div class="tt">${h(rec.title || '')}</div>${rows}
        <div class="tf">${h(rec.category || '')}${rec.review ? `　·　${h(rec.review)}` : ''}</div>`;
      tip.style.display = '';
      const tw = tip.offsetWidth || 220;
      const leftPx = (x / W) * rect.width;
      tip.style.left = `${Math.max(6, Math.min(rect.width - tw - 6, leftPx + 12))}px`;
      tip.style.top = `${Math.max(6, e.clientY - rect.top - 12)}px`;
    });
    hit.addEventListener('mouseleave', () => {
      guide.style.display = 'none';
      tip.style.display = 'none';
    });
    hit.addEventListener('click', (e) => {
      if (!opts.onPick) return;
      const rect = svg.getBoundingClientRect();
      const scale = W / rect.width;
      const px = (e.clientX - rect.left) * scale;
      const t = Math.max(0, Math.min(1, (px - pad.left) / iw));
      let idx = 0;
      let best = Infinity;
      xv.forEach((v, i) => {
        const dd = Math.abs(v - t);
        if (dd < best) { best = dd; idx = i; }
      });
      const id = data.records[idx]?.id;
      if (id) opts.onPick(id);
    });
  }

  draw();
  if (typeof ResizeObserver !== 'undefined') {
    let t = null;
    ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(draw, 120);
    });
    ro.observe(host);
  }
  return {
    destroy() { destroyed = true; ro?.disconnect(); },
    hidden,
    redraw: draw,
  };
}

/** 图例（可点选隐藏／显示系列） */
export function legendHtml(data, hidden) {
  return data.series.map((s) => `
    <span class="chip lg ${hidden.has(s.id) ? 'off' : ''}" data-s="${h(s.id)}" title="${h(s.hint || '')}">
      <i style="background:${s.color}"></i>${h(s.name)}</span>`).join('');
}

export { NS };
