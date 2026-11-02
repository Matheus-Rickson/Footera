# Olheiros e categorias de base (Fase 8B)

Decisões do usuário (02/11/2026): olheiros **contratáveis**, elenco **sub-20 separado** e safra num **dia de peneira em março**.

## Olheiros
- Até **4** olheiros, só no clube do usuário. A cada mês há 5 candidatos (determinísticos por semente e mês): qualidade 3–19, salário mensal
  `economia × (3.000 + qualidade² × 150)`. Contrato de 2 anos; ao vencer, o olheiro sai (com notícia). Demitir paga até 3 meses de salário (`scouting`, via `makePoster`).
- Designação: **um país** (acompanha 5 jogadores ao mesmo tempo até concluir cada relatório — primeiro os já iniciados; novos alvos sorteados entre os 80 mais valiosos ainda não observados; nunca do próprio clube nem da base) ou **lista de observação** (divide `3 × ganho` por dia entre os
  jogadores marcados com "Observar"). Ganho diário por jogador observado = `3 + 0,35 × qualidade` pontos de conhecimento (0..100).
- **Estimativa com conhecimento `k`:** `f = 1 − k/100`; ruído do centro × f; meia-largura da força `1 + 5f` (6 → 1), do potencial `2 + 6f` (8 → 2); o centro do
  potencial vai do potencial estimado (k = 0) ao potencial oculto (k = 100). Com k = 0 o resultado é idêntico ao de antes da fase (testado). A faixa de força sempre
  contém o valor real. Regra 7 continua: o usuário só vê faixas, nunca os valores de jogadores de outros clubes.
- Processado por `moveClock` todo dia (depois do mercado, antes do fechamento mensal) e no dia da virada.

## Categorias de base
- Jogador da base: `club_id` nulo e `youth_club_id` = clube. Não aparece no elenco principal, nas escalações, no mercado nem nas propostas; não conta no limite de 30.
  Salário próprio (`economia × (500 + 20 × força)`), pago na categoria `youth`.
- **Academias iniciais:** 6–8 jovens de 15–18 anos por clube, uma única vez (carreiras novas e saves antigos, `meta.youth_seeded`).
- **Peneira em 15/mar** (uma vez por temporada, `meta.youth_intake_<temporada>`): safra de `2 + nível da base/7 + sorteio×2` jovens de 15–16 anos (+1 para o usuário),
  limitada a 20 na base do usuário e 12 na da IA. Notícia com nomes, posição e potencial estimado.
- Qualidade: 45% reputação do clube + 45% nível da base. O formado típico chega ao auge uns 5 pontos abaixo do nível médio do clube; os talentos raros
  (potencial extra do gerador) viram titulares.
- O usuário **promove** (contrato profissional de 3 temporadas, salário pelo valor) ou **dispensa** (fica livre). Promover respeita o limite de 30.
- **Virada:** a IA promove jovens de 17+ com nível de reserva imediato (13º do elenco − 3) até 26 no elenco, e de 18+ com nível de fim de elenco (20º − 4) para
  completar elencos abaixo de 24. Quem tem 19 anos e não foi promovido deixa a base (livre). Se um elenco fica sem o mínimo num setor, o **melhor jovem da base** desse
  setor é promovido antes de gerar uma reposição (vale para o usuário, com aviso).
- Promoção não é transferência (mesmo clube); entrada de jogador vindo de outro clube ou livre continua só por `executeTransfer`.

## Ajustes no ciclo de carreira feitos nesta fase
- Os jovens deixaram de entrar direto no elenco principal na virada (agora: peneira → base → promoção).
- **Pretensão de livres:** ao ficar sem clube, o salário do jogador vira 1,2% do valor de mercado (`resetToFreeAgentWage`). Antes, livres carregavam o salário antigo como
  piso (×1,05): ingleses dispensados assinavam no Brasil com salário inglês e as folhas subiam em cascata.
- A IA só contrata livres cujo pedido caiba em 1,5× o salário médio do próprio elenco.
- Livres de qualquer idade largam o futebol com mais frequência (+30 p.p.; +50 a partir dos 30).

## Estabilidade (5 viradas, universo completo, semente `soak`)
| Medida | Início | Depois de 5 viradas |
|---|---|---|
| Média dos 14 melhores: Série A / Série B | 67,6 / 57,8 | 67,4 / 59,9 |
| Média dos 14 melhores: Premier / Championship | 66,5 / 56,6 | 68,1 / 59,0 |
| Folha mediana Série A | 787 mil | 850 mil |
| Margem anual mediana sem prêmio | +0,1% | entre −2% e +2% por temporada, sem tendência |
| Margem com prêmio | +2,7% | +2% a +5% |
| Livres / jovens nas bases | 0 / 569 | ~530 / ~640 |
| Saldos inconsistentes | 0 | 0 |

Calibrações descartadas: com a base em 50%+50% e sem os ajustes de livres, a força subia ~+2,5 e a margem caía para −12,6% em 5 temporadas.
As segundas divisões ainda sobem ~2 pontos (principalmente rebaixados que chegam com elencos fortes).

## Limitações conhecidas
- A IA não tem olheiros (não precisa: decide com os valores reais, como antes).
- Nível da base é fixo (investimento em instalações: Fase 8C). Sem treino individual, empréstimo de jovens ou contratos de formação.
- O usuário vê a força real e o potencial estimado dos próprios jovens (mesma regra do elenco principal).
