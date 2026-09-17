import { categoryBreakdown, monthlyTrend, monthSummary, currentLedger } from '../store.js';
import { money, currentMonth, shiftMonth, monthLabel, escapeHtml } from '../utils.js';
import { pieChart, trendChart } from '../charts.js';
import { setListFilter } from './list.js';
import { navigate } from '../nav.js';

const view = {
  month: currentMonth(),
  kind: 'expense'
};

export function renderStats(root) {
  if (view.month > currentMonth()) view.month = currentMonth();

  const ledger = currentLedger();
  const months = lastMonths(view.month, 6);
  const trend = monthlyTrend(months, ledger.id);
  const summary = monthSummary(view.month, ledger.id);
  const breakdown = categoryBreakdown(view.month, view.kind, ledger.id);
  const atLatest = view.month >= currentMonth();

  root.innerHTML = `
    <div class="month-nav">
      <button type="button" class="m-arrow" data-role="prev">‹</button>
      <span class="m-label">${escapeHtml(monthLabel(view.month))}</span>
      <button type="button" class="m-arrow" data-role="next" ${atLatest ? 'disabled' : ''}>›</button>
    </div>

    <div class="card">
      <p class="card-title">${escapeHtml(monthLabel(view.month))}总结</p>
      <div class="summary" style="box-shadow:none;padding:0;margin:0">
        <div><div class="s-val income">${escapeHtml(money(summary.incomeFen))}</div><div class="s-key">收入</div></div>
        <div><div class="s-val expense">${escapeHtml(money(summary.expenseFen))}</div><div class="s-key">支出</div></div>
        <div><div class="s-val balance">${escapeHtml(money(summary.balanceFen))}</div><div class="s-key">结余</div></div>
      </div>
      ${summary.count ? '' : '<div class="muted" style="margin-top:10px">这个月还没有记录</div>'}
    </div>

    <div class="card">
      <div class="seg" data-role="kindseg" style="margin-bottom:12px">
        <button type="button" data-kind="expense">支出构成</button>
        <button type="button" data-kind="income">收入构成</button>
      </div>
      <div data-role="pie"></div>
    </div>

    <div class="card">
      <p class="card-title">最近 6 个月趋势</p>
      <div data-role="trend"></div>
    </div>
  `;

  root.querySelector('[data-role="pie"]').innerHTML = pieChart(breakdown.items);
  root.querySelector('[data-role="trend"]').innerHTML = trendChart(trend);

  root.querySelectorAll('[data-role="kindseg"] button').forEach((b) => {
    b.classList.toggle('active', b.dataset.kind === view.kind);
    b.addEventListener('click', () => {
      view.kind = b.dataset.kind;
      renderStats(root);
    });
  });

  root.querySelector('[data-role="prev"]').addEventListener('click', () => {
    view.month = shiftMonth(view.month, -1);
    renderStats(root);
  });
  root.querySelector('[data-role="next"]').addEventListener('click', () => {
    view.month = shiftMonth(view.month, 1);
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
      setListFilter({ month: view.month, categoryId: item.categoryId });
      navigate('list');
    });
  });
}

/** 以 month 结尾、往前数 n 个月 */
function lastMonths(month, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) out.push(shiftMonth(month, -i));
  return out;
}
