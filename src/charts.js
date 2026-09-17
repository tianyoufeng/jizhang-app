import { money, colorAt, escapeHtml, monthLabel } from './utils.js';

/* ---------------- 饼图（环形） ---------------- */

/**
 * items: [{ name, emoji, amountFen, pct }]
 * 用 SVG 画环形图。只有一段时画整圆，避免 arc 退化。
 */
export function pieChart(items, { size = 200, thickness = 30 } = {}) {
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
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="支出分类占比">
      ${paths.join('')}
      <text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="12" fill="var(--text-3)">合计</text>
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="17" font-weight="700" fill="var(--text)">${escapeHtml(money(total))}</text>
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
 * 每个月两根柱子，收入绿、支出红。y 轴按最大值自适应。
 */
export function trendChart(trend, { height = 190 } = {}) {
  const W = 340;
  const H = height;
  const padL = 8;
  const padR = 8;
  const padT = 22;
  const padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const max = Math.max(...trend.map((t) => Math.max(t.incomeFen, t.expenseFen)), 1);

  const slot = plotW / trend.length;
  const barW = Math.min(13, slot / 3.2);

  const bars = trend
    .map((t, i) => {
      const cx = padL + slot * i + slot / 2;
      const hIn = Math.round((t.incomeFen / max) * plotH);
      const hEx = Math.round((t.expenseFen / max) * plotH);
      const yIn = padT + plotH - hIn;
      const yEx = padT + plotH - hEx;
      return `
        <rect x="${cx - barW - 2}" y="${yEx}" width="${barW}" height="${Math.max(hEx, t.expenseFen ? 2 : 0)}" rx="3" fill="var(--expense)" />
        <rect x="${cx + 2}" y="${yIn}" width="${barW}" height="${Math.max(hIn, t.incomeFen ? 2 : 0)}" rx="3" fill="var(--income)" />
        <text x="${cx}" y="${H - 10}" text-anchor="middle" font-size="10" fill="var(--text-3)">${escapeHtml(monthLabel(t.month))}</text>`;
    })
    .join('');

  const hasData = trend.some((t) => t.incomeFen || t.expenseFen);

  return `<div class="chart-wrap">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="最近几个月收支趋势">
      <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="var(--border)" stroke-width="1" />
      <text x="${padL}" y="12" font-size="10" fill="var(--text-3)">最高 ${escapeHtml(money(max))}</text>
      ${bars}
    </svg>
  </div>
  <div class="legend-row" style="margin-top:8px">
    <span class="legend-dot" style="background:var(--income)"></span>
    <span class="legend-name">收入</span>
    <span class="legend-dot" style="background:var(--expense)"></span>
    <span class="legend-name">支出</span>
  </div>
  ${hasData ? '' : '<div class="muted" style="margin-top:8px">这几个月还没有记录</div>'}`;
}
