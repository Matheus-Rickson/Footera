# Checklist de validação — FOOTERA v0.8.1

Validação manual de tudo o que foi implementado até aqui (Fases 1–8 e lapidação de interface).
Marque `[x]` no que funcionar e anote o que falhar (tela, passos, o que apareceu).
Itens com **(já verificado)** foram conferidos por você em versões anteriores; vale repassar rápido, porque a interface mudou.

Testes automáticos desta versão: `npm test` → 152 de 152 passando; typecheck completo limpo.

---

## 0. Instalação (novo nesta versão)
- [ ] `FOOTERA Setup 0.8.1.exe` instala (o instalador permite escolher a pasta). O Windows pode mostrar o aviso do SmartScreen porque o instalador não é assinado digitalmente: "Mais informações" → "Executar assim mesmo".
- [ ] O atalho e o executável aparecem como **FOOTERA**, com o ícone verde da prancheta tática.
- [ ] O jogo instalado mostra **as mesmas carreiras** que você já tinha (a pasta dos saves continua `%APPDATA%\football-manager-simulator`).
- [ ] O rodapé da tela inicial mostra `v0.8.1`.
- [ ] A desinstalação (Configurações do Windows → Aplicativos) remove o jogo e **mantém** os saves.

## 1. Tela inicial e perfis
- [ ] Aparecem o logo, **FOOTERA** e "Build your club. Create your legacy.", nos temas escuro e claro.
- [ ] O título da janela é "FOOTERA".
- [ ] Criar perfil; tentar um nome vazio e um repetido (erro em vermelho). **(já verificado)**
- [ ] "Última carreira" → Continuar; Carregar carreira lista todas. **(já verificado)**
- [ ] Fechar e reabrir: perfil, carreiras e tema escolhido continuam. **(já verificado)**

## 2. Nova carreira
- [ ] Escolher clube, preencher o treinador e uma foto PNG/JPEG → Iniciar. **(já verificado)**
- [ ] Um `.txt` renomeado para `.png` é recusado; data de nascimento recente é bloqueada. **(já verificado)**

## 3. Interface geral (lapidação)
- [ ] Tema escuro **azul meia-noite** por padrão; "Tema claro/escuro" no rodapé do menu alterna e fica salvo.
- [ ] Menu lateral agrupado (Clube, Competição, Mercado, Desenvolvimento, Gestão, Carreira), com ícones e item ativo destacado.
- [ ] Barra superior com título, data e ações (Avançar 1 dia / Próxima rodada / Simular / Acompanhar ao vivo / Iniciar nova temporada).
- [ ] Visão geral: indicadores de classificação (com "ver tabela"), caixa, elenco e folha; próxima partida; resultados da rodada.
- [ ] Nenhum botão sem função; textos em português e sem cortes nas telas que você usar.

## 4. Calendário e competições
- [ ] Calendário com 38 jogos, alternando casa e fora. **(já verificado)**
- [ ] Competições: as 4 ligas, zonas coloridas e classificação calculada a partir dos jogos. **(já verificado)**
- [ ] "Avançar 1 dia" e "Próxima rodada" param no dia de jogo. **(já verificado)**

## 5. Acompanhamento da partida (novo nesta versão)
- [ ] "Acompanhar ao vivo" abre a partida **em tela cheia, sem menu lateral nem barra superior**; "Voltar" devolve o painel.
- [ ] Placar, minuto e situação (Pré-jogo / Ao vivo / Pausado / Encerrado) e barra de progresso.
- [ ] Iniciar/Pausar, velocidade 1×/2×/4×, Ir para o fim, Assistir do início.
- [ ] Campo de cada time (laterais): iniciais, **nota mudando** ao longo do jogo, ícones de gol, assistência, cartão, substituição e lesão.
- [ ] Tabelas dos times: posição, nome, força (só do seu time; os rivais mostram "—"), **condição caindo**, nota, minutos, gols; seção "Saíram".
- [ ] Eventos: mandante à esquerda e visitante à direita, placar em cada gol, intervalo e fim; "Lances menores" mostra faltas, impedimentos etc.
- [ ] Campo animado: bola e jogadores se movem a cada minuto, "GOL!" aparece nos gols; o texto abaixo explica que é uma representação.
- [ ] Estatísticas mudam durante o jogo (posse, xG, finalizações, no alvo, escanteios, faltas, cartões, passes, desarmes, defesas).
- [ ] Ao final: craque do jogo, público e renda, e táticas dos dois times.
- [ ] Partidas → relatório de um jogo **antigo** (antes desta versão): abre no fim, com aviso de que as notas e estatísticas ao vivo não existem para ele.
- [ ] Relatório de jogo de outros clubes: aviso de relatório resumido.
- [ ] A condição dos jogadores no Elenco, depois do jogo, bate com a mostrada no fim da partida.

## 6. Táticas e escalação
- [ ] 7 esquemas padrão; duplicar, editar formação/controles/escalação manual, salvar, ativar. **(já verificado)**
- [ ] Nome vazio ou repetido dá erro. **(já verificado)**
- [ ] A partida usa a formação e os jogadores escolhidos; jogador lesionado ou suspenso gera aviso de escalação ajustada. **(já verificado)**

## 7. Elenco e ficha do jogador (novo nesta versão)
- [ ] Elenco: clicar no nome abre a ficha.
- [ ] Cabeçalho: avatar, selo NÍVEL, nacionalidade, clube, posição (GOL/ZAG/LE/LD/VOL/MC/MEI/PE/PD/ATA), pé, idade e nascimento, personalidade, altura/peso, condição e moral.
- [ ] Faixa: valor, salário, fim do contrato, potencial; botão Voltar.
- [ ] Aba Visão geral: barras por grupo e radar, mapa de posições, gráfico de evolução, estatísticas da temporada e últimos 5 jogos com nota.
- [ ] Aba Atributos: os 23 atributos (1–20). Aba Histórico: transferências e força por temporada.
- [ ] Jogador de **outro clube**: NÍVEL e atributos aparecem como faixas estimadas; personalidade e moral aparecem como "?" abaixo de 50% de conhecimento dos olheiros; sem evolução por temporada.

## 8. Transferências (novo nesta versão)
- [ ] Abas Mercado, Propostas recebidas, Meus jogadores e Histórico; situação da janela, caixa e elenco no topo.
- [ ] Mercado carrega sozinho; a busca por nome e os filtros (posição, idade, valor máximo, só livres, Limpar) atualizam a lista.
- [ ] Sinalizações ao lado do nome: binóculo (observado), cruz (lesionado, com data no tooltip), suspenso, cartões amarelo/vermelho com o número.
- [ ] Colunas: clube, nacionalidade, posição, secundárias, idade, nível e potencial estimados, pé, altura, peso, valor, salário, contrato, olheiros; Observar/Negociar fixos à direita.
- [ ] Clicar no nome abre a ficha completa; voltar mantém os filtros.
- [ ] **Negociação, etapa Proposta** (janela aberta): disposição do clube, interesse do jogador, caixa, orçamento e folha. Uma taxa baixa é recusada; uma intermediária recebe contraproposta, com "Aceitar valor"; ao aceitar, segue para o Contrato.
- [ ] **Etapa Contrato:** salário e temporadas, "folha após a contratação" comparada ao teto. Salário baixo recebe contraproposta, com "Aceitar salário pedido". Concluir leva à **Assinatura**.
- [ ] Jogador **livre**: pula a taxa e funciona com a janela fechada.
- [ ] Com a janela fechada, "Negociar" fica desativado para jogadores com clube (o tooltip mostra quando abre).
- [ ] A compra concluída aparece no Elenco, no caixa, no extrato de Finanças e no Histórico. **(fluxo base já verificado)**
- [ ] Meus jogadores → marcar transferíveis → propostas recebidas → aceitar/recusar. **(já verificado)**
- [ ] A diretoria veta valores fora da realidade (ex.: mais de 2× o valor de mercado) ou acima do orçamento. **(já verificado)**
- [ ] "Fazer proposta" na ficha e "Negociar" nos Olheiros abrem a mesma janela de negociação.

## 9. Finanças
- [ ] Caixa, patrocínios, gráfico mensal com tooltip de composição (mouse e Tab), último mês, projeção com bilheteria. **(já verificado)**
- [ ] Bilheteria em jogos em casa; extrato com cada lançamento; o caixa da Visão geral bate com o de Finanças. **(já verificado)**
- [ ] Salários de olheiros, base e comissão entram no dia 1º; multas de demissão aparecem no extrato. **(já verificado)**

## 10. Contratos e ciclo de temporada
- [ ] Contratos: destaque dos que vencem; renovação com recusa, contraproposta e aceite; o painel mostra "Novo contrato até …". **(já verificado)**
- [ ] Fim de temporada → avançar até 01/07 → Iniciar nova temporada → relatório (posição, prêmio, campeões, acessos/rebaixamentos, jovens, saídas). **(já verificado)**
- [ ] Histórico da carreira, Sala de troféus e Notícias registram a temporada. **(já verificado)**

## 11. Olheiros e categorias de base
- [ ] Contratar, designar (país ou lista de observação) e demitir olheiros; o conhecimento sobe e as faixas estreitam. **(já verificado)**
- [ ] Relatórios abrem a ficha; contratar a partir do relatório. **(já verificado)**
- [ ] Base: promover e dispensar; peneira em 15/03; quem faz 19 anos e não foi promovido sai na virada. **(já verificado)**

## 12. Treino, comissão técnica, médico e infraestrutura
- [ ] Treino pelo técnico (intensidade e foco) ou delegado ao preparador físico (focos sugeridos e travados). **(já verificado)**
- [ ] Evolução mensal na coluna "Na temporada". **(já verificado)**
- [ ] Departamento médico: lesionados, previsão de retorno, "Em risco"; efeito do nível em uma casa decimal. **(já verificado)**
- [ ] Infraestrutura: obra com custo e prazo, barra de progresso, nível sobe ao concluir. **(já verificado)**

## 13. Diretoria e empregos
- [ ] Objetivo, meta, confiança e orçamentos; a confiança muda com os resultados. **(já verificado)**
- [ ] Pedidos de orçamento (negados com confiança baixa; um de cada por temporada). **(só por testes automáticos)**
- [ ] Obra cara negada com confiança baixa. **(só por testes automáticos)**
- [ ] Propostas de emprego: aceitar troca de clube na hora. **(só por testes automáticos)**
- [ ] Demissão: menu restrito, treinador sem clube e chegada de propostas. **(só por testes automáticos)**

## 14. Persistência
- [ ] Fechar no meio de uma temporada e reabrir: data, resultados, finanças, contratos, olheiros, treino, obras e diretoria continuam iguais.
- [ ] Sair e entrar na mesma carreira não refaz partidas nem cobra mês duas vezes.

---

**Fora do escopo desta versão** (planejado): exportar/importar saves e backups (Fase 10), outros países e competições continentais (Fase 9).
O botão "Importar save" na tela inicial aparece desativado, com "em breve (Fase 10)".
