/** Composição de uma barra do gráfico financeiro (receitas ou despesas de um mês). Pura, para ser testada sem interface. */
export interface BarPart { category: string; amount: number; pct: number }
export interface BarComposition { total: number; parts: BarPart[] }

export function composeBar(items: ReadonlyArray<{ category: string; amount: number }>, kind: 'income' | 'expense'): BarComposition {
  const rel = items.filter((i) => (kind === 'income' ? i.amount > 0 : i.amount < 0)).map((i) => ({ category: i.category, amount: Math.abs(i.amount) }));
  const total = rel.reduce((s, i) => s + i.amount, 0);
  const parts = rel.sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category)).map((p) => ({ ...p, pct: total > 0 ? (p.amount / total) * 100 : 0 }));
  return { total, parts };
}
