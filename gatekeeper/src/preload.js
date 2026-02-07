const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("Gatekeeper", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (cfg) => ipcRenderer.invoke("config:set", cfg),
  requestUnlock: (payload) => ipcRenderer.invoke("unlock:request", payload),
  getInstalledApps: () => ipcRenderer.invoke("apps:getInstalledApps"),
  setChatbotApiKey: (apiKey) => ipcRenderer.invoke("chatbot:setApiKey", apiKey),
  hasChatbotApiKey: () => ipcRenderer.invoke("chatbot:hasApiKey"),
  validateChatbotApiKey: () => ipcRenderer.invoke('chatbot:validateApiKey'),
  openSettings: () => ipcRenderer.invoke('window:openSettings'),
  onConfigUpdated: (cb) => {
    // allow renderer to register a callback for config updates
    ipcRenderer.on('config:updated', (_e, payload) => {
      try { cb(payload); } catch (_) { }
    });
  },
  detectModel: () => ipcRenderer.invoke('chatbot:detectModel'),
  setModelName: (modelName) => ipcRenderer.invoke('chatbot:setModelName', modelName),
  listModels: () => ipcRenderer.invoke('chatbot:listModels')
});
