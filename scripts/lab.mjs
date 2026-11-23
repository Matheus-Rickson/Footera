// npm run lab: compila e abre a janela do Laboratório (docs/LAB.md). `--so-compilar` só compila.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-lab');

await vite({ configFile: path.join(root, 'lab', 'vite.config.ts'), logLevel: 'warn' });
const common = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'], sourcemap: true, logLevel: 'warning' };
for (const name of ['main', 'preload', 'worker']) {
  await esbuild({ ...common, entryPoints: [path.join(root, 'lab', 'electron', `${name}.ts`)], outfile: path.join(out, `${name}.cjs`) });
}
console.log('Laboratório compilado em dist-lab/.');
if (process.argv.includes('--so-compilar')) process.exit(0);

// ELECTRON_RUN_AS_NODE (terminais do VS Code) faria o Electron rodar como Node puro, sem janela
const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
const app = spawn(require('electron'), [path.join(out, 'main.cjs')], { stdio: 'inherit', env: { ...env, FOOTERA_LAB_ROOT: root }, cwd: root });
app.on('exit', (code) => process.exit(code ?? 0));
