# Competições continentais — regras e implementação

Pedido do usuário (08/11/2026): CONMEBOL, UEFA, CONCACAF e AFC, seguindo o **regulamento real**. Decisões do usuário:
- Países que faltam no universo entram **na base como países simplificados** (ligas próprias, resultado rápido).
- **Rússia**: segue a realidade (suspensa pela UEFA, fora dos continentais), com uma opção no **editor de dados** para os clubes russos
  voltarem a receber vagas no futuro.
- Ordem: **CONMEBOL primeiro**; depois UEFA, CONCACAF e AFC.

Legenda (a mesma de `COPAS_NACIONAIS.md`): **[REG]** = lido no regulamento oficial · **[SEC]** = fonte secundária (Wikipédia, imprensa) ·
**[ABERTO]** = não confirmado; não codificar como definitivo (fica configurável).

## Documentos

| Competição | Documento oficial | Situação |
|---|---|---|
| Libertadores 2026 | CONMEBOL — Manual de Clubes CONMEBOL Libertadores 2026 (aprovado em 28/11/2025) — `docs/Manual-de-Clubes-CONMEBOL-Libertadores-2026-ESP.pdf` | **lido** (cap. 2, 3.6, 3.7 e anexo de calendário) |
| Sul-Americana 2026 | CONMEBOL — Manual de Clubes CONMEBOL Sudamericana 2026 — `docs/Manual-de-Clubes-CONMEBOL-Sudamericana-2026-ESP.pdf` | **lido** (cap. 2 e 3.6) |
| Recopa 2027 | nos dois manuais (item 2.3) | **lido** |
| Premiação 2026 | não está nos manuais; anúncio da CONMEBOL de 07/04/2026 pela imprensa (Trivela, Super Rádio Tupi, Lance, Portal Tela; Recopa: Band, 27/02/2026) | **[SEC]** (ver "Premiação" abaixo) |

Citações: "LIB p." = página do PDF do manual da Libertadores; "SUD p." = do manual da Sul-Americana.

## CONMEBOL Libertadores 2026 [REG]

- **Vagas** (LIB p. 63, 3.6.1): Argentina 6, Bolívia 4, Brasil 7, Chile 4, Colômbia 4, Equador 4, Paraguai 4, Peru 4, Uruguai 4, Venezuela 4,
  mais o campeão da Libertadores 2025 e o da Sul-Americana 2025 — **47 clubes**. Cada federação define a ordem (Nº1, Nº2…) pelo seu
  campeonato; o campeão da Libertadores entra como Nº1 do seu país; o da Sul-Americana como classificado do seu país (se já estava
  classificado por mérito, a vaga dele fica com a federação). Para os países novos (simplificados), a ordem será a da liga — **[ADAPT]**.
- **Formato** (LIB p. 38): fase preliminar (fases 1, 2 e 3), fase de grupos e fase final (oitavas, quartas, semifinal e final);
  tudo em ida e volta, menos a final.
- **Fase 1** (LIB p. 39): 6 clubes — 1 de Bolívia, Equador, Paraguai, Peru, Uruguai e Venezuela; 3 chaves por sorteio. Pote 1 = mais bem
  ranqueados (decidem em casa), pote 2 = os outros (mandantes na ida). Vencedores: E1, E2, E3.
- **Fase 2** (LIB p. 40): 16 clubes = E1–E3 + Brasil 2, Colômbia 2, Chile 2 e 1 de cada uma das outras 7 federações. Pote 1 = os 8 mais
  bem ranqueados; pote 2 = os 5 seguintes + E1–E3. Clubes do mesmo país não se enfrentam (salvo E1–E3 ainda desconhecidos no sorteio;
  se o sorteio cruzar, o último sorteado passa para a linha seguinte). Mandantes na ida: pote 2. Vencedores: C1…C8.
- **Fase 3** (LIB p. 41): chaves fixas C1×C8, C2×C7, C3×C6, C4×C5; mandante na ida = o de pior ranking. Vencedores G1–G4 vão aos grupos;
  **os 4 perdedores vão à fase de grupos da Sul-Americana**. Perdedores das fases 1 e 2 são eliminados.
- **Grupos** (LIB p. 42–44): 32 clubes (28 diretos + G1–G4), 8 grupos de 4, ida e volta (rodadas fixas: 4×2 e 3×1; 2×3 e 1×4; 2×1 e 4×3;
  3×2 e 4×1; 1×2 e 3×4; 1×3 e 2×4). Potes: **1** = campeão da Libertadores (cabeça do grupo A) + os 7 mais bem ranqueados; **2** = campeão da
  Sul-Americana + os 7 seguintes (se o campeão da Sul-Americana tiver ranking de pote 1, fica no pote 1); **3** = os 8 seguintes; **4** = G1–G4 +
  os 4 seguintes. Mesmo país não divide grupo, salvo clube vindo da fase 3 (o sorteado repetido passa ao grupo seguinte).
  1º e 2º → oitavas; **3º → play-off das oitavas da Sul-Americana**.
- **Desempate nos grupos** (LIB p. 49–50): pontos; entre os empatados — pontos, saldo, gols marcados; saldo geral; gols marcados;
  menos vermelhos; menos amarelos; sorteio (critério aplicado não volta).
- **Oitavas** (LIB p. 44–45): duas tabelas — 1ºs de grupo numerados 1–8 e 2ºs numerados 9–16 pelo desempenho nos grupos (mesmos critérios).
  Sorteio: cada 2º (pote 2) recebe um 1º (pote 1); o 2º manda a ida. Mesmo país e reencontro de grupo são permitidos.
- **Quartas** (LIB p. 45): A×H, B×G, C×F, D×E (chaves das oitavas). **Semis** (LIB p. 46): S1×S4, S2×S3. Em todas, quem tem a menor
  numeração (1–16) decide em casa.
- **Desempate no mata-mata e nas preliminares** (LIB p. 50): saldo de gols no agregado; persistindo, **pênaltis direto** (sem prorrogação,
  sem gol fora).
- **Final** (LIB p. 46, 50): jogo único em sede definida pela CONMEBOL (2026: 28/11, Estádio Centenário, Montevidéu — [SEC]); o de menor
  numeração é o "Equipo A". Empate → **prorrogação de 30 min** e, persistindo, pênaltis.
- **Ranking de clubes** (LIB p. 51–52): desempenho nos últimos 10 anos (campeão 1.000; vice 500; semifinal 300; quartas 200; oitavas 100;
  vitória a partir dos grupos 80; empate 40; participação nos grupos 100; eliminação nas preliminares 25), com peso de 100% (ano mais recente)
  a 10% (10º ano); mais o coeficiente histórico (campeão 100, vice 50, semifinal 30, vitória 8, empate 4) e 50 pontos por título nacional
  (mesma depreciação). Potes de 2026: ranking em 15/12/2025.
- **Calendário 2026** (LIB p. 276, aprovado em 28/07/2025): fase 1 sem. de 04/02 e 11/02 · fase 2 18/02 e 25/02 · fase 3 04/03 e 11/03 ·
  sorteio dos grupos 18/03 · grupos 08/04, 15/04, 29/04, 06/05, 20/05, 27/05 · sorteio das oitavas 03/06 · oitavas 12/08 e 19/08 · quartas
  09/09 e 16/09 · semis 14/10 e 21/10 · final 28/11. Jogos às terças, quartas e quintas (LIB p. 65).

## CONMEBOL Sul-Americana 2026 [REG]

- **Vagas** (SUD p. 63, 3.6.1): Argentina 6, Brasil 6, Bolívia/Chile/Colômbia/Equador/Paraguai/Peru/Uruguai/Venezuela 4 cada (44 clubes),
  mais os 4 perdedores da fase 3 da Libertadores (grupos) e os 8 terceiros da Libertadores (play-off das oitavas) — **56 clubes**.
- **Primeira fase** (SUD p. 38–40): 32 clubes (os 4 de cada um dos 8 países), **jogo único entre clubes do mesmo país**; sorteio por país,
  o primeiro sorteado de cada cruzamento é o mandante. Vencedores: "BOL 1/BOL 2" etc. (2 por país). Empate → **pênaltis** (SUD p. 47).
- **Grupos** (SUD p. 40–42): 32 clubes (Argentina 6, Brasil 6, 4 perdedores da fase 3 da Libertadores, 16 da primeira fase), 8 grupos de 4,
  ida e volta. Potes: **1** = os 8 mais bem ranqueados; **2** e **3** = os 8 seguintes cada; **4** = os 4 da Libertadores + os 4 seguintes.
  Mesmo país não divide grupo (sem exceção). 1º → oitavas; 2º → play-off; 3º e 4º eliminados. Desempate igual ao da Libertadores (SUD p. 47–48).
- **Ordenamento** (SUD p. 42): 1ºs da Sul-Americana 1–8, 2ºs 9–16 e terceiros da Libertadores 17–24, pelo desempenho nos grupos.
- **Play-off das oitavas** (SUD p. 43): chaves fixas 9×24, 10×23, 11×22, 12×21, 13×20, 14×19, 15×18, 16×17; o terceiro da Libertadores manda a ida.
- **Oitavas** (SUD p. 44): sorteio — cada vencedor do play-off (pote 2, manda a ida) recebe um 1º de grupo (pote 1). **Quartas**: A×H, B×G,
  C×F, D×E; **semis**: S1×S4, S2×S3; o de menor numeração decide em casa (SUD p. 44–45). Desempate: saldo no agregado e pênaltis (SUD p. 48).
- **Final** (SUD p. 45, 48): jogo único em sede definida (2026: 21/11, Barranquilla — [SEC]); prorrogação e pênaltis.
- **Calendário 2026** (LIB p. 276, o mesmo anexo): primeira fase sem. de 04/03 · grupos nas mesmas semanas da Libertadores · play-off 22/07 e
  29/07 · oitavas 12/08 e 19/08 · quartas 09/09 e 16/09 · semis 14/10 e 21/10 · final 21/11.

## CONMEBOL Recopa [REG]

- Campeão da Libertadores × campeão da Sul-Americana, ida e volta; o campeão da Libertadores manda o segundo jogo (LIB p. 48; SUD p. 46).
  Desistência → vice ou o seguinte da classificação geral da mesma competição. 2026: ida na semana de 18/02 e volta na de 25/02 (LIB p. 276).
  Desempate do agregado não está no manual. Na Recopa 2026 (Lanús × Flamengo) o agregado empatado foi à **prorrogação** e depois aos
  pênaltis — **[SEC]**; o jogo usa saldo no agregado → prorrogação no jogo de volta → pênaltis (diferente do mata-mata da Libertadores,
  que vai direto aos pênaltis).

## Implementação (v0.8.13 — etapas 3 e 4)

Legenda extra: **[ADAPT]** = adaptação ao universo fictício do jogo (sem história real) ou a um limite do jogo.

### Motor (puro: `game/format-engine/engine.ts` e `game/continental-engine/`)
- **Formatos** (`continental-engine/formats.ts`):
  - `conmebol-lib`: 47 sementes (fase 1 = 6, fase 2 = 13, grupos = 28);
  - `conmebol-sud`: 44 sementes (primeira fase = 32, grupos = 12) + 12 entrantes externos vindos da Libertadores;
  - `conmebol-rec`: 2 sementes.
  - Os três ficam registrados em `formatById`.
- **Recursos novos do motor de formatos**:
  - **Confrontos `preset`**: vêm do sorteio com restrições; no par `[a, b]`, `a` decide em casa.
  - **Mando `favorite`** (fase 3): decide em casa o de melhor ranking.
  - **Mando `numbered`** (quartas, semis e o "Equipo A" da final): decide em casa o de menor numeração (1–16 na Libertadores, 1–24 na
    Sul-Americana).
  - **Rodadas fixas** `schedule: 'conmebol'`: a posição no grupo é o pote.
  - **Entrantes externos** `{ external, idx }`: a Sul-Americana recebe `lib-f3` e `lib-g3` quando a lista da Libertadores está completa.
  - **Desempate por `fairPlay`**: menos vermelhos, depois menos amarelos, lidos de `fixtures.cards_json`. O resultado rápido conta como
    zero.
  - **Confronto direto aplicado uma vez** entre os empatados (`h2hOnce`, "critério aplicado não volta").
  - **`nthBest`** (numeração 1–16 e 1–24): pelos critérios do formato, sem o confronto direto.
  - **[ADAPT]** O sorteio final do desempate vira a ordem determinística da semente.
- **Sorteios** (`draw.ts`, `preset.ts`): pote por pote, com o RNG da semente da carreira.
  - **Libertadores, fase 1**: pote 1 = os 3 mais bem ranqueados, que decidem em casa.
  - **Fase 2**: pote 1 = os 8 melhores diretos; pote 2 = os outros 5 + E1–E3, que ficam isentos da restrição de país.
  - **Grupos**: campeão da Libertadores fixo em A1; campeão da Sul-Americana no pote 2 (ou no 1, se o ranking der); G1–G4 no pote 4,
    isentos.
  - **Oitavas**: 8 primeiros × 8 segundos.
  - **Sul-Americana**: primeira fase por país (o primeiro sorteado manda); grupos sem dois clubes do mesmo país; pote 4 = os 4 da
    Libertadores + os 4 seguintes.
  - **Sorteio travado**: backtracking determinístico dentro do pote. O manual manda "passar ao grupo seguinte"; o resultado respeita as
    mesmas restrições.
- **Ranking** (`ranking.ts`, LIB p. 55–59): soma Libertadores e Sul-Americana.
  - **Pontos da Sul-Americana**: campeão 600, vice 300, semi 180, quartas 120, oitavas/play-off 60, vitória 48, empate 24, grupos 60,
    participação na primeira fase 15.
  - **Coluna HIST. da Sul-Americana**: 60 / 30 / 18 / 4,8 / 2,4.
  - **Pesos**: 10 anos, de 100% a 10%; coeficiente histórico a partir do 11º ano; 50 pontos por título nacional.
  - **[ADAPT]** Cada clube começa com um "ano histórico" de 0,6 × (reputação − 30)² pontos (`continental_history`). Ele vale como a
    edição do ano anterior ao início e some em 10 temporadas.
- **Calendário** (`calendar.ts`):
  - As semanas de 2026 do anexo (LIB p. 276) ficam guardadas pela quarta-feira e vão para o mesmo dia da semana nos anos seguintes.
  - Cada jogo vai para terça, quarta ou quinta: o dia com mais descanso para os dois clubes (no empate, quarta > quinta > terça).
  - Finais no sábado: 21/11 (Sul-Americana) e 28/11 (Libertadores).
- **Vagas** (`slots.ts`): cotas por país (LIB/SUD 3.6.1).
  - **[ADAPT]** A ordem de cada país é a classificação final da 1ª divisão na temporada anterior (sem ela, a reputação). O campeão da copa
    nacional (Brasil e Argentina) entra logo depois do G4.
  - Os campeões continentais entram por fora da cota.
  - Na 1ª temporada da carreira não há campeões do ano anterior: as 2 vagas extras vão a Brasil e Argentina (os próximos da ordem).

### Banco e jogo (`continentalRepository.ts`, migração 035)
- **Tabelas**:
  - `competitions.kind = 'continental'`: sem país, com `confederation`.
  - `continental_results`: até onde cada clube chegou. O ranking é sempre derivado dela, dos títulos nacionais e do ano histórico.
  - `continental_history` e `fixtures.cards_json`.
- **Filtro `CURRENT_COMP`**: usa a temporada da confederação para a competição sem país. Com isso os continentais aparecem no calendário,
  no próximo jogo, nas estatísticas e nas finanças sem código à parte.
- **Criação** (`ensureContinentals`):
  - Roda em `createSeason`, **antes** das copas nacionais, quando os 10 países estão na mesma temporada e ainda não passou a véspera da 1ª
    data.
  - **Saves antigos**: ao abrir, cria se ainda dá tempo **e** se as copas nacionais da temporada não caem nas semanas da CONMEBOL. As
    copas sorteadas antes da v0.8.13 caem nelas; nesse caso os continentais começam na temporada seguinte, com o calendário nacional
    montado em volta deles.
- **Choques** **[ADAPT, como a CBF faz]**:
  - As copas nacionais dos países da CONMEBOL evitam as semanas continentais.
  - Um jogo de liga ou de estadual/regional a 1 dia ou menos de um jogo continental é remarcado (`clearClashes`). Vai para a terça a
    quinta livre mais próxima: sem jogo dos dois clubes a menos de 2 dias e fora das datas previstas da copa do país. O usuário recebe
    notícia.
- **Disciplina**: cartões e suspensões valem só na competição (`cup_discipline`). 3 amarelos suspendem (LIB/SUD, código disciplinar) e a
  contagem zera antes das semifinais.
- **Final em sede neutra**: sem bilheteria para o mandante nominal. A correção vale também para as finais dos estaduais e da Copa da
  Rússia.
- **Fim**: troféu, `continental_results`, premiação de campeão e vice, bônus de título de copa dos patrocinadores e notícias.
- **Inscrição de 50 jogadores** **[ADAPT]**: não modelada; todo o elenco pode jogar.

### Premiação [SEC]
Os valores são em dólares, convertidos por 1 € = US$ 1,1557 (taxa do BCE de 07/04/2026, a data do anúncio). **Não escalam pela economia
do país**: a CONMEBOL paga o mesmo a todos.

| Fase | Libertadores (US$) | Sul-Americana (US$) |
|---|---|---|
| Fase 1 / primeira fase | 400 mil | 225 mil mandante / 250 mil visitante (uma fonte só) |
| Fase 2 | 500 mil | — |
| Fase 3 | 600 mil | — |
| Grupos: por jogo em casa | 1 mi (modelo de 2025) | 300 mil |
| Grupos: por vitória | 340 mil | 125 mil |
| Play-off | — | 500 mil |
| Oitavas / quartas / semis | 1,25 mi / 1,7 mi / 2,3 mi | 600 mil / 700 mil / 800 mil |
| Vice / campeão | 7 mi / 25 mi | 2,5 mi / 10 mi |

- **Recopa**: campeão US$ 1,8 mi; vice "metade" (US$ 900 mil).
- **Quando paga**: a participação, quando a fase do clube é montada; jogo em casa e vitória, no dia do jogo; campeão e vice, no fim.

### Telas
- **Competições**: grupo "Continentais (CONMEBOL)" no seletor, com a visão por fases (grupos A–H e confrontos com agregado e pênaltis).
  Também o "Ranking de clubes CONMEBOL": top 50 e a posição do seu clube.
- **Calendário, próximo jogo e relatório**: nome da competição, fase, ida/volta e campo neutro. O logo usa a imagem `cups/conmebol-lib`
  etc., se o pacote tiver.
- **Perfil do clube**: a campanha continental da temporada, junto das copas.
- **Sala de troféus**: prateleira "Continentais" logo depois das ligas.
- **Diretoria** **[ADAPT]**: objetivo `conmebol` pelo pote estimado na criação (ranking entre os que entram direto nos grupos).
  - Libertadores: pote 1 → quartas (importante); pote 2 → oitavas (importante); potes 3–4 → oitavas (desejável); preliminares → chegar
    aos grupos (importante).
  - Sul-Americana (um nível abaixo, tudo desejável): pote 1 → quartas; pote 2 → oitavas; potes 3–4 → passar dos grupos; primeira fase →
    chegar aos grupos.

## Plano de etapas

1. **Regulamentos CONMEBOL**: feito (08/11/2026) com os manuais oficiais; premiação e desempate da Recopa por fontes secundárias.
2. **Feito (08/11/2026):** base 1.2.0 com os 8 países (ver `docs/DATABASE.md`). Plano original —
   **Novos países CONMEBOL na base** (versão 1.2.0): Bolívia, Chile, Colômbia, Equador, Paraguai, Peru, Uruguai e Venezuela como países
   simplificados (1ª divisão com resultado rápido, temporada no calendário real de cada um), clubes e elencos gerados como o resto da base.
3. **Feito (v0.8.13):** **Motor continental**: competição de vários países (fases preliminares, grupos com potes e restrição de país, mata-mata numerado, final em
   sede neutra), ranking de clubes CONMEBOL, vagas pela liga/copa de cada país, transferências Libertadores → Sul-Americana, datas no calendário.
4. **Feito (v0.8.13):** **Libertadores + Sul-Americana + Recopa no jogo**: telas (Competições, calendário), premiação, objetivos da diretoria.
5. **UEFA** (Champions, Europa, Conference, Supercopa): regulamentos, países que faltam, opção da Rússia no editor.
6. **CONCACAF** e **AFC**.
