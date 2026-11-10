/**
 * Títulos históricos dos clubes (v0.8.10): conquistas anteriores ao universo, cadastradas nos pacotes de dados (`clubs.json`, campo
 * `honours`) e mostradas na Sala de troféus como "antes da carreira". JSON: [{ competitionId?, name, count, years? }]. Vazio na base.
 */
export const migration031 = {
  version: 31,
  name: 'club_honours',
  sql: `
ALTER TABLE clubs ADD COLUMN honours_json TEXT;
`,
};
