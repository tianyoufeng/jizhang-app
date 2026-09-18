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

/* 每个 tab 的滚动位置。原来切一次 tab 就 scrollTo(0,0)，
   账单翻到下半截、去统计看一眼再回来，位置就没了 */
const scrollMemory = {};
let activeTab = null;

function syncLedgerName() {
  ledgerNameEl.textContent = currentLedger()?.name ?? '';
}

function renderApp() {
  const tab = currentTab();
  if (activeTab && activeTab !== tab) {
    scrollMemory[activeTab] = window.scrollY;
  }
  // 同一个 tab 重渲染（比如保存后刷新）就停在原地，切 tab 才回到各自己的位置
  const restore = activeTab === tab ? window.scrollY : (scrollMemory[tab] || 0);
  activeTab = tab;

  titleEl.textContent = TITLES[tab];
  syncLedgerName();
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  RENDERERS[tab](viewEl);
  window.scrollTo(0, restore);
}

// 在「设置」里新建/切换/改名/删除账本时，顶栏也要立刻跟着变
onLedgerChange(syncLedgerName);

/* ---------------- iOS：让 :active 生效 ---------------- */

// iOS Safari / WKWebView 只有在页面里存在 touchstart 监听时才会触发 :active，
// 否则所有按下的反馈都是死的。挂一个空的就够了。
document.addEventListener('touchstart', () => {}, { passive: true });

/* ---------------- 主题 ---------------- */

function applyTheme() {
  const saved = state.meta.theme;
  const dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  // 图标由 CSS 跟着 data-theme 切换（见 styles.css 里的 #themeToggle 规则），
  // 不需要 JS 改内容，也就少了一处各厂 ROM 渲染不一的 emoji
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
    if (tab === currentTab()) {
      scrollMemory[tab] = 0; // 再点一次当前这个 tab ＝ 回到顶部
      renderApp();
    } else {
      navigate(tab);
    }
  });
});

onNavigate(renderApp);

/* ---------------- PWA 离线缓存 ---------------- */

// 只在浏览器里注册：原生 App 的资源就在本地，套一层 Service Worker
// 反而可能把旧版本缓存住，装新包后界面不更新。
const isNativeApp = Boolean(window.Capacitor?.isNativePlatform?.());

if ('serviceWorker' in navigator) {
  if (isNativeApp) {
    navigator.serviceWorker.getRegistrations?.()
      .then((list) => list.forEach((r) => r.unregister()))
      .catch(() => {});
  } else if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
}

/* ---------------- 启动 ---------------- */

async function boot() {
  try {
    await initStore();
  } catch (err) {
    viewEl.innerHTML = `<div class="empty"><span class="empty-ico">😵</span>
      数据打不开了：${escapeHtml(err.message)}<br /><br />
      可以试试刷新页面。如果还是不行，可能是浏览器禁用了本地存储。</div>`;
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
