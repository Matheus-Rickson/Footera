/**
 * Importação e exportação de jogadores e clubes em CSV (planilha) para os pacotes de dados. Regras puras: ler/escrever o texto e
 * converter cada linha em registro de pacote (o mesmo formato dos arquivos JSON). A validação final é a do pacote (compilação).
 *
 * - Separador `;` (Excel em português) ou `,`, detectado pela linha de cabeçalho; aspas duplas para campos com separador/quebra de linha.
 * - Cabeçalhos em português, sem diferença entre maiúsculas/minúsculas e acentos ("Posição" = "posicao"); também aceita as chaves do JSON.
 * - Linha com `id` de registro existente ALTERA esse registro (só as colunas preenchidas); sem `id`, CRIA um registro novo.
 * - Células vazias são ignoradas (não apagam nada).
 */
import { ATTR_GROUP, ATTR_LABEL } from '../../shared/attributeLabels.ts';
import { POS_LABEL } from '../../shared/positions.ts';
import type { Position } from '../../shared/types.ts';

export type CsvKind = 'players' | 'clubs';
type Rec = Record<string, unknown>;
export interface CsvRowResult { line: number; record: Rec }
export interface CsvIssue { line: number; message: string }

// ---------------------------------------------------------------- texto
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Lê o CSV (com ou sem BOM). Retorna as linhas (já sem linhas totalmente vazias) com o número da linha no arquivo. */
export function parseCsv(text: string): { sep: ';' | ','; rows: Array<{ line: number; cells: string[] }> } {
  const t = text.replace(/^﻿/, '');
  const firstLine = t.split(/\r?\n/, 1)[0] ?? '';
  const sep: ';' | ',' = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: Array<{ line: number; cells: string[] }> = [];
  let cells: string[] = [], cur = '', q = false, line = 1, start = 1;
  const endRow = () => { cells.push(cur); cur = ''; if (cells.some((c) => c.trim() !== '')) rows.push({ line: start, cells: cells.map((c) => c.trim()) }); cells = []; };
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else if (ch === '\r' && t[i + 1] === '\n') continue; // CRLF dentro de aspas vira \n
      else { if (ch === '\n') line++; cur += ch; }
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === sep) { cells.push(cur); cur = ''; }
    else if (ch === '\r') continue;
    else if (ch === '\n') { endRow(); line++; start = line; }
    else cur += ch;
  }
  if (cur !== '' || cells.length) endRow();
  return { sep, rows };
}

/** global do Node e do navegador (o tsconfig do motor não inclui a lib DOM) */
type Decoder = new (label: string, opts?: { fatal?: boolean }) => { decode(b: Uint8Array): string };
const Dec = (globalThis as unknown as { TextDecoder: Decoder }).TextDecoder;

/** Bytes do arquivo → texto: UTF-8 (com ou sem BOM) ou, se não for UTF-8 válido, Windows-1252 (padrão do Excel em português). */
export function decodeCsv(bytes: Uint8Array): string {
  try { return new Dec('utf-8', { fatal: true }).decode(bytes); } catch { return new Dec('windows-1252').decode(bytes); }
}

/** Escreve CSV com `;` e BOM (o Excel em português abre direto, com acentos). */
export function toCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  const cell = (v: string | number | null | undefined) => { const s = v == null ? '' : String(v); return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- colunas
interface Col { key: string; label: string; aliases?: string[]; help: string }
const ATTR_COLS: Col[] = Object.entries(ATTR_LABEL).filter(([k]) => k !== 'goalkeeping').map(([k, label]) => ({ key: `attr.${k}`, label, aliases: [k], help: 'atributo 1–20' }));
export const CSV_COLUMNS: Record<CsvKind, Col[]> = {
  players: [
    { key: 'id', label: 'id', help: 'vazio = jogador novo; preenchido = altera o jogador com este id' },
    { key: 'firstName', label: 'Nome', aliases: ['primeiro nome'], help: 'obrigatório para jogador novo' },
    { key: 'lastName', label: 'Sobrenome', help: 'obrigatório para jogador novo' },
    { key: 'birthDate', label: 'Nascimento', aliases: ['data de nascimento'], help: 'dd/mm/aaaa ou aaaa-mm-dd' },
    { key: 'nationality', label: 'Nacionalidade', help: 'código de 3 letras padrão FIFA (BRA, ARG, ENG, USA, NGA…); vale qualquer nação, mesmo fora do universo' },
    { key: 'club', label: 'Clube', help: 'id do clube (veja no editor); "livre" = sem clube' },
    { key: 'position', label: 'Posição', aliases: ['posicao principal'], help: 'GOL, ZAG, LE, LD, AE, AD, VOL, MC, ME, MD, MEI, PE, PD, SA, CA' },
    { key: 'secondaryPositions', label: 'Secundárias', aliases: ['posicoes secundarias'], help: 'até 3, separadas por / (ex.: MEI/PE)' },
    { key: 'foot', label: 'Pé', aliases: ['pe preferido'], help: 'direito, esquerdo ou ambos' },
    { key: 'heightCm', label: 'Altura', aliases: ['altura cm'], help: 'em cm (140–220)' },
    { key: 'weightKg', label: 'Peso', aliases: ['peso kg'], help: 'em kg (40–130)' },
    { key: 'ability', label: 'Força', aliases: ['forca 1 20', 'nivel'], help: '1–20: sem atributos, o jogo gera atributos coerentes com a posição' },
    { key: 'potential', label: 'Potencial', help: '1–20' },
    { key: 'salary', label: 'Salário', aliases: ['salario mensal'], help: 'euros por mês' },
    { key: 'contractEnd', label: 'Fim do contrato', aliases: ['contrato ate'], help: 'dd/mm/aaaa ou aaaa-mm-dd' },
    ...ATTR_COLS,
  ],
  clubs: [
    { key: 'id', label: 'id', help: 'vazio = clube novo; preenchido = altera o clube com este id' },
    { key: 'name', label: 'Nome', help: 'obrigatório para clube novo' },
    { key: 'shortName', label: 'Sigla', help: '2 a 5 letras' },
    { key: 'country', label: 'País', aliases: ['pais id'], help: 'id do país (ex.: bra)' },
    { key: 'league', label: 'Liga', aliases: ['divisao'], help: 'id da liga (ex.: bra-1)' },
    { key: 'city', label: 'Cidade', help: '' },
    { key: 'state', label: 'Estado', aliases: ['uf'], help: 'sigla do estado (ex.: SP), se o país tiver estados' },
    { key: 'stateDivision', label: 'Divisão estadual', aliases: ['divisao do estadual'], help: '1 = elite do estadual, 2 = segunda divisão, vazio = fora do estadual' },
    { key: 'reputation', label: 'Reputação', help: '1–100 (no jogo aparece em estrelas)' },
    { key: 'balance', label: 'Caixa', aliases: ['saldo'], help: 'euros' },
    { key: 'fans', label: 'Torcida', aliases: ['torcedores'], help: 'número de torcedores' },
    { key: 'fac.training', label: 'Centro de treinamento', help: 'instalação 1–20' },
    { key: 'fac.youth', label: 'Categorias de base', help: 'instalação 1–20' },
    { key: 'fac.medical', label: 'Departamento médico', help: 'instalação 1–20' },
    { key: 'fac.stadium', label: 'Estádio', aliases: ['estrutura do estadio'], help: 'instalação 1–20' },
    { key: 'honours', label: 'Títulos históricos', aliases: ['titulos'], help: 'separados por ";": [id da competição] Nome: quantidade (anos). Ex.: [bra-1] Brasileirão: 7 (1980, 1982); Copa Sul: 2. O id e os anos são opcionais; "-" apaga' },
  ],
};

/** Títulos históricos em texto de planilha: "[bra-1] Brasileirão: 7 (1980, 1982); Copa Sul: 2". */
export function formatHonours(list: ReadonlyArray<{ competitionId?: string; name: string; count: number; years?: string }> | undefined | null): string | null {
  if (!list?.length) return null;
  return list.map((h) => `${h.competitionId ? `[${h.competitionId}] ` : ''}${h.name}: ${h.count}${h.years ? ` (${h.years})` : ''}`).join('; ');
}
/** Lê o texto de títulos históricos; `null` = apagar ("-"); erro com a parte que não deu para ler. */
export function parseHonours(text: string): { value: Array<{ competitionId?: string; name: string; count: number; years?: string }> | null } | { error: string } {
  if (text.trim() === '-') return { value: null };
  const out: Array<{ competitionId?: string; name: string; count: number; years?: string }> = [];
  for (const part of text.split(';').map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(?:\[([a-z0-9-]+)\]\s*)?(.+?)\s*:\s*(\d+)\s*(?:\((.*)\))?$/i);
    if (!m) return { error: `"${part}": use Nome: quantidade (anos), por exemplo Copa Sul: 2 (1999, 2004).` };
    out.push({ ...(m[1] ? { competitionId: m[1].toLowerCase() } : {}), name: m[2]!.trim(), count: Number(m[3]), ...(m[4]?.trim() ? { years: m[4].trim() } : {}) });
  }
  return { value: out };
}
const POS_BY_LABEL = new Map<string, Position>([
  ...Object.entries(POS_LABEL).map(([code, label]) => [norm(label), code as Position] as const),
  ...Object.keys(POS_LABEL).map((code) => [norm(code), code as Position] as const),
]);
const FOOT: Record<string, 'right' | 'left' | 'both'> = { direito: 'right', destro: 'right', right: 'right', d: 'right', esquerdo: 'left', canhoto: 'left', left: 'left', e: 'left', ambos: 'both', ambidestro: 'both', both: 'both' };

/** Cabeçalho do arquivo → coluna conhecida (ou erro com as que não foram reconhecidas). */
export function mapHeader(kind: CsvKind, header: readonly string[]): { cols: Array<Col | null>; unknown: string[] } {
  const known = new Map<string, Col>();
  for (const c of CSV_COLUMNS[kind]) for (const a of [c.label, c.key, ...(c.aliases ?? [])]) known.set(norm(a), c);
  const cols = header.map((h) => known.get(norm(h)) ?? null);
  return { cols, unknown: header.filter((h, i) => h.trim() && !cols[i]) };
}

const num = (s: string): number | null => { const v = Number(s.replace(/\./g, '').replace(',', '.').replace(/[€\s]/g, '')); return Number.isFinite(v) ? v : null; };
const intOf = (s: string): number | null => { const v = num(s); return v === null ? null : Math.round(v); };
function dateOf(s: string): string | null {
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]!.padStart(2, '0')}-${br[1]!.padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Converte as linhas em registros de pacote. Erros de formato por linha (a validação de regras vem depois, na compilação). */
export function rowsToRecords(kind: CsvKind, text: string): { records: CsvRowResult[]; issues: CsvIssue[] } {
  const { rows } = parseCsv(text);
  const issues: CsvIssue[] = [];
  if (!rows.length) return { records: [], issues: [{ line: 1, message: 'Arquivo vazio.' }] };
  const { cols, unknown } = mapHeader(kind, rows[0]!.cells);
  if (unknown.length) issues.push({ line: rows[0]!.line, message: `Coluna(s) não reconhecida(s), ignorada(s): ${unknown.join(', ')}.` });
  if (!cols.some(Boolean)) return { records: [], issues: [{ line: rows[0]!.line, message: 'Nenhuma coluna reconhecida no cabeçalho. Use o modelo do editor.' }] };
  const records: CsvRowResult[] = [];
  for (const { line, cells } of rows.slice(1)) {
    const r: Rec = {};
    const bad = (m: string) => issues.push({ line, message: m });
    cols.forEach((c, i) => {
      const v = (cells[i] ?? '').trim();
      if (!c || v === '') return;
      const k = c.key;
      if (k.startsWith('attr.')) {
        const a = k.slice(5), n = intOf(v), g = ATTR_GROUP[a]!;
        if (n === null) return bad(`${c.label}: "${v}" não é número.`);
        const attrs = (r.attributes ??= {}) as Record<string, Record<string, number>>;
        (attrs[g] ??= {})[a] = n;
      } else if (k.startsWith('fac.')) {
        const n = intOf(v);
        if (n === null) return bad(`${c.label}: "${v}" não é número.`);
        ((r.facilities ??= {}) as Record<string, number>)[k.slice(4)] = n;
      } else if (k === 'position') {
        const p = POS_BY_LABEL.get(norm(v));
        if (!p) return bad(`Posição "${v}" desconhecida (use GOL, ZAG, LE, LD, AE, AD, VOL, MC, ME, MD, MEI, PE, PD, SA ou CA).`);
        r.position = p;
      } else if (k === 'secondaryPositions') {
        const ps = v.split(/[/|,]/).map((x) => x.trim()).filter(Boolean).map((x) => POS_BY_LABEL.get(norm(x)));
        if (ps.some((x) => !x)) return bad(`Secundárias "${v}": posição desconhecida.`);
        r.secondaryPositions = ps;
      } else if (k === 'foot') {
        const f = FOOT[norm(v)];
        if (!f) return bad(`Pé "${v}": use direito, esquerdo ou ambos.`);
        r.foot = f;
      } else if (k === 'birthDate' || k === 'contractEnd') {
        const d = dateOf(v);
        if (!d) return bad(`${c.label} "${v}": use dd/mm/aaaa ou aaaa-mm-dd.`);
        if (k === 'birthDate') r.birthDate = d; else ((r.contract ??= {}) as Rec).end = d;
      } else if (k === 'salary') {
        const n = intOf(v);
        if (n === null) return bad(`Salário "${v}" não é número.`);
        ((r.contract ??= {}) as Rec).salary = n;
      } else if (k === 'club') {
        r.club = norm(v) === 'livre' || norm(v) === 'sem clube' ? null : v;
      } else if (k === 'nationality') r.nationality = v.toUpperCase();
      else if (k === 'state') r.state = v.toUpperCase();
      else if (k === 'honours') {
        const h = parseHonours(v);
        if ('error' in h) return bad(`Títulos históricos: ${h.error}`);
        r.honours = h.value;
      }
      else if (k === 'stateDivision') {
        const n = intOf(v);
        if (n !== 1 && n !== 2) return bad(`Divisão estadual "${v}": use 1 (elite) ou 2 (segunda divisão).`);
        r.stateDivision = n;
      }
      else if (['heightCm', 'weightKg', 'ability', 'potential', 'reputation', 'balance', 'fans'].includes(k)) {
        const n = intOf(v);
        if (n === null) return bad(`${c.label}: "${v}" não é número.`);
        r[k] = n;
      } else r[k] = v;
    });
    if (Object.keys(r).length) records.push({ line, record: r });
  }
  return { records, issues };
}

/** Uma linha de CSV a partir de um registro de pacote (exportação). */
export function recordToRow(kind: CsvKind, r: Rec): Array<string | number | null> {
  return CSV_COLUMNS[kind].map((c) => {
    const k = c.key;
    if (k.startsWith('attr.')) { const a = k.slice(5); const g = (r.attributes as Record<string, Record<string, number>> | undefined)?.[ATTR_GROUP[a]!]; return g?.[a] ?? null; }
    if (k.startsWith('fac.')) return (r.facilities as Record<string, number> | undefined)?.[k.slice(4)] ?? null;
    if (k === 'position') return r.position ? POS_LABEL[r.position as Position] : null;
    if (k === 'secondaryPositions') return Array.isArray(r.secondaryPositions) ? (r.secondaryPositions as Position[]).map((p) => POS_LABEL[p]).join('/') : null;
    if (k === 'foot') return r.foot ? ({ right: 'direito', left: 'esquerdo', both: 'ambos' } as Record<string, string>)[String(r.foot)]! : null;
    if (k === 'birthDate') return r.birthDate ? String(r.birthDate).split('-').reverse().join('/') : null;
    if (k === 'contractEnd') { const e = (r.contract as Rec | undefined)?.end; return e ? String(e).split('-').reverse().join('/') : null; }
    if (k === 'salary') return ((r.contract as Rec | undefined)?.salary as number | undefined) ?? null;
    if (k === 'club') return r.club === null ? 'livre' : (r.club as string | undefined) ?? null;
    if (k === 'honours') return formatHonours(r.honours as Parameters<typeof formatHonours>[0]);
    return (r[k] as string | number | undefined) ?? null;
  });
}
export const csvHeader = (kind: CsvKind): string[] => CSV_COLUMNS[kind].map((c) => c.label);
