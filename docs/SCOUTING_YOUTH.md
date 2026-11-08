# Olheiros e categorias de base (Fase 8B)

Decisões do usuário (02/11/2026): olheiros **contratáveis**, elenco **sub-20 separado** e safra num **dia de peneira em março**.

## Olheiros
- Até **4** olheiros, só no clube do usuário. A cada mês há 5 candidatos (determinísticos por semente e mês): qualidade 3–19, salário mensal
  `economia × (3.000 + qualidade² × 150)`. Contrato de 2 anos; ao vencer, o olheiro sai (com notícia). Demitir paga até 3 meses de salário (`scouting`, via `makePoster`).
- Designação: **um país** (acompanha 5 jogadores ao mesmo tempo até concluir cada relatório — primeiro os já iniciados; novos alvos sorteados entre os 80 mais valiosos ainda não observados; nunca do próprio clube nem da base) ou **lista de observação** (divide `3 × ganho` por dia entre os
  jogadores marcados com "Observar"). Ganho diário por jogador observado = `3 + 0,35 × qualidade` pontos de conhecimento (0..100).
- **Estimativa com conhecimento `k`** (revisada na v0.8.7, pedido do usuário): `f = 1 − k/100`; ruído do centro × f; meia-largura da força `12f`
  (±12 sem conhecimento, ex.: 32–56 → valor exato com 100%), do potencial `14f`; o centro do potencial vai do potencial estimado (k = 0) ao potencial
  oculto (k = 100). Atributos: sempre há estimativa (antes, nada abaixo de 25%), meia-largura `5f` (±5 → exato). A faixa sempre contém o valor real.
  Regra 7: o usuário só vê faixas de jogadores de outros clubes; o valor exato aparece só com 100% de observação.
- **Escala de exibição 1–20** (v0.8.7): força, potencial, força na vaga, compatibilidade de função e resumos de atributos aparecem de 1 a 20 (inteiro,
  `shared/scale.ts`, `round(v/5)`), como os atributos; o motor continua calculando em 0–100.
- Processado por `moveClock` todo dia (depois do mercado, antes do fechamento mensal) e no dia da virada.

## Tarefas de busca (reformulação de 07/11/2026; substitui a designação "um país")
Decisões do usuário: critérios checados nos **valores reais**, escopos **país / liga / mundo**, **olheiros contratados** continuam (cada tarefa ativa
ocupa um olheiro). Código: `game/scouting-engine/tasks.ts` (puro) e `scoutRepository.ts`; migração 025 (`scout_tasks`, `scout_task_players`).
- **Tarefa:** escopo + área (país: clubes do país e livres dessa nacionalidade; liga: clubes da liga; mundo: todos, livres inclusive), critérios
  opcionais e duração (1, 2, 3, 6, 9 ou 12 meses, ou contínua). Nome automático ("ATA · Brasil · Força 13+ · Idade ≤27 · +2 filtros"), editável.
- **Critérios** (todos precisam bater): posição principal, "joga também de" (principal ou secundária), força e potencial (1–20; potencial = o oculto,
  real), idade, situação (sem clube / contrato terminando em até 6 meses / com contrato), valor (mi €), salário (mil €/mês), reputação (estrelas),
  condição, moral, pé, mínimos de atributos de linha e de goleiro (1–20) e de estatísticas da temporada atual do país (jogos, minutos, gols,
  assistências, nota média).
- **Regra 7:** os critérios usam os valores reais (é o trabalho do olheiro), mas a tela só mostra estimativas. A prévia dá os compatíveis em **faixa**
  (1–5, 6–10, 11–20, 21–35, 36–50, 51–100, 101–200, 201–500, 501–1.000, 1.001–2.000, mais de 2.000), nunca o número exato.
- **Fila:** até 12 tarefas abertas. Os olheiros livres (os melhores primeiro) assumem as tarefas da fila por ordem de criação; o prazo conta do início.
  Olheiro demitido ou com contrato vencido: a tarefa volta para a fila.
- **Trabalho diário:** cada tarefa acompanha até 5 jogadores compatíveis por vez, com o ganho cheio do olheiro (no mundo × 0,75), começando pelos já
  iniciados; novos alvos sorteados entre os 80 mais valiosos compatíveis; quem já tem 100% entra na lista sem custo (até 300 por tarefa).
  Prazo vencido → concluída (notícia). Com prazo e sem mais compatíveis a observar → conclui antes. Contínua esgotada: procura de novo 7 dias depois
  da última busca vazia (`searched_on`) e, enquanto isso, o olheiro ajuda a lista de observação.
- **E-mails (Caixa de entrada, decisão do usuário: resumo semanal):** 7 dias depois do início da tarefa ou do último resumo, se houver novidade, o
  departamento manda "N jogadores identificados na tarefa ..." (ou "N relatórios concluídos") com a tabela dos jogadores (clube, nacionalidade, posição,
  idade, força e potencial estimados, valor, conhecimento; até 30) e "Abrir scouting". O aviso de conclusão traz a lista (os 30 mais conhecidos).
  A tabela mostra as estimativas do dia em que o usuário abre (`news.players_json` guarda só os ids; migração 026).
- **Janela da tarefa:** cada filtro abre uma caixa de escolha — posições em lista com "Selecionar todas"/"Limpar"; faixas (força, potencial, idade,
  valor, salário, reputação, condição, moral) num controle deslizante de duas pontas; atributos e estatísticas num de uma ponta (mínimo); situação e pé
  em opções. Cancelar/Aplicar; o filtro ativo mostra o valor e reabre ao clicar.
- **Lista de observação:** observada pelos olheiros sem tarefa (ou sem trabalho no dia), como antes (`3 × ganho` dividido pela lista).
- **Cancelar:** ativa/fila → cancelada (a lista fica no histórico); concluída/cancelada → apagada.
- **Migração:** olheiro designado a um país vira tarefa contínua, ativa, sem critérios, no mesmo país (mesmo comportamento de antes).
- **Desempenho:** a busca lê os jogadores em blocos de 500, do mais valioso ao menos, e para ao achar o necessário (80 novos; prévia: 2.001).
  Universo completo (~25 mil jogadores): 4–17 ms por busca no dia a dia; prévia sem critérios no mundo ~115 ms; critério raro sem pré-filtro
  (atributo) no mundo pode ler tudo (~300 ms), no máximo uma vez a cada 7 dias numa tarefa contínua esgotada.

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
