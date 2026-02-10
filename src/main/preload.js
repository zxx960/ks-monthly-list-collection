const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendMessage: (message) => ipcRenderer.send('message', message),
  uploadVideosToBaidu: (payload) => ipcRenderer.invoke('upload-videos-to-baidu', payload),
  onUploadVideosToBaiduProgress: (listener) => {
    const channel = 'upload-videos-to-baidu-progress';
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.off(channel, handler);
  }
})
