/**
 * Importa para o pacote "1" as planilhas reais de D:\DATA BASE FOOTERA\csv_jogadores (formato do editor, ids da base, montadas por outro
 * agente a partir da extração futmob) e completa com a própria extração: 36 divisões de 22 países (Brasil B/C/D, Espanha 1–3, Itália, França,
 * Portugal, Holanda, Argentina, Bélgica, Japão, Áustria, México, Irlanda e Rússia 1–2; Croácia, Uruguai, Colômbia, Equador, Paraguai, Chile,
 * Peru, Bolívia e Venezuela 1ª). Mesmas regras da importação de Alemanha/Inglaterra (scripts/importar-ligas.ts, decisões de 08/11/2026):
 * - a planilha manda; cada clube é completado com os jogadores da extração que faltam (força estimada por regressão, por liga);
 * - jogador da planilha que a extração põe em outro clube do jogo vai para o clube da extração;
 * - duplicata: fica o da planilha e o registro antigo é removido, exceto se o antigo está num clube fora desta importação (fica o antigo);
 * - elencos limitados a 40 (sai quem veio da extração com menor valor de mercado).
 * Fotos, escudos, técnicos e logos da extração vão para images/ do pacote no padrão do jogo.
 *
 *   node --disable-warning=ExperimentalWarning scripts/importar-paises.ts [--gravar] [--teste=<pasta>]
 */
import fs from 'node:fs';
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
const CSV = `${ROOT}/csv_jogadores`;
const EXT = `${ROOT}/futmob database/dados`;
const DATA_DIR = path.join(process.env.APPDATA ?? '', 'football-manager-simulator', 'data');
const PACOTE = '1';
const SAIDA = `${ROOT}/importacao-paises-2026-27`;
const GRAVAR = process.argv.includes('--gravar');
const SQUAD_MAX = 40;
/** liga do jogo → pasta da extração e nome real da competição (Brasil: fica o nome do pacote de licenças) */
const LIGAS: Array<{ lg: string; ext: string; nome?: string }> = [
  { lg: 'bra-2', ext: 'serie-b_8814' }, { lg: 'bra-3', ext: 'serie-c_8971' }, { lg: 'bra-4', ext: 'serie-d_9464' },
  { lg: 'esp-1', ext: 'laliga_87', nome: 'LaLiga' }, { lg: 'esp-2', ext: 'laliga2_140', nome: 'LaLiga 2' }, { lg: 'esp-3', ext: 'primera-federacion_8968', nome: 'Primera Federación' },
  { lg: 'ita-1', ext: 'serie-a_55', nome: 'Serie A' }, { lg: 'ita-2', ext: 'serie-b_86', nome: 'Serie B' },
  { lg: 'fra-1', ext: 'ligue-1_53', nome: 'Ligue 1' }, { lg: 'fra-2', ext: 'ligue-2_110', nome: 'Ligue 2' },
  { lg: 'por-1', ext: 'liga-portugal_61', nome: 'Liga Portugal' }, { lg: 'por-2', ext: 'liga-portugal-2_185', nome: 'Liga Portugal 2' },
  { lg: 'ned-1', ext: 'eredivisie_57', nome: 'Eredivisie' }, { lg: 'ned-2', ext: 'eerste-divisie_111', nome: 'Eerste Divisie' },
  { lg: 'arg-1', ext: 'liga-profesional_112', nome: 'Liga Profesional' }, { lg: 'arg-2', ext: 'primera-b-nacional_8965', nome: 'Primera Nacional' },
  { lg: 'bel-1', ext: 'first-division-a_40', nome: 'Pro League' }, { lg: 'bel-2', ext: 'first-division-b_264', nome: 'Challenger Pro League' },
  { lg: 'jpn-1', ext: 'j-league_223', nome: 'J1 League' }, { lg: 'jpn-2', ext: 'j-league-2_8974', nome: 'J2 League' },
  { lg: 'aut-1', ext: 'bundesliga_38', nome: 'Bundesliga' }, { lg: 'aut-2', ext: '2-liga_119', nome: '2. Liga' },
  { lg: 'mex-1', ext: 'liga-mx_230', nome: 'Liga MX' }, { lg: 'mex-2', ext: 'liga-de-expansion-mx_8976', nome: 'Liga de Expansión MX' },
  { lg: 'irl-1', ext: 'premier-division_126', nome: 'Premier Division' }, { lg: 'irl-2', ext: 'first-division_218', nome: 'First Division' },
  { lg: 'rus-1', ext: 'premier-league_63', nome: 'Premier Liga' }, { lg: 'rus-2', ext: '1-division_338', nome: 'Pervaya Liga' },
  { lg: 'cro-1', ext: 'hnl_252', nome: 'HNL' }, { lg: 'uru-1', ext: 'liga-auf-uruguaya_161', nome: 'Liga AUF Uruguaya' },
  { lg: 'col-1', ext: 'primera-a_274', nome: 'Primera A' }, { lg: 'ecu-1', ext: 'serie-a_246', nome: 'LigaPro Serie A' },
  { lg: 'par-1', ext: 'division-profesional_199', nome: 'División Profesional' }, { lg: 'chi-1', ext: 'liga-de-primera_273', nome: 'Liga de Primera' },
  { lg: 'per-1', ext: 'liga-1_131', nome: 'Liga 1' }, { lg: 'bol-1', ext: 'primera-division_144', nome: 'División Profesional' },
  { lg: 'ven-1', ext: 'primera-division_339', nome: 'Liga FUTVE' },
];
const NACAO: Record<string, string> = { bra: 'BRA', esp: 'ESP', ita: 'ITA', fra: 'FRA', por: 'POR', ned: 'NED', arg: 'ARG', bel: 'BEL', jpn: 'JPN', aut: 'AUT', mex: 'MEX',
  irl: 'IRL', rus: 'RUS', cro: 'CRO', uru: 'URU', col: 'COL', ecu: 'ECU', par: 'PAR', chi: 'CHI', per: 'PER', bol: 'BOL', ven: 'VEN' };
const METODOLOGIA: Record<string, string> = { defensiva: 'defensive', posse: 'possession', agressiva: 'aggressive' };

// ---------------------------------------------------------------- utilidades
type Row = Record<string, string>;
type Rec = Record<string, unknown>;
function readCsv(file: string): Row[] {
  const { rows } = parseCsv(fs.readFileSync(file, 'utf8'));
  if (!rows.length) return [];
  const head = rows[0]!.cells.map((h) => h.replace(/^\uFEFF/, '').trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r.cells[i] ?? '').trim()])));
}
const norm = (s: string) => s.replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const lastToken = (s: string) => norm(s).split(' ').at(-1) ?? '';
const STOP = new Set(['fc', 'sc', 'sv', 'cf', 'club', 'de', 'del', 'la', 'el', 'los', 'las', 'do', 'da', 'the', 'fk', 'nk', 'sk', 'ac', 'cd', 'ca', 'sd', 'ud', 'afc', 'cs', 'ec', 'se', 'esporte', 'clube', 'futebol', 'football', 'futbol']);
const teamTokens = (s: string) => new Set(norm(s).split(' ').filter((t) => t && !STOP.has(t)));
function teamScore(a: string, b: string): number {
  const A = teamTokens(a), B = teamTokens(b); const inter = [...A].filter((t) => B.has(t)).length;
  return inter / Math.max(1, Math.min(A.size, B.size)) + 0.01 * (inter / Math.max(1, new Set([...A, ...B]).size));
}
/** data AAAA-MM-DD que existe e é plausível para nascimento/contrato (a extração tem "0001-01-01" quando não sabe) */
const isDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s ?? '')) return false;
  const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y!, m! - 1, d!));
  return y! >= 1940 && y! <= 2040 && t.getUTCMonth() === m! - 1 && t.getUTCDate() === d;
};
const splitName = (nome: string): [string, string] => { const p = nome.trim().split(/\s+/); return p.length === 1 ? [p[0]!, p[0]!] : [p[0]!, p.slice(1).join(' ')]; };
const ageOn = (birth: string, ref: string) => { const [y, m, d] = birth.split('-').map(Number); const [Y, M, D] = ref.split('-').map(Number); return Y! - y! - (M! < m! || (M === m && D! < d!) ? 1 : 0); };
const POS: Record<string, Position> = { GK: 'GK', CB: 'CB', LB: 'LB', RB: 'RB', LWB: 'LWB', RWB: 'RWB', CDM: 'DM', CM: 'CM', CAM: 'AM', LM: 'LM', RM: 'RM', LW: 'LW', RW: 'RW', ST: 'CF', CF: 'SS' };
const GRUPO: Record<string, Position> = { goleiro: 'GK', defensor: 'CB', 'meio-campista': 'CM', atacante: 'CF' };
function positions(r: Row): { position: Position; secondaryPositions: Position[] } {
  const list = [...new Set((r.posicao ?? '').split(',').map((p) => POS[p.trim().toUpperCase()]).filter((p): p is Position => !!p))];
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
const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { (m.get(k) ?? m.set(k, []).get(k)!).push(v); };
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
const wClub = new Map(before.clubs.map((c) => [c.id, c]));
const avisos: string[] = [];
const players = new Map<string, Rec>(pack.data.players.map((r) => [String(r.id), { ...r } as Rec]));
const removed = new Set<string>();
const clubRecs = new Map<string, Rec>((pack.data.clubs ?? []).map((r) => [String(r.id), { ...r } as Rec]));
const coachRecs = new Map<string, Rec>((pack.data.coaches ?? []).map((r) => [String(r.id), { ...r } as Rec]));
const leagueRecs = new Map<string, Rec>((pack.data.leagues ?? []).map((r) => [String(r.id), { ...r } as Rec]));
const allIds = new Set<string>([...before.players.map((p) => p.id), ...before.clubs.map((c) => c.id), ...before.stadiums.map((s) => s.id), ...(before.coaches ?? []).map((k) => k.id)]);
const uniqId = (base: string) => { const b = slugify(base) || 'x'; let id = b, k = 2; while (allIds.has(id)) id = `${b}-${k++}`; allIds.add(id); return id; };
const playerOrigin = new Map<string, string>();   // id → 'planilha' | 'extração (existente)' | 'extração (novo)'
const playerExt = new Map<string, { row: Row; dir: string }>();
const extToId = new Map<Row, string>();
const created: Array<{ id: string; row: Row }> = [];
const relClubes: Rec[] = [], relTec: Rec[] = [];
const images: Array<{ kind: 'players' | 'clubs' | 'coaches' | 'leagues'; id: string; file: string }> = [];
const scopeLeagues = new Set(LIGAS.map((l) => l.lg));

interface LigaData { lg: string; country: string; dir: string; nome?: string; times: Row[]; ext: Row[]; tec: Row[]; csvPlayers: Rec[]; csvClubs: Rec[] }
const ligas: LigaData[] = LIGAS.map((L) => {
  const country = L.lg.slice(0, 3);
  const base = `${EXT}/${L.ext}`; const sub = fs.readdirSync(base).filter((d) => fs.statSync(`${base}/${d}`).isDirectory());
  if (sub.length !== 1) throw new Error(`${L.lg}: esperava uma temporada em ${base}, achei ${sub.join(', ')}`);
  const dir = `${base}/${sub[0]}`;
  const tab = (f: string) => (fs.existsSync(`${dir}/tabelas/${f}`) ? readCsv(`${dir}/tabelas/${f}`) : []);
  const p = rowsToRecords('players', fs.readFileSync(`${CSV}/jogadores-${country}-${L.lg}.csv`, 'utf8'));
  const c = rowsToRecords('clubs', fs.readFileSync(`${CSV}/clubes-${country}-${L.lg}.csv`, 'utf8'));
  const errs = [...p.issues, ...c.issues].filter((i) => !/coluna/i.test(i.message));
  if (errs.length) throw new Error(`${L.lg}: planilha com erros: ${errs.slice(0, 3).map((i) => `linha ${i.line}: ${i.message}`).join(' | ')}`);
  const csvPlayers = p.records.map((x) => ({ ...x.record }) as Rec);
  for (const r of csvPlayers) if (r.birthDate !== undefined && !isDate(String(r.birthDate))) {
    const keep = wPlayer.get(String(r.id))?.birthDate;
    avisos.push(`${r.firstName} ${r.lastName} (${L.lg}): nascimento "${r.birthDate}" inválido na planilha; mantido o da base (${keep ?? '—'})`);
    if (keep) r.birthDate = keep; else delete r.birthDate;
  }
  // o jogo aceita 15 a 45 anos na data de início: fora disso o jogador sai (o registro da base é removido)
  const okAge = csvPlayers.filter((r) => {
    const b = String(r.birthDate ?? wPlayer.get(String(r.id))?.birthDate ?? ''); const a = isDate(b) ? ageOn(b, refDate) : 25;
    if (a >= 15 && a <= 45) return true;
    avisos.push(`${r.firstName} ${r.lastName} (${L.lg}): ${a} anos na data de início do jogo (aceita 15 a 45); não importado`); removed.add(String(r.id)); return false;
  });
  return { lg: L.lg, country, dir, nome: L.nome, times: tab('times.csv'), ext: tab('jogadores.csv'), tec: tab('tecnicos.csv'),
    csvPlayers: okAge, csvClubs: c.records.map((x) => ({ ...x.record }) as Rec) };
});
const scopeClubs = new Set<string>([...before.clubs.filter((c) => scopeLeagues.has(c.leagueId ?? '')).map((c) => c.id), ...ligas.flatMap((d) => d.csvClubs.map((c) => String(c.id)))]);

// ---------------------------------------------------------------- times da extração → clubes do jogo (por país: um time pode estar noutra divisão)
const teamToClub = new Map<string, string>();   // `${dir}|${nome}` → clube do jogo
const teamKey = (dir: string, nome: string) => `${dir}|${nome}`;
for (const country of new Set(ligas.map((d) => d.country))) {
  const ds = ligas.filter((d) => d.country === country);
  const times = ds.flatMap((d) => d.times.map((t) => ({ d, t })));
  const clubs = ds.flatMap((d) => d.csvClubs);
  const used = new Set<string>();
  // 1) nome igual (nome ou nome curto)
  for (const { d, t } of times) {
    const cl = clubs.find((c) => !used.has(String(c.id)) && [norm(t.nome), norm(t.nome_curto ?? '')].includes(norm(String(c.name))));
    if (cl) { teamToClub.set(teamKey(d.dir, t.nome), String(cl.id)); used.add(String(cl.id)); }
  }
  // só nome igual: as planilhas já trazem o nome da extração nos clubes reais, e a semelhança casava clubes fictícios com times reais
  // (ex.: "Real Robledal" × "Real Jaén"); os candidatos parecidos vão para os avisos, para conferência
  for (const { d, t } of times) if (!teamToClub.has(teamKey(d.dir, t.nome))) {
    const best = clubs.filter((c) => !used.has(String(c.id))).map((c) => ({ c, s: Math.max(teamScore(t.nome, String(c.name)), teamScore(t.nome_curto ?? '', String(c.name))) })).sort((x, y) => y.s - x.s)[0];
    if (best && best.s >= 1) avisos.push(`${country}: time "${t.nome}" (extração ${d.lg}) parecido com o clube "${best.c.name}" da planilha, mas não casado (nome diferente)`);
  }
  for (const { d, t } of times) if (!teamToClub.has(teamKey(d.dir, t.nome))) avisos.push(`${country}: time "${t.nome}" (extração ${d.lg}) não está no jogo; jogadores dele não importados`);
  for (const c of clubs) if (!used.has(String(c.id))) avisos.push(`${country}: clube "${c.name}" (${c.id}) sem time na extração; fica só com a planilha (sem escudo)`);
}

// ---------------------------------------------------------------- clubes, técnicos e ligas
for (const d of ligas) for (const cl of d.csvClubs) clubRecs.set(String(cl.id), { ...(clubRecs.get(String(cl.id)) ?? {}), ...cl });
for (const d of ligas) {
  for (const t of d.times) {
    const id = teamToClub.get(teamKey(d.dir, t.nome)); if (!id) continue;
    if (t.logo && fs.existsSync(`${d.dir}/${t.logo}`)) images.push({ kind: 'clubs', id, file: `${d.dir}/${t.logo}` });
    relClubes.push({ liga_extracao: d.lg, time_real: t.nome, clube_jogo_id: id, nome_no_jogo: clubRecs.get(id)!.name, liga_no_jogo: clubRecs.get(id)!.league,
      reputacao: clubRecs.get(id)!.reputation, valor_elenco_eur: d.ext.filter((r) => r.time === t.nome).reduce((s, r) => s + value(r), 0),
      escudo: images.some((x) => x.kind === 'clubs' && x.id === id) ? 'sim' : 'não' });
  }
  for (const k of readCsv(`${CSV}/tecnicos-${d.country}-${d.lg}.csv`)) {
    const rec: Rec = { id: k.id, firstName: k.Nome, lastName: k.Sobrenome, club: k.Clube, ...(isDate(k.Nascimento) ? { birthDate: k.Nascimento } : {}),
      ...(nationOf(k.Nacionalidade) ? { nationality: k.Nacionalidade } : {}), ...(Number(k['Reputação']) ? { reputation: Number(k['Reputação']) } : {}),
      ...(METODOLOGIA[k.Metodologia] ? { methodology: METODOLOGIA[k.Metodologia] } : {}),
      attributes: Object.fromEntries([['tactics', 'Conhecimento tático'], ['motivation', 'Motivação'], ['youth', 'Desenvolvimento de jovens'], ['discipline', 'Disciplina'], ['negotiation', 'Negociação'], ['adaptability', 'Adaptabilidade']]
        .filter(([, col]) => Number(k[col!])).map(([key, col]) => [key, Math.max(1, Math.min(20, Number(k[col!])))])) };
    coachRecs.set(k.id, { ...(coachRecs.get(k.id) ?? {}), ...rec });
  }
}
const coachesByClub = new Map<string, Rec[]>();
for (const k of coachRecs.values()) if (k.club) push(coachesByClub, String(k.club), k);
for (const d of ligas) {
  for (const t of d.tec) {
    const club = teamToClub.get(teamKey(d.dir, t.time)); if (!club) continue;
    const k = (coachesByClub.get(club) ?? []).find((x) => norm(`${x.firstName} ${x.lastName}`) === norm(t.nome));
    if (!k) { const o = coachesByClub.get(club)?.[0]; avisos.push(`técnico ${t.nome} (${t.time}): a planilha tem ${o ? `${o.firstName} ${o.lastName}` : 'outro'}; mantido o da planilha, sem foto`); continue; }
    const cid = String(k.id);
    if (t.foto && fs.existsSync(`${d.dir}/${t.foto}`)) images.push({ kind: 'coaches', id: cid, file: `${d.dir}/${t.foto}` });
    relTec.push({ liga: d.lg, tecnico: t.nome, time_real: t.time, tecnico_id: cid, clube_jogo_id: club, foto: images.some((x) => x.kind === 'coaches' && x.id === cid) ? 'sim' : 'não' });
  }
  const logo = fs.existsSync(`${d.dir}/imagens/liga`) ? fs.readdirSync(`${d.dir}/imagens/liga`).find((f) => /^\d+\.png$/.test(f)) : undefined;
  if (logo) images.push({ kind: 'leagues', id: d.lg, file: `${d.dir}/imagens/liga/${logo}` });
}
// ligas: nome real e elenco máximo de 40; das regras da planilha, só o que difere do jogo atual
const ruleDiffs: string[] = [];
for (const country of new Set(ligas.map((d) => d.country))) for (const l of readCsv(`${CSV}/ligas-${country}.csv`)) {
  const d = ligas.find((x) => x.lg === l.id); if (!d) continue;
  const cur = before.leagues.find((x) => x.id === l.id)!.rules as unknown as Rec;
  const n = (k: string) => (l[k] === '' ? undefined : Number(l[k]));
  const want: Rec = { rounds: n('Turnos'), pointsWin: n('Pontos por vitória'), pointsDraw: n('Pontos por empate'), promotionSlots: n('Vagas de acesso'), relegationSlots: n('Vagas de rebaixamento'),
    continentalSlots: n('Vagas continentais'), maxForeignPlayers: l['Máximo de estrangeiros'] === '' ? null : n('Máximo de estrangeiros'), squadMin: n('Elenco mínimo') };
  const rules: Rec = { squadMax: SQUAD_MAX };
  for (const [k, v] of Object.entries(want)) if (v !== undefined && (cur[k] ?? null) !== v) { rules[k] = v; ruleDiffs.push(`${l.id}.${k}: ${cur[k] ?? '—'} → ${v}`); }
  const prev = leagueRecs.get(l.id) ?? {};
  leagueRecs.set(l.id, { ...prev, id: l.id, ...(d.nome ? { name: d.nome } : {}), rules: { ...((prev.rules as Rec) ?? {}), ...rules } });
}

// ---------------------------------------------------------------- jogadores: planilhas
const keyOf = (first: unknown, last: unknown, birth: unknown) => `${norm(`${first} ${last}`)}|${birth}`;
const csvByKey = new Map<string, { rec: Rec; lg: string }>();
for (const d of ligas) for (const r of d.csvPlayers) {
  const k = keyOf(r.firstName, r.lastName, r.birthDate);
  if (csvByKey.has(k)) { avisos.push(`${r.firstName} ${r.lastName}: está em duas planilhas (${csvByKey.get(k)!.lg} e ${d.lg}); fica a primeira, ${r.id} removido`); removed.add(String(r.id)); continue; }
  csvByKey.set(k, { rec: r, lg: d.lg });
}
const currentClub = (id: string) => (players.has(id) && 'club' in players.get(id)! ? (players.get(id)!.club as string | null) : (wPlayer.get(id)?.clubId ?? null));
const outOfScope = (id: string) => { const c = currentClub(id); return !!c && !scopeClubs.has(c); };
const universeByKey = new Map<string, string[]>();
for (const p of before.players) push(universeByKey, keyOf(p.firstName, p.lastName, p.birthDate), p.id);
for (const r of pack.data.players) if (!wPlayer.has(String(r.id)) && r.firstName) push(universeByKey, keyOf(r.firstName, r.lastName, r.birthDate), String(r.id));
for (const [k, { rec, lg }] of [...csvByKey]) {
  const others = (universeByKey.get(k) ?? []).filter((id) => id !== rec.id && !removed.has(id));
  const kept = others.find(outOfScope);
  if (kept) { avisos.push(`${rec.firstName} ${rec.lastName}: já está em ${wClub.get(currentClub(kept)!)?.name ?? currentClub(kept)} (${kept}), fora desta importação; a linha da planilha ${lg} (${rec.id}) foi descartada`); removed.add(String(rec.id)); csvByKey.delete(k); continue; }
  for (const id of others) { removed.add(id); avisos.push(`${rec.firstName} ${rec.lastName}: registro antigo ${id} removido (fica ${rec.id}, da planilha ${lg})`); }
}
for (const { rec } of csvByKey.values()) { const id = String(rec.id); players.set(id, { ...(players.get(id) ?? {}), ...rec }); playerOrigin.set(id, 'planilha'); }

// ---------------------------------------------------------------- extração: casa com as planilhas e completa os elencos
const csvByName = new Map<string, string[]>(), csvByLastBirth = new Map<string, Rec[]>();
for (const [k, { rec }] of csvByKey) { push(csvByName, k.split('|')[0]!, String(rec.id)); push(csvByLastBirth, `${lastToken(String(rec.lastName))}|${rec.birthDate}`, rec); }
const extNames = new Set(ligas.flatMap((d) => d.ext.map((r) => norm(r.nome))));
const pending: Array<{ row: Row; dir: string; club: string }> = [];
for (const d of ligas) for (const r of d.ext) {
  const club = teamToClub.get(teamKey(d.dir, r.time));
  const k = `${norm(r.nome)}|${r.nascimento}`;
  let id = csvByKey.get(k)?.rec.id as string | undefined;
  if (id && playerExt.has(id)) id = undefined;
  if (!id) { const c = (csvByName.get(norm(r.nome)) ?? []).filter((x) => !playerExt.has(x)); if (c.length === 1) id = c[0]; }
  if (!id && isDate(r.nascimento)) { const c = (csvByLastBirth.get(`${lastToken(r.nome)}|${r.nascimento}`) ?? []).filter((rec) => !playerExt.has(String(rec.id)) && !extNames.has(norm(`${rec.firstName} ${rec.lastName}`))); if (c.length === 1) id = String(c[0]!.id); }
  if (id) {
    playerExt.set(id, { row: r, dir: d.dir }); extToId.set(r, id);
    const rec = players.get(id)!;
    if (club && rec.club !== club) { avisos.push(`${rec.firstName} ${rec.lastName}: planilha em ${clubRecs.get(String(rec.club))?.name ?? rec.club}, extração em ${r.time} → vai para ${clubRecs.get(club)?.name ?? club}`); rec.club = club; }
    continue;
  }
  if (club) pending.push({ row: r, dir: d.dir, club });
}
for (const { row: r, dir, club } of pending) {
  if (!isDate(r.nascimento)) { avisos.push(`${r.nome} (${r.time}): sem data de nascimento na extração; não importado`); continue; }
  const age0 = ageOn(r.nascimento, refDate);
  if (age0 < 15 || age0 > 45) { avisos.push(`${r.nome} (${r.time}): ${age0} anos na data de início do jogo (aceita 15 a 45); não importado`); continue; }
  const k = `${norm(r.nome)}|${r.nascimento}`;
  const cands = (universeByKey.get(k) ?? []).filter((id) => !removed.has(id) && !playerExt.has(id));
  if (cands.some(outOfScope)) { const o = cands.find(outOfScope)!; avisos.push(`${r.nome} (${r.time}): já está em ${wClub.get(currentClub(o)!)?.name ?? currentClub(o)} (${o}), fora desta importação; não duplicado`); continue; }
  const country = String(clubRecs.get(club)?.country ?? wClub.get(club)?.countryId ?? '');
  const pos = positions(r), nat = (r.pais_codigo ?? '').toUpperCase();
  const common: Rec = { birthDate: r.nascimento, nationality: nationOf(nat) ? nat : (NACAO[country] ?? 'BRA'), club, position: pos.position, secondaryPositions: pos.secondaryPositions,
    ...(foot(r.pe_preferido) ? { foot: foot(r.pe_preferido) } : {}), ...(Number(r.altura_cm) >= 140 && Number(r.altura_cm) <= 220 ? { heightCm: Math.round(Number(r.altura_cm)) } : {}) };
  if (cands.length) {
    const id = cands[0]!; players.set(id, { ...(players.get(id) ?? { id }), ...common, ...(isDate(r.contrato_ate) ? { contract: { ...((players.get(id)?.contract as object) ?? {}), end: r.contrato_ate } } : {}) });
    playerOrigin.set(id, 'extração (existente)'); playerExt.set(id, { row: r, dir }); extToId.set(r, id); continue;
  }
  const [firstName, lastName] = splitName(r.nome);
  const id = uniqId(`${firstName}-${lastName}-${r.nascimento.slice(0, 4)}`);
  players.set(id, { id, firstName, lastName, ...common, ...(isDate(r.contrato_ate) ? { contract: { end: r.contrato_ate } } : {}) });
  playerOrigin.set(id, 'extração (novo)'); playerExt.set(id, { row: r, dir }); extToId.set(r, id); created.push({ id, row: r });
}
for (const id of removed) { if (wPlayer.has(id)) players.set(id, { id, $remove: true }); else players.delete(id); }

// elenco acima do máximo: sai (fica sem clube) quem veio da extração com menor valor de mercado
const squadOf = new Map<string, string[]>();
for (const id of new Set([...before.players.map((p) => p.id), ...players.keys()])) {
  if (players.get(id)?.$remove) continue;
  const c = currentClub(id); if (c && scopeClubs.has(c)) push(squadOf, c, id);
}
const posOf = (id: string) => String(players.get(id)?.position ?? wPlayer.get(id)?.position ?? '');
for (const [club, sq] of squadOf) {
  // o compilador completa com goleiro gerado quem tem menos de 2: goleiros não saem e, se faltar, reserva-se a vaga
  const gks = sq.filter((id) => posOf(id) === 'GK').length, limit = SQUAD_MAX - Math.max(0, 2 - gks);
  if (sq.length <= limit) continue;
  // ordem de saída: 1) acrescentados da extração; 2) da planilha que a extração não confirma no clube; 3) da planilha confirmados — o de menor valor primeiro
  const tier = (id: string) => (playerOrigin.get(id)?.startsWith('extração') ? 0 : playerExt.has(id) ? 2 : 1);
  const val = (id: string) => (playerExt.has(id) ? value(playerExt.get(id)!.row) : -1);
  const extra = sq.filter((id) => posOf(id) !== 'GK').sort((a, b) => tier(a) - tier(b) || val(a) - val(b)).slice(0, sq.length - limit);
  for (const id of extra) { if (!players.has(id)) players.set(id, { id }); players.get(id)!.club = null; }
  const n = (t: number) => extra.filter((id) => tier(id) === t).length;
  avisos.push(`${clubRecs.get(club)?.name ?? club}: ${sq.length} jogadores, acima de ${limit}; ficaram sem clube ${n(0)} acrescentado(s) da extração, ${n(1)} da planilha sem confirmação e ${n(2)} da planilha confirmado(s) (os de menor valor)`);
}

// ---------------------------------------------------------------- força dos novos: regressão por liga nos jogadores com atributos
const build = () => ({ manifest: pack.manifest, data: { ...pack.data,
  players: [...players.values()] as typeof pack.data.players, clubs: [...clubRecs.values()] as typeof pack.data.clubs,
  coaches: [...coachRecs.values()] as typeof pack.data.coaches, leagues: [...leagueRecs.values()] as typeof pack.data.leagues } });
for (const c of created) players.get(c.id)!.ability = 10;   // provisório, só para compilar
const w1 = compileWith(build()).world;
const p1 = new Map(w1.players.map((p) => [p.id, p]));
const lgOfClub = new Map(w1.clubs.map((c) => [c.id, c.leagueId ?? '']));
const feats = (row: Row, v: number) => { const age = ageOn(row.nascimento, refDate); return [1, Math.log(v), age - 26, (age - 26) ** 2, row.grupo === 'goleiro' ? 1 : 0]; };
const samples = [...playerExt].filter(([id, { row }]) => playerOrigin.get(id) === 'planilha' && value(row) > 0 && isDate(row.nascimento) && p1.has(id))
  .map(([id, { row }]) => ({ lg: lgOfClub.get(p1.get(id)!.clubId ?? '') ?? '', x: feats(row, value(row)), y: p1.get(id)!.overall / 5 }));
const fit = (s: typeof samples) => { const coef = ols(s.map((x) => x.x), s.map((x) => x.y)); const pred = (x: number[]) => x.reduce((a, v, i) => a + v * coef[i]!, 0);
  return { coef, pred, n: s.length, rmse: Math.sqrt(s.reduce((a, x) => a + (x.y - pred(x.x)) ** 2, 0) / s.length) }; };
const global = fit(samples);
const models = new Map<string, ReturnType<typeof fit> & { tipo: string }>();
for (const L of LIGAS) { const s = samples.filter((x) => x.lg === L.lg); models.set(L.lg, s.length >= 60 ? { ...fit(s), tipo: 'da liga' } : { ...global, tipo: 'geral' }); }
const medianValue = new Map<string, number>();
for (const c of created) {
  const lg = lgOfClub.get(String(players.get(c.id)!.club ?? '')) ?? '';
  const m = models.get(lg) ?? { ...global, tipo: 'geral' };
  if (!medianValue.has(lg)) { const v = samples.filter((x) => x.lg === lg).map((x) => Math.exp(x.x[1]!)).sort((a, b) => a - b); medianValue.set(lg, v[Math.floor(v.length / 4)] ?? 100000); }
  const age = ageOn(c.row.nascimento, refDate);
  const ability = Math.max(1, Math.min(20, Math.round(m.pred(feats(c.row, value(c.row) || medianValue.get(lg)!)))));
  Object.assign(players.get(c.id)!, { ability, potential: Math.max(ability, Math.min(20, ability + Math.round(Math.max(0, 24 - age) * 0.7))) });
}

// ---------------------------------------------------------------- imagens dos jogadores, validação final
for (const [id, { row, dir }] of playerExt) {
  if (players.get(id)?.$remove) continue;
  const f = row.foto ? `${dir}/${row.foto}` : '';
  if (f && fs.existsSync(f)) images.push({ kind: 'players', id, file: f });
}
const badImages: string[] = [];
for (const im of [...images]) { try { validateImage(new Uint8Array(fs.readFileSync(im.file)), `${im.kind}/${im.id}`); } catch (e) { badImages.push(`${im.kind}/${im.id}: ${(e as Error).message}`); images.splice(images.indexOf(im), 1); } }
for (const b of badImages) avisos.push(`imagem recusada ${b}`);
const out = build();
const final = compileWith(out).world;
const finalIds = new Set(final.players.map((x) => x.id));
const missing = [...playerExt].filter(([id]) => !players.get(id)?.$remove && !finalIds.has(id));
if (missing.length) throw new Error(`validação: ${missing.length} jogador(es) da extração fora do universo (ex.: ${missing.slice(0, 3).map(([id]) => id).join(', ')})`);
const bySquad = new Map<string, number>(); for (const p of final.players) if (p.clubId) bySquad.set(p.clubId, (bySquad.get(p.clubId) ?? 0) + 1);
for (const L of LIGAS) {
  const cs = final.clubs.filter((c) => c.leagueId === L.lg); const sz = cs.map((c) => bySquad.get(c.id) ?? 0);
  console.log(`${L.lg}: ${cs.length} clubes, elencos de ${Math.min(...sz)} a ${Math.max(...sz)} — ${final.leagues.find((l) => l.id === L.lg)!.name}`);
}

// ---------------------------------------------------------------- relatórios
fs.mkdirSync(SAIDA, { recursive: true });
const pF = new Map(final.players.map((p) => [p.id, p]));
const imgPlayers = new Set(images.filter((x) => x.kind === 'players').map((x) => x.id));
const relJog: Rec[] = [];
for (const d of ligas) for (const r of d.ext) {
  const id = extToId.get(r); const p = id ? pF.get(id) : undefined;
  relJog.push({ liga_extracao: d.lg, extracao_id: r.id, nome: r.nome, time_real: r.time, jogador_id: id ?? '', situacao: id ? playerOrigin.get(id) : (teamToClub.has(teamKey(d.dir, r.time)) ? 'fora' : 'time fora do jogo'),
    clube_jogo_id: p?.clubId ?? '', liga_jogo: p?.clubId ? lgOfClub.get(p.clubId) ?? '' : '', posicao: p?.position ?? '', idade: isDate(r.nascimento) ? ageOn(r.nascimento, refDate) : '',
    valor_mercado_eur: value(r), forca: p ? Math.round(p.overall / 5) : '', forca_origem: id && playerOrigin.get(id) === 'extração (novo)' ? 'estimada' : 'atributos', foto: id && imgPlayers.has(id) ? 'sim' : 'não' });
}
for (const d of ligas) for (const r of d.csvPlayers) if (!playerExt.has(String(r.id)) && !removed.has(String(r.id))) {
  const p = pF.get(String(r.id));
  relJog.push({ liga_extracao: d.lg, extracao_id: '', nome: `${r.firstName} ${r.lastName}`, time_real: '', jogador_id: r.id, situacao: 'só na planilha', clube_jogo_id: p?.clubId ?? '',
    liga_jogo: p?.clubId ? lgOfClub.get(p.clubId) ?? '' : '', posicao: p?.position ?? '', idade: p ? ageOn(p.birthDate, refDate) : '', valor_mercado_eur: '', forca: p ? Math.round(p.overall / 5) : '', forca_origem: 'atributos', foto: 'não' });
}
fs.writeFileSync(path.join(SAIDA, 'jogadores.csv'), csvOut(relJog));
fs.writeFileSync(path.join(SAIDA, 'clubes.csv'), csvOut(relClubes));
fs.writeFileSync(path.join(SAIDA, 'tecnicos.csv'), csvOut(relTec));
fs.writeFileSync(path.join(SAIDA, 'removidos.csv'), csvOut([...removed].map((id) => ({ jogador_id: id, nome: wPlayer.get(id) ? `${wPlayer.get(id)!.firstName} ${wPlayer.get(id)!.lastName}` : '', na_base: wPlayer.has(id) ? 'sim' : 'não' }))));
fs.writeFileSync(path.join(SAIDA, 'regressao.json'), JSON.stringify({ variaveis: ['constante', 'ln(valor de mercado)', 'idade − 26', '(idade − 26)²', 'goleiro'], data_referencia: refDate,
  geral: { coeficientes: global.coef, amostra: global.n, rmse_forca_1a20: global.rmse },
  ligas: Object.fromEntries([...models].map(([lg, m]) => [lg, { modelo: m.tipo, coeficientes: m.coef, amostra: m.tipo === 'da liga' ? m.n : samples.filter((x) => x.lg === lg).length, rmse_forca_1a20: m.rmse,
    criados: created.filter((c) => lgOfClub.get(String(players.get(c.id)!.club ?? '')) === lg).length }])) }, null, 1));
fs.writeFileSync(path.join(SAIDA, 'regras-alteradas.txt'), ruleDiffs.join('\n') + '\n');
fs.writeFileSync(path.join(SAIDA, 'avisos.txt'), avisos.join('\n') + '\n');
const cnt = (s: string) => relJog.filter((r) => r.situacao === s).length;
console.log(`Jogadores: ${cnt('planilha')} da planilha casados com a extração, ${cnt('só na planilha')} só na planilha, ${cnt('extração (existente)')} da extração já existentes, ${cnt('extração (novo)')} criados, ${cnt('time fora do jogo')} de times fora do jogo; ${removed.size} removidos (duplicatas)`);
console.log(`Imagens: ${imgPlayers.size} jogadores, ${images.filter((x) => x.kind === 'clubs').length} escudos, ${images.filter((x) => x.kind === 'coaches').length} técnicos, ${images.filter((x) => x.kind === 'leagues').length} ligas; recusadas ${badImages.length}`);
console.log(`Regressão geral: ${global.n} jogadores, erro médio ${global.rmse.toFixed(2)}; regras alteradas: ${ruleDiffs.length}; avisos: ${avisos.length}; relatórios em ${SAIDA}`);

const TESTE = process.argv.find((x) => x.startsWith('--teste='))?.slice(8);
if (TESTE) { writePackDir(out, TESTE); console.log(`pacote de teste em ${TESTE}`); }
if (GRAVAR) {
  writePackDir(out, packDir);
  for (const im of images) setPackImage(packDir, im.kind, im.id, new Uint8Array(fs.readFileSync(im.file)));
  console.log(`Pacote "${PACOTE}" gravado em ${packDir}`);
} else console.log('Simulação (sem --gravar): nada foi gravado no pacote.');
