# Estatísticas pós-jogo (v0.11.0)

Tela de análise da partida no estilo dos aplicativos de estatística: momentum, estatísticas por grupo, mapa de finalizações e,
por jogador, mapa de calor, mapa de passes e ações defensivas. Tudo vem do que o motor v2 gravou na partida. Nada é estimado
depois nem inventado.

## Onde aparece
- **Fim da partida ao vivo.** Quando a rodada é gravada, a tela da partida troca sozinha para a análise. "Ver a partida" volta
  ao campo e aos eventos. "Assistir do início" refaz o replay.
- **Relatório aberto pelo Calendário ou pelos resultados.** Abre direto na análise (a partida já terminou).
- **Abas:**
  - **Resumo:** momentum, território e os 5 destaques. Clicar num destaque abre a ficha dele.
    - **Território (v0.11.1):** campo com o mapa de calor de onde a bola esteve com os dois times, ou com um deles (filtro). Mostra
      também a fatia do tempo com a bola em cada terço. Partidas gravadas antes só mostram as fatias.
  - **Estatísticas:** Visão geral, Finalizações, Passes, Duelos e posse, Defesa.
  - **Finalizações:** só o mapa, com o xG de cada time no cabeçalho. A lista foi retirada na v0.11.1, a pedido do usuário; o minuto,
    o jogador e o resultado aparecem ao passar o mouse.
  - **Jogadores:** lista de um time por vez (filtro com os dois times; trocar o time abre a ficha do melhor em campo dele) e a ficha
    do jogador escolhido, que começa no craque do jogo.
- **Partidas sem análise.** Jogos anteriores à v0.11 e jogos de outros clubes mostram só o que existe (estatísticas gerais e,
  se houver posição, as finalizações), com um aviso.

## O que o motor grava (`MatchOutcome.detail`, `MatchDetail` em `types.ts`)
Coletado por `src/game/match-engine/v2/analysis.ts`, ligado por `MatchOptions.detail`. A coleta **só observa**: não consome o
sorteio nem muda nada. Há teste comparando a partida com e sem a análise.

| Dado | Como é medido |
|---|---|
| Mapa de calor | A cada lance, cada jogador em campo soma o tempo do lance na célula onde está. Grade de 21 × 14 células de 5 × 4,9 m, campo inteiro no sentido do mandante. Gravada em bytes de 0 a 255, onde 255 é a célula mais frequentada pelo jogador. |
| Passes | Origem, destino (ou onde a bola parou, no passe errado) e marcas: certo, cruzamento, decisivo (gerou finalização) e longo (mais de 30 m). Inclui a cobrança de escanteio que vira cabeceio. |
| Ações defensivas | Desarme, interceptação, corte, recuperação de bola e falta cometida, cada uma com a posição. Desarme e interceptação só perto da linha da bola (1,25 m); mais longe é recuperação. |
| Contadores | Toques (ações com a bola), dribles tentados e certos, duelos ganhos e perdidos, disputas aéreas, posses perdidas (passe errado, desarmado, drible que não passou), recuperações e segundos em campo. |
| Momentum | Para cada minuto registrado e cada time: segundos com a bola no campo de ataque (1 no terço final, 0,3 antes dele) mais 60 × o xG das finalizações. A tela mostra mandante menos visitante, suavizado com os 2 minutos vizinhos e normalizado de −1 a 1. |
| Território | Segundos com a bola de cada time em cada terço, do ponto de vista dele: defesa, meio e ataque. |
| Bola por time (`ball`, v0.11.1) | A cada lance, onde a bola está com cada time, na grade 21 × 14 no sentido do mandante. Os dois times usam a mesma escala: 255 é a célula mais usada por qualquer um deles. |

As finalizações vêm dos eventos, que no v2 já trazem posição e xG. Por isso a lista de comentários (`CommentaryLine`) passou a
levar `x`, `y` e `xg`.

**Consistência (testada):** em cada jogador, o número de passes e de passes certos e os desarmes, interceptações e faltas da
análise são iguais aos do relatório. Os passes decisivos marcados são iguais aos do relatório. O tempo do mapa de calor
acompanha os minutos jogados: os minutos do relatório não contam os acréscimos, por isso a tolerância é de −3 a +14 min.

**Grandes chances:** finalizações com xG a partir de 0,3.

## Gravação (`match_detail`, migração 036)
- Uma linha por partida do clube do usuário: `fixture_id`, `engine` e `detail_json`.
- Fica fora de `matches.report_json` para o relatório continuar leve.
- A prévia ao vivo **não** envia a análise (ela não seria usada a cada decisão). Ela chega com a gravação: `getMatchReport` →
  `MatchReportDto.analysis`.
- **Tamanho:** cerca de 27 KB por partida, com mapas, passes e ações em base64. São cerca de 1,6 MB por temporada de 60 jogos.
- **Saves antigos:** a tabela nasce vazia, e as partidas já jogadas ficam sem análise (a tela avisa).

## Leitura (`src/game/match-engine/v2/detail.ts`, puro)
- `decodeHeat`, `decodePasses`, `decodeDef`: lêem os bytes gravados.
- `attackRight` e `heatAttackRight`: viram o visitante para que todo jogador apareça atacando para a direita.
- `smoothHeat`: núcleo gaussiano 3 × 3 aplicado n vezes; cada passada espalha no máximo uma célula. A tela usa 1 passada e
  mais um desfoque leve no SVG.
- `averagePosition`: centro de massa do mapa (o círculo branco na tela).
- `momentumSeries`: a série do gráfico.

## Tela (`src/renderer/screens/MatchAnalysis.tsx`, estilos `ma-` em `match.css`)
- **Cores.** Times nas cores dos escudos (`--mc-home` / `--mc-away`, de `matchSides`). Mapa de calor numa cor só (âmbar),
  mais forte onde o jogador ficou mais tempo.
- **Finalizações.** Gol cheio, defendido meio cheio, para fora ou bloqueado tracejado. O tamanho é o xG. Passar o mouse mostra
  minuto, jogador, resultado, xG e origem; clicar destaca a linha na lista.
- **Passes.** Certo branco, errado vermelho tracejado, decisivo amarelo, com filtros.
- **Ações defensivas.** Cada tipo tem uma forma (● ◆ ▲ ■ ✕) e a contagem aparece na legenda.

## Achados que a análise revelou no motor
1. **Lados do visitante espelhados (corrigido na v0.11.0).**
   - A largura da âncora (0 = esquerda de quem ataca) virava o mesmo `y` do campo para os dois times. Como o visitante ataca
     no sentido contrário, a esquerda dele ficava à direita: o ponta-esquerda visitante jogava pela direita, de frente para
     o lateral-esquerdo do mandante.
   - Corrigido em `shape()` (sinal `sy`). Há teste: os jogadores de lado ficam no lado certo nos dois times, e a mutação pega.
   - Calibração refeita (tabela em `docs/MATCH_ENGINE_V2.md`).
2. **Distribuição da bola por posição (melhorada na v0.11.1, ainda não realista).**
   - Os totais do time estão calibrados (cerca de 510 passes, 79% certos), mas a divisão entre as posições não é realista.
     Média de 40 jogos, titulares com 80 minutos ou mais:

     | Posição | Passes por jogo | Real (aprox.) |
     |---|---|---|
     | Zagueiro | 6 | 50 a 70 |
     | Volante | 26 | — |
     | Lateral | cerca de 30 | — |
     | Meia | 88 a 95 | — |
     | Ponta | 76 a 83 | — |
     | Centroavante | 75 | cerca de 20 |

   - O motor quase não usava a saída de bola por trás.
   - **v0.11.1:** paciência para girar a bola, passe livre para trás mais seguro, zagueiro perto do portador e atacante mais à
     frente sem a bola. Detalhes e recalibração em `docs/MATCH_ENGINE_V2.md`.
   - **Resultado em 200 jogos, titulares com 80 min ou mais:**

     | Posição | Passes por jogo |
     |---|---|
     | Zagueiro | 16 |
     | Lateral | 38 |
     | Ala | 66 |
     | Volante | 25 |
     | Meio-campista | 77 |
     | Meia | 82 |
     | Ponta | 76 |
     | Centroavante | 54 |
     | Goleiro | 10 |

   - **Ainda falta:** o zagueiro segue bem abaixo do real, e o meio-campo concentra a bola.
     - Aumentar a paciência no meio-campo leva o zagueiro a 40–70 passes, mas desequilibra as formações: o 5-3-2 cai para 0,74 a
       1,08 ponto/jogo, e os gols despencam.
     - Uma solução melhor precisa de outro mecanismo, como posses mais longas que começam pela defesa.
   - Há teste: o zagueiro faz pelo menos 12 passes, e o centroavante até 65 e menos que o meio-campista.
3. **Contagens infladas de interceptações, desarmes e posses perdidas (corrigido na v0.11.1; visto na validação de 24/11/2026).**
   - Na final do Brasiliense, cada time teve:

     | Estatística | No jogo | Real (aprox.) |
     |---|---|---|
     | Interceptações | 105–128 | 8–15 |
     | Desarmes | 50–69 | 15–20 |
     | Posses perdidas | cerca de 200 | 110–140 |

   - Um centroavante teve 58 toques em 23 minutos.
   - Causa: o motor credita quase todo passe errado como interceptação de alguém, mesmo longe da linha do passe, e toda condução que falha como desarme. É a mesma raiz da distribuição da bola (item 2): muitas posses curtas no meio.
   - **Correção da contagem (v0.11.1):** só vale como interceptação ou desarme quem estava a menos de 1,25 m da linha da bola. Mais
     longe, a bola sobrou, e conta como recuperação. A correção só mexe na contagem: a mesma partida sai igual.
   - **Resultado por time, em 200 jogos:**

     | Estatística | Antes | Agora | Real (aprox.) |
     |---|---|---|---|
     | Interceptações | 80 | 14 | 8–15 |
     | Desarmes | 27–33 | 25 | 15–20 |
     | Posses perdidas | 120–148 | 116 | 110–140 |

   - Com a saída de bola do item 2, as posses ficaram mais longas.
   - Há teste: interceptações entre 4 e 25 por time, desarmes até 28, mais recuperações que interceptações e até 145 posses
     perdidas.
