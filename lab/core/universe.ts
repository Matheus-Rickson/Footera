/**
 * Universos de teste do Laboratório. Os mundos são montados uma vez por processo e nunca modificados.
 * - `calib`: o universo das calibrações do motor (Brasil e Inglaterra, duas divisões; `generateWorld({ seed: 'calib' })`, o mesmo dos testes).
 * - `base`: a base fixa do jogo (data/base), sem pacotes do usuário.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWorld } from '../../src/game/world/generator.ts';
import { baseUniverse, setBaseUniverseDir } from '../../src/services/universeService.node.ts';
import { buildSheet, toMatchPlayer } from '../../src/game/match-engine/team-builder.ts';
import { FORMATIONS } from '../../src/game/match-engine/formations.ts';
import type { MatchPlayer, TeamSheet, TeamTactics } from '../../src/game/match-engine/types.ts';
import type { Player, World } from '../../src/shared/types.ts';
import { ParamError } from './types.ts';

export type UniverseId = 'calib' | 'base';
export const UNIVERSES: Array<{ value: UniverseId; label: string }> = [
  { value: 'calib', label: 'Calibração (Brasil e Inglaterra, 2 divisões)' },
  { value: 'base', label: 'Base fixa do jogo (sem pacotes)' },
];

/**
 * Raiz do repositório. O lançador da janela informa por FOOTERA_LAB_ROOT (no pacote do Electron não há import.meta.url);
 * no terminal, sai do caminho deste arquivo (lab/core → ../..).
 */
export function repoRoot(): string {
  if (process.env.FOOTERA_LAB_ROOT) return process.env.FOOTERA_LAB_ROOT;
  try { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); } catch { return process.cwd(); }
}

interface Loaded { world: World; byClub: Map<string, Player[]>; strength: Map<string, number> }
const cache = new Map<UniverseId, Loaded>();

export function loadUniverse(id: UniverseId): Loaded {
  const hit = cache.get(id);
  if (hit) return hit;
  let world: World;
  if (id === 'calib') world = generateWorld({ seed: 'calib' });
  else if (id === 'base') { setBaseUniverseDir(path.join(repoRoot(), 'data', 'base')); world = baseUniverse().world; }
  else throw new ParamError(`Universo desconhecido: ${String(id)}`);
  const byClub = new Map<string, Player[]>();
  for (const p of world.players) if (p.clubId) (byClub.get(p.clubId) ?? byClub.set(p.clubId, []).get(p.clubId)!).push(p);
  const strength = new Map<string, number>();
  for (const [cid, ps] of byClub) {
    const top = ps.map((p) => p.overall).sort((a, b) => b - a).slice(0, 11);
    strength.set(cid, top.reduce((s, v) => s + v, 0) / Math.max(1, top.length));
  }
  const loaded = { world, byClub, strength };
  cache.set(id, loaded);
  return loaded;
}

export const asUniverse = (v: unknown): UniverseId => {
  if (v === 'calib' || v === 'base') return v;
  throw new ParamError(`Universo inválido: ${String(v)} (use calib ou base)`);
};

/** clubes com elenco completo o bastante para jogar (18+), do mais forte ao mais fraco */
export function playableClubs(u: UniverseId): Array<{ id: string; name: string; leagueId: string; strength: number }> {
  const { world, byClub, strength } = loadUniverse(u);
  return world.clubs
    .filter((c) => (byClub.get(c.id)?.length ?? 0) >= 18)
    .map((c) => ({ id: c.id, name: c.name, leagueId: c.leagueId, strength: strength.get(c.id) ?? 0 }))
    .sort((a, b) => b.strength - a.strength);
}

/** opções de clube para os formulários: "Nome (liga · força)" */
export function clubOptions(u: UniverseId): Array<{ value: string; label: string }> {
  return playableClubs(u).map((c) => ({ value: c.id, label: `${c.name} (${c.leagueId} · ${c.strength.toFixed(1)})` }));
}

/**
 * Clubes de nível médio e parecido da 1ª liga (a mesma escolha de `midClubs()` dos testes no universo calib):
 * do 7º ao 14º em reputação. Na base, a 1ª liga do Brasil.
 */
export function midClubs(u: UniverseId): string[] {
  const { world } = loadUniverse(u);
  const lg = u === 'base' ? (world.leagues.find((l) => l.id === 'bra-1') ?? world.leagues[0]!) : world.leagues[0]!;
  return world.clubs.filter((c) => c.leagueId === lg.id).sort((a, b) => a.reputation - b.reputation).slice(6, 14).map((c) => c.id);
}

export const FORMATION_OPTIONS = FORMATIONS.map((f) => ({ value: f.id, label: f.id }));
export const BALANCED: TeamTactics = { mentality: 'balanced', tempo: 3, width: 3, defensiveLine: 3, pressing: 3, buildUp: 'mixed' };

export interface SideSetup { clubId: string; formation: string; tactics: TeamTactics }

/**
 * Escalação de um clube para o motor. Jogadores descansados e com moral/forma neutras (como nas baterias de calibração), e ids
 * prefixados pelo lado: um clube pode enfrentar a si mesmo (espelho) sem jogadores repetidos.
 */
export function sheetFor(u: UniverseId, side: SideSetup, prefix: 'H:' | 'A:'): TeamSheet {
  const { world, byClub } = loadUniverse(u);
  const club = world.clubs.find((c) => c.id === side.clubId);
  if (!club) throw new ParamError(`Clube não encontrado no universo ${u}: ${side.clubId}`);
  const squad: MatchPlayer[] = (byClub.get(club.id) ?? []).map((p) => ({ ...toMatchPlayer({ ...p, condition: 100, morale: 70, form: 60 }), id: prefix + p.id }));
  if (squad.length < 16) throw new ParamError(`${club.name} tem só ${squad.length} jogadores (mínimo 16).`);
  return buildSheet({ clubId: club.id, name: club.name, squad, tactics: side.tactics, ...(side.formation !== 'auto' ? { formationId: side.formation } : {}) });
}

export const clubName = (u: UniverseId, id: string): string => loadUniverse(u).world.clubs.find((c) => c.id === id)?.name ?? id;
/** id do jogador sem o prefixo de lado */
export const rawId = (id: string): string => id.replace(/^[HA]:/, '');
