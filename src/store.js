import { db, newId } from './db.js';
import { currentMonth, periodRange, periodAxisLabel, shiftPeriod, today } from './utils.js';

/** 默认分类：支出 9 个，收入 5 个。
 *  图标一律挑 Unicode 9.0（2016）以前就有的，
 *  免得在旧安卓的 emoji 字体上显示成豆腐块。
 *  唯一的例外是「红包」的 🧧 —— 它要等 Emoji 11.0（Android 9 / 2018）才有。
 *  但「红包」这个名字除了红包本身没有更贴切的图标：原来用的 💵 是张绿色美钞，
 *  放在收入分类里颜色也不对（这一版起收统一是红色）。装这个 App 的机器都是
 *  Android 9 以上，就用了。 */
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

  await migrateCategoryIcons();

  state.loaded = true;
}

/**
 * 一次性数据迁移：把「红包」分类的旧图标换成新的。
 *
 * 只改 DEFAULT_CATEGORIES 是不够的 —— 分类数据存在 IndexedDB 里，
 * 已经在用的手机永远不会再走一遍「首次初始化」，不搬一次的话
 * 装上新版看到的还是那张绿色美钞。
 *
 * 只认「名字还叫红包、图标还是旧的那个」这一种组合：
 * 用户自己挑过图标的（哪怕是同一个 💵）就不动；改完条件不再成立，
 * 每次启动重复跑也没有副作用。
 */
async function migrateCategoryIcons() {
  const stale = state.categories.filter(
    (c) => c.kind === 'income' && c.name === '红包' && c.emoji === '💵'
  );
  for (const cat of stale) {
    cat.emoji = '🧧';
    await db.put('categories', cat);
  }
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

export async function addCategory(kind, name, emoji, budgetFen = 0) {
  const sameKind = state.categories.filter((c) => c.kind === kind);
  const cat = {
    id: newId(),
    kind,
    name: name.trim(),
    emoji: emoji || '📦',
    order: sameKind.reduce((max, c) => Math.max(max, c.order ?? 0), -1) + 1
  };
  if (kind === 'expense' && budgetFen > 0) cat.budgetFen = budgetFen;
  state.categories.push(cat);
  await db.put('categories', cat);
  return cat;
}

/**
 * 把某个分类在同类型里上移 / 下移一格。
 * 原来 order 只在新建时写一次，界面上没有任何地方能改到它，
 * 常用的分类永远调不到顺手的位置。
 */
export async function moveCategory(id, delta) {
  const cat = categoryById(id);
  if (!cat) return false;
  const list = categoriesOf(cat.kind);
  const from = list.findIndex((c) => c.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= list.length) return false;

  // 整体重排后回写，避免出现重复的 order
  list.splice(to, 0, list.splice(from, 1)[0]);
  await Promise.all(
    list.map((c, idx) => {
      c.order = idx;
      return db.put('categories', c);
    })
  );
  return true;
}

export async function updateCategory(id, patch) {
  const cat = categoryById(id);
  if (!cat) return;
  Object.assign(cat, patch);
  // 月预算只对支出有意义，而且 0 就是「不设」。
  // 归一成「属性不存在」而不是留个 0：免得界面上再也看不到、
  // 也改不掉，却跟着备份一路带下去。
  if (cat.kind === 'income' || !(cat.budgetFen > 0)) delete cat.budgetFen;
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
  const gone = state.transactions.find((t) => t.id === id) || null;
  state.transactions = state.transactions.filter((t) => t.id !== id);
  await db.remove('transactions', id);
  return gone;
}

/** 撤销删除：把原来那条原样塞回去 */
export async function restoreTransaction(record) {
  if (!record) return;
  if (state.transactions.some((t) => t.id === record.id)) return;
  state.transactions.push(record);
  await db.put('transactions', record);
}

/* ---------------- 查询与统计 ---------------- */

/**
 * 某账本在某个周期里的记录，按日期倒序、同日按录入时间倒序。
 *
 * unit / key 是周期（'week' | 'month' | 'year' 配对应的键，见 utils.js）。
 * 原来参数写死是「月份」，账单页只能按月看；泛化成周期后，
 * 按周、按年走的是同一条查询路径，不用各写一份。
 *
 * scope='all' 时不再限制时间 —— 搜关键字要能跨全部时间找，
 * 否则想翻「三个月前那笔买空调的钱」得一个月一个月翻过去。
 */
export function periodTransactions(unit, key, ledgerId = state.meta.currentLedgerId, { categoryId = '', keyword = '', scope = 'period' } = {}) {
  const kw = keyword.trim().toLowerCase();
  const { start, end } = periodRange(unit, key);
  return transactionsOfLedger(ledgerId)
    .filter((t) => scope === 'all' || (t.date >= start && t.date <= end))
    .filter((t) => !categoryId || t.categoryId === categoryId)
    .filter((t) => {
      if (!kw) return true;
      const cat = categoryById(t.categoryId);
      return (t.note || '').toLowerCase().includes(kw) || (cat?.name || '').toLowerCase().includes(kw);
    })
    .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : b.date.localeCompare(a.date)));
}

/** 某个周期的收支合计 */
export function periodSummary(unit, key, ledgerId = state.meta.currentLedgerId) {
  const { start, end } = periodRange(unit, key);
  const list = transactionsOfLedger(ledgerId).filter((t) => t.date >= start && t.date <= end);
  const incomeFen = list.filter((t) => t.kind === 'income').reduce((a, t) => a + t.amountFen, 0);
  const expenseFen = list.filter((t) => t.kind === 'expense').reduce((a, t) => a + t.amountFen, 0);
  return { incomeFen, expenseFen, balanceFen: incomeFen - expenseFen, count: list.length };
}

/** 「本月」是个常用说法（预算、设置页都按自然月），留个直达的口子 */
export function monthSummary(month, ledgerId = state.meta.currentLedgerId) {
  return periodSummary('month', month, ledgerId);
}

/** 某周期某类型，按分类汇总成 Map<categoryId, { amountFen, count }> */
export function categoryTotals(unit, key, kind, ledgerId = state.meta.currentLedgerId) {
  const { start, end } = periodRange(unit, key);
  const map = new Map();
  for (const t of transactionsOfLedger(ledgerId)) {
    if (t.kind !== kind || t.date < start || t.date > end) continue;
    const entry = map.get(t.categoryId) || { amountFen: 0, count: 0 };
    entry.amountFen += t.amountFen;
    entry.count += 1;
    map.set(t.categoryId, entry);
  }
  return map;
}

/** 按分类汇总，金额从大到小 */
export function categoryBreakdown(unit, key, kind, ledgerId = state.meta.currentLedgerId) {
  const map = categoryTotals(unit, key, kind, ledgerId);
  const total = [...map.values()].reduce((a, e) => a + e.amountFen, 0);

  return {
    total,
    items: [...map.entries()]
      .map(([categoryId, e]) => {
        const cat = categoryById(categoryId);
        return {
          categoryId,
          amountFen: e.amountFen,
          count: e.count,
          name: cat?.name ?? '未分类',
          emoji: cat?.emoji ?? '❓',
          pct: total ? e.amountFen / total : 0
        };
      })
      .sort((a, b) => b.amountFen - a.amountFen)
  };
}

/* ---------------- 分类预算 ---------------- */

/** 花到 80% 就该给个眼色，和「本月预算」那张卡一个口径 */
const BUDGET_WARN_RATIO = 0.8;

/**
 * 一次算好所有「设了预算的支出分类」在本月的状态，给记账页的分类格用。
 * 逐个分类各查一次要扫 N 遍全部记录，所以先按分类汇总一轮再查表。
 * 返回 Map<categoryId, { budgetFen, spentFen, leftFen, ratio, level }>，
 * level 取 'ok' | 'warn' | 'over'。没设预算的分类不在表里。
 */
export function categoryBudgetMap(month = currentMonth(), ledgerId = state.meta.currentLedgerId) {
  // 分类预算是按月设的，不管账单页当前在看周还是年，这里都按自然月算
  const spent = categoryTotals('month', month, 'expense', ledgerId);
  const out = new Map();

  for (const cat of state.categories) {
    if (cat.kind !== 'expense') continue;
    const budgetFen = cat.budgetFen || 0;
    if (budgetFen <= 0) continue;
    const spentFen = spent.get(cat.id)?.amountFen ?? 0;
    const ratio = spentFen / budgetFen;
    out.set(cat.id, {
      budgetFen,
      spentFen,
      leftFen: budgetFen - spentFen,
      ratio,
      level: ratio >= 1 ? 'over' : ratio >= BUDGET_WARN_RATIO ? 'warn' : 'ok'
    });
  }
  return out;
}

/**
 * 以 key 这个周期结尾、往前数 n 个周期的收支，从早到晚，给趋势图用。
 * 每个点自带一个已经排好的短标签，图表那边不必再关心当前是周是月还是年。
 */
export function periodTrend(unit, key, n, ledgerId = state.meta.currentLedgerId) {
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const k = shiftPeriod(unit, key, -i);
    out.push({ key: k, label: periodAxisLabel(unit, k), ...periodSummary(unit, k, ledgerId) });
  }
  return out;
}

/** 有记录的最早一天，用于限制往前翻的边界 */
export function earliestDate(ledgerId = state.meta.currentLedgerId) {
  const list = transactionsOfLedger(ledgerId);
  if (!list.length) return today();
  return list.reduce((min, t) => (t.date < min ? t.date : min), list[0].date);
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
