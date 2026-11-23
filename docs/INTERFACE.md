# Interface "Estádio noturno"

Redesenho completo da interface pedido pelo usuário ("mais cara de jogo, mantendo a base"), em 5 lotes, um por versão (0.8.14 a 0.8.18).
Branch `interface-estadio`. Motor, banco, IPC e funcionalidades não mudam. A única chamada nova é `club:colors`.

Decisões do usuário (20/11/2026):
- **Estilo**: estádio noturno, com fundo **`#03050a`**.
- **Navegação**: barra superior com 6 abas.
- **Cor de destaque**: vem do escudo do clube.
- **Escopo**: todas as telas.

## Lotes
| Lote | Versão | Telas | Estado |
|---|---|---|---|
| 1 | 0.8.14 | Fundação (tokens, fonte, componentes, cores do escudo), barra superior, menu principal, Carregar carreira, Nova carreira (cor do clube), Visão geral, caixa "Avançando o tempo" | feito; aguardando validação no `npm run dev` |
| 2 | 0.8.15 | Elenco, ficha do jogador, Táticas, Contratos, partida (ao vivo, relatório, vestiário) | feito; aguardando validação no `npm run dev` |
| 3 | 0.8.16 | Competições, fases e mata-mata, ranking CONMEBOL, Calendário, Temporada, ficha do clube, Sala de troféus, Histórico | pendente |
| 4 | 0.8.17 | Transferências, negociação, Olheiros, Base, Treinamento, Comissão técnica, Médico | pendente |
| 5 | 0.8.18 | Finanças e gráficos, Infraestrutura, Diretoria, Caixa de entrada, Notícias, Pacotes, Editor, ajuda e limpeza do CSS antigo | pendente |

As telas dos lotes 3 a 5 já herdam o visual novo (tokens, fonte, botões, painéis e tabelas), mas ainda não têm redesenho próprio.

## Estilos (`src/renderer/styles/`)
- `index.css` define a ordem da cascata: `tokens` → `base` → `legacy` → `ui` → `common` → `shell` → `home` → `overview` → `squad` → `player` → `tactics` → `match`.
  - `legacy.css` guarda o CSS das telas ainda não redesenhadas. Cada lote move a sua área para um arquivo próprio e apaga o trecho de lá.
- **Regra 8**: nenhuma classe simples se repete em **todos** os arquivos juntos (`styles-commentary.test.ts`).
  - Dentro de `@media`, use um seletor composto (ex.: `.nv .nv-top`), como já era feito antes.
- **Tokens** (`tokens.css`):
  - fundo `--bg: #03050a`; superfícies `--surface*` no mesmo azul quase preto; borda luminosa `--edge`/`--edge-hi`; vidro `--glass`;
  - fundo de estádio `--stadium`: faixas de gramado e brilho de refletor bem sutis;
  - marca do jogo `--brand`/`--primary` (verde de gramado iluminado);
  - estados `--danger`, `--warning`, `--info`, reservados e sempre acompanhados de rótulo;
  - tema claro "dia de jogo" em `data-theme="light"`.
- **Fontes**:
  - títulos, números, abas e botões em **Barlow Condensed** 600/700/800 (OFL), empacotada pelo `@fontsource/barlow-condensed` 5.3.0
    (subconjuntos latin e latin-ext): o jogo continua offline e a CSP continua `'self'`;
  - corpo do texto em Segoe UI Variable.
- **Movimento**:
  - entrada dos painéis (`ui-rise`) e pulso do botão em dia de jogo (`ui-pulse`);
  - tudo desligado com `prefers-reduced-motion`.

## Cor do clube
- **Cálculo** (`src/shared/crestColor.ts`, função pura e testada):
  - `crestColors(pixels, w, h, 'rgba' | 'bgra')` ignora pixels transparentes (alfa < 128), quase pretos, quase brancos e cinzas
    (saturação < 0,28);
  - agrupa os pixels em 24 faixas de matiz, somando as vizinhas. A **primária** é a faixa com mais pixels, e a **secundária** é outra
    faixa a ≥ 45° com pelo menos 12% dos pixels coloridos (se não houver, a primária escurecida);
  - escudo com menos de 6% de pixels coloridos (preto e branco) recebe a **paleta prateada neutra**.
- **Contraste** (WCAG):
  - primária e secundária são clareadas até **3:1** contra `#03050a`, e a cor de texto até **4,5:1**;
  - a tinta sobre a primária é quase preto ou branco, o de maior contraste;
  - no tema claro, as mesmas matizes são escurecidas até 3:1 e 4,5:1 contra o branco.
- **No processo principal** (`main.ts`, IPC `club:colors`):
  - `nativeImage` reduz o escudo a 32 px de largura e `toBitmap()` entrega os pixels em **BGRA no Windows** (conferido no Electron
    37: pixel vermelho `220,10,40` saiu `40,10,220`);
  - o resultado fica em cache por arquivo e data de modificação;
  - clube sem imagem de escudo devolve `null`.
- **Na tela** (`src/renderer/clubColors.ts`):
  - `useClubPalette(clubId)` guarda as paletas de todas as telas e as recalcula quando a versão do índice de imagens muda;
  - sem escudo, usa as matizes do escudo gerado (`clubHues` → `paletteFromHues`), as mesmas que o jogador vê no escudo.
- **Variáveis CSS**: `clubVars(p)` escreve `--club-d`, `--club-text-d`… no elemento, e a classe `.club-scope` transforma essas
  variáveis em `--club`, `--club-2`, `--club-text`, `--club-ink`, `--club-soft` e `--club-glow`, conforme o tema.
- **Onde aparece**:
  - na carreira: aba ativa, botão Continuar, filete da barra, linha do clube nas tabelas, traço dos painéis e dia atual em
    "Avançando o tempo";
  - fora da carreira: carreira mais recente no menu e "slots" de Carregar carreira;
  - em Nova carreira: o clube destacado.

## Componentes (`src/renderer/ui/index.tsx`)
- `Panel`: painel com faixa de título e ações.
- `StatTile`: número grande com rótulo e detalhe.
- `Meter`: faixa 0–100 com o número ao lado e a cor como reforço, nunca como única informação.
- `FormStrip`: forma V/E/D.
- `MatchBanner`: cartaz da partida com as cores dos dois clubes, competição, fase, ida/volta e casa/fora/campo neutro.
- `SegFilter` (lote 2): filtro em segmentos com contagem (setor, situação), na cor do clube.
- Os lotes seguintes podem acrescentar `DataTable` e `PlayerChip`.

## Navegação (`CareerDashboard.tsx`)
**Linha 1**:
- escudo, nome do clube (até 2 linhas), liga e posição;
- as 6 abas;
- Caixa de entrada com contador;
- botão principal: **Continuar**, **Simular / Jogo ao vivo** (pulsando) no dia de jogo, ou **Nova temporada**;
- tema e menu principal.

**Linha 2**: as subseções da aba e a data com a temporada.

| Aba | Subseções |
|---|---|
| Clube | Visão geral, Caixa de entrada, Notícias, Temporada, Sala de troféus, Histórico |
| Elenco | Elenco, Táticas, Contratos, Treinamento, Médico |
| Competições | Calendário, Competições |
| Mercado | Transferências, Olheiros |
| Desenvolvimento | Base, Comissão técnica, Infraestrutura |
| Gestão | Finanças, Diretoria |

Comportamento:
- Voltar a uma aba reabre a última subseção visitada nela.
- Sem clube, as subseções que dependem de elenco ficam bloqueadas (`UNEMPLOYED_VIEWS`), e uma aba fica bloqueada quando todas as dela
  estão.
- Durante a partida, a barra some: a partida ocupa a tela inteira.
- A janela não rola; quem rola é a área de conteúdo. As telas que cabem na janela (`content-fit`) só rolam nas listas internas.

## Lote 2 (v0.8.15): Elenco, ficha, Táticas, Contratos e partida
- **Peças compartilhadas** (`styles/common.css`, saídas do `legacy.css`):
  - janela modal em vidro escuro com traço na cor do clube;
  - selo de posição com a **cor do setor** (goleiro âmbar, defesa azul, meio verde, ataque vermelho) como reforço da sigla
    (`PosPill` ganhou a classe `pf-pos-<setor>` por `groupOf`);
  - força num selo chanfrado (`sq-ovr`), cores de nível ajustadas aos dois temas, cartões, sinalizações e abas internas
    (`pf-tab`) com a barra iluminada na cor do clube; estas abas aparecem também em Finanças, Treinamento, Transferências etc.
- **Elenco** (`styles/squad.css`): painel com o filtro de setor (`SegFilter`), indicadores (jogadores, força, idade e condição médias)
  e a tabela rolando por dentro; números na fonte condensada.
- **Contratos** (`styles/squad.css`): indicadores que filtram (com brilho na cor do clube quando ligados), filtros em segmentos com
  contagem, linha selecionada na cor do clube, painel do jogador com as abas novas e o tempo de jogo em segmentos.
- **Ficha do jogador** (`styles/player.css`): cartaz nas **cores do clube do jogador** (sem clube: as do seu), foto em moldura chanfrada,
  força em destaque, condição e moral com `Meter`, contrato em `StatTile`, painéis com faixa de título; radar e curva de
  desenvolvimento na cor do clube; campinho das posições com classes próprias (`pf-pitch-*`). Janela compacta de Táticas no mesmo estilo.
- **Táticas** (`styles/tactics.css`): pré-definições em segmentos, campo noturno (refletores nos cantos, vinheta), crachás com a camisa
  na cor do clube e o anel de encaixe na posição; janelas de função e de estilo de jogo no estilo novo.
- **Partida** (`styles/match.css`): placar de transmissão (bloco chanfrado escuro, relógio condensado, "ao vivo" pulsando), faixas e
  barras nas **cores dos dois escudos**, gols com a faixa de quem marcou, campos noturnos, vestiário e sugestões do auxiliar no estilo novo.
- **Cores dos times na partida** (`shared/crestColor.ts`, puro e testado):
  - `matchSides(casa, fora)`: o mandante joga com a primária; o visitante, com a primeira de primária, secundária, prata, âmbar e azul que
    não se confunda com a do mandante (como o uniforme reserva);
  - `colorsClash`: matizes a menos de 45° se confundem; um cinza (croma < 0,12) e uma cor nunca; dois cinzas só com brilho parecido (< 0,22);
  - texto sobre cada cor (`ink`) é quase preto ou branco, o de maior contraste;
  - `MatchReport.tsx` escreve `--mc-home`, `--mc-away` e as tintas no `.mc`; sem paleta, azul × vermelho.
- **Retirado do CSS antigo, sem uso em nenhuma tela**: relatório de partida antigo (`scoreboard`, `comm`, `k-*`), campinho antigo
  (`pitch*`, `dot-*`), táticas antigas (`tactics`, `schemes`, `slot*`), `sq-group`, `tc-chip`, `tc-seg`, `kt-chips`, `kt-tabs`,
  `kt-status-pick` e `pq-foot`. A classe `attrs` ficou sem uso (sai na limpeza do lote 5).

### Verificação do lote 2 feita pelo assistente
- Testes: `match-sides.test.ts` (5) e a guarda de CSS em todos os arquivos. Suíte completa 389/389; `npm run typecheck` ok.
- Mutações mortas (5 de 5): limiar de matiz zerado, visitante sem a secundária, cinza contra cor sempre comparado pelo brilho
  (sobreviveu na 1ª rodada e passou a ser detectada com o caso prata × azul-claro), tinta sempre branca, brilho dos cinzas ignorado.
- Capturas do jogo compilado numa instância isolada (`--user-data-dir` temporário; a instância via 0 perfis, os saves do usuário não foram
  tocados), carreira de teste na base sem pacotes (clube brasileiro de maior reputação):
  - Elenco (escuro, claro e 1024×640), ficha (visão geral e atributos), Táticas (campo, janela de função, janela do jogador, tema claro),
    Contratos (lista e painel);
  - três partidas ao vivo (início, vestiário, sugestão do auxiliar, 2º tempo, fim, tema claro); nenhum erro no console.
- Ajustes feitos a partir das capturas:
  - iniciais dos crachás de Táticas ilegíveis no tema claro (a cor de nível vencia a tinta do clube): seletor mais específico;
  - nomes longos no placar viravam "ASS…": quebram em duas linhas e a coluna do placar ficou mais larga.
- **Achado de ambiente**: o terminal do VS Code define `ELECTRON_RUN_AS_NODE=1`; o Electron só abre a janela sem essa variável.

### Ajustes pedidos pelo usuário no primeiro teste (tela 1919×1032)
**Validados pelo usuário no `npm run dev` em 23/11/2026** (todos os itens desta seção). O restante do lote 2 segue na tabela acima.
- **Correção de raiz** (`shell.css`): a regra do lote 1 que impede avisos de encolher (`.content-fit > *`) tinha a mesma
  especificidade das raízes das telas (`.cl`, `.so`…) e vencia por vir depois; telas como o Calendário não esticavam até o pé
  da janela. Agora é `:where(.content-fit > *)` (especificidade zero) e cada tela decide se estica.
- **Calendário**: a grade ocupa a altura toda; número do dia, placar, adversário e competição maiores, na fonte condensada;
  escudo de 30 para 40 px; o dia de hoje brilha na cor do clube; o número do dia fica preso no canto (num `<button>`, dia com
  relatório, o Chromium centralizava o conteúdo e o número descia); meses menores abaixo de 1600 px para caberem numa linha.
- **Táticas** e **Contratos** passaram a "caber na janela" (`content-fit`): só a lista do elenco/dos contratos e o painel do
  jogador rolam por dentro; o campo de Táticas ocupa a altura que sobra mantendo a proporção. Abaixo de 1200 px de largura
  (Táticas), 1100 px (Contratos) ou 680 px de altura, voltam a empilhar e a página rola.
- **Táticas**: os crachás usam uma faixa interna do gramado (4% a 88% da altura); o goleiro ficava a 95% e o nome, a posição e a
  função saíam pela borda de baixo.
- **Táticas — posições livres só ao arrastar**: os círculos tracejados das vagas vazias ficam escondidos e aparecem (com um
  esmaecer curto) enquanto um jogador é arrastado, ou no modo "Colocar em campo"/"Trocar de lugar" da janela do jogador, que
  depende de clicar nelas. Como o Chromium cancela o arraste se o DOM muda dentro do `dragstart`, elas aparecem no tique seguinte;
  somem no `dragend` ou ao soltar. Conferido com um arraste real pelo protocolo de depuração: 0/13 vagas visíveis antes, 13/13
  durante, 0/13 depois; titular solto numa vaga vazia mudou a formação (4-3-3 → 4-1-2-2-1).
- **Táticas — arraste fluido** (substitui o item "posições livres só ao arrastar" acima na mecânica, não no efeito):
  - **Causa do "pulo para o lado"**: o `button:active { transform: translateY(1px) }` global (`base.css`) trocava o
    `translate(-50%, -50%)` que centraliza o crachá; ao ser pressionado ele pulava meio crachá para a direita e para baixo, e o
    clique às vezes caía no gramado (abrindo o estilo de jogo). Corrigido fixando o centro no `:active` dos crachás e vagas.
  - O arrastar-e-soltar nativo do navegador (imagem-fantasma translúcida, cursor de "proibido", precisava acertar o círculo)
    foi trocado por um arraste por ponteiro: o crachá acompanha o cursor (o de origem fica esmaecido), a **vaga válida mais perto
    acende como um ímã** e, ao soltar, os jogadores **deslizam** até o lugar novo (troca, formação nova e pré-definição também).
    Para deslizar, os crachás têm a chave do jogador e uma ordem fixa no DOM (reordenar cortaria a transição).
  - Reserva só troca com um titular (as vagas livres não aparecem); titular de linha também vai para vaga livre (aparecem e a
    formação muda); goleiro só troca. Esc ou sair da janela cancelam. Clique simples continua abrindo a função (campo) e o
    jogador (lista); "Colocar em campo" continua funcionando.
  - Conferido com eventos de mouse reais pelo protocolo de depuração: titular solto a ~20 px da vaga "MC" (o ímã a escolheu;
    4-2-3-1 → 4-2-1-2-1), reserva solto sobre um volante (trocou), Esc (nada mudou), cliques (janelas abriram), sem janela aberta
    por engano depois dos arrastes; nenhum erro no console.
- **Avisos da carreira só na tela principal** (`CareerDashboard.tsx`): fim de temporada, resultado do avanço/da simulação
  (verde e amarelo) e o aviso fixo da carreira (foto do treinador não encontrada) aparecem só na Visão geral. Um aviso que nasce
  em outra tela espera e aparece quando o usuário abre a Visão geral; some quando ele sai dela para outra tela. **Erros**
  (vermelho) de uma ação continuam aparecendo na tela onde ela foi feita, para nenhuma falha passar em silêncio. A dica do modo
  "Colocar em campo" de Táticas é da própria tela e continua lá.
- **Táticas reorganizada para o campo crescer**: a faixa de pré-definições e esquemas foi para a coluna do elenco (em duas linhas);
  o campo ocupa a coluna da direita do topo ao pé; "Escalação automática/fixa" foi para o cabeçalho do painel e a dica de clicar
  no jogador juntou-se à do estilo de jogo, na linha da legenda. Campo a 1920×980: 509×749 (antes 441×648 com 1000 de altura).
- **Visão geral**: a linha do meio (treinador, conversas) tinha altura automática e empurrava notícias e diretoria para fora da
  janela; agora as linhas dividem a altura (1 : 1,25) e cada painel rola por dentro.
- Conferido em capturas a 1920×1000, 1366×768 e 1024×640 (medição automática: a área principal não rola nas telas que cabem;
  nenhum pedaço dos crachás fora do campo). Achado à parte, de antes: em 1024×640 a legenda do Histórico fica cortada.

## Verificação feita pelo assistente (lote 1)
- Testes: `crest-color.test.ts` (6) e a guarda de CSS em todos os arquivos.
- Mutações mortas (4 de 4): limiar de transparência, ajuste de contraste, descarte do cinza e ordem BGRA.
- Capturas do jogo compilado numa pasta de dados temporária (carreira de teste no Flamengo, com uma cópia dos pacotes do usuário),
  sem tocar nos saves:
  - menu principal (escuro e claro), Carregar carreira, Nova carreira (países e clube);
  - Visão geral (normal, dia de jogo e depois do jogo), Elenco e Calendário;
  - "Avançando o tempo", tema claro e janela mínima de 1024×640.
- Ajustes feitos a partir das capturas:
  - o painel Notícias estava espremido pela Diretoria: a diretoria foi para a coluna do meio e os objetivos rolam por dentro;
  - nomes longos de clube agora quebram em duas linhas na barra;
  - o valor do caixa não quebra mais.
- **Achado**: numa janela fora da tela, o Windows pausa as animações e o conteúdo fica invisível até a janela aparecer. No uso normal
  não acontece; no roteiro de capturas, a detecção de oclusão foi desligada.
