'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ML = require('../src/shared/memo.js');
const TL = require('../src/shared/tasks.js');
const { writeTextAtomic } = require('../src/main/store.js');

test('备忘录 id 只允许安全字符（用作文件名）', () => {
  assert.ok(ML.isValidMemoId(TL.uid()));
  assert.ok(ML.isValidMemoId('abc_DEF-123'));
  for (const bad of ['', '../x', 'a/b', 'a\\b', 'a.b', 'a b', null, undefined, 123, 'x'.repeat(65)]) {
    assert.equal(ML.isValidMemoId(bad), false, String(bad));
  }
});

test('图片只允许内嵌的位图 data URL', () => {
  assert.ok(ML.isSafeImageSrc('data:image/png;base64,iVBORw0KGgo='));
  assert.ok(ML.isSafeImageSrc('data:image/jpeg;base64,/9j/4AAQ'));
  assert.ok(ML.isSafeImageSrc('data:image/webp;base64,UklGRg=='));
  for (const bad of [
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:text/html;base64,PHNjcmlwdD4=',
    'https://example.com/a.png',
    'file:///C:/a.png',
    'javascript:alert(1)',
    'data:image/png;base64,AA" onerror="x',
    '',
    null,
  ]) {
    assert.equal(ML.isSafeImageSrc(bad), false, String(bad));
  }
});

test('链接只允许 http / https / mailto，没写协议时补 https', () => {
  assert.equal(ML.safeLinkHref('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(ML.safeLinkHref('http://example.com'), 'http://example.com');
  assert.equal(ML.safeLinkHref(' example.com/path '), 'https://example.com/path');
  assert.equal(ML.safeLinkHref('localhost:3000'), 'https://localhost:3000');
  assert.equal(ML.safeLinkHref('mailto:a@b.com'), 'mailto:a@b.com');
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,hi', 'file:///C:/x', 'vbscript:x', 'a b', '', '   ', null]) {
    assert.equal(ML.safeLinkHref(bad), '', String(bad));
  }
});

test('项目带 hasMemo 标记，旧数据默认没有备忘录', () => {
  assert.equal(TL.createProject('x', 0).hasMemo, false);
  const s = TL.normalizeState({ projects: [{ id: 'p1', name: 'A', tasks: [] }, { id: 'p2', name: 'B', hasMemo: true, tasks: [] }] });
  assert.equal(s.projects[0].hasMemo, false);
  assert.equal(s.projects[1].hasMemo, true);
});

test('writeTextAtomic：写入、覆盖并保留 .bak', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-test-'));
  try {
    const file = path.join(dir, 'sub', 'p1.html');
    writeTextAtomic(file, '<p>一</p>', true);
    assert.equal(fs.readFileSync(file, 'utf8'), '<p>一</p>');
    writeTextAtomic(file, '<p>二</p>', true);
    assert.equal(fs.readFileSync(file, 'utf8'), '<p>二</p>');
    assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), '<p>一</p>');
    assert.equal(fs.existsSync(`${file}.tmp`), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
