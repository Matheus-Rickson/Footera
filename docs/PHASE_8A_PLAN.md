# Fase 8A — Ciclo de carreira (IMPLEMENTADO — estado em `PROGRESS.md`, regras em `CAREER_CYCLE.md`)

Refeita do zero nesta sessão (o trabalho parcial anterior tinha se perdido).

## Decisões de projeto
- A virada de temporada é **ação do usuário**, em 1º de julho, e o mercado de verão abre nesse dia.
- Ordem da virada: resultados → prêmios → promoção/rebaixamento por país → aposentadorias → contratos (IA renova 90%/55%; o usuário **não** renova automaticamente) → snapshot de desenvolvimento → entrada de jovens → zerar suspensões e amarelos → `season + 1` → `ensureSeason`.
- Prêmio do campeão = `economia × 2,4M` na 1ª divisão; último colocado recebe 10% disso; 2ª divisão ×0,23.
- Desenvolvimento respeita o teto de potencial até os 28 anos.

## Checklist
- [x] Migração `007_career_cycle`: `players.retired`, `player_development`, `season_results`, `trophies`, `news`.
- [x] `src/game/career-engine/development.ts`: `developPlayer`, `expectedChange`, `retirementChance`, `prizeMoney` + `src/tests/development.test.ts`.
- [x] Extrair `moveClock(db, today, target, now, beforeDay?)` de `advanceTime` (`competitionRepository.ts`). *Feito como `moveClock(db, from, to, now)`: o gancho `beforeDay` não foi necessário — o dia da virada é deixado para `startNextSeason`.*
- [x] `playerInserter` em `worldRepository.ts`; exportar `buildPlayer`/`marketValue`/`SQUAD_TEMPLATE` e suportar `forceAge`/idade ≤ 16 em `generator.ts`.
- [x] Jogadores livres (`clubId: null`) em `transferRepository.ts`: busca, oferta com taxa 0, `aiSignFreeAgents`.
- [x] Categoria financeira `prize`.
- [x] `seasonRepository`: `isSeasonComplete`, `getSeasonStatus`, `startNextSeason`, `renewContract`, `getNews`, `getHistory`, `getTrophies`. *`getNews` ficou em `newsRepository.ts` (usado também por `executeTransfer`, evitando dependência circular); `getContracts` foi acrescentado.*
- [x] DTOs/`GameApi`: `NewsDto`, `SeasonStatusDto`, `NewSeasonReportDto`, `HistoryRowDto`, `TrophyDto`, `RenewInput/Result`; ligação service/IPC/preload.
- [x] UI: fim de temporada, renovação, notícias, histórico, troféus. (**escrita, não verificada no Electron**)
- [x] Testes com mutações (invariantes de dinheiro, transferência e determinismo seguem valendo após a virada).
