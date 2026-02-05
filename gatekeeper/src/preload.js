const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("Gatekeeper", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (cfg) => ipcRenderer.invoke("config:set", cfg),
  requestUnlock: (payload) => ipcRenderer.invoke("unlock:request", payload)
});
