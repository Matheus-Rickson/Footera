/**
 * Supercopas nacionais (Fase 9). Regras do levantamento docs/supercopas-regulamentos.pdf (06/11/2026), aprovadas pelo usuário com as
 * propostas do documento: começam na 2ª temporada da carreira (usam campeões da temporada anterior no save, nada inventado); só troféu,
 * sem prêmio em dinheiro; abrem a temporada (fim de julho nos países de julho; fim de janeiro nos de ano civil), exceto Espanha e Itália
 * (início de janeiro). Áustria (extinta) e México (Apertura/Clausura que a base não tem): sem supercopa.
 * Rússia: campeão da Premier Liga × vencedor da Copa da Rússia (motor de formatos, docs/COPA_RUSSIA.md).
 *
 * Classificados: campeão da liga (1ª divisão) e campeão da copa da temporada anterior do país. Se o mesmo clube ganhar os dois
 * (`double`): vice da liga ('league2'), vice da copa ('cup2') ou sem jogo ('none', Croácia). Espanha: quatro clubes (campeão e vice da
 * liga e da copa; vagas repetidas vão para 3º, 4º... da liga), semifinais campeão da liga × vice da copa e campeão da copa × vice da liga.
 */
import type { CupFormat, CupStage, Source } from './formats.ts';

export type SupercupDouble = 'league2' | 'cup2' | 'none';
/** Quem manda: campo neutro, o campeão da copa (ou quem herdou a vaga) ou o campeão da liga. */
export type SupercupHost = 'neutral' | 'cup' | 'league';

export interface SupercupRule {
  id: string; countryCode: string; name: string; regulation: string;
  source: { structure: Source; tiebreak: Source; host: Source };
  teams: 2 | 4;
  double: SupercupDouble;
  host: SupercupHost;
  /** prorrogação antes dos pênaltis */
  extraTime: boolean;
  /** data (MM-DD) na temporada de julho; Espanha: [semifinais, final] */
  dates: string[];
  /** data quando o país joga no ano civil (ausente = `dates`) */
  datesCalendarYear?: string[];
  /** substituições extras (Community Shield: 6) */
  extraSub?: boolean;
}

const JULY = ['07-26'];   // último fim de semana de julho, antes da 1ª rodada (1º sábado de agosto)
const CIVIL = ['01-24'];  // uma semana antes da 1ª rodada do ano civil (31/jan)

export const SUPERCUP_RULES: SupercupRule[] = [
  { id: 'bra', countryCode: 'BRA', name: 'Supercopa do Brasil', regulation: 'CBF — regulamento 2020 (citado) e edições 2021–2026', source: { structure: 'SEC', tiebreak: 'SEC', host: 'SEC' },
    teams: 2, double: 'league2', host: 'neutral', extraTime: false, dates: JULY, datesCalendarYear: CIVIL },
  { id: 'eng', countryCode: 'ENG', name: 'Community Shield', regulation: 'The FA — edições 2025 e 2026', source: { structure: 'SEC', tiebreak: 'SEC', host: 'SEC' },
    teams: 2, double: 'league2', host: 'neutral', extraTime: false, dates: JULY, extraSub: true },
  { id: 'esp', countryCode: 'ESP', name: 'Supercopa de España', regulation: 'RFEF — edições 2025 e 2026 (prorrogação suprimida)', source: { structure: 'SEC', tiebreak: 'SEC', host: 'SEC' },
    teams: 4, double: 'league2', host: 'neutral', extraTime: false, dates: ['01-08', '01-11'] },
  { id: 'ger', countryCode: 'GER', name: 'Franz Beckenbauer Supercup', regulation: 'DFL — edições 2025 e 2026', source: { structure: 'SEC', tiebreak: 'SEC', host: 'SEC' },
    teams: 2, double: 'league2', host: 'cup', extraTime: false, dates: JULY },
  { id: 'ita', countryCode: 'ITA', name: 'Supercoppa Italiana', regulation: 'Lega Serie A — formato de dois clubes (2026/27)', source: { structure: 'SEC', tiebreak: 'ADAPT', host: 'ADAPT' },
    teams: 2, double: 'cup2', host: 'league', extraTime: false, dates: ['01-04'] },
  { id: 'fra', countryCode: 'FRA', name: 'Trophée des Champions', regulation: 'LFP — edições 2025 e 2026', source: { structure: 'SEC', tiebreak: 'SEC', host: 'ADAPT' },
    teams: 2, double: 'league2', host: 'neutral', extraTime: false, dates: JULY },
  { id: 'por', countryCode: 'POR', name: 'Supertaça Cândido de Oliveira', regulation: 'FPF — edições 2025 e 2026', source: { structure: 'SEC', tiebreak: 'SEC', host: 'SEC' },
    teams: 2, double: 'cup2', host: 'neutral', extraTime: true, dates: JULY },
  { id: 'ned', countryCode: 'NED', name: 'Johan Cruijff Schaal', regulation: 'KNVB — edições 2017–2026', source: { structure: 'SEC', tiebreak: 'ADAPT', host: 'SEC' },
    teams: 2, double: 'league2', host: 'league', extraTime: false, dates: JULY },
  // 2025: CSKA (copa) 1×0 Krasnodar (liga), 12/07 em Kazan; dobradinha de 2020 (Zenit): vice da liga (Lokomotiv). Prorrogação: as
  // edições recentes foram do empate direto aos pênaltis (2024: Zenit 1×1 Spartak, 4×2 nos pênaltis) — regulamento da RFS não obtido
  { id: 'rus', countryCode: 'RUS', name: 'Supercopa da Rússia', regulation: 'RFS/RPL — edições 2020–2025 (regulamento não obtido)', source: { structure: 'SEC', tiebreak: 'ADAPT', host: 'SEC' },
    teams: 2, double: 'league2', host: 'neutral', extraTime: false, dates: JULY },
  { id: 'arg', countryCode: 'ARG', name: 'Supercopa Argentina', regulation: 'AFA — adaptado (sem Trofeo de Campeones)', source: { structure: 'ADAPT', tiebreak: 'SEC', host: 'SEC' },
    teams: 2, double: 'league2', host: 'neutral', extraTime: false, dates: JULY, datesCalendarYear: CIVIL },
  { id: 'bel', countryCode: 'BEL', name: 'Supercup', regulation: 'Pro League — edições recentes', source: { structure: 'SEC', tiebreak: 'SEC', host: 'SEC' },
    teams: 2, double: 'cup2', host: 'league', extraTime: false, dates: JULY },
  { id: 'jpn', countryCode: 'JPN', name: 'Fujifilm Super Cup', regulation: 'J.League — edições 2025 e 2026', source: { structure: 'SEC', tiebreak: 'SEC', host: 'SEC' },
    teams: 2, double: 'league2', host: 'neutral', extraTime: false, dates: JULY, datesCalendarYear: CIVIL },
  { id: 'irl', countryCode: 'IRL', name: "President of Ireland's Cup", regulation: 'FAI — edições 2021–2026', source: { structure: 'SEC', tiebreak: 'SEC', host: 'SEC' },
    teams: 2, double: 'league2', host: 'neutral', extraTime: false, dates: JULY, datesCalendarYear: CIVIL },
  { id: 'cro', countryCode: 'CRO', name: 'Supercup', regulation: 'HNS — edições 2024 e 2025 (sem jogo na dobradinha)', source: { structure: 'SEC', tiebreak: 'SEC', host: 'SEC' },
    teams: 2, double: 'none', host: 'league', extraTime: true, dates: JULY },
];

export const supercupRuleFor = (code: string, rules: readonly SupercupRule[] = SUPERCUP_RULES): SupercupRule | null => rules.find((r) => r.countryCode === code) ?? null;

/** Classificação da temporada anterior do país, para montar a supercopa. Listas vazias = sem dado (1ª temporada, transição). */
export interface SupercupInputs { league: string[]; cupWinner: string | null; cupRunnerUp: string | null }

/**
 * Participantes na ordem do chaveamento. Duas equipes: [mandante (se houver mando), visitante]; quatro: [L1, C2, C1, L2] (semifinais
 * 1×2 e 3×4). null = não há supercopa nesta temporada (faltam campeões, ou dobradinha na Croácia).
 */
export function supercupEntrants(rule: SupercupRule, inp: SupercupInputs): string[] | null {
  const [l1, l2] = inp.league;
  const c1 = inp.cupWinner, c2 = inp.cupRunnerUp;
  if (!l1 || !c1) return null;
  if (rule.teams === 4) {
    if (!c2 || !l2) return null;
    // vagas por prioridade (campeão da liga, vice da liga, campeão da copa, vice da copa); repetidas vão para 3º, 4º... da liga
    const slots = [l1, l2, c1, c2];
    const used = new Set<string>(), spare = inp.league.slice(2);
    const got = slots.map((id) => {
      let pick: string | undefined = id;
      while (pick && used.has(pick)) pick = spare.shift();
      if (!pick) return null;
      used.add(pick);
      return pick;
    });
    if (!got.every((x) => x)) return null;
    const [L1, L2, C1, C2] = got as string[];
    return [L1!, C2!, C1!, L2!]; // semifinais: campeão da liga × vice da copa; campeão da copa × vice da liga
  }
  let league = l1, cup = c1;
  if (league === cup) {
    if (rule.double === 'none') return null;
    if (rule.double === 'league2') { if (!l2) return null; league = l1; cup = l2; } // o vice da liga herda a vaga da copa
    else { if (!c2) return null; cup = c2; }
  }
  return rule.host === 'cup' ? [cup, league] : [league, cup];
}

/** Formato no padrão das copas (fases, desempate, mando), gravado na competição. Sem prêmio em dinheiro. */
export function supercupFormat(rule: SupercupRule): CupFormat {
  const decider: CupStage['decider'] = { extraTime: rule.extraTime, penalties: true, ...(rule.extraSub ? { extraTimeSub: true } : {}) };
  const host = rule.host === 'neutral' ? 'neutral' : 'higher'; // 'higher' = o primeiro do chaveamento (ordem acima) manda
  const stages: CupStage[] = rule.teams === 4
    ? [{ name: 'Semifinal', legs: 1, decider, draw: 'bracket', host: 'neutral' }, { name: 'Final', legs: 1, decider, draw: 'bracket', host: 'neutral' }]
    : [{ name: 'Final', legs: 1, decider, draw: 'bracket', host }];
  return {
    id: rule.id, countryCode: rule.countryCode, name: rule.name, kind: 'supercup',
    source: { ...rule.source, discipline: 'ADAPT', prizes: 'ADAPT' }, regulation: rule.regulation, stages,
    window: { start: rule.dates[0]!, final: rule.dates[rule.dates.length - 1]! },
    ...(rule.datesCalendarYear ? { windowCalendarYear: { start: rule.datesCalendarYear[0]!, final: rule.datesCalendarYear[rule.datesCalendarYear.length - 1]! } } : {}),
    discipline: { yellowLimit: 99 }, prizes: { runnerUp: 0, winner: 0 }, reward: 'Troféu (sem prêmio em dinheiro)',
  };
}
