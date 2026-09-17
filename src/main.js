import { initStore, state, currentLedger, switchLedger, setMeta, onLedgerChange } from './store.js';
import { navigate, onNavigate, currentTab } from './nav.js';
import { renderRecord } from './views/record.js';
import { renderList, resetListView } from './views/list.js';
import { renderStats } from './views/stats.js';
import { renderSettings } from './views/settings.js';
import { openSheet, toast } from './ui.js';
import { escapeHtml } from './utils.js';

const TITLES = { record: '记账', list: '账单', stats: '统计', settings: '设置' };

const viewEl = document.getElementById('view');
const titleEl = document.getElementById('pageTitle');
const ledgerNameEl = document.getElementById('ledgerName');

const RENDERERS = {
  record: renderRecord,
  list: renderList,
  stats: renderStats,
  settings: renderSettings
};

function syncLedgerName() {
  ledgerNameEl.textContent = currentLedger()?.name ?? '';
}

function renderApp() {
  const tab = currentTab();
  titleEl.textContent = TITLES[tab];
  syncLedgerName();
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  viewEl.scrollTop = 0;
  window.scrollTo(0, 0);
  RENDERERS[tab](viewEl);
}

// 在「设置」里新建/切换/改名/删除账本时，顶栏也要立刻跟着变
onLedgerChange(syncLedgerName);

/* ---------------- 主题 ---------------- */

function applyTheme() {
  const saved = state.meta.theme;
  const dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.getElementById('themeIcon').textContent = dark ? '☀️' : '🌙';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1d2027' : '#3b7dd8');
}

document.getElementById('themeToggle').addEventListener('click', async () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  await setMeta('theme', next);
  applyTheme();
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!state.meta.theme) applyTheme();
});

/* ---------------- 顶部账本切换 ---------------- */

document.getElementById('ledgerSwitch').addEventListener('click', () => {
  const options = state.ledgers.map((l) => ({
    value: l.id,
    label: l.name,
    emoji: l.id === state.meta.currentLedgerId ? '✅' : '📒',
    sub: `${state.transactions.filter((t) => t.ledgerId === l.id).length} 笔`
  }));

  const handle = openSheet({
    title: '切换账本',
    body: `<div class="set-list">${options
      .map(
        (o) => `<button type="button" class="set-row" data-id="${o.value}">
          <span class="sr-ico">${o.emoji}</span>
          <span class="sr-main">${escapeHtml(o.label)}<span class="sr-sub">${o.sub}</span></span>
        </button>`
      )
      .join('')}</div>
    <p class="muted" style="margin-top:12px">要新建或删除账本，去「设置 → 账本」。</p>`
  });

  handle.body.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-id]');
    if (!row) return;
    await switchLedger(row.dataset.id);
    handle.close();
    toast('已切换账本');
    resetListView(); // 换个账本，上次的筛选不该带过来
    renderApp();
  });
});

/* ---------------- 底部导航 ---------------- */

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    // 从底栏进「账单」＝看当月全貌，把上次的筛选清掉
    if (tab === 'list') resetListView();
    if (tab === currentTab()) renderApp();
    else navigate(tab);
  });
});

onNavigate(renderApp);

/* ---------------- 启动 ---------------- */

async function boot() {
  try {
    await initStore();
  } catch (err) {
    viewEl.innerHTML = `<div class="empty"><span class="empty-ico">😵</span>
      数据打不开了：${escapeHtml(err.message)}<br /><br />
      可以试试刷新页面。如果还是不行，可能是手机浏览器禁用了本地存储。</div>`;
    return;
  }

  applyTheme();
  resetListView();
  renderApp();

  // 记完账回到账单页时，月份要跟着回到最新
  window.addEventListener('focus', () => {
    if (currentTab() === 'list') renderApp();
  });
}

boot();
