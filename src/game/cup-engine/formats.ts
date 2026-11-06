/**
 * Formatos das copas nacionais (Fase 9). Regras reais conferidas em docs/COPAS_NACIONAIS.md; onde não houve regulamento oficial lido,
 * vale o PDF revisado pelo usuário (06/11/2026). Cada formato é a ADAPTAÇÃO para os clubes da base (2 a 4 divisões por país):
 * as fases, quem entra em cada uma, folgas, sorteio, mando, desempate, cartões, premiação (forma) e calendário (janela jul–jun).
 *
 * Origem de cada parâmetro em `source`: 'REG' (regulamento oficial lido), 'SEC' (fonte secundária / PDF revisado) ou 'ADAPT'
 * (decisão de design para a base reduzida). México: sem copa (Copa MX descontinuada). Rússia: bloqueada até modelar os dois caminhos.
 */
import type { MatchDecider } from '../match-engine/types.ts';

export type CupDraw = 'open' | 'seeded' | 'opposite' | 'bracket';
export type CupHost = 'draw' | 'lower' | 'lower2' | 'higher' | 'neutral';
export type Source = 'REG' | 'SEC' | 'ADAPT';

export interface CupStage {
  name: string;
  /** divisões (1 = primeira) cujos clubes estreiam nesta fase */
  enterTiers?: number[];
  /** os N mais bem classificados da copa inteira estreiam nesta fase (ex.: cabeças da Coppa Italia, clubes da Supercopa na Espanha) */
  enterBest?: number;
  /** quantos clubes desta fase avançam sem jogar (os mais bem classificados); o resto joga */
  byes?: number;
  legs: 1 | 2;
  /** desempate do jogo único ou do jogo de volta */
  decider: Pick<MatchDecider, 'extraTime' | 'penalties' | 'extraTimeSub'>;
  draw: CupDraw;
  /** jogo único: quem manda; ida e volta: quem manda o jogo de VOLTA */
  host: CupHost;
}
export interface CupFormat {
  id: string; countryCode: string; name: string;
  /** de onde veio cada grupo de regras (exibido na tela e gravado no histórico) */
  source: { structure: Source; tiebreak: Source; host: Source; discipline: Source; prizes: Source };
  /** referência do regulamento (versão usada) */
  regulation: string;
  stages: CupStage[];
  /** janela no calendário do jogo (temporada jul–jun): primeira fase e final (MM-DD; a final pode ser no ano seguinte) */
  window: { start: string; final: string };
  discipline: { yellowLimit: number; /** zera os amarelos ao fim desta fase (índice) */ resetAfterStage?: number };
  /** forma da premiação (moeda local, valores reais ou proporções); escalada para a economia do jogo em `cupPrizes` */
  prizes: { perStage?: number[]; win?: number[]; semiLoser?: number; runnerUp: number; winner: number };
  /** o que o campeão ganha (registrado agora; usado quando as competições continentais existirem) */
  reward: string;
}

const PENS: CupStage['decider'] = { extraTime: false, penalties: true };
const ET: CupStage['decider'] = { extraTime: true, penalties: true };
const final = (decider: CupStage['decider'], name = 'Final'): CupStage => ({ name, legs: 1, decider, draw: 'bracket', host: 'neutral' });

export const CUP_FORMATS: CupFormat[] = [
  {
    id: 'bra', countryCode: 'BRA', name: 'Copa do Brasil', regulation: 'CBF — REC Copa do Brasil 2026 (adaptado à base)',
    source: { structure: 'REG', tiebreak: 'REG', host: 'REG', discipline: 'REG', prizes: 'REG' },
    stages: [
      { name: '1ª fase', enterTiers: [3, 4], legs: 1, decider: PENS, draw: 'opposite', host: 'draw' },
      { name: '2ª fase', enterTiers: [2], legs: 1, decider: PENS, draw: 'open', host: 'draw' },
      { name: '3ª fase', byes: 4, legs: 1, decider: PENS, draw: 'open', host: 'draw' },
      { name: '5ª fase', enterTiers: [1], legs: 2, decider: PENS, draw: 'seeded', host: 'draw' },
      { name: 'Oitavas de final', legs: 2, decider: PENS, draw: 'open', host: 'draw' },
      { name: 'Quartas de final', legs: 2, decider: PENS, draw: 'open', host: 'draw' },
      { name: 'Semifinal', legs: 2, decider: PENS, draw: 'bracket', host: 'draw' },
      final(PENS),
    ],
    window: { start: '08-19', final: '05-26' },
    // limite de amarelos: Regulamento Geral da CBF (não lido) — 3, padrão da CBF; zera ao fim das quartas (REC art. 25)
    discipline: { yellowLimit: 3, resetAfterStage: 5 },
    prizes: { perStage: [0.83, 1.38, 1.53, 2, 3, 4, 9], runnerUp: 34, winner: 78 },
    reward: 'Libertadores (campeão na fase de grupos; vice na fase preliminar)',
  },
  {
    id: 'eng', countryCode: 'ENG', name: 'FA Cup', regulation: 'Rules of The FA Challenge Cup 2026-27 (adaptado à base)',
    source: { structure: 'ADAPT', tiebreak: 'REG', host: 'REG', discipline: 'SEC', prizes: 'SEC' },
    stages: [
      { name: '1ª rodada', enterTiers: [3, 4], legs: 1, decider: ET, draw: 'open', host: 'draw' },
      { name: '3ª rodada', enterTiers: [1, 2], byes: 4, legs: 1, decider: ET, draw: 'open', host: 'draw' },
      { name: '4ª rodada', legs: 1, decider: ET, draw: 'open', host: 'draw' },
      { name: '5ª rodada', legs: 1, decider: ET, draw: 'open', host: 'draw' },
      { name: 'Quartas de final', legs: 1, decider: ET, draw: 'open', host: 'draw' },
      { name: 'Semifinal', legs: 1, decider: ET, draw: 'open', host: 'neutral' },
      final(ET),
    ],
    window: { start: '08-26', final: '05-15' },
    discipline: { yellowLimit: 5 },
    prizes: { win: [47.75, 121.5, 127, 238.5, 477, 1060], semiLoser: 530, runnerUp: 1060, winner: 2120 },
    reward: 'Europa League (fase de liga) e Community Shield',
  },
  {
    id: 'esp', countryCode: 'ESP', name: 'Copa del Rey', regulation: 'Edição 2025/26 (Wikipédia; PDF revisado) — regulamento RFEF não obtido',
    source: { structure: 'SEC', tiebreak: 'SEC', host: 'SEC', discipline: 'ADAPT', prizes: 'ADAPT' },
    stages: [
      { name: '1ª rodada', enterTiers: [1, 2, 3], legs: 1, decider: ET, draw: 'seeded', host: 'lower' },
      { name: 'Dezesseis-avos', enterBest: 4, legs: 1, decider: ET, draw: 'opposite', host: 'lower' },
      { name: 'Oitavas de final', legs: 1, decider: ET, draw: 'open', host: 'lower' },
      { name: 'Quartas de final', legs: 1, decider: ET, draw: 'open', host: 'lower' },
      { name: 'Semifinal', legs: 2, decider: ET, draw: 'open', host: 'draw' },
      final(ET),
    ],
    window: { start: '10-28', final: '04-24' },
    discipline: { yellowLimit: 3 },
    prizes: { runnerUp: 1, winner: 2 },
    reward: 'Europa League (fase de liga) e Supercopa da Espanha (campeão e vice)',
  },
  {
    id: 'ger', countryCode: 'GER', name: 'DFB-Pokal', regulation: 'DFB-Pokal 2025/26 (Wikipédia; DFB Durchführungsbestimmungen)',
    source: { structure: 'ADAPT', tiebreak: 'SEC', host: 'SEC', discipline: 'SEC', prizes: 'ADAPT' },
    stages: [
      { name: '1ª rodada', enterTiers: [1, 2, 3], byes: 8, legs: 1, decider: ET, draw: 'seeded', host: 'lower' },
      { name: '2ª rodada', legs: 1, decider: ET, draw: 'seeded', host: 'lower' },
      { name: 'Oitavas de final', legs: 1, decider: ET, draw: 'open', host: 'lower' },
      { name: 'Quartas de final', legs: 1, decider: ET, draw: 'open', host: 'lower' },
      { name: 'Semifinal', legs: 1, decider: ET, draw: 'open', host: 'lower' },
      final(ET),
    ],
    window: { start: '08-19', final: '05-22' },
    discipline: { yellowLimit: 5 },
    prizes: { runnerUp: 1, winner: 2 },
    reward: 'Europa League (fase de liga) e Supercup contra o campeão alemão',
  },
  {
    id: 'ita', countryCode: 'ITA', name: 'Coppa Italia', regulation: 'Coppa Italia 2025/26 (FIGC C.U. 103/A; imprensa) — regulamento da Lega não obtido',
    source: { structure: 'SEC', tiebreak: 'SEC', host: 'SEC', discipline: 'REG', prizes: 'ADAPT' },
    stages: [
      { name: '1ª rodada', enterTiers: [1, 2], legs: 1, decider: PENS, draw: 'opposite', host: 'higher' },
      { name: '2ª rodada', legs: 1, decider: PENS, draw: 'bracket', host: 'higher' },
      { name: 'Oitavas de final', enterBest: 8, legs: 1, decider: PENS, draw: 'opposite', host: 'higher' },
      { name: 'Quartas de final', legs: 1, decider: PENS, draw: 'bracket', host: 'higher' },
      { name: 'Semifinal', legs: 2, decider: ET, draw: 'bracket', host: 'higher' },
      final(ET),
    ],
    window: { start: '08-12', final: '05-12' },
    // amarelos zeram ao fim dos turnos preliminares (C.U. 103/A); limite de amarelos não lido
    discipline: { yellowLimit: 3, resetAfterStage: 1 },
    prizes: { runnerUp: 1, winner: 2 },
    reward: 'Europa League (fase de liga) e Supercoppa Italiana',
  },
  {
    id: 'fra', countryCode: 'FRA', name: 'Coupe de France', regulation: 'Coupe de France 2025/26 (PDF revisado; FFF regionais) — regulamento FFF não obtido',
    source: { structure: 'ADAPT', tiebreak: 'SEC', host: 'SEC', discipline: 'ADAPT', prizes: 'ADAPT' },
    stages: [
      { name: 'Preliminar', enterTiers: [2], byes: 10, legs: 1, decider: PENS, draw: 'open', host: 'lower2' },
      { name: '32 avos de final', enterTiers: [1], legs: 1, decider: PENS, draw: 'open', host: 'lower2' },
      { name: 'Oitavas de final', legs: 1, decider: PENS, draw: 'open', host: 'lower2' },
      { name: 'Quartas de final', legs: 1, decider: PENS, draw: 'open', host: 'lower2' },
      { name: 'Semifinal', legs: 1, decider: PENS, draw: 'open', host: 'lower2' },
      final(ET),
    ],
    window: { start: '11-11', final: '05-21' },
    discipline: { yellowLimit: 3 },
    prizes: { runnerUp: 1, winner: 2 },
    reward: 'Europa League (fase de liga) e Trophée des Champions',
  },
  {
    id: 'por', countryCode: 'POR', name: 'Taça de Portugal', regulation: 'Taça de Portugal 2025/26 (PDF revisado) — regulamento FPF não obtido',
    source: { structure: 'ADAPT', tiebreak: 'SEC', host: 'SEC', discipline: 'ADAPT', prizes: 'ADAPT' },
    stages: [
      { name: '1ª eliminatória', enterTiers: [2], byes: 10, legs: 1, decider: ET, draw: 'open', host: 'draw' },
      { name: '3ª eliminatória', enterTiers: [1], legs: 1, decider: ET, draw: 'open', host: 'lower' },
      { name: '4ª eliminatória', legs: 1, decider: ET, draw: 'open', host: 'draw' },
      { name: 'Quartas de final', legs: 1, decider: ET, draw: 'open', host: 'draw' },
      { name: 'Meias-finais', legs: 2, decider: ET, draw: 'open', host: 'draw' },
      final(ET),
    ],
    window: { start: '09-16', final: '05-23' },
    discipline: { yellowLimit: 3 },
    prizes: { runnerUp: 1, winner: 2 },
    reward: 'Europa League (fase de liga) e Supertaça',
  },
  {
    id: 'ned', countryCode: 'NED', name: 'KNVB Beker', regulation: 'Reglement KNVB Beker 2025/26 (adaptado à base)',
    source: { structure: 'ADAPT', tiebreak: 'REG', host: 'REG', discipline: 'ADAPT', prizes: 'ADAPT' },
    stages: [
      { name: '1ª rodada', enterTiers: [1, 2], byes: 28, legs: 1, decider: ET, draw: 'open', host: 'draw' },
      { name: '2ª rodada', legs: 1, decider: ET, draw: 'open', host: 'draw' },
      { name: 'Oitavas de final', legs: 1, decider: ET, draw: 'open', host: 'draw' },
      { name: 'Quartas de final', legs: 1, decider: ET, draw: 'open', host: 'draw' },
      { name: 'Semifinal', legs: 1, decider: ET, draw: 'open', host: 'draw' },
      final(ET),
    ],
    window: { start: '09-23', final: '04-18' },
    discipline: { yellowLimit: 3 },
    prizes: { runnerUp: 1, winner: 2 },
    reward: 'Europa League e Johan Cruijff-schaal',
  },
  {
    id: 'arg', countryCode: 'ARG', name: 'Copa Argentina', regulation: 'AFA — Boletín Especial 6811, Reglamento Copa Argentina 2026 (adaptado à base)',
    source: { structure: 'ADAPT', tiebreak: 'REG', host: 'REG', discipline: 'REG', prizes: 'ADAPT' },
    stages: [
      { name: 'Preliminar', enterTiers: [1, 2], byes: 24, legs: 1, decider: PENS, draw: 'opposite', host: 'neutral' },
      { name: '32 avos de final', legs: 1, decider: PENS, draw: 'seeded', host: 'neutral' },
      { name: 'Oitavas de final', legs: 1, decider: PENS, draw: 'bracket', host: 'neutral' },
      { name: 'Quartas de final', legs: 1, decider: PENS, draw: 'bracket', host: 'neutral' },
      { name: 'Semifinal', legs: 1, decider: PENS, draw: 'bracket', host: 'neutral' },
      final(PENS),
    ],
    window: { start: '08-26', final: '05-26' },
    // limite de amarelos não está no regulamento; suspensões da copa valem só na copa (REG)
    discipline: { yellowLimit: 3 },
    prizes: { runnerUp: 1, winner: 2 },
    reward: 'Libertadores (se já classificado, a vaga segue o regulamento da Primera División)',
  },
  {
    id: 'bel', countryCode: 'BEL', name: 'Croky Cup', regulation: 'Croky Cup 2026/27 (PDF revisado) — verificação normativa pendente',
    source: { structure: 'ADAPT', tiebreak: 'SEC', host: 'SEC', discipline: 'ADAPT', prizes: 'ADAPT' },
    stages: [
      { name: '7ª rodada', enterTiers: [1, 2], legs: 1, decider: ET, draw: 'seeded', host: 'lower' },
      { name: 'Oitavas de final', legs: 1, decider: ET, draw: 'open', host: 'lower' },
      { name: 'Quartas de final', legs: 1, decider: ET, draw: 'open', host: 'lower' },
      { name: 'Semifinal', legs: 2, decider: ET, draw: 'open', host: 'draw' },
      final(ET),
    ],
    window: { start: '09-30', final: '05-13' },
    discipline: { yellowLimit: 3 },
    prizes: { runnerUp: 1, winner: 2 },
    reward: 'Europa League',
  },
  {
    id: 'jpn', countryCode: 'JPN', name: 'Copa do Imperador', regulation: 'JFA — 開催規程 2026 (adaptado à base)',
    source: { structure: 'ADAPT', tiebreak: 'SEC', host: 'ADAPT', discipline: 'REG', prizes: 'REG' },
    stages: [
      { name: '2ª rodada', enterTiers: [1, 2], byes: 28, legs: 1, decider: ET, draw: 'open', host: 'draw' },
      { name: '3ª rodada', legs: 1, decider: ET, draw: 'open', host: 'draw' },
      { name: 'Oitavas de final', legs: 1, decider: ET, draw: 'open', host: 'draw' },
      { name: 'Quartas de final', legs: 1, decider: ET, draw: 'open', host: 'draw' },
      { name: 'Semifinal', legs: 1, decider: ET, draw: 'open', host: 'neutral' },
      final(ET),
    ],
    window: { start: '08-26', final: '01-01' },
    // 2 amarelos = 1 jogo; quem tem 1 zera depois das quartas (art. 18)
    discipline: { yellowLimit: 2, resetAfterStage: 3 },
    prizes: { win: [0.5, 1, 2, 3, 3], semiLoser: 20, runnerUp: 50, winner: 150 },
    reward: 'AFC Champions League Two',
  },
  {
    id: 'aut', countryCode: 'AUT', name: 'ÖFB-Cup', regulation: 'ÖFB-Cup 2026/27 (PDF revisado) — regulamento ÖFB não obtido',
    source: { structure: 'ADAPT', tiebreak: 'SEC', host: 'SEC', discipline: 'ADAPT', prizes: 'ADAPT' },
    stages: [
      { name: '1ª rodada', enterTiers: [1, 2], byes: 4, legs: 1, decider: ET, draw: 'open', host: 'lower' },
      { name: 'Oitavas de final', legs: 1, decider: ET, draw: 'open', host: 'lower' },
      { name: 'Quartas de final', legs: 1, decider: ET, draw: 'open', host: 'lower' },
      { name: 'Semifinal', legs: 1, decider: ET, draw: 'open', host: 'lower' },
      final(ET),
    ],
    window: { start: '08-26', final: '05-01' },
    discipline: { yellowLimit: 3 },
    prizes: { runnerUp: 1, winner: 2 },
    reward: 'Europa League (3ª pré-eliminatória)',
  },
  {
    id: 'irl', countryCode: 'IRL', name: 'FAI Cup', regulation: 'FAI Cup 2026 (PDF revisado) — verificação normativa pendente',
    source: { structure: 'ADAPT', tiebreak: 'SEC', host: 'SEC', discipline: 'ADAPT', prizes: 'ADAPT' },
    stages: [
      { name: '2ª rodada', enterTiers: [1, 2], byes: 12, legs: 1, decider: ET, draw: 'open', host: 'draw' },
      { name: '3ª rodada', legs: 1, decider: ET, draw: 'open', host: 'draw' },
      { name: 'Quartas de final', legs: 1, decider: ET, draw: 'open', host: 'draw' },
      { name: 'Semifinal', legs: 1, decider: ET, draw: 'open', host: 'draw' },
      final(ET),
    ],
    window: { start: '08-26', final: '11-08' },
    discipline: { yellowLimit: 3 },
    prizes: { runnerUp: 1, winner: 2 },
    reward: 'Europa League (1ª pré-eliminatória) e President of Ireland’s Cup',
  },
  {
    id: 'cro', countryCode: 'CRO', name: 'Copa da Croácia', regulation: 'HNS — Propozicije HNK 2026/27 (adaptado à base)',
    source: { structure: 'ADAPT', tiebreak: 'REG', host: 'SEC', discipline: 'REG', prizes: 'ADAPT' },
    stages: [
      { name: 'Preliminar', enterTiers: [2], legs: 1, decider: { ...ET, extraTimeSub: true }, draw: 'open', host: 'draw' },
      { name: 'Oitavas de final', enterTiers: [1], legs: 1, decider: { ...ET, extraTimeSub: true }, draw: 'opposite', host: 'lower' },
      { name: 'Quartas de final', legs: 1, decider: { ...ET, extraTimeSub: true }, draw: 'open', host: 'draw' },
      { name: 'Semifinal', legs: 1, decider: { ...ET, extraTimeSub: true }, draw: 'open', host: 'draw' },
      final({ ...ET, extraTimeSub: true }),
    ],
    window: { start: '08-26', final: '05-12' },
    discipline: { yellowLimit: 4 },
    prizes: { runnerUp: 1, winner: 2 },
    reward: 'Competição da UEFA conforme as decisões da UEFA',
  },
];

export const cupFormatFor = (countryCode: string): CupFormat | null => CUP_FORMATS.find((f) => f.countryCode === countryCode) ?? null;
