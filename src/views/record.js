import { mountTxForm } from './txForm.js';
import { state, currentLedger, monthSummary, setMeta } from '../store.js';
import { money, currentMonth, daysBetween, escapeHtml } from '../utils.js';
import { navigate } from '../nav.js';

const DAY = 86400000;
const REMIND_AFTER_DAYS = 30;   // 这么久没备份就提醒
const MUTE_DAYS = 7;            // 点了「知道了」之后安静几天

export function renderRecord(root) {
  const ledger = currentLedger();
  const summary = monthSummary(currentMonth());
  const budget = ledger.budgetFen || 0;

  root.innerHTML = `
    ${reminderCard()}
    ${budget > 0 ? budgetCard(summary.expenseFen, budget) : ''}
    <div data-role="form"></div>
  `;

  bindReminder(root);

  mountTxForm(root.querySelector('[data-role="form"]'), {
    onSaved: () => {
      // 保存后刷新顶部的预算进度
      renderRecord(root);
    }
  });
}

/**
 * 备份提醒。数据只在本机、系统云备份又是关的，
 * README 里一直劝人定期备份，但 App 自己从来不提。
 */
function reminderCard() {
  const last = state.meta.lastBackupAt || 0;
  const mutedUntil = state.meta.backupReminderMutedUntil || 0;
  if (Date.now() < mutedUntil) return '';
  if (!state.transactions.length) return '';

  // 从没备份过时，按「最早一条记录是多久以前」算
  const oldest = state.transactions.reduce((min, t) => Math.min(min, t.createdAt || Date.now()), Date.now());
  const since = Date.now() - (last || oldest);
  if (since < REMIND_AFTER_DAYS * DAY) return '';

  const days = last ? daysBetween(new Date(last).toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)) : null;
  const text = last
    ? `上次备份是 ${days} 天前了。数据只在这台手机里，建议导出一份存到网盘。`
    : `还没有备份过。数据只在这台手机里，系统云备份也是关的 —— 卸载或者丢手机就全没了。建议导出一份存到网盘。`;

  return `<div class="reminder" data-role="reminder">
    <span class="rem-main">${escapeHtml(text)}</span>
    <button type="button" class="rem-close" data-act="reminder-close" aria-label="暂时不提醒">×</button>
  </div>`;
}

function bindReminder(root) {
  const box = root.querySelector('[data-role="reminder"]');
  if (!box) return;
  box.querySelector('[data-act="reminder-close"]').addEventListener('click', async () => {
    await setMeta('backupReminderMutedUntil', Date.now() + MUTE_DAYS * DAY);
    box.remove();
  });
  box.querySelector('.rem-main').addEventListener('click', () => navigate('settings'));
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
