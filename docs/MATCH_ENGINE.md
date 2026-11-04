# Motor de partidas (Fase 4)

## Modelo
Simulação minuto a minuto (90 + acréscimos; prorrogação e pênaltis quando `knockout`), com ~2,6 **fases de posse** por minuto.
Cada fase: (1) decide quem tem a bola pelo controle de meio-campo; (2) registra passes (volume e precisão dependem de passe/visão,
estilo de saída, pressão adversária, clima e gramado); (3) sorteia um desfecho: falta, impedimento, chance de gol ou nada.

Nada é decidido só pela diferença de força. Entram: atributos individuais **na função em que jogam** (`overallFor` + penalidade por posição
não natural), condição física, moral, forma, **fadiga acumulada no jogo** (depende de resistência, tempo, pressão e calor), entrosamento,
mando de campo, tática (mentalidade, ritmo, linha defensiva, pressão, saída de bola, amplitude), placar (urgência no fim do jogo),
cartões vermelhos e lesões (o time joga com menos gente), substituições da IA e "forma do dia" (±8%, evento aleatório controlado).

**Linha do tempo (`opts.timeline`, só nas partidas do usuário):** ao fim de cada minuto o motor guarda estatísticas acumuladas, fases de posse e,
por jogador, a nota parcial (`rateReport`, a mesma fórmula da nota final, com os minutos jogados até ali) e a condição (`conditionAfter`, a mesma
fórmula que grava a condição pós-jogo). Só lê o estado: não sorteia nada, então o resultado é idêntico com ou sem registro (há teste).
O campo animado da tela de acompanhamento é uma representação desses dados: o motor não tem coordenadas de jogadores.

**Técnico ao vivo (`opts.control` e `opts.interventions`):** sob controle, o time do técnico não faz substituições automáticas (nem por lesão) até o
minuto registrado `control.until`; depois o auxiliar assume. Intervenções (substituição; conversa do intervalo) são aplicadas no início do minuto
registrado indicado, sem sorteio — por isso o jogo até ali é idêntico e a mesma lista de decisões sempre dá o mesmo resultado. A conversa altera a
moral dos relacionados (`teamTalk.ts`), que entra na força (±3%) só nesta partida (`moraleDelta` não é gravado). Sob controle, nos momentos em que o
auxiliar trocaria, ele apenas sugere (`suggestions`, com motivo): mesma regra de `aiSubs`, calculada sem executar. Se quem entra é de outra posição,
a sugestão traz a formação que o encaixa (`planReshape`); aceitar com `reshape` muda a função dos jogadores e emite `formation_change`.

Finalização: tipo de chance (jogada, cruzamento, bola longa, contra-ataque, escanteio, falta, pênalti) → xG = base × habilidade do finalizador ×
(ataque/defesa) × goleiro × clima → bloqueio / para fora / trave / defesa / gol. Gols esperados somam coerentemente com os gols reais.

## Posições de corredor (v0.8.6): meias abertos (ME/MD = LM/RM) e alas (AE/AD = LWB/RWB)
- **Atributos** (`overall.ts`): ME = visão, passe, cruzamento, controle e resistência; MD = velocidade, passe, cruzamento, drible e recomposição;
  AE = resistência, velocidade, cruzamento e marcação; AD = resistência, velocidade, cruzamento, posicionamento e defesa.
- **Comportamento** (`engine.ts`): meia aberto pesa no meio-campo (ataque 0,45 / meio 0,75 / defesa 0,2); ala divide o corredor (0,35 / 0,35 / 0,6).
  Nos lances de cruzamento, quem cruza é escolhido pelo peso de corredor (`CROSSER_W`) e pelo atributo cruzamento: ~73% das assistências de cruzamento
  vêm de laterais, alas, meias abertos e pontas (antes ~39%, quando o cruzamento saía de qualquer passador). Alas cansam 15% mais e meias abertos 5%.
- **Funções parecidas** rendem 95%: lateral ↔ ala e ponta ↔ meia aberto do mesmo lado (`roles.ts`).
- Pré-definições: 4-4-2 e 4-1-4-1 com meias abertos; 3-5-2 e 3-4-3 com alas. A referência que normaliza ataque/meio/defesa ficou **fixa**
  (4-4-2 clássico com pontas): antes era calculada da 1ª pré-definição e, ao mudá-la, inflou o ataque de todos (3,56 gols/jogo, detectado pelo teste).
- Gerador: elencos de carreiras novas têm 1 AE, 1 AD, 1 ME e 1 MD naturais (no lugar de 1 LE, 1 LD, 1 PE e 1 PD); saves anteriores não mudam.

## Funções táticas (v0.8.6) — `playerRoles.ts`
Posição é **onde** o jogador joga; função é **como** ele joga ali. 3 funções por posição (33 no total; o ATA dos universos antigos exerce as de SA e CA):
GOL Tradicional/Líbero/Construtor · ZAG Defensivo/Construtor/Agressivo · LE/LD Defensivo/Completo/Ofensivo · AE/AD Ofensivo/Equilibrado/Defensivo ·
VOL Primeiro/Construtor/Dinâmico · MC Box-to-Box/Organizador/Recuperador · ME/MD Meia Aberto/Armador Aberto/Meia Infiltrador ·
MEI Armador Clássico/Meia Atacante/Organizador Recuado · PE/PD Ponta Aberto/Invertido/Construtor · SA Segundo Atacante/Falso 9/Atacante de Profundidade ·
CA Pivô/Atacante de Referência/Atacante Móvel.
- **Compatibilidade** (0–100): média ponderada dos atributos que a função exige (×5). Muda com os atributos (evolução mensal). Treinar a função com o
  foco de atributos em Equilibrado aplica os pesos do foco (×1,35 nos atributos da função, ×0,9 nos demais) à evolução: medido em 12 meses (3 elencos),
  jovens +2,5 a +3,8 pontos de compatibilidade contra +0,8 a +2,8 sem treino, força geral praticamente igual (+0,05 a +0,14). Veterano no pico ou em declínio
  quase não muda, porque o treino só redistribui a evolução e não a cria.
- **Domínio** (0–100): inicial pelo perfil (100% na função da posição natural que mais combina; 55% nas outras dela e na melhor de cada posição
  secundária; 30% nas demais das secundárias; 20% fora). Cresce **jogando** (+1,5 a cada 90 min na função, todos os clubes) e **treinando**
  (+10/mês × qualidade do auxiliar/treinador de goleiros × centro de treinamento × intensidade; só o clube do usuário). Limite 100. Tabela `player_roles`.
- **Rendimento**: força na posição × (1 + 0,35·(compatibilidade/força − 1), limitado a −5%…+4%) × (0,93 + 0,07·domínio). Função escolhida e
  dominada por quem tem o perfil: até ~+4%; função que não combina, com domínio 20%: ~−11%.
- **Comportamento** (`fx`): inclinação ataque/meio/defesa da vaga **renormalizada** (a função não soma força de graça), participação nos lances
  (finalização, cabeceio, chute de longe, passe, cruzamento, desarme, faltas, impedimento), desgaste, saída de bola do time (precisão de passe +0,6 p.p.
  por unidade) e exposição a contra-ataques (`1 + 0,05·risco − 0,12·cobertura do goleiro`, entre 0,7 e 1,4).
- **Automática**: sem escolha do técnico (e para a IA), cada jogador exerce a função de maior rendimento para ele na vaga.
- Efeitos medidos (mesmos jogos, só muda a função): lateral ofensivo × defensivo em 1.500 jogos — finalizações +16%, passes decisivos +19%,
  assistências de cruzamento +53%, gols pró +6,5%, gols sofridos +8,6%. CA de referência × pivô: +22% de finalizações em jogada.
  Zagueiros agressivos + goleiro construtor × zagueiros defensivos + goleiro líbero: +29% de contra-ataques sofridos.
- **Equilíbrio entre formações** com SA/CA e funções: o expoente de retornos decrescentes por setor caiu de 0,5 para 0,35 (`ZONE_EXP`), porque
  a raiz punia demais formações desbalanceadas (5-3-2, 4-1-4-1). Dispersão entre a melhor e a pior formação (5.880 jogos, tática equilibrada):
  0,31 → 0,13 ponto por jogo. `K.chance` 0,080 → 0,070 para manter os gols (matriz equilibrada: 2,69 gols/jogo, 0x0 7,6%, empates 26,8%, mandante 44,7%).

## Calibração (2.000 partidas entre clubes de nível médio, gerador de universo `calib`, táticas escolhidas pela IA)
**v0.8.6 (funções táticas)** — o script de medição original se perdeu e foi refeito (formação escolhida pelo elenco, pares de clubes médios); ele não
reproduz exatamente os números da tabela abaixo. Por isso, a comparação justa é com a v0.8.5 medida **pelo mesmo script novo**:

| Métrica | v0.8.6 (atual) | v0.8.5 (mesmo script) | Faixa de referência |
|---|---|---|---|
| Gols por jogo | 2,93 | 2,99 | 2,5–2,9 |
| Mandante / empate / visitante | 46,1% / 25,1% / 28,8% | 46,5 / 24,6 / 29,0 | ~43–48 / 23–29 / 27–32 |
| 0x0 | 6,7% | 5,9% | ~7–8% |
| Finalizações por time / % no alvo | 13,4 / 37,0% | 13,7 / 36,7% | 11–14 / 30–38 |
| Passes por time / precisão | 491 / 85,6% | 506 / 84,4% | 380–480 / 78–86% |
| Amarelos / vermelhos por jogo | 3,4 / 0,16 | 3,5 / 0,19 | 3–4,5 / 0,05–0,15 |
| Pênaltis / xG por gol | 0,32 / 1,00 | 0,32 / 1,00 | 0,2–0,35 / ≈ 1 |
| Acréscimos 1º / 2º tempo (min) | 2,5 / 4,6 | 3,7 / 7,0 | ~2–3 / 4–6 |

Gols e passes ficam um pouco acima da faixa neste método (já ficavam na v0.8.5, que o usuário validou jogando); a precisão de passe sobe ~1 p.p.
pelas funções de saída de bola. Os testes de calibração (`match-engine.test.ts`, 500 jogos) passam.

**Medição anterior (v0.8.5, script original):**
Medido após os ajustes da depuração: zonas normalizadas, `K.chance` 0,068 → 0,080 e acréscimos recalibrados.
Bateria completa por formação em `docs/MATCH_ENGINE_DEBUG.md`.

| Métrica | Medido | Antes dos ajustes | Faixa de referência |
|---|---|---|---|
| Gols por jogo | 2,80 | 2,59 | 2,5–2,9 |
| Mandante / empate / visitante | 46,9% / 24,7% / 28,4% | 44,5 / 28,3 / 27,2 | ~43–48 / 23–29 / 27–32 |
| 0x0 | 6,3% | — | ~7–8% |
| Finalizações por time | 13,4 | 12,4 | 11–14 |
| % no alvo | 36,4% | 36,9% | 30–38 |
| Gols por finalização | 10,4% | 10,7% | 8–12 |
| Escanteios por time | 5,3 | 5,5 | 4,5–6 |
| Faltas por time | 11,3 | 11,7 | 10–13 |
| Amarelos / vermelhos por jogo | 3,2 / 0,17 | 3,3 / 0,16 | 3–4,5 / 0,05–0,15 |
| Impedimentos por time | 2,0 | 2,1 | 1,5–3 |
| Passes por time / precisão | 429 / 83,2% | 445 / 83% | 380–480 / 78–86% |
| Posse do mandante | 53,1% | — | 50–55% |
| Lesões / substituições por jogo | 0,22 / 6,3 | 0,19 / — | 0,1–0,3 / — |
| Pênaltis por jogo | 0,29 | 0,32 | 0,2–0,35 |
| xG por gol | 1,00 | — | ≈ 1 |
| Acréscimos 1º / 2º tempo (min) | 2,4 / 4,4 | 3,4 / 6,7 | ~2–3 / 4–6 |

Vermelhos por jogo (0,17) seguem levemente acima da faixa, como antes dos ajustes (0,16).

**Equilíbrio entre formações:** cada função de linha soma o mesmo peso total de zona (`ZONE_TOTAL` = 1,15; o perfil de cada função é
`ZONE_SHAPE`). Antes, funções que somavam mais peso (meia aberto 1,4; ala 1,3) davam força "de graça" à formação: a diferença entre a
melhor e a pior formação caiu de 0,34 para 0,16 ponto por jogo na bateria de 5.880 jogos.

As faixas de referência são ordens de grandeza típicas do futebol profissional (não vêm de uma base de dados oficial) e servem para detectar
descalibragem. Os testes (`match-engine.test.ts`) usam faixas **mais largas** e falham se o motor sair delas. Constantes em `K` (engine.ts).

## Limitações conhecidas
- Desníveis extremos (XI ~70 × ~50) rendem ~100% de vitórias do favorito; no futebol real haveria ~1% de zebras.
- Vermelhos (0,16) estão no limite superior da faixa.
- Não há gols contra, bola parada ensaiada, goleiro-linha tático, cobrança de falta por especialista designado, nem clima mudando durante o jogo.
- Desarmes e interceptações são contados como estatística (por jogador), mas **não** viram eventos individuais na linha do tempo.
- O "minuto a minuto" é um **replay** da partida já simulada (determinística); o usuário ainda não pode intervir durante o jogo. Substituições e
  táticas durante a partida são feitas pela IA.
- Edição de táticas/escalação pelo usuário não existe ainda: o clube do usuário joga com formação e escalação automáticas e tática derivada da metodologia do treinador.
