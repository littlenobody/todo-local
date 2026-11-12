'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const TL = require('../src/shared/tasks.js');

const mk = (title, extra) => TL.createTask(title, extra);

test('完成任务：移到当前层级最后，并联动子孙', () => {
  const a = mk('a');
  const b = mk('b', { children: [mk('b1'), mk('b2')] });
  const c = mk('c');
  const tasks = [a, b, c];
  TL.setDone(tasks, a.id, true, { moveToBottom: true });
  assert.deepEqual(tasks.map((t) => t.title), ['b', 'c', 'a']);
  TL.setDone(tasks, b.id, true, { moveToBottom: true });
  assert.deepEqual(tasks.map((t) => t.title), ['c', 'a', 'b']);
  assert.ok(b.children.every((x) => x.done && x.doneAt));
});

test('子任务完成只在其所在层级置底', () => {
  const b1 = mk('b1');
  const b2 = mk('b2');
  const b = mk('b', { children: [b1, b2] });
  const tasks = [b, mk('c')];
  TL.setDone(tasks, b1.id, true, { moveToBottom: true });
  assert.deepEqual(b.children.map((t) => t.title), ['b2', 'b1']);
  assert.deepEqual(tasks.map((t) => t.title), ['b', 'c']);
});

test('moveToBottom=false 时不移动', () => {
  const a = mk('a');
  const tasks = [a, mk('b')];
  TL.setDone(tasks, a.id, true, { moveToBottom: false });
  assert.deepEqual(tasks.map((t) => t.title), ['a', 'b']);
});

test('取消完成：回到未完成区末尾，祖先同步取消', () => {
  const x = mk('x');
  const y = mk('y');
  const z = mk('z');
  const p = mk('p', { children: [x, y, z] });
  const root = [p, mk('q')];
  TL.setDone(root, p.id, true, { moveToBottom: true });
  assert.ok(p.done && x.done);
  TL.setDone(root, y.id, false, { moveToBottom: true });
  assert.equal(y.done, false);
  assert.equal(p.done, false);
  assert.deepEqual(root.map((t) => t.title), ['q', 'p']);
});

test('insertTask：保持已完成在底部', () => {
  const d = mk('d', { done: true });
  const list = [mk('a'), d];
  TL.insertTask(list, mk('n'), true);
  assert.deepEqual(list.map((t) => t.title), ['a', 'n', 'd']);
  TL.insertTask(list, mk('m'), false);
  assert.equal(list[list.length - 1].title, 'm');
});

test('多级嵌套查找与删除', () => {
  const leaf = mk('leaf');
  const tasks = [mk('a', { children: [mk('b', { children: [leaf] })] })];
  const path = TL.findPath(tasks, leaf.id);
  assert.equal(path.length, 3);
  assert.equal(TL.removeTask(tasks, leaf.id).id, leaf.id);
  assert.equal(TL.findPath(tasks, leaf.id), null);
});

test('标签：规范化、去重、拆分', () => {
  assert.equal(TL.normalizeTag('  #工作  '), '工作');
  assert.deepEqual(TL.uniqueTags(['A', 'a', '#b', ' ']), ['A', 'b']);
  assert.deepEqual(TL.splitTagInput('x, y，z、x\nw'), ['x', 'y', 'z', 'w']);
});

test('标签过滤：与 / 或 / 排除组合', () => {
  const t1 = mk('1', { tags: ['工作', '紧急'] });
  const t2 = mk('2', { tags: ['工作'] });
  const t3 = mk('3', { tags: ['生活'] });
  const run = (f) => [t1, t2, t3].filter(TL.makeTagPredicate(f)).map((t) => t.title);
  assert.deepEqual(run({ include: ['工作', '紧急'], exclude: [], mode: 'and' }), ['1']);
  assert.deepEqual(run({ include: ['紧急', '生活'], exclude: [], mode: 'or' }), ['1', '3']);
  assert.deepEqual(run({ include: ['工作'], exclude: ['紧急'], mode: 'and' }), ['2']);
  assert.deepEqual(run({ include: [], exclude: ['工作'], mode: 'and' }), ['3']);
  assert.equal(TL.makeTagPredicate({ include: [], exclude: [] }), null);
});

test('filterTree：保留命中项的祖先链', () => {
  const hit = mk('买牛奶');
  const tasks = [mk('生活', { children: [hit, mk('其他')] }), mk('无关')];
  const tree = TL.filterTree(tasks, TL.makeSearchPredicate('牛奶'));
  assert.equal(tree.length, 1);
  assert.equal(tree[0].match, false);
  assert.equal(tree[0].children.length, 1);
  assert.equal(tree[0].children[0].task.id, hit.id);
  assert.equal(tree[0].children[0].match, true);
});

test('模糊搜索：标题/备注/标签、多关键字、子序列', () => {
  const t = mk('Write quarterly report', { note: '给老板看', tags: ['work'] });
  const hit = (q) => !!TL.makeSearchPredicate(q)(t);
  assert.ok(hit('QUARTERLY'));
  assert.ok(hit('老板'));
  assert.ok(hit('work'));
  assert.ok(hit('write report'));
  assert.ok(hit('wqr')); // 子序列模糊
  assert.ok(!hit('zzz'));
  assert.ok(!hit('write zzz'));
  assert.equal(TL.makeSearchPredicate('   '), null);
});

test('时间：解析、格式化、状态', () => {
  assert.equal(TL.parseDue('2025-01-02T03:04').getHours(), 3);
  assert.equal(TL.parseDue('bad'), null);
  assert.equal(TL.parseDue('2025-13-40T99:99'), null);
  const now = new Date(2025, 5, 10, 12, 0);
  assert.equal(TL.formatDue('2025-06-10T09:05', now), '今天 09:05');
  assert.equal(TL.formatDue('2025-06-11T09:05', now), '明天 09:05');
  assert.equal(TL.dueState({ done: false, due: '2025-06-10T11:00' }, now), 'overdue');
  assert.equal(TL.dueState({ done: false, due: '2025-06-10T20:00' }, now), 'soon');
  assert.equal(TL.dueState({ done: false, due: '2025-06-20T20:00' }, now), 'later');
  assert.equal(TL.dueState({ done: true, due: '2025-06-01T20:00' }, now), 'none');
  const d = new Date(2025, 0, 2, 3, 4);
  assert.equal(TL.toDueString(d), '2025-01-02T03:04');
});

test('normalizeState：默认值、修复坏数据', () => {
  const s = TL.normalizeState(null);
  assert.equal(s.settings.noteMode, true); // 默认便笺模式
  assert.equal(s.settings.completedToBottom, true); // 默认开启完成置底
  assert.equal(s.projects.length, 1);
  assert.equal(s.ui.view, s.projects[0].id);

  const bad = TL.normalizeState({
    settings: { noteMode: 'x', noteOpacity: 9, remindLeadMinutes: -5 },
    ui: { view: 'ghost' },
    projects: [{ name: 'P', tasks: [{ title: 1, due: 'oops', tags: ['a', 'A'], children: [{ title: 'k' }] }] }],
  });
  assert.equal(bad.settings.noteMode, true);
  assert.equal(bad.settings.noteOpacity, 1);
  assert.equal(bad.settings.remindLeadMinutes, 0);
  assert.equal(bad.ui.view, bad.projects[0].id);
  const t = bad.projects[0].tasks[0];
  assert.equal(t.due, null);
  assert.deepEqual(t.tags, ['a']);
  assert.equal(t.children[0].title, 'k');
  assert.ok(t.id && t.children[0].id);
});

test('countOpen / countOverdue / collectTags', () => {
  const now = new Date(2025, 5, 10, 12, 0);
  const tasks = [
    mk('a', { due: '2025-06-01T10:00', tags: ['X'], children: [mk('a1', { tags: ['x', 'y'] })] }),
    mk('b', { done: true }),
  ];
  assert.equal(TL.countOpen(tasks), 2);
  assert.equal(TL.countOverdue(tasks, now), 1);
  const tags = TL.collectTags(tasks);
  assert.equal(tags.get('x').count, 2);
  assert.equal(tags.get('y').count, 1);
});
