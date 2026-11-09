"""Gera e executa notebooks/main.ipynb: relatório (em português, com pandas) da importação da Bundesliga 2026/27 para o pacote "1".
Uso (na pasta do projeto): python scripts/notebook-importacao.py
Lê os relatórios gravados por scripts/importar-futmob.ts em D:/DATA BASE FOOTERA/importacao-bundesliga-2026-27."""
import nbformat as nbf
from nbclient import NotebookClient

md = nbf.v4.new_markdown_cell
code = nbf.v4.new_code_cell
cells = [
    md("# Importação da Bundesliga 2026/27 para o pacote \"1\"\n\n"
       "Relatório da atualização do pacote de dados **1** do FOOTERA com a extração pública (futmob) da Bundesliga 2026/27.\n\n"
       "- **Extração:** `D:\\DATA BASE FOOTERA\\futmob database\\dados\\bundesliga_54\\2026-2027` (18 clubes, 535 jogadores, 18 técnicos e imagens).\n"
       "- **Pacote:** `%APPDATA%\\football-manager-simulator\\data\\packs\\1` (backup anterior em `D:\\DATA BASE FOOTERA\\backups`).\n"
       "- **Script:** `scripts/importar-futmob.ts` — os clubes reais ocupam os 18 clubes da 1ª divisão alemã da base (mesmos ids); "
       "quem já estava no pacote mantém id e atributos; quem falta é criado com força estimada; quem saiu do elenco real fica sem clube.\n\n"
       "Decisões do usuário: atualizar para 2026/27 (os promovidos ocupam os lugares dos rebaixados), elenco real completo, manter os atributos "
       "existentes e estimar os novos, reputação dos clubes pelo valor do elenco."),
    code("import json, os\nimport numpy as np\nimport pandas as pd\nimport matplotlib.pyplot as plt\n\n"
         "SAIDA = r'D:\\DATA BASE FOOTERA\\importacao-bundesliga-2026-27'\n"
         "EXTRACAO = r'D:\\DATA BASE FOOTERA\\futmob database\\dados\\bundesliga_54\\2026-2027'\n"
         "PACOTE = os.path.join(os.environ['APPDATA'], 'football-manager-simulator', 'data', 'packs', '1')\n"
         "ler = lambda nome: pd.read_csv(os.path.join(SAIDA, nome), sep=';', encoding='utf-8-sig')\n"
         "jogadores, clubes, tecnicos = ler('jogadores.csv'), ler('clubes.csv'), ler('tecnicos.csv')\n"
         "regressao = json.load(open(os.path.join(SAIDA, 'regressao.json'), encoding='utf-8'))\n"
         "pd.set_option('display.max_rows', 60); pd.set_option('display.width', 160)\n"
         "print(f'{len(jogadores)} linhas no relatório de jogadores, {len(clubes)} clubes, {len(tecnicos)} técnicos')"),
    md("## 1. Resumo\n\n"
       "- **atualizado**: jogador da extração que já existia no universo (normalmente no pacote) — mantém id e atributos; recebe nascimento, "
       "nacionalidade, clube, posições, pé, altura e contrato reais.\n"
       "- **criado**: jogador da extração que não existia — entra no pacote com força e potencial estimados (seção 4).\n"
       "- **liberado**: estava no pacote em um clube da Bundesliga, mas não está no elenco real de 2026/27 — fica sem clube (livre no mercado).\n\n"
       "O **critério** mostra como cada jogador foi reconhecido: nome + nascimento (o mais seguro), só o nome (único no pacote, com data diferente) "
       "ou sobrenome + nascimento (nome escrito de outro jeito, ex.: Joe × Joseph Scally)."),
    code("display(jogadores.groupby('situacao').size().rename('jogadores').to_frame())\n"
         "display(pd.crosstab(jogadores['situacao'], jogadores['criterio'], margins=True, margins_name='total'))"),
    md("## 2. Clubes: clube real → clube da base\n\n"
       "Cada clube real ocupa o clube da base onde o pacote já tinha a maioria dos seus jogadores (15 clubes). Os três promovidos "
       "(Schalke 04, Elversberg, Paderborn) ocupam os lugares livres deixados pelos rebaixados de 2025/26 (Wolfsburg, St. Pauli, Heidenheim).\n\n"
       "A **reputação** foi redistribuída pelo valor de mercado do elenco real: o elenco mais valioso recebe a maior reputação que já existia na "
       "divisão, e assim por diante — a faixa da base (50 a 77) não muda."),
    code("t = clubes.sort_values('valor_elenco_eur', ascending=False).copy()\n"
         "t['valor_elenco_mi_eur'] = (t['valor_elenco_eur'] / 1e6).round(1)\n"
         "display(t[['time_real', 'sigla', 'clube_jogo_id', 'nome_na_base', 'reputacao_antes', 'reputacao_depois', 'valor_elenco_mi_eur', 'jogadores_extracao', 'criterio', 'escudo']].reset_index(drop=True))"),
    code("fig, ax = plt.subplots(1, 2, figsize=(13, 5))\n"
         "ax[0].barh(t['time_real'][::-1], t['valor_elenco_mi_eur'][::-1], color='#10b981'); ax[0].set_title('Valor de mercado do elenco (milhões de €)')\n"
         "ax[1].scatter(t['reputacao_antes'], t['reputacao_depois'], color='#0f5132')\n"
         "for _, r in t.iterrows(): ax[1].annotate(r['sigla'], (r['reputacao_antes'], r['reputacao_depois']), fontsize=8, xytext=(3, 3), textcoords='offset points')\n"
         "ax[1].plot([48, 79], [48, 79], '--', color='grey'); ax[1].set_xlabel('reputação antes (clube da base)'); ax[1].set_ylabel('reputação depois'); ax[1].set_title('Reputação: antes × depois')\n"
         "plt.tight_layout(); plt.show()"),
    md("## 3. Elencos por clube"),
    code("el = jogadores[jogadores['situacao'] != 'liberado']\n"
         "tab = pd.crosstab(el['time_real'], el['situacao'], margins=True, margins_name='total').sort_values('total', ascending=False)\n"
         "display(tab)\n"
         "print('Posições principais no jogo (todos os jogadores importados):')\n"
         "display(el['posicao'].value_counts().rename('jogadores').to_frame().T)"),
    md("## 4. Força estimada dos jogadores novos\n\n"
       "A extração não traz atributos de jogo. A força (escala 1–20, a mesma da tela) dos jogadores **criados** foi estimada por uma regressão "
       "ajustada nos jogadores que já existiam no pacote (força calculada pelos atributos deles):\n\n"
       "força ≈ a + b·ln(valor de mercado) + c·(idade − 26) + d·(idade − 26)² + e·goleiro\n\n"
       "O potencial dos novos é a força mais 0,7 ponto por ano abaixo de 24 anos (no máximo 20). O jogo gera os atributos coerentes com a posição."),
    code("coef = pd.DataFrame({'variável': regressao['variaveis'], 'coeficiente': np.round(regressao['coeficientes'], 4)})\n"
         "display(coef)\n"
         "print(f\"amostra: {regressao['amostra']} jogadores · erro médio (RMSE): {regressao['rmse_forca_1a20']:.2f} ponto na escala 1–20 · data de referência: {regressao['data_referencia']}\")"),
    code("at = jogadores[(jogadores['situacao'] == 'atualizado') & (jogadores['valor_mercado_eur'] > 0)]\n"
         "cr = jogadores[jogadores['situacao'] == 'criado']\n"
         "fig, ax = plt.subplots(1, 2, figsize=(13, 4.5))\n"
         "ax[0].scatter(np.log(at['valor_mercado_eur']), at['forca'], s=12, alpha=.6, label='já no pacote (atributos)', color='#0f5132')\n"
         "ax[0].scatter(np.log(cr['valor_mercado_eur'].clip(lower=1)), cr['forca'], s=12, alpha=.6, label='criados (estimada)', color='#d97706')\n"
         "ax[0].set_xlabel('ln(valor de mercado em €)'); ax[0].set_ylabel('força (1–20)'); ax[0].legend(); ax[0].set_title('Força × valor de mercado')\n"
         "ax[1].hist([at['forca'], cr['forca']], bins=range(5, 21), label=['já no pacote', 'criados'], color=['#0f5132', '#d97706'])\n"
         "ax[1].set_xlabel('força (1–20)'); ax[1].legend(); ax[1].set_title('Distribuição da força')\n"
         "plt.tight_layout(); plt.show()"),
    code("print('Jogadores criados mais valiosos:')\n"
         "display(cr.sort_values('valor_mercado_eur', ascending=False)[['nome', 'time_real', 'posicao', 'idade', 'valor_mercado_eur', 'forca', 'potencial']].head(20).reset_index(drop=True))"),
    md("## 5. Jogadores liberados\n\nEstavam no pacote em clubes da Bundesliga 2025/26 e não estão nos elencos de 2026/27 — agora sem clube, disponíveis no mercado."),
    code("lib = jogadores[jogadores['situacao'] == 'liberado']\n"
         "display(lib.groupby('clube_jogo_nome_base').size().rename('liberados').sort_values(ascending=False).to_frame())\n"
         "display(lib[['nome', 'clube_jogo_nome_base', 'posicao', 'idade', 'forca']].sort_values('forca', ascending=False).head(20).reset_index(drop=True))"),
    md("## 6. Fotos, escudos, técnicos e avisos\n\n"
       "As imagens foram gravadas no pacote no padrão do jogo: `images/players/<id do jogador>.png`, `images/clubs/<id do clube>.png`, "
       "`images/coaches/<id do técnico>.png` e `images/leagues/ger-1.png`."),
    code("imgs = {k: len(os.listdir(os.path.join(PACOTE, 'images', k))) for k in ['players', 'clubs', 'coaches', 'leagues']}\n"
         "display(pd.Series(imgs, name='imagens no pacote').to_frame().T)\n"
         "print('Jogadores importados sem foto na extração:')\n"
         "display(el[el['foto'] == 'não'][['nome', 'time_real', 'jogador_id']].reset_index(drop=True))\n"
         "display(tecnicos)"),
    code("avisos = open(os.path.join(SAIDA, 'avisos.txt'), encoding='utf-8').read().strip().splitlines()\n"
         "print(f'{len(avisos)} avisos (casamentos por critério mais fraco, para conferir):')\n"
         "display(pd.DataFrame({'aviso': avisos}))"),
    md("## 7. Conferência do pacote gravado"),
    code("pl = pd.DataFrame(json.load(open(os.path.join(PACOTE, 'players.json'), encoding='utf-8')))\n"
         "cl = pd.DataFrame(json.load(open(os.path.join(PACOTE, 'clubs.json'), encoding='utf-8')))\n"
         "print(f\"players.json: {len(pl)} jogadores ({pl['club'].isna().sum()} sem clube) · clubs.json: {len(cl)} clubes\")\n"
         "ids_ok = set(el['jogador_id']) <= set(pl['id'])\n"
         "clube_ok = (pl.set_index('id').loc[el['jogador_id'], 'club'].values == el['clube_jogo_id'].values).all()\n"
         "print('Todo jogador da extração está no pacote:', ids_ok, '· no clube certo:', bool(clube_ok))\n"
         "display(cl)"),

    md("# Parte 2 — 2. Bundesliga, 3. Liga e as quatro divisões inglesas\n\n"
       "Script `scripts/importar-ligas.ts`. Fontes: as **planilhas editadas** (formato do editor, com atributos completos) em "
       "`D:\DATA BASE FOOTERA\csv_editor_ger` e `csv_editor_eng`, e a **extração futmob 2026/27** das seis ligas.\n\n"
       "Decisões do usuário: as planilhas mandam e cada clube é completado com os jogadores da extração que faltam (força estimada); "
       "os 12 clubes ingleses que a base não tinha foram **criados** (Championship, League One e League Two com 24 clubes, como na realidade); "
       "quando um jogador aparecia duas vezes (livre no pacote e de novo numa planilha), ficou o da planilha e o registro antigo foi removido."),
    code("SAIDA2 = r'D:\DATA BASE FOOTERA\importacao-2026-27'\n"
         "ler2 = lambda nome: pd.read_csv(os.path.join(SAIDA2, nome), sep=';', encoding='utf-8-sig')\n"
         "jog2, clu2, tec2, rem2 = ler2('jogadores.csv'), ler2('clubes.csv'), ler2('tecnicos.csv'), ler2('removidos.csv')\n"
         "reg2 = json.load(open(os.path.join(SAIDA2, 'regressao.json'), encoding='utf-8'))\n"
         "print(f'{len(jog2)} linhas de jogadores, {len(clu2)} clubes, {len(tec2)} técnicos com foto/casamento, {len(rem2)} registros removidos')"),
    md("## 2.1 Resumo por liga\n\n- **planilha**: jogador da planilha que casou com a extração (fica com os atributos da planilha e a foto da extração).\n"
       "- **só na planilha**: está na planilha mas não no elenco real extraído (mantido, sem foto).\n"
       "- **extração (existente)**: estava no universo (ex.: livre no pacote) e foi para o clube real.\n"
       "- **extração (novo)**: criado com força estimada.\n- **fora**: sem data de nascimento na extração (o jogo exige a data; não importado)."),
    code("display(pd.crosstab(jog2['liga'], jog2['situacao'].fillna('fora'), margins=True, margins_name='total'))"),
    md("## 2.2 Clubes\n\nClube real → clube do jogo. Os clubes **criados** receberam a reputação do clube da planilha com valor de elenco mais parecido."),
    code("c2 = clu2.copy(); c2['valor_elenco_mi_eur'] = (c2['valor_elenco_eur'] / 1e6).round(1)\n"
         "display(c2[['liga', 'time_real', 'clube_jogo_id', 'situacao', 'reputacao', 'valor_elenco_mi_eur', 'escudo']])"),
    code("fig, ax = plt.subplots(figsize=(13, 4.5))\n"
         "for lg, g in c2.groupby('liga'): ax.scatter(np.log10(g['valor_elenco_eur'].clip(lower=1)), g['reputacao'], label=lg, s=25)\n"
         "cr2 = c2[c2['situacao'] == 'criado']; ax.scatter(np.log10(cr2['valor_elenco_eur']), cr2['reputacao'], facecolors='none', edgecolors='black', s=90, label='criados')\n"
         "ax.set_xlabel('log10(valor do elenco em €)'); ax.set_ylabel('reputação'); ax.legend(ncol=4); ax.set_title('Reputação × valor do elenco'); plt.tight_layout(); plt.show()"),
    md("## 2.3 Força\n\nA força (1–20) dos jogadores **criados** saiu de uma regressão ajustada nos jogadores que têm atributos (planilhas e pacote):"),
    code("display(pd.DataFrame({'variável': reg2['variaveis'], 'coeficiente': np.round(reg2['coeficientes'], 4)}))\n"
         "print(f\"amostra: {reg2['amostra']} jogadores · erro médio (RMSE): {reg2['rmse_forca_1a20']:.2f} ponto\")\n"
         "display(jog2.groupby(['liga', 'forca_origem'])['forca'].agg(['count', 'mean', 'min', 'max']).round(1))"),
    code("fig, ax = plt.subplots(1, 6, figsize=(16, 3.2), sharey=True)\n"
         "for i, (lg, g) in enumerate(jog2.dropna(subset=['forca']).groupby('liga')):\n"
         "    ax[i].hist([g[g.forca_origem == 'atributos']['forca'], g[g.forca_origem == 'estimada']['forca']], bins=range(3, 21), label=['atributos', 'estimada'], color=['#0f5132', '#d97706'])\n"
         "    ax[i].set_title(lg)\n"
         "ax[0].legend(); plt.tight_layout(); plt.show()"),
    md("## 2.4 Duplicatas removidas, técnicos e avisos"),
    code("display(rem2)\ndisplay(tec2)\n"
         "av2 = open(os.path.join(SAIDA2, 'avisos.txt'), encoding='utf-8').read().strip().splitlines()\n"
         "print(f'{len(av2)} avisos'); display(pd.DataFrame({'aviso': av2}))"),
    md("## 2.5 Conferência do pacote gravado"),
    code("pl2 = pd.DataFrame(json.load(open(os.path.join(PACOTE, 'players.json'), encoding='utf-8')))\n"
         "imgs2 = {k: len(os.listdir(os.path.join(PACOTE, 'images', k))) for k in ['players', 'clubs', 'coaches', 'leagues']}\n"
         "print(f\"players.json: {len(pl2)} registros ({int(pl2['$remove'].fillna(False).sum()) if '$remove' in pl2 else 0} remoções) · imagens: {imgs2}\")\n"
         "ok = jog2.dropna(subset=['jogador_id'])\n"
         "print('Todo jogador importado está no pacote ou na base:', bool(set(ok[ok.situacao != 'só na planilha']['jogador_id']) <= set(pl2['id'])))"),

    md("# Parte 3 — 22 países (36 divisões)\n\n"
       "Script `scripts/importar-paises.ts`. Fontes: as **planilhas reais** de `D:\\DATA BASE FOOTERA\\csv_jogadores` (formato do editor, ids da base, "
       "nomes e atributos montados por outro agente a partir da extração) e a **extração futmob** de cada liga (fotos, escudos, técnicos, logos e "
       "os jogadores que faltam nos elencos de 25 das planilhas).\n\n"
       "Divisões: Brasil (Séries B, C e D), Espanha (1ª–3ª), Itália, França, Portugal, Holanda, Argentina, Bélgica, Japão, Áustria, México, Irlanda e "
       "Rússia (1ª–2ª); Croácia, Uruguai, Colômbia, Equador, Paraguai, Chile, Peru, Bolívia e Venezuela (1ª). A Inglaterra já tinha entrado na Parte 2 "
       "(as planilhas inglesas de `csv_jogadores` são as mesmas).\n\n"
       "Regras (as mesmas da Parte 2):\n"
       "- a planilha manda; jogador da planilha que a extração põe noutro clube do jogo vai para o clube da extração;\n"
       "- cada clube é completado com os jogadores da extração que faltam, com força estimada por uma regressão **por liga**;\n"
       "- elenco máximo de 40: saem primeiro os acrescentados da extração de menor valor; goleiros não saem (o jogo exige 2);\n"
       "- duplicata: fica o da planilha e o registro antigo é removido, salvo se o antigo está num clube fora desta importação (Alemanha, Inglaterra, Série A);\n"
       "- times casados **só por nome igual** (a semelhança de nome casava clubes fictícios com times reais, ex.: \"Real Robledal\" × \"Real Jaén\");\n"
       "- o jogo aceita 15 a 45 anos na data de início; datas \"0001-01-01\" da extração contam como ausentes."),
    code("SAIDA3 = r'D:\\DATA BASE FOOTERA\\importacao-paises-2026-27'\n"
         "ler3 = lambda nome: pd.read_csv(os.path.join(SAIDA3, nome), sep=';', encoding='utf-8-sig')\n"
         "jog3, clu3, tec3, rem3 = ler3('jogadores.csv'), ler3('clubes.csv'), ler3('tecnicos.csv'), ler3('removidos.csv')\n"
         "reg3 = json.load(open(os.path.join(SAIDA3, 'regressao.json'), encoding='utf-8'))\n"
         "jog3['pais'] = jog3['liga_extracao'].str[:3]\n"
         "print(f'{len(jog3)} linhas de jogadores, {len(clu3)} times casados, {len(tec3)} técnicos casados, {len(rem3)} registros removidos')"),
    md("## 3.1 Resumo por liga\n\n- **planilha**: casou com a extração (atributos da planilha, foto da extração).\n"
       "- **só na planilha**: não está nos elencos extraídos (mantido, sem foto) — inclui os clubes que seguem fictícios (3ª espanhola, 2ª irlandesa) "
       "e as ligas cuja extração veio sem jogadores (Uruguai, J2 League).\n"
       "- **extração (novo)**: criado com força estimada. **fora**: sem data de nascimento ou fora da faixa de idade.\n"
       "- **time fora do jogo**: o time real não tem clube no jogo (ex.: a Liga Profesional argentina tem 30 times e o jogo 20; a 2ª argentina, 36)."),
    code("display(pd.crosstab(jog3['liga_extracao'], jog3['situacao'].fillna('fora'), margins=True, margins_name='total'))"),
    code("fotos = jog3[jog3.situacao.isin(['planilha', 'extração (novo)', 'extração (existente)'])].groupby('liga_extracao')['foto'].apply(lambda s: (s == 'sim').mean() * 100).round(0)\n"
         "fig, ax = plt.subplots(figsize=(14, 3.6)); fotos.plot.bar(ax=ax, color='#0f5132'); ax.set_ylabel('% com foto'); ax.set_xlabel('')\n"
         "ax.set_title('Jogadores importados com foto, por liga'); plt.tight_layout(); plt.show()"),
    md("## 3.2 Clubes\n\nTime real → clube do jogo (pelo nome igual ao da planilha). Um time pode estar noutra divisão do mesmo país na planilha."),
    code("c3 = clu3.copy(); c3['valor_elenco_mi_eur'] = (c3['valor_elenco_eur'] / 1e6).round(1)\n"
         "display(c3.groupby('liga_no_jogo').agg(clubes=('clube_jogo_id', 'count'), escudos=('escudo', lambda s: (s == 'sim').sum()), reputacao_media=('reputacao', 'mean'), valor_medio_mi=('valor_elenco_mi_eur', 'mean')).round(1))"),
    code("fig, ax = plt.subplots(figsize=(13, 5))\n"
         "for p, g in c3.assign(pais=c3['liga_no_jogo'].str[:3]).groupby('pais'): ax.scatter(np.log10(g['valor_elenco_eur'].clip(lower=1e4)), g['reputacao'], label=p, s=14)\n"
         "ax.set_xlabel('log10(valor do elenco em €)'); ax.set_ylabel('reputação'); ax.legend(ncol=8, fontsize=8); ax.set_title('Reputação (planilha) × valor do elenco real'); plt.tight_layout(); plt.show()"),
    md("## 3.3 Força dos jogadores criados\n\nRegressão de força (1–20) em ln(valor de mercado), idade, idade² e goleiro, ajustada **por liga** nos jogadores da planilha "
       "que casaram com a extração (com 60 ou mais na amostra; senão, a regressão geral). O erro é baixo porque os atributos das planilhas já foram "
       "derivados do valor de mercado."),
    code("rl = pd.DataFrame(reg3['ligas']).T[['modelo', 'amostra', 'rmse_forca_1a20', 'criados']]; rl['rmse_forca_1a20'] = rl['rmse_forca_1a20'].astype(float).round(2)\n"
         "print(f\"regressão geral: {reg3['geral']['amostra']} jogadores, RMSE {reg3['geral']['rmse_forca_1a20']:.2f}\"); display(rl)\n"
         "display(jog3.dropna(subset=['forca']).groupby(['liga_extracao', 'forca_origem'])['forca'].agg(['count', 'mean', 'min', 'max']).round(1).unstack())"),
    code("med = jog3.dropna(subset=['forca']).groupby(['liga_extracao', 'forca_origem'])['forca'].mean().unstack()\n"
         "fig, ax = plt.subplots(figsize=(14, 4)); med.plot.bar(ax=ax, color=['#0f5132', '#d97706']); ax.set_ylabel('força média (1–20)'); ax.set_xlabel('')\n"
         "ax.set_title('Força média: atributos da planilha × estimada'); plt.tight_layout(); plt.show()"),
    md("## 3.4 Duplicatas removidas, técnicos e avisos"),
    code("display(rem3)\nprint(f\"técnicos com foto: {(tec3['foto'] == 'sim').sum()} de {len(tec3)}\")\n"
         "av3 = open(os.path.join(SAIDA3, 'avisos.txt'), encoding='utf-8').read().strip().splitlines()\n"
         "tipo = pd.Series(av3).str.replace(r'^[^:]*: ', '', regex=True).str.replace(r'\"[^\"]*\"', 'X', regex=True).str.replace(r'\\d+', 'N', regex=True).str[:60]\n"
         "print(f'{len(av3)} avisos'); display(tipo.value_counts().head(15).rename('quantidade').to_frame())\n"
         "display(pd.DataFrame({'aviso': av3}))"),
    md("## 3.5 Conferência do pacote gravado"),
    code("pl3 = pd.DataFrame(json.load(open(os.path.join(PACOTE, 'players.json'), encoding='utf-8')))\n"
         "imgs3 = {k: len(os.listdir(os.path.join(PACOTE, 'images', k))) for k in ['players', 'clubs', 'coaches', 'leagues']}\n"
         "print(f\"players.json: {len(pl3)} registros · imagens: {imgs3}\")\n"
         "imp = jog3[jog3.situacao.isin(['planilha', 'extração (novo)', 'extração (existente)'])]\n"
         "print('Todo jogador importado está no pacote:', bool(set(imp['jogador_id']) <= set(pl3['id'])))\n"
         "com_foto = imp[imp.foto == 'sim']['jogador_id']\n"
         "arqs = {os.path.splitext(f)[0] for f in os.listdir(os.path.join(PACOTE, 'images', 'players'))}\n"
         "print('Toda foto prevista está gravada:', bool(set(com_foto) <= arqs))"),
]
nb = nbf.v4.new_notebook(cells=cells, metadata={'kernelspec': {'display_name': 'Python 3', 'language': 'python', 'name': 'python3'}, 'language_info': {'name': 'python'}})
NotebookClient(nb, timeout=300, kernel_name='python3').execute()
nbf.write(nb, 'notebooks/main.ipynb')
print('notebooks/main.ipynb gerado e executado')
