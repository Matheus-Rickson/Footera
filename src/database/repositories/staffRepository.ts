import type { SqlDb } from '../types.ts';
import { withTransaction } from '../types.ts';
import { UserError } from '../../shared/errors.ts';
import { addYears } from '../../shared/date.ts';
import { COUNTRY_TEMPLATES } from '../../game/world/names.ts';
import {
  qualityFactor, recoveryFactor, STAFF_CONTRACT_YEARS, STAFF_ROLES, STAFF_SEVERANCE_MONTHS, staffCandidates, UNSTAFFED_QUALITY, DEFAULT_DEPT_LEVEL, type FacilityKind, type StaffRole,
} from '../../game/training-engine/training.ts';
import type { StaffOverviewDto } from '../../shared/api.ts';
import { RECOVERY, sharpnessDecay } from '../../game/training-engine/condition.ts';
import { gkCoachFactor } from '../../game/training-engine/sessions.ts';
import { getCareerState } from './careerRepository.ts';
import { makePoster } from './financeRepository.ts';
import { addNews } from './newsRepository.ts';
import { fmtMoney } from '../../shared/money.ts';

export class StaffError extends UserError {}

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const fmt = fmtMoney; // dinheiro nas mensagens (moeda única: euro)
const seedOf = (db: SqlDb) => S((db.prepare("SELECT value FROM meta WHERE key = 'world_seed'").get() ?? { value: 'sem-semente' }).value);
const monthsLeft = (date: string, end: string) => Math.max(0, (Number(end.slice(0, 4)) - Number(date.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(date.slice(5, 7)));
const economyOf = (db: SqlDb, clubId: string) => N(db.prepare('SELECT co.economy FROM clubs cl JOIN countries co ON co.id = cl.country_id WHERE cl.id = ?').get(clubId)!.economy);
/** Níveis das instalações do clube; scouting e rede de captação ausentes = DEFAULT_DEPT_LEVEL (10). */
export const facilitiesOf = (db: SqlDb, clubId: string): Record<FacilityKind, number> => {
  const f = JSON.parse(S(db.prepare('SELECT facilities_json FROM clubs WHERE id = ?').get(clubId)!.facilities_json)) as Partial<Record<FacilityKind, number>>;
  return { training: f.training ?? 1, youth: f.youth ?? 1, medical: f.medical ?? 1, stadium: f.stadium ?? 1, scouting: f.scouting ?? DEFAULT_DEPT_LEVEL, recruitment: f.recruitment ?? DEFAULT_DEPT_LEVEL };
};

export const ROLE_LABEL: Record<StaffRole, string> = { assistant: 'Auxiliar técnico', fitness: 'Preparador físico', goalkeeping: 'Treinador de goleiros', doctor: 'Médico' };
/** O que cada função da comissão faz no jogo (texto das mensagens). */
export const ROLE_EFFECT: Record<StaffRole, string> = {
  assistant: 'O auxiliar técnico acelera a evolução técnica e mental dos jogadores de linha e o aprendizado das funções táticas.',
  fitness: 'O preparador físico acelera a evolução física e a recuperação da condição, segura o ritmo de jogo de quem está parado, freia o declínio dos veteranos, reduz lesões no treino, manda o relatório físico semanal e pode assumir a rotina de treino (delegar).',
  goalkeeping: 'O treinador de goleiros escolhe a sessão de cada goleiro, acelera a evolução deles e manda o relatório semanal dos goleiros.',
  doctor: 'O médico encurta o tempo de recuperação das lesões.',
};

/**
 * Qualidade efetiva (1..20) de uma função no clube. Usuário: o profissional contratado (ou 5, sem ninguém).
 * Clubes da IA não têm comissão individual: o nível do centro de treinamento (ou do departamento médico, para o médico) faz esse papel.
 */
export function staffQuality(db: SqlDb, clubId: string, role: StaffRole): number {
  const st = getCareerState(db);
  if (clubId !== st.clubId) { const f = facilitiesOf(db, clubId); return role === 'doctor' ? f.medical : f.training; }
  const r = db.prepare('SELECT ability FROM staff WHERE role = ?').get(role);
  return r ? N(r.ability) : UNSTAFFED_QUALITY;
}

/** Multiplicador do tempo de lesão do clube (médico + departamento médico). */
export const medicalFactor = (db: SqlDb, clubId: string): number => recoveryFactor(staffQuality(db, clubId, 'doctor'), facilitiesOf(db, clubId).medical);

export function getStaffOverview(db: SqlDb): StaffOverviewDto {
  const st = getCareerState(db);
  const hired = db.prepare('SELECT * FROM staff').all();
  const byRole = new Map(hired.map((r) => [S(r.role) as StaffRole, r]));
  const candidates = staffCandidates(seedOf(db), st.gameDate.slice(0, 7), COUNTRY_TEMPLATES, economyOf(db, st.clubId)).filter((c) => !hired.some((h) => S(h.id) === c.id));
  const f = facilitiesOf(db, st.clubId);
  const pct = (x: number) => `${x >= 1 ? '+' : ''}${Math.round((x - 1) * 100)}%`;
  const effect = (role: StaffRole, q: number): string => {
    if (role === 'assistant') return `Evolução técnica e mental dos jogadores de linha: ${pct(qualityFactor(q))}`;
    if (role === 'fitness') return `Evolução física ${pct(qualityFactor(q))}; recuperação mais rápida; segura o ritmo de jogo; menos lesões no treino; pode assumir a rotina de treino`;
    if (role === 'goalkeeping') return `Evolução dos goleiros: ${pct(gkCoachFactor(q))}`;
    return `Tempo de lesão: ${pct(recoveryFactor(q, f.medical))} (com o departamento médico nível ${f.medical})`;
  };
  /** efeitos com a qualidade atual da função (as mesmas fórmulas do treino, docs/TRAINING_STAFF.md) */
  const effects = (role: StaffRole, q: number): Array<{ label: string; value: string }> => {
    if (role === 'assistant') return [
      { label: 'Evolução técnica e mental', value: pct(qualityFactor(q)) },
      { label: 'Aprendizado das funções táticas', value: pct(qualityFactor(q)) },
    ];
    if (role === 'fitness') return [
      { label: 'Evolução física', value: pct(qualityFactor(q)) },
      { label: 'Recuperação da condição', value: `+${Math.round(((RECOVERY.fitness * q) / 20 / RECOVERY.base) * 100)}%` },
      { label: 'Queda do ritmo parado', value: `${sharpnessDecay(q).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} por dia` },
      { label: 'Risco de lesão no treino', value: pct(1.15 - (0.3 * q) / 20) },
      { label: 'Declínio físico dos veteranos', value: pct(1.1 - (0.2 * q) / 20) },
    ];
    if (role === 'goalkeeping') return [{ label: 'Evolução dos goleiros', value: pct(gkCoachFactor(q)) }, { label: 'Sessão de goleiros', value: byRole.has('goalkeeping') ? 'escolhida por ele (a do ponto mais fraco)' : 'todas as áreas' }];
    return [
      { label: 'Tempo de lesão', value: pct(recoveryFactor(q, f.medical)) },
      { label: 'Departamento médico', value: `nível ${f.medical}` },
    ];
  };
  return {
    roles: STAFF_ROLES.map((role) => {
      const r = byRole.get(role);
      const q = r ? N(r.ability) : UNSTAFFED_QUALITY;
      return {
        role, label: ROLE_LABEL[role], effect: effect(role, q), effects: effects(role, q), quality: q,
        member: r ? { id: S(r.id), name: `${S(r.first_name)} ${S(r.last_name)}`, nationality: S(r.nationality), ability: N(r.ability), salary: N(r.salary), contractEnd: S(r.contract_end) } : null,
        candidates: candidates.filter((c) => c.role === role).map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, nationality: c.nationality, ability: c.ability, salary: c.salary })),
      };
    }),
    monthlyCost: hired.reduce((s, r) => s + N(r.salary), 0), unstaffedQuality: UNSTAFFED_QUALITY,
  };
}

export function hireStaff(db: SqlDb, candidateId: string): void {
  const st = getCareerState(db);
  const c = staffCandidates(seedOf(db), st.gameDate.slice(0, 7), COUNTRY_TEMPLATES, economyOf(db, st.clubId)).find((x) => x.id === candidateId);
  if (!c) throw new StaffError('Candidato indisponível (a lista muda a cada mês).');
  if (db.prepare('SELECT 1 AS x FROM staff WHERE role = ?').get(c.role)) throw new StaffError(`O clube já tem um ${ROLE_LABEL[c.role].toLowerCase()}: demita o atual antes de contratar outro.`);
  withTransaction(db, () => {
    db.prepare('INSERT INTO staff (id, role, first_name, last_name, nationality, ability, salary, hired_on, contract_end) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(c.id, c.role, c.firstName, c.lastName, c.nationality, c.ability, c.salary, st.gameDate, addYears(st.gameDate, STAFF_CONTRACT_YEARS));
    addNews(db, st.gameDate, 'staff', `${ROLE_LABEL[c.role]} contratado: ${c.firstName} ${c.lastName}`, `${c.firstName} ${c.lastName} assinou contrato de ${STAFF_CONTRACT_YEARS} anos como ${ROLE_LABEL[c.role].toLowerCase()}. Qualidade ${c.ability}/20; salário de ${fmt(c.salary)} por mês.\n\n${ROLE_EFFECT[c.role]} Quanto maior a qualidade, maior o efeito.`);
  });
}

/** Demissão: até 3 meses de salário de multa (pela porta única de dinheiro). Sem preparador físico, o treino deixa de ser delegado. */
export function fireStaff(db: SqlDb, staffId: string): number {
  const st = getCareerState(db);
  const r = db.prepare('SELECT * FROM staff WHERE id = ?').get(staffId);
  if (!r) throw new StaffError('Profissional não encontrado.');
  const severance = N(r.salary) * Math.min(STAFF_SEVERANCE_MONTHS, monthsLeft(st.gameDate, S(r.contract_end)));
  withTransaction(db, () => {
    makePoster(db, st.clubId)(st.clubId, st.gameDate, 'coaching', -severance, `Rescisão: ${ROLE_LABEL[S(r.role) as StaffRole]} ${S(r.first_name)} ${S(r.last_name)}`);
    db.prepare('DELETE FROM staff WHERE id = ?').run(staffId);
    if (S(r.role) === 'fitness') db.prepare('UPDATE training_settings SET delegated = 0 WHERE id = 1').run();
  });
  return severance;
}

/** Contratos vencidos encerram (com notícia). NÃO abre transação. */
export function processStaffDay(db: SqlDb, date: string): void {
  for (const r of db.prepare('SELECT * FROM staff WHERE contract_end < ?').all(date)) {
    db.prepare('DELETE FROM staff WHERE id = ?').run(S(r.id));
    if (S(r.role) === 'fitness') db.prepare('UPDATE training_settings SET delegated = 0 WHERE id = 1').run();
    addNews(db, date, 'staff', `Fim de contrato: ${ROLE_LABEL[S(r.role) as StaffRole]} ${S(r.first_name)} ${S(r.last_name)} deixou o clube`,
      `O contrato de ${S(r.first_name)} ${S(r.last_name)} terminou e ele deixou o clube. Sem ninguém na função, o clube trabalha no nível básico (qualidade 5).\n\n${ROLE_EFFECT[S(r.role) as StaffRole]}${S(r.role) === 'fitness' ? ' O treino deixou de ser delegado: defina a rotina na aba Treinamento.' : ''} Contrate um substituto em Comissão técnica.`, { actionLabel: 'Contratar substituto' });
  }
}
