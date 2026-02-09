const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendMessage: (message) => ipcRenderer.send('message', message),
  uploadVideosToBaidu: (rows) => ipcRenderer.invoke('upload-videos-to-baidu', rows)
})
