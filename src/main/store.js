'use strict';
const fs = require('fs');
const path = require('path');

const BACKUP_INTERVAL_MS = 5 * 60 * 1000;

/** 读取 JSON；文件不存在返回 fallback，文件损坏则改名保留并返回 fallback */
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      try {
        fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
      } catch {
        /* ignore */
      }
    }
    return fallback;
  }
}

/** 原子写入：先写临时文件再改名，并定期保留 .bak 备份 */
function writeJsonAtomic(file, data, withBackup) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (withBackup) {
    try {
      const bak = `${file}.bak`;
      const stale = !fs.existsSync(bak) || Date.now() - fs.statSync(bak).mtimeMs > BACKUP_INTERVAL_MS;
      if (stale && fs.existsSync(file)) fs.copyFileSync(file, bak);
    } catch {
      /* 备份失败不影响保存 */
    }
  }
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

module.exports = { readJson, writeJsonAtomic };
