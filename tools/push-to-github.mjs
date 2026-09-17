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
 * 用法：
 *   node tools/push-to-github.mjs                 推到 origin 指向的仓库
 *   node tools/push-to-github.mjs owner/repo      推到指定仓库
 *
 * 前提：gh 已登录（脚本直接问 gh 要 token）。
 */
import { execFileSync } from 'node:child_process';

const BRANCH = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();

function guessRepo() {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const m = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!m) throw new Error('从 origin 地址里看不出仓库名，请手动指定 owner/repo');
  return `${m[1]}/${m[2]}`;
}

const REPO = process.argv[2] || guessRepo();
const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();

async function api(path, body, method = 'POST') {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'push-to-github-script'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}\n${text}`);
  return text ? JSON.parse(text) : null;
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const gitBuf = (...args) => execFileSync('git', args, { maxBuffer: 256 * 1024 * 1024 });

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

/* ---------------- 2. 上传所有文件内容（同内容只传一次） ---------------- */
const needed = new Map(); // blob sha -> 该 blob 出现的路径（仅用于日志）
for (const c of commits) {
  for (const e of listTree(c)) if (!needed.has(e.sha)) needed.set(e.sha, e.path);
}

console.log(`文件：${needed.size} 个不同的内容\n`);

const blobRemote = new Map();
let uploaded = 0;
const lanes = 6;

const uploadOne = async (sha) => {
  const buf = gitBuf('cat-file', 'blob', sha);
  const res = await api(`/repos/${REPO}/git/blobs`, { content: buf.toString('base64'), encoding: 'base64' });
  blobRemote.set(sha, res.sha);
  uploaded += 1;
  if (uploaded % 20 === 0 || uploaded === needed.size) process.stdout.write(`  已上传 ${uploaded}/${needed.size}\n`);
};

const shaList = [...needed.keys()];
for (let i = 0; i < shaList.length; i += lanes) {
  await Promise.all(shaList.slice(i, i + lanes).map(uploadOne));
}

/* ---------------- 3. 逐个复刻提交 ---------------- */
console.log('\n复刻提交…');
const remoteOf = new Map(); // 本地 commit sha -> 远程 commit sha
const mismatches = [];

for (const c of commits) {
  const localTree = git('log', '-1', '--format=%T', c);
  const entries = listTree(c).map((e) => ({
    path: e.path,
    mode: e.mode,
    type: 'blob',
    sha: blobRemote.get(e.sha)
  }));

  const tree = await api(`/repos/${REPO}/git/trees`, { tree: entries });
  if (tree.sha !== localTree) mismatches.push(`tree 哈希不一致：本地 ${localTree.slice(0, 7)}，远程 ${tree.sha.slice(0, 7)}`);

  // 作者、提交者、时间都照抄本地，哈希才对得上
  const [an, ae, ad, cn, ce, cd] = git(
    'log', '-1', '--format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI', c
  ).split('\0');

  const parents = git('log', '-1', '--format=%P', c).split(' ').filter(Boolean);
  const remoteParents = parents.map((p) => remoteOf.get(p));

  const created = await api(`/repos/${REPO}/git/commits`, {
    message: git('log', '-1', '--format=%B', c),
    tree: tree.sha,
    parents: remoteParents,
    author: { name: an, email: ae, date: ad },
    committer: { name: cn, email: ce, date: cd }
  });

  remoteOf.set(c, created.sha);
  if (created.sha !== c) mismatches.push(`提交哈希不一致：本地 ${c.slice(0, 7)}，远程 ${created.sha.slice(0, 7)}`);
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

/* 顺手把本地的 origin 记录也对齐，这样 git status 不会显示「分叉」 */
try {
  execFileSync('git', ['update-ref', `refs/remotes/origin/${BRANCH}`, head]);
} catch {
  /* 失败也不影响推送结果 */
}

console.log(`\n推送完成：https://github.com/${REPO}/tree/${BRANCH}`);
if (mismatches.length) {
  console.log('\n注意：有几处哈希对不上，本地和远程可能分叉：');
  mismatches.forEach((m) => console.log('  - ' + m));
  process.exitCode = 1;
} else {
  console.log('远程和本地的提交哈希完全一致，两边是同步的。');
}
