import type { SqlDb } from '../types.ts';
import { createRng, type Rng } from '../../game/rng.ts';
import { addDays } from '../../shared/date.ts';
import { computeStandings, type MatchResult } from '../../game/competition-engine/standings.ts';
import { templateFor as countryTemplate } from '../../game/world/names.ts';
import {
  clubMatchText, coachText, commentLikes, commentsFor, engagement, handleOf, hatTrickText, injuryText, JOURNALIST_ROLES, matchText, OUTLETS, previewText,
  roundText, sackingText, titleText, transferText, userPreviewText, type Mood, type PostKind,
} from '../../game/social-engine/social.ts';
import type { LeagueRules } from '../../shared/types.ts';
import type { SocialAccountDto, SocialCard, SocialFeedDto, SocialFilter, SocialPostDto } from '../../shared/api.ts';
import { getCareerState } from './careerRepository.ts';
import { FULL_CLUBS } from './simLevelRepository.ts';
import { fmtMoney } from '../../shared/money.ts';
import { cupStateOf } from './cupRepository.ts';
import { CURRENT_COMP } from './countrySeasonRepository.ts';

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const seedOf = (db: SqlDb) => S((db.prepare("SELECT value FROM meta WHERE key = 'world_seed'").get() ?? { value: 'sem-semente' }).value);
/** Limite de posts por dia (o feed não pode virar spam). */
const DAY_CAP = 12;

interface ClubRef { id: string; name: string; rep: number; leagueId: string }
const clubRef = (db: SqlDb, id: string): ClubRef => {
  const r = db.prepare('SELECT id, name, reputation, league_id FROM clubs WHERE id = ?').get(id)!;
  return { id: S(r.id), name: S(r.name), rep: N(r.reputation), leagueId: S(r.league_id) };
};

// ---------------------------------------------------------------- perfis
function uniqueHandle(db: SqlDb, base: string): string {
  const h = handleOf(base);
  for (let n = 0; ; n++) {
    const cand = n === 0 ? h : `${h.slice(0, 21)}${n}`;
    if (!db.prepare('SELECT 1 AS x FROM social_accounts WHERE handle = ?').get(cand)) return cand;
  }
}
const insertAccount = (db: SqlDb, a: { id: string; kind: string; name: string; handle: string; verified: boolean; clubId?: string | null; leagueId?: string | null; bio?: string; hue: number }) =>
  db.prepare('INSERT OR IGNORE INTO social_accounts (id, kind, name, handle, verified, club_id, league_id, bio, hue) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(a.id, a.kind, a.name, a.handle, a.verified ? 1 : 0, a.clubId ?? null, a.leagueId ?? null, a.bio ?? '', a.hue);

function templateFor(db: SqlDb, clubId: string | null) {
  const code = clubId ? S(db.prepare('SELECT co.code FROM clubs c JOIN countries co ON co.id = c.country_id WHERE c.id = ?').get(clubId)?.code ?? 'BRA') : 'BRA';
  return countryTemplate(code);
}

/** Veículos e jornalistas (uma vez por carreira). NÃO abre transação. */
export function ensureSocialAccounts(db: SqlDb): void {
  if (db.prepare("SELECT 1 AS x FROM social_accounts WHERE kind = 'outlet' LIMIT 1").get()) return;
  for (const o of OUTLETS) insertAccount(db, { id: `out-${o.key}`, kind: 'outlet', name: o.name, handle: uniqueHandle(db, o.handle), verified: true, bio: o.bio, hue: o.hue });
  const st = getCareerState(db);
  const t = templateFor(db, st.clubId || null);
  const rng = createRng(`social-accounts:${seedOf(db)}`);
  for (const j of JOURNALIST_ROLES) {
    const name = `${rng.pick(t.firstNames)} ${rng.pick(t.lastNames)}`;
    insertAccount(db, { id: `jor-${j.key}`, kind: 'journalist', name, handle: uniqueHandle(db, name), verified: true, bio: j.bio, hue: j.hue });
  }
}
function leagueAccount(db: SqlDb, leagueId: string): string {
  const id = `lg-${leagueId}`;
  if (!db.prepare('SELECT 1 AS x FROM social_accounts WHERE id = ?').get(id)) {
    const l = db.prepare('SELECT l.name, co.name AS country, co.code FROM leagues l JOIN countries co ON co.id = l.country_id WHERE l.id = ?').get(leagueId)!;
    insertAccount(db, { id, kind: 'league', name: S(l.name), handle: uniqueHandle(db, `${S(l.name)}${S(l.code)}`), verified: true, leagueId, bio: `Perfil oficial da ${S(l.name)} (${S(l.country)}).`, hue: 210 });
  }
  return id;
}
function clubAccount(db: SqlDb, clubId: string): string {
  const id = `cl-${clubId}`;
  if (!db.prepare('SELECT 1 AS x FROM social_accounts WHERE id = ?').get(id)) {
    const c = clubRef(db, clubId);
    insertAccount(db, { id, kind: 'club', name: c.name, handle: uniqueHandle(db, c.name), verified: true, clubId, bio: `Perfil oficial do ${c.name}.`, hue: 120 });
  }
  return id;
}
/** Torcedor de um clube (ou neutro): até 8 por clube; depois reaproveita. */
function fanAccount(db: SqlDb, rng: Rng, clubId: string | null, exclude: ReadonlySet<string> = new Set()): string {
  const fans = db.prepare(`SELECT id FROM social_accounts WHERE kind = 'fan' AND ${clubId ? 'club_id = ?' : 'club_id IS NULL'} ORDER BY id`).all(...(clubId ? [clubId] : [])).map((r) => S(r.id));
  const free = fans.filter((f) => !exclude.has(f));
  if (fans.length >= 8 && free.length) return rng.pick(free);
  const t = templateFor(db, clubId);
  const first = rng.pick(t.firstNames), last = rng.pick(t.lastNames);
  const club = clubId ? clubRef(db, clubId).name : null;
  const tag = club ? handleOf(club.split(/\s+/).filter((w) => w.length > 3).pop() ?? club).slice(0, 8) : 'futebol';
  const style = rng.int(0, 3);
  const handleBase = style === 0 ? `${first}${tag}` : style === 1 ? `${first}_${last}` : style === 2 ? `${tag}${first}${rng.int(1, 99)}` : `${first}${last[0]}${rng.int(10, 99)}`;
  const id = `fan-${clubId ?? 'neutro'}-${fans.length + 1}`;
  insertAccount(db, { id, kind: 'fan', name: `${first} ${last[0]}.`, handle: uniqueHandle(db, handleBase), verified: false, clubId, bio: club ? `Torcedor do ${club}.` : 'Apaixonado por futebol.', hue: rng.int(0, 359) });
  return id;
}

// ---------------------------------------------------------------- posts
interface Draft { kind: PostKind; author: string; text: string; card?: SocialCard | null; clubs: ClubRef[]; mood?: Mood; player?: string; priority: number }
function publish(db: SqlDb, rng: Rng, date: string, d: Draft): void {
  const verified = N(db.prepare('SELECT verified FROM social_accounts WHERE id = ?').get(d.author)!.verified) === 1;
  const rep = Math.max(20, ...d.clubs.map((c) => c.rep));
  const e = engagement(rng, d.kind, rep, verified);
  db.prepare('INSERT INTO social_posts (date, account_id, kind, text, card_json, clubs, likes, reposts) VALUES (?,?,?,?,?,?,?,?)')
    .run(date, d.author, d.kind, d.text, d.card ? JSON.stringify(d.card) : null, d.clubs.length ? `,${d.clubs.map((c) => c.id).join(',')},` : '', e.likes, e.reposts);
  const postId = N(db.prepare('SELECT last_insert_rowid() AS id').get()!.id);
  const used = new Set<string>(); // cada torcedor comenta uma vez por post
  for (const c of commentsFor(rng, d.kind, d.clubs, d.mood ?? {}, d.player)) {
    const fan = fanAccount(db, rng, c.clubId, used);
    used.add(fan);
    db.prepare('INSERT INTO social_comments (post_id, account_id, text, likes) VALUES (?,?,?,?)').run(postId, fan, c.text, commentLikes(rng));
  }
}
function flush(db: SqlDb, rng: Rng, date: string, drafts: Draft[]): number {
  const chosen = [...drafts].sort((a, b) => b.priority - a.priority).slice(0, DAY_CAP);
  for (const d of chosen) publish(db, rng, date, d);
  return chosen.length;
}

interface TableRow { clubId: string; name: string; points: number; played: number; position: number }
function tableOf(db: SqlDb, competitionId: string): { rows: TableRow[]; name: string; leagueId: string; tier: number } {
  const c = db.prepare('SELECT c.name, c.league_id, l.rules_json, l.tier FROM competitions c JOIN leagues l ON l.id = c.league_id WHERE c.id = ?').get(competitionId)!;
  const teams = db.prepare('SELECT id, name FROM clubs WHERE id IN (SELECT home_club_id FROM fixtures WHERE competition_id = ? UNION SELECT away_club_id FROM fixtures WHERE competition_id = ?)').all(competitionId, competitionId);
  const names = new Map(teams.map((t) => [S(t.id), S(t.name)]));
  const results: MatchResult[] = db.prepare("SELECT home_club_id, away_club_id, home_goals, away_goals FROM fixtures WHERE competition_id = ? AND status = 'played' AND (stage IS NULL OR stage = 'f1')").all(competitionId)
    .map((r) => ({ home: S(r.home_club_id), away: S(r.away_club_id), homeGoals: N(r.home_goals), awayGoals: N(r.away_goals) }));
  const rows = computeStandings([...names.keys()], results, JSON.parse(S(c.rules_json)) as LeagueRules)
    .map((r) => ({ clubId: r.teamId, name: names.get(r.teamId) ?? '?', points: r.points, played: r.played, position: r.position }));
  return { rows, name: S(c.name), leagueId: S(c.league_id), tier: N(c.tier) };
}
const tableCard = (title: string, rows: TableRow[], n: number): SocialCard => ({ type: 'table', title, rows: rows.slice(0, n).map((r) => ({ clubId: r.clubId, name: r.name, points: r.points, played: r.played, rank: r.position })) });
/** nome da fase de uma partida de copa (null = partida de liga) */
function cupStage(db: SqlDb, fixtureId: string): string | null {
  const t = db.prepare('SELECT t.stage, t.competition_id FROM fixtures f JOIN cup_ties t ON t.id = f.tie_id WHERE f.id = ?').get(fixtureId);
  return t ? cupStateOf(db, S(t.competition_id)).format.stages[N(t.stage)]!.name : null;
}
const userCompetition = (db: SqlDb, date: string): string | null => {
  const st = getCareerState(db);
  if (!st.clubId) return null;
  const r = db.prepare(`SELECT competition_id FROM fixtures WHERE (home_club_id = ? OR away_club_id = ?) AND competition_id IN (SELECT c.id FROM competitions c WHERE ${CURRENT_COMP} AND c.kind = 'league') LIMIT 1`).get(st.clubId, st.clubId);
  return r ? S(r.competition_id) : null;
};

/**
 * Notícias do dia (chamado por moveClock ao entrar no dia, depois das rotinas): prévias dos jogos de HOJE (confronto direto
 * entre líder e vice-líder; o jogo do usuário) e o que aconteceu ONTEM (transferências, demissões de técnicos, troca de clube do
 * usuário) — a imprensa noticia na manhã seguinte, então nada que o usuário faça no dia fica de fora. NÃO abre transação.
 */
export function processSocialDay(db: SqlDb, date: string): number {
  ensureSocialAccounts(db);
  const st = getCareerState(db);
  const rng = createRng(`social-day:${seedOf(db)}:${date}`);
  const yesterday = addDays(date, -1);
  const mine = userCompetition(db, date);
  const drafts: Draft[] = [];

  // ---- confronto direto entre os dois primeiros (ligas completas)
  for (const cr of db.prepare(`SELECT DISTINCT f.competition_id FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE f.match_date = ? AND f.status = 'scheduled' AND c.kind = 'league' AND f.home_club_id IN ${FULL_CLUBS} ORDER BY f.competition_id`).all(date)) {
    const compId = S(cr.competition_id);
    const t = tableOf(db, compId);
    const [a, b] = t.rows;
    if (!a || !b || b.played < 3 || a.points - b.points > 3) continue; // só vale a pena com a disputa em aberto
    const f = db.prepare("SELECT home_club_id, round FROM fixtures WHERE competition_id = ? AND match_date = ? AND ((home_club_id = ? AND away_club_id = ?) OR (home_club_id = ? AND away_club_id = ?))").get(compId, date, a.clubId, b.clubId, b.clubId, a.clubId);
    if (!f) continue;
    const ca = clubRef(db, a.clubId), cb = clubRef(db, b.clubId);
    const base = { leader: a.name, second: b.name, gap: a.points - b.points, comp: t.name, round: N(f.round) };
    const prio = (compId === mine ? 90 : 60) - t.tier * 5;
    drafts.push({ kind: 'preview', author: leagueAccount(db, t.leagueId), text: previewText(rng, { ...base, official: true }), card: tableCard(`${t.name} — classificação`, t.rows, 4), clubs: [ca, cb], mood: { [ca.id]: 1, [cb.id]: 1 }, priority: prio + 2 });
    drafts.push({ kind: 'preview', author: rng.chance(0.5) ? 'jor-colunista' : 'out-escanteio', text: previewText(rng, { ...base, official: false }), card: null, clubs: [ca, cb], mood: { [ca.id]: 1, [cb.id]: 1 }, priority: prio });
  }

  // ---- jogo do usuário hoje
  if (st.clubId) {
    const f = db.prepare("SELECT f.id, f.home_club_id, f.away_club_id, f.round, c.name FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE f.match_date = ? AND f.status = 'scheduled' AND (f.home_club_id = ? OR f.away_club_id = ?)").get(date, st.clubId, st.clubId);
    if (f) {
      const h = clubRef(db, S(f.home_club_id)), aw = clubRef(db, S(f.away_club_id));
      drafts.push({ kind: 'preview', author: 'out-arquibancada', text: userPreviewText(rng, { home: h.name, away: aw.name, comp: S(f.name), round: N(f.round), stage: cupStage(db, S(f.id)) ?? undefined }),
        card: { type: 'fixture', homeId: h.id, homeName: h.name, awayId: aw.id, awayName: aw.name, competition: S(f.name) }, clubs: [h, aw], mood: { [h.id]: 1, [aw.id]: 1 }, priority: 80 });
    }
  }

  // ---- transferências de ontem (clubes completos): as do usuário sempre; das outras, as maiores
  const transfers = db.prepare(`SELECT t.player_id, t.from_club_id, t.to_club_id, t.fee, p.first_name, p.last_name FROM transfers t JOIN players p ON p.id = t.player_id
    WHERE t.date = ? AND (t.to_club_id IN ${FULL_CLUBS} OR t.from_club_id IN ${FULL_CLUBS}) ORDER BY t.fee DESC, t.id`).all(yesterday);
  let others = 0;
  for (const tr of transfers) {
    const user = S(tr.to_club_id) === st.clubId || (tr.from_club_id != null && S(tr.from_club_id) === st.clubId);
    const fee = N(tr.fee);
    if (!user && (fee < 1_000_000 || others >= 3)) continue;
    if (!user) others++;
    const to = clubRef(db, S(tr.to_club_id)), from = tr.from_club_id == null ? null : clubRef(db, S(tr.from_club_id));
    const player = `${S(tr.first_name)} ${S(tr.last_name)}`;
    const scoop = fee >= 8_000_000 || to.rep >= 75;
    drafts.push({ kind: 'transfer', author: scoop ? rng.pick(['jor-mercado', 'jor-mercado2']) : 'out-gazeta',
      text: transferText(rng, { player, from: from?.name ?? null, to: to.name, fee: fmtMoney(fee), free: !from, scoop }),
      card: { type: 'transfer', player, fromId: from?.id ?? null, fromName: from?.name ?? null, toId: to.id, toName: to.name, fee },
      clubs: from ? [to, from] : [to], mood: from ? { [to.id]: 1, [from.id]: -1 } : { [to.id]: 1 }, player, priority: (user ? 85 : 40) + Math.min(20, fee / 2_000_000) });
  }

  // ---- técnicos demitidos ontem (IA) e troca de clube do usuário
  for (const v of db.prepare(`SELECT s.club_id, a.first_name, a.last_name FROM ai_coach_spells s JOIN ai_coaches a ON a.id = s.coach_id
    WHERE s.end_date = ? AND s.end_reason = 'sacked' AND s.club_id IN ${FULL_CLUBS} ORDER BY s.club_id`).all(yesterday).slice(0, 2)) {
    const c = clubRef(db, S(v.club_id));
    drafts.push({ kind: 'sacking', author: 'out-jornaldabola', text: sackingText(rng, { club: c.name, coach: `${S(v.first_name)} ${S(v.last_name)}` }), clubs: [c], mood: { [c.id]: -1 }, priority: 45 + c.rep / 5 });
  }
  // técnicos da IA contratados ontem: anúncio no perfil oficial do clube
  for (const h of db.prepare(`SELECT s.club_id, a.first_name, a.last_name FROM ai_coach_spells s JOIN ai_coaches a ON a.id = s.coach_id
    WHERE s.start_date = ? AND s.club_id IN ${FULL_CLUBS} ORDER BY s.club_id`).all(yesterday).slice(0, 2)) {
    const c = clubRef(db, S(h.club_id));
    drafts.push({ kind: 'coach', author: clubAccount(db, c.id), text: coachText(rng, { coach: `${S(h.first_name)} ${S(h.last_name)}`, club: c.name, sacked: false }), clubs: [c], mood: { [c.id]: 1 }, priority: 40 + c.rep / 5 });
  }
  const coach = JSON.parse(S(db.prepare('SELECT coach_json FROM career WHERE id = 1').get()!.coach_json)) as { firstName: string; lastName: string };
  const coachName = `${coach.firstName} ${coach.lastName}`;
  for (const sp of db.prepare("SELECT club_id, start_date, end_date, end_reason FROM coach_spells WHERE start_date = ? OR (end_date = ? AND end_reason = 'sacked')").all(yesterday, yesterday)) {
    const c = clubRef(db, S(sp.club_id));
    const sacked = S(sp.end_date ?? '') === yesterday;
    drafts.push({ kind: 'coach', author: sacked ? 'out-gazeta' : clubAccount(db, c.id), text: coachText(rng, { coach: coachName, club: c.name, sacked }), clubs: [c], mood: { [c.id]: sacked ? -1 : 1 }, priority: 95 });
  }
  return flush(db, rng, date, drafts);
}

/**
 * Notícias da rodada (chamado por simulateMatchday, na mesma transação): o jogo do usuário (imprensa e perfil oficial do clube),
 * zebras e goleadas, hat-tricks e lesões longas (partidas com relatório), fim de rodada e campeão. NÃO abre transação.
 */
export function processSocialMatchday(db: SqlDb, date: string, fixtureIds: readonly string[]): number {
  if (!fixtureIds.length) return 0;
  ensureSocialAccounts(db);
  const st = getCareerState(db);
  const rng = createRng(`social-match:${seedOf(db)}:${date}`);
  const mine = userCompetition(db, date);
  const full = new Set(db.prepare(FULL_CLUBS.slice(1, -1)).all().map((r) => S(r.id)));
  const drafts: Draft[] = [];
  const ph = fixtureIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT f.id, f.competition_id, f.round, f.home_club_id, f.away_club_id, f.home_goals, f.away_goals, c.name AS comp FROM fixtures f JOIN competitions c ON c.id = f.competition_id
    WHERE f.id IN (${ph}) AND f.status = 'played' ORDER BY f.id`).all(...fixtureIds);
  const notable: Draft[] = [];
  for (const f of rows) {
    const h = clubRef(db, S(f.home_club_id)), a = clubRef(db, S(f.away_club_id));
    const hg = N(f.home_goals), ag = N(f.away_goals);
    const card: SocialCard = { type: 'match', homeId: h.id, homeName: h.name, awayId: a.id, awayName: a.name, hg, ag, competition: S(f.comp) };
    const mood: Mood = { [h.id]: Math.sign(hg - ag), [a.id]: Math.sign(ag - hg) };
    const stage = cupStage(db, S(f.id)) ?? undefined;
    const base = { home: h.name, away: a.name, hg, ag, competition: S(f.comp), round: N(f.round), stage };
    if (st.clubId && (h.id === st.clubId || a.id === st.clubId)) {
      const me = h.id === st.clubId ? h : a, opp = me === h ? a : h;
      const my = me === h ? hg : ag, their = me === h ? ag : hg;
      drafts.push({ kind: 'match', author: 'out-placar', text: matchText(rng, { ...base, upset: false }), card, clubs: [h, a], mood, priority: 88 });
      drafts.push({ kind: 'match', author: clubAccount(db, me.id), text: clubMatchText(rng, { mine: my > their ? 'V' : my < their ? 'D' : 'E', opp: opp.name, score: `${my} x ${their}`, cup: stage ? S(f.comp) : undefined }), card: null, clubs: [me], mood: { [me.id]: Math.sign(my - their) }, priority: 87 });
      continue;
    }
    if (!full.has(h.id) && !full.has(a.id)) continue;
    const winner = hg > ag ? h : ag > hg ? a : null, loser = winner === h ? a : winner === a ? h : null;
    const upset = !!winner && !!loser && loser.rep - winner.rep >= 15;
    if (upset || Math.abs(hg - ag) >= 4) {
      notable.push({ kind: upset ? 'upset' : 'match', author: rng.pick(['out-placar', 'out-gazeta']), text: matchText(rng, { ...base, upset }), card, clubs: [h, a], mood,
        priority: (S(f.competition_id) === mine ? 55 : 30) + (upset ? 10 : 0) + (h.rep + a.rep) / 20 });
    }
  }
  drafts.push(...notable.sort((x, y) => y.priority - x.priority).slice(0, 3));

  // ---- relatórios (partidas completas): hat-tricks e lesões longas
  let hats = 0, injuries = 0;
  const reports = db.prepare(`SELECT m.fixture_id, m.report_json FROM matches m WHERE m.fixture_id IN (${ph}) ORDER BY m.fixture_id`).all(...fixtureIds);
  for (const m of reports) {
    const r = JSON.parse(S(m.report_json)) as { home: { clubId: string; name: string }; away: { clubId: string; name: string }; players: Array<{ id: string; name: string; team: 0 | 1; goals?: number; injuredDays?: number }> };
    for (const p of r.players) {
      const club = p.team === 0 ? r.home : r.away, opp = p.team === 0 ? r.away : r.home;
      const user = club.clubId === st.clubId;
      if ((p.goals ?? 0) >= 3 && (user || hats < 1)) {
        if (!user) hats++;
        const c = clubRef(db, club.clubId);
        drafts.push({ kind: 'hattrick', author: 'jor-dados', text: hatTrickText(rng, { player: p.name, club: club.name, goals: p.goals!, opp: opp.name }), clubs: [c], mood: { [c.id]: 1 }, player: p.name, priority: (user ? 84 : 50) + p.goals! });
      }
      if ((p.injuredDays ?? 0) >= 21 && injuries < 2) {
        const ovr = N(db.prepare('SELECT overall FROM players WHERE id = ?').get(p.id)?.overall ?? 0);
        if (!user && ovr < 72) continue;
        injuries++;
        const c = clubRef(db, club.clubId);
        drafts.push({ kind: 'injury', author: user ? 'jor-setorista' : 'out-jornaldabola', text: injuryText(rng, { player: p.name, club: club.name, days: p.injuredDays! }),
          card: { type: 'injury', player: p.name, clubId: c.id, clubName: c.name, days: p.injuredDays! }, clubs: [c], mood: { [c.id]: -1 }, player: p.name, priority: user ? 83 : 42 });
      }
    }
  }

  // ---- fim de rodada (liga do usuário e primeiras divisões completas) e campeão
  const leagueComps = new Set(db.prepare("SELECT id FROM competitions WHERE kind = 'league'").all().map((r) => S(r.id)));
  for (const cr of [...new Set(rows.map((f) => S(f.competition_id)))].filter((c) => leagueComps.has(c)).sort()) { // copas não têm tabela
    const round = N(rows.find((f) => S(f.competition_id) === cr)!.round);
    const left = N(db.prepare("SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = ? AND status = 'scheduled'").get(cr)!.n);
    const roundLeft = N(db.prepare("SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = ? AND round = ? AND status = 'scheduled'").get(cr, round)!.n);
    const t = tableOf(db, cr);
    const leaderFull = t.rows[0] && full.has(t.rows[0].clubId);
    if (!leaderFull) continue;
    const lead = clubRef(db, t.rows[0]!.clubId);
    if (left === 0 && (cr === mine || t.tier === 1)) {
      drafts.push({ kind: 'title', author: leagueAccount(db, t.leagueId), text: titleText(rng, { champion: lead.name, comp: t.name, points: t.rows[0]!.points }), card: tableCard(`${t.name} — classificação final`, t.rows, 5), clubs: [lead], mood: { [lead.id]: 1 }, priority: cr === mine ? 99 : 70 });
    } else if (roundLeft === 0 && cr === mine) { // fim de rodada: só a liga do usuário (senão o feed vira tabela)
      drafts.push({ kind: 'round', author: leagueAccount(db, t.leagueId), text: roundText(rng, { round, comp: t.name, leader: lead.name, points: t.rows[0]!.points }), card: tableCard(`${t.name} — classificação`, t.rows, 5),
        clubs: t.rows.slice(0, 3).map((r) => clubRef(db, r.clubId)), mood: { [lead.id]: 1 }, priority: cr === mine ? 60 : 25 });
    }
  }
  return flush(db, rng, date, drafts);
}

// ---------------------------------------------------------------- tela
const accountDto = (r: Record<string, unknown>): SocialAccountDto => ({
  id: S(r.id), kind: S(r.kind) as SocialAccountDto['kind'], name: S(r.name), handle: S(r.handle), verified: N(r.verified) === 1,
  clubId: r.club_id == null ? null : S(r.club_id), leagueId: r.league_id == null ? null : S(r.league_id), bio: S(r.bio), hue: N(r.hue),
});
const KIND_FILTER: Partial<Record<SocialFilter, string[]>> = {
  match: ['match', 'upset', 'hattrick', 'preview', 'round', 'title'], transfer: ['transfer'], injury: ['injury'], coach: ['sacking', 'coach'],
};

export function getSocialFeed(db: SqlDb, filter: SocialFilter = 'all', limit = 60): SocialFeedDto {
  const st = getCareerState(db);
  const where: string[] = [], args: unknown[] = [];
  if (filter === 'mine') { where.push('p.clubs LIKE ?'); args.push(`%,${st.clubId},%`); }
  else if (filter === 'league') { where.push("a.kind = 'league'"); }
  else if (KIND_FILTER[filter]) { const ks = KIND_FILTER[filter]!; where.push(`p.kind IN (${ks.map(() => '?').join(',')})`); args.push(...ks); }
  const posts = db.prepare(`SELECT p.*, a.id AS a_id, a.kind AS a_kind, a.name AS a_name, a.handle AS a_handle, a.verified AS a_verified, a.club_id AS a_club_id, a.league_id AS a_league_id, a.bio AS a_bio, a.hue AS a_hue
    FROM social_posts p JOIN social_accounts a ON a.id = p.account_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.date DESC, p.id DESC LIMIT ?`).all(...args, Math.max(1, Math.min(200, limit)));
  const comments = new Map<number, SocialPostDto['comments']>();
  if (posts.length) {
    const ids = posts.map((p) => N(p.id));
    for (const c of db.prepare(`SELECT c.id, c.post_id, c.text, c.likes, a.* FROM social_comments c JOIN social_accounts a ON a.id = c.account_id WHERE c.post_id IN (${ids.map(() => '?').join(',')}) ORDER BY c.likes DESC, c.id`).all(...ids)) {
      const list = comments.get(N(c.post_id)) ?? [];
      list.push({ id: N(c.id), text: S(c.text), likes: N(c.likes), author: accountDto(c) });
      comments.set(N(c.post_id), list);
    }
  }
  const dto: SocialPostDto[] = posts.map((p) => ({
    id: N(p.id), date: S(p.date), kind: S(p.kind) as PostKind, text: S(p.text), card: p.card_json == null ? null : (JSON.parse(S(p.card_json)) as SocialCard),
    likes: N(p.likes), reposts: N(p.reposts), mine: !!st.clubId && S(p.clubs).includes(`,${st.clubId},`),
    author: accountDto({ id: p.a_id, kind: p.a_kind, name: p.a_name, handle: p.a_handle, verified: p.a_verified, club_id: p.a_club_id, league_id: p.a_league_id, bio: p.a_bio, hue: p.a_hue }),
    comments: comments.get(N(p.id)) ?? [],
  }));
  // em alta: clubes mais citados nos últimos 14 dias
  const counts = new Map<string, number>();
  for (const r of db.prepare('SELECT clubs FROM social_posts WHERE date >= ?').all(addDays(st.gameDate, -14))) for (const id of S(r.clubs).split(',').filter(Boolean)) counts.set(id, (counts.get(id) ?? 0) + 1);
  const trending = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6).map(([id, n]) => ({ clubId: id, name: S(db.prepare('SELECT name FROM clubs WHERE id = ?').get(id)?.name ?? id), posts: n }));
  const profiles = db.prepare("SELECT * FROM social_accounts WHERE kind IN ('outlet', 'journalist') ORDER BY kind DESC, name").all().map(accountDto);
  const comp = userCompetition(db, st.gameDate);
  const league = comp ? db.prepare('SELECT a.* FROM social_accounts a WHERE a.id = ?').get(`lg-${S(db.prepare('SELECT league_id FROM competitions WHERE id = ?').get(comp)!.league_id)}`) : null;
  return { posts: dto, trending, profiles: league ? [accountDto(league), ...profiles] : profiles, total: N(db.prepare('SELECT COUNT(*) AS n FROM social_posts').get()!.n) };
}
