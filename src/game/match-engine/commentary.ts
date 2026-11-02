import type { MatchEvent } from './types.ts';

export interface CommentaryLine {
  i: number; minute: number; label: string; text: string; team: 0 | 1 | null;
  kind: 'goal' | 'shot' | 'card' | 'sub' | 'foul' | 'corner' | 'offside' | 'injury' | 'penalty' | 'period' | 'shootout';
  major: boolean;
}
export interface CommentaryContext {
  teamNames: [string, string];
  playerName: (id: string | undefined) => string;
}

const pick = <T>(arr: readonly T[], i: number): T => arr[i % arr.length]!;

/** Gera uma linha de comentário por evento, SEMPRE a partir do evento real (nunca texto aleatório solto). */
export function commentate(events: readonly MatchEvent[], ctx: CommentaryContext): CommentaryLine[] {
  const score: [number, number] = [0, 0];
  const out: CommentaryLine[] = [];
  const [H, A] = ctx.teamNames;
  const nm = ctx.playerName;
  for (const e of events) {
    const team = ctx.teamNames[e.team];
    const base = { i: e.i, minute: e.minute, label: e.label, team: e.team as 0 | 1 | null };
    const push = (kind: CommentaryLine['kind'], text: string, major: boolean) => out.push({ ...base, kind, text, major });
    switch (e.type) {
      case 'goal': {
        score[e.team]++;
        const sc = `${H} ${score[0]} x ${score[1]} ${A}`;
        const who = nm(e.player), ast = e.player2 ? ` Assistência de ${nm(e.player2)}.` : '';
        const how: Record<string, readonly string[]> = {
          buildup: [`bela jogada coletiva e ${who} balança a rede`, `${who} recebe na área e finaliza com precisão`, `troca de passes envolvente termina com ${who} a empurrar para o gol`, `${who} aparece livre na área e não desperdiça`],
          counter: [`contra-ataque fulminante! ${who} não perdoa`, `${who} termina a velocidade do contra-ataque`, `a defesa é pega desprevenida e ${who} fica cara a cara com o goleiro`, `saída rápida e ${who} finaliza sem chances de defesa`],
          cross: [`cruzamento na medida e ${who} cabeceia para o gol`, `${who} sobe mais que todo mundo e testa para a rede`, `bola levantada na área e ${who} completa de cabeça`, `${who} desvia o cruzamento para o fundo da rede`],
          long: [`${who} arrisca de longe e acerta um chute indefensável`, `que pancada de fora da área de ${who}`, `${who} tenta de fora e a bola entra no ângulo`, `de longe, ${who} bate colocado e surpreende o goleiro`],
          corner: [`na cobrança de escanteio, ${who} aparece para marcar`, `${who} completa a bola parada para o gol`, `escanteio bem batido e ${who} desvia para as redes`, `confusão na área e ${who} chega primeiro à bola`],
          freekick: [`${who} cobra a falta com categoria e marca`, `falta batida por ${who} e a bola termina no fundo da rede`, `${who} bate a falta por cima da barreira e faz o gol`, `cobrança perfeita de ${who}, sem chances para o goleiro`],
          penalty: [`${who} cobra o pênalti com frieza e converte`, `${who} bate firme e não dá chance ao goleiro`, `${who} desloca o goleiro e converte a penalidade`, `pênalti convertido por ${who}`],
        };
        const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
        push('goal', `GOOOL do ${team}! ${cap(pick(how[e.chance ?? 'buildup']!, e.i))}.${ast} ${sc}.`, true);
        break;
      }
      case 'shot': {
        const who = nm(e.player), gk = nm(e.player2);
        const text = e.outcome === 'saved' ? pick([`${gk} faz boa defesa na finalização de ${who}.`, `${who} chuta firme, mas ${gk} espalma.`], e.i)
          : e.outcome === 'post' ? `NA TRAVE! ${who} quase abre o placar para o ${team}.`
          : e.outcome === 'blocked' ? `${who} finaliza, mas a defesa bloqueia.`
          : pick([`${who} chuta e a bola passa perto do gol.`, `${who} finaliza por cima do travessão.`, `${who} chuta para fora.`], e.i);
        const major = e.outcome === 'saved' || e.outcome === 'post';
        push('shot', e.chance === 'penalty' ? `${who} desperdiça a cobrança de pênalti! ${text}` : text, major || e.chance === 'penalty');
        break;
      }
      case 'corner': push('corner', `Escanteio para o ${team}.`, false); break;
      case 'foul': push('foul', `Falta de ${nm(e.player)} (${team})${e.player2 ? ` em ${nm(e.player2)}` : ''}.`, false); break;
      case 'offside': push('offside', `${nm(e.player)} (${team}) é flagrado em impedimento.`, false); break;
      case 'penalty_awarded': push('penalty', `PÊNALTI para o ${team}${e.player2 ? `, após falta em ${nm(e.player2)}` : ''}!`, true); break;
      case 'yellow_card': push('card', `Cartão amarelo para ${nm(e.player)} (${team}).`, true); break;
      case 'red_card': push('card', e.detail === 'second_yellow'
        ? `Segundo amarelo e EXPULSÃO de ${nm(e.player)} (${team})!` : `VERMELHO DIRETO! ${nm(e.player)} (${team}) é expulso.`, true); break;
      case 'substitution': push('sub', `Substituição no ${team}: entra ${nm(e.player)}, sai ${nm(e.player2)}${e.detail === 'injury' ? ' (lesão)' : ''}.`, true); break;
      case 'injury': push('injury', `${nm(e.player)} (${team}) sente uma lesão e deve ficar cerca de ${e.days} dias afastado.`, true); break;
      case 'period_end': {
        const sc = `${H} ${score[0]} x ${score[1]} ${A}`;
        const t = e.detail === 'halftime' ? `Fim do primeiro tempo. ${sc}.` : e.detail === 'fulltime' ? `Fim de jogo. ${sc}.`
          : e.detail === 'extra1' ? `Fim do primeiro tempo da prorrogação. ${sc}.` : `Fim da prorrogação. ${sc}.`;
        out.push({ ...base, team: null, kind: 'period', text: t, major: true });
        break;
      }
      case 'shootout_kick': push('shootout', `${nm(e.player)} (${team}) ${e.scored ? 'converte a cobrança' : 'desperdiça a cobrança'} na disputa de pênaltis.`, true); break;
    }
  }
  return out;
}
