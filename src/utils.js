/** 通用工具：金额、日期、字符串 */

/**
 * 版本号。发新版时这五处要一起改，别只改一处：
 * 这里、package.json、android/app/build.gradle、ios 的 project.pbxproj、public/sw.js 的 CACHE。
 */
export const APP_VERSION = '1.3';

/** 金额一律以「分」为单位存整数，避免小数计算误差 */

export function fenToYuan(fen) {
  const neg = fen < 0;
  const abs = Math.abs(fen);
  const yuan = Math.floor(abs / 100);
  const cent = abs % 100;
  return (neg ? '-' : '') + yuan + (cent ? '.' + String(cent).padStart(2, '0') : '');
}

/** 带千分位的显示，用于列表和统计 */
export function money(fen) {
  const neg = fen < 0;
  const abs = Math.abs(fen);
  const yuan = Math.floor(abs / 100);
  const cent = abs % 100;
  const int = yuan.toLocaleString('en-US');
  const txt = cent ? `${int}.${String(cent).padStart(2, '0')}` : `${int}.00`;
  return (neg ? '-' : '') + txt;
}

/** 输入框里的字符串 → 分。返回 null 表示不合法 */
export function yuanToFen(input) {
  const s = String(input).trim();
  if (!s) return null;
  if (!/^\d*(\.\d{0,2})?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** 日期：YYYY-MM-DD */
export function today() {
  return toDateStr(new Date());
}

export function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 今天往前 n 天的日期字符串。dayAgo(0) 就是今天 */
export function dayAgo(n = 0) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toDateStr(d);
}

/** 两个日期字符串相差多少天（b - a） */
export function daysBetween(a, b) {
  const toMs = (s) => {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  };
  return Math.round((toMs(b) - toMs(a)) / 86400000);
}

/** 'YYYY-MM-DD' → 'YYYY-MM' */
export function monthOf(dateStr) {
  return String(dateStr).slice(0, 7);
}

export function currentMonth() {
  return today().slice(0, 7);
}

/** 'YYYY-MM' 加减月份 */
export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' → '9月17日 周三' */
export function dateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
  return `${m}月${d}日 ${week}`;
}

export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  const nowYear = new Date().getFullYear();
  return y === nowYear ? `${m}月` : `${y}年${m}月`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/** 饼图配色，冷暖交替，深浅模式下都够区分 */
export const CHART_COLORS = [
  '#3b7dd8', '#e0575b', '#26a06a', '#e0a32e', '#8b5cf6',
  '#12a5b8', '#e0669a', '#7a8b3f', '#c2743a', '#5a6b8c'
];

export function colorAt(i) {
  return CHART_COLORS[i % CHART_COLORS.length];
}

export function sum(list, pick) {
  return list.reduce((acc, x) => acc + pick(x), 0);
}

/** 一批记录的收支合计 */
export function totals(list) {
  const incomeFen = sum(list.filter((t) => t.kind === 'income'), (t) => t.amountFen);
  const expenseFen = sum(list.filter((t) => t.kind === 'expense'), (t) => t.amountFen);
  return { incomeFen, expenseFen, balanceFen: incomeFen - expenseFen };
}
