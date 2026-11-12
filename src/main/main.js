'use strict';
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, globalShortcut, screen, shell } = require('electron');
const { readJson, writeJsonAtomic } = require('./store');
const TaskLib = require('../shared/tasks.js');
const { Reminders } = require('./reminders');
const { sendToBottom } = require('./zorder');
const { createWindowIcon, createTrayIcon } = require('./icon');

const MIN_W = 280;
const MIN_H = 320;
const DEFAULT_SIZE = { normal: { width: 1100, height: 720 }, note: { width: 340, height: 520 } };
const SHORTCUTS = ['CommandOrControl+Alt+T', 'CommandOrControl+Alt+Shift+T', 'CommandOrControl+Alt+J', 'CommandOrControl+Alt+Shift+J'];
let activeShortcut = '';

let win = null;
let tray = null;
let reminders = null;
let state = null;
let winPrefs = {};
let dataDir = '';
let stateFile = '';
let windowFile = '';
let saveTimer = null;
let boundsTimer = null;
let dirty = false;
let quitting = false;
const liveNotifications = new Set();

const isNote = () => !!state.settings.noteMode;
const alive = () => win && !win.isDestroyed();

/* ---------- 数据持久化 ---------- */

function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!dirty) return;
  try {
    writeJsonAtomic(stateFile, state, true);
    dirty = false;
  } catch (err) {
    console.error('[store] 保存失败：', err);
  }
}

function scheduleSave() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}

/* ---------- 窗口位置 ---------- */

function resolveBounds(mode) {
  const def = DEFAULT_SIZE[mode];
  const saved = winPrefs[mode];
  const primary = screen.getPrimaryDisplay().workArea;

  if (saved && [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite)) {
    const area = screen.getDisplayMatching(saved).workArea;
    const overlapW = Math.min(saved.x + saved.width, area.x + area.width) - Math.max(saved.x, area.x);
    const overlapH = Math.min(saved.y + saved.height, area.y + area.height) - Math.max(saved.y, area.y);
    if (overlapW >= 80 && overlapH >= 40) {
      return {
        x: saved.x,
        y: saved.y,
        width: Math.max(MIN_W, Math.min(saved.width, area.width)),
        height: Math.max(MIN_H, Math.min(saved.height, area.height)),
      };
    }
  }
  const width = Math.min(def.width, primary.width);
  const height = Math.min(def.height, primary.height);
  if (mode === 'note') {
    return { width, height, x: primary.x + primary.width - width - 24, y: primary.y + 48 };
  }
  return {
    width,
    height,
    x: primary.x + Math.round((primary.width - width) / 2),
    y: primary.y + Math.round((primary.height - height) / 2),
  };
}

function saveWinPrefs(mode) {
  if (!alive() || win.isMinimized() || win.isFullScreen()) return;
  winPrefs[mode] = win.getNormalBounds();
  try {
    writeJsonAtomic(windowFile, winPrefs, false);
  } catch {
    /* 位置保存失败不影响使用 */
  }
}

/* ---------- 窗口与托盘 ---------- */

function showWindow() {
  if (!alive()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.moveTop();
  win.focus();
}

function toggleWindow() {
  if (!alive()) return;
  if (win.isVisible() && !win.isMinimized() && win.isFocused()) {
    if (isNote()) sendToBottom(win);
    else win.hide();
  } else {
    showWindow();
  }
}

function createTray() {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip('待办清单');
  tray.on('click', showWindow);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示窗口', click: showWindow },
      { label: '切换到便笺模式', click: () => setNoteModeFromMain(true) },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ])
  );
}

function destroyTray() {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

/** 根据当前模式应用窗口特性：任务栏、透明度、托盘图标 */
function applyTraits() {
  if (!alive()) return;
  const note = isNote();
  win.setSkipTaskbar(note);
  win.setMaximizable(!note);
  win.setOpacity(note ? state.settings.noteOpacity : 1);
  if (note) destroyTray();
  else createTray();
}

function onSettingsChanged(prev) {
  const cur = state.settings;
  if (cur.noteMode !== prev.noteMode) {
    saveWinPrefs(prev.noteMode ? 'note' : 'normal');
    if (win.isMaximized()) win.unmaximize();
    win.setBounds(resolveBounds(cur.noteMode ? 'note' : 'normal'));
    applyTraits();
    showWindow();
  } else if (cur.noteOpacity !== prev.noteOpacity) {
    applyTraits();
  }
}

/** 托盘菜单发起的模式切换：更新状态并通知界面 */
function setNoteModeFromMain(note) {
  if (isNote() === note) return;
  const prev = { ...state.settings };
  state.settings.noteMode = note;
  scheduleSave();
  onSettingsChanged(prev);
  if (alive()) win.webContents.send('set-mode', note);
}

function createWindow(firstRun) {
  const note = isNote();
  win = new BrowserWindow({
    ...resolveBounds(note ? 'note' : 'normal'),
    minWidth: MIN_W,
    minHeight: MIN_H,
    frame: false,
    show: false,
    skipTaskbar: note,
    backgroundColor: note ? '#fff7c2' : '#f5f6fa',
    icon: createWindowIcon(),
    title: '待办清单',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.once('ready-to-show', () => {
    applyTraits();
    if (isNote() && !firstRun && state.settings.noteSendToBottom) {
      // 便笺模式启动时直接沉到底层，不抢焦点
      win.showInactive();
      sendToBottom(win);
    } else {
      win.show();
    }
  });

  win.on('blur', () => {
    if (!isNote() || !state.settings.noteSendToBottom) return;
    setTimeout(() => {
      if (alive() && isNote() && !win.isFocused()) sendToBottom(win);
    }, 120);
  });

  const onBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => saveWinPrefs(isNote() ? 'note' : 'normal'), 500);
  };
  win.on('resize', onBounds);
  win.on('move', onBounds);

  win.on('close', (e) => {
    saveWinPrefs(isNote() ? 'note' : 'normal');
    flushSave();
    // 普通模式：关闭按钮收起到托盘；便笺模式没有托盘，关闭即退出
    if (quitting || isNote()) return;
    e.preventDefault();
    win.hide();
  });
  win.on('closed', () => {
    win = null;
  });
}

/* ---------- 提醒 ---------- */

function notify(title, body, taskId) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: createWindowIcon() });
  liveNotifications.add(n);
  const release = () => liveNotifications.delete(n);
  n.on('click', () => {
    showWindow();
    if (taskId && alive()) win.webContents.send('focus-task', taskId);
    release();
  });
  n.on('close', release);
  n.show();
}

function onDue(items) {
  if (items.length <= 3) {
    for (const it of items) {
      notify(`任务到期：${it.title || '（无标题）'}`, `${it.project} · ${TaskLib.formatDue(it.due)}`, it.id);
    }
  } else {
    const names = items.slice(0, 3).map((i) => i.title || '（无标题）').join('、');
    notify(`${items.length} 个任务已到期`, `${names} 等`, items[0].id);
  }
  // 便笺模式下窗口沉在底层，把它提到前面让提醒更醒目（不抢焦点）
  if (alive() && isNote()) {
    if (!win.isVisible()) win.showInactive();
    win.moveTop();
  }
}

/* ---------- 启动 ---------- */

function start() {
  app.setAppUserModelId('local.todo-local');
  Menu.setApplicationMenu(null);

  dataDir = app.getPath('userData');
  stateFile = path.join(dataDir, 'todo-data.json');
  windowFile = path.join(dataDir, 'window.json');
  const firstRun = !fs.existsSync(stateFile);
  state = TaskLib.normalizeState(readJson(stateFile, null));
  const prefs = readJson(windowFile, {});
  winPrefs = prefs && typeof prefs === 'object' ? prefs : {};

  ipcMain.handle('state:load', (e) => (alive() && e.sender === win.webContents ? { state, dataDir, shortcut: activeShortcut } : null));
  ipcMain.on('state:save', (e, incoming) => {
    if (!alive() || e.sender !== win.webContents) return;
    const prev = state.settings;
    state = TaskLib.normalizeState(incoming);
    scheduleSave();
    onSettingsChanged(prev);
  });
  ipcMain.on('win:minimize', () => {
    if (!alive()) return;
    if (isNote()) sendToBottom(win);
    else win.minimize();
  });
  ipcMain.on('win:toggle-maximize', () => {
    if (!alive() || isNote()) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('win:close', () => {
    if (alive()) win.close();
  });
  ipcMain.on('app:quit', () => app.quit());
  ipcMain.on('app:open-data-dir', () => shell.openPath(dataDir));

  createWindow(firstRun);

  reminders = new Reminders({ getState: () => state, file: path.join(dataDir, 'reminded.json'), onDue });
  reminders.start();

  if (!registerShortcut()) {
    console.warn('[shortcut] 全局快捷键均注册失败（可能被其他程序占用），可通过再次启动程序找回窗口');
  }
}

/** 依次尝试候选快捷键，返回是否成功；成功的那个会显示在设置里 */
function registerShortcut() {
  for (const accel of SHORTCUTS) {
    try {
      if (globalShortcut.register(accel, toggleWindow)) {
        activeShortcut = accel;
        return true;
      }
    } catch {
      /* 尝试下一个 */
    }
  }
  return false;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => {
    quitting = true;
    flushSave();
    if (reminders) reminders.stop();
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(start);
}
