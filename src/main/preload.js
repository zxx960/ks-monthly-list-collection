const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendMessage: (message) => ipcRenderer.send('message', message),
  uploadVideosToBaidu: (rows) => ipcRenderer.invoke('upload-videos-to-baidu', rows),
  onUploadVideosToBaiduProgress: (listener) => {
    const channel = 'upload-videos-to-baidu-progress';
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.off(channel, handler);
  }
})
