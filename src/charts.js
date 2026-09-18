import { money, colorAt, escapeHtml, monthLabel } from './utils.js';

/**
 * 两个图的 viewBox 宽度统一按「实际渲染宽度」来设计。
 * 原因：.chart-wrap svg 是 width:100%，SVG 内部的文字会跟着 viewBox 一起缩放。
 * 之前趋势图 viewBox 宽 340、饼图宽 200，同一块区域里一个被缩到 0.89、
 * 一个被放大到 1.52，图内字号和旁边的 CSS 字号完全是两套。
 *
 * 现在统一按 320 设计（.chart-wrap 有 max-width:360px 兜底），
 * 缩放比稳定在 0.85–1.1 之间，图内 13px 渲染出来就是 12–14px。
 */
const VIEW_W = 320;

/* ---------------- 饼图（环形） ---------------- */

/**
 * items: [{ name, emoji, amountFen, pct }]
 * 用 SVG 画环形图。只有一段时画整圆，避免 arc 退化。
 */
export function pieChart(items, { size = VIEW_W, thickness = 48 } = {}) {
  const total = items.reduce((a, i) => a + i.amountFen, 0);
  if (!total) return '<div class="empty">还没有支出记录</div>';

  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;

  let angle = -Math.PI / 2;
  const paths = items.map((item, i) => {
    const sweep = (item.amountFen / total) * Math.PI * 2;
    const seg = sweep >= Math.PI * 2 - 1e-6
      ? donut(cx, cy, r, thickness, 0, Math.PI * 2 - 1e-4)
      : donut(cx, cy, r, thickness, angle, angle + sweep);
    angle += sweep;
    return `<path d="${seg}" fill="${colorAt(i)}" />`;
  });

  const top = items[0];
  return `<div class="chart-wrap">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img"
         aria-label="分类占比环形图，合计 ${escapeHtml(money(total))} 元">
      ${paths.join('')}
      <text x="${cx}" y="${cy - 8}" text-anchor="middle" font-size="13" fill="var(--text-3)">合计</text>
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="18" font-weight="600" fill="var(--text)">${escapeHtml(money(total))}</text>
    </svg>
  </div>
  <div class="legend">
    ${items
      .slice(0, 8)
      .map(
        (item, i) => `<div class="legend-row">
          <span class="legend-dot" style="background:${colorAt(i)}"></span>
          <span class="legend-name">${escapeHtml(item.emoji + ' ' + item.name)}</span>
          <span class="legend-amt">${escapeHtml(money(item.amountFen))}</span>
          <span class="legend-pct">${(item.pct * 100).toFixed(1)}%</span>
        </div>`
      )
      .join('')}
    ${items.length > 8 ? `<div class="muted">还有 ${items.length - 8} 个分类没显示</div>` : ''}
  </div>
  <div class="muted" style="margin-top:10px">占比最大：${escapeHtml(top.name)}，${(top.pct * 100).toFixed(1)}%</div>`;
}

/** 环形的一段：外弧顺时针 + 内弧逆时针 */
function donut(cx, cy, r, thickness, a0, a1) {
  const R = r + thickness / 2;
  const ri = r - thickness / 2;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const x0 = cx + R * Math.cos(a0);
  const y0 = cy + R * Math.sin(a0);
  const x1 = cx + R * Math.cos(a1);
  const y1 = cy + R * Math.sin(a1);
  const x2 = cx + ri * Math.cos(a1);
  const y2 = cy + ri * Math.sin(a1);
  const x3 = cx + ri * Math.cos(a0);
  const y3 = cy + ri * Math.sin(a0);
  return `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${ri} ${ri} 0 ${large} 0 ${x3} ${y3} Z`;
}

/* ---------------- 趋势柱状图 ---------------- */

/**
 * trend: [{ month, incomeFen, expenseFen }]
 * 每个月两根柱子，收入绿、支出红。y 轴按最大值自适应，带三条刻度线。
 */
export function trendChart(trend, { height = 190 } = {}) {
  const W = VIEW_W;
  const H = height;
  const padL = 42;   // 留给 y 轴刻度文字
  const padR = 8;
  const padT = 16;
  const padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const max = Math.max(...trend.map((t) => Math.max(t.incomeFen, t.expenseFen)), 1);

  const slot = plotW / trend.length;
  const barW = Math.min(12, slot / 3.2);
  const baseY = padT + plotH;

  const bars = trend
    .map((t, i) => {
      const cx = padL + slot * i + slot / 2;
      const hIn = Math.round((t.incomeFen / max) * plotH);
      const hEx = Math.round((t.expenseFen / max) * plotH);
      const yIn = baseY - hIn;
      const yEx = baseY - hEx;
      return `
        <rect x="${(cx - barW - 2).toFixed(1)}" y="${yEx}" width="${barW}" height="${Math.max(hEx, t.expenseFen ? 2 : 0)}" rx="2.5" fill="var(--expense)" />
        <rect x="${(cx + 2).toFixed(1)}" y="${yIn}" width="${barW}" height="${Math.max(hIn, t.incomeFen ? 2 : 0)}" rx="2.5" fill="var(--income)" />
        <text x="${cx.toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="13" fill="var(--text-3)">${escapeHtml(monthLabel(t.month))}</text>`;
    })
    .join('');

  // 三条刻度：最高、一半、0。没有刻度线时只能读相对高低，读不出大概金额
  const gridlines = [1, 0.5, 0]
    .map((ratio) => {
      const y = padT + plotH * (1 - ratio);
      const solid = ratio === 0;
      return `
        <line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"
              stroke="var(--border)" stroke-width="${solid ? 1 : 0.5}"
              ${solid ? '' : 'stroke-dasharray="3 3"'} />
        <text x="${padL - 8}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="central"
              font-size="12" fill="var(--text-3)">${escapeHtml(axisLabel(max * ratio))}</text>`;
    })
    .join('');

  const hasData = trend.some((t) => t.incomeFen || t.expenseFen);

  return `<div class="chart-wrap">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="最近几个月收支趋势柱状图">
      ${gridlines}
      ${bars}
    </svg>
  </div>
  <div class="legend-group" style="margin-top:8px">
    <span class="legend-item"><i class="legend-dot" style="background:var(--income)"></i>收入</span>
    <span class="legend-item"><i class="legend-dot" style="background:var(--expense)"></i>支出</span>
  </div>
  ${hasData ? '' : '<div class="muted" style="margin-top:8px">这几个月还没有记录</div>'}`;
}

/** y 轴刻度用的简短金额：1 万元以上折成「万」，免得刻度文字太长挤掉绘图区 */
function axisLabel(fen) {
  if (!fen) return '0';
  const yuan = fen / 100;
  if (yuan >= 10000) {
    const wan = yuan / 10000;
    const txt = wan >= 10 ? String(Math.round(wan)) : wan.toFixed(1).replace(/\.0$/, '');
    return `${txt}万`;
  }
  return String(Math.round(yuan));
}
