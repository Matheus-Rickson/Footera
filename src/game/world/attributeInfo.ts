/**
 * Informativo de cada atributo do jogador: o que é e como entra na partida. Os efeitos descritos são os que o motor
 * (match-engine/engine.ts, roles.ts, playerRoles.ts) realmente usa — se o motor mudar, mude aqui também (há teste que confere a lista).
 * A parte "pesa na força de…" é calculada da tabela de pesos por posição (overall.ts), então nunca fica desatualizada.
 */
import type { Position } from '../../shared/types.ts';
import { POS_LABEL } from '../../shared/positions.ts';
import { positionWeights } from './overall.ts';

export interface AttributeInfo { what: string; match: string }

export const ATTRIBUTE_INFO: Record<string, AttributeInfo> = {
  // técnicos
  finishing: { what: 'Precisão e frieza na hora de chutar a gol.', match: 'É 60% da qualidade da finalização (chance de gol e de acertar o alvo) e faz o jogador finalizar mais vezes; também decide quem cobra e a conversão dos pênaltis.' },
  passing: { what: 'Qualidade dos passes curtos e longos.', match: 'Metade da precisão de passe do time; metade do critério de quem dá a assistência nas jogadas trabalhadas; 20% do chute de longe.' },
  dribbling: { what: 'Conduzir a bola e passar pelo marcador.', match: 'Quem dribla mais é quem mais sofre as faltas (inclusive os pênaltis) do time.' },
  tackling: { what: 'Desarmar o adversário sem cometer falta.', match: 'Entra na força de zagueiros, volantes e laterais (a força do setor decide as recuperações de bola); nos lances, quem desarma melhor é quem aparece fazendo os desarmes.' },
  marking: { what: 'Acompanhar e anular o adversário.', match: 'Entra na força dos defensores e nas funções defensivas (sem efeito próprio nos lances).' },
  firstTouch: { what: 'Dominar a bola com qualidade.', match: '25% da precisão de passe do time.' },
  crossing: { what: 'Qualidade dos cruzamentos.', match: 'Quem cruza melhor é quem mais cruza nas jogadas pelas pontas.' },
  heading: { what: 'Cabeceio, no ataque e na defesa.', match: '60% da qualidade das finalizações de cabeça (cruzamentos e escanteios) e faz o jogador cabecear mais vezes.' },
  longShots: { what: 'Chutes de fora da área.', match: '60% da qualidade dos chutes de longe.' },
  goalkeeping: { what: 'Qualidade geral como goleiro.', match: 'Para goleiros, é calculado dos atributos de goleiro e é o que mais pesa na defesa do gol. Nos jogadores de linha, decide quem vai para o gol numa emergência.' },
  // mentais
  vision: { what: 'Enxergar a jogada antes dos outros.', match: '25% da precisão de passe do time e metade do critério de quem dá a assistência.' },
  composure: { what: 'Calma sob pressão.', match: 'Conta na finalização (20%), no chute de longe (20%) e nos pênaltis (30% a 50%). Abaixo de 10, o jogador reage pior a broncas no vestiário.' },
  decisions: { what: 'Escolher a melhor jogada.', match: 'Entra na força das posições que dependem de leitura de jogo e nas funções (sem efeito próprio nos lances).' },
  positioning: { what: 'Estar no lugar certo.', match: 'Conta 20% na finalização; quem se posiciona melhor é quem aparece interceptando passes; pesa muito em zagueiros, volantes, centroavantes e goleiros.' },
  workRate: { what: 'Disposição para correr e ajudar o time.', match: 'Entra na força de laterais, alas e meio-campistas e nas funções de muita movimentação.' },
  leadership: { what: 'Liderar e organizar os companheiros.', match: 'Ainda não influencia a partida (será usado em capitania e moral do grupo).' },
  aggression: { what: 'Intensidade na disputa da bola.', match: 'Quanto mais agressivo, mais faltas e cartões (inclusive vermelhos); a média do time aumenta as faltas cometidas.' },
  // físicos
  pace: { what: 'Velocidade de corrida.', match: 'Entra na força de pontas, laterais, alas e atacantes e nas funções de profundidade.' },
  stamina: { what: 'Fôlego ao longo do jogo.', match: 'Quanto maior, menos o jogador cansa durante a partida (o cansaço reduz o rendimento) e melhor a condição física depois do jogo.' },
  strength: { what: 'Força física nas disputas de corpo.', match: 'Entra na força de zagueiros e centroavantes e nas funções de pivô e defensivas.' },
  agility: { what: 'Mudar de direção com rapidez.', match: 'Entra na força de pontas e goleiros e nas funções que pedem mobilidade.' },
  jumping: { what: 'Impulsão para disputar bolas altas.', match: '40% da qualidade do cabeceio; entra na força de zagueiros e goleiros.' },
  naturalFitness: { what: 'Preparo físico natural.', match: 'Reduz o cansaço durante o jogo e o risco de lesão.' },
  // goleiro
  reflexes: { what: 'Defesas em chutes de perto e à queima-roupa.', match: 'Peso 3 no "goleiro (geral)" (o maior); principal atributo do Goleiro Tradicional.' },
  oneOnOne: { what: 'Frente a frente com o atacante.', match: 'Peso 2 no "goleiro (geral)"; importante para o Goleiro Líbero.' },
  handling: { what: 'Segurar a bola sem dar rebote.', match: 'Peso 2 no "goleiro (geral)"; importante para o Goleiro Tradicional.' },
  aerial: { what: 'Cruzamentos e bolas altas na área.', match: 'Peso 1,5 no "goleiro (geral)"; conta para o Goleiro Tradicional.' },
  rushingOut: { what: 'Sair da área para cortar lançamentos.', match: 'Peso 1 no "goleiro (geral)"; principal atributo do Goleiro Líbero (que reduz os contra-ataques sofridos).' },
  kicking: { what: 'Chutes, tiros de meta e reposições.', match: 'Peso 0,5 no "goleiro (geral)"; principal atributo do Goleiro Construtor (que melhora a saída de bola).' },
};

const ORDER: Position[] = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'LM', 'RM', 'AM', 'LW', 'RW', 'SS', 'CF'];

/** Posições em que o atributo mais pesa na força (peso ≥ 1,5 na tabela de pesos). */
export function positionsWeighing(key: string): Position[] {
  return ORDER.filter((p) => (positionWeights(p)[key] ?? 0) >= 1.5);
}

/** Texto completo do informativo (o que é · na partida · pesa na força de…). */
export function attributeHelp(key: string): string {
  const i = ATTRIBUTE_INFO[key];
  if (!i) return '';
  const pos = positionsWeighing(key);
  return `${i.what} Na partida: ${i.match}${pos.length ? ` Pesa na força de: ${pos.map((p) => POS_LABEL[p]).join(', ')}.` : ''}`;
}
