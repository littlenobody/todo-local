'use strict';
/*
 * 把 dist 里的安装包发布到 GitHub Release（tag 为 v<package.json 版本>）。
 *   node build/publish-release.js            # 发布；release 已存在则只补传缺失的安装包
 *   node build/publish-release.js --dry-run  # 只检查，不发请求
 *   node build/publish-release.js --notes-file RELEASE_NOTES.md  # 用文件内容作为更新说明（新建 release 时生效）
 * 令牌：优先读环境变量 GITHUB_TOKEN，否则取 git 已保存的 github.com 凭据（与 git push 相同）。
 * 资源名固定为英文（见 src/main/update-utils.js），GitHub 会丢掉中文文件名。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { REPO, installerAssetName } = require('../src/main/update-utils');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const version = pkg.version;
const tag = `v${version}`;
const dryRun = process.argv.includes('--dry-run');
const notesIdx = process.argv.indexOf('--notes-file');
const notesFile = notesIdx > -1 ? process.argv[notesIdx + 1] : null;

function findInstaller() {
  const dist = path.join(root, 'dist');
  const hit = fs.existsSync(dist) && fs.readdirSync(dist).find((n) => n.endsWith(`-${version}.exe`));
  if (!hit) throw new Error(`dist 里没有 ${version} 版安装包，请先运行 npm run dist`);
  return path.join(dist, hit);
}

function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const r = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  const m = /^password=(.+)$/m.exec(r.stdout || '');
  if (!m) throw new Error('没有找到 GitHub 令牌：请设置环境变量 GITHUB_TOKEN（需要 contents:write 权限）');
  return m[1].trim();
}

async function gh(token, url, init) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'todo-local-publish',
      ...(init && init.headers),
    },
  });
  return res;
}

async function main() {
  const file = findInstaller();
  const size = fs.statSync(file).size;
  const assetName = installerAssetName(version);
  console.log(`安装包：${path.basename(file)}（${(size / 1048576).toFixed(1)} MB）→ ${assetName}`);
  console.log(`仓库：${REPO}，标签：${tag}`);
  if (dryRun) return;

  const token = getToken();
  const api = `https://api.github.com/repos/${REPO}`;

  const notes = notesFile ? fs.readFileSync(path.resolve(notesFile), 'utf8').trim() : '';
  if (notesFile && !notes) throw new Error(`更新说明文件为空：${notesFile}`);

  let res = await gh(token, `${api}/releases/tags/${tag}`);
  let release;
  if (res.status === 404) {
    res = await gh(token, `${api}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        name: `${pkg.build.productName} ${tag}`,
        ...(notes ? { body: notes } : { generate_release_notes: true }),
      }),
    });
    if (!res.ok) throw new Error(`创建 release 失败：${res.status} ${await res.text()}`);
    release = await res.json();
    console.log(`已创建 release：${release.html_url}`);
  } else if (res.ok) {
    release = await res.json();
    console.log(`release 已存在：${release.html_url}`);
  } else {
    throw new Error(`查询 release 失败：${res.status} ${await res.text()}`);
  }

  if ((release.assets || []).some((a) => a.name === assetName && a.state === 'uploaded')) {
    console.log('安装包已在 release 中，跳过上传');
    return;
  }

  const uploadUrl = release.upload_url.replace(/\{.*$/, '') + `?name=${encodeURIComponent(assetName)}`;
  const body = fs.createReadStream(file);
  res = await gh(token, uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) },
    body,
    duplex: 'half',
  });
  if (!res.ok) throw new Error(`上传失败：${res.status} ${await res.text()}`);
  const asset = await res.json();
  console.log(`上传完成：${asset.browser_download_url}`);
}

main().catch((err) => {
  console.error('发布失败：', err.message);
  process.exit(1);
});
