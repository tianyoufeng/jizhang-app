import { categoriesOf, addTransaction, updateTransaction, currentLedger } from '../store.js';
import { money, yuanToFen, today, escapeHtml } from '../utils.js';
import { toast } from '../ui.js';

/**
 * 记账表单。记账页和「编辑某笔记录」共用这一套。
 * opts: { tx?, onSaved?, submitLabel?, compact? }
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
    </div>

    <div class="card">
      <div class="field-grid">
        <div class="field">
          <span class="field-label">日期</span>
          <input type="date" data-role="date" />
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
  const dateEl = root.querySelector('[data-role="date"]');
  const noteEl = root.querySelector('[data-role="note"]');
  const saveEl = root.querySelector('[data-role="save"]');

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
      return;
    }
    if (!list.some((c) => c.id === draft.categoryId)) {
      draft.categoryId = list[0].id;
    }
    catsEl.innerHTML = list
      .map(
        (c) => `<button type="button" class="cat-item ${c.id === draft.categoryId ? 'active' : ''}" data-cat="${c.id}">
          <span class="cat-emoji">${escapeHtml(c.emoji)}</span>
          <span class="cat-name">${escapeHtml(c.name)}</span>
        </button>`
      )
      .join('');
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

  amountEl.addEventListener('input', () => {
    draft.amount = amountEl.value.replace(/[^\d.]/g, '');
    if (amountEl.value !== draft.amount) amountEl.value = draft.amount;
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
      validate();
    }
  };
}
