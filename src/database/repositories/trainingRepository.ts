import type { SqlDb } from '../types.ts';
import { UserError } from '../../shared/errors.ts';
import { createRng } from '../../game/rng.ts';
import { addDays, ageOn, weekday } from '../../shared/date.ts';
import { developPlayer } from '../../game/career-engine/development.ts';
import { marketValue } from '../../game/world/generator.ts';
import {
  bestFocus, chooseIntensity, FOCUS_KEYS, FOCUSES, INJURED_CONDITION_CAP, INTENSITY, qualityFactor, trainingInjuryChance, type Focus, type Intensity,
} from '../../game/training-engine/training.ts';
import type { Attributes } from '../../shared/types.ts';
import type { MedicalOverviewDto, TrainingOverviewDto } from '../../shared/api.ts';
import { getCareerState } from './careerRepository.ts';
import { addNews } from './newsRepository.ts';
import { facilitiesOf, medicalFactor, staffQuality } from './staffRepository.ts';
import { rowToPlayer } from './worldRepository.ts';
import { addFamiliarity, familiarityOf, ROLE_TRAIN_GAIN, roleFocusMap } from './roleRepository.ts';
import { roleById } from '../../game/match-engine/playerRoles.ts';
import { FULL_CLUBS, FULL_PLAYERS, lightClubIds } from './simLevelRepository.ts';
import { youthGrowthMultiplier } from '../../game/coach-engine/coach.ts';
import { coachOf } from './boardRepository.ts';
import { POS_NAME } from '../../shared/positions.ts';
import type { Position } from '../../shared/types.ts';

export class TrainingError extends UserError {}

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const seedOf = (db: SqlDb) => S((db.prepare("SELECT value FROM meta WHERE key = 'world_seed'").get() ?? { value: 'sem-semente' }).value);

export function trainingSettings(db: SqlDb): { intensity: Intensity; delegated: boolean } {
  const r = db.prepare('SELECT intensity, delegated FROM training_settings WHERE id = 1').get();
  return r ? { intensity: S(r.intensity) as Intensity, delegated: N(r.delegated) === 1 } : { intensity: 'normal', delegated: false };
}
const hasFitnessCoach = (db: SqlDb) => !!db.prepare("SELECT 1 AS x FROM staff WHERE role = 'fitness'").get();
const focusMap = (db: SqlDb) => new Map(db.prepare('SELECT player_id, focus FROM player_training').all().map((r) => [S(r.player_id), S(r.focus) as Focus]));

// ---------------------------------------------------------------- ações do usuário
export function setIntensity(db: SqlDb, intensity: Intensity): void {
  if (!(intensity in INTENSITY)) throw new TrainingError('Intensidade inválida.');
  if (trainingSettings(db).delegated) throw new TrainingError('O treino está delegado ao preparador físico: retome o controle para mudar a intensidade.');
  db.prepare('UPDATE training_settings SET intensity = ? WHERE id = 1').run(intensity);
}

export function setDelegated(db: SqlDb, on: boolean): void {
  if (on && !hasFitnessCoach(db)) throw new TrainingError('Contrate um preparador físico (aba Comissão técnica) para delegar a rotina de treino.');
  db.prepare('UPDATE training_settings SET delegated = ? WHERE id = 1').run(on ? 1 : 0);
  if (on) applyDelegation(db, getCareerState(db).gameDate);
}

export function setFocus(db: SqlDb, playerId: string, focus: Focus): void {
  const st = getCareerState(db);
  if (!FOCUSES.includes(focus)) throw new TrainingError('Foco inválido.');
  if (trainingSettings(db).delegated) throw new TrainingError('O treino está delegado ao preparador físico: retome o controle para escolher focos.');
  if (!db.prepare('SELECT 1 AS x FROM players WHERE id = ? AND club_id = ?').get(playerId, st.clubId)) throw new TrainingError('Só é possível definir o treino de jogadores do seu elenco.');
  db.prepare('INSERT INTO player_training (player_id, focus) VALUES (?, ?) ON CONFLICT(player_id) DO UPDATE SET focus = excluded.focus').run(playerId, focus);
}

/**
 * Função tática que o jogador treina no mês (null = nenhuma). Independe da delegação: o preparador cuida do foco físico/técnico;
 * a função é escolha do técnico.
 */
export function setRoleFocus(db: SqlDb, playerId: string, roleId: string | null): void {
  const st = getCareerState(db);
  if (roleId !== null && !roleById(roleId)) throw new TrainingError('Função inválida.');
  if (!db.prepare('SELECT 1 AS x FROM players WHERE id = ? AND club_id = ?').get(playerId, st.clubId)) throw new TrainingError('Só é possível definir o treino de jogadores do seu elenco.');
  db.prepare("INSERT INTO player_training (player_id, focus, role_focus) VALUES (?, 'balanced', ?) ON CONFLICT(player_id) DO UPDATE SET role_focus = excluded.role_focus").run(playerId, roleId);
}

/** O preparador físico escolhe o foco de cada jogador e a intensidade da semana. NÃO abre transação. */
function applyDelegation(db: SqlDb, date: string): void {
  const st = getCareerState(db);
  const squad = db.prepare('SELECT * FROM players WHERE club_id = ?').all(st.clubId).map(rowToPlayer);
  const up = db.prepare('INSERT INTO player_training (player_id, focus) VALUES (?, ?) ON CONFLICT(player_id) DO UPDATE SET focus = excluded.focus');
  for (const p of squad) up.run(p.id, bestFocus(p.position, p.attributes, ageOn(p.birthDate, date)));
  const avg = squad.length ? squad.reduce((s, p) => s + p.condition, 0) / squad.length : 100;
  const games = N(db.prepare(`SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled' AND match_date > ? AND match_date <= ? AND (home_club_id = ? OR away_club_id = ?)`)
    .get(date, addDays(date, 7), st.clubId, st.clubId)!.n);
  db.prepare('UPDATE training_settings SET intensity = ? WHERE id = 1').run(chooseIntensity(avg, games));
}

// ---------------------------------------------------------------- processamento diário e mensal (chamados por moveClock)
/**
 * Um dia de treino: o preparador revê a rotina às segundas (se delegada); recuperação de condição (intensidade e preparador no clube do usuário,
 * 6/dia nos demais); lesionados ficam com condição limitada (voltam sem ritmo); lesões de treino. NÃO abre transação.
 */
export function processTrainingDay(db: SqlDb, date: string): void {
  const st = getCareerState(db);
  const settings = trainingSettings(db);
  if (settings.delegated && weekday(date) === 1) applyDelegation(db, date);
  const intensity = trainingSettings(db).intensity;
  const userRecovery = INTENSITY[intensity].recovery + (staffQuality(db, st.clubId, 'fitness') / 20) * 1.5;
  db.prepare('UPDATE players SET condition_pct = MIN(100, condition_pct + ?) WHERE club_id = ? AND condition_pct < 100').run(userRecovery, st.clubId);
  db.prepare('UPDATE players SET condition_pct = MIN(100, condition_pct + 6) WHERE (club_id IS NULL OR club_id <> ?) AND condition_pct < 100').run(st.clubId);
  db.prepare('UPDATE players SET condition_pct = MIN(condition_pct, ?) WHERE id IN (SELECT player_id FROM player_status WHERE injury_until > ?)').run(INJURED_CONDITION_CAP, date);

  // lesões de treino (todos os clubes; a IA treina em intensidade normal, com o centro de treinamento no papel de preparador)
  const rng = createRng(`training-injury:${seedOf(db)}:${date}`);
  const injured = new Set(db.prepare('SELECT player_id FROM player_status WHERE injury_until > ?').all(date).map((r) => S(r.player_id)));
  const fitness = new Map<string, number>(), medical = new Map<string, number>();
  const upStatus = db.prepare(`INSERT INTO player_status (player_id, injury_until, injury_note) VALUES (?,?,?)
    ON CONFLICT(player_id) DO UPDATE SET injury_until = excluded.injury_until, injury_note = excluded.injury_note`);
  for (const r of db.prepare(`SELECT id, club_id, first_name, last_name, position, condition_pct FROM players WHERE club_id IN ${FULL_CLUBS} ORDER BY id`).all()) {
    const clubId = S(r.club_id), id = S(r.id);
    const roll = rng.next();
    if (injured.has(id)) continue;
    if (!fitness.has(clubId)) { fitness.set(clubId, staffQuality(db, clubId, 'fitness')); medical.set(clubId, medicalFactor(db, clubId)); }
    if (roll >= trainingInjuryChance(N(r.condition_pct), clubId === st.clubId ? intensity : 'normal', fitness.get(clubId)!)) continue;
    const days = Math.max(2, Math.round(createRng(`training-injury-days:${seedOf(db)}:${date}:${id}`).int(3, 21) * medical.get(clubId)!));
    upStatus.run(id, addDays(date, days), `Lesão no treino (${days} dias)`);
    db.prepare('UPDATE players SET condition_pct = MIN(condition_pct, ?) WHERE id = ?').run(INJURED_CONDITION_CAP, id);
    if (clubId === st.clubId) {
      const name = `${S(r.first_name)} ${S(r.last_name)}`, back = addDays(date, days);
      addNews(db, date, 'medical', `Lesão no treino: ${name} fora por ${days} dias`,
        `${name} (${POS_NAME[S(r.position) as Position].toLowerCase()}) se machucou durante o treino de hoje. Pela avaliação do departamento médico, a previsão de retorno é ${back.split('-').reverse().join('/')} (${days} dias).\n\nEle não pode ser escalado até lá. Se estiver entre os titulares do esquema ativo, o auxiliar escolhe um substituto na hora do jogo, mas vale revisar a escalação e a função da vaga em Táticas.`,
        { actionLabel: 'Ajustar a escalação em Táticas' });
    }
  }
}

/**
 * Evolução mensal (dia 1º), para todos os jogadores ativos. Clube do usuário: intensidade, foco de cada jogador, comissão técnica e centro de treinamento;
 * base do usuário: nível das categorias de base. Clubes da IA: foco equilibrado e o centro de treinamento no papel da comissão. NÃO abre transação.
 */
export function processTrainingMonth(db: SqlDb, date: string): number {
  if (date.slice(8) !== '01') return 0;
  const st = getCareerState(db);
  const seed = seedOf(db);
  const settings = trainingSettings(db);
  const focus = focusMap(db);
  const coachAttrs = st.clubId ? coachOf(db).attributes : undefined;
  const economy = new Map(db.prepare('SELECT code, economy FROM countries').all().map((r) => [S(r.code), N(r.economy)]));
  // fração de minutos na temporada até aqui
  const minutes = new Map(db.prepare('SELECT pss.player_id, SUM(pss.minutes) AS m FROM player_season_stats pss JOIN competitions c ON c.id = pss.competition_id WHERE c.season = ? GROUP BY pss.player_id')
    .all(st.season).map((r) => [S(r.player_id), N(r.m)]));
  const played = new Map(db.prepare(`SELECT club, COUNT(*) AS n FROM (SELECT f.home_club_id AS club FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE c.season = ? AND f.status = 'played'
    UNION ALL SELECT f.away_club_id FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE c.season = ? AND f.status = 'played') GROUP BY club`).all(st.season, st.season).map((r) => [S(r.club), N(r.n)]));
  const clubCtx = new Map<string, { tech: number; phys: number; gk: number; facility: number; youthFacility: number }>();
  const ctxOf = (clubId: string) => {
    let c = clubCtx.get(clubId);
    if (!c) {
      const f = facilitiesOf(db, clubId);
      c = { tech: staffQuality(db, clubId, 'assistant'), phys: staffQuality(db, clubId, 'fitness'), gk: staffQuality(db, clubId, 'goalkeeping'), facility: f.training, youthFacility: f.youth };
      clubCtx.set(clubId, c);
    }
    return c;
  };
  const up = db.prepare('UPDATE players SET attributes_json = ?, overall = ?, potential_hidden = ?, potential_estimated = ?, market_value = ? WHERE id = ?');
  const roleFocus = roleFocusMap(db);
  const roleFam = familiarityOf(db, [...roleFocus.keys()]);
  let n = 0;
  // países simplificados evoluem uma vez por ano, na virada (developLightPlayers)
  for (const r of db.prepare(`SELECT * FROM players WHERE retired = 0 AND ${FULL_PLAYERS} ORDER BY id`).all()) {
    const p = rowToPlayer(r);
    const age = ageOn(p.birthDate, date);
    const youthClub = r.youth_club_id == null ? null : S(r.youth_club_id);
    const clubId = p.clubId ?? youthClub;
    let growth: Partial<Record<keyof Attributes, number>> = { technical: 0.9, mental: 0.9, physical: 0.9 }; // livre: treina por conta própria
    let physicalDecline = 1.1;
    let focusKeys: ReadonlySet<string> | undefined;
    if (clubId) {
      const c = ctxOf(clubId);
      const user = clubId === st.clubId, academy = youthClub !== null;
      const base = qualityFactor(academy ? c.youthFacility : c.facility) * (user && !academy ? INTENSITY[settings.intensity].growth : 1)
        * (user ? youthGrowthMultiplier(coachAttrs, age) : 1); // desenvolvimento de jovens do treinador (elenco e base do seu clube)
      const techQ = p.position === 'GK' ? c.gk : c.tech;
      growth = { technical: base * qualityFactor(techQ), mental: base * qualityFactor(techQ), physical: base * qualityFactor(c.phys) };
      physicalDecline = 1.1 - (0.2 * c.phys) / 20;
      if (user && !academy) {
        // delegado: vale sempre a escolha do preparador (inclusive para quem entrou no elenco depois da última revisão)
        const f = settings.delegated ? bestFocus(p.position, p.attributes, age) : focus.get(p.id) ?? 'balanced';
        if (f !== 'balanced') focusKeys = new Set(FOCUS_KEYS[f]);
        // treino de função: auxiliar técnico (ou de goleiros) e centro de treinamento aceleram o domínio
        const rf = roleFocus.get(p.id);
        if (rf) { const f2 = roleFam.get(p.id); if (f2) p.roleFamiliarity = f2; addFamiliarity(db, p, rf, ROLE_TRAIN_GAIN * qualityFactor(techQ) * base); }
        // sem foco de atributos (Equilibrado), a evolução privilegia os atributos que a função treinada exige: a compatibilidade sobe com o tempo
        const rd = rf ? roleById(rf) : undefined;
        if (!focusKeys && rd) focusKeys = new Set(Object.keys(rd.weights));
      }
    }
    const possible = 90 * (p.clubId ? played.get(p.clubId) ?? 0 : 0);
    const d = developPlayer(p, age, possible > 0 ? Math.min(1, (minutes.get(p.id) ?? 0) / possible) : 0, createRng(`train:${seed}:${date}:${p.id}`), { fraction: 1 / 12, focusKeys, growth, physicalDecline });
    up.run(JSON.stringify(d.attributes), d.overall, d.potentialHidden, d.potentialEstimated, marketValue(d.overall, age, d.potentialHidden, economy.get(p.nationality) ?? 1), p.id);
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- telas
export function getTrainingOverview(db: SqlDb): TrainingOverviewDto {
  const st = getCareerState(db);
  const settings = trainingSettings(db);
  const focus = focusMap(db);
  const injured = new Map(db.prepare('SELECT player_id, injury_until FROM player_status WHERE injury_until > ?').all(st.gameDate).map((r) => [S(r.player_id), S(r.injury_until)]));
  const players = db.prepare('SELECT * FROM players WHERE club_id = ? ORDER BY position, overall DESC').all(st.clubId).map((r) => {
    const p = rowToPlayer(r);
    const age = ageOn(p.birthDate, st.gameDate);
    return {
      id: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position, age, overall: p.overall, potentialEstimated: Math.max(p.overall, p.potentialEstimated),
      condition: Math.round(p.condition), focus: settings.delegated ? bestFocus(p.position, p.attributes, age) : focus.get(p.id) ?? 'balanced', suggestedFocus: bestFocus(p.position, p.attributes, age),
      seasonChange: p.overall - N(r.season_start_overall ?? p.overall), injuredUntil: injured.get(p.id) ?? null,
    };
  });
  return { intensity: settings.intensity, delegated: settings.delegated, hasFitnessCoach: hasFitnessCoach(db), focuses: FOCUSES, players, intensityEffects: INTENSITY };
}

export function getMedicalOverview(db: SqlDb): MedicalOverviewDto {
  const st = getCareerState(db);
  const doc = db.prepare("SELECT first_name, last_name, ability FROM staff WHERE role = 'doctor'").get();
  const f = facilitiesOf(db, st.clubId);
  const intensity = trainingSettings(db).intensity;
  const fitnessQ = staffQuality(db, st.clubId, 'fitness');
  const rows = db.prepare(`SELECT p.id, p.first_name, p.last_name, p.position, p.condition_pct, s.injury_until, s.injury_note FROM players p
    LEFT JOIN player_status s ON s.player_id = p.id WHERE p.club_id = ? ORDER BY p.condition_pct`).all(st.clubId);
  const days = (until: string) => Math.max(0, Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${st.gameDate}T00:00:00Z`)) / 86_400_000));
  return {
    doctor: doc ? { name: `${S(doc.first_name)} ${S(doc.last_name)}`, ability: N(doc.ability) } : null, medicalLevel: f.medical,
    recoveryFactor: Math.round(medicalFactor(db, st.clubId) * 100) / 100, intensity,
    injured: rows.filter((r) => r.injury_until != null && S(r.injury_until) > st.gameDate).map((r) => ({
      id: S(r.id), name: `${S(r.first_name)} ${S(r.last_name)}`, position: S(r.position) as never, until: S(r.injury_until), daysLeft: days(S(r.injury_until)), note: r.injury_note == null ? 'Lesão' : S(r.injury_note),
    })).sort((a, b) => a.daysLeft - b.daysLeft),
    atRisk: rows.filter((r) => !(r.injury_until != null && S(r.injury_until) > st.gameDate) && N(r.condition_pct) < 70).map((r) => ({
      id: S(r.id), name: `${S(r.first_name)} ${S(r.last_name)}`, position: S(r.position) as never, condition: Math.round(N(r.condition_pct)),
      dailyRisk: Math.round(trainingInjuryChance(N(r.condition_pct), intensity, fitnessQ) * 100000) / 1000,
    })),
  };
}

/**
 * Evolução ANUAL dos jogadores de países com simulação simplificada (eles não passam pela evolução mensal nem jogam partidas detalhadas).
 * Chamada na virada. Minutos estimados pela posição no elenco: os 11 melhores como titulares, os 7 seguintes como reservas.
 * NÃO abre transação.
 */
export function developLightPlayers(db: SqlDb, date: string): number {
  const seed = seedOf(db);
  const economy = new Map(db.prepare('SELECT code, economy FROM countries').all().map((r) => [S(r.code), N(r.economy)]));
  const up = db.prepare('UPDATE players SET attributes_json = ?, overall = ?, potential_hidden = ?, potential_estimated = ?, market_value = ? WHERE id = ?');
  let n = 0;
  for (const clubId of lightClubIds(db)) {
    const squad = db.prepare('SELECT * FROM players WHERE club_id = ? AND retired = 0').all(clubId).map(rowToPlayer).sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id));
    squad.forEach((p, i) => {
      const age = ageOn(p.birthDate, date);
      const d = developPlayer(p, age, i < 11 ? 0.8 : i < 18 ? 0.35 : 0.08, createRng(`light-dev:${seed}:${date}:${p.id}`), { fraction: 1 });
      up.run(JSON.stringify(d.attributes), d.overall, d.potentialHidden, d.potentialEstimated, marketValue(d.overall, age, d.potentialHidden, economy.get(p.nationality) ?? 1), p.id);
      n++;
    });
  }
  return n;
}
