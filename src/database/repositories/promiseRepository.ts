import type { SqlDb } from '../types.ts';
import { withTransaction } from '../types.ts';
import { UserError } from '../../shared/errors.ts';
import { addDays } from '../../shared/date.ts';
import type { BoardTopicDto, ConversationsDto, PlayerTopicDto, PromiseDto, TalkResultDto } from '../../shared/api.ts';
import type { Position } from '../../shared/types.ts';
import { EFFECT, judgeMinutes, judgeWins, promisedPosition, TALK, talkOutcome, type PromiseKind } from '../../game/promise-engine/promises.ts';
import { getCareerState } from './careerRepository.ts';
import { board, fastForwarding, leagueSituation, setConfidence } from './boardRepository.ts';
import { addNews } from './newsRepository.ts';

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const br = (d: string) => d.split('-').reverse().join('/');
const clampMorale = (v: number) => Math.max(10, Math.min(100, Math.round(v * 10) / 10));
const clampForm = (v: number) => Math.max(0, Math.min(100, Math.round(v * 10) / 10));
/** moral abaixo disso: o jogador pede conversa */
export const REQUEST_MORALE = 40;

const TOPIC_LABEL: Record<PlayerTopicDto | BoardTopicDto, string> = {
  praise: 'Elogiar o desempenho', demand: 'Cobrar mais empenho', promise_minutes: 'Prometer mais minutos', promise_renewal: 'Prometer renovação de contrato',
  promise_position: 'Prometer posição na liga', promise_wins: 'Prometer vitórias',
};

interface Baseline { minutes?: number; matches?: number; contractEnd?: string; competitionId?: string; position?: number; played?: number }

const playerRow = (db: SqlDb, id: string) => db.prepare('SELECT id, first_name, last_name, club_id, morale, form, contract_end, position FROM players WHERE id = ?').get(id);
const nameOf = (p: Record<string, unknown>) => `${S(p.first_name)} ${S(p.last_name)}`;
/** minutos do jogador pelo clube (todas as competições e temporadas) */
const minutesFor = (db: SqlDb, playerId: string, clubId: string) => N(db.prepare('SELECT COALESCE(SUM(minutes), 0) AS n FROM player_season_stats WHERE player_id = ? AND club_id = ?').get(playerId, clubId)!.n);
/** jogos disputados pelo clube (todas as competições e temporadas) */
const clubPlayed = (db: SqlDb, clubId: string) => N(db.prepare("SELECT COUNT(*) AS n FROM fixtures WHERE status = 'played' AND (home_club_id = ? OR away_club_id = ?)").get(clubId, clubId)!.n);
/** resultados (V/E/D) dos jogos do clube a partir do n-ésimo (ordem do calendário) */
function resultsFrom(db: SqlDb, clubId: string, offset: number, limit: number): Array<'V' | 'E' | 'D'> {
  return db.prepare(`SELECT home_club_id, home_goals, away_goals FROM fixtures WHERE status = 'played' AND (home_club_id = ? OR away_club_id = ?)
      ORDER BY match_date, id LIMIT ? OFFSET ?`).all(clubId, clubId, limit, offset)
    .map((f) => { const d = (S(f.home_club_id) === clubId ? 1 : -1) * (N(f.home_goals) - N(f.away_goals)); return d > 0 ? 'V' : d < 0 ? 'D' : 'E'; });
}
const lastTalk = (db: SqlDb, clubId: string, target: 'player' | 'board', playerId: string | null) =>
  db.prepare(`SELECT MAX(date) AS d FROM conversations WHERE club_id = ? AND target = ? AND ${playerId ? 'player_id = ?' : 'player_id IS NULL'}`).get(...[clubId, target, ...(playerId ? [playerId] : [])])?.d;
function nextTalkDate(db: SqlDb, clubId: string, target: 'player' | 'board', playerId: string | null, today: string): string | null {
  const d = lastTalk(db, clubId, target, playerId);
  if (d == null) return null;
  const next = addDays(S(d), target === 'player' ? TALK.playerCooldown : TALK.boardCooldown);
  return next > today ? next : null;
}
const openPromise = (db: SqlDb, clubId: string, where: string, ...p: unknown[]) => db.prepare(`SELECT id FROM promises WHERE status = 'open' AND club_id = ? AND ${where}`).get(clubId, ...p);

// ---------------------------------------------------------------- disponibilidade dos temas
function playerTopics(db: SqlDb, clubId: string, p: Record<string, unknown>, today: string): Record<PlayerTopicDto, string | null> {
  const wait = nextTalkDate(db, clubId, 'player', S(p.id), today);
  const busy = wait ? `Vocês conversaram há pouco: nova conversa a partir de ${br(wait)}.` : null;
  const promised = openPromise(db, clubId, "player_id = ?", S(p.id)) ? 'Já existe uma promessa em aberto com este jogador.' : null;
  const renewal = S(p.contract_end) > addDays(today, TALK.renewalWindowDays) ? 'O contrato ainda tem mais de 18 meses: renovação não é assunto agora.' : null;
  return { praise: busy, demand: busy, promise_minutes: busy ?? promised, promise_renewal: busy ?? promised ?? renewal };
}

function boardTopics(db: SqlDb, clubId: string, today: string): ConversationsDto['board']['topics'] {
  const b = board(db);
  const wait = nextTalkDate(db, clubId, 'board', null, today);
  const busy = wait ? `A diretoria só recebe o treinador de novo a partir de ${br(wait)}.` : null;
  const sit = leagueSituation(db, clubId, getCareerState(db).season);
  const target = b ? N(b.target_position) : 0;
  const pos = promisedPosition(target);
  const totalRounds = sit ? N(db.prepare('SELECT COALESCE(MAX(round), 0) AS n FROM fixtures WHERE competition_id = ?').get(sit.competitionId)!.n) : 0;
  const late = sit && totalRounds > 0 && sit.played > totalRounds * TALK.positionMaxShare ? 'A liga já passou de 3/4: tarde para prometer posição.' : null;
  const noLeague = !sit || !b ? 'Sem liga em andamento nesta temporada.' : null;
  const leftPos = noLeague ?? late ?? (pos == null ? 'A meta já é o título: não há como prometer mais.' : null);
  const leftWins = (b ? null : 'Sem diretoria.') ?? (N(db.prepare("SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled' AND (home_club_id = ? OR away_club_id = ?)").get(clubId, clubId)!.n) < 1 ? 'Sem jogos pela frente nesta temporada.' : null);
  return {
    promise_position: {
      label: TOPIC_LABEL.promise_position,
      detail: pos == null ? 'Prometer terminar a liga acima da meta da diretoria.' : `Terminar a liga em ${pos}º ou melhor (meta: ${target}º). Agora: confiança +${EFFECT.position.now}; cumprida +${EFFECT.position.kept}; quebrada ${EFFECT.position.broken}.`,
      unavailable: busy ?? (openPromise(db, clubId, "kind = 'position'") ? 'Já existe uma promessa de posição em aberto.' : null) ?? leftPos,
    },
    promise_wins: {
      label: TOPIC_LABEL.promise_wins,
      detail: `Vencer ${TALK.winsNeeded} dos próximos ${TALK.winsMatches} jogos (todas as competições). Agora: confiança +${EFFECT.wins.now}; cumprida +${EFFECT.wins.kept}; quebrada ${EFFECT.wins.broken}.`,
      unavailable: busy ?? (openPromise(db, clubId, "kind = 'wins'") ? 'Já existe uma promessa de vitórias em aberto.' : null) ?? leftWins,
    },
  };
}

// ---------------------------------------------------------------- conversas
function logTalk(db: SqlDb, clubId: string, target: 'player' | 'board', playerId: string | null, topic: string, date: string, outcome: string) {
  db.prepare('INSERT INTO conversations (club_id, target, player_id, topic, date, outcome) VALUES (?, ?, ?, ?, ?, ?)').run(clubId, target, playerId, topic, date, outcome);
}
function addPromise(db: SqlDb, clubId: string, target: 'player' | 'board', playerId: string | null, kind: PromiseKind, today: string, due: string, base: Baseline) {
  db.prepare('INSERT INTO promises (club_id, target, player_id, kind, made_on, due, baseline_json) VALUES (?, ?, ?, ?, ?, ?, ?)').run(clubId, target, playerId, kind, today, due, JSON.stringify(base));
}

/** Conversa com um jogador do elenco. Atômica. */
export function talkToPlayer(db: SqlDb, playerId: string, topic: PlayerTopicDto): TalkResultDto {
  const message = withTransaction(db, () => {
    const st = getCareerState(db);
    if (!st.clubId) throw new UserError('Sem clube: não há elenco para conversar.');
    const p = playerRow(db, playerId);
    if (!p || S(p.club_id) !== st.clubId) throw new UserError('O jogador não é do seu elenco.');
    if (!['praise', 'demand', 'promise_minutes', 'promise_renewal'].includes(topic)) throw new UserError('Tema de conversa inválido.');
    const why = playerTopics(db, st.clubId, p, st.gameDate)[topic];
    if (why) throw new UserError(why);
    const name = nameOf(p), today = st.gameDate;
    let text: string;
    if (topic === 'praise' || topic === 'demand') {
      const r = talkOutcome(topic, { form: N(p.form), morale: N(p.morale) });
      db.prepare('UPDATE players SET morale = ?, form = ? WHERE id = ?').run(clampMorale(N(p.morale) + r.moraleDelta), clampForm(N(p.form) + r.formDelta), playerId);
      text = `${name}: ${r.text}`;
    } else if (topic === 'promise_minutes') {
      addPromise(db, st.clubId, 'player', playerId, 'minutes', today, addDays(today, TALK.minutesDays), { minutes: minutesFor(db, playerId, st.clubId), matches: clubPlayed(db, st.clubId) });
      db.prepare('UPDATE players SET morale = ? WHERE id = ?').run(clampMorale(N(p.morale) + EFFECT.minutes.now), playerId);
      text = `${name} gostou da promessa: a moral subiu. Ele espera jogar em média ${TALK.minutesPerMatch} minutos por jogo nos próximos ${TALK.minutesMatches} jogos do clube (prazo ${br(addDays(today, TALK.minutesDays))}).`;
    } else {
      const due = [addDays(today, TALK.renewalDays), S(p.contract_end)].sort()[0]!;
      addPromise(db, st.clubId, 'player', playerId, 'renewal', today, due, { contractEnd: S(p.contract_end) });
      db.prepare('UPDATE players SET morale = ? WHERE id = ?').run(clampMorale(N(p.morale) + EFFECT.renewal.now), playerId);
      text = `${name} ficou feliz com a promessa de renovação: a moral subiu. Renove o contrato até ${br(due)} na aba Contratos.`;
    }
    logTalk(db, st.clubId, 'player', playerId, topic, today, text);
    return text;
  });
  return { message, conversations: getConversations(db) };
}

/** Promessa à diretoria. Atômica. */
export function talkToBoard(db: SqlDb, topic: BoardTopicDto): TalkResultDto {
  const message = withTransaction(db, () => {
    const st = getCareerState(db);
    const b = board(db);
    if (!st.clubId || !b) throw new UserError('Sem clube: não há diretoria para conversar.');
    if (topic !== 'promise_position' && topic !== 'promise_wins') throw new UserError('Tema de conversa inválido.');
    const why = boardTopics(db, st.clubId, st.gameDate)[topic].unavailable;
    if (why) throw new UserError(why);
    const today = st.gameDate;
    let text: string;
    if (topic === 'promise_position') {
      const sit = leagueSituation(db, st.clubId, st.season)!;
      const pos = promisedPosition(N(b.target_position))!;
      const last = S(db.prepare('SELECT MAX(match_date) AS d FROM fixtures WHERE competition_id = ?').get(sit.competitionId)!.d);
      addPromise(db, st.clubId, 'board', null, 'position', today, last, { competitionId: sit.competitionId, position: pos });
      setConfidence(db, N(b.confidence) + EFFECT.position.now);
      text = `A diretoria anotou: terminar a liga em ${pos}º ou melhor. A confiança subiu agora; será cobrada no fim da liga (${br(last)}).`;
    } else {
      addPromise(db, st.clubId, 'board', null, 'wins', today, addDays(today, TALK.winsDays), { matches: clubPlayed(db, st.clubId) });
      setConfidence(db, N(b.confidence) + EFFECT.wins.now);
      text = `A diretoria anotou: ${TALK.winsNeeded} vitórias nos próximos ${TALK.winsMatches} jogos (prazo ${br(addDays(today, TALK.winsDays))}). A confiança subiu agora.`;
    }
    logTalk(db, st.clubId, 'board', null, topic, today, text);
    return text;
  });
  return { message, conversations: getConversations(db) };
}

// ---------------------------------------------------------------- cobrança diária
function resolve(db: SqlDb, id: number, status: 'kept' | 'broken' | 'void', date: string) {
  db.prepare('UPDATE promises SET status = ?, resolved_on = ? WHERE id = ?').run(status, date, id);
}
function applyPlayer(db: SqlDb, playerId: string, delta: number) {
  const p = playerRow(db, playerId)!;
  db.prepare('UPDATE players SET morale = ? WHERE id = ?').run(clampMorale(N(p.morale) + delta), playerId);
}

/**
 * Cobra as promessas em aberto (chamada dia a dia por `moveClock`). Anula as de quem deixou o clube (jogador vendido/liberado ou treinador
 * em outro clube). NÃO abre transação.
 */
export function processPromisesDay(db: SqlDb, date: string): void {
  if (fastForwarding(db)) return;
  const st = getCareerState(db);
  for (const r of db.prepare("SELECT * FROM promises WHERE status = 'open' ORDER BY id").all()) {
    const id = N(r.id), clubId = S(r.club_id), kind = S(r.kind) as PromiseKind, base = JSON.parse(S(r.baseline_json)) as Baseline, due = S(r.due);
    if (clubId !== st.clubId) { resolve(db, id, 'void', date); continue; }
    if (S(r.target) === 'player') {
      const p = playerRow(db, S(r.player_id));
      if (!p || S(p.club_id) !== clubId) { resolve(db, id, 'void', date); continue; }
      const name = nameOf(p);
      let out: 'kept' | 'broken' | 'void' | null = null;
      if (kind === 'minutes') {
        const matches = clubPlayed(db, clubId) - (base.matches ?? 0);
        if (matches >= TALK.minutesMatches || date >= due) out = judgeMinutes(minutesFor(db, S(p.id), clubId) - (base.minutes ?? 0), matches);
      } else if (S(p.contract_end) > (base.contractEnd ?? '')) out = 'kept';
      else if (date >= due) out = 'broken';
      if (!out) continue;
      resolve(db, id, out, date);
      if (out === 'void') continue;
      const eff = EFFECT[kind];
      applyPlayer(db, S(p.id), out === 'kept' ? eff.kept : eff.broken);
      const what = kind === 'minutes' ? 'mais minutos em campo' : 'a renovação do contrato';
      addNews(db, date, 'squad', out === 'kept' ? `Promessa cumprida: ${name}` : `Promessa quebrada: ${name}`,
        out === 'kept' ? `Você cumpriu a promessa de ${what} a ${name}. A moral dele subiu.` : `Você não cumpriu a promessa de ${what} a ${name}. Ele ficou bastante chateado: a moral caiu ${-eff.broken} pontos.`,
        { sender: 'Comissão técnica', action: 'squad', actionLabel: 'Ver o elenco' });
      continue;
    }
    // diretoria
    const b = board(db);
    if (!b) { resolve(db, id, 'void', date); continue; }
    let out: 'kept' | 'broken' | 'void' | null = null, detail = '';
    if (kind === 'wins') {
      const res = resultsFrom(db, clubId, base.matches ?? 0, TALK.winsMatches);
      if (res.length >= TALK.winsMatches || date >= due) {
        const wins = res.filter((x) => x === 'V').length;
        out = judgeWins(wins, res.length); detail = `${wins} vitória(s) em ${res.length} jogo(s)`;
      }
    } else {
      const comp = base.competitionId ?? '';
      const left = N(db.prepare("SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = ? AND status = 'scheduled'").get(comp)!.n);
      if (left === 0) {
        const sit = leagueSituation(db, clubId, st.season);
        const pos = sit && sit.competitionId === comp ? sit.position : null;
        out = pos == null ? 'void' : pos <= (base.position ?? 0) ? 'kept' : 'broken'; detail = pos == null ? '' : `terminou em ${pos}º`;
      }
    }
    if (!out) continue;
    resolve(db, id, out, date);
    if (out === 'void') continue;
    const eff = EFFECT[kind];
    setConfidence(db, N(b.confidence) + (out === 'kept' ? eff.kept : eff.broken));
    const what = kind === 'wins' ? `${TALK.winsNeeded} vitórias em ${TALK.winsMatches} jogos` : `terminar a liga em ${base.position}º ou melhor`;
    addNews(db, date, 'board', out === 'kept' ? 'Diretoria: promessa cumprida' : 'Diretoria: promessa quebrada',
      `Você prometeu ${what} (${detail}). ${out === 'kept' ? `A confiança da diretoria subiu ${eff.kept} pontos.` : `A confiança da diretoria caiu ${-eff.broken} pontos.`}`,
      { actionLabel: 'Ver a Diretoria' });
  }
}

// ---------------------------------------------------------------- tela
function promiseDto(db: SqlDb, r: Record<string, unknown>): PromiseDto {
  const kind = S(r.kind) as PromiseKind, base = JSON.parse(S(r.baseline_json)) as Baseline, status = S(r.status) as PromiseDto['status'];
  const p = r.player_id == null ? null : playerRow(db, S(r.player_id));
  const clubId = S(r.club_id);
  const label = kind === 'minutes' ? `Mais minutos (média de ${TALK.minutesPerMatch} por jogo em ${TALK.minutesMatches} jogos)` : kind === 'renewal' ? 'Renovar o contrato'
    : kind === 'wins' ? `${TALK.winsNeeded} vitórias nos próximos ${TALK.winsMatches} jogos` : `Terminar a liga em ${base.position}º ou melhor`;
  let progress: string;
  if (status !== 'open') progress = status === 'kept' ? 'Cumprida' : status === 'broken' ? 'Quebrada' : 'Anulada (saiu do clube ou não houve jogos)';
  else if (kind === 'minutes' && p) {
    const m = clubPlayed(db, clubId) - (base.matches ?? 0);
    progress = `${minutesFor(db, S(p.id), clubId) - (base.minutes ?? 0)} min em ${m} de ${TALK.minutesMatches} jogos (precisa de ${TALK.minutesPerMatch * Math.max(1, m)})`;
  } else if (kind === 'renewal') progress = `Renovar até ${br(S(r.due))}`;
  else if (kind === 'wins') {
    const res = resultsFrom(db, clubId, base.matches ?? 0, TALK.winsMatches);
    progress = `${res.filter((x) => x === 'V').length} vitória(s) em ${res.length} de ${TALK.winsMatches} jogos`;
  } else {
    const sit = leagueSituation(db, clubId, getCareerState(db).season);
    progress = sit && sit.played > 0 ? `Agora: ${sit.position}º` : 'A liga ainda não começou';
  }
  return {
    id: N(r.id), target: S(r.target) as 'player' | 'board', playerId: p ? S(p.id) : null, playerName: p ? nameOf(p) : null, kind, label,
    madeOn: S(r.made_on), due: S(r.due), status, resolvedOn: r.resolved_on == null ? null : S(r.resolved_on), progress,
  };
}

export function getConversations(db: SqlDb): ConversationsDto {
  const st = getCareerState(db);
  const empty: ConversationsDto = { employed: false, requests: [], players: [], board: { nextTalk: null, confidence: null, topics: { promise_position: { label: TOPIC_LABEL.promise_position, detail: '', unavailable: 'Sem clube.' }, promise_wins: { label: TOPIC_LABEL.promise_wins, detail: '', unavailable: 'Sem clube.' } } }, open: [], recent: [], talks: [] };
  if (!st.clubId) return empty;
  const today = st.gameDate, clubId = st.clubId;
  const rows = db.prepare('SELECT id, first_name, last_name, club_id, morale, form, contract_end, position FROM players WHERE club_id = ? ORDER BY last_name, first_name').all(clubId);
  const players = rows.map((p) => ({
    id: S(p.id), name: nameOf(p), position: S(p.position) as Position, morale: Math.round(N(p.morale)), form: Math.round(N(p.form)), contractEnd: S(p.contract_end),
    nextTalk: nextTalkDate(db, clubId, 'player', S(p.id), today), topics: playerTopics(db, clubId, p, today),
  }));
  const requests = players.filter((p) => p.morale < REQUEST_MORALE).sort((a, b) => a.morale - b.morale)
    .map((p) => ({ playerId: p.id, name: p.name, position: p.position, morale: p.morale, reason: `Moral baixa (${p.morale}/100)` }));
  const b = board(db);
  const prom = (where: string, limit: number) => db.prepare(`SELECT * FROM promises WHERE club_id = ? AND ${where} ORDER BY COALESCE(resolved_on, made_on) DESC, id DESC LIMIT ?`).all(clubId, limit).map((r) => promiseDto(db, r));
  const talks = db.prepare('SELECT c.date, c.topic, c.outcome, c.target, p.first_name, p.last_name FROM conversations c LEFT JOIN players p ON p.id = c.player_id WHERE c.club_id = ? ORDER BY c.id DESC LIMIT 5').all(clubId)
    .map((t) => ({ date: S(t.date), who: S(t.target) === 'board' ? 'Diretoria' : `${S(t.first_name)} ${S(t.last_name)}`, topic: TOPIC_LABEL[S(t.topic) as PlayerTopicDto] ?? S(t.topic), outcome: S(t.outcome) }));
  return {
    employed: true, requests, players,
    board: { nextTalk: nextTalkDate(db, clubId, 'board', null, today), confidence: b ? N(b.confidence) : null, topics: boardTopics(db, clubId, today) },
    open: prom("status = 'open'", 50), recent: prom("status IN ('kept', 'broken')", 5), talks,
  };
}
