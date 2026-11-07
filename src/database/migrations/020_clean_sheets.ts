/**
 * Jogos sem sofrer gols (tela de Competições, 06/11/2026).
 * - `player_season_stats.clean_sheets`: o goleiro que esteve no gol por pelo menos 60 minutos numa partida em que o time não sofreu gol.
 * - Preenche a partir das partidas já gravadas (relatório com os minutos e a vaga de cada jogador).
 */
export const migration020 = {
  version: 20,
  name: 'clean_sheets',
  sql: `
ALTER TABLE player_season_stats ADD COLUMN clean_sheets INTEGER NOT NULL DEFAULT 0;
UPDATE player_season_stats SET clean_sheets = cs.n FROM (
  SELECT f.competition_id AS cid, json_extract(p.value, '$.id') AS pid, COUNT(*) AS n
    FROM matches m JOIN fixtures f ON f.id = m.fixture_id, json_each(m.report_json, '$.players') p
   WHERE json_extract(p.value, '$.slot') = 'GK' AND json_extract(p.value, '$.minutes') >= 60
     AND (CASE json_extract(p.value, '$.team') WHEN 0 THEN m.away_goals ELSE m.home_goals END) = 0
   GROUP BY f.competition_id, json_extract(p.value, '$.id')
) AS cs WHERE cs.cid = player_season_stats.competition_id AND cs.pid = player_season_stats.player_id;
`,
};
