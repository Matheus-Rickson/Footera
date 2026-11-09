# Competições continentais — plano e regras levantadas (etapa 0)

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
| Premiação 2026 | não está nos manuais (divulgada à parte pela CONMEBOL) | **[ABERTO]** |

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
  Desempate do agregado não está no manual — **[ABERTO]** (proposta: o mesmo do mata-mata, saldo e pênaltis).

## Plano de etapas (proposta)

1. **Regulamentos CONMEBOL**: feito (08/11/2026) com os manuais oficiais; em aberto só a premiação e o desempate da Recopa.
2. **Feito (08/11/2026):** base 1.2.0 com os 8 países (ver `docs/DATABASE.md`). Plano original —
   **Novos países CONMEBOL na base** (versão 1.2.0): Bolívia, Chile, Colômbia, Equador, Paraguai, Peru, Uruguai e Venezuela como países
   simplificados (1ª divisão com resultado rápido, temporada no calendário real de cada um), clubes e elencos gerados como o resto da base.
3. **Motor continental**: competição de vários países (fases preliminares, grupos com potes e restrição de país, mata-mata numerado, final em
   sede neutra), ranking de clubes CONMEBOL, vagas pela liga/copa de cada país, transferências Libertadores → Sul-Americana, datas no calendário.
4. **Libertadores + Sul-Americana + Recopa no jogo**: telas (Competições, calendário), premiação, objetivos da diretoria.
5. **UEFA** (Champions, Europa, Conference, Supercopa): regulamentos, países que faltam, opção da Rússia no editor.
6. **CONCACAF** e **AFC**.
