/**
 * Licenças do treinador (v0.8.10; regras em game/coach-engine/licenses.ts e docs/BOARD_JOBS.md): licença atual, curso em andamento,
 * exigência dos clubes, teto de reputação, matrícula, conclusão dos cursos (no `moveClock`) e a licença inicial de cada carreira.
 * Não depende do boardRepository (é ele quem usa este módulo): a reputação com teto é aplicada aqui.
 */
import type { SqlDb } from '../types.ts';
import { withTransaction } from '../types.ts';
import { UserError } from '../../shared/errors.ts';
import { addDays, daysBetween } from '../../shared/date.ts';
import type { Coach } from '../../shared/types.ts';
import {
  canCoach, cappedReputation, enrollError, hasLicense, initialLicenses, licenseRank, licenseRule, nextLicense, requiredLicense, reputationCap,
  type HeldLicense, type LicenseId,
} from '../../game/coach-engine/licenses.ts';
import { getCareerState } from './careerRepository.ts';
import { addNews } from './newsRepository.ts';

export class LicenseError extends UserError {}
const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const br = (d: string) => d.split('-').reverse().join('/');

export const readCoach = (db: SqlDb): Coach => JSON.parse(S(db.prepare('SELECT coach_json FROM career WHERE id = 1').get()!.coach_json)) as Coach;
const writeCoach = (db: SqlDb, c: Coach) => db.prepare('UPDATE career SET coach_json = ? WHERE id = 1').run(JSON.stringify(c));
const hasTables = (db: SqlDb) => db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'coach_licenses'").get() !== undefined;

/** Maior licença obtida ('none' = nenhuma). */
export function heldLicense(db: SqlDb): HeldLicense {
  if (!hasTables(db)) return 'PRO'; // banco sem a migração 32 (não acontece num save preparado): sem teto nem exigência
  let best: HeldLicense = 'none';
  for (const r of db.prepare('SELECT license FROM coach_licenses').all()) if (licenseRank(S(r.license) as LicenseId) > licenseRank(best)) best = S(r.license) as LicenseId;
  return best;
}
export function activeCourse(db: SqlDb): { license: LicenseId; start: string; end: string; waived: boolean } | null {
  if (!hasTables(db)) return null;
  const r = db.prepare('SELECT license, start_date, end_date, waived FROM coach_course WHERE id = 1').get();
  return r ? { license: S(r.license) as LicenseId, start: S(r.start_date), end: S(r.end_date), waived: N(r.waived) === 1 } : null;
}
/** Licença exigida por um clube: divisão da liga (sem divisão nacional = só estadual → C). */
export function clubRequiredLicense(db: SqlDb, clubId: string): LicenseId {
  const r = db.prepare('SELECT l.tier, l.active FROM clubs c JOIN leagues l ON l.id = c.league_id WHERE c.id = ?').get(clubId);
  if (!r) return 'C';
  return requiredLicense(N(r.active ?? 1) === 0 ? null : N(r.tier));
}
/** O treinador pode assumir o clube (licença exigida ou matrícula no curso dela). */
export const canCoachClub = (db: SqlDb, clubId: string): boolean => canCoach(heldLicense(db), activeCourse(db)?.license ?? null, clubRequiredLicense(db, clubId));

/** Muda a reputação do treinador respeitando o teto da licença. NÃO abre transação. */
export function applyReputation(db: SqlDb, delta: number): number {
  const c = readCoach(db);
  c.reputation = cappedReputation(c.reputation, delta, heldLicense(db));
  writeCoach(db, c);
  return c.reputation;
}

/** Dias desde o início do primeiro trabalho da carreira. */
export function careerDays(db: SqlDb, date: string): number {
  const first = db.prepare('SELECT MIN(start_date) AS d FROM coach_spells').get()?.d;
  return first == null ? 0 : Math.max(0, daysBetween(S(first), date));
}
/** Temporadas completas no comando de um clube (avaliadas na virada ou recuperadas do histórico). */
export function employedSeasons(db: SqlDb): number {
  return N(db.prepare("SELECT COUNT(*) AS n FROM coach_seasons WHERE end_reason = 'season' OR objective_met IS NOT NULL").get()!.n);
}

function startCourse(db: SqlDb, license: LicenseId, date: string, waived: boolean): string {
  const end = addDays(date, licenseRule(license).courseDays);
  db.prepare('INSERT OR REPLACE INTO coach_course (id, license, start_date, end_date, waived) VALUES (1, ?, ?, ?, ?)').run(license, date, end, waived ? 1 : 0);
  return end;
}

/**
 * Licença inicial (carreira nova ou save anterior à v0.8.10): C, ou B com reputação 25+, nunca abaixo do teto da reputação atual; clube
 * mais exigente → licença logo abaixo da exigida + matrícula no curso dela (carência). Idempotente.
 */
export function ensureLicenses(db: SqlDb): void {
  if (!hasTables(db)) return;
  if (db.prepare('SELECT 1 AS x FROM coach_licenses LIMIT 1').get()) return;
  const st = getCareerState(db);
  const coach = readCoach(db);
  const required = st.clubId ? clubRequiredLicense(db, st.clubId) : 'C';
  const init = initialLicenses(coach.reputation, required);
  withTransaction(db, () => {
    for (const l of ['C', 'B', 'A', 'PRO'] as const) if (licenseRank(l) <= licenseRank(init.held)) db.prepare('INSERT INTO coach_licenses (license, obtained, initial) VALUES (?, ?, 1)').run(l, st.gameDate);
    if (init.course) {
      const end = startCourse(db, init.course, st.gameDate, true);
      addNews(db, st.gameDate, 'board', `Matrícula no curso da ${licenseRule(init.course).name}`, `O seu clube disputa uma divisão que exige a ${licenseRule(init.course).name}. Você tem a ${licenseRule(init.held).name} e foi matriculado no curso da ${licenseRule(init.course).name}, que termina em ${br(end)}.\n\nEnquanto o curso não termina, você pode trabalhar no clube (carência). Ao concluir, a reputação sobe ${licenseRule(init.course).reputationBonus} pontos e o teto de reputação passa a ${licenseRule(init.course).reputationCap}.\n\nAcompanhe as licenças no Histórico da carreira.`, { sender: 'Escola de treinadores', action: 'history', actionLabel: 'Ver licenças' });
    }
  });
}

/** Matrícula pedida pelo usuário: só a próxima licença, com os pré-requisitos; um curso por vez; sem custo. */
export function enrollLicense(db: SqlDb, license: LicenseId): string {
  const st = getCareerState(db);
  const err = enrollError({ held: heldLicense(db), course: activeCourse(db)?.license ?? null, target: license, careerDays: careerDays(db, st.gameDate), employedSeasons: employedSeasons(db) });
  if (err) throw new LicenseError(err);
  let end = '';
  withTransaction(db, () => { end = startCourse(db, license, st.gameDate, false); });
  return `Matrícula feita: o curso da ${licenseRule(license).name} termina em ${br(end)}.`;
}

/**
 * Troca de clube para um que exige licença maior (só acontece pelo convite de emergência de quem está sem clube): matrícula automática
 * no curso exigido, sem os pré-requisitos (carência). NÃO abre transação.
 */
export function ensureCourseForClub(db: SqlDb, clubId: string, date: string): void {
  if (!hasTables(db) || canCoachClub(db, clubId)) return;
  const required = clubRequiredLicense(db, clubId);
  const end = startCourse(db, required, date, true);
  addNews(db, date, 'board', `Matrícula no curso da ${licenseRule(required).name}`, `O novo clube exige a ${licenseRule(required).name}. A federação aceitou a sua matrícula no curso, que termina em ${br(end)}; até lá você trabalha em carência.`, { sender: 'Escola de treinadores', action: 'history', actionLabel: 'Ver licenças' });
}

/** Conclusão do curso no dia do término: licença obtida, bônus de reputação (já com o teto novo) e notícia. NÃO abre transação. */
export function processLicensesDay(db: SqlDb, date: string): void {
  const c = activeCourse(db);
  if (!c || c.end > date) return;
  db.prepare('INSERT OR IGNORE INTO coach_licenses (license, obtained, initial) VALUES (?, ?, 0)').run(c.license, date);
  // quem pulou etapas na carência fica com as licenças abaixo também (a trilha é cumulativa)
  for (const l of ['C', 'B', 'A'] as const) if (licenseRank(l) < licenseRank(c.license)) db.prepare('INSERT OR IGNORE INTO coach_licenses (license, obtained, initial) VALUES (?, ?, 0)').run(l, date);
  db.prepare('DELETE FROM coach_course WHERE id = 1').run();
  const rule = licenseRule(c.license);
  const rep = applyReputation(db, rule.reputationBonus);
  const next = nextLicense(c.license);
  addNews(db, date, 'board', `Curso concluído: ${rule.name}`, `Você concluiu o curso e recebeu a ${rule.name}. Reputação +${rule.reputationBonus} (agora ${rep}); o teto de reputação passa a ${rule.reputationCap}.${next ? `\n\nPróximo passo: a ${licenseRule(next).name}, quando cumprir os pré-requisitos (Histórico da carreira).` : '\n\nVocê chegou ao topo da formação de treinadores.'}`, { sender: 'Escola de treinadores', action: 'history', actionLabel: 'Ver licenças' });
}

/** Clube promovido a uma divisão que exige licença maior: aviso (sem demissão) pedindo a matrícula. NÃO abre transação. */
export function licenseReminder(db: SqlDb, date: string): void {
  const st = getCareerState(db);
  if (!st.clubId || !hasTables(db) || canCoachClub(db, st.clubId)) return;
  const required = clubRequiredLicense(db, st.clubId);
  const held = heldLicense(db);
  const next = nextLicense(held);
  addNews(db, date, 'board', `A nova divisão exige a ${licenseRule(required).name}`, `O clube agora disputa uma divisão que exige a ${licenseRule(required).name} do treinador; você tem ${held === 'none' ? 'nenhuma licença' : `a ${licenseRule(held).name}`}.\n\nA diretoria mantém você no cargo, mas espera que siga a formação: ${next ? `matricule-se no curso da ${licenseRule(next).name} assim que cumprir os pré-requisitos` : 'conclua os cursos'} (Histórico da carreira).`, { sender: 'Escola de treinadores', action: 'history', actionLabel: 'Ver licenças' });
}

export { canCoach, hasLicense, reputationCap };
