import { mountTxForm } from './txForm.js';
import { currentLedger, monthSummary } from '../store.js';
import { money, currentMonth, escapeHtml } from '../utils.js';

export function renderRecord(root) {
  const ledger = currentLedger();
  const summary = monthSummary(currentMonth());
  const budget = ledger.budgetFen || 0;

  root.innerHTML = `
    ${budget > 0 ? budgetCard(summary.expenseFen, budget) : ''}
    <div data-role="form"></div>
  `;

  mountTxForm(root.querySelector('[data-role="form"]'), {
    onSaved: () => {
      // 保存后刷新顶部的预算进度
      renderRecord(root);
    }
  });
}

function budgetCard(spentFen, budgetFen) {
  const ratio = spentFen / budgetFen;
  const cls = ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : '';
  const left = budgetFen - spentFen;

  const tip = ratio >= 1
    ? `已经超支 ${money(-left)} 元`
    : `还能花 ${money(left)} 元`;

  return `<div class="card">
    <p class="card-title">本月预算</p>
    <div class="budget-line">
      <span>已花 ${escapeHtml(money(spentFen))} 元</span>
      <span>预算 ${escapeHtml(money(budgetFen))} 元</span>
    </div>
    <div class="progress ${cls}"><i style="width:${Math.min(ratio * 100, 100).toFixed(1)}%"></i></div>
    <div class="budget-tip ${cls}">${escapeHtml(tip)}（已用 ${(ratio * 100).toFixed(0)}%）</div>
  </div>`;
}
