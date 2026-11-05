import { SECONDARY_OPTIONS } from '../../shared/positions.ts';

/** pares natural:secundária plausíveis, para o SQL */
const pairs = Object.entries(SECONDARY_OPTIONS).flatMap(([nat, secs]) => secs.map((s) => `'${nat}:${s}'`)).join(', ');

export const migration012 = {
  version: 12,
  name: 'plausible_secondary_positions',
  sql: `
-- Universos antigos sorteavam a posição secundária entre todas (goleiro ala, atacante zagueiro). Mantém só as vizinhas no campo.
UPDATE players SET secondary_positions_json = (
  SELECT COALESCE(json_group_array(j.value), '[]') FROM json_each(players.secondary_positions_json) j
  WHERE players.position || ':' || j.value IN (${pairs})
);
`,
};
