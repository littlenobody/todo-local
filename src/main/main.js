'use strict';
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, globalShortcut, screen, shell } = require('electron');
const { readJson, writeJsonAtomic, writeTextAtomic } = require('./store');
const TaskLib = require('../shared/tasks.js');
const MemoLib = require('../shared/memo.js');
const { Reminders } = require('./reminders');
const { sendToBottom } = require('./zorder');
const { createWindowIcon, createTrayIcon } = require('./icon');
const { createUpdater } = require('./updater');
const { createEdgeDock } = require('./edge-dock');

const MIN_W = 280;
const MIN_H = 320;
const DEFAULT_SIZE = { normal: { width: 1100, height: 720 }, note: { width: 340, height: 520 } };
const SHORTCUTS = ['CommandOrControl+Alt+T', 'CommandOrControl+Alt+Shift+T', 'CommandOrControl+Alt+J', 'CommandOrControl+Alt+Shift+J'];
let activeShortcut = '';

let win = null;
let tray = null;
let reminders = null;
let updater = null;
let state = null;
let winPrefs = {};
let dataDir = '';
let memosDir = '';
let stateFile = '';
let windowFile = '';
let saveTimer = null;
let boundsTimer = null;
let dirty = false;
let quitting = false;
const liveNotifications = new Set();

const isNote = () => !!state.settings.noteMode;
const alive = () => win && !win.isDestroyed();

/** 便笺贴边收起：仅在便笺模式且开启该设置时生效 */
const edgeDock = createEdgeDock({
  screen,
  getWin: () => win,
  isActive: () => !!state && !!win && isNote() && !!state.settings.noteEdgeDock,
  onChange: () => applyLayer(),
});

/** 失去焦点后是否应把便笺沉到底层（置顶、缩在边缘时都不能沉） */
const shouldSink = () =>
  isNote() && !!state.settings.noteSendToBottom && !state.settings.noteAlwaysOnTop && !edgeDock.isCollapsed();

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
  // 便笺缩在屏幕边缘时，保存展开后的位置；缩起来的位置下次启动会被当成“在屏幕外”而丢弃
  const rest = edgeDock.restBounds();
  winPrefs[mode] = rest ? { ...win.getNormalBounds(), x: rest.x, y: rest.y } : win.getNormalBounds();
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
  edgeDock.expand();
  win.moveTop();
  win.focus();
}

function toggleWindow() {
  if (!alive()) return;
  if (win.isVisible() && !win.isMinimized() && win.isFocused()) {
    if (isNote()) {
      // 置顶的窗口沉不下去，改为最小化到任务栏
      if (state.settings.noteAlwaysOnTop) win.minimize();
      else sendToBottom(win);
    } else win.hide();
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

/**
 * 窗口层级：便笺模式下，设置了置顶，或缩在屏幕边缘时（否则露出的那一条会被别的窗口盖住）保持置顶。
 * 其余情况交给失焦时的“沉到底层”逻辑。
 */
function applyLayer() {
  if (!alive()) return;
  win.setAlwaysOnTop(isNote() && (!!state.settings.noteAlwaysOnTop || edgeDock.isCollapsed()));
}

/** 根据当前模式应用窗口特性：透明度、层级、贴边、托盘图标（便笺模式保留任务栏项，否则不会出现在 alt+tab 中） */
function applyTraits() {
  if (!alive()) return;
  const note = isNote();
  win.setMaximizable(!note);
  win.setOpacity(note ? state.settings.noteOpacity : 1);
  applyLayer();
  if (note) destroyTray();
  else createTray();
  edgeDock.refresh();
}

function applyAutoStart(enable) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enable,
      path: process.execPath,
      args: [],
    });
  } catch (err) {
    console.warn('[autostart] 设置开机自启失败：', err.message);
  }
}

function onSettingsChanged(prev) {
  const cur = state.settings;
  if (cur.noteMode !== prev.noteMode) {
    saveWinPrefs(prev.noteMode ? 'note' : 'normal');
    edgeDock.release(); // 先把缩在边缘的窗口放回去，再换到另一种模式的位置
    if (win.isMaximized()) win.unmaximize();
    win.setBounds(resolveBounds(cur.noteMode ? 'note' : 'normal'));
    applyTraits();
    showWindow();
  } else if (
    cur.noteOpacity !== prev.noteOpacity ||
    cur.noteAlwaysOnTop !== prev.noteAlwaysOnTop ||
    cur.noteEdgeDock !== prev.noteEdgeDock
  ) {
    applyTraits();
  }
  if (cur.autoStart !== prev.autoStart) {
    applyAutoStart(cur.autoStart);
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
    if (isNote() && !firstRun && shouldSink()) {
      // 便笺模式启动时直接沉到底层，不抢焦点
      win.showInactive();
      sendToBottom(win);
    } else {
      win.show();
    }
  });

  win.on('blur', () => {
    if (!shouldSink()) return;
    setTimeout(() => {
      if (alive() && shouldSink() && !win.isFocused()) sendToBottom(win);
    }, 120);
  });

  const onBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => saveWinPrefs(isNote() ? 'note' : 'normal'), 500);
  };
  win.on('resize', onBounds);
  win.on('move', onBounds);
  // 拖动 / 缩放结束后判断是否贴到了屏幕边缘（Windows 上 moved、resized 只在操作结束时触发）
  win.on('moved', () => edgeDock.refresh());
  win.on('resized', () => edgeDock.refresh());

  win.on('close', (e) => {
    saveWinPrefs(isNote() ? 'note' : 'normal');
    flushSave();
    // 普通模式：关闭按钮收起到托盘；便笺模式没有托盘，关闭即退出
    if (quitting || isNote()) return;
    e.preventDefault();
    win.hide();
  });
  win.on('closed', () => {
    edgeDock.release();
    win = null;
  });
}

/* ---------- 项目备忘录文件 ---------- */

const memoFile = (id) => path.join(memosDir, `${id}.html`);

function removeMemoFiles(id) {
  if (!MemoLib.isValidMemoId(id)) return;
  const file = memoFile(id);
  for (const f of [file, `${file}.bak`, `${file}.tmp`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch (err) {
      console.warn('[memo] 清理备忘录失败：', err.message);
    }
  }
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
      notify(`任务到期：${it.label}`, `${it.project} · ${TaskLib.formatDue(it.due)}`, it.id);
    }
  } else {
    const names = items.slice(0, 3).map((i) => i.label).join('、');
    notify(`${items.length} 个任务已到期`, `${names} 等`, items[0].id);
  }
  // 便笺模式下窗口沉在底层，把它提到前面让提醒更醒目（不抢焦点）
  if (alive() && isNote()) {
    if (!win.isVisible()) win.showInactive();
    win.moveTop();
    edgeDock.expand(8000); // 缩在边缘时先展开，并保持一会儿，免得提醒还没看清就缩回去
  }
}

/* ---------- 启动 ---------- */

function start() {
  app.setAppUserModelId('local.todo-local');
  Menu.setApplicationMenu(null);

  dataDir = app.getPath('userData');
  memosDir = path.join(dataDir, 'memos');
  stateFile = path.join(dataDir, 'todo-data.json');
  windowFile = path.join(dataDir, 'window.json');
  const firstRun = !fs.existsSync(stateFile);
  const rawState = readJson(stateFile, null);
  if (TaskLib.hasLegacyTitles(rawState)) {
    // 任务不再有标题，旧标题会并入备注；迁移前留一份原始数据（只创建一次）
    const legacyBak = `${stateFile}.pre-notitle.bak`;
    try {
      if (!fs.existsSync(legacyBak)) fs.copyFileSync(stateFile, legacyBak);
    } catch (err) {
      console.warn('[store] 迁移前备份失败：', err.message);
    }
  }
  state = TaskLib.normalizeState(rawState);
  applyAutoStart(state.settings.autoStart);
  const prefs = readJson(windowFile, {});
  winPrefs = prefs && typeof prefs === 'object' ? prefs : {};

  ipcMain.handle('state:load', (e) => (alive() && e.sender === win.webContents ? { state, dataDir, shortcut: activeShortcut, version: app.getVersion() } : null));
  ipcMain.on('state:save', (e, incoming) => {
    if (!alive() || e.sender !== win.webContents) return;
    const prev = state.settings;
    const prevIds = state.projects.map((p) => p.id);
    state = TaskLib.normalizeState(incoming);
    // 项目被删除后，连带清理它的备忘录文件
    for (const id of prevIds) {
      if (!state.projects.some((p) => p.id === id)) removeMemoFiles(id);
    }
    scheduleSave();
    onSettingsChanged(prev);
  });
  ipcMain.on('win:minimize', () => {
    if (!alive()) return;
    if (isNote()) {
      if (state.settings.noteAlwaysOnTop) win.minimize();
      else sendToBottom(win);
    } else win.minimize();
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
  ipcMain.on('app:open-external', (e, url) => {
    if (!alive() || e.sender !== win.webContents) return;
    const href = MemoLib.safeLinkHref(url); // 只放行 http / https / mailto
    if (href) shell.openExternal(href);
  });

  /* 项目备忘录：每个项目一个 HTML 文件（图片以 data URL 内嵌），和任务数据分开存放 */
  ipcMain.handle('memo:load', (e, id) => {
    if (!alive() || e.sender !== win.webContents || !MemoLib.isValidMemoId(id)) return null;
    try {
      return fs.readFileSync(memoFile(id), 'utf8');
    } catch (err) {
      return err && err.code === 'ENOENT' ? '' : null;
    }
  });
  ipcMain.handle('memo:save', (e, id, html) => {
    if (!alive() || e.sender !== win.webContents || !MemoLib.isValidMemoId(id)) return false;
    if (!state.projects.some((p) => p.id === id)) return false; // 已删除或不存在的项目不再写入
    if (typeof html !== 'string' || html.length > MemoLib.MAX_MEMO_CHARS) return false;
    try {
      writeTextAtomic(memoFile(id), html, true);
      return true;
    } catch (err) {
      console.error('[memo] 保存失败：', err);
      return false;
    }
  });

  updater = createUpdater({
    dir: path.join(dataDir, 'updates'),
    onChange: (s) => {
      if (alive()) win.webContents.send('update:status', s);
    },
    onInstall: () => app.quit(),
  });
  const fromWin = (e) => alive() && e.sender === win.webContents;
  ipcMain.handle('update:status', (e) => (fromWin(e) ? updater.status() : null));
  ipcMain.handle('update:check', (e) => (fromWin(e) ? updater.check().then(() => updater.status()) : null));
  ipcMain.handle('update:install', (e) => fromWin(e) && updater.install());

  createWindow(firstRun);

  // 显示器增减、分辨率或任务栏变化后，缩在边缘的窗口可能落到屏幕外：先放回，再按新布局重新判断
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(ev, () => {
      edgeDock.release();
      edgeDock.refresh();
    });
  }

  reminders = new Reminders({ getState: () => state, file: path.join(dataDir, 'reminded.json'), onDue });
  reminders.start();
  updater.start();

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
