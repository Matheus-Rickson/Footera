# CLAUDE.md — FOOTERA (Football Manager Simulator)

Jogo de gerenciamento de futebol offline (estilo Football Manager/Brasfoot), **em português do Brasil**.
Stack: Electron + React + TypeScript + Vite + SQLite (`node:sqlite`, fallback `better-sqlite3`) + Zod. Alvo: Windows.
Motor separado da UI. Versão atual: ver `package.json` (0.8.0 = Fase 8 completa: 8A–8D; 0.8.1 = nome FOOTERA, logo, instalador e lapidação de interface; 0.8.2 = posições em português em todas as telas e tema escuro grafite; 0.8.3 = técnico ao vivo: vestiário, substituições, placar compacto; 0.8.4 = placar alinhado, conversa só na partida, auxiliar sugere trocas com motivo; 0.8.5 = auxiliar propõe a formação para encaixar quem entra; 0.8.6 = ME/MD/AE/AD e SA/CA, funções táticas, elenco e táticas reorganizados; 0.8.7 = janela do jogador em Táticas, secundárias plausíveis, mercado completo com filtros, estimativas que convergem e escala 1–20).

## Comandos
- `npm test` — testes (`node:test`, não Vitest). Rode sempre antes de dizer que algo funciona.
- `npm run typecheck:core` — checa só o motor/banco/serviços (sem React).
- `npm run typecheck` — checa tudo (precisa de `npm install`).
- `npm run dev` — Electron + Vite em desenvolvimento. `npm run package` — instalador Windows.
- `npm run pack -- validate|export|schema` — ferramenta de pacotes de dados (patches).
- Requer Node >= 22.18 com `erasableSyntaxOnly`: imports com extensão `.ts`, **sem enums**.

## Arquitetura (detalhes em docs/ARCHITECTURE.md)
- `src/shared`: tipos, datas, `api.ts` (contrato `GameApi` + DTOs), `UserError`.
- `src/game/*`: lógica pura, determinística (`createRng` com semente). Sem I/O. `game/data-pack`: formato dos pacotes de dados e montagem do universo (base + pacotes).
- `src/database`: interface `SqlDb`, migrações numeradas, repositórios.
- `src/services/*.node.ts`: usam fs. `src/main`: IPC validado com Zod. `src/preload`.
- `src/renderer`: React; só fala com o motor via `window.api`.
- Cada save é um arquivo SQLite independente (`saves/<profileId>/<careerId>/career.db`), copiado do universo (`compileUniverse`: **base fixa `data/base`** (16 países, congelada) + pacotes de dados; ver `docs/DATABASE.md`). IDs fixos e legíveis (`shared/slug.ts`). A carreira tem semente própria só para o acaso.
- Países com simulação completa × simplificada (`countries.sim_level`): rotinas detalhadas (finanças, treino, base, mercado da IA, diretoria/vagas, partidas lance a lance) filtram por `FULL_CLUBS`/`FULL_PLAYERS` (`simLevelRepository.ts`); simplificados usam `quickResult` e evolução anual na virada.

## Regras inegociáveis (cada uma tem teste)
1. Todo dinheiro passa por `makePoster`: saldo = saldo inicial + soma do extrato, para TODOS os clubes. Moeda exibida: euro (`fmtMoney`).
2. Jogador só entra em clube vindo de outro clube/livre via `executeTransfer`; saída sem destino (fim de contrato, aposentadoria) via `releasePlayer`; base → principal (mesmo clube) via `promoteFromYouth`.
3. O tempo só avança por `moveClock`, dia a dia: mercado do dia, depois fechamento mensal. Nunca passa de 1º/jul; a virada é `startNextSeason` (ação do usuário, atômica).
4. Classificação é derivada das partidas, nunca armazenada.
5. Rodada simulada é atômica.
6. Determinismo por semente (mesma semente = mesmo resultado).
7. O usuário só vê **estimativas** (`estimateRange`/`estimateAttributes`) de jogadores de outros clubes; as faixas estreitam com a observação e só com 100% de conhecimento mostram o valor exato. Força, potencial e compatibilidade aparecem na escala 1–20 (`shared/scale.ts`); o motor calcula em 0–100.
8. Nomes de classes CSS são únicos (há teste de guarda).
9. Sem botão decorativo, sem dado falso, sem resultado de teste inventado; relatar o que não foi executado.

## Método de trabalho
Implementar → testar → **teste de mutação** (injetar defeito e confirmar que o teste falha) → documentar em `docs/PROGRESS.md` (funcional / pendente / não executado).
Calibrações: `docs/MATCH_ENGINE.md`, `docs/FINANCE.md` (margem anual mediana ~+2%), `docs/TRANSFERS.md`, `docs/CAREER_CYCLE.md`, `docs/SCOUTING_YOUTH.md`, `docs/TRAINING_STAFF.md` e `docs/BOARD_JOBS.md` (estabilidade em várias temporadas).
Telas React só são "verificadas" depois que o usuário roda `npm run dev`; até lá, declarar como não verificadas.

## Estado e roadmap
- Fases 1–7 concluídas (7: tela ainda não verificada no Electron). v0.7.1 = correções pós-fase 7.
- 8A (ciclo de carreira) implementada e testada; telas não verificadas no Electron. Decisão pendente do usuário: prêmios × margem financeira (ver PROGRESS.md).
- Plano acordado com o usuário: **8A ciclo de carreira → 8B olheiros/base → 8C treino/staff/médico/infra → 8D diretoria/objetivos/propostas de emprego → fase de lapidação (SEM funcionalidades novas) → Fase 9 (universo: outros países, competições continentais, dados reais importáveis por schema) → Fase 10 (export/import de saves, backups, migrações, build Windows).**
- 8A e 8B commitadas (branches `fase-8a-ciclo-de-carreira` e `fase-8b-olheiros-base`) e verificadas pelo usuário.
- 8C (treino/comissão/médico/infra) commitada no branch `fase-8c-treino-staff-medico-infra` e verificada pelo usuário.
- 8D (diretoria/objetivos/empregos) commitada no branch `fase-8d-diretoria-empregos`; Diretoria e veto verificados pelo usuário (demissão/propostas só por testes). O treinador pode ficar sem clube (`clubId = ''`).
- Lapidação em andamento (branch `lapidacao-ui`, v0.8.1): nova interface (tema escuro grafite padrão + claro), ficha do jogador, Transferências com
  negociação em 3 etapas, centro de jogo ao vivo (linha do tempo minuto a minuto no motor, só observa) em tela cheia, marca FOOTERA e instalador.
  Validação do usuário pelo `docs/CHECKLIST_VALIDACAO.md`. Saves do app instalado ficam em `%APPDATA%\football-manager-simulator` (fixado no main.ts).
- v0.8.6 commitada (funções com popup verificadas pelo usuário; validação completa em andamento): ME/MD/AE/AD e SA/CA como posições; funções táticas (`playerRoles.ts`, migração 011,
  domínio que se aprende jogando/treinando); motor rebalanceado (`ZONE_EXP` 0,35, `K.chance` 0,070). Ver PROGRESS.md.
- v0.8.7 commitada (aguardando validação completa pelo checklist 13c). **Fase 9 em andamento** (branch `fase-9-base-de-dados`): etapa 1 da base
  editável commitada (`0304652`); base fixa de 16 países + países completos × simplificados feitos, sem commit; etapas 2–5 pendentes
  (tela de pacotes/.zip, fotos, editor+CSV, técnicos da IA); competições continentais depois. Ver `docs/DATABASE.md`.
- A especificação original do usuário deve ficar em `docs/SPEC.md` (ver PROGRESS.md: não consta no zip).
