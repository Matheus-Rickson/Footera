# Motor de partidas (Fase 4)

## Modelo
Simulação minuto a minuto (90 + acréscimos; prorrogação e pênaltis quando `knockout`), com ~2,6 **fases de posse** por minuto.
Cada fase: (1) decide quem tem a bola pelo controle de meio-campo; (2) registra passes (volume e precisão dependem de passe/visão,
estilo de saída, pressão adversária, clima e gramado); (3) sorteia um desfecho: falta, impedimento, chance de gol ou nada.

Nada é decidido só pela diferença de força. Entram: atributos individuais **na função em que jogam** (`overallFor` + penalidade por posição
não natural), condição física, moral, forma, **fadiga acumulada no jogo** (depende de resistência, tempo, pressão e calor), entrosamento,
mando de campo, tática (mentalidade, ritmo, linha defensiva, pressão, saída de bola, amplitude), placar (urgência no fim do jogo),
cartões vermelhos e lesões (o time joga com menos gente), substituições da IA e "forma do dia" (±8%, evento aleatório controlado).

Finalização: tipo de chance (jogada, cruzamento, bola longa, contra-ataque, escanteio, falta, pênalti) → xG = base × habilidade do finalizador ×
(ataque/defesa) × goleiro × clima → bloqueio / para fora / trave / defesa / gol. Gols esperados somam coerentemente com os gols reais.

## Calibração (2.000 partidas entre clubes de nível médio, gerador de universo `calib`)
| Métrica | Medido | Faixa de referência |
|---|---|---|
| Gols por jogo | 2,82 | 2,5–2,9 |
| Mandante / empate / visitante | 45,9% / 26,4% / 27,7% | ~43–48 / 23–29 / 27–32 |
| Finalizações por time | 13,2 | 11–14 |
| % no alvo | 36,9% | 30–38 |
| Gols por finalização | 10,7% | 8–12 |
| Escanteios por time | 5,5 | 4,5–6 |
| Faltas por time | 11,7 | 10–13 |
| Amarelos / vermelhos por jogo | 3,3 / 0,16 | 3–4,5 / 0,05–0,15 |
| Impedimentos por time | 2,1 | 1,5–3 |
| Passes por time / precisão | 445 / 83% | 380–480 / 78–86% |
| Lesões por jogo | 0,19 | 0,1–0,3 |
| Pênaltis por jogo | 0,32 | 0,2–0,35 |

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
