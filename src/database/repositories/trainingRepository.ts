import type { SqlDb } from '../types.ts';
import { UserError } from '../../shared/errors.ts';
import { createRng } from '../../game/rng.ts';
import { addDays, ageOn, daysBetween, weekday } from '../../shared/date.ts';
import { developPlayer } from '../../game/career-engine/development.ts';
import { marketValue } from '../../game/world/generator.ts';
import {
  ACUTE_SAFE, bestFocus, chooseIntensity, chooseTemplate, FOCUS_KEYS, FOCUSES, INJURED_CONDITION_CAP, INTENSITY, qualityFactor, trainingInjuryChance, type Focus, type Intensity,
} from '../../game/training-engine/training.ts';
import {
  bestGkSession, GK_SESSION_KEYS, GK_SESSION_LABEL, GK_SESSIONS, gkCoachFactor, GROWTH_GROUPS, monthlyMultipliers, PLAN_SESSIONS, SESSION, SESSION_LABEL, sessionFor,
  TEMPLATE_IDS, TEMPLATES, type GkSession, type MatchAround, type PlanSession, type Session, type TemplateId, type Week,
} from '../../game/training-engine/sessions.ts';
import { nextSharpness, recoverDay, sessionLoad, sharpnessDecay } from '../../game/training-engine/condition.ts';
import { effAcute, effSharp, sharpRateOf } from './fitnessState.ts';
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
import { CURRENT_COMP } from './countrySeasonRepository.ts';

export class TrainingError extends UserError {}

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const seedOf = (db: SqlDb) => S((db.prepare("SELECT value FROM meta WHERE key = 'world_seed'").get() ?? { value: 'sem-semente' }).value);
const br = (d: string) => d.split('-').reverse().join('/');

export interface TrainingSettings { intensity: Intensity; delegated: boolean; template: TemplateId | 'custom'; autoAdjust: boolean }
export function trainingSettings(db: SqlDb): TrainingSettings {
  const r = db.prepare('SELECT intensity, delegated, template, auto_adjust FROM training_settings WHERE id = 1').get();
  return r ? { intensity: S(r.intensity) as Intensity, delegated: N(r.delegated) === 1, template: S(r.template) as TemplateId, autoAdjust: N(r.auto_adjust) === 1 }
    : { intensity: 'normal', delegated: false, template: 'balanced', autoAdjust: true };
}
/** Grade semanal do clube do usuário (0 = domingo … 6 = sábado). */
export function weekPlan(db: SqlDb): Week {
  const w = [...TEMPLATES.balanced.week];
  for (const r of db.prepare('SELECT dow, session FROM training_week').all()) w[N(r.dow)] = S(r.session) as Session;
  return w;
}
const staffName = (db: SqlDb, role: string) => { const r = db.prepare('SELECT first_name, last_name, ability FROM staff WHERE role = ?').get(role); return r ? { name: `${S(r.first_name)} ${S(r.last_name)}`, ability: N(r.ability) } : null; };
const hasFitnessCoach = (db: SqlDb) => !!db.prepare("SELECT 1 AS x FROM staff WHERE role = 'fitness'").get();
const hasGkCoach = (db: SqlDb) => !!db.prepare("SELECT 1 AS x FROM staff WHERE role = 'goalkeeping'").get();
const focusMap = (db: SqlDb) => new Map(db.prepare('SELECT player_id, focus FROM player_training').all().map((r) => [S(r.player_id), S(r.focus) as Focus]));
const gkSessionMap = (db: SqlDb) => new Map(db.prepare('SELECT player_id, gk_session FROM player_training WHERE gk_session IS NOT NULL').all().map((r) => [S(r.player_id), S(r.gk_session) as GkSession]));

/** Jogos de cada clube ontem, hoje e amanhã (para ajustar a sessão do dia). */
function matchesAround(db: SqlDb, date: string): Map<string, MatchAround> {
  const out = new Map<string, MatchAround>();
  const y = addDays(date, -1), t = addDays(date, 1);
  for (const r of db.prepare('SELECT home_club_id, away_club_id, match_date FROM fixtures WHERE match_date >= ? AND match_date <= ?').all(y, t)) {
    for (const c of [S(r.home_club_id), S(r.away_club_id)]) {
      const m = out.get(c) ?? { today: false, yesterday: false, tomorrow: false };
      const d = S(r.match_date);
      if (d === date) m.today = true; else if (d === y) m.yesterday = true; else m.tomorrow = true;
      out.set(c, m);
    }
  }
  return out;
}
const NO_MATCH: MatchAround = { today: false, yesterday: false, tomorrow: false };
/** Sessão de referência (semana Equilibrada com ajuste automático): a da IA e a base de comparação da evolução do usuário. */
const refSession = (date: string, m: MatchAround): Session => sessionFor(TEMPLATES.balanced.week[weekday(date)]!, m, true);

// ---------------------------------------------------------------- ações do usuário
const notDelegated = (db: SqlDb, what: string) => {
  if (trainingSettings(db).delegated) throw new TrainingError(`O treino está delegado ao preparador físico: retome o controle para ${what}.`);
};
export function setIntensity(db: SqlDb, intensity: Intensity): void {
  if (!(intensity in INTENSITY)) throw new TrainingError('Intensidade inválida.');
  notDelegated(db, 'mudar a intensidade');
  db.prepare('UPDATE training_settings SET intensity = ? WHERE id = 1').run(intensity);
}

export function setDelegated(db: SqlDb, on: boolean): void {
  if (on && !hasFitnessCoach(db)) throw new TrainingError('Contrate um preparador físico (aba Comissão técnica) para delegar a rotina de treino.');
  db.prepare('UPDATE training_settings SET delegated = ? WHERE id = 1').run(on ? 1 : 0);
  if (on) applyDelegation(db, getCareerState(db).gameDate);
}

const writeWeek = (db: SqlDb, week: Week) => { const up = db.prepare('UPDATE training_week SET session = ? WHERE dow = ?'); week.forEach((s, d) => up.run(s, d)); };
/** Troca a sessão de um dia da grade (a grade passa a ser "personalizada"). */
export function setWeekSession(db: SqlDb, dow: number, session: PlanSession): void {
  if (!Number.isInteger(dow) || dow < 0 || dow > 6) throw new TrainingError('Dia da semana inválido.');
  if (!PLAN_SESSIONS.includes(session)) throw new TrainingError('Sessão inválida.');
  notDelegated(db, 'montar a semana');
  db.prepare('UPDATE training_week SET session = ? WHERE dow = ?').run(session, dow);
  db.prepare("UPDATE training_settings SET template = 'custom' WHERE id = 1").run();
}
/** Aplica um modelo pronto de semana. */
export function applyTemplate(db: SqlDb, id: TemplateId): void {
  if (!TEMPLATE_IDS.includes(id)) throw new TrainingError('Modelo de semana inválido.');
  notDelegated(db, 'trocar o modelo da semana');
  writeWeek(db, TEMPLATES[id].week);
  db.prepare('UPDATE training_settings SET template = ? WHERE id = 1').run(id);
}
export function setAutoAdjust(db: SqlDb, on: boolean): void {
  notDelegated(db, 'mudar o ajuste aos jogos');
  db.prepare('UPDATE training_settings SET auto_adjust = ? WHERE id = 1').run(on ? 1 : 0);
}

export function setFocus(db: SqlDb, playerId: string, focus: Focus): void {
  const st = getCareerState(db);
  if (!FOCUSES.includes(focus)) throw new TrainingError('Foco inválido.');
  notDelegated(db, 'escolher focos');
  if (!db.prepare('SELECT 1 AS x FROM players WHERE id = ? AND club_id = ?').get(playerId, st.clubId)) throw new TrainingError('Só é possível definir o treino de jogadores do seu elenco.');
  db.prepare('INSERT INTO player_training (player_id, focus) VALUES (?, ?) ON CONFLICT(player_id) DO UPDATE SET focus = excluded.focus').run(playerId, focus);
}

/** Sessão de goleiros de um goleiro do elenco (null = deixar com o treinador de goleiros). Independe da delegação, como a função. */
export function setGkSession(db: SqlDb, playerId: string, session: GkSession | null): void {
  const st = getCareerState(db);
  if (session !== null && !GK_SESSIONS.includes(session)) throw new TrainingError('Sessão de goleiros inválida.');
  if (!db.prepare("SELECT 1 AS x FROM players WHERE id = ? AND club_id = ? AND position = 'GK'").get(playerId, st.clubId)) throw new TrainingError('Só goleiros do seu elenco fazem a sessão de goleiros.');
  db.prepare("INSERT INTO player_training (player_id, focus, gk_session) VALUES (?, 'balanced', ?) ON CONFLICT(player_id) DO UPDATE SET gk_session = excluded.gk_session").run(playerId, session);
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

const gamesNext7 = (db: SqlDb, clubId: string, date: string) => N(db.prepare(`SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled' AND match_date > ? AND match_date <= ? AND (home_club_id = ? OR away_club_id = ?)`)
  .get(date, addDays(date, 7), clubId, clubId)!.n);

/** O preparador físico escolhe o foco de cada jogador, o modelo da semana e a intensidade. NÃO abre transação. */
function applyDelegation(db: SqlDb, date: string): void {
  const st = getCareerState(db);
  const squad = db.prepare('SELECT * FROM players WHERE club_id = ?').all(st.clubId);
  const up = db.prepare('INSERT INTO player_training (player_id, focus) VALUES (?, ?) ON CONFLICT(player_id) DO UPDATE SET focus = excluded.focus');
  for (const r of squad) { const p = rowToPlayer(r); up.run(p.id, bestFocus(p.position, p.attributes, ageOn(p.birthDate, date))); }
  const avg = squad.length ? squad.reduce((s, r) => s + N(r.condition_pct), 0) / squad.length : 100;
  const load = squad.length ? squad.reduce((s, r) => s + effAcute(r, date), 0) / squad.length : 0;
  const games = gamesNext7(db, st.clubId, date);
  const tpl = chooseTemplate(avg, games, load);
  writeWeek(db, TEMPLATES[tpl].week);
  db.prepare('UPDATE training_settings SET intensity = ?, template = ?, auto_adjust = 1 WHERE id = 1').run(chooseIntensity(avg, games, load), tpl);
}

// ---------------------------------------------------------------- processamento diário e mensal (chamados por moveClock)
/**
 * Um dia de treino (v0.8.12). Cada clube completo faz a sessão do dia — o usuário pela sua grade (ajustada aos jogos, se ligado), a IA pela
 * semana Equilibrada ajustada aos jogos dela. Condição: recupera uma fração do que falta (sessão, preparador, departamento médico, idade e
 * recuperação física); a carga das sessões gasta condição só no clube do usuário (a IA só recupera). Ritmo e carga de jogos são
 * preguiçosos (`fitnessState.ts`): só o clube do usuário e os lesionados têm o ritmo gravado no dia. Pode haver lesão no treino.
 * Lesionados ficam com condição limitada (voltam sem ritmo). O preparador revê a rotina às segundas (se delegada) e os relatórios semanais
 * saem às segundas. Grava só as linhas que mudam: atualizar ~18 mil linhas largas de `players` por dia custava ~200 ms. NÃO abre transação.
 */
export function processTrainingDay(db: SqlDb, date: string): void {
  const st = getCareerState(db);
  if (st.clubId && trainingSettings(db).delegated && weekday(date) === 1) applyDelegation(db, date);
  const settings = trainingSettings(db);
  const week = weekPlan(db);
  const dow = weekday(date);
  const around = matchesAround(db, date);
  const userM = around.get(st.clubId) ?? NO_MATCH;
  const userSession = sessionFor(week[dow]!, userM, settings.autoAdjust);
  const I = INTENSITY[settings.intensity];
  const yesterday = addDays(date, -1);

  // jogadores ainda sem data do ritmo (save migrado, recém-criados): a queda conta a partir de hoje
  db.prepare('UPDATE players SET sharp_on = ? WHERE sharp_on IS NULL').run(date);
  // países simplificados, base e livres: recuperação simples, como antes
  db.prepare(`UPDATE players SET condition_pct = MIN(100, condition_pct + 6) WHERE condition_pct < 100 AND (club_id IS NULL OR club_id NOT IN ${FULL_CLUBS})`).run();

  // clubes completos: sessão do dia, condição, ritmo e lesões de treino (a IA treina em intensidade normal, com o centro de treinamento no
  // papel de preparador físico)
  const rng = createRng(`training-injury:${seedOf(db)}:${date}`);
  const injured = new Set(db.prepare('SELECT player_id FROM player_status WHERE injury_until > ?').all(date).map((r) => S(r.player_id)));
  interface ClubDay { user: boolean; session: Session; loadMul: number; injuryMul: number; fitnessQ: number; medicalLevel: number; medical: number }
  const clubs = new Map<string, ClubDay>();
  const clubDay = (clubId: string): ClubDay => {
    let c = clubs.get(clubId);
    if (!c) {
      const user = clubId === st.clubId;
      const session = user ? userSession : refSession(date, around.get(clubId) ?? NO_MATCH);
      c = { user, session, loadMul: user ? I.load : 0, injuryMul: SESSION[session].injury * (user ? I.injury : 1), fitnessQ: staffQuality(db, clubId, 'fitness'),
        medicalLevel: facilitiesOf(db, clubId).medical, medical: medicalFactor(db, clubId) };
      clubs.set(clubId, c);
    }
    return c;
  };
  const upStatus = db.prepare(`INSERT INTO player_status (player_id, injury_until, injury_note) VALUES (?,?,?)
    ON CONFLICT(player_id) DO UPDATE SET injury_until = excluded.injury_until, injury_note = excluded.injury_note`);
  const condOnly: Array<[string, number]> = [];
  const full: Array<[string, number, number, number]> = [];
  // todos os jogadores completos (sorteio na ordem dos ids) pelo índice de cobertura idx_players_daily; o resto da linha (data de nascimento,
  // ritmo, moral, recuperação física no JSON dos atributos) só de quem recupera, treina com carga ou está lesionado — ler as linhas largas
  // de todos custava ~40 ms por dia
  const detailSql = "SELECT id, birth_date, sharpness, sharp_on, last_played, morale, json_extract(attributes_json, '$.physical.naturalFitness') AS nf FROM players";
  const detail = new Map(db.prepare(`${detailSql} WHERE (condition_pct < 100 AND club_id IN ${FULL_CLUBS}) OR club_id = ?`).all(st.clubId).map((r) => [S(r.id), r]));
  const detailOne = db.prepare(`${detailSql} WHERE id = ?`);
  for (const r0 of db.prepare(`SELECT id, club_id, condition_pct, acute_load, acute_on FROM players WHERE club_id IN ${FULL_CLUBS} ORDER BY id`).all()) {
    const clubId = S(r0.club_id), id = S(r0.id);
    const roll = rng.next();
    const c = clubDay(clubId);
    const hurt = injured.has(id);
    const session: Session = hurt ? 'recovery' : c.session;
    const cond0 = N(r0.condition_pct);
    const needs = cond0 < 100 || c.user || hurt;
    const r = needs ? { ...r0, ...(detail.get(id) ?? detailOne.get(id)) } : r0;
    let cond = cond0 < 100 || (c.user && !hurt)
      ? recoverDay(cond0, { session, loadMul: c.loadMul, fitnessQ: c.fitnessQ, medicalLevel: c.medicalLevel, age: ageOn(S(r.birth_date), date), naturalFitness: N(r.nf ?? 10) })
      : cond0;
    if (hurt) cond = Math.min(cond, INJURED_CONDITION_CAP);
    let newInjury = 0;
    if (!hurt && c.injuryMul > 0 && roll < trainingInjuryChance(cond, c.injuryMul, c.fitnessQ, effAcute(r, date))) {
      newInjury = Math.max(2, Math.round(createRng(`training-injury-days:${seedOf(db)}:${date}:${id}`).int(3, 21) * c.medical));
      cond = Math.min(cond, INJURED_CONDITION_CAP);
    }
    if (c.user || hurt) {
      // ritmo do dia: a queda de quem está parado (ou −3 lesionado) e o ganho das sessões pré-jogo/tática; moral da folga (só o usuário)
      const sharp = nextSharpness(effSharp(r, yesterday, sharpnessDecay(c.fitnessQ)), {
        idle: r.last_played == null ? null : daysBetween(S(r.last_played), date), injured: hurt, session, fitnessQ: c.fitnessQ,
      });
      full.push([id, cond, sharp, Math.min(100, N(r.morale) + (c.user ? SESSION[session].morale : 0))]);
    } else if (cond !== cond0) condOnly.push([id, cond]);
    if (!newInjury) continue;
    upStatus.run(id, addDays(date, newInjury), `Lesão no treino (${newInjury} dias)`);
    if (c.user) {
      const who = db.prepare('SELECT first_name, last_name, position FROM players WHERE id = ?').get(id)!;
      const name = `${S(who.first_name)} ${S(who.last_name)}`, back = addDays(date, newInjury);
      addNews(db, date, 'medical', `Lesão no treino: ${name} fora por ${newInjury} dias`,
        `${name} (${POS_NAME[S(who.position) as Position].toLowerCase()}) se machucou durante o treino de hoje (${SESSION_LABEL[session].toLowerCase()}). Pela avaliação do departamento médico, a previsão de retorno é ${br(back)} (${newInjury} dias).\n\nEle não pode ser escalado até lá. Se estiver entre os titulares do esquema ativo, o auxiliar escolhe um substituto na hora do jogo, mas vale revisar a escalação e a função da vaga em Táticas.`,
        { actionLabel: 'Ajustar a escalação em Táticas' });
    }
  }
  // uma instrução por tipo de mudança (instruções avulsas por jogador custavam caro)
  if (condOnly.length) db.prepare(`UPDATE players SET condition_pct = json_extract(j.value, '$[1]') FROM json_each(?) AS j WHERE players.id = json_extract(j.value, '$[0]')`).run(JSON.stringify(condOnly));
  if (full.length) db.prepare(`UPDATE players SET condition_pct = json_extract(j.value, '$[1]'), sharpness = json_extract(j.value, '$[2]'), sharp_on = ?,
    morale = json_extract(j.value, '$[3]') FROM json_each(?) AS j WHERE players.id = json_extract(j.value, '$[0]')`).run(date, JSON.stringify(full));
  db.prepare('UPDATE players SET condition_pct = ? WHERE condition_pct > ? AND id IN (SELECT player_id FROM player_status WHERE injury_until > ?)').run(INJURED_CONDITION_CAP, INJURED_CONDITION_CAP, date);

  if (!st.clubId) return;
  // acumulado do mês do usuário: a grade efetiva (com a intensidade) × a semana Equilibrada com os mesmos jogos
  const ref = refSession(date, userM);
  const acc = db.prepare('INSERT INTO training_month (key, actual, ref) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET actual = actual + excluded.actual, ref = ref + excluded.ref');
  for (const g of GROWTH_GROUPS) acc.run(g, SESSION[userSession].growth[g] * I.growth, SESSION[ref].growth[g]);
  acc.run('role', SESSION[userSession].role, SESSION[ref].role);
  if (dow === 1) weeklyStaffReports(db, date);
}

/** Multiplicadores do mês do usuário (e zera o acumulado). Sem acumulado (save recém-migrado): só a intensidade. */
function takeMonthMultipliers(db: SqlDb, intensity: Intensity): Record<'physical' | 'technical' | 'mental' | 'role', number> {
  const rows = db.prepare('SELECT key, actual, ref FROM training_month').all();
  db.exec('DELETE FROM training_month');
  if (!rows.length) { const g = INTENSITY[intensity].growth; return { physical: g, technical: g, mental: g, role: 1 }; }
  const actual: Record<string, number> = {}, ref: Record<string, number> = {};
  for (const r of rows) { actual[S(r.key)] = N(r.actual); ref[S(r.key)] = N(r.ref); }
  return monthlyMultipliers({ actual, ref });
}

/**
 * Evolução mensal (dia 1º), para todos os jogadores ativos. Clube do usuário: a grade de sessões do mês (multiplicadores por grupo, com a
 * intensidade), foco de cada jogador, sessão de goleiros, comissão técnica e centro de treinamento; base do usuário: nível das categorias
 * de base. Clubes da IA: foco equilibrado e o centro de treinamento no papel da comissão. NÃO abre transação.
 */
export function processTrainingMonth(db: SqlDb, date: string): number {
  if (date.slice(8) !== '01') return 0;
  const st = getCareerState(db);
  const seed = seedOf(db);
  const settings = trainingSettings(db);
  const focus = focusMap(db);
  const gkChosen = gkSessionMap(db);
  const gkCoach = hasGkCoach(db);
  const month = st.clubId ? takeMonthMultipliers(db, settings.intensity) : null;
  const coachAttrs = st.clubId ? coachOf(db).attributes : undefined;
  const economy = new Map(db.prepare('SELECT code, economy FROM countries').all().map((r) => [S(r.code), N(r.economy)]));
  // fração de minutos na temporada até aqui
  const minutes = new Map(db.prepare(`SELECT pss.player_id, SUM(pss.minutes) AS m FROM player_season_stats pss JOIN competitions c ON c.id = pss.competition_id WHERE ${CURRENT_COMP} GROUP BY pss.player_id`)
    .all().map((r) => [S(r.player_id), N(r.m)]));
  const played = new Map(db.prepare(`SELECT club, COUNT(*) AS n FROM (SELECT f.home_club_id AS club FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE ${CURRENT_COMP} AND f.status = 'played'
    UNION ALL SELECT f.away_club_id FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE ${CURRENT_COMP} AND f.status = 'played') GROUP BY club`).all().map((r) => [S(r.club), N(r.n)]));
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
  const userGks: Array<{ id: string; attributes: Attributes; overall: number }> = [];
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
      const base = qualityFactor(academy ? c.youthFacility : c.facility) * (user ? youthGrowthMultiplier(coachAttrs, age) : 1); // desenvolvimento de jovens do treinador
      const gk = p.position === 'GK';
      const techQ = gk ? c.gk : c.tech;
      growth = { technical: base * qualityFactor(techQ), mental: base * qualityFactor(techQ), physical: base * qualityFactor(c.phys) };
      physicalDecline = 1.1 - (0.2 * c.phys) / 20;
      if (user && !academy && month) {
        // sessões do mês: cada grupo pelo que a grade deu × a semana Equilibrada; goleiros fazem a sessão de goleiros em todo dia de treino
        // (volume = média dos grupos) e rendem pelo treinador de goleiros (0,80–1,10)
        const vol = (month.physical + month.technical + month.mental) / 3;
        const tq = gk ? gkCoachFactor(c.gk) : qualityFactor(c.tech);
        growth = { technical: base * tq * (gk ? vol : month.technical), mental: base * tq * month.mental, physical: base * qualityFactor(c.phys) * month.physical };
        // delegado: vale sempre a escolha do preparador (inclusive para quem entrou no elenco depois da última revisão)
        const f = settings.delegated ? bestFocus(p.position, p.attributes, age) : focus.get(p.id) ?? 'balanced';
        if (f !== 'balanced') focusKeys = new Set(FOCUS_KEYS[f]);
        if (gk) {
          const s = gkChosen.get(p.id) ?? (gkCoach ? bestGkSession(p.attributes) : null);
          if (s) focusKeys = new Set(GK_SESSION_KEYS[s]);
        }
        // treino de função: auxiliar técnico (ou de goleiros), centro de treinamento e sessões táticas aceleram o domínio
        const rf = roleFocus.get(p.id);
        if (rf) { const f2 = roleFam.get(p.id); if (f2) p.roleFamiliarity = f2; addFamiliarity(db, p, rf, ROLE_TRAIN_GAIN * qualityFactor(techQ) * base * month.role); }
        // sem foco de atributos (Equilibrado), a evolução privilegia os atributos que a função treinada exige: a compatibilidade sobe com o tempo
        const rd = rf ? roleById(rf) : undefined;
        if (!focusKeys && rd) focusKeys = new Set(Object.keys(rd.weights));
      }
    }
    const possible = 90 * (p.clubId ? played.get(p.clubId) ?? 0 : 0);
    const d = developPlayer(p, age, possible > 0 ? Math.min(1, (minutes.get(p.id) ?? 0) / possible) : 0, createRng(`train:${seed}:${date}:${p.id}`), { fraction: 1 / 12, focusKeys, growth, physicalDecline });
    up.run(JSON.stringify(d.attributes), d.overall, d.potentialHidden, d.potentialEstimated, marketValue(d.overall, age, d.potentialHidden, economy.get(p.nationality) ?? 1), p.id);
    if (p.clubId && p.clubId === st.clubId && p.position === 'GK') userGks.push({ id: p.id, attributes: d.attributes, overall: d.overall });
    n++;
  }
  // referência do relatório do treinador de goleiros: atributos no início do mês
  db.exec('DELETE FROM gk_month_start');
  const snap = db.prepare('INSERT INTO gk_month_start (player_id, attrs_json, overall) VALUES (?, ?, ?)');
  for (const g of userGks) snap.run(g.id, JSON.stringify(g.attributes.goalkeeper ?? {}), g.overall);
  return n;
}

// ---------------------------------------------------------------- relatórios semanais da comissão (Caixa de entrada, segundas-feiras)
const GK_ATTR_LABEL: Record<string, string> = { reflexes: 'reflexos', oneOnOne: 'um contra um', handling: 'mãos', aerial: 'jogo aéreo', rushingOut: 'saídas', kicking: 'chute' };
function weeklyStaffReports(db: SqlDb, date: string): void {
  const st = getCareerState(db);
  const fitness = staffName(db, 'fitness'), gkc = staffName(db, 'goalkeeping');
  if (!fitness && !gkc) return;
  const rate = sharpRateOf(db, st.clubId);
  const rows = db.prepare('SELECT * FROM players WHERE club_id = ? ORDER BY position, overall DESC').all(st.clubId)
    .map((r): Record<string, unknown> => ({ ...r, acute_load: effAcute(r, date), sharpness: effSharp(r, date, rate) }));
  const injured = new Set(db.prepare('SELECT player_id FROM player_status WHERE injury_until > ?').all(date).map((r) => S(r.player_id)));
  const name = (r: Record<string, unknown>) => `${S(r.first_name)} ${S(r.last_name)}`;
  if (fitness && rows.length) {
    const fit = rows.filter((r) => !injured.has(S(r.id)));
    const avgC = fit.reduce((s, r) => s + N(r.condition_pct), 0) / Math.max(1, fit.length);
    const avgL = fit.reduce((s, r) => s + N(r.acute_load), 0) / Math.max(1, fit.length);
    const tired = fit.filter((r) => N(r.condition_pct) < 75).sort((a, b) => N(a.condition_pct) - N(b.condition_pct));
    const heavy = fit.filter((r) => N(r.acute_load) > ACUTE_SAFE).sort((a, b) => N(b.acute_load) - N(a.acute_load));
    const rusty = fit.filter((r) => N(r.sharpness) < 50).sort((a, b) => N(b.overall) - N(a.overall));
    const games = gamesNext7(db, st.clubId, date);
    const recs = [
      ...tired.slice(0, 3).map((r) => `- Poupar ${name(r)} no próximo jogo ou usá-lo só no segundo tempo.`),
      ...(games >= 2 ? ['- Semana com 2 jogos: modelo "Semana com 2 jogos" ou intensidade leve.'] : []),
      ...(avgC < 82 ? ['- Elenco cansado: incluir sessões de recuperação.'] : []),
      ...(heavy.length >= 3 ? ['- Vários jogadores com carga alta: aliviar a intensidade nesta semana.'] : []),
    ];
    const body = [
      `Condição média do elenco: ${Math.round(avgC)}%. Carga média de jogos dos últimos dias: ${avgL.toFixed(1)} (90 minutos = 10; acima de ${ACUTE_SAFE} o risco de lesão aumenta). Jogos nos próximos 7 dias: ${games}.`,
      tired.length ? `Abaixo de 75%: ${tired.slice(0, 8).map((r) => `${name(r)} (${Math.round(N(r.condition_pct))}%)`).join(', ')}.` : 'Ninguém abaixo de 75% de condição.',
      ...(heavy.length ? [`Carga alta: ${heavy.slice(0, 6).map((r) => `${name(r)} (${N(r.acute_load).toFixed(0)})`).join(', ')}.`] : []),
      ...(rusty.length ? [`Sem ritmo de jogo (abaixo de 50): ${rusty.slice(0, 6).map((r) => `${name(r)} (${Math.round(N(r.sharpness))})`).join(', ')}. Minutos em campo devolvem o ritmo.`] : []),
      '',
      'Recomendações:',
      ...(recs.length ? recs : ['- Elenco em boas condições: dá para manter a rotina.']),
    ].join('\n');
    addNews(db, date, 'staff', `Relatório físico da semana: condição média ${Math.round(avgC)}%`, body,
      { sender: `${fitness.name} (preparador físico)`, action: 'training', actionLabel: 'Abrir Treino', players: [...new Set([...tired, ...rusty].map((r) => S(r.id)))].slice(0, 12) });
  }
  const gks = rows.filter((r) => S(r.position) === 'GK');
  if (gkc && gks.length) {
    const chosen = gkSessionMap(db);
    const start = new Map(db.prepare('SELECT player_id, attrs_json FROM gk_month_start').all().map((r) => [S(r.player_id), JSON.parse(S(r.attrs_json)) as Record<string, number>]));
    const lines = gks.map((r) => {
      const p = rowToPlayer(r);
      const s = chosen.get(p.id) ?? bestGkSession(p.attributes);
      const ref = start.get(p.id);
      const cur = (p.attributes.goalkeeper ?? {}) as unknown as Record<string, number>;
      const ups = ref ? Object.keys(GK_ATTR_LABEL).filter((k) => (cur[k] ?? 0) > (ref[k] ?? 0)).map((k) => GK_ATTR_LABEL[k]!) : [];
      const evo = !ref ? 'ainda sem referência do mês (o primeiro balanço sai depois do dia 1º)'
        : ups.length ? `evoluiu em ${ups.join(', ')} neste mês` : 'sem evolução visível neste mês';
      return `- ${name(r)}: sessão "${GK_SESSION_LABEL[s]}"${chosen.has(p.id) ? ' (escolhida pelo técnico)' : ''}; ${evo}.`;
    });
    addNews(db, date, 'staff', 'Relatório dos goleiros da semana', ['Treino específico dos goleiros nos dias de físico, técnico e tático:', ...lines].join('\n'),
      { sender: `${gkc.name} (treinador de goleiros)`, action: 'training', actionLabel: 'Abrir Treino', players: gks.map((r) => S(r.id)) });
  }
}

// ---------------------------------------------------------------- telas
export function getTrainingOverview(db: SqlDb): TrainingOverviewDto {
  const st = getCareerState(db);
  const settings = trainingSettings(db);
  const focus = focusMap(db);
  const chosenGk = gkSessionMap(db);
  const gkCoach = staffName(db, 'goalkeeping'), fitness = staffName(db, 'fitness');
  const week = weekPlan(db);
  const injured = new Map(db.prepare('SELECT player_id, injury_until FROM player_status WHERE injury_until > ?').all(st.gameDate).map((r) => [S(r.player_id), S(r.injury_until)]));
  // próximos 7 dias (a partir de amanhã: o treino de hoje já foi feito), com a sessão efetiva já ajustada aos jogos
  const games = new Map(db.prepare(`SELECT f.match_date, f.home_club_id, h.name AS hn, a.name AS an FROM fixtures f JOIN clubs h ON h.id = f.home_club_id JOIN clubs a ON a.id = f.away_club_id
    WHERE f.match_date >= ? AND f.match_date <= ? AND (f.home_club_id = ? OR f.away_club_id = ?)`).all(st.gameDate, addDays(st.gameDate, 8), st.clubId, st.clubId)
    .map((r) => [S(r.match_date), { home: S(r.home_club_id) === st.clubId, opponent: S(r.home_club_id) === st.clubId ? S(r.an) : S(r.hn) }]));
  const I = INTENSITY[settings.intensity];
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(st.gameDate, i + 1), dow = weekday(date);
    const m = { today: games.has(date), yesterday: games.has(addDays(date, -1)), tomorrow: games.has(addDays(date, 1)) };
    const session = sessionFor(week[dow]!, m, settings.autoAdjust);
    const g = games.get(date);
    return { date, dow, planned: week[dow]!, session, opponent: g?.opponent ?? null, home: g ? g.home : null, load: Math.round(sessionLoad(session, I.load) * 10) / 10 };
  });
  const start = new Map(db.prepare('SELECT player_id, attrs_json FROM gk_month_start').all().map((r) => [S(r.player_id), JSON.parse(S(r.attrs_json)) as Record<string, number>]));
  const rate = sharpRateOf(db, st.clubId);
  const players = db.prepare('SELECT * FROM players WHERE club_id = ? ORDER BY position, overall DESC').all(st.clubId).map((r) => {
    const p = rowToPlayer(r);
    const age = ageOn(p.birthDate, st.gameDate);
    const gk = p.position === 'GK';
    const gkAttrs = gk && p.attributes.goalkeeper ? { ...p.attributes.goalkeeper } as unknown as Record<string, number> : null;
    const ref = start.get(p.id);
    return {
      id: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position, age, overall: p.overall, potentialEstimated: Math.max(p.overall, p.potentialEstimated),
      condition: Math.round(p.condition), sharpness: Math.round(effSharp(r, st.gameDate, rate)), acuteLoad: effAcute(r, st.gameDate),
      focus: settings.delegated ? bestFocus(p.position, p.attributes, age) : focus.get(p.id) ?? 'balanced', suggestedFocus: bestFocus(p.position, p.attributes, age),
      gkSession: gk ? chosenGk.get(p.id) ?? null : null, suggestedGkSession: gk ? bestGkSession(p.attributes) : null,
      gkAttributes: gkAttrs, gkMonthChange: gkAttrs && ref ? Object.fromEntries(Object.keys(gkAttrs).map((k) => [k, (gkAttrs[k] ?? 0) - (ref[k] ?? gkAttrs[k] ?? 0)])) : null,
      seasonChange: p.overall - N(r.season_start_overall ?? p.overall), injuredUntil: injured.get(p.id) ?? null,
    };
  });
  return {
    intensity: settings.intensity, delegated: settings.delegated, hasFitnessCoach: !!fitness, fitnessCoach: fitness?.name ?? null,
    gkCoach, gkFactor: Math.round(gkCoachFactor(staffQuality(db, st.clubId, 'goalkeeping')) * 100) / 100,
    focuses: FOCUSES, players, intensityEffects: INTENSITY, template: settings.template, autoAdjust: settings.autoAdjust,
    templates: TEMPLATE_IDS.map((id) => ({ id, label: TEMPLATES[id].label })),
    sessions: PLAN_SESSIONS.map((id) => ({ id, label: SESSION_LABEL[id], load: SESSION[id].load, rate: SESSION[id].rate, growth: SESSION[id].growth, sharp: SESSION[id].sharp, role: SESSION[id].role })),
    gkSessions: GK_SESSIONS.map((id) => ({ id, label: GK_SESSION_LABEL[id], keys: [...GK_SESSION_KEYS[id]] })),
    week: days, weekLoad: Math.round(days.reduce((s, d) => s + d.load, 0) * 10) / 10,
  };
}

/** Motivos de risco de um jogador (aba "Em risco" do departamento médico). */
export function riskReasons(cond: number, acute: number, sharp: number, age: number, recentGames: number): string[] {
  return [
    cond < 75 ? `condição ${Math.round(cond)}%` : '',
    acute > ACUTE_SAFE ? `carga alta (${acute.toFixed(0)}${recentGames >= 2 ? `, ${recentGames} jogos em 7 dias` : ''})` : '',
    sharp < 50 ? `sem ritmo de jogo (${Math.round(sharp)})` : '',
    age >= 32 && (cond < 85 || acute > ACUTE_SAFE - 5) ? `veterano (${age} anos)` : '',
  ].filter(Boolean);
}

export function getMedicalOverview(db: SqlDb): MedicalOverviewDto {
  const st = getCareerState(db);
  const doc = db.prepare("SELECT first_name, last_name, ability FROM staff WHERE role = 'doctor'").get();
  const f = facilitiesOf(db, st.clubId);
  const settings = trainingSettings(db);
  const intensity = settings.intensity;
  const fitnessQ = staffQuality(db, st.clubId, 'fitness');
  const fitness = staffName(db, 'fitness');
  const rate = sharpnessDecay(fitnessQ);
  // risco do próximo dia de treino: a sessão de amanhã (ajustada aos jogos)
  const tomorrow = addDays(st.gameDate, 1);
  const around = matchesAround(db, tomorrow).get(st.clubId) ?? NO_MATCH;
  const session = sessionFor(weekPlan(db)[weekday(tomorrow)]!, around, settings.autoAdjust);
  const injuryMul = SESSION[session].injury * INTENSITY[intensity].injury;
  const recent = new Map<string, number>();
  for (const r of db.prepare(`SELECT m.report_json FROM matches m JOIN fixtures fx ON fx.id = m.fixture_id WHERE fx.match_date > ? AND fx.match_date <= ? AND (fx.home_club_id = ? OR fx.away_club_id = ?)`)
    .all(addDays(st.gameDate, -7), st.gameDate, st.clubId, st.clubId)) {
    for (const p of (JSON.parse(S(r.report_json)) as { players?: Array<{ id: string; minutes?: number }> }).players ?? []) if ((p.minutes ?? 0) > 0) recent.set(p.id, (recent.get(p.id) ?? 0) + 1);
  }
  const rows = db.prepare(`SELECT p.id, p.first_name, p.last_name, p.position, p.birth_date, p.condition_pct, p.acute_load, p.acute_on, p.sharpness, p.sharp_on, p.last_played, s.injury_until, s.injury_note FROM players p
    LEFT JOIN player_status s ON s.player_id = p.id WHERE p.club_id = ? ORDER BY p.condition_pct`).all(st.clubId);
  const days = (until: string) => Math.max(0, Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${st.gameDate}T00:00:00Z`)) / 86_400_000));
  const isHurt = (r: Record<string, unknown>) => r.injury_until != null && S(r.injury_until) > st.gameDate;
  const atRisk = rows.filter((r) => !isHurt(r)).map((r) => {
    const cond = N(r.condition_pct), acute = effAcute(r, st.gameDate), sharp = effSharp(r, st.gameDate, rate), age = ageOn(S(r.birth_date), st.gameDate);
    const reasons = riskReasons(cond, acute, sharp, age, recent.get(S(r.id)) ?? 0);
    const advice = !fitness || !reasons.length ? null
      : cond < 75 || acute > ACUTE_SAFE + 5 ? `${fitness.name}: poupar no próximo jogo e fazer recuperação.`
      : sharp < 50 ? `${fitness.name}: dar minutos em jogo para recuperar o ritmo, sem forçar.`
      : `${fitness.name}: controlar a carga nesta semana.`;
    return {
      id: S(r.id), name: `${S(r.first_name)} ${S(r.last_name)}`, position: S(r.position) as never, condition: Math.round(cond), sharpness: Math.round(sharp), acuteLoad: Math.round(acute * 10) / 10,
      dailyRisk: Math.round(trainingInjuryChance(cond, injuryMul, fitnessQ, acute) * 100000) / 1000, reasons, advice,
    };
  }).filter((r) => r.reasons.length).sort((a, b) => b.dailyRisk - a.dailyRisk || a.condition - b.condition);
  return {
    doctor: doc ? { name: `${S(doc.first_name)} ${S(doc.last_name)}`, ability: N(doc.ability) } : null, medicalLevel: f.medical,
    recoveryFactor: Math.round(medicalFactor(db, st.clubId) * 100) / 100, intensity, nextSession: SESSION_LABEL[session], fitnessCoach: fitness?.name ?? null,
    injured: rows.filter(isHurt).map((r) => ({
      id: S(r.id), name: `${S(r.first_name)} ${S(r.last_name)}`, position: S(r.position) as never, until: S(r.injury_until), daysLeft: days(S(r.injury_until)), note: r.injury_note == null ? 'Lesão' : S(r.injury_note),
    })).sort((a, b) => a.daysLeft - b.daysLeft),
    atRisk,
  };
}


/**
 * Evolução ANUAL dos jogadores de países com simulação simplificada (eles não passam pela evolução mensal nem jogam partidas detalhadas).
 * Chamada na virada. Minutos estimados pela posição no elenco: os 11 melhores como titulares, os 7 seguintes como reservas.
 * NÃO abre transação.
 */
export function developLightPlayers(db: SqlDb, date: string, onlyClubs?: ReadonlySet<string>): number {
  const seed = seedOf(db);
  const economy = new Map(db.prepare('SELECT code, economy FROM countries').all().map((r) => [S(r.code), N(r.economy)]));
  const up = db.prepare('UPDATE players SET attributes_json = ?, overall = ?, potential_hidden = ?, potential_estimated = ?, market_value = ? WHERE id = ?');
  let n = 0;
  for (const clubId of lightClubIds(db)) {
    if (onlyClubs && !onlyClubs.has(clubId)) continue;
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
