import { createRng } from '../rng.ts';
import { COUNTRY_TEMPLATES } from '../world/names.ts';
import { generateAiCoach } from './coach.ts';
import type { WorldCoach } from '../../shared/types.ts';

/**
 * Técnicos do universo (Fase 9): fazem parte do mundo, como os jogadores. Os técnicos PADRÃO saem de uma semente fixa (não a da
 * carreira): um por clube, gerado só a partir do id e da reputação do clube (id `tec-<clube>`), e um grupo de desempregados
 * (15% do número de clubes, ids `tec-livre-N`). Pacotes de dados alteram, criam ou removem técnicos por cima deles (`coaches.json`).
 */
const ROOT = 'ai-coaches:universo';
const templateOf = (code: string) => COUNTRY_TEMPLATES.find((t) => t.code === code) ?? COUNTRY_TEMPLATES[0]!;
export type CoachClub = { id: string; reputation: number; countryCode: string };

/** id padrão do técnico de um clube (no máximo 60 caracteres, como todo id) */
export const clubCoachId = (clubId: string) => `tec-${clubId}`.slice(0, 60);

function toWorld(id: string, clubId: string | null, nationality: string, d: ReturnType<typeof generateAiCoach>): WorldCoach {
  return { id, firstName: d.firstName, lastName: d.lastName, birthDate: d.birthDate, nationality, clubId, reputation: d.reputation, methodology: d.methodology, attributes: d.attributes };
}

/** O técnico padrão de um clube (independe dos demais clubes e da ordem). `variant` gera outro para o mesmo clube. */
export function clubCoach(club: CoachClub, startDate: string, variant = ''): WorldCoach {
  const d = generateAiCoach(createRng(ROOT).fork(`${club.id}${variant}`), templateOf(club.countryCode), club.reputation, startDate);
  return toWorld(variant ? `${clubCoachId(club.id).slice(0, 55)}${variant}` : clubCoachId(club.id), club.id, club.countryCode, d);
}

/** Todos os técnicos padrão: os dos clubes (na ordem recebida) e depois os desempregados. */
export function defaultCoaches(clubs: readonly CoachClub[], startDate: string): WorldCoach[] {
  const rng = createRng(ROOT);
  const out = clubs.map((c) => clubCoach(c, startDate));
  const pool = Math.ceil(clubs.length * 0.15);
  for (let i = 0; i < pool && clubs.length; i++) {
    const c = clubs[Math.floor(rng.next() * clubs.length)]!;
    out.push(toWorld(`tec-livre-${i + 1}`, null, c.countryCode, generateAiCoach(rng.fork(`livre-${i}`), templateOf(c.countryCode), c.reputation - 5, startDate)));
  }
  return out;
}

/** Técnico criado por um pacote sem todos os campos: o que faltar vem de um técnico gerado para ele (pelo id). */
export function packCoachDefaults(id: string, reputation: number, nationality: string, startDate: string): WorldCoach {
  return toWorld(id, null, nationality, generateAiCoach(createRng(`${ROOT}:pacote`).fork(id), templateOf(nationality), reputation, startDate));
}
