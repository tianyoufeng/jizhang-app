import {
  state, initStore, currentLedger, switchLedger, addLedger, updateLedger, deleteLedger,
  categoriesOf, addCategory, updateCategory, moveCategory, deleteCategory, categoryUsage,
  categoryBudgetMap, exportPayload, importPayload, toCsv, monthSummary, setMeta
} from '../store.js';
import { db } from '../db.js';
import { money, yuanToFen, fenToYuan, currentMonth, daysBetween, toDateStr, escapeHtml, APP_VERSION } from '../utils.js';
import { openSheet, confirmDialog, alertDialog, toast } from '../ui.js';
import { saveTextFile, readTextFile, stamp } from '../fileio.js';

// 图标一律挑 Unicode 9.0（2016）以前就有的，旧安卓的 emoji 字体才画得出来
const EMOJI_CHOICES = [
  '🍚','🍜','🍔','🍰','☕','🍺','🚌','🚇','🚕','⛽','🛒','👕','💄','🏠','💡','📱','🎮','🎬','✈️','🏨',
  '💊','🏥','📚','✏️','🎓','🎁','💵','💰','💼','📈','🐱','👶','🔧','🚿','🛁','🏋️','🎵','📷','🌸','📦',
  '💳','🏦','💎','🎯','📄','💉','🍎','🚗','🛵','🎨','🧧'
];

export function renderSettings(root) {
  // 用一个全新的容器承载这一页，监听器跟着容器一起被丢掉，
  // 避免重复渲染时旧的监听器还挂在 #view 上被重复触发。
  const page = document.createElement('div');
  root.replaceChildren(page);

  const ledger = currentLedger();
  const summary = monthSummary(currentMonth(), ledger.id);
  const budget = ledger.budgetFen || 0;
  const lastBackup = state.meta.lastBackupAt || 0;

  page.innerHTML = `
    <div class="set-group">
      <h2>账本</h2>
      <div class="set-list">
        <button type="button" class="set-row" data-act="ledgers">
          <span class="sr-ico">📒</span>
          <span class="sr-main">${escapeHtml(ledger.name)}<span class="sr-sub">共 ${state.ledgers.length} 个账本，点这里切换</span></span>
          <span class="sr-arrow">›</span>
        </button>
        <button type="button" class="set-row" data-act="budget">
          <span class="sr-ico">🎯</span>
          <span class="sr-main">本月预算<span class="sr-sub">本月已花 ${escapeHtml(money(summary.expenseFen))} 元</span></span>
          <span class="sr-val">${budget ? escapeHtml(money(budget)) + ' 元' : '未设置'}</span>
          <span class="sr-arrow">›</span>
        </button>
        <button type="button" class="set-row" data-act="rename">
          <span class="sr-ico">✏️</span>
          <span class="sr-main">重命名当前账本</span>
          <span class="sr-arrow">›</span>
        </button>
        <button type="button" class="set-row" data-act="newledger">
          <span class="sr-ico">➕</span>
          <span class="sr-main">新建账本<span class="sr-sub">比如「装修」「旅行」，数据各算各的</span></span>
          <span class="sr-arrow">›</span>
        </button>
      </div>
    </div>

    <div class="set-group">
      <h2>分类</h2>
      <div class="set-list">
        <button type="button" class="set-row" data-act="cats">
          <span class="sr-ico">🏷️</span>
          <span class="sr-main">分类管理<span class="sr-sub">新增、改名、换图标、调顺序、删除</span></span>
          <span class="sr-val">${state.categories.length} 个</span>
          <span class="sr-arrow">›</span>
        </button>
      </div>
    </div>

    <div class="set-group">
      <h2>数据</h2>
      <div class="set-list">
        <button type="button" class="set-row" data-act="csv">
          <span class="sr-ico">📊</span>
          <span class="sr-main">导出当前账本为 CSV<span class="sr-sub">Excel / WPS 能直接打开</span></span>
          <span class="sr-arrow">›</span>
        </button>
        <button type="button" class="set-row" data-act="backup">
          <span class="sr-ico">💾</span>
          <span class="sr-main">导出完整备份<span class="sr-sub">所有账本、分类、预算，一个文件全带走</span></span>
          <span class="sr-val">${escapeHtml(backupHint(lastBackup))}</span>
          <span class="sr-arrow">›</span>
        </button>
        <button type="button" class="set-row" data-act="restore">
          <span class="sr-ico">📥</span>
          <span class="sr-main">从备份恢复<span class="sr-sub" style="color:var(--danger)">会覆盖现在的全部数据</span></span>
          <span class="sr-arrow">›</span>
        </button>
        <button type="button" class="set-row" data-act="wipe">
          <span class="sr-ico">🗑️</span>
          <span class="sr-main" style="color:var(--danger)">清空所有数据</span>
          <span class="sr-arrow">›</span>
        </button>
      </div>
      <p class="muted" style="margin:10px 6px 0">
        数据全部存在这台手机里，不联网、不上传。换手机或者怕丢，记得定期「导出完整备份」，把文件存到网盘或发给自己。
      </p>
    </div>

    <div class="set-group">
      <h2>关于</h2>
      <div class="set-list">
        <div class="set-row" style="cursor:default">
          <span class="sr-ico">ℹ️</span>
          <span class="sr-main">记账本<span class="sr-sub">本地版 v${escapeHtml(APP_VERSION)} · 记录 ${state.transactions.length} 笔</span></span>
        </div>
      </div>
    </div>
  `;

  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const rerender = () => renderSettings(root);

    if (act === 'ledgers') return openLedgerList(root);
    if (act === 'budget') return openBudgetEditor(root);
    if (act === 'rename') return openLedgerRename(root);
    if (act === 'newledger') return openNewLedger(root);
    if (act === 'cats') return openCategoryManager(root);
    if (act === 'csv') return doExportCsv();
    if (act === 'backup') return doExportBackup(rerender);
    if (act === 'restore') return doRestore(rerender);
    if (act === 'wipe') return doWipe(rerender);
  });
}

/** 「导出完整备份」这一行右边显示上次备份是多久以前 */
function backupHint(lastBackup) {
  if (!lastBackup) return '还没有备份';
  const days = daysBetween(toDateStr(new Date(lastBackup)), toDateStr(new Date()));
  if (days <= 0) return '今天刚备份';
  if (days === 1) return '昨天备份';
  return `${days} 天前备份`;
}

/* ---------------- 账本 ---------------- */

function openLedgerList(root) {
  const rows = state.ledgers
    .map(
      (l) => `<button type="button" class="set-row" data-id="${l.id}">
        <span class="sr-ico">${l.id === state.meta.currentLedgerId ? '✅' : '📒'}</span>
        <span class="sr-main">${escapeHtml(l.name)}
          <span class="sr-sub">${state.transactions.filter((t) => t.ledgerId === l.id).length} 笔${l.budgetFen ? ' · 预算 ' + escapeHtml(money(l.budgetFen)) : ''}</span>
        </span>
        ${state.ledgers.length > 1 ? `<span class="sr-val" data-del="${l.id}">删除</span>` : ''}
      </button>`
    )
    .join('');

  const handle = openSheet({
    title: '选择账本',
    body: `<div class="set-list">${rows}</div>
      <p class="muted" style="margin-top:12px">每个账本的记录和统计互相独立，切换后首页、账单、统计都会跟着变。</p>`
  });

  handle.body.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const ledger = state.ledgers.find((l) => l.id === del.dataset.del);
      const count = state.transactions.filter((t) => t.ledgerId === ledger.id).length;
      const ok = await confirmDialog({
        title: `删除「${ledger.name}」？`,
        message: count ? `这个账本里有 ${count} 笔记录，会一起删掉，删了没法恢复。` : '这个账本还是空的，删掉不影响别的账本。',
        okText: '删除',
        danger: true
      });
      if (!ok) return;
      try {
        await deleteLedger(ledger.id);
        toast('已删除账本');
        handle.close();
        renderSettings(root);
      } catch (err) {
        toast(err.message);
      }
      return;
    }

    const row = e.target.closest('[data-id]');
    if (!row) return;
    await switchLedger(row.dataset.id);
    toast('已切换账本');
    handle.close();
    renderSettings(root);
  });
}

function openNewLedger(root) {
  const handle = openSheet({
    title: '新建账本',
    body: `<div class="field-grid">
      <div class="field"><span class="field-label">名字</span>
        <input type="text" data-role="name" maxlength="12" placeholder="例如：装修" /></div>
      <div class="field"><span class="field-label">预算</span>
        <input type="text" inputmode="decimal" data-role="budget" placeholder="选填，每月支出上限" /></div>
    </div>
    <p class="muted" style="margin-top:10px">预算可以以后再设，先建账本也行。</p>`,
    actions: [
      { label: '取消', className: 'btn-outline', onClick: (h) => h.close() },
      {
        label: '创建',
        className: 'btn-primary',
        onClick: async (h) => {
          const name = h.body.querySelector('[data-role="name"]').value.trim();
          const budgetRaw = h.body.querySelector('[data-role="budget"]').value.trim();
          if (!name) return toast('给账本起个名字');

          let budgetFen = 0;
          if (budgetRaw) {
            const fen = yuanToFen(budgetRaw);
            if (fen === null || fen < 0) return toast('预算填个数字就行，比如 3000');
            budgetFen = fen;
          }

          const ledger = await addLedger(name, budgetFen);
          await switchLedger(ledger.id);
          toast(`已创建「${name}」并切过去了`);
          h.close();
          renderSettings(root);
        }
      }
    ]
  });

  setTimeout(() => handle.body.querySelector('[data-role="name"]')?.focus(), 120);
}

function openLedgerRename(root) {
  const ledger = currentLedger();
  const handle = openSheet({
    title: '重命名账本',
    body: `<div class="field-grid">
      <div class="field"><span class="field-label">名字</span>
        <input type="text" data-role="name" maxlength="12" value="${escapeHtml(ledger.name)}" /></div>
    </div>`,
    actions: [
      { label: '取消', className: 'btn-outline', onClick: (h) => h.close() },
      {
        label: '保存',
        className: 'btn-primary',
        onClick: async (h) => {
          const name = h.body.querySelector('[data-role="name"]').value.trim();
          if (!name) return toast('名字不能是空的');
          await updateLedger(ledger.id, { name });
          toast('已改名');
          h.close();
          renderSettings(root);
        }
      }
    ]
  });

  setTimeout(() => handle.body.querySelector('[data-role="name"]')?.select(), 120);
}

function openBudgetEditor(root) {
  const ledger = currentLedger();
  const handle = openSheet({
    title: '本月预算',
    body: `<div class="field-grid">
      <div class="field"><span class="field-label">金额</span>
        <input type="text" inputmode="decimal" data-role="amount"
               placeholder="比如 3000，填 0 表示不设预算"
               value="${ledger.budgetFen ? escapeHtml(fenToYuan(ledger.budgetFen)) : ''}" /></div>
    </div>
    <p class="muted" style="margin-top:10px">这是每个月总的支出上限，花到 80% 会提醒你。</p>`,
    actions: [
      { label: '取消', className: 'btn-outline', onClick: (h) => h.close() },
      {
        label: '保存',
        className: 'btn-primary',
        onClick: async (h) => {
          const raw = h.body.querySelector('[data-role="amount"]').value.trim();
          if (!raw) {
            await updateLedger(ledger.id, { budgetFen: 0 });
            toast('已取消预算');
            h.close();
            return renderSettings(root);
          }
          const fen = yuanToFen(raw);
          if (fen === null) return toast('填数字就行，比如 3000');
          await updateLedger(ledger.id, { budgetFen: fen });
          toast(fen ? `预算设为 ${money(fen)} 元` : '已取消预算');
          h.close();
          renderSettings(root);
        }
      }
    ]
  });

  setTimeout(() => handle.body.querySelector('[data-role="amount"]')?.focus(), 120);
}

/* ---------------- 分类管理 ---------------- */

/** 分类管理列表里那行小字：用了多少笔，设了预算的再带上本月进度 */
function catSub(used, b) {
  const base = `${used} 笔记录在用`;
  if (!b) return base;
  const pct = (b.ratio * 100).toFixed(0);
  return `${base} · 本月 ${money(b.spentFen)} / ${money(b.budgetFen)} 元（${pct}%）`;
}

function openCategoryManager(root, kind = 'expense') {
  const handle = openSheet({
    title: '分类管理',
    body: `
      <div class="seg" data-role="seg" style="margin-bottom:12px">
        <button type="button" data-kind="expense">支出分类</button>
        <button type="button" data-kind="income">收入分类</button>
      </div>
      <div data-role="list"></div>
      <button type="button" class="btn btn-outline btn-block" data-role="add" style="margin-top:14px">➕ 新增分类</button>
      <p class="muted" style="margin-top:12px">↑↓ 调整分类在记账页的排列顺序。点分类可以改名、换图标，也可以给支出分类设月预算。删掉分类不会删掉记录，那些记录会显示成「未分类」。</p>`
  });

  function paint() {
    const items = categoriesOf(kind);
    // 只有支出分类有预算这回事，收入分类不必白算一遍
    const budgets = kind === 'expense' ? categoryBudgetMap(currentMonth()) : new Map();

    handle.body.querySelectorAll('[data-role="seg"] button').forEach((b) => {
      b.classList.toggle('active', b.dataset.kind === kind);
    });

    const box = handle.body.querySelector('[data-role="list"]');
    box.innerHTML = `<div class="set-list">${items
      .map((c, i) => {
        const used = categoryUsage(c.id);
        const b = budgets.get(c.id);
        return `<div class="cat-row">
          <button type="button" class="cat-row-main" data-cat="${c.id}">
            <span class="cm-emoji">${escapeHtml(c.emoji)}</span>
            <span class="cm-body">
              <div class="cm-name">${escapeHtml(c.name)}</div>
              <div class="cm-sub ${b ? b.level : ''}">${catSub(used, b)}</div>
            </span>
          </button>
          <span class="cm-tools">
            <button type="button" class="mini-btn" data-up="${c.id}" ${i === 0 ? 'disabled' : ''} aria-label="上移">↑</button>
            <button type="button" class="mini-btn" data-down="${c.id}" ${i === items.length - 1 ? 'disabled' : ''} aria-label="下移">↓</button>
          </span>
        </div>`;
      })
      .join('')}</div>`;

    box.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => openCategoryEditor(state.categories.find((c) => c.id === btn.dataset.cat), () => paint(), root));
    });

    box.querySelectorAll('[data-up], [data-down]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const delta = btn.dataset.up ? -1 : 1;
        const id = btn.dataset.up || btn.dataset.down;
        if (await moveCategory(id, delta)) paint();
      });
    });
  }

  handle.body.querySelectorAll('[data-role="seg"] button').forEach((b) => {
    b.addEventListener('click', () => {
      kind = b.dataset.kind;
      paint();
    });
  });

  handle.body.querySelector('[data-role="add"]').addEventListener('click', () => {
    openCategoryEditor(null, () => {
      handle.close();
      renderSettings(root);
    }, root, kind);
  });

  paint();
}

function openCategoryEditor(cat, onDone, root, kind = 'expense') {
  const isNew = !cat;
  let emoji = cat?.emoji ?? '📦';
  let selectedKind = cat?.kind ?? kind;

  const handle = openSheet({
    title: isNew ? '新增分类' : '编辑分类',
    body: `
      <div class="field-grid">
        <div class="field"><span class="field-label">名称</span>
          <input type="text" data-role="name" maxlength="6" value="${escapeHtml(cat?.name ?? '')}" placeholder="最多 6 个字" /></div>
        <div class="field"><span class="field-label">类型</span>
          <select data-role="kind">
            <option value="expense" ${selectedKind === 'expense' ? 'selected' : ''}>支出</option>
            <option value="income" ${selectedKind === 'income' ? 'selected' : ''}>收入</option>
          </select></div>
        <div class="field" data-role="budget-field" ${selectedKind === 'expense' ? '' : 'hidden'}>
          <span class="field-label">月预算</span>
          <input type="text" inputmode="decimal" data-role="budget" placeholder="选填，比如 1000"
                 value="${cat?.budgetFen ? escapeHtml(fenToYuan(cat.budgetFen)) : ''}" /></div>
      </div>
      <p class="muted" data-role="budget-hint" style="margin-top:10px" ${selectedKind === 'expense' ? '' : 'hidden'}>
        月预算是这个分类每月的支出上限。记账页的分类格上会显示进度，花到八成变黄、超支变红。留空或填 0 就是不设。
      </p>
      <p class="card-title" style="margin:16px 0 8px">选个图标</p>
      <div class="emoji-grid" data-role="emojis">
        ${EMOJI_CHOICES.map((e) => `<button type="button" data-e="${e}" class="${e === emoji ? 'active' : ''}">${e}</button>`).join('')}
      </div>
      ${isNew ? '' : '<div class="divider"></div><button type="button" class="btn btn-danger btn-block" data-role="del">删除这个分类</button>'}`,
    actions: [
      { label: '取消', className: 'btn-outline', onClick: (h) => h.close() },
      {
        label: isNew ? '创建' : '保存',
        className: 'btn-primary',
        onClick: async (h) => {
          const name = h.body.querySelector('[data-role="name"]').value.trim();
          if (!name) return toast('给分类起个名字');
          const k = h.body.querySelector('[data-role="kind"]').value;
          const budgetRaw = h.body.querySelector('[data-role="budget"]').value.trim();

          // 收入分类没有预算这回事，那时输入框是藏着的，直接按不设处理
          let budgetFen = 0;
          if (k === 'expense' && budgetRaw) {
            const fen = yuanToFen(budgetRaw);
            if (fen === null || fen < 0) return toast('月预算填个数字就行，比如 1000');
            budgetFen = fen;
          }

          if (isNew) {
            await addCategory(k, name, emoji, budgetFen);
            toast(budgetFen ? `分类已添加，月预算 ${money(budgetFen)} 元` : '分类已添加');
          } else {
            await updateCategory(cat.id, { name, emoji, kind: k, budgetFen });
            toast(budgetFen ? `已保存，月预算 ${money(budgetFen)} 元` : '已保存');
          }
          h.close();
          onDone?.();
        }
      }
    ]
  });

  // 改成收入分类就把预算那一格收起来。用的是 hidden 属性，
  // 而 .field 是 display:flex —— 所以 styles.css 里必须有 [hidden] 的兜底规则，
  // 否则这一行根本藏不住（踩过一次）。
  handle.body.querySelector('[data-role="kind"]').addEventListener('change', (e) => {
    const isExpense = e.target.value === 'expense';
    handle.body.querySelector('[data-role="budget-field"]').hidden = !isExpense;
    handle.body.querySelector('[data-role="budget-hint"]').hidden = !isExpense;
  });

  handle.body.querySelector('[data-role="emojis"]').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-e]');
    if (!btn) return;
    emoji = btn.dataset.e;
    handle.body.querySelectorAll('[data-e]').forEach((b) => b.classList.toggle('active', b === btn));
  });

  handle.body.querySelector('[data-role="del"]')?.addEventListener('click', async () => {
    const used = categoryUsage(cat.id);
    const ok = await confirmDialog({
      title: `删除「${cat.name}」？`,
      message: used
        ? `有 ${used} 笔记录在用这个分类。删掉分类不会删记录，但那些记录会变成「未分类」。`
        : '这个分类还没被用过，可以放心删。',
      okText: '删除',
      danger: true
    });
    if (!ok) return;
    await deleteCategory(cat.id);
    toast('已删除');
    handle.close();
    onDone?.();
  });

  setTimeout(() => handle.body.querySelector('[data-role="name"]')?.focus(), 120);
}

/* ---------------- 导出 / 导入 ---------------- */

/** 把 saveTextFile 的返回值翻译成一句人话 */
function describeSave(res) {
  if (res.mode === 'download') return '已导出，去「下载」或「文件」里找';
  if (res.mode === 'share-failed') return '文件已生成，但发送面板没弹出来：' + (res.message || '系统限制');
  return '已导出，选个地方保存吧';
}

async function doExportCsv() {
  const ledger = currentLedger();
  const csv = toCsv(ledger.id);
  const rows = csv.split('\r\n').length - 1;
  if (!rows) return toast('这个账本还没有记录，导出来是空的');

  // 加 BOM，不然 Excel 打开中文会乱码
  const filename = `${ledger.name}-${stamp()}.csv`;
  try {
    const res = await saveTextFile(filename, '﻿' + csv, 'text/csv');
    toast(`${res.mode === 'download' ? `已导出 ${rows} 条，` : ''}${describeSave(res)}`);
  } catch (err) {
    toast('导出失败：' + (err.message || '未知原因'));
  }
}

async function doExportBackup(rerender) {
  if (!state.transactions.length) return toast('还没有数据可以备份');
  const filename = `记账备份-${stamp()}.json`;
  try {
    const res = await saveTextFile(filename, JSON.stringify(exportPayload(), null, 2), 'application/json');
    // 记下备份时间，「记账」页据此判断要不要提醒
    await setMeta('lastBackupAt', Date.now());
    toast(describeSave(res));
    rerender?.();
  } catch (err) {
    toast('导出失败：' + (err.message || '未知原因'));
  }
}

async function doRestore(rerender) {
  // 选文件要在点「继续」的同一拍里触发，所以用 onOk 提前把窗口叫起来
  let picking = null;

  const ok = await confirmDialog({
    title: '从备份恢复？',
    message: '导入后，现在手机里的所有记录、账本、分类都会被备份文件里的内容替换掉，换不回来。\n\n建议先「导出完整备份」存一份再操作。',
    okText: '继续选择文件',
    danger: true,
    onOk: () => {
      picking = readTextFile();
    }
  });
  if (!ok || !picking) return;

  const text = await picking;
  if (text == null) return;

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return alertDialog({ title: '这个文件读不了', message: '它看起来不是备份文件，可能选错了。\n请选之前用「导出完整备份」生成的那个 .json 文件。' });
  }

  try {
    const count = await importPayload(payload);
    // 恢复完手里的数据和这份备份一致，等同于刚备份过
    await setMeta('lastBackupAt', Date.now());
    await alertDialog({ title: '恢复完成', message: `成功导入 ${count} 笔记录。` });
    rerender();
  } catch (err) {
    await alertDialog({ title: '恢复失败', message: err.message });
  }
}

async function doWipe(rerender) {
  const first = await confirmDialog({
    title: '清空所有数据？',
    message: `现在一共有 ${state.transactions.length} 笔记录、${state.ledgers.length} 个账本。\n清空之后全部消失，没法恢复。`,
    okText: '我确定',
    danger: true
  });
  if (!first) return;

  const second = await confirmDialog({
    title: '最后确认一次',
    message: '真的要清空吗？建议先在电脑上导出一份备份放着。',
    okText: '清空',
    danger: true
  });
  if (!second) return;

  await db.clearAll();
  await initStore(); // 库是空的，会自动补上默认账本和默认分类
  toast('已清空');
  rerender();
}
