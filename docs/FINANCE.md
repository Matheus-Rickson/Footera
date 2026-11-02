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
- Premiação da liga (categoria `prize`) é paga na virada de temporada — fórmula e efeito na margem em `docs/CAREER_CYCLE.md`.
- Sem empréstimos, juros, impostos nem regras de fair play; saldo negativo não gera consequências ainda.
- Patrocínios são renovados automaticamente (sem negociação); reputação é fixa, então os valores só variam entre contratos por sorteio (±12%).
- Comissão técnica não é modelada por funcionário: o custo deriva do nível das instalações. Preço do ingresso não é editável.
- Extrato detalhado só para o clube do usuário; os demais têm resumo mensal por categoria.
- Fatores econômicos de países além de Brasil e Inglaterra caem em 1,0 até a Fase 9 (universo ampliado).
- O gráfico é um SVG próprio (testável sem dependências); a biblioteca Recharts prevista na especificação não foi usada.
