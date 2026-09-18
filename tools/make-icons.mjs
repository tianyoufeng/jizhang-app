/**
 * 生成各平台需要的图标和启动画面。
 * 用系统自带的 Edge 无头模式把 assets 里的 SVG 渲染成各个尺寸的 PNG。
 *
 * 一次把三件事都做了：
 *   1. 安卓            → android/app/src/main/res/ 下各密度目录
 *   2. 网页 / PWA      → public/ 下 192 / 512 / maskable / apple-touch-icon
 *   3. iOS             → ios/App/App/Assets.xcassets（只在已经跑过 npx cap add ios 之后）
 *
 * 用法：node tools/make-icons.mjs
 */
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const RES = 'android/app/src/main/res';

/**
 * 品牌色。图标本体是「金 → 橙」的斜向渐变，所以这里存两端色值：
 * 图标 SVG 里写的是同样的渐变（见 assets/icon-*.svg）。
 * 需要单一色值的场合（安卓兜底 color 资源、manifest 的 theme_color）用 BRAND_FROM。
 * 改配色时这两处要一起改，否则图标和启动图会不同色。
 */
const BRAND_FROM = '#C79A2E';
const BRAND_TO = '#D9662A';
// CSS 里没有「渐变值」这种类型，只能用 linear-gradient()；方向 135deg = 左上 → 右下，
// 和 SVG 里 x1=0,y1=0→x2=1,y2=1 是同一个方向。
const BRAND_CSS = `linear-gradient(135deg, ${BRAND_FROM}, ${BRAND_TO})`;

// 各自去掉写死的宽高，交给外层按目标尺寸指定
const svgFull = readFileSync('assets/icon-full.svg', 'utf8').replace(/width="1024" height="1024"/, '');
const svgFore = readFileSync('assets/icon-foreground.svg', 'utf8').replace(/width="1024" height="1024"/, '');

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });

/** 把一段 HTML 渲染成 PNG */
async function shoot({ width, height, html, transparent = true }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  const buf = await page.screenshot({ omitBackground: transparent, type: 'png' });
  await page.close();
  return buf;
}

/**
 * 方形图标。
 * bg 为 null 时背景透明（自适应图标的前景层用）；
 * 给了底色就是把整块铺满（maskable / iOS 的图标要用渐变铺满整块）。
 */
function squareHtml({ size, svg, inset = 1, bg = null }) {
  const box = Math.round(size * inset);
  const inner = svg.replace('<svg', `<svg width="${box}" height="${box}"`);
  return `<html><body style="margin:0;padding:0;width:${size}px;height:${size}px;
      background:${bg || 'transparent'};display:flex;align-items:center;justify-content:center">
     <div style="width:${box}px;height:${box}px">${inner}</div>
   </body></html>`;
}

/** 一整块纯渐变的方块，给自适应图标的背景层用 */
function gradientHtml(size) {
  return `<html><body style="margin:0;padding:0;width:${size}px;height:${size}px;
      background:${BRAND_CSS}"></body></html>`;
}

/* ================= 1. 安卓 ================= */

// 安卓各密度对应的倍数：mdpi=1x, hdpi=1.5x, xhdpi=2x, xxhdpi=3x, xxxhdpi=4x
const DENSITIES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4]
];

// 老图标基准 48dp；自适应图标的前景层与背景层基准都是 108dp
const JOBS = [
  { svg: svgFull, file: 'ic_launcher.png', base: 48, transparent: false },
  { svg: svgFull, file: 'ic_launcher_round.png', base: 48, transparent: false },
  // 前景层要把 ￥ 缩到 0.67：安卓只显示这层中间 66% 那块并放大到图标大小，
  // 若按整块图标那样铺（字形占本层 62.5%），裁完等于放大到 94%，顶到边。
  // 0.67 是反推出来的：62.5% ÷ 66.7% ≈ 0.94 太大，要让裁完仍是 62.5%，就得乘 0.67。
  { svg: svgFore, file: 'ic_launcher_foreground.png', base: 108, transparent: true, inset: 0.67 },
  // 自适应图标的背景层：整块品牌渐变。系统负责把两层裁成圆/方/水滴，
  // 所以这里要铺满、不留边 —— 之前这里是一个纯色 @color，换渐变必须换成图片。
  { file: 'ic_launcher_background.png', base: 108, transparent: false, bgOnly: true }
];

for (const job of JOBS) {
  for (const [density, scale] of DENSITIES) {
    const size = Math.round(job.base * scale);
    const buf = await shoot({
      width: size,
      height: size,
      transparent: job.transparent,
      html: job.bgOnly ? gradientHtml(size) : squareHtml({ size, svg: job.svg, inset: job.inset ?? 1 })
    });

    const dir = `${RES}/mipmap-${density}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/${job.file}`, buf);
    console.log(`${job.file}  ${density}  ${size}×${size}`);
  }
}

/* ================= 2. 网页 / PWA ================= */

// 透明背景的圆角版，给支持 SVG 或透明 PNG 的场景
for (const size of [192, 512]) {
  const buf = await shoot({ width: size, height: size, html: squareHtml({ size, svg: svgFull }) });
  writeFileSync(`public/icon-${size}.png`, buf);
  console.log(`public/icon-${size}.png  ${size}×${size}`);
}

// maskable：必须铺满整块。0.9 是留出安全边距 —— maskable 最坏会被裁成
// 直径 80% 的圆，不留边的话 ￥ 的两撇会贴到圆边上。
{
  const size = 512;
  const buf = await shoot({
    width: size,
    height: size,
    transparent: false,
    html: squareHtml({ size, svg: svgFore, inset: 0.9, bg: BRAND_CSS })
  });
  writeFileSync('public/icon-maskable-512.png', buf);
  console.log(`public/icon-maskable-512.png  ${size}×${size}`);
}

// iOS 的 apple-touch-icon：不带透明通道，且系统会自己套圆角，所以要铺满
{
  const size = 180;
  const buf = await shoot({
    width: size,
    height: size,
    transparent: false,
    html: squareHtml({ size, svg: svgFore, inset: 1, bg: BRAND_CSS })
  });
  writeFileSync('public/apple-touch-icon.png', buf);
  console.log(`public/apple-touch-icon.png  ${size}×${size}`);
}

/* ================= 3. 安卓启动画面 ================= */

// 品牌渐变底 + 居中白色的 ￥，尺寸跟原来模板里的一致
const SPLASHES = [
  ['drawable', 480, 320],
  ['drawable-port-mdpi', 320, 480],
  ['drawable-port-hdpi', 480, 800],
  ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxhdpi', 960, 1600],
  ['drawable-port-xxxhdpi', 1280, 1920],
  ['drawable-land-mdpi', 480, 320],
  ['drawable-land-hdpi', 800, 480],
  ['drawable-land-xhdpi', 1280, 720],
  ['drawable-land-xxhdpi', 1600, 960],
  ['drawable-land-xxxhdpi', 1920, 1280]
];

function splashHtml({ width, height, logo }) {
  const inner = svgFore.replace('<svg', `<svg width="${logo}" height="${logo}"`);
  return `<html><body style="margin:0;padding:0;width:${width}px;height:${height}px;background:${BRAND_CSS};
      display:flex;align-items:center;justify-content:center">
     <div style="width:${logo}px;height:${logo}px">${inner}</div>
   </body></html>`;
}

for (const [dir, w, h] of SPLASHES) {
  // 0.48：￥ 的墨迹只占自己那个方框的 62%，乘下来是屏幕短边的 30% 左右，
  // 比原来那张白卡片明显一点，又不至于撑满。
  const logo = Math.round(Math.min(w, h) * 0.48);
  const buf = await shoot({ width: w, height: h, transparent: false, html: splashHtml({ width: w, height: h, logo }) });
  mkdirSync(`${RES}/${dir}`, { recursive: true });
  writeFileSync(`${RES}/${dir}/splash.png`, buf);
  console.log(`splash.png  ${dir}  ${w}×${h}`);
}

/* ================= 4. 1024 预览图 ================= */

for (const [svg, outPath] of [
  [svgFull, 'assets/icon-full.png'],
  [svgFore, 'assets/icon-foreground.png']
]) {
  const buf = await shoot({ width: 1024, height: 1024, html: squareHtml({ size: 1024, svg }) });
  writeFileSync(outPath, buf);
}

/* ================= 5. iOS ================= */

/**
 * Capacitor 生成的 iOS 工程里，每个 imageset 都有一个 Contents.json
 * 描述了需要哪些文件名和尺寸。直接照着它生成，不用把尺寸表写死 ——
 * 以后 Capacitor 换模板也不会对不上。
 */
/**
 * 算出这张图该生成多少像素。Contents.json 有两种写法，都要认：
 *   有 size 的（AppIcon）        → size × scale
 *   没 size、尺寸写在文件名里（Splash）→ 直接用文件名里的数字，不再乘 scale
 */
function targetPixels(img) {
  if (img.size) {
    const w = Number(String(img.size).split('x')[0]) || 0;
    const scale = Number(String(img.scale || '1x').replace('x', '')) || 1;
    if (w) return Math.round(w * scale);
  }
  const fromName = /(\d+)x(\d+)/.exec(img.filename || '');
  if (fromName) return Number(fromName[1]);
  return 0;
}

async function fillImageSet(dir, makeHtml) {
  const contentsPath = `${dir}/Contents.json`;
  if (!existsSync(contentsPath)) return false;

  const contents = JSON.parse(readFileSync(contentsPath, 'utf8'));
  let count = 0;

  for (const img of contents.images || []) {
    if (!img.filename) continue;
    const px = targetPixels(img);
    if (!px) continue;

    const buf = await shoot({ width: px, height: px, transparent: false, html: makeHtml(px) });
    writeFileSync(`${dir}/${img.filename}`, buf);
    console.log(`${dir}/${img.filename}  ${px}×${px}`);
    count += 1;
  }
  return count > 0;
}

const IOS_ASSETS = 'ios/App/App/Assets.xcassets';

if (existsSync(IOS_ASSETS)) {
  const didIcon = await fillImageSet(
    `${IOS_ASSETS}/AppIcon.appiconset`,
    (px) => squareHtml({ size: px, svg: svgFore, inset: 1, bg: BRAND_CSS })
  );
  const didSplash = await fillImageSet(
    `${IOS_ASSETS}/Splash.imageset`,
    (px) => splashHtml({ width: px, height: px, logo: Math.round(px * 0.2) })
  );
  console.log(`\niOS：图标 ${didIcon ? '已生成' : '未找到'}，启动图 ${didSplash ? '已生成' : '未找到'}`);
} else {
  console.log('\n没有找到 ios/ 工程，跳过 iOS 图标（先跑 npx cap add ios）');
}

await browser.close();
console.log('\n全部完成。');
