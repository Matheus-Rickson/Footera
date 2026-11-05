# Base de dados editável — pacotes de dados (patches)

Decisões do usuário (04/11/2026): JSON como formato principal (+ CSV para planilhas, etapa 4); pacotes valem para **carreiras novas**
(exceto fotos e nomes, que poderão ser aplicados a saves existentes); começar pela etapa 1. O jogo vem só com dados fictícios: nomes e fotos
reais têm direitos de imagem e de marca, então pacotes com dados reais são feitos e distribuídos pelos usuários.

## Como o universo é montado
`universo = base + pacotes na ordem de carga` (`compileUniverse`, em `src/game/data-pack/compile.ts`, puro e determinístico).
- **Base:** o mundo gerado pela semente da carreira — ou nada, se o primeiro pacote declarar `"base": "none"` (base de dados completa).
- **Pacotes:** aplicados em ordem; o último vence em caso de conflito. O save grava quais pacotes usou (`meta.data_packs`, `id@versão`).
- Depois dos pacotes: validação de tudo (referências e regras do jogo) e **elencos completados** (clube com menos de `squadMin + 2`
  jogadores ou menos de 2 goleiros ganha jogadores gerados do país do clube, com aviso). Erro em qualquer pacote = nada é aplicado.

## IDs fixos
Todo registro tem um `id` único no universo inteiro: minúsculas, números, `-` e `_`, até 60 caracteres (ex.: `joao-silva-1998`).
- Na base gerada: países `bra`, `eng`; ligas `bra-1`, `bra-2`, `eng-1`, `eng-2` (**fixos**); clubes e estádios pelo nome; jogadores por
  `nome-sobrenome-ano`. **Clubes, estádios e jogadores da base gerada dependem da semente** — um patch que altera um jogador da base só
  funciona em carreiras com a mesma semente. Para dados próprios (ligas reais, por exemplo), crie as entidades com IDs seus ou use uma
  base completa (`"base": "none"`).
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
2. Pacotes e ordem de carga na interface (tela "Pacotes de dados" no menu principal; `.zip`; pasta de pacotes do usuário).
3. Fotos e escudos (jogadores, clubes, técnicos, competições), por pacote e pela pasta de fotos do usuário; protocolo próprio do Electron.
4. Editor no jogo (salva num pacote do usuário) + importação/exportação CSV.
5. Técnicos dos clubes da IA como entidade (nome, nacionalidade, foto, reputação, metodologia → tática da IA).
