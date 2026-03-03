const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onStateChange: (callback) => ipcRenderer.on('state-change', (_event, data) => callback(data)),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  showContextMenu: () => ipcRenderer.send('show-context-menu'),
  moveWindow: (dx, dy) => ipcRenderer.send('move-window', dx, dy),
  toggleFullScreen: () => ipcRenderer.send('toggle-fullscreen')
});
