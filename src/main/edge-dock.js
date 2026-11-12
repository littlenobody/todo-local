'use strict';

/*
 * 便笺贴边收起：窗口被拖到屏幕边缘后，鼠标离开就缩到边缘只留一条，鼠标移到那一条上再展开。
 * 几何计算在 dock.js（纯函数）；这里负责状态、轮询鼠标位置和位移动画。
 * 所有依赖都从外面注入（screen、窗口、开关），方便在测试里替换。
 */
const D = require('./dock');

const POLL_MS = 100; // 轮询鼠标位置的间隔
const ENTER_MS = 150; // 鼠标在边缘停留多久才展开，避免划过边缘时误触发
const LEAVE_MS = 500; // 鼠标离开窗口多久后收起
const ANIM_MS = 140;

/**
 * @param {object} deps
 * @param {{ getAllDisplays(): any[], getCursorScreenPoint(): {x:number,y:number} }} deps.screen
 * @param {() => any} deps.getWin 返回当前窗口（可能为 null）
 * @param {() => boolean} deps.isActive 当前是否应启用贴边（便笺模式且设置开启）
 * @param {() => void} [deps.onChange] 收起 / 展开开始时的回调（用来调整窗口层级：缩在边缘时要浮在上面才看得见）
 */
function createEdgeDock({ screen, getWin, isActive, onChange }) {
  let dock = null; // { edge, area, expanded, collapsed }
  let pollTimer = null;
  let animTimer = null;
  let inSince = 0;
  let outSince = 0;
  let holdUntil = 0;

  const win = () => {
    const w = getWin();
    return w && !w.isDestroyed() ? w : null;
  };

  /** 取整并消除 -0：Math.round(-0.3) 是 -0，Electron 的整数参数转换会拒绝它并抛 TypeError */
  const px = (v) => Math.round(v) + 0;

  function stopAnim() {
    clearInterval(animTimer);
    animTimer = null;
  }

  function stopPoll() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  /** 只改位置不改大小：在缩放比例不是整数的屏幕上，反复 setBounds 会让窗口尺寸慢慢漂移 */
  function moveTo(target, animate, done) {
    const w = win();
    if (!w) return;
    stopAnim();
    const from = w.getBounds();
    if (!animate || (from.x === target.x && from.y === target.y)) {
      w.setPosition(target.x, target.y);
      if (done) done();
      return;
    }
    const start = Date.now();
    animTimer = setInterval(() => {
      const cur = win();
      if (!cur) return stopAnim();
      const k = Math.min(1, (Date.now() - start) / ANIM_MS);
      const e = 1 - Math.pow(1 - k, 3);
      cur.setPosition(px(from.x + (target.x - from.x) * e), px(from.y + (target.y - from.y) * e));
      if (k >= 1) {
        stopAnim();
        if (done) done();
      }
    }, 16);
  }

  /** 展开。holdMs > 0 时，这段时间内即使鼠标不在窗口上也不会收起（提醒、快捷键唤出时用） */
  function expand(holdMs) {
    const w = win();
    if (!w || !dock) return;
    holdUntil = holdMs ? Date.now() + holdMs : 0;
    outSince = 0;
    inSince = 0;
    if (!dock.collapsed) return;
    dock.collapsed = false;
    if (onChange) onChange();
    if (w.isVisible()) w.moveTop(); // 不抢焦点；便笺可能沉在其他窗口下面，展开时要让它露出来
    moveTo(dock.expanded, true);
  }

  function collapse() {
    if (!dock || dock.collapsed) return;
    dock.collapsed = true;
    inSince = 0;
    outSince = 0;
    if (onChange) onChange();
    moveTo(D.collapsedRect(dock.edge, dock.expanded, dock.area), true);
  }

  function tick() {
    const w = win();
    if (!w || !dock) return;
    if (!isActive()) return refresh();
    if (animTimer || !w.isVisible() || w.isMinimized()) return;

    const p = screen.getCursorScreenPoint();
    const now = Date.now();

    if (dock.collapsed) {
      if (D.inHotZone(p, dock.edge, dock.expanded, dock.area)) {
        if (!inSince) inSince = now;
        if (now - inSince >= ENTER_MS) expand();
      } else {
        inSince = 0;
      }
      return;
    }

    // 窗口有焦点（正在输入、有弹窗）或还在保持期内，不收起
    if (D.pointInRect(p, w.getBounds(), 2) || w.isFocused() || now < holdUntil) {
      outSince = 0;
      return;
    }
    if (!outSince) outSince = now;
    if (now - outSince >= LEAVE_MS) collapse();
  }

  function startPoll() {
    if (!pollTimer) pollTimer = setInterval(tick, POLL_MS);
  }

  /** 结束贴边状态；如果窗口正缩在边缘，先把它放回展开位置 */
  function release() {
    stopAnim();
    stopPoll();
    const w = win();
    const wasCollapsed = !!(dock && dock.collapsed);
    if (w && wasCollapsed) w.setPosition(dock.expanded.x, dock.expanded.y);
    dock = null;
    if (wasCollapsed && onChange) onChange();
    inSince = 0;
    outSince = 0;
    holdUntil = 0;
  }

  /**
   * 根据窗口当前位置重新判断是否贴边：拖动结束、缩放结束、切换模式、改设置、显示器变化后调用。
   * 贴边时顺便把窗口吸附到边缘。缩着的时候不重新判断（此时窗口位置不是真实位置）。
   */
  function refresh() {
    const w = win();
    if (!w || !isActive() || w.isMaximized() || w.isMinimized() || w.isFullScreen()) return release();
    if (dock && dock.collapsed) return;
    const found = D.detectDock(w.getBounds(), screen.getAllDisplays());
    if (!found) return release();
    dock = { edge: found.edge, area: found.area, expanded: found.expanded, collapsed: false };
    holdUntil = 0;
    outSince = 0;
    w.setPosition(found.expanded.x, found.expanded.y);
    startPoll();
  }

  return {
    refresh,
    expand,
    release,
    /** 窗口缩在边缘时返回它的展开位置，用来保存窗口位置（缩起来的位置下次启动会被当成“看不见”而丢弃） */
    restBounds: () => (dock && dock.collapsed ? { ...dock.expanded } : null),
    isCollapsed: () => !!(dock && dock.collapsed),
    isDocked: () => !!dock,
  };
}

module.exports = { createEdgeDock, POLL_MS, ENTER_MS, LEAVE_MS };
