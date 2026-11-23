/**
 * Laboratório no terminal — os mesmos cenários e relatórios da janela (docs/LAB.md).
 *
 *   npm run lab:run -- lista
 *   npm run lab:run -- <cenário> ajuda
 *   npm run lab:run -- <cenário> [chave=valor ...] [--saida pasta] [--sem-arquivos]
 *
 * Exemplo: npm run lab:run -- lote-partidas n=2000 homeFormation=4-3-3 awayMentality=defensive
 * Por padrão grava <pasta>/<data>-<cenário>.html e .json (pasta padrão: lab-reports/).
 */
import fs from 'node:fs';
import path from 'node:path';
import { optionsFor, runScenario, SCENARIOS, scenarioById } from './core/registry.ts';
import { reportHtml, reportText } from './core/render.ts';
import { repoRoot } from './core/universe.ts';
import { Cancelled, ParamError } from './core/types.ts';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, v && !v.startsWith('--') ? 2 : 1); return v && !v.startsWith('--') ? v : ''; };
const outDir = flag('--saida') ?? path.join(repoRoot(), 'lab-reports');
const noFiles = flag('--sem-arquivos') !== null;
const [cmd, ...rest] = argv;

function help(): void {
  console.log('Cenários:');
  for (const s of SCENARIOS) console.log(`  ${s.id.padEnd(18)} ${s.description}`);
  console.log('\nUse: npm run lab:run -- <cenário> ajuda   (parâmetros do cenário)');
}

async function main(): Promise<number> {
  if (!cmd || cmd === 'lista' || cmd === 'list' || cmd === 'ajuda' || cmd === '--help') { help(); return 0; }
  const s = scenarioById(cmd);
  if (rest[0] === 'ajuda' || rest[0] === '--help') {
    console.log(`${s.title}: ${s.description}\n\nParâmetros (chave=valor):`);
    for (const d of s.params) {
      const range = d.kind === 'number' ? ` [${d.min}–${d.max}]` : d.kind === 'boolean' ? ' [sim/não]' : '';
      const opts = d.kind === 'select' ? [...(d.options ?? []), ...(d.source && d.source !== 'clubs' ? optionsFor(d.source, {}) : [])].map((o) => o.value || '""').slice(0, 12).join(' | ') : '';
      console.log(`  ${d.key.padEnd(16)} ${d.label}${range} — padrão: ${JSON.stringify(d.default)}${opts ? `\n${' '.repeat(19)}opções: ${opts}${d.kind === 'select' && d.source === 'clubs' ? ' | ids de clube (veja o relatório "lote-partidas" ou a janela)' : ''}` : ''}`);
      if (d.help) console.log(`${' '.repeat(19)}${d.help}`);
    }
    return 0;
  }
  const given: Record<string, string> = {};
  for (const a of rest) {
    const m = a.match(/^([A-Za-z]\w*)=(.*)$/);
    if (!m) throw new ParamError(`Argumento inválido: "${a}" (use chave=valor).`);
    given[m[1]!] = m[2]!;
  }
  let last = -1;
  const report = await runScenario(s.id, given, {
    cancelled: () => false,
    onProgress: (p) => {
      const pc = Math.floor((100 * p.done) / Math.max(1, p.total));
      if (pc >= last + 10 || p.done === p.total) { last = pc; process.stderr.write(`  ${pc}%${p.label ? ` ${p.label}` : ''}\n`); }
    },
  });
  console.log(reportText(report));
  if (!noFiles) {
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = report.startedAt.replace(/[:T]/g, '-').slice(0, 19);
    const base = path.join(outDir, `${stamp}-${report.scenario}`);
    fs.writeFileSync(`${base}.html`, reportHtml(report));
    fs.writeFileSync(`${base}.json`, JSON.stringify(report));
    console.log(`\nRelatório: ${base}.html\nDados:     ${base}.json`);
  }
  return 0;
}

main().then((c) => process.exit(c), (e: unknown) => {
  if (e instanceof ParamError || e instanceof Cancelled) { console.error(`Erro: ${e.message}`); process.exit(2); }
  console.error(e); process.exit(1);
});
