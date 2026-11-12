# Desempenho do banco e do motor (v0.8.11, 10/11/2026)

O FOOTERA não tem servidor HTTP: o motor roda no processo principal do Electron, fala com a interface por IPC (`src/main/main.ts`, validado
com Zod) e cada save é um arquivo SQLite aberto com `node:sqlite` (`DatabaseSync`, síncrono; `better-sqlite3` só como alternativa se faltar).
A conexão de cada save fica aberta (até 2 saves; v0.8.9).

## Como medir
`npm run bench` (ou `node scripts/bench.ts [career.db] --n 7 --writes --out arquivo.json`). Usa uma **cópia** do save (o mais recente em
`%APPDATA%\football-manager-simulator\data\saves` se nenhum for informado) e mede todas as chamadas de leitura do IPC: média, p95, número de
consultas SQL, compilações de SQL, tempo dentro do SQLite e tamanho da resposta. `--writes` mede avançar 1 dia, 7 dias e a próxima rodada
(cada uma numa cópia nova). Com `node --expose-gc` a memória é lida depois da coleta.

## Diagnóstico (save real do usuário: 58 MB, 36.541 jogadores, 16.429 partidas, 1.111 clubes, 120 competições)
- **Leituras** quase todas abaixo de 6 ms. Exceções: mercado (95 ms, 607 consultas: a página monta 100 jogadores com ~5 consultas cada) e tela
  da temporada (84 ms, 449 consultas: a classificação de cada uma das 47 ligas).
- **Escritas** são o gargalo real: avançar 1 dia 245 ms (3.135 consultas), 7 dias 3,7 s, próxima rodada 748 ms.
- **Nenhuma consulta preparada era reaproveitada**: cada execução compilava a SQL de novo (ex.: o estado da carreira, 1.061 vezes num dia).
- **`EXPLAIN QUERY PLAN`:** a classificação usava o índice `(status, match_date)` e percorria as ~10 mil partidas jogadas para achar as de uma
  competição; a lista de observação dos olheiros (4 linhas) percorria os 36 mil jogadores pelo índice da base.
- **Perfil de CPU (7 dias, 4,6 s):** força do jogador recalculada montando um objeto achatado dos atributos (~1 s); COMMIT esperando o disco
  (`synchronous = FULL`, ~350 ms); elencos inteiros (`SELECT *` + JSON dos atributos) lidos 2.143 vezes pela contratação de livres da IA.
- Banco com cache de 2 MB (padrão) para um arquivo de 58 MB.
- Respostas do IPC pequenas (a maior, a rede social, 91 KB; o mercado pagina 100 por vez); a interface já espera 300 ms na digitação da busca.

## O que mudou
| Mudança | Onde | Por quê |
|---|---|---|
| Cache de consultas preparadas (LRU, 600 por conexão) | `database/connection.ts` (`withStatementCache`) | cada execução compilava a SQL de novo |
| PRAGMAs dos saves | `database/connection.ts` | ver abaixo |
| Índice `fixtures(competition_id, status, match_date)` | migração 033 | classificação, forma e resultados por competição |
| Lista de observação com `CROSS JOIN` (a lista comanda) | `scoutRepository.ts` | plano percorria todos os jogadores |
| Força sem objeto achatado (pesos em lista, leitura direta dos grupos) | `game/world/overall.ts` | ~20% do tempo de um dia |
| Elenco "leve" (id, posição, força, salário) na contratação de livres da IA | `transferRepository.ts` | `SELECT *` + JSON de centenas de elencos por dia |
| Cache de leitura do mercado até a próxima escrita | `database/writeMemo.ts`, `searchMarketPage` | "carregar mais" e a mesma busca refaziam a varredura |

### PRAGMAs (só saves em arquivo; a leitura dos resumos da lista de carreiras abre só para leitura, sem PRAGMAs)
- `journal_mode = WAL` (já existia): leitura não bloqueia a escrita.
- `synchronous = NORMAL`: **durabilidade** — com WAL o arquivo nunca corrompe, mas numa queda de energia ou travamento do sistema as últimas
  transações confirmadas podem se perder (no jogo: o último dia avançado volta). Um fechamento do jogo, mesmo forçado, não perde nada.
- `cache_size = -32000` (32 MB por conexão): **memória** — no máximo 2 saves abertos = 64 MB; o RSS medido no fim do benchmark ficou igual
  (333 → 323 MB), porque o cache só ocupa o que lê.
- `temp_store = MEMORY`: ordenações e agrupamentos temporários sem arquivo.
- `busy_timeout = 5000`: **concorrência** — o único escritor é a conexão do jogo; a leitura do resumo (outra conexão, só leitura) espera até 5 s
  em vez de falhar com `SQLITE_BUSY`.
- `mmap_size`: **não ativado** (nenhum ganho medido).
- `PRAGMA optimize` / `ANALYZE`: **não ativado**. Medido numa cópia: telas 1–3 ms mais rápidas, escritas iguais. Mas estatísticas mudam o plano
  de consultas sem `ORDER BY`, e a ordem das linhas alimenta o sorteio da simulação: a mesma carreira poderia divergir conforme o momento em que
  as estatísticas fossem gravadas (regra 6, determinismo). Os dois planos ruins encontrados foram corrigidos sem estatísticas (índice e
  `CROSS JOIN`).

### Índices avaliados e descartados (medidos numa cópia do save)
- `players(condition_pct) WHERE condition_pct < 100` (recuperação diária): 5,4 → 6,6 ms (3.495 jogadores abaixo de 100; o índice custa mais
  do que poupa e encarece cada atualização de condição).
- `players(market_value DESC, id)` (ordem do mercado): o planejador não usa (filtra pela base antes).

### Cache de leitura (`memoUntilWrite`)
Chave = consulta + versão de escrita da conexão (`total_changes()`: toda linha inserida, alterada ou apagada por ela, inclusive em transações
desfeitas). Cada save tem uma única conexão de escrita, então **qualquer** escrita (partida, transferência, observação, data, dispensa)
invalida tudo: não há TTL porque o dado nunca envelhece sem escrita. LRU de 8 entradas por conexão. Usado só no mercado (lista filtrada e
países), onde a medição mostrou ganho. Classificações, calendários, estatísticas e históricos **não** ganharam cache: já respondem em 0,3–4 ms
(a regra 4 — classificação derivada das partidas — continua literal: nada é gravado).

## Resultado (mesmo script, mesmo save, N = 7; antes = commit `cb3d83f`)
| Operação | Antes média / p95 (ms) | Depois média / p95 (ms) | Variação |
|---|---|---|---|
| Avançar 1 dia | 244,7 / 264,6 | 149,9 / 160,4 | −39% |
| Avançar 7 dias | 3.699 / 3.708 | 2.098 / 2.109 | −43% |
| Próxima rodada | 748,3 / 756,0 | 325,1 / 330,7 | −57% |
| Mercado (busca repetida / carregar mais) | 95,2 / 103,3 | 7,2 / 9,1 | −92% |
| Mercado (filtro novo, sem cache) | 92,6 / 98,0 | 68,6 / 77,6 | −26% |
| Mercado (livres) | 19,8 / 24,2 | 5,7 / 7,1 | −71% |
| Temporada | 83,6 / 87,9 | 43,7 / 49,0 | −48% |
| Abrir carreira (já aberta) | 14,3 / 17,2 | 8,7 / 9,9 | −39% |
| Abrir carreira (1ª vez na sessão) | 242 | 190 | −21% |
| Classificação | 1,5 / 1,7 | 0,7 / 0,9 | −53% |
| Perfil do clube | 11,2 / 11,6 | 7,4 / 9,1 | −34% |
| Diretoria | 5,9 / 6,3 | 3,2 / 3,8 | −46% |
| Contratos | 6,2 / 6,5 | 3,9 / 4,5 | −37% |

Compilações de SQL por chamada: de igual ao número de consultas para **0** depois da 1ª vez (ex.: mercado 508 → 0). As demais telas ficaram
iguais ou até 1 ms mais rápidas; rede social (1,7 → 2,3 ms) e técnicos livres (0,6 → 0,7 ms) variaram dentro do ruído de medição.
Memória (RSS depois da coleta, fim do benchmark): 333 → 323 MB; heap 19 → 18 MB.

## v0.8.12: treino diário sem regravar o universo (12/11/2026)
O treino por sessões (docs/TRAINING_STAFF.md) atualizava condição, carga e ritmo de todos os ~18 mil jogadores de clubes completos por dia: avançar
1 dia foi de 150 para ~375 ms, quase tudo no COMMIT (as linhas de `players` são largas, com o JSON dos atributos: ~3 mil páginas sujas por dia).
Solução: ritmo e carga de jogos guardados com a data (`sharp_on`, `acute_on`) e calculados na leitura (`fitnessState.ts`); só o clube do usuário e
os lesionados gravam o ritmo no dia; a condição só é regravada para quem não está em 100%; a varredura diária lê um índice de cobertura
(`idx_players_daily`) e só busca a linha inteira de quem precisa. O índice parcial de condição (`idx_players_tired`), que piorou na 0.8.11, agora
ajuda: a recuperação simples dos países simplificados deixou de varrer a tabela. Mesmo save já migrado, N = 7:

| Operação | v0.8.11 | v0.8.12 (1ª versão) | v0.8.12 |
|---|---|---|---|
| Avançar 1 dia | 150 | ~375 | 153 |
| Avançar 7 dias | 2.098 | ~2.350 | 1.132 |
| Próxima rodada | 325 | ~697 | 271 |

O primeiro dia depois de atualizar um save grava a data do ritmo em todos os jogadores uma vez (na migração 034).

## Garantias de que nada mudou
- **Hash do estado inteiro** (jogadores, partidas, finanças, transferências, estatísticas, lesões, clubes, notícias, funções) depois de 120 dias
  simulados com a mesma semente: idêntico no código antigo e no novo (`e93a32cdd2b8ace0`; simulação 3,7 s → 2,3 s em memória).
- `db-performance.test.ts` (7 testes): força igual à implementação anterior em mais de 15 mil casos (com e sem atributos de goleiro e com grupos
  incompletos); PRAGMAs aplicados e conexão só leitura intacta; consultas preparadas reaproveitadas, LRU, reentrância e fechamento; cache até a
  escrita (inclusive transação desfeita); mercado em cache igual à busca nova e atualizado na hora por dispensa e lista de observação; índice
  usado pela classificação e classificação igual à calculada das partidas.
- Suíte completa (`npm test`) passando.

## Abertura do app em desenvolvimento (v0.8.12, 12/11/2026)
`npm run dev` mostrava a janela vazia e sem resposta por ~15 s. Marcos no processo principal (`[perf] abertura: …`): Electron pronto em ~30 ms,
DOM pronto em 15,3 s — o atraso era do Vite servindo o `main.tsx`. Perfil de CPU: 12,4 s em `FSWatcher` (o observador de arquivos cobre a pasta do
projeto e `release/`, com os instaladores descompactados, tem ~21 mil arquivos). `vite.config.ts` passou a ignorar `release/`, `dist/`,
`dist-electron/`, `build/`, `data/`, `docs/`, `notebooks/` e `scripts/` no observador e a usar só o `index.html` na varredura de dependências.
Resultado: DOM pronto em 2,1 s. O app instalado carrega o renderer já empacotado (sem Vite).

## Limitações e próximos passos possíveis
- O avanço do tempo continua dominado pelo motor de partidas (escolha de formação × jogadores, lance a lance) e pelo COMMIT (~10 ms por dia,
  gravação real no WAL de milhares de jogadores). Mover a simulação para uma Worker Thread tiraria o trabalho da thread principal, mas exige uma
  conexão própria no worker e serialização do resultado; não foi feito.
- A força poderia ser memorizada por jogador, mas há código que altera atributos no próprio objeto (`development.ts`, `goalkeeper.ts`): um cache
  por objeto devolveria valores velhos. Não foi feito.
- A tela da temporada ainda calcula a classificação inteira das 47 ligas para mostrar só o líder (44 ms).
- O mercado sem cache (filtro novo) ainda varre ~35 mil jogadores (69 ms); filtros por posição e idade são aplicados em JavaScript.
- Medições de renderização no Electron (tempo de pintura, re-renderizações do React) não foram feitas: o benchmark mede o motor e o IPC.
