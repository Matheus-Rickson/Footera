/**
 * Objetivos da diretoria por tamanho e fase do clube (v0.8.10, docs/BOARD_JOBS.md).
 * - `board_state` ganha `size` e `phase` (classificação do clube no início da temporada).
 * - `board_objectives`: objetivos da temporada (o de liga também, espelhando `board_state`); `status` só é gravado na avaliação da
 *   virada (`met`/`missed`); durante a temporada o andamento é calculado na hora.
 * - `board_confidence_log`: confiança da diretoria no dia 1º de cada mês e na avaliação (gráfico da tela).
 */
export const migration030 = {
  version: 30,
  name: 'board_objectives',
  sql: `
ALTER TABLE board_state ADD COLUMN size TEXT;
ALTER TABLE board_state ADD COLUMN phase TEXT;
CREATE TABLE board_objectives (
  club_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  kind TEXT NOT NULL,
  importance TEXT NOT NULL CHECK (importance IN ('essential', 'important', 'desirable')),
  label TEXT NOT NULL,
  target_json TEXT NOT NULL,
  status TEXT CHECK (status IN ('met', 'missed')),
  PRIMARY KEY (club_id, season, idx)
);
CREATE TABLE board_confidence_log (
  date TEXT NOT NULL,
  club_id TEXT NOT NULL,
  confidence REAL NOT NULL,
  PRIMARY KEY (date, club_id)
);
`,
};
