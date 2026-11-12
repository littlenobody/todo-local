'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { spawn } = require('child_process');
const { app, net } = require('electron');
const U = require('./update-utils');

const FIRST_CHECK_DELAY_MS = 20 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const API_TIMEOUT_MS = 20 * 1000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * 从 GitHub Release 检测新版本并自动下载安装包。
 * 状态：idle | checking | uptodate | downloading{version,percent} | ready{version} | error{message}
 * 走 electron 的 net 模块，会沿用系统代理设置。
 */
function createUpdater({ dir, onChange, onInstall, repo = U.REPO, api = 'https://api.github.com', web = U.WEB }) {
  const current = app.getVersion();
  const headers = { 'User-Agent': `todo-local/${current}` };
  let status = { state: 'idle', current };
  let readyFile = '';
  let running = null;
  let lastPercent = -1;

  function set(patch) {
    status = { current, ...patch };
    onChange(status);
  }

  async function getLatest() {
    const res = await net.fetch(`${api}/repos/${repo}/releases/latest`, {
      headers: { ...headers, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (res.status === 404) return null; // 还没有发布过 release
    if (!res.ok) throw new Error(`GitHub 返回 ${res.status}`);
    return res.json();
  }

  function sha256File(file) {
    return new Promise((resolve, reject) => {
      const h = crypto.createHash('sha256');
      fs.createReadStream(file)
        .on('data', (c) => h.update(c))
        .on('error', reject)
        .on('end', () => resolve(h.digest('hex')));
    });
  }

  /** 清掉更新目录里除 keep 之外的文件（旧安装包、中断的 .part） */
  function cleanDir(keep) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      if (n === keep) continue;
      try {
        fs.rmSync(path.join(dir, n), { force: true, recursive: true });
      } catch {
        /* 清理失败不影响更新 */
      }
    }
  }

  /** 已有文件是否完整：大小一致，且（有摘要时）sha256 一致 */
  async function isIntact(file, asset) {
    try {
      if (typeof asset.size === 'number' && fs.statSync(file).size !== asset.size) return false;
      const want = U.parseDigest(asset.digest);
      return want ? (await sha256File(file)) === want : true;
    } catch {
      return false;
    }
  }

  async function download(asset, dest, version) {
    const part = `${dest}.part`;
    fs.mkdirSync(dir, { recursive: true });
    const res = await net.fetch(asset.browser_download_url, { headers, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok || !res.body) throw new Error(`下载失败（${res.status}）`);
    const total = asset.size || Number(res.headers.get('content-length')) || 0;
    const hash = crypto.createHash('sha256');
    let got = 0;
    lastPercent = -1;
    const meter = new Transform({
      transform(chunk, _enc, cb) {
        hash.update(chunk);
        got += chunk.length;
        if (total) {
          const percent = Math.min(99, Math.floor((got / total) * 100));
          if (percent !== lastPercent) {
            lastPercent = percent;
            set({ state: 'downloading', version, percent });
          }
        }
        cb(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body), meter, fs.createWriteStream(part));
      if (typeof asset.size === 'number' && got !== asset.size) throw new Error('下载不完整');
      const want = U.parseDigest(asset.digest);
      if (want && hash.digest('hex') !== want) throw new Error('安装包校验失败');
      fs.renameSync(part, dest);
    } catch (err) {
      fs.rmSync(part, { force: true });
      throw err;
    }
  }

  async function runCheck() {
    if (status.state !== 'ready') set({ state: 'checking' }); // 已下载好时保持界面稳定
    try {
      const release = await getLatest();
      const tag = release && release.tag_name;
      if (!release || !U.isNewer(tag, current)) {
        cleanDir(null); // 已是最新（含刚装完更新）：删掉残留安装包
        readyFile = '';
        set({ state: 'uptodate' });
        return;
      }
      const version = String(tag).replace(/^v/i, '');
      const asset = U.pickInstallerAsset(release.assets, repo, web);
      if (!asset) throw new Error(`v${version} 没有附带安装包`);

      const dest = path.join(dir, asset.name);
      cleanDir(asset.name);
      if (!(fs.existsSync(dest) && (await isIntact(dest, asset)))) {
        set({ state: 'downloading', version, percent: 0 });
        await download(asset, dest, version);
      }
      readyFile = dest;
      set({ state: 'ready', version });
    } catch (err) {
      const message = err && err.name === 'TimeoutError' ? '连接超时' : (err && err.message) || String(err);
      if (status.state === 'ready' && readyFile) return; // 已有可安装的包，后台失败不打扰
      set({ state: 'error', message });
    }
  }

  /** 同一时间只跑一次检查 */
  function check() {
    if (!running) running = runCheck().finally(() => (running = null));
    return running;
  }

  /** 启动安装程序并退出本程序；安装包不存在或无法启动时返回 false / 置为错误状态 */
  function install() {
    if (status.state !== 'ready' || !readyFile || !fs.existsSync(readyFile)) return false;
    const child = spawn(readyFile, [], { detached: true, stdio: 'ignore' });
    child.once('error', (err) => set({ state: 'error', message: `无法启动安装程序：${err.message}` }));
    child.once('spawn', () => {
      child.unref();
      onInstall();
    });
    return true;
  }

  /** 打包后的程序：启动后稍等片刻检查一次，之后每 6 小时一次（开发模式不自动下载） */
  function start() {
    if (!app.isPackaged) return;
    const first = setTimeout(check, FIRST_CHECK_DELAY_MS);
    const loop = setInterval(check, CHECK_INTERVAL_MS);
    first.unref();
    loop.unref();
  }

  return { start, check, install, status: () => status };
}

module.exports = { createUpdater };
