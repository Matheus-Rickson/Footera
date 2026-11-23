/**
 * Processo principal do Laboratório (npm run lab). Janela própria, separada do jogo; cada execução roda num worker.
 * Relatórios salvos em <repo>/lab-reports (HTML + JSON). Nada aqui escreve em saves do usuário (ver lab/core/saves.ts).
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { scenarioCatalog } from '../core/registry.ts';
import { reportHtml } from '../core/render.ts';
import type { Report } from '../core/types.ts';

const ROOT = process.env.FOOTERA_LAB_ROOT ?? path.resolve(__dirname, '..');
process.env.FOOTERA_LAB_ROOT = ROOT;
const REPORTS = path.join(ROOT, 'lab-reports');
let win: BrowserWindow | null = null;
let running: Worker | null = null;

function inWorker<T>(data: unknown, onProgress?: (p: unknown) => void): { promise: Promise<T>; worker: Worker } {
  const worker = new Worker(path.join(__dirname, 'worker.cjs'), { workerData: data });
  const promise = new Promise<T>((resolve, reject) => {
    worker.on('message', (m: { type: string; value: unknown }) => {
      if (m.type === 'progress') onProgress?.(m.value);
      else if (m.type === 'result') { resolve(m.value as T); void worker.terminate(); }
      else if (m.type === 'error') { reject(new Error(String(m.value))); void worker.terminate(); }
    });
    worker.on('error', reject);
    worker.on('exit', (code) => reject(new Error(code === 1 ? 'Execução cancelada.' : `O cenário parou (código ${code}).`)));
  });
  return { promise, worker };
}

ipcMain.handle('lab:catalog', () => scenarioCatalog());
ipcMain.handle('lab:options', (_e, source: string, params: Record<string, unknown>) => inWorker({ type: 'options', source, params }).promise);
ipcMain.handle('lab:run', async (e, id: string, params: Record<string, unknown>) => {
  if (running) throw new Error('Já há um cenário rodando: espere ou cancele.');
  const job = inWorker<Report>({ type: 'run', id, params }, (p) => e.sender.send('lab:progress', p));
  running = job.worker;
  try { return await job.promise; } finally { running = null; }
});
ipcMain.handle('lab:cancel', async () => { if (running) { await running.terminate(); running = null; } return true; });
ipcMain.handle('lab:save', (_e, report: Report) => {
  fs.mkdirSync(REPORTS, { recursive: true });
  const base = path.join(REPORTS, `${report.startedAt.replace(/[:T]/g, '-').slice(0, 19)}-${report.scenario}`);
  fs.writeFileSync(`${base}.html`, reportHtml(report));
  fs.writeFileSync(`${base}.json`, JSON.stringify(report));
  return `${base}.html`;
});
ipcMain.handle('lab:open-reports', async () => { fs.mkdirSync(REPORTS, { recursive: true }); return shell.openPath(REPORTS); });

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1024, minHeight: 640, title: 'FOOTERA · Laboratório', backgroundColor: '#0b1120', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  void win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
});
app.on('window-all-closed', () => app.quit());
