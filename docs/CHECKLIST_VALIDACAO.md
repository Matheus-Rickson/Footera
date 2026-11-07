# Checklist de validação — FOOTERA v0.8.5

Validação manual de tudo o que foi implementado até aqui (Fases 1–8 e lapidação de interface).
Marque `[x]` no que funcionar e anote o que falhar (tela, passos, o que apareceu).
Itens com **(já verificado)** foram conferidos por você em versões anteriores; vale repassar rápido, porque a interface mudou.

Testes automáticos desta versão: `npm test` → 161 de 161 passando; typecheck completo limpo.

---

## 0. Instalação (novo nesta versão)
- [ ] `FOOTERA Setup 0.8.5.exe` instala (por cima da versão anterior, sem desinstalar) (o instalador permite escolher a pasta). O Windows pode mostrar o aviso do SmartScreen porque o instalador não é assinado digitalmente: "Mais informações" → "Executar assim mesmo".
- [ ] O atalho e o executável aparecem como **FOOTERA**, com o ícone verde da prancheta tática.
- [ ] O jogo instalado mostra **as mesmas carreiras** que você já tinha (a pasta dos saves continua `%APPDATA%\football-manager-simulator`).
- [ ] O rodapé da tela inicial mostra `v0.8.5`.
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
- [ ] Tema escuro **grafite** (cinza neutro, como a referência enviada) por padrão; "Tema claro/escuro" no rodapé do menu alterna e fica salvo.
- [ ] Menu lateral agrupado (Clube, Competição, Mercado, Desenvolvimento, Gestão, Carreira), com ícones e item ativo destacado.
- [ ] Barra superior com título, data e ações (Avançar 1 dia / Próxima rodada / Simular / Acompanhar ao vivo / Iniciar nova temporada).
- [ ] Visão geral: indicadores de classificação (com "ver tabela"), caixa, elenco e folha; próxima partida; resultados da rodada.
- [ ] Nenhum botão sem função; textos em português e sem cortes nas telas que você usar.

- [ ] **Posições em português em todas as telas** (GOL, ZAG, LE, LD, VOL, MC, MEI, PE, PD, ATA): Elenco, Contratos, Táticas (lista, opções e campo), Treinamento,
      Departamento médico, Categorias de base, Olheiros, Transferências, Temporada, ficha, negociação e partida. Também no aviso "Escalação ajustada",
      na notícia da peneira e nos promovidos da virada (notícias antigas já gravadas continuam como estavam).

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

- [ ] **Placar centralizado** sobre a coluna dos Eventos; botões à direita.
- [ ] **Sem barra de rolagem** na tela da partida (em tela cheia, 1920×1080): placar compacto em uma faixa; tabelas, eventos e estatísticas rolam por dentro.
- [ ] **Vestiário:** no fim do 1º tempo o jogo pausa sozinho e abre o vestiário; escolher uma fala → "Falar com o elenco" mostra motivados/indiferentes/abalados;
      "Não falar nada" também funciona; "Voltar ao jogo" continua.
- [ ] A conversa vale **só nesta partida**: aparece nos Eventos e não muda a moral gravada no Elenco depois do jogo (só o resultado muda).
- [ ] **Substituições:** botão "Substituições (n/5)" pausa; escolher quem sai e quem entra → "Confirmar"; o jogador muda no campo e na tabela ("Saíram");
      aviso quando entra fora da posição; no máximo 5 trocas.
- [ ] Durante o ao vivo o seu time **não** troca sozinho: nos momentos de troca (58', 66', 74', 82') e em lesões, abre **Sugestão do auxiliar**
      com a troca e o motivo (cansaço, rendimento, buscar/segurar o resultado, lesão); "Fazer esta troca", "Escolher outra troca" ou "Agora não".
- [ ] Sugestão com jogador de **outra posição**: mostra a nova formação (ex.: 4-3-3 → 4-2-3-1) e quem muda de função; "Fazer a troca e mudar a formação"
      atualiza o campo, as posições na tabela e o rótulo da formação no placar; o evento aparece nos Eventos.
- [ ] "Ir para o fim" e "Voltar" no meio do jogo: o auxiliar decide o resto e a rodada é gravada (Voltar pede confirmação).
- [ ] Fechar o jogo no meio do ao vivo: ao reabrir, a partida continua pendente (nada foi gravado).
- [ ] "Simular rodada" (sem acompanhar) continua funcionando como antes.

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

## 13b. Funções táticas (v0.8.6, em validação — use uma carreira NOVA para ver SA/CA)
- [ ] Táticas: cada jogador no campo mostra a função da vaga embaixo do nome (em itálico quando é automática).
- [ ] Clicar num jogador do campo abre a janela "Função de …" (popup): Automática + 3 funções da posição, com descrição, compatibilidade e domínio;
  fecha com Concluir, X, Esc ou clique fora. "Trocar de lugar" fecha a janela e o próximo clique numa posição move o jogador.
- [ ] Escolher uma função salva na hora; trocar o jogador da vaga mantém a função (ela é da vaga); mudar para uma pré-definição volta tudo para automática.
- [ ] Mover um titular para outra posição do campo: a função daquela vaga volta para automática se não servir para a nova posição.
- [ ] "Função a treinar no mês": escolher, avançar até o dia 1º do mês seguinte e ver o domínio subir (Táticas e ficha).
- [ ] Compatibilidade: com o foco de atributos do jogador em **Equilibrado** (Treinamento) e uma função em treino, avançar alguns meses com um jogador jovem e ver a compatibilidade daquela função subir aos poucos (no veterano ela quase não muda).
- [ ] Depois de alguns jogos, o domínio de quem joga numa função cresce.
- [ ] Ficha de um jogador seu: card **Funções** (compatibilidade, domínio e "treinando"). Ficha de jogador de outro clube: sem o card.
- [ ] Carreira nova: elencos com SA e CA; na carreira antiga, ATA pode jogar como SA ou CA.

## 13c. Janela do jogador e posições secundárias (v0.8.7)
- [ ] Táticas: clicar num jogador do elenco abre uma janela com atributos, posições, funções e estatísticas; fecha com X, Esc, clique fora ou "Fechar".
- [ ] "Colocar em campo" fecha a janela e, ao clicar numa posição do campo, o jogador vai para lá; arrastar para o campo continua funcionando.
- [ ] "Ficha completa" abre a ficha inteira; "Voltar" retorna a Táticas.
- [ ] Elenco (save antigo ou carreira nova): nenhum goleiro com segunda posição; secundárias só vizinhas (ex.: ZAG→VOL/LE/LD, CA→SA/MEI, LE→AE/ZAG/ME).
- [ ] Elenco: a página não tem barra de rolagem; só a tabela rola dentro do cartão (testar com a janela menor também).
- [ ] Transferências: colunas FIN/GOL, TEC, PAS, DES, FIS e VEL com faixas ("?" para quem os olheiros conhecem pouco); ao rolar para os lados, a coluna do jogador fica parada.
- [ ] Transferências: o rodapé mostra o total de jogadores disponíveis; ao rolar a lista até o fim, mais jogadores carregam sozinhos.
- [ ] Filtro Posição: marcar ZAG e VOL mostra quem joga em qualquer uma (inclusive como secundária); desmarcar "Incluir… secundária" restringe à natural; clicar no nome do setor marca o setor inteiro.
- [ ] Filtros Perfil (idade, pé, nacionalidade), Contrato e valor (situação, valor, salário, fim do contrato) e Olheiros: cada um filtra e vira uma etiqueta removível; "Limpar tudo" zera.
- [ ] Os menus fecham ao clicar fora ou com Esc; a página de Transferências não tem barra de rolagem externa (em todas as abas).
- [ ] Jogador de outro clube sem observação: força, potencial e atributos aparecem como faixas largas (sem "?"); com "Observar", as faixas estreitam a cada dia; com 100%, mostram um número só.
- [ ] Escala 1–20 em todas as telas: força no Elenco, Táticas (lista, "Na vaga", campo e compatibilidade das funções), ficha, janela do jogador, Treinamento, Base, Contratos, Transferências, Olheiros, partida e Visão geral.

## 13d. Base fixa e países completos × simplificados (Fase 9)
- [ ] Nova carreira: barra de etapas (Países · Clube · Treinador) no topo.
- [ ] Passo 1: cartões limpos (caixa, bandeira, nome); clicar no cartão ou usar espaço/Enter marca e desmarca; atalhos "Só o Brasil", "Todos", "Limpar".
- [ ] País marcado mostra o botão "4/4" (divisões); ele abre um painel com as divisões (fecha ao clicar fora ou Esc); desmarcar vira "3/4" em destaque; a última não desmarca.
- [ ] Explicações só nos ícones de interrogação (passar o mouse ou focar com Tab), nos três passos.
- [ ] Barra inferior fixa com o resumo (completa, simplificada, ritmo) e o botão "Escolher clube" (desabilitado sem países).
- [ ] Resumo: países, ligas e clubes em simulação completa e simplificada, e o ritmo estimado; "Só o Brasil" / "Todos completos".
- [ ] "Escolher clube" (desabilitado sem nenhum país completo) leva ao passo 2.
- [ ] Passo 2: já abre com um clube destacado (o de maior reputação do primeiro país completo) e o painel: escudo gerado, cidade e país,
      liga, estádio e capacidade, objetivo da diretoria e posição esperada, força média, elenco e idade média, reputação, torcida, caixa,
      destaques do elenco e estrutura. Só aparecem clubes de países completos; busca e filtros por país e liga.
- [ ] O objetivo mostrado no painel é o mesmo que aparece na Diretoria depois de iniciar a carreira.
- [ ] Os três passos cabem na janela, sem barra de rolagem da página (só a lista de países, a lista de clubes, o painel do clube e o formulário rolam por dentro em janelas pequenas); o painel de divisões da última linha abre para cima e não é cortado; as interrogações da barra inferior e da lista de clubes abrem para cima.
- [ ] Painel do clube: a imagem do estádio não cobre mais as caixas de informação (objetivo, força, reputação).
- [ ] Lista de clubes: o clube selecionado fica alinhado (linhas não se sobrepõem). Painel em duas colunas (imagem e história | informações, destaques e estrutura) cabe inteiro, sem barra de rolagem, em 1920×1080.
- [ ] Painel do clube: caixa inicial coerente com o porte (o maior da Série A ~€ 34 mi) e com o símbolo €.
- [ ] Valores em € em todas as telas (Visão geral, Finanças, Transferências, negociação, Contratos, Diretoria, Comissão, Olheiros, Infraestrutura, ficha, partida) e nas mensagens/notícias.
- [ ] Passo 3: card "Atributos" com 6 atributos em 5 e "12 pontos restantes"; + e − funcionam (não passa de 15, não desce de 5, + trava sem pontos); "Redistribuir" zera; "Iniciar carreira" só com os 12 pontos usados.
- [ ] Logo do FOOTERA no topo dos três passos; no painel do clube, imagem ilustrativa do estádio (com a etiqueta) e "História e identidade" com a etiqueta "Texto de exemplo"; trocar de clube muda imagem e texto; conferir o encaixe em janela menor.
- [ ] Ao clicar em outro clube, a tela muda suavemente para a cor dele (fundo, faixa do estádio, borda do painel e linha selecionada), nos temas escuro e claro.
- [ ] Criar duas carreiras com o mesmo clube: elencos idênticos (base fixa); resultados diferentes ao jogar (sorte própria de cada carreira).
- [ ] Em jogo: Competições mostra as ligas de todos os países; partidas de país simplificado mostram "só placar" (sem relatório).
- [ ] Visão geral: resultados da rodada só dos países completos (com o aviso).
- [ ] Transferências: jogadores de países simplificados aparecem e podem ser contratados.
- [ ] Tempo de avanço aceitável com o(s) país(es) escolhido(s) (anotar quantos países completos e a sensação de ritmo).

## 13e. Pacotes de dados (Fase 9, etapa 2)
- [ ] Menu principal → "Pacotes de dados": base do jogo travada no topo; lista vazia com instrução.
- [ ] "Importar .zip" com `docs/exemplos/pacote-exemplo.zip`: aparece na lista como válido (clubes e jogadores contados), desativado.
- [ ] Ativar: o resumo do universo muda (clubes/jogadores); importar de novo o mesmo .zip pergunta antes de substituir.
- [ ] Nova carreira com o pacote ativo: passo 1 mostra "Base + 1 pacote(s)"; Série A aparece como "Brasileirão Série A"; a Argentina
      tem os clubes novos (Club Atlético Norte etc.) quando marcada como completa.
- [ ] Na lista de clubes, os 4 clubes do pacote (Club Atlético Norte, Deportivo Sur, Unión Oeste, Racing Este) têm a etiqueta "novo"; no painel aparece "Criado pelo pacote …" (clubes alterados mostram "alterado" / "Alterado por …").
- [ ] Desativar e criar outra carreira: volta ao normal; a carreira anterior não muda.
- [ ] "Abrir pasta" abre a pasta de pacotes; copiar uma pasta de pacote com erro: aparece com "N erro(s)" e não ativa.
- [ ] Remover pede confirmação e some da lista.

## 13f. Editor de dados
- [ ] Menu principal → "Editor de dados": criar um pacote (nome obrigatório) abre a área de trabalho; o pacote aparece ativo em Pacotes de dados.
- [ ] Jogadores: buscar um jogador, mudar nome e alguns atributos — a força muda ao vivo; "Salvar" marca "alterado"; "Restaurar original" volta.
- [ ] Trocar de item com alterações não salvas mostra o aviso (Salvar e continuar / Descartar / Continuar editando).
- [ ] Campo inválido (ex.: atributo 25, nascimento 1960) fica vermelho com a mensagem e "Salvar" não habilita.
- [ ] Criar clube (país, liga, nome, estádio) e um jogador nele pela força; criar carreira nova: clube "novo" com o jogador no elenco.
- [ ] Excluir um clube da base: aparece como "excluído" (com Restaurar); "Só o que este pacote mudou" lista tudo que foi mexido.
- [ ] "Detalhes do pacote" altera nome/versão; "Exportar .zip" salva um arquivo que importa em Pacotes de dados.

## 13g. Goleiros e fotos
- [ ] Editor → um goleiro: aparecem Reflexos, Um contra um, Manejo, Jogo aéreo, Saídas do gol e Reposição; mudar reflexos muda a força ao vivo; o "Goleiro" técnico não aparece para editar.
- [ ] Ficha de um goleiro (Atributos): grupo "Goleiro" com os seis; jogador de linha não mostra o grupo.
- [ ] Cada atributo (editor, ficha e janela do jogador) tem um (?) com o que ele é, o efeito na partida e as posições em que mais pesa; no editor, "Potencial" fica numa seção própria ("Evolução").
- [ ] Editor → clube: "Escudo" e "Foto do estádio" (Escolher…/Trocar…/Remover); jogador: "Foto do jogador". Arquivo que não é imagem é recusado com mensagem.
- [ ] Nova carreira com o pacote ativo: escudo na lista e no painel; foto do estádio no lugar da ilustração (sem a etiqueta "Imagem ilustrativa").
- [ ] Editor → liga: "Logo da liga". Com o pacote ativo, o logo aparece no menu de divisões e na etiqueta da liga do painel (nova carreira) e em Competições.
- [ ] Balão de ajuda (?) no editor fica dentro do quadro do formulário (não invade a lista).
- [ ] Dentro do jogo, com o pacote ativo: escudo do clube na barra lateral, no card "Clube" da Visão geral, no placar da partida (ao vivo e relatório) e na tabela de Competições.
- [ ] Ficha do jogador com foto (no jogo); desativar o pacote em Pacotes de dados: as imagens somem (voltam o escudo gerado e as iniciais).
- [ ] Exportar .zip de um pacote com imagens e importar em outra instalação (ou depois de remover): as imagens voltam.

## 13h. Reputação e treinador
- [ ] Reputação em estrelas (0–5, com meia estrela) em: nova carreira (painel do clube), Visão geral (treinador e clube), Diretoria (treinador e propostas), ficha e janela do jogador, Transferências (coluna Reputação). Nenhum número 0–100 aparece fora do editor.
- [ ] Editor → clube: o campo Reputação mostra a prévia em estrelas ao lado do número.
- [ ] Nova carreira num clube grande: reputação inicial do treinador maior que num clube pequeno (até 3,5 estrelas no máximo).
- [ ] Diretoria → Carreira do treinador: 6 atributos com barra e (?) explicando o efeito; sem pontos, sem botão "+".
- [ ] Depois de uma virada no cargo: notícia da avaliação cita os pontos ganhos; na Diretoria aparece "N ponto(s) para distribuir" e o "+" em cada atributo; o "+" some quando acabam os pontos e fica desativado no 20.

## 13i. Campinho das funções
- [ ] Táticas → clicar num jogador → janela da função: campinho à direita animado; passar o mouse em cada função troca a animação; sem mouse, mostra a escolhida (ou a automática).
- [ ] Lateral Ofensivo vai à linha de fundo e cruza (zona vermelha atrás); Lateral Defensivo fica perto da defesa (zona azul); Falso 9 recua; Goleiro Líbero sai da área. Lado direito espelhado.

## 13j. Calendário
- [ ] Calendário abre no mês atual, em grade (dom–sáb), sem rolagem; abas de julho a junho e setas trocam o mês; meses sem jogo ficam apagados.
- [ ] Dia de jogo: escudo do adversário, Casa/Fora; jogo disputado com V (verde), E (amarelo) ou D (vermelho) e o placar do seu ponto de vista, com o dia tingido; clicar abre o relatório.
- [ ] Painel: data, escudo do clube, campanha V-E-D, próximo jogo com dias restantes e janela de transferências (aberta/fechada e dias até fechar/abrir).

## 13k. Notícias (rede social)
- [ ] Notícias → aba Rede: feed com perfis (avatar, nome, @), selo azul em imprensa, jornalistas, ligas e clubes; torcedores sem selo; data relativa (hoje, ontem, há N dias).
- [ ] Depois de um jogo: post da imprensa com cartão do placar (escudos) e post do perfil oficial do seu clube; comentários de torcedores (2 primeiros e "Ver todos").
- [ ] Prévia do seu jogo no dia; se líder e vice (até 3 pontos de diferença) se enfrentarem, post do perfil oficial da liga com a tabela e matéria da imprensa.
- [ ] Mercado (julho/agosto): transferências relevantes com cartão (de → para, valor em €). Lesões longas, hat-tricks, zebras, goleadas, fim de rodada.
- [ ] Filtros funcionam; "Em alta" lista clubes mais citados.

## 13l. Caixa de entrada
- [ ] Menu Clube → "Caixa de entrada" com contador de não lidas; abrir uma mensagem marca como lida e o contador cai; "Marcar todas como lidas" zera.
- [ ] Mensagem em estilo e-mail (remetente, para, data, saudação, parágrafos, assinatura); filtros Todas / Não lidas / Pedem ação.
- [ ] Lesão de jogador seu (partida ou treino): mensagem do Departamento médico com previsão de retorno e botão "Ajustar a escalação em Táticas", que abre Táticas.
- [ ] Suspensão, proposta por jogador seu (botão para Transferências), alerta da diretoria e proposta de emprego (botão para a Diretoria).

## 13m. Técnicos da IA
- [ ] Nova carreira → painel de cada clube: "Técnico atual" (nome, estrelas, idade, país). Depois de criar, Competições → clicar em outro clube: o mesmo técnico mostrado na criação.
- [ ] Competições → clicar no clube: ficha com reputação, torcida, estádio, técnico e elenco (sem força); clicar num jogador abre o perfil; no seu clube aparece "você".
- [ ] Clicar no técnico: ficha com atributos 1–20, metodologia e passagens (início, fim, motivo da saída). Esc ou clique fora fecha.
- [ ] Comissão técnica → "Técnicos sem clube": lista por reputação (inclui o técnico que você substituiu); cada nome abre a ficha.
- [ ] A Diretoria não mostra mais o card "Técnicos".
- [ ] Competições: passar o mouse no nome do clube só sublinha (sem fundo verde); o cartão do técnico na ficha não fica verde; a página de Competições não rola: só a tabela rola, dentro do quadro (cabeçalho e legenda ficam visíveis).
- [ ] Editor de dados → Técnicos: lista com clube, idade e país; filtros por país e clube; editar reputação/atributos e salvar; criar um técnico num clube (o de lá vai para "Sem clube").
- [ ] Foto do técnico no editor; com o pacote ativo, a foto aparece na nova carreira ("Técnico atual"), na ficha do clube e na ficha do técnico.
- [ ] Pacotes de dados: o cartão do pacote mostra "N técnico(s)" quando ele mexe em técnicos.
- [ ] Ao longo da temporada: demissão aparece na rede social com o nome do técnico e o clube fica com "vaga aberta"; depois, o perfil do clube anuncia o novo técnico.
- [ ] Proposta de emprego cita o técnico demitido ("está sem técnico desde a demissão de …").

## 13n. Planilhas (CSV) no editor
- [ ] Editor → Jogadores (ou Clubes): barra "Planilha" com Importar, Exportar e Modelo; o (?) lista as colunas.
- [ ] Exportar abre "Salvar como"; o arquivo abre no Excel com acentos e colunas certas.
- [ ] Editar algumas linhas no Excel (salvar como CSV), Importar: relatório com criados/alterados/sem mudança; as mudanças aparecem na lista.
- [ ] Planilha com erro (ex.: posição "XYZ" ou clube inexistente): relatório "Importação não realizada" com o número da linha; nada muda no pacote.

## 13o. Copas nacionais
- [ ] Competições → seletor com "Ligas" e "Copas nacionais"; a copa do seu país aparece primeiro entre as copas.
- [ ] Copa: cabeçalho com situação, campeão (no fim), cartões e o que o campeão ganha; o (?) diz o regulamento usado e a origem de cada regra.
- [ ] Fases com datas e regra (jogo único/ida e volta, desempate, mando, sorteio, folgas); fase futura: "Sorteio quando a fase anterior terminar".
- [ ] Confrontos com placares (ida e volta), agregado, "na prorrogação", pênaltis, folga e campo neutro; o vencedor em negrito; seu clube destacado; clicar no clube abre a ficha.
- [ ] Calendário: jogos de copa às quartas-feiras, sem coincidir com a liga, com faixa dourada, o nome da copa ("Fora · Copa do Brasil") e a fase ("5ª fase (ida)"); jogos de liga continuam "Liga". "Próximo jogo" mostra a competição.
- [ ] Caixa de entrada: sorteio da fase (adversário, datas, casa/fora, regra de desempate), folga, título.
- [ ] Partida de copa ao vivo/relatório: fase e "jogo de ida/volta" no cabeçalho, agregado na volta; jogo com pênaltis direto termina aos 90 (sem prorrogação) e vai aos pênaltis.
- [ ] Finanças: cotas e prêmios da copa no extrato; final em campo neutro sem bilheteria.
- [ ] Sala de troféus: títulos de copa.
- [ ] Carreira antiga: ao abrir antes da 1ª fase, a copa da temporada aparece; depois dela, só na próxima temporada.

## 13o2. Cabeçalho da partida
- [ ] Relatório/ao vivo: nome da competição com logo (se houver no pacote), etiquetas (fase em dourado, ida/volta, agregado, decidido nos pênaltis/prorrogação) e itens com ícone (data, local, tempo, público, renda, craque).
- [ ] Jogo decidido nos pênaltis: "Fim · pênaltis" e bloco "Pênaltis 7 x 6" com o vencedor em verde e as bolinhas de cada cobrança (cheia = convertida, vazia = perdida).
- [ ] Jogo de outros clubes: aviso "Resumo: só os eventos-chave" discreto.

## 13p. Temporada por país (ano civil)
- [x] Nova carreira com clube do Brasil/Argentina/Irlanda (ou europeu): caixa destacada "A carreira começa em 01/01/2026" (ou 01/07/2026) acima dos botões; criar leva alguns segundos ("Simulando…").
- [x] A carreira abre em 01/01/2026, "Temporada 2026"; os clubes estão nas divisões da base (nenhum rebaixado antes de começar).
- [x] Competições: "Série A 2026"; ligas europeias em "2025/26" com cerca de metade das rodadas jogadas e copas em andamento; em 1º/jul/2026 viram para 2026/27.
- [x] Carreira com clube europeu: começa em 01/07/2026 ("Simulando jan–jun/2026 nos outros países…"); Brasileirão 2026 na metade, com as divisões da base; nenhum "Torneio de Transição".
- [ ] Calendário: meses de janeiro a dezembro; 1ª rodada no fim de janeiro/início de fevereiro.
- [ ] Contratos: renovar mostra fim em 31/12; a virada é em 1º/jan ("Iniciar temporada 2028"; janela de janeiro).
- [ ] Clube europeu: a temporada continua julho a junho; em 1º/jan os países de ano civil viram sozinhos (o relógio não para).
- [ ] Editor → Países: campo "Temporada" (julho a junho / ano civil).

## 13q. Supercopas
- [ ] 2ª temporada: Competições → grupo "Supercopas"; jogo no fim de julho (Espanha e Itália em janeiro; ano civil em 24/jan), antes da liga.
- [ ] Participantes: campeão da liga × campeão da copa (dobradinha pela regra do país); Espanha com semifinais e final; Croácia sem jogo na dobradinha.
- [ ] Cabeçalho: "Vale só o troféu"; sem lançamento em Finanças; título na Sala de troféus.

## 13r. Copas no editor de dados
- [ ] Editor → Copas: lista com copa e supercopa por país (filtro por país); "desativada" aparece na lista.
- [ ] Alterar nome, janela, amarelos; desativar uma supercopa; criar uma copa para um país novo escolhendo "Fases de".
- [ ] Logo da competição: enviar imagem; aparece em Competições ao lado do seletor (com o pacote ativo, numa carreira nova).

## 13s. Competições (esboço) e Continuar
- [x] Competições → liga: classificação com Pts, SG com sinal e Forma (quadradinhos V/E/D); faixa colorida nas posições de acesso, vaga continental e rebaixamento; a legenda nomeia a divisão de destino.
- [x] Estatísticas dos jogadores: trocar entre Artilheiros, Assistências e Jogos sem sofrer gols; clicar no nome abre o jogador e no clube abre a ficha.
- [x] Jogos da rodada: abre na rodada em andamento; setas mudam a rodada; placar de jogo jogado abre o relatório; seu jogo destacado.
- [x] Nenhuma barra de rolagem na tela de Competições (janela maximizada).
- [x] Topo: botão "Continuar" no lugar de "Avançar 1 dia"/"Próxima rodada"; a caixa "Avançando o tempo" mostra os dias passando.
- [x] O tempo para sozinho no dia de jogo do seu time (aparecem "Simular partida" e "Acompanhar ao vivo") e em proposta/diretoria (aviso com o título da mensagem).
- [x] "Parar aqui" para no dia atual; clicar num dia futuro da faixa para nele.

## 13t. Ficha completa do clube, Visão geral e conversas
- [ ] Competições → clique num clube → na ficha resumida, clicar no nome (ou "Ficha completa") abre a tela cheia; "Voltar" retorna.
- [ ] Ficha completa: campanha, copas, últimos/próximos jogos (placar abre o relatório), elenco ordenável com J/Min/G/A/JSG/Nota, títulos e histórico; jogador abre o perfil.
- [ ] Visão geral: treinador, notícias, conversas e promessas, tabela (zonas coloridas), diretoria/torcida/objetivos; sem rolagem na janela maximizada.
- [ ] "Conversar com jogador": escolher um jogador, ver moral/forma; elogiar/cobrar mostra o resultado; depois, os temas ficam bloqueados por 14 dias.
- [ ] Prometer minutos/renovação aparece em "Promessas em aberto" com o andamento; no fim, mensagem "Promessa cumprida/quebrada" na Caixa de entrada.
- [ ] "Falar com a diretoria": prometer posição ou vitórias; confiança sobe na hora; desfecho chega como mensagem (o Continuar para).
- [ ] Jogador com moral abaixo de 40 aparece em "Pedem conversa".

## 13u. Livres e negociação
- [x] Transferências → filtro "só livres": os melhores ficam por volta de 12 (estimativa); só um ou outro 14+ depois de uma virada.
- [x] Ficha de um jogador → "Fazer proposta" → "Cancelar negociação"; sair e voltar a Transferências: a janela NÃO reabre.

## 14. Persistência
- [ ] Fechar no meio de uma temporada e reabrir: data, resultados, finanças, contratos, olheiros, treino, obras e diretoria continuam iguais.
- [ ] Sair e entrar na mesma carreira não refaz partidas nem cobra mês duas vezes.

---

**Fora do escopo desta versão** (planejado): exportar/importar saves e backups (Fase 10), outros países e competições continentais (Fase 9).
O botão "Importar save" na tela inicial aparece desativado, com "em breve (Fase 10)".
