# Ciclo de carreira (Fase 8A)

## Linha do tempo
- **Temporada por país (Fase 9):** cada país tem a sua (`countries.season_start`: julho a junho, ou ano civil — Brasil, Argentina e Irlanda
  na base) e vira na sua data. A virada do país do treinador é a ação dele (`startNextSeason`); as dos outros acontecem sozinhas dentro de
  `moveClock` (`autoTurnovers`), com a mesma ordem abaixo, restrita aos clubes daquele país. No ano civil, a temporada `S` vai de 1º/jan a 31/dez
  (contratos terminam em 31/dez). **Início da carreira** (pedido do usuário, 06–07/11/2026; `careerWorld`): sempre no início da temporada
  do país do clube, com as divisões da base, e os países do outro calendário na metade da temporada deles. Clube de ano civil → 1º/jan/2026:
  o universo começa em 1º/jul/2025 e os países de julho jogam jul–dez da 2025/26. Clube de julho → 1º/jul/2026: o universo começa em
  1º/jan/2026 e os países de ano civil jogam jan–jun da temporada 2026. Os seis meses são simulados na criação sem o treinador
  (`fastForwardToCareerStart`, resultado rápido, sem diretoria nem rotina do clube); o país do clube fica parado nesse período
  (`country_seasons.transition = 1`, sem jogos), então a sua primeira virada não tem acesso/rebaixamento. **Não há mais torneio de transição**
  (saves antigos que já tinham um continuam; a virada dele não tem acesso/rebaixamento). Universo com um só calendário: começa direto.
  Base real: ~8 s para criar. O texto abaixo descreve a temporada de julho.
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
   **Aposentadoria anunciada (09/11/2026, migração 027):** jogador **com clube** não se aposenta mais de surpresa na virada. O sorteio é feito no
   **início** da temporada (na virada anterior, ou na criação da carreira), com a idade que ele terá no fim dela (idade + 1, para a aposentadoria
   acontecer na mesma idade de antes); quem foi sorteado fica com `retire_planned = 1`, cumpre a temporada, não pode renovar e se aposenta na virada
   seguinte. O treinador recebe um e-mail ("X vai se aposentar ao fim da temporada") com os do seu elenco; contratar um jogador que já anunciou
   também avisa. Livres continuam decidindo na própria virada (sem contrato, não há temporada a cumprir). Ninguém se aposenta no primeiro dia da
   carreira: com simulação prévia, o país do clube sorteia na virada que abre a carreira. Saves anteriores à migração (sem a marca
   `retire_plan:<país>` em `meta`) usam a regra antiga uma última vez e passam a sortear a partir daí.
5. **Contratos que vencem** (`contract_end ≤ 1º/jul`): a IA renova 90% dos 14 mais fortes do elenco e 55% dos demais (1–3 temporadas, limitado pela idade);
   os outros ficam livres. **O usuário não renova automaticamente:** quem não foi renovado sai de graça.
6. **Desenvolvimento** — desde a Fase 8C é **mensal** (dia 1º, pelo treino; ver `docs/TRAINING_STAFF.md`); a virada só registra o saldo da temporada. Regras de crescimento (`developPlayer`): até 27 anos cresce em direção ao potencial oculto — `margem × taxa(idade) + 0,3`, com taxa de 30% (≤18)
   a 12% (27), × (0,85 + 0,3 × fração de minutos jogados) × (0,85 + 0,3 × profissionalismo/20), mais ruído; **antes dos 28 nunca passa do potencial oculto**
   (atributos cortados até caber). 28–29: estável. A partir dos 30 declina (−0,3, −1, −1,5 … −3 aos 35, −3,5 e mais a partir de 36), com o físico caindo 1,5× mais rápido;
   profissionais declinam mais devagar. Valor de mercado recalculado. Snapshot em `player_development`.
7. **Categorias de base** (desde a Fase 8B, ver `docs/SCOUTING_YOUTH.md`): a IA promove jovens prontos; quem tem 19 anos e não foi promovido sai da base. A safra chega na peneira de 15/mar, não mais na virada.
8. **Elencos da IA:** acima de 35 (`SQUAD_MAX`; era 28 até 09/11/2026) libera os mais fracos (veteranos primeiro) sem abrir carência; abaixo da composição mínima (22 jogadores; 3 GK, 7 DEF, 6 MEI, 4 ATA)
   contrata livres compatíveis com o próprio nível e, se faltar, promove jovens. Elenco do usuário abaixo do mínimo para jogar (18; 2/6/4/3) recebe jovens às pressas (avisado).
9. Suspensões e cartões amarelos zeram (lesões continuam). `season + 1`, calendário novo (`createSeason`, que também cria as copas nacionais
   da temporada e sorteia a 1ª fase), mercado e cobrança do dia 1º/jul. A temporada só termina depois da final das copas (maio; no Japão, 1º/jan).

## Contratos
- Todo contrato novo (transferência, livre, renovação, jovem) termina em **30/jun**, para vencer exatamente numa virada. Saves antigos têm fins em 1º/jul ou no meio
  da temporada; eles vencem na primeira virada em que `contract_end ≤ 1º/jul`.
- **Renegociação pelo usuário (v0.8.9, a qualquer momento):** em Contratos → painel do jogador → "Renegociar": salário, temporadas a acrescentar
  (0 = mantém o fim do contrato; contam a partir do fim atual) e **status de tempo de jogo**. Pedido = max(valor × 1,2%, salário × 1,08) × fator de
  ambição (+) e fidelidade (−) × multiplicador de negociação do treinador × peso do status novo ÷ peso do atual (`renegotiationTarget`).
  - Oferta ≥ 97% do pedido: aceita. Abaixo disso o jogador **contrapropõe**: oferta + 40% da diferença, nunca abaixo de 85% do pedido nem acima
    do pedido anterior nos mesmos termos (status e temporadas). Aceitar o pedido dele sempre fecha, mesmo abaixo do salário atual (redução negociada).
  - **3 tentativas**: na 3ª oferta insuficiente ele encerra a conversa e só volta a negociar 30 dias depois (`contract_talks`, migração 028).
  - Temporadas: máximo pela idade, 5 (≤29), 3 (30–31), 2 (32–33), 1 (34+), e o contrato resultante não passa desse limite + 24 meses a partir de
    hoje (quem tem contrato longo acrescenta menos). Antes, a renovação só era possível com até 24 meses restantes.
  - Veto da diretoria para salários fora do orçamento; quem anunciou a aposentadoria não renegocia.
- **Tempo de jogo (v0.8.9):** cada jogador do clube do usuário tem um status combinado no contrato (`squad_roles`, migração 028):

  | Status | Minutos esperados | Peso no salário pedido |
  |---|---|---|
  | Jogador-chave | 85% | 1,15 |
  | Titular | 70% | 1,05 |
  | Rotação | 40% | 1,00 |
  | Reserva | 15% | 0,92 |
  | Promessa (até 21 anos) | 10% | 0,90 |

  - Status padrão (carreira nova e quem chega ao elenco): pela força, 3 jogadores-chave, 8 titulares, 7 de rotação; do resto, até 21 anos promessa e
    os demais reserva. Promessa que passa dos 21 vira reserva. Só muda por renegociação; rebaixar o status custa 5 de moral por degrau.
  - **Avaliação mensal** (dia 1º, `processPlayingTimeMonth` dentro do `moveClock`): minutos do jogador desde a última avaliação ÷ (jogos do clube no
    período × 90), em todas as competições, com pelo menos 3 jogos (com menos, acumula para o mês seguinte). Abaixo de 60% do esperado: insatisfeito,
    moral −6; no esperado ou acima: satisfeito, +2; entre os dois: nada. Quem se lesionou no período fica de fora. Um e-mail da comissão técnica lista os
    insatisfeitos (ação "Abrir contratos"). Não calibrado em várias temporadas.
  - Na tela, a barra mostra a parte dos minutos da temporada corrente (com a marca do esperado) e o ícone, o último veredito mensal.
- **Renovação pela IA:** salário = valor × 1,2% × fator de personalidade, **no máximo +10%** sobre o atual (veterano desvalorizado aceita redução).
  Com o piso de +8% do usuário aplicado também à IA, as folhas inflavam e a margem mediana caía de +1% para −9% em cinco temporadas.

- **Rescisão pelo usuário (09/11/2026):** em Contratos → "Rescindir". O clube paga os salários que faltam até o fim do contrato (salário ×
  meses restantes, no mínimo 1 mês; categoria `wages`, pelo `makePoster`) e o jogador sai livre na hora (`releasePlayer`), com a pretensão
  salarial pelo valor atual. Vale fora da janela; recusada se o caixa não cobre o valor ou se o elenco ficaria abaixo do mínimo (18; 2 goleiros
  e profundidade por setor).

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
