# Treino, comissão técnica, departamento médico e infraestrutura (Fase 8C)

Decisões do usuário (02/11/2026): foco semanal + evolução mensal; o técnico monta a rotina **ou delega ao preparador físico** (contratado como os olheiros), que escolhe
o melhor treino de cada jogador; profissionais contratáveis; obras com custo e prazo; departamento médico com prevenção e recuperação.

## Evolução mensal
- Todo dia 1º, todos os jogadores ativos evoluem 1/12 do ano (`processTrainingMonth`, chamado por `moveClock`). O crescimento é composto (12 meses ≈ 1 ano, testado);
  o teto do potencial antes dos 28 é respeitado mês a mês; ruído com desvio de `1,1 × √(1/12)`. A virada não aplica mais evolução: registra o saldo da temporada
  (`season_start_overall` → `player_development`), revisa o potencial estimado visível e reinicia a referência. A evolução de 1º/jul é aplicada no começo da virada.
- **Multiplicadores** (0,90 a 1,10 por fator de qualidade 1..20): centro de treinamento × intensidade (só o usuário) × profissional da área — auxiliar técnico
  (técnicos e mentais dos jogadores de linha), treinador de goleiros (técnicos e mentais dos goleiros), preparador físico (físicos). O preparador também freia o declínio
  físico de veteranos (`1,1 − 0,2 × qualidade/20`). Base: nível das categorias de base. IA: o nível do centro de treinamento faz o papel da comissão; foco equilibrado.
  Livres treinam por conta própria (×0,9).
- **Foco individual:** finalização, criação, defesa, físico, técnica, goleiro ou equilibrado. Atributos do foco ×1,35, os demais ×0,9 (o total de pontos se conserva).
  Com ×1,6/×0,85 a força crescia 42% mais rápido quando o foco coincidia com a posição — vantagem excessiva sobre a IA; agora o ganho fica em ~15–20% com o foco bem escolhido.
- **Intensidade:** leve (evolução ×0,88, recuperação 7,5/dia, risco de lesão ×0,6), normal (×1, 6/dia, ×1), forte (×1,14, 4/dia, ×1,7). O preparador físico soma
  `1,5 × qualidade/20` à recuperação diária do elenco.
- **Delegar ao preparador físico** (exige um contratado): ele aplica o melhor foco de cada jogador (goleiro → goleiro; 31+ → físico; demais → o grupo relevante para a
  posição em que o jogador está mais fraco) e, toda segunda-feira, escolhe a intensidade (leve com elenco abaixo de 82% ou 2+ jogos na semana; forte sem jogos e elenco
  acima de 95%; normal no resto). Sem preparador (demitido ou contrato vencido), a rotina volta ao técnico.

## Comissão técnica
- Auxiliar técnico, preparador físico, treinador de goleiros e médico: um por função, 3 candidatos por função a cada mês (determinísticos), qualidade 3–19, salário
  `economia × (3.500 + qualidade² × 170)`, contrato de 2 anos, multa de até 3 meses ao demitir. Sem ninguém na função, ela rende como qualidade 5.
- **Custo do usuário:** a comissão contratada vai para a categoria `coaching`; o fixo `staff` do usuário passou a ser só a estrutura (base + metade do peso do centro de
  treinamento e do departamento médico, `staffUserMonthly`). A IA continua com o fixo completo (`staffMonthly`).

## Departamento médico
- **Lesões de treino** (todos os clubes, todo dia): `0,04% × intensidade × (2 se condição < 70%) × (1,15 − 0,3 × preparador/20)`, de 3 a 21 dias.
- **Duração** de lesões de treino e de jogo × `1,15 − 0,15 × médico/20 − 0,15 × departamento/20` (0,85 a 1,15). IA: o nível do departamento faz o papel do médico.
- Lesionado fica com condição de no máximo 60% e volta sem ritmo, recuperando aos poucos.
- Tela com lesionados (previsão de retorno) e jogadores em risco (condição < 70%, risco diário no treino).

## Infraestrutura
- Centro de treinamento, categorias de base, departamento médico e estádio: +1 nível por obra (máximo 20), paga à vista (`infrastructure`, via `makePoster`),
  uma por vez. Custo `economia × base × 1,12^nível` (base: estádio 1,6 mi; centro 1,1 mi; base e médico 0,9 mi); prazo `90 + 8 × nível` dias (estádio 150 + 8 × nível).
- Ao concluir: nível sobe (efeitos acima e na qualidade das safras), a manutenção mensal sobe; o estádio ganha 5% de lugares (mais bilheteria).

## Estabilidade (5 viradas, universo completo; usuário passivo, sem comissão)
| Medida | Início | Depois de 5 viradas |
|---|---|---|
| Média dos 14 melhores: Série A / Série B | 67,6 / 57,8 | 68,3 / 59,4 |
| Média dos 14 melhores: Premier / Championship | 66,5 / 56,6 | 68,8 / 59,2 |
| Folha mediana Série A | 787 mil | 850 mil |
| Margem anual mediana sem prêmio | −0,2% | +1,5% a +5,5% por temporada |
| Saldos inconsistentes | 0 | 0 |

## Limitações conhecidas
- A IA não contrata comissão nem faz obras (usa os níveis das instalações).
- Não há treino tático, entrosamento por treino, sessões por dia da semana, nem recaídas de lesão.
- O seletor de foco é uma lista suspensa (mudança acidental pela roda do mouse fica visível na própria tabela).
