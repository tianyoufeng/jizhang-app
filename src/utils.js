/** 通用工具：金额、日期、字符串 */

/**
 * 版本号。发新版时这五处要一起改，别只改一处：
 * 这里、package.json、android/app/build.gradle、ios 的 project.pbxproj、public/sw.js 的 CACHE。
 */
export const APP_VERSION = '1.4';

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

/* ---------------- 周期：周 / 月 / 年 ----------------
 *
 * 账单页和统计页都要能按周、按月、按年看。三者的「区间」写法各不相同，
 * 所以统一收成一个「周期键」字符串，加减 / 比较 / 排序都能直接拿字符串做，
 * 不用到处传 start、end 两个日期：
 *   周 → 'YYYY-MM-DD'，取那一周的周一
 *   月 → 'YYYY-MM'
 *   年 → 'YYYY'
 * 这样按月份的旧字符串比较（'2026-09-14' >= '2026-09-01'）依然成立。
 */

/** 支持的粒度，顺序就是页面上切换按钮的顺序 */
export const PERIOD_UNITS = ['week', 'month', 'year'];

/** 切换按钮上的字 */
export const PERIOD_BTN_TEXT = { week: '按周', month: '按月', year: '按年' };

/** 「比上周 / 比上月 / 比上年」里的那个词 */
export const PERIOD_PREV_TEXT = { week: '上周', month: '上月', year: '上年' };

/** 「6 周 / 6 个月 / 6 年」里的量词 */
export const PERIOD_WORD = { week: '周', month: '个月', year: '年' };

/** 「这一周还没有记账」里的主语 */
export const PERIOD_THIS_TEXT = { week: '这一周', month: '这个月', year: '这一年' };

/** 某一天属于哪个周期 */
export function periodKey(unit, dateStr = today()) {
  if (unit === 'week') return weekStart(dateStr);
  if (unit === 'year') return dateStr.slice(0, 4);
  return monthOf(dateStr);
}

export function currentPeriod(unit) {
  return periodKey(unit, today());
}

/** 这一天所在那一周的周一。按中文习惯，一周从周一开始，周日结尾 */
function weekStart(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return toDateStr(dt);
}

/** 周期键 → 日期区间，首尾都算在内 */
export function periodRange(unit, key) {
  if (unit === 'week') {
    const [y, m, d] = key.split('-').map(Number);
    return { start: key, end: toDateStr(new Date(y, m - 1, d + 6)) };
  }
  if (unit === 'year') {
    return { start: `${key}-01-01`, end: `${key}-12-31` };
  }
  const [y, m] = key.split('-').map(Number);
  // 下个月的第 0 天＝这个月的最后一天，闰年二月也不用特判
  return { start: `${key}-01`, end: toDateStr(new Date(y, m, 0)) };
}

/** 周期键往前 / 往后挪 n 个周期 */
export function shiftPeriod(unit, key, delta) {
  if (unit === 'week') {
    const [y, m, d] = key.split('-').map(Number);
    return toDateStr(new Date(y, m - 1, d + delta * 7));
  }
  if (unit === 'year') return String(Number(key) + delta);
  return shiftMonth(key, delta);
}

/**
 * 换个粒度但保住位置。
 *
 * 关键一条：正在看的这一段里**包含今天**时，落在今天所在的新周期上。
 * 否则「在当月切成按周」会落到 9 月 1 日那一周（8/31–9/6，一条记录都没有），
 * 而不是本周 —— 踩过一次。
 * 看的是过去某一段（比如 3 月）时，才退回用它的第一天来换算。
 */
export function convertPeriod(fromUnit, key, toUnit) {
  const { start, end } = periodRange(fromUnit, key);
  const t = today();
  const anchor = t >= start && t <= end ? t : start;
  return periodKey(toUnit, anchor);
}

/** 页面标题：周='9月14日–20日'、月='9月'、年='2026年' */
export function periodLabel(unit, key) {
  if (unit === 'year') return `${key}年`;
  if (unit === 'month') return monthLabel(key);

  const { start, end } = periodRange('week', key);
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const nowYear = new Date().getFullYear();
  // 不是今年才写年份，否则标题会长得没必要
  const yTag = (y) => (y === nowYear ? '' : `${y}年`);
  // 跨月的那一周（9/29–10/5）后半段也要带月份，不然「9月29日–5日」看不懂
  const tail = sy === ey && sm === em ? `${ed}日` : `${yTag(ey)}${em}月${ed}日`;
  return `${yTag(sy)}${sm}月${sd}日–${tail}`;
}

/** 坐标轴上的短标签，长了会把柱子挤扁：周='9/14'、月='9月'、年='2026' */
export function periodAxisLabel(unit, key) {
  if (unit === 'year') return key;
  if (unit === 'month') return `${Number(key.slice(5))}月`;
  const [, m, d] = key.split('-').map(Number);
  return `${m}/${d}`;
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
