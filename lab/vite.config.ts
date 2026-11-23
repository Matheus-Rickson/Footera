import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// janela do Laboratório: build separado do jogo (dist-lab/renderer), fora do instalador
export default defineConfig({
  root: fileURLToPath(new URL('./renderer', import.meta.url)),
  plugins: [react()],
  base: './',
  build: { outDir: fileURLToPath(new URL('../dist-lab/renderer', import.meta.url)), emptyOutDir: true },
});
