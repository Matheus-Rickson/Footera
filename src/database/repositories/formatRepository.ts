/**
 * Campeonatos em fases no banco (Fase 9 — Séries C e D reais; depois os estaduais). Regras puras em game/format-engine; aqui: criar a
 * competição, montar cada fase quando os participantes ficam definidos (com datas), ler o estado a partir das partidas, desempate do jogo
 * decisivo do mata-mata e registro dos pênaltis. Classificação sempre derivada das partidas (regra 4). NÃO abre transação.
 */
import type { SqlDb } from '../types.ts';
import { createRng } from '../../game/rng.ts';
import { addDays, nextWeekdayOnOrAfter } from '../../shared/date.ts';
import {
  buildableStages, buildStage, deciderFor, finalRanking, leagueDeciderFor, formatComplete, outcomes, stageEntrants, stageOf, stageTables, tieOutcome,
  type FormatDef, type FormatState, type FxResult, type StageState,
} from '../../game/format-engine/engine.ts';
import { COPA_DO_BRASIL_SPOTS, COPA_ESTADUAL_NOMES, COPA_RUSSIA_ID, COPA_RUSSIA_RPL, copaDaRussia, copaDaRussiaDates, COPA_ESTADUAL_SIZE, copaEstadual, copaEstadualPrize, ESTADUAIS, formatById, REGIONAIS, regionalGroups, SERIE_D_SPOTS } from '../../game/format-engine/formats.ts';
import type { MatchDecider } from '../../game/match-engine/types.ts';
import { makePoster } from './financeRepository.ts';
import { addNews } from './newsRepository.ts';
import { getCareerState } from './careerRepository.ts';
import { UserError } from '../../shared/errors.ts';
import type { StagedViewDto } from '../../shared/api.ts';
import { brazilStageDates, estadualPool } from '../../game/career-engine/brazilCalendar.ts';

/** O país segue o calendário brasileiro do modelo 2026 (Brasil no ano civil). */
export function brazilCalendar(db: SqlDb, cs: { countryId: string }): boolean {
  const r = db.prepare('SELECT code, season_start FROM countries WHERE id = ?').get(cs.countryId);
  return !!r && S(r.code) === 'BRA' && S(r.season_start) === '01-01';
}

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const seedOf = (db: SqlDb) => S((db.prepare("SELECT value FROM meta WHERE key = 'world_seed'").get() ?? { value: 'sem-semente' }).value);

/** O que a competição grava: formato, participantes na ordem de semente, data mínima da 1ª fase e dia da semana dos jogos. */
export interface FormatMeta { formatId: string; seeds: string[]; start: string; weekday: number; intervalDays: number }

/** Jogos da tabela de liga de uma competição: os de pontos corridos e, num campeonato em fases, só os da 1ª fase. */
export const LEAGUE_TABLE_FIXTURES = "(f.stage IS NULL OR f.stage = 'f1')";

export function formatMetaOf(db: SqlDb, compId: string): FormatMeta | null {
  const r = db.prepare("SELECT format_json FROM competitions WHERE id = ? AND kind IN ('league', 'state') AND format_json IS NOT NULL").get(compId);
  return r ? (JSON.parse(S(r.format_json)) as FormatMeta) : null;
}

/** Formato e estado atual (fases montadas e resultados das partidas disputadas). */
export function formatStateOf(db: SqlDb, compId: string): { def: FormatDef; meta: FormatMeta; state: FormatState } | null {
  const meta = formatMetaOf(db, compId);
  if (!meta) return null;
  const def = formatById(meta.formatId, meta.seeds.length, N(db.prepare('SELECT season FROM competitions WHERE id = ?').get(compId)!.season));
  if (!def) return null;
  const state: FormatState = { seeds: meta.seeds, stages: {} };
  for (const r of db.prepare('SELECT stage_id, groups_json, ties_json, expected FROM competition_stages WHERE competition_id = ?').all(compId)) {
    state.stages[S(r.stage_id)] = {
      ...(r.groups_json ? { groups: JSON.parse(S(r.groups_json)) as string[][] } : {}),
      ...(r.ties_json ? { ties: JSON.parse(S(r.ties_json)) as StageState['ties'] } : {}),
      results: [], expected: N(r.expected),
    };
  }
  for (const f of db.prepare("SELECT stage, stage_tie, leg, home_club_id, away_club_id, home_goals, away_goals, pens_winner FROM fixtures WHERE competition_id = ? AND status = 'played' AND stage IS NOT NULL ORDER BY match_date, id").all(compId)) {
    const st = state.stages[S(f.stage)];
    if (!st) continue;
    const r: FxResult = { home: S(f.home_club_id), away: S(f.away_club_id), homeGoals: N(f.home_goals), awayGoals: N(f.away_goals) };
    if (f.stage_tie != null) { r.tie = N(f.stage_tie); r.leg = (f.leg == null ? 1 : N(f.leg)) as 1 | 2; }
    if (f.pens_winner != null) r.pens = S(f.pens_winner);
    st.results.push(r);
  }
  return { def, meta, state };
}

/** Monta as fases prontas (participantes definidos), com jogos a partir de `notBefore`. Devolve quantas fases montou. */
function buildPending(db: SqlDb, compId: string, notBefore: string): number {
  let built = 0;
  for (let guard = 0; guard < 20; guard++) {
    const fs = formatStateOf(db, compId);
    if (!fs) return built;
    const ready = buildableStages(fs.def, fs.state);
    if (!ready.length) return built;
    for (const id of ready) {
      const stage = stageOf(fs.def, id);
      let preset: string[][] | undefined;
      if (stage.kind === 'league' && stage.assign === 'preset') {
        const entrants = stageEntrants(fs.def, fs.state, id)!;
        const stateOf = new Map(db.prepare(`SELECT id, state FROM clubs WHERE id IN (${entrants.map(() => '?').join(',')})`).all(...entrants).map((r) => [S(r.id), r.state == null ? null : S(r.state)]));
        preset = regionalGroups(entrants.map((c) => ({ id: c, state: stateOf.get(c) ?? null })), stage.groups);
      }
      const b = buildStage(fs.def, fs.state, id, createRng(`format:${seedOf(db)}:${compId}:${id}`), preset);
      db.prepare('INSERT INTO competition_stages (competition_id, stage_id, groups_json, ties_json, expected) VALUES (?,?,?,?,?)')
        .run(compId, id, b.stage.groups ? JSON.stringify(b.stage.groups) : null, b.stage.ties ? JSON.stringify(b.stage.ties) : null, b.stage.expected);
      // rodadas continuam a numeração da competição (um clube não tem dois jogos na mesma rodada); um jogo por semana no dia do calendário
      const offset = N(db.prepare('SELECT COALESCE(MAX(round), 0) AS n FROM fixtures WHERE competition_id = ?').get(compId)!.n);
      const first = nextWeekdayOnOrAfter(notBefore, fs.meta.weekday);
      // Brasil no ano civil: datas do modelo 2026 (Série D pela tabela básica; Série C pelas datas-âncora), se ainda não passaram
      const comp = db.prepare('SELECT season, country_id, kind FROM competitions WHERE id = ?').get(compId)!;
      const rounds = Math.max(...b.fixtures.map((f) => f.round));
      let planned = brazilCalendar(db, { countryId: S(comp.country_id) }) ? brazilStageDates(fs.meta.formatId, id, N(comp.season), rounds, fs.def.size) : null;
      if (fs.meta.formatId === COPA_RUSSIA_ID) planned = copaDaRussiaDates(N(comp.season), id);
      else if (S(comp.kind) === 'state') { // estadual ou regional: as próximas datas da lista a partir do dia mínimo
        const pool = fs.meta.formatId.startsWith('reg_') ? regionalPool(db, S(comp.country_id), N(comp.season)) : estadualPool(N(comp.season), fs.meta.formatId), i = pool.findIndex((d) => d >= notBefore);
        planned = i >= 0 && i + rounds <= pool.length ? pool.slice(i, i + rounds) : null;
      }
      const dateOf = (r: number) => (planned && planned[0]! >= notBefore ? planned[r - 1]! : addDays(first, (r - 1) * fs.meta.intervalDays));
      const ins = db.prepare('INSERT INTO fixtures (id, competition_id, round, match_date, home_club_id, away_club_id, stage, stage_tie, leg, neutral) VALUES (?,?,?,?,?,?,?,?,?,?)');
      const perRound = new Map<number, number>();
      for (const f of b.fixtures) {
        const idx = (perRound.get(f.round) ?? 0) + 1;
        perRound.set(f.round, idx);
        ins.run(`${compId}_${id}_r${String(f.round).padStart(2, '0')}_m${idx}`, compId, offset + f.round, dateOf(f.round),
          f.home, f.away, id, f.tie ?? null, f.tie !== undefined ? (f.leg ?? 1) : null, f.neutral ? 1 : 0);
      }
      built++;
    }
  }
  return built;
}

/**
 * Cria um campeonato em fases (a 1ª fase já com os jogos): divisão nacional (`leagueId`) ou estadual (`leagueId` null, tipo 'state').
 * `seeds`: participantes do mais forte ao mais fraco.
 */
export function createFormatCompetition(db: SqlDb, c: { compId: string; leagueId: string | null; countryId: string; season: number; name: string; def: FormatDef; seeds: string[]; start: string; weekday: number; intervalDays: number }): void {
  if (c.seeds.length !== c.def.size) throw new Error(`${c.def.name}: ${c.seeds.length} clubes para um formato de ${c.def.size}.`);
  const meta: FormatMeta = { formatId: c.def.id, seeds: c.seeds, start: c.start, weekday: c.weekday, intervalDays: c.intervalDays };
  db.prepare('INSERT INTO competitions (id, kind, league_id, country_id, season, name, format_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(c.compId, c.leagueId ? 'league' : 'state', c.leagueId, c.countryId, c.season, c.name, JSON.stringify(meta));
  buildPending(db, c.compId, c.start);
}

/** Depois de uma rodada: monta as fases que ficaram definidas (jogos a partir de 4 dias depois) e encerra os campeonatos concluídos. */
export function advanceFormats(db: SqlDb, date: string): void {
  for (const r of db.prepare("SELECT id FROM competitions WHERE kind IN ('league', 'state') AND format_json IS NOT NULL AND status <> 'finished'").all()) {
    const id = S(r.id);
    const fs = formatStateOf(db, id);
    if (!fs) continue;
    if (formatComplete(fs.def, fs.state)) { db.prepare("UPDATE competitions SET status = 'finished' WHERE id = ?").run(id); finishEstadual(db, id, fs, date); continue; }
    if (buildableStages(fs.def, fs.state).length) buildPending(db, id, addDays(date, 4));
  }
}

/** Regra do jogo de mata-mata de um campeonato em fases: desempate no jogo decisivo (null = pontos corridos ou jogo de ida). */
export function formatFixtureRule(db: SqlDb, fixtureId: string): { decider: MatchDecider | undefined; neutral: boolean; stageName: string; leg: 1 | 2 | null } | null {
  const f = db.prepare('SELECT competition_id, stage, stage_tie, leg, neutral FROM fixtures WHERE id = ? AND stage IS NOT NULL').get(fixtureId);
  if (!f) return null;
  const meta = f.stage_tie == null ? formatMetaOf(db, S(f.competition_id)) : null;
  if (f.stage_tie == null && meta?.formatId !== COPA_RUSSIA_ID) return null; // pontos corridos: só a fase de grupos da Copa da Rússia tem pênaltis
  const fs = formatStateOf(db, S(f.competition_id));
  if (!fs) return null;
  if (f.stage_tie == null) {
    const d = leagueDeciderFor(fs.def, S(f.stage));
    return d ? { decider: d, neutral: false, stageName: stageOf(fs.def, S(f.stage)).name, leg: null } : null;
  }
  const leg = (f.leg == null ? 1 : N(f.leg)) as 1 | 2;
  const d = deciderFor(fs.def, fs.state, S(f.stage), N(f.stage_tie), leg);
  return { decider: d ?? undefined, neutral: N(f.neutral) === 1, stageName: stageOf(fs.def, S(f.stage)).name, leg: f.leg == null ? null : leg };
}

/** Registra quem venceu nos pênaltis o jogo decisivo do confronto. */
export function recordFormatShootout(db: SqlDb, fixtureId: string, r: { winner: 0 | 1 | null; decidedIn: string }): void {
  if (r.decidedIn !== 'penalties' || r.winner === null) return;
  const f = db.prepare('SELECT home_club_id, away_club_id FROM fixtures WHERE id = ?').get(fixtureId)!;
  db.prepare('UPDATE fixtures SET pens_winner = ? WHERE id = ?').run(r.winner === 0 ? S(f.home_club_id) : S(f.away_club_id), fixtureId);
}

/** Desfecho de um campeonato em fases (classificação final, campeão, títulos, acessos e rebaixamentos), ou null se não tem formato. */
export function formatOutcomesOf(db: SqlDb, compId: string): { ranking: string[]; champion: string | null; promoted: string[]; relegated: string[]; titles: Array<{ name: string; club: string | null }>; complete: boolean } | null {
  const fs = formatStateOf(db, compId);
  if (!fs) return null;
  return { ranking: finalRanking(fs.def, fs.state), ...outcomes(fs.def, fs.state), complete: formatComplete(fs.def, fs.state) };
}

/**
 * Série D da temporada seguinte (REC Série D 2026, art. 2º), com o tamanho do formato (96): (1) os rebaixados da Série C; (2) as vagas de
 * cada estado (`SERIE_D_SPOTS`): os mais bem colocados na elite do estadual da temporada que não estão nas Séries A–C (sem estadual
 * concluído: a divisão estadual e a reputação — ADAPT); (3) até 28 clubes da Série D que terminaram entre o 5º e o 32º lugar; (4) o restante: a Série D anterior pela
 * classificação e depois os sem divisão pela reputação. Quem fica de fora vai para a divisão sem jogos ("Sem divisão"). NÃO abre transação.
 */
export function rebuildSerieD(db: SqlDb, countryId: string, dLeague: string, ranking: readonly string[], promoted: ReadonlySet<string>, relegatedFromC: readonly string[]): void {
  const none = db.prepare('SELECT id FROM leagues WHERE country_id = ? AND active = 0 ORDER BY tier LIMIT 1').get(countryId);
  if (!none) return; // sem a divisão "Sem divisão", a Série D continua com os mesmos clubes
  const size = 96;
  const dTier = N(db.prepare('SELECT tier FROM leagues WHERE id = ?').get(dLeague)!.tier);
  const national = new Set(db.prepare('SELECT c.id FROM clubs c JOIN leagues l ON l.id = c.league_id WHERE c.country_id = ? AND l.active = 1 AND l.tier < ?').all(countryId, dTier).map((r) => S(r.id)));
  const next: string[] = [];
  const add = (id: string) => { if (next.length < size && !national.has(id) && !next.includes(id)) next.push(id); };
  for (const id of relegatedFromC) add(id);
  const clubs = db.prepare('SELECT id, state, state_division, reputation FROM clubs WHERE country_id = ? ORDER BY id').all(countryId);
  const season = N(db.prepare("SELECT c.season FROM competitions c WHERE c.league_id = ? ORDER BY c.season DESC LIMIT 1").get(dLeague)?.season ?? 0);
  for (const [uf, spots] of Object.entries(SERIE_D_SPOTS)) {
    // pela classificação final da elite do estadual da temporada; sem estadual concluído, pela divisão estadual e reputação (ADAPT)
    const elite = ESTADUAIS.find((e) => e.uf === uf && e.division === 1);
    const est = elite ? formatOutcomesOf(db, `est_${elite.id}_${season}`) : null;
    const rank = new Map((est?.complete ? est.ranking : []).map((id, i) => [id, i]));
    const cand = clubs.filter((c) => S(c.state ?? '') === uf && !national.has(S(c.id)))
      .sort((a, b) => (rank.get(S(a.id)) ?? 999) - (rank.get(S(b.id)) ?? 999)
        || (a.state_division == null ? 9 : N(a.state_division)) - (b.state_division == null ? 9 : N(b.state_division)) || N(b.reputation) - N(a.reputation) || S(a.id).localeCompare(S(b.id)));
    // ES e SE: a última vaga é do campeão da copa estadual da temporada (se não estiver nas Séries A–C nem já classificado)
    const copa = copaEstadualPrize(uf) === 'serie-d' ? copaEstadualChampion(db, uf, season) : null;
    const viaCopa = copa && !national.has(copa) && !next.includes(copa) ? copa : null;
    let taken = 0;
    for (const c of cand) { if (taken >= spots - (viaCopa ? 1 : 0)) break; if (!next.includes(S(c.id)) && S(c.id) !== viaCopa) { add(S(c.id)); taken++; } }
    if (viaCopa) add(viaCopa);
  }
  let fromD = 0;
  for (const id of ranking.slice(4, 32)) { if (fromD >= 28) break; if (!promoted.has(id) && !next.includes(id)) { add(id); fromD++; } }
  for (const id of ranking) if (!promoted.has(id)) add(id);
  for (const c of [...clubs].sort((a, b) => N(b.reputation) - N(a.reputation) || S(a.id).localeCompare(S(b.id)))) add(S(c.id));
  const keep = new Set(next);
  const toNone = db.prepare('UPDATE clubs SET league_id = ? WHERE id = ?'), toD = db.prepare('UPDATE clubs SET league_id = ? WHERE id = ?');
  for (const r of db.prepare('SELECT id FROM clubs WHERE league_id = ?').all(dLeague)) if (!keep.has(S(r.id))) toNone.run(S(none.id), S(r.id));
  for (const id of next) toD.run(dLeague, id);
}

/**
 * Estaduais da temporada de um país com estados (Brasil): um por estado e divisão (`ESTADUAIS`), com os clubes de `clubs.state` e
 * `clubs.state_division`, do mais forte (série nacional, reputação) ao mais fraco. Um estadual sem o número de clubes do formato
 * (pacote que mudou os clubes) não é disputado. Devolve quantos criou. NÃO abre transação.
 */
export function createEstaduais(db: SqlDb, countryId: string, season: number): number {
  const co = db.prepare('SELECT code, states_json FROM countries WHERE id = ?').get(countryId);
  if (!co || co.states_json == null || S(co.code) !== 'BRA') return 0;
  let created = 0;
  for (const e of ESTADUAIS) {
    const compId = `est_${e.id}_${season}`;
    if (db.prepare('SELECT 1 AS x FROM competitions WHERE id = ?').get(compId)) continue;
    const def = e.format(season);
    const seeds = db.prepare(`SELECT c.id FROM clubs c JOIN leagues l ON l.id = c.league_id WHERE c.country_id = ? AND c.state = ? AND c.state_division = ?
      ORDER BY (l.active = 0), l.tier, c.reputation DESC, c.id`).all(countryId, e.uf, e.division).map((r) => S(r.id));
    if (seeds.length !== def.size) continue;
    const pool = estadualPool(season, e.id);
    createFormatCompetition(db, { compId, leagueId: null, countryId, season, name: `${e.name} ${season}`, def, seeds, start: pool[0]!, weekday: 0, intervalDays: 7 });
    created++;
  }
  return created;
}

/**
 * Premiação dos estaduais, copas regionais e copas estaduais (ADAPT — sem tabela oficial no levantamento): campeão = economia × 400 mil,
 * vice = metade; segunda divisão (A2 de SP e RJ) × 0,5; copa estadual × 0,25; copa regional × 1,5; Copa da Rússia × 6 (economia × 2,4 mi,
 * o prêmio de campeão das outras copas nacionais). Em euros, pelo extrato (regra 1).
 */
export const ESTADUAL_PRIZE = { champion: 400_000, runnerUp: 200_000, secondDivision: 0.5, stateCup: 0.25, regional: 1.5, nationalCup: 6 } as const;

/** Estadual encerrado: troféu do campeão, premiação de campeão e vice e notícia para o clube do usuário. NÃO abre transação. */
function finishEstadual(db: SqlDb, compId: string, fs: NonNullable<ReturnType<typeof formatStateOf>>, date: string): void {
  const c = db.prepare("SELECT season, name, country_id FROM competitions WHERE id = ? AND kind = 'state'").get(compId);
  if (!c) return;
  const ranking = finalRanking(fs.def, fs.state), out = outcomes(fs.def, fs.state);
  const champ = out.champion;
  if (!champ) return;
  const user = getCareerState(db).clubId;
  db.prepare('INSERT INTO trophies (season, club_id, competition_id, won_by_user) VALUES (?,?,?,?)').run(N(c.season), champ, compId, champ === user ? 1 : 0);
  const economy = N(db.prepare('SELECT economy FROM countries WHERE id = ?').get(S(c.country_id))!.economy);
  const div = fs.meta.formatId === COPA_RUSSIA_ID ? ESTADUAL_PRIZE.nationalCup : fs.meta.formatId.startsWith('cest_') ? ESTADUAL_PRIZE.stateCup : fs.meta.formatId.startsWith('reg_') ? ESTADUAL_PRIZE.regional
    : ESTADUAIS.find((e) => e.id === fs.meta.formatId)?.division === 2 ? ESTADUAL_PRIZE.secondDivision : 1;
  const post = makePoster(db, user);
  const name = S(c.name);
  post(champ, date, 'prize', Math.round((economy * ESTADUAL_PRIZE.champion * div) / 1000) * 1000, `Premiação: campeão — ${name}`);
  if (ranking[1]) post(ranking[1], date, 'prize', Math.round((economy * ESTADUAL_PRIZE.runnerUp * div) / 1000) * 1000, `Premiação: vice-campeão — ${name}`);
  if (!user) return;
  const pos = ranking.indexOf(user);
  if (pos < 0) return;
  const clubName = (id: string) => S(db.prepare('SELECT name FROM clubs WHERE id = ?').get(id)!.name);
  if (champ === user) addNews(db, date, 'trophy', `CAMPEÃO! ${clubName(user)} conquista o ${name}`, `Parabéns, professor! O ${clubName(user)} é campeão do ${name}.\n\nO troféu já está na Sala de troféus e a premiação foi creditada no caixa.`);
  else addNews(db, date, 'season', `${name}: ${pos + 1}º lugar`, `O ${name} terminou: ${clubName(user)} em ${pos + 1}º lugar. Campeão: ${clubName(champ)}.${out.relegated.includes(user) ? '\n\nO clube foi rebaixado no estadual e disputa a divisão de baixo no próximo ano.' : out.promoted.includes(user) ? '\n\nO clube conquistou o acesso à elite do estadual!' : ''}`);
}

/**
 * Virada dos estaduais (antes de criar os do ano seguinte): quem caiu desce uma divisão (da elite para a A2 em SP e RJ; senão, para a
 * reserva do estado), quem subiu da A2 vai para a elite; depois cada divisão é completada até o tamanho do formato do ano seguinte com os
 * melhores da divisão de baixo (A2 pela classificação; reserva pela reputação — a segunda divisão dos outros estados não é disputada:
 * ADAPT). NÃO abre transação.
 */
export function estadualTurnover(db: SqlDb, countryId: string, season: number): void {
  const co = db.prepare('SELECT code FROM countries WHERE id = ?').get(countryId);
  if (!co || S(co.code) !== 'BRA') return;
  const setDiv = db.prepare('UPDATE clubs SET state_division = ? WHERE id = ?');
  for (const uf of [...new Set(ESTADUAIS.map((e) => e.uf))]) {
    const divs = ESTADUAIS.filter((e) => e.uf === uf).sort((a, b) => a.division - b.division);
    const a2Rank: string[] = [];
    const leftDivision = new Map<number, Set<string>>(); // quem acabou de cair de cada divisão não volta para ela ao completar
    for (const e of divs) {
      const r = formatOutcomesOf(db, `est_${e.id}_${season}`);
      if (!r || !r.complete) continue;
      const below = divs.some((x) => x.division === e.division + 1) ? e.division + 1 : null;
      for (const id of r.relegated) setDiv.run(below, id);
      leftDivision.set(e.division, new Set(r.relegated));
      if (e.division === 2) { for (const id of r.promoted) setDiv.run(1, id); a2Rank.push(...r.ranking); }
    }
    for (const e of divs) {
      const size = e.format(season + 1).size;
      const members = db.prepare('SELECT id FROM clubs WHERE country_id = ? AND state = ? AND state_division = ?').all(countryId, uf, e.division).map((r) => S(r.id));
      if (members.length >= size) continue;
      const pool = e.division === 1 && divs.some((x) => x.division === 2)
        ? a2Rank.filter((id) => db.prepare('SELECT state_division AS d FROM clubs WHERE id = ?').get(id)!.d === 2)
        : [];
      const reserve = db.prepare('SELECT id FROM clubs WHERE country_id = ? AND state = ? AND state_division IS NULL ORDER BY reputation DESC, id').all(countryId, uf).map((r) => S(r.id));
      const out = leftDivision.get(e.division) ?? new Set<string>();
      for (const id of [...pool, ...reserve].filter((x) => !out.has(x)).slice(0, size - members.length)) setDiv.run(e.division, id);
    }
  }
}

/** Visão por fases de um campeonato (tela de Competições): tabelas dos grupos e confrontos com os jogos, o agregado e o vencedor. */
export function getStagedView(db: SqlDb, compId: string): StagedViewDto {
  const fs = formatStateOf(db, compId);
  const c = db.prepare('SELECT name, kind, status FROM competitions WHERE id = ?').get(compId);
  if (!fs || !c) throw new UserError('Competição não encontrada ou sem fases.');
  const user = getCareerState(db).clubId;
  const names = new Map<string, string>();
  const nameOf = (id: string) => { let n = names.get(id); if (n === undefined) { n = S(db.prepare('SELECT name FROM clubs WHERE id = ?').get(id)?.name ?? '?'); names.set(id, n); } return n; };
  const club = (id: string | null) => (id ? { id, name: nameOf(id) } : null);
  const out = outcomes(fs.def, fs.state);
  const fixtures = db.prepare(`SELECT f.id, f.stage, f.stage_tie, f.leg, f.match_date, f.home_club_id, f.home_goals, f.away_goals, f.status,
      EXISTS (SELECT 1 FROM matches m WHERE m.fixture_id = f.id) AS rep FROM fixtures f WHERE f.competition_id = ? AND f.stage_tie IS NOT NULL ORDER BY f.match_date, f.leg`).all(compId);
  const letter = (i: number) => String.fromCharCode(65 + i);
  return {
    id: compId, name: S(c.name), kind: S(c.kind) === 'state' ? 'state' : 'league', status: S(c.status) as StagedViewDto['status'], regulation: fs.def.regulation, source: { ...fs.def.source },
    champion: club(out.champion), titles: out.titles.map((t) => ({ name: t.name, club: club(t.club) })),
    promoted: out.promoted.map((id) => club(id)!), relegated: out.relegated.map((id) => club(id)!),
    stages: fs.def.stages.map((stage) => {
      const st = fs.state.stages[stage.id];
      const base = { id: stage.id, name: stage.name, kind: stage.kind, side: !!stage.side, built: !!st, legs: stage.kind === 'knockout' ? stage.legs : stage.legs };
      if (!st) return { ...base, groups: [], ties: [] };
      if (stage.kind === 'league') {
        const t = stageTables(fs.def, fs.state, stage.id);
        return { ...base, ties: [], groups: t.groups.map((g, i) => ({
          name: t.groups.length > 1 ? `Grupo ${letter(i)}` : stage.name,
          rows: g.map((r) => ({ position: r.position, clubId: r.teamId, clubName: nameOf(r.teamId), played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst, goalDiff: r.goalDiff, points: r.points, isUserClub: r.teamId === user })),
        })) };
      }
      return { ...base, groups: [], ties: (st.ties ?? []).map((tie, i) => {
        const games = fixtures.filter((f) => S(f.stage) === stage.id && N(f.stage_tie) === i);
        const played = games.filter((g) => S(g.status) === 'played');
        let ga = 0, gb = 0;
        for (const g of played) { if (S(g.home_club_id) === tie.a) { ga += N(g.home_goals); gb += N(g.away_goals); } else { ga += N(g.away_goals); gb += N(g.home_goals); } }
        const o = tieOutcome(fs.def, fs.state, stage.id, i);
        const pens = st.results.find((r) => r.tie === i && r.pens)?.pens ?? null;
        return {
          a: club(tie.a)!, b: club(tie.b)!, involvesUser: tie.a === user || tie.b === user,
          games: games.map((g) => ({ fixtureId: S(g.id), date: S(g.match_date), homeId: S(g.home_club_id), homeGoals: g.home_goals == null ? null : N(g.home_goals), awayGoals: g.away_goals == null ? null : N(g.away_goals), hasReport: N(g.rep) === 1 })),
          aggregate: played.length ? [ga, gb] as [number, number] : null, winner: o?.winner ?? null, pens,
        };
      }) };
    }),
  };
}

/** Resultado do clube no estadual (concluído) da temporada: posição final, título, acesso (A2) e rebaixamento; null se não disputou. */
export function estadualResultOf(db: SqlDb, clubId: string, season: number): { position: number; champion: boolean; promoted: boolean; relegated: boolean } | null {
  const c = db.prepare("SELECT id FROM competitions WHERE kind = 'state' AND id LIKE 'est\\_%' ESCAPE '\\' AND season = ? AND id IN (SELECT competition_id FROM fixtures WHERE home_club_id = ? OR away_club_id = ?) LIMIT 1").get(season, clubId, clubId);
  if (!c) return null;
  const o = formatOutcomesOf(db, S(c.id));
  if (!o || !o.complete) return null;
  return { position: o.ranking.indexOf(clubId) + 1, champion: o.champion === clubId, promoted: o.promoted.includes(clubId), relegated: o.relegated.includes(clubId) };
}

/**
 * Campeões do ano anterior que vão à 3ª fase da Copa do Brasil (critério 2), na ordem do regulamento: Séries C e D, Copa do Nordeste e Copa
 * Verde (2026); de 2027 em diante, Copa Norte e Copa Centro-Oeste no lugar da Copa Verde, mais a Copa Sul-Sudeste.
 */
function copaDoBrasilChampions(db: SqlDb, season: number): string[] {
  const p = season - 1;
  const champ = (id: string) => { const o = formatOutcomesOf(db, id); return o?.complete ? o.champion : null; };
  const title = (id: string, name: string) => { const o = formatOutcomesOf(db, id); return o?.complete ? o.titles.find((t) => t.name === name)?.club ?? null : null; };
  const list = season <= 2026
    ? [champ(`cmp_bra-3_${p}`), champ(`cmp_bra-4_${p}`), champ(`reg_ne_${p}`), champ(`reg_cv_${p}`)]
    : [champ(`cmp_bra-3_${p}`), champ(`cmp_bra-4_${p}`), champ(`reg_ne_${p}`), title(`reg_cv_${p}`, 'Copa Norte'), title(`reg_cv_${p}`, 'Copa Centro-Oeste'), champ(`reg_ss_${p}`)];
  return list.filter((c): c is string => !!c);
}

/**
 * Participantes da Copa do Brasil pelos critérios (REC 2026; docs/COPAS_REGIONAIS.md), como uma ordem de ranking para as faixas de entrada:
 * os 20 da Série A; os campeões do ano anterior (4 em 2026 — Série C, Série D, Copa do Nordeste, Copa Verde —, 6 a partir de 2027 com a
 * Copa Norte, a Copa Centro-Oeste e a Copa Sul-Sudeste); e as vagas de cada federação (`COPA_DO_BRASIL_SPOTS`) pela classificação da elite
 * do estadual do ano anterior. Sem histórico (primeira temporada), os campeões e as vagas saem do ranking do jogo. Clube já classificado
 * por outro critério cede a vaga ao próximo. Só para o Brasil com estados; senão null.
 */
export function copaDoBrasilOrder(db: SqlDb, countryId: string, season: number, ranked: ReadonlyArray<{ id: string; tier: number; rank: number }>): { ranked: Array<{ id: string; tier: number; rank: number }>; champions: number } | null {
  const co = db.prepare('SELECT code, states_json FROM countries WHERE id = ?').get(countryId);
  if (!co || S(co.code) !== 'BRA' || co.states_json == null) return null;
  const k = season >= 2027 ? 6 : 4;
  const rankOf = new Map(ranked.map((c) => [c.id, c.rank]));
  const taken = new Set<string>();
  const serieA = ranked.filter((c) => c.tier === 1).map((c) => c.id);
  serieA.forEach((id) => taken.add(id));
  const champions: string[] = [];
  for (const id of copaDoBrasilChampions(db, season)) if (!taken.has(id) && champions.length < k) { champions.push(id); taken.add(id); }
  const states = new Map(db.prepare('SELECT id, state, state_division FROM clubs WHERE country_id = ?').all(countryId).map((r) => [S(r.id), { uf: r.state == null ? null : S(r.state), div: r.state_division == null ? 9 : N(r.state_division) }]));
  const fed: string[] = [];
  for (const [uf, spots] of Object.entries(COPA_DO_BRASIL_SPOTS)) {
    const elite = ESTADUAIS.find((e) => e.uf === uf && e.division === 1);
    const prev = elite ? formatOutcomesOf(db, `est_${elite.id}_${season - 1}`) : null;
    const order = prev?.complete ? prev.ranking
      : ranked.filter((c) => states.get(c.id)?.uf === uf).sort((a, b) => states.get(a.id)!.div - states.get(b.id)!.div || a.rank - b.rank).map((c) => c.id);
    // a última vaga vai ao campeão da copa estadual do ano anterior (exceto ES e SE, cuja copa dá vaga na Série D), se ele ainda não tem vaga
    const copa = copaEstadualPrize(uf) === 'copa-do-brasil' ? copaEstadualChampion(db, uf, season - 1) : null;
    const viaCopa = copa && !taken.has(copa) ? copa : null;
    let n = 0;
    for (const id of order) { if (n >= spots - (viaCopa ? 1 : 0)) break; if (!taken.has(id) && id !== viaCopa) { fed.push(id); taken.add(id); n++; } }
    if (viaCopa) { fed.push(viaCopa); taken.add(viaCopa); }
  }
  // campeões que faltaram (primeira temporada ou campeão já classificado): os mais bem ranqueados ainda fora, depois das federações
  for (const c of ranked) { if (champions.length >= k) break; if (!taken.has(c.id)) { champions.push(c.id); taken.add(c.id); } }
  const byRank = (a: string, b: string) => (rankOf.get(a) ?? 1e9) - (rankOf.get(b) ?? 1e9);
  const order = [...serieA, ...champions, ...fed.sort(byRank), ...ranked.map((c) => c.id).filter((id) => !taken.has(id))];
  const tierOf = new Map(ranked.map((c) => [c.id, c.tier]));
  return { ranked: order.map((id, i) => ({ id, tier: tierOf.get(id) ?? 9, rank: i })), champions: k };
}

/**
 * Datas das copas regionais: quartas-feiras a partir de 15/04, sem as quartas já usadas pelas ligas do país (as regionais começam depois
 * dos estaduais mais longos; no real, 25/03 a 07/06 — ADAPT). Dez datas por copa; a lista traz folga.
 */
export function regionalPool(db: SqlDb, countryId: string, season: number): string[] {
  const used = new Set(db.prepare("SELECT DISTINCT f.match_date AS d FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE c.kind = 'league' AND c.season = ? AND c.country_id = ?").all(season, countryId).map((r) => S(r.d)));
  const out: string[] = [];
  for (let d = nextWeekdayOnOrAfter(`${season}-04-15`, 3); out.length < 20; d = addDays(d, 7)) if (![-1, 0, 1, 2].some((k) => used.has(addDays(d, k)))) out.push(d);
  return out;
}

/**
 * Clubes "em competições Conmebol", que não jogam as regionais (ADAPT: o jogo ainda não tem continentais): os da Série A que terminaram a
 * temporada anterior entre os 12 primeiros; na primeira temporada, os 12 de maior reputação da Série A.
 */
function conmebolClubs(db: SqlDb, countryId: string, season: number): Set<string> {
  const prev = db.prepare(`SELECT r.club_id FROM season_results r JOIN competitions c ON c.id = r.competition_id JOIN leagues l ON l.id = c.league_id
    WHERE c.country_id = ? AND l.tier = 1 AND l.active = 1 AND r.season = ? AND r.position <= 12`).all(countryId, season - 1).map((r) => S(r.club_id));
  if (prev.length) return new Set(prev);
  return new Set(db.prepare("SELECT c.id FROM clubs c JOIN leagues l ON l.id = c.league_id WHERE c.country_id = ? AND l.tier = 1 AND l.active = 1 ORDER BY c.reputation DESC, c.id LIMIT 12").all(countryId).map((r) => S(r.id)));
}

/** Classificação da elite do estadual do ano anterior (ou, sem ela, os clubes do estado pela divisão estadual, série e reputação). */
function estadualOrder(db: SqlDb, countryId: string, uf: string, season: number): string[] {
  const elite = ESTADUAIS.find((e) => e.uf === uf && e.division === 1);
  const prev = elite ? formatOutcomesOf(db, `est_${elite.id}_${season - 1}`) : null;
  if (prev?.complete) return prev.ranking;
  return db.prepare(`SELECT c.id FROM clubs c JOIN leagues l ON l.id = c.league_id WHERE c.country_id = ? AND c.state = ?
    ORDER BY COALESCE(c.state_division, 9), (l.active = 0), l.tier, c.reputation DESC, c.id`).all(countryId, uf).map((r) => S(r.id));
}

/**
 * Copas regionais da temporada (Copa do Nordeste, Copa Verde, Copa Sul-Sudeste): vagas por estado pela classificação do estadual do ano
 * anterior, sem os clubes "em competições Conmebol". Copa Verde: os 12 da Copa Norte primeiro, divididos nos grupos A e B em serpentina,
 * depois os 12 da Copa Centro-Oeste (C e D). Devolve quantas criou. NÃO abre transação.
 */
export function createRegionais(db: SqlDb, countryId: string, season: number): number {
  const co = db.prepare('SELECT code, states_json FROM countries WHERE id = ?').get(countryId);
  if (!co || S(co.code) !== 'BRA' || co.states_json == null) return 0;
  const out = conmebolClubs(db, countryId, season);
  const rep = new Map(db.prepare('SELECT id, reputation FROM clubs WHERE country_id = ?').all(countryId).map((r) => [S(r.id), N(r.reputation)]));
  let created = 0;
  for (const r of REGIONAIS) {
    const compId = `${r.id}_${season}`;
    if (db.prepare('SELECT 1 AS x FROM competitions WHERE id = ?').get(compId)) continue;
    const def = r.format();
    const pick = (uf: string) => estadualOrder(db, countryId, uf, season).filter((id) => !out.has(id)).slice(0, r.spots[uf] ?? 0);
    const byRep = (a: string, b: string) => (rep.get(b) ?? 0) - (rep.get(a) ?? 0) || a.localeCompare(b);
    let seeds: string[];
    if (r.blocks) {
      seeds = [];
      for (const block of r.blocks) {
        const clubs = block.flatMap(pick).sort(byRep);
        const ga: string[] = [], gb: string[] = [];
        clubs.forEach((c, i) => ((i % 4 === 0 || i % 4 === 3) ? ga : gb).push(c));
        seeds.push(...ga, ...gb);
      }
    } else seeds = Object.keys(r.spots).flatMap(pick).sort(byRep);
    if (seeds.length !== def.size || new Set(seeds).size !== seeds.length) continue;
    const pool = regionalPool(db, countryId, season);
    createFormatCompetition(db, { compId, leagueId: null, countryId, season, name: `${r.name} ${season}`, def, seeds, start: pool[0]!, weekday: 3, intervalDays: 7 });
    created++;
  }
  return created;
}

/** Campeão da copa estadual do 2º semestre de um estado numa temporada (null se não houve ou não terminou). */
export function copaEstadualChampion(db: SqlDb, uf: string, season: number): string | null {
  const o = formatOutcomesOf(db, `cest_${uf.toLowerCase()}_${season}`);
  return o?.complete ? o.champion : null;
}

/**
 * Copas estaduais do 2º semestre (ADAPT, docs/COPAS_REGIONAIS.md): em cada estado, os clubes sem divisão nacional (inclusive a reserva),
 * do mais forte ao mais fraco, até 16 (número par a partir de 9); com menos de 4, não há copa. Domingos a partir de agosto.
 * Devolve quantas criou. NÃO abre transação.
 */
export function createCopasEstaduais(db: SqlDb, countryId: string, season: number): number {
  const co = db.prepare('SELECT code, states_json FROM countries WHERE id = ?').get(countryId);
  if (!co || S(co.code) !== 'BRA' || co.states_json == null) return 0;
  let created = 0;
  for (const st of JSON.parse(S(co.states_json)) as Array<{ code: string; name: string }>) {
    const compId = `cest_${st.code.toLowerCase()}_${season}`;
    if (db.prepare('SELECT 1 AS x FROM competitions WHERE id = ?').get(compId)) continue;
    let clubs = db.prepare(`SELECT c.id FROM clubs c JOIN leagues l ON l.id = c.league_id WHERE c.country_id = ? AND c.state = ? AND l.active = 0
      ORDER BY COALESCE(c.state_division, 9), c.reputation DESC, c.id`).all(countryId, st.code).map((r) => S(r.id)).slice(0, COPA_ESTADUAL_SIZE.max);
    if (clubs.length > 8 && clubs.length % 2 === 1) clubs = clubs.slice(0, -1);
    if (clubs.length < COPA_ESTADUAL_SIZE.min) continue;
    const def = copaEstadual(st.code, clubs.length), pool = estadualPool(season, def.id);
    createFormatCompetition(db, { compId, leagueId: null, countryId, season, name: `${COPA_ESTADUAL_NOMES[st.code] ?? `Copa ${st.name}`} ${season}`, def: { ...def, name: COPA_ESTADUAL_NOMES[st.code] ?? `Copa ${st.name}` }, seeds: clubs, start: pool[0]!, weekday: 0, intervalDays: 7 });
    created++;
  }
  return created;
}

/**
 * Copa da Rússia da temporada (docs/COPA_RUSSIA.md): os 16 da Premier Liga e os da Pervaya Liga, cada divisão pela posição na temporada
 * anterior (na primeira, pela reputação). Só se a Premier Liga tiver 16 clubes. Devolve se criou. NÃO abre transação.
 */
export function createCopaDaRussia(db: SqlDb, countryId: string, season: number): boolean {
  const co = db.prepare('SELECT code FROM countries WHERE id = ?').get(countryId);
  if (!co || S(co.code) !== 'RUS') return false;
  const compId = `${COPA_RUSSIA_ID}_${season}`;
  if (db.prepare('SELECT 1 AS x FROM competitions WHERE id = ?').get(compId)) return false;
  // posição anterior na mesma divisão; quem subiu vem depois dos que ficaram, quem caiu vem antes
  const prev = new Map(db.prepare(`SELECT r.club_id, r.position, l.tier FROM season_results r JOIN competitions c ON c.id = r.competition_id
      JOIN leagues l ON l.id = c.league_id WHERE r.season = ?`).all(season - 1).map((r) => [S(r.club_id), { pos: N(r.position), tier: N(r.tier) }]));
  const byTier = (tier: number) => db.prepare(`SELECT c.id FROM clubs c JOIN leagues l ON l.id = c.league_id
      WHERE c.country_id = ? AND l.active = 1 AND l.tier = ? ORDER BY c.reputation DESC, c.id`).all(countryId, tier)
    .map((r) => { const p = prev.get(S(r.id)); return { id: S(r.id), key: !p ? 5000 : p.tier === tier ? 1000 + p.pos : p.tier < tier ? p.pos : 3000 + p.pos }; })
    .sort((a, b) => a.key - b.key).map((c) => c.id);
  const rpl = byTier(1), fnl = byTier(2);
  if (rpl.length !== COPA_RUSSIA_RPL) return false;
  const def = copaDaRussia(rpl.length + fnl.length);
  if (!def) return false;
  createFormatCompetition(db, { compId, leagueId: null, countryId, season, name: `Copa da Rússia ${season}/${String(season + 1).slice(2)}`, def, seeds: [...rpl, ...fnl],
    start: copaDaRussiaDates(season, 'g')![0]!, weekday: 3, intervalDays: 7 });
  return true;
}
