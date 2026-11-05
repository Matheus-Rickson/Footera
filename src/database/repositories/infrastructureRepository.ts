import type { SqlDb } from '../types.ts';
import { withTransaction } from '../types.ts';
import { UserError } from '../../shared/errors.ts';
import { addDays } from '../../shared/date.ts';
import {
  FACILITY_KINDS, MAX_FACILITY_LEVEL, recoveryFactor, qualityFactor, stadiumExpansion, UNSTAFFED_QUALITY, upgradeCost, upgradeDays, type FacilityKind,
} from '../../game/training-engine/training.ts';
import { maintenanceMonthly, staffUserMonthly, type ClubEcon } from '../../game/finance-engine/finance.ts';
import type { InfrastructureOverviewDto } from '../../shared/api.ts';
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
export const FACILITY_LABEL: Record<FacilityKind, string> = { training: 'Centro de treinamento', youth: 'Categorias de base', medical: 'Departamento médico', stadium: 'Estádio' };

/** Custo mensal fixo que muda quando o nível sobe (comissão/base e manutenção usam os níveis). */
function monthlyCostAt(econ: ClubEcon, kind: FacilityKind, level: number): number {
  const e = { ...econ, facilities: { ...econ.facilities, [kind]: level } };
  return kind === 'stadium' ? maintenanceMonthly(e) : staffUserMonthly(e);
}

function effectText(kind: FacilityKind, level: number): string {
  const pct = (x: number) => `${x >= 1 ? '+' : ''}${Math.round((x - 1) * 100)}%`;
  if (kind === 'training') return `Evolução dos jogadores ${pct(qualityFactor(level))}`;
  if (kind === 'youth') return `Qualidade e tamanho das safras; evolução na base ${pct(qualityFactor(level))}`;
  if (kind === 'medical') { const d = (recoveryFactor(UNSTAFFED_QUALITY, level) - 1) * 100; return `Lesões duram ${Math.abs(d).toFixed(1).replace('.', ',')}% ${d >= 0 ? 'a mais' : 'a menos'} que a referência (sem médico contratado; um bom médico reduz mais)`; }
  return 'Ampliação: +5% de lugares (mais bilheteria) e maior manutenção';
}

export function getInfrastructureOverview(db: SqlDb): InfrastructureOverviewDto {
  const st = getCareerState(db);
  const econ = loadClubEcon(db, st.clubId);
  const f = facilitiesOf(db, st.clubId);
  const active = db.prepare("SELECT * FROM construction_projects WHERE club_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1").get(st.clubId);
  const balance = N(db.prepare('SELECT balance FROM clubs WHERE id = ?').get(st.clubId)!.balance);
  return {
    balance, capacity: econ.capacity,
    project: active ? {
      kind: S(active.kind) as FacilityKind, label: FACILITY_LABEL[S(active.kind) as FacilityKind], toLevel: N(active.from_level) + 1, cost: N(active.cost),
      start: S(active.start_date), end: S(active.end_date),
      progress: Math.min(100, Math.round((100 * (Date.parse(st.gameDate) - Date.parse(S(active.start_date)))) / Math.max(1, Date.parse(S(active.end_date)) - Date.parse(S(active.start_date))))),
    } : null,
    facilities: FACILITY_KINDS.map((kind) => {
      const level = f[kind], maxed = level >= MAX_FACILITY_LEVEL;
      return {
        kind, label: FACILITY_LABEL[kind], level, maxed, effect: effectText(kind, level), nextEffect: maxed ? null : effectText(kind, level + 1),
        cost: maxed ? null : upgradeCost(kind, level, econ.econ), days: maxed ? null : upgradeDays(kind, level),
        extraMonthly: maxed ? null : monthlyCostAt(econ, kind, level + 1) - monthlyCostAt(econ, kind, level),
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
    addNews(db, st.gameDate, 'staff', `Obra iniciada: ${FACILITY_LABEL[kind]}`, `Investimento de ${fmt(cost)}; conclusão prevista para ${br(end)}.`);
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
    addNews(db, date, 'staff', `Obra concluída: ${FACILITY_LABEL[kind]} agora no nível ${f[kind]}`, `A manutenção mensal aumentou.${extra}`);
  }
}
