/**
 * 图标校验：把生成好的图标按「各平台实际看到的样子」拼成一张图，供肉眼确认。
 *
 * 重点模拟安卓启动器对自适应图标的处理：系统只显示那一层 108dp 中间 72dp（66%）
 * 那块、并放大到图标大小。**不模拟的话看不出问题** —— v1.3 换 ￥ 时，
 * 前景层忘了缩小，真机上两撇会顶到图标边缘，而源码和 1024 预览图都看着正常。
 *
 * 用法：node tools/verify-icons.mjs
 * 产出：tools/shots/icon-check.png
 */
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const RES = 'android/app/src/main/res';
const OUT = 'tools/shots';

const dataUri = (p) => 'data:image/png;base64,' + readFileSync(p).toString('base64');

const ICON = 150;          // 展示尺寸
const CROP = 0.66;         // 安卓自适应图标可见区 = 108dp 图层的中间 66%
const bigPx = Math.round(ICON / CROP);
const offset = -Math.round((bigPx - ICON) / 2);

/** 自适应图标：按启动器的裁切方式合成 背景层 + 前景层 */
function adaptive(shape) {
  const bg = dataUri(`${RES}/mipmap-xxxhdpi/ic_launcher_background.png`);
  const fg = dataUri(`${RES}/mipmap-xxxhdpi/ic_launcher_foreground.png`);
  const radius = shape === 'circle' ? '50%' : '26%';
  const img = (src) =>
    `<img src="${src}" style="position:absolute;width:${bigPx}px;height:${bigPx}px;
        left:${offset}px;top:${offset}px">`;
  return `<div style="position:relative;width:${ICON}px;height:${ICON}px;border-radius:${radius};
      overflow:hidden;background:#000">${img(bg)}${img(fg)}</div>`;
}

/** 整层不裁（对照：看内容有没有超出安全区） */
function fullLayer() {
  const bg = dataUri(`${RES}/mipmap-xxxhdpi/ic_launcher_background.png`);
  const fg = dataUri(`${RES}/mipmap-xxxhdpi/ic_launcher_foreground.png`);
  return `<div style="position:relative;width:${ICON}px;height:${ICON}px;border-radius:8px;overflow:hidden">
      <img src="${bg}" style="width:100%;height:100%">
      <img src="${fg}" style="position:absolute;inset:0;width:100%;height:100%">
    </div>`;
}

/** maskable：系统最多裁到直径 80% 的内切圆 */
function maskable() {
  const src = dataUri('public/icon-maskable-512.png');
  return `<div style="position:relative;width:${ICON}px;height:${ICON}px;border-radius:50%;overflow:hidden">
      <img src="${src}" style="width:100%;height:100%">
    </div>`;
}

const plain = (path) =>
  `<img src="${dataUri(path)}" style="width:${ICON}px;height:${ICON}px;display:block">`;

const splash = dataUri(`${RES}/drawable-port-xhdpi/splash.png`);

const tiles = [
  ['整块图标<br><span>老安卓 / favicon</span>', plain(`${RES}/mipmap-xxxhdpi/ic_launcher.png`)],
  ['自适应 · 整层<br><span>对照，看有没有出安全区</span>', fullLayer()],
  ['自适应 · 方角<br><span>启动器实际裁切效果</span>', adaptive('square')],
  ['自适应 · 圆形<br><span>启动器实际裁切效果</span>', adaptive('circle')],
  ['maskable<br><span>PWA，最坏情况裁成圆</span>', maskable()],
  ['apple-touch-icon<br><span>iPhone 主屏 180px</span>', plain('public/apple-touch-icon.png')],
  ['iOS AppIcon<br><span>1024 源图</span>', plain('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')],
  ['PWA icon-512', plain('public/icon-512.png')]
]
  .map(
    ([title, body]) => `<div style="background:#fff;border:1px solid #e3e7ee;border-radius:16px;
        padding:18px;text-align:center">
      <div style="display:flex;justify-content:center;height:${ICON}px;align-items:center">${body}</div>
      <div style="font:600 14px/1.5 'Microsoft YaHei',sans-serif;color:#1b1f26;margin-top:12px">${title}</div>
    </div>`
  )
  .join('');

const html = `<html><body style="margin:0;background:#f4f6f9;padding:26px;font-family:'Microsoft YaHei',sans-serif">
  <div style="font:700 22px/1.3 sans-serif;color:#1b1f26;margin-bottom:16px">
    记账本图标 · 各平台实际观感校验</div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">${tiles}</div>
  <div style="font:700 17px/1.3 sans-serif;color:#1b1f26;margin:24px 0 12px">
    安卓启动图（竖屏 xhdpi，缩小显示）</div>
  <img src="${splash}" style="width:300px;border-radius:12px;border:1px solid #e3e7ee">
</body></html>`;

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'load' });
writeFileSync(`${OUT}/icon-check.png`, await page.screenshot({ fullPage: true, type: 'png' }));
await browser.close();
console.log(`校验图：${OUT}/icon-check.png`);
