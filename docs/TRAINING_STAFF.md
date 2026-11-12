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
- **Intensidade** (v0.8.12): leve (evolução ×0,88, carga das sessões ×0,6, risco de lesão ×0,6), normal (×1, ×1, ×1), forte (×1,14, ×1,4, ×1,7). Até a v0.8.11
  ela dava uma recuperação fixa por dia (7,5 / 6 / 4); agora a recuperação vem das sessões (abaixo).
- **Delegar ao preparador físico** (exige um contratado): ele aplica o melhor foco de cada jogador (goleiro → goleiro; 31+ → físico; demais → o grupo relevante para a
  posição em que o jogador está mais fraco) e, toda segunda-feira, escolhe o **modelo da semana** (2+ jogos → "Semana com 2 jogos"; elenco abaixo de 82% ou carga média
  acima de 35 → "Recuperação"; sem jogos → "Pré-temporada"; senão "Equilibrada") e a **intensidade** (leve com elenco abaixo de 82%, 2+ jogos ou carga alta; forte sem
  jogos e elenco a 92%+; normal no resto), sempre com o ajuste aos jogos ligado. Sem preparador (demitido ou contrato vencido), a rotina volta ao técnico.

## Sessões semanais, condição e ritmo de jogo (v0.8.12, 12/11/2026)
Pedido do usuário: treino "levemente mais complexo", com papel real para o preparador físico e o treinador de goleiros, e condição recalibrada (jogar 90 minutos
deixava o jogador com ~87%). Decisões dele: grade semanal com uma sessão por dia, ajustada sozinha aos jogos e com modelos prontos; ~65–75% depois de 90 minutos e
~95% de volta em ~72 h; preparador físico com carga, sessões de goleiro, ritmo de jogo e relatórios semanais; avisos de risco no Departamento médico.

**Sessões** (`game/training-engine/sessions.ts`):

| Sessão | Carga | Taxa de recuperação | Crescimento (físico / técnico / mental) | Extra | Risco de lesão |
|---|---|---|---|---|---|
| Físico | 6 | −0,10 | 1,6 / 0,7 / 0,7 | — | ×1,3 |
| Técnico | 3 | — | 0,7 / 1,6 / 0,7 | — | ×1 |
| Tático | 3 | — | 0,7 / 0,7 / 1,6 | ritmo +1; domínio da função ×2 | ×1 |
| Pré-jogo | 1 | — | 0,4 / 0,5 / 0,6 | ritmo +1 | ×0,5 |
| Recuperação | 0 | +0,12 | — | — | 0 |
| Folga | 0 | +0,08 | — | moral +0,5 | 0 |
| Jogo (automática) | 0 | −0,20 (só a manhã) | — | — | 0 |

- **Grade** (`training_week`, 0 = domingo … 6 = sábado) e **modelos**: Equilibrada (padrão: folga, técnico, físico, tático, técnico, tático, pré-jogo), Pré-temporada,
  Tática, Semana com 2 jogos, Recuperação. Trocar um dia deixa a grade "personalizada".
- **Ajuste aos jogos** (ligado por padrão): dia de jogo → Jogo; dia seguinte → Recuperação; véspera → Pré-jogo (entre dois jogos seguidos a recuperação vence).
- **IA:** a semana Equilibrada ajustada aos jogos dela, intensidade normal, centro de treinamento no papel de preparador (nada gravado). A carga das sessões
  não gasta a condição da IA (ela só recupera); as sessões continuam valendo para o risco de lesão de treino. Motivo: desempenho (ver "Gravação preguiçosa").
- **Evolução mensal:** cada dia soma no `training_month` o crescimento da sessão efetiva (× intensidade) e o da semana Equilibrada com os mesmos jogos. No dia 1º cada
  grupo evolui × `efetivo / referência` (0,75–1,30; domínio da função 0,5–2). Equilibrada + normal = 1 exato (o crescimento calibrado de antes; testado), e semanas
  cheias de jogos não penalizam. Pré-temporada: físico ×1,22, mental ×0,83 (com um jogo por semana).
- **Goleiros:** nos dias de treino fazem a sessão de goleiros (Reflexos: reflexos, um contra um, agilidade; Saídas e jogo aéreo: saídas, jogo aéreo, mãos, impulsão;
  Jogo com os pés: chute, passe, domínio, compostura), com os atributos dela ×1,35 e os demais ×0,9. Quem escolhe: o técnico por goleiro, ou o treinador de goleiros
  (a do grupo mais fraco); sem os dois, todas as áreas (o foco "Goleiro" de antes). Técnicos/mentais dos goleiros do usuário × `0,80 + 0,30 × treinador/20`
  (sem ninguém = qualidade 5 → 0,875; antes 0,90–1,10 pelo fator geral); o técnico deles evolui pelo volume da grade (média dos três grupos).

**Condição** (`game/training-engine/condition.ts`, `conditionAfter` no motor):
- **No jogo:** `perda = 8 × minutos/90 + 1,41 × fadiga^0,8`, piso 30. A fadiga é a acumulada no próprio jogo (resistência, recuperação física, ritmo, pressão, calor,
  posição, função); antes só a resistência contava. Medido (base real, 300 jogos por cenário): 90 minutos com a tática padrão → mediana 70% (P10 67, P90 73); pressão 5
  e ritmo 4 → 60%; calor → 66%. Substituto que joga ~20 minutos perde ~9.
- **Entrar cansado:** fadiga inicial `max(0, 95 − condição) × 0,6` (70% → começa com 15, rendendo ~5% menos e caindo mais cedo); risco de lesão no jogo sobe junto.
  Na prontidão a condição pesa pouco (`0,90 + 0,10 × √c`, antes `0,78 + 0,22 × √c`) para não contar duas vezes.
- **Escalação:** `selectionCondition` (só na escolha de titulares e banco, não no motor): 1 com 88%+, −1% por ponto abaixo (piso 0,5). A IA e a "melhor escalação"
  poupam cansados.
- **Recuperação diária:** `c + (100 − c) × taxa − carga × intensidade`; taxa `0,45 + sessão + 0,08 × preparador/20 + 0,04 × departamento médico/20 + idade (≤23 +0,04;
  31–33 −0,05; 34+ −0,09) + (recuperação física/20 − 0,5) × 0,1`, entre 0,10 e 0,85; 99,5+ vira 100. De 70%: recuperação → pré-jogo → manhã do jogo = ~95%
  (domingo → quarta). No clube do usuário quem só treina fica perto de 94% (carga 3); na IA (sem carga de sessão) volta a 100%. Lesionado: sessão de recuperação,
  teto de 60%.
- **Carga de jogos** (`players.acute_load` + `acute_on`): média móvel exponencial de 7 dias dos **jogos** (90 minutos = 10; um jogo por semana fica entre ~6 e ~16,
  dois chegam a ~25). As sessões não entram (elas já pesam pelo risco da sessão e pela intensidade). Acima de 20 o risco de lesão no treino cresce
  `(1 + (carga − 20)/15)`; o preparador, delegado, alivia a semana acima de 25.

**Ritmo de jogo** (`players.sharpness` + `sharp_on`, 0–100; `last_played`): +12 por 90 minutos jogados; +1 nas sessões tática e pré-jogo (clube do usuário);
−1,5 por dia depois de 4 dias sem jogar (−0,8 com preparador de qualidade 20, interpolado), **até o piso de 60** — o treino mantém um ritmo básico; sem o piso, a
pré-temporada sem amistosos deixava o elenco inteiro em ~48 na estreia; −3 por dia lesionado (abaixo do piso, se for o caso). Rendimento × `0,92 + 0,08 × ritmo/100`.
Saves antigos: 85 para quem jogou na temporada, 75 para os demais; carreira nova 75. Livres perdem ritmo; países simplificados não usam.

**Gravação preguiçosa** (`repositories/fitnessState.ts`): ritmo e carga de jogos guardam o valor e a data em que valiam (`sharp_on`, `acute_on`); o valor do dia sai
da fórmula (`sharpnessAt`, `acuteAt` — iguais à regra aplicada dia a dia; há teste). Só o clube do usuário e os lesionados têm o ritmo gravado no dia; os jogos gravam
os dois; a condição só é regravada para quem não está em 100%. Motivo: regravar ritmo, carga e condição dos ~18 mil jogadores de clubes completos todo dia sujava
quase todas as páginas da tabela `players` (linhas largas, com o JSON dos atributos) e levava avançar 1 dia de 150 para ~375 ms. Índices da migração 034:
`idx_players_daily` (cobertura da varredura diária), `idx_players_tired` (parcial, condição < 100) e `idx_players_sharp_on_null` (parcial, jogadores sem data).

**Lesões de treino:** `0,055% × risco da sessão × intensidade × (2 se condição < 70%) × fator de carga × (1,15 − 0,3 × preparador/20)`. A base subiu de 0,04% porque
folga, recuperação e dia de jogo deixaram de ter risco.

**Relatórios semanais** (Caixa de entrada, segundas-feiras, só com o profissional contratado): preparador físico (condição e carga médias, abaixo de 75%, carga alta, sem
ritmo, recomendações) e treinador de goleiros (sessão de cada goleiro e o que evoluiu desde o dia 1º, `gk_month_start`).

**Departamento médico, "Em risco":** todo jogador com algum motivo (condição < 75%, carga de jogos > 20 com os jogos dos últimos 7 dias, ritmo < 50, veterano 32+ cansado ou
carregado), o risco do próximo treino (sessão de amanhã) e a recomendação do preparador físico, se houver.

### Estabilidade (save real do usuário, 120 dias simulados de 01/07 a 29/10/2026, 538 clubes completos, 3.251 partidas)
Mesmo script e mesmo save, código anterior (`cb3d83f`) × v0.8.12 (versão final, com a gravação preguiçosa):

| Medida | Antes | v0.8.12 |
|---|---|---|
| Condição dos titulares antes do jogo (mediana / P10) | 100 / 100 | 100 / 97,7 |
| Condição depois de 90 minutos (P10 / mediana / P90) | 80 / 82,5 / 85 | 64 / 69,2 / 75,6 |
| Lesões (jogo + treino) por clube em 4 meses | 10,17 | 10,16 |
| Variação média da força dos jogadores | +0,225 | +0,225 |
| Ritmo do dia dos titulares antes do jogo (mediana / P10) | — | 95,8 / 65,6 |

Na primeira versão (carga das sessões também na IA) os titulares da IA entravam com ~96,6% e saíam com mediana 66%; sem a carga das sessões na IA (desempenho)
entram inteiros e a mediana depois de 90 minutos fica em 69%, dentro da faixa pedida (65–75%). O rodízio por cansaço continua nas semanas com dois jogos.

## Comissão técnica
- Auxiliar técnico, preparador físico, treinador de goleiros e médico: um por função, 3 candidatos por função a cada mês (determinísticos), qualidade 3–19, salário
  `economia × (3.500 + qualidade² × 170)`, contrato de 2 anos, multa de até 3 meses ao demitir. Sem ninguém na função, ela rende como qualidade 5.
- **Custo do usuário:** a comissão contratada vai para a categoria `coaching`; o fixo `staff` do usuário passou a ser só a estrutura (base + metade do peso do centro de
  treinamento e do departamento médico, `staffUserMonthly`). A IA continua com o fixo completo (`staffMonthly`).

## Departamento médico
- **Lesões de treino** (clubes completos, nos dias com sessão de risco): fórmula na seção de sessões (v0.8.12; antes `0,04%` todo dia), de 3 a 21 dias.
- **Duração** de lesões de treino e de jogo × `1,15 − 0,15 × médico/20 − 0,15 × departamento/20` (0,85 a 1,15). IA: o nível do departamento faz o papel do médico.
- Lesionado fica com condição de no máximo 60% e perde ritmo de jogo (−3 por dia), recuperando aos poucos.
- Tela com lesionados (previsão de retorno) e jogadores em risco (motivos e recomendação; v0.8.12).

## Infraestrutura
- Centro de treinamento, categorias de base, departamento médico e estádio: +1 nível por obra (máximo 20), paga à vista (`infrastructure`, via `makePoster`),
  uma por vez. Custo `economia × base × 1,12^nível` (base: estádio 1,6 mi; centro 1,1 mi; base e médico 0,9 mi); prazo `90 + 8 × nível` dias (estádio 150 + 8 × nível).
- Ao concluir: nível sobe (efeitos acima e na qualidade das safras), a manutenção mensal sobe; o estádio ganha 5% de lugares (mais bilheteria).

### Departamento de scouting e rede de captação (07/11/2026; decisão do usuário: "os dois com nível")
- Instalações novas, 1–20, só do clube do usuário (`facilities_json.scouting` / `.recruitment`; ausentes = 10). O nível 10 reproduz o jogo de antes.
- **Scouting:** olheiros (= tarefas ativas ao mesmo tempo) `2 + nível/5` (10 → 4; 20 → 6); jogadores acompanhados por tarefa `3 + nível/5` (10 → 5; 20 → 7).
  A contratação e a demissão de olheiros ficam em Infraestrutura → Departamento de scouting → "Gerenciar".
- **Rede de captação:** jovens a mais na peneira do usuário `round(nível/10)` (10 → +1, como antes; 20 → +2; safra máxima 8) e chance de cada jovem vir
  de outro país do universo = nível% (10 → 10%). A IA não usa (a calibração dela não muda).
- **Custos:** obra base 600 mil × economia × 1,12^nível; manutenção `staffPerLevel/3 × nível` cada (× economia), descontada de uma base de 20 níveis
  (no 10/10 a estrutura mensal é idêntica à de antes, então a margem financeira calibrada não muda). Migração 026 (CHECK das obras).
- **Tela:** cards por instalação (5 barras = 20 níveis, manutenção por card, linhas com explicação, custo e prazo da expansão, "Expandir" com confirmação);
  estádio com capacidade, manutenção, público médio e ocupação nos jogos em casa da temporada, torcedores e preço médio do ingresso (setores e ajuste de
  preço ficaram para depois, decisão do usuário).

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
- Não há entrosamento por treino nem recaídas de lesão. As sessões valem para o elenco inteiro (só os goleiros têm sessão própria); não há treino individual por dia.
- O risco de lesão no jogo usa a fadiga (inclusive a inicial), mas não a carga aguda.
- O seletor de foco é uma lista suspensa (mudança acidental pela roda do mouse fica visível na própria tabela).
