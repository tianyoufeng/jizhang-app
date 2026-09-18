import { categoryBreakdown, periodTrend, periodSummary, currentLedger } from '../store.js';
import {
  money, currentPeriod, shiftPeriod, convertPeriod, periodLabel, escapeHtml,
  PERIOD_UNITS, PERIOD_BTN_TEXT, PERIOD_PREV_TEXT, PERIOD_WORD, PERIOD_THIS_TEXT
} from '../utils.js';
import { pieChart, trendChart } from '../charts.js';
import { setListFilter } from './list.js';
import { navigate } from '../nav.js';

/** 趋势图看几个周期。6 个刚好：横轴不挤，又能看出走向 */
const TREND_COUNT = 6;

const view = {
  unit: 'month',
  key: currentPeriod('month'),
  kind: 'expense'
};

export function renderStats(root) {
  const unit = view.unit;
  if (view.key > currentPeriod(unit)) view.key = currentPeriod(unit);

  const ledger = currentLedger();
  const summary = periodSummary(unit, view.key, ledger.id);
  const prev = periodSummary(unit, shiftPeriod(unit, view.key, -1), ledger.id);
  const breakdown = categoryBreakdown(unit, view.key, view.kind, ledger.id);
  const trend = periodTrend(unit, view.key, TREND_COUNT, ledger.id);
  const atLatest = view.key >= currentPeriod(unit);
  const label = periodLabel(unit, view.key);

  root.innerHTML = `
    <div class="scope" data-role="scope">
      ${PERIOD_UNITS.map(
        (u) => `<button type="button" data-scope="${u}" class="${unit === u ? 'active' : ''}">${PERIOD_BTN_TEXT[u]}</button>`
      ).join('')}
    </div>

    <div class="month-nav">
      <button type="button" class="m-arrow" data-role="prev">‹</button>
      <span class="m-label">${escapeHtml(label)}</span>
      <button type="button" class="m-arrow" data-role="next" ${atLatest ? 'disabled' : ''}>›</button>
    </div>

    <div class="card">
      <p class="card-title">${escapeHtml(label)}总结</p>
      <div class="summary summary-plain">
        <div><div class="s-val income">${escapeHtml(money(summary.incomeFen))}</div><div class="s-key income">收入</div></div>
        <div><div class="s-val expense">${escapeHtml(money(summary.expenseFen))}</div><div class="s-key expense">支出</div></div>
        <div><div class="s-val balance">${escapeHtml(money(summary.balanceFen))}</div><div class="s-key">结余</div></div>
      </div>
      ${deltaLine(summary, prev, unit)}
      ${summary.count ? '' : `<div class="muted" style="margin-top:10px">${escapeHtml(PERIOD_THIS_TEXT[unit])}还没有记录</div>`}
    </div>

    <div class="card">
      <div class="seg" data-role="kindseg" style="margin-bottom:12px">
        <button type="button" data-kind="expense">支出构成</button>
        <button type="button" data-kind="income">收入构成</button>
      </div>
      <div data-role="pie"></div>
    </div>

    <div class="card">
      <p class="card-title">最近 ${TREND_COUNT} ${PERIOD_WORD[unit]}趋势</p>
      <div data-role="trend"></div>
    </div>
  `;

  root.querySelector('[data-role="pie"]').innerHTML = pieChart(breakdown.items, {
    emptyText: `这段时间还没有${view.kind === 'income' ? '收入' : '支出'}记录`
  });
  root.querySelector('[data-role="trend"]').innerHTML = trendChart(trend, {
    ariaLabel: `最近 ${TREND_COUNT} ${PERIOD_WORD[unit]}的收支趋势柱状图`,
    emptyText: '这段时间还没有记录'
  });

  root.querySelector('[data-role="scope"]').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-scope]');
    if (!btn) return;
    const next = btn.dataset.scope;
    if (next === view.unit) {
      // 再点一次当前粒度＝回到当下（和底栏「再点一次当前 tab 回到顶部」一致）
      if (view.key === currentPeriod(unit)) return;
      view.key = currentPeriod(unit);
      renderStats(root);
      return;
    }
    // 换粒度时按当前周期的第一天换算，别跳回今天
    view.key = convertPeriod(view.unit, view.key, next);
    view.unit = next;
    renderStats(root);
  });

  root.querySelectorAll('[data-role="kindseg"] button').forEach((b) => {
    b.classList.toggle('active', b.dataset.kind === view.kind);
    b.addEventListener('click', () => {
      view.kind = b.dataset.kind;
      renderStats(root);
    });
  });

  root.querySelector('[data-role="prev"]').addEventListener('click', () => {
    view.key = shiftPeriod(unit, view.key, -1);
    renderStats(root);
  });
  root.querySelector('[data-role="next"]').addEventListener('click', () => {
    view.key = shiftPeriod(unit, view.key, 1);
    renderStats(root);
  });

  // 点饼图的图例，跳到账单页看这个分类的明细
  // （只圈饼图的图例，下面趋势图那行图例不算）
  root.querySelectorAll('[data-role="pie"] .legend-row').forEach((row, i) => {
    const item = breakdown.items[i];
    if (!item) return;
    row.style.cursor = 'pointer';
    row.title = '点一下看这个分类的明细';
    row.addEventListener('click', () => {
      // 带着当前周期跳过去，于是「按年看到的餐饮」点进去也是整年的餐饮
      setListFilter({ unit: view.unit, key: view.key, categoryId: item.categoryId });
      navigate('list');
    });
  });
}

/**
 * 环比：这个周期比上一个周期多花 / 少花多少。
 * 单周期数字和 6 个周期的趋势都有，但「比上期多花多少」这句最想知道的话原来没有。
 */
function deltaLine(summary, prev, unit) {
  const prevWord = PERIOD_PREV_TEXT[unit];
  if (!summary.count) return '';
  if (!prev.count) return `<div class="delta">${prevWord}没有记录，没法比</div>`;

  const diff = summary.expenseFen - prev.expenseFen;
  if (diff === 0) return `<div class="delta">支出和${prevWord}持平</div>`;

  const more = diff > 0;
  const cls = more ? 'up' : 'down';
  const amount = `支出比${prevWord}${more ? '多' : '少'}花 <b>${escapeHtml(money(Math.abs(diff)))}</b> 元`;

  // 上期只记了收入、没记支出时，除数是 0，百分比会算出 Infinity%
  if (!prev.expenseFen) return `<div class="delta ${cls}">${amount}</div>`;

  const pct = Math.round(Math.abs(diff / prev.expenseFen) * 100);
  return `<div class="delta ${cls}">${amount} <b>(${more ? '+' : '-'}${pct}%)</b></div>`;
}
