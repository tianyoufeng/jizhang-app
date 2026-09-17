/**
 * 生成安卓 App 图标。
 * 用系统自带的 Edge 无头模式把 assets 里的 SVG 渲染成各个尺寸的 PNG，
 * 直接写进 android/app/src/main/res/ 下对应的密度目录。
 *
 * 用法：node tools/make-icons.mjs
 */
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const RES = 'android/app/src/main/res';

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
  { svg: 'assets/icon-full.svg', file: 'ic_launcher.png', base: 48, transparent: false },
  { svg: 'assets/icon-full.svg', file: 'ic_launcher_round.png', base: 48, transparent: false },
  { svg: 'assets/icon-foreground.svg', file: 'ic_launcher_foreground.png', base: 108, transparent: true }
];

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });

for (const job of JOBS) {
  const svg = readFileSync(job.svg, 'utf8');

  for (const [density, scale] of DENSITIES) {
    const size = Math.round(job.base * scale);
    const page = await browser.newPage();
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(
      `<html><body style="margin:0;padding:0;background:transparent">
         <div style="width:${size}px;height:${size}px">${svg.replace('<svg', `<svg width="${size}" height="${size}"`)}</div>
       </body></html>`,
      { waitUntil: 'load' }
    );
    const buf = await page.screenshot({ omitBackground: job.transparent, type: 'png' });
    await page.close();

    const dir = `${RES}/mipmap-${density}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/${job.file}`, buf);
    console.log(`${job.file}  ${density}  ${size}×${size}`);
  }
}

// 顺手留一份 1024 的预览图，方便以后换图标或做别的用
for (const [svgPath, outPath] of [
  ['assets/icon-full.svg', 'assets/icon-full.png'],
  ['assets/icon-foreground.svg', 'assets/icon-foreground.png']
]) {
  const svg = readFileSync(svgPath, 'utf8');
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 1024, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;padding:0">${svg}</body></html>`, { waitUntil: 'load' });
  writeFileSync(outPath, await page.screenshot({ omitBackground: true, type: 'png' }));
  await page.close();
}

/* ---------------- 启动画面 ---------------- */

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

const logoSvg = readFileSync('assets/icon-foreground.svg', 'utf8').replace(/width="1024" height="1024"/, '');

for (const [dir, w, h] of SPLASHES) {
  const logo = Math.round(Math.min(w, h) * 0.34);
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.setContent(
    `<html><body style="margin:0;padding:0;width:${w}px;height:${h}px;background:#3b7dd8;
        display:flex;align-items:center;justify-content:center">
       <div style="width:${logo}px;height:${logo}px">${logoSvg.replace('<svg', `<svg width="${logo}" height="${logo}"`)}</div>
     </body></html>`,
    { waitUntil: 'load' }
  );
  const buf = await page.screenshot({ type: 'png' });
  await page.close();

  mkdirSync(`${RES}/${dir}`, { recursive: true });
  writeFileSync(`${RES}/${dir}/splash.png`, buf);
  console.log(`splash.png  ${dir}  ${w}×${h}`);
}

await browser.close();
console.log('\n图标和启动画面已写入', RES);
