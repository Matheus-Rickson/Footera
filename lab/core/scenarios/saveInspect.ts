/**
 * Inspetor de save: abre uma CÓPIA temporária de um save do usuário (o original nunca é aberto) pelas mesmas funções que o jogo usa
 * (saveService) e mostra resumo, tabela, elenco, finanças e base. Opcionalmente avança N dias na cópia — jogos do clube simulados,
 * virada de temporada feita quando chega a data — e compara antes e depois. A cópia é apagada no fim.
 */
import type { CareerOverviewDto, MatchSummaryDto } from '../../../src/shared/api.ts';
import { copySave } from '../saves.ts';
import { f1, pct } from '../stats.ts';
import { Cancelled, ParamError, type Scenario, type Section } from '../types.ts';

type Svc = typeof import('../../../src/services/saveService.node.ts');
const money = (v: number) => `${v < 0 ? '−' : ''}€ ${Math.abs(Math.round(v)).toLocaleString('pt-BR')}`;

function overviewKpis(ov: CareerOverviewDto, title: string): Section {
  const lp = ov.leaguePosition;
  return {
    kind: 'kpis', title, items: [
      { label: 'Clube', value: ov.club?.name ?? 'sem clube (demitido)' },
      { label: 'Data', value: ov.summary.gameDate, hint: `temporada ${ov.summary.seasonLabel}` },
      { label: 'Posição na liga', value: lp ? `${lp.position}º de ${lp.total}` : '—', hint: lp ? `${lp.points} pts em ${lp.played} jogos` : undefined },
      { label: 'Saldo', value: ov.club ? money(ov.club.balance) : '—', tone: ov.club && ov.club.balance < 0 ? 'bad' : undefined },
      { label: 'Elenco', value: String(ov.squad.length) },
      { label: 'Partidas pendentes', value: String(ov.pendingMatches) },
      { label: 'Avisos', value: ov.warnings.length ? ov.warnings.join(' · ') : 'nenhum', tone: ov.warnings.length ? 'warn' : 'ok' },
    ],
  };
}

export const saveInspect: Scenario = {
  id: 'inspetor-save',
  title: 'Inspetor de save',
  description: 'Abre uma cópia de um save (o original não é tocado), mostra a situação da carreira e pode avançar dias na cópia para ver o que acontece.',
  params: [
    { key: 'save', label: 'Save', kind: 'select', default: '', options: [{ value: '', label: 'Escolha um save…' }], source: 'saves' },
    { key: 'path', label: 'Ou o caminho de um career.db', kind: 'text', default: '', help: 'Tem prioridade sobre a lista.' },
    { key: 'days', label: 'Avançar dias na cópia', kind: 'number', default: 0, min: 0, max: 730, help: 'Os jogos do seu clube são simulados; a virada de temporada é feita quando a data chega.' },
    { key: 'squad', label: 'Mostrar o elenco', kind: 'boolean', default: true },
    { key: 'finance', label: 'Mostrar as finanças', kind: 'boolean', default: true },
    { key: 'youth', label: 'Mostrar a base', kind: 'boolean', default: true },
  ],
  async run(p, ctx) {
    const source = String(p.path).trim() || String(p.save);
    const days = Number(p.days);
    if (!Number.isInteger(days) || days < 0) throw new ParamError('Número de dias inválido.');
    const svc: Svc = await import('../../../src/services/saveService.node.ts');
    const copy = copySave(source);
    const R = [copy.base, copy.profile, copy.career] as const;
    try {
      ctx.onProgress({ done: 0, total: days + 1, label: 'abrindo a cópia (migrações e verificações)' });
      const before = await svc.openCareer(...R);
      const sections: Section[] = [overviewKpis(before, 'Situação da carreira (cópia)')];

      if (before.leaguePosition) {
        const t = await svc.getTable(...R, before.leaguePosition.competitionId);
        sections.push({
          kind: 'table', title: `${t.competition.name} — rodada ${t.roundsPlayed}/${t.totalRounds}`, numeric: [0, 2, 3, 4, 5, 6, 7],
          columns: ['#', 'Clube', 'J', 'V', 'E', 'D', 'SG', 'Pts'],
          rows: t.rows.map((r) => [r.position, `${r.clubName}${r.isUserClub ? ' ◆' : ''}`, r.played, r.won, r.drawn, r.lost, r.goalDiff, r.points]),
        });
      }
      if (p.squad && before.squad.length) {
        sections.push({
          kind: 'table', title: 'Elenco', numeric: [2, 3, 4, 5, 6, 8, 9, 10],
          columns: ['Jogador', 'Pos.', 'Idade', 'Força', 'Condição', 'Moral', 'Salário', 'Contrato', 'Jogos', 'Gols', 'Nota média'],
          rows: before.squad.map((s) => [s.name, s.position, s.age, s.overall, s.condition, s.morale, money(s.salary), s.contractEnd, s.stats.appearances, s.stats.goals, s.stats.avgRating == null ? '—' : f1(s.stats.avgRating)]),
        });
      }
      if (p.finance && before.club) {
        const fin = await svc.getFinance(...R);
        sections.push({
          kind: 'kpis', title: 'Finanças (projeção mensal)', items: [
            { label: 'Receita', value: money(fin.projection.income) }, { label: 'Despesa', value: money(fin.projection.expense) },
            { label: 'Resultado', value: money(fin.projection.net), tone: fin.projection.net < 0 ? 'bad' : 'ok' },
            { label: 'Folha salarial', value: money(fin.projection.wageBill) }, { label: 'Base', value: money(fin.projection.youthBill) },
            { label: 'Fôlego', value: fin.runwayMonths == null ? '—' : `${fin.runwayMonths} meses` },
          ],
        });
        if (fin.lastMonth.length) sections.push({ kind: 'table', title: `Último mês fechado (${fin.lastSettledMonth ?? '—'})`, numeric: [1], columns: ['Categoria', 'Valor'], rows: fin.lastMonth.map((x) => [x.category, money(x.amount)]) });
      }
      if (p.youth && before.club) {
        const y = await svc.getYouth(...R);
        sections.push({
          kind: 'table', title: `Base: ${y.players.length} de ${y.cap} · nível ${y.academyLevel}/20 · próxima peneira ${y.nextIntake}`, numeric: [2, 3, 4],
          columns: ['Jogador', 'Pos.', 'Idade', 'Força', 'Pot. estimado', 'Sai na virada'],
          rows: y.players.map((j) => [j.name, j.position, j.age, j.overall, j.potentialEstimated, j.leavesAtTurnover ? 'sim' : '']),
        });
      }

      if (days > 0) {
        const start = before.summary.gameDate;
        const target = new Date(Date.parse(`${start}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
        const played: MatchSummaryDto[] = [];
        const notes: string[] = [];
        let date = start, stuck = 0, turnovers = 0;
        while (date < target) {
          if (ctx.cancelled()) throw new Cancelled();
          const step = await svc.continueCareerDay(...R);
          if (step.simulation?.userMatch) played.push(step.simulation.userMatch);
          if (step.stop === 'user_match') {
            const sim = await svc.simulateCareerMatchday(...R);
            if (sim.userMatch) played.push(sim.userMatch);
          } else if (step.stop === 'season_end') {
            const s = await svc.getSeason(...R);
            if (s.canStart) { await svc.beginNextSeason(...R); turnovers++; notes.push(`Virada de temporada feita em ${s.gameDate}.`); }
          }
          const now = step.date;
          if (now === date) { if (++stuck >= 4) { notes.push(`Parou em ${date}: o dia não avançou (${step.stop ?? 'sem motivo'}: ${step.message}).`); break; } } else stuck = 0;
          date = now;
          ctx.onProgress({ done: Math.min(days, Math.round((Date.parse(date) - Date.parse(start)) / 86400000)), total: days + 1, label: date });
        }
        const after = await svc.openCareer(...R);
        sections.push(overviewKpis(after, `Depois de avançar até ${after.summary.gameDate}`));
        const wins = played.filter((m) => (m.homeName === after.club?.name ? m.homeGoals > m.awayGoals : m.awayGoals > m.homeGoals)).length;
        sections.push({
          kind: 'kpis', title: 'O que mudou', items: [
            { label: 'Dias avançados', value: String(Math.round((Date.parse(after.summary.gameDate) - Date.parse(start)) / 86400000)) },
            { label: 'Jogos do clube', value: String(played.length), hint: played.length ? `${wins} vitórias (${pct(wins / played.length, 0)})` : undefined },
            { label: 'Saldo', value: before.club && after.club ? `${money(before.club.balance)} → ${money(after.club.balance)}` : '—' },
            { label: 'Viradas de temporada', value: String(turnovers) },
          ],
        });
        if (played.length) sections.push({ kind: 'table', title: 'Jogos do clube no período', columns: ['Data', 'Competição', 'Mandante', 'Placar', 'Visitante'], rows: played.map((m) => [m.date, m.competitionName, m.homeName, `${m.homeGoals} x ${m.awayGoals}`, m.awayName]) });
        if (notes.length) sections.push({ kind: 'text', title: 'Observações', body: notes.join('\n'), tone: 'warn' });
      }
      return { sections };
    } finally {
      await svc.closeCareerDb(copy.file).catch(() => undefined);
      copy.dispose();
    }
  },
};
