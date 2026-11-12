'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/main/dock.js');

const display = (id, x, y, w, h, taskbar = 0) => ({
  id,
  bounds: { x, y, width: w, height: h },
  workArea: { x, y, width: w, height: h - taskbar },
});
const one = [display(1, 0, 0, 1920, 1080, 40)];
const win = (x, y, w = 340, h = 520) => ({ x, y, width: w, height: h });

test('detectDock：靠近左 / 右 / 上边缘时吸附，并给出贴齐后的位置', () => {
  const left = D.detectDock(win(5, 100), one);
  assert.equal(left.edge, 'left');
  assert.deepEqual(left.expanded, win(0, 100));

  const right = D.detectDock(win(1920 - 340 - 8, 100), one);
  assert.equal(right.edge, 'right');
  assert.equal(right.expanded.x, 1920 - 340);

  const top = D.detectDock(win(600, 3), one);
  assert.equal(top.edge, 'top');
  assert.equal(top.expanded.y, 0);
});

test('detectDock：离边缘较远、或靠在下边缘（任务栏）时不贴边', () => {
  assert.equal(D.detectDock(win(600, 300), one), null);
  assert.equal(D.detectDock(win(600, 1040 - 520), one), null);
  assert.equal(D.detectDock(win(D.SNAP + 1, 300), one), null);
});

test('detectDock：窗口已超出边缘（负坐标）也算贴边', () => {
  assert.equal(D.detectDock(win(-30, 100), one).edge, 'left');
});

test('detectDock：同时靠近两条边时取更近的那条', () => {
  assert.equal(D.detectDock(win(2, 9), one).edge, 'left');
  assert.equal(D.detectDock(win(9, 2), one).edge, 'top');
});

test('detectDock：收起部分会落进相邻显示器时，这条边不可用', () => {
  const two = [display(1, 0, 0, 1920, 1080), display(2, 1920, 0, 1920, 1080)];
  // 窗口在显示器 1 的右边缘，右边是显示器 2：缩起来会漏到隔壁屏幕上
  assert.equal(D.detectDock(win(1920 - 340, 100), two), null);
  // 显示器 2 的右边缘外面没有显示器，可以贴
  assert.equal(D.detectDock(win(3840 - 340, 100), two).edge, 'right');
  // 显示器 2 的左边缘是显示器 1，不可用
  assert.equal(D.detectDock(win(1920, 100), two), null);
});

test('detectDock：用窗口所在的显示器判断，而不是只看主屏', () => {
  const two = [display(1, 0, 0, 1920, 1080), display(2, 1920, 0, 1280, 720)];
  const d = D.detectDock(win(3200 - 340 - 4, 100), two);
  assert.equal(d.edge, 'right');
  assert.equal(d.expanded.x, 3200 - 340);
});

test('collapsedRect：只在屏幕内留下 sliver 宽度', () => {
  const area = one[0].workArea;
  const l = D.collapsedRect('left', win(0, 100), area);
  assert.equal(l.x + l.width, D.SLIVER);
  const r = D.collapsedRect('right', win(1580, 100), area);
  assert.equal(r.x, 1920 - D.SLIVER);
  const t = D.collapsedRect('top', win(600, 0), area);
  assert.equal(t.y + t.height, D.SLIVER);
});

test('inHotZone：只有露出的那条（沿边缘方向在窗口范围内）才会触发展开', () => {
  const area = one[0].workArea;
  const exp = win(0, 100);
  assert.equal(D.inHotZone({ x: 2, y: 200 }, 'left', exp, area), true);
  assert.equal(D.inHotZone({ x: 2, y: 50 }, 'left', exp, area), false); // 窗口上方的边缘不触发
  assert.equal(D.inHotZone({ x: 2, y: 700 }, 'left', exp, area), false); // 窗口下方也不触发
  assert.equal(D.inHotZone({ x: 40, y: 200 }, 'left', exp, area), false);
  assert.equal(D.inHotZone({ x: 1919, y: 200 }, 'right', win(1580, 100), area), true);
  assert.equal(D.inHotZone({ x: 700, y: 0 }, 'top', win(600, 0), area), true);
  assert.equal(D.inHotZone({ x: 100, y: 0 }, 'top', win(600, 0), area), false);
});

test('pointInRect', () => {
  const r = win(10, 10, 100, 100);
  assert.equal(D.pointInRect({ x: 10, y: 10 }, r), true);
  assert.equal(D.pointInRect({ x: 110, y: 50 }, r), false);
  assert.equal(D.pointInRect({ x: 111, y: 50 }, r, 2), true);
});
