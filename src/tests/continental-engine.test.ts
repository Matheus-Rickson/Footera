import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, type Rng } from '../game/rng.ts';
import {
  buildableStages, buildStage, CONMEBOL_GROUP_ROUNDS, finalRanking, formatComplete, numberingOf, outcomes, resolveRef, stageEntrants, stageOf, stageTables, tieOutcome,
  type FormatDef, type FormatState, type Fixture, type FxResult,
} from '../game/format-engine/engine.ts';
import { formatById } from '../game/format-engine/formats.ts';
import { LIB_ID, LIB_SIZE, LIB_TO_SUD, libertadores, recopa, SUD_ID, SUD_SIZE, sulAmericana } from '../game/continental-engine/formats.ts';
import { conmebolPreset, isConmebolPresetStage, type PresetContext } from '../game/continental-engine/preset.ts';
import { groupDraw, potPairs, sameCountryPairs } from '../game/continental-engine/draw.ts';
import { CONMEBOL_COUNTRY_CODES, countryOrder, distributeQualifiers, LIB_SLOTS, SUD_SLOTS } from '../game/continental-engine/slots.ts';
import { editionPoints, historyPoints, rankingPoints, rankOrder, yearWeight } from '../game/continental-engine/ranking.ts';
import { conmebolFirstDate, conmebolStageDates, conmebolWeeks, pickMatchDay, shiftToSeason } from '../game/continental-engine/calendar.ts';
import { finalPrizes, groupMatchPrize, stageEntryPrize, usdToEur } from '../game/continental-engine/prizes.ts';
import { computeStandings } from '../game/competition-engine/standings.ts';
import { weekday } from '../shared/date.ts';
import { conmebolTarget, objectiveStatus, seasonObjectives } from '../game/board-engine/objectives.ts';

/** Universo de teste: 20 clubes por país da CONMEBOL (id = país + número; número menor = melhor no ranking). */
const COUNTRY = new Map<string, string>();
const ORDER: Record<string, string[]> = {};
for (const code of CONMEBOL_COUNTRY_CODES) {
  ORDER[code] = Array.from({ length: 20 }, (_, i) => `${code}${String(i + 1).padStart(2, '0')}`);
  for (const id of ORDER[code]!) COUNTRY.set(id, code);
}
const RANK: Record<string, number> = {};
[...COUNTRY.keys()].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)) || a.localeCompare(b)).forEach((id, i) => { RANK[id] = i + 1; });

/** Joga uma competição CONMEBOL inteira com placares aleatórios (sorteios pelo preset; externos informados por `external`). */
function run(def: FormatDef, seeds: string[], ctx: PresetContext, seed: string, external?: () => Record<string, string[]>, until?: (s: FormatState) => boolean) {
  const rng = createRng(seed);
  const state: FormatState = { seeds, stages: {}, rank: ctx.rank };
  const fixtures = new Map<string, Fixture[]>();
  for (let guard = 0; guard < 40 && !formatComplete(def, state) && !(until?.(state)); guard++) {
    if (external) state.external = external();
    const ready = buildableStages(def, state);
    if (!ready.length) break;
    for (const id of ready) {
      const preset = isConmebolPresetStage(def.id, id) ? conmebolPreset(def.id, id, stageEntrants(def, state, id)!, ctx, rng.fork(`draw:${id}`)) : undefined;
      const b = buildStage(def, state, id, rng.fork(id), preset);
      state.stages[id] = b.stage;
      fixtures.set(id, b.fixtures);
      play(def, state, id, b.fixtures, rng.fork(`p:${id}`));
    }
  }
  return { state, fixtures };
}
function play(def: FormatDef, state: FormatState, id: string, fixtures: readonly Fixture[], rng: Rng) {
  const st = state.stages[id]!, stage = stageOf(def, id);
  for (const f of [...fixtures].sort((a, b) => a.round - b.round)) {
    const r: FxResult = { home: f.home, away: f.away, homeGoals: rng.int(0, 3), awayGoals: rng.int(0, 3), cards: { homeRed: rng.int(0, 1), homeYellow: rng.int(0, 4), awayRed: rng.int(0, 1), awayYellow: rng.int(0, 4) } };
    if (f.tie !== undefined) { r.tie = f.tie; r.leg = f.leg; }
    st.results.push(r);
    if (f.tie !== undefined && stage.kind === 'knockout' && (f.leg ?? 1) === stage.legs && tieOutcome(def, state, id, f.tie) === null) {
      const t = st.ties![f.tie]!;
      r.pens = rng.next() < 0.5 ? t.a : t.b;
    }
  }
}
function libSeeds(champions: { lib: string | null; sud: string | null } = { lib: null, sud: null }) {
  const q = distributeQualifiers(ORDER, champions);
  return { q, lib: [...q.lib.f1, ...q.lib.f2, ...q.lib.groups], sud: [...q.sud.p1.flat(), ...q.sud.groups] };
}

test('Continentais: vagas por país fecham 47 na Libertadores e 44 na Sul-Americana, sem repetir clube; campeões entram por fora da cota', () => {
  assert.equal(Object.values(LIB_SLOTS).reduce((s, x) => s + x.groups + x.f2 + x.f1, 0), 45);
  assert.equal(Object.values(SUD_SLOTS).reduce((s, x) => s + x.groups + x.p1, 0), 44);
  const { q, lib, sud } = libSeeds();
  assert.equal(lib.length, LIB_SIZE);
  assert.deepEqual([q.lib.f1.length, q.lib.f2.length, q.lib.groups.length], [6, 13, 28]);
  assert.equal(sud.length, SUD_SIZE);
  assert.equal(new Set([...lib, ...sud]).size, lib.length + sud.length, 'ninguém nas duas');
  // 1ª temporada (sem campeões): Brasil 8 e Argentina 7 na Libertadores (ADAPT)
  assert.equal(lib.filter((c) => COUNTRY.get(c) === 'BRA').length, 8);
  assert.equal(lib.filter((c) => COUNTRY.get(c) === 'ARG').length, 7);
  // campeão já classificado pela liga: a cota do país é preenchida sem ele (o país fica com uma vaga a mais)
  const withChamps = libSeeds({ lib: 'URU01', sud: 'COL03' });
  assert.equal(withChamps.lib.length, LIB_SIZE);
  assert.equal(withChamps.q.lib.groups[0], 'URU01', 'campeão da Libertadores = semente 19 (cabeça do grupo A)');
  assert.equal(withChamps.lib.filter((c) => COUNTRY.get(c) === 'URU').length, 5);
  assert.equal(withChamps.lib.filter((c) => COUNTRY.get(c) === 'COL').length, 5);
  assert.equal(withChamps.lib.filter((c) => COUNTRY.get(c) === 'BRA').length, 7);
  assert.equal(new Set(withChamps.lib).size, LIB_SIZE);
  // a Sul-Americana pega os seguintes da ordem do país
  assert.deepEqual(withChamps.q.sud.groups.filter((c) => COUNTRY.get(c) === 'BRA'), ['BRA08', 'BRA09', 'BRA10', 'BRA11', 'BRA12', 'BRA13']);
  assert.throws(() => distributeQualifiers({ ...ORDER, VEN: ORDER.VEN!.slice(0, 5) }, { lib: null, sud: null }), /faltam clubes de VEN/);
  // ordem do país: campeão da copa logo depois do G4
  assert.deepEqual(countryOrder(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 'g'), ['a', 'b', 'c', 'd', 'g', 'e', 'f']);
  assert.deepEqual(countryOrder(['a', 'b', 'c', 'd', 'e'], 'b'), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(countryOrder(['a', 'b', 'c', 'd', 'e'], 'x', ['y']), ['a', 'b', 'c', 'd', 'x', 'e', 'y']);
});

test('Continentais: Libertadores e Sul-Americana rodam inteiras (sorteios com restrição de país, rodadas fixas, numeração e mando)', () => {
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
    const champs = seed < 'd' ? { lib: null, sud: null } : { lib: 'ARG02', sud: 'COL05' };
    const { lib: libS, sud: sudS } = libSeeds(champs);
    const ctx: PresetContext = { country: COUNTRY, rank: RANK, libChampion: champs.lib, sudChampion: champs.sud };
    const L = libertadores(), S = sulAmericana();
    const lib = run(L, libS, ctx, `lib:${seed}`);
    assert.ok(formatComplete(L, lib.state), 'Libertadores terminou');
    const champ = outcomes(L, lib.state).champion;
    assert.ok(champ);
    // fase 2: nenhum cruzamento do mesmo país (salvo E1–E3)
    const e = [0, 1, 2].map((i) => tieOutcome(L, lib.state, 'f1', i)!.winner);
    for (const t of lib.state.stages.f2!.ties!) if (!e.includes(t.a) && !e.includes(t.b)) assert.notEqual(COUNTRY.get(t.a), COUNTRY.get(t.b), 'fase 2 sem mesmo país');
    // fase 3: C1×C8…; o de melhor ranking decide em casa
    for (const t of lib.state.stages.f3!.ties!) assert.equal(t.host, RANK[t.a]! < RANK[t.b]! ? t.a : t.b);
    // grupos: só clube vindo da fase 3 pode dividir grupo com outro do mesmo país; campeão na posição A1
    const g3 = [0, 1, 2, 3].map((i) => tieOutcome(L, lib.state, 'f3', i)!.winner);
    for (const g of lib.state.stages.g!.groups!) {
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (!g3.includes(g[i]!) && !g3.includes(g[j]!)) assert.notEqual(COUNTRY.get(g[i]!), COUNTRY.get(g[j]!), `grupo sem mesmo país: ${g.join(',')}`);
    }
    if (champs.lib) assert.equal(lib.state.stages.g!.groups![0]![0], champs.lib);
    // rodadas fixas: 6 rodadas, 16 jogos por rodada, a 1ª é 4×2 e 3×1
    const gfx = lib.fixtures.get('g')!;
    assert.equal(gfx.length, 96);
    const gA = lib.state.stages.g!.groups![0]!;
    assert.deepEqual(gfx.filter((f) => f.round === 1 && gA.includes(f.home)).map((f) => [f.home, f.away]), [[gA[3], gA[1]], [gA[2], gA[0]]]);
    // oitavas: cada 1º contra um 2º; o 1º decide em casa (manda a volta)
    const num = numberingOf(L, lib.state);
    for (const t of lib.state.stages.r16!.ties!) { assert.ok(num.get(t.a)! <= 8 && num.get(t.b)! > 8); assert.equal(t.host, t.a); }
    // quartas e semis: o de menor numeração decide em casa
    for (const id of ['qf', 'sf']) for (const t of lib.state.stages[id]!.ties!) assert.equal(t.host, num.get(t.a)! < num.get(t.b)! ? t.a : t.b);
    // final: jogo único em campo neutro; "Equipo A" = menor numeração
    const fin = lib.state.stages.final!.ties![0]!;
    assert.ok(fin.neutral);
    assert.equal(fin.host, num.get(fin.a)! < num.get(fin.b)! ? fin.a : fin.b);
    assert.equal(lib.fixtures.get('final')!.length, 1);
    assert.equal(finalRanking(L, lib.state).length, LIB_SIZE);

    // Sul-Americana: externos vêm da Libertadores
    const external = () => {
      const out: Record<string, string[]> = {};
      for (const [k, refs] of Object.entries(LIB_TO_SUD)) { const l = refs.map((r) => resolveRef(L, lib.state, r)); if (l.every((c) => c)) out[k] = l as string[]; }
      return out;
    };
    const sud = run(S, sudS, ctx, `sud:${seed}`, external);
    assert.ok(formatComplete(S, sud.state), 'Sul-Americana terminou');
    // primeira fase: só clubes do mesmo país, jogo único
    for (const t of sud.state.stages.p1!.ties!) assert.equal(COUNTRY.get(t.a), COUNTRY.get(t.b));
    assert.equal(sud.fixtures.get('p1')!.length, 16);
    // grupos sem nenhum par do mesmo país; perdedores da fase 3 da Libertadores estão nos grupos
    for (const g of sud.state.stages.g!.groups!) assert.equal(new Set(g.map((c) => COUNTRY.get(c))).size, 4, `grupo da Sul-Americana sem mesmo país: ${g.join(',')}`);
    const losers = [0, 1, 2, 3].map((i) => tieOutcome(L, lib.state, 'f3', i)!.loser);
    for (const c of losers) assert.ok(sud.state.stages.g!.groups!.flat().includes(c));
    // play-off: 9×24 … 16×17; o 3º da Libertadores (17–24) manda a ida, o 2º decide em casa
    const sn = numberingOf(S, sud.state);
    sud.state.stages.po!.ties!.forEach((t, i) => { assert.deepEqual([sn.get(t.a), sn.get(t.b)], [9 + i, 24 - i]); assert.equal(t.host, t.a); });
    assert.equal(finalRanking(S, sud.state).length, SUD_SIZE + 12, 'classificação com os 12 de fora');
  }
});

test('Continentais: referência externa fica pendente até a lista completar; Recopa com prorrogação no agregado empatado', () => {
  const S = sulAmericana();
  const { sud } = libSeeds();
  const st: FormatState = { seeds: sud, stages: {} };
  assert.equal(resolveRef(S, st, { external: 'lib-f3', idx: 0 }), null);
  st.external = { 'lib-f3': ['x1', 'x2', 'x3', 'x4'] };
  assert.equal(resolveRef(S, st, { external: 'lib-f3', idx: 2 }), 'x3');
  const R = recopa();
  assert.equal(formatById('conmebol-rec', 2)?.id, 'conmebol-rec');
  assert.equal(formatById(LIB_ID, LIB_SIZE)?.id, LIB_ID);
  assert.equal(formatById(SUD_ID, SUD_SIZE)?.id, SUD_ID);
  assert.equal(formatById(LIB_ID, 40), null);
  const rs: FormatState = { seeds: ['lib', 'sud'], stages: {} };
  const b = buildStage(R, rs, 'f', createRng('r'));
  assert.equal(b.stage.ties![0]!.host, 'lib', 'o campeão da Libertadores manda a volta');
  assert.deepEqual(b.fixtures.map((f) => [f.home, f.leg]), [['sud', 1], ['lib', 2]]);
  const f = stageOf(R, 'f');
  assert.ok(f.kind === 'knockout' && f.extraTime && f.legs === 2);
});

test('Continentais: desempate CONMEBOL — confronto direto não se reaplica; fair play; ordem entre grupos sem confronto direto', () => {
  // achado por busca: com o confronto direto reaplicado ao subgrupo dá D, A, B, C; no padrão CONMEBOL ("não se volta") dá A, D, B, C
  const res = ([['A', 'B', 2, 2], ['A', 'C', 0, 1], ['A', 'D', 1, 2], ['B', 'A', 1, 2], ['B', 'C', 3, 2], ['B', 'D', 0, 2], ['C', 'A', 0, 2], ['C', 'B', 2, 2],
    ['C', 'D', 2, 2], ['D', 'A', 0, 0], ['D', 'B', 0, 1], ['D', 'C', 1, 2]] as const).map(([home, away, homeGoals, awayGoals]) => ({ home, away, homeGoals, awayGoals }));
  const tb = ['points', 'headToHead', 'goalDiff', 'goalsFor', 'fairPlay'] as const;
  const order = (h2hOnce: boolean) => computeStandings(['A', 'B', 'C', 'D'], res, { pointsWin: 3, pointsDraw: 1, tiebreakers: [...tb] }, { h2hOnce }).map((r) => r.teamId).join('');
  assert.equal(order(false), 'DABC');
  assert.equal(order(true), 'ADBC');
  // fair play: dois clubes idênticos, decide quem tem menos vermelhos
  const eq = [{ home: 'X', away: 'Y', homeGoals: 1, awayGoals: 1 }, { home: 'Y', away: 'X', homeGoals: 1, awayGoals: 1 }];
  const fp = computeStandings(['X', 'Y'], eq, { pointsWin: 3, pointsDraw: 1, tiebreakers: [...tb] }, { cards: new Map([['X', { red: 1, yellow: 0 }], ['Y', { red: 0, yellow: 9 }]]) });
  assert.deepEqual(fp.map((r) => r.teamId), ['Y', 'X']);
  const fp2 = computeStandings(['X', 'Y'], eq, { pointsWin: 3, pointsDraw: 1, tiebreakers: [...tb] }, { cards: new Map([['X', { red: 0, yellow: 2 }], ['Y', { red: 0, yellow: 3 }]]) });
  assert.deepEqual(fp2.map((r) => r.teamId), ['X', 'Y']);
  // ordem entre os 1ºs de grupo (Libertadores): pontos, saldo, gols (sem "vitórias", que não é critério da CONMEBOL)
  const L = libertadores();
  const st: FormatState = { seeds: [], stages: { g: { groups: [['a1', 'a2'], ['b1', 'b2']], results: [], expected: 4 } } };
  st.stages.g!.results.push({ home: 'a1', away: 'a2', homeGoals: 1, awayGoals: 0 }, { home: 'a2', away: 'a1', homeGoals: 0, awayGoals: 0 },
    { home: 'b1', away: 'b2', homeGoals: 3, awayGoals: 0 }, { home: 'b2', away: 'b1', homeGoals: 1, awayGoals: 1 });
  // a1: 4 pts, saldo +1; b1: 4 pts, saldo +3 → b1 é o 1º melhor
  assert.equal(resolveRef(L, st, { stage: 'g', pos: 1, nthBest: 1 }), 'b1');
  assert.equal(stageTables(L, st, 'g').groups[0]![0]!.teamId, 'a1');
});

test('Continentais: sorteios respeitam as restrições em milhares de sementes e são determinísticos', () => {
  const countries = ['ARG', 'BRA', 'BRA', 'ARG', 'COL', 'URU', 'CHI', 'ECU'];
  for (let s = 0; s < 400; s++) {
    // potes com muitos brasileiros e argentinos (o caso difícil)
    const mk = (p: number) => Array.from({ length: 8 }, (_, i) => ({ id: `p${p}c${i}`, country: p < 3 ? countries[(i + p) % 8]! : ['BRA', 'ARG', 'BRA', 'PAR', 'PER', 'BOL', 'VEN', 'ARG'][i]! }));
    const pots = [mk(0), mk(1), mk(2), mk(3)];
    const all = new Map(pots.flat().map((c) => [c.id, c.country]));
    const g = groupDraw(pots, 8, createRng(`g${s}`));
    for (const grp of g) {
      assert.equal(grp.length, 4);
      assert.equal(new Set(grp.map((c) => all.get(c))).size, 4, `sem mesmo país (semente ${s}): ${grp.join(',')}`);
      grp.forEach((c, i) => assert.ok(c.startsWith(`p${i}`), 'posição = pote'));
    }
    const fixed = groupDraw(pots, 8, createRng(`g${s}`), { fixed: 'p0c3' });
    assert.equal(fixed[0]![0], 'p0c3');
    const pairs = potPairs(pots[0]!, pots[1]!, createRng(`p${s}`), { forbidSameCountry: true });
    assert.equal(pairs.length, 8);
    for (const [a, b] of pairs) { assert.ok(a.startsWith('p0') && b.startsWith('p1')); assert.notEqual(all.get(a), all.get(b)); }
  }
  assert.deepEqual(groupDraw([[{ id: 'a', country: 'X' }, { id: 'b', country: 'Y' }]], 2, createRng('z')), groupDraw([[{ id: 'a', country: 'X' }, { id: 'b', country: 'Y' }]], 2, createRng('z')));
  // mesmo país impossível de separar → erro (2 grupos, 3 clubes do mesmo país em potes diferentes não cabem... aqui: pote 2 todo do país do pote 1)
  assert.throws(() => groupDraw([[{ id: 'a', country: 'X' }, { id: 'b', country: 'X' }], [{ id: 'c', country: 'X' }, { id: 'd', country: 'Y' }]], 2, createRng('q')), /impossível/);
  // isento (vindo da fase 3) pode dividir grupo com o mesmo país
  const ok = groupDraw([[{ id: 'a', country: 'X' }, { id: 'b', country: 'X' }], [{ id: 'c', country: 'X' }, { id: 'd', country: 'Y' }]], 2, createRng('q'), { exempt: new Set(['c']) });
  assert.equal(ok.flat().length, 4);
  const sc = sameCountryPairs([['a1', 'a2', 'a3', 'a4'], ['b1', 'b2', 'b3', 'b4']], createRng('s'));
  assert.equal(sc.length, 4);
  for (const [h, a] of sc) assert.equal(h[0], a[0]);
});

test('Continentais: ranking CONMEBOL — pontos acumulados, depreciação de 10% ao ano, coeficiente histórico e título nacional', () => {
  assert.deepEqual([0, 1, 9, 10].map(yearWeight), [1, 0.9, 0.1, 0]);
  // campeão da Libertadores no ano mais recente: grupos 100 + oitavas 100 + quartas 200 + semi 300 + campeão 1000 + 8 vitórias × 80 + 3 empates × 40
  const champ = { season: 2030, comp: 'lib' as const, stage: 'champion' as const, prelim: false, groups: true, wins: 8, draws: 3 };
  assert.equal(editionPoints(champ, 0), 100 + 100 + 200 + 300 + 1000 + 640 + 120);
  assert.equal(editionPoints(champ, 1), (100 + 100 + 200 + 300 + 1000 + 640 + 120) * 0.9);
  // 11º ano: só o histórico (campeão 100, semi 30, vitória 8, empate 4)
  assert.equal(editionPoints(champ, 10), 100 + 30 + 64 + 12);
  // eliminado na fase preliminar da Libertadores: 25; Sul-Americana: primeira fase 15 + grupos 60 + playoff/oitavas 60 (uma vez) + 2 vitórias × 48
  assert.equal(editionPoints({ season: 2030, comp: 'lib', stage: 'prelimOut', prelim: true, groups: false, wins: 0, draws: 0 }, 0), 25);
  assert.equal(editionPoints({ season: 2030, comp: 'sud', stage: 'r16', prelim: true, groups: true, wins: 2, draws: 0 }, 0), 15 + 60 + 60 + 96);
  // terceiro da Libertadores no play-off da Sul-Americana (sem os grupos da Sul-Americana): só os 60 do playoff
  assert.equal(editionPoints({ season: 2030, comp: 'sud', stage: 'po', prelim: false, groups: false, wins: 0, draws: 0 }, 0), 60);
  // total com título nacional e ano histórico (ADAPT)
  const pts = rankingPoints([champ], [2030, 2028], { season: 2025, points: 1000 }, 2030);
  assert.equal(pts, 2460 + 50 + 50 * 0.8 + 1000 * 0.5);
  assert.equal(historyPoints(90), 2160);
  assert.equal(historyPoints(30), 0);
  assert.deepEqual(rankOrder([{ id: 'b', points: 10, reputation: 50 }, { id: 'a', points: 10, reputation: 60 }, { id: 'c', points: 20, reputation: 1 }]), ['c', 'a', 'b']);
});

test('Continentais: calendário (semanas do anexo, mesmo dia da semana nos anos seguintes, terça a quinta) e premiação em euros', () => {
  assert.equal(conmebolFirstDate(2026), '2026-02-04');
  assert.deepEqual(conmebolStageDates(LIB_ID, 'final', 2026), ['2026-11-28']);
  assert.equal(weekday('2026-11-28'), 6, 'final da Libertadores num sábado');
  assert.equal(weekday(conmebolStageDates(SUD_ID, 'final', 2026)![0]!), 6);
  for (const season of [2026, 2027, 2028, 2031]) {
    for (const d of conmebolWeeks(season)) assert.ok([3, 6].includes(weekday(d)), `${d} é quarta (semana) ou sábado (final)`);
    const g = conmebolStageDates(LIB_ID, 'g', season)!;
    assert.equal(g.length, 6);
    assert.ok(g[0]!.slice(5) >= '04-05' && g[0]!.slice(5) <= '04-11');
  }
  assert.equal(shiftToSeason('2026-02-04', 2027), '2027-02-03');
  assert.equal(pickMatchDay('2026-03-04', []), '2026-03-04');
  assert.equal(pickMatchDay('2026-03-04', ['2026-03-04']), '2026-03-05', 'quarta ocupada → quinta (ou terça), o dia com mais descanso');
  assert.equal(pickMatchDay('2026-03-04', ['2026-03-05', '2026-03-07']), '2026-03-03');
  assert.equal(usdToEur(1_155_700), 1_000_000);
  assert.equal(stageEntryPrize(LIB_ID, 'f1'), usdToEur(400_000));
  assert.equal(stageEntryPrize(LIB_ID, 'g'), 0, 'grupos pagam por jogo em casa');
  assert.equal(stageEntryPrize(SUD_ID, 'po'), usdToEur(500_000));
  assert.deepEqual(groupMatchPrize(LIB_ID), { home: usdToEur(1_000_000), win: usdToEur(340_000) });
  assert.deepEqual(finalPrizes(LIB_ID), { champion: usdToEur(25_000_000), runnerUp: usdToEur(7_000_000) });
  assert.deepEqual(finalPrizes('conmebol-rec'), { champion: usdToEur(1_800_000), runnerUp: usdToEur(900_000) });
  assert.equal(CONMEBOL_GROUP_ROUNDS.length, 6);
  // cada par de clubes do grupo se enfrenta uma vez em cada mando
  const pairs = CONMEBOL_GROUP_ROUNDS.flat().map(([h, a]) => `${h}${a}`).sort();
  assert.deepEqual(pairs, ['12', '13', '14', '21', '23', '24', '31', '32', '34', '41', '42', '43'].sort().filter((p) => pairs.includes(p)));
  assert.equal(new Set(CONMEBOL_GROUP_ROUNDS.flat().map(([h, a]) => `${Math.min(h, a)}${Math.max(h, a)}`)).size, 6);
});

test('Continentais: objetivo da diretoria pelo pote (ADAPT) e julgamento pela fase alcançada', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((p) => conmebolTarget('lib', p)), [
    { reach: 'groups', importance: 'important' }, { reach: 'qf', importance: 'important' }, { reach: 'r16', importance: 'important' },
    { reach: 'r16', importance: 'desirable' }, { reach: 'r16', importance: 'desirable' }]);
  assert.deepEqual([0, 1, 2, 3].map((p) => conmebolTarget('sud', p).reach), ['groups', 'qf', 'r16', 'po']);
  assert.ok([0, 1, 2, 3].every((p) => conmebolTarget('sud', p).importance === 'desirable'), 'Sul-Americana um nível abaixo');
  const base = { league: null, cup: null, state: null, payroll: 1_000_000, wageCeiling: 1_200_000, youthTarget: 0, squadAge: 26, tier: 1 };
  const o = seasonObjectives('giant', 'stable', { ...base, conmebol: { name: 'CONMEBOL Libertadores', comp: 'lib', pot: 1 } }).find((x) => x.kind === 'conmebol')!;
  assert.deepEqual([o.label, o.importance, o.target.reach], ['CONMEBOL Libertadores: chegar às quartas de final', 'important', 4]);
  assert.equal(seasonObjectives('giant', 'stable', base).some((x) => x.kind === 'conmebol'), false, 'sem continental, sem objetivo');
  // julgamento: quartas (4) cumpre; caiu nas oitavas (3) não cumpre; vivo nas oitavas segue em andamento; sem estreia, pendente
  assert.equal(objectiveStatus(o, { reach: 4, reachEliminated: false }, false), 'met');
  assert.equal(objectiveStatus(o, { reach: 3, reachEliminated: true }, false), 'missed');
  assert.equal(objectiveStatus(o, { reach: 3, reachEliminated: false }, false), 'on_track');
  assert.equal(objectiveStatus(o, { reach: null, reachEliminated: false }, false), 'pending');
  assert.equal(objectiveStatus(o, { reach: 3, reachEliminated: false }, true), 'missed', 'fim da temporada sem chegar');
});
