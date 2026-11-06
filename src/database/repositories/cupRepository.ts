/**
 * Copas nacionais no save (Fase 9): criação a cada temporada, sorteio de cada fase quando a anterior termina, regra de desempate de cada
 * partida, cartões que valem só dentro da copa, premiação e título. Formatos em game/cup-engine/formats.ts; regras em docs/COPAS_NACIONAIS.md.
 *
 * Fluxo: `createCups` (junto com o calendário das ligas) cria a competição e sorteia a 1ª fase. Cada partida decisiva grava o vencedor do
 * confronto (`recordCupResult`, chamada pela rodada); no fim da rodada, `advanceCups` sorteia a fase seguinte (mesma transação) ou encerra a
 * copa (troféu, prêmios, notícia). Tudo determinístico pela semente do universo.
 */
import type { SqlDb } from '../types.ts';
import { createRng } from '../../game/rng.ts';
import { cupFormatFor, type CupFormat } from '../../game/cup-engine/formats.ts';
import { cupDates, cupPrizes, drawPairs, entryStages, hostOf, planByes, rankCupClubs, type CupClub, type CupPrizeTable } from '../../game/cup-engine/bracket.ts';
import type { MatchDecider } from '../../game/match-engine/types.ts';
import type { Poster } from './financeRepository.ts';
import type { CupBracketDto } from '../../shared/api.ts';
import { addNews } from './newsRepository.ts';
import { getCareerState } from './careerRepository.ts';

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const seedOf = (db: SqlDb) => S((db.prepare("SELECT value FROM meta WHERE key = 'world_seed'").get() ?? { value: 'sem-semente' }).value);

/** O que fica gravado na competição: a regra usada (versão do regulamento) e o plano calculado para esta edição. */
export interface CupState {
  format: CupFormat;
  byes: number[]; pools: number[]; declaredByes: boolean;
  dates: string[][];
  entry: Record<string, number>;
  clubs: CupClub[];
  prizes: CupPrizeTable;
}
export const cupStateOf = (db: SqlDb, competitionId: string): CupState =>
  JSON.parse(S(db.prepare("SELECT format_json FROM competitions WHERE id = ? AND kind = 'cup'").get(competitionId)!.format_json)) as CupState;

const roundOf = (state: CupState, stage: number, leg: number) => state.format.stages.slice(0, stage).reduce((s, st) => s + st.legs, 0) + leg;

/**
 * Cria as copas da temporada (uma por país com formato e clubes suficientes). Idempotente. NÃO abre transação.
 * `notBefore`: em saves antigos, só cria a copa se a 1ª fase ainda não passou.
 */
export function createCups(db: SqlDb, season: number, notBefore?: string): number {
  const seed = seedOf(db);
  let created = 0;
  for (const co of db.prepare('SELECT id, code, name, economy FROM countries ORDER BY rowid').all()) {
    const format = cupFormatFor(S(co.code));
    if (!format) continue;
    const compId = `cup_${S(co.id)}_${season}`;
    if (db.prepare('SELECT 1 AS x FROM competitions WHERE id = ?').get(compId)) continue;
    const prev = new Map(db.prepare('SELECT club_id, position FROM season_results WHERE season = ?').all(season - 1).map((r) => [S(r.club_id), N(r.position)]));
    const clubs = db.prepare('SELECT c.id, c.reputation, l.tier FROM clubs c JOIN leagues l ON l.id = c.league_id WHERE c.country_id = ? ORDER BY c.id').all(S(co.id))
      .map((r) => ({ id: S(r.id), tier: N(r.tier), reputation: N(r.reputation), prevPosition: prev.get(S(r.id)) ?? null }));
    const ranked = rankCupClubs(clubs);
    const entry = entryStages(format, ranked);
    const entrants = format.stages.map((_, i) => [...entry.values()].filter((s) => s === i).length);
    if (entry.size < 2) continue;
    let plan: ReturnType<typeof planByes>, dates: string[][];
    try {
      plan = planByes(format, entrants);
      const avoid = new Set(db.prepare(`SELECT DISTINCT f.match_date AS d FROM fixtures f JOIN competitions c ON c.id = f.competition_id
        WHERE c.season = ? AND c.kind = 'league' AND c.country_id = ?`).all(season, S(co.id)).map((r) => S(r.d)));
      dates = cupDates(format, season, avoid);
    } catch { continue; } // formato que não fecha com os clubes do universo (pacote): o país fica sem copa nesta temporada
    if (notBefore && dates[0]![0]! < notBefore) continue;
    if (plan.entryAll !== undefined) for (const id of entry.keys()) entry.set(id, plan.entryAll); // plano de reserva: todos estreiam juntos
    const topEntry = Math.min(...ranked.filter((c) => c.tier === 1).map((c) => entry.get(c.id) ?? 0));
    const state: CupState = {
      format, byes: plan.byes, pools: plan.pools, declaredByes: plan.declared, dates, entry: Object.fromEntries(entry),
      clubs: ranked.filter((c) => entry.has(c.id)), prizes: cupPrizes(format, N(co.economy), Number.isFinite(topEntry) ? topEntry : 0),
    };
    db.prepare("INSERT INTO competitions (id, kind, league_id, country_id, season, name, format_json) VALUES (?, 'cup', NULL, ?, ?, ?, ?)")
      .run(compId, S(co.id), season, `${format.name} ${season}/${String(season + 1).slice(2)}`, JSON.stringify(state));
    drawFrom(db, compId, 0, seed, null, '');
    created++;
  }
  return created;
}

/**
 * Sorteia a fase `stage` e, se ela não tiver jogos (fase sem clubes ainda, ou só folgas), resolve na hora e sorteia a seguinte, até a
 * primeira fase com partidas. `date`/`userClub`: avisa o usuário do sorteio (caixa de entrada).
 */
function drawFrom(db: SqlDb, compId: string, stage: number, seed: string, date: string | null, userClub: string): void {
  const state = cupStateOf(db, compId);
  for (let s = stage; s < state.format.stages.length; s++) {
    drawStage(db, compId, s, seed);
    const playable = N(db.prepare('SELECT COUNT(*) AS n FROM cup_ties WHERE competition_id = ? AND stage = ? AND club_b IS NOT NULL').get(compId, s)!.n) > 0;
    if (date) notifyDraw(db, compId, s, date, userClub);
    if (playable) return;
  }
}

/** Sorteia a fase `stage`: folgas para os mais bem classificados, confrontos e mandos pela regra, partidas nas datas do plano. */
function drawStage(db: SqlDb, compId: string, stage: number, seed: string): void {
  const state = cupStateOf(db, compId);
  const st = state.format.stages[stage]!;
  const byId = new Map(state.clubs.map((c) => [c.id, c]));
  const survivors = db.prepare('SELECT winner FROM cup_ties WHERE competition_id = ? AND stage = ? ORDER BY slot').all(compId, stage - 1).map((r) => byId.get(S(r.winner))!);
  const entrants = state.clubs.filter((c) => state.entry[c.id] === stage);
  const pool = [...survivors, ...entrants];
  const rng = createRng(`cup:${seed}:${compId}:${stage}`);
  const nByes = state.byes[stage] ?? 0;
  const byes = new Set([...pool].sort((a, b) => a.rank - b.rank).slice(0, nByes).map((c) => c.id));
  const playing = pool.filter((c) => !byes.has(c.id));
  const insTie = db.prepare('INSERT INTO cup_ties (id, competition_id, stage, slot, club_a, club_b, winner, decided_in) VALUES (?,?,?,?,?,?,?,?)');
  const insFix = db.prepare('INSERT INTO fixtures (id, competition_id, round, match_date, home_club_id, away_club_id, tie_id, leg, neutral) VALUES (?,?,?,?,?,?,?,?,?)');
  let slot = 0;
  // folgas primeiro, na ordem da chave (para a chave fixa, cada folga ocupa uma posição)
  for (const c of pool.filter((x) => byes.has(x.id))) insTie.run(`${compId}_s${stage}_t${slot}`, compId, stage, slot++, c.id, null, c.id, 'bye');
  const isFinal = stage === state.format.stages.length - 1;
  for (const [a, b] of drawPairs(rng, playing, st.draw)) {
    const h = hostOf(rng, a, b, isFinal ? 'neutral' : st.host);
    const tieId = `${compId}_s${stage}_t${slot}`;
    insTie.run(tieId, compId, stage, slot++, h.home.id, h.away.id, null, null);
    const dates = state.dates[stage]!;
    if (st.legs === 1) insFix.run(`${tieId}_l1`, compId, roundOf(state, stage, 1), dates[0], h.home.id, h.away.id, tieId, null, h.neutral ? 1 : 0);
    else { // ida na casa de quem não manda a volta
      insFix.run(`${tieId}_l1`, compId, roundOf(state, stage, 1), dates[0], h.away.id, h.home.id, tieId, 1, 0);
      insFix.run(`${tieId}_l2`, compId, roundOf(state, stage, 2), dates[1], h.home.id, h.away.id, tieId, 2, 0);
    }
  }
  db.prepare("UPDATE competitions SET status = CASE WHEN status = 'scheduled' AND ? > 0 THEN 'in_progress' ELSE status END WHERE id = ?").run(stage, compId);
}

/** Regra da partida de copa: desempate (com o jogo de ida no agregado) e campo neutro. null = não é partida de copa. */
export function cupFixtureRule(db: SqlDb, fixtureId: string): { decider: MatchDecider | undefined; neutral: boolean; competitionId: string; stage: number; stageName: string; leg: 1 | 2 | null; yellowLimit: number } | null {
  const f = db.prepare('SELECT competition_id, tie_id, leg, neutral, home_club_id FROM fixtures WHERE id = ? AND tie_id IS NOT NULL').get(fixtureId);
  if (!f) return null;
  const state = cupStateOf(db, S(f.competition_id));
  const stage = N(db.prepare('SELECT stage FROM cup_ties WHERE id = ?').get(S(f.tie_id))!.stage);
  const st = state.format.stages[stage]!;
  const base = { neutral: N(f.neutral) === 1, competitionId: S(f.competition_id), stage, stageName: st.name, leg: (f.leg == null ? null : N(f.leg)) as 1 | 2 | null, yellowLimit: state.format.discipline.yellowLimit };
  if (f.leg != null && N(f.leg) === 1) return { ...base, decider: undefined }; // ida: empate vale
  let firstLeg: [number, number] | undefined;
  if (f.leg != null && N(f.leg) === 2) {
    const ida = db.prepare("SELECT home_club_id, home_goals, away_goals FROM fixtures WHERE tie_id = ? AND leg = 1 AND status = 'played'").get(S(f.tie_id));
    if (!ida) throw new Error('Jogo de volta antes do jogo de ida.');
    // ponto de vista do mandante de hoje (que foi visitante na ida)
    firstLeg = S(ida.home_club_id) === S(f.home_club_id) ? [N(ida.home_goals), N(ida.away_goals)] : [N(ida.away_goals), N(ida.home_goals)];
  }
  return { ...base, decider: { ...st.decider, ...(firstLeg ? { firstLeg } : {}) } };
}

/**
 * Depois de uma partida de copa: cota de participação da fase (no jogo único ou na ida, para os dois clubes) e, na partida decisiva
 * (jogo único ou volta), o vencedor do confronto e os prêmios. NÃO abre transação.
 */
export function recordCupResult(db: SqlDb, fixtureId: string, r: { winner: 0 | 1 | null; decidedIn: 'regular' | 'extra_time' | 'penalties'; shootout: { home: number; away: number } | null }, post?: Poster): void {
  const f = db.prepare('SELECT tie_id, leg, home_club_id, away_club_id, match_date, competition_id FROM fixtures WHERE id = ? AND tie_id IS NOT NULL').get(fixtureId);
  if (!f) return;
  if (post && (f.leg == null || N(f.leg) === 1)) {
    const state = cupStateOf(db, S(f.competition_id));
    const stage = N(db.prepare('SELECT stage FROM cup_ties WHERE id = ?').get(S(f.tie_id))!.stage);
    const cota = state.prizes.perStage[stage] ?? 0;
    if (cota) for (const id of [S(f.home_club_id), S(f.away_club_id)]) post(id, S(f.match_date), 'prize', cota, `${state.format.name}: cota da ${state.format.stages[stage]!.name}`);
  }
  if (f.leg != null && N(f.leg) === 1) return;
  if (r.winner === null) throw new Error('Partida decisiva de copa terminou sem vencedor.');
  const winner = S(r.winner === 0 ? f.home_club_id : f.away_club_id), loser = S(r.winner === 0 ? f.away_club_id : f.home_club_id);
  const tie = db.prepare('SELECT competition_id, stage, club_a FROM cup_ties WHERE id = ?').get(S(f.tie_id))!;
  // pênaltis gravados do ponto de vista do confronto (club_a = quem manda o jogo único ou a volta)
  const aIsHome = S(tie.club_a) === S(f.home_club_id);
  db.prepare('UPDATE cup_ties SET winner = ?, decided_in = ?, shootout_a = ?, shootout_b = ? WHERE id = ?').run(
    winner, r.decidedIn, r.shootout ? (aIsHome ? r.shootout.home : r.shootout.away) : null, r.shootout ? (aIsHome ? r.shootout.away : r.shootout.home) : null, S(f.tie_id));
  const state = cupStateOf(db, S(tie.competition_id));
  const stage = N(tie.stage), n = state.format.stages.length, date = S(f.match_date);
  if (!post) return;
  const name = state.format.name;
  if (stage < n - 1 && state.prizes.win[stage]) post(winner, date, 'prize', state.prizes.win[stage]!, `${name}: vitória na ${state.format.stages[stage]!.name}`);
  if (stage === n - 2 && state.prizes.semiLoser) post(loser, date, 'prize', state.prizes.semiLoser, `${name}: semifinalista`);
  if (stage === n - 1) {
    post(winner, date, 'prize', state.prizes.winner, `${name}: campeão`);
    post(loser, date, 'prize', state.prizes.runnerUp, `${name}: vice-campeão`);
  }
}

/**
 * Depois da rodada: para cada copa cuja fase atual terminou, zera cartões se a regra mandar, sorteia a fase seguinte ou encerra a copa
 * (troféu e notícia). NÃO abre transação. Devolve as copas encerradas.
 */
export function advanceCups(db: SqlDb, date: string): string[] {
  const seed = seedOf(db);
  const st = getCareerState(db);
  const finished: string[] = [];
  for (const c of db.prepare("SELECT id, name, season FROM competitions WHERE kind = 'cup' AND status <> 'finished'").all()) {
    const compId = S(c.id);
    const state = cupStateOf(db, compId);
    const cur = db.prepare('SELECT MAX(stage) AS s FROM cup_ties WHERE competition_id = ? AND club_b IS NOT NULL').get(compId);
    if (cur?.s == null) continue;
    const stage = N(cur.s);
    if (N(db.prepare('SELECT COUNT(*) AS n FROM cup_ties WHERE competition_id = ? AND stage = ? AND winner IS NULL').get(compId, stage)!.n) > 0) continue;
    if (state.format.discipline.resetAfterStage === stage) db.prepare('UPDATE cup_discipline SET yellow_cards = 0 WHERE competition_id = ?').run(compId);
    if (stage < state.format.stages.length - 1) { drawFrom(db, compId, stage + 1, seed, date, st.clubId); continue; }
    const champ = S(db.prepare('SELECT winner FROM cup_ties WHERE competition_id = ? AND stage = ?').get(compId, stage)!.winner);
    db.prepare("UPDATE competitions SET status = 'finished' WHERE id = ?").run(compId);
    db.prepare('INSERT INTO trophies (season, club_id, competition_id, won_by_user) VALUES (?,?,?,?)').run(N(c.season), champ, compId, champ === st.clubId ? 1 : 0);
    if (champ === st.clubId) addNews(db, date, 'board', `Título: campeão da ${state.format.name}!`, `O clube conquistou a ${S(c.name)}. A diretoria parabeniza o elenco e a comissão técnica.\n\nO título vale vaga em: ${state.format.reward} (as competições continentais ainda não existem no jogo).`);
    finished.push(compId);
  }
  return finished;
}

/** Caixa de entrada: adversário sorteado para o clube do usuário. */
function notifyDraw(db: SqlDb, compId: string, stage: number, date: string, userClub: string): void {
  if (!userClub) return;
  const tie = db.prepare('SELECT id, club_a, club_b FROM cup_ties WHERE competition_id = ? AND stage = ? AND (club_a = ? OR club_b = ?)').get(compId, stage, userClub, userClub);
  if (!tie) return;
  const state = cupStateOf(db, compId);
  const st = state.format.stages[stage]!;
  if (tie.club_b == null) { addNews(db, date, 'squad', `${state.format.name}: folga na ${st.name}`, `Pelo regulamento, o clube avança direto da ${st.name} (folga para os mais bem classificados).`); return; }
  const opp = S(tie.club_a) === userClub ? S(tie.club_b) : S(tie.club_a);
  const oppName = S(db.prepare('SELECT name FROM clubs WHERE id = ?').get(opp)!.name);
  const games = db.prepare('SELECT match_date, home_club_id, neutral FROM fixtures WHERE tie_id = ? ORDER BY leg').all(S(tie.id));
  const where = (g: Record<string, unknown>) => (N(g.neutral) === 1 ? 'campo neutro' : S(g.home_club_id) === userClub ? 'em casa' : 'fora');
  const when = games.map((g) => `${S(g.match_date).split('-').reverse().join('/')} (${where(g)})`).join(' e ');
  addNews(db, date, 'squad', `${state.format.name}: ${st.name} contra o ${oppName}`, `Sorteio da ${st.name}: o adversário é o ${oppName}. ${games.length > 1 ? 'Jogos' : 'Jogo'}: ${when}.\n\n${st.legs === 2 ? 'Confronto de ida e volta: vale o agregado (sem gol fora de casa). ' : ''}${st.decider.extraTime ? 'Empate: prorrogação e, se preciso, pênaltis.' : 'Empate: pênaltis direto, sem prorrogação.'}`);
}

/** Cartões da copa (cada regulamento tem o seu limite; suspensões da copa valem só nela). NÃO abre transação. */
export function cupSuspensions(db: SqlDb, competitionId: string, clubId: string): Map<string, number> {
  return new Map(db.prepare('SELECT d.player_id, d.suspension_matches FROM cup_discipline d JOIN players p ON p.id = d.player_id WHERE d.competition_id = ? AND p.club_id = ? AND d.suspension_matches > 0')
    .all(competitionId, clubId).map((r) => [S(r.player_id), N(r.suspension_matches)]));
}
export function applyCupCards(db: SqlDb, competitionId: string, playerId: string, yellows: number, red: 0 | 1 | 2, served: boolean, limit: number): { suspension: number; byYellow: boolean } {
  const cur = db.prepare('SELECT yellow_cards, suspension_matches FROM cup_discipline WHERE competition_id = ? AND player_id = ?').get(competitionId, playerId);
  let y = N(cur?.yellow_cards ?? 0) + yellows, s = N(cur?.suspension_matches ?? 0);
  if (served) s = Math.max(0, s - 1);
  let byYellow = false;
  if (red) s += red;
  if (y >= limit) { s += 1; y -= limit; byYellow = true; }
  db.prepare(`INSERT INTO cup_discipline (competition_id, player_id, yellow_cards, suspension_matches) VALUES (?,?,?,?)
    ON CONFLICT(competition_id, player_id) DO UPDATE SET yellow_cards = excluded.yellow_cards, suspension_matches = excluded.suspension_matches`).run(competitionId, playerId, y, s);
  return { suspension: s, byYellow };
}
export function serveCupSuspension(db: SqlDb, competitionId: string, playerId: string): void {
  db.prepare('UPDATE cup_discipline SET suspension_matches = MAX(0, suspension_matches - 1) WHERE competition_id = ? AND player_id = ?').run(competitionId, playerId);
}

const DRAW_TEXT: Record<string, string> = { open: 'sorteio livre', seeded: 'cabeças de chave × demais', opposite: '1º × último, 2º × penúltimo…', bracket: 'chave fixa' };
const HOST_TEXT: Record<string, string> = { draw: 'mando do primeiro sorteado', lower: 'mando do clube de divisão inferior', lower2: 'mando do clube 2+ divisões abaixo', higher: 'mando do mais bem classificado', neutral: 'campo neutro' };

/** Chave de uma copa para a tela (fases, confrontos, regra de cada fase, origem das regras). */
export function getCupBracket(db: SqlDb, competitionId: string): CupBracketDto {
  const c = db.prepare("SELECT c.id, c.name, c.status, co.name AS country, co.code FROM competitions c JOIN countries co ON co.id = c.country_id WHERE c.id = ? AND c.kind = 'cup'").get(competitionId);
  if (!c) throw new Error('Copa não encontrada.');
  const st = getCareerState(db);
  const state = cupStateOf(db, competitionId);
  const names = new Map(db.prepare('SELECT id, name FROM clubs').all().map((r) => [S(r.id), S(r.name)]));
  const club = (id: string) => ({ id, name: names.get(id) ?? '?' });
  const n = state.format.stages.length;
  const stages: CupBracketDto['stages'] = state.format.stages.map((sd, i) => {
    const ties = db.prepare('SELECT * FROM cup_ties WHERE competition_id = ? AND stage = ? ORDER BY slot').all(competitionId, i).map((t) => {
      const games = db.prepare('SELECT f.id, f.match_date, f.home_club_id, f.home_goals, f.away_goals, f.neutral, EXISTS (SELECT 1 FROM matches m WHERE m.fixture_id = f.id) AS rep FROM fixtures f WHERE f.tie_id = ? ORDER BY f.leg').all(S(t.id))
        .map((g) => ({ fixtureId: S(g.id), date: S(g.match_date), homeId: S(g.home_club_id), homeGoals: g.home_goals == null ? null : N(g.home_goals), awayGoals: g.away_goals == null ? null : N(g.away_goals), neutral: N(g.neutral) === 1, hasReport: N(g.rep) === 1 }));
      const a = S(t.club_a), b = t.club_b == null ? null : S(t.club_b);
      // agregado do ponto de vista de "a" (quem manda o jogo único ou a volta)
      const goalsOf = (id: string) => games.reduce((s, g) => s + (g.homeGoals == null ? 0 : g.homeId === id ? g.homeGoals : g.awayGoals!), 0);
      const played = games.every((g) => g.homeGoals != null);
      return {
        id: S(t.id), a: club(a), b: b ? club(b) : null, games,
        winnerId: t.winner == null ? null : S(t.winner), decidedIn: (t.decided_in == null ? null : S(t.decided_in)) as CupBracketDto['stages'][number]['ties'][number]['decidedIn'],
        shootout: t.shootout_a == null ? null : [N(t.shootout_a), N(t.shootout_b)] as [number, number],
        aggregate: b && sd.legs === 2 && played ? [goalsOf(a), goalsOf(b)] as [number, number] : null,
        mine: !!st.clubId && (a === st.clubId || b === st.clubId),
      };
    });
    const tb = sd.decider.extraTime ? 'empate: prorrogação e pênaltis' : 'empate: pênaltis direto';
    const rule = [sd.legs === 2 ? 'ida e volta (agregado, sem gol fora)' : 'jogo único', tb, i === n - 1 ? 'campo neutro' : HOST_TEXT[sd.host], DRAW_TEXT[sd.draw],
      state.byes[i] ? `${state.byes[i]} folga(s) para os mais bem classificados` : '', sd.decider.extraTimeSub ? '6ª troca na prorrogação' : ''].filter(Boolean).join(' · ');
    return { name: sd.name, legs: sd.legs, dates: state.dates[i] ?? [], rule, drawn: ties.length > 0, ties };
  });
  const champ = S(c.status) === 'finished' ? db.prepare('SELECT winner FROM cup_ties WHERE competition_id = ? AND stage = ?').get(competitionId, n - 1) : null;
  const reset = state.format.discipline.resetAfterStage;
  return {
    id: S(c.id), name: S(c.name), country: S(c.country), countryCode: S(c.code), status: S(c.status) as CupBracketDto['status'],
    champion: champ?.winner != null ? club(S(champ.winner)) : null, regulation: state.format.regulation, reward: state.format.reward, source: state.format.source,
    discipline: { yellowLimit: state.format.discipline.yellowLimit, resetAfter: reset == null ? null : state.format.stages[reset]!.name }, stages,
  };
}

/** Quanto a copa pagou até agora, recalculado dos confrontos e partidas (cotas, vitórias, semifinalistas, finalistas). Para conferência. */
export function cupPrizesPaid(db: SqlDb, competitionId: string): number {
  const state = cupStateOf(db, competitionId);
  const n = state.format.stages.length;
  let total = 0;
  for (const t of db.prepare('SELECT id, stage, winner, club_b FROM cup_ties WHERE competition_id = ? AND club_b IS NOT NULL').all(competitionId)) {
    const stage = N(t.stage);
    if (db.prepare("SELECT 1 AS x FROM fixtures WHERE tie_id = ? AND (leg IS NULL OR leg = 1) AND status = 'played'").get(S(t.id))) total += 2 * (state.prizes.perStage[stage] ?? 0);
    if (t.winner == null) continue;
    if (stage < n - 1) total += state.prizes.win[stage] ?? 0;
    if (stage === n - 2) total += state.prizes.semiLoser;
    if (stage === n - 1) total += state.prizes.winner + state.prizes.runnerUp;
  }
  return total;
}
