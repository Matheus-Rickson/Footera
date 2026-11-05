import type { SqlDb } from '../types.ts';
import { posLabel } from '../../shared/positions.ts';
import { withTransaction } from '../types.ts';
import { UserError } from '../../shared/errors.ts';
import { createRng, type Rng } from '../../game/rng.ts';
import { ageOn } from '../../shared/date.ts';
import { buildPlayer } from '../../game/world/generator.ts';
import { COUNTRY_TEMPLATES } from '../../game/world/names.ts';
import { contractEndFor, seasonYearOf } from '../../game/career-engine/contracts.ts';
import { INTAKE_DAY, intakeSize, YOUTH_CAP, YOUTH_MAX_AGE, youthSalary } from '../../game/scouting-engine/scouting.ts';
import { groupOf, SQUAD_MAX, type PositionGroup } from '../../game/transfer-engine/transfer.ts';
import type { Player, Position } from '../../shared/types.ts';
import type { YouthOverviewDto } from '../../shared/api.ts';
import { getCareerState } from './careerRepository.ts';
import { addNews } from './newsRepository.ts';
import { playerInserter, rowToPlayer } from './worldRepository.ts';
import { resetToFreeAgentWage } from './transferRepository.ts';
import { recordYouthPromotionForBoard } from './boardRepository.ts';
import { FULL_CLUBS } from './simLevelRepository.ts';
import { to20 } from '../../shared/scale.ts';

export class YouthError extends UserError {}

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const nameOf = (p: Pick<Player, 'firstName' | 'lastName'>) => `${p.firstName} ${p.lastName}`;
const br = (d: string) => d.split('-').reverse().join('/');
const seedOf = (db: SqlDb) => S((db.prepare("SELECT value FROM meta WHERE key = 'world_seed'").get() ?? { value: 'sem-semente' }).value);
const getMeta = (db: SqlDb, key: string): string | null => { const r = db.prepare('SELECT value FROM meta WHERE key = ?').get(key); return r ? S(r.value) : null; };
const setMeta = (db: SqlDb, key: string, value: string) => { db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value); };

export const GROUP_POSITIONS: Record<PositionGroup, Position[]> = { GK: ['GK'], DEF: ['CB', 'CB', 'LB', 'RB'], MID: ['DM', 'CM', 'CM', 'AM'], ATT: ['ST', 'ST', 'LW', 'RW'] };
/** Universos criados a partir da v0.8.6 também têm ME/MD/AE/AD; saves anteriores continuam só com as 10 posições originais. */
export const GROUP_POSITIONS_V2: Record<PositionGroup, Position[]> = { GK: ['GK'], DEF: ['CB', 'CB', 'LB', 'RB', 'LWB', 'RWB'], MID: ['DM', 'CM', 'CM', 'AM', 'LM', 'RM'], ATT: ['ST', 'ST', 'LW', 'RW'] };
/** v3: também segundo atacante e centroavante no lugar do atacante genérico. */
export const GROUP_POSITIONS_V3: Record<PositionGroup, Position[]> = { ...GROUP_POSITIONS_V2, ATT: ['CF', 'CF', 'SS', 'LW', 'RW'] };
const groupPositions = (db: SqlDb) => { const v = db.prepare("SELECT value FROM meta WHERE key = 'position_set'").get()?.value; return v === 'v3' ? GROUP_POSITIONS_V3 : v === 'v2' ? GROUP_POSITIONS_V2 : GROUP_POSITIONS; };
const ANY_GROUP: PositionGroup[] = ['DEF', 'MID', 'ATT', 'DEF', 'MID', 'ATT', 'GK'];

export const youthOf = (db: SqlDb, clubId: string): Player[] => db.prepare('SELECT * FROM players WHERE youth_club_id = ? ORDER BY id').all(clubId).map(rowToPlayer);
const seniorOf = (db: SqlDb, clubId: string): Player[] => db.prepare('SELECT * FROM players WHERE club_id = ? ORDER BY id').all(clubId).map(rowToPlayer);
const economyOf = (db: SqlDb, clubId: string) => N(db.prepare('SELECT co.economy FROM clubs cl JOIN countries co ON co.id = cl.country_id WHERE cl.id = ?').get(clubId)!.economy);

/**
 * Fábrica de jogadores novos (base, reposições) com IDs estáveis e únicos por `tag`. Qualidade = 45% reputação do clube + 45% nível da base.
 * `youth` = vai para as categorias de base (club_id nulo, youth_club_id = clube); senão entra direto no elenco principal.
 */
export function playerFactory(db: SqlDb, tag: string, date: string) {
  const insert = playerInserter(db);
  let counter = 0;
  const newId = (prefix: string) => `${prefix}_${tag}_${(++counter).toString(36).padStart(4, '0')}`;
  return (rng: Rng, clubId: string, pos: Position, age: number, youth: boolean): Player => {
    const info = db.prepare('SELECT cl.reputation, cl.facilities_json, co.code, co.economy FROM clubs cl JOIN countries co ON co.id = cl.country_id WHERE cl.id = ?').get(clubId)!;
    const tpl = COUNTRY_TEMPLATES.find((t) => t.code === S(info.code)) ?? COUNTRY_TEMPLATES[0]!;
    // o formado típico chega ao auge ~5 pontos abaixo do nível médio do clube; só os talentos raros (potencial extra do gerador) viram titulares.
    // Com 0,5 + 0,5 a seleção (só os melhores sobem) inflava força e salários (~+2,5 de força e +20% de folha em 5 temporadas).
    const youthRep = 0.45 * N(info.reputation) + 0.45 * (JSON.parse(S(info.facilities_json)) as { youth: number }).youth * 5;
    const taken = new Set(db.prepare("SELECT first_name || ' ' || last_name AS n FROM players WHERE club_id = ? OR youth_club_id = ?").all(clubId, clubId).map((r) => S(r.n)));
    let name = { first: rng.pick(tpl.firstNames), last: rng.pick(tpl.lastNames) };
    for (let i = 0; i < 50 && taken.has(`${name.first} ${name.last}`); i++) name = { first: rng.pick(tpl.firstNames), last: rng.pick(tpl.lastNames) };
    const p = buildPlayer(rng, newId, tpl, clubId, youthRep, pos, date, name, { forceAge: age });
    const out: Player = youth
      ? { ...p, clubId: null, salary: youthSalary(p.overall, N(info.economy)), contractEnd: contractEndFor(date, 4) }
      : { ...p, contractEnd: contractEndFor(date, 3) };
    insert(out);
    if (youth) db.prepare('UPDATE players SET youth_club_id = ? WHERE id = ?').run(clubId, out.id);
    return out;
  };
}

/** Academias iniciais (uma única vez por save: carreiras novas e saves anteriores à Fase 8B): 6 a 8 jovens de 15 a 18 anos por clube. */
export function ensureYouthAcademies(db: SqlDb): void {
  if (getMeta(db, 'youth_seeded') !== null) return;
  withTransaction(db, () => {
    const st = getCareerState(db);
    const make = playerFactory(db, 'y0', st.gameDate);
    const rng = createRng(`youth-seed:${seedOf(db)}`);
    for (const r of db.prepare(`SELECT id FROM clubs WHERE id IN ${FULL_CLUBS} ORDER BY rowid`).all()) {
      const c = rng.fork(S(r.id));
      for (let i = 0, n = c.int(6, 8); i < n; i++) make(c, S(r.id), c.pick(groupPositions(db)[c.pick(ANY_GROUP)]), c.int(15, 18), true);
    }
    setMeta(db, 'youth_seeded', st.gameDate);
  });
}

/** Peneira anual (15/mar): cada clube recebe uma safra de 15–16 anos na base. Uma vez por temporada. NÃO abre transação. */
export function youthIntake(db: SqlDb, date: string): number {
  if (date.slice(5) !== INTAKE_DAY) return 0;
  const season = seasonYearOf(date);
  if (getMeta(db, `youth_intake_${season}`) !== null) return 0;
  const st = getCareerState(db);
  const make = playerFactory(db, `y${season + 1}`, date);
  const rng = createRng(`youth-intake:${seedOf(db)}:${season}`);
  let total = 0;
  const mine: Player[] = [];
  for (const r of db.prepare(`SELECT id, facilities_json FROM clubs WHERE id IN ${FULL_CLUBS} ORDER BY rowid`).all()) {
    const clubId = S(r.id), user = clubId === st.clubId, c = rng.fork(clubId);
    const level = (JSON.parse(S(r.facilities_json)) as { youth: number }).youth;
    const room = (user ? YOUTH_CAP.user : YOUTH_CAP.ai) - youthOf(db, clubId).length;
    const n = Math.max(0, Math.min(intakeSize(level, user, c.next()), room));
    for (let i = 0; i < n; i++) {
      const p = make(c, clubId, c.pick(groupPositions(db)[c.pick(ANY_GROUP)]), c.int(15, 16), true);
      total++;
      if (user) mine.push(p);
    }
  }
  setMeta(db, `youth_intake_${season}`, JSON.stringify({ date, ids: mine.map((p) => p.id) }));
  addNews(db, date, 'youth', mine.length ? `Peneira: ${mine.length} jovem(ns) chega(m) às categorias de base` : 'Peneira: a base está lotada e não recebeu jovens',
    mine.length ? `A peneira anual trouxe ${mine.length} jovem(ns) para as categorias de base:\n\n${mine.map((p) => `• ${nameOf(p)} (${posLabel(p.position)}, ${ageOn(p.birthDate, date)} anos), potencial estimado ${to20(p.potentialEstimated)}/20`).join('\n')}\n\nEles evoluem na base conforme o nível das instalações. Promova ao elenco principal quem estiver pronto (antes dos 19 anos, ou ele sai de graça).` : `A base atingiu o limite de ${YOUTH_CAP.user} jogadores e não recebeu ninguém nesta peneira. Promova ou dispense jovens para abrir espaço.`);
  return total;
}

/** Sobe um jogador da base para o elenco principal do mesmo clube (contrato profissional de 3 temporadas). NÃO abre transação. */
export function promoteFromYouth(db: SqlDb, p: Player, clubId: string, date: string): void {
  const salary = Math.max(Math.round((p.marketValue * 0.012) / 100) * 100, p.salary, Math.round((1500 * economyOf(db, clubId)) / 100) * 100);
  db.prepare('UPDATE players SET club_id = ?, youth_club_id = NULL, salary = ?, contract_end = ? WHERE id = ? AND youth_club_id = ?').run(clubId, salary, contractEndFor(date, 3), p.id, clubId);
}

export function promoteYouth(db: SqlDb, playerId: string): void {
  const st = getCareerState(db);
  const row = db.prepare('SELECT * FROM players WHERE id = ? AND youth_club_id = ?').get(playerId, st.clubId);
  if (!row) throw new YouthError('Só é possível promover jogadores das suas categorias de base.');
  if (seniorOf(db, st.clubId).length >= SQUAD_MAX) throw new YouthError(`O elenco principal já tem o máximo de ${SQUAD_MAX} jogadores.`);
  const p = rowToPlayer(row);
  withTransaction(db, () => {
    promoteFromYouth(db, p, st.clubId, st.gameDate);
    recordYouthPromotionForBoard(db);
    addNews(db, st.gameDate, 'youth', `Promovido: ${nameOf(p)} sobe ao elenco principal`, `${nameOf(p)} (${posLabel(p.position)}, ${ageOn(p.birthDate, st.gameDate)} anos) assinou o primeiro contrato profissional, até ${br(contractEndFor(st.gameDate, 3))}.\n\nMinutos em campo aceleram a evolução dele. Promover jovens também conta para a meta da diretoria, quando houver.`, { action: 'tactics', actionLabel: 'Escalar em Táticas' });
  });
}

/** Dispensa um jogador da base: ele fica livre (sem clube). */
export function releaseYouth(db: SqlDb, playerId: string): void {
  const st = getCareerState(db);
  if (!db.prepare('SELECT 1 AS x FROM players WHERE id = ? AND youth_club_id = ?').get(playerId, st.clubId)) throw new YouthError('Só é possível dispensar jogadores das suas categorias de base.');
  db.prepare('UPDATE players SET youth_club_id = NULL WHERE id = ?').run(playerId);
  resetToFreeAgentWage(db, playerId);
}

/** Melhor jovem da base de um setor, para cobrir uma carência (antes de gerar reposições). NÃO abre transação. */
export function promoteBestOfGroup(db: SqlDb, clubId: string, group: PositionGroup, date: string): Player | null {
  const p = youthOf(db, clubId).filter((x) => groupOf(x.position) === group).sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id))[0];
  if (!p) return null;
  promoteFromYouth(db, p, clubId, date);
  return p;
}

/**
 * Virada: a IA promove os jovens prontos (17+ e com nível do elenco) e dispensa quem chega aos 19; os jovens de 19 do usuário que
 * não foram promovidos saem. Devolve os nomes dos dispensados da base do usuário. NÃO abre transação.
 */
export function youthTurnover(db: SqlDb, date: string, userClub: string, aiCap: number): string[] {
  const releasedUser: string[] = [];
  for (const r of db.prepare('SELECT id FROM clubs ORDER BY rowid').all()) {
    const clubId = S(r.id);
    const youth = youthOf(db, clubId).sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id));
    if (clubId !== userClub) {
      const senior = seniorOf(db, clubId).sort((a, b) => b.overall - a.overall);
      const bar = (senior[12]?.overall ?? 0) - 3;     // nível de um reserva imediato
      const fringe = (senior[19]?.overall ?? 0) - 4;  // nível do fim do elenco: aos 18 sobe para completar elencos curtos
      let size = senior.length;
      for (const p of youth) {
        const age = ageOn(p.birthDate, date);
        const ready = age >= 17 && p.overall >= bar && size < aiCap;
        const filler = age >= 18 && p.overall >= fringe && size < 24;
        if (!ready && !filler) continue;
        promoteFromYouth(db, p, clubId, date); size++;
      }
    }
    for (const p of youthOf(db, clubId)) {
      if (ageOn(p.birthDate, date) < YOUTH_MAX_AGE) continue;
      db.prepare('UPDATE players SET youth_club_id = NULL WHERE id = ?').run(p.id);
      resetToFreeAgentWage(db, p.id);
      if (clubId === userClub) releasedUser.push(nameOf(p));
    }
  }
  return releasedUser;
}

export function getYouthOverview(db: SqlDb): YouthOverviewDto {
  const st = getCareerState(db);
  const turnover = `${st.season + 1}-07-01`;
  const level = (JSON.parse(S(db.prepare('SELECT facilities_json FROM clubs WHERE id = ?').get(st.clubId)!.facilities_json)) as { youth: number }).youth;
  const intakeYear = st.gameDate.slice(5) < INTAKE_DAY || st.gameDate.slice(5) >= '07-01' ? seasonYearOf(st.gameDate) + 1 : seasonYearOf(st.gameDate) + 2;
  const last = (() => {
    const r = db.prepare("SELECT value FROM meta WHERE key LIKE 'youth_intake_%' ORDER BY key DESC LIMIT 1").get();
    if (!r) return null;
    const v = JSON.parse(S(r.value)) as { date: string; ids: string[] };
    const names = v.ids.map((id) => db.prepare('SELECT first_name, last_name FROM players WHERE id = ?').get(id)).filter(Boolean).map((x) => `${S(x!.first_name)} ${S(x!.last_name)}`);
    return { date: v.date, names };
  })();
  return {
    academyLevel: level, nextIntake: `${intakeYear}-${INTAKE_DAY}`, lastIntake: last, cap: YOUTH_CAP.user, seniorSize: seniorOf(db, st.clubId).length, seniorMax: SQUAD_MAX,
    players: youthOf(db, st.clubId).sort((a, b) => b.potentialEstimated - a.potentialEstimated || b.overall - a.overall).map((p) => ({
      id: p.id, name: nameOf(p), position: p.position, age: ageOn(p.birthDate, st.gameDate), overall: p.overall,
      potentialEstimated: Math.max(p.overall, p.potentialEstimated), salary: p.salary, leavesAtTurnover: ageOn(p.birthDate, turnover) >= YOUTH_MAX_AGE,
    })),
  };
}
