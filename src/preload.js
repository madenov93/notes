const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  folders: {
    list: () => ipcRenderer.invoke('folders:list'),
    create: (name) => ipcRenderer.invoke('folders:create', name),
    rename: (id, name) => ipcRenderer.invoke('folders:rename', id, name),
    delete: (id) => ipcRenderer.invoke('folders:delete', id),
  },
  notes: {
    list: (folderId) => ipcRenderer.invoke('notes:list', folderId),
    search: (query) => ipcRenderer.invoke('notes:search', query),
    create: (folderId) => ipcRenderer.invoke('notes:create', folderId),
    update: (id, updates) => ipcRenderer.invoke('notes:update', id, updates),
    delete: (id) => ipcRenderer.invoke('notes:delete', id),
    exportPdf: (id) => ipcRenderer.invoke('notes:export-pdf', id),
  }
});
