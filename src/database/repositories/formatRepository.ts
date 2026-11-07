/**
 * Campeonatos em fases no banco (Fase 9 — Séries C e D reais; depois os estaduais). Regras puras em game/format-engine; aqui: criar a
 * competição, montar cada fase quando os participantes ficam definidos (com datas), ler o estado a partir das partidas, desempate do jogo
 * decisivo do mata-mata e registro dos pênaltis. Classificação sempre derivada das partidas (regra 4). NÃO abre transação.
 */
import type { SqlDb } from '../types.ts';
import { createRng } from '../../game/rng.ts';
import { addDays, nextWeekdayOnOrAfter } from '../../shared/date.ts';
import {
  buildableStages, buildStage, deciderFor, finalRanking, formatComplete, outcomes, stageEntrants, stageOf,
  type FormatDef, type FormatState, type FxResult, type StageState,
} from '../../game/format-engine/engine.ts';
import { formatById, regionalGroups, SERIE_D_SPOTS } from '../../game/format-engine/formats.ts';
import type { MatchDecider } from '../../game/match-engine/types.ts';
import { brazilStageDates } from '../../game/career-engine/brazilCalendar.ts';

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
  const r = db.prepare("SELECT format_json FROM competitions WHERE id = ? AND kind = 'league' AND format_json IS NOT NULL").get(compId);
  return r ? (JSON.parse(S(r.format_json)) as FormatMeta) : null;
}

/** Formato e estado atual (fases montadas e resultados das partidas disputadas). */
export function formatStateOf(db: SqlDb, compId: string): { def: FormatDef; meta: FormatMeta; state: FormatState } | null {
  const meta = formatMetaOf(db, compId);
  if (!meta) return null;
  const def = formatById(meta.formatId, meta.seeds.length);
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
      const comp = db.prepare('SELECT season, country_id FROM competitions WHERE id = ?').get(compId)!;
      const rounds = Math.max(...b.fixtures.map((f) => f.round));
      const planned = brazilCalendar(db, { countryId: S(comp.country_id) }) ? brazilStageDates(fs.meta.formatId, id, N(comp.season), rounds, fs.def.size) : null;
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

/** Cria uma divisão disputada em fases (a 1ª fase já com os jogos). `seeds`: participantes do mais forte ao mais fraco. */
export function createFormatCompetition(db: SqlDb, c: { compId: string; leagueId: string; countryId: string; season: number; name: string; def: FormatDef; seeds: string[]; start: string; weekday: number; intervalDays: number }): void {
  if (c.seeds.length !== c.def.size) throw new Error(`${c.def.name}: ${c.seeds.length} clubes para um formato de ${c.def.size}.`);
  const meta: FormatMeta = { formatId: c.def.id, seeds: c.seeds, start: c.start, weekday: c.weekday, intervalDays: c.intervalDays };
  db.prepare("INSERT INTO competitions (id, kind, league_id, country_id, season, name, format_json) VALUES (?, 'league', ?, ?, ?, ?, ?)")
    .run(c.compId, c.leagueId, c.countryId, c.season, c.name, JSON.stringify(meta));
  buildPending(db, c.compId, c.start);
}

/** Depois de uma rodada: monta as fases que ficaram definidas (jogos a partir de 4 dias depois) e encerra os campeonatos concluídos. */
export function advanceFormats(db: SqlDb, date: string): void {
  for (const r of db.prepare("SELECT id FROM competitions WHERE kind = 'league' AND format_json IS NOT NULL AND status <> 'finished'").all()) {
    const id = S(r.id);
    const fs = formatStateOf(db, id);
    if (!fs) continue;
    if (formatComplete(fs.def, fs.state)) { db.prepare("UPDATE competitions SET status = 'finished' WHERE id = ?").run(id); continue; }
    if (buildableStages(fs.def, fs.state).length) buildPending(db, id, addDays(date, 4));
  }
}

/** Regra do jogo de mata-mata de um campeonato em fases: desempate no jogo decisivo (null = pontos corridos ou jogo de ida). */
export function formatFixtureRule(db: SqlDb, fixtureId: string): { decider: MatchDecider | undefined; neutral: boolean; stageName: string; leg: 1 | 2 | null } | null {
  const f = db.prepare('SELECT competition_id, stage, stage_tie, leg, neutral FROM fixtures WHERE id = ? AND stage IS NOT NULL AND stage_tie IS NOT NULL').get(fixtureId);
  if (!f) return null;
  const fs = formatStateOf(db, S(f.competition_id));
  if (!fs) return null;
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
 * cada estado (`SERIE_D_SPOTS`) — até haver os estaduais no jogo, os clubes de melhor reputação da elite do estadual que não estão nas
 * Séries A–C (ADAPT); (3) até 28 clubes da Série D que terminaram entre o 5º e o 32º lugar; (4) o restante: a Série D anterior pela
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
  for (const [uf, spots] of Object.entries(SERIE_D_SPOTS)) {
    const cand = clubs.filter((c) => S(c.state ?? '') === uf && !national.has(S(c.id)))
      .sort((a, b) => (a.state_division == null ? 9 : N(a.state_division)) - (b.state_division == null ? 9 : N(b.state_division)) || N(b.reputation) - N(a.reputation) || S(a.id).localeCompare(S(b.id)));
    let taken = 0;
    for (const c of cand) { if (taken >= spots) break; if (!next.includes(S(c.id))) { add(S(c.id)); taken++; } }
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
