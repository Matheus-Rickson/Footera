# Depuração do motor de partidas — bateria de formações (v0.8.6 em andamento)

**14.180 partidas simuladas**: matriz de formações (5.880). espelho com mando (600). espelho neutro (600 + 4.000). determinismo (100) e esquerda × direita (3.000).
Clubes de nível médio do universo de calibração (`calib`), tática equilibrada nos dois lados, formação forçada.
Cada um dos 49 confrontos de formação (mandante × visitante) usa **os mesmos 120 pares de clubes e sementes**: a diferença de força dos elencos se anula e o que muda é só a formação.

## 1. Sanidade e determinismo

- Anomalias (nota fora de 3–10, minutos inválidos, posse ≠ 100%, valores inválidos): **0**.
- Determinismo: **50/50** partidas repetidas com a mesma semente idênticas.
- Maior placar: 6x4 (4-2-3-1 x 4-4-2). 0x0: 10.4%.

## 2. Médias gerais (matriz)

| Métrica | Valor | Referência |
|---|---|---|
| Gols por jogo | 2.42 | 2,5–2,9 |
| xG por jogo | 2.41 | ≈ gols |
| Mandante / empate / visitante | 43.6% / 28.5% / 27.9% | ~43–48 / 23–29 / 27–32 |
| 0x0 | 10.4% | ~7–8% |
| Amarelos / vermelhos por jogo | 3.32 / 0.158 | 3–4,5 / 0,05–0,15 |
| Lesões / substituições por jogo | 0.21 / 7.14 | — |
| Acréscimos 1º / 2º tempo (min) | 3.4 / 6.7 | ~2–3 / 4–6 |

## 3. Por formação (1.680 jogos cada: metade como mandante, metade como visitante)

| Formação | Pts/jogo (±EP) | V / E / D | Gols pró | Gols contra | xG pró | xG contra | Finalizações pró/contra | Posse | Gols de cruzamento | Força média da escalação | Fora de posição por jogo |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 4-4-2 | 1.532 (±0.032) | 42.2% / 26.5% / 31.2% | 1.39 | 1.19 | 1.39 | 1.19 | 13.3 / 11.3 | 54.0% | 11.4% | 65.3 | 3.12 |
| 4-1-4-1 | 1.417 (±0.031) | 36.7% / 31.7% / 31.6% | 1.09 | 0.99 | 1.10 | 0.99 | 11.8 / 9.5 | 60.1% | 9.5% | 65.1 | 3.25 |
| 3-4-3 | 1.405 (±0.032) | 38.5% / 24.9% / 36.5% | 1.36 | 1.27 | 1.37 | 1.28 | 12.8 / 12.4 | 48.4% | 10.6% | 65.3 | 2.62 |
| 4-3-3 | 1.361 (±0.032) | 36.1% / 27.7% / 36.2% | 1.31 | 1.28 | 1.27 | 1.25 | 12.3 / 11.9 | 50.5% | 9.8% | 65.1 | 2.75 |
| 3-5-2 | 1.299 (±0.031) | 33.5% / 29.4% / 37.1% | 1.11 | 1.19 | 1.12 | 1.18 | 11.1 / 11.7 | 49.3% | 9.0% | 64.7 | 2.75 |
| 4-2-3-1 | 1.292 (±0.032) | 34.2% / 26.7% / 39.1% | 1.25 | 1.37 | 1.26 | 1.38 | 11.6 / 13.4 | 43.6% | 10.2% | 64.9 | 3.38 |
| 5-3-2 | 1.195 (±0.030) | 28.9% / 32.7% / 38.3% | 0.95 | 1.17 | 0.92 | 1.15 | 9.3 / 11.8 | 44.2% | 9.7% | 64.8 | 2.62 |

## 4. Matriz de confrontos (linha = mandante, coluna = visitante; 120 jogos por célula)

### Pontos do mandante por jogo

| Mandante \ Visitante | 4-4-2 | 4-3-3 | 4-2-3-1 | 3-5-2 | 3-4-3 | 5-3-2 | 4-1-4-1 |
|---|---|---|---|---|---|---|---|
| **4-4-2** | 1.86 | 1.77 | 1.82 | 1.83 | 1.78 | 2.02 | 1.68 |
| **4-3-3** | 1.38 | 1.66 | 1.58 | 1.52 | 1.82 | 1.57 | 1.67 |
| **4-2-3-1** | 1.30 | 1.51 | 1.62 | 1.51 | 1.39 | 1.71 | 1.26 |
| **3-5-2** | 1.58 | 1.49 | 1.68 | 1.35 | 1.62 | 1.53 | 1.40 |
| **3-4-3** | 1.53 | 1.78 | 1.73 | 1.93 | 1.87 | 1.80 | 1.54 |
| **5-3-2** | 1.35 | 1.36 | 1.45 | 1.34 | 1.43 | 1.41 | 1.24 |
| **4-1-4-1** | 1.37 | 1.70 | 1.57 | 1.80 | 1.85 | 1.64 | 1.48 |

### Saldo de gols do mandante por jogo

| Mandante \ Visitante | 4-4-2 | 4-3-3 | 4-2-3-1 | 3-5-2 | 3-4-3 | 5-3-2 | 4-1-4-1 |
|---|---|---|---|---|---|---|---|
| **4-4-2** | +0.62 | +0.62 | +0.65 | +0.68 | +0.48 | +0.83 | +0.28 |
| **4-3-3** | -0.03 | +0.44 | +0.37 | +0.32 | +0.56 | +0.43 | +0.37 |
| **4-2-3-1** | -0.03 | +0.10 | +0.37 | +0.28 | +0.13 | +0.51 | -0.01 |
| **3-5-2** | +0.31 | +0.07 | +0.54 | +0.16 | +0.23 | +0.30 | +0.15 |
| **3-4-3** | +0.34 | +0.48 | +0.60 | +0.83 | +0.75 | +0.76 | +0.20 |
| **5-3-2** | +0.02 | -0.04 | +0.17 | +0.06 | +0.07 | +0.09 | -0.14 |
| **4-1-4-1** | +0.09 | +0.38 | +0.39 | +0.53 | +0.51 | +0.38 | +0.12 |

### Posse do mandante (%)

| Mandante \ Visitante | 4-4-2 | 4-3-3 | 4-2-3-1 | 3-5-2 | 3-4-3 | 5-3-2 | 4-1-4-1 |
|---|---|---|---|---|---|---|---|
| **4-4-2** | 53 | 56 | 63 | 58 | 59 | 63 | 46 |
| **4-3-3** | 49 | 52 | 60 | 54 | 55 | 59 | 43 |
| **4-2-3-1** | 43 | 45 | 53 | 47 | 48 | 52 | 36 |
| **3-5-2** | 48 | 52 | 59 | 52 | 54 | 58 | 42 |
| **3-4-3** | 48 | 51 | 57 | 53 | 53 | 57 | 41 |
| **5-3-2** | 43 | 46 | 54 | 48 | 48 | 52 | 37 |
| **4-1-4-1** | 58 | 63 | 68 | 64 | 65 | 68 | 54 |

### Gols por jogo

| Mandante \ Visitante | 4-4-2 | 4-3-3 | 4-2-3-1 | 3-5-2 | 3-4-3 | 5-3-2 | 4-1-4-1 |
|---|---|---|---|---|---|---|---|
| **4-4-2** | 2.48 | 2.62 | 2.62 | 2.60 | 2.77 | 2.50 | 2.27 |
| **4-3-3** | 2.84 | 2.76 | 2.75 | 2.45 | 2.77 | 2.38 | 2.42 |
| **4-2-3-1** | 2.68 | 3.05 | 3.12 | 2.41 | 2.82 | 2.16 | 1.99 |
| **3-5-2** | 2.51 | 2.54 | 2.38 | 2.29 | 2.52 | 1.98 | 1.85 |
| **3-4-3** | 2.91 | 2.55 | 3.17 | 2.57 | 2.67 | 2.27 | 2.42 |
| **5-3-2** | 2.42 | 2.14 | 2.30 | 1.84 | 2.45 | 1.77 | 1.84 |
| **4-1-4-1** | 2.34 | 2.21 | 2.16 | 2.04 | 2.27 | 1.78 | 1.77 |

### Formações iguais × diferentes

| Grupo | Jogos | Mandante | Empate | Visitante | Gols/jogo |
|---|---|---|---|---|---|
| Mesma formação dos dois lados | 840 | 43.8% | 29.0% | 27.1% | 2.41 |
| Formações diferentes | 5040 | 43.6% | 28.5% | 28.0% | 2.42 |

Confrontos mais desequilibrados (diferença de pontos do mandante quando se inverte o mando): 4-4-2 × 5-3-2 (0.67); 4-2-3-1 × 4-4-2 (0.52); 3-5-2 × 4-1-4-1 (0.40); 4-1-4-1 × 5-3-2 (0.40); 4-3-3 × 4-4-2 (0.39).

## 5. Espelho (mesmo clube, mesma formação e tática)

- **Com mando de campo** (600 jogos): mandante 41.2%, empate 31.0%, visitante 27.8%; gols 1.34 × 1.07; xG 1.39 × 1.05; posse do mandante 52.9%. É a vantagem de jogar em casa isolada.
- **Campo neutro** (4.000 jogos): lado 0 33,8%, empate 32,0%, lado 1 34,2%: diferença de −0,5 p.p. (IC95 ±2,6 p.p.); posse 50,01%. **Sem viés de lado.** (Com 600 jogos a diferença parecia de 5 p.p.: era ruído.)
- **Esquerda × direita** (3.000 jogos, mesmos jogadores espelhados com a posição natural trocada): a nota acompanha o jogador (6,58 → 6,55 e 6,52 → 6,49), não o lado. A nota maior dos laterais esquerdos na matriz vem dos jogadores (força média LE 61,9 × LD 58,5 nesta amostra). **Sem viés de lado.**

## 6. Por função (por 90 minutos; nota = média de quem jogou 45+ min)

| Função | Jogos (90') | Nota | Gols | Assistências | Finalizações | Desarmes | Passes-chave | Amarelos |
|---|---|---|---|---|---|---|---|---|
| GOL | 11759 | 6.67 | 0.000 | 0.006 | 0.00 | 0.00 | 0.04 | 0.005 |
| ZAG | 28587 | 6.36 | 0.035 | 0.019 | 0.36 | 2.45 | 0.18 | 0.198 |
| LE | 8209 | 6.43 | 0.036 | 0.086 | 0.37 | 1.97 | 0.90 | 0.182 |
| LD | 7949 | 6.36 | 0.033 | 0.076 | 0.31 | 1.87 | 0.85 | 0.174 |
| AE | 3360 | 6.44 | 0.054 | 0.118 | 0.50 | 1.78 | 1.33 | 0.177 |
| AD | 3291 | 6.38 | 0.041 | 0.112 | 0.44 | 1.68 | 1.12 | 0.181 |
| VOL | 10117 | 6.72 | 0.052 | 0.069 | 0.70 | 2.69 | 0.64 | 0.224 |
| MC | 19572 | 6.54 | 0.118 | 0.120 | 1.35 | 1.70 | 1.14 | 0.197 |
| ME | 3329 | 6.57 | 0.115 | 0.139 | 1.24 | 1.06 | 1.43 | 0.114 |
| MD | 3325 | 6.54 | 0.121 | 0.118 | 1.29 | 1.10 | 1.32 | 0.115 |
| MEI | 2298 | 6.47 | 0.213 | 0.139 | 2.15 | 0.64 | 1.33 | 0.129 |
| PE | 5214 | 6.47 | 0.182 | 0.126 | 1.71 | 0.54 | 1.26 | 0.108 |
| PD | 5064 | 6.46 | 0.170 | 0.135 | 1.70 | 0.54 | 1.25 | 0.106 |
| ATA | 16943 | 6.43 | 0.378 | 0.031 | 3.21 | 0.32 | 0.31 | 0.085 |

## 7. Tipos de chance (calibração do xG)

| Tipo | Finalizações | Gols | Conversão | xG médio | Gols / xG |
|---|---|---|---|---|---|
| Jogada trabalhada | 43054 | 4614 | 10.7% | 0.109 | 0.98 |
| Contra-ataque | 24339 | 4357 | 17.9% | 0.179 | 1.00 |
| Falta | 21574 | 1132 | 5.2% | 0.050 | 1.04 |
| Cruzamento | 19556 | 1435 | 7.3% | 0.070 | 1.05 |
| Chute de longe | 15942 | 634 | 4.0% | 0.039 | 1.01 |
| Escanteio | 11580 | 784 | 6.8% | 0.066 | 1.03 |
| Pênalti | 1672 | 1256 | 75.1% | 0.760 | 0.99 |

## 8. Placares mais comuns

1×1 12.7% · 1×0 12.4% · 0×0 10.4% · 0×1 9.1% · 2×1 8.6% · 2×0 7.3% · 1×2 6.1% · 0×2 4.8% · 2×2 4.6% · 3×0 3.7% · 3×1 3.6% · 1×3 2.1%

## 9. Achados

1. **Desequilíbrio entre formações (defeito estrutural).** Dispersão de 0,34 ponto por jogo entre a melhor (4-4-2, 1,53) e a pior (5-3-2, 1,20), cerca de 10× o erro padrão. A ordem acompanha a **soma dos pesos de zona** de cada formação (4-1-4-1 11,7 · 4-4-2 11,5 · 3-4-3 11,4 · 3-5-2 11,3 · 4-3-3 11,2 · 4-2-3-1 11,1 · 5-3-2 10,9): funções com peso total maior (meia aberto 1,4; ala 1,3; meio-campista 1,25; zagueiro e atacante 1,0) dão força "de graça" à formação que as usa. A força das escalações é praticamente igual entre formações (64,7–65,3), então não é o elenco.
2. **Gols um pouco baixos neste cenário**: 2,42 gols por jogo, 0x0 em 10,4% e 28,5% de empates, com tática equilibrada nos dois lados (a calibração com a IA escolhendo as táticas mede 2,59). Dentro do teste automático (2,3–3,3), mas abaixo da faixa real de referência (2,5–2,9) e com 0x0 acima do comum (~7–8%).
3. **Acréscimos do 2º tempo** com média de 6,7 minutos (real ~4–6).
4. **Sem viés de lado** (neutro e esquerda × direita), **xG bem calibrado** em todos os tipos de chance (gols/xG de 0,98 a 1,05), determinismo e sanidade OK. Mesma formação × formações diferentes não muda nada por si só: o efeito é de cada formação.

## 10. Correção testada (aplicada depois; ver seção 11): peso total igual para todas as funções de linha

Cada função de linha passa a somar o mesmo peso total (1,15) em ataque + meio + defesa, mantendo o formato (o ala continua mais defensivo que o meia aberto etc.). Jogar com um a menos continua enfraquecendo o time. Mesma bateria de 5.880 jogos:

| | Atual | Com a correção |
|---|---|---|
| Dispersão entre formações (pts/jogo) | 0.336 | 0.180 |
| Gols por jogo | 2.42 | 2.40 |
| 0x0 / empates / mandante | 10.4% / 28.5% / 43.6% | 10.5% / 28.8% / 43.5% |
| Ranking (pts/jogo) | 4-4-2 1.53 · 4-1-4-1 1.42 · 3-4-3 1.40 · 4-3-3 1.36 · 3-5-2 1.30 · 4-2-3-1 1.29 · 5-3-2 1.20 | 4-3-3 1.42 · 4-4-2 1.42 · 3-4-3 1.38 · 4-1-4-1 1.36 · 4-2-3-1 1.34 · 3-5-2 1.33 · 5-3-2 1.24 |

O teste de calibração do motor continua passando com a correção. A diferença que sobra (5-3-2 mais fraco, com mais empates) é de estilo, não de peso gratuito.

Roteiros da bateria: `engine_debug.ts` (matriz, espelho, neutro, determinismo) e `engine_probe.ts` (neutro com 4.000 jogos, esquerda × direita, soma de pesos), mantidos fora do repositório.

## 11. Ajustes APLICADOS (a pedido do usuário) e nova bateria completa

1. **Equilíbrio entre formações:** todas as funções de linha com o mesmo peso total de zona (1,15), mantendo o perfil de cada uma.
2. **Mais gols e menos 0x0:** frequência de chances `K.chance` de 0,068 para 0,080 (escolhido em afinação: 0,068 / 0,073 / 0,076 / 0,080 / 0,083; 0,083 deixava a calibração com táticas da IA acima de 2,9 gols por jogo).
3. **Acréscimos:** pesos de gol 0,8→0,5, substituição 0,5→0,3, lesão 1,5→1,0, cartão 0,3→0,2, falta 0,08→0,03 e pênalti 0,8→0,5 minuto.
4. **Defeito encontrado durante os ajustes e corrigido:** com o goleiro expulso ou lesionado, o motor trocava sozinho pelo goleiro reserva mesmo com o técnico no comando (partida ao vivo). Agora alguém de linha vai para o gol improvisado e o auxiliar sugere a troca pelo goleiro reserva ("Sem goleiro"), com o motivo; o técnico decide.

Mesma bateria (5880 jogos da matriz + 600 espelho + 600 neutro + 100 determinismo; anomalias 0; determinismo 50/50):

| Métrica | Antes | Depois |
|---|---|---|
| Gols por jogo | 2,42 | 2,64 |
| xG por jogo | 2,41 | 2,64 |
| 0x0 | 10,4% | 8,3% |
| Mandante / empate / visitante | 43,6% / 28,5% / 27,9% | 44,7% / 26,4% / 28,9% |
| Acréscimos 1º / 2º tempo | 3,4 / 6,7 min | 2,4 / 4,5 min |
| Dispersão entre formações | 0,336 pts/jogo | 0,158 pts/jogo |
| Espelho com mando (casa / empate / fora) | 41,2% / 31,0% / 27,8% | 42,7% / 30,2% / 27,2% |

| Formação | Pts/jogo | V / E / D | Gols pró / contra | Posse |
|---|---|---|---|---|
| 3-4-3 | 1,441 | 40,4 / 22,9 / 36,7% | 1,50 / 1,39 | 48,4% |
| 4-3-3 | 1,426 | 39,0 / 25,5 / 35,5% | 1,44 / 1,36 | 51,4% |
| 4-4-2 | 1,410 | 39,0 / 23,9 / 37,1% | 1,44 / 1,40 | 52,3% |
| 4-1-4-1 | 1,370 | 35,0 / 32,0 / 33,0% | 1,11 / 1,12 | 59,0% |
| 4-2-3-1 | 1,345 | 36,3 / 25,6 / 38,1% | 1,43 / 1,45 | 45,1% |
| 3-5-2 | 1,301 | 34,3 / 27,2 / 38,5% | 1,24 / 1,31 | 49,0% |
| 5-3-2 | 1,283 | 33,6 / 27,6 / 38,8% | 1,08 / 1,21 | 44,8% |

Calibração com táticas da IA (2.000 jogos): 2,80 gols por jogo; 46,9 / 24,7 / 28,4%; 0x0 6,3%; acréscimos 2,4 / 4,4 min (tabela completa em `docs/MATCH_ENGINE.md`).
Simulação longa (3 temporadas com viradas): margem financeira mediana −0,3% a +1,3% sem prêmios (+3,0% a +5,3% com prêmios), força dos elencos estável, saldos 100% consistentes com o extrato.
