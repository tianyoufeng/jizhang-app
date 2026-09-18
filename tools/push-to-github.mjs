/**
 * 通过 GitHub 的 REST 接口推送本地提交。
 *
 * 为什么需要这个：这台机器上 github.com 被墙，`git push` 直接连不上，
 * 但 api.github.com 是通的。所以改走 Git Data 接口，把本地提交逐个复刻上去。
 *
 * 复刻（而不是传一个打包好的快照）是刻意的：blob/tree/commit 的哈希都是
 * 按内容算的，只要内容、作者、时间和父子关系一致，远程算出来的哈希就和本地
 * 完全相同。这样本地和远程不会分叉，以后网络通了直接 `git push` 也是同步的。
 *
 * 浅克隆（git clone --depth）要特别小心：
 *   本地最早那个提交（`git rev-list HEAD` 的最后一个）可能带着一个父提交，
 *   但父对象本地没有拉下来。这个父提交在远程是真实存在的，必须原样接回去；
 *   一旦当成「空父提交」丢掉，复刻出来的就是一个没有父提交的根提交，
 *   原来那一段历史会和分支脱开，哈希也永远对不上。见下面 resolveParents。
 *
 * 用法：
 *   node tools/push-to-github.mjs                 推到 origin 指向的仓库
 *   node tools/push-to-github.mjs owner/repo      推到指定仓库
 *
 * 前提：gh 已登录（脚本直接问 gh 要 token）。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BRANCH = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();

function guessRepo() {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const m = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!m) throw new Error('从 origin 地址里看不出仓库名，请手动指定 owner/repo');
  return `${m[1]}/${m[2]}`;
}

const REPO = process.argv[2] || guessRepo();
const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();

/* ---------------- 0. 证书自愈 ---------------- */
/**
 * 有些机器（公司电脑、装了抓包/加速代理的机器）会替换 TLS 证书。这种代理的根证书
 * 装在 Windows 的证书库里，而 Node 默认只认自己内置的那份，于是 api.github.com 会报
 * UNABLE_TO_VERIFY_LEAF_SIGNATURE —— 明明 `gh` 能用，脚本却连不上。
 *
 * Node 22.15+ 的 --use-system-ca 可以改用系统证书库。这里先探一下，需要就带着这个
 * 参数把自己重跑一遍，省得每次都要记住加参数。
 */
async function tlsProbe() {
  try {
    await fetch('https://api.github.com/rate_limit', { method: 'GET' });
    return { ok: true };
  } catch (e) {
    const code = String(e?.cause?.code || e?.code || e?.message || '');
    return { ok: false, code, tlsLike: /CERT|UNABLE_TO_VERIFY|SELF_SIGNED|SSL|TLS/i.test(code) };
  }
}

const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
const supportsSystemCa = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 15);

if (supportsSystemCa && !process.execArgv.includes('--use-system-ca')) {
  const probe = await tlsProbe();
  if (!probe.ok && probe.tlsLike) {
    console.log(`检测到本机 TLS 证书链问题（${probe.code}），改用系统证书库重试…\n`);
    const child = spawnSync(process.execPath, ['--use-system-ca', ...process.argv.slice(1)], {
      stdio: 'inherit'
    });
    process.exit(child.status ?? 1);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 退避间隔：指数增长 + 随机抖动，免得几个并发请求同时重试、又一起撞墙 */
const backoff = (n) => Math.min(500 * 2 ** n, 8000) + Math.floor(Math.random() * 400);

/**
 * 调 GitHub API。
 *
 * 5xx 和连接层错误**一律重试**：这个接口偶发 502
 * （`An error occurred while sending the request`），而且是在传了几十个 blob 之后突然来一下 ——
 * 没有重试的话整个流程白跑。4xx 不重试，那是请求本身有问题，重试多少次都一样。
 */
async function api(path, body, method = 'POST', attempts = 6) {
  const payload = body ? JSON.stringify(body) : undefined;
  for (let n = 0; ; n += 1) {
    let res = null;
    let text = '';
    try {
      res = await fetch(`https://api.github.com${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'push-to-github-script'
        },
        body: payload
      });
      text = await res.text();
    } catch (err) {
      // 连接被重置 / 超时，连响应都没拿到
      if (n + 1 >= attempts) throw err;
      const wait = backoff(n);
      console.log(`  ⚠ ${method} ${path} 连接出错（${err.message}），${wait}ms 后重试（${n + 1}/${attempts - 1}）`);
      await sleep(wait);
      continue;
    }
    if (res.ok) return text ? JSON.parse(text) : null;
    if (res.status >= 500 && n + 1 < attempts) {
      const wait = backoff(n);
      console.log(`  ⚠ ${method} ${path} → ${res.status}，${wait}ms 后重试（${n + 1}/${attempts - 1}）`);
      await sleep(wait);
      continue;
    }
    throw new Error(`${method} ${path} → ${res.status}\n${text}`);
  }
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const gitBuf = (...args) => execFileSync('git', args, { maxBuffer: 256 * 1024 * 1024 });

/**
 * 取出提交的原始消息（连结尾换行一起）。
 * 不能图省事用 `git log --format=%B`，那个会被 trim 掉结尾的换行，
 * 而换行也是提交对象的一部分 —— 少这一个字节，算出来的哈希就和本地对不上，
 * 本地和远程就分叉了。
 */
function rawMessage(sha) {
  const raw = gitBuf('cat-file', 'commit', sha).toString('utf8');
  const i = raw.indexOf('\n\n');
  if (i < 0) throw new Error(`提交 ${sha} 格式不对，找不到消息部分`);
  return raw.slice(i + 2);
}

/**
 * 取提交的父提交列表。
 *
 * 同样不能图省事用 `git log --format=%P`：浅克隆的边界提交在 git 眼里「没有父提交」
 * （它的父对象没被拉下来），`%P` 会返回空 —— 但它对象里其实写着 `parent ...`。
 * 照 `%P` 的结果去复刻，就会凭空造出一个没有父提交的根提交，历史直接断掉。
 * 所以必须从原始对象里逐行读。
 */
function rawParents(sha) {
  return gitBuf('cat-file', 'commit', sha)
    .toString('utf8')
    .split('\n')
    .filter((line) => line.startsWith('parent '))
    .map((line) => line.slice('parent '.length).trim());
}

/**
 * GitHub 不允许在一个没有任何提交的仓库上创建 blob，
 * 所以空仓库要先塞一个占位提交把它「激活」。
 * 这个占位提交最后会被强制覆盖掉，不影响最终历史。
 */
async function ensureRepoHasCommit() {
  try {
    await api(`/repos/${REPO}/git/refs/heads/${BRANCH}`, null, 'GET');
    return;
  } catch {
    /* 空仓库，继续往下走 */
  }
  await api(
    `/repos/${REPO}/contents/.gitkeep`,
    { message: '临时占位，稍后会被覆盖', content: Buffer.from('\n').toString('base64') },
    'PUT'
  );
  console.log('（仓库本来是空的，先建了个占位提交，最后会被覆盖掉）\n');
}

/** 解析 `git ls-tree -r -z` 的输出 */
function listTree(sha) {
  return gitBuf('ls-tree', '-r', '-z', sha)
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split('\t');
      const [mode, type, blobSha] = meta.split(/\s+/);
      return { mode, type, sha: blobSha, path };
    })
    .filter((e) => e.type === 'blob');
}

/* ---------------- 1. 本地提交列表（从旧到新） ---------------- */
const commits = git('rev-list', '--reverse', 'HEAD').split('\n').filter(Boolean);
if (!commits.length) throw new Error('本地还没有任何提交');

console.log(`仓库：${REPO}`);
console.log(`分支：${BRANCH}`);
console.log(`提交：${commits.length} 个（从旧到新）`);

// 浅克隆时，本地只有最近若干个提交。窗口之外的父提交本地没有对象，
// 但远程有 —— resolveParents 会把它们原样接回去，这里只是提醒一句。
if (existsSync('.git/shallow')) {
  console.log('（浅克隆：只复刻本地已有的这几个提交，更早的历史原样接在远程上）');
}

await ensureRepoHasCommit();

/* ---------------- 2. 上传所有文件内容（同内容只传一次） ---------------- */
const needed = new Map(); // blob sha -> 该 blob 出现的路径（仅用于日志）
for (const c of commits) {
  for (const e of listTree(c)) if (!needed.has(e.sha)) needed.set(e.sha, e.path);
}

console.log(`文件：${needed.size} 个不同的内容\n`);

const blobRemote = new Map();
let uploaded = 0;
const lanes = 4;

// 超过这个体积的内容单独一个个传：并发上传几 MB 的 blob 时，
// api.github.com 的网关更容易回 502 —— 安装包和启动图都在这个量级。
const BIG = 1_000_000;

const uploadOne = async (sha) => {
  const buf = gitBuf('cat-file', 'blob', sha);
  const res = await api(`/repos/${REPO}/git/blobs`, { content: buf.toString('base64'), encoding: 'base64' });
  blobRemote.set(sha, res.sha);
  uploaded += 1;
  if (uploaded % 20 === 0 || uploaded === pending.length) process.stdout.write(`  已上传 ${uploaded}/${pending.length}\n`);
};

const shaList = [...needed.keys()];
const sizeOf = new Map(shaList.map((s) => [s, Number(gitBuf('cat-file', '-s', s).toString().trim())]));

/**
 * 远程是不是已经有这个内容了。
 *
 * blob 按内容寻址，哈希一样内容就一样 —— 所以远程有这个 sha，直接沿用即可，
 * 不用再传一遍。加这一步是因为以前每推一次都会把**全部** blob 重传一遍
 * （这次 216 个、约 19 MB，光四个旧安装包就 16 MB），既慢又容易被网关的偶发
 * 5xx / 连接重置打断：一次失败就要从头再来四分钟。查一次是几十字节的 GET，
 * 比重传一个 3.8 MB 的安装包便宜太多。
 *
 * 404 就是「没有」，正常情况，不算错误，也不能走 api()（那里 4xx 会直接抛）。
 */
async function blobExists(sha, attempts = 4) {
  for (let n = 0; ; n += 1) {
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/git/blobs/${sha}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'push-to-github-script'
        }
      });
      if (res.status === 200) return true;
      if (res.status === 404) return false;
      if (res.status >= 500 && n + 1 < attempts) {
        await sleep(backoff(n));
        continue;
      }
      throw new Error(`GET git/blobs/${sha.slice(0, 8)} → ${res.status}`);
    } catch (err) {
      if (String(err.message).startsWith('GET git/blobs/')) throw err;
      if (n + 1 >= attempts) throw err;
      await sleep(backoff(n));
    }
  }
}

const pending = [];
let reused = 0;
for (let i = 0; i < shaList.length; i += 8) {
  const batch = shaList.slice(i, i + 8);
  const flags = await Promise.all(batch.map((s) => blobExists(s)));
  batch.forEach((s, k) => {
    if (flags[k]) {
      blobRemote.set(s, s); // 内容一样，远程那份的 sha 就是它自己
      reused += 1;
    } else {
      pending.push(s);
    }
  });
  process.stdout.write(`\r  检查远程已有内容 ${Math.min(i + 8, shaList.length)}/${shaList.length}`);
}
process.stdout.write('\n');
console.log(`远程已有 ${reused} 个，本次只需上传 ${pending.length} 个\n`);

const bigFiles = pending.filter((s) => sizeOf.get(s) > BIG);
const smallFiles = pending.filter((s) => sizeOf.get(s) <= BIG);

if (bigFiles.length) {
  console.log(`大文件 ${bigFiles.length} 个（>1MB），改成逐个上传：`);
  for (const sha of bigFiles) {
    console.log(`  → ${needed.get(sha)}  ${Math.round(sizeOf.get(sha) / 1024)} KB`);
  }
}
for (const sha of bigFiles) await uploadOne(sha);
for (let i = 0; i < smallFiles.length; i += lanes) {
  await Promise.all(smallFiles.slice(i, i + lanes).map(uploadOne));
}

/* ---------------- 3. 逐个复刻提交 ---------------- */
console.log('\n复刻提交…');
const remoteOf = new Map(); // 本地 commit sha -> 远程 commit sha
const shaDrift = []; // 只有提交哈希对不上（内容一致但历史分叉，要提醒）

/**
 * 把本地的父提交列表翻译成远程的父提交列表。
 *
 * 大多数父提交就在本次推送的窗口里，直接从 remoteOf 里取。
 * 但浅克隆时，窗口里最早那个提交的父提交属于「本地没有、远程有」的情况，
 * 必须原样沿用它的哈希 —— 丢掉它就会凭空多出一个根提交，历史直接断掉。
 */
async function resolveParents(parents) {
  const out = [];
  for (const p of parents) {
    const mapped = remoteOf.get(p);
    if (mapped) {
      out.push(mapped);
      continue;
    }
    try {
      await api(`/repos/${REPO}/git/commits/${p}`, null, 'GET');
    } catch {
      throw new Error(
        `父提交 ${p.slice(0, 7)} 本地没有（浅克隆），远程也查不到，推上去会断掉历史。\n` +
          `先补全本地历史再推：git fetch --unshallow`
      );
    }
    out.push(p);
  }
  return out;
}

for (const c of commits) {
  const localTree = git('log', '-1', '--format=%T', c);
  const entries = listTree(c).map((e) => ({
    path: e.path,
    mode: e.mode,
    type: 'blob',
    sha: blobRemote.get(e.sha)
  }));

  const tree = await api(`/repos/${REPO}/git/trees`, { tree: entries });
  if (tree.sha !== localTree) {
    // 内容都对不上就别动分支了，免得把远程改成半吊子状态
    throw new Error(
      `提交 ${c.slice(0, 7)} 的 tree 哈希不一致：本地 ${localTree.slice(0, 7)}，远程 ${tree.sha.slice(0, 7)}\n` +
        `文件内容没有完整复刻，已中止 —— 分支指针没有被改动。`
    );
  }

  // 作者、提交者、时间都照抄本地，哈希才对得上
  const [an, ae, ad, cn, ce, cd] = git(
    'log', '-1', '--format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI', c
  ).split('\0');

  const parents = rawParents(c);
  const remoteParents = await resolveParents(parents);

  const created = await api(`/repos/${REPO}/git/commits`, {
    message: rawMessage(c),
    tree: tree.sha,
    parents: remoteParents,
    author: { name: an, email: ae, date: ad },
    committer: { name: cn, email: ce, date: cd }
  });

  remoteOf.set(c, created.sha);
  if (created.sha !== c) shaDrift.push(`提交哈希不一致：本地 ${c.slice(0, 7)}，远程 ${created.sha.slice(0, 7)}`);
  console.log(`  ${c.slice(0, 7)} → ${created.sha.slice(0, 7)}  ${git('log', '-1', '--format=%s', c)}`);
}

/* ---------------- 4. 更新分支指针 ---------------- */
const head = remoteOf.get(commits[commits.length - 1]);
console.log('\n更新分支…');
try {
  await api(`/repos/${REPO}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: head });
} catch {
  await api(`/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: head, force: true }, 'PATCH');
}

/**
 * 直接写一个「松散引用」文件（.git/refs/... 下的普通文件）。
 *
 * 这台机器上 `git update-ref` 会出现「退出码 0、但引用根本没变」的情况：
 * 引用只存在于 .git/packed-refs，松散文件没被建出来，回读还是旧值。
 * 所以对不上时用这个兜底 —— 松散引用本来就是这么存的。
 */
function writeLooseRef(ref, sha) {
  const file = path.join('.git', ...ref.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, sha + '\n');
}

/* 顺手把本地的 origin 记录也对齐，这样 git status 不会显示「分叉」 */
try {
  const ref = `refs/remotes/origin/${BRANCH}`;
  execFileSync('git', ['update-ref', ref, head]);
  const now = execFileSync('git', ['rev-parse', ref], { encoding: 'utf8' }).trim();
  if (now !== head) {
    writeLooseRef(ref, head);
    console.log('（git update-ref 没真正生效，已直接写松散引用文件兜底）');
  }
  console.log(`本地 origin/${BRANCH} 已指向 ${head.slice(0, 7)}`);
} catch (e) {
  console.log(`（本地 origin/${BRANCH} 没对齐成功：${e.message.split('\n')[0]}）`);
}

console.log(`\n推送完成：https://github.com/${REPO}/tree/${BRANCH}`);
if (shaDrift.length) {
  console.log('\n注意：文件内容一致，但有提交的哈希对不上，本地和远程仍然是分叉的：');
  shaDrift.forEach((m) => console.log('  - ' + m));
  console.log('  内容没问题，只是历史线的形状不一样，以后网络通了直接 git push 会冲突。');
  process.exitCode = 1;
} else {
  console.log('远程和本地的提交哈希完全一致，两边是同步的。');
}
