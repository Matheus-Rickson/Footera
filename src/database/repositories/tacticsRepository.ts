import type { SqlDb } from '../types.ts';
import { withTransaction } from '../types.ts';
import { UserError } from '../../shared/errors.ts';
import { FORMATIONS, getFormation } from '../../game/match-engine/formations.ts';
import { assignLineup, tacticsForMethodology, toMatchPlayer } from '../../game/match-engine/team-builder.ts';
import { roleRating } from '../../game/match-engine/roles.ts';
import type { TeamTactics } from '../../game/match-engine/types.ts';
import type { Coach, Methodology, Position } from '../../shared/types.ts';
import type { SchemeDto, SchemeInput, TacticsOverviewDto, TacticsSquadPlayer } from '../../shared/api.ts';
import { getCareerState } from './competitionRepository.ts';
import { loadSquad } from './squadRepository.ts';

export class TacticsError extends UserError {}

const S = (v: unknown) => String(v);
const POSITIONS: Position[] = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'];
const POS_ORDER = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'];
const NAME_RE = /^[\p{L}\p{N} _.()\-+/]+$/u;
const MENTALITIES = ['defensive', 'balanced', 'attacking'];
const BUILDUPS = ['short', 'mixed', 'long'];
/** Formação inicial recomendada por metodologia (as preferências iniciais do treinador). */
const DEFAULT_FORMATION: Record<Methodology, string> = { defensive: '5-3-2', possession: '4-3-3', aggressive: '4-2-3-1' };

const builtinId = (formation: string) => `sch_b_${formation}`;

function coachOf(db: SqlDb): Coach {
  return JSON.parse(S(db.prepare('SELECT coach_json FROM career WHERE id = 1').get()!.coach_json)) as Coach;
}

function toDto(r: Record<string, unknown>, activeId: string | null): SchemeDto {
  return {
    id: S(r.id), name: S(r.name), formation: S(r.formation), settings: JSON.parse(S(r.settings_json)) as TeamTactics,
    lineup: r.lineup_json == null ? null : (JSON.parse(S(r.lineup_json)) as string[]), builtin: Number(r.builtin) === 1, active: S(r.id) === activeId,
  };
}

function activeId(db: SqlDb): string | null {
  const r = db.prepare('SELECT active_scheme_id FROM career WHERE id = 1').get();
  return r?.active_scheme_id == null ? null : S(r.active_scheme_id);
}

/** Cria os 7 esquemas padrão (idempotente) e garante que exista um esquema ativo. Também repara saves anteriores à Fase 5. */
export function ensureSchemes(db: SqlDb, now: Date = new Date()): void {
  withTransaction(db, () => {
    const coach = coachOf(db);
    const ts = now.toISOString();
    const ins = db.prepare('INSERT OR IGNORE INTO tactic_schemes (id, name, formation, settings_json, lineup_json, builtin, created_at, updated_at) VALUES (?,?,?,?,NULL,1,?,?)');
    for (const f of FORMATIONS) ins.run(builtinId(f.id), `${f.id} (padrão)`, f.id, JSON.stringify(tacticsForMethodology(coach.methodology)), ts, ts);
    const cur = activeId(db);
    const valid = cur && db.prepare('SELECT 1 AS x FROM tactic_schemes WHERE id = ?').get(cur);
    if (!valid) db.prepare('UPDATE career SET active_scheme_id = ? WHERE id = 1').run(builtinId(DEFAULT_FORMATION[coach.methodology]));
  });
}

export function listSchemes(db: SqlDb): SchemeDto[] {
  const act = activeId(db);
  return db.prepare('SELECT * FROM tactic_schemes ORDER BY builtin DESC, rowid').all().map((r) => toDto(r, act));
}

export function getActiveScheme(db: SqlDb): SchemeDto | null {
  const id = activeId(db);
  const r = id ? db.prepare('SELECT * FROM tactic_schemes WHERE id = ?').get(id) : undefined;
  return r ? toDto(r, id) : null;
}

function validateSettings(s: TeamTactics): void {
  if (!s || !MENTALITIES.includes(s.mentality)) throw new TacticsError('Mentalidade inválida.');
  if (!BUILDUPS.includes(s.buildUp)) throw new TacticsError('Saída de bola inválida.');
  for (const [k, label] of [['tempo', 'Ritmo'], ['width', 'Amplitude'], ['defensiveLine', 'Linha defensiva'], ['pressing', 'Pressão']] as const) {
    const v = s[k];
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new TacticsError(`${label} deve ser um número inteiro de 1 a 5.`);
  }
}

function cleanName(raw: string): string {
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > 40) throw new TacticsError('O nome do esquema deve ter de 1 a 40 caracteres.');
  if (!NAME_RE.test(name)) throw new TacticsError('Use apenas letras, números, espaços e os símbolos . _ - ( ) + / no nome do esquema.');
  return name;
}

/** Busca por nome ignorando maiúsculas/acentuação de caixa em pt-BR (o NOCASE do SQLite só dobra letras ASCII). */
function findByName(db: SqlDb, name: string): string | null {
  const key = name.toLocaleLowerCase('pt-BR');
  for (const r of db.prepare('SELECT id, name FROM tactic_schemes').all()) if (S(r.name).toLocaleLowerCase('pt-BR') === key) return S(r.id);
  return null;
}

function nextUserId(db: SqlDb): string {
  let max = 0;
  for (const r of db.prepare("SELECT id FROM tactic_schemes WHERE id LIKE 'sch_u_%'").all()) max = Math.max(max, Number(S(r.id).slice(6)) || 0);
  return `sch_u_${max + 1}`;
}

export function saveScheme(db: SqlDb, input: SchemeInput, now: Date = new Date()): SchemeDto {
  const name = cleanName(input.name);
  if (!FORMATIONS.some((f) => f.id === input.formation)) throw new TacticsError('Formação desconhecida.');
  validateSettings(input.settings);
  if (input.lineup !== null) {
    if (!Array.isArray(input.lineup) || input.lineup.length !== 11) throw new TacticsError('A escalação precisa ter exatamente 11 jogadores.');
    if (new Set(input.lineup).size !== 11) throw new TacticsError('Há jogador repetido na escalação.');
    const st = getCareerState(db);
    const own = new Set(db.prepare('SELECT id FROM players WHERE club_id = ?').all(st.clubId).map((r) => S(r.id)));
    if (input.lineup.some((id) => !own.has(id))) throw new TacticsError('A escalação contém jogador que não pertence ao seu clube.');
  }
  return withTransaction(db, () => {
    const clash = findByName(db, name);
    const ts = now.toISOString();
    if (input.id) {
      const cur = db.prepare('SELECT * FROM tactic_schemes WHERE id = ?').get(input.id);
      if (!cur) throw new TacticsError('Esquema não encontrado.');
      if (Number(cur.builtin) === 1) throw new TacticsError('Esquemas padrão não podem ser editados. Duplique-o para criar a sua versão.');
      if (clash && clash !== input.id) throw new TacticsError('Já existe um esquema com esse nome.');
      db.prepare('UPDATE tactic_schemes SET name = ?, formation = ?, settings_json = ?, lineup_json = ?, updated_at = ? WHERE id = ?')
        .run(name, input.formation, JSON.stringify(input.settings), input.lineup ? JSON.stringify(input.lineup) : null, ts, input.id);
      return toDto(db.prepare('SELECT * FROM tactic_schemes WHERE id = ?').get(input.id)!, activeId(db));
    }
    if (clash) throw new TacticsError('Já existe um esquema com esse nome.');
    const id = nextUserId(db);
    db.prepare('INSERT INTO tactic_schemes (id, name, formation, settings_json, lineup_json, builtin, created_at, updated_at) VALUES (?,?,?,?,?,0,?,?)')
      .run(id, name, input.formation, JSON.stringify(input.settings), input.lineup ? JSON.stringify(input.lineup) : null, ts, ts);
    return toDto(db.prepare('SELECT * FROM tactic_schemes WHERE id = ?').get(id)!, activeId(db));
  });
}

export function duplicateScheme(db: SqlDb, id: string, now: Date = new Date()): SchemeDto {
  const src = listSchemes(db).find((s) => s.id === id);
  if (!src) throw new TacticsError('Esquema não encontrado.');
  const base = `${src.name.replace(/ \(cópia\)( \d+)?$/, '')} (cópia)`.slice(0, 40);
  let name = base;
  for (let n = 2; findByName(db, name); n++) name = `${base.slice(0, 40 - String(n).length - 1)} ${n}`;
  return saveScheme(db, { id: null, name, formation: src.formation, settings: src.settings, lineup: src.lineup }, now);
}

export function deleteScheme(db: SqlDb, id: string): void {
  withTransaction(db, () => {
    const cur = db.prepare('SELECT builtin FROM tactic_schemes WHERE id = ?').get(id);
    if (!cur) throw new TacticsError('Esquema não encontrado.');
    if (Number(cur.builtin) === 1) throw new TacticsError('Esquemas padrão não podem ser excluídos.');
    if (activeId(db) === id) db.prepare('UPDATE career SET active_scheme_id = ? WHERE id = 1').run(builtinId(DEFAULT_FORMATION[coachOf(db).methodology]));
    db.prepare('DELETE FROM tactic_schemes WHERE id = ?').run(id);
  });
}

export function activateScheme(db: SqlDb, id: string): void {
  if (!db.prepare('SELECT 1 AS x FROM tactic_schemes WHERE id = ?').get(id)) throw new TacticsError('Esquema não encontrado.');
  db.prepare('UPDATE career SET active_scheme_id = ? WHERE id = 1').run(id);
}

/** Melhor XI disponível (sem lesionados/suspensos) para a formação, alinhado às posições dela. */
export function autoLineup(db: SqlDb, formationId: string): string[] {
  if (!FORMATIONS.some((f) => f.id === formationId)) throw new TacticsError('Formação desconhecida.');
  const st = getCareerState(db);
  const squad = loadSquad(db, st.clubId, st.gameDate);
  return assignLineup(squad.available.map(toMatchPlayer), getFormation(formationId)).lineup.map((l) => l.player.id);
}

export function getTacticsOverview(db: SqlDb): TacticsOverviewDto {
  const st = getCareerState(db);
  const squad = loadSquad(db, st.clubId, st.gameDate);
  const players: TacticsSquadPlayer[] = squad.players.map((p) => {
    const s = squad.status.get(p.id);
    const unavailable = s?.injuryUntil && s.injuryUntil > st.gameDate ? { kind: 'injured' as const, until: s.injuryUntil }
      : (s?.suspension ?? 0) > 0 ? { kind: 'suspended' as const, matches: s!.suspension } : null;
    const mp = toMatchPlayer(p);
    const slotScores = Object.fromEntries(POSITIONS.map((pos) => [pos, Math.round(roleRating(mp, pos))])) as Record<Position, number>;
    return { id: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position, secondaryPositions: p.secondaryPositions, overall: p.overall, condition: p.condition, unavailable, slotScores };
  }).sort((a, b) => POS_ORDER.indexOf(a.position) - POS_ORDER.indexOf(b.position) || b.overall - a.overall);
  return { schemes: listSchemes(db), squad: players, formations: FORMATIONS.map((f) => ({ id: f.id, slots: f.slots })) };
}
