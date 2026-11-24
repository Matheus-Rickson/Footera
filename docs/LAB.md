# Laboratório (v0.9.0)

Programa de testes à parte do jogo, para testes específicos sob demanda. Tem janela própria e um executor de terminal que usam o mesmo código. **Nada no Laboratório altera os saves do jogo.** Ele não entra no instalador: o `build.files` do electron-builder só leva `dist`, `dist-electron` e `data`.

## Como abrir
- **Janela:** `npm run lab`. Compila para `dist-lab/` e abre o Electron. `node scripts/lab.mjs --so-compilar` só compila.
- **Terminal:**
  - `npm run lab:run -- lista`: lista os cenários.
  - `npm run lab:run -- <cenário> ajuda`: mostra os parâmetros de um cenário.
  - `npm run lab:run -- <cenário> chave=valor ...`: roda o cenário. Grava `lab-reports/<data>-<cenário>.html` e `.json`. Opções: `--saida <pasta>` muda o destino; `--sem-arquivos` só imprime.
  - Exemplo: `npm run lab:run -- lote-partidas n=1000 homeMentality=attacking seed=x`.
- Com os mesmos parâmetros, a janela e o terminal dão o mesmo relatório (conferido: lote de 300 jogos idêntico, fora o tempo medido). A janela salva relatórios em `lab-reports/` pelo botão "Salvar HTML e JSON", e a pasta está no `.gitignore`.

## Cenários
| id | O que faz | Parâmetros principais |
|---|---|---|
| `lote-partidas` | Simula N jogos com o motor da carreira (`simulateMatch`). Mostra gols, xG, mando, 0x0, cartões, substituições, lesões, acréscimos e anomalias, a tabela por lado, os placares mais comuns e os jogos extremos. | `universe` (`calib` ou `base`), `homeClub`/`awayClub` (vazio = sorteio entre clubes médios da 1ª liga), `n`, `alternate` (alterna o mando), `seed`, e para cada lado `Formation`, `Mentality`, `Pressing`, `Tempo`, `Line` |
| `inspetor-partida` | Refaz um jogo do lote (os mesmos parâmetros mais `game` = número do jogo) e mostra o placar, as estatísticas, o lance a lance narrado e as notas de cada jogador. | os do lote, sem `n`, mais `game` |
| `calibracao` | Confere as metas de realismo contra as faixas de referência (gols 2,5–2,9; mandante 43–48%; empate 23–29%; visitante 27–32%; 0x0 6–10%; amarelos 3–4,5; vermelhos 0,05–0,15; acréscimos 2–3 e 4–6 min; xG próximo dos gols). Também testa o determinismo (20 jogos refeitos) e, opcionalmente, o equilíbrio entre formações em rodízio. | `universe`, `n`, `formations`, `perFormation`, `seed` |
| `inspetor-save` | Copia um save para uma pasta temporária e trabalha só na cópia. Mostra a situação, a tabela da liga, o elenco, as finanças e a base. Pode avançar N dias: simula os jogos do clube e faz a virada de temporada quando a data chega. No fim mostra o antes e depois, e a cópia é apagada. | `save` (lista dos saves) ou `path` (caminho de um `career.db`), `days`, `squad`, `finance`, `youth` |

Universos:
- `calib`: o universo procedural de calibração, com Brasil e Inglaterra em 2 divisões. É o mesmo usado em `docs/MATCH_ENGINE.md`.
- `base`: a base fixa `data/base` com 16 países, sem pacotes.
- Nos dois, os jogadores entram descansados (condição 100, moral 70, forma 60).

## Leitura dos números
- **Erro-padrão.** Os indicadores mostram o erro-padrão (±) quando faz sentido. Por exemplo, com 70 jogos por formação o erro de pontos por jogo é de cerca de ±0,16. Por isso, uma diferença de 0,4 entre formações nesse tamanho de amostra ainda é ruído. Para conclusões, use 400 jogos ou mais por formação.
- **Anomalias.** Contam jogos com nota fora de 3–10, posse que não soma 100%, minutos inválidos ou números não finitos. O esperado é 0.

## Segurança dos saves
- **Listagem.** A lista de saves lê só o `profiles.json` e os metadados dos arquivos. O `career.db` original nunca é aberto, porque abrir um banco pode rodar migrações.
- **Cópia.** `copySave` copia o `career.db` e o `-wal` para `%TEMP%/footera-lab-*/saves/<perfil>/<carreira>/`. O cenário fecha a conexão e apaga a pasta no `finally`.
- **Teste.** `src/tests/lab.test.ts` cria uma carreira temporária, roda o inspetor avançando dias e confere que o original fica igual: mesmo hash, nenhum `-wal`/`-shm` criado ao lado e mesma data de modificação.

## Código
- **Núcleo** (Node puro, sem Electron):
  - `lab/core/types.ts`: o cenário, os parâmetros e as seções do relatório (kpis, table, checks, bars, events, text).
  - `registry.ts`: o catálogo, a validação dos parâmetros (`resolveParams` rejeita chave desconhecida, número fora da faixa e opção inexistente) e `runScenario`.
  - `universe.ts`: os universos em cache e a escalação (`sheetFor`).
  - `stats.ts`: médias, erro-padrão, acréscimos e anomalias.
  - `saves.ts`: listagem e cópia dos saves.
  - `render.ts`: o relatório em HTML estático (tema claro e escuro, sem scripts) e em texto.
  - Os cenários ficam em `lab/core/scenarios/`.
- **Terminal:** `lab/cli.ts`.
- **Janela:**
  - `lab/electron/main.ts`: a janela e o IPC. Roda uma execução por vez num `worker_thread`, e Cancelar encerra o worker.
  - `lab/electron/preload.ts`: `window.lab`.
  - `lab/electron/worker.ts`.
  - `lab/renderer/`: React, com o visual do jogo (`tokens`, `base`, `ui.css`) e só classes `lab-*`.
- **Build:** `scripts/lab.mjs` usa vite para a tela e esbuild para `main`, `preload` e `worker`, que viram `.cjs`. A variável `FOOTERA_LAB_ROOT` aponta a raiz do repositório para os bundles.

## Como acrescentar um cenário
1. Criar `lab/core/scenarios/<nome>.ts` exportando um `Scenario` com `id`, `title`, `description`, `params` e `run(params, ctx)`. O `run` devolve `{ sections }`, chama `ctx.onProgress` e, em laços longos, lança `Cancelled` quando `ctx.cancelled()` for verdadeiro.
2. Registrar em `SCENARIOS` (`registry.ts`). A janela gera o formulário a partir de `params`. As listas dinâmicas usam `source: 'clubs' | 'formations' | 'saves'`.
3. Acrescentar o teste em `src/tests/lab.test.ts`.

## Próximos cenários (plano)
- **Fase B (feito em parte):** os cenários de lote e de calibração têm o parâmetro `engine` (v1 ou v2; padrão = o do jogo), e a calibração mede também finalizações, passes, faltas, escanteios e impedimentos por time. Falta o replay no mapa dentro do inspetor de partida.
- **Fase D:** projeção da base, que simula X temporadas numa cópia do save.
