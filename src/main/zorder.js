'use strict';

/*
 * Electron 没有“窗口置底”的 API，这里通过 koffi 调用 Win32 SetWindowPos(HWND_BOTTOM)。
 * koffi 是可选依赖：加载失败时静默降级（窗口只是不置顶，不会置底）。
 */
let setWindowPos = null;
let tried = false;

const HWND_BOTTOM = 1;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;

function init() {
  if (tried) return;
  tried = true;
  if (process.platform !== 'win32') return;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    setWindowPos = user32.func(
      'bool __stdcall SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int x, int y, int cx, int cy, uint32_t flags)'
    );
  } catch (err) {
    console.warn('[zorder] koffi 不可用，便笺无法置底：', err.message);
  }
}

function sendToBottom(win) {
  init();
  if (!setWindowPos || !win || win.isDestroyed()) return false;
  try {
    const handle = win.getNativeWindowHandle();
    const hwnd = handle.length >= 8 ? Number(handle.readBigUInt64LE(0)) : handle.readUInt32LE(0);
    return setWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
  } catch (err) {
    console.warn('[zorder] SetWindowPos 失败：', err.message);
    return false;
  }
}

module.exports = { sendToBottom };
