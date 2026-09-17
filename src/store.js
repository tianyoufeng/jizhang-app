import { db, newId } from './db.js';
import { monthOf, currentMonth } from './utils.js';

/** 默认分类：支出 9 个，收入 5 个 */
const DEFAULT_CATEGORIES = [
  { kind: 'expense', name: '餐饮', emoji: '🍚' },
  { kind: 'expense', name: '交通', emoji: '🚌' },
  { kind: 'expense', name: '购物', emoji: '🛒' },
  { kind: 'expense', name: '房租水电', emoji: '🏠' },
  { kind: 'expense', name: '娱乐', emoji: '🎮' },
  { kind: 'expense', name: '医疗', emoji: '💊' },
  { kind: 'expense', name: '学习', emoji: '📚' },
  { kind: 'expense', name: '人情', emoji: '🎁' },
  { kind: 'expense', name: '其他', emoji: '📦' },
  { kind: 'income', name: '工资', emoji: '💰' },
  { kind: 'income', name: '红包', emoji: '🧧' },
  { kind: 'income', name: '理财', emoji: '📈' },
  { kind: 'income', name: '兼职', emoji: '💼' },
  { kind: 'income', name: '其他', emoji: '📦' }
];

const DEFAULT_LEDGER_NAME = '日常账本';

/** 内存状态。数据量小（个人记账通常几千条），全部载入内存，读写都走这里 */
export const state = {
  ledgers: [],
  categories: [],
  transactions: [],
  meta: {},
  loaded: false
};

/* ---------------- 初始化 ---------------- */

export async function initStore() {
  const [ledgers, categories, transactions, metaList] = await Promise.all([
    db.getAll('ledgers'),
    db.getAll('categories'),
    db.getAll('transactions'),
    db.getAll('meta')
  ]);

  state.ledgers = ledgers.sort(byOrder);
  state.categories = categories.sort(byOrder);
  state.transactions = transactions;
  state.meta = Object.fromEntries(metaList.map((m) => [m.key, m.value]));

  if (!state.ledgers.length) {
    const ledger = {
      id: newId(),
      name: DEFAULT_LEDGER_NAME,
      budgetFen: 0,
      order: 0,
      createdAt: Date.now()
    };
    state.ledgers = [ledger];
    await db.put('ledgers', ledger);
    state.meta.currentLedgerId = ledger.id;
    await db.put('meta', { key: 'currentLedgerId', value: ledger.id });
  }

  if (!state.categories.length) {
    state.categories = DEFAULT_CATEGORIES.map((c, i) => ({
      id: newId(),
      kind: c.kind,
      name: c.name,
      emoji: c.emoji,
      order: i
    }));
    await db.putMany('categories', state.categories);
  }

  if (!state.meta.currentLedgerId || !state.ledgers.some((l) => l.id === state.meta.currentLedgerId)) {
    state.meta.currentLedgerId = state.ledgers[0].id;
    await db.put('meta', { key: 'currentLedgerId', value: state.meta.currentLedgerId });
  }

  state.loaded = true;
}

function byOrder(a, b) {
  return (a.order ?? 0) - (b.order ?? 0);
}

/* ---------------- 设置项 ---------------- */

export async function setMeta(key, value) {
  state.meta[key] = value;
  await db.put('meta', { key, value });
}

/* ---------------- 账本 ---------------- */

export function currentLedger() {
  return state.ledgers.find((l) => l.id === state.meta.currentLedgerId) || state.ledgers[0];
}

/* 账本名 / 当前账本变了，顶栏要跟着变。谁关心谁注册。 */
const ledgerListeners = new Set();

export function onLedgerChange(fn) {
  ledgerListeners.add(fn);
  return () => ledgerListeners.delete(fn);
}

function notifyLedgerChange() {
  const ledger = currentLedger();
  ledgerListeners.forEach((fn) => fn(ledger));
}

export async function switchLedger(id) {
  if (!state.ledgers.some((l) => l.id === id)) return;
  await setMeta('currentLedgerId', id);
  notifyLedgerChange();
}

export async function addLedger(name, budgetFen = 0) {
  const ledger = {
    id: newId(),
    name: name.trim(),
    budgetFen,
    order: state.ledgers.length,
    createdAt: Date.now()
  };
  state.ledgers.push(ledger);
  await db.put('ledgers', ledger);
  return ledger;
}

export async function updateLedger(id, patch) {
  const ledger = state.ledgers.find((l) => l.id === id);
  if (!ledger) return;
  Object.assign(ledger, patch);
  await db.put('ledgers', ledger);
  notifyLedgerChange();
}

/** 删除账本，连带删掉它名下的所有记录 */
export async function deleteLedger(id) {
  if (state.ledgers.length <= 1) throw new Error('至少要保留一个账本');
  const doomed = state.transactions.filter((t) => t.ledgerId === id);
  state.transactions = state.transactions.filter((t) => t.ledgerId !== id);
  state.ledgers = state.ledgers.filter((l) => l.id !== id);
  await db.removeMany('transactions', doomed.map((t) => t.id));
  await db.remove('ledgers', id);
  if (state.meta.currentLedgerId === id) {
    await setMeta('currentLedgerId', state.ledgers[0].id);
  }
  notifyLedgerChange();
}

/* ---------------- 分类 ---------------- */

export function categoriesOf(kind) {
  return state.categories.filter((c) => c.kind === kind).sort(byOrder);
}

export function categoryById(id) {
  return state.categories.find((c) => c.id === id);
}

export async function addCategory(kind, name, emoji) {
  const sameKind = state.categories.filter((c) => c.kind === kind);
  const cat = {
    id: newId(),
    kind,
    name: name.trim(),
    emoji: emoji || '📦',
    order: sameKind.length
  };
  state.categories.push(cat);
  await db.put('categories', cat);
  return cat;
}

export async function updateCategory(id, patch) {
  const cat = categoryById(id);
  if (!cat) return;
  Object.assign(cat, patch);
  await db.put('categories', cat);
}

/** 用了多少条记录引用这个分类 */
export function categoryUsage(id) {
  return state.transactions.filter((t) => t.categoryId === id).length;
}

export async function deleteCategory(id) {
  state.categories = state.categories.filter((c) => c.id !== id);
  await db.remove('categories', id);
}

/* ---------------- 记录 ---------------- */

export function transactionsOfLedger(ledgerId = state.meta.currentLedgerId) {
  return state.transactions.filter((t) => t.ledgerId === ledgerId);
}

export async function addTransaction(tx) {
  const now = Date.now();
  const record = {
    id: newId(),
    ledgerId: tx.ledgerId,
    kind: tx.kind,
    amountFen: tx.amountFen,
    categoryId: tx.categoryId,
    date: tx.date,
    note: tx.note || '',
    createdAt: now,
    updatedAt: now
  };
  state.transactions.push(record);
  await db.put('transactions', record);
  return record;
}

export async function updateTransaction(id, patch) {
  const record = state.transactions.find((t) => t.id === id);
  if (!record) return;
  Object.assign(record, patch, { updatedAt: Date.now() });
  await db.put('transactions', record);
}

export async function deleteTransaction(id) {
  state.transactions = state.transactions.filter((t) => t.id !== id);
  await db.remove('transactions', id);
}

/* ---------------- 查询与统计 ---------------- */

/** 某账本某月的记录，按日期倒序、同日按录入时间倒序 */
export function monthTransactions(month, ledgerId = state.meta.currentLedgerId, { categoryId = '', keyword = '' } = {}) {
  const kw = keyword.trim().toLowerCase();
  return transactionsOfLedger(ledgerId)
    .filter((t) => monthOf(t.date) === month)
    .filter((t) => !categoryId || t.categoryId === categoryId)
    .filter((t) => {
      if (!kw) return true;
      const cat = categoryById(t.categoryId);
      return (t.note || '').toLowerCase().includes(kw) || (cat?.name || '').toLowerCase().includes(kw);
    })
    .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : b.date.localeCompare(a.date)));
}

export function monthSummary(month, ledgerId = state.meta.currentLedgerId) {
  const list = transactionsOfLedger(ledgerId).filter((t) => monthOf(t.date) === month);
  const incomeFen = list.filter((t) => t.kind === 'income').reduce((a, t) => a + t.amountFen, 0);
  const expenseFen = list.filter((t) => t.kind === 'expense').reduce((a, t) => a + t.amountFen, 0);
  return { incomeFen, expenseFen, balanceFen: incomeFen - expenseFen, count: list.length };
}

/** 按分类汇总，金额从大到小 */
export function categoryBreakdown(month, kind, ledgerId = state.meta.currentLedgerId) {
  const list = transactionsOfLedger(ledgerId)
    .filter((t) => t.kind === kind && monthOf(t.date) === month);

  const map = new Map();
  for (const t of list) {
    const key = t.categoryId;
    const entry = map.get(key) || { categoryId: key, amountFen: 0, count: 0 };
    entry.amountFen += t.amountFen;
    entry.count += 1;
    map.set(key, entry);
  }

  const total = [...map.values()].reduce((a, e) => a + e.amountFen, 0);
  return {
    total,
    items: [...map.values()]
      .map((e) => {
        const cat = categoryById(e.categoryId);
        return {
          ...e,
          name: cat?.name ?? '未分类',
          emoji: cat?.emoji ?? '❓',
          pct: total ? e.amountFen / total : 0
        };
      })
      .sort((a, b) => b.amountFen - a.amountFen)
  };
}

/** 最近 n 个月的收支，从早到晚，用于趋势图 */
export function monthlyTrend(months, ledgerId = state.meta.currentLedgerId) {
  return months.map((m) => ({ month: m, ...monthSummary(m, ledgerId) }));
}

/** 有记录的最早月份，用于限制往前翻的边界 */
export function earliestMonth(ledgerId = state.meta.currentLedgerId) {
  const list = transactionsOfLedger(ledgerId);
  if (!list.length) return currentMonth();
  return list.reduce((min, t) => (monthOf(t.date) < min ? monthOf(t.date) : min), monthOf(list[0].date));
}

/* ---------------- 导入导出 ---------------- */

export function exportPayload() {
  return {
    app: 'jizhang',
    version: 1,
    exportedAt: new Date().toISOString(),
    ledgers: state.ledgers,
    categories: state.categories,
    transactions: state.transactions,
    meta: { currentLedgerId: state.meta.currentLedgerId }
  };
}

export function toCsv(ledgerId = state.meta.currentLedgerId) {
  const ledger = state.ledgers.find((l) => l.id === ledgerId);
  const rows = [['日期', '类型', '分类', '金额(元)', '备注', '账本']];

  transactionsOfLedger(ledgerId)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
    .forEach((t) => {
      rows.push([
        t.date,
        t.kind === 'expense' ? '支出' : '收入',
        categoryById(t.categoryId)?.name ?? '未分类',
        (t.amountFen / 100).toFixed(2),
        t.note || '',
        ledger?.name ?? ''
      ]);
    });

  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 覆盖式导入。返回导入了多少条记录 */
export async function importPayload(payload) {
  if (!payload || payload.app !== 'jizhang') {
    throw new Error('这不是本 App 导出的备份文件');
  }
  if (!Array.isArray(payload.ledgers) || !Array.isArray(payload.transactions)) {
    throw new Error('备份文件内容不完整，可能传坏了');
  }

  // 先把整个文件校验完，再动数据库。
  // 否则中途出错时旧数据已经被清掉了，等于既没恢复成又丢了原有的。
  const ledgers = payload.ledgers;
  if (!ledgers.length) throw new Error('备份文件里没有账本');
  if (!ledgers.every(validLedger)) throw new Error('备份文件里的账本信息不完整');
  if (!payload.transactions.every(validTransaction)) throw new Error('备份文件里有读不懂的记录');

  const categories = Array.isArray(payload.categories) ? payload.categories.filter(validCategory) : [];
  const finalCategories = categories.length ? categories : seedCategories();

  const wantedId = payload.meta?.currentLedgerId;
  const currentId = ledgers.some((l) => l.id === wantedId) ? wantedId : ledgers[0].id;

  // 主题这类本机偏好不在备份里，导入后保持现状，别把用户的深色模式重置了
  const localPrefs = { ...state.meta };
  delete localPrefs.currentLedgerId;

  await db.clearAll();
  await db.putMany('ledgers', ledgers);
  await db.putMany('categories', finalCategories);
  await db.putMany('transactions', payload.transactions);
  await db.put('meta', { key: 'currentLedgerId', value: currentId });
  await db.putMany('meta', Object.entries(localPrefs).map(([key, value]) => ({ key, value })));

  await initStoreForce();
  notifyLedgerChange();
  return payload.transactions.length;
}

function seedCategories() {
  return DEFAULT_CATEGORIES.map((c, i) => ({ id: newId(), kind: c.kind, name: c.name, emoji: c.emoji, order: i }));
}

function validLedger(l) {
  return l && typeof l.id === 'string' && typeof l.name === 'string';
}
function validCategory(c) {
  return c && typeof c.id === 'string' && typeof c.name === 'string' && (c.kind === 'expense' || c.kind === 'income');
}
function validTransaction(t) {
  return t && typeof t.id === 'string' && typeof t.date === 'string' && Number.isFinite(t.amountFen);
}

async function initStoreForce() {
  state.loaded = false;
  await initStore();
}
