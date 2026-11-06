const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('depthwarden', {
  quit: () => ipcRenderer.send('quit'),
  platform: process.platform,
});
