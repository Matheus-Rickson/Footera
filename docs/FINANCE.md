# Motor financeiro (Fase 6)

## Modelo
Todo dinheiro passa por **uma única função** (`makePoster`): atualiza `clubs.balance`, o resumo mensal `finance_months` (todos os clubes) e o extrato
`finance_ledger` (apenas o clube do usuário, para não inflar o save). Por isso vale a invariante testada para **todos os clubes**:
`saldo atual = saldo inicial + soma dos lançamentos`.

**Mensal (dia 1 de cada mês, liquidado uma única vez — `meta.finance_last_month`):**
- Receitas: direitos de TV (por divisão e reputação), patrocínios (3 contratos: camisa 55%, material esportivo 30%, naming rights 15%), produtos oficiais (torcida).
- Despesas: salários dos jogadores (soma real dos contratos), comissão técnica e base (nível das instalações), estádio e instalações (capacidade e nível),
  administração e viagens (reputação).
**Por jogo em casa:** bilheteria = público × preço. Público = capacidade × ocupação (reputação do mandante, atração do adversário, clima, ruído), nunca acima da capacidade.
Fator econômico por país (`countries.economy`: Brasil 0,6; Inglaterra 1,6) escala todos os valores.

## Calibração (320 clubes de 4 universos; `finance.test.ts`)
| Medida | Resultado |
|---|---|
| Margem anual mediana | +2% (faixa aceita: −4% a +8%) |
| Clubes no vermelho | 46% (faixa: 20–65%) |
| p10 / p90 da margem | −16% / +17% |
| Mediana por divisão (1ª / 2ª) | +3–4% / −1% |

A 1ª calibração deixava a 2ª divisão em −22% (todos quebrando); custos fixos foram reescalados. Âncoras: a folha dos jogadores gerados já é proporcional
a `economia × (reputação/65)^2,35`, e as receitas foram ancoradas na mesma estrutura.

## Limitações conhecidas
- Categorias de despesa `coaching` (comissão contratada, só o usuário; o fixo `staff` do usuário virou só estrutura) e `infrastructure` (obras) — Fase 8C.
- Categorias de despesa `youth` (salários da base, todos os clubes) e `scouting` (olheiros e multas, só o usuário) — Fase 8B.
- Premiação da liga (categoria `prize`) é paga na virada de temporada — fórmula e efeito na margem em `docs/CAREER_CYCLE.md`.
- Sem empréstimos, juros, impostos nem regras de fair play; saldo negativo não gera consequências ainda.
- Patrocínios dos clubes da IA são renovados automaticamente (sem negociação), com sorteio de ±12%. Os do clube do usuário são negociados (seção abaixo).
- Comissão técnica não é modelada por funcionário: o custo deriva do nível das instalações. Preço do ingresso não é editável.
- Extrato detalhado só para o clube do usuário; os demais têm resumo mensal por categoria.
- Fatores econômicos de países além de Brasil e Inglaterra caem em 1,0 até a Fase 9 (universo ampliado).
- O gráfico é um SVG próprio (testável sem dependências); a biblioteca Recharts prevista na especificação não foi usada.

## Caixa inicial e moeda (Fase 9, 05/11/2026)
- **Moeda única: euro (€)**, nas telas e nas mensagens do jogo (`shared/money.ts`, `fmtMoney`). A economia de cada país continua escalando
  salários, valores e receitas; só a unidade exibida é única.
- **Caixa inicial** = `reputação × 180.000 × economia + 22% do valor do elenco` (`startingBalance`). Antes era só a primeira parcela, e o
  clube mais forte da Série A começava com € 8,7 mi tendo um elenco de € 114 mi e um jogador de € 16,7 mi — não conseguia contratar.
  Agora: melhor da Série A ~€ 34 mi; pior da Série A ~€ 13 mi; melhor da Premier ~€ 82 mi; Série D ~€ 2 mi. A regra vale para clubes
  criados por pacote sem caixa informado. Os fluxos mensais não mudaram (a margem anual não depende do saldo); todos os testes de finanças
  e mercado continuam passando. A base fixa foi regenerada com o novo caixa (ainda não havia sido publicada).

## Copas nacionais (Fase 9)
Prêmios das copas (cotas por fase, vitórias, semifinalista, vice e campeão) e bilheteria dos jogos de copa entram pelo `makePoster`
(regra 1 conferida por teste com as copas). Medido em temporadas completas (mundo de teste, 2 países × 2 divisões de 20, 3 sementes):
prêmios das copas ≈ 1,0% da receita dos clubes e bilheteria dos jogos de copa ≈ 1,6%; somados, ≈ 2,6% das despesas — a margem anual sobe
cerca de 2,6 pontos em média (mediana +2% → ≈ +4,6%, dentro da faixa aceita de −4% a +8%), concentrados em quem avança mais. A calibração
mensal (sem prêmios) não mudou.

## Divisões de baixo e folhas fora da realidade (09/11/2026)
Pedido do usuário: clubes começavam a temporada com caixa negativo. Medido na base fixa (16 países) com `annualEstimate`, a margem anual
mediana era −40% na 3ª divisão, −150% na 4ª e −330% na "Sem divisão": as receitas (TV, patrocínio, bilheteria) caem com a reputação, mas os
pisos de custo não (salário mínimo de 1.500, estrutura e manutenção do estádio). No universo do usuário (base + pacotes) havia ainda folhas
reais muito acima da receita (Flamengo do pacote de licenças: folha 4,3× a receita; Bayern, Bromley, Remo, Preston acima de 1×).
- **Cota de participação** (`F.participation`, × economia, por mês, junto com a TV): 3ª divisão 80 mil, 4ª 105 mil, 5ª ("Sem divisão") 120 mil;
  1ª e 2ª inalteradas (calibração antiga e testes preservados). Valores = o que faltava ao clube mediano de cada divisão para a margem ficar
  perto de +2%. Base fixa depois: 3ª +1 a +8%, 4ª −4 a +13%, 5ª +1% (teste em `club-management.test.ts`, faixa −8% a +12%).
- **Teto da folha na montagem do universo** (`WAGE_CAP`, `wageCapFactor`, `compile.ts`): se a folha de um clube com salários informados por um
  pacote do usuário passa de 80% da receita anual estimada, todos os salários do elenco são reduzidos na mesma proporção até 65% (aviso
  "salários reduzidos" no universo). A base fixa e os mundos gerados não passam pelo teto (a ida e volta base → pacote → universo continua idêntica).
- **Resultado** (universo real do usuário, carreira no Brasil, 18 divisões completas, uma temporada): clubes no vermelho no fim da temporada
  **45 → 0** (antes: 36 na Série D, 4 na League One, 4 na League Two, 1 na Série A).

## Patrocínios negociados (v0.8.10, migração 029)
Decisão do usuário: "Propostas + contraproposta + bônus". Regras em `game/finance-engine/sponsors.ts` (puro) e `sponsorRepository.ts`.
- **Quando chegam propostas:** 60 dias antes de uma cota (camisa, material esportivo, naming rights) vencer, com e-mail; ou pelo botão "Buscar
  patrocinador" numa cota vaga (no máximo a cada 30 dias por cota). São 2 ou 3 empresas por cota.
- **Valor de referência** = o mesmo da renovação automática (`sponsorTotalMonthly × participação da cota`). Perfis: **fixo alto** (102–110% da
  referência, sem bônus) ou **fixo menor + bônus** (82–90%, com bônus por título da liga ×4 mensalidades, acesso ×3, posição-alvo ×1,5 e título de
  copa ×2). O valor esperado fica perto da referência, para não mexer na margem calibrada (~+2%; `finance.test.ts` continua passando).
- **Contraproposta:** cada empresa tem um teto secreto (106–115% da proposta). Pedido até o teto: aceita. Acima: a empresa sobe a oferta em 40% da diferença entre a oferta dela e o pedido,
  sem passar do teto. Até 3 rodadas; na 3ª insuficiente, desiste e a cota fica 30 dias sem propostas dela.
- **Duração:** 1 a 4 anos (o usuário escolhe ao aceitar).
- **Rescisão:** multa de 3 mensalidades, limitada ao que resta do contrato, paga por `makePoster` (categoria `sponsorship`, valor negativo). A cota fica
  vaga até um novo acordo: nenhuma receita dela enquanto isso.
- **Vencimento sem decisão:** a melhor proposta aberta é aceita sozinha (com aviso), para a cota não ficar vazia sem querer.
- **Bônus:** pagos por `makePoster` (`sponsorship`) quando a meta acontece: título de copa na final; liga, acesso e posição na virada.

## Tela de Finanças (v0.8.10)
Sem barra de rolagem na página (em telas menores que 1100×700 volta a rolar). Abas: **Visão geral** (caixa, resultado da temporada, folha × teto,
fôlego; saldo em 24 meses; receitas × despesas em 12 meses; composição das receitas e despesas da temporada), **Receitas e despesas** (temporada atual ×
anterior por categoria, com a tendência dos 12 meses), **Patrocínios** (3 cotas com tempo de contrato, bônus, negociação e rescisão), **Bilheteria**
(público × capacidade por jogo) e **Extrato** (paginado, filtro por categoria, IPC `finance:ledger`). Cada bloco tem um "?" com explicação.
Gráficos em SVG próprio (`renderer/charts.tsx`), cores pelos tokens `--viz-1..6` nos dois temas (paleta conferida com o validador da skill de
visualização; no tema claro três cores ficam abaixo de 3:1 de contraste, por isso as roscas sempre têm legenda com os valores).

## Piso de patrocínio das divisões de baixo (v0.8.10, 10/11/2026)
Pedido do usuário: o Brasiliense (Série D, reputação 15) recebia € 12,1 mil/mês somando os 3 patrocínios (naming rights € 1,8 mil), menos que a
venda de produtos (€ 37,7 mil) e um nono da folha (€ 105 mil). Causa: o patrocínio cai com a reputação ao expoente 2,4, e uma reputação 15 dá ~3%
do valor de referência; o que faltava a esses clubes vinha de uma cota artificial somada à TV. Nos clubes pequenos de verdade o patrocínio
(casas de apostas, empresas regionais) é a principal receita; orçamentos de Série D ficam em R$ 0,5–2 mi/ano (Tribuna do Norte, sem metodologia
publicada; balanços de Série C/D não foram encontrados).
- **Piso mensal** (`F.sponsorFloor`, × economia): 3ª divisão 30 mil, 4ª 40 mil, 5ª ("Sem divisão") 35 mil, somado à parte pela reputação.
- **Saves antigos:** os contratos em vigor dos clubes da 3ª divisão para baixo sobem a parte do piso de cada cota, uma vez (`meta.sponsor_floor`).
- Brasiliense depois: patrocínios € 36,1 mil/mês (camisa 20,3 mil, material 10,4 mil, naming rights 5,4 mil).
- A primeira versão tirava o piso da cota de participação (receita total igual). A calibração abaixo, pedida em seguida, reduziu custos e
  receitas juntos.

## Calibração das divisões de baixo (v0.8.10, 10/11/2026)
Pedido do usuário ("Pode realizar a calibração indicada"): mesmo com o piso de patrocínio, um clube da Série D movimentava ~€ 1,3 milhão por ano
(≈ R$ 8 milhões), contra R$ 0,5–2 milhões na realidade. Causas: salário mínimo de 1.500 para todos os países (80% dos jogadores da Série D
estavam no piso), estrutura e estádio cobrados como num clube grande e a cota de participação que cobria esse custo. Série A e B ficaram fora
(na realidade estão acima do jogo; outra calibração).
- **Salário mínimo por país** (`minSalary`): 1.000 × economia, entre 100 e 1.500 (Brasil 600 ≈ R$ 3,7 mil; Inglaterra e Espanha 1.500, como
  antes). `fairSalary` = 1,2% do valor ao mês, nunca abaixo do mínimo. Usado no gerador, na montagem do universo (jogadores criados), na
  pretensão dos livres (país da nacionalidade), nos pedidos de transferência (`wageDemand`) e de renovação (`renewalDemand`, `aiRenewalWage`;
  país do clube que paga) e na promoção da base. O veto da diretoria por salário fora da realidade continua com o piso antigo (1.500 é "fora
  da realidade" em nenhum país).
- **Piso antigo rebaixado** (`rebasedFloorSalary`): quem ganha exatamente 1.500 e vale menos que isso passa ao salário pelo valor com o mínimo do
  país. Na montagem do universo vale para a base, para os pacotes (exatamente 1.500 é o piso exportado por versões anteriores) e para os livres
  (país da nacionalidade). **Saves antigos:** a mesma correção uma vez (`meta.salary_floor`), sem mexer nos jovens da base nem em quem vale mais.
- **Porte do clube** (`sizeFactor` = reputação / 30, entre 0,2 e 1): multiplica estrutura (comissão), instalações, manutenção do estádio e venda
  de produtos. Reputação 30+ (praticamente toda a 1ª e a 2ª divisão) paga como antes.
- **Cota de participação** 80/105/120 mil → **25/18/16 mil** (3ª/4ª/5ª, × economia), recalculada para a margem mediana voltar a ~+2%.
- **Resultado** (base fixa, Brasil, medianas anuais):

  | Divisão | Receita antes | Receita depois | Margem depois |
  |---|---|---|---|
  | Série C | € 2,2 mi | € 1,8 mi | +6,4% |
  | Série D | € 1,3 mi | € 0,75 mi (≈ R$ 4,6 mi) | +2,1% |
  | Sem divisão | € 1,1 mi | € 0,49 mi (≈ R$ 3 mi) | −0,4% |

  Outros países, 3ª divisão: Inglaterra −5,7%, Espanha +4,1%, Alemanha +5,9%; 4ª da Inglaterra +9,9%. A faixa por divisão do teste (−8% a +12%) e a calibração dos mundos
  gerados (`finance.test.ts`, −4% a +8%) continuam valendo; o teste novo prende a receita mediana da Série D em € 0,5–1 milhão e a dos clubes sem
  divisão em € 0,3–0,7 milhão.
- **Com os pacotes do usuário** (carreira nova): Série D mediana +4,4%; o Brasiliense fica com folha de € 61 mil/mês (o teto da folha da montagem
  reduz os salários do pacote) e −11% ao ano.
- **No save atual do usuário** (cópia): a folha do Brasiliense cai de € 105,4 mil para € 91,9 mil/mês (15 jogadores saem do piso antigo), mas a
  receita estimada cai de € 1,62 mi para € 1,06 mi por ano. O déficit previsto passa de −€ 389 mil para −€ 479 mil por ano. Ele vem de 7 contratos
  de € 9,9–10,6 mil/mês (do pacote "1" e de contratações), que os saves não reduzem (contrato assinado).
- O universo em cache no disco é refeito (`UNIVERSE_CACHE_FORMAT` 2).
