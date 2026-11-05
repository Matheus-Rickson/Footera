/**
 * História resumida de EXEMPLO de um clube (texto provisório para testar a tela, até a base de dados ter histórias próprias).
 * Determinística pelo id do clube. Usa só dados reais do universo (cidade, estádio, torcida, liga, rival da mesma cidade ou liga);
 * o que é inventado (ano de fundação, apelido, cores) é neutro e NÃO cita títulos, para não contradizer a sala de troféus.
 */
import { createRng } from '../rng.ts';

export interface StoryInput {
  id: string; name: string; city: string; country: string; league: string; tier: number;
  stadium: string; capacity: number; fans: number; reputation: number; rival: string | null;
}
export interface ClubStory { founded: number; nickname: string; colors: string; text: string[] }

const COLORS = ['verde e branco', 'azul e branco', 'vermelho e preto', 'grená', 'amarelo e azul', 'preto e branco', 'vinho e branco', 'laranja', 'azul-celeste', 'vermelho e branco', 'verde e amarelo', 'roxo e branco'];
const NICKS = ['Leão', 'Tricolor', 'Alvinegro', 'Gigante', 'Furacão', 'Colosso', 'Dragão', 'Expresso', 'Raposa', 'Lobo', 'Falcão', 'Touro'];

export function clubStory(c: StoryInput): ClubStory {
  const rng = createRng(`story:${c.id}`);
  const founded = rng.int(1889, 1972);
  const colors = rng.pick(COLORS);
  const nickname = `${rng.pick(NICKS)} ${rng.pick(['da cidade', 'do bairro', 'de ' + c.city.split(' ')[0], 'da região'])}`;
  const size = c.fans >= 250_000 ? 'uma das maiores torcidas do país' : c.fans >= 120_000 ? 'uma torcida numerosa e fiel' : 'uma torcida pequena, mas muito presente';
  const stature = c.tier === 1 ? (c.reputation >= 70 ? 'um dos clubes mais tradicionais da elite' : 'presença constante na primeira divisão')
    : c.tier === 2 ? 'um clube que sonha em voltar à elite' : 'um clube de raízes locais, em busca de crescimento';
  const text = [
    `Fundado em ${founded} em ${c.city}, o ${c.name} veste ${colors} e é conhecido como "${nickname}". Hoje disputa a ${c.league} (${c.tier}ª divisão de ${c.country}) e é ${stature}.`,
    `Manda seus jogos no ${c.stadium}, com capacidade para ${c.capacity.toLocaleString('pt-BR')} pessoas, empurrado por ${size}.${c.rival ? ` O clássico contra o ${c.rival} mobiliza a cidade a cada temporada.` : ''}`,
  ];
  return { founded, nickname, colors, text };
}
