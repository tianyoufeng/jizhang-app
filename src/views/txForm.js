import { categoriesOf, addTransaction, updateTransaction, currentLedger, categoryBudgetMap } from '../store.js';
import { money, yuanToFen, today, dayAgo, monthOf, escapeHtml } from '../utils.js';
import { toast } from '../ui.js';

/** 输入框里只保留「数字 + 一个小数点 + 最多两位小数」 */
export function sanitizeAmount(raw) {
  let s = String(raw).replace(/[^\d.]/g, '');
  const firstDot = s.indexOf('.');
  if (firstDot !== -1) {
    // 第二个及以后的小数点全部丢掉
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
    const [intPart, decPart = ''] = s.split('.');
    s = `${intPart}.${decPart.slice(0, 2)}`;
  }
  return s;
}

/**
 * 分类格上预算圆点的说明文字，同时当 title 和无障碍替代文本用。
 * 圆点本身只是个色块，屏幕阅读器读不出任何东西，得靠这句。
 */
function budgetLabel(cat, b) {
  if (b.level === 'over') {
    return `${cat.name}：本月已花 ${money(b.spentFen)} 元，超预算 ${money(-b.leftFen)} 元（预算 ${money(b.budgetFen)} 元）`;
  }
  return `${cat.name}：本月已花 ${money(b.spentFen)} 元，预算 ${money(b.budgetFen)} 元，还剩 ${money(b.leftFen)} 元（已用 ${(b.ratio * 100).toFixed(0)}%）`;
}

/**
 * 记账表单。记账页和「编辑某笔记录」共用这一套。
 * opts: { tx?, onSaved?, submitLabel? }
 */
export function mountTxForm(root, opts = {}) {
  const editing = Boolean(opts.tx);

  const draft = editing
    ? {
        kind: opts.tx.kind,
        amount: (opts.tx.amountFen / 100).toFixed(2).replace(/\.00$/, ''),
        categoryId: opts.tx.categoryId,
        date: opts.tx.date,
        note: opts.tx.note || ''
      }
    : {
        kind: 'expense',
        amount: '',
        categoryId: '',
        date: today(),
        note: ''
      };

  root.innerHTML = `
    <div class="seg" data-role="seg">
      <button type="button" data-kind="expense">支出</button>
      <button type="button" data-kind="income">收入</button>
    </div>

    <div class="amount-box">
      <div class="amount-label">金额</div>
      <div class="amount-row">
        <span class="amount-cur">¥</span>
        <input id="amountInput" type="text" inputmode="decimal" placeholder="0.00"
               autocomplete="off" enterkeyhint="done" />
      </div>
      <div class="amount-hint" data-role="hint"></div>
    </div>

    <div class="card">
      <p class="card-title">分类</p>
      <div class="cat-grid" data-role="cats"></div>
      <p class="cat-legend" data-role="cat-legend" hidden></p>
    </div>

    <div class="card">
      <div class="field-grid">
        <div class="field">
          <span class="field-label">日期</span>
          <input type="date" data-role="date" />
        </div>
        <div class="quick-dates" data-role="quickdates">
          <button type="button" class="chip" data-off="0">今天</button>
          <button type="button" class="chip" data-off="1">昨天</button>
          <button type="button" class="chip" data-off="2">前天</button>
        </div>
        <div class="field">
          <span class="field-label">备注</span>
          <input type="text" data-role="note" maxlength="60" placeholder="选填，例如：和同事聚餐" />
        </div>
      </div>
    </div>

    <button type="button" class="btn btn-primary btn-block" data-role="save">${escapeHtml(opts.submitLabel || (editing ? '保存修改' : '保存这笔'))}</button>
  `;

  const amountEl = root.querySelector('#amountInput');
  const hintEl = root.querySelector('[data-role="hint"]');
  const catsEl = root.querySelector('[data-role="cats"]');
  const legendEl = root.querySelector('[data-role="cat-legend"]');
  const dateEl = root.querySelector('[data-role="date"]');
  const noteEl = root.querySelector('[data-role="note"]');
  const saveEl = root.querySelector('[data-role="save"]');
  const quickEl = root.querySelector('[data-role="quickdates"]');

  amountEl.value = draft.amount;
  dateEl.value = draft.date;
  noteEl.value = draft.note;

  function renderSeg() {
    root.querySelectorAll('[data-role="seg"] button').forEach((b) => {
      b.classList.toggle('active', b.dataset.kind === draft.kind);
    });
  }

  function renderCats() {
    const list = categoriesOf(draft.kind);
    if (!list.length) {
      catsEl.innerHTML = '<div class="muted">这个类型下还没有分类，去「设置 → 分类管理」加一个</div>';
      legendEl.hidden = true;
      return;
    }
    if (!list.some((c) => c.id === draft.categoryId)) {
      draft.categoryId = list[0].id;
    }

    // 圆点跟着「所选日期」所在的月份走：补记上个月的账时，
    // 该看到的是上个月花了多少，而不是今天的当月进度。
    const budgets = draft.kind === 'expense' ? categoryBudgetMap(monthOf(draft.date)) : new Map();

    catsEl.innerHTML = list
      .map((c) => {
        const b = budgets.get(c.id);
        const label = b ? budgetLabel(c, b) : '';
        return `<button type="button" class="cat-item ${c.id === draft.categoryId ? 'active' : ''}" data-cat="${c.id}"
            ${b ? `title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"` : ''}>
          ${b ? `<span class="cat-dot ${b.level}"></span>` : ''}
          <span class="cat-emoji">${escapeHtml(c.emoji)}</span>
          <span class="cat-name">${escapeHtml(c.name)}</span>
        </button>`;
      })
      .join('');

    // 一个预算都没设时，这行说明只会是噪音。
    // 文案压到一行以内 —— 记账页本来就不短，别再往下多推一行
    legendEl.hidden = budgets.size === 0;
    legendEl.textContent = '圆点＝月预算，黄是花到八成，红是超支';
  }

  /** 日期快捷按钮的高亮：只有正好等于今天/昨天/前天时才亮 */
  function renderQuick() {
    quickEl.querySelectorAll('[data-off]').forEach((b) => {
      b.classList.toggle('active', dayAgo(Number(b.dataset.off)) === draft.date);
    });
  }

  function validate() {
    const fen = yuanToFen(draft.amount);
    if (draft.amount.trim() === '') {
      hintEl.className = 'amount-hint';
      hintEl.textContent = '';
      return null;
    }
    if (fen === null) {
      hintEl.className = 'amount-hint error';
      hintEl.textContent = '金额只能填数字，最多两位小数';
      return null;
    }
    if (fen <= 0) {
      hintEl.className = 'amount-hint error';
      hintEl.textContent = '金额要大于 0';
      return null;
    }
    hintEl.className = 'amount-hint';
    hintEl.textContent = `合计 ${money(fen)} 元`;
    return fen;
  }

  // 进来就把第二个小数点挡掉。以前是原样放行，然后校验时报
  // 「只能填数字」——可用户确实只输了数字和点，看到会莫名其妙
  amountEl.addEventListener('input', () => {
    const clean = sanitizeAmount(amountEl.value);
    if (clean !== amountEl.value) {
      const pos = amountEl.selectionStart ?? clean.length;
      amountEl.value = clean;
      const next = Math.max(0, Math.min(clean.length, pos - 1));
      amountEl.setSelectionRange(next, next);
    }
    draft.amount = clean;
    validate();
  });

  amountEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEl.click();
    }
  });

  root.querySelectorAll('[data-role="seg"] button').forEach((b) => {
    b.addEventListener('click', () => {
      draft.kind = b.dataset.kind;
      draft.categoryId = '';
      renderSeg();
      renderCats();
    });
  });

  catsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    draft.categoryId = btn.dataset.cat;
    renderCats();
  });

  dateEl.addEventListener('change', () => {
    draft.date = dateEl.value || today();
    renderQuick();
    renderCats();   // 换了月份，分类格上的预算进度也得跟着换
  });

  quickEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-off]');
    if (!btn) return;
    draft.date = dayAgo(Number(btn.dataset.off));
    dateEl.value = draft.date;
    renderQuick();
    renderCats();
  });

  noteEl.addEventListener('input', () => {
    draft.note = noteEl.value;
  });

  saveEl.addEventListener('click', async () => {
    const fen = validate();
    if (fen === null) {
      if (draft.amount.trim() === '') toast('先填金额');
      amountEl.focus();
      return;
    }
    if (!draft.categoryId) {
      toast('先选一个分类');
      return;
    }

    saveEl.disabled = true;
    try {
      if (editing) {
        await updateTransaction(opts.tx.id, {
          kind: draft.kind,
          amountFen: fen,
          categoryId: draft.categoryId,
          date: draft.date,
          note: draft.note.trim()
        });
        toast('已保存修改');
      } else {
        await addTransaction({
          ledgerId: currentLedger().id,
          kind: draft.kind,
          amountFen: fen,
          categoryId: draft.categoryId,
          date: draft.date,
          note: draft.note.trim()
        });
        toast(`记下了 ${money(fen)} 元`);
      }
      saveEl.disabled = false;
      opts.onSaved?.({ ...draft, amountFen: fen });
    } catch (err) {
      saveEl.disabled = false;
      toast('保存失败：' + err.message);
    }
  });

  renderSeg();
  renderCats();
  renderQuick();
  validate();

  // 改金额是最常见的修改，打开就把原数字选中，直接输新的就行
  if (editing) {
    setTimeout(() => {
      amountEl.focus();
      amountEl.select();
    }, 150);
  }

  return {
    draft,
    reset() {
      draft.amount = '';
      draft.note = '';
      draft.date = today();
      draft.categoryId = '';
      amountEl.value = '';
      noteEl.value = '';
      dateEl.value = draft.date;
      renderCats();
      renderQuick();
      validate();
    }
  };
}
