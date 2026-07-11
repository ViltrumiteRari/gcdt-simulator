const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentConsole', {
  getState: () => ipcRenderer.invoke('agent:get-state'),
  chooseFolder: () => ipcRenderer.invoke('agent:choose-folder'),
  openFolder: () => ipcRenderer.invoke('agent:open-folder'),
  openNotebook: () => ipcRenderer.invoke('agent:open-notebook'),
  onUpdate: callback => ipcRenderer.on('agent:update', (_event, state) => callback(state)),
});
