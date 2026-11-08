import type { SqlDb } from '../types.ts';
import type { InboxAction, NewsDto } from '../../shared/api.ts';
import { OBJECTIVE_LABEL, type Objective } from '../../game/board-engine/board.ts';
import { fmtMoney } from '../../shared/money.ts';

export type NewsKind = NewsDto['kind'];

/** Remetente e ação padrão de cada tipo de mensagem (quando quem grava não informa). */
export const INBOX_DEFAULTS: Record<NewsKind, { sender: string; action: InboxAction | null; label: string | null }> = {
  season: { sender: 'Diretoria', action: 'season', label: 'Ver a temporada' },
  trophy: { sender: 'Presidência', action: 'trophies', label: 'Abrir a sala de troféus' },
  transfer: { sender: 'Departamento de futebol', action: 'transfers', label: 'Ir para Transferências' },
  contract: { sender: 'Departamento de futebol', action: 'contracts', label: 'Ver contratos' },
  youth: { sender: 'Categorias de base', action: 'youth', label: 'Ir para a base' },
  retirement: { sender: 'Departamento de futebol', action: 'squad', label: 'Ver o elenco' },
  offer: { sender: 'Diretoria', action: 'board', label: 'Responder na Diretoria' },
  staff: { sender: 'Comissão técnica', action: 'staff', label: 'Ver a comissão técnica' },
  medical: { sender: 'Departamento médico', action: 'tactics', label: 'Ajustar a escalação em Táticas' },
  market: { sender: 'Departamento de futebol', action: 'transfers', label: 'Responder a proposta' },
  board: { sender: 'Diretoria', action: 'board', label: 'Ir para a Diretoria' },
  squad: { sender: 'Comissão técnica', action: 'tactics', label: 'Ajustar a escalação' },
};

/** Resumo da diretoria (objetivo, orçamentos, confiança) para as mensagens; vazio sem clube. */
export function boardBrief(db: SqlDb): string {
  const b = db.prepare('SELECT * FROM board_state WHERE id = 1').get();
  if (!b) return '';
  const left = Math.max(0, Number(b.transfer_budget) - Number(b.transfer_spent));
  return `Objetivo da temporada: ${OBJECTIVE_LABEL[String(b.objective) as Objective].toLowerCase()} (terminar até o ${Number(b.target_position)}º). Orçamento de transferências disponível: ${fmtMoney(left)}; teto da folha salarial: ${fmtMoney(Number(b.wage_ceiling))} por mês. Confiança da diretoria: ${Math.round(Number(b.confidence))}/100.`;
}
/** Tamanho do elenco principal do clube. */
export const squadSize = (db: SqlDb, clubId: string): number => Number(db.prepare('SELECT COUNT(*) AS n FROM players WHERE club_id = ?').get(clubId)!.n);

/** Mensagens gravadas antes da Caixa de entrada: reclassificadas pelo assunto (remetente e ação certos). */
function legacyKind(kind: NewsKind, title: string): NewsKind {
  if (kind === 'staff' && title.startsWith('Departamento médico:')) return 'medical';
  if (kind === 'season' && /^(Diretoria|DEMITIDO|Novo clube)/.test(title)) return 'board';
  return kind;
}

/** Registra uma mensagem na caixa de entrada do treinador. NÃO abre transação. */
export function addNews(db: SqlDb, date: string, kind: NewsKind, title: string, body = '', opts: { sender?: string; action?: InboxAction | null; actionLabel?: string; players?: string[] } = {}): void {
  db.prepare('INSERT INTO news (date, kind, title, body, sender, action, action_label, players_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(date, kind, title, body, opts.sender ?? null, opts.action === undefined ? null : opts.action ?? 'none', opts.actionLabel ?? null, opts.players?.length ? JSON.stringify(opts.players) : null);
}

export function getNews(db: SqlDb, limit = 200): NewsDto[] {
  return db.prepare('SELECT * FROM news ORDER BY date DESC, id DESC LIMIT ?').all(Math.max(1, Math.min(500, Math.floor(limit)))).map((r) => {
    const kind = r.sender == null && r.action == null ? legacyKind(String(r.kind) as NewsKind, String(r.title)) : (String(r.kind) as NewsKind), d = INBOX_DEFAULTS[kind];
    const action = r.action == null ? d.action : String(r.action) === 'none' ? null : (String(r.action) as InboxAction);
    return {
      id: Number(r.id), date: String(r.date), kind, title: String(r.title), body: String(r.body),
      sender: r.sender == null ? d.sender : String(r.sender), action, actionLabel: action ? (r.action_label == null ? (r.action == null ? d.label : null) ?? 'Abrir' : String(r.action_label)) : null,
      read: Number(r.read) === 1, playerIds: r.players_json == null ? null : (JSON.parse(String(r.players_json)) as string[]),
    };
  });
}
export const unreadCount = (db: SqlDb): number => Number(db.prepare('SELECT COUNT(*) AS n FROM news WHERE read = 0').get()!.n);
/** Marca uma mensagem (ou todas, com `id` nulo) como lida. */
export function markRead(db: SqlDb, id: number | null): void {
  if (id === null) db.prepare('UPDATE news SET read = 1 WHERE read = 0').run();
  else db.prepare('UPDATE news SET read = 1 WHERE id = ?').run(id);
}
