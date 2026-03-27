const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vertebrae', {
  appName: 'vertebrae',
  isElectron: true,
  onShowProperties: (callback) => {
    ipcRenderer.on('show-properties', callback);
  },
  saveSpineExport: (payload) => ipcRenderer.invoke('save-spine-export', payload),
  saveLightningExport: (payload) => ipcRenderer.invoke('save-lightning-export', payload),
  saveCaptureSequence: (payload) => ipcRenderer.invoke('save-capture-sequence', payload),
  importSpineFile: (opts) => ipcRenderer.invoke('import-spine-file', opts ?? {}),
});
