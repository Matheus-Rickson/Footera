import type { SqlDb } from '../database/types.ts';
import { ensureLicenses } from '../database/repositories/coachLicenseRepository.ts';
import { withTransaction } from '../database/types.ts';
import { migrate } from '../database/migrator.ts';
import { saveWorld } from '../database/repositories/worldRepository.ts';
import { ensureSeason } from '../database/repositories/competitionRepository.ts';
import { ensureSchemes } from '../database/repositories/tacticsRepository.ts';
import { ensureFinance, prevMonth } from '../database/repositories/financeRepository.ts';
import { ensureYouthAcademies } from '../database/repositories/youthRepository.ts';
import { ensureBoard } from '../database/repositories/boardRepository.ts';
import { ensureSquadRoles } from '../database/repositories/squadRoleRepository.ts';
import { userSeason } from '../database/repositories/countrySeasonRepository.ts';
import { advanceTime, getCareerState } from '../database/repositories/competitionRepository.ts';
import type { ContinueStepDto } from '../shared/api.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import { planRetirementsAtCreation, startNextSeason } from '../database/repositories/seasonRepository.ts';
import { ageOn, isValidIso } from '../shared/date.ts';
import type { Coach, World } from '../shared/types.ts';
import { setFullLeagues } from '../database/repositories/simLevelRepository.ts';
import { startingAttributesError } from '../shared/coachAttributes.ts';
import { ensureAiCoaches } from '../database/repositories/aiCoachRepository.ts';

export class ValidationError extends Error {}

export function validateCoach(c: Coach, careerStartDate: string): void {
  if (!c.firstName.trim()) throw new ValidationError('Informe o nome do treinador.');
  if (!c.lastName.trim()) throw new ValidationError('Informe o sobrenome do treinador.');
  if (!isValidIso(c.birthDate)) throw new ValidationError('Data de nascimento inválida.');
  if (c.birthDate >= careerStartDate) throw new ValidationError('A data de nascimento deve ser anterior ao início da carreira.');
  const age = ageOn(c.birthDate, careerStartDate);
  if (age < 18 || age > 90) throw new ValidationError('Idade do treinador fora do intervalo permitido (18 a 90).');
  if (!['defensive', 'possession', 'aggressive'].includes(c.methodology)) throw new ValidationError('Metodologia inválida.');
  if (c.attributes) { const e = startingAttributesError(c.attributes); if (e) throw new ValidationError(e); }
}

/**
 * Cria uma carreira independente: aplica migrações em um banco novo e copia o universo para ele.
 * O banco recebido deve estar vazio. Alterações posteriores não afetam o `world` original nem outras carreiras.
 */
/**
 * `dataPacks`: pacotes de dados usados para montar o universo (id@versão, na ordem de carga), gravados no save.
 * `fullLeagues`: divisões com simulação completa (ids de liga); as demais ficam simplificadas. Ausente = todas completas. A divisão do
 * clube escolhido é sempre completa (e o clube do usuário segue completo mesmo se for rebaixado).
 */
export function createCareer(db: SqlDb, universe: World, coach: Coach, clubId: string, now: Date = new Date(), dataPacks: string[] = [], fullLeagues?: readonly string[]): void {
  const club = universe.clubs.find((c) => c.id === clubId);
  if (!club) throw new ValidationError('Clube inexistente no universo.');
  const { world, preCareer } = careerWorld(universe, clubId);
  validateCoach(coach, world.startDate);
  for (const id of fullLeagues ?? []) if (!world.leagues.some((l) => l.id === id)) throw new ValidationError(`Divisão inexistente no universo: ${id}.`);
  migrate(db);
  saveWorld(db, world);
  if (fullLeagues) setFullLeagues(db, [...fullLeagues, club.leagueId]);
  withTransaction(db, () => {
    const ts = now.toISOString();
    db.prepare('INSERT INTO career (id, coach_json, club_id, game_date, season, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?)')
      .run(JSON.stringify(coach), clubId, world.startDate, Number(world.startDate.slice(0, 4)), ts, ts);
  });
  ensureSeason(db, Number(world.startDate.slice(0, 4)));
  ensureSchemes(db, now);
  // a 1ª cobrança mensal ocorre quando o jogo passar do dia 1 do mês de início
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('finance_last_month', prevMonth(world.startDate.slice(0, 7)));
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('data_packs', JSON.stringify(dataPacks));
  ensureFinance(db);
  ensureYouthAcademies(db);
  ensureBoard(db);
  ensureAiCoaches(db, world.coaches);
  // aposentadorias anunciadas para o fim da temporada (com simulação prévia, as do país do clube são sorteadas na virada que abre a carreira)
  planRetirementsAtCreation(db, world.startDate, preCareer ? userSeason(db).turnover : null);
  if (preCareer) fastForwardToCareerStart(db, now);
  ensureLicenses(db); // licença inicial (e matrícula, se o clube exigir mais), no primeiro dia de trabalho
  ensureSquadRoles(db); // tempo de jogo combinado com cada jogador do elenco (status padrão pela força)
}

/**
 * Início da carreira (pedido do usuário, 06/11/2026): sempre no início da temporada do país do clube, com as divisões da base, e os
 * países do outro calendário na metade da temporada deles (simulada na criação, sem o treinador). Sem torneio de transição.
 * - Clube de ano civil (Brasil, Argentina, Irlanda...): carreira em 1º/jan/2026; o universo começa em 1º/jul/2025 e os países de julho
 *   jogam jul–dez da temporada 2025/26; os de ano civil ficam parados até 1º/jan.
 * - Clube de julho: carreira em 1º/jul/2026; o universo começa em 1º/jan/2026 e os países de ano civil jogam jan–jun da temporada 2026;
 *   os de julho ficam parados até 1º/jul.
 * Universo com um só calendário: a carreira começa direto, sem simulação prévia.
 */
export function careerWorld(world: World, clubId: string): { world: World; preCareer: boolean } {
  const club = world.clubs.find((c) => c.id === clubId);
  const civilOf = (countryId: string) => world.countries.find((c) => c.id === countryId)?.seasonStart === '01-01';
  const civil = !!club && civilOf(club.countryId);
  const y = Number(world.startDate.slice(0, 4));
  const other = world.countries.some((c) => (c.seasonStart === '01-01') !== civil); // há países do outro calendário
  const careerStart = civil ? `${y}-01-01` : `${y}-07-01`;
  const start = !other ? careerStart : civil ? `${y - 1}-07-01` : `${y}-01-01`;
  return { world: start === world.startDate ? world : { ...world, startDate: start }, preCareer: start !== careerStart };
}

/**
 * Simula os seis meses antes da carreira: jogos dos países do outro calendário pelo resultado rápido, sem diretoria avaliando nem
 * rotina diária do clube; ao chegar à virada do país do clube, ela abre a primeira temporada dele (sem acesso/rebaixamento, pois esse
 * país ficou parado) e a caixa de entrada começa vazia.
 */
export function fastForwardToCareerStart(db: SqlDb, now: Date = new Date()): void {
  const flag = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('fast_forward', '1')");
  flag.run();
  try {
    for (let guard = 0; guard < 5000; guard++) {
      const today = String(db.prepare('SELECT game_date AS d FROM career WHERE id = 1').get()!.d);
      const pending = Number(db.prepare("SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled' AND match_date <= ?").get(today)!.n);
      if (pending > 0) { simulateMatchday(db); continue; }
      if (!advanceTime(db, 'nextMatchday', now).advanced) break; // chegou à virada do país do clube
    }
    db.prepare('DELETE FROM news').run(); // a caixa de entrada começa vazia no primeiro dia de trabalho
    db.prepare('UPDATE coach_spells SET start_date = (SELECT game_date FROM career WHERE id = 1) WHERE end_date IS NULL').run(); // o trabalho começa hoje
  } finally {
    db.prepare("DELETE FROM meta WHERE key = 'fast_forward'").run();
  }
  startNextSeason(db, now, { quiet: true });
}

/** Mensagens que pedem uma decisão do treinador: o "Continuar" para nelas. */
const DECISION_KINDS = ['offer', 'market', 'board'];

/**
 * Um dia do botão "Continuar". Não passa do jogo do clube do treinador (é ele quem joga, ao vivo ou simulando) nem da virada da
 * temporada do país dele. Jogos de outros clubes no dia são simulados aqui (rodada atômica) antes de avançar o relógio.
 */
export function continueDay(db: SqlDb, now: Date = new Date()): ContinueStepDto {
  const clubId = getCareerState(db).clubId;
  const userPending = () => !!clubId && !!db.prepare("SELECT 1 FROM fixtures WHERE status = 'scheduled' AND match_date <= ? AND (home_club_id = ? OR away_club_id = ?) LIMIT 1")
    .get(getCareerState(db).gameDate, clubId, clubId);
  const stop = (s: ContinueStepDto['stop'], message: string, simulation: ContinueStepDto['simulation'] = null): ContinueStepDto => ({ date: getCareerState(db).gameDate, stop: s, message, simulation });
  if (userPending()) return stop('user_match', 'Dia de jogo do seu time.');
  const lastNews = Number(db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM news').get()!.n);
  const decisions = () => db.prepare(`SELECT title FROM news WHERE id > ? AND kind IN (${DECISION_KINDS.map(() => '?').join(',')}) ORDER BY id`)
    .all(lastNews, ...DECISION_KINDS).map((r) => String(r.title));
  const pending = Number(db.prepare("SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled' AND match_date <= ?").get(getCareerState(db).gameDate)!.n);
  const simulation = pending > 0 ? simulateMatchday(db) : null;
  const r = advanceTime(db, 'day', now);
  const found = decisions();
  if (found.length) return stop('decision', found.join(' · '), simulation);
  if (!r.advanced) return stop('season_end', r.message, simulation);
  if (userPending()) return stop('user_match', 'Dia de jogo do seu time.', simulation);
  if (r.toDate >= userSeason(db).turnover) return stop('season_end', r.message, simulation);
  return stop(null, r.message, simulation);
}
