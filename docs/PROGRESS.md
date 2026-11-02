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

## Fase 8A — Ciclo de carreira (estado: regras, persistência e integração testadas; telas AINDA NÃO verificadas no Electron)

Regras, fórmulas e calibração: `docs/CAREER_CYCLE.md`.

### Funcional e testado (119 testes no total, `npm test`; `npm run typecheck` e `typecheck:core` limpos)
- **Virada de temporada** como ação do usuário em 1º/jul, atômica, na ordem do plano: resultados → promoção/rebaixamento por país → prêmios → aposentadorias →
  contratos → desenvolvimento → jovens da base → reposição dos elencos da IA → zera suspensões/amarelos → temporada + 1 → calendário novo → mercado e cobrança do dia.
- **Relógio:** `moveClock` é o único ponto que move a data; depois da última rodada o jogo avança até 1º/jul (maio e junho continuam sendo cobrados) e para.
- **Prêmios** pela porta única de dinheiro (`makePoster`, categoria `prize`): `saldo = saldo inicial + lançamentos` vale para todos os clubes depois de uma e de duas viradas.
- **Desenvolvimento** anual: cresce até o potencial (nunca acima antes dos 28), estável no auge, declínio a partir dos 30; snapshot em `player_development`.
- **Contratos:** todo contrato novo termina em 30/jun; a IA renova (90%/55%) ou libera; o usuário perde quem não renovou; **renovação** com contraproposta e limite de temporadas por idade.
- **Jogadores livres:** mercado com filtro, contratação sem taxa e fora da janela; a IA contrata livres para cobrir carências. Aposentados nunca aparecem.
- **Notícias, histórico da carreira e sala de troféus** (histórico derivado das partidas; `season_results` guarda só o que a virada aplicou).
- **Correção encontrada no caminho:** a tabela de uma competição pegava os times pela liga *atual* do clube — depois de um acesso/rebaixamento as tabelas de temporadas
  passadas ficariam erradas. Agora os participantes vêm das partidas da competição (testado).
- Mutação: **14 defeitos injetados**, todos detectados — prêmio fora do `makePoster`, teto de potencial ignorado, rebaixar os primeiros, renovação automática do usuário,
  dia da virada processado pelo relógio, tabela antiga pela liga atual, suspensões não zeradas, aposentados no mercado, livre com taxa, renovação contada da temporada,
  aleatoriedade sem semente nos jovens, avanço passando da virada, IA renovando com inflação salarial, aposentado continuando no clube.

### Descobertas durante a fase (simulação de 5 viradas no universo completo)
- No primeiro desenho a qualidade média caía ~1 ponto por temporada (jovens reservas cresciam devagar e a base entrava rápido demais) e os livres passavam de 500.
  Recalibrado: minutos pesam menos no crescimento, a IA promove 1–3 jovens só até 26 no elenco, livres abandonam a carreira com mais frequência. Agora qualidade, idade e número de livres ficam estáveis.
- Renovações da IA com piso de +8% inflavam as folhas (margem mediana de +1% para −9% em 5 temporadas). A IA passou a renovar pelo valor atual (máx. +10%).
- O `typecheck` completo rodou pela primeira vez (havia rede para o `npm install`): dois erros de tipo **pré-existentes** em testes antigos foram corrigidos
  (`computeStandings` agora aceita critérios `readonly`; índice possivelmente indefinido em `photo.test.ts`).
- Testes antigos que jogavam "até o fim da temporada" passaram a parar quando não há mais partidas (antes do novo avanço até 1º/jul); as asserções originais foram mantidas.

### Decisão pendente (do usuário)
- **Prêmios × calibração financeira:** os valores do plano (campeão = economia × 2,4 mi) elevam a margem anual mediana em +2 a +4 p.p. (≈ +3,5% → +7%), acima da âncora
  de ~+2%. Opções: manter, reduzir o multiplicador ou compensar nos custos. Nada foi alterado sem a sua decisão.

### Escrito, mas NÃO executado (precisa do seu `npm run dev`)
- Abas **Temporada** (status, contratos que vencem, confirmação e relatório da virada), **Contratos** (renovação), **Notícias**, **Histórico da carreira** e **Sala de troféus**;
  botão "Iniciar nova temporada" e aviso de fim de temporada no cabeçalho; mercado com jogadores livres (filtro, taxa travada em 0, negociação com a janela fechada).
- `npm run build:renderer` e `npm run build:electron` compilam; a interface em si não foi aberta.
- `scripts/dev.mjs` agora remove `ELECTRON_RUN_AS_NODE` do ambiente do Electron (herdada de terminais de extensões do VS Code, faz o Electron abrir como Node puro, sem janela).

### Pendente
Copas e competições continentais (Fase 9), artilharia/prêmios individuais, rescisões e empréstimos, treino individual (8C), olheiros e gestão da base (8B), mudança de clube do treinador (8D).

### Próximos passos
1. Seu teste da Fase 7 (Transferências) e da 8A (roteiro abaixo).
2. Fase 8B: olheiros e categorias de base.

### Roteiro de teste manual da Fase 8A
O caminho mais rápido é uma **carreira nova**; para chegar ao fim da temporada use "Simular rodada" + "Avançar até a próxima rodada" repetidamente (38 rodadas).
1. **Contratos:** antes do fim da temporada, abra a aba Contratos. Os que vencem em 01/07 aparecem destacados. Renove um (salário baixo → recusa; intermediário → contraproposta → aceitar).
   Tente 5 temporadas com um veterano de 33+ (deve recusar pela duração). A renovação aparece em Notícias.
2. Depois da última rodada, o cabeçalho mostra "Avançar até 01/07/2027 (nova temporada)" e o aviso de fim de temporada. Avance: Finanças mostra maio e junho cobrados.
3. Em 01/07 o botão vira **Iniciar nova temporada** → aba Temporada → Confirmar virada. O relatório mostra posição, prêmio, campeões, acessos/rebaixamentos, jovens e quem saiu.
4. Confira: Finanças tem "Premiação" no extrato; Competições mostra a temporada nova (e o clube na divisão certa, se subiu/caiu); Elenco tem os jovens e não tem quem não foi renovado.
5. Transferências → marque "Só jogadores livres" → Buscar. Negocie um livre (taxa travada em 0). Depois de 01/09 (janela fechada) o botão Negociar continua ativo só para livres.
6. Histórico da carreira e Sala de troféus mostram a temporada encerrada; Notícias lista os eventos da virada.

### Verificado pelo usuário (prints de 02/11/2026)
- Contratos (lista, destaque dos que vencem, renovação, botão desativado com mais de 24 meses), virada completa (relatório, prêmio de 758.000 pelo 11º lugar,
  campeões, acessos/rebaixamentos, jovens, saídas por fim de contrato), Notícias, Histórico da carreira e Sala de troféus.

### Correções após a verificação (8A.1)
- Jovens da base saíam com **15 anos** (nascimento sorteado no ano todo); agora a idade forçada é exata (16–17 na virada). Mutação detectada por 2 testes.
- Aba Temporada dizia "faltam 1520 partidas no país" (era a soma das 4 ligas); agora mostra os jogos restantes do seu clube e o total de todas as ligas.
- Com a temporada nova ainda sem jogos, a aba Temporada e o Histórico mostravam uma posição sem sentido (10º de 20) e a premiação "se terminasse agora"; agora mostram que a liga não começou / "—".

### Verificação do usuário (2ª rodada) e ajustes
- **Verificado:** mercado de jogadores livres (filtro, taxa travada em 0, contratação de Sam Ward por 4 anos → contrato até 30/06/2031, salário pela contraproposta).
- **Prêmios × margem financeira:** o usuário decidiu manter os valores atuais por enquanto (rever na fase de lapidação, se necessário).
- **Renovação do Murilo Cardoso gravada até 30/06/2032 sem o usuário mudar "temporadas" (2):** o servidor foi reexecutado numa cópia do save e calcula certo
  (2 temporadas a partir de 01/07/2028 → 30/06/2030); o código da tela envia o valor do seletor. Causa não confirmada — hipótese: a roda do mouse trocou o valor do
  seletor com foco. Mitigação: o painel agora mostra **"Novo contrato até …"** (calculado com `renewBaseYear` vindo do servidor) antes de propor; teste garante que a data exibida = a gravada.
  Se voltar a acontecer com a data exibida correta, é bug e deve ser reaberto.
- **Causa provável confirmada pelo padrão (3ª rodada):** Davi Ribeiro também foi gravado com 5 temporadas (até 30/06/2033); Gabriel Freitas, com a data visível, saiu certo (2 → 30/06/2030).
  Os dois erros caíram exatamente na última opção do seletor — o efeito da roda do mouse sobre um `<select>` com foco no Windows. O seletor de temporadas foi trocado por
  **botões 1–5** (`YearsPicker`) em Contratos e Transferências; em Contratos, opções acima do máximo aceito pela idade ficam desativadas. Ainda não verificado no Electron.
  Os contratos já gravados (Murilo até 2032, Davi até 2033) não foram alterados no save.

## Fase 8B — Olheiros e categorias de base (estado: regras, persistência e integração testadas; telas AINDA NÃO verificadas no Electron)

Decisões do usuário: olheiros contratáveis; elenco sub-20 separado; peneira em março. Regras e calibração: `docs/SCOUTING_YOUTH.md`.

### Funcional e testado (127 testes no total; `typecheck` completo limpo; builds do renderer e do Electron ok)
- **Olheiros:** candidatos mensais, contratação (até 4), salário mensal e multa de demissão pela porta única de dinheiro, contrato de 2 anos; designação a um país ou à
  lista de observação; conhecimento diário que estreita as faixas do mercado (idênticas às de antes quando o conhecimento é 0) e leva o potencial estimado ao real.
- **Categorias de base:** academias em todos os clubes, fora do elenco/mercado/propostas, salários na categoria `youth`; peneira em 15/mar (uma vez por temporada);
  promover (limite de 30) e dispensar; na virada a IA promove os prontos, jovens de 19 saem, carências do elenco são cobertas primeiro pela base.
- Saves antigos: a migração 008 foi aplicada numa **cópia** do save do usuário (esquema 7 → 8): 8 notícias preservadas, base criada, candidatos disponíveis.
- Mutação: **13 defeitos injetados, todos detectados**. Dois sobreviveram na primeira rodada e revelaram testes fracos (olheiro designado a país diferente do
  usuário; peneira nunca chamada duas vezes) — testes reforçados, ambos detectados depois.

### Descobertas durante a fase (simulação de 5 viradas)
- A primeira versão inflava força (+2,5) e salários e derrubava a margem mediana para −12,6%. Causas e correções: livres carregavam o salário antigo como piso
  (agora pretensão pelo valor); a IA contratava livres caros (agora cabe na folha); a base formava jogadores no nível do clube e a seleção empurrava a média para cima
  (agora o formado típico fica ~5 pontos abaixo; os raros viram titulares); a IA promovia pouco e completava elencos com livres (agora promove também para completar).
- A métrica "força média do elenco" da 8A era puxada para baixo pelos jovens de 16–17 que entravam direto; passou-se a acompanhar a média dos 14 melhores e a folha.

### Escrito, mas NÃO executado (precisa do seu `npm run dev`)
- Aba **Olheiros** (custo, olheiros com botões de designação, candidatos, lista de observação, relatórios com barra de conhecimento) e aba **Categorias de base**
  (jovens com promover/dispensar com confirmação, aviso dos que saem aos 19, próxima peneira); coluna **Olheiros** e botão **Observar** no mercado; relatório da virada
  com "deixaram a base"; notícias do tipo Comissão.

### Pendente
Treino individual, comissão técnica, departamento médico e investimento em instalações (8C, inclusive nível da base); empréstimo de jovens; olheiros da IA.

### Roteiro de teste manual da Fase 8B (pode usar o save atual: a migração cria as bases ao abrir)
1. **Categorias de base:** veja os 6–8 jovens; promova um (ele aparece em Elenco e Contratos); dispense outro (confirmação; ele aparece em Transferências → Só jogadores livres).
2. **Olheiros:** contrate um candidato; designe-o para a "Lista de observação". Em Transferências → Mercado, clique **Observar** em 2–3 jogadores. Avance alguns dias:
   a coluna Olheiros sobe até 100% e as faixas de força/potencial ficam estreitas. Designe outro olheiro para um país e confira os Relatórios depois de algumas semanas.
3. Finanças: no dia 1º aparecem "Olheiros" e "Categorias de base (salários)"; demitir um olheiro lança a multa no extrato.
4. Avance até 15/03: notícia "Peneira" e novos jovens de 15–16 anos na base. Na virada (01/07), quem tem 19 anos e não foi promovido sai (relatório e notícias).

### Verificado pelo usuário (prints de 02/11/2026)
- Olheiros (contratar, designar por botões), Categorias de base (promover 3, dispensar 2 com confirmação, aviso dos que saem aos 19), peneira de 15/03/2028
  (6 jovens, próxima em 2029), virada 2028 com "Deixaram a base", elenco com os promovidos.

### Correção após a verificação (8B.1)
- **Olheiro de país espalhava o esforço demais:** no save do usuário, após uma temporada com 2 olheiros em países, 1.655 jogadores observados, só 7 acima de 50% e
  nenhum completo (Relatórios vazios). Agora acompanha 5 jogadores até 100% (os iniciados primeiro; novos sorteados entre os mais valiosos). Numa cópia do save:
  30 dias → 31 relatórios completos. Teste reforçado (detecta o comportamento antigo).

### Verificado pelo usuário e correção 8B.2 — ficha do jogador
- **Verificado:** lista de observação (3 jogadores chegaram a 100% e as faixas estreitaram) e Relatórios cheios depois do ajuste 8B.1.
- **Problema apontado pelo usuário:** observar era inútil — não havia como ver o jogador (atributos) nem contratá-lo a partir dos olheiros.
- **Corrigido:** **ficha do jogador** (clique no nome no mercado, na proposta e nas listas de olheiros): dados públicos, estatísticas da temporada, força/potencial
  estimados, **atributos estimados** (a partir de 25% de conhecimento; faixas de ±3 a ±1 que sempre contêm o real e nunca o revelam exatamente — regra 7) e
  **parecer do olheiro** (melhor do elenco / briga por vaga de titular / reforço para o banco / não melhora; destaca promessas e relatórios pouco precisos).
  Botões **Negociar** (abre a proposta em Transferências; o servidor diz se a janela permite) e Observar na ficha; **Negociar** também nas listas de olheiros.
  Jogadores do próprio clube mostram os valores reais na ficha. 130 testes; 6 mutações novas, todas detectadas. Tela ainda não verificada no Electron.
- **Verificado pelo usuário:** ficha abre ao clicar no jogador (Declan Wright e Otávio Costa a 100%: atributos em faixas de ±1, parecer "seria o melhor do elenco"),
  Negociar abre a proposta (caixa insuficiente avisada corretamente) e a compra de Otávio Souza foi concluída a partir do fluxo de olheiros.
  Ajuste visual: nome do jogador no título da proposta agora usa o tamanho do título.

## Fase 8C — Treino, comissão técnica, departamento médico e infraestrutura (estado: regras, persistência e integração testadas; telas AINDA NÃO verificadas no Electron)

Decisões do usuário: foco + evolução mensal, com opção de **delegar a rotina ao preparador físico** (contratável), que escolhe o melhor treino de cada jogador;
profissionais contratáveis; obras com custo e prazo; prevenção + recuperação. Regras e calibração: `docs/TRAINING_STAFF.md`.

### Funcional e testado (139 testes; `typecheck` completo limpo; builds do renderer e do Electron ok)
- **Evolução mensal** (dia 1º) para todos os jogadores, com intensidade, foco individual, comissão técnica e instalações; a virada só registra o saldo da temporada.
- **Rotina do técnico ou do preparador:** intensidade (leve/normal/forte) e foco por jogador; delegar exige preparador físico, que aplica o melhor foco e ajusta a
  intensidade às segundas; sem preparador, o controle volta ao técnico.
- **Comissão técnica:** 4 funções, 3 candidatos por função por mês, um por função, salário (`coaching`) e multa pela porta única de dinheiro, contrato de 2 anos.
- **Departamento médico:** lesões de treino (cansaço, intensidade, preparador), duração de lesões de treino **e de jogo** ajustada por médico e departamento,
  volta sem ritmo (condição ≤ 60%), tela de lesionados e de jogadores em risco.
- **Infraestrutura:** obras de +1 nível pagas à vista (`infrastructure`), uma por vez, com prazo; ao concluir a manutenção sobe e o estádio ganha 5% de lugares.
- Migração 009 aplicada numa **cópia** do save do usuário (esquema 8 → 9): telas novas carregam com os dados do save.
- Mutação: **16 defeitos injetados, todos detectados**.

### Descobertas durante a fase
- **Foco desequilibrado:** com ×1,6/×0,85 a força crescia 42% mais rápido quando o foco coincidia com a posição (o preparador delegado sempre escolhe um foco
  relevante: vantagem enorme sobre a IA). Ajustado para ×1,35/×0,9 (pontos conservados; ganho efetivo ~15–20%).
- **Ordem da virada:** a evolução de 1º/jul rodava depois de reiniciar a referência da temporada (o saldo ficaria errado); agora roda no começo da virada.
- Testes antigos ajustados à mecânica nova: lesões de treino limitam a condição (o teste "quem não jogou segue descansado" exclui lesionados) e a recuperação do
  clube do usuário depende da intensidade e do preparador; o fixo `staff` do usuário passou a ser só a estrutura.
- Soak de 5 viradas: força, folhas e margem estáveis (tabela no documento da fase).

### Escrito, mas NÃO executado (precisa do seu `npm run dev`)
- Abas **Comissão técnica** (função, efeito, contratado ou candidatos, demitir), **Treinamento** (quem decide, intensidade, foco por jogador, sugestão do preparador,
  evolução na temporada), **Departamento médico** (médico, nível, lesionados, em risco) e **Infraestrutura** (níveis, efeitos atual/próximo, custo, prazo,
  manutenção extra, confirmação, barra de progresso da obra). Nomes clicáveis abrem a ficha do jogador.

### Roteiro de teste manual da Fase 8C (pode usar o save atual)
1. **Comissão técnica:** contrate um preparador físico e um médico; confira o custo mensal. Demita um (multa no extrato de Finanças).
2. **Treinamento:** com "Eu (técnico)", mude a intensidade e o foco de alguns jogadores. Depois clique "Preparador físico": os focos passam a ser os sugeridos e ficam travados.
3. Avance até o dia 1º do mês seguinte: a coluna "Na temporada" muda (evolução mensal). Finanças mostra "Comissão técnica (salários)".
4. **Departamento médico:** acompanhe lesionados e previsão de retorno ao longo de algumas semanas; jogadores abaixo de 70% aparecem "Em risco".
5. **Infraestrutura:** encomende uma obra (confirmação; o caixa cai na hora); a barra de progresso avança; ao terminar, o nível sobe e chega a notícia.

### Verificado pelo usuário (prints de 02/11/2026)
- Departamento médico (médico 17/20, nível 13, tempo de lesão −7%, lesionado com previsão de retorno), Treinamento como técnico e delegado ao preparador (focos
  aplicados, intensidade escolhida pelo preparador: forte na entressafra), evolução mensal na coluna "Na temporada", virada 2029 com promoção da base por carência.

### Correções após a verificação (8C.1)
- Com o treino delegado, jogadores que entraram no elenco depois da última revisão (ex.: os 3 zagueiros promovidos às pressas na virada) apareciam com foco
  "Equilibrado"; agora o foco efetivo é sempre o do preparador.
- Zagueiros recebiam a sugestão "Finalização" (cabeceio e compostura contam para eles); os focos sugeridos agora dependem do setor
  (defensores: defesa/físico/criação; meias: criação/defesa/técnica/físico; atacantes: finalização/técnica/físico/criação). Ambas com teste e mutação detectada.

## Fase 8D — Diretoria, objetivos e propostas de emprego (estado: regras, persistência e integração testadas; telas AINDA NÃO verificadas no Electron)

Decisões do usuário: objetivos de liga + finanças + base; demissão com a carreira continuando; propostas a qualquer momento com troca imediata; orçamentos de
transferência e folha **e autonomia da diretoria para barrar negociações caras demais para o clube**. Regras: `docs/BOARD_JOBS.md`.

### Funcional e testado (147 testes; `typecheck` completo limpo; builds do renderer e do Electron ok)
- **Objetivos** pela posição esperada (título, top 4, vaga continental, metade de cima, evitar rebaixamento; acesso / brigar pelo acesso na 2ª divisão) e secundários
  (caixa no azul, promover jovens). **Confiança** por partida e pelo fechamento do mês; aviso abaixo de 25; demissão em 10 (após 6 jogos); **avaliação na virada** com
  reflexo na reputação do treinador.
- **Orçamentos** de transferência e teto da folha; **veto** dos termos finais (orçamento, teto, taxa > 2× o valor, salário > 2,2× o justo) em compras, livres e renovações;
  aprovação de obras grandes; pedidos de aumento (um por tipo por temporada, confiança 65+).
- **Empregos:** vagas na IA (clubes muito abaixo do esperado, rebaixados, o clube deixado), propostas conforme a reputação, troca de clube imediata, demissão com a carreira
  continuando **sem clube** (calendário, partidas e virada seguem; telas de clube bloqueadas), propostas de reserva para o desempregado.
- Migração 010 (recria `career` com clube anulável) aplicada numa **cópia** do save do usuário pela camada de serviços: diretoria criada; demissão simulada; abertura sem clube;
  transferências bloqueadas com mensagem; tabela e avanço funcionando.
- Mutação: **16 defeitos injetados, todos detectados** (2 sobreviveram na primeira rodada — veto de orçamento mascarado pelo veto de taxa no teste; nenhum caso de
  rebaixamento avaliado — testes reforçados).

### Descobertas durante a fase
- O veto checado **antes** da negociação barrava até propostas que o vendedor recusaria; passou a avaliar os **termos finais** (como na renovação).
- O teste antigo de jogadores livres contratava o livre mais valioso, agora barrado pelo teto da folha — passou a usar o mais barato (o veto tem testes próprios).
- Soak de 4 temporadas: confiança 100 → 80 → 45 e demissão do treinador passivo na virada de 2029; desempregado depois; contabilidade íntegra.

### Escrito, mas NÃO executado (precisa do seu `npm run dev`)
- Aba **Diretoria** (medidor de confiança, objetivo e status, secundários, orçamentos e pedidos de aumento, propostas de emprego com confirmação, carreira do treinador);
  painel **sem clube** (menu restrito, cartão "Sem clube" na visão geral); avaliação da diretoria no relatório da virada; recusa "board_rejected" nas propostas.

### Roteiro de teste manual da Fase 8D (pode usar o save atual)
1. **Diretoria:** confira objetivo, meta, confiança, orçamentos. Simule algumas rodadas: a confiança sobe/desce com os resultados e no dia 1º.
2. **Veto:** em Transferências, tente pagar mais de 2× o valor de mercado por um jogador (a diretoria veta) ou estourar o orçamento; numa renovação, ofereça um salário absurdo.
3. **Pedidos:** peça mais orçamento (com confiança abaixo de 65 é negado; só um pedido de cada por temporada).
4. **Obras:** encomende uma obra acima de 30% do caixa com confiança baixa (negada).
5. **Empregos:** acompanhe Notícias/Diretoria para propostas; aceite uma (confirmação) e veja o painel mudar de clube. Se for demitido, o menu fica restrito e chegam propostas.

### Verificado pelo usuário (prints de 02/11/2026)
- Aba Diretoria (objetivo "metade de cima", meta 10º, confiança 60 → 52 com o time em 12º "perto da meta", orçamentos, secundários, carreira do treinador) e **veto**:
  oferta de 120.000/mês a um livre de valor 472 mil barrada pelo teto da folha.
- Ajuste visual (8D.1): jogadores sem clube mostram "—" na coluna Contrato e "pretensão salarial … · sem contrato" na proposta e na ficha (antes aparecia o contrato antigo, vencido).
- Não exercitados pelo usuário nesta rodada (cobertos por testes automatizados e pelo teste na cópia do save): demissão/modo sem clube, propostas de emprego, pedidos de orçamento e aprovação de obras.
