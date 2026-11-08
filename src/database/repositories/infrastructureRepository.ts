import type { SqlDb } from '../types.ts';
import { withTransaction } from '../types.ts';
import { UserError } from '../../shared/errors.ts';
import { addDays } from '../../shared/date.ts';
import {
  FACILITY_KINDS, MAX_FACILITY_LEVEL, recoveryFactor, qualityFactor, stadiumExpansion, UNSTAFFED_QUALITY, upgradeCost, upgradeDays, type FacilityKind,
} from '../../game/training-engine/training.ts';
import { facilityMonthly, maintenanceMonthly, staffUserMonthly, ticketPrice, type ClubEcon } from '../../game/finance-engine/finance.ts';
import type { FacilityStat, InfrastructureOverviewDto } from '../../shared/api.ts';
import { foreignChance, intakeRange, maxScoutsFor, recruitBonus, trackedFor, YOUTH_CAP } from '../../game/scouting-engine/scouting.ts';
import { CURRENT_COMP } from './countrySeasonRepository.ts';
import { getCareerState } from './careerRepository.ts';
import { loadClubEcon, makePoster } from './financeRepository.ts';
import { addNews } from './newsRepository.ts';
import { facilitiesOf } from './staffRepository.ts';
import { boardApprovesConstruction } from './boardRepository.ts';
import { fmtMoney } from '../../shared/money.ts';

export class InfrastructureError extends UserError {}

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const fmt = fmtMoney; // dinheiro nas mensagens (moeda única: euro)
const br = (d: string) => d.split('-').reverse().join('/');
export const FACILITY_LABEL: Record<FacilityKind, string> = { training: 'Centro de treinamento', youth: 'Categorias de base', medical: 'Departamento médico', stadium: 'Estádio', scouting: 'Departamento de scouting', recruitment: 'Rede de captação' };
/** O que cada instalação melhora no jogo (texto das mensagens). */
export const FACILITY_EFFECT: Record<FacilityKind, string> = {
  training: 'O centro de treinamento acelera a evolução mensal dos jogadores do elenco e o aprendizado das funções táticas.',
  youth: 'As categorias de base melhores trazem safras maiores e mais talentosas na peneira e aceleram a evolução dos jovens.',
  medical: 'O departamento médico encurta o tempo de recuperação das lesões.',
  stadium: 'O estádio maior aumenta a capacidade e a renda de bilheteria nos jogos em casa.',
  scouting: 'O departamento de scouting maior comporta mais olheiros (tarefas ativas ao mesmo tempo) e mais jogadores acompanhados por tarefa.',
  recruitment: 'A rede de captação maior traz mais jovens na peneira anual e aumenta a chance de revelar jovens de outros países.',
};

/** Custo mensal fixo que muda quando o nível sobe (comissão/base e manutenção usam os níveis). */
function monthlyCostAt(econ: ClubEcon, kind: FacilityKind, level: number): number {
  const e = { ...econ, facilities: { ...econ.facilities, [kind]: level } };
  if (kind === 'scouting' || kind === 'recruitment') return staffUserMonthly(e);
  return kind === 'stadium' ? maintenanceMonthly(e) : staffUserMonthly(e);
}

function effectText(kind: FacilityKind, level: number): string {
  const pct = (x: number) => `${x >= 1 ? '+' : ''}${Math.round((x - 1) * 100)}%`;
  if (kind === 'training') return `Evolução dos jogadores ${pct(qualityFactor(level))}`;
  if (kind === 'youth') return `Qualidade e tamanho das safras; evolução na base ${pct(qualityFactor(level))}`;
  if (kind === 'medical') { const d = (recoveryFactor(UNSTAFFED_QUALITY, level) - 1) * 100; return `Lesões duram ${Math.abs(d).toFixed(1).replace('.', ',')}% ${d >= 0 ? 'a mais' : 'a menos'} que a referência (sem médico contratado; um bom médico reduz mais)`; }
  if (kind === 'scouting') return `Até ${maxScoutsFor(level)} olheiros (tarefas ativas) e ${trackedFor(level)} jogadores acompanhados por tarefa`;
  if (kind === 'recruitment') return `+${recruitBonus(level)} jovem(ns) na peneira; ${Math.round(foreignChance(level) * 100)}% de chance de cada um vir de outro país`;
  return 'Ampliação: +5% de lugares (mais bilheteria) e maior manutenção';
}

/** Faixa qualitativa do nível (1–20) para os cards. */
const tier = (level: number): { text: string; tone: 'great' | 'good' | 'avg' | 'poor' } =>
  level >= 17 ? { text: 'Muito alto', tone: 'great' } : level >= 13 ? { text: 'Alto', tone: 'good' } : level >= 9 ? { text: 'Médio', tone: 'avg' } : level >= 5 ? { text: 'Baixo', tone: 'poor' } : { text: 'Muito baixo', tone: 'poor' };

function statsOf(db: SqlDb, kind: FacilityKind, f: Record<FacilityKind, number>): FacilityStat[] {
  const level = f[kind];
  const pct = (x: number) => `${x >= 1 ? '+' : ''}${Math.round((x - 1) * 100)}%`;
  if (kind === 'training') return [{ label: 'Ganho de treino', value: `${tier(level).text} (${pct(qualityFactor(level))})`, tone: tier(level).tone, help: 'Velocidade da evolução mensal do elenco e do aprendizado das funções táticas (a comissão técnica soma ao efeito).' }];
  if (kind === 'youth') return [
    { label: 'Desenvolvimento de jovens', value: `${tier(level).text} (${pct(qualityFactor(level))})`, tone: tier(level).tone, help: 'Qualidade das safras da peneira e evolução dos jovens na base.' },
    { label: 'Capacidade da academia', value: String(YOUTH_CAP.user), help: 'Máximo de jovens na base do clube; a peneira não traz ninguém além disso.' },
  ];
  if (kind === 'recruitment') {
    const r = intakeRange(f.youth, level);
    return [
      { label: 'Menor entrada', value: String(r.min), help: 'Menor safra possível na peneira anual (15/mar), com o nível atual da base e da rede de captação.' },
      { label: 'Maior entrada', value: String(r.max), help: 'Maior safra possível na peneira anual.' },
      { label: 'Chance no exterior', value: `${Math.round(foreignChance(level) * 100)}%`, help: 'Chance de cada jovem da peneira vir de outro país (com a nacionalidade de lá).' },
    ];
  }
  if (kind === 'scouting') {
    const scouts = N(db.prepare('SELECT COUNT(*) AS n FROM scouts').get()!.n), active = N(db.prepare("SELECT COUNT(*) AS n FROM scout_tasks WHERE status = 'active'").get()!.n);
    return [
      { label: 'Tarefas ativas', value: `${active} / ${maxScoutsFor(level)}`, help: 'Cada tarefa ativa ocupa um olheiro; o nível define quantos olheiros o departamento comporta.' },
      { label: 'Olheiros contratados', value: String(scouts), help: 'Olheiros do clube (contratar e demitir em "Gerenciar").' },
      { label: 'Jogadores por tarefa', value: String(trackedFor(level)), help: 'Jogadores que cada tarefa acompanha ao mesmo tempo até o relatório completo.' },
    ];
  }
  if (kind === 'medical') {
    const d = (recoveryFactor(UNSTAFFED_QUALITY, level) - 1) * 100;
    return [{ label: 'Tempo de recuperação', value: `${Math.abs(d).toFixed(1).replace('.', ',')}% ${d >= 0 ? 'mais longo' : 'mais curto'}`, tone: d <= -5 ? 'good' : d < 0 ? 'avg' : 'poor', help: 'Duração das lesões em relação à referência, sem médico contratado (um bom médico reduz mais; ver Departamento médico).' }];
  }
  return [];
}

export function getInfrastructureOverview(db: SqlDb): InfrastructureOverviewDto {
  const st = getCareerState(db);
  const econ = loadClubEcon(db, st.clubId);
  const f = facilitiesOf(db, st.clubId);
  const ecoF: ClubEcon = { ...econ, facilities: { ...econ.facilities, scouting: f.scouting, recruitment: f.recruitment } };
  const active = db.prepare("SELECT * FROM construction_projects WHERE club_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1").get(st.clubId);
  const club = db.prepare('SELECT c.balance, c.fans, s.name AS stadium FROM clubs c LEFT JOIN stadiums s ON s.id = c.stadium_id WHERE c.id = ?').get(st.clubId)!;
  const att = db.prepare(`SELECT AVG(m.attendance) AS a, COUNT(*) AS n FROM fixtures f JOIN matches m ON m.fixture_id = f.id JOIN competitions c ON c.id = f.competition_id
    WHERE f.home_club_id = ? AND f.status = 'played' AND m.attendance IS NOT NULL AND COALESCE(f.neutral, 0) = 0 AND ${CURRENT_COMP}`).get(st.clubId)!;
  const avg = N(att.n) > 0 ? Math.round(N(att.a)) : null;
  return {
    balance: N(club.balance), capacity: econ.capacity,
    stadium: { name: club.stadium == null ? 'Estádio' : S(club.stadium), capacity: econ.capacity, monthly: facilityMonthly(ecoF, 'stadium'), avgAttendance: avg,
      occupancy: avg === null ? null : Math.round((100 * avg) / Math.max(1, econ.capacity)), homeGames: N(att.n), fans: N(club.fans), ticketPrice: ticketPrice(econ) },
    project: active ? {
      kind: S(active.kind) as FacilityKind, label: FACILITY_LABEL[S(active.kind) as FacilityKind], toLevel: N(active.from_level) + 1, cost: N(active.cost),
      start: S(active.start_date), end: S(active.end_date),
      progress: Math.min(100, Math.round((100 * (Date.parse(st.gameDate) - Date.parse(S(active.start_date)))) / Math.max(1, Date.parse(S(active.end_date)) - Date.parse(S(active.start_date))))),
    } : null,
    facilities: FACILITY_KINDS.map((kind) => {
      const level = f[kind], maxed = level >= MAX_FACILITY_LEVEL;
      return {
        kind, label: FACILITY_LABEL[kind], level, maxLevel: MAX_FACILITY_LEVEL, maxed, monthly: facilityMonthly(ecoF, kind), stats: statsOf(db, kind, f),
        effect: effectText(kind, level), nextEffect: maxed ? null : effectText(kind, level + 1),
        cost: maxed ? null : upgradeCost(kind, level, econ.econ), days: maxed ? null : upgradeDays(kind, level),
        extraMonthly: maxed ? null : monthlyCostAt(ecoF, kind, level + 1) - monthlyCostAt(ecoF, kind, level),
        extraSeats: kind === 'stadium' && !maxed ? stadiumExpansion(econ.capacity) : null,
      };
    }),
  };
}

/** Encomenda a obra de +1 nível: paga na hora (porta única de dinheiro) e fica pronta depois do prazo. Uma obra por vez. */
export function startUpgrade(db: SqlDb, kind: FacilityKind): void {
  const st = getCareerState(db);
  if (!FACILITY_KINDS.includes(kind)) throw new InfrastructureError('Instalação inválida.');
  if (db.prepare("SELECT 1 AS x FROM construction_projects WHERE club_id = ? AND status = 'active'").get(st.clubId)) throw new InfrastructureError('Já há uma obra em andamento: só é possível uma por vez.');
  const level = facilitiesOf(db, st.clubId)[kind];
  if (level >= MAX_FACILITY_LEVEL) throw new InfrastructureError(`${FACILITY_LABEL[kind]} já está no nível máximo.`);
  const cost = upgradeCost(kind, level, loadClubEcon(db, st.clubId).econ);
  const balance = N(db.prepare('SELECT balance FROM clubs WHERE id = ?').get(st.clubId)!.balance);
  if (balance < cost) throw new InfrastructureError(`Caixa insuficiente: a obra custa ${fmt(cost)} e o clube tem ${fmt(balance)}.`);
  const denied = boardApprovesConstruction(db, cost);
  if (denied) throw new InfrastructureError(denied);
  const end = addDays(st.gameDate, upgradeDays(kind, level));
  withTransaction(db, () => {
    makePoster(db, st.clubId)(st.clubId, st.gameDate, 'infrastructure', -cost, `Obra: ${FACILITY_LABEL[kind]} (nível ${level} → ${level + 1})`);
    db.prepare('INSERT INTO construction_projects (club_id, kind, from_level, cost, start_date, end_date) VALUES (?,?,?,?,?,?)').run(st.clubId, kind, level, cost, st.gameDate, end);
    addNews(db, st.gameDate, 'staff', `Obra iniciada: ${FACILITY_LABEL[kind]} (nível ${level} → ${level + 1})`, `As obras de ${FACILITY_LABEL[kind].toLowerCase()} começaram. Investimento de ${fmt(cost)}, já descontado do caixa; conclusão prevista para ${br(end)}.\n\n${FACILITY_EFFECT[kind]} O novo nível só vale quando a obra terminar; depois disso a manutenção mensal sobe.`, { sender: 'Departamento de infraestrutura', action: 'infrastructure', actionLabel: 'Ver infraestrutura' });
  });
}

/** Conclui as obras cujo prazo chegou. NÃO abre transação. */
export function processConstructionDay(db: SqlDb, date: string): void {
  for (const p of db.prepare("SELECT * FROM construction_projects WHERE status = 'active' AND end_date <= ? ORDER BY id").all(date)) {
    const clubId = S(p.club_id), kind = S(p.kind) as FacilityKind;
    const f = facilitiesOf(db, clubId);
    f[kind] = Math.min(MAX_FACILITY_LEVEL, N(p.from_level) + 1);
    db.prepare('UPDATE clubs SET facilities_json = ? WHERE id = ?').run(JSON.stringify(f), clubId);
    let extra = '';
    if (kind === 'stadium') {
      const st = db.prepare('SELECT s.id, s.capacity FROM stadiums s JOIN clubs c ON c.stadium_id = s.id WHERE c.id = ?').get(clubId)!;
      const seats = stadiumExpansion(N(st.capacity));
      db.prepare('UPDATE stadiums SET capacity = capacity + ? WHERE id = ?').run(seats, S(st.id));
      extra = ` Capacidade: ${(N(st.capacity) + seats).toLocaleString('pt-BR')} lugares (+${seats.toLocaleString('pt-BR')}).`;
    }
    db.prepare("UPDATE construction_projects SET status = 'done' WHERE id = ?").run(N(p.id));
    addNews(db, date, 'staff', `Obra concluída: ${FACILITY_LABEL[kind]} agora no nível ${f[kind]}`, `A obra de ${FACILITY_LABEL[kind].toLowerCase()} foi entregue: a instalação está no nível ${f[kind]}.${extra}\n\n${FACILITY_EFFECT[kind]} A manutenção mensal aumentou e já aparece nas Finanças.`, { sender: 'Departamento de infraestrutura', action: 'infrastructure', actionLabel: 'Ver infraestrutura' });
  }
}
