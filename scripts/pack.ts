/**
 * Ferramenta de linha de comando para quem cria pacotes de dados (patches) do FOOTERA.
 *
 *   npm run pack -- validate <pasta> [<pasta> …] [--seed <semente>]   valida os pacotes nessa ordem de carga e monta o universo
 *   npm run pack -- export <pasta-destino> [--seed <semente>]         exporta a base gerada como pacote completo (ponto de partida)
 *   npm run pack -- schema [<pasta-destino>]                          gera os JSON Schema (padrão: docs/schema)
 */
import path from 'node:path';
import fs from 'node:fs';
import { generateWorld } from '../src/game/world/generator.ts';
import { compileUniverse } from '../src/game/data-pack/compile.ts';
import { exportUniverse } from '../src/game/data-pack/export.ts';
import { fmtIssue, PackError } from '../src/game/data-pack/format.ts';
import { packJsonSchemas } from '../src/game/data-pack/jsonSchema.ts';
import { readPackDir, writePackDir } from '../src/services/packService.node.ts';

const args = process.argv.slice(2);
const flag = (name: string, def: string) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1] ?? def; args.splice(i, 2); return v; };
const seed = flag('--seed', 'footera');
const [cmd, ...rest] = args;

function fail(msg: string): never { console.error(msg); process.exit(1); }

try {
  if (cmd === 'validate') {
    if (!rest.length) fail('Informe a(s) pasta(s) do(s) pacote(s), na ordem de carga.');
    const packs = rest.map((d) => readPackDir(d));
    const { world, warnings, applied } = compileUniverse(generateWorld({ seed }), packs);
    for (const w of warnings) console.log(`aviso  ${fmtIssue(w)}`);
    console.log(`\nOK: ${applied.join(' → ')}`);
    console.log(`Universo: ${world.countries.length} país(es), ${world.leagues.length} liga(s), ${world.clubs.length} clube(s), ${world.players.length} jogador(es); ${warnings.length} aviso(s).`);
  } else if (cmd === 'export') {
    const dir = rest[0] ?? fail('Informe a pasta de destino.');
    if (fs.existsSync(dir) && fs.readdirSync(dir).length) fail(`A pasta ${dir} não está vazia.`);
    const world = generateWorld({ seed });
    writePackDir(exportUniverse(world, { id: 'base', name: `Base gerada (semente ${seed})` }), dir);
    console.log(`Base exportada em ${path.resolve(dir)}: ${world.clubs.length} clubes e ${world.players.length} jogadores.`);
  } else if (cmd === 'schema') {
    const dir = rest[0] ?? path.join('docs', 'schema');
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, schema] of Object.entries(packJsonSchemas())) fs.writeFileSync(path.join(dir, name), `${JSON.stringify(schema, null, 2)}\n`);
    console.log(`JSON Schema gravados em ${path.resolve(dir)}.`);
  } else {
    fail('Uso: npm run pack -- validate <pasta…> | export <destino> | schema [destino]   (opção: --seed <semente>)');
  }
} catch (e) {
  if (e instanceof PackError) { for (const i of e.issues) console.error(`erro   ${fmtIssue(i)}`); fail(`\n${e.issues.length} problema(s): pacote não aplicado.`); }
  throw e;
}
