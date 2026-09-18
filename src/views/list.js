import {
  state, periodTransactions, categoryById, categoriesOf,
  deleteTransaction, restoreTransaction, currentLedger, earliestDate, addTransaction
} from '../store.js';
import {
  money, today, currentPeriod, periodKey, periodLabel, shiftPeriod, convertPeriod,
  dateLabel, escapeHtml, sum, totals, PERIOD_UNITS, PERIOD_BTN_TEXT, PERIOD_THIS_TEXT
} from '../utils.js';
import { openSheet, confirmDialog, toast } from '../ui.js';
import { mountTxForm } from './txForm.js';

const view = {
  // unit 是「看多久」：一周 / 一个月 / 一年
  unit: 'month',
  // key 是周期键（见 utils.js）：周='那周的周一'、月='YYYY-MM'、年='YYYY'
  key: currentPeriod('month'),
  categoryId: '',
  keyword: '',
  // 'period' 只看当前周期，'all' 跨全部时间 —— 搜旧记录不用一个周期一个周期翻
  scope: 'period'
};

export function resetListView() {
  // 粒度是「看的方式」，不该被清掉；清的是筛选条件和翻到的位置
  view.key = currentPeriod(view.unit);
  view.categoryId = '';
  view.keyword = '';
  view.scope = 'period';
}

export function renderList(root) {
  const unit = view.unit;
  if (view.key > currentPeriod(unit)) view.key = currentPeriod(unit);

  const ledger = currentLedger();
  const list = periodTransactions(unit, view.key, ledger.id, {
    categoryId: view.categoryId,
    keyword: view.keyword,
    scope: view.scope
  });
  const filtering = Boolean(view.categoryId || view.keyword.trim());
  const allTime = view.scope === 'all';
  // 筛选时合计跟着筛选结果走，免得看了只有餐饮的列表却对上全周期的支出
  const summary = totals(list);

  const atEarliest = view.key <= periodKey(unit, earliestDate(ledger.id));
  const atLatest = view.key >= currentPeriod(unit);

  root.innerHTML = `
    <div class="scope" data-role="scope">
      ${PERIOD_UNITS.map(
        (u) => `<button type="button" data-scope="${u}" class="${!allTime && unit === u ? 'active' : ''}">${PERIOD_BTN_TEXT[u]}</button>`
      ).join('')}
      <button type="button" data-scope="all" class="${allTime ? 'active' : ''}">全部时间</button>
    </div>

    ${allTime ? '' : `<div class="month-nav">
      <button type="button" class="m-arrow" data-role="prev" ${atEarliest ? 'disabled' : ''}>‹</button>
      <span class="m-label">${escapeHtml(periodLabel(unit, view.key))}${filtering ? ` · 筛选出 ${list.length} 笔` : ''}</span>
      <button type="button" class="m-arrow" data-role="next" ${atLatest ? 'disabled' : ''}>›</button>
    </div>`}

    <div class="summary">
      <div><div class="s-val income">${escapeHtml(money(summary.incomeFen))}</div><div class="s-key income">收入</div></div>
      <div><div class="s-val expense">${escapeHtml(money(summary.expenseFen))}</div><div class="s-key expense">支出</div></div>
      <div><div class="s-val balance">${escapeHtml(money(summary.balanceFen))}</div><div class="s-key">结余</div></div>
    </div>

    ${allTime ? `<p class="muted" style="margin:-4px 0 12px 2px">全部时间里${filtering ? '筛选出' : '共'} ${list.length} 笔</p>` : ''}

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
  listEl.innerHTML = list.length ? groupByDay(list, allTime) : emptyState(filtering, allTime, unit);

  root.querySelector('[data-role="scope"]').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-scope]');
    if (!btn) return;
    const next = btn.dataset.scope;

    if (next === 'all') {
      if (allTime) return;
      view.scope = 'all';
      renderList(root);
      return;
    }
    if (!allTime && unit === next) {
      // 再点一次当前这个粒度＝回到当下，和底栏「再点一次当前 tab 回到顶部」一个路子。
      // 翻了好几页想跳回来时，比一格一格按回去省事
      if (view.key === currentPeriod(unit)) return;
      view.key = currentPeriod(unit);
      renderList(root);
      return;
    }
    // 换粒度但不丢位置：拿当前周期的第一天去换算新粒度，
    // 否则翻到 3 月再点「按年」会猛地蹦回 12 月
    view.key = convertPeriod(unit, view.key, next);
    view.unit = next;
    view.scope = 'period';
    renderList(root);
  });

  const prevBtn = root.querySelector('[data-role="prev"]');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      view.key = shiftPeriod(unit, view.key, -1);
      renderList(root);
    });
    root.querySelector('[data-role="next"]').addEventListener('click', () => {
      view.key = shiftPeriod(unit, view.key, 1);
      renderList(root);
    });
  }

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

function groupByDay(list, allTime) {
  const days = new Map();
  for (const t of list) {
    if (!days.has(t.date)) days.set(t.date, []);
    days.get(t.date).push(t);
  }

  const thisYear = String(new Date().getFullYear());

  return [...days.entries()]
    .map(([date, items]) => {
      const incomeFen = sum(items.filter((t) => t.kind === 'income'), (t) => t.amountFen);
      const expenseFen = sum(items.filter((t) => t.kind === 'expense'), (t) => t.amountFen);
      const parts = [];
      if (incomeFen) parts.push(`收 ${money(incomeFen)}`);
      if (expenseFen) parts.push(`支 ${money(expenseFen)}`);

      // 跨年看的时候不写年份会分不清是哪一年
      const y = date.slice(0, 4);
      const label = allTime && y !== thisYear ? `${y}年${dateLabel(date)}` : dateLabel(date);

      return `<div class="day-group">
        <div class="day-head">
          <span>${escapeHtml(label)}</span>
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

function emptyState(filtering, allTime, unit) {
  const title = filtering
    ? '没有符合条件的记录'
    : allTime
      ? '还没有任何记录'
      : `${PERIOD_THIS_TEXT[unit]}还没有记账`;
  return `<div class="empty">
    <span class="empty-ico">${filtering ? '🔍' : '🗒️'}</span>
    ${title}
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
        message: `${tx.date}　${cat?.name ?? '未分类'}　${money(tx.amountFen)} 元\n删掉之后可以马上点提示里的「撤销」找回。`,
        okText: '删除',
        danger: true
      });
      if (!ok) return;
      const gone = await deleteTransaction(tx.id);
      renderList(root);
      // 撤销窗口开 6 秒，误删不用重记
      toast('已删除 1 笔记录', {
        ms: 6000,
        actionLabel: '撤销',
        onAction: async () => {
          await restoreTransaction(gone);
          toast('已恢复');
          renderList(root);
        }
      });
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
  // 复制到今天了，视图也要跟回当下那个周期，不然那笔新记录落在视野外
  if (view.scope !== 'all' && view.key !== currentPeriod(view.unit)) view.key = currentPeriod(view.unit);
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
export function setListFilter({ unit, key, categoryId } = {}) {
  if (unit) view.unit = unit;
  if (key) view.key = key;
  if (categoryId !== undefined) view.categoryId = categoryId;
  // 点统计页图例进来的是「某个周期里的某个分类」，留在周期视图更符合预期
  if (key) view.scope = 'period';
}

export { view as listView };
