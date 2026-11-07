# FOOTERA

Jogo de gerenciamento de futebol **offline**, em português do Brasil, no estilo Football Manager/Brasfoot.
Electron + React + TypeScript + Vite + SQLite (`node:sqlite`). Alvo: Windows. Versão atual: **0.8.7** (Fase 9 em andamento).

## O que já existe
- **Carreira**: escolha de países, clube e treinador (atributos, metodologia, foto). A carreira começa no início da temporada do país do
  clube (01/01/2026 no ano civil, 01/07/2026 nos países de julho a junho), com os países do outro calendário na metade da temporada.
- **Universo**: base fixa com 16 países (ligas, clubes, jogadores, técnicos, estádios), temporada por país (julho a junho ou ano civil),
  copas e supercopas nacionais com regulamentos reais, simulação completa ou simplificada por divisão.
- **Partidas**: motor lance a lance com funções táticas, centro de jogo ao vivo (substituições, vestiário, sugestões do auxiliar),
  relatórios e estatísticas (artilheiros, assistências, jogos sem sofrer gols).
- **Gestão**: elenco, táticas, contratos, transferências (negociação em 3 etapas, mercado com filtros, jogadores livres), olheiros com
  estimativas que estreitam com a observação, categorias de base, treino, comissão técnica, departamento médico, infraestrutura,
  finanças, diretoria (objetivos, confiança, demissão) e propostas de emprego.
- **Dia a dia**: botão Continuar (avança dia a dia e para no jogo do seu clube ou em decisões), Visão geral, Caixa de entrada, rede
  social de notícias, conversas e promessas com jogadores e diretoria, ficha completa de clubes e técnicos.
- **Dados editáveis**: pacotes de dados (.zip) por cima da base, editor de dados dentro do jogo (países, ligas, clubes, jogadores,
  técnicos, copas, imagens) e planilhas CSV.

Detalhes do que está pronto, pendente e não verificado: `docs/PROGRESS.md`. Roteiro de validação: `docs/CHECKLIST_VALIDACAO.md`.

## Requisitos
- Node.js 22.18 ou superior (usa `node:sqlite` e execução nativa de TypeScript)
- Windows 10/11 para o instalador (o desenvolvimento funciona também em macOS/Linux)

## Comandos
| Comando | O que faz |
|---|---|
| `npm install` | Instala as dependências |
| `npm test` | Testes automatizados (`node:test`) |
| `npm run typecheck:core` | Verificação de tipos do motor, banco e serviços (sem React) |
| `npm run typecheck` | Verificação de tipos completa |
| `npm run dev` | Vite + Electron em modo desenvolvimento |
| `npm run build` | Typecheck + build do renderer e do Electron |
| `npm run package` | Gera o instalador Windows (NSIS) em `release/` |
| `npm run pack -- validate\|export\|schema` | Ferramenta de pacotes de dados |

## Estrutura
- `src/game`: regras puras e determinísticas (mesma semente = mesmo resultado), sem I/O.
- `src/database`: migrações numeradas e repositórios (SQLite).
- `src/services`, `src/main`, `src/preload`: serviços com acesso a arquivos e IPC validado com Zod.
- `src/renderer`: interface React; só fala com o motor via `window.api`.
- `data/base`: base fixa do universo. `docs/`: arquitetura, banco de dados, calibrações e regulamentos.

Visão geral em `docs/ARCHITECTURE.md`; formato da base e dos pacotes em `docs/DATABASE.md` (esquemas em `docs/schema`).

## Saves
Cada carreira é um arquivo SQLite independente (`saves/<perfil>/<carreira>/career.db`). No app instalado, os saves ficam em
`%APPDATA%\football-manager-simulator`.
