# Fase 8A — Ciclo de carreira (PLANO; nada abaixo está implementado)

Um trabalho parcial de 8A foi feito numa sessão anterior e **perdeu-se** (nunca foi empacotado). Refazer do zero conforme abaixo.

## Decisões de projeto
- A virada de temporada é **ação do usuário**, em 1º de julho, e o mercado de verão abre nesse dia.
- Ordem da virada: resultados → prêmios → promoção/rebaixamento por país → aposentadorias → contratos (IA renova 90%/55%; o usuário **não** renova automaticamente) → snapshot de desenvolvimento → entrada de jovens → zerar suspensões e amarelos → `season + 1` → `ensureSeason`.
- Prêmio do campeão = `economia × 2,4M` na 1ª divisão; último colocado recebe 10% disso; 2ª divisão ×0,23.
- Desenvolvimento respeita o teto de potencial até os 28 anos.

## Checklist
- [ ] Migração `007_career_cycle`: `players.retired`, `player_development`, `season_results`, `trophies`, `news`.
- [ ] `src/game/career-engine/development.ts`: `developPlayer`, `expectedChange`, `retirementChance`, `prizeMoney` + `src/tests/development.test.ts`.
- [ ] Extrair `moveClock(db, today, target, now, beforeDay?)` de `advanceTime` (`competitionRepository.ts`).
- [ ] `playerInserter` em `worldRepository.ts`; exportar `buildPlayer`/`marketValue`/`SQUAD_TEMPLATE` e suportar `forceAge`/idade ≤ 16 em `generator.ts`.
- [ ] Jogadores livres (`clubId: null`) em `transferRepository.ts`: busca, oferta com taxa 0, `aiSignFreeAgents`.
- [ ] Categoria financeira `prize`.
- [ ] `seasonRepository`: `isSeasonComplete`, `getSeasonStatus`, `startNextSeason`, `renewContract`, `getNews`, `getHistory`, `getTrophies`.
- [ ] DTOs/`GameApi`: `NewsDto`, `SeasonStatusDto`, `NewSeasonReportDto`, `HistoryRowDto`, `TrophyDto`, `RenewInput/Result`; ligação service/IPC/preload.
- [ ] UI: fim de temporada, renovação, notícias, histórico, troféus.
- [ ] Testes com mutações (invariantes de dinheiro, transferência e determinismo seguem valendo após a virada).
