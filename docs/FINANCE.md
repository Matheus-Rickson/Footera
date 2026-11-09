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
- Patrocínios são renovados automaticamente (sem negociação); reputação é fixa, então os valores só variam entre contratos por sorteio (±12%).
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
