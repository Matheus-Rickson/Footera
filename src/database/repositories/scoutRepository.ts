import type { SqlDb } from '../types.ts';
import { familiarity, ROLES, roleSuitability } from '../../game/match-engine/playerRoles.ts';
import { roleFocusMap, withFamiliarity } from './roleRepository.ts';
import { withTransaction } from '../types.ts';
import { UserError } from '../../shared/errors.ts';
import { createRng } from '../../game/rng.ts';
import { addDays, addYears, ageOn } from '../../shared/date.ts';
import { COUNTRY_TEMPLATES } from '../../game/world/names.ts';
import { dailyGain, maxScoutsFor, SCOUT_CONTRACT_YEARS, SCOUT_SEVERANCE_MONTHS, scoutCandidates, trackedFor } from '../../game/scouting-engine/scouting.ts';
import { facilitiesOf } from './staffRepository.ts';
import {
  addMonths, compatibleBucket, criteriaProblems, matchesCriteria, MAX_FOUND, MAX_OPEN_TASKS, needsAttributes, needsStats, reportDays, taskGain, taskName,
  type ScoutCriteria, type ScoutScope, type ScoutSubject,
} from '../../game/scouting-engine/tasks.ts';
import { estimateAttributes, estimateRange, groupOf, scoutVerdict, windowStatus } from '../../game/transfer-engine/transfer.ts';
import type { MarketPlayerDto, PlayerProfileDto, ScoutDto, ScoutingOverviewDto, ScoutTaskDto, ScoutTaskInput, ScoutTaskPreviewDto } from '../../shared/api.ts';
import { getCareerState } from './careerRepository.ts';
import { makePoster } from './financeRepository.ts';
import { addNews } from './newsRepository.ts';
import { rowToPlayer } from './worldRepository.ts';
import { summarizeRanges } from '../../shared/attributeSummary.ts';
import { fmtMoney } from '../../shared/money.ts';
import { nationName } from '../../shared/nations.ts';

export class ScoutError extends UserError {}

import { playerReputation } from '../../shared/scale.ts';
import { CURRENT_COMP } from './countrySeasonRepository.ts';
const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const fmt = fmtMoney; // dinheiro nas mensagens (moeda única: euro)
const seedOf = (db: SqlDb) => S((db.prepare("SELECT value FROM meta WHERE key = 'world_seed'").get() ?? { value: 'sem-semente' }).value);
const userEconomy = (db: SqlDb, clubId: string) => N(db.prepare('SELECT co.economy FROM clubs cl JOIN countries co ON co.id = cl.country_id WHERE cl.id = ?').get(clubId)!.economy);
const monthsLeft = (date: string, end: string) => Math.max(0, (Number(end.slice(0, 4)) - Number(date.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(date.slice(5, 7)));

/** Conhecimento acumulado (0..100) sobre cada jogador observado. */
export function knowledgeMap(db: SqlDb): Map<string, number> {
  return new Map(db.prepare('SELECT player_id, knowledge FROM scout_knowledge').all().map((r) => [S(r.player_id), N(r.knowledge)]));
}


/** Jogador de outro clube (ou livre) como o usuário o enxerga: só estimativas, mais estreitas quanto maior o conhecimento. */
export function toScoutedDto(db: SqlDb, r: Record<string, unknown>, date: string, knowledge: number, shortlisted: boolean): MarketPlayerDto {
  const p = rowToPlayer(r);
  const est = estimateRange(p.overall, p.potentialEstimated, seedOf(db), p.id, knowledge, p.potentialHidden);
  return {
    id: p.id, name: `${p.firstName} ${p.lastName}`, age: ageOn(p.birthDate, date), nationality: p.nationality, position: p.position, secondaryPositions: p.secondaryPositions, foot: p.foot,
    clubId: p.clubId, clubName: r.club_name == null ? null : S(r.club_name), marketValue: p.marketValue, salary: p.salary, contractEnd: p.contractEnd,
    estOverall: est.overall, estPotential: est.potential, knowledge: Math.floor(knowledge), shortlisted,
    reputation: playerReputation(p.marketValue, r.club_reputation == null ? null : N(r.club_reputation)),
    nationalityName: countryName(db, p.nationality), heightCm: p.heightCm, weightKg: p.weightKg, status: publicStatus(db, p.id, date),
    estSummary: summarizeRanges(estimateAttributes(p.attributes, seedOf(db), p.id, knowledge)),
  };
}

const countryName = (db: SqlDb, code: string) => { const r = db.prepare('SELECT name FROM countries WHERE code = ?').get(code); return nationName(code, r ? S(r.name) : null); };
/** Situação pública do jogador: lesão em curso, suspensão e cartões nas competições da temporada atual. */
function publicStatus(db: SqlDb, playerId: string, date: string): MarketPlayerDto['status'] {
  const ps = db.prepare('SELECT injury_until, suspension_matches FROM player_status WHERE player_id = ?').get(playerId);
  const cards = db.prepare(`SELECT COALESCE(SUM(pss.yellow_cards), 0) AS y, COALESCE(SUM(pss.red_cards), 0) AS r FROM player_season_stats pss
    JOIN competitions c ON c.id = pss.competition_id WHERE pss.player_id = ? AND ${CURRENT_COMP}`).get(playerId)!;
  const injury = ps?.injury_until == null ? null : S(ps.injury_until);
  return { injuredUntil: injury && injury > date ? injury : null, suspension: ps ? N(ps.suspension_matches) : 0, yellows: N(cards.y), reds: N(cards.r) };
}

export function getScoutingOverview(db: SqlDb): ScoutingOverviewDto {
  const st = getCareerState(db);
  const tasks = listScoutTasks(db);
  const byScout = new Map(tasks.filter((t) => t.status === 'active' && t.scoutId).map((t) => [t.scoutId!, t]));
  const scouts: ScoutDto[] = db.prepare('SELECT * FROM scouts ORDER BY hired_on, id').all().map((r) => ({
    id: S(r.id), name: `${S(r.first_name)} ${S(r.last_name)}`, nationality: S(r.nationality), ability: N(r.ability), salary: N(r.salary), contractEnd: S(r.contract_end),
    taskId: byScout.get(S(r.id))?.id ?? null, taskName: byScout.get(S(r.id))?.name ?? null,
  }));
  const hired = new Set(scouts.map((s) => s.id));
  const candidates = scoutCandidates(seedOf(db), st.gameDate.slice(0, 7), COUNTRY_TEMPLATES, userEconomy(db, st.clubId)).filter((c) => !hired.has(c.id))
    .map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, nationality: c.nationality, ability: c.ability, salary: c.salary }));
  const know = knowledgeMap(db);
  const shortlistIds = new Set(db.prepare('SELECT player_id FROM scout_shortlist').all().map((r) => S(r.player_id)));
  const sel = 'SELECT p.*, c.name AS club_name, c.reputation AS club_reputation FROM players p LEFT JOIN clubs c ON c.id = p.club_id';
  const visible = (r: Record<string, unknown>) => N(r.retired) === 0 && r.youth_club_id == null && S(r.club_id) !== st.clubId;
  const shortlist = db.prepare(`${sel} JOIN scout_shortlist s ON s.player_id = p.id ORDER BY s.added_on, p.id`).all().filter(visible)
    .map((r) => toScoutedDto(db, r, st.gameDate, know.get(S(r.id)) ?? 0, true));
  const reports = db.prepare(`${sel} JOIN scout_knowledge k ON k.player_id = p.id WHERE k.knowledge >= 50 ORDER BY k.knowledge DESC, p.id LIMIT 400`).all().filter(visible)
    .map((r) => toScoutedDto(db, r, st.gameDate, know.get(S(r.id)) ?? 0, shortlistIds.has(S(r.id))))
    .sort((a, b) => b.estPotential.low + b.estPotential.high - a.estPotential.low - a.estPotential.high).slice(0, 60);
  return {
    scouts, candidates, maxScouts: maxScoutsFor(facilitiesOf(db, st.clubId).scouting), deptLevel: facilitiesOf(db, st.clubId).scouting, tracked: trackedFor(facilitiesOf(db, st.clubId).scouting), monthlyCost: scouts.reduce((s, x) => s + x.salary, 0),
    countries: db.prepare('SELECT code, name FROM countries ORDER BY rowid').all().map((r) => ({ code: S(r.code), name: S(r.name) })),
    leagues: db.prepare(`SELECT l.id, l.name, co.code, co.name AS cn FROM leagues l JOIN countries co ON co.id = l.country_id
      WHERE l.active = 1 AND EXISTS (SELECT 1 FROM clubs c WHERE c.league_id = l.id) ORDER BY co.rowid, l.tier, l.name`).all()
      .map((r) => ({ id: S(r.id), name: S(r.name), countryCode: S(r.code), countryName: S(r.cn) })),
    tasks, maxOpenTasks: MAX_OPEN_TASKS, shortlist, reports, today: st.gameDate,
    homeCountryCode: S(db.prepare('SELECT co.code FROM clubs c JOIN countries co ON co.id = c.country_id WHERE c.id = ?').get(st.clubId)?.code ?? ''),
  };
}

export function hireScout(db: SqlDb, candidateId: string): void {
  const st = getCareerState(db);
  const max = maxScoutsFor(facilitiesOf(db, st.clubId).scouting);
  if (N(db.prepare('SELECT COUNT(*) AS n FROM scouts').get()!.n) >= max) throw new ScoutError(`O departamento de scouting comporta ${max} olheiros neste nível. Amplie o departamento em Infraestrutura para contratar mais.`);
  if (db.prepare('SELECT 1 AS x FROM scouts WHERE id = ?').get(candidateId)) throw new ScoutError('Este olheiro já trabalha para o clube.');
  const c = scoutCandidates(seedOf(db), st.gameDate.slice(0, 7), COUNTRY_TEMPLATES, userEconomy(db, st.clubId)).find((x) => x.id === candidateId);
  if (!c) throw new ScoutError('Candidato indisponível (a lista de candidatos muda a cada mês).');
  withTransaction(db, () => {
    db.prepare('INSERT INTO scouts (id, first_name, last_name, nationality, ability, salary, hired_on, contract_end) VALUES (?,?,?,?,?,?,?,?)')
      .run(c.id, c.firstName, c.lastName, c.nationality, c.ability, c.salary, st.gameDate, addYears(st.gameDate, SCOUT_CONTRACT_YEARS));
    rebalanceTasks(db, st.gameDate); // tarefa na fila começa com o novo olheiro
    addNews(db, st.gameDate, 'staff', `Olheiro contratado: ${c.firstName} ${c.lastName}`, `${c.firstName} ${c.lastName} assinou contrato de ${SCOUT_CONTRACT_YEARS} anos como olheiro. Qualidade ${c.ability}/20; salário de ${fmt(c.salary)} por mês.\n\nQuanto melhor o olheiro, mais rápido o conhecimento sobre os jogadores observados cresce e mais estreitas ficam as faixas de estimativa. Defina a região (país) ou a lista de observação dele na aba Olheiros.`, { sender: 'Departamento de scouting', action: 'scouting', actionLabel: 'Ir para Olheiros' });
  });
}

/** Demissão: paga até 3 meses de salário (limitado ao que resta do contrato) pela porta única de dinheiro. */
export function fireScout(db: SqlDb, scoutId: string): number {
  const st = getCareerState(db);
  const r = db.prepare('SELECT * FROM scouts WHERE id = ?').get(scoutId);
  if (!r) throw new ScoutError('Olheiro não encontrado.');
  const severance = N(r.salary) * Math.min(SCOUT_SEVERANCE_MONTHS, monthsLeft(st.gameDate, S(r.contract_end)));
  withTransaction(db, () => {
    makePoster(db, st.clubId)(st.clubId, st.gameDate, 'scouting', -severance, `Rescisão do olheiro ${S(r.first_name)} ${S(r.last_name)}`);
    db.prepare('DELETE FROM scouts WHERE id = ?').run(scoutId);
    rebalanceTasks(db, st.gameDate); // a tarefa dele volta para a fila (ou passa a outro olheiro livre)
  });
  return severance;
}

export function setShortlisted(db: SqlDb, playerId: string, on: boolean): void {
  const st = getCareerState(db);
  if (!on) { db.prepare('DELETE FROM scout_shortlist WHERE player_id = ?').run(playerId); return; }
  const r = db.prepare('SELECT club_id, retired, youth_club_id FROM players WHERE id = ?').get(playerId);
  if (!r || N(r.retired) === 1 || r.youth_club_id != null) throw new ScoutError('Jogador indisponível para observação.');
  if (S(r.club_id) === st.clubId) throw new ScoutError('Jogadores do seu clube não precisam ser observados.');
  db.prepare('INSERT OR IGNORE INTO scout_shortlist (player_id, added_on) VALUES (?, ?)').run(playerId, st.gameDate);
}

// ---------------------------------------------------------------- tarefas de busca

const areaNameOf = (db: SqlDb, scope: ScoutScope, area: string): string | null => {
  if (scope === 'world') return 'Mundo';
  const r = scope === 'country' ? db.prepare('SELECT name FROM countries WHERE code = ?').get(area) : db.prepare('SELECT name FROM leagues WHERE id = ?').get(area);
  return r ? S(r.name) : null;
};

function rowToTask(db: SqlDb, r: Record<string, unknown>, scoutNames: Map<string, string>, know: Map<string, number>): ScoutTaskDto {
  const ids = db.prepare('SELECT player_id FROM scout_task_players WHERE task_id = ?').all(S(r.id)).map((x) => S(x.player_id));
  const scope = S(r.scope) as ScoutScope;
  return {
    id: S(r.id), name: S(r.name), scope, area: S(r.area), areaName: areaNameOf(db, scope, S(r.area)) ?? S(r.area),
    criteria: JSON.parse(S(r.criteria_json)) as ScoutCriteria, months: r.months == null ? null : N(r.months),
    status: S(r.status) as ScoutTaskDto['status'], scoutId: r.scout_id == null ? null : S(r.scout_id), scoutName: r.scout_id == null ? null : scoutNames.get(S(r.scout_id)) ?? null,
    createdOn: S(r.created_on), startedOn: r.started_on == null ? null : S(r.started_on), endsOn: r.ends_on == null ? null : S(r.ends_on),
    finishedOn: r.finished_on == null ? null : S(r.finished_on), found: ids.length, complete: ids.filter((id) => (know.get(id) ?? 0) >= 100).length,
  };
}

/** Tarefas: ativas e fila (na ordem da fila), depois concluídas e canceladas (mais recentes primeiro). */
export function listScoutTasks(db: SqlDb): ScoutTaskDto[] {
  const names = new Map(db.prepare('SELECT id, first_name, last_name FROM scouts').all().map((r) => [S(r.id), `${S(r.first_name)} ${S(r.last_name)}`]));
  const know = knowledgeMap(db);
  return db.prepare(`SELECT * FROM scout_tasks ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
    CASE WHEN status IN ('active', 'queued') THEN seq ELSE 0 END, finished_on DESC, seq DESC`).all().map((r) => rowToTask(db, r, names, know));
}

/**
 * Distribui os olheiros: tarefa ativa sem olheiro (demitido, contrato vencido) volta para a fila; olheiros livres (os melhores primeiro)
 * assumem as tarefas da fila na ordem de criação. O prazo da tarefa conta a partir do dia em que ela começa. NÃO abre transação.
 */
export function rebalanceTasks(db: SqlDb, date: string): void {
  db.prepare("UPDATE scout_tasks SET status = 'queued', scout_id = NULL, started_on = NULL, ends_on = NULL WHERE status = 'active' AND (scout_id IS NULL OR scout_id NOT IN (SELECT id FROM scouts))").run();
  const busy = new Set(db.prepare("SELECT scout_id FROM scout_tasks WHERE status = 'active'").all().map((r) => S(r.scout_id)));
  const free = db.prepare('SELECT id FROM scouts ORDER BY ability DESC, id').all().map((r) => S(r.id)).filter((id) => !busy.has(id));
  for (const t of db.prepare("SELECT id, months FROM scout_tasks WHERE status = 'queued' ORDER BY seq").all()) {
    const scout = free.shift();
    if (!scout) break;
    db.prepare("UPDATE scout_tasks SET status = 'active', scout_id = ?, started_on = ?, ends_on = ? WHERE id = ?")
      .run(scout, date, t.months == null ? null : addMonths(date, N(t.months)), S(t.id));
  }
}

/** Assunto (valores reais) de uma linha de jogador; atributos e estatísticas só quando a tarefa pede. */
function subjectOf(r: Record<string, unknown>, date: string, withAttrs: boolean, stats: Map<string, ScoutSubject['stats']> | null): ScoutSubject {
  return {
    position: S(r.position) as ScoutSubject['position'], secondary: JSON.parse(S(r.secondary_positions_json)) as ScoutSubject['secondary'],
    overall: N(r.overall), potential: N(r.potential_hidden), age: ageOn(S(r.birth_date), date), value: N(r.market_value), salary: N(r.salary),
    reputation: playerReputation(N(r.market_value), r.club_reputation == null ? null : N(r.club_reputation)), foot: S(r.foot),
    clubId: r.club_id == null ? null : S(r.club_id), contractEnd: S(r.contract_end), condition: N(r.condition_pct), morale: N(r.morale),
    attributes: withAttrs ? rowToPlayer(r).attributes : null, stats: stats ? stats.get(S(r.id)) ?? { appearances: 0, minutes: 0, goals: 0, assists: 0, avgRating: null } : null,
  };
}

/**
 * Jogadores do escopo que atendem aos critérios (valores reais), do mais valioso ao menos. Nunca os do clube do usuário nem os da base.
 * País: clubes do país + livres dessa nacionalidade; liga: clubes da liga; mundo: todos (livres inclusive).
 * `opts.limit`: para ao achar tantos (lê em blocos, do mais valioso ao menos); `known`: só os já 100% conhecidos (true) ou só os demais
 * (false); `skip`: ids a ignorar. A busca no mundo inteiro sem critérios lê ~25 mil jogadores: o limite evita isso no dia a dia.
 */
export function taskPool(db: SqlDb, scope: ScoutScope, area: string, c: ScoutCriteria, date: string, userClub: string,
  opts: { limit?: number; known?: boolean; skip?: ReadonlySet<string> } = {}): string[] {
  const where = ['p.retired = 0', 'p.youth_club_id IS NULL', '(p.club_id IS NULL OR p.club_id <> ?)'];
  const args: unknown[] = [userClub];
  if (scope === 'country') { where.push('(co.code = ? OR (p.club_id IS NULL AND p.nationality = ?))'); args.push(area, area); }
  else if (scope === 'league') { where.push('c.league_id = ?'); args.push(area); }
  if (c.positions?.length) { where.push(`p.position IN (${c.positions.map(() => '?').join(',')})`); args.push(...c.positions); }
  if (c.value?.min !== undefined) { where.push('p.market_value >= ?'); args.push(c.value.min); }
  if (c.value?.max !== undefined) { where.push('p.market_value <= ?'); args.push(c.value.max); }
  if (c.overall?.min !== undefined) { where.push('p.overall >= ?'); args.push(c.overall.min * 5 - 3); } // pré-filtro largo; o exato é na escala 1–20
  if (c.status === 'free') where.push('p.club_id IS NULL');
  if (opts.known !== undefined) where.push(`${opts.known ? '' : 'NOT '}EXISTS (SELECT 1 FROM scout_knowledge k WHERE k.player_id = p.id AND k.knowledge >= 100)`);
  const q = db.prepare(`SELECT p.*, c.reputation AS club_reputation FROM players p LEFT JOIN clubs c ON c.id = p.club_id LEFT JOIN countries co ON co.id = c.country_id
    WHERE ${where.join(' AND ')} ORDER BY p.market_value DESC, p.id LIMIT ? OFFSET ?`);
  const attrs = needsAttributes(c), withStats = needsStats(c), limit = opts.limit ?? Infinity, out: string[] = [];
  const CHUNK = 500;
  for (let offset = 0; out.length < limit; offset += CHUNK) {
    const raw = q.all(...args, CHUNK, offset);
    const rows = raw.filter((r) => !opts.skip?.has(S(r.id)));
    let stats: Map<string, ScoutSubject['stats']> | null = null;
    if (withStats && rows.length) {
      stats = new Map(db.prepare(`SELECT pss.player_id AS id, SUM(pss.appearances) AS a, SUM(pss.minutes) AS m, SUM(pss.goals) AS g, SUM(pss.assists) AS s, SUM(pss.rating_sum) AS r
        FROM player_season_stats pss JOIN competitions c ON c.id = pss.competition_id WHERE ${CURRENT_COMP} AND pss.player_id IN (${rows.map(() => '?').join(',')}) GROUP BY pss.player_id`)
        .all(...rows.map((r) => S(r.id)))
        .map((x) => [S(x.id), { appearances: N(x.a), minutes: N(x.m), goals: N(x.g), assists: N(x.s), avgRating: N(x.a) > 0 ? Math.round((N(x.r) / N(x.a)) * 100) / 100 : null }]));
    }
    for (const r of rows) if (out.length < limit && matchesCriteria(subjectOf(r, date, attrs, stats), c, date)) out.push(S(r.id));
    if (raw.length < CHUNK) break;
  }
  return out;
}

function checkInput(db: SqlDb, input: ScoutTaskInput): { areaName: string; problems: string[] } {
  const problems = criteriaProblems(input.criteria);
  const areaName = areaNameOf(db, input.scope, input.area);
  if (!areaName) problems.unshift(input.scope === 'league' ? 'Escolha uma liga.' : 'Escolha um país.');
  if (input.months !== null && (!Number.isInteger(input.months) || input.months < 1 || input.months > 24)) problems.push('Duração: de 1 a 24 meses.');
  return { areaName: areaName ?? '', problems };
}

/** Prévia: nome automático, compatíveis em faixa (nunca o número exato), dias por relatório, início (null = fila) e término. */
export function previewScoutTask(db: SqlDb, input: ScoutTaskInput): ScoutTaskPreviewDto {
  const st = getCareerState(db);
  const { areaName, problems } = checkInput(db, input);
  const name = taskName(areaName || '—', input.criteria);
  const scouts = db.prepare('SELECT id, ability FROM scouts ORDER BY ability DESC, id').all().map((r) => ({ id: S(r.id), ability: N(r.ability) }));
  const busy = new Set(db.prepare("SELECT scout_id FROM scout_tasks WHERE status = 'active'").all().map((r) => S(r.scout_id)));
  const queuedAhead = N(db.prepare("SELECT COUNT(*) AS n FROM scout_tasks WHERE status = 'queued'").get()!.n);
  const free = scouts.filter((s) => !busy.has(s.id));
  const starts = free.length > queuedAhead;
  const days = scouts.map((s) => reportDays(s.ability, input.scope));
  return {
    name, problems, queued: !starts,
    compatible: problems.length ? { low: 0, high: 0 } : compatibleBucket(taskPool(db, input.scope, input.area, input.criteria, st.gameDate, st.clubId, { limit: 2001 }).length),
    reportDays: starts ? { min: reportDays(free[queuedAhead]!.ability, input.scope), max: reportDays(free[queuedAhead]!.ability, input.scope) }
      : days.length ? { min: Math.min(...days), max: Math.max(...days) } : null,
    startDate: starts ? st.gameDate : null, endDate: starts && input.months !== null ? addMonths(st.gameDate, input.months) : null,
  };
}

/** Cria a tarefa (vai para a fila e começa se houver olheiro livre). Devolve o id. */
export function createScoutTask(db: SqlDb, input: ScoutTaskInput): string {
  const st = getCareerState(db);
  const { areaName, problems } = checkInput(db, input);
  if (problems.length) throw new ScoutError(problems[0]!);
  if (N(db.prepare("SELECT COUNT(*) AS n FROM scout_tasks WHERE status IN ('active', 'queued')").get()!.n) >= MAX_OPEN_TASKS) throw new ScoutError(`Limite de ${MAX_OPEN_TASKS} tarefas abertas (ativas e na fila).`);
  const name = (input.name ?? '').trim().slice(0, 80) || taskName(areaName, input.criteria);
  const seq = N(db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM scout_tasks').get()!.n);
  const id = `tsk_${st.gameDate.replace(/-/g, '')}_${seq}`;
  withTransaction(db, () => {
    db.prepare("INSERT INTO scout_tasks (id, name, scope, area, criteria_json, months, status, seq, created_on) VALUES (?,?,?,?,?,?,'queued',?,?)")
      .run(id, name, input.scope, input.scope === 'world' ? '' : input.area, JSON.stringify(input.criteria), input.months, seq, st.gameDate);
    rebalanceTasks(db, st.gameDate);
  });
  return id;
}

/** Ativa ou na fila → cancelada (a lista de encontrados fica no histórico); concluída ou cancelada → apagada. */
export function removeScoutTask(db: SqlDb, taskId: string): void {
  const st = getCareerState(db);
  const t = db.prepare('SELECT status FROM scout_tasks WHERE id = ?').get(taskId);
  if (!t) throw new ScoutError('Tarefa não encontrada.');
  withTransaction(db, () => {
    if (S(t.status) === 'active' || S(t.status) === 'queued') db.prepare("UPDATE scout_tasks SET status = 'cancelled', scout_id = NULL, finished_on = ? WHERE id = ?").run(st.gameDate, taskId);
    else db.prepare('DELETE FROM scout_tasks WHERE id = ?').run(taskId);
    rebalanceTasks(db, st.gameDate);
  });
}

/** Jogadores como o usuário os enxerga (estimativas), na ordem pedida; sem aposentados e jogadores da base. */
export function getScoutedPlayers(db: SqlDb, ids: string[]): MarketPlayerDto[] {
  const st = getCareerState(db);
  const know = knowledgeMap(db);
  const shortlistIds = new Set(db.prepare('SELECT player_id FROM scout_shortlist').all().map((r) => S(r.player_id)));
  const q = db.prepare('SELECT p.*, c.name AS club_name, c.reputation AS club_reputation FROM players p LEFT JOIN clubs c ON c.id = p.club_id WHERE p.id = ? AND p.retired = 0 AND p.youth_club_id IS NULL');
  return ids.slice(0, 60).map((id) => q.get(id)).filter((r): r is Record<string, unknown> => !!r)
    .map((r) => toScoutedDto(db, r, st.gameDate, S(r.club_id) === st.clubId ? 100 : know.get(S(r.id)) ?? 0, shortlistIds.has(S(r.id))));
}

/** Jogadores encontrados pela tarefa (só estimativas), os mais conhecidos primeiro. 'shortlist' e 'reports' = as listas fixas. */
export function getScoutTaskPlayers(db: SqlDb, taskId: string): MarketPlayerDto[] {
  const st = getCareerState(db);
  if (taskId === 'shortlist' || taskId === 'reports') { const ov = getScoutingOverview(db); return taskId === 'shortlist' ? ov.shortlist : ov.reports; }
  if (!db.prepare('SELECT 1 AS x FROM scout_tasks WHERE id = ?').get(taskId)) throw new ScoutError('Tarefa não encontrada.');
  const know = knowledgeMap(db);
  const shortlistIds = new Set(db.prepare('SELECT player_id FROM scout_shortlist').all().map((r) => S(r.player_id)));
  return db.prepare(`SELECT p.*, c.name AS club_name, c.reputation AS club_reputation FROM scout_task_players tp JOIN players p ON p.id = tp.player_id
    LEFT JOIN clubs c ON c.id = p.club_id WHERE tp.task_id = ? AND p.retired = 0 AND p.youth_club_id IS NULL ORDER BY tp.found_on, p.id`).all(taskId)
    .filter((r) => S(r.club_id) !== st.clubId)
    .map((r) => toScoutedDto(db, r, st.gameDate, know.get(S(r.id)) ?? 0, shortlistIds.has(S(r.id))))
    .sort((a, b) => b.knowledge - a.knowledge || a.name.localeCompare(b.name));
}

/**
 * Um dia de trabalho dos olheiros (chamado por `moveClock`, depois do mercado do dia):
 * - contratos vencidos encerram (a tarefa volta para a fila); tarefas com prazo vencido concluem (notícia);
 * - cada tarefa ativa acompanha até 5 jogadores compatíveis por vez, cada um com o ganho cheio até 100%, começando pelos já iniciados;
 *   novos alvos são sorteados entre os 80 mais valiosos que atendem aos critérios (valores reais); quem já tem 100% entra na lista sem custo;
 * - tarefa com prazo sem mais nenhum compatível a observar conclui antes; a contínua espera (o olheiro ajuda a lista de observação);
 * - olheiros livres (ou sem trabalho no dia) dividem o esforço entre os jogadores da lista de observação.
 * NÃO abre transação.
 */
export function processScoutingDay(db: SqlDb, date: string): void {
  const st = getCareerState(db);
  for (const r of db.prepare('SELECT id, first_name, last_name FROM scouts WHERE contract_end < ?').all(date)) {
    db.prepare('DELETE FROM scouts WHERE id = ?').run(S(r.id));
    addNews(db, date, 'staff', `Fim de contrato: o olheiro ${S(r.first_name)} ${S(r.last_name)} deixou o clube`, 'O olheiro não renovou; a tarefa dele volta para a fila. Contrate outro na aba Olheiros.', { sender: 'Departamento de scouting', action: 'scouting', actionLabel: 'Ir para Olheiros' });
  }
  const finish = (id: string, name: string, why: string) => {
    db.prepare("UPDATE scout_tasks SET status = 'done', scout_id = NULL, finished_on = ? WHERE id = ?").run(date, id);
    const ids = db.prepare(`SELECT tp.player_id FROM scout_task_players tp LEFT JOIN scout_knowledge k ON k.player_id = tp.player_id WHERE tp.task_id = ?
      ORDER BY COALESCE(k.knowledge, 0) DESC, tp.found_on, tp.player_id`).all(id).map((r) => S(r.player_id));
    addNews(db, date, 'staff', `Tarefa de busca concluída: "${name}"`, `${why} A tarefa encontrou ${ids.length} ${ids.length === 1 ? 'jogador' : 'jogadores'}${ids.length > 30 ? ' (os 30 mais conhecidos abaixo; a lista completa fica na aba Olheiros)' : ''}.`,
      { sender: SCOUT_SENDER, action: 'scouting', actionLabel: 'Abrir scouting', players: ids.slice(0, 30) });
  };
  for (const t of db.prepare("SELECT id, name FROM scout_tasks WHERE status = 'active' AND ends_on IS NOT NULL AND ends_on < ?").all(date)) finish(S(t.id), S(t.name), 'O prazo terminou.');
  rebalanceTasks(db, date);
  const scouts = db.prepare('SELECT * FROM scouts ORDER BY id').all();
  if (!scouts.length) return;
  const know = knowledgeMap(db);
  const up = db.prepare('INSERT INTO scout_knowledge (player_id, knowledge, updated_on) VALUES (?,?,?) ON CONFLICT(player_id) DO UPDATE SET knowledge = excluded.knowledge, updated_on = excluded.updated_on');
  const add = (id: string, gain: number) => { const k = Math.min(100, (know.get(id) ?? 0) + gain); know.set(id, k); up.run(id, Math.round(k * 100) / 100, date); };
  const ins = db.prepare('INSERT OR IGNORE INTO scout_task_players (task_id, player_id, found_on) VALUES (?,?,?)');
  const ability = new Map(scouts.map((s) => [S(s.id), N(s.ability)]));
  const TRACKED = trackedFor(facilitiesOf(db, st.clubId).scouting);
  const idle = new Set(scouts.map((s) => S(s.id)));
  for (const t of db.prepare("SELECT * FROM scout_tasks WHERE status = 'active' ORDER BY seq").all()) {
    const id = S(t.id), scope = S(t.scope) as ScoutScope, scout = S(t.scout_id);
    const gain = taskGain(ability.get(scout) ?? 1, scope);
    const mine = db.prepare('SELECT player_id FROM scout_task_players WHERE task_id = ? ORDER BY found_on, player_id').all(id).map((x) => S(x.player_id));
    const have = new Set(mine);
    const tracked = mine.filter((p) => (know.get(p) ?? 0) < 100).slice(0, TRACKED);
    // contínua que já esgotou os compatíveis: procura de novo só 7 dias depois da última busca vazia, para não varrer o mundo todo dia
    const waiting = t.months == null && !tracked.length && t.searched_on != null && addDays(S(t.searched_on), 7) > date;
    if (!waiting && tracked.length < TRACKED && have.size < MAX_FOUND) {
      const crit = JSON.parse(S(t.criteria_json)) as ScoutCriteria;
      const known = taskPool(db, scope, S(t.area), crit, date, st.clubId, { known: true, skip: have, limit: MAX_FOUND - have.size });
      for (const p of known) { ins.run(id, p, date); have.add(p); } // já conhecidos (100%): entram na lista sem custo
      const fresh = createRng(`scouting:${seedOf(db)}:${date}:${id}`).shuffle(taskPool(db, scope, S(t.area), crit, date, st.clubId, { known: false, skip: have, limit: 80 }));
      for (const p of fresh) {
        if (tracked.length >= TRACKED || have.size >= MAX_FOUND) break;
        ins.run(id, p, date); have.add(p); tracked.push(p);
      }
    }
    if (!tracked.length) {
      if (!waiting) db.prepare('UPDATE scout_tasks SET searched_on = ? WHERE id = ?').run(date, id);
      if (t.months != null) finish(id, S(t.name), 'Não há mais jogadores compatíveis a observar.');
      continue; // contínua sem trabalho hoje: o olheiro ajuda a lista de observação
    }
    idle.delete(scout);
    for (const p of tracked) add(p, gain);
  }
  weeklyDigests(db, date);
  if (!idle.size) return;
  // CROSS JOIN: a lista (poucas linhas) comanda a busca; com JOIN o SQLite percorria todos os jogadores pelo índice da base (docs/PERFORMANCE.md)
  const shortlist = db.prepare(`SELECT s.player_id FROM scout_shortlist s CROSS JOIN players p ON p.id = s.player_id
    WHERE p.retired = 0 AND p.youth_club_id IS NULL AND (p.club_id IS NULL OR p.club_id <> ?) ORDER BY s.added_on, s.player_id`).all(st.clubId).map((x) => S(x.player_id));
  for (const sid of idle) {
    const open = shortlist.filter((p) => (know.get(p) ?? 0) < 100);
    if (!open.length) break;
    const g = dailyGain(ability.get(sid) ?? 1);
    for (const p of open) add(p, (g * 3) / open.length); // esforço dividido pela lista: um jogador sozinho fica conhecido em ~1 semana
  }
}

const SCOUT_SENDER = 'Departamento de scouting';
/**
 * Resumo semanal de cada tarefa ativa (Caixa de entrada): 7 dias depois do início ou do último resumo, se houver novidade — jogadores
 * identificados (entraram na lista) e relatórios concluídos (100%) desde o último resumo. A tabela mostra as estimativas ao abrir.
 */
function weeklyDigests(db: SqlDb, date: string): void {
  for (const t of db.prepare("SELECT id, name, started_on, digest_on FROM scout_tasks WHERE status = 'active' AND started_on IS NOT NULL").all()) {
    if (addDays(S(t.digest_on ?? t.started_on), 7) > date) continue;
    const since = t.digest_on == null ? S(t.started_on) : addDays(S(t.digest_on), 1); // desde o início, ou desde o dia seguinte ao último resumo
    const found = db.prepare('SELECT player_id FROM scout_task_players WHERE task_id = ? AND found_on >= ? AND found_on <= ? ORDER BY found_on, player_id').all(S(t.id), since, date).map((r) => S(r.player_id));
    const done = db.prepare(`SELECT tp.player_id FROM scout_task_players tp JOIN scout_knowledge k ON k.player_id = tp.player_id
      WHERE tp.task_id = ? AND k.knowledge >= 100 AND k.updated_on >= ? AND k.updated_on <= ? ORDER BY k.updated_on, tp.player_id`).all(S(t.id), since, date).map((r) => S(r.player_id));
    db.prepare('UPDATE scout_tasks SET digest_on = ? WHERE id = ?').run(date, S(t.id));
    if (!found.length && !done.length) continue;
    const parts = [found.length ? `identificou ${found.length} ${found.length === 1 ? 'jogador que atende' : 'jogadores que atendem'} aos critérios` : '',
      done.length ? `concluiu ${done.length} ${done.length === 1 ? 'relatório completo' : 'relatórios completos'} (valores exatos)` : ''].filter(Boolean);
    const ids = [...new Set([...done, ...found])];
    const title = found.length ? `${found.length} ${found.length === 1 ? 'jogador identificado' : 'jogadores identificados'} na tarefa "${S(t.name)}"` : `${done.length} ${done.length === 1 ? 'relatório concluído' : 'relatórios concluídos'} na tarefa "${S(t.name)}"`;
    addNews(db, date, 'staff', title, `Nesta semana, a tarefa de busca "${S(t.name)}" ${parts.join(' e ')}. Os resultados estão listados abaixo, com as estimativas atuais dos olheiros.`,
      { sender: SCOUT_SENDER, action: 'scouting', actionLabel: 'Abrir scouting', players: ids.slice(0, 30) });
  }
}

/** Ficha de um jogador: dados públicos, estatísticas da temporada, estimativas (outros clubes) ou valores reais (próprio clube) e parecer do olheiro. */
export function getPlayerProfile(db: SqlDb, playerId: string): PlayerProfileDto {
  const st = getCareerState(db);
  const r = db.prepare('SELECT p.*, c.name AS club_name, c.reputation AS club_reputation FROM players p LEFT JOIN clubs c ON c.id = p.club_id WHERE p.id = ?').get(playerId);
  if (!r || N(r.retired) === 1) throw new ScoutError('Jogador não encontrado ou aposentado.');
  const p = rowToPlayer(r);
  const youthOf = r.youth_club_id == null ? null : S(r.youth_club_id);
  const own = p.clubId === st.clubId || youthOf === st.clubId;
  if (youthOf && !own) throw new ScoutError('Jogadores das categorias de base de outros clubes não são observáveis.');
  const s = db.prepare(`SELECT COALESCE(SUM(pss.appearances), 0) AS apps, COALESCE(SUM(pss.goals), 0) AS goals, COALESCE(SUM(pss.assists), 0) AS assists, COALESCE(SUM(pss.rating_sum), 0) AS rs
    FROM player_season_stats pss JOIN competitions c ON c.id = pss.competition_id WHERE pss.player_id = ? AND ${CURRENT_COMP}`).get(p.id)!;
  const stats = { appearances: N(s.apps), goals: N(s.goals), assists: N(s.assists), avgRating: N(s.apps) > 0 ? Math.round((N(s.rs) / N(s.apps)) * 100) / 100 : null };
  const k0 = own ? 100 : knowledgeMap(db).get(p.id) ?? 0;
  const known = own || k0 >= 50;
  // últimos jogos do clube atual em que o jogador entrou em campo (nota, minutos, gols e assistências são públicos)
  const lastMatches: PlayerProfileDto['lastMatches'] = [];
  if (p.clubId) {
    for (const m of db.prepare(`SELECT f.id, f.match_date, f.home_club_id, f.home_goals, f.away_goals, h.name AS hn, a.name AS an, mt.report_json FROM fixtures f
      JOIN matches mt ON mt.fixture_id = f.id JOIN clubs h ON h.id = f.home_club_id JOIN clubs a ON a.id = f.away_club_id
      WHERE f.status = 'played' AND (f.home_club_id = ? OR f.away_club_id = ?) ORDER BY f.match_date DESC LIMIT 12`).all(p.clubId, p.clubId)) {
      const rp = (JSON.parse(S(m.report_json)) as { players: Array<{ id: string; minutes?: number; rating?: number; goals?: number; assists?: number }> }).players.find((x) => x.id === p.id);
      if (!rp || !rp.minutes) continue;
      const home = S(m.home_club_id) === p.clubId;
      lastMatches.push({ fixtureId: S(m.id), date: S(m.match_date), opponent: home ? S(m.an) : S(m.hn), home, score: `${N(m.home_goals)} x ${N(m.away_goals)}`,
        minutes: rp.minutes, rating: rp.rating ?? 0, goals: rp.goals ?? 0, assists: rp.assists ?? 0 });
      if (lastMatches.length >= 5) break;
    }
  }
  const transfers = db.prepare(`SELECT t.date, t.fee, f.name AS fn, c.name AS tn FROM transfers t LEFT JOIN clubs f ON f.id = t.from_club_id JOIN clubs c ON c.id = t.to_club_id
    WHERE t.player_id = ? ORDER BY t.date DESC, t.id DESC`).all(p.id).map((t) => ({ date: S(t.date), from: t.fn == null ? null : S(t.fn), to: S(t.tn), fee: N(t.fee) }));
  const history = own ? [...db.prepare('SELECT season, overall_after FROM player_development WHERE player_id = ? ORDER BY season').all(p.id).map((h) => ({ season: N(h.season), overall: N(h.overall_after) })),
    { season: st.season, overall: p.overall }] : null;
  const base = {
    birthDate: p.birthDate, nationalityName: countryName(db, p.nationality), condition: Math.round(p.condition),
    morale: known ? Math.round(p.morale) : null, personality: known ? { professionalism: p.personality.professionalism, ambition: p.personality.ambition, loyalty: p.personality.loyalty } : null,
    history, lastMatches, transfers,
    id: p.id, name: `${p.firstName} ${p.lastName}`, age: ageOn(p.birthDate, st.gameDate), nationality: p.nationality, position: p.position, secondaryPositions: p.secondaryPositions,
    foot: p.foot, heightCm: p.heightCm, weightKg: p.weightKg, clubId: p.clubId, clubName: r.club_name == null ? null : S(r.club_name), own, youth: youthOf !== null,
    marketValue: p.marketValue, salary: p.salary, contractEnd: p.contractEnd, stats, roles: null as PlayerProfileDto['roles'],
    reputation: playerReputation(p.marketValue, r.club_reputation == null ? null : N(r.club_reputation)),
  };
  if (own) {
    withFamiliarity(db, [p]);
    const mine = new Set([p.position, ...p.secondaryPositions]);
    const focus = roleFocusMap(db).get(p.id) ?? null;
    base.roles = {
      focus,
      list: ROLES.filter((x) => x.positions.some((pos) => mine.has(pos)) || p.roleFamiliarity?.[x.id] !== undefined || x.id === focus)
        .map((x) => ({ id: x.id, label: x.name, positions: x.positions, description: x.summary.join(' '), suitability: roleSuitability(p.attributes, x), familiarity: familiarity(p, x) })),
    };
    const exact = (g: object) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, { low: v as number, high: v as number }]));
    const pot = Math.max(p.overall, p.potentialEstimated); // o próprio clube vê a força real e o potencial ESTIMADO (como no elenco)
    return { ...base, knowledge: 100, estOverall: { low: p.overall, high: p.overall }, estPotential: { low: pot, high: pot },
      attributes: { technical: exact(p.attributes.technical), mental: exact(p.attributes.mental), physical: exact(p.attributes.physical), ...(p.attributes.goalkeeper ? { goalkeeper: exact(p.attributes.goalkeeper) } : {}) }, verdict: null, market: null, negotiable: false };
  }
  const k = knowledgeMap(db).get(p.id) ?? 0;
  const market = toScoutedDto(db, r, st.gameDate, k, !!db.prepare('SELECT 1 AS x FROM scout_shortlist WHERE player_id = ?').get(p.id));
  const center = (x: { low: number; high: number }) => Math.round((x.low + x.high) / 2);
  const group = groupOf(p.position);
  const squad = db.prepare('SELECT position, overall FROM players WHERE club_id = ?').all(st.clubId).filter((x) => groupOf(S(x.position) as never) === group).map((x) => N(x.overall));
  return {
    ...base, knowledge: market.knowledge, estOverall: market.estOverall, estPotential: market.estPotential,
    attributes: estimateAttributes(p.attributes, seedOf(db), p.id, k),
    verdict: scoutVerdict({ overall: center(market.estOverall), potential: center(market.estPotential), age: base.age, group, knowledge: k }, squad), market,
    negotiable: p.clubId === null || windowStatus(st.gameDate).open,
  };
}
