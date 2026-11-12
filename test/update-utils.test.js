'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../src/main/update-utils.js');

const url = (name) => `https://github.com/${U.REPO}/releases/download/v1.0.1/${name}`;
const asset = (name, extra) => ({ name, state: 'uploaded', browser_download_url: url(name), ...extra });

test('版本解析与比较', () => {
  assert.deepEqual(U.parseVersion('v1.2.3'), [1, 2, 3]);
  assert.deepEqual(U.parseVersion('1.2.3-beta.1'), [1, 2, 3]);
  assert.equal(U.parseVersion('abc'), null);
  assert.equal(U.parseVersion(null), null);
  assert.equal(U.isNewer('v1.0.1', '1.0.0'), true);
  assert.equal(U.isNewer('1.10.0', '1.9.9'), true); // 按数字而不是字符串比较
  assert.equal(U.isNewer('2.0.0', '1.99.99'), true);
  assert.equal(U.isNewer('1.0.0', '1.0.0'), false);
  assert.equal(U.isNewer('0.9.9', '1.0.0'), false);
  assert.equal(U.isNewer('nightly', '1.0.0'), false); // 无法解析不触发更新
});

test('只信任本仓库的 release 下载地址', () => {
  assert.equal(U.isTrustedDownloadUrl(url('todo-local-setup-1.0.1.exe')), true);
  assert.equal(U.isTrustedDownloadUrl('http://github.com/' + U.REPO + '/releases/download/v1/a.exe'), false);
  assert.equal(U.isTrustedDownloadUrl('https://evil.example/' + U.REPO + '/releases/download/v1/a.exe'), false);
  assert.equal(U.isTrustedDownloadUrl('https://github.com/other/repo/releases/download/v1/a.exe'), false);
  assert.equal(U.isTrustedDownloadUrl(`https://github.com/${U.REPO}/releases/download/../../x.exe`), false);
  assert.equal(U.isTrustedDownloadUrl('not a url'), false);
});

test('挑选安装包：按命名、状态、地址过滤', () => {
  const good = asset('todo-local-setup-1.0.1.exe');
  const picked = U.pickInstallerAsset([asset('todo-local-setup-1.0.1.exe.blockmap'), asset('notes.txt'), good]);
  assert.equal(picked, good);
  assert.equal(U.pickInstallerAsset([asset('todo-local-setup-1.0.1.exe', { state: 'starter' })]), null);
  assert.equal(U.pickInstallerAsset([asset('todo-local-setup-1.0.1.exe', { browser_download_url: 'https://evil.example/a.exe' })]), null);
  assert.equal(U.pickInstallerAsset([]), null);
  assert.equal(U.pickInstallerAsset(undefined), null);
});

test('资源名与摘要格式', () => {
  assert.equal(U.installerAssetName('1.2.3'), 'todo-local-setup-1.2.3.exe');
  assert.ok(U.pickInstallerAsset([asset(U.installerAssetName('1.2.3'))]));
  const hex = 'a'.repeat(64);
  assert.equal(U.parseDigest(`sha256:${hex.toUpperCase()}`), hex);
  assert.equal(U.parseDigest('sha1:abc'), null);
  assert.equal(U.parseDigest(undefined), null);
});
