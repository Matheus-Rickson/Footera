/**
 * Benchmark das chamadas do jogo (as mesmas do IPC) sobre uma CÓPIA de um save real.
 *
 *   node scripts/bench.ts [caminho/career.db] [--n 7] [--out bench.json] [--writes]
 *
 * Sem caminho: usa o save mais recente em %APPDATA%/football-manager-simulator/data/saves. O arquivo original nunca é aberto para escrita
 * (copia .db + -wal para uma pasta temporária). Para cada chamada de leitura: 1 aquecimento (a 1ª chamada da conexão roda as migrações e
 * verificações) + N medições; registra média, p95, consultas SQL por chamada, tempo dentro do SQLite e as consultas mais lentas.
 * `--writes`: também mede avançar dias e simular rodadas (cada uma numa cópia nova do save).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import * as sqlite from 'node:sqlite';

// ---------------------------------------------------------------- instrumentação do SQLite (conta e cronometra cada execução)
type Stat = { count: number; ms: number };
let current: Map<string, Stat> | null = null;
const proto = (sqlite as unknown as { StatementSync: { prototype: Record<string, unknown> } }).StatementSync.prototype;
for (const m of ['all', 'get', 'run', 'iterate'] as const) {
  const orig = proto[m] as (...a: unknown[]) => unknown;
  proto[m] = function (this: { sourceSQL: string }, ...a: unknown[]) {
    if (!current) return orig.apply(this, a);
    const t = performance.now();
    try { return orig.apply(this, a); } finally {
      const sql = this.sourceSQL.replace(/\s+/g, ' ').trim().slice(0, 160);
      const s = current.get(sql) ?? { count: 0, ms: 0 };
      s.count++; s.ms += performance.now() - t; current.set(sql, s);
    }
  };
}
let prepares = 0;
{
  const db = (sqlite as unknown as { DatabaseSync: { prototype: Record<string, unknown> } }).DatabaseSync.prototype;
  const orig = db.prepare as (...a: unknown[]) => unknown;
  db.prepare = function (...a: unknown[]) { if (current) prepares++; return orig.apply(this, a); };
}

const svc = await import('../src/services/saveService.node.ts');

// ---------------------------------------------------------------- argumentos e cópia do save
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
const N = Number(opt('--n', '7'));
const outFile = opt('--out', '');
const writes = args.includes('--writes');
function newestSave(): string {
  const root = path.join(process.env.APPDATA ?? '', 'football-manager-simulator', 'data', 'saves');
  const all: Array<{ f: string; t: number }> = [];
  for (const p of fs.existsSync(root) ? fs.readdirSync(root) : []) for (const c of fs.readdirSync(path.join(root, p))) {
    const f = path.join(root, p, c, 'career.db');
    if (fs.existsSync(f)) all.push({ f, t: fs.statSync(f).mtimeMs });
  }
  if (!all.length) throw new Error('Nenhum save encontrado; informe o caminho do career.db.');
  return all.sort((a, b) => b.t - a.t)[0]!.f;
}
const source = args[0] && !args[0].startsWith('--') ? args[0] : newestSave();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'footera-bench-'));
let copyNo = 0;
const PROFILE = '00000000-0000-4000-8000-00000000be0c';
function freshCopy(): { base: string; profile: string; career: string } {
  const career = `0000000${++copyNo}-0000-4000-8000-000000000000`.slice(-36);
  const dir = path.join(tmp, 'saves', PROFILE, career);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(source, path.join(dir, 'career.db'));
  if (fs.existsSync(`${source}-wal`)) fs.copyFileSync(`${source}-wal`, path.join(dir, 'career.db-wal'));
  return { base: tmp, profile: PROFILE, career };
}

// ---------------------------------------------------------------- medição
type Row = { name: string; kb?: number; meanMs: number; p95Ms: number; minMs: number; queries: number; prepares: number; sqlMs: number; top: Array<{ sql: string; count: number; ms: number }> };
const rows: Row[] = [];
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!; };
const r1 = (x: number) => Math.round(x * 10) / 10;

async function measure(name: string, fn: () => Promise<unknown>, n = N): Promise<void> {
  try { await fn(); } catch (e) { console.log(`${name.padEnd(28)} ERRO: ${e instanceof Error ? e.message : e}`); return; }
  const times: number[] = [];
  let last = new Map<string, Stat>(), lastPrep = 0, kb = 0;
  for (let i = 0; i < n; i++) {
    current = new Map(); prepares = 0;
    const t = performance.now();
    const out = await fn();
    if (i === 0) kb = Math.round(JSON.stringify(out ?? null).length / 102.4) / 10; // tamanho da resposta (o IPC serializa)
    times.push(performance.now() - t);
    last = current; lastPrep = prepares; current = null;
  }
  const stats = [...last].map(([sql, s]) => ({ sql, ...s }));
  const row: Row = {
    name, kb, meanMs: r1(times.reduce((s, x) => s + x, 0) / n), p95Ms: r1(q(times, 0.95)), minMs: r1(Math.min(...times)),
    queries: stats.reduce((s, x) => s + x.count, 0), prepares: lastPrep, sqlMs: r1(stats.reduce((s, x) => s + x.ms, 0)),
    top: stats.sort((a, b) => b.ms - a.ms).slice(0, 3).map((x) => ({ sql: x.sql, count: x.count, ms: r1(x.ms) })),
  };
  rows.push(row);
  console.log(`${name.padEnd(28)} média ${String(row.meanMs).padStart(7)} ms  p95 ${String(row.p95Ms).padStart(7)} ms  consultas ${String(row.queries).padStart(6)}  prepare ${String(row.prepares).padStart(5)}  SQL ${String(row.sqlMs).padStart(7)} ms  resposta ${String(kb).padStart(7)} KB`);
}

const mem0 = process.memoryUsage();
const ref = freshCopy();
const R = [ref.base, ref.profile, ref.career] as const;
console.log(`save: ${source} (${Math.round(fs.statSync(source).size / 1e6)} MB), N = ${N}\n`);

const tOpen = performance.now();
const ov = await svc.openCareer(...R);
console.log(`openCareer (1ª, com migrações/verificações): ${r1(performance.now() - tOpen)} ms\n`);
const comps = await svc.listCompetitionsFor(...R);
const compId = comps.userCompetitionId ?? comps.competitions[0]!.id;
const cupComp = comps.competitions.find((c) => c.kind === 'cup')?.id;
const stagedComp = comps.competitions.find((c) => c.kind !== 'league' && c.kind !== 'cup')?.id;
const playerId = ov.squad[0]?.id ?? '';
const clubId = ov.summary.clubId;
const cal = await svc.getCalendar(...R);
const played = cal.fixtures.find((f) => f.status === 'played' && f.hasReport)?.id;

await measure('openCareer', () => svc.openCareer(...R));
await measure('getCalendar', () => svc.getCalendar(...R));
await measure('listCompetitions', () => svc.listCompetitionsFor(...R));
await measure('getTable', () => svc.getTable(...R, compId));
await measure('getLeaders', () => svc.getLeaders(...R, compId));
await measure('getRound', () => svc.getRound(...R, compId, 1));
if (played) await measure('getReport', () => svc.getReport(...R, played));
if (cupComp) await measure('cupBracket', () => svc.cupBracket(...R, cupComp));
if (stagedComp) await measure('stagedView', () => svc.stagedView(...R, stagedComp));
await measure('getTactics', () => svc.getTactics(...R));
await measure('getFinance', () => svc.getFinance(...R));
await measure('financeLedger', () => svc.financeLedger(...R, { page: 0 }));
await measure('getTransfers', () => svc.getTransfers(...R));
await measure('searchMarket (todos)', () => svc.searchTransferMarket(...R, {}));
await measure('searchMarket (nome)', () => svc.searchTransferMarket(...R, { name: 'silva' }));
await measure('searchMarket (livres)', () => svc.searchTransferMarket(...R, { freeOnly: true }));
let variant = 0; // filtro diferente a cada chamada: mede a busca sem o cache de leitura
await measure('searchMarket (sem cache)', () => svc.searchTransferMarket(...R, { maxValue: 2_000_000_000 - ++variant }));
await measure('searchMarket (pág. 2)', () => svc.searchTransferMarket(...R, { offset: 100, limit: 100 }));
await measure('getSeason', () => svc.getSeason(...R));
await measure('listContracts', () => svc.listContracts(...R));
await measure('listNews', () => svc.listNews(...R));
await measure('socialFeed', () => svc.socialFeed(...R, 'all'));
await measure('careerHistory', () => svc.careerHistory(...R));
await measure('trophyRoom', () => svc.trophyRoom(...R));
await measure('coachCareer', () => svc.coachCareer(...R));
await measure('getBoard', () => svc.getBoard(...R));
await measure('getScouting', () => svc.getScouting(...R));
await measure('getYouth', () => svc.getYouth(...R));
if (playerId) await measure('playerProfile', () => svc.playerProfile(...R, playerId));
await measure('getTraining', () => svc.getTraining(...R));
await measure('getStaff', () => svc.getStaff(...R));
await measure('getMedical', () => svc.getMedical(...R));
await measure('getInfrastructure', () => svc.getInfrastructure(...R));
await measure('clubInfo', () => svc.clubInfo(...R, clubId));
await measure('clubProfile', () => svc.clubProfile(...R, clubId));
await measure('conversations', () => svc.conversations(...R));
await measure('unemployedCoaches', () => svc.unemployedCoaches(...R));

if (writes) {
  console.log('\nescritas (cada uma em cópia nova; inclui a 1ª abertura):');
  const once = async (name: string, fn: (r: readonly [string, string, string]) => Promise<unknown>, reps = 3) => {
    const times: number[] = []; let qs = 0, sqlMs = 0; let top: Row['top'] = [];
    for (let i = 0; i < reps; i++) {
      const c = freshCopy(); const rr = [c.base, c.profile, c.career] as const;
      await svc.openCareer(...rr);
      current = new Map();
      const t = performance.now(); await fn(rr); times.push(performance.now() - t);
      qs = [...current.values()].reduce((s, x) => s + x.count, 0);
      if (i === reps - 1) { sqlMs = [...current.values()].reduce((s, x) => s + x.ms, 0); top = [...current].map(([sql, x]) => ({ sql, count: x.count, ms: r1(x.ms) })).sort((a, b) => b.ms - a.ms).slice(0, 6); }
      current = null;
      svc.closeAllCareerDbs();
    }
    rows.push({ name, meanMs: r1(times.reduce((s, x) => s + x, 0) / reps), p95Ms: r1(Math.max(...times)), minMs: r1(Math.min(...times)), queries: qs, prepares: 0, sqlMs: r1(sqlMs), top });
    console.log(`${name.padEnd(28)} média ${r1(times.reduce((s, x) => s + x, 0) / reps)} ms  (min ${r1(Math.min(...times))}, máx ${r1(Math.max(...times))})  consultas ${qs}  SQL ${r1(sqlMs)} ms`);
    for (const t of top) console.log(`    ${String(t.ms).padStart(7)} ms ×${String(t.count).padStart(5)}  ${t.sql}`);
  };
  await once('avançar 1 dia', (rr) => svc.continueCareerDay(...rr));
  await once('avançar 7 dias', async (rr) => { for (let i = 0; i < 7; i++) await svc.continueCareerDay(...rr); }, 2);
  await once('próxima rodada (avançar)', (rr) => svc.advanceCareer(...rr, 'nextMatchday'), 2);
}

(globalThis as { gc?: () => void }).gc?.(); // com --expose-gc: memória depois da coleta (comparável entre versões)
const mem1 = process.memoryUsage();
console.log(`\nmemória: rss ${Math.round(mem0.rss / 1e6)} → ${Math.round(mem1.rss / 1e6)} MB, heap ${Math.round(mem0.heapUsed / 1e6)} → ${Math.round(mem1.heapUsed / 1e6)} MB`);
console.log('\nconsultas mais lentas por chamada (última medição):');
for (const r of [...rows].sort((a, b) => b.meanMs - a.meanMs).slice(0, 12)) for (const t of r.top.slice(0, 2)) console.log(`  ${r.name.padEnd(24)} ${String(t.ms).padStart(7)} ms ×${t.count}  ${t.sql}`);
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ source, n: N, date: new Date().toISOString(), rss: mem1.rss, rows }, null, 2));
svc.closeAllCareerDbs();
// limpa só o que criou (as cópias), arquivo por arquivo
for (let i = 1; i <= copyNo; i++) {
  const dir = path.join(tmp, 'saves', PROFILE, `0000000${i}-0000-4000-8000-000000000000`.slice(-36));
  for (const f of ['career.db', 'career.db-wal', 'career.db-shm']) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* não existe */ } }
  try { fs.rmdirSync(dir); } catch { /* sobrou algo: o sistema limpa a pasta temporária */ }
}
for (const d of [path.join(tmp, 'saves', PROFILE), path.join(tmp, 'saves'), tmp]) { try { fs.rmdirSync(d); } catch { /* idem */ } }
