/** Ponte segura entre a janela do Laboratório e o processo principal (contextIsolation). */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lab', {
  catalog: () => ipcRenderer.invoke('lab:catalog'),
  options: (source: string, params: Record<string, unknown>) => ipcRenderer.invoke('lab:options', source, params),
  run: (id: string, params: Record<string, unknown>) => ipcRenderer.invoke('lab:run', id, params),
  cancel: () => ipcRenderer.invoke('lab:cancel'),
  save: (report: unknown) => ipcRenderer.invoke('lab:save', report),
  openReports: () => ipcRenderer.invoke('lab:open-reports'),
  onProgress: (fn: (p: unknown) => void) => {
    const h = (_e: unknown, p: unknown) => fn(p);
    ipcRenderer.on('lab:progress', h);
    return () => { ipcRenderer.removeListener('lab:progress', h); };
  },
});
