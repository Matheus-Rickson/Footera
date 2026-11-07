# Transferências (Fase 7)

## Regras
- **Janelas:** verão (1º/jul a 31/ago) e inverno (janeiro). Fora delas não se negocia nem se aceitam propostas; o mercado da IA também para. (Configurável por liga na Fase 9.)
- **Negociação em duas etapas, nesta ordem:**
  1. **Clube vendedor:** compara a taxa com o *preço pedido* = valor de mercado × contrato restante (≤6 meses ×0,55; ≤12 ×0,75; ≤24 ×0,92; senão ×1,05) × promessa jovem
     (+ margem de crescimento/80 para ≤23 anos) × 0,8 (≥32 anos) × 1,25 (um dos 3 melhores do elenco) × 0,88 (clube no vermelho). Taxa ≥ preço → aceita; ≥ 85% → contraproposta pelo preço; menos → recusa.
     O clube também recusa se a saída deixar o elenco abaixo de 20 jogadores ou sem 2 goleiros/6 defensores/4 meias/3 atacantes.
  2. **Jogador:** salário ≥ 97% do exigido → aceita; ≥ 80% → contraproposta; menos → recusa. Exigido = max(valor×1,2%, salário atual×1,05) ajustado por prestígio do novo clube
     (−8% se for ≥10 pontos maior, +20% se for ≥10 menor) e ambição.
- **Limites do comprador:** caixa ≥ taxa; elenco < 30. Venda pelo usuário: elenco ficar ≥ 18 com 2 goleiros e profundidade.
- **Mercado mostra só estimativas** de força e potencial com margem de erro (faixa de ±6/±8 que sempre contém o valor real e é fixa por jogador/semente; atualizar a tela não revela nada).
- **Propostas recebidas:** jogadores listados como transferíveis sempre atraem propostas (5%/dia); os 12 mais valiosos, esporadicamente (0,4%/dia). No máximo 5 pendentes, 1 nova por dia, validade de 7 dias.
  Só clubes do mesmo país, de reputação ≥ (a sua − 30) e com caixa para a taxa podem comprar.
- **Mercado da IA:** cada clube tem 1,2%/dia (na janela) de vender um jogador reserva (posições 12–21 do elenco) para um clube do mesmo país com caixa ≥ 1,5× a taxa; tudo determinístico por semente e data.

## Contabilidade
Compra e venda passam pela mesma porta de lançamentos das finanças (`transfer_out` / `transfer_in`), então vale a invariante `saldo = saldo inicial + lançamentos`
para todos os clubes. O salário novo entra na folha mensal automaticamente. O dia a dia é processado em ordem fixa (mercado do dia e depois cobrança mensal), logo
pular até a próxima rodada dá o mesmo resultado que avançar dia a dia (testado).

## Limitações conhecidas
- Jogadores livres, fim de contrato e renovações: ver `docs/CAREER_CYCLE.md` (Fase 8A). Todo contrato novo termina em 30/jun.
- Livres bons não ficam no mercado (`FREE_AGENT_LEVEL` = 62, ou 12 na escala 1–20): acima disso, o clube de maior reputação em que o jogador
  entraria entre os 11 melhores (sem passar de melhor + 3, elenco com menos de 28, salário pedido até 3× a média da folha) o contrata, mesmo
  sem carência — com 70% de chance na virada e 6% por dia nas janelas (não é certeza: um ou outro 14+ fica disponível, pedido do usuário).
  Medido no universo real (2 temporadas): antes ~30 livres entre 14 e 16; depois, 1–2 livres com 14+ logo após cada virada (alguns
  ainda no fim da janela), os demais até 13; média ~8.
- Sem rescisões, empréstimos, cláusulas (multa, bônus), agentes, limite de estrangeiros nem regras de inscrição.
- Sem rede de olheiros (Fase 8): as estimativas não melhoram com investimento.
- As taxas de jogadores muito caros superam o caixa de quase todos os clubes (o caixa inicial equivale a ~4 meses de receita). Isso é realista, mas limita compras e vendas de craques.
- O jogador não considera tempo de jogo prometido, moral nem projeto esportivo; a recusa é só por salário.
- Jogador vendido que estava na escalação manual é substituído automaticamente e o jogo avisa.
