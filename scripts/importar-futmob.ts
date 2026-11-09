/**
 * Importa uma extração futmob (clubes, jogadores, técnicos e imagens de uma liga) para um pacote de dados, usando a base do jogo como
 * parâmetro: os clubes reais ocupam os clubes da divisão escolhida da base (mesmos ids), os jogadores que já existem no pacote são
 * reconhecidos pelo nome (e nascimento) e mantêm id e atributos; os que faltam são criados com força/potencial estimados; quem saiu do
 * elenco real fica sem clube. Plano aprovado pelo usuário em 08/11/2026 (Bundesliga 2026/27 → pacote "1").
 *
 *   node --disable-warning=ExperimentalWarning scripts/importar-futmob.ts [--gravar]
 *
 * Sem --gravar: só valida (compila o universo numa cópia temporária) e escreve o relatório. Com --gravar: grava o pacote e as imagens.
 * Rodar na pasta do projeto (a base fixa é lida de data/base).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { careerUniverse } from '../src/services/packManager.node.ts';
import { readPackDir, writePackDir } from '../src/services/packService.node.ts';
import { setPackImage, validateImage } from '../src/services/imageService.node.ts';
import { parseCsv } from '../src/game/data-pack/csv.ts';
import { slugify } from '../src/shared/slug.ts';
import { nationOf } from '../src/shared/nations.ts';
import type { Position } from '../src/shared/types.ts';

// ---------------------------------------------------------------- parâmetros
const EXTRACAO = 'D:/DATA BASE FOOTERA/futmob database/dados/bundesliga_54/2026-2027';
const DATA_DIR = path.join(process.env.APPDATA ?? '', 'football-manager-simulator', 'data');
const PACOTE = '1';
const LIGA = 'ger-1';
const NOME_LIGA = 'Bundesliga';
const SQUAD_MAX = 40;
const SAIDA = 'D:/DATA BASE FOOTERA/importacao-bundesliga-2026-27';
const GRAVAR = process.argv.includes('--gravar');
/** siglas reais (o jogo aceita 2–5 letras) */
const SIGLAS: Record<string, string> = {
  'Bayern München': 'FCB', 'Borussia Dortmund': 'BVB', 'Bayer Leverkusen': 'B04', 'RB Leipzig': 'RBL', 'VfB Stuttgart': 'VFB',
  'Eintracht Frankfurt': 'SGE', 'Hoffenheim': 'TSG', 'Mainz 05': 'M05', 'Freiburg': 'SCF', 'Augsburg': 'FCA', 'Union Berlin': 'FCU',
  '1. FC Köln': 'KOE', 'Werder Bremen': 'SVW', 'Hamburger SV': 'HSV', 'Borussia Mönchengladbach': 'BMG', 'Schalke 04': 'S04',
  'Elversberg': 'SVE', 'Paderborn': 'SCP',
};

// ---------------------------------------------------------------- utilidades
type Row = Record<string, string>;
function readCsv(file: string): Row[] {
  const { rows } = parseCsv(fs.readFileSync(file, 'utf8'));
  const head = rows[0]!.cells.map((h) => h.replace(/^\uFEFF/, '').trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r.cells[i] ?? '').trim()])));
}
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const lastToken = (s: string) => norm(s).split(' ').at(-1) ?? '';
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const splitName = (nome: string): [string, string] => {
  const parts = nome.trim().split(/\s+/);
  return parts.length === 1 ? [parts[0]!, parts[0]!] : [parts[0]!, parts.slice(1).join(' ')];
};
const ageOn = (birth: string, ref: string) => { const [y, m, d] = birth.split('-').map(Number); const [Y, M, D] = ref.split('-').map(Number); return Y! - y! - (M! < m! || (M === m && D! < d!) ? 1 : 0); };
const POS: Record<string, Position> = { GK: 'GK', CB: 'CB', LB: 'LB', RB: 'RB', LWB: 'LWB', RWB: 'RWB', CDM: 'DM', CM: 'CM', CAM: 'AM', LM: 'LM', RM: 'RM', LW: 'LW', RW: 'RW', ST: 'CF', CF: 'SS' };
const GRUPO: Record<string, Position> = { goleiro: 'GK', defensor: 'CB', 'meio-campista': 'CM', atacante: 'CF' };
function positions(r: Row): { position: Position; secondaryPositions: Position[] } {
  const list = r.posicao.split(',').map((p) => POS[p.trim().toUpperCase()]).filter((p): p is Position => !!p);
  const uniq = [...new Set(list)];
  const position = uniq[0] ?? GRUPO[r.grupo] ?? 'CM';
  return { position, secondaryPositions: uniq.filter((p) => p !== position).slice(0, 3) };
}
const foot = (s: string): 'right' | 'left' | 'both' | undefined => (s === 'right' || s === 'left' || s === 'both' ? s : undefined);

/** mínimos quadrados (equações normais, eliminação de Gauss) */
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
const csvOut = (rows: Array<Record<string, unknown>>) => {
  const head = Object.keys(rows[0] ?? {});
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '\uFEFF' + [head.join(';'), ...rows.map((r) => head.map((h) => esc(r[h])).join(';'))].join('\n') + '\n';
};

// ---------------------------------------------------------------- leitura
const packDir = path.join(DATA_DIR, 'packs', PACOTE);
const pack = readPackDir(packDir);
const before = careerUniverse(DATA_DIR);
const world = before.world;
const refDate = world.startDate;
const times = readCsv(path.join(EXTRACAO, 'tabelas', 'times.csv'));
const jogadores = readCsv(path.join(EXTRACAO, 'tabelas', 'jogadores.csv'));
const tecnicos = readCsv(path.join(EXTRACAO, 'tabelas', 'tecnicos.csv'));
const ligaClubs = world.clubs.filter((c) => c.leagueId === LIGA);
if (ligaClubs.length !== times.length) throw new Error(`${LIGA} tem ${ligaClubs.length} clubes na base; a extração tem ${times.length}`);
const wPlayer = new Map(world.players.map((p) => [p.id, p]));
const packPlayers = new Map(pack.data.players.map((r) => [String(r.id), { ...r } as Record<string, unknown>]));
const avisos: string[] = [];

// ---------------------------------------------------------------- casamento de jogadores
// candidatos: todos os jogadores do universo (o pacote e os demais), pelo nome completo normalizado
const byName = new Map<string, string[]>();
const byLastBirth = new Map<string, string[]>();
for (const p of world.players) {
  const n = norm(`${p.firstName} ${p.lastName}`);
  (byName.get(n) ?? byName.set(n, []).get(n)!).push(p.id);
  const lb = `${lastToken(p.lastName)}|${p.birthDate}`;
  (byLastBirth.get(lb) ?? byLastBirth.set(lb, []).get(lb)!).push(p.id);
}
const usedIds = new Set<string>();
const extractionNames = new Set(jogadores.map((r) => norm(r.nome)));
interface Match { row: Row; id: string | null; how: 'nome+nascimento' | 'nome' | 'sobrenome+nascimento' | 'novo' }
const matches: Match[] = jogadores.map((row) => {
  const cands = (byName.get(norm(row.nome)) ?? []).filter((id) => !usedIds.has(id));
  const exact = cands.filter((id) => wPlayer.get(id)!.birthDate === row.nascimento);
  let id: string | null = null, how: Match['how'] = 'novo';
  if (exact.length >= 1) { id = exact.find((x) => packPlayers.has(x)) ?? exact[0]!; how = 'nome+nascimento'; }
  else if (cands.length === 1 && packPlayers.has(cands[0]!)) { id = cands[0]!; how = 'nome'; avisos.push(`${row.nome}: casado só pelo nome (nascimento ${row.nascimento} × ${wPlayer.get(id)!.birthDate})`); }
  else {
    // mesmo sobrenome e nascimento, mas não se o candidato tem o nome de outro jogador da extração (gêmeos: Emil × Oscar Højlund)
    const lb = (byLastBirth.get(`${lastToken(row.nome)}|${row.nascimento}`) ?? []).filter((x) => !usedIds.has(x) && packPlayers.has(x)
      && !extractionNames.has(norm(`${wPlayer.get(x)!.firstName} ${wPlayer.get(x)!.lastName}`)));
    if (lb.length === 1) { id = lb[0]!; how = 'sobrenome+nascimento'; const p = wPlayer.get(id)!; avisos.push(`${row.nome}: casado com ${p.firstName} ${p.lastName} (mesmo sobrenome e nascimento)`); }
  }
  if (id) usedIds.add(id);
  return { row, id, how };
});

// ---------------------------------------------------------------- clubes: real → base, reputação
const realTeams = times.map((t) => t.nome);
const votes = new Map<string, Map<string, number>>();
for (const m of matches) if (m.id && packPlayers.has(m.id)) {
  const club = String(packPlayers.get(m.id)!.club ?? wPlayer.get(m.id)!.clubId ?? '');
  if (!ligaClubs.some((c) => c.id === club)) continue;
  const v = votes.get(m.row.time) ?? votes.set(m.row.time, new Map()).get(m.row.time)!;
  v.set(club, (v.get(club) ?? 0) + 1);
}
const pairs = [...votes].flatMap(([team, v]) => [...v].map(([club, n]) => ({ team, club, n }))).sort((a, b) => b.n - a.n);
const teamToClub = new Map<string, string>(), takenClubs = new Set<string>();
for (const p of pairs) if (p.n >= 5 && !teamToClub.has(p.team) && !takenClubs.has(p.club)) { teamToClub.set(p.team, p.club); takenClubs.add(p.club); }
const freeClubs = ligaClubs.filter((c) => !takenClubs.has(c.id)).sort((a, b) => b.reputation - a.reputation);
const freeTeams = realTeams.filter((t) => !teamToClub.has(t));
freeTeams.forEach((t, i) => { teamToClub.set(t, freeClubs[i]!.id); takenClubs.add(freeClubs[i]!.id); });
const value = (r: Row) => Number(r.valor_mercado_eur) || 0;
const squadValue = new Map(realTeams.map((t) => [t, jogadores.filter((r) => r.time === t).reduce((s, r) => s + value(r), 0)]));
const repsDesc = ligaClubs.map((c) => c.reputation).sort((a, b) => b - a);
const teamsByValue = [...realTeams].sort((a, b) => squadValue.get(b)! - squadValue.get(a)!);
const newRep = new Map(teamsByValue.map((t, i) => [t, repsDesc[i]!]));
const clubName = (id: string) => world.clubs.find((c) => c.id === id)!.name;

// ---------------------------------------------------------------- força estimada (regressão nos jogadores que casaram)
const sample = matches.filter((m) => m.id && value(m.row) > 0).map((m) => {
  const age = ageOn(m.row.nascimento, refDate);
  return { x: [1, Math.log(value(m.row)), age - 26, (age - 26) ** 2, m.row.grupo === 'goleiro' ? 1 : 0], y: wPlayer.get(m.id!)!.overall / 5 };
});
const coef = ols(sample.map((s) => s.x), sample.map((s) => s.y));
const pred = (x: number[]) => x.reduce((s, v, i) => s + v * coef[i]!, 0);
const resid = sample.map((s) => s.y - pred(s.x));
const rmse = Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / resid.length);
const medianValue = (() => { const v = jogadores.map(value).filter((x) => x > 0).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] ?? 100000; })();
function estimate(r: Row): { ability: number; potential: number } {
  const age = ageOn(r.nascimento, refDate);
  const ability = Math.max(1, Math.min(20, Math.round(pred([1, Math.log(value(r) || medianValue), age - 26, (age - 26) ** 2, r.grupo === 'goleiro' ? 1 : 0]))));
  const potential = Math.max(ability, Math.min(20, ability + Math.round(Math.max(0, 24 - age) * 0.7)));
  return { ability, potential };
}

// ---------------------------------------------------------------- registros do pacote
const allIds = new Set<string>([...world.players.map((p) => p.id), ...world.clubs.map((c) => c.id), ...world.stadiums.map((s) => s.id)]);
const uniqId = (base: string) => { const b = slugify(base) || 'jogador'; let id = b, k = 2; while (allIds.has(id)) id = `${b}-${k++}`; allIds.add(id); return id; };
const relatorio: Array<Record<string, unknown>> = [];
const finalPlayers = new Map(packPlayers);
const inSquad = new Set<string>();
for (const m of matches) {
  const r = m.row, club = teamToClub.get(r.time)!;
  const pos = positions(r), nat = r.pais_codigo.toUpperCase();
  const natOk = /^[A-Z]{3}$/.test(nat) && !!nationOf(nat);
  if (!natOk) avisos.push(`${r.nome}: nacionalidade "${r.pais_codigo}" fora da lista`);
  const common: Record<string, unknown> = {
    birthDate: r.nascimento, ...(natOk ? { nationality: nat } : {}), club, position: pos.position, secondaryPositions: pos.secondaryPositions,
    ...(foot(r.pe_preferido) ? { foot: foot(r.pe_preferido) } : {}),
    ...(Number(r.altura_cm) >= 140 && Number(r.altura_cm) <= 220 ? { heightCm: Math.round(Number(r.altura_cm)) } : {}),
  };
  let id: string, est: { ability: number; potential: number } | null = null;
  if (m.id) {
    id = m.id;
    const prev = finalPlayers.get(id) ?? { id };
    const contract = isDate(r.contrato_ate) ? { ...((prev.contract as object) ?? {}), end: r.contrato_ate } : prev.contract;
    finalPlayers.set(id, { ...prev, ...common, ...(contract ? { contract } : {}) });
  } else {
    const [firstName, lastName] = splitName(r.nome);
    id = uniqId(`${firstName}-${lastName}-${r.nascimento.slice(0, 4)}`);
    est = estimate(r);
    finalPlayers.set(id, { id, firstName, lastName, ...common, ...(natOk ? {} : { nationality: 'GER' }), ability: est.ability, potential: est.potential,
      ...(isDate(r.contrato_ate) ? { contract: { end: r.contrato_ate } } : {}) });
  }
  inSquad.add(id);
  const foto = r.foto && fs.existsSync(path.join(EXTRACAO, r.foto));
  relatorio.push({ extracao_id: r.id, nome: r.nome, time_real: r.time, clube_jogo_id: club, clube_jogo_nome_base: clubName(club), jogador_id: id,
    situacao: m.id ? 'atualizado' : 'criado', criterio: m.how, posicao: pos.position, secundarias: pos.secondaryPositions.join('/'),
    idade: ageOn(r.nascimento, refDate), valor_mercado_eur: value(r), forca: est ? est.ability : Math.round(wPlayer.get(id)!.overall / 5),
    potencial: est ? est.potential : '', forca_origem: est ? 'estimada' : 'atributos do pacote', foto: foto ? 'sim' : 'não' });
}
// quem estava no pacote e não está no elenco real: sem clube
for (const [id, rec] of finalPlayers) if (!inSquad.has(id) && rec.club && ligaClubs.some((c) => c.id === rec.club)) {
  relatorio.push({ extracao_id: '', nome: `${rec.firstName ?? wPlayer.get(id)?.firstName} ${rec.lastName ?? wPlayer.get(id)?.lastName}`, time_real: '',
    clube_jogo_id: '', clube_jogo_nome_base: clubName(String(rec.club)), jogador_id: id, situacao: 'liberado', criterio: 'fora do elenco real', posicao: rec.position ?? wPlayer.get(id)?.position,
    secundarias: '', idade: wPlayer.get(id) ? ageOn(wPlayer.get(id)!.birthDate, refDate) : '', valor_mercado_eur: '', forca: wPlayer.get(id) ? Math.round(wPlayer.get(id)!.overall / 5) : '', potencial: '', forca_origem: 'atributos do pacote', foto: '' });
  finalPlayers.set(id, { ...rec, club: null });
}

// técnicos: o técnico da IA de cada clube recebe o técnico real
const coachOf = new Map((world.coaches ?? []).filter((k) => k.clubId).map((k) => [k.clubId!, k.id]));
const coachRecs: Array<Record<string, unknown>> = [], coachImgs: Array<{ id: string; file: string }> = [];
const relTec: Array<Record<string, unknown>> = [];
for (const t of tecnicos) {
  const club = teamToClub.get(t.time), cid = club ? coachOf.get(club) : undefined;
  if (!club || !cid) { avisos.push(`técnico ${t.nome}: clube sem técnico no universo`); continue; }
  const [firstName, lastName] = splitName(t.nome); const nat = t.pais_codigo.toUpperCase();
  coachRecs.push({ id: cid, firstName, lastName, ...(isDate(t.nascimento) ? { birthDate: t.nascimento } : {}), ...(nationOf(nat) ? { nationality: nat } : {}), club });
  if (t.foto && fs.existsSync(path.join(EXTRACAO, t.foto))) coachImgs.push({ id: cid, file: path.join(EXTRACAO, t.foto) });
  relTec.push({ nome: t.nome, time_real: t.time, clube_jogo_id: club, tecnico_id: cid, foto: coachImgs.some((x) => x.id === cid) ? 'sim' : 'não' });
}
const clubRecs = times.map((t) => ({ id: teamToClub.get(t.nome)!, name: t.nome, shortName: SIGLAS[t.nome] ?? t.nome_curto.slice(0, 3).toUpperCase(), reputation: newRep.get(t.nome)! }));
const keepClubs = (pack.data.clubs ?? []).filter((c) => !clubRecs.some((x) => x.id === c.id));
const keepCoaches = (pack.data.coaches ?? []).filter((c) => !coachRecs.some((x) => x.id === c.id));
const keepLeagues = (pack.data.leagues ?? []).filter((l) => l.id !== LIGA);
const prevLeague = (pack.data.leagues ?? []).find((l) => l.id === LIGA) as Record<string, unknown> | undefined;
const leagueRec = { ...(prevLeague ?? {}), id: LIGA, name: NOME_LIGA, rules: { ...((prevLeague?.rules as object) ?? {}), squadMax: SQUAD_MAX } };
const out = { manifest: pack.manifest, data: { ...pack.data,
  players: [...finalPlayers.values()] as typeof pack.data.players, clubs: [...keepClubs, ...clubRecs] as typeof pack.data.clubs,
  coaches: [...keepCoaches, ...coachRecs] as typeof pack.data.coaches, leagues: [...keepLeagues, leagueRec] as typeof pack.data.leagues } };

// imagens
const playerImgs = matches.flatMap((m, i) => { const r = m.row; const f = r.foto ? path.join(EXTRACAO, r.foto) : ''; return f && fs.existsSync(f) ? [{ id: String(relatorio[i]!.jogador_id), file: f }] : []; });
const clubImgs = times.flatMap((t) => { const f = t.logo ? path.join(EXTRACAO, t.logo) : ''; return f && fs.existsSync(f) ? [{ id: teamToClub.get(t.nome)!, file: f }] : []; });
const ligaLogo = fs.readdirSync(path.join(EXTRACAO, 'imagens', 'liga')).find((f) => /^\d+\.png$/.test(f));
const allImgs: Array<{ kind: 'players' | 'clubs' | 'coaches' | 'leagues'; id: string; file: string }> = [
  ...playerImgs.map((x) => ({ kind: 'players' as const, ...x })), ...clubImgs.map((x) => ({ kind: 'clubs' as const, ...x })),
  ...coachImgs.map((x) => ({ kind: 'coaches' as const, ...x })), ...(ligaLogo ? [{ kind: 'leagues' as const, id: LIGA, file: path.join(EXTRACAO, 'imagens', 'liga', ligaLogo) }] : [])];
for (const im of allImgs) validateImage(new Uint8Array(fs.readFileSync(im.file)), `${im.kind}/${im.id}`);

// ---------------------------------------------------------------- validação numa cópia temporária
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'futmob-'));
try {
  fs.mkdirSync(path.join(tmp, 'packs'), { recursive: true });
  for (const f of fs.readdirSync(path.join(DATA_DIR, 'packs'))) {
    const src = path.join(DATA_DIR, 'packs', f);
    if (f === PACOTE) continue;
    if (fs.statSync(src).isDirectory()) { const p = readPackDir(src); writePackDir(p, path.join(tmp, 'packs', f)); } else fs.copyFileSync(src, path.join(tmp, 'packs', f));
  }
  writePackDir(out, path.join(tmp, 'packs', PACOTE));
  const after = careerUniverse(tmp).world;
  const sizes = ligaClubs.map((c) => after.players.filter((p) => p.clubId === c.id).length);
  for (const m of relatorio.filter((x) => x.situacao !== 'liberado')) {
    const p = after.players.find((x) => x.id === m.jogador_id);
    if (!p || p.clubId !== m.clube_jogo_id) throw new Error(`validação: ${m.nome} não está no clube ${m.clube_jogo_id}`);
  }
  console.log(`Validação ok: elencos de ${Math.min(...sizes)} a ${Math.max(...sizes)} jogadores; ${after.clubs.filter((c) => c.leagueId === LIGA).map((c) => c.name).join(', ')}`);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

// ---------------------------------------------------------------- relatórios
fs.mkdirSync(SAIDA, { recursive: true });
fs.writeFileSync(path.join(SAIDA, 'jogadores.csv'), csvOut(relatorio));
fs.writeFileSync(path.join(SAIDA, 'clubes.csv'), csvOut(times.map((t) => {
  const id = teamToClub.get(t.nome)!, base = world.clubs.find((c) => c.id === id)!;
  return { time_real: t.nome, sigla: SIGLAS[t.nome] ?? '', clube_jogo_id: id, nome_na_base: base.name, reputacao_antes: base.reputation, reputacao_depois: newRep.get(t.nome),
    valor_elenco_eur: squadValue.get(t.nome), jogadores_extracao: jogadores.filter((r) => r.time === t.nome).length,
    criterio: freeTeams.includes(t.nome) ? 'promovido (lugar livre)' : 'maioria dos jogadores do pacote', escudo: clubImgs.some((x) => x.id === id) ? 'sim' : 'não' };
})));
fs.writeFileSync(path.join(SAIDA, 'tecnicos.csv'), csvOut(relTec));
fs.writeFileSync(path.join(SAIDA, 'regressao.json'), JSON.stringify({ variaveis: ['constante', 'ln(valor de mercado)', 'idade − 26', '(idade − 26)²', 'goleiro'],
  coeficientes: coef, amostra: sample.length, rmse_forca_1a20: rmse, data_referencia: refDate }, null, 1));
fs.writeFileSync(path.join(SAIDA, 'avisos.txt'), avisos.join('\n') + '\n');
const count = (s: string) => relatorio.filter((r) => r.situacao === s).length;
console.log(`Jogadores: ${count('atualizado')} atualizados, ${count('criado')} criados, ${count('liberado')} liberados; imagens: ${playerImgs.length} jogadores, ${clubImgs.length} escudos, ${coachImgs.length} técnicos, ${ligaLogo ? 1 : 0} liga; avisos: ${avisos.length}`);
console.log(`Regressão da força (1–20): ${sample.length} jogadores, erro médio ${rmse.toFixed(2)}; relatórios em ${SAIDA}`);

// ---------------------------------------------------------------- gravação
if (GRAVAR) {
  writePackDir(out, packDir);
  for (const im of allImgs) setPackImage(packDir, im.kind, im.id, new Uint8Array(fs.readFileSync(im.file)));
  console.log(`Pacote "${PACOTE}" gravado em ${packDir}`);
} else console.log('Simulação (sem --gravar): nada foi gravado no pacote.');
