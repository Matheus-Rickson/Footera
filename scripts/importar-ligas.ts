/**
 * Importa para o pacote "1" as planilhas editadas (atributos) e a extração futmob 2026/27 de seis divisões: 2. Bundesliga (ger-2),
 * 3. Liga (ger-3), Premier League (eng-1), Championship (eng-2), League One (eng-3) e League Two (eng-4). Decisões do usuário (08/11/2026):
 * - as planilhas (formato do editor, ids da base, atributos) mandam; cada clube é completado com os jogadores da extração que faltam
 *   (força estimada por regressão nos jogadores com atributos);
 * - os 12 clubes ingleses que a base não tem (24 por divisão na realidade × 20 na base) são criados no pacote;
 * - jogador que aparece duas vezes (livre no pacote com id antigo e de novo numa planilha): fica o da planilha, o antigo é removido.
 * Fotos, escudos, técnicos e logos da extração vão para images/ do pacote no padrão do jogo.
 *
 *   node --disable-warning=ExperimentalWarning scripts/importar-ligas.ts [--gravar]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { careerUniverse } from '../src/services/packManager.node.ts';
import { compileUniverse } from '../src/game/data-pack/compile.ts';
import { EMPTY_WORLD, basePack } from '../src/services/universeService.node.ts';
import { readPackDir, writePackDir } from '../src/services/packService.node.ts';
import { setPackImage, validateImage } from '../src/services/imageService.node.ts';
import { parseCsv, rowsToRecords } from '../src/game/data-pack/csv.ts';
import { slugify } from '../src/shared/slug.ts';
import { nationOf } from '../src/shared/nations.ts';
import type { Position } from '../src/shared/types.ts';

// ---------------------------------------------------------------- parâmetros
const ROOT = 'D:/DATA BASE FOOTERA';
const EXT = `${ROOT}/futmob database/dados`;
const DATA_DIR = path.join(process.env.APPDATA ?? '', 'football-manager-simulator', 'data');
const PACOTE = '1';
const SAIDA = `${ROOT}/importacao-2026-27`;
const GRAVAR = process.argv.includes('--gravar');
const SQUAD_MAX = 40;
interface Liga { lg: string; ext: string; players: string; clubs: string; coaches: string }
const LIGAS: Liga[] = [
  { lg: 'ger-2', ext: '2-bundesliga_146/2026-2027', players: 'csv_editor_ger/jogadores-ger-ger-2.csv', clubs: 'csv_editor_ger/clubes-ger-ger-2.csv', coaches: 'csv_editor_ger/tecnicos-ger-ger-2.csv' },
  { lg: 'ger-3', ext: '3-liga_208/2026-2027', players: 'csv_editor_ger/jogadores-ger-ger-3.csv', clubs: 'csv_editor_ger/clubes-ger-ger-3.csv', coaches: 'csv_editor_ger/tecnicos-ger-ger-3.csv' },
  { lg: 'eng-1', ext: 'premier-league_47/2026-2027', players: 'csv_editor_eng/jogadores-eng-eng-1.csv', clubs: 'csv_editor_eng/clubes-eng-eng-1.csv', coaches: 'csv_editor_eng/tecnicos-eng-eng-1.csv' },
  { lg: 'eng-2', ext: 'championship_48/2026-2027', players: 'csv_editor_eng/jogadores-eng-eng-2.csv', clubs: 'csv_editor_eng/clubes-eng-eng-2.csv', coaches: 'csv_editor_eng/tecnicos-eng-eng-2.csv' },
  { lg: 'eng-3', ext: 'league-one_108/2026-2027', players: 'csv_editor_eng/jogadores-eng-eng-3.csv', clubs: 'csv_editor_eng/clubes-eng-eng-3.csv', coaches: 'csv_editor_eng/tecnicos-eng-eng-3.csv' },
  { lg: 'eng-4', ext: 'league-two_109/2026-2027', players: 'csv_editor_eng/jogadores-eng-eng-4.csv', clubs: 'csv_editor_eng/clubes-eng-eng-4.csv', coaches: 'csv_editor_eng/tecnicos-eng-eng-4.csv' },
];
const LEAGUE_CSVS = ['csv_editor_ger/ligas-ger-2-3.csv', 'csv_editor_eng/ligas-eng.csv'];
/** clubes ingleses que a base não tem: sigla e cidade reais */
const NOVOS: Record<string, { sigla: string; cidade: string }> = {
  'Queens Park Rangers': { sigla: 'QPR', cidade: 'Londres' }, 'Preston North End': { sigla: 'PNE', cidade: 'Preston' }, 'Lincoln City': { sigla: 'LIN', cidade: 'Lincoln' },
  'Charlton Athletic': { sigla: 'CHA', cidade: 'Londres' }, 'Stevenage': { sigla: 'STE', cidade: 'Stevenage' }, 'Bromley': { sigla: 'BRO', cidade: 'Londres' },
  'Wycombe Wanderers': { sigla: 'WYC', cidade: 'High Wycombe' }, 'Burton Albion': { sigla: 'BRT', cidade: 'Burton upon Trent' }, 'Salford City': { sigla: 'SAL', cidade: 'Salford' },
  'Fleetwood Town': { sigla: 'FLE', cidade: 'Fleetwood' }, 'Barnet': { sigla: 'BNT', cidade: 'Londres' }, 'Accrington Stanley': { sigla: 'ACC', cidade: 'Accrington' },
};
const METODOLOGIA: Record<string, string> = { defensiva: 'defensive', posse: 'possession', agressiva: 'aggressive' };

// ---------------------------------------------------------------- utilidades
type Row = Record<string, string>;
type Rec = Record<string, unknown>;
function readCsv(file: string): Row[] {
  const { rows } = parseCsv(fs.readFileSync(file, 'utf8'));
  const head = rows[0]!.cells.map((h) => h.replace(/^\uFEFF/, '').trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r.cells[i] ?? '').trim()])));
}
const norm = (s: string) => s.replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const lastToken = (s: string) => norm(s).split(' ').at(-1) ?? '';
const STOP = new Set(['fc', 'sc', 'sv', 'ssv', 'afc', 'cf', 'vfl', 'tsv', 'sg', '1', '04', '1904', 'the']);
const ALIAS: Record<string, string> = { rw: 'rot weiss' };
const teamTokens = (s: string) => new Set(norm(s).split(' ').map((t) => ALIAS[t] ?? t).join(' ').split(' ').filter((t) => t && !STOP.has(t)));
const teamScore = (a: string, b: string) => { const A = teamTokens(a), B = teamTokens(b); const inter = [...A].filter((t) => B.has(t)).length; return inter / Math.max(1, Math.min(A.size, B.size)); };
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const splitName = (nome: string): [string, string] => { const p = nome.trim().split(/\s+/); return p.length === 1 ? [p[0]!, p[0]!] : [p[0]!, p.slice(1).join(' ')]; };
const ageOn = (birth: string, ref: string) => { const [y, m, d] = birth.split('-').map(Number); const [Y, M, D] = ref.split('-').map(Number); return Y! - y! - (M! < m! || (M === m && D! < d!) ? 1 : 0); };
const POS: Record<string, Position> = { GK: 'GK', CB: 'CB', LB: 'LB', RB: 'RB', LWB: 'LWB', RWB: 'RWB', CDM: 'DM', CM: 'CM', CAM: 'AM', LM: 'LM', RM: 'RM', LW: 'LW', RW: 'RW', ST: 'CF', CF: 'SS' };
const GRUPO: Record<string, Position> = { goleiro: 'GK', defensor: 'CB', 'meio-campista': 'CM', atacante: 'CF' };
function positions(r: Row): { position: Position; secondaryPositions: Position[] } {
  const list = [...new Set(r.posicao.split(',').map((p) => POS[p.trim().toUpperCase()]).filter((p): p is Position => !!p))];
  const position = list[0] ?? GRUPO[r.grupo] ?? 'CM';
  return { position, secondaryPositions: list.filter((p) => p !== position).slice(0, 3) };
}
const foot = (s: string) => (s === 'right' || s === 'left' || s === 'both' ? s : undefined);
const value = (r: Row) => Number(r.valor_mercado_eur) || 0;
function ols(X: number[][], y: number[]): number[] {
  const k = X[0]!.length, A = Array.from({ length: k }, () => Array<number>(k + 1).fill(0));
  X.forEach((x, n) => { for (let i = 0; i < k; i++) { for (let j = 0; j < k; j++) A[i]![j]! += x[i]! * x[j]!; A[i]![k]! += x[i]! * y[n]!; } });
  for (let i = 0; i < k; i++) {
    let p = i; for (let r = i + 1; r < k; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[p]![i]!)) p = r;
    [A[i], A[p]] = [A[p]!, A[i]!];
    for (let r = 0; r < k; r++) if (r !== i) { const f = A[r]![i]! / A[i]![i]!; for (let c = i; c <= k; c++) A[r]![c]! -= f * A[i]![c]!; }
  }
  return A.map((row, i) => row[k]! / row[i]!);
}
const csvOut = (rows: Rec[]) => {
  const head = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '\uFEFF' + [head.join(';'), ...rows.map((r) => head.map((h) => esc(r[h])).join(';'))].join('\n') + '\n';
};
/** compila base + pacotes ativos com o pacote 1 trocado pelo montado (direto, sem o cache de careerUniverse; erro = exceção) */
function compileWith(data: ReturnType<typeof readPackDir>) {
  const order: string[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'packs', 'load-order.json'), 'utf8')).enabled ?? [];
  const packs = order.map((id) => (id === PACOTE ? data : readPackDir(path.join(DATA_DIR, 'packs', id))));
  if (!order.includes(PACOTE)) packs.push(data);
  return compileUniverse(EMPTY_WORLD, [basePack(), ...packs]);
}

// ---------------------------------------------------------------- leitura
const packDir = path.join(DATA_DIR, 'packs', PACOTE);
const pack = readPackDir(packDir);
const before = careerUniverse(DATA_DIR).world;
const refDate = before.startDate;
const wPlayer = new Map(before.players.map((p) => [p.id, p]));
const baseClubIds = new Set(before.clubs.map((c) => c.id));
const avisos: string[] = [];
const players = new Map<string, Rec>(pack.data.players.map((r) => [String(r.id), { ...r } as Rec]));
const removed = new Set<string>();
const clubRecs = new Map<string, Rec>((pack.data.clubs ?? []).map((r) => [String(r.id), { ...r } as Rec]));
const coachRecs = new Map<string, Rec>((pack.data.coaches ?? []).map((r) => [String(r.id), { ...r } as Rec]));
const leagueRecs = new Map<string, Rec>((pack.data.leagues ?? []).map((r) => [String(r.id), { ...r } as Rec]));
const allIds = new Set<string>([...before.players.map((p) => p.id), ...before.clubs.map((c) => c.id), ...before.stadiums.map((s) => s.id), ...(before.coaches ?? []).map((k) => k.id)]);
const uniqId = (base: string) => { const b = slugify(base) || 'x'; let id = b, k = 2; while (allIds.has(id)) id = `${b}-${k++}`; allIds.add(id); return id; };
const playerOrigin = new Map<string, string>();   // id → 'planilha' | 'extração (existente)' | 'extração (novo)'
const playerExt = new Map<string, { row: Row; lg: string }>();   // id → linha da extração (para foto e relatório)
const created: Array<{ id: string; row: Row; lg: string }> = [];
const relClubes: Rec[] = [], relTec: Rec[] = [];
const images: Array<{ kind: 'players' | 'clubs' | 'coaches' | 'leagues'; id: string; file: string }> = [];

// planilhas de todas as ligas primeiro (para resolver duplicatas entre elas e com o pacote)
interface LigaData { L: Liga; times: Row[]; ext: Row[]; tec: Row[]; csvPlayers: Rec[]; csvClubs: Rec[]; teamToClub: Map<string, string>; newTeams: string[] }
const ligas: LigaData[] = LIGAS.map((L) => {
  const dir = `${EXT}/${L.ext}`;
  const times = readCsv(`${dir}/tabelas/times.csv`), ext = readCsv(`${dir}/tabelas/jogadores.csv`), tec = readCsv(`${dir}/tabelas/tecnicos.csv`);
  const p = rowsToRecords('players', fs.readFileSync(`${ROOT}/${L.players}`, 'utf8'));
  const c = rowsToRecords('clubs', fs.readFileSync(`${ROOT}/${L.clubs}`, 'utf8'));
  const errs = [...p.issues, ...c.issues].filter((i) => !/coluna/i.test(i.message));
  if (errs.length) throw new Error(`${L.lg}: planilha com erros: ${errs.slice(0, 3).map((i) => `linha ${i.line}: ${i.message}`).join(' | ')}`);
  const csvPlayers = p.records.map((x) => ({ ...x.record }) as Rec), csvClubs = c.records.map((x) => ({ ...x.record }) as Rec);
  // clube real → clube da planilha (maior semelhança de nome; usa também o nome curto da extração)
  const pairs = times.flatMap((t) => csvClubs.map((cl) => ({ team: t.nome, club: String(cl.id), s: Math.max(teamScore(t.nome, String(cl.name)), teamScore(t.nome_curto, String(cl.name))) }))).sort((a, b) => b.s - a.s);
  const teamToClub = new Map<string, string>(), used = new Set<string>();
  for (const x of pairs) if (x.s >= 0.5 && !teamToClub.has(x.team) && !used.has(x.club)) { teamToClub.set(x.team, x.club); used.add(x.club); }
  const newTeams = times.map((t) => t.nome).filter((t) => !teamToClub.has(t));
  const spare = csvClubs.filter((cl) => !used.has(String(cl.id)));
  if (spare.length) throw new Error(`${L.lg}: clubes da planilha sem par na extração: ${spare.map((cl) => cl.name).join(', ')}`);
  if (newTeams.some((t) => !NOVOS[t])) throw new Error(`${L.lg}: times da extração sem par: ${newTeams.join(', ')}`);
  return { L, times, ext, tec, csvPlayers, csvClubs, teamToClub, newTeams };
});

// ---------------------------------------------------------------- clubes, técnicos e ligas
for (const d of ligas) {
  for (const cl of d.csvClubs) clubRecs.set(String(cl.id), { ...(clubRecs.get(String(cl.id)) ?? {}), ...cl });
  for (const t of d.newTeams) {
    const info = NOVOS[t]!, id = uniqId(t);
    d.teamToClub.set(t, id);
    clubRecs.set(id, { id, name: t, shortName: info.sigla, country: 'eng', league: d.L.lg, city: info.cidade });
  }
  // reputação dos clubes novos: a do clube da planilha com valor de elenco mais próximo
  const sv = new Map(d.times.map((t) => [t.nome, d.ext.filter((r) => r.time === t.nome).reduce((s, r) => s + value(r), 0)]));
  for (const t of d.newTeams) {
    const id = d.teamToClub.get(t)!;
    const near = d.times.filter((x) => !d.newTeams.includes(x.nome)).sort((a, b) => Math.abs(Math.log((sv.get(a.nome) || 1) / (sv.get(t) || 1))) - Math.abs(Math.log((sv.get(b.nome) || 1) / (sv.get(t) || 1))))[0]!;
    clubRecs.get(id)!.reputation = Number(clubRecs.get(d.teamToClub.get(near.nome)!)?.reputation ?? 40);
  }
  for (const t of d.times) {
    const id = d.teamToClub.get(t.nome)!;
    if (t.logo && fs.existsSync(`${EXT}/${d.L.ext}/${t.logo}`)) images.push({ kind: 'clubs', id, file: `${EXT}/${d.L.ext}/${t.logo}` });
    relClubes.push({ liga: d.L.lg, time_real: t.nome, clube_jogo_id: id, nome_no_jogo: clubRecs.get(id)!.name, situacao: d.newTeams.includes(t.nome) ? 'criado' : 'planilha',
      reputacao: clubRecs.get(id)!.reputation, valor_elenco_eur: sv.get(t.nome), escudo: images.some((x) => x.kind === 'clubs' && x.id === id) ? 'sim' : 'não' });
  }
  // técnicos: os da planilha; nos clubes novos, o da extração (criado)
  const tecCsv = readCsv(`${ROOT}/${d.L.coaches}`);
  for (const k of tecCsv) {
    const rec: Rec = { id: k.id, firstName: k.Nome, lastName: k.Sobrenome, club: k.Clube, ...(isDate(k.Nascimento) ? { birthDate: k.Nascimento } : {}),
      ...(nationOf(k.Nacionalidade) ? { nationality: k.Nacionalidade } : {}), ...(Number(k['Reputação']) ? { reputation: Number(k['Reputação']) } : {}),
      ...(METODOLOGIA[k.Metodologia] ? { methodology: METODOLOGIA[k.Metodologia] } : {}),
      attributes: Object.fromEntries([['tactics', 'Conhecimento tático'], ['motivation', 'Motivação'], ['youth', 'Desenvolvimento de jovens'], ['discipline', 'Disciplina'], ['negotiation', 'Negociação'], ['adaptability', 'Adaptabilidade']]
        .filter(([, col]) => Number(k[col!])).map(([key, col]) => [key, Math.max(1, Math.min(20, Number(k[col!])))])) };
    coachRecs.set(k.id, { ...(coachRecs.get(k.id) ?? {}), ...rec });
  }
  for (const t of d.tec) {
    const club = d.teamToClub.get(t.time); if (!club) continue;
    let cid = [...coachRecs.values()].find((k) => k.club === club && norm(`${k.firstName} ${k.lastName}`) === norm(t.nome))?.id as string | undefined;
    if (!cid && d.newTeams.includes(t.time)) {
      const [firstName, lastName] = splitName(t.nome); cid = uniqId(`tec-${club}`);
      coachRecs.set(cid, { id: cid, firstName, lastName, birthDate: isDate(t.nascimento) ? t.nascimento : '1980-01-01', nationality: nationOf(t.pais_codigo) ? t.pais_codigo : 'ENG', club });
    }
    if (!cid) { cid = [...coachRecs.values()].find((k) => k.club === club)?.id as string | undefined; if (cid) avisos.push(`técnico ${t.nome} (${t.time}): a planilha tem ${coachRecs.get(cid)!.firstName} ${coachRecs.get(cid)!.lastName}; mantido o da planilha, sem foto`); continue; }
    if (t.foto && fs.existsSync(`${EXT}/${d.L.ext}/${t.foto}`)) images.push({ kind: 'coaches', id: cid, file: `${EXT}/${d.L.ext}/${t.foto}` });
    relTec.push({ liga: d.L.lg, tecnico: t.nome, time_real: t.time, tecnico_id: cid, clube_jogo_id: club, foto: images.some((x) => x.kind === 'coaches' && x.id === cid) ? 'sim' : 'não' });
  }
  const logo = fs.existsSync(`${EXT}/${d.L.ext}/imagens/liga`) ? fs.readdirSync(`${EXT}/${d.L.ext}/imagens/liga`).find((f) => /^\d+\.png$/.test(f)) : undefined;
  if (logo) images.push({ kind: 'leagues', id: d.L.lg, file: `${EXT}/${d.L.ext}/imagens/liga/${logo}` });
}
for (const f of LEAGUE_CSVS) for (const l of readCsv(`${ROOT}/${f}`)) {
  if (!LIGAS.some((x) => x.lg === l.id)) continue;
  const n = (k: string) => (l[k] === '' ? undefined : Number(l[k]));
  const rules: Rec = { rounds: n('Turnos'), pointsWin: n('Pontos por vitória'), pointsDraw: n('Pontos por empate'), promotionSlots: n('Vagas de acesso'), relegationSlots: n('Vagas de rebaixamento'),
    continentalSlots: n('Vagas continentais'), maxForeignPlayers: l['Máximo de estrangeiros'] === '' ? null : n('Máximo de estrangeiros'), squadMin: n('Elenco mínimo'), squadMax: SQUAD_MAX };
  leagueRecs.set(l.id, { ...(leagueRecs.get(l.id) ?? {}), id: l.id, name: l.Nome, rules: Object.fromEntries(Object.entries(rules).filter(([, v]) => v !== undefined)) });
}

// ---------------------------------------------------------------- jogadores: planilhas
const keyOf = (first: unknown, last: unknown, birth: unknown) => `${norm(`${first} ${last}`)}|${birth}`;
const csvByKey = new Map<string, { rec: Rec; lg: string }>();
for (const d of ligas) for (const r of d.csvPlayers) {
  const k = keyOf(r.firstName, r.lastName, r.birthDate);
  if (csvByKey.has(k)) { avisos.push(`${r.firstName} ${r.lastName}: está em duas planilhas (${csvByKey.get(k)!.lg} e ${d.L.lg}); fica a primeira, ${r.id} removido`); removed.add(String(r.id)); continue; }
  csvByKey.set(k, { rec: r, lg: d.L.lg });
}
// o elenco da 1ª divisão alemã (importado antes, extração 2026/27) prevalece sobre as planilhas
const ger1 = new Set(before.clubs.filter((c) => c.leagueId === 'ger-1').map((c) => c.id));
const currentClub = (id: string) => (players.has(id) && 'club' in players.get(id)! ? (players.get(id)!.club as string | null) : (wPlayer.get(id)?.clubId ?? null));
const universeByKey = new Map<string, string[]>();
for (const p of before.players) { const k = keyOf(p.firstName, p.lastName, p.birthDate); (universeByKey.get(k) ?? universeByKey.set(k, []).get(k)!).push(p.id); }
for (const [k, { rec, lg }] of csvByKey) {
  const others = (universeByKey.get(k) ?? []).filter((id) => id !== rec.id && !removed.has(id));
  const inGer1 = others.find((id) => ger1.has(currentClub(id) ?? ''));
  if (inGer1) { avisos.push(`${rec.firstName} ${rec.lastName}: está no elenco da Bundesliga 2026/27 (${inGer1}); a linha da planilha ${lg} (${rec.id}) foi descartada`); removed.add(String(rec.id)); csvByKey.delete(k); continue; }
  for (const id of others) if (!currentClub(id) || players.has(id)) { removed.add(id); avisos.push(`${rec.firstName} ${rec.lastName}: registro antigo ${id} removido (fica ${rec.id}, da planilha ${lg})`); }
}
for (const { rec } of csvByKey.values()) { const id = String(rec.id); players.set(id, { ...(players.get(id) ?? {}), ...rec }); playerOrigin.set(id, 'planilha'); }

// ---------------------------------------------------------------- extração: casa com as planilhas e completa os elencos
const csvByName = new Map<string, string[]>();
for (const [k, { rec }] of csvByKey) { const n = k.split('|')[0]!; (csvByName.get(n) ?? csvByName.set(n, []).get(n)!).push(String(rec.id)); }
const extNames = new Set(ligas.flatMap((d) => d.ext.map((r) => norm(r.nome))));
const pending: Array<{ row: Row; lg: string; club: string }> = [];
for (const d of ligas) for (const r of d.ext) {
  const club = d.teamToClub.get(r.time)!; const k = `${norm(r.nome)}|${r.nascimento}`;
  let id = csvByKey.get(k)?.rec.id as string | undefined;
  if (!id) { const c = (csvByName.get(norm(r.nome)) ?? []).filter((x) => !playerExt.has(x)); if (c.length === 1) id = c[0]; }
  if (!id) { const c = [...csvByKey.values()].filter(({ rec }) => lastToken(String(rec.lastName)) === lastToken(r.nome) && rec.birthDate === r.nascimento && !playerExt.has(String(rec.id)) && !extNames.has(norm(`${rec.firstName} ${rec.lastName}`))); if (c.length === 1) id = String(c[0]!.rec.id); }
  if (id) {
    playerExt.set(id, { row: r, lg: d.L.lg });
    const rec = players.get(id)!;
    if (rec.club !== club) { avisos.push(`${rec.firstName} ${rec.lastName}: planilha em ${rec.club}, extração em ${r.time} → vai para ${club}`); rec.club = club; }
    continue;
  }
  pending.push({ row: r, lg: d.L.lg, club });
}
// quem não está nas planilhas: jogador já existente no universo (mesmo nome e nascimento) ou novo
const semNascimento: Array<{ row: Row; lg: string }> = [];
for (const { row: r, lg, club } of pending) {
  if (!isDate(r.nascimento)) { semNascimento.push({ row: r, lg }); avisos.push(`${r.nome} (${r.time}): sem data de nascimento na extração; não importado`); continue; }
  const k = `${norm(r.nome)}|${r.nascimento}`;
  const exist = (universeByKey.get(k) ?? []).filter((id) => !removed.has(id) && !playerExt.has(id) && !ger1.has(currentClub(id) ?? ''));
  const pos = positions(r), nat = r.pais_codigo.toUpperCase();
  const common: Rec = { birthDate: r.nascimento, ...(nationOf(nat) ? { nationality: nat } : {}), club, position: pos.position, secondaryPositions: pos.secondaryPositions,
    ...(foot(r.pe_preferido) ? { foot: foot(r.pe_preferido) } : {}), ...(Number(r.altura_cm) >= 140 && Number(r.altura_cm) <= 220 ? { heightCm: Math.round(Number(r.altura_cm)) } : {}) };
  if (exist.length) {
    const id = exist[0]!; players.set(id, { ...(players.get(id) ?? { id }), ...common, ...(isDate(r.contrato_ate) ? { contract: { ...((players.get(id)?.contract as object) ?? {}), end: r.contrato_ate } } : {}) });
    playerOrigin.set(id, 'extração (existente)'); playerExt.set(id, { row: r, lg }); continue;
  }
  const [firstName, lastName] = splitName(r.nome);
  const id = uniqId(`${firstName}-${lastName}-${r.nascimento.slice(0, 4)}`);
  players.set(id, { id, firstName, lastName, ...common, ...(nationOf(nat) ? {} : { nationality: lg.startsWith('ger') ? 'GER' : 'ENG' }), ...(isDate(r.contrato_ate) ? { contract: { end: r.contrato_ate } } : {}) });
  playerOrigin.set(id, 'extração (novo)'); playerExt.set(id, { row: r, lg }); created.push({ id, row: r, lg });
}
for (const id of removed) { if (wPlayer.has(id)) players.set(id, { id, $remove: true }); else players.delete(id); }

// elenco acima do máximo: sai (fica sem clube) quem foi acrescentado da extração com menor valor de mercado
const effClub = (id: string) => (players.has(id) && 'club' in players.get(id)! ? (players.get(id)!.club as string | null) : (wPlayer.get(id)?.clubId ?? null));
const squadOf = new Map<string, string[]>();
for (const id of new Set([...before.players.map((p) => p.id), ...players.keys()])) {
  if (players.get(id)?.$remove) continue;
  const c = effClub(id); if (c) (squadOf.get(c) ?? squadOf.set(c, []).get(c)!).push(id);
}
for (const d of ligas) for (const club of new Set(d.teamToClub.values())) {
  const sq = squadOf.get(club) ?? [];
  if (sq.length <= SQUAD_MAX) continue;
  const extra = sq.filter((id) => playerOrigin.get(id)?.startsWith('extração')).sort((a, b) => value(playerExt.get(a)!.row) - value(playerExt.get(b)!.row)).slice(0, sq.length - SQUAD_MAX);
  for (const id of extra) { players.get(id)!.club = null; avisos.push(`${players.get(id)!.firstName ?? wPlayer.get(id)?.firstName} ${players.get(id)!.lastName ?? wPlayer.get(id)?.lastName}: ${clubRecs.get(club)?.name ?? club} passou de ${SQUAD_MAX} jogadores; ficou sem clube`); }
}

// ---------------------------------------------------------------- força dos novos: regressão nos jogadores com atributos (compilação 1)
const build = () => ({ manifest: pack.manifest, data: { ...pack.data,
  players: [...players.values()] as typeof pack.data.players, clubs: [...clubRecs.values()] as typeof pack.data.clubs,
  coaches: [...coachRecs.values()] as typeof pack.data.coaches, leagues: [...leagueRecs.values()] as typeof pack.data.leagues } });
for (const c of created) players.get(c.id)!.ability = 10;   // provisório, só para compilar
const w1 = compileWith(build()).world;
const ov1 = new Map(w1.players.map((p) => [p.id, p.overall]));
const sample = [...playerExt].filter(([id, { row }]) => playerOrigin.get(id) !== 'extração (novo)' && value(row) > 0 && ov1.has(id)).map(([id, { row }]) => {
  const age = ageOn(row.nascimento, refDate); return { x: [1, Math.log(value(row)), age - 26, (age - 26) ** 2, row.grupo === 'goleiro' ? 1 : 0], y: ov1.get(id)! / 5 };
});
const coef = ols(sample.map((s) => s.x), sample.map((s) => s.y));
const pred = (x: number[]) => x.reduce((s, v, i) => s + v * coef[i]!, 0);
const rmse = Math.sqrt(sample.reduce((s, x) => s + (x.y - pred(x.x)) ** 2, 0) / sample.length);
const medianValue = (() => { const v = ligas.flatMap((d) => d.ext.map(value)).filter((x) => x > 0).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] ?? 100000; })();
for (const c of created) {
  const age = ageOn(c.row.nascimento, refDate);
  const ability = Math.max(1, Math.min(20, Math.round(pred([1, Math.log(value(c.row) || medianValue), age - 26, (age - 26) ** 2, c.row.grupo === 'goleiro' ? 1 : 0]))));
  Object.assign(players.get(c.id)!, { ability, potential: Math.max(ability, Math.min(20, ability + Math.round(Math.max(0, 24 - age) * 0.7))) });
}

// ---------------------------------------------------------------- imagens dos jogadores, validação final
for (const [id, { row, lg }] of playerExt) {
  if (players.get(id)?.$remove) continue;
  const f = row.foto ? `${EXT}/${LIGAS.find((l) => l.lg === lg)!.ext}/${row.foto}` : '';
  if (f && fs.existsSync(f)) images.push({ kind: 'players', id, file: f });
}
for (const im of images) validateImage(new Uint8Array(fs.readFileSync(im.file)), `${im.kind}/${im.id}`);
const out = build();
const final = compileWith(out).world;
const sizes = new Map<string, number[]>();
for (const L of LIGAS) sizes.set(L.lg, final.clubs.filter((c) => c.leagueId === L.lg).map((c) => final.players.filter((p) => p.clubId === c.id).length));
const finalIds = new Set(final.players.map((x) => x.id));
const missing = [...playerExt].filter(([id]) => !players.get(id)?.$remove && !finalIds.has(id));
if (missing.length) { console.log('FALTANDO', missing.length, missing.slice(0, 4).map(([id, { row }]) => `${row.nome} ${id} ${JSON.stringify(players.get(id))} origem=${playerOrigin.get(id)} removed=${removed.has(id)}`).join(' || ')); throw new Error(`validação: ${missing.length} jogador(es) da extração fora do universo`); }
for (const L of LIGAS) console.log(`${L.lg}: ${sizes.get(L.lg)!.length} clubes, elencos de ${Math.min(...sizes.get(L.lg)!)} a ${Math.max(...sizes.get(L.lg)!)} — ${final.leagues.find((l) => l.id === L.lg)!.name}`);

// ---------------------------------------------------------------- relatórios
fs.mkdirSync(SAIDA, { recursive: true });
const ovF = new Map(final.players.map((p) => [p.id, p]));
const relJog: Rec[] = [];
for (const d of ligas) for (const r of d.ext) {
  const id = [...playerExt].find(([, v]) => v.row === r)?.[0];
  const p = id ? ovF.get(id) : undefined;
  relJog.push({ liga: d.L.lg, extracao_id: r.id, nome: r.nome, time_real: r.time, jogador_id: id ?? '', situacao: id ? playerOrigin.get(id) : 'fora', clube_jogo_id: p?.clubId ?? '',
    posicao: p?.position ?? '', idade: ageOn(r.nascimento, refDate), valor_mercado_eur: value(r), forca: p ? Math.round(p.overall / 5) : '', forca_origem: id && playerOrigin.get(id) === 'extração (novo)' ? 'estimada' : 'atributos',
    foto: id && images.some((x) => x.kind === 'players' && x.id === id) ? 'sim' : 'não' });
}
for (const d of ligas) for (const r of d.csvPlayers) if (!playerExt.has(String(r.id)) && !removed.has(String(r.id))) {
  const p = ovF.get(String(r.id));
  relJog.push({ liga: d.L.lg, extracao_id: '', nome: `${r.firstName} ${r.lastName}`, time_real: '', jogador_id: r.id, situacao: 'só na planilha', clube_jogo_id: p?.clubId ?? '', posicao: p?.position ?? '',
    idade: p ? ageOn(p.birthDate, refDate) : '', valor_mercado_eur: '', forca: p ? Math.round(p.overall / 5) : '', forca_origem: 'atributos', foto: 'não' });
}
fs.writeFileSync(path.join(SAIDA, 'jogadores.csv'), csvOut(relJog));
fs.writeFileSync(path.join(SAIDA, 'clubes.csv'), csvOut(relClubes));
fs.writeFileSync(path.join(SAIDA, 'tecnicos.csv'), csvOut(relTec));
fs.writeFileSync(path.join(SAIDA, 'removidos.csv'), csvOut([...removed].map((id) => ({ jogador_id: id, nome: wPlayer.get(id) ? `${wPlayer.get(id)!.firstName} ${wPlayer.get(id)!.lastName}` : '', na_base: wPlayer.has(id) ? 'sim' : 'não' }))));
fs.writeFileSync(path.join(SAIDA, 'regressao.json'), JSON.stringify({ variaveis: ['constante', 'ln(valor de mercado)', 'idade − 26', '(idade − 26)²', 'goleiro'], coeficientes: coef, amostra: sample.length, rmse_forca_1a20: rmse, data_referencia: refDate }, null, 1));
fs.writeFileSync(path.join(SAIDA, 'avisos.txt'), avisos.join('\n') + '\n');
const cnt = (s: string) => relJog.filter((r) => r.situacao === s).length;
console.log(`Jogadores: ${cnt('planilha')} da planilha casados com a extração, ${cnt('só na planilha')} só na planilha, ${cnt('extração (existente)')} da extração já existentes, ${cnt('extração (novo)')} criados; ${removed.size} removidos (duplicatas)`);
console.log(`Clubes criados: ${relClubes.filter((c) => c.situacao === 'criado').length}; imagens: ${images.filter((x) => x.kind === 'players').length} jogadores, ${images.filter((x) => x.kind === 'clubs').length} escudos, ${images.filter((x) => x.kind === 'coaches').length} técnicos, ${images.filter((x) => x.kind === 'leagues').length} ligas`);
console.log(`Regressão: ${sample.length} jogadores, erro médio ${rmse.toFixed(2)}; avisos: ${avisos.length}; relatórios em ${SAIDA}`);

const TESTE = process.argv.find((x) => x.startsWith('--teste='))?.slice(8);
if (TESTE) { writePackDir(out, TESTE); console.log(`pacote de teste em ${TESTE}`); }
if (GRAVAR) {
  writePackDir(out, packDir);
  for (const im of images) setPackImage(packDir, im.kind, im.id, new Uint8Array(fs.readFileSync(im.file)));
  console.log(`Pacote "${PACOTE}" gravado em ${packDir}`);
} else console.log('Simulação (sem --gravar): nada foi gravado no pacote.');
