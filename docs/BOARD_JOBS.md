# Diretoria, objetivos e propostas de emprego (Fase 8D)

Decisões do usuário (02/11/2026): objetivos de liga + finanças + base; demissão com a carreira continuando (desempregado recebe propostas); propostas a qualquer
momento com troca imediata; orçamentos de transferência e de folha **e autonomia da diretoria para barrar negociações com valores altos demais para o clube**.

## Objetivos e confiança
- **Posição esperada** = posição da reputação do clube entre os participantes da liga. **Objetivo** (meta = pior posição que ainda cumpre):
  1ª divisão — esperado 1–2: brigar pelo título (meta 2º); 3–4: top 4; até as vagas continentais: vaga continental; metade de cima; senão evitar o rebaixamento.
  Liga com acesso — esperado dentro das vagas: conquistar o acesso; até 3 posições abaixo: brigar pelo acesso; depois metade de cima / evitar o rebaixamento.
- **Secundários:** terminar a temporada no azul; promover jovens da base (1 com base nível 8+, 2 com 14+; só contam as promoções feitas pelo usuário).
- **Confiança** (0–100; começa em 60, 65 num clube novo): vitória +1,5, empate 0, derrota −1,5 (−2 com objetivo de título/acesso); todo dia 1º: +2 dentro da meta,
  0 até 2 posições abaixo, −1 a −6 pior que isso (após 3 jogos); −3 com caixa negativo. Abaixo de 25: aviso (notícia). Em 10 ou menos, depois de 6 jogos no cargo: **demissão**.
- **Virada:** objetivo cumprido +15 (reputação do treinador +5); não cumprido −20 (−4); título +10 (+10); acesso +5 (+6); rebaixamento −15 (−8); secundários ±5.
  Se o objetivo falhar e a confiança ficar em 15 ou menos, a diretoria demite. Objetivos e orçamentos são redefinidos para a temporada nova.

## Orçamentos e veto
- **Transferências** = 40% do caixa no início da temporada (ou na contratação). Compras consomem; vendas devolvem metade da taxa.
- **Teto da folha** = maior entre a folha atual +8% e 55% da receita mensal estimada.
- A diretoria avalia os **termos finais** (depois de clube e jogador aceitarem) de compras, livres e renovações: barra o que estoura o orçamento ou o teto e **veta valores fora
  da realidade** — taxa acima de 2× o valor de mercado, salário acima de 2,2× o salário justo (1,2% do valor).
- **Obras** acima de 30% do caixa precisam de aprovação: negada com confiança abaixo de 50 ou se o caixa ficar abaixo de 3 meses de folha.
- **Pedidos de aumento** (um de cada por temporada): só com confiança 65+; transferências +25% (se o caixa comportar), teto da folha +10%.

## Empregos
- **Vagas na IA:** todo dia 1º, clubes muito abaixo do esperado (≥ max(3, times/4) posições, após 6 jogos) demitem o técnico com 10–40% de chance; rebaixados na virada,
  50%. O clube que o usuário deixa também abre vaga. A IA preenche vagas sem proposta pendente em 30 dias.
- **Propostas:** vagas em clubes de reputação compatível (até reputação do treinador +25 e no mínimo −30; desempregado: +15 e −60) fazem proposta, no máximo
  1 nova por dia, válidas por 10 dias (`OFFER_PACE` em `board.ts`).
  - **Desempregado:** 8%/dia por vaga, até 3 pendentes; clube que teve proposta recusada só volta a chamar depois de 60 dias. Sem propostas, a cada 15
    dias um dos clubes mais modestos chama.
  - **Empregado (raras e seletivas, a pedido do usuário):** 1,2%/dia por vaga, no máximo 1 pendente, pelo menos 30 dias desde a última proposta, só clubes de
    reputação igual ou maior que a do clube atual, e o mesmo clube não volta a chamar em 90 dias (tenha a proposta sido recusada ou expirado). Antes: 3%/dia,
    até 3 pendentes e sem intervalo — numa carreira real chegaram 7 propostas em um mês, inclusive de clubes bem menores.
- **Troca de clube** (aceite) e **demissão**: comissão técnica, olheiros, conhecimento, rotina de treino, listas de transferíveis e propostas recebidas ficam para trás; escalações
  salvas nos esquemas são limpas; obras em andamento seguem com o clube. Passagens registradas em `coach_spells`. Reputação do treinador −6 ao ser demitido.
- **Sem clube:** `career.club_id` é NULL (o estado expõe `clubId = ''`); todas as rotinas tratam todos os clubes como IA; as telas de clube ficam bloqueadas; o calendário e
  as partidas continuam; a virada funciona normalmente.

## Reputação e atributos do treinador (Fase 9)
- **Exibição:** toda reputação (treinador, clubes e jogadores) aparece em **estrelas de 0 a 5, de meia em meia** (`toStars`: 10 pontos = meia
  estrela, arredondando). O motor continua em 0–100. No editor de clubes o número segue editável, com a prévia em estrelas.
- **Reputação de jogador:** derivada só de dados públicos (`playerReputation`): valor de mercado em escala logarítmica (€20 mil → 0,
  €60 milhões → 100) com peso 70% e reputação do clube com peso 30% (sem clube = 20). Não revela a força real.
- **Reputação inicial do treinador:** 10 + 25% da reputação do clube escolhido, entre 15 e 35 (antes: 20 fixo).
- **Variação na avaliação da temporada:** objetivo cumprido +5, mais +1 por posição acima da meta (até +4); não cumprido −4; título +10;
  acesso +6; rebaixamento −8; demissão −6.
- **Confiança ao assumir um clube novo:** 65 + (reputação do treinador − reputação do clube)/5 (limitado a −8..+8) + bônus de adaptabilidade.
- **Atributos (1–20) com efeito real** (`game/coach-engine/coach.ts`): o efeito cresce linearmente da base de criação (5 = nenhum efeito,
  como antes e como a IA) até 20 (efeito máximo). Saves sem atributos se comportam como base.
  | Atributo | Efeito máximo (atributo 20) |
  |---|---|
  | Conhecimento tático | +2,5% na força do time em campo (multiplica o entrosamento) |
  | Motivação | conversa no vestiário: efeito bom +50%, efeito ruim −40% |
  | Desenvolvimento de jovens | +25% no crescimento mensal dos jogadores de até 21 anos do clube (elenco e base) |
  | Disciplina | −30% na chance de cartão amarelo e vermelho dos seus jogadores |
  | Negociação | −8% na taxa pedida pelos clubes e no salário pedido (contratação, jogador livre e renovação) |
  | Adaptabilidade | +5% de rendimento para quem entra ou muda de posição por decisão do técnico; +8 de confiança ao assumir clube novo |
- **Evolução:** na avaliação de cada temporada no cargo, +1 ponto (+1 com o objetivo cumprido, +1 título, +1 acesso). O usuário distribui
  na aba Diretoria (cada atributo até 20). Pontos ficam em `coach_json.attributePoints`.
- **Fora do escopo:** salário do treinador (não existe no jogo; criar mexeria nas finanças) e reputação dos treinadores da IA.

## Técnicos da IA (Fase 9, migração 017)
- **Quem são:** um técnico por clube e um mercado de desempregados (15% do número de clubes). Fazem parte do **universo**, como os jogadores
  (`World.coaches`): os padrão saem de `game/coach-engine/worldCoaches.ts` com semente fixa (não a da carreira) e os pacotes de dados os
  alteram, criam ou removem (`coaches.json`, editor de dados → Técnicos, com foto em `images/coaches/<id>`; ver `docs/DATABASE.md`). A mesma
  base com os mesmos pacotes dá os mesmos técnicos em toda carreira, e a tela de nova carreira mostra o técnico de cada clube. Ao criar a carreira (`ensureAiCoaches`; saves antigos ganham técnicos
  ao abrir), o técnico do clube escolhido é substituído pelo usuário e começa sem clube. Nome do país do clube, 35–68 anos, reputação perto da do clube (±8) e
  atributos 1–20 com média ≈ 3 + reputação/12 (perto do técnico criado pelo usuário).
- **Demissão:** a demissão mensal da IA (e a de clubes rebaixados na virada) tira o técnico do clube (−4 de reputação) e abre a vaga. Se em 30 dias não
  houver proposta pendente ao usuário, o clube contrata um desempregado com reputação de (clube − 25) a (clube + 15), com peso para a mais próxima;
  quem deixou o clube nos últimos 2 anos não volta. Sem ninguém na faixa, o clube promove um técnico novo.
- **Usuário:** assumir um clube que ainda tinha técnico (proposta de clube pequeno ao desempregado) o substitui (`replaced`); o clube que o usuário deixa
  fica com a vaga e contrata um técnico da IA depois.
- **Virada:** reputação dos empregados = posição esperada (pela reputação) − posição final (±6), +5 título, −4 rebaixamento; desempregados −1; aos 70 anos
  se aposentam (o clube contrata outro).
- **Na partida:** conhecimento tático e disciplina dos técnicos da IA valem como os do usuário (efeito zero na base 5). Impacto medido (4 sementes, 1.440
  jogos): gols por jogo 3,09 → 3,13 (+1,5%), amarelos 3,07 → 2,87 (−6,7%), vitória do mandante igual (47,6%). Com a média de atributos 5 + reputação/9
  os amarelos caíam 11%; por isso a média menor.
- **Telas:** nova carreira → painel do clube: "Técnico atual". Competições → clique no clube: ficha do clube (reputação, torcida, estádio, técnico,
  elenco sem força) → clique no técnico: ficha com atributos 1–20, metodologia e passagens. Comissão técnica → filtro "Técnicos sem clube" (por
  reputação, cada um abre a ficha). A Diretoria não lista mais os técnicos dos outros clubes.
  Rede social: demissão com o nome do técnico e anúncio do novo técnico no perfil oficial do clube. A proposta de emprego cita o técnico demitido.

## Verificações feitas
- Soak de 4 temporadas: confiança 100 → 80 → 45; o treinador passivo foi demitido na virada de 2029 depois de falhar no "top 4" e seguiu desempregado; contabilidade íntegra.
- Cópia do save do usuário: migração 10, diretoria criada, demissão simulada, abertura sem clube, telas de clube bloqueadas pela camada de serviços, tabela e avanço funcionando.

## Limitações conhecidas
- O usuário não pode pedir demissão nem procurar emprego ativamente.
- Reputação do treinador começa baixa (15–35), então no começo só clubes modestos fazem propostas.
- Objetivos não incluem copas nem competições continentais (Fase 9).
