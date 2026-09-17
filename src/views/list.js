import {
  state, monthTransactions, categoryById, categoriesOf,
  deleteTransaction, currentLedger, earliestMonth, addTransaction
} from '../store.js';
import { money, today, currentMonth, shiftMonth, monthLabel, dateLabel, escapeHtml, sum, totals } from '../utils.js';
import { openSheet, confirmDialog, toast } from '../ui.js';
import { mountTxForm } from './txForm.js';

const view = {
  month: currentMonth(),
  categoryId: '',
  keyword: ''
};

export function resetListView() {
  view.month = currentMonth();
  view.categoryId = '';
  view.keyword = '';
}

export function renderList(root) {
  if (view.month > currentMonth()) view.month = currentMonth();

  const ledger = currentLedger();
  const list = monthTransactions(view.month, ledger.id, {
    categoryId: view.categoryId,
    keyword: view.keyword
  });
  const filtering = Boolean(view.categoryId || view.keyword.trim());
  // 筛选时合计跟着筛选结果走，免得看了只有餐饮的列表却对上全月的支出
  const summary = totals(list);

  const atEarliest = view.month <= earliestMonth(ledger.id);
  const atLatest = view.month >= currentMonth();

  root.innerHTML = `
    <div class="month-nav">
      <button type="button" class="m-arrow" data-role="prev" ${atEarliest ? 'disabled' : ''}>‹</button>
      <span class="m-label">${escapeHtml(monthLabel(view.month))}${filtering ? ` · 筛选出 ${list.length} 笔` : ''}</span>
      <button type="button" class="m-arrow" data-role="next" ${atLatest ? 'disabled' : ''}>›</button>
    </div>

    <div class="summary">
      <div><div class="s-val income">${escapeHtml(money(summary.incomeFen))}</div><div class="s-key">收入</div></div>
      <div><div class="s-val expense">${escapeHtml(money(summary.expenseFen))}</div><div class="s-key">支出</div></div>
      <div><div class="s-val balance">${escapeHtml(money(summary.balanceFen))}</div><div class="s-key">结余</div></div>
    </div>

    <div class="filters">
      <select data-role="cat">
        <option value="">全部分类</option>
        ${categoriesOf('expense').map((c) => `<option value="${c.id}" ${view.categoryId === c.id ? 'selected' : ''}>支出 · ${escapeHtml(c.name)}</option>`).join('')}
        ${categoriesOf('income').map((c) => `<option value="${c.id}" ${view.categoryId === c.id ? 'selected' : ''}>收入 · ${escapeHtml(c.name)}</option>`).join('')}
      </select>
      <input type="search" data-role="kw" placeholder="搜备注或分类" value="${escapeHtml(view.keyword)}" />
    </div>

    <div data-role="list"></div>
  `;

  const listEl = root.querySelector('[data-role="list"]');
  listEl.innerHTML = list.length ? groupByDay(list) : emptyState(filtering);

  root.querySelector('[data-role="prev"]').addEventListener('click', () => {
    view.month = shiftMonth(view.month, -1);
    renderList(root);
  });
  root.querySelector('[data-role="next"]').addEventListener('click', () => {
    view.month = shiftMonth(view.month, 1);
    renderList(root);
  });

  root.querySelector('[data-role="cat"]').addEventListener('change', (e) => {
    view.categoryId = e.target.value;
    renderList(root);
  });

  const kwEl = root.querySelector('[data-role="kw"]');
  let kwTimer = null;
  kwEl.addEventListener('input', () => {
    clearTimeout(kwTimer);
    kwTimer = setTimeout(() => {
      view.keyword = kwEl.value;
      renderList(root);
      const next = document.querySelector('[data-role="kw"]');
      if (next) {
        next.focus();
        next.setSelectionRange(next.value.length, next.value.length);
      }
    }, 260);
  });

  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('[data-tx]');
    if (!row) return;
    openTxActions(row.dataset.tx, root);
  });
}

function groupByDay(list) {
  const days = new Map();
  for (const t of list) {
    if (!days.has(t.date)) days.set(t.date, []);
    days.get(t.date).push(t);
  }

  return [...days.entries()]
    .map(([date, items]) => {
      const incomeFen = sum(items.filter((t) => t.kind === 'income'), (t) => t.amountFen);
      const expenseFen = sum(items.filter((t) => t.kind === 'expense'), (t) => t.amountFen);
      const parts = [];
      if (incomeFen) parts.push(`收 ${money(incomeFen)}`);
      if (expenseFen) parts.push(`支 ${money(expenseFen)}`);

      return `<div class="day-group">
        <div class="day-head">
          <span>${escapeHtml(dateLabel(date))}</span>
          <span class="d-sub">${escapeHtml(parts.join('　'))}</span>
        </div>
        <div class="tx-list">
          ${items
            .map((t) => {
              const cat = categoryById(t.categoryId);
              return `<div class="tx" data-tx="${t.id}">
                <span class="tx-emoji">${escapeHtml(cat?.emoji ?? '❓')}</span>
                <span class="tx-main">
                  <div class="tx-cat">${escapeHtml(cat?.name ?? '未分类')}</div>
                  ${t.note ? `<div class="tx-note">${escapeHtml(t.note)}</div>` : ''}
                </span>
                <span class="tx-amt ${t.kind}">${t.kind === 'expense' ? '-' : '+'}${escapeHtml(money(t.amountFen))}</span>
              </div>`;
            })
            .join('')}
        </div>
      </div>`;
    })
    .join('');
}

function emptyState(filtering) {
  return `<div class="empty">
    <span class="empty-ico">${filtering ? '🔍' : '🗒️'}</span>
    ${filtering ? '没有符合条件的记录' : '这个月还没有记账'}
  </div>`;
}

/* ---------------- 点一条记录后的操作 ---------------- */

function openTxActions(txId, root) {
  const tx = state.transactions.find((t) => t.id === txId);
  if (!tx) return;

  const cat = categoryById(tx.categoryId);
  const handle = openSheet({
    title: '这笔记录',
    body: `
      <div class="set-list">
        <div class="set-row" style="cursor:default">
          <span class="sr-ico">${escapeHtml(cat?.emoji ?? '❓')}</span>
          <span class="sr-main">
            <div style="font-size:16px;font-weight:600">${escapeHtml(money(tx.amountFen))} 元</div>
            <div class="sr-sub">${escapeHtml(cat?.name ?? '未分类')} · ${escapeHtml(tx.date)}${tx.note ? ' · ' + escapeHtml(tx.note) : ''}</div>
          </span>
        </div>
        <button type="button" class="set-row" data-act="edit"><span class="sr-ico">✏️</span><span class="sr-main">修改</span></button>
        <button type="button" class="set-row" data-act="dup"><span class="sr-ico">📋</span><span class="sr-main">再记一笔一样的<span class="sr-sub">复制到今天</span></span></button>
        <button type="button" class="set-row" data-act="del"><span class="sr-ico">🗑️</span><span class="sr-main" style="color:var(--danger)">删除</span></button>
      </div>`,
    actions: [{ label: '取消', className: 'btn-outline', onClick: (h) => h.close() }]
  });

  handle.body.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    handle.close();

    if (act === 'edit') return openEditor(tx, root);

    if (act === 'del') {
      const ok = await confirmDialog({
        title: '删除这笔记录？',
        message: `${tx.date}　${cat?.name ?? '未分类'}　${money(tx.amountFen)} 元\n删掉之后没法恢复。`,
        okText: '删除',
        danger: true
      });
      if (!ok) return;
      await deleteTransaction(tx.id);
      toast('已删除');
      renderList(root);
      return;
    }

    if (act === 'dup') {
      await copyToToday(tx, root);
    }
  });
}

async function copyToToday(tx, root) {
  await addTransaction({
    ledgerId: currentLedger().id,
    kind: tx.kind,
    amountFen: tx.amountFen,
    categoryId: tx.categoryId,
    date: today(),
    note: tx.note
  });
  toast('已复制到今天');
  if (view.month !== currentMonth()) view.month = currentMonth();
  renderList(root);
}

function openEditor(tx, root) {
  const handle = openSheet({
    title: '修改记录',
    body: '<div data-role="form"></div>'
  });

  mountTxForm(handle.body.querySelector('[data-role="form"]'), {
    tx,
    submitLabel: '保存修改',
    onSaved: () => {
      handle.close();
      renderList(root);
    }
  });
}

/* 让「跳转到某分类」这类外部操作能改到筛选条件 */
export function setListFilter({ month, categoryId } = {}) {
  if (month) view.month = month;
  if (categoryId !== undefined) view.categoryId = categoryId;
}

export { view as listView };
