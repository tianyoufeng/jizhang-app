import {
  rangeSummary, rangeCategoryBreakdown, rangeTrend, periodTrend, currentLedger
} from '../store.js';
import {
  money, currentPeriod, periodKey, periodRange, shiftPeriod, convertPeriod, periodLabel,
  rangeLabel, rangeDays, prevRange, escapeHtml,
  PERIOD_UNITS, PERIOD_BTN_TEXT, PERIOD_PREV_TEXT, PERIOD_WORD, PERIOD_UNIT_TEXT, PERIOD_THIS_TEXT
} from '../utils.js';
import { pieChart, trendChart } from '../charts.js';
import { pickRange } from '../rangePicker.js';
import { setListFilter } from './list.js';
import { navigate } from '../nav.js';

/** 趋势图看几个周期。6 个刚好：横轴不挤，又能看出走向 */
const TREND_COUNT = 6;
/** 自定义区间最多切几根柱子。再多横轴标签就叠在一起了（8 根时每根 34px，刚好放得下「9/14」） */
const CUSTOM_BUCKETS = 8;

const view = {
  unit: 'month',
  key: currentPeriod('month'),
  kind: 'expense',
  scope: 'period',
  range: null
};

export function renderStats(root) {
  const unit = view.unit;
  const custom = view.scope === 'custom' && Boolean(view.range);
  if (!custom && view.key > currentPeriod(unit)) view.key = currentPeriod(unit);

  const ledger = currentLedger();
  // 周期和自定义在这里收成同一个区间，底下的取数就一条路
  const range = custom ? view.range : periodRange(unit, view.key);
  const prevR = custom
    ? prevRange(range)
    : periodRange(unit, shiftPeriod(unit, view.key, -1));

  const summary = rangeSummary(range, ledger.id);
  const prev = rangeSummary(prevR, ledger.id);
  const breakdown = rangeCategoryBreakdown(range, view.kind, ledger.id);
  const trend = custom
    ? rangeTrend(range, ledger.id, CUSTOM_BUCKETS)
    : periodTrend(unit, view.key, TREND_COUNT, ledger.id);

  const label = custom ? rangeLabel(range) : periodLabel(unit, view.key);
  const prevWord = custom ? '上一段' : PERIOD_PREV_TEXT[unit];
  // 自定义区间没有「上月」这个概念，环比就跟「紧挨着的、同样长的那一段」比
  const atLatest = !custom && view.key >= currentPeriod(unit);
  // 分桶粒度从 trend 身上读，保证标题和柱子是同一套（别在两处各算一遍）
  const bucketUnit = custom ? trend[0]?.unit ?? 'day' : unit;
  const trendTitle = custom
    ? `区间趋势 · 按${PERIOD_UNIT_TEXT[bucketUnit]}`
    : `最近 ${TREND_COUNT} ${PERIOD_WORD[unit]}趋势`;

  root.innerHTML = `
    <div class="scope" data-role="scope">
      ${PERIOD_UNITS.map(
        (u) => `<button type="button" data-scope="${u}" class="${view.scope === 'period' && unit === u ? 'active' : ''}">${PERIOD_BTN_TEXT[u]}</button>`
      ).join('')}
      <button type="button" data-scope="custom" class="${custom ? 'active' : ''}">自定义</button>
    </div>

    ${custom
      ? `<button type="button" class="month-nav range-bar" data-role="editrange">
          <span class="m-label">${escapeHtml(label)}<span class="rb-sub">共 ${rangeDays(range)} 天 · 点这里改时间</span></span>
          <span class="rb-edit">修改</span>
        </button>`
      : `<div class="month-nav">
          <button type="button" class="m-arrow" data-role="prev">‹</button>
          <span class="m-label">${escapeHtml(label)}</span>
          <button type="button" class="m-arrow" data-role="next" ${atLatest ? 'disabled' : ''}>›</button>
        </div>`}

    <div class="card">
      <p class="card-title">${escapeHtml(label)}总结</p>
      <div class="summary summary-plain">
        <div><div class="s-val income">${escapeHtml(money(summary.incomeFen))}</div><div class="s-key income">收入</div></div>
        <div><div class="s-val expense">${escapeHtml(money(summary.expenseFen))}</div><div class="s-key expense">支出</div></div>
        <div><div class="s-val balance">${escapeHtml(money(summary.balanceFen))}</div><div class="s-key">结余</div></div>
      </div>
      ${deltaLine(summary, prev, prevWord)}
      ${summary.count ? '' : `<div class="muted" style="margin-top:10px">${escapeHtml(custom ? '这段时间' : PERIOD_THIS_TEXT[unit])}还没有记录</div>`}
    </div>

    <div class="card">
      <div class="seg" data-role="kindseg" style="margin-bottom:12px">
        <button type="button" data-kind="expense">支出构成</button>
        <button type="button" data-kind="income">收入构成</button>
      </div>
      <div data-role="pie"></div>
    </div>

    <div class="card">
      <p class="card-title">${escapeHtml(trendTitle)}</p>
      <div data-role="trend"></div>
    </div>
  `;

  root.querySelector('[data-role="pie"]').innerHTML = pieChart(breakdown.items, {
    emptyText: `这段时间还没有${view.kind === 'income' ? '收入' : '支出'}记录`
  });
  root.querySelector('[data-role="trend"]').innerHTML = trendChart(trend, {
    ariaLabel: custom
      ? '这段时间的收支趋势柱状图'
      : `最近 ${TREND_COUNT} ${PERIOD_WORD[unit]}的收支趋势柱状图`,
    emptyText: '这段时间还没有记录'
  });

  root.querySelector('[data-role="scope"]').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-scope]');
    if (!btn) return;
    const next = btn.dataset.scope;

    if (next === 'custom') {
      openRangePicker(root);
      return;
    }
    if (view.scope === 'period' && next === view.unit) {
      // 再点一次当前粒度＝回到当下（和底栏「再点一次当前 tab 回到顶部」一致）
      if (view.key === currentPeriod(unit)) return;
      view.key = currentPeriod(unit);
      renderStats(root);
      return;
    }
    // 从自定义回周期：落在刚才那段的结尾所在的周期，别把人甩回今天
    view.key = view.scope === 'custom' && view.range
      ? periodKey(next, view.range.end)
      : convertPeriod(view.unit, view.key, next);
    view.unit = next;
    view.scope = 'period';
    renderStats(root);
  });

  const editRangeBtn = root.querySelector('[data-role="editrange"]');
  if (editRangeBtn) editRangeBtn.addEventListener('click', () => openRangePicker(root));

  root.querySelectorAll('[data-role="kindseg"] button').forEach((b) => {
    b.classList.toggle('active', b.dataset.kind === view.kind);
    b.addEventListener('click', () => {
      view.kind = b.dataset.kind;
      renderStats(root);
    });
  });

  const prevBtn = root.querySelector('[data-role="prev"]');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      view.key = shiftPeriod(unit, view.key, -1);
      renderStats(root);
    });
    root.querySelector('[data-role="next"]').addEventListener('click', () => {
      view.key = shiftPeriod(unit, view.key, 1);
      renderStats(root);
    });
  }

  // 点饼图的图例，跳到账单页看这个分类的明细
  // （只圈饼图的图例，下面趋势图那行图例不算）
  root.querySelectorAll('[data-role="pie"] .legend-row').forEach((row, i) => {
    const item = breakdown.items[i];
    if (!item) return;
    row.style.cursor = 'pointer';
    row.title = '点一下看这个分类的明细';
    row.addEventListener('click', () => {
      // 带着当前这一段跳过去，于是「自定义区间里看到的餐饮」点进去也是这一段
      if (custom) setListFilter({ range: view.range, categoryId: item.categoryId });
      else setListFilter({ unit: view.unit, key: view.key, categoryId: item.categoryId });
      navigate('list');
    });
  });
}

/** 弹「自定义时间」的面板。没选过就先用当前这个周期垫上；取消什么都不动 */
async function openRangePicker(root) {
  const picked = await pickRange({
    initial: view.range,
    fallback: periodRange(view.unit, view.key)
  });
  if (!picked) return;
  view.range = picked;
  view.scope = 'custom';
  renderStats(root);
}

/**
 * 环比：这一段比上一段多花 / 少花多少。
 * 单周期数字和柱子都有，但「多花多少」这句最想知道的话原来没有。
 * 自定义区间里「上一段」＝紧挨着它的、长度相同的那一段（见 utils.js 的 prevRange）。
 */
function deltaLine(summary, prev, prevWord) {
  if (!summary.count) return '';
  if (!prev.count) return `<div class="delta">${prevWord}没有记录，没法比</div>`;

  const diff = summary.expenseFen - prev.expenseFen;
  if (diff === 0) return `<div class="delta">支出和${prevWord}持平</div>`;

  const more = diff > 0;
  const cls = more ? 'up' : 'down';
  const amount = `支出比${prevWord}${more ? '多' : '少'}花 <b>${escapeHtml(money(Math.abs(diff)))}</b> 元`;

  // 上期只记了收入、没记支出时，除数是 0，百分比会算出 Infinity%
  if (!prev.expenseFen) return `<div class="delta ${cls}">${amount}</div>`;

  const pct = Math.round(Math.abs(diff / prev.expenseFen) * 100);
  return `<div class="delta ${cls}">${amount} <b>(${more ? '+' : '-'}${pct}%)</b></div>`;
}
