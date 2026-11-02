import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const URL = 'http://127.0.0.1:5173';
// 'vite/bin/vite.js' não é exportado pelo pacote; 'vite/package.json' é.
const viteBin = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
const vite = spawn(process.execPath, [viteBin, '--host', '127.0.0.1'], { stdio: 'inherit' });

async function waitForVite() {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(URL); if (r.ok) return; } catch { /* aguardando */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Vite não respondeu em 20 s.');
}

try {
  await waitForVite();
  await import('./build-electron.mjs');
  const electronPath = require('electron');
  const app = spawn(electronPath, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: URL } });
  app.on('exit', () => { vite.kill(); process.exit(0); });
} catch (e) {
  console.error(e); vite.kill(); process.exit(1);
}
