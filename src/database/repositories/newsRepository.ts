import type { SqlDb } from '../types.ts';
import type { NewsDto } from '../../shared/api.ts';

export type NewsKind = NewsDto['kind'];

/** Registra uma notícia do clube do usuário. NÃO abre transação. */
export function addNews(db: SqlDb, date: string, kind: NewsKind, title: string, body = ''): void {
  db.prepare('INSERT INTO news (date, kind, title, body) VALUES (?, ?, ?, ?)').run(date, kind, title, body);
}

export function getNews(db: SqlDb, limit = 100): NewsDto[] {
  return db.prepare('SELECT id, date, kind, title, body FROM news ORDER BY date DESC, id DESC LIMIT ?').all(Math.max(1, Math.min(500, Math.floor(limit))))
    .map((r) => ({ id: Number(r.id), date: String(r.date), kind: String(r.kind) as NewsKind, title: String(r.title), body: String(r.body) }));
}
