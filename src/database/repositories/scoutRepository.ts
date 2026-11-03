import type { SqlDb } from '../types.ts';
import { withTransaction } from '../types.ts';
import { UserError } from '../../shared/errors.ts';
import { createRng } from '../../game/rng.ts';
import { addYears, ageOn } from '../../shared/date.ts';
import { COUNTRY_TEMPLATES } from '../../game/world/names.ts';
import {
  COUNTRY_PLAYERS_PER_DAY, dailyGain, MAX_SCOUTS, SCOUT_CONTRACT_YEARS, SCOUT_SEVERANCE_MONTHS, scoutCandidates,
} from '../../game/scouting-engine/scouting.ts';
import { estimateAttributes, estimateRange, groupOf, scoutVerdict, windowStatus } from '../../game/transfer-engine/transfer.ts';
import type { MarketPlayerDto, PlayerProfileDto, ScoutAssignment, ScoutDto, ScoutingOverviewDto } from '../../shared/api.ts';
import { getCareerState } from './careerRepository.ts';
import { makePoster } from './financeRepository.ts';
import { addNews } from './newsRepository.ts';
import { rowToPlayer } from './worldRepository.ts';

export class ScoutError extends UserError {}

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const fmt = (n: number) => n.toLocaleString('pt-BR');
const seedOf = (db: SqlDb) => S((db.prepare("SELECT value FROM meta WHERE key = 'world_seed'").get() ?? { value: 'sem-semente' }).value);
const userEconomy = (db: SqlDb, clubId: string) => N(db.prepare('SELECT co.economy FROM clubs cl JOIN countries co ON co.id = cl.country_id WHERE cl.id = ?').get(clubId)!.economy);
const monthsLeft = (date: string, end: string) => Math.max(0, (Number(end.slice(0, 4)) - Number(date.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(date.slice(5, 7)));

/** Conhecimento acumulado (0..100) sobre cada jogador observado. */
export function knowledgeMap(db: SqlDb): Map<string, number> {
  return new Map(db.prepare('SELECT player_id, knowledge FROM scout_knowledge').all().map((r) => [S(r.player_id), N(r.knowledge)]));
}

const parseAssignment = (a: string): ScoutAssignment => (a.startsWith('country:') ? { kind: 'country', countryCode: a.slice(8) } : { kind: 'shortlist' });

/** Jogador de outro clube (ou livre) como o usuário o enxerga: só estimativas, mais estreitas quanto maior o conhecimento. */
export function toScoutedDto(db: SqlDb, r: Record<string, unknown>, date: string, knowledge: number, shortlisted: boolean): MarketPlayerDto {
  const p = rowToPlayer(r);
  const est = estimateRange(p.overall, p.potentialEstimated, seedOf(db), p.id, knowledge, p.potentialHidden);
  return {
    id: p.id, name: `${p.firstName} ${p.lastName}`, age: ageOn(p.birthDate, date), nationality: p.nationality, position: p.position, secondaryPositions: p.secondaryPositions, foot: p.foot,
    clubId: p.clubId, clubName: r.club_name == null ? null : S(r.club_name), marketValue: p.marketValue, salary: p.salary, contractEnd: p.contractEnd,
    estOverall: est.overall, estPotential: est.potential, knowledge: Math.floor(knowledge), shortlisted,
    nationalityName: countryName(db, p.nationality), heightCm: p.heightCm, weightKg: p.weightKg, status: publicStatus(db, p.id, date),
  };
}

const countryName = (db: SqlDb, code: string) => { const r = db.prepare('SELECT name FROM countries WHERE code = ?').get(code); return r ? S(r.name) : code; };
/** Situação pública do jogador: lesão em curso, suspensão e cartões nas competições da temporada atual. */
function publicStatus(db: SqlDb, playerId: string, date: string): MarketPlayerDto['status'] {
  const ps = db.prepare('SELECT injury_until, suspension_matches FROM player_status WHERE player_id = ?').get(playerId);
  const cards = db.prepare(`SELECT COALESCE(SUM(pss.yellow_cards), 0) AS y, COALESCE(SUM(pss.red_cards), 0) AS r FROM player_season_stats pss
    JOIN competitions c ON c.id = pss.competition_id WHERE pss.player_id = ? AND c.season = ?`).get(playerId, getCareerState(db).season)!;
  const injury = ps?.injury_until == null ? null : S(ps.injury_until);
  return { injuredUntil: injury && injury > date ? injury : null, suspension: ps ? N(ps.suspension_matches) : 0, yellows: N(cards.y), reds: N(cards.r) };
}

export function getScoutingOverview(db: SqlDb): ScoutingOverviewDto {
  const st = getCareerState(db);
  const scouts: ScoutDto[] = db.prepare('SELECT * FROM scouts ORDER BY hired_on, id').all().map((r) => ({
    id: S(r.id), name: `${S(r.first_name)} ${S(r.last_name)}`, nationality: S(r.nationality), ability: N(r.ability), salary: N(r.salary), contractEnd: S(r.contract_end),
    assignment: parseAssignment(S(r.assignment)),
  }));
  const hired = new Set(scouts.map((s) => s.id));
  const candidates = scoutCandidates(seedOf(db), st.gameDate.slice(0, 7), COUNTRY_TEMPLATES, userEconomy(db, st.clubId)).filter((c) => !hired.has(c.id))
    .map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, nationality: c.nationality, ability: c.ability, salary: c.salary }));
  const know = knowledgeMap(db);
  const shortlistIds = new Set(db.prepare('SELECT player_id FROM scout_shortlist').all().map((r) => S(r.player_id)));
  const sel = 'SELECT p.*, c.name AS club_name FROM players p LEFT JOIN clubs c ON c.id = p.club_id';
  const visible = (r: Record<string, unknown>) => N(r.retired) === 0 && r.youth_club_id == null && S(r.club_id) !== st.clubId;
  const shortlist = db.prepare(`${sel} JOIN scout_shortlist s ON s.player_id = p.id ORDER BY s.added_on, p.id`).all().filter(visible)
    .map((r) => toScoutedDto(db, r, st.gameDate, know.get(S(r.id)) ?? 0, true));
  const reports = db.prepare(`${sel} JOIN scout_knowledge k ON k.player_id = p.id WHERE k.knowledge >= 50 ORDER BY k.knowledge DESC, p.id LIMIT 400`).all().filter(visible)
    .map((r) => toScoutedDto(db, r, st.gameDate, know.get(S(r.id)) ?? 0, shortlistIds.has(S(r.id))))
    .sort((a, b) => b.estPotential.low + b.estPotential.high - a.estPotential.low - a.estPotential.high).slice(0, 60);
  return {
    scouts, candidates, maxScouts: MAX_SCOUTS, monthlyCost: scouts.reduce((s, x) => s + x.salary, 0),
    countries: db.prepare('SELECT code, name FROM countries ORDER BY rowid').all().map((r) => ({ code: S(r.code), name: S(r.name) })), shortlist, reports,
  };
}

export function hireScout(db: SqlDb, candidateId: string): void {
  const st = getCareerState(db);
  if (N(db.prepare('SELECT COUNT(*) AS n FROM scouts').get()!.n) >= MAX_SCOUTS) throw new ScoutError(`O clube já tem o máximo de ${MAX_SCOUTS} olheiros.`);
  if (db.prepare('SELECT 1 AS x FROM scouts WHERE id = ?').get(candidateId)) throw new ScoutError('Este olheiro já trabalha para o clube.');
  const c = scoutCandidates(seedOf(db), st.gameDate.slice(0, 7), COUNTRY_TEMPLATES, userEconomy(db, st.clubId)).find((x) => x.id === candidateId);
  if (!c) throw new ScoutError('Candidato indisponível (a lista de candidatos muda a cada mês).');
  withTransaction(db, () => {
    db.prepare('INSERT INTO scouts (id, first_name, last_name, nationality, ability, salary, hired_on, contract_end) VALUES (?,?,?,?,?,?,?,?)')
      .run(c.id, c.firstName, c.lastName, c.nationality, c.ability, c.salary, st.gameDate, addYears(st.gameDate, SCOUT_CONTRACT_YEARS));
    addNews(db, st.gameDate, 'staff', `Olheiro contratado: ${c.firstName} ${c.lastName}`, `Qualidade ${c.ability}/20, salário de ${fmt(c.salary)} por mês, contrato de ${SCOUT_CONTRACT_YEARS} anos.`);
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
  });
  return severance;
}

export function assignScout(db: SqlDb, scoutId: string, assignment: ScoutAssignment): void {
  if (!db.prepare('SELECT 1 AS x FROM scouts WHERE id = ?').get(scoutId)) throw new ScoutError('Olheiro não encontrado.');
  let value = 'shortlist';
  if (assignment.kind === 'country') {
    if (!db.prepare('SELECT 1 AS x FROM countries WHERE code = ?').get(assignment.countryCode)) throw new ScoutError('País inválido.');
    value = `country:${assignment.countryCode}`;
  }
  db.prepare('UPDATE scouts SET assignment = ? WHERE id = ?').run(value, scoutId);
}

export function setShortlisted(db: SqlDb, playerId: string, on: boolean): void {
  const st = getCareerState(db);
  if (!on) { db.prepare('DELETE FROM scout_shortlist WHERE player_id = ?').run(playerId); return; }
  const r = db.prepare('SELECT club_id, retired, youth_club_id FROM players WHERE id = ?').get(playerId);
  if (!r || N(r.retired) === 1 || r.youth_club_id != null) throw new ScoutError('Jogador indisponível para observação.');
  if (S(r.club_id) === st.clubId) throw new ScoutError('Jogadores do seu clube não precisam ser observados.');
  db.prepare('INSERT OR IGNORE INTO scout_shortlist (player_id, added_on) VALUES (?, ?)').run(playerId, st.gameDate);
}

/**
 * Um dia de trabalho dos olheiros (chamado por `moveClock`, depois do mercado do dia): designados a um país observam alguns jogadores
 * de lá; os da lista de observação dividem o esforço entre os jogadores ainda não totalmente conhecidos. Contratos vencidos encerram.
 * NÃO abre transação.
 */
export function processScoutingDay(db: SqlDb, date: string): void {
  const st = getCareerState(db);
  for (const r of db.prepare('SELECT id, first_name, last_name FROM scouts WHERE contract_end < ?').all(date)) {
    db.prepare('DELETE FROM scouts WHERE id = ?').run(S(r.id));
    addNews(db, date, 'staff', `Fim de contrato: o olheiro ${S(r.first_name)} ${S(r.last_name)} deixou o clube`, 'Contrate outro na aba Olheiros.');
  }
  const scouts = db.prepare('SELECT * FROM scouts ORDER BY id').all();
  if (!scouts.length) return;
  const know = knowledgeMap(db);
  const up = db.prepare('INSERT INTO scout_knowledge (player_id, knowledge, updated_on) VALUES (?,?,?) ON CONFLICT(player_id) DO UPDATE SET knowledge = excluded.knowledge, updated_on = excluded.updated_on');
  const add = (id: string, gain: number) => { const k = Math.min(100, (know.get(id) ?? 0) + gain); know.set(id, k); up.run(id, Math.round(k * 100) / 100, date); };
  const shortlist = db.prepare(`SELECT s.player_id FROM scout_shortlist s JOIN players p ON p.id = s.player_id
    WHERE p.retired = 0 AND p.youth_club_id IS NULL AND (p.club_id IS NULL OR p.club_id <> ?) ORDER BY s.added_on, s.player_id`).all(st.clubId).map((x) => S(x.player_id));
  for (const s of scouts) {
    const gain = dailyGain(N(s.ability));
    const a = parseAssignment(S(s.assignment));
    if (a.kind === 'country') {
      // Acompanha os mesmos jogadores até concluir o relatório (primeiro os já iniciados); novos alvos são sorteados entre os mais valiosos do país.
      // Sorteando 5 por dia entre ~800, uma temporada inteira deixava só 7 jogadores acima de 50% (verificado num save real).
      const pool = db.prepare(`SELECT p.id FROM players p JOIN clubs c ON c.id = p.club_id JOIN countries co ON co.id = c.country_id
        WHERE co.code = ? AND p.club_id <> ? ORDER BY p.market_value DESC, p.id`).all(a.countryCode, st.clubId).map((x) => S(x.id)).filter((id) => (know.get(id) ?? 0) < 100);
      const started = pool.filter((id) => (know.get(id) ?? 0) > 0).sort((x, y) => (know.get(y) ?? 0) - (know.get(x) ?? 0) || x.localeCompare(y));
      const fresh = createRng(`scouting:${seedOf(db)}:${date}:${S(s.id)}`).shuffle(pool.filter((id) => !know.get(id)).slice(0, 80));
      for (const id of [...started, ...fresh].slice(0, COUNTRY_PLAYERS_PER_DAY)) add(id, gain);
    } else {
      const open = shortlist.filter((id) => (know.get(id) ?? 0) < 100);
      for (const id of open) add(id, (gain * 3) / open.length); // esforço dividido pela lista: um jogador sozinho fica conhecido em ~1 semana
    }
  }
}

/** Ficha de um jogador: dados públicos, estatísticas da temporada, estimativas (outros clubes) ou valores reais (próprio clube) e parecer do olheiro. */
export function getPlayerProfile(db: SqlDb, playerId: string): PlayerProfileDto {
  const st = getCareerState(db);
  const r = db.prepare('SELECT p.*, c.name AS club_name FROM players p LEFT JOIN clubs c ON c.id = p.club_id WHERE p.id = ?').get(playerId);
  if (!r || N(r.retired) === 1) throw new ScoutError('Jogador não encontrado ou aposentado.');
  const p = rowToPlayer(r);
  const youthOf = r.youth_club_id == null ? null : S(r.youth_club_id);
  const own = p.clubId === st.clubId || youthOf === st.clubId;
  if (youthOf && !own) throw new ScoutError('Jogadores das categorias de base de outros clubes não são observáveis.');
  const s = db.prepare(`SELECT COALESCE(SUM(pss.appearances), 0) AS apps, COALESCE(SUM(pss.goals), 0) AS goals, COALESCE(SUM(pss.assists), 0) AS assists, COALESCE(SUM(pss.rating_sum), 0) AS rs
    FROM player_season_stats pss JOIN competitions c ON c.id = pss.competition_id WHERE pss.player_id = ? AND c.season = ?`).get(p.id, st.season)!;
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
    marketValue: p.marketValue, salary: p.salary, contractEnd: p.contractEnd, stats,
  };
  if (own) {
    const exact = (g: object) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, { low: v as number, high: v as number }]));
    const pot = Math.max(p.overall, p.potentialEstimated); // o próprio clube vê a força real e o potencial ESTIMADO (como no elenco)
    return { ...base, knowledge: 100, estOverall: { low: p.overall, high: p.overall }, estPotential: { low: pot, high: pot },
      attributes: { technical: exact(p.attributes.technical), mental: exact(p.attributes.mental), physical: exact(p.attributes.physical) }, verdict: null, market: null, negotiable: false };
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
