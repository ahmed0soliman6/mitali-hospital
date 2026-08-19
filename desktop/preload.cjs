const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('MitaliDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,
  appVersion: 'v1.3.33',
  getUpdateState: () => ipcRenderer.invoke('update:get-state'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('update-state', listener);
    return () => ipcRenderer.removeListener('update-state', listener);
  },
}));
