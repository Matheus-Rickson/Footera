/**
 * Conversa no vestiário (intervalo). Regra pura e determinística: a reação de cada jogador depende do tom escolhido,
 * do placar no intervalo e da compostura dele (os de compostura baixa reagem mal a cobranças e se abalam mais).
 * O efeito é na moral: vale no 2º tempo (a moral entra na força em campo, ±3%) e fica gravada depois do jogo.
 */
export type TalkTone = 'incentivar' | 'cobrar' | 'encorajar' | 'consolar';

export const TALK_TONES: Record<TalkTone, { label: string; hint: string }> = {
  incentivar: { label: 'Incentivar', hint: 'Funciona melhor quando o time está ganhando ou empatando bem.' },
  cobrar: { label: 'Cobrar', hint: 'Pode acordar um time que está perdendo; quem tem pouca compostura sente o golpe. Com o time ganhando, soa injusto.' },
  encorajar: { label: 'Encorajar', hint: 'Dá confiança para buscar o resultado: ideal quando está empatado ou perdendo por pouco.' },
  consolar: { label: 'Consolar', hint: 'Evita que a moral desabe numa derrota pesada; com o time bem, deixa o grupo acomodado.' },
};

/** Mensagens prontas (o texto é só a forma; o efeito vem do tom). */
export const TALK_MESSAGES: Array<{ id: string; tone: TalkTone; text: string }> = [
  { id: 'inc1', tone: 'incentivar', text: 'Excelente primeiro tempo! Mantenham a intensidade.' },
  { id: 'inc2', tone: 'incentivar', text: 'Estou orgulhoso de vocês. Continuem jogando assim.' },
  { id: 'inc3', tone: 'incentivar', text: 'O plano está funcionando, confiem nele.' },
  { id: 'cob1', tone: 'cobrar', text: 'Isso é inaceitável! Quero muito mais de vocês.' },
  { id: 'cob2', tone: 'cobrar', text: 'Vocês estão dormindo em campo. Acordem!' },
  { id: 'cob3', tone: 'cobrar', text: 'Ninguém aqui tem lugar garantido. Mostrem que merecem a camisa.' },
  { id: 'enc1', tone: 'encorajar', text: 'Acreditem: dá para virar esse jogo.' },
  { id: 'enc2', tone: 'encorajar', text: 'Vocês são melhores do que isso. Vamos buscar!' },
  { id: 'enc3', tone: 'encorajar', text: 'Um gol muda tudo. Cabeça erguida e vamos para cima.' },
  { id: 'con1', tone: 'consolar', text: 'Não é culpa de vocês, foi um tempo difícil.' },
  { id: 'con2', tone: 'consolar', text: 'Esqueçam o placar, joguem pelo orgulho.' },
  { id: 'con3', tone: 'consolar', text: 'Fiquem tranquilos, ainda temos 45 minutos.' },
];

/** Variação de moral (pontos, escala 0–100) de um jogador. `goalDiff` = gols do time − gols do adversário no intervalo. */
export function talkDelta(tone: TalkTone, goalDiff: number, composure: number): number {
  const fragile = composure < 10;
  const winning = goalDiff > 0, drawing = goalDiff === 0, losingBig = goalDiff <= -2;
  switch (tone) {
    case 'incentivar': return winning ? 6 : drawing ? 4 : -2;
    case 'cobrar': return winning ? -5 : fragile ? -4 : drawing ? 2 : 5;
    case 'encorajar': return winning ? 2 : drawing ? 4 : losingBig ? 3 : 6;
    case 'consolar': return winning ? -3 : drawing ? -1 : losingBig ? 5 : 1;
  }
}
