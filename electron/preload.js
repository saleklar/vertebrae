const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vertebrae', {
  appName: 'vertebrae',
  isElectron: true,
  onShowProperties: (callback) => {
    ipcRenderer.on('show-properties', callback);
  },
  saveSpineExport: (payload) => ipcRenderer.invoke('save-spine-export', payload)
});
