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
- **Propostas:** vagas em clubes de reputação compatível (até reputação do treinador +25 e no mínimo −30; desempregado: +15 e −60) fazem proposta (3%/dia; 8% desempregado),
  no máximo 3 pendentes e 1 nova por dia, válidas por 10 dias; recusada, o clube só volta a chamar depois de 60 dias. Desempregado sem propostas: a cada 15 dias um dos clubes
  mais modestos chama.
- **Troca de clube** (aceite) e **demissão**: comissão técnica, olheiros, conhecimento, rotina de treino, listas de transferíveis e propostas recebidas ficam para trás; escalações
  salvas nos esquemas são limpas; obras em andamento seguem com o clube. Passagens registradas em `coach_spells`. Reputação do treinador −6 ao ser demitido.
- **Sem clube:** `career.club_id` é NULL (o estado expõe `clubId = ''`); todas as rotinas tratam todos os clubes como IA; as telas de clube ficam bloqueadas; o calendário e
  as partidas continuam; a virada funciona normalmente.

## Verificações feitas
- Soak de 4 temporadas: confiança 100 → 80 → 45; o treinador passivo foi demitido na virada de 2029 depois de falhar no "top 4" e seguiu desempregado; contabilidade íntegra.
- Cópia do save do usuário: migração 10, diretoria criada, demissão simulada, abertura sem clube, telas de clube bloqueadas pela camada de serviços, tabela e avanço funcionando.

## Limitações conhecidas
- Treinadores da IA não são entidades (as vagas são abstratas); o usuário não pode pedir demissão nem procurar emprego ativamente.
- Reputação do treinador começa em 20, então no começo só clubes modestos fazem propostas.
- Objetivos não incluem copas nem competições continentais (Fase 9).
