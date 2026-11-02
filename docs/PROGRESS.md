# Progresso

## Fase 1 — Fundação ✅ (verificada pelo usuário no Windows, Node 24)
- `npm install`, `npm test`, `npm run typecheck` e `npm run dev` funcionam; a janela Electron abre e o IPC gera o universo.
- Universo procedural determinístico (idêntico entre Node 22 e Electron), banco com migrações, isolamento universo × carreira.

## Fase 2 — Perfis, treinador e carreiras ✅ (verificada pelo usuário: foto, criação de carreira, painel e elenco funcionando no Electron)

### Funcional e testado (29 testes, `npm test`)
- Perfis locais (`profiles.json`, escrita atômica): nome normalizado, 1–40 caracteres, sem duplicados (sem distinguir maiúsculas), arquivo corrompido nunca é sobrescrito.
- Validação de foto PNG/JPEG por conteúdo (não por extensão): assinatura, CRC de todos os blocos PNG, estrutura/fim do JPEG, 5 MB, 64–4096 px.
  Conferida também contra imagens reais geradas pelo `sharp` (PNG RGB/paleta; JPEG baseline/progressivo/4:4:4).
- Criação de carreira: valida treinador, clube e foto *antes* de tocar o disco; grava em pasta temporária e só renomeia no final;
  qualquer falha remove o temporário (teste confirma que nada sobra). Foto copiada para dentro do save (`coach.png|jpg`).
- Listagem de carreiras por perfil (treinador, clube, data do jogo, temporada, último salvamento, tempo de jogo);
  saves ilegíveis são reportados sem derrubar a lista. Abertura devolve treinador (idade calculada), clube, estádio e elenco reais do banco.
- Segurança: IDs de perfil/carreira validados por UUID (path traversal bloqueado em teste); perfis não enxergam saves uns dos outros.
- Correção: coluna `current_date` (palavra reservada do SQLite) renomeada para `game_date`.

### Escrito, mas NÃO executado (precisa do seu `npm run dev`)
- Handlers IPC (`src/main/main.ts`) com Zod; seleção de foto pelo diálogo nativo (o renderer só recebe um token, nunca o caminho).
- Telas: Início (perfil, Nova/Continuar/Carregar/Sair), Nova carreira (semente → clube → treinador/foto), Carregar carreira, painel com *Visão geral* e *Elenco*.
- Verificação feita aqui: `tsc` sem erros de sintaxe nem de tipos próprios; todo o resto do ruído é de pacotes ausentes neste ambiente.
- `node:sqlite` funciona dentro do Electron 37 (confirmado pelo usuário).

### Pendente (não existe ainda)
- Treinador: licenças, experiência anterior, preferências táticas, idiomas, histórico profissional (§6 do documento).
- Excluir/renomear perfil; excluir carreira; botão de salvar explícito e contagem real do tempo de jogo.
- Importar save, Editor de dados, Configurações (botões desabilitados e identificados).
- Todas as demais seções do painel (Táticas em diante).

### Próximos passos
1. Seu teste da Fase 2 (roteiro abaixo) e retorno de qualquer erro.
2. Fase 3: calendário e competições (pontos corridos, desempates, classificação).
3. Fase 4: motor de partidas com eventos, estatísticas e relatório persistente.

### Roteiro de teste manual da Fase 2
1. `npm install` (se for pasta nova) e `npm run dev`.
2. Criar perfil → tentar nome duplicado e nome vazio (deve mostrar erro em vermelho).
3. Nova carreira → escolher clube → preencher treinador → escolher uma foto PNG/JPEG → Iniciar.
4. Tentar com um arquivo `.txt` renomeado para `.png` (deve ser recusado) e com data de nascimento a partir de 2008 (campo bloqueia).
5. No painel: conferir foto, idade, clube, estádio e a aba Elenco (25 jogadores).
6. Menu principal → Continuar carreira (abre a última) e Carregar carreira (lista com todas).
7. Fechar e reabrir o jogo: perfil e carreiras devem permanecer.

## Fase 3 — Calendário e competições ✅ (verificada pelo usuário: calendário reparado no save antigo, 40 partidas pendentes, zonas coloridas, aviso de ordem provisória)

### Correções do gerador (feitas antes da fase, a partir dos prints do usuário)
- A idade agora afeta a habilidade **atual** (jovens abaixo do auge, veteranos em declínio); potencial real acompanha a margem de crescimento.
- Nomes completos únicos dentro de cada elenco. Saves criados antes dessa correção mantêm os dados antigos.

### Funcional e testado (51 testes no total, `npm test`)
- **Rodadas (método do círculo):** para 2 a 21 times, todos jogam uma vez por rodada (folga se ímpar) e cada mando de cada confronto ocorre exatamente uma vez
  no turno/returno. Com 20 times: 19 jogos em casa e 19 fora por equipe, sem sequências longas de mando. Determinístico por semente.
- **Calendário:** primeira rodada no primeiro sábado em/após 1º/ago, rodadas semanais (configurável por liga via `rules.calendar`).
- **Classificação:** pontos, vitórias, saldo, gols pró e **confronto direto** (mini-tabela reaplicada ao subgrupo empatado), na ordem configurada
  pela liga; empate absoluto resolvido por ID. Testada por propriedade: independe da ordem de entrada, pontos e gols coerentes.
- **Desfecho da temporada** (`seasonOutcome`): campeão, promovidos, rebaixados, vagas continentais — função pronta e testada; ainda **não aplicada** (virada de temporada é pendente).
- **Banco (migração 002):** `competitions` e `fixtures` com restrições (mandante ≠ visitante, placar coerente com o status, sem time duplicado na rodada).
- **Persistência:** a classificação é sempre calculada a partir dos jogos gravados (sem tabela duplicada que possa divergir).
  `recordResult` é o ponto de integração do motor de partidas. Saves da Fase 2 recebem o calendário automaticamente ao abrir (teste cobre).
- **Avanço do tempo:** "1 dia" e "até a próxima rodada"; **nunca passa por cima de partidas não disputadas** (inclusive atrasadas); persiste no save.
  Temporada completa jogada com placares aleatórios nos testes termina consistente.
- Verificação por mutação: 4 defeitos injetados de propósito (bloqueio de atrasadas, pontos de empate, mando do returno, confronto direto) — todos detectados pela suíte
  (um deles só depois de eu adicionar um teste que faltava).

### Escrito, mas NÃO executado (precisa do seu `npm run dev`)
- Telas **Calendário** (jogos do clube, casa/fora, destaque da próxima partida), **Competições** (tabelas de todas as ligas, zonas coloridas, aviso quando não há jogos)
  e os botões **Avançar 1 dia / Avançar até a próxima rodada**; cartões "Próxima partida" e "Classificação" na Visão geral.

### Limitação importante (intencional)
Sem o motor de partidas (Fase 4) **nenhum jogo é disputado**: o avanço para em 01/08/2026 (primeira rodada) e avisa isso. A classificação mostra todos zerados e a tela diz
que a ordem é provisória. Nenhum resultado é inventado.

### Pendente
Copas nacionais, supercopa, competições continentais e MLS (conferências/playoffs); calendário com datas de inscrição e janelas; virada de temporada com promoção/rebaixamento;
quartas-feiras/jogos de meio de semana; tudo das Fases 4 em diante.

### Próximos passos
1. Seu teste da Fase 3 (roteiro abaixo).
2. **Fase 4: motor de partidas** — simulação por eventos, estatísticas, relatório persistente, simulação de todos os jogos do dia e gravação via `recordResult`.

### Roteiro de teste manual da Fase 3
1. Abra o save existente (ele deve ser reparado e ganhar calendário) ou crie uma nova carreira.
2. Visão geral: aparecem "Próxima partida" (01/08/2026) e "Classificação" (sem jogos).
3. Calendário: 38 jogos, alternando Casa/Fora; o primeiro destacado.
4. Competições: troque entre as 4 ligas; confira o aviso de ordem provisória e as cores (Série A: 7 azuis no topo e 4 vermelhos embaixo).
5. "Avançar 1 dia" → 02/07; "Avançar até a próxima rodada" → 01/08 e aviso amarelo; ao tentar avançar de novo, o jogo explica que depende da Fase 4.
6. Feche e reabra: a data deve continuar 01/08/2026.

## Fase 4 — Motor de partidas ✅ (verificada pelo usuário: replay minuto a minuto, estatísticas, notas, escalações, relatório resumido)

Detalhes do modelo, calibração e limitações: `docs/MATCH_ENGINE.md`.

### Funcional e testado (68 testes no total, `npm test`)
- **Motor** (`game/match-engine`): fases de posse minuto a minuto; passes, finalizações (bloqueada, fora, trave, defesa, gol), escanteios, faltas, cartões
  (segundo amarelo, nunca abaixo de 7 jogadores), impedimentos, pênaltis, lesões (com dias de afastamento), substituições da IA, acréscimos,
  prorrogação e disputa de pênaltis, xG, notas dos jogadores e craque do jogo. 7 formações, adequação à posição, fadiga, entrosamento, clima.
- **Calibração** medida em 2.000 partidas (tabela em `docs/MATCH_ENGINE.md`) e travada por testes em faixas largas.
  Ela revelou e corrigiu: gols em excesso, vermelhos 7× acima do normal, mando fraco, goleiro improvisado sem custo e resultados deterministas demais.
- **Invariantes** em 150 partidas: placar = eventos de gol; estatísticas = contagem de eventos; minutos em ordem; quem sai não volta; máximo de 5 substituições.
- **Efeitos causais** testados: time forte vence mais; mando favorece o mandante; mentalidade ofensiva cria e cede mais chances; pressão alta reduz a
  precisão de passe adversária; atacante no gol custa >0,5 gol/jogo; condição física 50% rende menos; entrosamento ajuda.
- **Persistência** (migração 003: `matches`, `player_status`, `club_state`, `player_season_stats`): a rodada é **atômica** (falha em uma partida desfaz todas);
  gera relatório por partida (completo para o clube do usuário, resumido para os demais); atualiza condição física, forma, moral, lesões, suspensões
  (vermelho = 1 ou 2 jogos; 5 amarelos = 1 jogo), entrosamento e estatísticas por jogador/competição.
- Comentários nascem dos eventos (um por evento; todo gol cita o autor e o placar); recuperação física diária (+6/dia).
- Temporada inteira simulada nos testes: lesionados e suspensos nunca são escalados (exceto goleiro de emergência quando **todos** estão indisponíveis).
- Mutação: 4 defeitos injetados (sem transação, suspensos escalados, lesionados escalados, vermelho sem suspensão) — todos detectados.

### Verificado pelo usuário
- Botões **Simular rodada** e **Acompanhar minuto a minuto** (replay dos eventos com pausa, velocidade 1×/4× e "ir para o fim"), painel de resultados da rodada,
  seção **Partidas** (meus jogos e resultados por rodada) e **relatório** (resumo com barras de estatísticas, comentários, notas dos jogadores, escalações no campo).

### Pendente
Edição de táticas e escalação pelo usuário (e mudanças durante o jogo), treino, finanças, transferências (receitas/despesas recorrentes), olheiros, base,
artilharia na tela (dados já gravados em `player_season_stats`), copas/mata-mata no calendário (o motor já suporta prorrogação e pênaltis),
virada de temporada, demais seções do painel.

### Próximos passos
1. Seu teste da Fase 4 (roteiro abaixo).
2. Fase 5: táticas e escalação do usuário (criar/salvar/duplicar/editar formações, funções, organização com e sem bola) usando o motor atual.

### Roteiro de teste manual da Fase 4
1. Abra o save, clique em "Avançar até a próxima rodada" (01/08/2026): os botões viram **Simular rodada (40)** e **Acompanhar minuto a minuto**.
2. "Acompanhar minuto a minuto": o placar anda conforme os lances; teste Pausar, 4×, "Ir para o fim"; depois veja Resumo, Jogadores e Escalações.
3. Volte à Visão geral: **Resultados da rodada** com 40 jogos e botão de relatório; Competições agora mostra pontos e a posição do seu clube.
4. Avance mais rodadas (simular → avançar). Em Elenco, a condição física de quem jogou cai e se recupera nos dias seguintes.
5. Em Partidas, navegue pelas rodadas de outras ligas e abra relatórios (jogos de outros clubes são "resumidos").
6. Feche e reabra o jogo: resultados e datas persistem.

### Correções da Fase 4 após a verificação (v0.4.1)
- Colisão de CSS (`.bar` definida duas vezes) cortava os cabeçalhos do painel em todas as telas; renomeado para `.sbar` e criado teste que impede classes duplicadas.
- Comentário de gol agora começa com maiúscula e tem 4 variações por tipo de jogada; o relatório aberto fecha ao avançar o tempo.
- Observação: nomes repetidos no mesmo elenco (ex.: dois "Diego Moreira") aparecem só em saves criados **antes** da correção do gerador; carreiras novas não têm.

## Fase 5 — Táticas e escalação do usuário ✅ (verificada pelo usuário: esquemas, editor, escalação manual, campo)

### Funcional e testado (78 testes no total, `npm test`)
- **Esquemas táticos** (migração 004): 7 padrão (4-4-2, 4-3-3, 4-2-3-1, 3-5-2, 3-4-3, 5-3-2, 4-1-4-1) com a tática da metodologia do treinador; o esquema ativo inicial segue a
  metodologia (defensivo → 5-3-2, posse → 4-3-3, agressivo → 4-2-3-1). Criar, editar, **duplicar**, excluir e **ativar**. Padrões não são editáveis nem excluíveis (só duplicáveis).
  Excluir o esquema ativo volta ao padrão da metodologia. Saves antigos recebem os esquemas ao abrir.
- **Validações:** nome (1–40, caracteres seguros, único sem distinguir maiúsculas **inclusive acentuadas** — o `NOCASE` do SQLite só dobra ASCII, bug pego pelo teste), formação existente,
  controles 1–5 inteiros, escalação com 11 jogadores distintos **do seu clube**.
- **Escalação:** automática (melhor time disponível a cada jogo) ou manual, posição por posição, com rendimento do jogador em cada função e aviso de fora de posição.
- **Integração com o motor:** a partida usa a formação, a escalação e a tática do esquema ativo. Se um titular escolhido estiver lesionado/suspenso, é substituído pelo melhor
  disponível para a vaga e você recebe o aviso ("Escalação ajustada: X (lesionado) foi substituído por Y como CB"). O relatório da partida guarda as táticas dos dois lados.
- Mutação: 4 defeitos injetados (editar padrão, aceitar jogador de outro clube, ignorar escalação manual, ignorar tática) — todos detectados.

### Verificado pelo usuário
- Aba **Táticas**: lista de esquemas (Ativar/Duplicar/Excluir/Novo), editor (nome, formação, mentalidade, saída de bola, ritmo, amplitude, linha defensiva, pressão),
  escalação automática ou manual com seletores por posição, campo com a escalação, e a seção "Táticas" no resumo do relatório da partida.

### Pendente
Transições defensiva/ofensiva, marcação, cruzamentos, liberdade criativa, funções individuais, bola parada, instruções durante a partida e substituições do usuário
(o motor ainda não tem esses parâmetros — a tela avisa isso). Treino, finanças, transferências, olheiros, base, etc.

### Próximos passos
1. Seu teste da Fase 5 (roteiro abaixo).
2. Fase 6: finanças (receitas e despesas recorrentes, salários, bilheteria, patrocínios) e economia do clube.

### Roteiro de teste manual da Fase 5
1. Confira que os cabeçalhos das telas voltaram ao normal (correção do CSS).
2. Aba **Táticas**: veja os 7 esquemas padrão; o ativo vem marcado. Selecione um padrão: os campos ficam travados.
3. **Duplicar** um padrão, mude formação e controles, desmarque "Automática", troque jogadores nas posições (um jogador já escalado troca de lugar com o outro) e **Salvar**; depois **Ativar**.
4. Tente salvar com nome repetido (ex.: "4-3-3 (PADRÃO)") e nome vazio: deve aparecer erro em vermelho.
5. Simule uma rodada e confira em Partidas → relatório → Escalações que a formação e os jogadores são os escolhidos, e em Resumo a seção Táticas.
6. Se um titular se lesionar/for expulso, na rodada seguinte aparece o aviso de escalação ajustada.

### Acabamentos após a verificação da Fase 5 (v0.5.1)
- Rótulos do campo agora mostram inicial + sobrenome ("C. Harris"), pois havia sobrenomes repetidos; controles deslizantes alinhados.

## Fase 6 — Finanças ✅ (verificada pelo usuário: caixa, gráfico, último mês, patrocínios, bilheteria e extrato)

Detalhes do modelo, calibração e limitações: `docs/FINANCE.md`.

### Funcional e testado (88 testes no total, `npm test`)
- **Fórmulas puras** (`game/finance-engine`): TV, patrocínios, produtos oficiais, comissão técnica, estádio, administração, preço do ingresso e público (≤ capacidade; sobe com reputação
  e atração do adversário; cai com chuva/calor/frio; determinístico por semente).
- **Calibração** medida em 320 clubes: margem mediana +2%, 46% no vermelho, 2ª divisão em equilíbrio (a 1ª tentativa deixava a 2ª em −22% e foi corrigida).
- **Contabilidade:** porta única de lançamentos; para **todos** os clubes `saldo = saldo inicial + lançamentos`, inclusive após uma temporada simulada inteira (4 ligas, ~224 jogos).
- **Cobrança mensal exatamente uma vez** — avançando de dia em dia, em saltos de rodada ou de vários meses (resultado idêntico). Salários = soma real dos contratos.
- **Patrocínios:** 3 contratos por clube, vencimentos escalonados, renovação automática sem lacunas por 4+ anos (contratos do mesmo tipo nunca se sobrepõem).
- **Bilheteria:** por jogo em casa, só o mandante recebe; público e renda no relatório da partida; extrato detalhado só do clube do usuário.
- **Saves antigos:** não são cobrados retroativamente; recebem patrocínios e começam a cobrança no mês seguinte.
- Mutação: 5 defeitos injetados (mês cobrado de novo, lançamento sem saldo, bilheteria não lançada, salário com sinal trocado, extrato vazando clubes da IA) — todos detectados.

### Verificado pelo usuário
- Aba **Finanças**: caixa, projeção mensal, gráfico de receitas × despesas (SVG), último mês por categoria, patrocínios vigentes, bilheteria dos últimos jogos e extrato;
  público e renda no resumo do relatório da partida.

### Pendente
Premiações, transferências com taxas, empréstimos, consequências de saldo negativo, negociação de patrocínio e de ingressos, comissão técnica individual, fair play financeiro.

### Próximos passos
1. Seu teste da Fase 6 (roteiro abaixo).
2. Fase 7: **transferências** (mercado, propostas, negociação de contratos, janela de inscrição) — fecha o item "ao menos uma transferência funcional" do MVP e liga o dinheiro das finanças.

### Roteiro de teste manual da Fase 6
1. Abra o save: aba **Finanças** deve mostrar o caixa, 3 patrocínios e "nenhum mês liquidado" (saves antigos não são cobrados retroativamente).
2. Simule rodadas até passar do dia 1 do mês seguinte (ex.: de 29/08 para 05/09): aparece a barra do mês no gráfico e o **Último mês** com TV, patrocínios, folha etc.
3. Em jogos em casa: **Bilheteria** lista público/ocupação/renda e o **Extrato** mostra a linha "Bilheteria vs …". Em jogos fora não entra renda.
4. Abra o relatório de um jogo em casa: Resumo mostra Público e Renda.
5. Confira que o saldo da Visão geral = Caixa da aba Finanças, e que a projeção mensal faz sentido com a folha de salários.

### Melhorias após a verificação da Fase 6 (v0.6.1) — 91 testes
- **Gráfico interativo:** passar o cursor (ou focar com Tab) sobre uma barra mostra um tooltip com a **composição** daquela barra — categoria, valor e % do total, mais o resultado do mês.
  A composição é uma função pura (`shared/financeChart.ts`) testada: soma = total da barra, ordenada do maior para o menor, receitas e despesas separadas.
- **Projeção mensal agora inclui a bilheteria** (antes ela era omitida, o que exagerava o prejuízo mostrado e o "caixa cobre N meses"): média dos últimos jogos em casa
  (≥ 3 jogos) ou estimativa pela fórmula, distribuída por 12 meses. A tela indica se é estimada.
- **Mês parcial:** em saves anteriores às finanças, o mês corrente só tem bilheteria (a folha nunca foi cobrada). A barra recebe `*` e o tooltip explica.
- Mutação: 4 defeitos nos recursos novos; um (projeção ignorando a bilheteria) sobreviveu até eu fortalecer o teste — agora todos são detectados.

### Roteiro de teste manual (v0.6.1)
1. Finanças → passe o cursor sobre as barras verde e vermelha de um mês: o tooltip lista as categorias com valor e %.
2. Use Tab para focar as barras: o mesmo tooltip aparece.
3. Barra de 08/26 com `*`: o tooltip avisa que é mês parcial.
4. A "Projeção mensal" agora mostra uma linha de bilheteria média; o resultado e o "caixa cobre N meses" mudam em relação à versão anterior.

## Fase 7 — Transferências (estado: regras, persistência e integração testadas; tela AINDA NÃO verificada no Electron)

Regras completas, fórmulas e limitações: `docs/TRANSFERS.md`.

### Funcional e testado (102 testes no total, `npm test`)
- **Janelas de transferência** (verão e inverno) aplicadas à negociação, às propostas recebidas e ao mercado da IA.
- **Mercado** com busca por posição/idade/valor/nome (parametrizada); mostra **estimativas com margem de erro**, nunca os atributos reais; exclui o seu clube; ordenado por valor.
- **Negociação em duas etapas** (clube e jogador) com recusa, contraproposta e aceite; transferência atômica (jogador, contrato, histórico, finanças). Validações: janela, valores, jogador próprio,
  elenco máximo (30), caixa e elenco do vendedor.
- **Vendas:** lista de transferíveis, propostas recebidas (aceitar, recusar, expirar em 7 dias), proteção do elenco mínimo e da janela.
- **Mercado da IA:** determinístico, só dentro das janelas, mantém todos os elencos entre 20 e 30 jogadores e equilibrados, sem tocar no clube do usuário.
- **Contabilidade:** `saldo = saldo inicial + lançamentos` continua valendo para todos os clubes; saltar até a rodada = avançar dia a dia.
- Integração: jogador vendido que estava na escalação manual é substituído e o jogo avisa.
- Mutação: 6 defeitos injetados (janela ignorada, taxa não lançada, elenco mínimo sem proteção, compra do próprio jogador, estimativa vazando o valor real, IA negociando com a janela fechada) — todos detectados.

### Descobertas durante a fase
- Pular vários dias e avançar dia a dia davam resultados diferentes (a cobrança do mês usava a folha antes do mercado dos dias intermediários); o processamento agora é dia a dia em ordem fixa.
- Listar um jogador não atraía propostas se ele não fosse dos 12 mais valiosos; e filtros de reputação/caixa dos compradores estavam apertados demais.

### Escrito, mas NÃO executado (precisa do seu `npm run dev`)
- Aba **Transferências**: faixa com a janela/caixa/elenco, Mercado (filtros, tabela com estimativas, painel de proposta com contraproposta aceitável em um clique), Propostas recebidas,
  Meus jogadores (marcar transferível) e Histórico.

### Pendente
Jogadores livres e renovação de contrato, rescisões, empréstimos, cláusulas, agentes, regras de inscrição e estrangeiros, rede de olheiros (Fase 8), negociação com tempo de resposta, transferências em mata-mata/copas.

### Próximos passos
1. Seu teste da Fase 7 (roteiro abaixo).
2. Fase 8: **olheiros e categorias de base** (relatórios com incerteza, estimativas que melhoram, desenvolvimento de jovens).

### Roteiro de teste manual da Fase 7
1. **Crie uma carreira nova** (começa em 01/07, janela de verão aberta). Em saves antigos a janela só reabre em 01/01/2027.
2. Transferências → Mercado: filtre por posição e "valor máx." menor que o seu caixa; clique em **Negociar**. Teste uma taxa baixa (recusa), uma intermediária (contraproposta do clube) e um salário baixo (contraproposta do jogador).
3. Conclua uma compra: o jogador entra no Elenco, o Caixa cai, o Extrato (Finanças) mostra "Compra de …" e o Histórico registra.
4. Em **Meus jogadores**, marque 2–3 jogadores como transferíveis, avance alguns dias e veja **Propostas recebidas**; aceite uma (caixa sobe) e recuse outra.
5. Avance até 01/09: a janela fecha e o botão **Negociar** é desabilitado; o Histórico mostra negócios entre outros clubes feitos durante o verão.
6. Se vender um titular da escalação manual, na próxima rodada aparece o aviso "Escalação ajustada".

## SNAPSHOT DE MIGRAÇÃO PARA O CLAUDE CODE (v0.7.1)
- Base: pacote da Fase 7 + correções v0.7.1 reaplicadas. `npm test`: **103 testes passando** (102 + 1 novo); `typecheck:core` limpo. Mutação do novo teste detectada.
- v0.7.1: potencial estimado nunca abaixo da força (gerador e exibição de saves antigos); aviso da tela limpo ao trocar de aba; rótulos de taxa/salário na negociação esclarecidos.
- **Não executado nesta sessão:** `npm install`/`npm run typecheck` completo (rede bloqueada), `npm run dev`, qualquer tela no Electron, build Windows.
- **Perdido:** o trabalho parcial da 8A (ver `docs/PHASE_8A_PLAN.md`) — refazer.
- **Ausente:** a especificação original do usuário não está no zip; colocar em `docs/SPEC.md`.
- Testes manuais pendentes do usuário: tooltip do gráfico (v0.6.1), tela de Transferências (Fase 7), v0.7.1.
