import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    // o observador de arquivos do Vite cobre a pasta inteira do projeto: release/ (instaladores, ~21 mil arquivos) fazia a 1ª página do
    // `npm run dev` esperar ~12 s registrando observadores. Nada fora de src/ e index.html é código do renderer.
    watch: { ignored: ['**/release/**', '**/dist/**', '**/dist-electron/**', '**/build/**', '**/data/**', '**/docs/**', '**/notebooks/**', '**/scripts/**'] },
  },
  // a varredura de dependências procura todos os .html do projeto (inclusive o LICENSES.chromium.html de 15 MB em release/): só o index.html
  optimizeDeps: { entries: ['index.html'] },
});
