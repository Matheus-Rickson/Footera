/**
 * Formato dos pacotes de dados (patches) — versão 1. Ver docs/DATABASE.md e docs/schema/.
 *
 * Um pacote é uma pasta com `manifest.json` e arquivos JSON por tipo (countries, leagues, stadiums, clubs, players). Cada registro tem um `id`
 * fixo: se o id ainda não existe no universo, o registro CRIA a entidade (precisa dos campos obrigatórios); se já existe, ALTERA só os campos
 * informados; `"$remove": true` REMOVE. Campos desconhecidos são erro (pega erros de digitação). Escalas: atributos, habilidade e potencial
 * de 1 a 20 (como na tela); reputação de 1 a 100.
 */
import { z } from 'zod';
import { ID_PATTERN } from '../../shared/slug.ts';
import type { Position } from '../../shared/types.ts';

export const PACK_FORMAT = 1;
/** Arquivos de dados, na ordem em que são aplicados (dependências primeiro). */
export const PACK_FILES = ['countries', 'leagues', 'stadiums', 'clubs', 'players'] as const;
export type PackFile = typeof PACK_FILES[number];

const id = z.string().regex(ID_PATTERN, 'id inválido: use minúsculas, números, "-" ou "_" (até 60 caracteres)');
const text = (max: number) => z.string().trim().min(1).max(max);
const int = (min: number, max: number) => z.number().int().min(min).max(max);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD');
const code3 = z.string().regex(/^[A-Z]{3}$/, 'código de país com 3 letras maiúsculas (ex.: BRA)');
const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'LM', 'RM', 'AM', 'LW', 'RW', 'SS', 'CF', 'ST'] as const satisfies readonly Position[];
const position = z.enum(POSITIONS);
const attr = int(1, 20);
const remove = { $remove: z.literal(true).optional() };

export const manifestSchema = z.object({
  format: z.literal(PACK_FORMAT),
  id,
  name: text(80),
  version: text(20),
  author: text(80).optional(),
  description: z.string().max(1000).optional(),
  /** pacotes que precisam vir antes deste na ordem de carga */
  requires: z.array(id).max(50).optional(),
  /** "none" = base de dados completa: descarta o universo gerado (só vale como primeiro pacote da ordem) */
  base: z.enum(['generated', 'none']).optional(),
}).strict();
export type PackManifest = z.infer<typeof manifestSchema>;

export const countrySchema = z.object({ id, ...remove, code: code3.optional(), name: text(60).optional(), economy: z.number().min(0.1).max(5).optional() }).strict();

const rulesSchema = z.object({
  rounds: int(1, 4).optional(), pointsWin: int(1, 5).optional(), pointsDraw: int(0, 3).optional(),
  promotionSlots: int(0, 10).optional(), relegationSlots: int(0, 10).optional(), continentalSlots: int(0, 10).optional(),
  maxForeignPlayers: int(0, 30).nullable().optional(), squadMin: int(14, 30).optional(), squadMax: int(18, 40).optional(),
  calendar: z.object({ seasonStart: z.string().regex(/^\d{2}-\d{2}$/), matchWeekday: int(0, 6), intervalDays: int(3, 14) }).strict().optional(),
}).strict();
export const leagueSchema = z.object({ id, ...remove, country: id.optional(), name: text(60).optional(), tier: int(1, 10).optional(), rules: rulesSchema.optional() }).strict();

export const stadiumSchema = z.object({ id, ...remove, name: text(80).optional(), city: text(60).optional(), capacity: int(500, 250_000).optional() }).strict();

export const clubSchema = z.object({
  id, ...remove,
  name: text(60).optional(), shortName: z.string().trim().min(2).max(5).optional(),
  country: id.optional(), league: id.optional(), city: text(60).optional(),
  /** sem estádio informado, um é criado para o clube */
  stadium: id.optional(),
  reputation: int(1, 100).optional(), balance: int(-1e10, 1e11).optional(), fans: int(0, 1e8).optional(),
  facilities: z.object({ training: attr.optional(), youth: attr.optional(), medical: attr.optional(), stadium: attr.optional() }).strict().optional(),
}).strict();

const technical = z.object({ finishing: attr, passing: attr, dribbling: attr, tackling: attr, marking: attr, firstTouch: attr, crossing: attr, heading: attr, longShots: attr, goalkeeping: attr }).strict();
const mental = z.object({ vision: attr, composure: attr, decisions: attr, positioning: attr, workRate: attr, leadership: attr, aggression: attr }).strict();
const physical = z.object({ pace: attr, stamina: attr, strength: attr, agility: attr, jumping: attr, naturalFitness: attr }).strict();
const goalkeeper = z.object({ reflexes: attr, oneOnOne: attr, handling: attr, aerial: attr, rushingOut: attr, kicking: attr }).strict();
export const playerSchema = z.object({
  id, ...remove,
  firstName: text(40).optional(), lastName: text(40).optional(), birthDate: date.optional(),
  nationality: code3.optional(), extraNationalities: z.array(code3).max(3).optional(),
  /** null = sem clube (livre no mercado) */
  club: id.nullable().optional(),
  position: position.optional(), secondaryPositions: z.array(position).max(3).optional(),
  foot: z.enum(['right', 'left', 'both']).optional(), heightCm: int(140, 220).optional(), weightKg: int(40, 130).optional(),
  /** os 23 atributos (1–20); ao alterar, pode informar só alguns */
  attributes: z.object({ technical: technical.partial().optional(), mental: mental.partial().optional(), physical: physical.partial().optional(),
    /** atributos de goleiro (reflexos, um contra um, manejo, jogo aéreo, saídas, reposição); o "goalkeeping" técnico é calculado deles */
    goalkeeper: goalkeeper.partial().optional() }).strict().optional(),
  /** força 1–20 (como na tela): sem `attributes`, o jogo gera atributos coerentes com a posição para chegar nela */
  ability: attr.optional(),
  /** potencial 1–20 */
  potential: attr.optional(),
  personality: z.object({ professionalism: attr, ambition: attr, loyalty: attr, temperament: attr, consistency: attr }).partial().strict().optional(),
  contract: z.object({ salary: int(0, 1e8).optional(), end: date.optional() }).strict().optional(),
  marketValue: int(0, 1e11).optional(),
  /** valores internos do motor (0–100), usados pela exportação da base para reproduzi-la exatamente; autores normalmente não precisam */
  internal: z.object({
    potentialHidden: int(1, 100).optional(), potentialEstimated: int(1, 100).optional(),
    condition: z.number().min(0).max(100).optional(), fatigue: z.number().min(0).max(100).optional(),
    morale: z.number().min(0).max(100).optional(), form: z.number().min(0).max(100).optional(),
  }).strict().optional(),
}).strict();

export const fileSchemas = { countries: countrySchema, leagues: leagueSchema, stadiums: stadiumSchema, clubs: clubSchema, players: playerSchema } as const;
export type CountryRec = z.infer<typeof countrySchema>;
export type LeagueRec = z.infer<typeof leagueSchema>;
export type StadiumRec = z.infer<typeof stadiumSchema>;
export type ClubRec = z.infer<typeof clubSchema>;
export type PlayerRec = z.infer<typeof playerSchema>;
export interface PackData { countries: CountryRec[]; leagues: LeagueRec[]; stadiums: StadiumRec[]; clubs: ClubRec[]; players: PlayerRec[] }
export interface Pack { manifest: PackManifest; data: PackData }

/** Problema encontrado num pacote: onde (pacote, arquivo, registro) e o quê. */
export interface PackIssue { pack: string; file: string; record?: string; message: string }
export class PackError extends Error {
  readonly issues: PackIssue[];
  constructor(issues: PackIssue[]) {
    super(`Pacote de dados inválido:\n${issues.slice(0, 20).map(fmtIssue).join('\n')}${issues.length > 20 ? `\n… e mais ${issues.length - 20} problema(s)` : ''}`);
    this.issues = issues;
  }
}
export const fmtIssue = (i: PackIssue) => `${i.pack} › ${i.file}${i.record ? ` › ${i.record}` : ''}: ${i.message}`;

/**
 * Valida a estrutura de um pacote já lido (objetos JSON). Não consulta o universo: referências e campos obrigatórios de criação
 * são conferidos na montagem (`compileUniverse`). Todos os problemas são relatados de uma vez.
 */
export function parsePack(raw: { manifest: unknown; files: Partial<Record<PackFile, unknown>> }, source = 'pacote'): Pack {
  const issues: PackIssue[] = [];
  const m = manifestSchema.safeParse(raw.manifest);
  const packName = m.success ? m.data.id : source;
  if (!m.success) for (const e of m.error.issues) issues.push({ pack: source, file: 'manifest.json', message: `${e.path.join('.') || '(raiz)'}: ${e.message}` });
  const data = { countries: [], leagues: [], stadiums: [], clubs: [], players: [] } as PackData;
  for (const f of PACK_FILES) {
    const content = raw.files[f];
    if (content === undefined) continue;
    if (!Array.isArray(content)) { issues.push({ pack: packName, file: `${f}.json`, message: 'o arquivo deve conter uma lista ([ … ]) de registros' }); continue; }
    const seen = new Set<string>();
    content.forEach((rec, i) => {
      const r = fileSchemas[f].safeParse(rec);
      const label = typeof (rec as { id?: unknown })?.id === 'string' ? String((rec as { id: string }).id) : `registro ${i + 1}`;
      if (!r.success) { for (const e of r.error.issues) issues.push({ pack: packName, file: `${f}.json`, record: label, message: `${e.path.join('.') || '(registro)'}: ${e.message}` }); return; }
      if (seen.has(r.data.id)) { issues.push({ pack: packName, file: `${f}.json`, record: label, message: 'id repetido no mesmo arquivo' }); return; }
      seen.add(r.data.id);
      (data[f] as unknown[]).push(r.data);
    });
  }
  if (issues.length) throw new PackError(issues);
  return { manifest: m.data!, data };
}
