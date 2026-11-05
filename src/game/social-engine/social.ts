/**
 * Rede social do futebol (aba Notícias). Regras puras: textos dos posts a partir dos fatos do jogo, comentários de torcedores
 * e engajamento (curtidas/compartilhamentos). Todos os veículos e jornalistas são FICTÍCIOS (nomes inventados); o selo azul marca
 * perfis de imprensa e perfis oficiais (ligas e clubes) do universo do jogo. Nada aqui inventa fato: placares, tabela, valores e
 * lesões vêm do banco; o texto só dá a forma.
 */
import type { Rng } from '../rng.ts';

export type PostKind = 'match' | 'preview' | 'transfer' | 'injury' | 'sacking' | 'title' | 'round' | 'coach' | 'hattrick' | 'upset';

/** Veículos fictícios (selo azul). */
export const OUTLETS: ReadonlyArray<{ key: string; name: string; handle: string; bio: string; hue: number }> = [
  { key: 'gazeta', name: 'Gazeta do Gol', handle: 'gazetadogol', bio: 'Jornal esportivo. Notícias, bastidores e análises.', hue: 10 },
  { key: 'arquibancada', name: 'Rádio Arquibancada', handle: 'radioarquibancada', bio: 'A rádio de quem vive o futebol. Ao vivo, todo dia.', hue: 32 },
  { key: 'placar', name: 'Placar Total', handle: 'placartotal', bio: 'Resultados, tabelas e números de todas as ligas.', hue: 145 },
  { key: 'jornaldabola', name: 'Jornal da Bola', handle: 'jornaldabola', bio: 'Desde sempre ao lado do torcedor.', hue: 220 },
  { key: 'escanteio', name: 'Canal Escanteio', handle: 'canalescanteio', bio: 'Vídeos, debates e mercado da bola.', hue: 280 },
  { key: 'meialua', name: 'Revista Meia-Lua', handle: 'revistameialua', bio: 'Reportagens e perfis do futebol.', hue: 330 },
];
/** Jornalistas fictícios: o papel define o tipo de post (mercado, setorista, dados). */
export const JOURNALIST_ROLES: ReadonlyArray<{ key: string; bio: string; hue: number }> = [
  { key: 'mercado', bio: 'Repórter de mercado da bola. Informação apurada.', hue: 48 },
  { key: 'mercado2', bio: 'Bastidores e transferências.', hue: 190 },
  { key: 'setorista', bio: 'Setorista. Cobertura diária dos clubes.', hue: 0 },
  { key: 'dados', bio: 'Números e estatísticas do futebol.', hue: 160 },
  { key: 'colunista', bio: 'Colunista. Opinião sem rodeios.', hue: 260 },
];

export const fmtScore = (hg: number, ag: number) => `${hg} x ${ag}`;
const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng.next() * xs.length)]!;
const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');

// ---------------------------------------------------------------- textos dos posts
export function matchText(rng: Rng, a: { home: string; away: string; hg: number; ag: number; competition: string; round: number; upset: boolean }): string {
  const { home, away, hg, ag } = a;
  const winner = hg > ag ? home : ag > hg ? away : null, loser = hg > ag ? away : ag > hg ? home : null;
  const diff = Math.abs(hg - ag), s = fmtScore(hg, ag), v = { home, away, s, winner: winner ?? '', loser: loser ?? '', comp: a.competition, r: String(a.round) };
  if (a.upset && winner) return fill(pick(rng, ['ZEBRA! {winner} surpreende e vence {loser}: {home} {s} {away}. ({comp}, {r}ª rodada)', 'Ninguém esperava: {winner} derruba {loser}. Final: {home} {s} {away}.']), v);
  if (diff >= 4) return fill(pick(rng, ['GOLEADA! {home} {s} {away}. Noite para esquecer para o {loser}.', 'Atropelo: {winner} passa por cima do {loser}. {home} {s} {away}.']), v);
  if (!winner && hg === 0) return fill(pick(rng, ['Jogo truncado e sem gols: {home} {s} {away}.', 'Tudo igual e sem gols entre {home} e {away}.']), v);
  if (!winner) return fill(pick(rng, ['Empate movimentado: {home} {s} {away}.', '{home} e {away} ficam no {s}. Pontos divididos na {r}ª rodada.']), v);
  return fill(pick(rng, ['FIM DE JOGO: {home} {s} {away}. {winner} leva os três pontos.', 'Resultado: {home} {s} {away}. Vitória do {winner} pela {r}ª rodada da {comp}.', '{winner} vence o {loser} por {s}. ({comp})']), v);
}
export function clubMatchText(rng: Rng, a: { mine: 'V' | 'E' | 'D'; opp: string; score: string }): string {
  const v = { opp: a.opp, s: a.score };
  if (a.mine === 'V') return fill(pick(rng, ['VITÓRIA! 💪 Fim de jogo: {s} contra o {opp}. Obrigado, torcida!', 'É NOSSA! Três pontos importantes diante do {opp} ({s}).']), v);
  if (a.mine === 'E') return fill(pick(rng, ['Fim de jogo: {s} contra o {opp}. Seguimos trabalhando.', 'Um ponto diante do {opp} ({s}). Próximo jogo já é decisão.']), v);
  return fill(pick(rng, ['Fim de jogo: {s} contra o {opp}. Não era o resultado que queríamos. Vamos reagir.', 'Derrota para o {opp} ({s}). Cabeça erguida, a temporada é longa.']), v);
}
export function previewText(rng: Rng, a: { leader: string; second: string; gap: number; comp: string; round: number; official: boolean }): string {
  const v = { l: a.leader, s: a.second, comp: a.comp, r: String(a.round), g: String(a.gap) };
  if (a.official) return fill(a.gap === 0
    ? pick(rng, ['🔥 CONFRONTO DIRETO! Líder e vice-líder, empatados em pontos, se enfrentam hoje: {l} x {s}. ({r}ª rodada da {comp})', 'Hoje tem duelo de topo de tabela na {comp}: {l} x {s}, empatados em pontos. Quem assume a liderança?'])
    : pick(rng, ['🔥 CONFRONTO DIRETO! Líder e vice se enfrentam hoje: {l} x {s}. Apenas {g} ponto(s) separam as equipes. ({r}ª rodada da {comp})', 'Topo da tabela em jogo: {l} recebe o vice {s} na {r}ª rodada. Diferença: {g} ponto(s).']), v);
  return fill(a.gap === 0
    ? pick(rng, ['Jogo do ano até aqui? {l} e {s} chegam empatados em pontos e decidem quem fica na ponta. Vale muito.', 'Empatados em pontos, {l} e {s} fazem hoje a final antecipada da rodada. Quem vacilar fica para trás.'])
    : pick(rng, ['{l} pode abrir vantagem hoje contra o {s}. Hoje são {g} ponto(s) de diferença entre os dois primeiros.', 'O {s} tem a chance de encostar no líder {l}: confronto direto hoje, {g} ponto(s) de distância.']), v);
}
export function userPreviewText(rng: Rng, a: { home: string; away: string; comp: string; round: number }): string {
  return fill(pick(rng, ['É DIA DE JOGO! {home} x {away} hoje pela {r}ª rodada da {comp}.', 'Hoje tem {home} x {away}. Quem leva? ({comp}, {r}ª rodada)']), { home: a.home, away: a.away, comp: a.comp, r: String(a.round) });
}
export function transferText(rng: Rng, a: { player: string; from: string | null; to: string; fee: string; free: boolean; scoop: boolean }): string {
  const v = { p: a.player, f: a.from ?? '', t: a.to, fee: a.fee };
  if (a.free) return fill(pick(rng, ['{t} anuncia {p}, que estava sem clube. Chega de graça.', 'Sem custo: {p} assina com o {t}.']), v);
  if (a.scoop) return fill(pick(rng, ['🚨 EXCLUSIVO: {p} é do {t}! Negócio fechado com o {f} por {fee}.', '🚨 BOMBA no mercado: {t} acerta a contratação de {p} ({f}) por {fee}. Contrato assinado.']), v);
  return fill(pick(rng, ['OFICIAL: {p} deixa o {f} e acerta com o {t}. Valor: {fee}.', '{t} confirma a chegada de {p}, ex-{f}, por {fee}.']), v);
}
export function injuryText(rng: Rng, a: { player: string; club: string; days: number }): string {
  const weeks = Math.max(1, Math.round(a.days / 7)), v = { p: a.player, c: a.club, w: String(weeks) };
  return fill(pick(rng, ['Baixa importante: {p} se lesionou e deve desfalcar o {c} por cerca de {w} semana(s).', 'Departamento médico do {c} confirma: {p} fica fora por aproximadamente {w} semana(s).']), v);
}
export function hatTrickText(rng: Rng, a: { player: string; club: string; goals: number; opp: string }): string {
  const v = { p: a.player, c: a.club, o: a.opp, g: String(a.goals) };
  return fill(a.goals >= 4 ? pick(rng, ['{g} GOLS! {p} faz chover e é o nome do jogo contra o {o}.']) : pick(rng, ['Hat-trick! {p} marca três vezes para o {c} contra o {o}. 🎩⚽', 'Noite de {p}: três gols contra o {o}.']), v);
}
export function sackingText(rng: Rng, a: { club: string }): string {
  return fill(pick(rng, ['URGENTE: {c} demite o técnico após sequência ruim. Clube já procura substituto.', 'Não resistiu: o técnico do {c} está fora. Diretoria anuncia a demissão.']), { c: a.club });
}
export function coachText(rng: Rng, a: { coach: string; club: string; sacked: boolean }): string {
  const v = { n: a.coach, c: a.club };
  return fill(a.sacked ? pick(rng, ['URGENTE: {c} anuncia a saída do técnico {n}.', 'Fim da linha: {n} não é mais o treinador do {c}.']) : pick(rng, ['OFICIAL: {n} é o novo treinador do {c}.', 'Novo comando: {c} anuncia {n} como treinador.']), v);
}
export function roundText(rng: Rng, a: { round: number; comp: string; leader: string; points: number }): string {
  return fill(pick(rng, ['Fim da {r}ª rodada da {comp}! O {l} lidera com {p} pontos. Confira a classificação 👇', 'Encerrada a {r}ª rodada. {l} segue na ponta com {p} pontos.']), { r: String(a.round), comp: a.comp, l: a.leader, p: String(a.points) });
}
export function titleText(rng: Rng, a: { champion: string; comp: string; points: number }): string {
  return fill(pick(rng, ['🏆 É CAMPEÃO! O {c} conquista a {comp} com {p} pontos. Parabéns!', '🏆 Temos campeão: {c} é o dono da {comp}! ({p} pontos)']), { c: a.champion, comp: a.comp, p: String(a.points) });
}

// ---------------------------------------------------------------- comentários
/** Humor de cada clube citado: +1 bom para o clube, −1 ruim, 0 neutro. */
export type Mood = Record<string, number>;
const POOLS: Record<string, { pos: string[]; neg: string[]; neu: string[] }> = {
  match: {
    pos: ['Que time! 🔥', '{club} gigante demais!', 'Esse é o meu {club}!', 'Ninguém segura a gente esse ano', 'Respeita o {club}!', 'Futebol bonito de ver 👏', 'Três pontos e paz na semana'],
    neg: ['Inadmissível, {club}...', 'Vergonha. Precisa mudar muita coisa', 'Esse elenco não dá mais', 'Cadê a diretoria?', 'Já vi esse filme antes 🤦', 'O técnico precisa explicar isso', 'Não dá pra aceitar jogar assim'],
    neu: ['Quem viu esse jogo sabe 👀', 'Campeonato tá pegando fogo', 'Arbitragem deixou a desejar', 'Resultado justo', 'Alguém mais achou o jogo morno?', 'E a tabela, como fica?'],
  },
  transfer: {
    pos: ['Chegou chegando! Bem-vindo, {player}!', 'Diretoria acordou 👏', 'Contratação de peso!', 'Agora sim, {club}!', 'Pode vir, {player}! 🔥'],
    neg: ['Vendeu barato demais', 'Vai deixar saudade, {player}', 'Mais um que sai...', 'Desmanche começou?', 'Não acredito que deixaram ele sair'],
    neu: ['Mercado tá louco', 'Boa contratação no papel', 'Quero ver render em campo', 'Esse negócio vai dar o que falar'],
  },
  injury: {
    pos: [], neg: ['Força, {player}! Volta logo 🙏', 'Péssima notícia pro {club}', 'Departamento médico precisa rever isso', 'Justo agora...', 'Quem entra no lugar?'],
    neu: ['Recuperação rápida, {player}!', 'Lesão chata, torcer para não ser nada grave'],
  },
  preview: {
    pos: ['Dá {club}, pode anotar!', 'Hoje é dia de {club} 💪', 'Vamos com tudo, {club}!'],
    neg: [], neu: ['Vai ser jogaço!', 'Final antecipada', 'Não perco esse por nada', 'Quem ganhar dispara', 'Palpites? 👇'],
  },
  sacking: { pos: [], neg: ['Demorou!', 'Injusto, o problema é o elenco', 'Quem vem agora?', 'Mais uma vez a culpa cai no técnico'], neu: ['Era questão de tempo', 'Vamos ver quem assume'] },
  coach: { pos: ['Bem-vindo! Confiança total 💪', 'Gostei da escolha', 'Que comece um novo tempo'], neg: ['Não era hora de mudar', 'Espero que tenham pensado bem'], neu: ['Boa sorte ao novo comandante', 'Quero ver o trabalho'] },
  title: { pos: ['É CAMPEÃO! 🏆', 'Mereceu demais!', 'Temporada histórica pro {club}!', 'Chora, rival!'], neg: [], neu: ['Parabéns ao campeão', 'Título justo'] },
  round: { pos: ['Líder com sobra! 💪', 'Tá vindo, {club}!'], neg: ['Ainda dá pra reagir', 'Que fase...'], neu: ['Tabela embolada', 'Campeonato equilibrado esse ano'] },
};
POOLS.hattrick = { pos: ['Que jogador! {player} 🎩', 'Craque demais!', '{player} na seleção já!'], neg: [], neu: ['Monstro!', 'Atuação de gala de {player}'] };
POOLS.upset = POOLS.match!;

export interface CommentDraft { clubId: string | null; text: string }
/**
 * 2 a 5 comentários: cada um de um torcedor de um clube citado (o humor do clube escolhe o tom) ou de um torcedor neutro.
 * `clubs` = clubes citados no post (com nome) e `player` = jogador citado.
 */
export function commentsFor(rng: Rng, kind: PostKind, clubs: ReadonlyArray<{ id: string; name: string }>, mood: Mood, player?: string): CommentDraft[] {
  const pool = POOLS[kind] ?? POOLS.match!;
  const n = 2 + Math.floor(rng.next() * 4);
  const out: CommentDraft[] = [];
  const used = new Set<string>();
  for (let i = 0; i < n * 3 && out.length < n; i++) {
    const c = clubs.length && rng.next() < 0.8 ? clubs[Math.floor(rng.next() * clubs.length)]! : null;
    const m = c ? mood[c.id] ?? 0 : 0;
    const list = m > 0 && pool.pos.length ? pool.pos : m < 0 && pool.neg.length ? pool.neg : pool.neu;
    const text = fill(pick(rng, list), { club: c?.name ?? '', player: player ?? '' });
    if (!text.trim() || used.has(text)) continue;
    used.add(text);
    out.push({ clubId: c?.id ?? null, text });
  }
  return out;
}

/** Engajamento: cresce com a reputação dos clubes envolvidos (0–100) e com o tipo de post. */
const KIND_WEIGHT: Record<PostKind, number> = { match: 1, upset: 1.6, preview: 1.3, transfer: 1.4, injury: 0.8, sacking: 1.5, title: 2.5, round: 0.9, coach: 1.2, hattrick: 1.3 };
export function engagement(rng: Rng, kind: PostKind, reputation: number, verifiedAuthor: boolean): { likes: number; reposts: number } {
  const base = (80 + Math.pow(Math.max(1, reputation), 2) * 1.6) * KIND_WEIGHT[kind] * (verifiedAuthor ? 1.3 : 1);
  const likes = Math.round(base * (0.6 + rng.next() * 0.8));
  return { likes, reposts: Math.round(likes * (0.06 + rng.next() * 0.14)) };
}
export function commentLikes(rng: Rng): number { return Math.floor(Math.pow(rng.next(), 3) * 400); }

/** "@" do perfil: só minúsculas, números e _ (até 24 caracteres). */
export function handleOf(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'perfil';
}
