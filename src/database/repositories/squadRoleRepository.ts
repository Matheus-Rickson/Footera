/**
 * Tempo de jogo (v0.8.9): status combinado com cada jogador do clube do usuário (Jogador-chave, Titular, Rotação, Reserva, Promessa) e a
 * avaliação mensal dos minutos jogados contra o que o status promete (moral e e-mail). Regras puras em `game/career-engine/contracts.ts`.
 * Só o clube do usuário tem status gravado (tabela `squad_roles`, migração 028).
 */
import type { SqlDb } from '../types.ts';
import { withTransaction } from '../types.ts';
import { ageOn } from '../../shared/date.ts';
import {
  defaultStatuses, PLAYING_TIME_MIN_MATCHES, PLAYING_TIME_MORALE, playingTimeVerdict, PROSPECT_MAX_AGE, STATUS_INFO, type PlayingTimeVerdict, type SquadStatus,
} from '../../game/career-engine/contracts.ts';
import { getCareerState } from './careerRepository.ts';
import { fastForwarding } from './boardRepository.ts';
import { CURRENT_COMP } from './countrySeasonRepository.ts';
import { addNews } from './newsRepository.ts';

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const clampMorale = (v: number) => Math.max(10, Math.min(100, Math.round(v * 10) / 10));

/** minutos do jogador pelo clube (todas as competições e temporadas: acumulado, base da avaliação mensal) */
export const totalMinutes = (db: SqlDb, playerId: string, clubId: string): number =>
  N(db.prepare('SELECT COALESCE(SUM(minutes), 0) AS n FROM player_season_stats WHERE player_id = ? AND club_id = ?').get(playerId, clubId)!.n);
/** jogos disputados pelo clube (todas as competições e temporadas) */
export const totalClubMatches = (db: SqlDb, clubId: string): number =>
  N(db.prepare("SELECT COUNT(*) AS n FROM fixtures WHERE status = 'played' AND (home_club_id = ? OR away_club_id = ?)").get(clubId, clubId)!.n);

export interface SquadRole { status: SquadStatus; since: string; baseMinutes: number; baseMatches: number; baseDate: string; verdict: PlayingTimeVerdict | null }
const toRole = (r: Record<string, unknown>): SquadRole => ({
  status: S(r.status) as SquadStatus, since: S(r.since), baseMinutes: N(r.base_minutes), baseMatches: N(r.base_matches), baseDate: S(r.base_date),
  verdict: r.verdict == null ? null : (S(r.verdict) as PlayingTimeVerdict),
});

/**
 * Deixa `squad_roles` igual ao elenco do usuário: tira quem saiu do clube (e a conversa de renegociação dele) e dá o status padrão a quem
 * chegou (pela força dentro do elenco atual), com a base da avaliação a partir de hoje. Treinador sem clube: tudo apagado. NÃO abre transação.
 */
export function syncSquadRoles(db: SqlDb): void {
  const st = getCareerState(db);
  if (!st.clubId) { db.exec('DELETE FROM squad_roles; DELETE FROM contract_talks;'); return; }
  db.prepare('DELETE FROM squad_roles WHERE player_id NOT IN (SELECT id FROM players WHERE club_id = ?)').run(st.clubId);
  db.prepare('DELETE FROM contract_talks WHERE player_id NOT IN (SELECT id FROM players WHERE club_id = ?)').run(st.clubId);
  const squad = db.prepare('SELECT p.id, p.overall, p.birth_date, r.player_id AS has FROM players p LEFT JOIN squad_roles r ON r.player_id = p.id WHERE p.club_id = ?').all(st.clubId);
  const missing = squad.filter((r) => r.has == null);
  if (!missing.length) return;
  const defaults = defaultStatuses(squad.map((r) => ({ id: S(r.id), overall: N(r.overall), age: ageOn(S(r.birth_date), st.gameDate) })));
  const matches = totalClubMatches(db, st.clubId);
  const ins = db.prepare('INSERT INTO squad_roles (player_id, status, since, base_minutes, base_matches, base_date, verdict) VALUES (?, ?, ?, ?, ?, ?, NULL)');
  for (const r of missing) ins.run(S(r.id), defaults.get(S(r.id))!, st.gameDate, totalMinutes(db, S(r.id), st.clubId), matches, st.gameDate);
}

/** `syncSquadRoles` na própria transação (abertura do save, carreira nova). */
export function ensureSquadRoles(db: SqlDb): void { withTransaction(db, () => syncSquadRoles(db)); }

export function squadRoles(db: SqlDb): Map<string, SquadRole> {
  return new Map(db.prepare('SELECT * FROM squad_roles').all().map((r) => [S(r.player_id), toRole(r)]));
}

/** Troca o status (renegociação aceita): a avaliação recomeça de hoje. NÃO abre transação. */
export function setSquadStatus(db: SqlDb, playerId: string, clubId: string, status: SquadStatus, date: string): void {
  db.prepare(`INSERT INTO squad_roles (player_id, status, since, base_minutes, base_matches, base_date, verdict) VALUES (?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(player_id) DO UPDATE SET status = excluded.status, since = excluded.since, base_minutes = excluded.base_minutes,
      base_matches = excluded.base_matches, base_date = excluded.base_date, verdict = NULL`)
    .run(playerId, status, date, totalMinutes(db, playerId, clubId), totalClubMatches(db, clubId), date);
}

/** Minutos de cada jogador do clube na temporada corrente e jogos do clube nela (para a tela). */
export function seasonPlayingTime(db: SqlDb, clubId: string): { minutes: Map<string, { minutes: number; appearances: number }>; clubMatches: number } {
  const minutes = new Map(db.prepare(`SELECT pss.player_id, SUM(pss.minutes) AS m, SUM(pss.appearances) AS a FROM player_season_stats pss JOIN competitions c ON c.id = pss.competition_id
      WHERE pss.club_id = ? AND ${CURRENT_COMP} GROUP BY pss.player_id`).all(clubId).map((r) => [S(r.player_id), { minutes: N(r.m), appearances: N(r.a) }]));
  const clubMatches = N(db.prepare(`SELECT COUNT(*) AS n FROM fixtures f JOIN competitions c ON c.id = f.competition_id
      WHERE ${CURRENT_COMP} AND f.status = 'played' AND (f.home_club_id = ? OR f.away_club_id = ?)`).get(clubId, clubId)!.n);
  return { minutes, clubMatches };
}

/**
 * Avaliação mensal (dia 1º, só o clube do usuário): para cada jogador, os minutos desde a última avaliação contra os jogos do clube no
 * período (mínimo de 3 jogos; com menos, acumula para o mês seguinte). Quem se lesionou no período fica de fora (a base recomeça).
 * Insatisfeito: moral −6; satisfeito: +2. Um e-mail lista os insatisfeitos. Promessa que passou dos 21 anos vira Reserva.
 * NÃO abre transação (chamada por `moveClock`).
 */
export function processPlayingTimeMonth(db: SqlDb, date: string): number {
  if (date.slice(8) !== '01' || fastForwarding(db)) return 0;
  const st = getCareerState(db);
  if (!st.clubId) return 0;
  syncSquadRoles(db);
  const matchesNow = totalClubMatches(db, st.clubId);
  const players = new Map(db.prepare('SELECT id, first_name, last_name, birth_date, morale FROM players WHERE club_id = ?').all(st.clubId).map((r) => [S(r.id), r]));
  const injuredUntil = new Map(db.prepare('SELECT player_id, injury_until FROM player_status WHERE injury_until IS NOT NULL').all().map((r) => [S(r.player_id), S(r.injury_until)]));
  const reset = db.prepare('UPDATE squad_roles SET base_minutes = ?, base_matches = ?, base_date = ?, verdict = COALESCE(?, verdict), status = ? WHERE player_id = ?');
  const setMorale = db.prepare('UPDATE players SET morale = ? WHERE id = ?');
  const unhappy: Array<{ id: string; name: string; status: SquadStatus; share: number }> = [];
  let judged = 0;
  for (const [id, role] of squadRoles(db)) {
    const p = players.get(id);
    if (!p) continue;
    const status: SquadStatus = role.status === 'prospect' && ageOn(S(p.birth_date), date) > PROSPECT_MAX_AGE ? 'backup' : role.status;
    const matches = matchesNow - role.baseMatches;
    if (matches < PLAYING_TIME_MIN_MATCHES) { if (status !== role.status) db.prepare('UPDATE squad_roles SET status = ? WHERE player_id = ?').run(status, id); continue; }
    const minutesNow = totalMinutes(db, id, st.clubId);
    const injured = (injuredUntil.get(id) ?? '') > role.baseDate;
    if (injured) { reset.run(minutesNow, matchesNow, date, null, status, id); continue; }
    const share = Math.max(0, minutesNow - role.baseMinutes) / (matches * 90);
    const verdict = playingTimeVerdict(share, STATUS_INFO[status].expected);
    reset.run(minutesNow, matchesNow, date, verdict, status, id);
    if (PLAYING_TIME_MORALE[verdict]) setMorale.run(clampMorale(N(p.morale) + PLAYING_TIME_MORALE[verdict]), id);
    if (verdict === 'unhappy') unhappy.push({ id, name: `${S(p.first_name)} ${S(p.last_name)}`, status, share });
    judged++;
  }
  if (unhappy.length) {
    const lines = unhappy.map((u) => `• ${u.name} (${STATUS_INFO[u.status].label}): jogou ${pct(u.share)} dos minutos; o combinado é cerca de ${pct(STATUS_INFO[u.status].expected)}.`);
    addNews(db, date, 'contract', unhappy.length === 1 ? `Tempo de jogo: ${unhappy[0]!.name} está insatisfeito` : `Tempo de jogo: ${unhappy.length} jogadores insatisfeitos`,
      `Desde a última avaliação, estes jogadores jogaram bem menos do que o status combinado no contrato:\n\n${lines.join('\n')}\n\nA moral deles caiu ${-PLAYING_TIME_MORALE.unhappy} pontos. Dê mais minutos a eles ou renegocie o status em Contratos.`,
      { sender: 'Comissão técnica', action: 'contracts', actionLabel: 'Abrir contratos', players: unhappy.map((u) => u.id) });
  }
  return judged;
}
