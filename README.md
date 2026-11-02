# Football Manager Simulator

Jogo de gerenciamento de futebol **offline** (Electron + React + TypeScript + SQLite), com universo procedural,
motor de partidas próprio e carreiras persistentes. Projeto em desenvolvimento por fases — veja `docs/PROGRESS.md`.

## Requisitos
- Node.js 22.18 ou superior (usa `node:sqlite` e execução nativa de TypeScript nos testes)
- Windows 10/11 para o instalador (o desenvolvimento funciona também em macOS/Linux)

## Comandos
| Comando | O que faz |
|---|---|
| `npm install` | Instala dependências |
| `npm test` | Testes automatizados (`node:test`, sem dependências): núcleo, banco, fotos, perfis e saves |
| `npm run typecheck:core` | Verificação de tipos do núcleo (shared, game, database, services) |
| `npm run typecheck` | Verificação de tipos completa (requer `npm install`) |
| `npm run dev` | Vite + Electron em modo desenvolvimento |
| `npm run build` | Typecheck + build do renderer e do Electron |
| `npm run package` | Gera instalador Windows (NSIS) em `release/` |

## Estrutura
Veja `docs/ARCHITECTURE.md`. Regra central: `src/game`, `src/database`, `src/services` e `src/shared`
não importam React nem Electron; a interface apenas consome serviços via IPC validado.

## Dados
O universo inicial é **fictício e procedural** (reprodutível por semente). Não há base de dados real incluída.
A importação de dados reais (CSV/JSON validados por esquema) está planejada para a Fase 9.
