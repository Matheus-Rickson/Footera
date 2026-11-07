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

## v0.8.0 — Fase 8 completa (8A ciclo de carreira, 8B olheiros/base, 8C treino/comissão/médico/infra, 8D diretoria/empregos)
- Versão do `package.json` (exibida no rodapé do app) subiu de 0.7.1 para 0.8.0; o branch `main` foi avançado até esta versão.
- Próximo: fase de lapidação (sem funcionalidades novas), com prioridades a definir com o usuário.

## Lapidação — 1ª frente: telas e textos + nova interface (estado: implementado; telas revisadas por capturas automáticas do app real; aguardando verificação do usuário)

Pedido do usuário: além da revisão de telas e textos, refatorar a interface para um visual contemporâneo de SaaS, limpo, com **tema escuro (padrão) e claro** à escolha.
Sem novas funcionalidades de jogo.

### Feito
- **Design system** (`styles.css` reescrito): tokens de cor por tema (`data-theme`), tipografia Segoe UI Variable (fonte do sistema: a CSP não permite fontes externas),
  cartões, botões (primário/secundário/perigo/link), campos com anel de foco, avisos (sucesso/alerta/erro), tabelas com cabeçalho fixo e hover, barras e medidores,
  gráfico e relatório de partida usando os tokens (o gramado do campo continua verde nos dois temas), barras de rolagem discretas, layout responsivo.
- **Tema** (`renderer/theme.ts`): escuro por padrão; alternância no rodapé do menu e na tela inicial; a escolha fica salva no computador (aplicada antes do 1º quadro).
- **Navegação:** menu agrupado (Clube, Competição, Mercado, Desenvolvimento, Gestão, Carreira) com ícones (`lucide-react`, MIT, embutido), escudo com as iniciais do clube,
  rodapé fixo (tema e menu principal); item desativado "Configurações e salvamento" removido do menu (volta na Fase 10). Barra superior com título, data e ações com ícones.
- **Visão geral:** indicadores (classificação com atalho para a tabela, caixa, elenco, folha) e remoção de cartões repetidos e do texto técnico "Estado do desenvolvimento".
- **Tela inicial:** marca, perfil, "Última carreira" com Continuar, ações com ícones; "Editor de dados" e "Configurações" (pendentes, sem fase definida) saíram do menu.
- Textos corrigidos: olheiro de país (não é mais "ao acaso"), efeito do departamento médico com uma casa decimal (antes "hoje" e "próximo nível" pareciam iguais),
  "Meus jogos" sem destaque em todas as linhas, nomes de jogadores com peso médio.

### Verificação
- Typecheck completo limpo; 147 testes; teste de guarda do CSS pegou uma classe duplicada durante a reescrita (corrigida).
- **Capturas automáticas do app real** (build de produção, cópia dos dados do usuário numa pasta temporária, apagada depois): todas as 20 telas no tema escuro e
  várias no claro foram revisadas visualmente.
- Diagnóstico durante as capturas: as chamadas ao motor levam 5–30 ms (a suspeita inicial de lentidão por clique não se confirmou); as interrupções eram do
  próprio roteiro de captura (janela fechada de fora e janela fora da tela sem repintar), não do jogo.

### 2ª rodada: ficha do jogador redesenhada + tema escuro azul meia-noite
- **Tema escuro** passou do cinza-neutro para azul meia-noite (fundo `#070d1c`, superfícies `#0d1630`…`#172549`, bordas e textos azulados). Tema claro inalterado.
- **Ficha do jogador** refeita com base na referência enviada pelo usuário: cabeçalho com avatar de iniciais, selo **NÍVEL** (próprio: força; outros clubes: estimativa
  "~ mín–máx"), nacionalidade, clube, posição em abreviação PT (GOL/ZAG/LE/LD/VOL/MC/MEI/PE/PD/ATA), pé, idade e nascimento, personalidade (Profissionalismo,
  Ambição, Fidelidade em Baixa/Média/Alta), altura/peso, condição e moral; faixa com valor, salário/pretensão, fim de contrato, potencial e botões
  (Observar, Fazer proposta, Voltar). Abas: **Visão geral** (6 grupos em barras + radar hexagonal, mapa de posições natural/familiar, gráfico de evolução,
  estatísticas da temporada, últimos 5 jogos com nota), **Atributos** (23 atributos 1–20) e **Histórico** (transferências e força por temporada).
- Nomes do **Elenco** viraram links para a ficha.
- **Regra 7 preservada:** personalidade e moral de jogadores de outros clubes só aparecem com ≥ 50% de conhecimento dos olheiros (senão "?"); evolução por temporada só
  do próprio clube. Teste novo cobre os três casos; mutações (liberar sempre; histórico para todos) foram detectadas.
- **Adaptações da referência:** não há histórico de valor de mercado nem reputação por estrelas (o jogo não guarda esses dados; nada foi inventado) e não há fotos (avatar de iniciais).
- Capturas do app real revisadas: ficha própria (3 abas), ficha de jogador observado, tema claro. Ajuste feito após a revisão: placar/nomes dos últimos jogos quebravam linha.
- 147 testes passando; typecheck completo limpo. **Telas ainda não verificadas pelo usuário no `npm run dev`.**

### 3ª rodada: tela de Transferências e janela de negociação (com base na referência do usuário)
- **Mercado** em tabela larga: avatar de iniciais + nome (abre a ficha completa) + **sinalizações** (binóculo = lista de observação; cruz = lesionado, com data;
  suspenso; cartões amarelos/vermelhos nas competições da temporada), clube, nacionalidade, posição e secundárias em siglas, idade, nível e potencial
  **estimados** (faixas), pé, altura, peso, valor, salário, contrato, conhecimento dos olheiros; coluna de ações fixa à direita (Observar / Negociar).
  Barra de busca por nome e filtros em "chips" (posição — grupos ou posição exata —, idade, valor máximo, só livres, limpar); a busca roda sozinha ao mudar os
  filtros, e os filtros continuam valendo ao voltar da ficha. Abas no topo (Mercado, Propostas recebidas, Meus jogadores, Histórico) e situação da janela/caixa/elenco.
- **Janela de negociação** em 3 etapas: **Proposta** (taxa ao clube: o clube aceita, contrapropõe ou recusa; nada é gravado), **Contrato** (salário e temporadas;
  folha após a contratação × teto da diretoria) e **Assinatura**. Jogador livre pula a taxa. A proposta final reavalia a taxa pela mesma regra (`clubTerms`),
  então a etapa 1 não cria atalho nenhum. Abre também pela ficha ("Fazer proposta") e pelos Olheiros ("Negociar").
- **"Disposição do clube" e "Interesse do jogador"** usam só dados públicos que o motor já usa: contrato restante, idade e caixa do vendedor (os descontos de
  `askingPrice`; zero se o clube não pode liberar o jogador) e prestígio relativo dos clubes (o fator de `wageDemand`). Não usam força real nem ambição oculta.
- **Adaptações da referência:** sem bandeiras e fotos (o jogo não tem as imagens), sem reputação em estrelas do jogador (não existe esse dado),
  sem "Detalhado"/"Salvar filtros"/menu "⋮" (seriam botões sem função).
- Backend: `proposeFee`, `getNegotiation` (IPC validado com Zod), `MarketPlayerDto` com nacionalidade, altura, peso e situação pública. 2 testes novos (149 no total);
  mutação: **4 defeitos injetados, 4 detectados** (etapa 1 aceitando sempre; clube sem poder vender com disposição > 0; lesão vencida ainda sinalizada; cartões de outra temporada).
- Capturas do app real revisadas (tema escuro e claro): mercado, negociação de livre (etapa Contrato) e etapa Proposta com recusa — esta última numa cópia
  temporária do save com a data alterada para janeiro (cópia apagada). **Não verificado pelo usuário no `npm run dev`.**

### 4ª rodada: acompanhamento da partida (centro de jogo) no estilo da referência
- **Layout:** placar com minuto e situação (Pré-jogo / Ao vivo / Pausado / Encerrado) e barra de progresso; à esquerda e à direita, campo de cada time com
  iniciais, **nota ao vivo**, nome e ícones (gol, assistência, cartões, entrada/saída, lesão) e tabela (posição, nome, força — só do seu clube —, **condição**,
  **nota**, minutos, gols, e "Saíram"); no centro, **Eventos** (mandante à esquerda, visitante à direita, placar no gol, intervalo/fim), **campo animado**
  e **Estatísticas** (posse, xG, finalizações, no alvo, escanteios, faltas, impedimentos, cartões, passes, precisão, desarmes, defesas). Controles:
  Iniciar/Pausar, 1×/2×/4×, Ir para o fim, Assistir do início. Abaixo de 1400 px de largura, o centro vai para cima e os times ficam lado a lado.
- **Dados ao vivo reais:** o motor passou a registrar, nas partidas do usuário, a **linha do tempo minuto a minuto** (`MatchTick`: estatísticas acumuladas,
  posse, nota parcial e condição de cada jogador). Só observa: nenhum sorteio novo — teste confirma resultado idêntico com e sem registro (24 partidas,
  com prorrogação e pênaltis), e o último minuto bate com a nota final e com a condição gravada (fórmulas extraídas para `rateReport` e `conditionAfter`).
  Jogos de outros clubes não guardam (relatório resumido). Partidas antigas: acompanhamento pelos eventos; notas/estatísticas aparecem no fim (aviso na tela).
- **Campo animado (onde ficava o "momentum"):** é uma **representação** — o motor simula por lances, não por coordenadas. Cada minuto vira 3 quadros
  em que bola e jogadores se deslocam conforme o lance real daquele minuto (gol, finalização, escanteio, impedimento, falta) ou a posse registrada;
  substituições, expulsões e lesões mudam quem está em campo. A tela diz isso abaixo do campo.
- Sem dados para: fotos/escudos, função tática por jogador ("FUN") e banco não utilizado (o relatório só guarda quem entrou em campo).
- Testes: 3 novos (152 no total). Mutação: **8 injetadas, 7 detectadas + 1 equivalente** (guarda redundante no repositório: o motor já só gera a linha do
  tempo nas partidas do usuário). Uma sobrevivente inicial (lesão sem substituto) revelou lacuna; caso construído adicionado e passou a ser detectada.
- Capturas do app real (1600 e 1920 px, escuro e claro) com uma cópia temporária do save (apagada). **Não verificado pelo usuário no `npm run dev`.**
- **Modo foco (pedido do usuário após o 1º teste, que funcionou):** durante o acompanhamento da partida o menu lateral e a barra superior de ações
  (Próxima rodada, Avançar 1 dia…) somem e a partida ocupa a tela toda; "Voltar" devolve o painel normal. Isso também impede avançar o tempo no meio do jogo.
  Conferido por captura em 1920×1080; aguardando verificação do usuário.

## v0.8.1 — FOOTERA (nome, logo e instalador) + lapidação de interface
- **Marca:** a tela inicial mostra o logo enviado pelo usuário (`footera.jpg` convertido em máscara transparente que segue a cor do tema), **FOOTERA** e
  "Build your club. Create your legacy."; título da janela "FOOTERA". Ícone do Windows (`build/icon.ico`, 16–256 px): o mesmo traço em verde sobre azul meia-noite.
- **Instalador:** `npm run package` → `release/FOOTERA Setup 0.8.1.exe` (NSIS, escolhe a pasta, x64). Saída movida de `dist/` (que é a pasta da tela compilada)
  para `release/`. Dependências de tela (React, lucide, zod) passaram a `devDependencies`: já vão embutidas pelo Vite/esbuild, então o pacote não leva `node_modules`.
  Sem assinatura digital (o SmartScreen avisa). No Windows, sem privilégio de link simbólico, o electron-builder falha ao extrair `winCodeSign`; contornado
  extraindo o pacote manualmente em `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0` (só arquivos de macOS ficam de fora).
- **Saves preservados:** com o nome do produto trocado, o Electron passaria a usar outra pasta no app instalado; o `main.ts` fixa
  `%APPDATA%\football-manager-simulator` quando empacotado.
- Verificação: 152 testes; typecheck limpo; teste de fumaça do **conteúdo empacotado** (app.asar extraído rodando com uma cópia dos dados: tela inicial,
  carreira, Elenco, ficha e Transferências). O `.exe` instalado em si **não foi executado** por mim (abriria os saves reais na sua área de trabalho).
- Checklist completo de validação: `docs/CHECKLIST_VALIDACAO.md`.

## v0.8.2 — posições em português e tema escuro grafite (pedido do usuário após validar a 0.8.1 com sucesso)
- **Posições:** siglas e nomes em português centralizados em `src/shared/positions.ts` (GOL, ZAG, LE, LD, VOL, MC, MEI, PE, PD, ATA), usados por todas as telas
  (selo `PosPill` nas tabelas; `posLabel` em textos, opções das Táticas e campo de escalação) e pelos textos do motor (aviso de escalação ajustada com o nome
  da posição, notícia da peneira, promovidos na virada). O código interno continua GK/CB/…. Notícias já gravadas em saves antigos não são reescritas.
  Teste de guarda: nenhuma tela nem repositório exibe a sigla interna (exceto colocação "12º"); mutações (sigla crua na Base, na peneira e na virada) detectadas.
- **Tema escuro:** de azul meia-noite para grafite neutro a partir da cor de referência (`#191a1b`): fundo `#161718`, superfícies `#1d1e20`…`#2a2b2f`, bordas
  `#303236`/`#3f4247`; sobreposição do modal, faixa "GOL!", selo de nota e cor inicial da janela neutralizados. Tema claro inalterado.
- 153 testes; typecheck limpo; capturas do app real (Elenco, Táticas, Base, Transferências, partida) revisadas. **Não verificado pelo usuário.**

## v0.8.3 — técnico na partida ao vivo: vestiário, substituições e placar compacto (pedido do usuário após validar a 0.8.2)
- **Tela sem rolagem:** placar numa faixa compacta (times, placar, minuto e ações na mesma linha; dados da partida embaixo); as três colunas ocupam a altura
  da janela e as listas (tabelas, eventos, estatísticas) rolam por dentro. Abaixo de 1400 px de largura volta ao layout empilhado com rolagem.
- **Como funciona agora o "Acompanhar ao vivo":** a partida do seu clube NÃO é gravada antes. O jogo mostra uma prévia (`previewUserMatch`, não grava nada)
  e cada decisão do técnico vira uma intervenção num minuto exato; o motor resimula a partida inteira com ela — determinístico, então tudo até aquele
  minuto fica idêntico e só o que vem depois muda. No fim (ou ao pular/sair, quando o auxiliar assume o restante) a rodada inteira é gravada de forma
  atômica com as mesmas decisões (`simulateMatchday(db, live)`): teste confirma que o gravado é exatamente o que foi visto.
  Se o jogo for fechado no meio, nada é gravado e a partida continua pendente. "Simular rodada" continua como antes (o auxiliar decide tudo).
- **Substituições do técnico:** durante o ao vivo o seu time não troca sozinho (nem por lesão). Botão "Substituições (n/5)" pausa o jogo; escolha quem sai
  e quem entra (assume a posição; aviso quando fica fora da posição natural). Lesão de jogador seu pausa o jogo e abre a janela de substituição.
  Limite de 5 trocas; decisões impossíveis (jogador já saiu, banco esgotado) são recusadas com mensagem.
- **Vestiário (intervalo):** o jogo pausa sozinho no fim do 1º tempo. 12 falas prontas em 4 tons — Incentivar, Cobrar, Encorajar, Consolar — e
  "Não falar nada". Efeito na moral de todos os relacionados (titulares e banco) por regra pura (`teamTalk.ts`): depende do tom, do placar no intervalo e
  da compostura do jogador (cobrança abala quem tem compostura baixa; incentivo com o time perdendo soa desconectado; consolo com o time bem acomoda).
  A moral muda a força em campo no 2º tempo (fator já existente, ±3%) e fica gravada depois do jogo (somada ao efeito do resultado). A janela mostra a reação
  (motivados / indiferentes / abalados e variação média).
- Testes: 4 novos (157 no total). Mutação: **9 injetadas, 9 detectadas** (uma sobreviveu na primeira rodada — limite de 5 trocas — e ganhou teste próprio).
- Capturas do app real (1920×1080): ao vivo, vestiário aberto automaticamente no intervalo, reação do elenco, substituição no intervalo, fim gravado.
  **Não exercitado em captura:** a pausa automática por lesão (depende de uma lesão acontecer no jogo; a regra está coberta pelos testes do motor).
  **Não verificado pelo usuário.**

## v0.8.4 — placar alinhado, conversa só na partida e auxiliar que sugere trocas (pedido do usuário após testar a 0.8.3)
- **Placar** centralizado sobre a coluna do meio (mesma grade das colunas de baixo): dados da partida à esquerda, botões à direita; nomes longos com "…".
- **Vestiário:** decisão do usuário — o efeito na moral vale **só nesta partida** (2º tempo); não é mais gravado depois do jogo (a 0.8.3 gravava).
- **Auxiliar técnico:** no ao vivo o seu time não troca sozinho; nos mesmos momentos em que o auxiliar trocaria (58', 66', 74', 82' e lesões), o jogo pausa
  e abre "Sugestão do auxiliar" com a troca (sai → entra, posição) e a justificativa calculada do estado real: cansaço (condição e nota), rendimento,
  buscar o resultado (perdendo, entra um atacante), segurar o resultado (vencendo, entra um defensor) ou lesão (dias fora). O técnico faz a troca,
  escolhe outra ou recusa. O motor calcula a sugestão com a mesma regra das trocas automáticas, sem executar (`suggestFor`): teste confirma que a 1ª
  sugestão é exatamente a 1ª troca que o auxiliar faria sozinho. Aceitar aplica a troca no minuto seguinte, na posição sugerida.
  Ao pular para o fim ou sair no meio, o auxiliar continua decidindo o restante (alguém precisa decidir; o aviso diz isso).
- Testes: 158; typecheck limpo. Mutação: 5 injetadas, 5 detectadas. Capturas do app real (1920×1080): placar centralizado, vestiário, sugestão aceita.
  **Não verificado pelo usuário.**

## v0.8.5 — auxiliar propõe a formação quando quem entra é de outra posição (pedido do usuário após validar a 0.8.4)
- Quando a troca sugerida traz um jogador de outra posição, o auxiliar escolhe, entre as formações conhecidas (4-4-2, 4-3-3, 4-2-3-1, 3-5-2, 3-4-3,
  5-3-2, 4-1-4-1), a que encaixa quem entra **na posição dele** com a menor perda de rendimento para quem precisa mudar de função (`planReshape`).
  A sugestão mostra "Formação: 4-3-3 → 4-2-3-1" (ou "com ajustes", se a formação se mantém) e quem muda (ex.: Felipe Ramos MC → VOL); o motivo explica.
  "Fazer a troca e mudar a formação" aplica tudo: a função de cada jogador muda no motor (afeta o jogo) e o campo/rótulo da formação na tela acompanham
  (evento `formation_change`). Com expulsos (menos de 10 na linha) não reorganiza. As trocas automáticas da IA (outros clubes) não mudaram.
- Testes: 161; typecheck limpo. Mutação: 8 injetadas, 7 detectadas; sobrevive a inversão da prioridade de quem entra na ordem de encaixe (praticamente
  equivalente: a regra "quem entra joga na posição dele" é garantida por uma exigência explícita, que tem teste e mutação detectada).
  Uma captura revelou um caso real (meia entrando num 4-3-3 ficaria improvisado) que virou regra + teste. **Não verificado pelo usuário.**

- **Verificação do usuário (0.8.2–0.8.5):** testes manuais concluídos no app instalado — posições em português, tema grafite, placar centralizado, vestiário
  (efeito só na partida), sugestões do auxiliar com motivo e reorganização da formação (4-3-3 → 4-2-3-1 aplicada e refletida no campo, tabela e placar).

## Elenco redesenhado (pedido do usuário, com referência; sem gerar instalador nesta etapa)
- Tabela no layout moderno, colunas na ordem pedida: **posição** (principal + até 2 secundárias), **força**, **jogador** (avatar de iniciais — o jogo
  não tem fotos de jogadores — e sinal de lesão/suspensão), **nacionalidade** (bandeira SVG desenhada no próprio jogo + sigla; o universo atual só tem
  Brasil e Inglaterra; outro código aparece como selo neutro, sem bandeira inventada), **idade**, **altura**, **condição** e **moral** (barras) e
  **estatísticas da temporada** (jogos, minutos, gols, assistências, nota média, cartões amarelos e vermelhos — todas as competições pelo clube).
- Filtro por setor (Todos, Goleiros, Defensores, Meio-campistas, Atacantes, com contagem), resumo (força, idade e condição médias) e ordenação por
  qualquer coluna (clique no cabeçalho). Nome abre a ficha completa. Salário/contrato/potencial continuam em Contratos e na ficha.
- `SquadRow` ganhou nacionalidade, altura, situação e estatísticas (consulta agregada em `openCareer`). Teste novo (162 no total); mutação: 4/4 detectadas.
- Capturas do app real (1920×1080, escuro e claro) revisadas. **Não verificado pelo usuário.** Sem commit e sem instalador (o usuário pede quando quiser).

## Táticas reestruturadas (pedido do usuário, com referência; sem instalador nesta etapa)
- **Layout:** elenco à esquerda (escalado em qual vaga, posição, força, jogador, condição, quanto rende na vaga; lesão/suspensão) e campo à direita
  com o time escalado. Barra com **pré-definições** (4-4-2, 4-3-3, 4-2-3-1, 3-5-2, 3-4-3, 5-3-2, 4-1-4-1), esquemas salvos ("Salvar como…", excluir)
  e estilo de jogo embaixo (mentalidade, saída de bola, ritmo, amplitude, linha defensiva, pressão).
- **Nada travado, salvo na hora:** escolher uma pré-definição aplica formação + melhor escalação e tudo continua editável; cada mudança grava o esquema
  ativo. Se o ativo for uma pré-definição antiga (somente leitura), a primeira mudança cria "Minha tática" e a ativa.
- **Arrastar e soltar** (também por clique, para acessibilidade): jogador do elenco sobre um titular = troca; titular sobre titular = trocam de lugar;
  titular numa âncora vazia = muda a formação (o goleiro fica no gol). Cores: natural / secundária / fora de posição; "!" = indisponível no momento.
- **Âncoras do campo** (as marcações do print): goleiro + defesa (5) + alas/volantes (5) + meio (5) + meia-ofensiva (5) + ataque (3) = 24 posições, cada uma
  com a função do motor. As 7 pré-definições foram reconstruídas sobre as âncoras com as **mesmas funções e a mesma ordem de vagas** (simulação e escalações
  salvas intactas; 162 testes anteriores passaram sem mudança). Formação livre = "@" + 11 âncoras; o nome exibido é o da pré-definição quando as posições
  coincidem, senão a contagem por linha (ex.: 5-1-2-1-1). Relatórios e partida mostram o nome, nunca o código.
- Correção achada na captura: a validação do IPC limitava a formação a 20 caracteres (formação livre é maior).
- Observação (sem mudança): "Melhor escalação" usa o mesmo algoritmo com que a IA escala todos os clubes (melhor rendimento por função); ele pode pôr um
  zagueiro forte no ataque se, pelo modelo, render tanto quanto o atacante disponível. Mudá-lo alteraria a simulação de todos os times.
- Testes: 163; typecheck limpo. Mutação: 3/3 detectadas (validação e nome da formação). Arrastar e soltar exercitado por captura do app real
  (eventos de arrasto reais do navegador) nos temas escuro e claro. **Não verificado pelo usuário.** Sem commit e sem instalador.
- **Ajustes pedidos após o 1º teste das Táticas (que funcionou):** a barra de estilo de jogo saiu da tela (só elenco e campo); clicar no gramado,
  fora dos jogadores e das posições (ou Enter com o campo em foco), abre a janela "Estilo de jogo" com mentalidade, saída de bola, ritmo, amplitude,
  linha defensiva e pressão (salvo automaticamente; dica abaixo do campo mostra a mentalidade atual). Âncoras renomeadas na tela: **ME/MD** (meia
  esquerdo/direito) nas extremas do meio e **ALE/ALD** (ala esquerda/direita) nas extremas da linha dos alas — só o nome; a função no motor continua
  ponta/lateral. Teste novo (164 no total). Capturas do app real revisadas. **Não verificado pelo usuário.**

## v0.8.6 (em andamento) — ME, MD, AE e AD como funções próprias (pedido do usuário, com a descrição de cada posição)
- Quatro posições novas no motor: **ME/MD** (meia esquerda/direita, LM/RM) e **AE/AD** (ala esquerda/direita, LWB/RWB), com atributos, peso em
  ataque/meio/defesa, participação nos lances (finalização, cabeceio, desarme, faltas, passe e um novo peso de **cruzamento**) e desgaste próprios
  (detalhes e calibração em `docs/MATCH_ENGINE.md`). Âncoras do campo nas Táticas passam a usá-las (siglas ME/MD/AE/AD); 4-4-2 e 4-1-4-1 ganham meias
  abertos, 3-5-2 e 3-4-3 ganham alas. Mercado, Elenco, ficha (mapa de posições), filtros e validação aceitam as novas posições.
- **Decisão do usuário: só carreiras novas** geram jogadores com essas posições (universo marcado com `position_set = v2`; a peneira dos saves antigos
  continua com as 10 posições originais). Nos saves atuais ninguém muda de posição: ponta como meia aberto e lateral como ala rendem 95% (funções
  parecidas, em amarelo nas Táticas); os demais, fora de posição (90%).
- Calibração: gols/jogo 2,88 → 2,59, empates 23,6% → 28,3% — dentro das faixas de referência. Um defeito meu (referência de normalização derivada da
  1ª pré-definição, que inflou para 3,56 gols/jogo) foi pego pelo teste de calibração e corrigido.
- Testes: 167; typecheck limpo. Mutação: 9/9 detectadas. Capturas do app real (Táticas no save atual) revisadas. **Não verificado pelo usuário.**
  Sem commit e sem instalador.

## Depuração do motor de partidas (pedido do usuário) e ajustes aplicados
- Bateria de 14.180 partidas (matriz 7×7 de formações com os mesmos clubes e sementes; espelho com mando e em campo neutro; esquerda × direita;
  determinismo). Relatório completo: `docs/MATCH_ENGINE_DEBUG.md`. Sem anomalias, determinismo OK, xG calibrado, **sem viés de lado**.
- Achados: (1) desequilíbrio estrutural entre formações (0,34 pt/jogo, causado pela soma de pesos de zona de cada função); (2) poucos gols e muitos 0x0
  com estilo equilibrado; (3) acréscimos do 2º tempo longos.
- **Aplicado (aprovado pelo usuário):** zonas normalizadas (dispersão 0,34 → 0,16); `K.chance` 0,068 → 0,080 (bateria: 2,42 → 2,64 gols/jogo,
  0x0 10,4% → 8,3%; IA: 2,80 gols/jogo); acréscimos 3,4/6,7 → 2,4/4,5 min. Defeito corrigido no caminho: goleiro expulso/lesionado era trocado
  automaticamente mesmo com o técnico no comando; agora o auxiliar sugere ("Sem goleiro"). Testes novos: equilíbrio de zonas, 0x0 e acréscimos na calibração, goleiro sob controle (169 no total); mutação 4/4 detectadas (uma só depois de apertar a faixa de acréscimos).
- Simulação longa de 3 temporadas estável (margem mediana sem prêmio −0,3% a +1,3%; saldos consistentes). Vermelhos (0,17/jogo) seguem um pouco
  acima da faixa de referência, como antes. **Não verificado pelo usuário em jogo.** Sem commit e sem instalador.

## v0.8.6 (em andamento) — Funções táticas (pedido do usuário: "não confunda posição com função")
- **Decisões do usuário:** dividir ATA em **SA** (segundo atacante) e **CA** (centroavante); familiaridade que se treina; funções valem para todos já
  (inclusive saves atuais e clubes da IA). Universo novo marcado `position_set = v3` (a base também gera SA/CA); nos saves antigos o ATA exerce as
  funções de SA e de CA.
- **Motor** (`playerRoles.ts`, detalhes em `docs/MATCH_ENGINE.md`): 33 funções (3 por posição) com atributos exigidos, compatibilidade, domínio e efeitos
  nos lances, no desgaste, na saída de bola e no risco de contra-ataque. Sem escolha, cada jogador exerce a de maior rendimento.
- **Rebalanceamento** (a divisão SA/CA + funções desequilibrou as formações: dispersão 0,16 → 0,31): expoente de setor 0,5 → 0,35 e `K.chance`
  0,080 → 0,070. Dispersão final 0,13; gols 2,69 (matriz equilibrada) e 2,93 com táticas da IA (v0.8.5 no mesmo script: 2,99).
- **Banco (migração 011):** `player_roles` (domínio aprendido), `tactic_schemes.roles_json` (função por vaga), `player_training.role_focus`.
- **Aprendizado:** +1,5 de domínio a cada 90 min jogados na função (todos os clubes); treino mensal da função escolhida (+10 × qualidade do auxiliar,
  do centro de treinamento e intensidade; só o usuário). Limite 100.
- **Telas (NÃO verificadas no Electron):** Táticas — cada crachá mostra a função da vaga (itálico = automática); clicar num jogador do campo abre uma
  janela (popup) com as funções da vaga (Automática + 3 funções com descrição, compatibilidade e domínio) e "Função a treinar no mês". Ficha do jogador — card
  **Funções** (só do próprio clube: de outros clubes revelaria atributos reais).
- **Testes:** 179 (10 novos em `roles.test.ts`: catálogo, domínio inicial, rendimento, equilíbrio de zona, efeitos causais — lateral, centroavante e risco
  nas costas —, função exercida/automática/determinismo, esquema com validação, aprendizado jogando, treino mensal com limite, privacidade na ficha).
  Dois limites de testes antigos ajustados por medição (cruzamentos: corredor ≥ 60% e alas/meias abertos ≥ 33%; medido 69% e 43% em 1.200 jogos).
- **Mutação:** 13/13 detectadas (duas só depois do teste causal isolado: risco nas costas e efeito de finalização da função).
- Typecheck limpo. Sem commit e sem instalador (aguardando validação do usuário).
- **Não executado:** simulação longa de várias temporadas com funções (soak) e capturas de tela do app.
- **Compatibilidade evolui com o treino de função** (pedido do usuário após testar): com o foco de atributos em Equilibrado, a função treinada vira o foco
  da evolução mensal (mesmos pesos do foco de atributos: ×1,35/×0,9). Um foco de atributos específico prevalece. Testei pesos maiores (×1,6/×0,8): a força
  geral subia até +0,3/ano a mais que sem treino, por isso mantive os pesos já calibrados. Teste causal novo (mesmo save e mesmas sementes, só muda o treino);
  a mutação que remove a regra foi detectada. 180 testes passando e typecheck limpo. Textos explicativos na janela de funções e na ficha (telas NÃO verificadas).

## v0.8.7 — janela do jogador em Táticas e posições secundárias realistas
- **Táticas:** clicar num jogador do elenco abre uma janela compacta (`PlayerQuickView` em `PlayerProfile.tsx`) com atributos 1–20, mapa de posições,
  funções (compatibilidade e domínio) e estatísticas da temporada; botões "Colocar em campo"/"Trocar de lugar" (seleciona para o próximo clique numa
  posição), "Ficha completa" e "Fechar" (também Esc e clique fora). Arrastar para o campo continua igual. Tela NÃO verificada no Electron.
- **Geração:** a posição secundária era sorteada entre todas as posições (goleiro ala, atacante zagueiro). Agora só entre vizinhas no campo
  (`SECONDARY_OPTIONS` em `shared/positions.ts`); goleiro nunca tem secundária. Vale para universos novos e para a base (`buildPlayer`).
- **Saves existentes (migração 012):** remove as secundárias implausíveis e mantém as vizinhas. Medido numa cópia do save do usuário: 905 → 169
  jogadores com secundária; goleiros com secundária 130 → 0.
- **Testes:** 181 (novo em `world.test.ts`: universo, 600 jovens da base e migração). Mutação 3/3 detectadas (sorteio antigo, goleiro com secundária,
  migração sem filtro). Typecheck limpo.
- **Ajustes pedidos depois:** CA também pode ter MEI como secundária (SA já tinha). **Elenco** cabe na janela: a página não rola, só a tabela
  dentro do cartão (`content-fit`). **Transferências:** colunas de atributos resumidos (FIN/GOL, TEC, PAS, DES, FIS, VEL) com as mesmas faixas
  estimadas da ficha (`shared/attributeSummary.ts`; "?" com menos de 25% de conhecimento; GOL só para goleiros, FIN só para jogadores de linha);
  rolagem horizontal com a coluna do jogador (nome e foto) fixa à esquerda e as ações fixas à direita. Telas NÃO verificadas no Electron.
- Testes: 182 (novo em `transfers.test.ts`: resumo é faixa que contém o real, igual à ficha, oculto com pouco conhecimento). Mutação: 3/3 detectadas
  (resumo ignora o conhecimento, resumo exato e CA zagueiro). Typecheck limpo.
- **Transferências — mercado completo e filtros por categoria:** a busca deixou de parar nos 100 mais valiosos: `searchMarketPage` filtra todos os
  disponíveis e devolve `total` + a página pedida (a tela carrega 100 por vez ao rolar a lista). Filtros agrupados em 4 menus (`MarketFilters.tsx`):
  **Posição** (várias ao mesmo tempo, por setor ou uma a uma; entra quem joga em qualquer uma, como natural ou secundária, com opção "só natural"),
  **Perfil** (idade, pé, nacionalidade — várias, com contagem), **Contrato e valor** (com/sem clube, valor e salário máximos, contrato que termina
  nesta temporada ou até a próxima) e **Olheiros** (só observados, só com atributos conhecidos). Filtros ativos viram etiquetas removíveis e há
  "Limpar tudo". A página de Transferências também cabe na janela (sem barra de rolagem externa; as abas rolam dentro do cartão). Telas NÃO verificadas.
- Testes: 183 (novo: mercado paginado cobre todos sem repetir, posições múltiplas com secundária, só natural, nacionalidade, contrato, situação,
  salário, pé e olheiros). Mutação 7/7 detectadas. Typecheck limpo.
- **Estimativas e escala 1–20 (pedido do usuário):** sem conhecimento, faixas largas (força ±12 em 0–100; atributos ±5) em vez de esconder; elas
  estreitam com a observação e, com 100%, mostram o valor exato da força, do potencial e dos atributos (regra 7 revista no CLAUDE.md). O filtro
  "Olheiros" do mercado passou a ser "Só bem observados (50%+)". Força, potencial, força na vaga, compatibilidade de função, resumos de atributos,
  força média e evolução aparecem de 1 a 20 (inteiro, decisão do usuário) em todas as telas; o motor, as calibrações e o banco continuam em 0–100.
  Moral, confiança da diretoria e reputação seguem em 0–100 (não são qualidade de jogador). Testes: 184 (estimativas exatas com 100%, faixas largas
  sem conhecimento, resumo do mercado exato com 100%, escala 1–20). Mutação 5/5 detectadas. Telas NÃO verificadas no Electron.

## Fase 9 — Base de dados editável (branch `fase-9-base-de-dados`; detalhes em `docs/DATABASE.md`)
Decisões do usuário: JSON + CSV; pacotes só para carreiras novas (exceto fotos/nomes); começar pela etapa 1; commit da v0.8.7 antes (feito: `a33826b`).
### Etapa 1 — formato, IDs fixos, montagem do universo, validador (funcional, testada)
- **IDs fixos e legíveis** no gerador, únicos no universo: `bra`, `bra-1`, clubes/estádios pelo nome, jogadores `nome-sobrenome-ano`
  (`shared/slug.ts`). Como os IDs alimentam sementes aleatórias, os cenários dos testes mudaram: 3 testes tinham suposições frágeis e foram
  ajustados sem afrouxar o que verificam (técnico demitido no cenário novo → diretoria mantida satisfeita no teste de contabilidade;
  titular lesionado no treino antes do jogo → ignorado; peneira de março com goleiro melhor → lista de goleiros lida na virada).
- **Formato v1** (`game/data-pack/format.ts`, Zod estrito): manifest + countries/leagues/stadiums/clubs/players; criar/alterar/remover por id;
  jogador completo (23 atributos) ou resumido (`ability` 1–20 → atributos gerados com o perfil da posição); erros com pacote › arquivo › registro.
- **Montagem** (`compileUniverse`): base gerada ou vazia (`"base": "none"`) + pacotes; valida referências, países/ligas, divisões, acesso ×
  rebaixamento, idade, IDs entre tipos, `requires` e ordem; completa elencos curtos; tudo ou nada. Carreira nova já passa por ela e grava
  `meta.data_packs`.
- **Exportação** (`exportUniverse`) e disco (`services/packService.node.ts`: limite de 64 MB por arquivo, BOM aceito, arquivo desconhecido = erro).
- **CLI** `npm run pack -- validate|export|schema`; **JSON Schema** gerado das próprias regras em `docs/schema/`; exemplo em `docs/exemplos/pacote-exemplo/`.
- **Testes:** 193 (9 novos em `data-pack.test.ts`: IDs, ida e volta exata pela memória e pelo disco, patch parcial, criar país/liga/clubes/
  jogadores e jogar uma rodada com o clube novo, remoções, erros, disco, schema em dia, exemplo da documentação). **Mutação 12/12** detectadas.
  Typecheck limpo.
- **Pendente:** etapas 2–5 (interface de pacotes e `.zip`, fotos e escudos, editor + CSV, técnicos da IA). **Não executado:** nenhuma tela nova
  nesta etapa; nada para verificar no Electron além de criar uma carreira (deve funcionar como antes, com IDs legíveis).
### Base fixa e países completos × simplificados (sem commit; telas NÃO verificadas no Electron)
Decisões do usuário: base fixa (não depende de semente: um patch feito para uma semente não funcionaria em outra); 16 países (+ Bélgica,
Japão, Áustria, México, Irlanda, Croácia, Rússia); Brasil e Inglaterra com 4 divisões, Espanha e Alemanha com 3, os demais com 2;
propostas de emprego só de clubes completos; competições continentais depois da edição da base.
- **Base fixa** em `data/base/` (pacote `footera-base@1.0.0`, 672 clubes, 16.800 jogadores), carregada uma vez por sessão
  (`universeService.node.ts`; 0,6 s) e incluída no instalador (`build.files`). Modelos de nomes/cidades fictícios por país (`names.ts`),
  força por país (`strength`) e nomes de estádio no idioma. O gerador manteve o universo dos testes (Brasil e Inglaterra, 2 divisões).
- **Semente:** saiu da tela; cada carreira tem semente interna (acaso dos jogos), universo idêntico (testado).
- **Nível de simulação por país** (migração 013, `simLevelRepository.ts`). Simplificado = só o placar das partidas (`quickResult`: Poisson
  pela força dos 11 melhores e fator casa; 2,59 gols/jogo, mandante 45%, empates 26%, 0x0 7% — o motor completo dá 2,69 / 44,7% / 26,8% / 7,6%),
  sem relatório, estatísticas, lesões, cartões nem bilheteria; sem finanças mensais e patrocínios; sem categorias de base; sem treino nem
  evolução mensal (evolução anual na virada, `developLightPlayers`, minutos estimados pela posição no elenco); a IA não compra nem
  contrata livres durante a temporada (na virada completa os elencos); sem demissões da IA, vagas e propostas de emprego. Acesso,
  rebaixamento, premiação e aposentadorias valem para todos. O usuário pode contratar de clubes simplificados.
- **Tela de nova carreira:** escolha dos países completos (o do clube sempre), contagem de clubes completos e ritmo estimado; filtro
  por país e liga. Resultados da rodada na Visão geral só dos países completos; partidas simplificadas mostram "só placar".
- **Desempenho medido** (10 rodadas): universo antigo (80 clubes, todos completos) 4,9 s; base com só o Brasil completo (80 completos +
  592 simplificados) 5,6 s; Brasil + Inglaterra + Espanha (220 completos) 14,3 s; todos completos (672) 41,8 s.
- **Testes:** 198 (5 novos em `sim-levels.test.ts`: resultado rápido, carreira mista com temporada e virada, compra de clube
  simplificado + vagas só em completos + determinismo, base fixa com as divisões pedidas, carreira pela base com semente própria).
  Testes de saves ajustados à base (contagens de competições/partidas derivadas da base). **Mutação 11/11** detectadas (uma só depois de
  reforçar o teste das vagas, que expiravam antes da checagem). Typecheck limpo.
- **Não executado:** soak de várias temporadas com a base inteira; telas no Electron.
- **Tela de nova carreira refeita (pedido do usuário):** 3 passos. (1) Países: bandeira (SVG próprio, `flags.tsx`) e nome em destaque,
  "Completa / Simplificada" e divisões abaixo; resumo de países/ligas/clubes de cada nível e ritmo; botão "Escolher clube".
  (2) Clube: lista (só países completos — é onde o técnico pode treinar e ser contratado) e painel do clube destacado, que já abre com o
  de maior reputação do primeiro país completo. Só dados reais da base: escudo gerado pelas cores do id (até a etapa de fotos e escudos),
  estádio e capacidade, objetivo da diretoria (mesma regra da Diretoria; teste compara com o `board_state` da carreira criada), força
  média, elenco, idade média, reputação, torcida, caixa, 3 destaques e estrutura. Sem foto do estádio e sem texto de história (não há
  esses dados ainda). (3) Treinador. Testes: 199; mutação no objetivo detectada. Telas NÃO verificadas no Electron.
- **Cor do clube no passo 2:** ao destacar um clube, o fundo ganha um leve tom da cor dele, com transição suave, e a faixa do estádio, a borda do painel e a linha selecionada usam as cores do clube. Enquanto a base não tem cores cadastradas, são as cores do escudo gerado (`clubHues`). Tela NÃO verificada no Electron.
- **Nível de simulação por divisão (pedido do usuário):** marcar o país = todas as divisões completas; um campo opcional permite deixar
  só algumas divisões completas. Migração 014 (`leagues.sim_level`, copiando o nível do país das carreiras de teste); `countries.sim_level`
  fica sem uso. O clube segue o nível da divisão em que está (quem sobe para divisão completa passa a ser completo; quem cai, simplificado);
  o clube do usuário é sempre completo, inclusive a partida dele dentro de uma divisão simplificada. Só clubes de divisões completas
  aparecem no passo 2. Testes: 200 (novo: divisões, acesso/rebaixamento entre níveis, usuário rebaixado, partida mista em casa e fora).
  Mutação 4/4 (uma só depois de cobrir a partida fora de casa). Tela NÃO verificada no Electron.
- **Passo 1 em estilo minimalista (pedido do usuário):** barra de etapas; cartões limpos (caixa, bandeira, nome); divisões num painel fechado por padrão, aberto pelo botão "n/total" no cartão do país; explicações só em ícones de interrogação (ao passar o mouse ou focar), também nos passos 2 e 3; barra inferior fixa com o resumo e o botão "Escolher clube". Tela NÃO verificada no Electron.
- **Conteúdo de exemplo para testar a tela (pedido do usuário):** logo do FOOTERA no topo da nova carreira; imagem ILUSTRATIVA do estádio (`StadiumArt`, vista aérea em SVG nas cores do clube, variações fixas pelo id) e história resumida de EXEMPLO (`clubStory`, determinística, só com dados reais do universo e sem citar títulos; teste e mutação). Ambas marcadas na tela como exemplo/ilustrativa e provisórias até a base de dados ter fotos e histórias (etapas 3 e 4). 201 testes. Tela NÃO verificada no Electron.
- **Nova carreira cabe na janela (padrão das telas principais):** sem barra de rolagem da página nos três passos (`nc-fit`); só áreas internas rolam quando falta espaço. Passo 3 em duas colunas (dados e metodologia | foto). Painel de divisões com posição fixa na janela (abre para cima quando falta espaço; fecha ao rolar ou redimensionar); interrogações perto do rodapé abrem para cima. Tela NÃO verificada no Electron.
- **Correção:** a imagem do estádio cobria as caixas de informação do painel do clube (proporção fixa + altura máxima); agora tem altura definida.
- **Atributos do treinador (pedido do usuário; base dos sistemas de reputação):** 6 atributos 1–20 (conhecimento tático, motivação,
  desenvolvimento de jovens, disciplina, negociação, adaptabilidade; `shared/coachAttributes.ts`). Todos começam em 5; o usuário distribui
  12 pontos (máximo 15 por atributo na criação), com + e −, contador e "Redistribuir"; iniciar a carreira exige os 12 pontos usados.
  Validados no IPC (Zod) e em `validateCoach`, gravados em `coach_json`. **Ainda não alteram a simulação** (próxima fase: reputação).
  Carreiras antigas seguem sem atributos. Testes: 202; mutação 3/3. Tela NÃO verificada no Electron.
- **Correção e encaixe do passo 2:** a lista de clubes era uma grade de altura fixa que espremia as linhas (o selecionado ficava torto, sobrepondo o vizinho); agora é coluna com linhas de altura natural. Painel do clube em duas colunas (imagem e história | informações, destaques e estrutura), tela mais larga (até 1600 px), para caber sem rolagem; rolagem interna só como reserva em janelas pequenas. Tela NÃO verificada no Electron.
- **Caixa inicial e moeda (pedido do usuário):** o caixa inicial passou a incluir 22% do valor do elenco (os grandes não conseguiam
  contratar; ver `docs/FINANCE.md`); base fixa regenerada (ainda não publicada). Moeda única **euro (€)** em todas as telas e nas mensagens
  do jogo (`fmtMoney`, 60 pontos trocados; capacidade, torcida, público e lugares seguem sem moeda). Testes: 204 (caixa cobre o melhor
  jogador do clube mais forte de cada 1ª divisão + clube de pacote; formato da moeda). Mutação no caixa detectada. Telas NÃO verificadas.
### Etapa 2 — pacotes de dados na interface (sem commit; telas NÃO verificadas no Electron)
Commit anterior: `8cca05e` (base fixa, simulação por divisão, nova carreira).
- `packManager.node.ts` (pasta `<dados>/packs`, `load-order.json`, universo base + pacotes com cache por versão e data dos arquivos),
  `zip.node.ts` (leitor/gravador .zip sem dependências: deflate, UTF-8, limites contra zip bomb, recusa "..", caminho absoluto e senha),
  IPC `packs:list|order|import|remove|folder`, tela `PacksView` (menu principal → "Pacotes de dados") e indicação dos pacotes ativos no
  passo 1 da nova carreira. Carreira nova = base + pacotes ativos; `meta.data_packs` grava a lista.
- `npm run pack -- zip`; exemplo pronto `docs/exemplos/pacote-exemplo.zip` (renomeia a Série A e a liga argentina, cria 4 clubes).
- Testes: 207 (3 novos em `packs.test.ts`: zip; importar/ativar/ordem/substituir/remover e carreira com o patch; erros de importação,
  pasta quebrada que não ativa nem fica gravada, combinação com erro que bloqueia). **Mutação 8/8** (uma só depois de checar o arquivo
  de ordem). Typecheck limpo.
- **Próximo (pedido do usuário):** editor de dados externo, para testar 100% os patches, antes do sistema de reputação do treinador.
- **Origem dos dados na seleção de clube (após teste do usuário, que não achou os clubes criados):** `compileUniverse` registra que pacote criou ou alterou cada entidade; a lista de clubes mostra "novo"/"alterado" e o painel "Criado pelo pacote …" / "Alterado por …". Teste e mutação. 207 testes.
### Editor de dados (pedido do usuário: "fácil, interface amigável, boas práticas de UI/UX"; sem commit; telas NÃO verificadas)
- **Serviço** `editorService.node.ts`: resumo de alterações, opções (países/ligas/clubes), lista paginada com busca, filtros e "só o que
  o pacote mudou" (excluídos aparecem para restaurar), obter, salvar (diferença em relação à base via `game/data-pack/diff.ts`;
  entidade criada = registro completo; clube grava o estádio junto), excluir, restaurar, criar pacote (já ativo), editar manifesto,
  exportar .zip. Toda gravação monta o universo antes de escrever (erro = nada muda). IPC `editor:*` validado com Zod.
- **Tela** `EditorView`: escolha/criação do pacote; área de trabalho em 3 colunas (categorias com contador de alterações | lista com
  busca, filtros e etiquetas novo/alterado/excluído | formulário). Formulários por tipo com seções, rótulos claros, ajuda (?) só onde
  precisa, validação imediata por campo, força do jogador recalculada ao vivo pelos atributos, valor de mercado calculado, "Restaurar
  original", excluir com confirmação, aviso de alterações não salvas ao trocar de item ("Salvar e continuar" só segue se salvar),
  detalhes do pacote e exportar .zip. Cabe na janela (rolagem só dentro da lista e do formulário).
- **Defeito encontrado pelos testes e corrigido:** ao esvaziar uma lista do pacote, o arquivo antigo ficava no disco e a alteração
  desfeita "voltava" (`writePackDir` agora apaga o arquivo). Teste próprio.
- Testes: 211 (4 novos: diferença, fluxo de edição/restauração/resumo, criar clube e jogador/excluir/restaurar/inválido não grava/
  exportar e importar, arquivo vazio apagado). Mutação 6/6. Typecheck limpo.
### Atributos de goleiro e fotos (pedido do usuário após testar o editor; sem commit; telas NÃO verificadas)
- **Goleiro** (`game/world/goalkeeper.ts`): reflexos, um contra um, manejo, jogo aéreo, saídas do gol e reposição. O "goleiro (geral)"
  que o motor usa é a média ponderada deles (o motor não mudou; agora cada específico influencia). Funções de goleiro usam os específicos
  (Tradicional: reflexos/manejo/jogo aéreo; Líbero: saídas/1×1; Construtor: reposição/passe). Dados antigos (base fixa, saves) ganham o
  grupo derivado sem mudar a força (média exata igual). Evolução mensal move o grupo e recalcula o geral (também no corte pelo potencial);
  foco de treino "goleiro" passou a mirar os específicos. Pacotes: `attributes.goalkeeper` (parcial vale; só o geral deriva o grupo).
  Ficha e janela do jogador mostram o grupo "Goleiro" para goleiros; o editor mostra os seis e o geral calculado ao vivo.
- **Fotos** (`imageService.node.ts`, índice em `packManager.imageIndex`, protocolo `footera-img` no processo principal, CSP liberada só
  para ele): escudos na escolha de clube (lista e painel), foto do estádio no painel (no lugar da ilustração), foto do jogador na ficha e
  na janela rápida; campos de imagem no editor; .zip leva e traz as imagens.
- **Logo da liga** (`images/leagues/<id>`): campo "Logo da liga" no editor de ligas; aparece no menu de divisões e na etiqueta da liga no
  painel do clube (nova carreira) e ao lado do seletor em Competições (`CompetitionInfoDto.leagueId`). Testes: índice e .zip aceitam o logo;
  a competição informa a liga. Mutação 2/2 (tipo fora do padrão de caminho; liga trocada pelo id da competição). Telas NÃO verificadas.
- **Balão de ajuda (?)** limitado ao quadro em que está (cartão/janela): alinha às bordas, abre em cima se faltar espaço, encolhe em quadro
  estreito. Tela NÃO verificada.
- Testes: 216 (4 de goleiro: derivação exata, efeito na força e no Líbero, patches, evolução, save antigo; 1 de imagens). Mutação: goleiro
  5/5 (uma só depois de checar a média exata, sem depender do arredondamento); imagens 6/6. Testes antigos ajustados: resumo do mercado
  com o grupo de goleiro; "safra não sobe direto" checado logo após a peneira (na virada, a carência de goleiro do usuário promoveu um jovem,
  regra própria). JSON Schema regenerado.
- **Informativo dos atributos (pedido do usuário):** `game/world/attributeInfo.ts` descreve cada atributo e o efeito real no motor (conferido no código: finalização 60% da qualidade do chute; passe/visão/primeiro toque na precisão de passe e em quem dá a assistência; cabeceio/impulsão no cabeceio; agressividade em faltas e cartões; resistência e preparo natural no cansaço e lesões; compostura em finalização, pênaltis e vestiário; etc.). "Pesa na força de…" é calculado da tabela de pesos. **Liderança ainda não tem efeito na partida** e o texto diz isso. (?) em cada atributo no editor, na ficha e na janela do jogador. No editor, "Potencial" saiu da grade de atributos (estava esticado). Teste de guarda: todo atributo tem texto e quem diz "não influencia" não pode aparecer no motor (o teste só passou a valer depois de corrigir um `` mal escapado — detectado pela mutação). 217 testes.
- **Correção (balões de ajuda cortados no editor):** o (?) passou a ser um componente único (`renderer/help.tsx`) com o balão posicionado pela janela (abre embaixo ou em cima e respeita as bordas), então não é mais cortado por áreas com rolagem. Vale para editor, nova carreira, pacotes, ficha e janela do jogador. Tela NÃO verificada no Electron.
- **Reputação e atributos do treinador (Fase 9):** reputação exibida em estrelas (0–5, meia estrela) para treinador, clubes e jogadores (`toStars`, `renderer/stars.tsx`);
  jogadores ganham reputação derivada de dados públicos (valor de mercado + clube). Os 6 atributos do treinador passam a valer (`game/coach-engine/coach.ts`):
  tática (força), motivação (vestiário), jovens (evolução até 21 anos), disciplina (cartões), negociação (taxas e salários, inclusive renovação) e
  adaptabilidade (trocas no jogo e confiança em clube novo); efeito zero na base 5 e pequeno no 20. Pontos por temporada (1 + objetivo + título + acesso),
  distribuídos na Diretoria (`board:coachPoint`). Reputação inicial 15–35 conforme o clube; superar a meta com folga dá até +4; confiança ao assumir clube
  novo depende da reputação. Detalhes em `docs/BOARD_JOBS.md`. Testes: 5 novos (`coach.test.ts`: estrelas, regras, neutralidade na base com a mesma semente,
  disciplina/tática/motivação/adaptabilidade na partida, pontos, negociação, jovens) + asserções em board/saves; teste de confiança ao contratar ajustado (65 fixo → fórmula).
  Mutação 14/14. 222 testes. **Não feito:** salário do treinador (não existe; mexeria nas finanças). Estrelas verificadas pelo usuário (nova carreira, visão geral, ficha); painel de atributos/pontos ainda não verificado (precisa de uma virada).
- **Escudos dentro do jogo (correção):** o escudo do pacote (ou o gerado, sem imagem) aparece na barra lateral, no card do clube da Visão geral, no placar da partida e na tabela de Competições — antes só na nova carreira. Barra lateral e calendário verificados pelo usuário.
- **Campinho animado das funções (Táticas):** na janela da função, um campinho horizontal mostra a função sob o mouse (ou a escolhida/automática) com o trajeto do jogador, a bola no lance característico e a zona que ele deixa ou protege nas costas, com etiquetas em texto. Gerado de `RoleDef.fx` (`game/match-engine/roleMotion.ts`), declarado na tela como ilustração das tendências, não lance real. Testes: 2 (`role-motion.test.ts`); mutação 6/6. 224 testes. Tela NÃO verificada.
- **Calendário em grade mensal (pedido do usuário):** abas de julho a junho, semanas de domingo a sábado (`monthGrid` em `shared/date.ts`), escudo do adversário em cada dia de jogo, resultado do ponto de vista do usuário (V verde / E amarelo / D vermelho + placar nossos:deles, com o dia tingido), casa/fora; jogo disputado com relatório abre o relatório. Painel à esquerda: data, escudo do clube, campanha V-E-D, próximo jogo (dias que faltam) e janela de transferências (dias até fechar/abrir, de `windowStatus`). Tela cabe na janela (sem rolagem). Teste da grade; mutação 3/3. 225 testes. Tela verificada pelo usuário.
- **Notícias como rede social (pedido do usuário):** migração 015 (`social_accounts`, `social_posts`, `social_comments`). Perfis: 6 veículos e 5 jornalistas
  FICTÍCIOS (selo azul), perfil oficial de cada liga e de cada clube (selo azul) e torcedores gerados por clube (sem selo). Posts gerados no
  processamento do dia (`processSocialDay`, em `moveClock`: prévia do confronto direto entre líder e vice com até 3 pontos de diferença — no perfil da
  liga e na imprensa —, o jogo do usuário no dia, transferências de ontem ≥ €1 mi ou do usuário, técnicos demitidos ontem, troca de clube do usuário) e da
  rodada (`processSocialMatchday`, em `simulateMatchday`, na mesma transação: jogo do usuário pela imprensa e pelo perfil oficial do clube, zebras e
  goleadas, hat-tricks, lesões de 3+ semanas de jogadores relevantes, fim de rodada da liga do usuário e campeão). 2–5 comentários por post, com tom pelo
  resultado de cada clube; curtidas/compartilhamentos pela reputação. Até 12 posts por dia. Tela `SocialView`: abas Rede / Comunicados do clube (as
  notícias internas de antes), filtros (tudo, meu clube, jogos, mercado, lesões, técnicos, ligas), cartões de placar, transferência, lesão e tabela com
  escudos, "Em alta" (clubes mais citados em 14 dias) e lista da imprensa. Testes: 3 (`social.test.ts`); mutação 6/6 (o teto diário não é exercitado:
  nenhum dia real chega a 12 rascunhos). Carreiras antigas começam com o feed vazio (posts a partir do próximo dia). 229 testes. Tela verificada pelo usuário.
- **Caixa de entrada (pedido do usuário):** os comunicados internos saíram da aba Notícias e viraram a "Caixa de entrada" (área Clube), em estilo e-mail:
  lista à esquerda (remetente, assunto, prévia, data relativa, ponto de não lida; filtros Todas / Não lidas / Pedem ação; marcar todas como lidas) e
  leitura à direita (tipo, assunto, remetente, para o treinador, saudação, corpo em parágrafos, assinatura) com o botão da ação sugerida, que abre a
  tela certa (lesão/suspensão → Táticas, proposta por jogador → Transferências, diretoria → Diretoria, obra → Infraestrutura, olheiro → Olheiros, etc.).
  Contador de não lidas no menu. Migração 016 (tipos médico/mercado/diretoria/elenco, remetente, ação, lida; as antigas entram como lidas).
  Mensagens novas e mais detalhadas: lesão em partida e no treino (posição, previsão de retorno), suspensão (expulsão/5º amarelo), proposta recebida por
  jogador seu (valor, valor de mercado, prazo), alerta da diretoria (limiar de demissão). Testes: 2 (`inbox.test.ts`); mutação 6/6. 231 testes. Tela verificada pelo usuário.
- **Caixa de entrada mais detalhada (pedido do usuário):** todas as mensagens ganharam corpo em parágrafos com os dados do jogo: contratação (posição,
  idade, contrato, elenco e orçamento restante; botão Escalar em Táticas), venda (destino, metade da taxa ao orçamento), renovação (salário antes/depois),
  proposta de emprego (liga, divisão, reputação do clube, o que acontece ao aceitar), demissão (reputação, o que fica no clube), novo clube e início de
  temporada (objetivo, orçamentos, confiança: `boardBrief`), avaliação da temporada (com a confiança final), obras (nível, efeito da instalação), comissão
  técnica e olheiros (o que a função faz), base (lista com potencial estimado na escala 1–20 — antes saía em 0–100), aposentadorias e fins de contrato
  (tamanho do elenco). Mensagens antigas são reclassificadas pelo assunto (lesão → Departamento médico/Táticas; alertas → Diretoria). Teste: toda
  mensagem gerada em 14 rodadas tem mais de um parágrafo; reclassificação. Mutação 5/5. Menu lateral compactado (o item novo fazia aparecer rolagem).
- **Propostas de emprego mais raras com o treinador empregado (pedido do usuário):** 1,2%/dia por vaga, 1 pendente no máximo, 30 dias entre propostas,
  só clubes de reputação igual ou maior que a do atual e o mesmo clube só volta em 90 dias (`OFFER_PACE`, `worthLeaving`). Desempregado sem mudança.
  Teste com todas as vagas abertas o tempo todo (pior caso): 2 a 9 propostas em 240 dias, espaçamento e seletividade conferidos; mutação 4/4.
  Observação: o teste de desempenho da rodada (limite de 2 s) passou de 4 s uma vez com a suíte inteira em paralelo; isolado roda em 1,2 s (oscilação de carga).
- **Técnicos da IA como pessoas (Fase 9, migração 017):** um técnico por clube e um mercado de desempregados; demissão abre vaga e a vaga é preenchida
  por um desempregado de reputação compatível (sem recontratar quem saiu do clube em 2 anos); o usuário substitui o técnico do clube que assume;
  reputação na virada pela campanha; aposentadoria aos 70. Tática e disciplina deles valem nas partidas (calibração medida: gols +1,5%, amarelos −6,7%;
  ver `docs/BOARD_JOBS.md`). Diretoria → "Técnicos" (liga e mercado), posts com nomes, proposta de emprego cita o técnico demitido. Testes: 4
  (`ai-coaches.test.ts`: regras, invariantes depois de uma temporada e da virada, determinismo, substituição pelo usuário, efeito na partida); teste da caixa
  de entrada passou a escolher a amostra entre sementes fixas (as partidas mudaram). Mutação 8/8. 235 testes. Tela verificada pelo usuário.
- **Planilhas (CSV) no editor (Fase 9):** importar/exportar jogadores e clubes (`game/data-pack/csv.ts`, `editorImportCsv`/`editorExportCsv`, canais
  `editor:importCsv`/`editor:exportCsv` com diálogos do sistema). Cabeçalhos em português, Excel brasileiro (`;`, Windows-1252), posições pela sigla,
  datas dd/mm/aaaa, valores com pontos de milhar; altera só o preenchido, cria sem id, ignora linhas sem mudança, tudo ou nada com a linha do erro.
  Nomes dos atributos passaram para `shared/attributeLabels.ts` (ficha do jogador e CSV). Testes: 3 (`csv.test.ts`); mutação 9/9. Telas verificadas pelo usuário.
  Não feito: CSV de países/ligas e na ferramenta de linha de comando (`npm run pack`).
- **Técnicos no universo e fichas (ajuste pedido pelo usuário):** os técnicos passaram a ser gerados com semente fixa a partir do universo
  (`worldCoaches.ts`), iguais em toda carreira; a tela de nova carreira mostra o "Técnico atual" de cada clube (o do clube escolhido fica sem clube ao
  começar). O card "Técnicos" saiu da Diretoria. Competições: clicar no clube abre a ficha do clube (`club:info`) com o técnico e o elenco (sem força:
  de outros clubes só há estimativas no perfil; o jogador abre o perfil); clicar no técnico abre a ficha dele (`coach:info`: atributos, metodologia,
  passagens). Comissão técnica: filtro "Técnicos sem clube" (`coach:unemployed`). Corrigido também o typecheck do motor (`TextDecoder` no csv.ts sem a
  lib DOM). Testes: 1 novo e 1 ampliado em `ai-coaches.test.ts`; mutação 9/9. 239 testes. Fichas, filtro e nova carreira verificados pelo usuário.
- **Técnicos editáveis nos pacotes de dados, com foto (pedido do usuário):** `World.coaches` + arquivo `coaches.json` no formato (criar/alterar/
  remover; técnicos padrão `tec-<clube>`/`tec-livre-N` gerados por semente fixa; um técnico por clube, o padrão vai para o mercado; clube sem
  técnico ganha um gerado), `docs/schema/coaches.schema.json`, exportação da base com técnicos, editor de dados → Técnicos (dados, clube,
  reputação, metodologia, 6 atributos, foto `images/coaches/<id>`), foto na nova carreira, na ficha do clube e na do técnico. A carreira grava os
  técnicos do universo montado (`ensureAiCoaches(db, world.coaches)`); contratações durante o jogo geram ids `tec-novo-N`. Correções visuais:
  hover verde no nome do clube e no cartão do técnico; rolagem interna da tabela de Competições removida. Saves já criados mantêm os técnicos
  que tinham. Testes: `world-coaches.test.ts` (3) e ajuste em `database.test.ts`; mutação 14/14. Telas verificadas pelo usuário.
  Correção: o canal do editor no processo principal recusava o tipo `coaches` ("Dados inválidos"); teste de guarda novo compara as listas de
  tipos do processo principal (editor e imagens) com as do motor (mutação 2/2). 243 testes.
  Não feito: técnicos na planilha CSV.
- **Copas nacionais — etapa 1 (verificação dos regulamentos):** `docs/COPAS_NACIONAIS.md` consolida o que foi lido nos regulamentos
  oficiais (Brasil REC 2026, FA Cup 2026-27, KNVB 2025/26, AFA 2026, JFA 2026, HNS 2026/27, FIGC C.U. 103/A, DFB Durchführungsbestimmungen)
  e o que segue aberto (Espanha, França, Portugal e Áustria sem regulamento obtido; Bélgica, Irlanda e Rússia para depois). Corrigida a fonte
  RFEF do levantamento original (era a Copa del Rey de futsal). Nada implementado.
- **Copas nacionais — etapa 2 (motor):** regra de desempate por partida (`MatchDecider`: prorrogação sim/não, pênaltis, agregado com o
  jogo de ida sem gol fora, 6ª troca na prorrogação) no motor completo e no resultado rápido (`quickKnockout`); `MatchOutcome.aggregate`;
  disputa de pênaltis corrigida para parar assim que um time não alcança mais o outro (antes conferia só a cada par de cobranças).
  Decisão do usuário: onde não há regulamento oficial lido, vale o PDF revisado. Testes: `match-decider.test.ts` (4); mutação 11/11.
  247 testes. Sem tela nova (as copas ainda não existem no jogo).
- **Copas nacionais — etapa 3 (estrutura, banco, telas):** 14 copas (formatos em `game/cup-engine/formats.ts`; México sem copa, Rússia
  bloqueada), chaveamento puro (`bracket.ts`: entradas por divisão, folgas declaradas ou calculadas, sorteios, mando, datas, premiação),
  migração 018 (competições liga/copa, confrontos, cartões por copa; migrador com `rebuildsTables`), `cupRepository.ts` (criação com o
  calendário, sorteio de cada fase na mesma transação da rodada, regra de cada partida, cartões, prêmios, título, chave para a tela), rodada
  integrada (motor e resultado rápido com a regra da fase, campo neutro sem bilheteria, suspensões da copa só na copa), rede social e
  sala de troféus com copas, Competições com a chave, relatório/ao vivo com fase, ida/volta e agregado (e correção: pênaltis direto
  terminam aos 90). Testes ajustados onde supunham só ligas (temporada termina na final das copas; troféus; prêmios = liga + copas).
  Testes: `cups.test.ts` (6); mutação 23/23. Impacto financeiro medido (≈ +2,6 pontos na margem, ver `docs/FINANCE.md`). 253 testes.
  Telas NÃO verificadas. Não feito: supercopas, continentais, Rússia, convidados amadores, suspensões pendentes para a edição seguinte.
  Ajuste pedido pelo usuário: o calendário mostrava "Liga" em todo jogo; agora o jogo de copa traz o nome da copa, a fase e ida/volta
  (`FixtureDto.cup`), com destaque dourado; "Próximo jogo" mostra a competição.
- **Temporada por país (ano civil × julho), supercopas e copas no editor (pedido do usuário, 06/11/2026; sem commit):**
  - *Temporada por país:* `countries.season_start` ('07-01' ou '01-01'; base: Brasil, Argentina e Irlanda no ano civil; o Japão ficou em
    julho porque a J.League passou a ago–mai em 2026/27 — editável no país). Migração 019: `country_seasons` (temporada corrente de cada
    país), `career.season_country`, `cup_formats`. Calendário em `game/career-engine/calendar.ts`; fragmento `CURRENT_COMP` nas consultas.
    Países de ano civil jogam um **torneio de transição** (jul–dez/2026, turno único, sem copa). Virada **por país**: a do país do treinador é
    `startNextSeason` (o relógio para nela); as dos outros acontecem sozinhas dentro de `moveClock` (`autoTurnovers`), cada uma com liga,
    copa, supercopa, acesso/rebaixamento, prêmios, contratos (fim em 31/dez no ano civil), base, aposentadorias e renovações da IA do grupo.
    Contratos assinados/renovados terminam no fim de uma temporada do país do clube. Trocar de emprego segue a temporada do novo país.
  - *Carreira começa em 2027 com clube de ano civil* (decisão do usuário): `createCareer` simula jul–dez/2026 sem o treinador
    (`fastForwardToCareerStart`: partidas pelo resultado rápido, sem rotina diária de treino, sem diretoria avaliando nem propostas) e vira o país
    em 1º/jan/2027 (pré-temporada; 1ª rodada a partir de 31/jan). Custo medido: ~9,6 s com todas as divisões completas da base (antes ~95 s com
    partidas lance a lance). A tela de nova carreira avisa.
  - *Supercopas* (`game/cup-engine/supercups.ts`, PDF de 06/11/2026 com as propostas aceitas): 13 países (sem Áustria, México e Rússia); a partir
    da 2ª temporada com os campeões da anterior (nada inventado); dobradinha pela regra do país (vice da liga, vice da copa, sem jogo na Croácia);
    Espanha com 4 clubes (vagas repetidas para 3º/4º da liga; pareamento como em 2026); mando neutro, do campeão da copa (Alemanha) ou da liga
    (Holanda, Bélgica, Croácia, Itália); prorrogação só em Portugal e Croácia; fim de julho (ano civil: 24/jan; Espanha 8 e 11/jan; Itália 4/jan);
    só troféu. Aparecem em Competições ("Supercopas"), calendário e sala de troféus.
  - *Copas e supercopas no editor de dados:* arquivo `cups.json` nos pacotes (`docs/schema/cups.schema.json`), `World.cups` (padrão das regras
    reais), gravado no save (`cup_formats`) e lido na criação de cada edição. Editor → Copas: nome, ativa, fases de (país do regulamento), janelas
    julho/ano civil, amarelos; supercopa: clubes, dobradinha, mando, prorrogação, datas; logo (`images/cups/<id>`, mostrada em Competições).
    País: campo "Temporada" (julho a junho / ano civil). Correção: o JSON Schema dos técnicos saía sem título.
  - Testes: `calendar-year.test.ts` (4), `supercups.test.ts` (2), `cups-editor.test.ts` (3); ajustes em saves, ciclo de carreira, copas, pacotes.
    262 testes passando (o de desempenho "40 jogos < 2 s" falha às vezes só sob a carga da suíte paralela; isolado passa em ~1 s).
    Mutação: calendário 9/12, supercopas 6/9, editor de copas 6/6 (+1 após teste novo). Sobreviventes: a diretoria parada no período pré-carreira
    (efeito depende do sorteio), escopo das aposentadorias por país, propostas ao treinador no período pré-carreira, deslocamento de data da
    supercopa (não houve conflito no teste), guarda redundante de transição e prêmio zero (equivalente).
  - Telas NÃO verificadas no Electron (calendário de 12 meses do ano civil, rótulos "2027", aviso da nova carreira, Supercopas, editor de copas).
  - Não feito: copa russa, continentais, fases da copa editáveis uma a uma (o editor escolhe o regulamento de um país), supercopa na planilha CSV.
- **Cabeçalho da partida e pênaltis (pedido do usuário após validar as copas; sem commit; tela NÃO verificada):** competição com logo (liga ou
  copa, quando o pacote tem a imagem; senão um troféu), etiquetas de fase (dourada), ida/volta, agregado e "decidido nos pênaltis/na
  prorrogação"; data, local (campo neutro ou casa do mandante), tempo, público, renda e craque em itens com ícone; aviso de relatório resumido
  discreto. Placar: "Fim · pênaltis"/"Fim · prorrogação" e bloco "Pênaltis 7 x 6" com o vencedor destacado e a sequência das cobranças de cada
  time (● convertida, ○ perdida). `MatchReportDto.logo`; `LiveState.kicks`. 262 testes passando.
- **Competições no esboço do usuário e botão Continuar (pedido do usuário, 06/11/2026; sem commit):**
  - *Competições (liga):* classificação à esquerda com Pts logo após o clube, SG com sinal e coluna **Forma** (últimos 5 jogos na
    competição: V/E/D); a faixa colorida da posição usa as cores das zonas e a legenda diz para onde vão: "Acesso (divisão de cima)",
    "Vaga continental", "Rebaixamento (divisão de baixo)" — nomes reais das divisões do país; sem continentais no jogo, a vaga continental
    segue genérica. À direita: **Estatísticas dos jogadores** com seletor (Artilheiros, Assistências, Jogos sem sofrer gols; 10 primeiros;
    clicar abre o jogador ou o clube) e **Jogos da rodada** (rodada em andamento, setas para as outras, placar abre o relatório). A tela cabe na
    janela sem rolagem; em janelas com menos de 1100 px de largura ou 700 px de altura, as colunas empilham e a página rola.
  - *Jogos sem sofrer gols:* migração 020 (`player_season_stats.clean_sheets`): conta para o goleiro que ficou ao menos 60 minutos no gol numa
    partida em que o time não sofreu gol; a migração preenche a partir dos relatórios das partidas já jogadas. Ligas com simulação simplificada
    não têm estatísticas de jogadores (a tela avisa).
  - *Continuar:* substitui "Avançar 1 dia" e "Próxima rodada". Abre a caixa "Avançando o tempo" (data por extenso, faixa de 5 dias com o dia
    atual marcado, "Parar aqui"; clicar num dia futuro marca a parada nele). Cada passo é `continueDay` (motor): simula os jogos do dia que não
    são do seu clube (rodada atômica) e avança um dia por `advanceTime`. Para sozinho no dia de jogo do seu clube (aí aparecem "Simular partida"
    e "Acompanhar ao vivo"), numa decisão importante (mensagem nova de proposta de emprego, proposta por jogador do elenco ou diretoria —
    demissão, alerta, avaliação, título) e na virada da temporada do seu país.
  - Testes: `continue-competitions.test.ts` (3). 265 testes; 263 passando na suíte e os 2 restantes conferidos: a colisão de CSS foi corrigida e o
    teste "40 jogos < 2 s" passa isolado (falha só sob a carga da suíte paralela, já conhecido). Mutação 6/8: sobreviveram o mínimo de 60 minutos
    do goleiro (nos jogos do teste não houve goleiro substituído antes dos 60) e a parada no jogo do usuário logo após avançar (equivalente: o
    passo seguinte para no mesmo dia, sem avançar).
  - Telas NÃO verificadas no Electron (Competições nova, caixa do Continuar).
- **Ficha completa do clube, Visão geral no esboço e conversas/promessas (pedido do usuário, 06/11/2026; sem commit):**
  - *Ficha completa do clube* (`ClubPage.tsx`, `clubProfileRepository.ts`): aberta pelo nome ou pelo botão "Ficha completa" na ficha resumida
    (Competições). Dados, técnico (ficha), campanha na liga (posição, campanha, forma, zona com o destino) e nas copas (na disputa, eliminado,
    campeão, fase), últimos e próximos 5 jogos (placar abre o relatório), elenco com estatísticas da temporada (J, min, G, A, JSG, nota; colunas
    ordenáveis; lesionados marcados; contrato só no seu clube; sem força — de outros clubes só estimativa no perfil), títulos e histórico.
  - *Visão geral* (`OverviewView.tsx`): treinador (com clube, caixa e próximo jogo) e notícias resumidas (6 últimas da rede social) à esquerda;
    conversas e promessas no centro; tabela da liga à direita; diretoria (confiança), torcida (humor) e objetivos embaixo. Cabe na janela;
    em janelas pequenas, uma coluna com rolagem. Os quadros antigos (números do clube, resultados da rodada) saíram: estão em Competições e na ficha.
  - *Conversas e promessas* (decisão do usuário: criar o sistema): migração 021 (`conversations`, `promises`); regras em
    `game/promise-engine/promises.ts`, aplicação em `promiseRepository.ts`, cobrança diária em `moveClock` (`processPromisesDay`). Jogador:
    elogiar, cobrar, prometer minutos, prometer renovação; diretoria: posição na liga, vitórias. Regras e números em `docs/PROMISES.md`.
  - *Humor da torcida*: indicador derivado dos últimos 5 jogos e da posição em relação ao esperado; sem efeito no jogo por ora.
  - Testes: `promises-club.test.ts` (5). 270 testes passando. Mutação 7/7 (anulação ao sair do clube, intervalo entre conversas, limite de
    minutos, prazo da renovação, 5º jogo, ordem dos últimos jogos, limiar de "pedem conversa").
  - NÃO calibrado: efeitos das conversas/promessas em várias temporadas. Telas NÃO verificadas no Electron (ficha completa, Visão geral, janelas de conversa).
- **Livres mais fracos e negociação que não reabre (pedido do usuário, 06/11/2026; sem commit):**
  - Livres com força 14+ vinham dos contratos que a IA deixa vencer (55% de renovação fora dos 14 principais). Agora livres acima de 12
    (`FREE_AGENT_LEVEL`) são contratados por um clube em que sejam reforço (`signStrongFreeAgents`, ver `docs/TRANSFERS.md`). Universo real,
    2 temporadas: de ~30 livres com 14+ para 1–2 logo após cada virada (não é certeza a contratação: 70% na virada, 6% por dia na janela,
    para que um ou outro 14+ fique disponível, pedido do usuário). Teste em `transfers.test.ts`; mutação 2/2. Efeito nas finanças da IA não medido
    em várias temporadas (suíte de finanças passa).
  - Transferências: o jogador escolhido na ficha/olheiros reabria a negociação toda vez que se voltava à tela; agora é descartado ao abrir.
    Botão "Cancelar negociação" (nada fica pendente no motor). Tela NÃO verificada no Electron.
- **Carreira de ano civil começa em 01/01/2026 (pedido do usuário, 06/11/2026; sem commit):**
  - Antes: clube de ano civil começava em 01/01/2027, depois de simular jul–dez/2026 (torneio de transição com acesso/rebaixamento), e os clubes
    chegavam fora das divisões da base. Agora a carreira começa obrigatoriamente em 01/01/2026 (`careerWorld`, `careerService.ts`), sem nada
    simulado; os países de julho jogam um torneio de transição jan–jun/2026 (a partir de 10/jan, turno único, sem copa) e viram para 2026/27 em 1º/jul.
  - Torneio de transição (os dois sentidos) sem acesso nem rebaixamento: divisões da base intactas na primeira temporada normal de todos os países.
  - Base real: criação em ~1 s, 0 clubes fora da divisão da base; transições europeias terminam entre março e maio.
  - Testes: `calendar-year.test.ts` reescrito (início em 2026, transição jan–jun, divisões intactas nos dois sentidos); copas da base contadas em
    duas carreiras (julho + ano civil = 14). Mutação 2/2. 271 testes passando. Telas (aviso da nova carreira) NÃO verificadas no Electron.
  - *Ajuste (pedido do usuário, mesmo dia):* em vez do torneio de transição jan–jun, os países de julho chegam a 01/01/2026 na **metade da
    temporada 2025/26**: o universo começa em 01/07/2025 e jul–dez é simulado na criação (resultado rápido, sem diretoria/rotina do clube);
    os países de ano civil ficam parados nesse período (meta `pre_career`: sem transição), então nenhum clube muda de divisão antes da carreira.
    Base real: ~8 s para criar; 0 clubes fora da divisão da base. Testes de `calendar-year.test.ts` e da copa da base ajustados; mutação 2/2.
  - *Sem torneio de transição (pedido do usuário, 07/11/2026):* o caminho inverso para clubes de julho: o universo começa em 01/01/2026,
    os países de ano civil jogam jan–jun da temporada 2026 (simulados na criação) e os de julho ficam parados até 01/07/2026, quando a carreira
    começa. O torneio de transição foi removido (o período antes da 1ª temporada de um país é parado, sem jogos). Universo com um só calendário
    (mundos de teste) começa direto. Testes: `calendar-year.test.ts`, `saves.test.ts` (14 copas, 1ª rodada do ano civil em julho),
    `sim-levels.test.ts` (a metade simulada segue a semente de cada carreira: só a identidade dos jogadores da base é comparada). Mutação 2/2.
    Tela de nova carreira (aviso e "Simulando jan–jun/2026…") NÃO verificada no Electron.
  - *Verificado pelo usuário (07/11/2026):* criação nos dois sentidos (Brasil em 01/01/2026 com a Premier 2025/26 na rodada 22; Inglaterra em
    01/07/2026 com o Brasileirão 2026 na rodada 22) e a negociação que não reabre. Pendentes: aviso/rótulo do botão na nova carreira, virada
    de 1º/jul vista de uma carreira brasileira e os livres (força dos melhores no filtro "só livres").
  - *Verificado pelo usuário (07/11/2026):* virada de 1º/jul vista de uma carreira brasileira e livres (melhores por volta de 10–12 no filtro
    "Sem clube"). Aviso de início da carreira passou para uma caixa destacada (`nc-start`, ícone de calendário) a pedido do usuário; NÃO verificada.
  - *Verificado pelo usuário (07/11/2026):* caixa do aviso de início da carreira. Seções 13u e do início da carreira completas; 13s (Competições e
    Continuar) confirmada antes pelo usuário. Ainda NÃO verificadas: 13t (ficha completa do clube, Visão geral, conversas e promessas) e 13o2–13r.
  - *Verificado pelo usuário (07/11/2026):* 13r (copas no editor: lista por país, edição da Supercoppa Italiana, exportação .zip e logo em Competições).
  - *Verificado pelo usuário (07/11/2026):* 13o2 (cabeçalho da partida), 13p (temporada por país), 13q (supercopas) e 13t (ficha completa do
    clube, Visão geral, conversas e promessas). Checklist da Fase 9 até 13u validado.
- **Estaduais e Séries C/D — etapa 1: motor de formatos (pedido do usuário, 07/11/2026; sem commit):**
  - Levantamento em `docs/ESTADUAIS.md` (regulamentos oficiais das Séries C e D 2026; 29 estaduais por fontes secundárias; lacunas como ADAPT).
    Decisões do usuário: calendário modelo 2026, estaduais dos 27 estados + A2 de SP e RJ, Série D real (96), Série C com a expansão real.
  - `game/format-engine/engine.ts` (puro): fases de liga (grupo único, grupos, contra os outros grupos, potes), mata-mata (jogo único ou ida
    e volta, chave fixa/semente/sorteio, mando, vantagem do empate, prorrogação, pênaltis), referências entre fases (posição no grupo ou na
    geral, n-ésimo melhor/pior entre os de uma posição, vencedor/perdedor de confronto), fases laterais (Taça Rio, Grupo X, quadrangulares),
    bonificação, campanha somada, classificação final, campeão, títulos, acessos e rebaixamentos, desempate para o motor da partida.
    `computeStandings` ganhou as opções `countAll` (jogos contra outros grupos) e `bonus` (padrão inalterado).
  - `game/format-engine/formats.ts`: Série C 2026/2027/2028+ (REG/SEC), Série D 2026 (REG, chaves do Anexo B), vagas da D por estado
    (`SERIE_D_SPOTS`) e os 29 estaduais (`ESTADUAIS`; formato padrão adaptado onde não houve fonte).
  - Testes: `format-engine.test.ts` (6): todas as competições simuladas até o fim com 2 sementes (rodadas sem conflito, campeão,
    classificação completa, zonas), contagem de jogos por tipo de fase, Série D (fases, chave da 2ª fase, Bloco I, playoffs, 6 acessos,
    65º–96º), regras de confronto, referências e bonificação, determinismo. 277 testes passando. Mutação 8/8.
  - Ainda NÃO ligado ao jogo (etapas 2–5: dados/estados/sem divisão, Séries C e D no banco, calendário 2026, estaduais completos e telas).
