/** Atributos do treinador com o botão de distribuir pontos (v0.8.10: saiu da Diretoria para o Histórico da carreira). */
import { Plus } from 'lucide-react';
import { HelpTip } from '../help.tsx';
import { COACH_ATTRS, type CoachAttrKey, type CoachAttributes } from '../../shared/coachAttributes.ts';
import { COACH_ATTR_CAP, COACH_EFFECT } from '../../game/coach-engine/coach.ts';

/** O que cada atributo do treinador faz no jogo (efeito máximo, com o atributo em 20; na base 5 não há efeito). */
const pct = (x: number) => `${Math.round(x * 100)}%`;
export const COACH_EFFECT_TEXT: Record<CoachAttrKey, string> = {
  tactics: `Força do time em campo: até +${String(COACH_EFFECT.tactics * 100).replace('.', ',')}% (soma ao entrosamento).`,
  motivation: `Conversa no vestiário: efeito bom até ${pct(COACH_EFFECT.talkBoost)} maior; efeito ruim até ${pct(COACH_EFFECT.talkSoften)} menor.`,
  youth: `Evolução mensal dos jogadores de até 21 anos do seu clube (elenco e base): até +${pct(COACH_EFFECT.youth)}.`,
  discipline: `Chance de cartão (amarelo e vermelho) dos seus jogadores: até −${pct(COACH_EFFECT.cards)}.`,
  negotiation: `Taxa pedida pelos clubes e salário pedido pelos jogadores (contratação e renovação): até −${pct(COACH_EFFECT.negotiation)}.`,
  adaptability: `Quem entra ou muda de posição por decisão sua rende até +${pct(COACH_EFFECT.inGame)}; ao assumir um clube novo, até +${COACH_EFFECT.newClub} de confiança da diretoria.`,
};

export function CoachAttributesPanel({ attributes, points, busy, onSpend }: { attributes: CoachAttributes; points: number; busy: boolean; onSpend: (key: CoachAttrKey) => void }) {
  return (
    <>
      <div className="row">
        {points > 0 && <span className="bd-points">{points} ponto(s) para distribuir</span>}
        <HelpTip text="Escala 1–20. Na avaliação de cada temporada no cargo o treinador ganha 1 ponto, +1 se cumprir o objetivo, +1 por título e +1 por acesso. Cada atributo vai até 20. Os efeitos começam acima de 5 (a base da criação) e são pequenos de propósito." />
      </div>
      <div className="bd-attrs">
        {COACH_ATTRS.map((a) => {
          const v = attributes[a.key];
          return (
            <div key={a.key} className="bd-attr">
              <span className="bd-attr-name">{a.label}<HelpTip text={`${a.description} ${COACH_EFFECT_TEXT[a.key]}`} /></span>
              <div className="meter bd-attr-bar"><i style={{ width: `${(v / COACH_ATTR_CAP) * 100}%` }} /></div>
              <strong className="bd-attr-val">{v}</strong>
              {points > 0 && <button className="nc-ghost bd-attr-plus" disabled={busy || v >= COACH_ATTR_CAP} aria-label={`Adicionar ponto em ${a.label}`} onClick={() => onSpend(a.key)}><Plus size={14} aria-hidden="true" /></button>}
            </div>
          );
        })}
      </div>
    </>
  );
}
