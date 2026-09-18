/**
 * 自动化走查 + 断言。用真浏览器把主要流程点一遍，存截图、收集报错、核对数字。
 * 用法：先 npm run dev，再 node tools/verify.mjs
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.env.APP_URL || 'http://localhost:5173';
const OUT = 'tools/shots';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const errors = [];
const results = [];
let shotCount = 0;

function check(name, actual, expected) {
  const ok = String(actual) === String(expected);
  results.push({ ok, name, actual, expected });
  if (!ok) console.log(`  ✗ ${name}\n      期望 ${expected}\n      实际 ${actual}`);
  return ok;
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

// 在页面脚本跑起来之前挂上钩子，把「下载」的文件内容截下来，方便核对导出结果
await page.evaluateOnNewDocument(() => {
  window.__saved = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    blob.text().then((t) => window.__saved.push(t));
    return orig(blob);
  };
});

page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const shot = async (name) => {
  await sleep(260);
  shotCount += 1;
  await page.screenshot({ path: `${OUT}/${String(shotCount).padStart(2, '0')}-${name}.png` });
};

const tap = async (selector) => {
  await page.waitForSelector(selector, { visible: true, timeout: 8000 });
  await page.click(selector);
  await sleep(180);
};

const text = (selector) => page.$eval(selector, (el) => el.innerText.replace(/\s+/g, ' ').trim());
const count = (selector) => page.$$eval(selector, (els) => els.length);
const sums = () => page.$$eval('.summary .s-val', (els) => els.map((e) => e.innerText.trim()));

async function closeOverlays() {
  for (let i = 0; i < 6; i += 1) {
    if (await page.$('.dialog-mask')) {
      const btn = (await page.$('.dialog-mask [data-act="cancel"]')) || (await page.$('.dialog-mask [data-act="ok"]'));
      if (btn) await btn.click();
      await sleep(180);
      continue;
    }
    if (await page.$('.sheet-mask')) {
      const cancel = await page.$('.sheet-actions .btn-outline');
      if (cancel) await cancel.click();
      else await page.mouse.click(195, 70);
      await sleep(220);
      continue;
    }
    break;
  }
}

async function goTab(name) {
  await closeOverlays();
  await page.evaluate((t) => document.querySelector(`#tabbar .tab[data-tab="${t}"]`).click(), name);
  await sleep(220);
}

/** 按分类名找那条记录并点开（列表顺序会变，按名字找更稳） */
async function tapTxOf(categoryName) {
  for (const h of await page.$$('.tx')) {
    if ((await h.evaluate((el) => el.innerText)).includes(categoryName)) {
      await h.click();
      await sleep(220);
      return;
    }
  }
  throw new Error(`列表里没找到「${categoryName}」的记录`);
}

const savedFiles = () => page.evaluate(() => window.__saved);

/** 分类格上那个预算圆点的 class，用来判断灰 / 黄 / 红。
 *  第 n 个分类按记账页的排列顺序数，从 1 开始 */
const dotClass = (n) => page.$eval(`.cat-grid .cat-item:nth-child(${n}) .cat-dot`, (el) => el.className);

/**
 * 在「分类管理」里给第 n 个分类设月预算。
 * 保存只关掉编辑面板，分类管理那一层还开着，所以能连着设好几个。
 */
async function setCategoryBudget(n, yuan) {
  await tap(`.sheet .cat-row:nth-child(${n}) .cat-row-main`);
  await page.waitForSelector('.sheet [data-role="budget"]', { visible: true, timeout: 8000 });
  await page.type('.sheet [data-role="budget"]', yuan);
  await page.click('.sheet-actions .btn-primary');
  await sleep(420);
}

/** 把记账页的日期改成某一天，会触发 change（圆点要跟着换月份） */
const pickDate = (date) =>
  page.$eval('[data-role="date"]', (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, date);

/**
 * 用 JS 触发点击，而不是按坐标点。
 * 记账页一旦出现「本月预算」卡片，内容就比一屏长，「今天/昨天/前天」那一行
 * 会落到固定底栏底下 —— 按坐标点会打到底栏的「账单」标签上去（踩过一次）。
 */
const clickEl = (selector) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error('找不到元素：' + s);
    el.click();
  }, selector);

/* ================= 开始 ================= */

await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForSelector('#tabbar .tab', { timeout: 8000 });
await shot('record-empty');
check('初始：默认账本名', await text('#ledgerName'), '日常账本');

await goTab('list');
check('初始：账单页空提示', await text('#view .empty'), '🗒️ 这个月还没有记账');
await goTab('settings');
check('初始：默认分类数', await text('[data-act="cats"] .sr-val'), '14 个');
await goTab('record');

/* ---- 记三笔：餐饮 38.5、交通 12、工资 8000 ---- */
await page.type('#amountInput', '38.5');
await page.click('.cat-grid .cat-item:nth-child(1)');            // 餐饮
await page.type('[data-role="note"]', '午饭, 和同事"聚餐"');      // 故意带逗号和引号，测 CSV 转义
await shot('record-filled');
await page.click('[data-role="save"]');
await sleep(400);
check('记账：保存后分类重置到第一个', await text('.cat-grid .cat-item.active'), '🍚 餐饮');

await page.type('#amountInput', '12');
await page.click('.cat-grid .cat-item:nth-child(2)');            // 交通
await page.click('[data-role="save"]');
await sleep(350);

await page.evaluate(() => document.querySelector('#view .seg button[data-kind="income"]').click());
await sleep(150);

// 「红包」原来画的是 💵（绿色美钞），和「收入」的红字不搭，也不像红包
const incomeCats = await page.$$eval('.cat-grid .cat-item', (els) =>
  els.map((e) => e.innerText.replace(/\s+/g, ' ').trim())
);
check('红包：图标是红色的 🧧', incomeCats.includes('🧧 红包'), true);
check('红包：旧的绿色美钞已经不在', incomeCats.some((t) => t.includes('💵')), false);

await page.type('#amountInput', '8000');
await page.click('.cat-grid .cat-item:nth-child(1)');            // 工资
await page.click('[data-role="save"]');
await sleep(400);
await shot('record-after-three');

/* ---- 账单页 ---- */
await goTab('list');
await shot('list');
check('账单：收入合计', (await sums())[0], '8,000.00');
check('账单：支出合计', (await sums())[1], '50.50');
check('账单：结余', (await sums())[2], '7,949.50');
check('账单：记录条数', await count('.tx'), 3);
check('账单：备注里的逗号引号正常显示', await text('.tx .tx-note'), '午饭, 和同事"聚餐"');

/* ---- 配色：红＝收入、绿＝支出 ---- */
// 按 RGB 通道关系判断，不写死具体色值：以后微调配色这几个断言不用改
const rgbOf = async (sel) =>
  (await page.$eval(sel, (el) => getComputedStyle(el).color)).match(/\d+/g).slice(0, 3).map(Number);
const incomeRGB = await rgbOf('.summary .s-val.income');
const expenseRGB = await rgbOf('.summary .s-val.expense');
check('配色：收入的数字是红的', incomeRGB[0] > 150 && incomeRGB[0] > incomeRGB[1] + 50 && incomeRGB[0] > incomeRGB[2] + 50, true);
check('配色：支出的数字是绿的', expenseRGB[1] > 100 && expenseRGB[1] > expenseRGB[0] + 50, true);
const incomeKeyRGB = await rgbOf('.summary .s-key.income');
check('配色：「收入」这两个字也跟着红了', incomeKeyRGB[0] > 150 && incomeKeyRGB[0] > incomeKeyRGB[1] + 50, true);

/* ---- 账单：周 / 月 / 年三种粒度 ---- */
// 这几条跟「今天是几号」有关，预期值按同一套规则在 Node 里算好，
// 免得写死「9月」到下个月就红。一周从周一开始，和 src/utils.js 保持一致。
const nowD = new Date();
const mLabel = (y, m) => (y === nowD.getFullYear() ? `${m}月` : `${y}年${m}月`);
const curMonth = mLabel(nowD.getFullYear(), nowD.getMonth() + 1);
const daysAgoStr = (n) => {
  const d = new Date(nowD);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 在当月切「按周」，要落在含今天的那一周，而不是月初那一周（踩过这个坑）
await clickEl('[data-role="scope"] [data-scope="week"]');
await sleep(240);
check('账单：按周能看到本周这 3 笔', await count('.tx'), 3);
check('账单：按周的标题是日期区间', /^\d{1,2}月\d{1,2}日–/.test(await text('.m-label')), true);
// 现在所有记录都在今天，没有更早的周期可翻，箭头就该是禁用的
check('账单：没有更早的记录时，往前翻的箭头禁用',
  await page.$eval('.month-nav [data-role="prev"]', (el) => el.disabled), true);

await clickEl('[data-role="scope"] [data-scope="year"]');
await sleep(240);
check('账单：按年能看到 3 笔', await count('.tx'), 3);
check('账单：按年的标题带年份', /^\d{4}年$/.test(await text('.m-label')), true);
check('账单：按年的合计和按月一致', (await sums())[1], '50.50');

await clickEl('[data-role="scope"] [data-scope="month"]');
await sleep(240);
check('账单：从「年」切回「月」保持在同一段', await text('.m-label'), curMonth);

/* ---- 编辑：交通 12 → 99.9 ---- */
await tapTxOf('交通');
await shot('tx-actions');
await tap('[data-act="edit"]');
// 打开修改面板时金额应该已经自动全选，直接输新数字就能覆盖
await page.keyboard.type('99.9');
await shot('tx-edit');
check('编辑：金额框自动全选，直接覆盖', await page.$eval('#amountInput', (el) => el.value), '99.9');
await page.click('.sheet [data-role="save"]');
await sleep(450);
await closeOverlays();
check('编辑：支出合计 38.50 + 99.90', (await sums())[1], '138.40');
check('编辑：条数没变', await count('.tx'), 3);

/* ---- 复制：餐饮 38.5 再记一笔 ---- */
await tapTxOf('餐饮');
await tap('[data-act="dup"]');
await sleep(450);
check('复制：条数 4', await count('.tx'), 4);
check('复制：支出合计 138.40 + 38.50', (await sums())[1], '176.90');

/* ---- 删除刚复制的那笔（列表中排在前面） ---- */
await tapTxOf('餐饮');
await tap('[data-act="del"]');
await shot('tx-delete-confirm');
await tap('.dialog-mask [data-act="ok"]');
await sleep(450);
check('删除：条数回到 3', await count('.tx'), 3);
check('删除：支出合计回到 138.40', (await sums())[1], '138.40');

/* ---- 分类筛选 ---- */
const catValue = await page.$eval('[data-role="cat"] option:nth-child(2)', (o) => o.value);
await page.select('[data-role="cat"]', catValue);
await sleep(350);
await shot('list-filtered');
check('筛选：只剩餐饮 1 笔', await count('.tx'), 1);
check('筛选：标题标出条数', await text('.m-label'), `${curMonth} · 筛选出 1 笔`);
check('筛选：合计跟着筛选走', (await sums())[1], '38.50');

/* ---- 从底栏重进账单，筛选应该被清掉 ---- */
await goTab('list');
check('重进账单：筛选已清空', await text('.m-label'), curMonth);
check('重进账单：记录都回来了', await count('.tx'), 3);

/* ---- 搜索 ---- */
await page.type('[data-role="kw"]', '聚餐');
await sleep(700);
check('搜索：按备注能搜到', await count('.tx'), 1);
await goTab('list');

/* ---- 统计 ---- */
await goTab('stats');
await shot('stats-expense');

/* ---- 统计：周 / 月 / 年 ---- */
check('统计：默认按月的标题', await text('#view .card-title'), `${curMonth}总结`);
await clickEl('#view [data-role="scope"] [data-scope="week"]');
await sleep(260);
check('统计：按周的标题是日期区间', /^\d{1,2}月\d{1,2}日–/.test(await text('#view .m-label')), true);
check('统计：按周算出同一批支出', (await sums())[1], '138.40');
check('统计：按周的环比说的是「上周」', (await text('#view .delta')).includes('上周'), true);

await clickEl('#view [data-role="scope"] [data-scope="year"]');
await sleep(260);
await shot('stats-year');
check('统计：按年的标题', /^\d{4}年总结$/.test(await text('#view .card-title')), true);
check('统计：按年合计一致', (await sums())[1], '138.40');
check('统计：趋势图跟着换成按年', await text('#view .card:last-child .card-title'), '最近 6 年趋势');

await clickEl('#view [data-role="scope"] [data-scope="month"]');
await sleep(260);
check('统计：从「年」切回「月」保持在同一段', await text('#view .m-label'), curMonth);

const pieRows = await page.$$eval('[data-role="pie"] .legend-row', (els) =>
  els.map((e) => e.innerText.replace(/\s+/g, ' ').trim())
);
// 图例按金额从大到小排，交通 99.90 在前
check('统计：支出构成两个分类', pieRows.length, 2);
check('统计：交通金额', pieRows[0].includes('99.90'), true);
check('统计：交通占比 72.2%', pieRows[0].includes('72.2%'), true);
check('统计：餐饮金额', pieRows[1].includes('38.50'), true);
check('统计：餐饮占比 27.8%', pieRows[1].includes('27.8%'), true);

await page.evaluate(() => document.querySelector('#view .seg button[data-kind="income"]').click());
await sleep(300);
await shot('stats-income');
check('统计：收入只有工资一项', await count('[data-role="pie"] .legend-row'), 1);

// 点饼图图例 → 跳账单看明细
await page.click('[data-role="pie"] .legend-row');
await sleep(450);
await shot('stats-drilldown-to-list');
check('统计：点图例跳到账单明细', await count('.tx'), 1);

/* ---- 导出 CSV ---- */
await goTab('settings');
await shot('settings');
await tap('[data-act="csv"]');
await sleep(400);
const csv = (await savedFiles()).pop() ?? '';
check('CSV：表头', csv.replace(/^\uFEFF/, '').split('\r\n')[0], '日期,类型,分类,金额(元),备注,账本');
check('CSV：逗号引号被正确转义', csv.includes('"午饭, 和同事""聚餐"""'), true);
check('CSV：行数 = 表头 + 3 条', csv.trim().split('\r\n').length, 4);

/* ---- 预算 ---- */
await tap('[data-act="budget"]');
await page.type('[data-role="amount"]', '100');
await page.click('.sheet-actions .btn-primary');
await sleep(450);
check('预算：设置成功', await text('[data-act="budget"] .sr-val'), '100.00 元');
await goTab('record');
await shot('record-budget');
check('预算：首页提示超支', await text('#view .budget-tip'), '已经超支 38.40 元（已用 138%）');

/* ---- 分类预算 ---- */
// 三种状态都要覆盖：餐饮 38.50/45 = 86%（黄）、交通 99.90/50（超支红）、
// 购物 0/200（正常灰）。第 4 个分类故意不设，验证不设就一个圆点都不该有。
await goTab('settings');
await tap('[data-act="cats"]');
await shot('category-manager');

await setCategoryBudget(1, '45');
check('分类预算：列表显示本月进度', await text('.sheet .cat-row:nth-child(1) .cm-sub'),
  '1 笔记录在用 · 本月 38.50 / 45.00 元（86%）');
check('分类预算：花到八成标黄',
  await page.$eval('.sheet .cat-row:nth-child(1) .cm-sub', (el) => el.classList.contains('warn')), true);

await setCategoryBudget(2, '50');
check('分类预算：超支文案', await text('.sheet .cat-row:nth-child(2) .cm-sub'),
  '1 笔记录在用 · 本月 99.90 / 50.00 元（200%）');
check('分类预算：超支标红',
  await page.$eval('.sheet .cat-row:nth-child(2) .cm-sub', (el) => el.classList.contains('over')), true);

await setCategoryBudget(3, '200');
check('分类预算：没记录的分类按 0 算', await text('.sheet .cat-row:nth-child(3) .cm-sub'),
  '0 笔记录在用 · 本月 0.00 / 200.00 元（0%）');
await closeOverlays();

await goTab('record');
await shot('record-category-budget');
check('分类圆点：餐饮八成黄', await dotClass(1), 'cat-dot warn');
check('分类圆点：交通超支红', await dotClass(2), 'cat-dot over');
check('分类圆点：购物正常灰', await dotClass(3), 'cat-dot ok');
check('分类圆点：没设预算就没有圆点', await count('.cat-grid .cat-item:nth-child(4) .cat-dot'), 0);
check('分类圆点：补了图例说明', (await text('#view .cat-legend')).startsWith('圆点＝月预算'), true);

// 圆点看的是「所选日期」那个月，不是今天这个月
await pickDate('2020-01-15');
await sleep(220);
check('分类圆点：切到没记录的月份退回正常', await dotClass(2), 'cat-dot ok');
await clickEl('[data-role="quickdates"] [data-off="0"]');
await sleep(220);
check('分类圆点：切回今天又是超支', await dotClass(2), 'cat-dot over');

/* ---- 导出备份 ---- */
await goTab('settings');
await tap('[data-act="backup"]');
await sleep(400);
const backupRaw = (await savedFiles()).pop() ?? '{}';
const backup = JSON.parse(backupRaw);
const backupPath = join(tmpdir(), `jizhang-backup-${Date.now()}.json`);
writeFileSync(backupPath, backupRaw, 'utf8');
check('备份：含 3 笔记录', backup.transactions.length, 3);
check('备份：含 1 个账本', backup.ledgers.length, 1);
check('备份：带上了预算', backup.ledgers[0].budgetFen, 10000);
check('备份：带上了分类', backup.categories.length, 14);
const budgetedCats = backup.categories.filter((c) => c.budgetFen);
check('备份：分类月预算跟着走', budgetedCats.length, 3);
check('备份：餐饮月预算 45 元', budgetedCats.find((c) => c.name === '餐饮').budgetFen, 4500);

/* ---- 新增分类 ---- */
await tap('[data-act="cats"]');
await shot('category-manager');
await tap('[data-role="add"]');
await page.type('[data-role="name"]', '宠物');
await page.click('.emoji-grid button:nth-child(31)');
await page.click('.sheet-actions .btn-primary');
await sleep(500);
check('分类：新增后 15 个', await text('[data-act="cats"] .sr-val'), '15 个');
await closeOverlays();

/* ---- 多账本 ---- */
await tap('[data-act="newledger"]');
await page.type('[data-role="name"]', '装修');
await page.type('[data-role="budget"]', '20000');
await page.click('.sheet-actions .btn-primary');
await sleep(500);
await shot('new-ledger-switched');
check('账本：新建后顶栏跟着换', await text('#ledgerName'), '装修');
await goTab('list');
check('账本：新账本是空的', await count('.tx'), 0);
await goTab('record');
check('账本：新账本用自己的预算', await text('#view .budget-line'), '已花 0.00 元 预算 20,000.00 元');

await tap('#ledgerSwitch');
await shot('ledger-picker');
await page.evaluate(() => document.querySelector('.sheet .set-row').click());
await sleep(500);
check('账本：切回来顶栏跟着换', await text('#ledgerName'), '日常账本');
await goTab('list');
check('账本：切回来数据还在', await count('.tx'), 3);
await goTab('record');
check('账本：切回来预算是自己的', await text('#view .budget-line'), '已花 138.40 元 预算 100.00 元');

/* ---- 备份还原 ---- */
// 先换个主题，验证还原备份不会把本机偏好一起重置
// 顺手核对主题按钮：原来那枚灰线图标压在白顶栏上几乎看不见
const toggleBg = () => page.$eval('#themeToggle', (el) => getComputedStyle(el).backgroundColor);
const iconShown = (cls) => page.$eval(`#themeToggle .${cls}`, (el) => getComputedStyle(el).display !== 'none');
const themeBeforeToggle = await page.$eval('html', (el) => el.dataset.theme);
check('主题按钮：有高亮底色，不是透明的', (await toggleBg()) !== 'rgba(0, 0, 0, 0)', true);
check('主题按钮：浅色下显示月亮', await iconShown('ico-moon'), themeBeforeToggle !== 'dark');
check('主题按钮：浅色下藏起太阳', await iconShown('ico-sun'), themeBeforeToggle === 'dark');
check('主题按钮：图标是暖色的，不是灰的', await page.$eval('#themeToggle', (el) => {
  const [r, g, b] = getComputedStyle(el).color.match(/\d+/g).map(Number);
  return r > b && r > 100;   // 暖色：红通道压过蓝通道
}), true);

await tap('#themeToggle');
await sleep(200);
const themeBeforeRestore = await page.$eval('html', (el) => el.dataset.theme);
check('主题按钮：点一下就切到另一个主题', themeBeforeRestore !== themeBeforeToggle, true);
check('主题按钮：深色下换成太阳', await iconShown('ico-sun'), themeBeforeRestore === 'dark');
check('主题按钮：深色下收起月亮', await iconShown('ico-moon'), themeBeforeRestore !== 'dark');

await goTab('settings');
await tap('[data-act="restore"]');
// 选择文件的窗口是在点「继续」之后弹的，监听必须先挂上
const chooserPromise = page.waitForFileChooser({ timeout: 8000 });
await tap('.dialog-mask [data-act="ok"]');
const chooser = await chooserPromise;
await chooser.accept([backupPath]);
await sleep(700);
await tap('.dialog-mask [data-act="ok"]');   // 「恢复完成」
await sleep(300);
await shot('after-restore');
check('还原：记录回到 3 笔', await goTab('list').then(() => count('.tx')), 3);
await goTab('settings');
check('还原：账本回到 1 个', await text('[data-act="ledgers"] .sr-main'), '日常账本共 1 个账本，点这里切换');
check('还原：分类回到 14 个（宠物被覆盖掉）', await text('[data-act="cats"] .sr-val'), '14 个');
check('还原：预算恢复成备份里的 100', await text('[data-act="budget"] .sr-val'), '100.00 元');
check('还原：本机主题偏好没被重置', await page.$eval('html', (el) => el.dataset.theme), themeBeforeRestore);
await goTab('record');
check('还原：分类预算也一起回来了', await dotClass(2), 'cat-dot over');

/* ---- 老数据的自动迁移 ---- */
// 先把备份里的「红包」图标改回旧的绿钞 💵，再恢复一次。
// 分类是存在本机的，光改默认值对已经装过旧版的人没用，必须搬一次
const legacy = JSON.parse(backupRaw);
legacy.categories.find((c) => c.name === '红包').emoji = '💵';
const legacyPath = join(tmpdir(), `jizhang-legacy-${Date.now()}.json`);
writeFileSync(legacyPath, JSON.stringify(legacy), 'utf8');

await goTab('settings');
await tap('[data-act="restore"]');
const legacyChooser = page.waitForFileChooser({ timeout: 8000 });
await tap('.dialog-mask [data-act="ok"]');
await (await legacyChooser).accept([legacyPath]);
await sleep(700);
await tap('.dialog-mask [data-act="ok"]');
await sleep(400);

await goTab('record');
await page.evaluate(() => document.querySelector('#view .seg button[data-kind="income"]').click());
await sleep(240);
const migratedCats = await page.$$eval('.cat-grid .cat-item', (els) =>
  els.map((e) => e.innerText.replace(/\s+/g, ' ').trim())
);
check('迁移：备份里带进来的旧图标 💵 被自动换成 🧧', migratedCats.includes('🧧 红包'), true);

/* ---- 截图看一眼当前主题 ---- */
await goTab('stats');
await shot('theme-stats');
await goTab('record');
await shot('theme-record');

/* ---- 刷新后数据还在 ---- */
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('#tabbar .tab', { timeout: 8000 });
await goTab('list');
await shot('after-reload');
check('刷新：数据还在', await count('.tx'), 3);
check('刷新：金额没变', (await sums())[1], '138.40');
check('刷新：主题选择记住了', await page.$eval('html', (el) => el.dataset.theme), themeBeforeRestore);

/* ---- 补一组浅色 / 深色的对照截图 ---- */
// 无头浏览器开局是深色，中途又被切过一次，所以这里不假设当前是哪种，
// 明确先切到浅色再拍 —— 免得拍出一组名字叫 light 其实是 dark 的图
if ((await page.$eval('html', (el) => el.dataset.theme)) === 'dark') {
  await tap('#themeToggle');
  await sleep(240);
}
check('浅色截图：当前确实是浅色', await page.$eval('html', (el) => el.dataset.theme), 'light');
await goTab('list');
await shot('theme-list-light');
await goTab('record');
await shot('theme-record-light');

/* ---- 补一笔上周的账，把「往前翻周期」真的走一遍 ---- */
// 前面所有记录都记在今天，往前翻的箭头一直是禁用的，翻页逻辑等于没测到
await goTab('record');
await page.evaluate(() => document.querySelector('#view .seg button[data-kind="expense"]').click());
await sleep(160);
await page.type('#amountInput', '7');
await clickEl('.cat-grid .cat-item:nth-child(1)');       // 餐饮
await pickDate(daysAgoStr(7));
await sleep(220);
await clickEl('[data-role="save"]');
await sleep(500);

await goTab('list');
await clickEl('[data-role="scope"] [data-scope="week"]');
await sleep(260);
check('翻周期：本周仍是 3 笔，上周那笔不算进来', await count('.tx'), 3);
const thisWeekLabel = await text('.m-label');

await clickEl('.month-nav [data-role="prev"]');
await sleep(260);
await shot('list-last-week');
check('翻周期：往前一周找到了上周那笔', await count('.tx'), 1);
check('翻周期：标题跟着翻页变', (await text('.m-label')) !== thisWeekLabel, true);
check('翻周期：上周合计 7.00', (await sums())[1], '7.00');

await clickEl('.month-nav [data-role="next"]');
await sleep(260);
check('翻周期：再翻回来又是本周', await text('.m-label'), thisWeekLabel);

await clickEl('[data-role="scope"] [data-scope="year"]');
await sleep(260);
check('翻周期：按年能看到全部 4 笔', await count('.tx'), 4);
await clickEl('[data-role="scope"] [data-scope="month"]');
await sleep(260);
check('翻周期：按月能看到全部 4 笔', await count('.tx'), 4);
// 4 笔都还在本月（今天 3 笔 + 上周 1 笔），往前翻会翻到一个空月份，
// 所以箭头该是禁用的 —— 和按周那条约边界规则一致
check('翻周期：数据都还在本月时，按月往前翻的箭头禁用',
  await page.$eval('.month-nav [data-role="prev"]', (el) => el.disabled), true);

// 收拾干净：回上周把那笔删掉，别给后面的截图留下多余数据
await clickEl('[data-role="scope"] [data-scope="week"]');
await clickEl('.month-nav [data-role="prev"]');
await sleep(260);
await tapTxOf('餐饮');
await tap('[data-act="del"]');
await tap('.dialog-mask [data-act="ok"]');
await sleep(450);
check('收拾：补的那笔删掉了，上周又空了', await count('.tx'), 0);
await clickEl('[data-role="scope"] [data-scope="week"]');    // 再点一次＝回到当下
await sleep(260);
check('收拾：再点一次当前粒度＝回到本周', await text('.m-label'), thisWeekLabel);
check('收拾：回到本周还是 3 笔', await count('.tx'), 3);

/* ================= 产出 README 用的截图 =================
 *
 * README 里那 5 张图以前是手工从 tools/shots/ 里挑的，挑的时候容易带进
 * 操作提示条（浮在底部，会盖住图例），而且每次发版都要重新挑一遍。
 * 这里按固定状态重拍一组，直接写进 docs/screenshots/ —— 发版时跑一次 verify 就够。
 */
const DOCS = 'docs/screenshots';
mkdirSync(DOCS, { recursive: true });

// 走查时用的是真机尺寸 390×844，内容一长（比如出现了「本月预算」卡片）就会超出一屏：
// 截图里会带上滚动条、备注和保存按钮被挤到屏幕外。README 的图要的是「整页一览」，
// 所以这几张换一个高一点的视口拍，拍完再换回来。
await page.setViewport({ width: 390, height: 1000, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(240);

// 提示条是浮层，截图前先清掉
const clearToasts = () =>
  page.evaluate(() => {
    const r = document.getElementById('toastRoot');
    if (r) r.innerHTML = '';
  });
const docShot = async (name) => {
  await clearToasts();
  await sleep(320);
  await page.screenshot({ path: `${DOCS}/${name}.png` });
};

// 上面拍浅色对照图时切过一次，这里统一先回深色，别拍出一次深一次浅的组图
if ((await page.$eval('html', (el) => el.dataset.theme)) !== 'dark') {
  await tap('#themeToggle');
  await sleep(260);
}

/** 记账页填好一笔但不保存 —— 比空表单有信息量 */
const fillRecordForm = async () => {
  await page.evaluate(() => document.querySelector('#view .seg button[data-kind="expense"]').click());
  await sleep(160);
  await page.type('#amountInput', '38.5');
  await clickEl('.cat-grid .cat-item:nth-child(1)'); // 餐饮
  await page.type('[data-role="note"]', '午饭，和同事聚餐');
  await sleep(200);
};

// 1. 记账页（深色）
await goTab('record');
await fillRecordForm();
await docShot('1-record');

// 2. 账单页：按月看当月
await goTab('list');
await clickEl('[data-role="scope"] [data-scope="month"]');
await sleep(300);
await docShot('2-list');

// 3. 统计页：按月、支出构成
await goTab('stats');
await clickEl('[data-role="scope"] [data-scope="month"]');
await sleep(300);
await docShot('3-stats');

// 4. 设置页
await goTab('settings');
await docShot('4-settings');

// 5. 浅色主题下的记账页，和 1-record 构成深浅对照
//    （切主题只改 data-theme、不重渲染，所以第 1 步填的表单还在）
await tap('#themeToggle');
await sleep(280);
await goTab('record');
await fillRecordForm();
await docShot('5-light');

console.log(`\nREADME 截图 5 张 → ${DOCS}/`);

// 换回走查用的真机尺寸
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

await browser.close();

/* ================= 汇总 ================= */
const failed = results.filter((r) => !r.ok);
console.log(`\n截图 ${shotCount} 张 → ${OUT}/`);
console.log(`检查 ${results.length} 项：通过 ${results.length - failed.length}，失败 ${failed.length}`);
if (errors.length) {
  console.log(`\nJS 报错 ${errors.length} 个：`);
  errors.forEach((e) => console.log('  - ' + e));
}
if (failed.length || errors.length) process.exitCode = 1;
