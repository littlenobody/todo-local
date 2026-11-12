'use strict';
/* 自动更新用到的纯函数（不依赖 electron，便于单测；发布脚本也复用同一套命名规则） */

const REPO = 'littlenobody/todo-local';
const WEB = 'https://github.com';

/** release 里安装包的资源名。GitHub 会剥掉非 ASCII 字符，所以资源名固定用英文 */
function installerAssetName(version) {
  return `todo-local-setup-${version}.exe`;
}

const ASSET_RE = /^todo-local-setup-[0-9A-Za-z.+-]+\.exe$/;

/** "v1.2.3" / "1.2.3-beta.1" → [1,2,3]；无法解析返回 null */
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(v == null ? '' : v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  }
  return 0;
}

/** remote 是否比 current 新；任一方无法解析时按“不更新”处理 */
const isNewer = (remote, current) => compareVersions(remote, current) > 0;

/** 只信任本仓库 release 下载地址，避免被响应内容引到别处 */
function isTrustedDownloadUrl(url, repo = REPO, web = WEB) {
  try {
    const u = new URL(url);
    const base = new URL(web);
    return u.origin === base.origin && u.pathname.startsWith(`/${repo}/releases/download/`) && !u.pathname.includes('..');
  } catch {
    return false;
  }
}

/** 从 release.assets 里挑安装包；没有符合命名、状态或地址的返回 null */
function pickInstallerAsset(assets, repo = REPO, web = WEB) {
  if (!Array.isArray(assets)) return null;
  return (
    assets.find(
      (a) =>
        a &&
        ASSET_RE.test(String(a.name)) &&
        (a.state === undefined || a.state === 'uploaded') &&
        isTrustedDownloadUrl(a.browser_download_url, repo, web)
    ) || null
  );
}

/** "sha256:abcd…" → 小写十六进制；格式不对返回 null */
function parseDigest(d) {
  const m = /^sha256:([0-9a-f]{64})$/i.exec(String(d || ''));
  return m ? m[1].toLowerCase() : null;
}

module.exports = {
  REPO,
  WEB,
  installerAssetName,
  parseVersion,
  compareVersions,
  isNewer,
  isTrustedDownloadUrl,
  pickInstallerAsset,
  parseDigest,
};
