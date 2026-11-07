# Conversas e promessas

Regras em `src/game/promise-engine/promises.ts` (puras, sem acaso); aplicação e cobrança em `src/database/repositories/promiseRepository.ts`;
tabelas `conversations` e `promises` (migração 021). Tela: Visão geral → "Conversas e promessas".

## Com jogadores do elenco
Uma conversa por jogador a cada 14 dias. Moral e forma vão de 0 a 100 (moral nunca abaixo de 10).

| Tema | Efeito |
|---|---|
| Elogiar o desempenho | forma ≥ 60: moral +6 · forma 45–59: +2 · forma < 45: −3 (fora de hora) |
| Cobrar mais empenho | forma ≥ 50: moral −5 (injusto) · forma < 50 e moral ≥ 50: forma +6, moral −2 · forma < 50 e moral < 50: moral −6 |
| Prometer mais minutos | moral +8 agora. Julgada depois de 5 jogos do clube (ou em 60 dias, com os jogos que houve): média de 45 min por jogo → +4; senão −15. Sem jogos no prazo: anulada |
| Prometer renovação | só com contrato terminando em até 18 meses. Moral +6 agora. Renovar até 60 dias depois (ou o fim do contrato, se antes) → +4; senão −15 |

Uma promessa em aberto por jogador. Jogador que sai do clube (venda, fim de contrato) ou treinador que muda de clube: a promessa é anulada, sem efeito.
Jogadores com moral abaixo de 40 aparecem em "Pedem conversa".

## Com a diretoria
Uma conversa a cada 30 dias; no máximo uma promessa de cada tipo em aberto.

| Promessa | Agora | Cumprida | Quebrada |
|---|---|---|---|
| Terminar a liga 2 posições acima da meta (mínimo 1º; indisponível se a meta já é o título ou depois de 3/4 da liga) | confiança +5 | +10 | −15 |
| Vencer 3 dos próximos 5 jogos (todas as competições; no prazo de 75 dias, a mesma proporção com os jogos que houve) | +3 | +6 | −8 |

A posição é cobrada quando a liga termina (sem jogos a disputar). Desfechos viram mensagem na Caixa de entrada; os da diretoria param o "Continuar".

## Humor da torcida
Indicador derivado (nada gravado, sem efeito no jogo por ora): 55 + 8 × (vitórias − derrotas nos últimos 5 jogos) + 3 × (posição esperada − posição atual na
liga), limitado a 0–100. Rótulos: ≥ 70 empolgada, ≥ 55 satisfeita, ≥ 40 desconfiada, abaixo disso irritada (`boardRepository.fanMood`).

## Não calibrado
Os números acima são a primeira proposta e não passaram por estudo de várias temporadas (como as finanças). A moral já influencia o desempenho nas
partidas pelo motor; o efeito acumulado de conversas frequentes não foi medido.
