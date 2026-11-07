# Copa do Brasil pelos estaduais, copas regionais e copas estaduais — levantamento (07/11/2026)

Etapa 6 dos estaduais (pedido do usuário): clubes sem divisão buscam, pelas regras, a vaga na Série D e na Copa do Brasil do ano seguinte;
copas menores dão calendário a quem não tem série nacional. Fonte: **REG** = regulamento oficial lido; **SEC** = fonte secundária;
**ADAPT** = adaptado por falta de fonte.

## Copa do Brasil — participantes
- **2026 (126 clubes)** — SEC (Lance, 22/12/2025; Netvasco): Critério 1 = os 20 da Série A (entram na 5ª fase); Critério 2 = 4 campeões
  do ano anterior (Série C, Série D, Copa do Nordeste, Copa Verde; 3ª fase); Critério 3 = **102 vagas das federações** pela classificação
  dos estaduais do ano anterior (os 28 de pior ranking na 1ª fase, os demais na 2ª). Vagas por federação (RNF 2026):
  **SP, RJ 6 · MG, RS, PR 5 · SC, BA, PA, CE, PE, AL, MT, AM, GO 4 · demais (13 estados) 3** (soma 102).
- **2027 (128 clubes)** — SEC (REC 2026 e imprensa): Critério 2 com **6** campeões (Série C, Série D, Copa do Nordeste, Copa Norte,
  Copa Centro-Oeste, Copa Sul-Sudeste). Federações com 3 vagas podem reservar uma para torneio seletivo (copa estadual). Fases de 2027
  não publicadas: as folgas são calculadas pelo jogo (ADAPT).
- Clube indicado que já tem vaga por outro critério: a vaga passa ao próximo da classificação do estadual (REC; ADAPT no detalhe).

## Copa do Nordeste 2026 — SEC (TNH1, Band)
- 20 clubes: **BA e CE 3 vagas; AL, MA, PB, PE, PI, RN, SE 2** (pela classificação dos estaduais do ano anterior; clubes em competições
  Conmebol não jogam).
- 4 grupos de 5; grupo A × grupo B e C × D em turno único (5 rodadas); os 2 primeiros de cada grupo → quartas em jogo único
  (1A×2C, 1B×2D, 1C×2A, 1D×2B; mando do 1º); semifinais e final em ida e volta (volta na casa da melhor campanha).
- 25/03 a 07/06. Campeão: 3ª fase da Copa do Brasil do ano seguinte (critério 2).

## Copa Verde 2026 (Copa Norte + Copa Centro-Oeste) — REG (REC Copa Verde 2026, CBF)
- 24 clubes, excluídos os em competições Conmebol: campeão estadual do ano anterior dos 12 estados (critério 1); vice de 10 deles (todos
  menos AP e MS — critério 2); mais 1 vaga para a federação mais bem ranqueada de cada bloco (critério 3).
- Blocos (art. 14): **Copa Norte** = AC, AM, AP, PA, RO, RR; **Copa Centro-Oeste** = DF, ES, GO, MT, MS, TO; 12 clubes cada.
- Em cada bloco: 2 grupos de 6, turno único dentro do grupo (art. 16), os 2 primeiros → quartas em jogo único (mando do 1º, art. 18) →
  final do bloco em ida e volta (art. 19). Final da Copa Verde: os campeões dos blocos, ida e volta (art. 20).
- 25/03 a 07/06 (10 datas). Campeões da Copa Norte e da Copa Centro-Oeste: 3ª fase da Copa do Brasil do ano seguinte (art. 7º).

## Copa Sul-Sudeste 2026 — REG (REC Copa Sul-Sudeste 2026, CBF)
- 12 clubes, excluídos os em competições Conmebol: campeão estadual do ano anterior de **MG, PR, RJ, RS, SC e SP** (critério 1) e o
  seguinte mais bem colocado de cada um (critério 2).
- 1ª fase: 2 grupos de 6, cada clube enfrenta os do outro grupo, turno único (art. 12); os 2 primeiros de cada grupo → semifinal **dentro
  do grupo** (1º × 2º), ida e volta, volta na casa do 1º (art. 15) → final em ida e volta (art. 16).
- 25/03 a 07/06. Campeão: 3ª fase da Copa do Brasil do ano seguinte (art. 5º).

## Copas estaduais do 2º semestre (torneios seletivos) — SEC parcial / ADAPT
Encontrado: **BA** Copa Governador do Estado (4ª vaga da Copa do Brasil); **AL** Copa Alagoas (vaga na Copa do Brasil); **ES** Copa
Espírito Santo (vaga na Série D); **SE** Copa Governo do Estado (2ª vaga da Série D); **MS** Copa MS (vaga na Copa do Brasil 2027).
Na Série D 2026, as vagas criadas pelo novo calendário não podem ir a seletivo (REC Série D, art. 2º §1º). Formatos e participantes das
copas estaduais não foram encontrados (ADAPT): disputadas pelos clubes do estado **sem divisão nacional** (inclusive a reserva), de julho a
novembro; a vaga que cada uma dá segue a lista acima; nos demais estados, a copa dá a última vaga do estado na Copa do Brasil (regra de 2027
para federações com 3 vagas, estendida — ADAPT).

## Adaptações gerais
- **Conmebol:** o jogo ainda não tem competições continentais; "clubes em competições Conmebol" = os da Série A que terminaram a temporada
  anterior entre os 12 primeiros (Libertadores e Sul-Americana; ADAPT).
- **Datas das regionais:** às quartas-feiras de 15/04 a 17/06 (o real é 25/03 a 07/06): começam depois dos estaduais mais longos do jogo,
  para nenhum clube jogar duas vezes com menos de 3 dias (ADAPT).
- **Primeira temporada (2026):** não há estaduais nem copas de 2025 no jogo: as vagas de 2026 saem do ranking do jogo (divisão estadual,
  série, reputação), como até agora.

## Implementação (etapa 6)
- **Copa do Brasil** (`copaDoBrasilOrder`, `copaDoBrasilFormat`): Série A na 5ª fase; campeões do ano anterior na 3ª (4 em 2026; 6 a partir
  de 2027); vagas das federações (`COPA_DO_BRASIL_SPOTS`) pela classificação da elite do estadual do ano anterior, a última pela copa
  estadual (exceto ES e SE), na 1ª e 2ª fases. **2027 (128):** 1ª fase com as 36 vagas de pior ranking, 2ª com as outras 66, 3ª com os 6
  campeões, 4ª, 5ª com a Série A — conta fechada sem folgas (ADAPT). Datas: as quartas da Série A durante os estaduais não bloqueiam a
  copa (a Série A só entra na 5ª fase) e as A2 de SP/RJ também não; elites estaduais e regionais, sim. Base real: 1ª fase em 18/02.
- **Copas regionais** (`createRegionais`, `copaNordeste`, `copaVerde`, `copaSulSudeste`; competições `reg_*` do tipo 'state'): vagas por
  estado pela classificação do estadual do ano anterior, sem os "em competições Conmebol" (ADAPT). Quartas de 15/04 a 17/06 que não
  coincidem com as ligas. Copa do Nordeste: grupos que só enfrentam o par (`crossPairs` no motor). Copa Verde com os títulos Copa Norte e
  Copa Centro-Oeste (os campeões vão à Copa do Brasil). Premiação × 1,5 da de um estadual (ADAPT).
- **Copas estaduais do 2º semestre** (`createCopasEstaduais`, `copaEstadual`; `cest_*`): os clubes sem divisão nacional do estado
  (inclusive a reserva), até 16; domingos a partir de agosto; premiação × 0,25 (ADAPT). Clubes de reserva passam a ter calendário.
- **Telas:** Competições com os grupos "Copas regionais" e "Copas estaduais"; visão por fases para todas.
- Base real, temporada inteira: 3 regionais e 27 copas estaduais concluídas; Copa do Brasil 2027 com 128 clubes; nenhum clube joga duas
  vezes com menos de 3 dias.

## Fontes
- REC Copa Verde 2026 e REC Copa Sul-Sudeste 2026 (CBF; PDFs oficiais).
- Lance (Copa do Brasil 2026: classificados), Netvasco (126 participantes), TNH1 e Band (Copa do Nordeste 2026), Itatiaia e CBF (Copa
  Verde), Goal (Copa Sul-Sudeste), Wikipédia (Baiano, Alagoano e Capixaba 2026), Correio do Estado (Copa MS).
