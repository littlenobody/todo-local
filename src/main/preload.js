'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('state:load'),
  save: (state) => ipcRenderer.send('state:save', state),
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
  close: () => ipcRenderer.send('win:close'),
  quit: () => ipcRenderer.send('app:quit'),
  openDataDir: () => ipcRenderer.send('app:open-data-dir'),
  openExternal: (url) => ipcRenderer.send('app:open-external', url),
  loadMemo: (projectId) => ipcRenderer.invoke('memo:load', projectId),
  saveMemo: (projectId, html) => ipcRenderer.invoke('memo:save', projectId, html),
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb) => ipcRenderer.on('update:status', (_e, s) => cb(s)),
  onFocusTask: (cb) => ipcRenderer.on('focus-task', (_e, id) => cb(id)),
  onSetMode: (cb) => ipcRenderer.on('set-mode', (_e, noteMode) => cb(!!noteMode)),
});
