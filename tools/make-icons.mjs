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
const BRAND = '#3b7dd8';

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
 * 给了底色、并把 inset 调大，就是 iOS / maskable 要的「铺满整块」版本。
 */
function squareHtml({ size, svg, inset = 1, bg = null }) {
  const box = Math.round(size * inset);
  const inner = svg.replace('<svg', `<svg width="${box}" height="${box}"`);
  return `<html><body style="margin:0;padding:0;width:${size}px;height:${size}px;
      background:${bg || 'transparent'};display:flex;align-items:center;justify-content:center">
     <div style="width:${box}px;height:${box}px">${inner}</div>
   </body></html>`;
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

// 老图标基准 48dp；自适应图标的前景层基准 108dp
const JOBS = [
  { svg: svgFull, file: 'ic_launcher.png', base: 48, transparent: false },
  { svg: svgFull, file: 'ic_launcher_round.png', base: 48, transparent: false },
  { svg: svgFore, file: 'ic_launcher_foreground.png', base: 108, transparent: true }
];

for (const job of JOBS) {
  for (const [density, scale] of DENSITIES) {
    const size = Math.round(job.base * scale);
    const buf = await shoot({
      width: size,
      height: size,
      transparent: job.transparent,
      html: squareHtml({ size, svg: job.svg, inset: 1, bg: job.transparent ? null : null })
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

// maskable：必须铺满整块，四周留安全边距，系统怎么裁都不会切到内容
{
  const size = 512;
  const buf = await shoot({
    width: size,
    height: size,
    transparent: false,
    html: squareHtml({ size, svg: svgFore, bg: BRAND })
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
    html: squareHtml({ size, svg: svgFore, inset: 1.15, bg: BRAND })
  });
  writeFileSync('public/apple-touch-icon.png', buf);
  console.log(`public/apple-touch-icon.png  ${size}×${size}`);
}

/* ================= 3. 安卓启动画面 ================= */

// 蓝底 + 居中的白色卡片，尺寸跟原来模板里的一致
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
  return `<html><body style="margin:0;padding:0;width:${width}px;height:${height}px;background:${BRAND};
      display:flex;align-items:center;justify-content:center">
     <div style="width:${logo}px;height:${logo}px">${inner}</div>
   </body></html>`;
}

for (const [dir, w, h] of SPLASHES) {
  const logo = Math.round(Math.min(w, h) * 0.34);
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
    (px) => squareHtml({ size: px, svg: svgFore, inset: 1.15, bg: BRAND })
  );
  const didSplash = await fillImageSet(
    `${IOS_ASSETS}/Splash.imageset`,
    (px) => splashHtml({ width: px, height: px, logo: Math.round(px * 0.18) })
  );
  console.log(`\niOS：图标 ${didIcon ? '已生成' : '未找到'}，启动图 ${didSplash ? '已生成' : '未找到'}`);
} else {
  console.log('\n没有找到 ios/ 工程，跳过 iOS 图标（先跑 npx cap add ios）');
}

await browser.close();
console.log('\n全部完成。');
