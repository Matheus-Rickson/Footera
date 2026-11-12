# Arquitetura

## Camadas
- `src/shared` — tipos de domínio, datas, contrato da API (`api.ts`). Sem dependências.
- `src/game/*` — regras de negócio puras e determinísticas (RNG com semente). Um módulo por motor.
- `src/database` — interface `SqlDb` mínima, migrações versionadas, repositórios. Compatível com `node:sqlite` e `better-sqlite3`. `openDatabase` aplica os PRAGMAs dos saves e devolve a conexão com cache de consultas preparadas; `writeMemo.ts` = cache de leitura válido até a próxima escrita (ver `docs/PERFORMANCE.md`).
- `src/services` — casos de uso (ex.: `createCareer`). Orquestram motores + banco; é a única porta de entrada para a UI.
- `src/main` / `src/preload` — Electron: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
  CSP no HTML, navegação externa bloqueada. Cada canal IPC valida a entrada com Zod e devolve `{ok, data|error}`.
- `src/renderer` — React. Só conhece `window.api` (tipado em `shared/api.ts`).

## Universo × Carreira
O universo (`World`) é gerado/importado e **copiado** para um arquivo SQLite novo por carreira
(`createCareer`). Cada save é um banco independente; alterar uma carreira não toca outra nem o universo de origem
(coberto por teste).

## Banco de dados
Migrações em `src/database/migrations/NNN_*.ts`, aplicadas em transação por `migrate()`; bancos de versão futura são recusados.
IDs são textos estáveis gerados por contador por prefixo (`clb_00001`); nomes nunca são chaves.

## Determinismo
Toda aleatoriedade passa por `createRng(seed)`; `fork(label)` cria fluxos independentes. Mesma semente ⇒ mesmo universo e (futuramente) mesma partida.

## Desvios da especificação (e motivo)
- **Testes com `node:test`, não Vitest:** foi o que pôde ser executado e verificado no ambiente de desenvolvimento
  sem acesso ao npm. Os testes só usam `describe`-free `test`/`assert`, portanto migrar para Vitest é mecânico.

## Competições (Fase 3)
- `game/competition-engine`: `roundRobin` (rodadas), `schedule` (datas), `standings` (classificação e desfecho). Funções puras.
- `database/repositories/competitionRepository`: `ensureSeason` (cria/repara o calendário de forma determinística), consultas de calendário/tabela,
  `recordResult` (único ponto que grava placares) e `advanceTime`.
- A classificação **não é armazenada**: é derivada dos jogos com status `played`. Evita divergência entre tabela e resultados.
- `advanceTime` nunca ultrapassa partidas pendentes; é o motor de partidas (Fase 4) que as marcará como disputadas.

## Partidas (Fase 4)
- `game/match-engine`: `engine` (simulação), `formations`, `roles` (adequação à posição e prontidão), `team-builder` (escalação, banco, táticas, entrosamento),
  `commentary` (texto gerado dos eventos). Puro e determinístico por semente (`<semente do universo>:<id da partida>`).
- `database/repositories/matchRepository`: monta elencos disponíveis (sem lesionados/suspensos), simula e aplica as consequências **numa única transação por rodada**.
- `fixtures` guarda só o placar (fonte da classificação); `matches.report_json` guarda o relatório; comentários são gerados na leitura.

## Táticas (Fase 5)
- `tactic_schemes` guarda esquemas (formação + 6 controles + escalação opcional); `career.active_scheme_id` aponta o esquema usado pelo clube do usuário.
- `tacticsRepository` valida e persiste; `team-builder.assignLineupPreferred` aplica a escalação pedida e devolve as vagas que precisaram ser trocadas.
- Clubes controlados pela IA continuam com formação/tática automáticas (`aiTactics`).

## Finanças (Fase 6)
- `game/finance-engine/finance.ts`: fórmulas puras. `database/repositories/financeRepository.ts`: porta única de lançamentos (`makePoster`), liquidação mensal idempotente
  (`settleFinances`, chamada por `advanceTime` na mesma transação), patrocínios, bilheteria (`recordGate`, chamada por `simulateMatchday`) e a visão da tela.
- `finance_months` (todos os clubes, por mês e categoria) é a fonte de verdade agregada; `finance_ledger` detalha só o clube do usuário.

## Transferências (Fase 7)
- `game/transfer-engine/transfer.ts`: regras puras (janelas, preço pedido, salário exigido, decisões, estimativas, validade do elenco).
- `database/repositories/transferRepository.ts`: `executeTransfer` (única porta de **entrada** de um jogador num clube, inclusive livres), `releasePlayer`
  (saída sem destino: fim de contrato ou aposentadoria), mercado, propostas, vendas, `aiSignFreeAgents` e `processMarketDay`
  (chamado por `moveClock` dia a dia, antes da cobrança mensal do mesmo dia).
- Tabelas: `transfers` (histórico), `transfer_offers` (propostas recebidas), `transfer_list` (transferíveis).

## Ciclo de carreira (Fase 8A) — regras e calibração em `docs/CAREER_CYCLE.md`
- `game/career-engine/development.ts` (`developPlayer`, `expectedChange`, `retirementChance`, `prizeMoney`) e `contracts.ts` (fim de contrato em 30/jun,
  vencimento na virada, pedidos de renovação). Puros e determinísticos.
- `competitionRepository.moveClock`: **único ponto que move o relógio** (dia a dia: mercado, depois fechamento mensal). Não processa o dia 1º/jul da virada.
  `advanceTime` nunca passa desse dia. `createSeason` = `ensureSeason` sem transação própria.
- `seasonRepository`: `isSeasonComplete`, `getSeasonStatus`, `startNextSeason` (virada atômica), `renewContract`, `getContracts`, `getHistory`, `getTrophies`.
  `newsRepository`: `addNews`/`getNews`.
- A tabela de uma competição deriva os participantes das **partidas** dela (não da liga atual do clube), para temporadas passadas continuarem corretas depois de acessos e rebaixamentos.
- Migração `007_career_cycle`: `players.retired`, `player_development`, `season_results` (registro do que a virada aplicou), `trophies`, `news`.

## Olheiros e categorias de base (Fase 8B) — regras em `docs/SCOUTING_YOUTH.md`
- `game/scouting-engine/scouting.ts`: candidatos, salários, ganho diário, tamanho da safra, salário da base. `estimateRange` (transfer-engine) recebe o conhecimento.
- `scoutRepository`: olheiros, lista de observação, conhecimento (`scout_knowledge`) e `processScoutingDay` (chamado por `moveClock`).
- `youthRepository`: `playerFactory` (fábrica única de jogadores novos), academias iniciais, peneira (`youthIntake`, chamada por `moveClock` em 15/mar), promover/dispensar,
  decisões da virada (`youthTurnover`, `promoteBestOfGroup`).
- Jogador da base = `club_id` nulo + `youth_club_id`; todas as consultas de elenco continuam usando `club_id`. Consultas de livres excluem `youth_club_id`.
- Migração `008_scouting_youth`: `players.youth_club_id`, `scouts`, `scout_knowledge`, `scout_shortlist`; recria `news` para aceitar o tipo `staff` (dados preservados).

## Treino, comissão técnica, médico e infraestrutura (Fase 8C) — regras em `docs/TRAINING_STAFF.md`
- `game/training-engine/training.ts`: focos, intensidades, melhor foco, intensidade do preparador, risco/duração de lesões, candidatos da comissão, custos e prazos de obras.
  `developPlayer` aceita fração do ano, foco e multiplicadores (sem opções = evolução anual de antes).
- `trainingRepository` (rotina, `processTrainingDay`: recuperação/lesões/revisão do preparador; `processTrainingMonth`: evolução do dia 1º), `staffRepository`
  (comissão, `staffQuality`, `medicalFactor`), `infrastructureRepository` (obras, `processConstructionDay`). Todos chamados por `moveClock` na ordem:
  comissão → treino → obras → evolução mensal → mercado → olheiros → peneira → fechamento mensal.
- Migração `009_training_staff_infra`: `players.season_start_overall`, `staff`, `training_settings`, `player_training`, `construction_projects`.

## Diretoria e empregos (Fase 8D) — regras em `docs/BOARD_JOBS.md`
- `game/board-engine/board.ts`: posição esperada, objetivos, deltas de confiança, avaliação da temporada, orçamentos, veto, elegibilidade, demissões da IA.
- `boardRepository`: objetivos/orçamentos (`setBoardForSeason`, `ensureBoard`), reações (`applyMatchesToBoard` dentro da rodada, `recordTransferForBoard` em
  `executeTransfer`), autorização (`boardVeto`, `boardApprovesConstruction`), `processBoardDay` (no fim do dia em `moveClock`), `reviewSeason`/`startBoardSeason` na virada,
  demissão (`fireCoach`) e troca de clube (`respondJobOffer`).
- **Treinador sem clube:** `career.club_id` NULL; `getCareerState` devolve `clubId = ''`, de modo que nenhum clube casa com o "clube do usuário" e todas as rotinas o tratam
  como IA. A camada de serviços bloqueia as ações de clube (`withClubCareer`).
- Migração `010_board_jobs`: recria `career` (club_id anulável), `board_state`, `coach_spells`, `job_vacancies`, `job_offers`.
