# Copa da Rússia — levantamento e implementação (07/11/2026)

Fonte: **REG** = regulamento oficial lido; **SEC** = fonte secundária; **ADAPT** = adaptado por falta de fonte ou pela base do jogo.
O regulamento da RFS não foi obtido; a estrutura vem da Wikipédia (en e ru, 2025/26) e da imprensa (Sport-Express, Championat) — SEC.

## Formato real 2025/26 (SEC)
- 104 clubes: 16 da Premier Liga (RPL), 18 da 1ª divisão (Pervaya Liga), 2ª divisão (A e B), amadores e clubes de mídia.
- **Caminho da RPL:** 4 grupos de 4, ida e volta (6 jogos), de 29/07 a 23/10. **Empate vai direto aos pênaltis**: vitória 3, vitória nos
  pênaltis 2, derrota nos pênaltis 1, derrota 0. Desempate: pontos, confronto direto (pontos, vitórias, saldo, gols), vitórias, saldo,
  gols, saldo nos pênaltis, sorteio. 1º e 2º → quartas da RPL; 3º → quartas das Regiões; 4º eliminado.
  Quartas (04–06/11 e 25–27/11), semifinais (03–05/03 e 17–19/03) e final do caminho (08/04 e 07/05) em ida e volta, pênaltis no
  agregado empatado. Em 2025/26, o perdedor da final da RPL está eliminado (antes ele descia para a final das Regiões).
- **Caminho das Regiões:** jogo único, pênaltis direto. Rodadas 1 a 6 (05/08 a 30/10): amadores e 2ª divisão B na 1ª; 2ª divisão A na
  2ª; Pervaya Liga na 4ª (32 clubes); sobram 4. Mando: o clube de divisão inferior joga em casa; entre iguais, quem tem menos jogos em
  casa. Quartas das Regiões, etapa 1 (25–27/11): os 4 classificados × os 3º dos grupos, em casa do clube das Regiões; etapa 2 (03–05/03):
  × perdedores das quartas da RPL. Semifinal das Regiões, etapa 1 (17–19/03) e etapa 2 (07–09/04, × perdedores das semifinais da RPL).
  Final das Regiões (06/05).
- **Superfinal** (24/05/2026, Moscou): campeão do caminho da RPL × campeão do caminho das Regiões. 2025/26: Spartak campeão, Krasnodar vice.
- Vaga europeia: suspensa (clubes russos fora das competições da UEFA desde 2022).

## No jogo (`copaDaRussia`, `copaDaRussiaDates`, `createCopaDaRussia`; competição `rcup_<ano>`)
- Participantes: os 16 da Premier Liga e os 18 da Pervaya Liga (a base não tem divisões inferiores — ADAPT), cada divisão pela posição na
  temporada anterior (quem subiu depois, quem caiu antes; 1ª temporada: reputação).
- Caminho das Regiões só com a Pervaya Liga: 4ª rodada preliminar entre os 4 de pior semente, 5ª com 16, 6ª com 8 → 4 (ADAPT na entrada;
  jogo único, pênaltis direto e mando do de pior semente — divisão inferior — como no real).
- Grupos da RPL por potes de semente (serpentina; o real é sorteio com restrições de Moscou — ADAPT), pênaltis depois do empate e pontos
  3/2/1/0 (SEC). Desempate: pontos, confronto direto, vitórias, saldo, gols (ADAPT parcial: sem os critérios de pênaltis).
- Quartas da RPL: 1º × 2º de outro grupo (A1×B2, B1×A2, C1×D2, D1×C2), volta em casa do 1º (ADAPT: no real a chave inteira é sorteada
  em junho). Mando da volta nas semifinais e final da RPL: o primeiro da chave (ADAPT).
- Dupla eliminação como no real; perdedor da final da RPL eliminado (regra de 2025/26). Final das Regiões em jogo único, mando sorteado
  (ADAPT); superfinal em campo neutro num domingo de maio (ADAPT: Moscou).
- Datas: as de 2025/26 levadas à quarta-feira (a liga da base joga aos sábados); superfinal no domingo seguinte a 23/05.
- Premiação: campeão economia × 2,4 mi (o mesmo das outras copas nacionais), vice metade (ADAPT). Troféu na Sala de troféus.
- Telas: Competições → "Copas nacionais"; calendário com o nome da copa.

## Supercopa da Rússia (`SUPERCUP_RULES`, id `rus`)
- Campeão da Premier Liga × vencedor da Copa da Rússia da temporada anterior (SEC). 2025: CSKA (copa) 1×0 Krasnodar (liga), 12/07, Kazan.
- Campo neutro (SEC: Kazan em 2025); dobradinha → vice da liga (SEC: 2020, Zenit × Lokomotiv). Empate direto aos pênaltis (ADAPT: as
  edições recentes não tiveram prorrogação, mas o regulamento não foi obtido). Data: 26/07, antes da 1ª rodada (como as outras de julho).
- Começa na 2ª temporada (usa os campeões do save); só troféu, como as demais supercopas. O vencedor e o vice da copa vêm do desfecho da
  superfinal (`formatOutcomesOf`) em `previousChampions`.

## Não feito
- A Copa da Rússia não aparece no editor de copas (`cups.json`): é fixa para a Rússia.
