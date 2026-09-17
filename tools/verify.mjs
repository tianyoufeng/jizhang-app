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
check('筛选：标题标出条数', await text('.m-label'), '9月 · 筛选出 1 笔');
check('筛选：合计跟着筛选走', (await sums())[1], '38.50');

/* ---- 从底栏重进账单，筛选应该被清掉 ---- */
await goTab('list');
check('重进账单：筛选已清空', await text('.m-label'), '9月');
check('重进账单：记录都回来了', await count('.tx'), 3);

/* ---- 搜索 ---- */
await page.type('[data-role="kw"]', '聚餐');
await sleep(700);
check('搜索：按备注能搜到', await count('.tx'), 1);
await goTab('list');

/* ---- 统计 ---- */
await goTab('stats');
await shot('stats-expense');
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
await tap('#themeToggle');
await sleep(200);
const themeBeforeRestore = await page.$eval('html', (el) => el.dataset.theme);

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
