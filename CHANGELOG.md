# 更新记录

本文件记录每个版本改了什么，方便回溯和接着迭代。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

---

## [1.1] — 2026-09-18

这一版做了两件事：**修掉 v1.0 的排版与交互问题**（共 20 条，逐条见 `记账本-优化建议.md`），
**并让 iPhone 也能装**。全程没有引入新框架、新依赖、新网络请求，仍然是纯本地 App。

### 新增

- **iPhone 支持**
  - PWA：新增 `public/manifest.webmanifest` + `public/sw.js`，Safari「添加到主屏幕」后全屏运行、支持离线。
  - 原生 iOS：新增 `ios/` 工程（Capacitor 6），图标与启动画面按苹果规范生成。
  - `index.html` 补 `apple-touch-icon`、`apple-mobile-web-app-*` 等 iOS 专用 meta。
- **账单页「本月 / 全部时间」切换** —— 以前 `monthTransactions()` 先按月过滤再搜关键字，
  想找「三个月前买空调那笔」得逐月翻；现在切到「全部时间」一次搜完。
- **删除可撤销** —— 删完弹一条带「撤销」的提示，6 秒内点了就恢复（`restoreTransaction`）。
- **统计页环比** —— 单月总结里多一行「比上月多花 412.30 元（+18%）」，涨红跌绿。
- **分类排序** —— 分类管理每行右侧加上移 / 下移按钮（`moveCategory`），常用的能调到顺手的位置。
- **备份提醒** —— 超过 30 天没导出过备份，记账页顶部出现提示条；导出后记下 `meta.lastBackupAt`，
  设置页显示「上次备份：X 天前」。
- **记账页快捷日期** —— 「今天 / 昨天 / 前天」三个 chip，补记不用翻日历。
- **金额输入实时纠正** —— 新增 `sanitizeAmount()`，输入 `1.2.3` 会被截成 `1.2`（只留一个小数点、最多两位）。

### 修复

- **顶栏标题不居中** —— `#topbar` 原来是 `flex`，左侧账本按钮宽 92px、右侧图标 40px，
  `h1{flex:1}` 只在剩余空间里居中，实测偏右约 26px。改用
  `grid-template-columns: minmax(0,1fr) auto minmax(0,1fr)` 后回到屏幕正中。
- **两张图表的字号一个被放大、一个被缩小** —— `.chart-wrap svg{width:100%}` 覆盖了 svg 固有尺寸，
  文字按 `viewBox` 比例一起缩放：趋势图 viewBox 340 在 360px 屏上缩到 0.89×（10px 字变 ≈9px），
  饼图 viewBox 200 反而放大到 1.52×（12px 字变 ≈18px）。现统一 `VIEW_W = 320` 并给
  `.chart-wrap` 设 `max-width:360px`，缩放比稳定在 1 附近。
- **趋势图图例被 `flex:1` 撑开** —— 「收入 / 支出」四个元素挤在同一个 `.legend-row` 里，
  第一个 `.legend-name` 吃掉剩余空间把「支出」推到最右。拆成两个 `.legend-group` 后并排显示。
- **轻提示挡住了「保存这笔」按钮** —— `.toast` 浮在底部导航之上且 `pointer-events:auto`，
  点保存时其实点到的是 toast，导致第 2、3 笔交易**静默保存失败**（走查里表现为
  「收入合计 期望 8000 实际 128000」）。改成 `.toast{pointer-events:none}` +
  `.toast-action{pointer-events:auto}`，只让撤销按钮接收点击。
- **新建分类的 `order` 会撞号** —— 原来用 `sameKind.length` 算序号，删过分类之后再新建就会重复。
  改成 `max(order) + 1`。
- **`tools/build-apk.mjs` 在 Windows 上必然失败** —— 原来用
  `cmd.exe /d /s /c "\"路径\gradlew.bat\" assembleRelease"`，Node 会把内嵌引号转义成 `\"`，
  而 cmd 不认识反斜杠转义，于是把 `\"C:\...\gradlew.bat\"` 整个当成命令名去找，报
  「不是内部或外部命令」。现在改成 `spawnSync(gradlew, ['assembleRelease'], { shell: true })`。
- **iOS 状态栏文字在浅色主题下看不见** —— `apple-mobile-web-app-status-bar-style` 原来用
  `black-translucent`，该模式下 iOS 状态栏文字**恒为白色**且页面顶到状态栏下面，
  而浅色主题顶栏是 `#ffffff`，白字压白底。改成 `default`（系统按当前外观自动取色）。
- **`Info.plist` 的设备能力声明过时** —— `UIRequiredDeviceCapabilities` 从模板默认的 `armv7`
  改为 `arm64`（Capacitor 6 只支持 iOS 13+，全是 64 位设备；留着 armv7 会导致 App Store 校验报错）。
- **`fileio.js` 分享失败没提示** —— `Share.share` 包了 try/catch，返回
  `{mode:'share-failed', uri, message}`，不再静默失败。

### 变更

- **底部导航图标从 emoji 换成内联 SVG** —— `✏️📋📊⚙️` 在各品牌 ROM 上渲染不一致，
  且无法跟随主题变色（选中的 tab 只有文字变蓝、图标还是原色）。现在用
  `stroke="currentColor"`，颜色自动跟主题走。
- **间距统一** —— 原来 `.card` 12px / `.day-group` 14px / `.set-group` 18px 三套混用，
  改成 `--gap-1..4`（8/12/16/24）一套刻度。
- **次级字号 11px → 12px** —— 11px 在手机上已接近可读下限。
- **统计页大数字加 `tabular-nums`** —— 翻月份时三列不再轻微抖动。
- **分类网格改自适应** —— 固定 5 列时每格约 63px，6 个中文字会被 `ellipsis` 截断；
  改成 `repeat(auto-fill, minmax(64px, 1fr))`。
- **默认分类图标 🧧 → 💵** —— 🧧 是 Unicode 9.0，在安卓 5.1 的老字体上是豆腐块；💵 是 6.0，安全。
  （🛒 同样是 9.0，但它已是「购物」的默认图标、改动影响面大，暂时保留。）
- **表单控件统一 16px + `appearance:none`** —— 防 iOS 聚焦时自动放大，并去掉各平台原生外观。
- **切 Tab 记住滚动位置** —— 新增 `scrollMemory`，不再每次 `scrollTo(0,0)`。
- **版本号 1.0 → 1.1** —— 见下方「版本号在哪几处」。

### 兼容性

- **数据库结构未变**，`DB_VERSION` 没有升，老数据直接可用。
- **备份文件格式未变**，v1.0 导出的备份在 v1.1 里能正常恢复。
- **⚠️ 签名密钥换了** —— 见下方「关于签名」。
- 原来的 `ledger_date` 索引建了但从没被查询用过。**这次故意没删**：删索引要升 IndexedDB
  版本号，会牵动老用户的数据，代价不划算，已在 `db.js` 加注释说明。

### 没做的

原清单里有三条这次**没动**，原因如下：

| 条目 | 为什么没做 |
|---|---|
| #12 分类预算（给某个分类单独设上限） | 要动 category 的数据结构，属于「加功能」而不是「修问题」，留到下一轮 |
| #15 周期性记账（房租 / 订阅每月自动生成） | 同上，需要设计「当月是否已生成」的状态，值得单独做一版 |
| #16 移除 `INTERNET` 权限 | 代码里确实一行网络请求都没有，但去掉它要真机逐项验证分享面板和文件导出，风险大于收益。已在 README 里写明「不会发起任何网络请求」 |

---

## 打包 / 推送工具链的修复（2026-09-18）

出这一版安装包时，在工具脚本里挖出几个真 bug，都已修好：

| 脚本 | 问题 | 症状 | 改法 |
|---|---|---|---|
| `tools/build-apk.mjs` | 传给 `cmd.exe` 的命令里，路径被 Node 转义成 `\"C:\...\gradlew.bat\"`，而 cmd 不认反斜杠转义 | `npm run apk` 在这台机器上跑不起来，报「不是内部或外部命令」 | 改用 `spawnSync('cmd.exe', [...], { shell: true })`，引号交给 cmd 自己处理 |
| `tools/push-to-github.mjs` | **浅克隆下会断历史** —— 本地最早那个提交的父提交没被拉下来。注意 `git log --format=%P` 是**浅克隆感知**的，对边界提交返回空，但它的提交对象里其实写着 `parent` | 推上去后 `main` 只剩 2 个提交，v1.0 和「添加推送脚本」这两段历史**和分支脱开了**（对象还在库里，只是不在历史线上） | 新增 `rawParents()` 从 `cat-file` 的原始对象里读父提交；再用 `resolveParents()` 确认它在远程存在后**原样沿用它的哈希** |
| `tools/push-to-github.mjs` | 本机代理替换了 TLS 证书，Node 内置的 CA 认不出 `api.github.com`，报 `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | `npm run push` 在这个网络环境下直接失败（同样环境下 `gh` 却正常） | 脚本开头加证书探测，需要就自动带 `--use-system-ca` 把**自己重跑一遍**，不用记额外命令 |
| `tools/push-to-github.mjs` | 本机 `git update-ref` **退出码 0 却不生效**：引用只在 `.git/packed-refs` 里，松散引用文件没被建出来，回读还是旧值 | 推完之后 `git status` 一直显示「ahead 2」，看着像没推成功 | 写完**回读校验**，值对不上就直接写 `.git/refs/...` 松散引用文件兜底 |

另外把「内容 tree 哈希不一致」改成**致命错误、当场中止，且不再改动分支指针** —— 原来的逻辑是内容对不上也照样先推分支、推完才报错，等于把远程改成半吊子状态。

> **浅克隆要留意**：这个仓库是 `git clone --depth` 下来的，本地只有最近的提交。
> 想让本地和远程完全一致，先 `git fetch --unshallow` 把历史补全。

---

## 版本号在哪几处

升版本时这几处都要改（**容易漏**，尤其 Service Worker 那个）：

| 文件 | 字段 |
|---|---|
| `package.json` | `version` |
| `android/app/build.gradle` | `versionCode`（每次都要 +1）、`versionName` |
| `ios/App/App.xcodeproj/project.pbxproj` | `MARKETING_VERSION`、`CURRENT_PROJECT_VERSION`（Debug / Release 各一处） |
| `public/sw.js` | `CACHE` 常量 |
| `README.md` | 顶部的「当前版本」 |

> `sw.js` 的缓存名**必须跟着升**。Service Worker 的 `activate` 是靠「缓存名不一样」来清旧缓存的，
> 不升的话老 PWA 用户拿到的还是旧资源。

---

## 关于签名

`android/jizhang.keystore` 和 `android/keystore.properties` **不在版本库里**（`.gitignore` 明确排除），
也**没有随仓库传过来**。要出可安装的 APK 就必须有一把钥匙，所以 v1.1 是**新生成**的一把，
和原作者签 v1.0 用的那把不是同一把。

后果：

- 手机上**没有**装过 v1.0 → 直接装 v1.1，没问题。
- 手机上**已经装了** v1.0（原作者那把签的）→ 装 v1.1 会报签名冲突，必须先卸载。
  **卸载会清掉 App 数据**，所以先「设置 → 导出完整备份」，卸完重装再恢复。

以后每次发新版，**继续用同一把钥匙**，就不会再有这个问题。
`android/jizhang.keystore` 和 `android/keystore.properties` 请另存到网盘或 U 盘 —— 丢了就只能再换一次钥匙。

---

## 下一轮可以做的（候选，按性价比排）

### 功能

1. **分类预算** —— 给 category 加可选 `budgetFen`，记账户页的分类格右上角显示小圆点，超支变红。
   「这个月餐饮花了 3000」比「总支出超了 500」更有指导意义。
2. **周期性记账** —— 记录上加「每月重复」开关，启动时检查当月是否已生成。房租、订阅场景。
3. **账单页按金额筛选** —— 现在只能按分类和关键字。「找出所有 >500 的支出」是很自然的需求。
4. **导出 Excel（.xlsx）** —— 现在只有 CSV。分月分表、带格式的话 Excel 更实用。
5. **记账页记住上次用的分类** —— 连记同类开销时能少点一下。

### 工程质量

6. **视觉回归测试** —— 现在的 `tools/verify.mjs` 有 53 项断言，但**只核对数字和文案**，
   上面那些排版问题（标题偏 26px、图表字号缩成 9px）它一条都发现不了。
   建议加一层：固定视口（360×800）截图与基线做像素比对，超阈值就报错。
7. **移除 `INTERNET` 权限** —— 需要真机验证导出 CSV、分享面板、备份恢复三处，验证通过再移除。
8. **补无障碍标签** —— 圆环图、柱状图目前没有可读的文字替代，屏幕阅读器读不出来。

### 兼容性

9. **iPad / 平板布局** —— 现在只有手机宽度下好看，横屏或 iPad 上卡片会拉得很宽。
10. **深色模式下的图表配色** —— 可以再针对深色背景微调一档对比度。

---

## v1.0 — 2026-09-17

最初的版本。纯本地安卓记账 App：四个页面（记账 / 账单 / 统计 / 设置），
多账本、分类管理、预算、CSV 导出、完整备份与恢复，数据全部存在本机 IndexedDB。

- 技术栈：原生 HTML/CSS/JS（无框架）+ Vite 5 + Capacitor 6
- 图表：手写 SVG，不依赖图表库
- 金额一律以「分」存整数，避免浮点误差
