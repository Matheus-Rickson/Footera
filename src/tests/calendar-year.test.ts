import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { advanceTime, getCareerState, getClubCalendar } from '../database/repositories/competitionRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import { getContracts, getSeasonStatus, isSeasonComplete, startNextSeason } from '../database/repositories/seasonRepository.ts';
import { allCountrySeasons, countrySeason } from '../database/repositories/countrySeasonRepository.ts';
import { contractEndIn, defaultSeasonStart, renewedEnd, seasonBounds, seasonLabelFor, seasonOfDate, yearInSeason } from '../game/career-engine/calendar.ts';
import type { SqlDb } from '../database/types.ts';
import { CONFIDENCE } from '../game/board-engine/board.ts';
import { makePoster } from '../database/repositories/financeRepository.ts';
import { executeTransfer } from '../database/repositories/transferRepository.ts';
import { rowToPlayer } from '../database/repositories/worldRepository.ts';
import type { Coach, World } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
const countryOfClub = (w: World, clubId: string) => w.clubs.find((c) => c.id === clubId)!.countryId;

/** Mundo gerado com alguns países no ano civil (por código). */
function worldWith(seed: string, civil: string[]): World {
  const w = generateWorld({ seed, teamsPerLeagueOverride: 6 });
  for (const c of w.countries) if (civil.includes(c.code)) c.seasonStart = '01-01';
  return w;
}
/** Avança e joga até a data `until` (exclusiva), parando antes se o relógio não andar. */
function playUntil(db: SqlDb, until: string) {
  for (let i = 0; i < 400 && getCareerState(db).gameDate < until; i++) {
    const r = advanceTime(db, 'nextMatchday');
    simulateMatchday(db);
    if (!r.advanced && r.reason === 'season_complete') break;
  }
}

test('Calendário: limites, rótulos, contratos e datas das temporadas de julho e de ano civil', () => {
  assert.deepEqual(seasonBounds(2026, '07-01'), { starts: '2026-07-01', turnover: '2027-07-01' });
  assert.deepEqual(seasonBounds(2027, '01-01'), { starts: '2027-01-01', turnover: '2028-01-01' });
  assert.deepEqual([seasonOfDate('2027-03-10', '07-01'), seasonOfDate('2027-03-10', '01-01')], [2026, 2027]);
  assert.deepEqual([seasonLabelFor(2026, '07-01'), seasonLabelFor(2027, '01-01'), seasonLabelFor(2026, '01-01', true)], ['2026/27', '2027', '2026 (transição)']);
  // contrato de 3 temporadas assinado em março: julho → 30/jun/2029 (a temporada 2026/27 conta); ano civil → 31/dez/2029 (2027 conta)
  assert.deepEqual([contractEndIn('2027-03-10', 3, '07-01'), contractEndIn('2027-03-10', 3, '01-01')], ['2029-06-30', '2029-12-31']);
  // renovar por 2: o contrato atual que vence em 30/jun/2027 (base) num clube de ano civil vence de fato na virada de 2028
  assert.deepEqual([renewedEnd('2027-06-30', 2, '07-01'), renewedEnd('2027-06-30', 2, '01-01'), renewedEnd('2027-12-31', 1, '01-01')], ['2029-06-30', '2029-12-31', '2028-12-31']);
  assert.deepEqual([yearInSeason('02-17', 2027, '01-01'), yearInSeason('02-17', 2026, '07-01'), yearInSeason('08-20', 2026, '07-01')], [2027, 2027, 2026]);
  assert.deepEqual(['BRA', 'ARG', 'IRL', 'JPN', 'ENG'].map(defaultSeasonStart), ['01-01', '01-01', '01-01', '07-01', '07-01']);
});

test('Clube de ano civil: a carreira começa em 1º/jan/2026 com as divisões da base; os países de julho já estão na metade de 2025/26', async () => {
  const w = worldWith('civil-start', ['BRA']);
  const clubId = w.clubs.find((c) => w.countries.find((x) => x.id === c.countryId)!.code === 'BRA')!.id;
  const bra = countryOfClub(w, clubId);
  const db = await openDatabase(':memory:');
  createCareer(db, w, coach, clubId);
  const st = getCareerState(db);
  assert.deepEqual([st.gameDate, st.season], ['2026-01-01', 2026]);
  assert.equal(String(db.prepare('SELECT season_country AS c FROM career').get()!.c), bra);
  assert.deepEqual(countrySeason(db, bra), { countryId: bra, season: 2026, starts: '2026-01-01', turnover: '2027-01-01', transition: false, start: '01-01', label: '2026' });
  // o Brasil ficou parado jul–dez/2025: nenhuma competição antes, divisões como na base, nada jogado ainda
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM competitions WHERE country_id = ? AND season < 2026', bra), 0, 'sem torneio de transição');
  for (const c of w.clubs.filter((x) => x.countryId === bra)) assert.equal(String(db.prepare('SELECT league_id FROM clubs WHERE id = ?').get(c.id)!.league_id), c.leagueId, `divisão da base: ${c.id}`);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE c.country_id = ? AND f.status = 'played'", bra), 0);
  const firstLeague = String(db.prepare("SELECT MIN(f.match_date) AS d FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE c.country_id = ? AND c.season = 2026 AND c.kind = 'league'").get(bra)!.d);
  assert.ok(firstLeague >= '2026-01-31' && firstLeague <= '2026-02-06', `liga começa depois da pré-temporada (${firstLeague})`);
  // países de julho: temporada 2025/26 normal (ida e volta), com o 1º turno disputado e nada pendente antes de hoje
  for (const cs of allCountrySeasons(db).filter((x) => x.countryId !== bra)) {
    assert.deepEqual([cs.season, cs.starts, cs.turnover, cs.transition, cs.label], [2025, '2025-07-01', '2026-07-01', false, '2025/26']);
    const lg = db.prepare("SELECT c.id FROM competitions c WHERE c.country_id = ? AND c.season = 2025 AND c.kind = 'league' ORDER BY c.id LIMIT 1").get(cs.countryId)!;
    const played = n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = ? AND status = 'played'", String(lg.id));
    const all = n(db, 'SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = ?', String(lg.id));
    const first = String(db.prepare('SELECT MIN(match_date) AS d FROM fixtures WHERE competition_id = ?').get(String(lg.id))!.d);
    // mundo de teste com 6 times por liga (ida e volta termina antes de janeiro); na base real, ~metade (ver docs/CAREER_CYCLE.md)
    assert.ok(first.startsWith('2025-08') && played > 0 && all > 0, `${cs.countryId}: temporada 2025/26 em andamento (${played}/${all}, desde ${first})`);
  }
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled' AND match_date < '2026-01-01'"), 0);
  // diretoria nova, caixa de entrada vazia, trabalho começa hoje, sem marcas da simulação
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM news WHERE date < '2026-01-01'"), 0, 'nada do período simulado na caixa de entrada');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM job_offers'), 0);
  assert.equal(Number(db.prepare('SELECT season FROM board_state WHERE id = 1').get()!.season), 2026);
  assert.equal(Number(db.prepare('SELECT confidence FROM board_state WHERE id = 1').get()!.confidence), CONFIDENCE.start, 'a diretoria não avaliou jul–dez');
  assert.equal(String(db.prepare('SELECT start_date FROM coach_spells WHERE end_date IS NULL').get()!.start_date), '2026-01-01');
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM meta WHERE key = 'fast_forward'"), 0);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM player_status WHERE injury_note LIKE 'Lesão no treino%'"), 0, 'sem rotina de treino diária antes da carreira');
  // telas: rótulos e meses do ano civil
  const ss = getSeasonStatus(db);
  assert.deepEqual([ss.label, ss.nextLabel, ss.turnoverDate, ss.complete], ['2026', '2027', '2027-01-01', false]);
  const cal = getClubCalendar(db);
  assert.deepEqual([cal.seasonLabel, cal.seasonStarts, cal.turnover], ['2026', '2026-01-01', '2027-01-01']);
  assert.ok(cal.fixtures.every((f) => f.date.startsWith('2026-')));
  assert.ok(getContracts(db).every((c) => c.renewEnds.every((e) => e.endsWith('-12-31'))));
  // contratação: o contrato vence no fim de uma temporada do país do comprador (31/dez aqui, 30/jun num clube de julho)
  const julyClub = w.clubs.find((c) => c.countryId !== bra)!;
  const [p1, p2] = db.prepare('SELECT * FROM players WHERE club_id IS NOT NULL AND club_id NOT IN (?, ?) AND retired = 0 ORDER BY id LIMIT 2').all(clubId, julyClub.id).map(rowToPlayer);
  executeTransfer(db, makePoster(db, clubId), { player: p1!, toClubId: clubId, fee: 0, wage: 1000, years: 2, date: '2026-01-01', kind: 'purchase' });
  executeTransfer(db, makePoster(db, clubId), { player: p2!, toClubId: julyClub.id, fee: 0, wage: 1000, years: 2, date: '2026-01-01', kind: 'ai' });
  assert.deepEqual([p1!.id, p2!.id].map((id) => String(db.prepare('SELECT contract_end FROM players WHERE id = ?').get(id)!.contract_end)), ['2027-12-31', '2027-06-30']);
  // a temporada 2025/26 termina e os países de julho viram sozinhos em 1º/jul
  playUntil(db, '2026-07-02');
  for (const cs of allCountrySeasons(db).filter((x) => x.countryId !== bra)) assert.deepEqual([cs.season, cs.turnover], [2026, '2027-07-01']);
  assert.ok(n(db, 'SELECT COUNT(*) AS n FROM trophies WHERE season = 2025') > 0, 'campeões de 2025/26 registrados');
});

test('Viradas por país: o de ano civil vira sozinho em 1º/jan; o treinador vira o seu em 1º/jul; o relógio para só na virada dele', async () => {
  const w = worldWith('civil-auto', ['ENG']);
  const clubId = w.clubs.find((c) => w.countries.find((x) => x.id === c.countryId)!.code === 'BRA')!.id;
  const eng = w.countries.find((c) => c.code === 'ENG')!.id;
  const db = await openDatabase(':memory:');
  createCareer(db, w, coach, clubId);
  assert.equal(getCareerState(db).gameDate, '2026-07-01', 'clube de julho: começa em 1º/jul');
  // a Inglaterra (ano civil) está na metade da temporada 2026 (jan–jun simulados na criação), sem transição
  const e0 = countrySeason(db, eng);
  assert.deepEqual([e0.season, e0.starts, e0.turnover, e0.transition], [2026, '2026-01-01', '2027-01-01', false]);
  assert.ok(n(db, "SELECT COUNT(*) AS n FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE c.country_id = ? AND f.status = 'played'", eng) > 0, 'jan–jun disputados');
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM competitions WHERE country_id <> ? AND season < 2026", eng), 0, 'países de julho parados antes de 1º/jul');
  for (const c of w.clubs.filter((x) => x.countryId !== eng)) assert.equal(String(db.prepare('SELECT league_id FROM clubs WHERE id = ?').get(c.id)!.league_id), c.leagueId, `divisão da base: ${c.id}`);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM news WHERE date < '2026-07-01'"), 0);
  assert.equal(String(db.prepare('SELECT start_date FROM coach_spells WHERE end_date IS NULL').get()!.start_date), '2026-07-01');
  const initial = new Map(w.clubs.map((c) => [c.id, c.balance]));
  // suspensões fictícias (9 jogos) nos ingleses: a virada de janeiro zera; nenhuma suspensão real chega a 9
  db.prepare('INSERT INTO player_status (player_id, suspension_matches) SELECT p.id, 9 FROM players p JOIN clubs c ON c.id = p.club_id WHERE c.country_id = ? ON CONFLICT(player_id) DO UPDATE SET suspension_matches = 9').run(eng);
  // contratos que vencem em 31/dez/2026 nos clubes ingleses: a IA renova (ou libera) na virada de janeiro, com fim em 31/dez
  const expiring = db.prepare('SELECT p.id FROM players p JOIN clubs c ON c.id = p.club_id WHERE c.country_id = ? ORDER BY p.id LIMIT 60').all(eng).map((r) => String(r.id));
  for (const id of expiring) db.prepare("UPDATE players SET contract_end = '2026-12-31' WHERE id = ?").run(id);
  playUntil(db, '2027-01-02');
  assert.ok(getCareerState(db).gameDate >= '2027-01-01');
  const e = countrySeason(db, eng);
  assert.deepEqual([e.season, e.turnover, e.transition], [2027, '2028-01-01', false], 'virada automática da Inglaterra em 1º/jan');
  assert.ok(n(db, "SELECT COUNT(*) AS n FROM competitions WHERE country_id = ? AND season = 2027 AND kind = 'league'", eng) > 0);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM player_status WHERE suspension_matches = 9'), 0, 'suspensões zeradas na virada da Inglaterra');
  // contratos renovados pela IA na virada de janeiro vencem em 31/dez
  const renewed = expiring.map((id) => db.prepare('SELECT p.contract_end, c.country_id FROM players p LEFT JOIN clubs c ON c.id = p.club_id WHERE p.id = ?').get(id)!)
    .filter((r) => String(r.country_id) === eng).map((r) => String(r.contract_end));
  assert.ok(renewed.length > 0 && renewed.every((d) => d.endsWith('-12-31') && d >= '2027-12-31'), `renovações da virada de janeiro no fim do ano: ${renewed.join(', ')}`);
  // o país do treinador ainda está em 2026/27
  assert.equal(getCareerState(db).season, 2026);
  assert.equal(getSeasonStatus(db).label, '2026/27');
  playUntil(db, '2027-07-01');
  assert.equal(isSeasonComplete(db), true);
  assert.equal(getCareerState(db).gameDate, '2027-07-01');
  assert.equal(advanceTime(db, 'day').reason, 'season_complete', 'para na virada do treinador');
  const engBefore = countrySeason(db, eng).season;
  startNextSeason(db);
  assert.equal(countrySeason(db, eng).season, engBefore, 'a virada de julho não mexe na Inglaterra (ano civil)');
  assert.equal(getCareerState(db).season, 2027);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM competitions WHERE country_id = ? AND season = 2028", eng), 0);
  // dinheiro: saldo = inicial + extrato, para todos
  for (const [id, start] of initial) assert.equal(n(db, 'SELECT balance AS n FROM clubs WHERE id = ?', id), start + n(db, 'SELECT COALESCE(SUM(amount), 0) AS n FROM finance_months WHERE club_id = ?', id), `saldo de ${id}`);
});

test('Temporada de ano civil completa: os países de julho viram sozinhos no meio do ano; a virada do treinador é em 1º/jan', async () => {
  const w = worldWith('civil-full', ['BRA']);
  const clubId = w.clubs.find((c) => w.countries.find((x) => x.id === c.countryId)!.code === 'BRA')!.id;
  const bra = countryOfClub(w, clubId);
  const db = await openDatabase(':memory:');
  createCareer(db, w, coach, clubId);
  const initial = new Map(w.clubs.map((c) => [c.id, c.balance]));
  // contrato que vence em 30/jun (base) num clube de ano civil: o jogador fica até a virada de janeiro
  const keeper = String(db.prepare("SELECT p.id FROM players p JOIN clubs c ON c.id = p.club_id WHERE c.country_id = ? AND p.club_id <> ? ORDER BY p.id LIMIT 1").get(bra, clubId)!.id);
  db.prepare("UPDATE players SET contract_end = '2026-06-30' WHERE id = ?").run(keeper);
  playUntil(db, '2026-07-05');
  const other = allCountrySeasons(db).find((x) => x.countryId !== bra)!;
  assert.deepEqual([other.season, other.turnover], [2026, '2027-07-01'], 'virada automática de julho dos outros países');
  assert.ok(db.prepare('SELECT club_id FROM players WHERE id = ?').get(keeper)!.club_id != null, 'contrato de 30/jun não vence no meio da temporada de ano civil');
  assert.equal(getSeasonStatus(db).label, '2026');
  playUntil(db, '2027-01-01');
  assert.equal(getCareerState(db).gameDate, '2027-01-01');
  assert.equal(isSeasonComplete(db), true);
  const r = startNextSeason(db);
  assert.equal(r.season, 2027);
  assert.deepEqual([countrySeason(db, bra).season, getSeasonStatus(db).label, getCareerState(db).season], [2027, '2027', 2027]);
  assert.ok(n(db, "SELECT COUNT(*) AS n FROM competitions WHERE country_id = ? AND season = 2027 AND kind = 'cup'", bra) <= 2, 'copa e supercopa');
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM season_results WHERE season = 2026 AND club_id = ?", clubId), 1, 'histórico da temporada 2026');
  for (const [id, start] of initial) assert.equal(n(db, 'SELECT balance AS n FROM clubs WHERE id = ?', id), start + n(db, 'SELECT COALESCE(SUM(amount), 0) AS n FROM finance_months WHERE club_id = ?', id), `saldo de ${id}`);
});
