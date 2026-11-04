import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { createRng } from '../game/rng.ts';
import { advanceTime, getCareerState, moveClock } from '../database/repositories/competitionRepository.ts';
import { withTransaction, type SqlDb } from '../database/types.ts';
import { ATTR_MIN_KNOWLEDGE, estimateAttributes, estimateRange, scoutVerdict } from '../game/transfer-engine/transfer.ts';
import { dailyGain, MAX_SCOUTS, scoutCandidates } from '../game/scouting-engine/scouting.ts';
import { COUNTRY_TEMPLATES } from '../game/world/names.ts';
import { assignScout, fireScout, getPlayerProfile, getScoutingOverview, hireScout, ScoutError, setShortlisted } from '../database/repositories/scoutRepository.ts';
import { getYouthOverview, promoteYouth, releaseYouth, youthIntake, YouthError } from '../database/repositories/youthRepository.ts';
import { makeOffer, searchMarket, TransferError } from '../database/repositories/transferRepository.ts';
import { getContracts, startNextSeason } from '../database/repositories/seasonRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import { getNews } from '../database/repositories/newsRepository.ts';
import type { Coach } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
async function setup(seed = 'sy', teams = 6) {
  const world = generateWorld({ seed, teamsPerLeagueOverride: teams });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  return { db, world, clubId: world.clubs[0]!.id, initial: new Map(world.clubs.map((c) => [c.id, c.balance])) };
}
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
function assertBooksBalance(db: SqlDb, initial: Map<string, number>) {
  for (const [id, start] of initial) assert.equal(n(db, 'SELECT balance AS n FROM clubs WHERE id = ?', id), start + n(db, 'SELECT COALESCE(SUM(amount), 0) AS n FROM finance_months WHERE club_id = ?', id), `saldo de ${id}`);
}
/** Avança o relógio sem jogar partidas (só mercado, olheiros, peneira e finanças), para testar o dia a dia. */
const clockTo = (db: SqlDb, to: string) => withTransaction(db, () => moveClock(db, getCareerState(db).gameDate, to, new Date('2030-01-01T00:00:00Z')));
const know = (db: SqlDb, id: string) => n(db, 'SELECT COALESCE((SELECT knowledge FROM scout_knowledge WHERE player_id = ?), 0) AS n', id);

test('Estimativas: sem conhecimento é a fórmula anterior; com conhecimento a faixa estreita, sempre contém a força real e converge ao potencial oculto', () => {
  for (let i = 0; i < 200; i++) {
    const ov = 30 + (i % 60), pe = ov + (i % 9), ph = ov + (i % 7);
    // fórmula anterior aos olheiros, reproduzida aqui
    const rng = createRng(`scout:s:p${i}`);
    const o = ov + rng.int(-4, 4), p = pe + rng.int(-3, 3);
    const cl = (v: number) => Math.max(1, Math.min(100, v));
    assert.deepEqual(estimateRange(ov, pe, 's', `p${i}`, 0, ph), { overall: { low: cl(o - 6), high: cl(o + 6) }, potential: { low: cl(p - 8), high: cl(Math.max(p + 8, o + 6)) } });
    let prev = Infinity;
    for (const k of [0, 25, 50, 75, 100]) {
      const e = estimateRange(ov, pe, 's', `p${i}`, k, ph);
      assert.ok(e.overall.low <= ov && ov <= e.overall.high, `k=${k}: faixa não contém a força real`);
      const width = e.overall.high - e.overall.low + e.potential.high - e.potential.low;
      assert.ok(width <= prev, `k=${k}: faixa alargou`); prev = width;
    }
    const full = estimateRange(ov, pe, 's', `p${i}`, 100, ph);
    assert.ok(full.overall.high - full.overall.low <= 2 && full.potential.low <= ph && ph <= full.potential.high);
  }
});

test('Olheiros: candidatos determinísticos por mês; contratar, limite, salário mensal pela porta única de dinheiro e demissão com multa', async () => {
  const { db, clubId, initial } = await setup('sy-hire');
  const cands = scoutCandidates('sy-hire', '2026-07', COUNTRY_TEMPLATES, 0.6);
  assert.equal(cands.length, 5);
  assert.deepEqual(cands, scoutCandidates('sy-hire', '2026-07', COUNTRY_TEMPLATES, 0.6));
  assert.notDeepEqual(cands.map((c) => c.id), scoutCandidates('sy-hire', '2026-08', COUNTRY_TEMPLATES, 0.6).map((c) => c.id));
  const ov = getScoutingOverview(db);
  assert.deepEqual(ov.candidates.map((c) => c.id), cands.map((c) => c.id));
  for (const c of ov.candidates.slice(0, MAX_SCOUTS)) hireScout(db, c.id);
  assert.throws(() => hireScout(db, ov.candidates[4]!.id), ScoutError, 'limite de olheiros');
  assert.throws(() => hireScout(db, ov.candidates[0]!.id), ScoutError);
  assert.throws(() => hireScout(db, 'sct_inventado'), ScoutError);
  const after = getScoutingOverview(db);
  assert.equal(after.scouts.length, MAX_SCOUTS);
  assert.equal(after.candidates.length, 1, 'contratados saem da lista');
  clockTo(db, '2026-08-02');
  assert.equal(n(db, "SELECT amount AS n FROM finance_months WHERE club_id = ? AND month = '2026-08' AND category = 'scouting'", clubId), -after.monthlyCost);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM finance_months WHERE club_id <> ? AND category = 'scouting'", clubId), 0, 'só o usuário tem olheiros');
  const s = after.scouts[0]!;
  assert.equal(fireScout(db, s.id), s.salary * 3);
  assert.equal(n(db, "SELECT amount AS n FROM finance_ledger WHERE category = 'scouting' AND description LIKE 'Rescisão%'"), -s.salary * 3);
  assert.equal(getScoutingOverview(db).scouts.length, MAX_SCOUTS - 1);
  assertBooksBalance(db, initial);
  // contrato de 2 anos vence e o olheiro sai
  db.prepare("UPDATE scouts SET contract_end = '2026-08-02'").run();
  clockTo(db, '2026-08-03');
  assert.equal(getScoutingOverview(db).scouts.length, 0);
  assert.ok(getNews(db).some((x) => x.kind === 'staff' && x.title.includes('Fim de contrato')));
});

test('Olheiros: designado ao próprio país só observa jogadores de lá (nunca os seus nem os da base); a lista de observação chega a 100% e estreita o mercado', async () => {
  const { db, clubId } = await setup('sy-work');
  const ov = getScoutingOverview(db);
  const best = [...ov.candidates].sort((a, b) => b.ability - a.ability);
  hireScout(db, best[0]!.id); hireScout(db, best[1]!.id);
  const [countryScout, listScout] = getScoutingOverview(db).scouts;
  assignScout(db, countryScout!.id, { kind: 'country', countryCode: 'BRA' }); // o país do clube do usuário: precisa ignorar o próprio elenco
  assignScout(db, listScout!.id, { kind: 'shortlist' });
  assert.throws(() => assignScout(db, countryScout!.id, { kind: 'country', countryCode: 'XXX' }), ScoutError);
  const target = searchMarket(db, { name: '' }).find((p) => p.nationality === 'ENG' && p.clubId !== null)!;
  assert.equal(target.knowledge, 0);
  setShortlisted(db, target.id, true);
  const own = String(db.prepare('SELECT id FROM players WHERE club_id = ? LIMIT 1').get(clubId)!.id);
  assert.throws(() => setShortlisted(db, own, true), ScoutError);
  const days = Math.ceil(100 / (dailyGain(listScout!.ability) * 3));
  clockTo(db, `2026-07-${String(1 + days).padStart(2, '0')}`);
  assert.equal(know(db, target.id), 100, 'jogador da lista totalmente conhecido');
  const now = searchMarket(db, { name: target.name }).find((p) => p.id === target.id)!;
  assert.equal(now.knowledge, 100);
  assert.ok(now.estOverall.high - now.estOverall.low < target.estOverall.high - target.estOverall.low, 'faixa estreitou');
  assert.ok(!('overall' in now) && !('potentialHidden' in now), 'continua sem vazar valores reais');
  const observed = db.prepare('SELECT k.player_id, p.club_id, p.youth_club_id, co.code FROM scout_knowledge k JOIN players p ON p.id = k.player_id LEFT JOIN clubs c ON c.id = p.club_id LEFT JOIN countries co ON co.id = c.country_id').all();
  // o olheiro de país concentra o esforço: 5 jogadores acompanhados por dia, cada um com o ganho cheio (relatórios concluídos, não 1.600 jogadores a 10%)
  const deep = observed.filter((r) => r.code === 'BRA' && know(db, String(r.player_id)) >= dailyGain(countryScout!.ability) * days * 0.99);
  assert.equal(deep.length, 5, 'olheiro do país acompanhou os mesmos 5 jogadores todos os dias');
  for (const r of observed) {
    assert.notEqual(r.club_id, clubId);
    assert.equal(r.youth_club_id, null);
    assert.ok(r.code === 'BRA' || String(r.player_id) === target.id, `observou fora do país designado: ${String(r.player_id)}`);
  }
  assert.ok(getScoutingOverview(db).reports.some((p) => p.id === target.id));
  // em um mês de trabalho, o olheiro de país conclui vários relatórios completos
  clockTo(db, '2026-08-15');
  const done = n(db, `SELECT COUNT(*) AS n FROM scout_knowledge k JOIN players p ON p.id = k.player_id JOIN clubs c ON c.id = p.club_id
    JOIN countries co ON co.id = c.country_id WHERE co.code = 'BRA' AND k.knowledge >= 100`);
  assert.ok(done >= 10, `só ${done} relatórios completos em ~6 semanas`);
  assert.ok(getScoutingOverview(db).reports.length >= 10);
});

test('Base: academias em todos os clubes, fora do elenco principal, do mercado e das propostas; salários na categoria própria', async () => {
  const { db, clubId, initial } = await setup('sy-youth');
  for (const c of db.prepare('SELECT id FROM clubs').all()) assert.ok(n(db, 'SELECT COUNT(*) AS n FROM players WHERE youth_club_id = ?', String(c.id)) >= 6);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM players WHERE youth_club_id IS NOT NULL AND club_id IS NOT NULL'), 0);
  const y = getYouthOverview(db);
  assert.ok(y.players.length >= 6 && y.players.every((p) => p.age >= 15 && p.age <= 18));
  const youthIds = new Set(db.prepare('SELECT id FROM players WHERE youth_club_id IS NOT NULL').all().map((r) => String(r.id)));
  assert.ok(getContracts(db).every((c) => !youthIds.has(c.id)), 'base fora do elenco principal');
  assert.ok(searchMarket(db, {}).every((p) => !youthIds.has(p.id)) && searchMarket(db, { freeOnly: true }).every((p) => !youthIds.has(p.id)));
  const otherYouth = String(db.prepare('SELECT id FROM players WHERE youth_club_id IS NOT NULL AND youth_club_id <> ? LIMIT 1').get(clubId)!.id);
  assert.throws(() => makeOffer(db, { playerId: otherYouth, fee: 1000, wage: 1000, years: 1 }), TransferError);
  assert.throws(() => setShortlisted(db, otherYouth, true), ScoutError);
  clockTo(db, '2026-07-02');
  assert.equal(n(db, "SELECT amount AS n FROM finance_months WHERE club_id = ? AND category = 'youth'", clubId), -n(db, 'SELECT SUM(salary) AS n FROM players WHERE youth_club_id = ?', clubId));
  assertBooksBalance(db, initial);
});

test('Peneira: a safra chega em 15/mar uma única vez (mesmo saltando dias), aos 15–16 anos, na base, com notícia', async () => {
  const { db, clubId } = await setup('sy-intake');
  const before = n(db, 'SELECT COUNT(*) AS n FROM players WHERE youth_club_id IS NOT NULL');
  db.exec("UPDATE fixtures SET status = 'played', home_goals = 0, away_goals = 0"); // sem partidas no caminho
  clockTo(db, '2027-03-14');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM players WHERE youth_club_id IS NOT NULL'), before);
  clockTo(db, '2027-04-30');
  const fresh = db.prepare("SELECT birth_date, youth_club_id FROM players WHERE id LIKE 'plr_y2027_%'").all();
  assert.ok(fresh.length >= 4 * 6 * 2, `safra pequena: ${fresh.length}`);
  for (const r of fresh) {
    const age = 2027 - Number(String(r.birth_date).slice(0, 4)) - (String(r.birth_date).slice(5) > '03-15' ? 1 : 0);
    assert.ok(age >= 15 && age <= 16, `idade ${age}`);
    assert.notEqual(r.youth_club_id, null);
  }
  clockTo(db, '2027-06-30');
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM players WHERE id LIKE 'plr_y2027_%'"), fresh.length, 'uma única safra por temporada');
  assert.equal(withTransaction(db, () => youthIntake(db, '2027-03-15')), 0, 'chamar de novo no mesmo dia não gera outra safra');
  assert.ok(getNews(db).some((x) => x.kind === 'youth' && x.title.startsWith('Peneira')));
  assert.ok(getYouthOverview(db).lastIntake!.names.length >= 3);
  assert.equal(getYouthOverview(db).nextIntake, '2028-03-15');
  void clubId;
});

test('Base: promover cria contrato profissional e respeita o limite de 30; dispensar torna o jovem livre com pretensão pelo valor', async () => {
  const { db, clubId } = await setup('sy-promote');
  const [a, b] = getYouthOverview(db).players;
  promoteYouth(db, a!.id);
  const row = db.prepare('SELECT club_id, youth_club_id, contract_end FROM players WHERE id = ?').get(a!.id)!;
  assert.deepEqual([String(row.club_id), row.youth_club_id, String(row.contract_end)], [clubId, null, '2029-06-30']);
  assert.ok(getContracts(db).some((c) => c.id === a!.id));
  assert.throws(() => promoteYouth(db, a!.id), YouthError, 'não está mais na base');
  const filler = db.prepare('SELECT id FROM players WHERE youth_club_id IS NOT NULL AND youth_club_id <> ? LIMIT 10').all(clubId).map((r) => String(r.id));
  const size = n(db, 'SELECT COUNT(*) AS n FROM players WHERE club_id = ?', clubId);
  for (const id of filler.slice(0, 30 - size)) db.prepare('UPDATE players SET club_id = ?, youth_club_id = NULL WHERE id = ?').run(clubId, id);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM players WHERE club_id = ?', clubId), 30);
  assert.throws(() => promoteYouth(db, b!.id), /máximo de 30/);
  releaseYouth(db, b!.id);
  const freed = searchMarket(db, { freeOnly: true, name: b!.name }).find((p) => p.id === b!.id)!;
  assert.ok(freed && freed.clubId === null);
  const mv = n(db, 'SELECT market_value AS n FROM players WHERE id = ?', b!.id);
  assert.equal(freed.salary, Math.max(1500, Math.round((mv * 0.012) / 100) * 100));
  assert.throws(() => releaseYouth(db, b!.id), YouthError);
});

test('Virada: jovens de 19 do usuário saem da base; com elenco incompleto, o melhor jovem do setor é promovido antes de gerar reposição', async () => {
  const { db, clubId } = await setup('sy-turn');
  const old = db.prepare("SELECT id FROM players WHERE youth_club_id = ? ORDER BY id LIMIT 1").get(clubId)!;
  db.prepare("UPDATE players SET birth_date = '2008-01-01' WHERE id = ?").run(String(old.id)); // 19 anos na virada
  // goleiro da base e só 1 goleiro no principal
  const gkYouth = String(db.prepare("SELECT id FROM players WHERE youth_club_id = ? AND id <> ? ORDER BY id LIMIT 1").get(clubId, String(old.id))!.id);
  db.prepare("UPDATE players SET position = 'GK', birth_date = '2010-01-01' WHERE id = ?").run(gkYouth);
  const gks = db.prepare("SELECT id FROM players WHERE club_id = ? AND position = 'GK' ORDER BY overall").all(clubId).map((r) => String(r.id));
  for (const id of gks.slice(0, gks.length - 1)) db.prepare("UPDATE players SET club_id = NULL WHERE id = ?").run(id);
  const youthGks = db.prepare("SELECT id FROM players WHERE youth_club_id = ? AND position = 'GK'").all(clubId).map((r) => String(r.id));
  for (let i = 0; i < 80 && n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled'") > 0; i++) { advanceTime(db, 'nextMatchday'); simulateMatchday(db); }
  advanceTime(db, 'nextMatchday');
  const r = startNextSeason(db);
  assert.ok(r.youthReleased.length >= 1, 'jovem de 19 dispensado');
  assert.equal(db.prepare('SELECT youth_club_id FROM players WHERE id = ?').get(String(old.id))!.youth_club_id, null);
  assert.ok(youthGks.some((id) => String(db.prepare('SELECT club_id FROM players WHERE id = ?').get(id)!.club_id) === clubId), 'goleiro da base promovido para cobrir a carência');
  assert.ok(n(db, "SELECT COUNT(*) AS n FROM players WHERE club_id = ? AND position = 'GK'", clubId) >= 2);
});

test('Ficha: atributos estimados só a partir de 25% de conhecimento, em faixas que contêm o real, estreitam e nunca revelam o valor exato', async () => {
  const { world } = await setup('sy-attr');
  for (const pl of world.players.slice(0, 120)) {
    assert.equal(estimateAttributes(pl.attributes, 's', pl.id, ATTR_MIN_KNOWLEDGE - 1), null);
    const maxWidth = (k: number) => 2 * (1 + Math.round(3 * (1 - k / 100))); // ±3 → ±1
    for (const k of [25, 50, 75, 100]) {
      assert.ok(k === 25 || maxWidth(k) <= maxWidth(k - 25), 'largura máxima não aumenta com o conhecimento');
      const e = estimateAttributes(pl.attributes, 's', pl.id, k)!;
      for (const g of ['technical', 'mental', 'physical'] as const) {
        for (const [key, r] of Object.entries(e[g])) {
          const real = (pl.attributes[g] as unknown as Record<string, number>)[key]!;
          assert.ok(r.low <= real && real <= r.high, `${key}: ${real} fora de ${r.low}–${r.high} (k=${k})`);
          if (real > 1 && real < 20) assert.ok(r.high > r.low, 'nunca o valor exato');
          assert.ok(r.high - r.low <= maxWidth(k), `${key}: faixa larga demais para k=${k}`);
        }
      }
    }
    assert.deepEqual(estimateAttributes(pl.attributes, 's', pl.id, 60), estimateAttributes(pl.attributes, 's', pl.id, 60), 'fixas por jogador');
  }
});

test('Parecer do olheiro: compara com o elenco do usuário no setor e destaca promessas', () => {
  const squad = [70, 66, 64, 60, 52, 50];
  const v = (overall: number, extra: Partial<{ potential: number; age: number; knowledge: number }> = {}) =>
    scoutVerdict({ overall, potential: extra.potential ?? overall, age: extra.age ?? 26, group: 'DEF', knowledge: extra.knowledge ?? 100 }, squad);
  assert.equal(v(72).level, 'starter'); assert.match(v(72).text, /melhor do elenco/);
  assert.equal(v(61).level, 'starter');
  assert.equal(v(55).level, 'rotation');
  assert.equal(v(45).level, 'no');
  assert.equal(v(45, { potential: 70, age: 18 }).level, 'depth'); assert.match(v(45, { potential: 70, age: 18 }).text, /Promessa/);
  assert.match(v(61, { knowledge: 30 }).text, /pouco preciso/);
});

test('Ficha: jogador de outro clube mostra estimativas e permite negociar/observar; do próprio clube mostra valores reais; base alheia é bloqueada', async () => {
  const { db, clubId } = await setup('sy-profile');
  const other = searchMarket(db, {}).find((p) => p.clubId !== null)!;
  const p0 = getPlayerProfile(db, other.id);
  assert.equal(p0.own, false); assert.equal(p0.attributes, null); assert.equal(p0.knowledge, 0);
  assert.ok(!('overall' in p0) && !('potentialHidden' in p0));
  assert.ok(p0.market && p0.market.id === other.id && p0.negotiable, 'janela aberta em 1º/jul: negociável');
  assert.ok(p0.verdict && p0.verdict.text.length > 0);
  db.prepare('INSERT INTO scout_knowledge (player_id, knowledge, updated_on) VALUES (?, 100, ?)').run(other.id, '2026-07-01');
  const p1 = getPlayerProfile(db, other.id);
  const real = db.prepare('SELECT overall, attributes_json FROM players WHERE id = ?').get(other.id)!;
  assert.ok(p1.attributes && p1.estOverall.low <= Number(real.overall) && Number(real.overall) <= p1.estOverall.high && p1.estOverall.high - p1.estOverall.low <= 2);
  const attrs = JSON.parse(String(real.attributes_json)) as Record<string, Record<string, number>>;
  for (const g of ['technical', 'mental', 'physical'] as const) for (const [k, r] of Object.entries(p1.attributes![g])) assert.ok(r.low <= attrs[g]![k]! && attrs[g]![k]! <= r.high);
  db.prepare("UPDATE career SET game_date = '2026-10-10'").run();
  assert.equal(getPlayerProfile(db, other.id).negotiable, false, 'janela fechada');
  const mine = String(db.prepare('SELECT id FROM players WHERE club_id = ? LIMIT 1').get(clubId)!.id);
  const own = getPlayerProfile(db, mine);
  assert.equal(own.own, true); assert.equal(own.market, null); assert.equal(own.verdict, null);
  assert.equal(own.estOverall.low, own.estOverall.high);
  assert.ok(Object.values(own.attributes!.technical).every((r) => r.low === r.high));
  const alienYouth = String(db.prepare('SELECT id FROM players WHERE youth_club_id IS NOT NULL AND youth_club_id <> ? LIMIT 1').get(clubId)!.id);
  assert.throws(() => getPlayerProfile(db, alienYouth), ScoutError);
  // dados da ficha nova: o próprio clube vê personalidade, moral e evolução; de outro clube, só com 50%+ de conhecimento e nunca a evolução da força
  assert.ok(own.personality && own.morale !== null && own.history && own.history.at(-1)!.overall === Number(db.prepare('SELECT overall FROM players WHERE id = ?').get(mine)!.overall));
  const fresh = searchMarket(db, {}).find((x) => x.clubId !== null && x.id !== other.id)!;
  const f0 = getPlayerProfile(db, fresh.id);
  assert.deepEqual([f0.personality, f0.morale, f0.history], [null, null, null], 'sem conhecimento: personalidade, moral e evolução ocultas');
  db.prepare('INSERT INTO scout_knowledge (player_id, knowledge, updated_on) VALUES (?, 60, ?)').run(fresh.id, '2026-07-01');
  const f1 = getPlayerProfile(db, fresh.id);
  assert.ok(f1.personality && f1.morale !== null); assert.equal(f1.history, null, 'evolução da força de outro clube revelaria o valor real');
  assert.ok(Array.isArray(f1.lastMatches) && Array.isArray(f1.transfers) && f1.nationalityName.length > 0);
  const myYouth = String(db.prepare('SELECT id FROM players WHERE youth_club_id = ? LIMIT 1').get(clubId)!.id);
  assert.equal(getPlayerProfile(db, myYouth).youth, true);
});

test('Base: só universos novos (marcados) geram as posições novas (ME/MD/AE/AD/SA/CA); saves anteriores seguem com as 10 posições originais', async () => {
  const { GROUP_POSITIONS, GROUP_POSITIONS_V2, GROUP_POSITIONS_V3 } = await import('../database/repositories/youthRepository.ts');
  const novas = ['LM', 'RM', 'LWB', 'RWB', 'SS', 'CF'];
  assert.ok(!Object.values(GROUP_POSITIONS).flat().some((p) => novas.includes(p)));
  assert.ok(['LM', 'RM', 'LWB', 'RWB'].every((p) => Object.values(GROUP_POSITIONS_V2).flat().includes(p as never)), 'v2: meias abertos e alas');
  assert.ok(novas.every((p) => Object.values(GROUP_POSITIONS_V3).flat().includes(p as never)) && !GROUP_POSITIONS_V3.ATT.includes('ST'), 'v3: também SA e CA, sem ATA');
  const { db } = await setup();
  assert.equal(String(db.prepare("SELECT value FROM meta WHERE key = 'position_set'").get()?.value), 'v3', 'carreira nova marcada');
  const { youthIntake } = await import('../database/repositories/youthRepository.ts');
  const youthPositions = (d: typeof db) => d.prepare('SELECT position FROM players WHERE youth_club_id IS NOT NULL').all().map((r) => String(r.position));
  // save novo: as academias (criadas na carreira) e a peneira já trazem as posições novas
  youthIntake(db, '2027-03-15');
  assert.ok(youthPositions(db).some((p) => novas.includes(p)), 'save novo gera ME/MD/AE/AD na base');
  // save anterior (sem a marcação): academia e peneira só com as posições originais
  const { db: old } = await setup('sy-antigo');
  old.exec("DELETE FROM meta WHERE key = 'position_set'");
  old.exec('DELETE FROM players WHERE youth_club_id IS NOT NULL');
  youthIntake(old, '2027-03-15');
  const got = youthPositions(old);
  assert.ok(got.length > 20, 'a peneira gerou jovens');
  assert.ok(!got.some((p) => novas.includes(p)), 'save anterior não ganha as posições novas');
});
