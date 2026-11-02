# CLAUDE.md — Football Manager Simulator

Jogo de gerenciamento de futebol offline (estilo Football Manager/Brasfoot), **em português do Brasil**.
Stack: Electron + React + TypeScript + Vite + SQLite (`node:sqlite`, fallback `better-sqlite3`) + Zod. Alvo: Windows.
Motor separado da UI. Versão atual: ver `package.json` (0.7.1).

## Comandos
- `npm test` — testes (`node:test`, não Vitest). Rode sempre antes de dizer que algo funciona.
- `npm run typecheck:core` — checa só o motor/banco/serviços (sem React).
- `npm run typecheck` — checa tudo (precisa de `npm install`).
- `npm run dev` — Electron + Vite em desenvolvimento. `npm run package` — instalador Windows.
- Requer Node >= 22.18 com `erasableSyntaxOnly`: imports com extensão `.ts`, **sem enums**.

## Arquitetura (detalhes em docs/ARCHITECTURE.md)
- `src/shared`: tipos, datas, `api.ts` (contrato `GameApi` + DTOs), `UserError`.
- `src/game/*`: lógica pura, determinística (`createRng` com semente). Sem I/O.
- `src/database`: interface `SqlDb`, migrações numeradas, repositórios.
- `src/services/*.node.ts`: usam fs. `src/main`: IPC validado com Zod. `src/preload`.
- `src/renderer`: React; só fala com o motor via `window.api`.
- Cada save é um arquivo SQLite independente (`saves/<profileId>/<careerId>/career.db`), copiado do universo.

## Regras inegociáveis (cada uma tem teste)
1. Todo dinheiro passa por `makePoster`: saldo = saldo inicial + soma do extrato, para TODOS os clubes.
2. Jogador só muda de clube via `executeTransfer`.
3. O tempo só avança por `moveClock`, dia a dia: mercado do dia, depois fechamento mensal.
4. Classificação é derivada das partidas, nunca armazenada.
5. Rodada simulada é atômica.
6. Determinismo por semente (mesma semente = mesmo resultado).
7. O usuário só vê **estimativas** (`estimateRange`) de jogadores de outros clubes.
8. Nomes de classes CSS são únicos (há teste de guarda).
9. Sem botão decorativo, sem dado falso, sem resultado de teste inventado; relatar o que não foi executado.

## Método de trabalho
Implementar → testar → **teste de mutação** (injetar defeito e confirmar que o teste falha) → documentar em `docs/PROGRESS.md` (funcional / pendente / não executado).
Calibrações: `docs/MATCH_ENGINE.md`, `docs/FINANCE.md` (margem anual mediana ~+2%), `docs/TRANSFERS.md`.
Telas React só são "verificadas" depois que o usuário roda `npm run dev`; até lá, declarar como não verificadas.

## Estado e roadmap
- Fases 1–7 concluídas (7: tela ainda não verificada no Electron). v0.7.1 = correções pós-fase 7.
- Plano acordado com o usuário: **8A ciclo de carreira → 8B olheiros/base → 8C treino/staff/médico/infra → 8D diretoria/objetivos/propostas de emprego → fase de lapidação (SEM funcionalidades novas) → Fase 9 (universo: outros países, competições continentais, dados reais importáveis por schema) → Fase 10 (export/import de saves, backups, migrações, build Windows).**
- Próximo passo imediato: `docs/PHASE_8A_PLAN.md`.
- A especificação original do usuário deve ficar em `docs/SPEC.md` (ver PROGRESS.md: não consta no zip).
