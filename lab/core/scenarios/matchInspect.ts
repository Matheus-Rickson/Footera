/**
 * Inspetor de partida: refaz exatamente o jogo nº `game` de um lote (mesmos parâmetros e semente do lote) e mostra tudo dele:
 * placar, estatísticas dos dois times, o lance a lance (comentário gerado dos eventos reais) e a ficha de cada jogador.
 */
import { commentate } from '../../../src/game/match-engine/commentary.ts';
import { POS_NAME } from '../../../src/shared/positions.ts';
import { roleById } from '../../../src/game/match-engine/playerRoles.ts';
import { asUniverse, clubName, rawId } from '../universe.ts';
import { f1, f2 } from '../stats.ts';
import { ParamError, type Scenario, type Section } from '../types.ts';
import { batchGame, matchBatch } from './matchBatch.ts';

// rótulos como no relatório da partida (MatchReport.tsx)
const WEATHER: Record<string, string> = { clear: 'tempo bom', rain: 'chuva', heat: 'calor intenso', cold: 'frio' };
const PITCH: Record<string, string> = { good: 'bom', poor: 'ruim' };

export const matchInspect: Scenario = {
  id: 'inspetor-partida',
  title: 'Inspetor de partida',
  description: 'Refaz um jogo de um lote (mesmos parâmetros, semente e número do jogo) e mostra o lance a lance, as estatísticas e cada jogador.',
  params: [
    ...matchBatch.params.filter((d) => d.key !== 'n'),
    { key: 'game', label: 'Número do jogo no lote', kind: 'number', default: 0, min: 0, max: 19999, help: 'A coluna "Jogo" da tabela de jogos extremos do lote.' },
  ],
  async run(p) {
    const u = asUniverse(p.universe);
    const i = Number(p.game);
    if (!Number.isInteger(i) || i < 0) throw new ParamError('Número do jogo inválido.');
    const { game: g, outcome: o } = batchGame(u, p, i);
    const [hc, ac] = g.aHome ? [g.aClub, g.bClub] : [g.bClub, g.aClub];
    const names: [string, string] = [clubName(u, hc), clubName(u, ac)];
    const byId = new Map(o.players.map((r) => [r.id, r]));
    const nm = (id: string | undefined) => (id ? byId.get(id)?.name ?? rawId(id) : '');
    const s = o.stats;
    const row = (label: string, a: number | string, b: number | string) => [label, a, b];
    const sections: Section[] = [
      {
        kind: 'kpis', title: `Jogo ${i} · semente ${g.seed}`, items: [
          { label: names[0], value: String(o.homeGoals), hint: `${o.lineups[0]!.formation} · mandante` },
          { label: names[1], value: String(o.awayGoals), hint: `${o.lineups[1]!.formation} · visitante` },
          { label: 'Decidido', value: o.decidedIn === 'regular' ? 'no tempo normal' : o.decidedIn === 'extra_time' ? 'na prorrogação' : 'nos pênaltis' },
          { label: 'Melhor em campo', value: nm(o.manOfTheMatch ?? undefined) || '—' },
          { label: 'Condições', value: `${WEATHER[o.conditions.weather] ?? o.conditions.weather} · gramado ${PITCH[o.conditions.pitch] ?? o.conditions.pitch}` },
        ],
      },
      {
        kind: 'table', title: 'Estatísticas', columns: ['', names[0], names[1]], numeric: [1, 2],
        rows: [
          row('Posse', `${s[0].possession}%`, `${s[1].possession}%`), row('xG', f2(s[0].xg), f2(s[1].xg)),
          row('Finalizações (no gol)', `${s[0].shots} (${s[0].shotsOnTarget})`, `${s[1].shots} (${s[1].shotsOnTarget})`),
          row('Chances criadas', s[0].chancesCreated, s[1].chancesCreated),
          row('Passes (certos)', `${s[0].passes} (${s[0].passesCompleted})`, `${s[1].passes} (${s[1].passesCompleted})`),
          row('Escanteios', s[0].corners, s[1].corners), row('Faltas', s[0].fouls, s[1].fouls),
          row('Desarmes / interceptações', `${s[0].tackles} / ${s[0].interceptions}`, `${s[1].tackles} / ${s[1].interceptions}`),
          row('Defesas do goleiro', s[0].saves, s[1].saves), row('Impedimentos', s[0].offsides, s[1].offsides),
          row('Amarelos / vermelhos', `${s[0].yellowCards} / ${s[0].redCards}`, `${s[1].yellowCards} / ${s[1].redCards}`),
        ],
      },
      { kind: 'events', title: 'Lance a lance', items: commentate(o.events, { teamNames: names, playerName: nm }).map((l) => ({ minute: l.label, team: l.team, text: l.text })) },
    ];
    for (const t of [0, 1] as const) {
      sections.push({
        kind: 'table', title: `Jogadores — ${names[t]}`,
        columns: ['Jogador', 'Posição', 'Função', 'Min', 'Nota', 'Gols', 'Assist.', 'Chutes (gol)', 'xG', 'Passes (certos)', 'Passes-chave', 'Desarmes', 'Intercep.', 'Defesas', 'Cartões'],
        numeric: [3, 4, 5, 6, 8, 10, 11, 12, 13],
        rows: o.players.filter((r) => r.team === t && r.minutes > 0).map((r) => [
          r.name, POS_NAME[r.slot] ?? r.slot, r.role ? roleById(r.role)?.name ?? r.role : '—', r.minutes, f1(r.rating), r.goals, r.assists, `${r.shots} (${r.shotsOnTarget})`, f2(r.xg),
          `${r.passes} (${r.passesCompleted})`, r.keyPasses, r.tackles, r.interceptions, r.saves, `${r.yellow ? 'A' : ''}${r.red ? 'V' : ''}` || '—',
        ]),
      });
    }
    return { sections, data: { outcome: o } };
  },
};
