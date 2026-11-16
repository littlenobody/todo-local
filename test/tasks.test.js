'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const TL = require('../src/shared/tasks.js');

// 任务没有标题，内容就是 note
const mk = (note, extra) => TL.createTask(note, extra);
const names = (list) => list.map((t) => t.note);

test('完成任务：移到当前层级最后，并联动子孙', () => {
  const a = mk('a');
  const b = mk('b', { children: [mk('b1'), mk('b2')] });
  const c = mk('c');
  const tasks = [a, b, c];
  TL.setDone(tasks, a.id, true, { moveToBottom: true });
  assert.deepEqual(names(tasks), ['b', 'c', 'a']);
  TL.setDone(tasks, b.id, true, { moveToBottom: true });
  assert.deepEqual(names(tasks), ['c', 'a', 'b']);
  assert.ok(b.children.every((x) => x.done && x.doneAt));
});

test('子任务完成只在其所在层级置底', () => {
  const b1 = mk('b1');
  const b2 = mk('b2');
  const b = mk('b', { children: [b1, b2] });
  const tasks = [b, mk('c')];
  TL.setDone(tasks, b1.id, true, { moveToBottom: true });
  assert.deepEqual(names(b.children), ['b2', 'b1']);
  assert.deepEqual(names(tasks), ['b', 'c']);
});

test('moveToBottom=false 时不移动', () => {
  const a = mk('a');
  const tasks = [a, mk('b')];
  TL.setDone(tasks, a.id, true, { moveToBottom: false });
  assert.deepEqual(names(tasks), ['a', 'b']);
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
  assert.deepEqual(names(root), ['q', 'p']);
});

test('insertTask：保持已完成在底部', () => {
  const d = mk('d', { done: true });
  const list = [mk('a'), d];
  TL.insertTask(list, mk('n'), true);
  assert.deepEqual(names(list), ['a', 'n', 'd']);
  TL.insertTask(list, mk('m'), false);
  assert.equal(list[list.length - 1].note, 'm');
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
  const run = (f) => names([t1, t2, t3].filter(TL.makeTagPredicate(f)));
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

test('模糊搜索：内容/标签、多关键字、首行子序列', () => {
  const t = mk('Write quarterly report\n给老板看', { tags: ['work'] });
  const hit = (q) => !!TL.makeSearchPredicate(q)(t);
  assert.ok(hit('QUARTERLY'));
  assert.ok(hit('老板')); // 非首行内容也能搜到
  assert.ok(hit('work')); // 标签
  assert.ok(hit('write report'));
  assert.ok(hit('wqr')); // 首行子序列模糊
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
  assert.equal(s.settings.noteAlwaysOnTop, false); // 置顶默认关闭
  assert.equal(s.settings.noteEdgeDock, true);
  assert.equal(s.projects.length, 1);
  assert.equal(s.ui.view, s.projects[0].id);

  const bad = TL.normalizeState({
    settings: { noteMode: 'x', noteOpacity: 9, remindLeadMinutes: -5 },
    ui: { view: 'ghost' },
    projects: [{ name: 'P', tasks: [{ note: 1, due: 'oops', tags: ['a', 'A'], children: [{ note: 'k' }] }] }],
  });
  assert.equal(bad.settings.noteMode, true);
  assert.equal(bad.settings.noteOpacity, 1);
  assert.equal(bad.settings.remindLeadMinutes, 0);
  assert.equal(bad.ui.view, bad.projects[0].id);
  const t = bad.projects[0].tasks[0];
  assert.equal(t.note, '');
  assert.equal(t.due, null);
  assert.deepEqual(t.tags, ['a']);
  assert.equal(t.children[0].note, 'k');
  assert.ok(t.id && t.children[0].id);
});

test('任务没有 title 字段', () => {
  assert.ok(!('title' in mk('x')));
  const s = TL.normalizeState({ projects: [{ name: 'P', tasks: [{ note: 'x' }] }] });
  assert.ok(!('title' in s.projects[0].tasks[0]));
});

test('旧数据迁移：标题并入备注最前面', () => {
  const s = TL.normalizeState({
    projects: [
      {
        name: 'P',
        tasks: [
          { title: '买牛奶', note: '全脂\n两盒', children: [{ title: '只有标题' }, { note: '只有备注' }, { title: '  ', note: '  ' }] },
          { title: '', note: '' },
        ],
      },
    ],
  });
  const [a, b] = s.projects[0].tasks;
  assert.equal(a.note, '买牛奶\n全脂\n两盒');
  assert.deepEqual(names(a.children), ['只有标题', '只有备注', '  ']);
  assert.ok(a.children.every((c) => !('title' in c)));
  assert.equal(b.note, '');
});

test('迁移后再次规范化结果不变（幂等）', () => {
  const once = TL.normalizeState({ projects: [{ name: 'P', tasks: [{ title: 'T', note: 'N' }] }] });
  const twice = TL.normalizeState(JSON.parse(JSON.stringify(once)));
  assert.equal(twice.projects[0].tasks[0].note, 'T\nN');
});

test('hasLegacyTitles：只在存在非空旧标题时为真', () => {
  assert.equal(TL.hasLegacyTitles(null), false);
  assert.equal(TL.hasLegacyTitles({ projects: [{ tasks: [{ title: '', note: 'x' }] }] }), false);
  assert.equal(TL.hasLegacyTitles({ projects: [{ tasks: [{ note: 'x' }] }] }), false);
  assert.equal(TL.hasLegacyTitles({ projects: [{ tasks: [{ title: 'a' }] }] }), true);
  assert.equal(TL.hasLegacyTitles({ projects: [{ tasks: [{ note: 'x', children: [{ title: 'deep' }] }] }] }), true);
});

test('taskLabel：首个非空行 > 标签 > 占位', () => {
  assert.equal(TL.taskLabel({ note: '\n  第一行   内容 \n第二行', tags: ['a'] }), '第一行 内容');
  assert.equal(TL.taskLabel({ note: '', tags: ['a', 'b'] }), '#a #b');
  assert.equal(TL.taskLabel({ note: '  ', tags: [] }), '（空白任务）');
  assert.equal(TL.taskLabel({ note: '1234567890', tags: [] }, 5), '12345…');
});

test('parseQuickInput：提取 #标签、保留换行、整理空白', () => {
  assert.deepEqual(TL.parseQuickInput('买牛奶 #生活 #采购'), { text: '买牛奶', tags: ['生活', '采购'] });
  assert.deepEqual(TL.parseQuickInput('#只有标签'), { text: '', tags: ['只有标签'] });
  assert.deepEqual(TL.parseQuickInput('   '), { text: '', tags: [] });
  assert.deepEqual(TL.parseQuickInput(null), { text: '', tags: [] });
  // 多行：换行保留，行内多余空格合并，行首尾空格去掉，连续空行最多一个
  assert.equal(TL.parseQuickInput('  第一行   内容  \r\n\r\n\r\n\r\n  第二行 ').text, '第一行 内容\n\n第二行');
  // 标签可以在任意一行；提取后不留空行的多余空格
  assert.deepEqual(TL.parseQuickInput('第一行\n#工作 第二行'), { text: '第一行\n第二行', tags: ['工作'] });
  assert.deepEqual(TL.parseQuickInput('第一行\n#工作\n第二行'), { text: '第一行\n\n第二行', tags: ['工作'] });
  // 不是标签：#前面有非空白字符（如 C#）
  assert.deepEqual(TL.parseQuickInput('学 C# 语法'), { text: '学 C# 语法', tags: [] });
  // 标签去重（不区分大小写）
  assert.deepEqual(TL.parseQuickInput('x #A #a #b').tags, ['A', 'b']);
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

test('moveTask: 同级排序 (before / after)', () => {
  const a = mk('a');
  const b = mk('b');
  const c = mk('c');
  const tasks = [a, b, c];

  // 将 c 移到 a 之前 -> [c, a, b]
  assert.equal(TL.moveTask(tasks, c.id, a.id, 'before'), true);
  assert.deepEqual(names(tasks), ['c', 'a', 'b']);

  // 将 c 移到 b 之后 -> [a, b, c]
  assert.equal(TL.moveTask(tasks, c.id, b.id, 'after'), true);
  assert.deepEqual(names(tasks), ['a', 'b', 'c']);

  // 将 a 移到 b 之后 -> [b, a, c]
  assert.equal(TL.moveTask(tasks, a.id, b.id, 'after'), true);
  assert.deepEqual(names(tasks), ['b', 'a', 'c']);
});

test('moveTask: 拖入成为子任务 (inside) 与跨层级拖出', () => {
  const a = mk('a');
  const b = mk('b');
  const tasks = [a, b];

  // b 移入 a 作为子任务
  assert.equal(TL.moveTask(tasks, b.id, a.id, 'inside'), true);
  assert.deepEqual(names(tasks), ['a']);
  assert.deepEqual(names(a.children), ['b']);

  // 将 b 拖回到根层级 a 之前
  assert.equal(TL.moveTask(tasks, b.id, a.id, 'before'), true);
  assert.deepEqual(names(tasks), ['b', 'a']);
  assert.deepEqual(names(a.children), []);
});

test('moveTask: 非法操作防护（移动到自身或自身子孙）', () => {
  const sub = mk('sub');
  const a = mk('a', { children: [sub] });
  const b = mk('b');
  const tasks = [a, b];

  // 不能移到自身
  assert.equal(TL.moveTask(tasks, a.id, a.id, 'before'), false);
  // 不能移到自身子孙
  assert.equal(TL.moveTask(tasks, a.id, sub.id, 'inside'), false);
  assert.equal(TL.moveTask(tasks, a.id, sub.id, 'after'), false);
  // 无效 id
  assert.equal(TL.moveTask(tasks, 'not-exist', b.id, 'before'), false);
  assert.equal(TL.moveTask(tasks, a.id, 'not-exist', 'before'), false);
});

test('autoStart 配置项默认值与规范化', () => {
  const def = TL.normalizeSettings(null);
  assert.equal(def.autoStart, false);

  const custom = TL.normalizeSettings({ autoStart: true });
  assert.equal(custom.autoStart, true);

  const invalid = TL.normalizeSettings({ autoStart: 'not-bool' });
  assert.equal(invalid.autoStart, false);
});

test('moveTaskInState: 跨项目或项目内拖动', () => {
  const p1 = TL.createProject('P1', 0);
  const p2 = TL.createProject('P2', 1);
  const t1 = mk('t1');
  const t2 = mk('t2');
  const t3 = mk('t3');
  p1.tasks = [t1, t2];
  p2.tasks = [t3];
  const state = { projects: [p1, p2] };

  // 将 t3 移动到 t1 之后
  assert.equal(TL.moveTaskInState(state, t3.id, t1.id, 'after'), true);
  assert.deepEqual(names(p1.tasks), ['t1', 't3', 't2']);
  assert.deepEqual(names(p2.tasks), []);
});

test('isBlankTask: 只有空白才算空任务', () => {
  assert.equal(TL.isBlankTask(mk('')), true);
  assert.equal(TL.isBlankTask(mk('  \n ')), true);
  assert.equal(TL.isBlankTask(mk('a')), false);
  assert.equal(TL.isBlankTask(mk('', { tags: ['x'] })), false);
  assert.equal(TL.isBlankTask(mk('', { due: '2030-01-01T09:00' })), false);
  assert.equal(TL.isBlankTask(mk('', { children: [mk('c')] })), false);
  assert.equal(TL.isBlankTask(null), false);
});

test('insertSibling: 在上方 / 下方插入同级任务', () => {
  const a = mk('a');
  const b = mk('b');
  const tasks = [a, b];
  assert.equal(TL.insertSibling(tasks, a.id, mk('x'), 'after', false), true);
  assert.deepEqual(names(tasks), ['a', 'x', 'b']);
  TL.insertSibling(tasks, a.id, mk('y'), 'before', false);
  assert.deepEqual(names(tasks), ['y', 'a', 'x', 'b']);
  assert.equal(TL.insertSibling(tasks, 'nope', mk('z'), 'after', false), false);

  // 子层级
  const c = mk('c', { children: [mk('c1')] });
  const t2 = [c];
  TL.insertSibling(t2, c.children[0].id, mk('c2'), 'after', false);
  assert.deepEqual(names(c.children), ['c1', 'c2']);
});

test('insertSibling: 参照任务已完成且开启置底时，新任务放到未完成区末尾', () => {
  const a = mk('a');
  const d1 = mk('d1', { done: true });
  const d2 = mk('d2', { done: true });
  const tasks = [a, d1, d2];
  TL.insertSibling(tasks, d1.id, mk('n'), 'after', true);
  assert.deepEqual(names(tasks), ['a', 'n', 'd1', 'd2']);
  // 参照任务未完成：仍紧跟其后
  const b = mk('b');
  const t2 = [a, b, d1];
  TL.insertSibling(t2, a.id, mk('m'), 'after', true);
  assert.deepEqual(names(t2), ['a', 'm', 'b', 'd1']);
});

test('indentTask: 变成上一个同级任务的最后一个子任务', () => {
  const a = mk('a', { children: [mk('a1')], collapsed: true });
  const b = mk('b');
  const c = mk('c');
  const tasks = [a, b, c];
  assert.equal(TL.indentTask(tasks, b.id), true);
  assert.deepEqual(names(tasks), ['a', 'c']);
  assert.deepEqual(names(a.children), ['a1', 'b']);
  assert.equal(a.collapsed, false); // 自动展开，能看到刚缩进的任务
  assert.equal(TL.indentTask(tasks, a.id), false); // 第一个任务不能缩进
  assert.equal(TL.indentTask(tasks, 'nope'), false);
});

test('indentTask: 未完成任务不能缩进到已完成任务下面', () => {
  const d = mk('d', { done: true });
  const x = mk('x');
  const tasks = [d, x];
  assert.equal(TL.indentTask(tasks, x.id), false);
  assert.deepEqual(names(tasks), ['d', 'x']);
});

test('indentTask: 开启置底时插在子任务的未完成区末尾', () => {
  const k = mk('k', { done: true });
  const a = mk('a', { children: [mk('a1'), k] });
  const b = mk('b');
  const tasks = [a, b];
  TL.indentTask(tasks, b.id, { keepDoneAtBottom: true });
  assert.deepEqual(names(a.children), ['a1', 'b', 'k']);
});

test('outdentTask: 移出父任务，放在父任务后面', () => {
  const b1 = mk('b1');
  const b2 = mk('b2');
  const b = mk('b', { children: [b1, b2] });
  const c = mk('c');
  const tasks = [b, c];
  assert.equal(TL.outdentTask(tasks, b1.id), true);
  assert.deepEqual(names(tasks), ['b', 'b1', 'c']);
  assert.deepEqual(names(b.children), ['b2']);
  assert.equal(TL.outdentTask(tasks, b.id), false); // 已在顶层

  // 多级：移出一层后仍在上一层
  const z = mk('z');
  const y = mk('y', { children: [z] });
  const x = mk('x', { children: [y] });
  const t2 = [x];
  TL.outdentTask(t2, z.id);
  assert.deepEqual(names(x.children), ['y', 'z']);
});

test('outdentTask: 已完成任务移出后不越过未完成的同级', () => {
  const d = mk('d', { done: true });
  const p = mk('p', { children: [d] });
  const q = mk('q');
  const r = mk('r', { done: true });
  const tasks = [p, q, r];
  TL.outdentTask(tasks, d.id, { keepDoneAtBottom: true });
  assert.deepEqual(names(tasks), ['p', 'q', 'r', 'd']);
});

test('shiftTask: 同级上移下移，边界不动', () => {
  const a = mk('a');
  const b = mk('b');
  const c = mk('c');
  const tasks = [a, b, c];
  assert.equal(TL.shiftTask(tasks, b.id, 'up'), true);
  assert.deepEqual(names(tasks), ['b', 'a', 'c']);
  assert.equal(TL.shiftTask(tasks, b.id, 'up'), false);
  assert.equal(TL.shiftTask(tasks, c.id, 'down'), false);
  assert.equal(TL.shiftTask(tasks, a.id, 'down'), true);
  assert.deepEqual(names(tasks), ['b', 'c', 'a']);

  // 子任务只在自己这一层移动
  const p = mk('p', { children: [mk('p1'), mk('p2')] });
  const t2 = [p];
  TL.shiftTask(t2, p.children[1].id, 'up');
  assert.deepEqual(names(p.children), ['p2', 'p1']);
});

test('shiftTask: 开启置底时不跨越已完成与未完成的分界', () => {
  const a = mk('a');
  const d = mk('d', { done: true });
  const tasks = [a, d];
  assert.equal(TL.shiftTask(tasks, a.id, 'down', { keepDoneAtBottom: true }), false);
  assert.deepEqual(names(tasks), ['a', 'd']);
  assert.equal(TL.shiftTask(tasks, a.id, 'down', { keepDoneAtBottom: false }), true);
  assert.deepEqual(names(tasks), ['d', 'a']);
});
