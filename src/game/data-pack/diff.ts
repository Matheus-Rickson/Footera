/**
 * Diferença entre o registro original (da base) e o editado, no formato do pacote: só os campos que mudaram. Objetos aninhados
 * que o formato aceita parciais (atributos, estrutura, regras, contrato, personalidade) entram só com as chaves alteradas.
 * Devolve null se nada mudou (o editor então tira o registro do pacote).
 */
type Rec = Record<string, unknown>;
const PARTIAL = new Set(['facilities', 'rules', 'contract', 'personality']);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function diffRecord(base: Rec, edited: Rec): Rec | null {
  const out: Rec = { id: edited.id ?? base.id };
  let changed = false;
  for (const [k, v] of Object.entries(edited)) {
    if (k === 'id' || v === undefined) continue;
    const b = base[k];
    if (same(b, v)) continue;
    if (k === 'attributes' && v && b && typeof v === 'object' && typeof b === 'object') {
      const groups: Rec = {};
      for (const [g, attrs] of Object.entries(v as Rec)) {
        const bg = ((b as Rec)[g] ?? {}) as Rec;
        const d = Object.fromEntries(Object.entries(attrs as Rec).filter(([ak, av]) => bg[ak] !== av));
        if (Object.keys(d).length) groups[g] = d;
      }
      if (Object.keys(groups).length) { out.attributes = groups; changed = true; }
      continue;
    }
    if (PARTIAL.has(k) && v && b && typeof v === 'object' && typeof b === 'object' && !Array.isArray(v)) {
      const d = Object.fromEntries(Object.entries(v as Rec).filter(([sk, sv]) => !same((b as Rec)[sk], sv)));
      if (Object.keys(d).length) { out[k] = d; changed = true; }
      continue;
    }
    out[k] = v; changed = true;
  }
  return changed ? out : null;
}
