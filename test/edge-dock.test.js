'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEdgeDock, POLL_MS, ENTER_MS, LEAVE_MS } = require('../src/main/edge-dock.js');
const D = require('../src/main/dock.js');

const AREA = { x: 0, y: 0, width: 1920, height: 1040 };
const DISPLAY = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: AREA };

function setup(opts = {}) {
  const calls = { changes: 0, moveTop: 0 };
  const cursor = { x: 900, y: 500 };
  const w = {
    b: { x: 5, y: 100, width: 340, height: 520 },
    focused: false,
    visible: true,
    isDestroyed: () => false,
    isVisible: () => w.visible,
    isMinimized: () => false,
    isMaximized: () => false,
    isFullScreen: () => false,
    isFocused: () => w.focused,
    getBounds: () => ({ ...w.b }),
    setPosition: (x, y) => {
      w.b.x = x;
      w.b.y = y;
    },
    moveTop: () => calls.moveTop++,
  };
  let active = true;
  const dock = createEdgeDock({
    screen: { getAllDisplays: () => [DISPLAY], getCursorScreenPoint: () => ({ ...cursor }) },
    getWin: () => w,
    isActive: () => active && (opts.active !== false),
    onChange: () => calls.changes++,
  });
  return { dock, w, cursor, calls, setActive: (v) => (active = v) };
}

/**
 * 推进假时钟。mock 的 Date.now() 在一次 tick() 内部不会随定时器逐个推进，
 * 所以必须拆成小步长，轮询和动画里的“已过去多久”才算得对。
 */
const advance = (ctx, ms) => {
  for (let left = ms; left > 0; left -= 10) ctx.mock.timers.tick(Math.min(10, left));
};

test('靠边后吸附；鼠标离开一段时间后收起，只露出一条', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const s = setup();
  s.dock.refresh();
  assert.equal(s.dock.isDocked(), true);
  assert.equal(s.w.b.x, 0); // 从 x=5 吸附到边缘
  assert.equal(s.dock.isCollapsed(), false);

  advance(t, LEAVE_MS - POLL_MS * 2);
  assert.equal(s.dock.isCollapsed(), false); // 还没到时间

  advance(t, POLL_MS * 4 + 400); // 超过 LEAVE_MS，再等动画结束
  assert.equal(s.dock.isCollapsed(), true);
  assert.equal(s.w.b.x + s.w.b.width, D.SLIVER);
  assert.equal(s.calls.changes, 1);
  s.dock.release();
});

test('收起后鼠标停在边缘一小会儿才展开；划过边缘不触发', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const s = setup();
  s.dock.refresh();
  advance(t, LEAVE_MS + 800);
  assert.equal(s.dock.isCollapsed(), true);

  // 在边缘一闪而过
  s.cursor.x = 2;
  s.cursor.y = 200;
  advance(t, POLL_MS);
  s.cursor.x = 400;
  advance(t, ENTER_MS * 3);
  assert.equal(s.dock.isCollapsed(), true);

  // 窗口范围之外的那段边缘不触发
  s.cursor.x = 2;
  s.cursor.y = 900;
  advance(t, ENTER_MS * 3);
  assert.equal(s.dock.isCollapsed(), true);

  // 停在露出的那条上
  s.cursor.y = 200;
  advance(t, ENTER_MS + POLL_MS * 2 + 400);
  assert.equal(s.dock.isCollapsed(), false);
  assert.equal(s.w.b.x, 0);
  assert.ok(s.calls.moveTop >= 1);
  s.dock.release();
});

test('窗口有焦点或鼠标在窗口上时不收起', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const s = setup();
  s.dock.refresh();
  s.w.focused = true;
  advance(t, LEAVE_MS * 4);
  assert.equal(s.dock.isCollapsed(), false);

  s.w.focused = false;
  s.cursor.x = 100;
  s.cursor.y = 300; // 在窗口上
  advance(t, LEAVE_MS * 4);
  assert.equal(s.dock.isCollapsed(), false);
  s.dock.release();
});

test('expand(holdMs)：保持期内不会收起，过后恢复', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const s = setup();
  s.dock.refresh();
  advance(t, LEAVE_MS + 800);
  assert.equal(s.dock.isCollapsed(), true);

  s.dock.expand(3000);
  advance(t, 600); // 动画结束
  assert.equal(s.dock.isCollapsed(), false);
  advance(t, 2000);
  assert.equal(s.dock.isCollapsed(), false); // 仍在保持期
  advance(t, 2000 + LEAVE_MS + 400);
  assert.equal(s.dock.isCollapsed(), true);
  s.dock.release();
});

test('restBounds：收起时返回展开位置，用于保存窗口位置', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const s = setup();
  assert.equal(s.dock.restBounds(), null);
  s.dock.refresh();
  assert.equal(s.dock.restBounds(), null);
  advance(t, LEAVE_MS + 800);
  assert.deepEqual(s.dock.restBounds(), { x: 0, y: 100, width: 340, height: 520 });
  s.dock.release();
});

test('release：缩在边缘时先放回展开位置，并通知层级变化', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const s = setup();
  s.dock.refresh();
  advance(t, LEAVE_MS + 800);
  const before = s.calls.changes;
  s.dock.release();
  assert.equal(s.w.b.x, 0);
  assert.equal(s.dock.isDocked(), false);
  assert.equal(s.calls.changes, before + 1);
});

test('关闭设置后（isActive=false）自动退出贴边并展开', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const s = setup();
  s.dock.refresh();
  advance(t, LEAVE_MS + 800);
  assert.equal(s.dock.isCollapsed(), true);
  s.setActive(false);
  s.dock.refresh();
  assert.equal(s.dock.isDocked(), false);
  assert.equal(s.w.b.x, 0);
});

test('不靠边、或功能未启用时不贴边', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const s = setup();
  s.w.b.x = 600;
  s.dock.refresh();
  assert.equal(s.dock.isDocked(), false);
  advance(t, LEAVE_MS * 3);
  assert.equal(s.w.b.x, 600);

  const off = setup({ active: false });
  off.dock.refresh();
  assert.equal(off.dock.isDocked(), false);
  assert.equal(off.w.b.x, 5);
});

test('拖离边缘后重新判断：不再贴边', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const s = setup();
  s.dock.refresh();
  assert.equal(s.dock.isDocked(), true);
  s.w.b.x = 700;
  s.dock.refresh();
  assert.equal(s.dock.isDocked(), false);
  advance(t, LEAVE_MS * 3);
  assert.equal(s.w.b.x, 700);
});
