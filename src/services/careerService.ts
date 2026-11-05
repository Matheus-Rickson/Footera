import type { SqlDb } from '../database/types.ts';
import { withTransaction } from '../database/types.ts';
import { migrate } from '../database/migrator.ts';
import { saveWorld } from '../database/repositories/worldRepository.ts';
import { ensureSeason } from '../database/repositories/competitionRepository.ts';
import { ensureSchemes } from '../database/repositories/tacticsRepository.ts';
import { ensureFinance, prevMonth } from '../database/repositories/financeRepository.ts';
import { ensureYouthAcademies } from '../database/repositories/youthRepository.ts';
import { ensureBoard } from '../database/repositories/boardRepository.ts';
import { ageOn, isValidIso } from '../shared/date.ts';
import type { Coach, World } from '../shared/types.ts';
import { setFullLeagues } from '../database/repositories/simLevelRepository.ts';
import { startingAttributesError } from '../shared/coachAttributes.ts';

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
export function createCareer(db: SqlDb, world: World, coach: Coach, clubId: string, now: Date = new Date(), dataPacks: string[] = [], fullLeagues?: readonly string[]): void {
  validateCoach(coach, world.startDate);
  const club = world.clubs.find((c) => c.id === clubId);
  if (!club) throw new ValidationError('Clube inexistente no universo.');
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
}
