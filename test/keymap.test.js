'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KM = require('../src/shared/keymap.js');
const TL = require('../src/shared/tasks.js');

const ev = (key, mods, code) => Object.assign({ key, code: code || '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }, mods);

test('默认键位：互不冲突，且都通过校验', () => {
  const seen = new Set();
  for (const a of KM.ACTIONS) {
    assert.equal(KM.normalizeCombo(a.default), a.default, `${a.id} 的默认值需为规范写法`);
    assert.equal(KM.validateCombo(a.default, a.scope), null, `${a.id} 的默认值应合法`);
    assert.ok(!seen.has(a.default), `${a.id} 与其他操作重复：${a.default}`);
    seen.add(a.default);
  }
  assert.deepEqual(KM.resolve({}), Object.fromEntries(KM.ACTIONS.map((a) => [a.id, a.default])));
});

test('组合键解析：大小写、别名、修饰键顺序', () => {
  assert.equal(KM.normalizeCombo('shift+ctrl+enter'), 'Ctrl+Shift+Enter');
  assert.equal(KM.normalizeCombo('alt + Right'), 'Alt+ArrowRight');
  assert.equal(KM.normalizeCombo('ctrl+d'), 'Ctrl+D');
  assert.equal(KM.normalizeCombo('Ctrl+,'), 'Ctrl+,');
  assert.equal(KM.normalizeCombo('Ctrl+'), null);
  assert.equal(KM.normalizeCombo('Foo+A'), null);
  assert.equal(KM.normalizeCombo(''), null);
  assert.equal(KM.normalizeCombo(null), null);
});

test('按键事件 → 组合键', () => {
  assert.equal(KM.comboFromEvent(ev('Enter')), 'Enter');
  assert.equal(KM.comboFromEvent(ev('Enter', { ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+Enter');
  assert.equal(KM.comboFromEvent(ev('ArrowRight', { altKey: true })), 'Alt+ArrowRight');
  // Shift+/ 的 key 是 "?"，仍按物理键识别为 "/"
  assert.equal(KM.comboFromEvent(ev('?', { ctrlKey: true, shiftKey: true }, 'Slash')), 'Ctrl+Shift+/');
  // 字母不受大小写和 Shift 影响
  assert.equal(KM.comboFromEvent(ev('D', { ctrlKey: true, shiftKey: true }, 'KeyD')), 'Ctrl+Shift+D');
  assert.equal(KM.comboFromEvent(ev('F1')), 'F1');
  assert.equal(KM.comboFromEvent(ev(' ', { ctrlKey: true })), 'Ctrl+Space');
  // 只按了修饰键、输入法处理中：没有结果
  assert.equal(KM.comboFromEvent(ev('Control', { ctrlKey: true })), null);
  assert.equal(KM.comboFromEvent(ev('Shift', { shiftKey: true })), null);
  assert.equal(KM.comboFromEvent(ev('Process')), null);
});

test('校验：会破坏输入的组合被拒绝', () => {
  assert.ok(KM.validateCombo('A', 'task')); // 单个字母
  assert.ok(KM.validateCombo('Shift+A', 'task'));
  assert.ok(KM.validateCombo('Space', 'task'));
  assert.equal(KM.validateCombo('Shift+Enter', 'task'), null); // 任务内可用
  assert.ok(KM.validateCombo('Shift+Enter', 'global')); // 全局操作不行，会影响其他输入框
  assert.ok(KM.validateCombo('Ctrl+C', 'task')); // 系统占用
  assert.ok(KM.validateCombo('Ctrl+B', 'task')); // 备忘录格式化
  assert.ok(KM.validateCombo('Ctrl+Backspace', 'task')); // 删除单词
  assert.ok(KM.validateCombo('Ctrl+ArrowLeft', 'task')); // 按词移动光标
  assert.ok(KM.validateCombo('Escape', 'task')); // Esc 固定
  assert.ok(KM.validateCombo('Ctrl+Alt+T', 'global')); // 全局显示 / 收起窗口
  assert.ok(KM.validateCombo('Enter', 'global')); // 全局操作不能占用裸 Enter
  assert.ok(KM.validateCombo('Tab', 'global'));
  assert.ok(KM.validateCombo('Enter', 'task')); // Enter 留给换行
  assert.ok(KM.validateCombo('Enter', 'global'));
  assert.equal(KM.validateCombo('Tab', 'task'), null);
  assert.equal(KM.validateCombo('ArrowDown', 'task'), null);
  assert.equal(KM.validateCombo('F5', 'global'), null);
  assert.equal(KM.validateCombo('Ctrl+Shift+K', 'global'), null);
  assert.equal(KM.validateCombo('Alt+Enter', 'task'), null);
  assert.equal(KM.validateCombo('Alt+Shift+Enter', 'task'), null);
  assert.equal(KM.validateCombo('Ctrl+Enter', 'task'), null);
});

test('resolve：自定义覆盖默认；非法、冲突项回落或置空', () => {
  const r = KM.resolve({ addChild: 'Ctrl+Alt+K', deleteTask: '' });
  assert.equal(r.addChild, 'Ctrl+Alt+K');
  assert.equal(r.deleteTask, ''); // 明确清除
  assert.equal(r.addSibling, 'Alt+Enter'); // 其余保持默认

  // 非法组合回落到默认
  assert.equal(KM.resolve({ addChild: 'A' }).addChild, 'Tab');
  assert.equal(KM.resolve({ addChild: 'garbage' }).addChild, 'Tab');
  assert.equal(KM.resolve({ addChild: 123 }).addChild, 'Tab');
  // 未知操作被忽略
  assert.equal(KM.resolve({ nope: 'Ctrl+Q' }).nope, undefined);

  // 手改文件造成重复：排在前面的操作保留，后面的置空，不会出现一个键触发两个操作
  const dup = KM.resolve({ addChild: 'Alt+Enter' });
  assert.equal(dup.addSibling, 'Alt+Enter');
  assert.equal(dup.addChild, '');

  // Enter 留给换行：保存的数据里即使有，也回落到默认
  assert.equal(KM.resolve({ addSibling: 'Enter' }).addSibling, 'Alt+Enter');
  assert.equal(KM.resolve({ moveUp: 'Shift+Enter' }).moveUp, 'Shift+Enter'); // Shift+Enter 可以绑定

  // 容错：自定义不是对象
  assert.equal(KM.resolve(null).addSibling, 'Alt+Enter');
  assert.equal(KM.resolve([1, 2]).addSibling, 'Alt+Enter');
});

test('conflictWith / buildLookup / setBinding', () => {
  const r = KM.resolve({});
  assert.equal(KM.conflictWith(r, 'addChild', 'Alt+Enter'), 'addSibling');
  assert.equal(KM.conflictWith(r, 'addSibling', 'Alt+Enter'), null); // 自己不算冲突
  assert.equal(KM.conflictWith(r, 'addChild', 'Ctrl+Alt+K'), null);
  assert.equal(KM.buildLookup(r).get('Alt+ArrowUp'), 'moveUp');

  // 与默认相同则不保存；不同则保存；原对象不被修改
  const base = { addChild: 'Ctrl+Alt+K' };
  assert.deepEqual(KM.setBinding(base, 'addChild', 'Tab'), {});
  assert.deepEqual(KM.setBinding(base, 'moveUp', 'Ctrl+Alt+U'), { addChild: 'Ctrl+Alt+K', moveUp: 'Ctrl+Alt+U' });
  assert.deepEqual(KM.setBinding({}, 'moveUp', ''), { moveUp: '' });
  assert.deepEqual(base, { addChild: 'Ctrl+Alt+K' });
});

test('显示格式', () => {
  assert.equal(KM.formatCombo('Alt+ArrowRight'), 'Alt+→');
  assert.equal(KM.formatCombo('Ctrl+Shift+Delete'), 'Ctrl+Shift+Del');
  assert.equal(KM.formatCombo('Ctrl+PageUp'), 'Ctrl+PgUp');
  assert.deepEqual(KM.displayParts('Ctrl+Enter'), ['Ctrl', 'Enter']);
  assert.deepEqual(KM.displayParts('bad+'), []);
});

test('设置：keybindings 规范化与默认值', () => {
  assert.deepEqual(TL.normalizeSettings(null).keybindings, {});
  assert.deepEqual(TL.normalizeSettings({ keybindings: { addChild: 'Ctrl+K', bad: 5, 'x y': 'A', other: '' } }).keybindings, { addChild: 'Ctrl+K', other: '' });
  assert.deepEqual(TL.normalizeSettings({ keybindings: 'oops' }).keybindings, {});
  assert.deepEqual(TL.normalizeSettings({ keybindings: [1] }).keybindings, {});
  // 经过 normalizeState 后保持不变
  const s = TL.normalizeState({ settings: { keybindings: { moveUp: 'Ctrl+Alt+U' } } });
  assert.deepEqual(s.settings.keybindings, { moveUp: 'Ctrl+Alt+U' });
});
