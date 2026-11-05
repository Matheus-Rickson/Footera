# Base de dados editável — pacotes de dados (patches)

Decisões do usuário (04/11/2026): JSON como formato principal (+ CSV para planilhas, etapa 4); pacotes valem para **carreiras novas**
(exceto fotos e nomes, que poderão ser aplicados a saves existentes); começar pela etapa 1. O jogo vem só com dados fictícios: nomes e fotos
reais têm direitos de imagem e de marca, então pacotes com dados reais são feitos e distribuídos pelos usuários.

## Base fixa (decisão do usuário, 04/11/2026)
O jogo vem com **uma única base fictícia**, igual para todos os jogadores e todas as carreiras, gravada como pacote em `data/base/`
(`footera-base@1.0.0`, ~15 MB): 16 países — Brasil e Inglaterra com 4 divisões; Espanha e Alemanha com 3; Itália, França, Portugal,
Holanda, Argentina, Bélgica, Japão, Áustria, México, Irlanda, Croácia e Rússia com 2 — 672 clubes e 16.800 jogadores.
- A base foi gerada uma vez (`npm run pack -- build-base`, semente `BASE_SEED`) e fica **congelada**: mudanças no gerador não a afetam.
  Regenerar exige `--force` e uma versão nova (`BASE_VERSION`), porque patches feitos para a anterior podem deixar de funcionar.
- **Semente:** a carreira não escolhe mais semente. Cada carreira ganha uma semente interna só para o acaso (resultados, lesões, peneiras);
  o universo é sempre a base. Por isso um patch feito para a base vale em qualquer carreira.
- Nomes de cidades e clubes são fictícios; as listas de nomes evitam combinações de jogadores famosos reais.

## Países completos e simplificados
Na criação da carreira o usuário escolhe os países com **simulação completa** (o do clube entra sempre); os demais ficam **simplificados**
(`countries.sim_level`, migração 013). Detalhes em `docs/PROGRESS.md` (Fase 9).

## Como o universo é montado
`universo = base + pacotes na ordem de carga` (`compileUniverse`, em `src/game/data-pack/compile.ts`, puro e determinístico).
- **Base:** a base fixa (`data/base`) na carreira; nos testes e na linha de comando, o mundo gerado por semente. Um pacote com
  `"base": "none"` (base de dados completa) descarta a base.
- **Pacotes:** aplicados em ordem; o último vence em caso de conflito. O save grava quais pacotes usou (`meta.data_packs`, `id@versão`).
- Depois dos pacotes: validação de tudo (referências e regras do jogo) e **elencos completados** (clube com menos de `squadMin + 2`
  jogadores ou menos de 2 goleiros ganha jogadores gerados do país do clube, com aviso). Erro em qualquer pacote = nada é aplicado.

## IDs fixos
Todo registro tem um `id` único no universo inteiro: minúsculas, números, `-` e `_`, até 60 caracteres (ex.: `joao-silva-1998`).
- Na base fixa: países pelo código (`bra`, `eng`, `esp`…); ligas `<país>-<divisão>` (`bra-1` … `bra-4`); clubes e estádios pelo nome;
  jogadores por `nome-sobrenome-ano`. Todos **fixos** (a base é congelada). Abra `data/base/` para achar os IDs.
- Jogadores da base criados durante a carreira (peneiras) usam outro formato e não entram em pacotes.

## Estrutura do pacote
```
meu-patch/
  manifest.json     obrigatório
  countries.json  leagues.json  stadiums.json  clubs.json  players.json   (todos opcionais)
```
Cada arquivo é uma lista (`[ … ]`). Os arquivos são aplicados nessa ordem (países → ligas → estádios → clubes → jogadores).
Arquivos `.json` com outros nomes são erro (evita um `jogadores.json` ignorado em silêncio). UTF-8 com ou sem BOM.

### manifest.json
| Campo | Obrigatório | Descrição |
|---|---|---|
| `format` | sim | versão do formato: `1` |
| `id` | sim | id do pacote |
| `name`, `version` | sim | nome e versão (texto livre, ex.: `1.2.0`) |
| `author`, `description` | não | |
| `requires` | não | ids de pacotes que precisam vir **antes** na ordem de carga |
| `base` | não | `"none"` = base de dados completa (descarta o mundo gerado; só como primeiro pacote) |

### Três operações por registro
- **Criar:** o `id` ainda não existe → precisa dos campos obrigatórios (abaixo).
- **Alterar:** o `id` já existe → muda **só** os campos informados (`{ "id": "joao-silva-1998", "club": "outro-clube" }`).
- **Remover:** `{ "id": "…", "$remove": true }`. Clube removido deixa os jogadores sem clube (aviso). Remover id inexistente = aviso.
- Campo desconhecido é **erro** (pega erros de digitação como `fistName`).

### Campos
**countries:** `code` (3 letras, ex.: `ARG`) e `name` obrigatórios para criar; `economy` (0,1–5; padrão 1: escala salários e valores).

**leagues:** `country`, `name`, `tier` (1 = primeira divisão) obrigatórios; `rules` opcional: `rounds`, `pointsWin`, `pointsDraw`,
`promotionSlots`, `relegationSlots`, `continentalSlots`, `maxForeignPlayers` (ou `null`), `squadMin`, `squadMax`,
`calendar` (`seasonStart` "MM-DD", `matchWeekday` 0–6, `intervalDays`). O número de clubes vem dos clubes da liga.
Regras conferidas: divisões de cada país 1, 2, 3… sem buracos; quem rebaixa N na divisão de cima sobe N na de baixo; ao menos 2 clubes.

**stadiums:** `name` obrigatório; `city`, `capacity` (500–250.000).

**clubs:** `name`, `country`, `league` obrigatórios (a liga precisa ser do mesmo país); `shortName` (2–5), `city`, `stadium`
(sem estádio, um é criado: `<id>-estadio`), `reputation` (1–100; padrão 50), `balance`, `fans`, `facilities` (`training`, `youth`,
`medical`, `stadium`, 1–20). O que faltar é derivado da reputação, como no gerador.

**players:** `firstName`, `lastName`, `birthDate` (AAAA-MM-DD; 15 a 45 anos na data de início), `nationality` (3 letras),
`position`, `club` (id ou `null` = livre) obrigatórios, **mais** `attributes` (os 23) **ou** `ability`.
- `ability` (1–20, a força como aparece na tela): o jogo gera atributos com o perfil da posição para chegar nela. Com `attributes` parciais
  junto, os informados prevalecem.
- `attributes`: `technical` (finishing, passing, dribbling, tackling, marking, firstTouch, crossing, heading, longShots, goalkeeping),
  `mental` (vision, composure, decisions, positioning, workRate, leadership, aggression), `physical` (pace, stamina, strength, agility,
  jumping, naturalFitness), de 1 a 20. Ao alterar, pode mandar só alguns.
- Opcionais: `potential` (1–20), `secondaryPositions` (até 3; fora das vizinhas no campo gera aviso), `foot` (`right`/`left`/`both`),
  `heightCm`, `weightKg`, `extraNationalities`, `personality` (professionalism, ambition, loyalty, temperament, consistency; 1–20),
  `contract` (`salary`, `end`), `marketValue`. O que faltar é calculado (valor pela força/idade/potencial; salário 1,2% do valor; contrato 1–4 anos).
- `internal`: valores do motor (0–100) que a exportação grava para reproduzir a base exatamente; autores normalmente não usam.
- Posições: `GK`, `CB`, `LB`, `RB`, `LWB`, `RWB`, `DM`, `CM`, `LM`, `RM`, `AM`, `LW`, `RW`, `SS`, `CF` (`ST` = atacante dos universos antigos).
- **Goleiro:** `attributes.goalkeeper` com `reflexes`, `oneOnOne`, `handling`, `aerial`, `rushingOut`, `kicking` (1–20). O
  `technical.goalkeeping` passa a ser calculado deles (média ponderada 3/2/2/1,5/1/0,5); informar só o `goalkeeping` deriva o grupo.

## Ferramentas
- `npm run pack -- validate <pasta> [<pasta> …] [--seed <semente>]` — valida na ordem de carga e mostra erros e avisos com pacote › arquivo › registro.
- `npm run pack -- export <pasta> [--seed <semente>]` — exporta a base gerada como pacote completo (ponto de partida para editar).
- `npm run pack -- schema` — regenera `docs/schema/*.schema.json` (há teste que exige que estejam em dia).
- **JSON Schema** em `docs/schema/`: dá autocompletar e validação ao digitar. Como os arquivos de dados são listas, a associação é feita
  na configuração do editor. No VS Code (`settings.json`):
  ```json
  "json.schemas": [
    { "fileMatch": ["**/meu-patch/players.json"], "url": "./docs/schema/players.schema.json" },
    { "fileMatch": ["**/meu-patch/manifest.json"], "url": "./docs/schema/manifest.schema.json" }
  ]
  ```
- Exemplo completo e validado por teste: `docs/exemplos/pacote-exemplo/`.

## Etapas
1. **Formato, IDs fixos, montagem do universo, validador, exportação e JSON Schema** — feito (v0.9.0-dev). A carreira nova já passa
   pela montagem (sem pacotes ainda: a escolha chega na etapa 2).
1b. **Base fixa (16 países) e países completos × simplificados** — feito (sem commit). Ver PROGRESS.md.
2. **Pacotes e ordem de carga na interface** — feito (sem commit). Tela "Pacotes de dados" no menu principal: pasta do usuário
   `<dados>/packs/<id>/` (no app instalado: `%APPDATA%\football-manager-simulator\data\packs`), ordem em `packs/load-order.json`;
   ativar/desativar, subir/descer, importar `.zip` (raiz ou uma pasta; leitor próprio com limites e caminhos seguros), substituir
   (pergunta antes), remover, abrir a pasta, erros por pacote e resumo/erros do universo resultante. A base é sempre a primeira.
   Pacotes com erro de estrutura não ativam; combinação com erro bloqueia a carreira nova com mensagem. A carreira nova usa base +
   pacotes ativos e grava a lista em `meta.data_packs`. `npm run pack -- zip <pasta> <arquivo.zip>` gera o .zip;
   exemplo pronto: `docs/exemplos/pacote-exemplo.zip`.
3. **Fotos e escudos** — feito (sem commit). No pacote: `images/players/<id>.png|jpg` (foto do jogador), `images/clubs/<id>` (escudo) e
   `images/stadiums/<id>` (foto do estádio) e `images/leagues/<id>` (logo da liga); PNG ou JPEG validados pelo conteúdo, até 5 MB, de 64 a 4096 px. Vêm dos pacotes ATIVOS (o último
   da ordem vence), inclusive em carreiras já criadas; desativar o pacote tira as imagens. O jogo serve só o que está no índice
   (`footera-img://img/<tipo>/<id>`), sem caminho vindo da tela. Importar/exportar .zip leva as imagens; imagem inválida recusa o pacote.
   No editor: campo de imagem na liga (logo), no clube (escudo e foto do estádio) e no jogador (gravado na hora). O logo da liga aparece
   nas divisões e no painel do clube (nova carreira) e em Competições. Técnicos e competições continentais ficam para quando existirem.
4. **Editor de dados** — feito (sem commit), menu principal → "Editor de dados". Edita um pacote do usuário em cima da base (o que
   aparece é "base + este pacote"): países, ligas, clubes (com estádio) e jogadores; criar (jogador pela força, clube com estádio),
   alterar (o pacote guarda só a diferença; voltar ao original tira o registro), excluir (da base vira `$remove`, restaurável), restaurar,
   detalhes do pacote (nome, versão, autor, descrição) e exportar .zip. Cada gravação valida o universo inteiro antes de escrever.
   Pacote novo já entra ativo no fim da ordem de carga. CSV fica para depois.
5. Técnicos dos clubes da IA como entidade (nome, nacionalidade, foto, reputação, metodologia → tática da IA).
