import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { baseUniverse } from '../services/universeService.node.ts';
import { advanceTime, getCompetitionTable } from '../database/repositories/competitionRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import { startNextSeason } from '../database/repositories/seasonRepository.ts';
import { formatOutcomesOf, formatStateOf, getStagedView } from '../database/repositories/formatRepository.ts';
import { regionalGroups } from '../game/format-engine/formats.ts';
import { brazilLeagueDates, brazilStageDates, estadualPool, spreadDates, worldCupYear } from '../game/career-engine/brazilCalendar.ts';
import { COPA_DO_BRASIL_SPOTS, ESTADUAIS, REGIONAIS, SERIE_D_SPOTS } from '../game/format-engine/formats.ts';
import { tieOutcome } from '../game/format-engine/engine.ts';
import type { SqlDb } from '../database/types.ts';
import type { Coach } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
const leagueCount = (db: SqlDb, id: string) => n(db, 'SELECT COUNT(*) AS n FROM clubs WHERE league_id = ?', id);

test('Calendário brasileiro (modelo 2026): Série A com pausa na Copa do Mundo, Série B, Série C pelas âncoras e Série D pela tabela básica', () => {
  const a = brazilLeagueDates('bra-1', 2026, 38)!;
  assert.deepEqual([a.length, a[0], a[18], a[37]], [38, '2026-01-28', '2026-07-22', '2026-12-02']);
  assert.ok(a[17]! <= '2026-05-31' && a.every((d, i) => i === 0 || d > a[i - 1]!), '18 rodadas até 31/05, em ordem');
  assert.ok(!a.some((d) => d > '2026-05-31' && d < '2026-07-22'), 'pausa da Copa do Mundo');
  assert.equal(worldCupYear(2027), false);
  const a27 = brazilLeagueDates('bra-1', 2027, 38)!;
  assert.ok(a27.some((d) => d > '2027-06-01' && d < '2027-07-21'), 'sem Copa do Mundo, sem pausa');
  const b = brazilLeagueDates('bra-2', 2026, 38)!;
  assert.deepEqual([b[0], b[37], new Set(b).size], ['2026-03-21', '2026-11-28', 38]);
  assert.deepEqual(brazilStageDates('bra-serie-d', 'f1', 2026, 10, 96)!.map((d) => d.slice(5)), ['04-04', '04-11', '04-18', '04-25', '05-02', '05-09', '05-16', '05-23', '05-30', '06-13']);
  assert.deepEqual(brazilStageDates('bra-serie-d', 'final', 2026, 2, 96), ['2026-09-05', '2026-09-12']);
  assert.deepEqual(brazilStageDates('bra-serie-c', 'final', 2026, 2, 20), ['2026-10-17', '2026-10-24']);
  assert.deepEqual(brazilStageDates('bra-serie-c', 'final', 2028, 2, 28), ['2028-10-03', '2028-10-10']);
  for (const n of [19, 23, 26]) { const c = brazilStageDates('bra-serie-c', 'f1', 2026, n, 20)!; assert.deepEqual([c.length, new Set(c).size, c[0], c[n - 1]! <= '2026-08-29'], [n, n, '2026-04-04', true]); }
  // estaduais: 12 datas de 10/01 a 15/03 (sábado, quarta, domingo, quarta, domingos), depois quartas; Série A às quartas nesse período
  const pool = estadualPool(2026, 'sp-a1');
  assert.deepEqual(pool.slice(0, 12).map((d) => d.slice(5)), ['01-10', '01-14', '01-18', '01-21', '01-25', '02-01', '02-08', '02-15', '02-22', '03-01', '03-08', '03-15']);
  assert.ok(pool.slice(12).every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 3) && pool[12] === '2026-03-25');
  assert.equal(estadualPool(2026, 'rj-a2')[0], '2026-04-29', 'Série A2 carioca de abril a agosto');
  assert.ok(a.slice(0, 8).every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 3) && a[7] === '2026-03-18', 'Série A às quartas durante os estaduais');
  // sábados primeiro; quartas só quando faltam datas
  const few = spreadDates(2026, '04-04', '05-30', 5);
  assert.ok(few.every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 6));
  const many = spreadDates(2026, '04-04', '05-30', 12);
  assert.ok(many.some((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 3) && new Set(many).size === 12);
});

test('Grupos regionais da Série D: 16 grupos de 6, no máximo 3 clubes do mesmo estado, em ordem geográfica', () => {
  const ufs = ['RJ', 'RJ', 'RJ', 'RJ', 'RJ', 'RJ', 'SP', 'SP', 'SP', 'SP', 'SP', 'AC', 'AC', 'AC'];
  const clubs = Array.from({ length: 96 }, (_, i) => ({ id: `c${String(i).padStart(2, '0')}`, state: ufs[i % ufs.length]! }));
  const groups = regionalGroups(clubs, 16);
  assert.equal(groups.length, 16);
  assert.ok(groups.every((g) => g.length === 6));
  assert.deepEqual(groups.flat().sort(), clubs.map((c) => c.id).sort());
  const stateOf = new Map(clubs.map((c) => [c.id, c.state]));
  for (const g of groups) for (const uf of new Set(g.map((c) => stateOf.get(c)))) assert.ok(g.filter((c) => stateOf.get(c) === uf).length <= 3, `${uf} com mais de 3 no grupo`);
  assert.ok(groups[0]!.some((c) => stateOf.get(c) === 'AC'), 'começa pelo norte (ordem geográfica)');
});

test('Séries C e D reais na carreira (base fixa): fases montadas conforme avançam, mata-mata com pênaltis, acessos, Série C cresce para 24 e Série D é remontada com 96', async () => {
  const w = baseUniverse().world;
  const club = w.clubs.find((c) => c.leagueId === 'bra-3')!;
  const db = await openDatabase(':memory:');
  createCareer(db, { ...w, seed: 'series-cd' }, coach, club.id, new Date(), [], ['bra-3', 'bra-4']); // C e D lance a lance (desempate do jogo decisivo na partida completa)
  const c = 'cmp_bra-3_2026', d = 'cmp_bra-4_2026';
  // criação: só a 1ª fase existe (Série C: turno único com 20; Série D: 16 grupos de 6 em ida e volta, até 3 do mesmo estado)
  assert.deepEqual(db.prepare("SELECT competition_id, stage_id FROM competition_stages WHERE competition_id LIKE 'cmp_%' ORDER BY competition_id").all().map((r) => `${r.competition_id}:${r.stage_id}`), [`${c}:f1`, `${d}:f1`]);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM competition_stages WHERE competition_id GLOB 'est_*' AND stage_id = 'f1'"), 29, 'os 29 estaduais começam com a 1ª fase');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = ?', c), 190);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = ?', d), 480);
  const dGroups = formatStateOf(db, d)!.state.stages.f1!.groups!;
  assert.equal(dGroups.length, 16);
  const stateOf = new Map(db.prepare("SELECT id, state FROM clubs WHERE league_id = 'bra-4'").all().map((r) => [String(r.id), String(r.state)]));
  for (const g of dGroups) for (const uf of new Set(g.map((x) => stateOf.get(x)))) assert.ok(g.filter((x) => stateOf.get(x) === uf).length <= 3);
  // temporada inteira
  const before = { d: new Set(db.prepare("SELECT id FROM clubs WHERE league_id = 'bra-4'").all().map((r) => String(r.id))) };
  for (let i = 0; i < 600; i++) { const r = advanceTime(db, 'nextMatchday'); simulateMatchday(db); if (!r.advanced && r.reason === 'season_complete') break; }
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = ?', c), 190 + 24 + 2, 'Série C: 1ª fase, 2 grupos de 4 em ida e volta, final');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = ?', d), 610, 'Série D: 610 jogos (como no regulamento)');
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM competitions WHERE id IN (?, ?) AND status = 'finished'", c, d), 2);
  // tabela de liga = 1ª fase (19 jogos por clube na Série C)
  const table = getCompetitionTable(db, c);
  assert.equal(table.rows.length, 20);
  assert.ok(table.rows.every((r) => r.played === 19));
  // confrontos empatados no agregado foram decididos nos pênaltis (registrados no jogo decisivo)
  const fs = formatStateOf(db, d)!;
  for (const s of ['f2', 'f3', 'f4', 'f5', 'sf', 'po', 'final']) fs.state.stages[s]!.ties!.forEach((_, i) => assert.ok(tieOutcome(fs.def, fs.state, s, i), `${s}/${i} decidido`));
  assert.ok(n(db, 'SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = ? AND pens_winner IS NOT NULL', d) > 0, 'houve decisão por pênaltis');
  const oc = formatOutcomesOf(db, c)!, od = formatOutcomesOf(db, d)!;
  assert.deepEqual([oc.complete, oc.promoted.length, oc.relegated.length, od.complete, od.promoted.length], [true, 4, 2, true, 6]);
  // calendário: nenhum clube brasileiro joga duas vezes com menos de 3 dias de intervalo (todas as competições); Série D nas datas oficiais
  const close = n(db, `WITH m AS (SELECT home_club_id c, match_date d FROM fixtures f JOIN competitions k ON k.id = f.competition_id WHERE k.country_id = 'bra'
    UNION ALL SELECT away_club_id, match_date FROM fixtures f JOIN competitions k ON k.id = f.competition_id WHERE k.country_id = 'bra')
    SELECT COUNT(*) AS n FROM m a JOIN m b ON a.c = b.c AND b.d > a.d AND julianday(b.d) - julianday(a.d) < 3`);
  assert.equal(close, 0, 'jogos com menos de 3 dias de intervalo');
  assert.deepEqual({ ...db.prepare('SELECT MIN(match_date) AS a, MAX(match_date) AS b FROM fixtures WHERE competition_id = ?').get(d) }, { a: '2026-04-04', b: '2026-09-12' });
  assert.equal(String(db.prepare("SELECT MIN(match_date) AS a FROM fixtures WHERE competition_id = 'cmp_bra-1_2026'").get()!.a), '2026-01-28');
  // estaduais: os 29 disputados até o fim, com campeão (troféu e premiação); os de estados com clubes na Série A acabam até 15/03
  const est = db.prepare("SELECT id, status, json_extract(format_json, '$.formatId') AS f FROM competitions WHERE kind = 'state' AND id GLOB 'est_*' AND season = 2026").all();
  assert.equal(est.length, 29);
  assert.ok(est.every((r) => r.status === 'finished'));
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM trophies t JOIN competitions c ON c.id = t.competition_id WHERE c.kind = 'state' AND c.id GLOB 'est_*' AND c.season = 2026"), 29);
  for (const uf of ['SP', 'RJ', 'MG', 'RS', 'PR', 'BA', 'SC', 'PA']) {
    const id = `est_${ESTADUAIS.find((e) => e.uf === uf && e.division === 1)!.id}_2026`;
    assert.ok(String(db.prepare('SELECT MAX(match_date) AS d FROM fixtures WHERE competition_id = ?').get(id)!.d) <= '2026-03-15', `${uf}: estadual até 15/03`);
  }
  // Copa do Brasil existe e nenhuma data dela coincide com uma data usada pelos estaduais
  const estDates = new Set(db.prepare("SELECT DISTINCT f.match_date AS d FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE c.kind = 'state' AND c.country_id = 'bra' AND c.id NOT LIKE 'cest%' AND c.id NOT IN ('est_sp-a2_2026', 'est_rj-a2_2026') AND c.season = 2026").all().map((r) => String(r.d)));
  const cupDays = db.prepare("SELECT DISTINCT match_date AS d FROM fixtures WHERE competition_id = 'cup_bra_2026'").all().map((r) => String(r.d));
  assert.ok(cupDays.length > 0 && cupDays.every((dd) => !estDates.has(dd)), 'Copa do Brasil fora das datas das elites estaduais e das regionais (as A2 não entram pela vaga do estadual)');
  const paulista = formatOutcomesOf(db, 'est_sp-a1_2026')!;
  const finalMonth = String(db.prepare("SELECT MAX(match_date) AS d FROM fixtures WHERE competition_id = 'est_sp-a1_2026'").get()!.d).slice(0, 7);
  assert.equal(n(db, "SELECT COALESCE(SUM(amount), 0) AS n FROM finance_months WHERE club_id = ? AND month = ? AND category = 'prize'", paulista.champion, finalMonth), 240_000, 'premiação do campeão paulista (economia 0,6 × 400 mil)');
  // visão por fases (tela de Competições): Série D com os 16 grupos e o mata-mata; Paulistão com campeão
  const vd = getStagedView(db, d);
  assert.deepEqual(vd.stages.map((x) => x.id), ['f1', 'f2', 'f3', 'f4', 'f5', 'sf', 'po', 'final']);
  assert.equal(vd.stages[0]!.groups.length, 16);
  assert.ok(vd.stages[0]!.groups.every((g) => g.rows.length === 6 && g.rows.every((r) => r.played === 10)));
  assert.equal(vd.stages[1]!.ties.length, 32);
  assert.ok(vd.stages[1]!.ties.every((t) => t.games.length === 2 && t.aggregate && t.winner && [t.a.id, t.b.id].includes(t.winner)));
  for (const t of vd.stages[1]!.ties) {
    const sum = t.games.reduce((acc, g) => (g.homeId === t.a.id ? [acc[0]! + g.homeGoals!, acc[1]! + g.awayGoals!] : [acc[0]! + g.awayGoals!, acc[1]! + g.homeGoals!]), [0, 0]);
    assert.deepEqual(t.aggregate, sum, 'agregado = soma dos dois jogos');
  }
  assert.ok(vd.stages.find((x) => x.id === 'po')!.side && vd.champion && vd.promoted.length === 6);
  const vsp = getStagedView(db, 'est_sp-a1_2026');
  assert.equal(vsp.kind, 'state');
  assert.deepEqual([vsp.champion?.id, vsp.relegated.length], [formatOutcomesOf(db, 'est_sp-a1_2026')!.champion, 2]);
  // copas regionais: as 3 disputadas (15/04 a 17/06), vagas por estado; Copa Verde com os títulos da Copa Norte e da Copa Centro-Oeste
  for (const r of REGIONAIS) {
    const id = `${r.id}_2026`, o = formatOutcomesOf(db, id)!;
    assert.ok(o.complete && o.champion, `${r.name} com campeão`);
    const span = { ...db.prepare('SELECT MIN(match_date) AS a, MAX(match_date) AS b FROM fixtures WHERE competition_id = ?').get(id) };
    assert.ok(String(span.a) >= '2026-04-15' && String(span.b) <= '2026-06-17', `${r.name}: ${span.a}..${span.b}`);
    const ufs = (formatStateOf(db, id)!.state.seeds).map((c) => String(db.prepare('SELECT state FROM clubs WHERE id = ?').get(c)!.state));
    for (const [uf, k] of Object.entries(r.spots)) assert.equal(ufs.filter((x) => x === uf).length, k, `${r.name}: vagas de ${uf}`);
  }
  // Copa do Nordeste: na 1ª fase, só A × B e C × D
  const ne = formatStateOf(db, 'reg_ne_2026')!.state.stages.f1!;
  const pairOf = new Map(ne.groups!.flatMap((g, i) => g.map((c) => [c, Math.floor(i / 2)] as const)));
  const groupOfNe = new Map(ne.groups!.flatMap((g, i) => g.map((c) => [c, i] as const)));
  assert.ok(ne.results.length === 50 && ne.results.every((r) => pairOf.get(r.home) === pairOf.get(r.away) && groupOfNe.get(r.home) !== groupOfNe.get(r.away)), 'Copa do Nordeste: A × B e C × D');
  const cv = formatOutcomesOf(db, 'reg_cv_2026')!;
  assert.ok(cv.titles.every((t) => t.club) && cv.titles.map((t) => t.name).join() === 'Copa Norte,Copa Centro-Oeste');
  // copas estaduais do 2º semestre: uma por estado (com clubes sem divisão), todas concluídas, de agosto em diante
  const copas = db.prepare("SELECT id, status FROM competitions WHERE id GLOB 'cest_*' AND season = 2026").all();
  assert.equal(copas.length, 27);
  assert.ok(copas.every((r) => r.status === 'finished'));
  assert.ok(String(db.prepare("SELECT MIN(f.match_date) AS d FROM fixtures f WHERE f.competition_id GLOB 'cest_*'").get()!.d) >= '2026-08-01');
  const copaChamp = (uf: string) => formatOutcomesOf(db, `cest_${uf.toLowerCase()}_2026`)!.champion!;
  const est26 = Object.fromEntries(['sp-a1', 'sp-a2', 'sc', 'rj-a2'].map((e) => [e, formatOutcomesOf(db, `est_${e}_2026`)!]));
  const elite = Object.fromEntries(ESTADUAIS.filter((e) => e.division === 1).map((e) => [e.uf, formatOutcomesOf(db, `est_${e.id}_2026`)!.ranking]));
  // virada: Série C com 24 (20 − 4 + 4 − 2 + 6); Série D remontada com 96; os rebaixados da C estão nela; quem sobe da D está na C
  startNextSeason(db);
  assert.deepEqual(['bra-1', 'bra-2', 'bra-3', 'bra-4'].map((l) => leagueCount(db, l)), [20, 20, 24, 96]);
  const league = (id: string) => String(db.prepare('SELECT league_id AS l FROM clubs WHERE id = ?').get(id)!.l);
  assert.ok(od.promoted.every((id) => league(id) === 'bra-3'), 'acesso da D para a C');
  assert.ok(oc.relegated.every((id) => league(id) === 'bra-4'), 'rebaixados da C na Série D');
  assert.ok(oc.promoted.every((id) => league(id) === 'bra-2'), 'acesso da C para a B');
  const after = new Set(db.prepare("SELECT id FROM clubs WHERE league_id = 'bra-4'").all().map((r) => String(r.id)));
  assert.ok([...before.d].some((id) => !after.has(id) && league(id) === 'bra-sd'), 'quem não se classificou volta para a "Sem divisão"');
  assert.ok([...after].some((id) => !before.d.has(id) && !oc.relegated.includes(id)), 'clubes sem divisão entraram pela vaga do estado');
  // estaduais na virada: quem caiu desce (elite → A2 em SP; A2 → reserva), quem subiu da A2 vai para a elite; Catarinense com 10 em 2027
  const sdiv = (id: string) => db.prepare('SELECT state_division AS d FROM clubs WHERE id = ?').get(id)!.d;
  assert.ok(est26['sp-a1']!.relegated.every((id) => sdiv(id) === 2) && est26['sp-a2']!.promoted.every((id) => sdiv(id) === 1) && est26['sp-a2']!.relegated.every((id) => sdiv(id) === null));
  assert.ok(est26.sc!.relegated.every((id) => sdiv(id) === null) && est26['rj-a2']!.promoted.every((id) => sdiv(id) === 1));
  const sizes = Object.fromEntries(db.prepare("SELECT json_extract(c.format_json, '$.formatId') AS f, COUNT(DISTINCT f.home_club_id) AS n FROM competitions c JOIN fixtures f ON f.competition_id = c.id WHERE c.kind = 'state' AND c.id GLOB 'est_*' AND c.season = 2027 GROUP BY c.id").all().map((r) => [String(r.f), Number(r.n)]));
  assert.equal(Object.keys(sizes).length, 29);
  assert.equal(sizes.sc, 10);
  for (const e of ESTADUAIS) assert.equal(sizes[e.id], e.format(2027).size, e.name);
  // Série D 2027: em cada estado, os mais bem colocados na elite do estadual fora das Séries A–C ganharam as vagas
  for (const [uf, spots] of Object.entries(SERIE_D_SPOTS)) {
    const viaCopa = uf === 'ES' || uf === 'SE' ? 1 : 0; // ES e SE: uma das vagas é do campeão da copa estadual
    const best = elite[uf]!.filter((id) => !['bra-1', 'bra-2', 'bra-3'].includes(league(id))).slice(0, spots - viaCopa);
    assert.ok(best.every((id) => league(id) === 'bra-4'), `${uf}: vagas da Série D pelo estadual`);
  }
  // Copa do Brasil 2027 (128): os 20 da Série A, 6 campeões de 2026 e as vagas das federações (a última pela copa estadual, exceto ES e SE)
  const cup27 = JSON.parse(String(db.prepare("SELECT format_json AS f FROM competitions WHERE id = 'cup_bra_2027'").get()!.f)) as { clubs: Array<{ id: string }>; entry: Record<string, number> };
  const inCup = new Set(cup27.clubs.map((c) => c.id));
  assert.equal(inCup.size, 128);
  const serieA27 = new Set(db.prepare("SELECT id FROM clubs WHERE league_id = 'bra-1'").all().map((r) => String(r.id)));
  const champs = [oc.champion, od.champion, formatOutcomesOf(db, 'reg_ne_2026')!.champion, ...cv.titles.map((t) => t.club), formatOutcomesOf(db, 'reg_ss_2026')!.champion];
  assert.ok(champs.every((c) => inCup.has(c!)), 'campeões de 2026 na Copa do Brasil 2027');
  assert.ok(champs.filter((c) => !serieA27.has(c!)).every((c) => cup27.entry[c!] === 2), 'campeões (fora da Série A) estreiam na 3ª fase');
  // vagas das federações = quem estreia na 1ª ou na 2ª fase (Série A na 5ª, campeões na 3ª)
  assert.equal(Object.values(cup27.entry).filter((st) => st === 2).length, 6, '6 vagas do critério 2 na 3ª fase');
  const fedClubs = Object.entries(cup27.entry).filter(([, st]) => st <= 1).map(([c]) => c);
  assert.equal(fedClubs.length, 102);
  for (const [uf, spots] of Object.entries(COPA_DO_BRASIL_SPOTS)) {
    const k = fedClubs.filter((c) => String(db.prepare('SELECT state FROM clubs WHERE id = ?').get(c)!.state) === uf).length;
    assert.equal(k, spots, `${uf}: vagas da federação na Copa do Brasil`);
    // pela classificação do estadual de 2026: os mais bem colocados ainda sem vaga (a última pode ser do campeão da copa estadual)
    const viaCopa = uf === 'ES' || uf === 'SE' ? 0 : 1;
    const first = elite[uf]!.filter((c) => !serieA27.has(c) && cup27.entry[c] !== 2).slice(0, spots - viaCopa);
    assert.ok(first.every((c) => fedClubs.includes(c)), `${uf}: vagas da Copa do Brasil pela classificação do estadual`);
  }
  for (const uf of ['BA', 'AL', 'MS']) { const c = copaChamp(uf); assert.ok(inCup.has(c) || serieA27.has(c), `${uf}: campeão da copa estadual na Copa do Brasil`); }
  for (const uf of ['ES', 'SE']) { const c = copaChamp(uf); assert.ok(['bra-4', 'bra-3', 'bra-2', 'bra-1'].includes(league(c)), `${uf}: campeão da copa estadual na Série D`); }
  // nova temporada: Série C de 24 em turno único (23 rodadas) e Série D de novo com 96
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = 'cmp_bra-3_2027'"), 276);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = 'cmp_bra-4_2027'"), 480);
  // dinheiro: saldo = inicial + extrato para todos os clubes
  for (const cl of w.clubs.slice(0, 40)) assert.equal(n(db, 'SELECT balance AS n FROM clubs WHERE id = ?', cl.id), cl.balance + n(db, 'SELECT COALESCE(SUM(amount), 0) AS n FROM finance_months WHERE club_id = ?', cl.id), `saldo de ${cl.id}`);
});
