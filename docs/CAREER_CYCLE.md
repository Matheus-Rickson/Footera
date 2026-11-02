# Ciclo de carreira (Fase 8A)

## Linha do tempo
- A temporada `S` vai de 1º/jul/S a 30/jun/S+1. A liga começa no 1º sábado de agosto; com 20 times a última rodada cai em abril.
- Depois da última rodada o calendário continua andando (dia a dia ou "até 1º/jul"): salários, TV e patrocínios de maio e junho são lançados normalmente.
- O relógio **nunca passa de 1º/jul/S+1** (`advanceTime` devolve `season_complete`). Ali a virada é uma **ação do usuário** (`startNextSeason`).
- O dia da virada (mercado e cobrança de julho) não é processado por `moveClock`: fica para `startNextSeason`, depois de contratos, promoções e jovens.

## Ordem da virada (uma única transação)
1. **Resultados:** tabelas finais derivadas das partidas (nada armazenado antes disso).
2. **Promoção/rebaixamento por país:** os `k` últimos da divisão `t` trocam com os `k` primeiros da `t+1`, `k = min(rebaixados de t, promovidos de t+1)`
   (Brasil 4, Inglaterra 3). Promovido +3 de reputação, rebaixado −3, campeão +2.
3. **Prêmios** (categoria `prize`, via `makePoster`): campeão da 1ª divisão = `economia × 2,4 mi`; último = 10% do campeão; linear entre eles; cada divisão abaixo × 0,23.
   Gravados em `season_results` (posição, desfecho e prêmio = registro oficial do que foi aplicado; um teste garante que a posição bate com a tabela derivada) e `trophies`.
4. **Aposentadorias:** probabilidade por idade (0 até 32; 12% aos 33 … 70% aos 36; 90% a partir de 37; 100% aos 40); −10 p.p. para força ≥ 75;
   jogadores **sem clube** têm +10 p.p. (até 23 anos), +30 p.p. (24–29) e +50 p.p. (30+), o que mantém o número de livres estável (~320 no universo completo).
5. **Contratos que vencem** (`contract_end ≤ 1º/jul`): a IA renova 90% dos 14 mais fortes do elenco e 55% dos demais (1–3 temporadas, limitado pela idade);
   os outros ficam livres. **O usuário não renova automaticamente:** quem não foi renovado sai de graça.
6. **Desenvolvimento** (uma vez por temporada, `developPlayer`): até 27 anos cresce em direção ao potencial oculto — `margem × taxa(idade) + 0,3`, com taxa de 30% (≤18)
   a 12% (27), × (0,85 + 0,3 × fração de minutos jogados) × (0,85 + 0,3 × profissionalismo/20), mais ruído; **antes dos 28 nunca passa do potencial oculto**
   (atributos cortados até caber). 28–29: estável. A partir dos 30 declina (−0,3, −1, −1,5 … −3 aos 35, −3,5 e mais a partir de 36), com o físico caindo 1,5× mais rápido;
   profissionais declinam mais devagar. Valor de mercado recalculado. Snapshot em `player_development`.
7. **Jovens da base:** usuário 2–4 por temporada (até 30 no elenco); IA 1–3 (só até 26). 16–17 anos, qualidade = metade reputação do clube, metade nível da base.
8. **Elencos da IA:** acima de 28 libera os mais fracos (veteranos primeiro) sem abrir carência; abaixo da composição mínima (22 jogadores; 3 GK, 7 DEF, 6 MEI, 4 ATA)
   contrata livres compatíveis com o próprio nível e, se faltar, promove jovens. Elenco do usuário abaixo do mínimo para jogar (18; 2/6/4/3) recebe jovens às pressas (avisado).
9. Suspensões e cartões amarelos zeram (lesões continuam). `season + 1`, calendário novo (`createSeason`), mercado e cobrança do dia 1º/jul.

## Contratos
- Todo contrato novo (transferência, livre, renovação, jovem) termina em **30/jun**, para vencer exatamente numa virada. Saves antigos têm fins em 1º/jul ou no meio
  da temporada; eles vencem na primeira virada em que `contract_end ≤ 1º/jul`.
- **Renovação pelo usuário:** só com até 24 meses restantes; conta a partir do fim do contrato atual. Pedido = max(valor × 1,2%, salário × 1,08) × fator de
  ambição (+) e fidelidade (−). Máximo de temporadas por idade: 5 (≤29), 3 (30–31), 2 (32–33), 1 (34+). Decisão igual à das transferências (≥ 97% aceita; ≥ 80% contraproposta).
- **Renovação pela IA:** salário = valor × 1,2% × fator de personalidade, **no máximo +10%** sobre o atual (veterano desvalorizado aceita redução).
  Com o piso de +8% do usuário aplicado também à IA, as folhas inflavam e a margem mediana caía de +1% para −9% em cinco temporadas.

## Jogadores livres
- Aparecem no mercado com `clubId = null` (filtro "Só jogadores livres"); a contratação não tem taxa e pode ser feita **fora das janelas**. Só o salário é negociado.
- A IA contrata livres para cobrir carências (na virada e, com pouca chance, durante as janelas). Aposentados nunca aparecem.
- Entrada em clube sempre por `executeTransfer`; saída sem destino (fim de contrato, aposentadoria) por `releasePlayer` — nenhuma das duas envolve dinheiro além da taxa.

## Estabilidade em várias temporadas (simulação de 5 viradas, universo completo, semente `soak`)
| Medida | Início | Depois de 5 viradas |
|---|---|---|
| Força média Série A / Premier | 61,3 / 60,6 | 59,6 / 59,2 |
| Força média Série B / Championship | 51,8 / 50,3 | 51,3 / 51,2 |
| Idade média nos elencos | 25,6 | 25,7 |
| Jogadores livres | 0 | ~320 (estável desde a 3ª virada) |
| Margem anual mediana sem prêmio | +1,3% | entre +3% e +8% por temporada |
| Saldos inconsistentes (`saldo ≠ inicial + lançamentos`) | 0 | 0 |

**Efeito dos prêmios nas finanças:** os valores acordados no plano somam de +2 a +4 p.p. à margem anual mediana (ex.: +3,5% → +7,1%), acima da âncora de ~+2% da
calibração da Fase 6. Não foram alterados; ver "Decisões pendentes" no `PROGRESS.md`.

## Limitações conhecidas
- Desenvolvimento só na virada (treino individual chega na Fase 8C); minutos jogados pesam pouco por isso.
- Sem copas, competições continentais, artilharia/prêmios individuais, rescisão de contrato ou empréstimos.
- O usuário não pode mudar de clube (propostas de emprego: Fase 8D); os troféus do treinador são os do clube.
- Reputação do clube só muda por acesso/rebaixamento/título.
