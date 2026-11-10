/**
 * Licenças de treinador (v0.8.10), inspiradas nos cursos da CBF Academy/UEFA (C → B → A → PRO): cada uma exige a anterior e
 * experiência, leva um tempo de curso (sem custo) e, ao ser concluída, dá um bônus de reputação e libera um teto maior de reputação.
 * Os clubes exigem licença pela divisão: 1ª → PRO, 2ª → A, demais divisões → B, clube sem divisão nacional (só estadual) → C.
 * Quem está matriculado no curso da licença exigida pode assumir o cargo (carência). Valores aproximados; ver docs/BOARD_JOBS.md.
 */
export type LicenseId = 'C' | 'B' | 'A' | 'PRO';
export type HeldLicense = LicenseId | 'none';

export interface LicenseRule {
  id: LicenseId; name: string; courseDays: number; reputationBonus: number; reputationCap: number;
  /** pré-requisito: licença anterior + dias de carreira e/ou temporadas completas empregado */
  requires: { license: HeldLicense; careerDays: number; employedSeasons: number };
}
export const LICENSES: readonly LicenseRule[] = [
  { id: 'C', name: 'Licença C', courseDays: 30, reputationBonus: 2, reputationCap: 45, requires: { license: 'none', careerDays: 0, employedSeasons: 0 } },
  { id: 'B', name: 'Licença B', courseDays: 120, reputationBonus: 3, reputationCap: 60, requires: { license: 'C', careerDays: 90, employedSeasons: 0 } },
  { id: 'A', name: 'Licença A', courseDays: 240, reputationBonus: 5, reputationCap: 80, requires: { license: 'B', careerDays: 0, employedSeasons: 1 } },
  { id: 'PRO', name: 'Licença PRO', courseDays: 365, reputationBonus: 8, reputationCap: 100, requires: { license: 'A', careerDays: 0, employedSeasons: 2 } },
];
/** Teto de reputação sem licença nenhuma. */
export const NO_LICENSE_CAP = 35;
const ORDER: HeldLicense[] = ['none', 'C', 'B', 'A', 'PRO'];

export const licenseRank = (l: HeldLicense | null | undefined): number => (l ? ORDER.indexOf(l) : 0);
export const licenseRule = (l: LicenseId): LicenseRule => LICENSES.find((x) => x.id === l)!;
export const licenseName = (l: HeldLicense): string => (l === 'none' ? 'Sem licença' : licenseRule(l).name);
export const reputationCap = (l: HeldLicense): number => (l === 'none' ? NO_LICENSE_CAP : licenseRule(l).reputationCap);
/** A próxima licença da trilha (null = já tem a PRO). */
export const nextLicense = (l: HeldLicense): LicenseId | null => (ORDER[licenseRank(l) + 1] as LicenseId | undefined) ?? null;
/** A licença imediatamente abaixo (para a licença inicial de quem começa num clube exigente). */
export const previousLicense = (l: LicenseId): HeldLicense => ORDER[licenseRank(l) - 1]!;

/** Licença exigida pelo clube: pela divisão (tier) da liga; `null` = sem divisão nacional (só estadual). */
export function requiredLicense(tier: number | null): LicenseId {
  if (tier == null || tier <= 0) return 'C';
  return tier === 1 ? 'PRO' : tier === 2 ? 'A' : 'B';
}
export const hasLicense = (held: HeldLicense, required: LicenseId): boolean => licenseRank(held) >= licenseRank(required);
/** Pode assumir o cargo: tem a licença exigida ou está matriculado no curso dela (ou de uma acima). */
export function canCoach(held: HeldLicense, course: LicenseId | null, required: LicenseId): boolean {
  return hasLicense(held, required) || (course !== null && licenseRank(course) >= licenseRank(required));
}

/** Reputação depois de uma variação, respeitando o teto da licença (quem já está acima do teto não perde por isso). */
export function cappedReputation(current: number, delta: number, held: HeldLicense): number {
  const cap = Math.max(reputationCap(held), current);
  return Math.max(1, Math.min(cap, 100, Math.round(current + delta)));
}

/** Por que não dá para se matricular (null = pode). Um curso por vez; só a próxima licença da trilha; pré-requisitos de experiência. */
export function enrollError(a: { held: HeldLicense; course: LicenseId | null; target: LicenseId; careerDays: number; employedSeasons: number }): string | null {
  if (a.course) return `Você já está no curso da ${licenseRule(a.course).name}. Um curso por vez.`;
  if (hasLicense(a.held, a.target)) return `Você já tem a ${licenseRule(a.target).name}.`;
  const r = licenseRule(a.target);
  if (a.held !== r.requires.license) return `A ${r.name} exige a ${licenseName(r.requires.license)} antes.`;
  if (a.careerDays < r.requires.careerDays) return `A ${r.name} exige ${r.requires.careerDays} dias de carreira (você tem ${a.careerDays}).`;
  if (a.employedSeasons < r.requires.employedSeasons) return `A ${r.name} exige ${r.requires.employedSeasons} temporada(s) completa(s) no comando de um clube (você tem ${a.employedSeasons}).`;
  return null;
}

/**
 * Licença inicial da carreira: a C, ou a B para quem começa com reputação 25+; nunca com teto abaixo da reputação inicial. Se o clube
 * escolhido exige mais, o treinador chega com a licença imediatamente abaixo da exigida e é matriculado no curso dela (carência), sem
 * os pré-requisitos de experiência.
 */
export function initialLicenses(reputation: number, required: LicenseId): { held: LicenseId; course: LicenseId | null } {
  let held: LicenseId = reputation >= 25 ? 'B' : 'C';
  while (reputationCap(held) < reputation && nextLicense(held)) held = nextLicense(held)!;
  if (hasLicense(held, required)) return { held, course: null };
  const below = previousLicense(required);
  if (below !== 'none' && licenseRank(below) > licenseRank(held)) held = below;
  return { held, course: required };
}
