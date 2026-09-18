/**
 * 把 dist/ 打成 iPhone 用的 PWA 包：记账本-v<版本>-pwa.zip
 *
 * 用法：npm run build && node tools/make-pwa-zip.mjs
 *
 * 两个约定，改动时留意：
 *  1. 条目放在**根层** —— 解压出来 index.html 就在最外层，直接整包传到静态托管即可。
 *     如果包一层文件夹，托管站点会变成「域名/记账本/」，Safari 加到主屏幕后路径也不对。
 *  2. 文件名带版本号，用的是 ZIP 规范里的 UTF-8 名字标志（flag 0x0800），
 *     否则 Windows 资源管理器 / 部分解压工具会把中文名显示成乱码。
 *
 * 为什么不用 PowerShell 的 Compress-Archive：命令行传中文文件名时，
 * 参数在 shell 里会按本地代码页转一次，包名有概率变成乱码。
 * 这里全部在 Node 里算，绕开这一层。
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join, relative, sep } from 'node:path';

const DIST = 'dist';

/* ---- CRC32（ZIP 每个条目都要）---- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** MS-DOS 时间 / 日期，ZIP 头里用的老格式 */
function dosTime(d) {
  return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xffff;
}
function dosDate(d) {
  return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
}

/** 递归列出 dist 下所有文件，返回相对路径（用 / 分隔，ZIP 规范要求） */
function walk(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return walk(full, base);
    return relative(base, full).split(sep).join('/');
  });
}

/* ---- 读版本号：package.json 里是 1.4.0，包名只留 1.4 ---- */
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version.replace(/\.0$/, '');
const outName = `记账本-v${version}-pwa.zip`;

const names = walk(DIST).sort();

const locals = [];
const centrals = [];
let offset = 0;

for (const name of names) {
  const raw = readFileSync(join(DIST, name));
  const deflated = deflateRawSync(raw, { level: 9 });
  // 压不小就直接存原文（PNG 这类已经压过的，deflate 反而会涨）
  const useDeflate = deflated.length < raw.length;
  const body = useDeflate ? deflated : raw;
  const method = useDeflate ? 8 : 0;

  const nameBuf = Buffer.from(name, 'utf8');
  const mtime = statSync(join(DIST, name)).mtime;
  const crc = crc32(raw);

  const local = Buffer.alloc(30 + nameBuf.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);            // 需要的解压版本
  local.writeUInt16LE(0x0800, 6);        // flag：文件名是 UTF-8
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(dosTime(mtime), 10);
  local.writeUInt16LE(dosDate(mtime), 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);            // extra 长度
  nameBuf.copy(local, 30);

  locals.push(local, body);

  const central = Buffer.alloc(46 + nameBuf.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);          // 打包程序版本
  central.writeUInt16LE(20, 6);          // 需要的解压版本
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(dosTime(mtime), 12);
  central.writeUInt16LE(dosDate(mtime), 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);          // extra
  central.writeUInt16LE(0, 32);          // comment
  central.writeUInt16LE(0, 34);          // 所在磁盘号
  central.writeUInt16LE(0, 36);          // 内部属性
  central.writeUInt32LE(0, 38);          // 外部属性
  central.writeUInt32LE(offset, 42);     // 本地头偏移
  nameBuf.copy(central, 46);

  centrals.push(central);
  offset += local.length + body.length;
}

const centralBuf = Buffer.concat(centrals);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);                // 本磁盘号
eocd.writeUInt16LE(0, 6);                // 中央目录起始磁盘号
eocd.writeUInt16LE(names.length, 8);
eocd.writeUInt16LE(names.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(offset, 16);          // 中央目录偏移
eocd.writeUInt16LE(0, 20);               // 注释长度

const zip = Buffer.concat([...locals, centralBuf, eocd]);
writeFileSync(outName, zip);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const rawTotal = names.reduce((s, n) => s + statSync(join(DIST, n)).size, 0);
console.log(`${outName}`);
console.log(`  ${names.length} 个文件，${kb(rawTotal)} → ${kb(zip.length)}`);
names.forEach((n) => console.log(`  · ${n}`));
