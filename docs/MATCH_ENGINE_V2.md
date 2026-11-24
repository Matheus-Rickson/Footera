# Motor de partida v2: lance a lance (v0.10.0)

O placar nasce do que acontece no campo. Os 22 jogadores têm posição o tempo todo. Quem está com a bola escolhe a próxima ação, e o sucesso dela é uma disputa entre os jogadores envolvidos. O xG vem do lugar do chute.

O contrato não mudou: `simulateMatch(home, away, opts)` devolve o mesmo `MatchOutcome`, então carreira, copas, continentais e relatórios seguem iguais. `MatchOutcome` ganhou dois campos: `engine` (`'v1' | 'v2'`) e `track`, o trajeto da partida. Cada partida grava a versão no relatório, e os relatórios antigos continuam abrindo.

A versão padrão é `DEFAULT_ENGINE = 'v2'`, em `src/game/match-engine/engine.ts`. A v1 continua disponível pela opção `engine: 'v1'` e no Laboratório (`engine=v1`).

**Onde cada motor roda no jogo** (`runFixture`, em `matchRepository.ts`):
- **v2:** todas as competições em que o clube do usuário joga (liga, copas, continentais), inclusive os jogos entre outros clubes nelas.
- **v1:** os demais jogos do país do usuário. A v2 custa cerca de 25 ms por partida, contra 4,6 ms da v1. Com todos os jogos na v2, avançar 7 dias passava de 3,5 s para 8,4 s (`npm run bench`). As duas versões são calibradas para as mesmas metas.
- **`quickResult`:** os países com simulação simplificada, como antes.

## Arquivos
| Arquivo | O que faz |
|---|---|
| `src/game/match-engine/v2/engine.ts` | O motor. Também tem as tabelas de forma do time (`DEF_DEPTH`, `DEF_WIDTH`, `ATT_PUSH`, `RUN`) e as constantes calibradas (`K2`). |
| `src/game/match-engine/v2/pitch.ts` | Geometria pura: campo de 105 × 68, `depthOf`, xG pela posição (`xgAt`), ameaça da posição (`threat`) e base64. |
| `src/game/match-engine/v2/track.ts` | Leitura do trajeto: `decodeTrack`, `framesByTick` e `sceneAt` (interpolação). Usado pela tela ao vivo e pelos testes. |
| `src/game/match-engine/common.ts` | Partes que a v1 e a v2 compartilham, como `MatchInterventionError`. |

## Modelo
- **Coordenadas.** O campo mede 105 × 68 m. O mandante ataca para a direita: x = 0 é o gol dele. A "profundidade" de cada time é a distância até o próprio gol, no sentido em que ele ataca.
- **Posições.** Cada jogador parte da âncora da formação (`formations.ts`), inclinada pela função (`RoleDef.fx`).
  - **Com a bola:** o time sobe conforme a bola, a linha e a mentalidade. Meias abertos e alas sobem mais (`ATT_PUSH`). Quem tem `RUN` alto ataca a área no último terço.
  - **Sem a bola:** o time recompõe em linhas, a `DEF_DEPTH` metros à frente da linha defensiva, e fecha por dentro (`DEF_WIDTH`). A dupla de zaga numa linha de 4 fica mais junta (`CB_PAIR_WIDTH`). Há marcação individual (gulosa) e pressão sobre o portador pelos dois mais próximos.
  - **Um atacante só:** quando o time tem só um atacante, os meias atacam mais a área (`loneRun`). Sem isso, a 4-1-4-1 ficava 0,2 ponto/jogo abaixo das outras formações.
  - **Movimento próprio:** cada jogador oscila em torno do seu alvo, procurando espaço em ciclos de 25 a 60 s, em fase diferente dos companheiros (`wander`; sem a bola, `wanderDef`, que não mexe na linha de defesa). Quem está perto do portador se aproxima para dar opção de passe (`support`).
    - É determinístico: não consome sorteio.
    - Por lance, o deslocamento de cada jogador em relação ao bloco subiu de 3,1 m para 3,4 m. Amplitudes maiores tiravam a calibração do lugar: o movimento livre aumenta os gols, e a aproximação ao portador os diminui.
- **Ações.** A ação sai de um softmax sobre a utilidade de cada opção: ameaça do destino, avanço, manter a bola e risco de perdê-la.
  - As opções são passe curto, passe longo, bola em profundidade (corrida entre atacante e zagueiro), condução, drible, cruzamento, chute e afastar.
  - Pesam os atributos de quem age, a pressão, as linhas de passe fechadas, a função e a tática (saída curta ou direta, ritmo).
- **Disputas.** `duel()` compara os atributos dos dois jogadores e satura em `duelCap`. A saturação evita goleadas absurdas quando o desnível é grande.
- **Finalização.** O xG da posição (`xgAt`) é multiplicado por quatro fatores:
  - a pressão sobre o chute;
  - a qualidade de quem chuta;
  - o goleiro (`gkMod`);
  - a proteção da área: um bloco recuado protege a área (`mtOrg`), e o time que vence por 3 ou mais relaxa (`leadRelax`).
- **Bolas paradas, cartões e escanteios.** Faltas viram cartões conforme a agressividade. Escanteios também saem de chute defendido, bloqueado ou na trave.
- **Moldura igual à da v1.** Ficaram iguais:
  - minutos registrados, fadiga, lesões, cartões e substituições da IA;
  - sugestões do auxiliar, vestiário, linha do tempo e acréscimos;
  - prorrogação, pênaltis e determinismo pela semente.

## Técnico durante o jogo
O técnico tem três intervenções novas (`Intervention` em `types.ts`). Elas valem a partir do minuto registrado `tick`, e o jogo antes disso é idêntico.

| Intervenção | Efeito | Evento |
|---|---|---|
| `{ kind: 'tactics', settings }` | Troca mentalidade, ritmo, amplitude, linha, pressão e saída de bola. Valores fora de 1–5 são recusados. | `tactics_change` (detalhe `coach`) |
| `{ kind: 'role', playerId, role }` | Troca a função de um jogador em campo. A função precisa servir para a posição dele, e o jogador precisa estar em campo. | `role_change` |
| `{ kind: 'formation', formation }` | Reorganiza o time. Quem já tem lugar fica, e quem muda de posição perde um pouco de rendimento até se adaptar. Com expulsos, a formação não muda. | `formation_change` |

Erros viram `MatchInterventionError` e aparecem na tela.

O IPC (`previewLiveMatch` e `finishLiveMatch`) aceita as três formas, validadas pelo zod de `main.ts`, até 60 decisões por partida.

**Técnico da IA.** Reage aos 75', 82' e 87':
- perdendo por 1 ou 2 gols, passa para a mentalidade ofensiva e sobe a pressão aos 87';
- vencendo por 1 gol a partir dos 87', baixa o ritmo.

Cada mudança vira o evento `tactics_change` com detalhe `ai`, e o comentário narra a mudança.

## Trajeto (`track`)
Grava-se um quadro por ação com bola, só quando `opts.track` é verdadeiro. Hoje isso acontece na prévia da partida ao vivo do usuário. O trajeto só observa: não muda nenhum sorteio, e um teste confere isso.

Formato (`MatchTrack`):
- `ids[time]` lista os jogadores na ordem em que entraram. Os que entram de substituição vão para o fim da lista.
- `data` é base64 de quadros de `TRACK_HEAD + 4 × TRACK_SLOTS` bytes cada.
- **Cabeçalho do quadro:**
  - minuto registrado (2 bytes): o mesmo índice da `timeline` e do passo da tela;
  - segundo × 4;
  - tipo da ação (`TRACK_KIND`);
  - time com a bola (2 = ninguém);
  - índice de quem está com a bola (255 = ninguém);
  - bola x e y.
- **Corpo do quadro:** os pares (x, y) dos 18 lugares de cada time, em meio metro. 255 indica fora de campo.

Uma partida típica tem cerca de 1.400 quadros, 14 por minuto, e cerca de 145 KB em base64.

## Tela ao vivo
- **`LivePitch.tsx`.** Com trajeto, desenha as posições reais dos 22 jogadores e da bola, interpoladas quadro a quadro no ritmo da tela.
  - Destaca quem está com a bola e mostra o lance atual (passe, desarme, finalização…).
  - Sem trajeto (motor v1 ou partida antiga), usa a representação ilustrativa de antes.
  - Se o auxiliar decide o fim da partida, o trajeto da prévia deixa de valer e não é mostrado.
  - Ritmo: com o mapa real, 1× = 4 s por minuto de jogo (cerca de 3,5 lances por segundo), 2× = 2 s e 4× = 0,8 s. Sem trajeto, os tempos continuam 1 s, 0,5 s e 0,22 s.
  - Na copa, o banco do modal de substituições e o aviso pré-jogo indicam quem está suspenso na liga mas pode jogar (as suspensões valem só na competição em que foram recebidas).
- **`MatchReport.tsx` e `LiveDecisions.tsx`.**
  - O botão **Tática** abre o modal com a formação e os seis ajustes.
  - Clicar num jogador seu no campo abre a troca de função, com a animação da função (`RoleField`).
  - As duas coisas só existem no motor v2.

## Calibração (Laboratório, 2000 jogos, universo `calib`)
`npm run lab:run -- calibracao engine=v2 n=2000 --sem-arquivos`. O mesmo comando com `engine=v1` serve de comparação.

| Meta | v2 | v1 | Faixa |
|---|---|---|---|
| Gols por jogo | 2,86 | 2,72 | 2,50–2,90 |
| xG − gols | 0,09 | 0,00 | ≤ 0,15 |
| Mandante / empate / visitante | 45 / 27 / 28 % | 45 / 24 / 31 % | 43–48 / 23–29 / 27–32 % |
| 0x0 | 8,2 % | 6,7 % | 6–10 % |
| Amarelos / vermelhos | 3,78 / 0,11 | 3,24 / 0,15 | 3–4,5 / 0,05–0,15 |
| Finalizações / no gol por time | 12,4 / 4,6 | 12,8 / 4,8 | 10–15 / 3,5–5,5 |
| Passes por time / certos | 509 / 79 % | 429 / 84 % | 380–560 / 76–86 % |
| Faltas / escanteios / impedimentos por time | 11,9 / 5,2 / 1,9 | 11,3 / 5,4 / 2,0 | 9–15 / 4–6,2 / 1,2–2,8 |
| Determinismo | 20/20 | 20/20 | 20/20 |
| Equilíbrio entre formações (maior − menor pontos/jogo) | 0,12 | 0,15 | ≤ 0,20 |

Formações na v2, em pontos por jogo (±0,06): 4-3-3 1,45; 4-4-2 1,43; 3-5-2 1,41; 3-4-3 1,40; 4-2-3-1 1,38; 5-3-2 1,34; 4-1-4-1 1,33. Todas as metas estão na faixa.

**Histórico do ajuste:**
- Uma tentativa de equilibrar as formações com DM mais recuado e AM mais perto da linha (5 e 13) piorou a mentalidade defensiva: −0,26 ponto/jogo contra a equilibrada. Foi desfeita, e os valores voltaram a 7 e 16.
- O que equilibrou as formações foi `loneRun`, com o movimento próprio (`wander` 3, `support` 0,05). Para manter o mando de campo na faixa, `home` passou de 1,065 para 1,08. Para conter a maior goleada em jogos muito desiguais (máximo de 9 de saldo), `leadEase` passou de 0,72 para 0,62.
- **Atenção:** o equilíbrio entre formações é sensível a mudanças pequenas na dinâmica. Recalcular a oscilação só uma vez por segundo de jogo, em vez de continuamente, levou o equilíbrio para 0,35. Depois de qualquer mudança no motor, rode a calibração completa com formações.

**Desempenho:** cerca de 25 ms por partida, contra 4,6 ms da v1, porque recalcular a forma do time a cada ação é o maior custo. No jogo, só as competições do usuário rodam na v2, e `npm run bench` dá: avançar 1 dia 336 ms, 7 dias 3,5 s, próxima rodada 598 ms. Com a v1 em tudo: 361 ms, 3,5 s e 744 ms.

## Testes
- **`src/tests/match-engine-v2.test.ts`** (7 testes):
  - determinismo, e o trajeto não muda o jogo;
  - o trajeto decodifica dentro do campo e na ordem do relógio;
  - a interpolação da cena;
  - tática, função e formação valem só a partir do minuto escolhido e recusam entradas inválidas;
  - a IA só ataca quando está perdendo, e a partir dos 75'.
- **Mutação, 5 de 5 pegas:**
  - intervenção aplicada um minuto atrasada;
  - função sem validar a posição;
  - coordenadas sem o meio metro;
  - jogador que sai continua desenhado;
  - segundos decodificados errados.
- **Suítes que já existiam** (`match-engine`, `engine-balance`, `coach`, `tactics`) rodam com a v2 como padrão.
  - O teste do treinador (conhecimento tático melhora o saldo de xG) passou de 300 para 1.200 jogos. Na v2 cada jogo diverge logo nos primeiros lances, e o efeito de +2,5% de força só aparece numa amostra grande: +0,08 de saldo de xG por jogo em 1.500 jogos.
- **`match-persistence.test.ts`** confere que a competição do usuário grava `engine: 'v2'` e que as outras gravam `'v1'` (mutação “tudo na v2” pega).
