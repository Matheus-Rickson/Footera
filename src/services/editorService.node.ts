/**
 * Editor de dados: edita um pacote do usuário (packs/<id>) em cima da base fixa. O que o editor mostra é o universo "base + este pacote".
 * Cada gravação valida a combinação inteira antes de escrever (erro = nada é gravado). O pacote guarda só as diferenças em relação à
 * base (registros de alteração), as entidades criadas (registros completos) e as remoções ($remove).
 */
import fs from 'node:fs';
import path from 'node:path';
import { compileUniverse } from '../game/data-pack/compile.ts';
import { diffRecord } from '../game/data-pack/diff.ts';
import { csvHeader, recordToRow, rowsToRecords, toCsv, type CsvKind } from '../game/data-pack/csv.ts';
import { clubRec, coachRec, countryRec, cupRec, leagueRec, playerRec, stadiumRec } from '../game/data-pack/export.ts';
import { fmtIssue, PACK_FORMAT, PackError, type Pack, type PackData } from '../game/data-pack/format.ts';
import { ageOn } from '../shared/date.ts';
import { ID_PATTERN, uniqueIds } from '../shared/slug.ts';
import { to20 } from '../shared/scale.ts';
import type { CsvImportReportDto, EditorEntityDto, EditorKind, EditorListDto, EditorListQuery, EditorOptionsDto, EditorStatus, EditorSummaryDto } from '../shared/api.ts';
import type { World } from '../shared/types.ts';
import { ValidationError } from './careerService.ts';
import { packsDir, setLoadOrder } from './packManager.node.ts';
import { readPackDir, writePackDir } from './packService.node.ts';
import { basePack, baseUniverse, EMPTY_WORLD } from './universeService.node.ts';

type Rec = Record<string, unknown>;
const KINDS: EditorKind[] = ['countries', 'leagues', 'clubs', 'players', 'coaches', 'cups'];

function packDirOf(dataDir: string, packId: string): string {
  if (!ID_PATTERN.test(packId)) throw new ValidationError('Pacote inválido.');
  const dir = path.join(packsDir(dataDir), packId);
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) throw new ValidationError('Pacote não encontrado.');
  return dir;
}
function loadPack(dataDir: string, packId: string): Pack {
  try { return readPackDir(packDirOf(dataDir, packId)); } catch (e) {
    if (e instanceof PackError) throw new ValidationError(`O pacote tem erros e não pode ser editado aqui: ${fmtIssue(e.issues[0]!)}`);
    throw e;
  }
}

/** universo base + pacote (cache pelo conteúdo do pacote) */
let cache: { key: string; world: World } | null = null;
function universeOf(pack: Pack): World {
  const key = `${pack.manifest.id}:${JSON.stringify(pack.data).length}:${hash(JSON.stringify(pack.data))}`;
  if (cache?.key === key) return cache.world;
  const world = compile(pack);
  cache = { key, world };
  return world;
}
function compile(pack: Pack): World {
  try { return compileUniverse(EMPTY_WORLD, [basePack(), pack]).world; } catch (e) {
    if (e instanceof PackError) throw new ValidationError(e.issues.slice(0, 4).map((i) => i.message + (i.record ? ` (${i.record})` : '')).join(' • ') + (e.issues.length > 4 ? ` • e mais ${e.issues.length - 4}` : ''));
    throw e;
  }
}
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

const recordsOf = (pack: Pack, kind: EditorKind | 'stadiums') => pack.data[kind] as unknown as Rec[];
function statusOf(pack: Pack, kind: EditorKind, id: string, baseHas: boolean): EditorStatus {
  const r = recordsOf(pack, kind).find((x) => x.id === id);
  if (!r) return 'base';
  if (r.$remove) return 'removed';
  return baseHas ? 'edited' : 'created';
}
function baseHas(kind: EditorKind | 'stadiums', id: string): boolean {
  const w = baseUniverse().world;
  return ((w[kind] ?? []) as Array<{ id: string }>).some((x) => x.id === id);
}

/** registro "de formulário" de uma entidade do universo (escalas 1–20; sem valores internos do motor) */
function formRecord(w: World, kind: EditorKind, id: string): Rec | null {
  if (kind === 'countries') { const c = w.countries.find((x) => x.id === id); return c ? countryRec(c) as Rec : null; }
  if (kind === 'leagues') { const l = w.leagues.find((x) => x.id === id); return l ? leagueRec(l) as Rec : null; }
  if (kind === 'clubs') { const c = w.clubs.find((x) => x.id === id); return c ? clubRec(c) as Rec : null; }
  if (kind === 'coaches') { const k = (w.coaches ?? []).find((x) => x.id === id); return k ? coachRec(k) as Rec : null; }
  if (kind === 'cups') { const k = (w.cups ?? []).find((x) => x.id === id); return k ? cupRec(k) as Rec : null; }
  const p = w.players.find((x) => x.id === id);
  if (!p) return null;
  const { marketValue: _m, ...rest } = playerRec(p, false);
  return { ...rest, potential: to20(p.potentialHidden) };
}

export function editorSummary(dataDir: string, packId: string): EditorSummaryDto {
  const pack = loadPack(dataDir, packId);
  const changes = Object.fromEntries(KINDS.map((k) => {
    const recs = recordsOf(pack, k);
    return [k, { created: recs.filter((r) => !r.$remove && !baseHas(k, String(r.id))).length, edited: recs.filter((r) => !r.$remove && baseHas(k, String(r.id))).length, removed: recs.filter((r) => r.$remove).length }];
  })) as EditorSummaryDto['changes'];
  const m = pack.manifest;
  let enabled = false;
  try { enabled = (JSON.parse(fs.readFileSync(path.join(packsDir(dataDir), 'load-order.json'), 'utf8')) as { enabled: string[] }).enabled.includes(packId); } catch { /* sem ordem gravada */ }
  return { pack: { id: m.id, name: m.name, version: m.version, author: m.author ?? null, description: m.description ?? null }, changes, enabled };
}

export function editorOptions(dataDir: string, packId: string): EditorOptionsDto {
  const w = universeOf(loadPack(dataDir, packId));
  return {
    countries: w.countries.map((c) => ({ id: c.id, name: c.name, code: c.code, states: (c.states ?? []).map((s) => ({ ...s })) })),
    leagues: w.leagues.map((l) => ({ id: l.id, name: l.name, countryId: l.countryId, tier: l.tier, active: l.active !== false })),
    clubs: w.clubs.map((c) => ({ id: c.id, name: c.name, leagueId: c.leagueId, countryId: c.countryId })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function editorList(dataDir: string, packId: string, q: EditorListQuery): EditorListDto {
  const pack = loadPack(dataDir, packId);
  const w = universeOf(pack), base = baseUniverse().world;
  const country = new Map(w.countries.map((c) => [c.id, c]));
  const league = new Map(w.leagues.map((l) => [l.id, l]));
  const club = new Map(w.clubs.map((c) => [c.id, c]));
  const s = (q.search ?? '').trim().toLowerCase();
  type Row = EditorListDto['rows'][number];
  let rows: Row[] = [];
  const st = (id: string) => statusOf(pack, q.kind, id, baseHas(q.kind, id));
  if (q.kind === 'countries') rows = w.countries.map((c) => ({ id: c.id, title: c.name, subtitle: `${c.code} · ${w.leagues.filter((l) => l.countryId === c.id).length} liga(s)`, status: st(c.id), extra: null }));
  if (q.kind === 'leagues') rows = w.leagues.filter((l) => !q.countryId || l.countryId === q.countryId)
    .sort((a, b) => a.countryId.localeCompare(b.countryId) || a.tier - b.tier)
    .map((l) => ({ id: l.id, title: l.name, subtitle: `${country.get(l.countryId)?.name ?? l.countryId} · ${l.tier}ª divisão · ${l.teamCount} clubes`, status: st(l.id), extra: null }));
  if (q.kind === 'clubs') {
    const avg = new Map<string, number[]>();
    for (const p of w.players) if (p.clubId) avg.set(p.clubId, [...(avg.get(p.clubId) ?? []), p.overall]);
    rows = w.clubs.filter((c) => (!q.countryId || c.countryId === q.countryId) && (!q.leagueId || c.leagueId === q.leagueId))
      .sort((a, b) => (league.get(a.leagueId)?.tier ?? 9) - (league.get(b.leagueId)?.tier ?? 9) || b.reputation - a.reputation)
      .map((c) => { const o = avg.get(c.id) ?? []; return { id: c.id, title: c.name, subtitle: `${league.get(c.leagueId)?.name ?? ''} · ${country.get(c.countryId)?.name ?? ''}`, status: st(c.id), extra: o.length ? String(to20(o.reduce((x, y) => x + y, 0) / o.length)) : null }; });
  }
  if (q.kind === 'players') rows = w.players.filter((p) => (!q.clubId || p.clubId === q.clubId) && (!q.countryId || (p.clubId ? club.get(p.clubId)?.countryId === q.countryId : false)) && (!q.position || p.position === q.position))
    .sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id))
    .map((p) => ({ id: p.id, title: `${p.firstName} ${p.lastName}`, subtitle: `${p.position} · ${p.clubId ? club.get(p.clubId)?.name ?? '' : 'Sem clube'} · ${ageOn(p.birthDate, w.startDate)} anos`, status: st(p.id), extra: String(to20(p.overall)) }));
  if (q.kind === 'coaches') rows = (w.coaches ?? []).filter((k) => (!q.clubId || k.clubId === q.clubId) && (!q.countryId || (k.clubId ? club.get(k.clubId)?.countryId === q.countryId : country.get(q.countryId)?.code === k.nationality)))
    .sort((a, b) => b.reputation - a.reputation || a.id.localeCompare(b.id))
    .map((k) => ({ id: k.id, title: `${k.firstName} ${k.lastName}`, subtitle: `${k.clubId ? club.get(k.clubId)?.name ?? '' : 'Sem clube'} · ${ageOn(k.birthDate, w.startDate)} anos · ${k.nationality}`, status: st(k.id), extra: null }));
  if (q.kind === 'cups') rows = (w.cups ?? []).filter((k) => !q.countryId || k.countryId === q.countryId)
    .sort((a, b) => (country.get(a.countryId)?.name ?? '').localeCompare(country.get(b.countryId)?.name ?? '') || a.kind.localeCompare(b.kind))
    .map((k) => ({ id: k.id, title: k.name, subtitle: `${k.kind === 'cup' ? 'Copa' : 'Supercopa'} · ${country.get(k.countryId)?.name ?? k.countryId}${k.enabled ? '' : ' · desativada'}`, status: st(k.id), extra: null }));
  // entidades removidas pelo pacote não estão no universo: aparecem a partir da base (para poder restaurar)
  for (const r of recordsOf(pack, q.kind).filter((x) => x.$remove)) {
    const id = String(r.id);
    const b = ((base[q.kind] ?? []) as Array<{ id: string; name?: string; firstName?: string; lastName?: string }>).find((x) => x.id === id);
    if (b) rows.unshift({ id, title: b.name ?? `${b.firstName} ${b.lastName}`, subtitle: 'excluído por este pacote', status: 'removed', extra: null });
  }
  if (s) rows = rows.filter((r) => r.title.toLowerCase().includes(s) || r.id.includes(s));
  if (q.onlyChanged) rows = rows.filter((r) => r.status !== 'base');
  const offset = Math.max(0, q.offset ?? 0), limit = Math.min(300, Math.max(1, q.limit ?? 100));
  return { total: rows.length, rows: rows.slice(offset, offset + limit) };
}

export function editorGet(dataDir: string, packId: string, kind: EditorKind, id: string): EditorEntityDto {
  const pack = loadPack(dataDir, packId);
  const w = universeOf(pack);
  const inBase = baseHas(kind, id);
  const status = statusOf(pack, kind, id, inBase);
  const record = formRecord(status === 'removed' ? baseUniverse().world : w, kind, id);
  if (!record) throw new ValidationError('Registro não encontrado.');
  const dto: EditorEntityDto = { kind, id, status, inBase, record, stadium: null, derived: {} };
  if (kind === 'clubs') {
    const c = (status === 'removed' ? baseUniverse().world : w).clubs.find((x) => x.id === id)!;
    const sd = (status === 'removed' ? baseUniverse().world : w).stadiums.find((x) => x.id === c.stadiumId);
    dto.stadium = sd ? stadiumRec(sd) as Rec : null;
    const sq = w.players.filter((p) => p.clubId === id);
    dto.derived = { squad: sq.length, overall: sq.length ? to20(sq.reduce((s, p) => s + p.overall, 0) / sq.length) : null };
  }
  if (kind === 'players') {
    const p = (status === 'removed' ? baseUniverse().world : w).players.find((x) => x.id === id)!;
    dto.derived = { overall: to20(p.overall), marketValue: p.marketValue, age: ageOn(p.birthDate, w.startDate) };
  }
  if (kind === 'coaches') {
    const k = ((status === 'removed' ? baseUniverse().world : w).coaches ?? []).find((x) => x.id === id)!;
    dto.derived = { age: ageOn(k.birthDate, w.startDate) };
  }
  return dto;
}

/** limpa o registro antes de guardar: sem campos vazios; jogador criado sem valores calculados pelo jogo */
function clean(kind: EditorKind | 'stadiums', r: Rec, created: boolean): Rec {
  const out: Rec = {};
  for (const [k, v] of Object.entries(r)) if (v !== undefined && v !== '' && !(k === 'status')) out[k] = v;
  if (kind === 'players') {
    delete out.internal;
    if (created) { delete out.marketValue; if (out.attributes) delete out.ability; }
  }
  return out;
}

/** Grava a entidade no pacote (cria, ou altera guardando só as diferenças da base). `stadium` acompanha o clube. */
export function editorSave(dataDir: string, packId: string, kind: EditorKind, input: Rec, stadium?: Rec | null): EditorEntityDto {
  const pack = loadPack(dataDir, packId);
  const w = universeOf(pack);
  const next: Pack = { manifest: pack.manifest, data: JSON.parse(JSON.stringify(pack.data)) as PackData };
  let id = typeof input.id === 'string' && input.id ? input.id : '';
  const isNew = !id;
  if (isNew) id = newIdFor(w, kind, input);
  const inBase = baseHas(kind, id);
  const record = clean(kind, { ...input, id }, !inBase);
  const put = (k: EditorKind | 'stadiums', rid: string, rec: Rec | null) => {
    const arr = recordsOf(next, k);
    const i = arr.findIndex((x) => x.id === rid);
    if (rec === null) { if (i >= 0) arr.splice(i, 1); return; }
    if (i >= 0) arr[i] = rec; else arr.push(rec);
  };
  // clube: primeiro o estádio (alterado, ou criado junto com um clube novo), depois o clube já apontando para ele
  if (kind === 'clubs' && stadium) {
    const sid = typeof stadium.id === 'string' && stadium.id ? stadium.id : typeof record.stadium === 'string' && record.stadium ? record.stadium : uniqueIds([...allIds(w), id])(`${id}-estadio`);
    const srec = clean('stadiums', { ...stadium, id: sid, city: stadium.city ?? record.city ?? record.name }, false);
    const sBase = baseUniverse().world.stadiums.find((x) => x.id === sid);
    put('stadiums', sid, sBase ? diffRecord(stadiumRec(sBase) as Rec, srec) : srec);
    record.stadium = sid;
  }
  put(kind, id, inBase ? diffRecord(formRecord(baseUniverse().world, kind, id)!, record) : record);
  compile(next); // valida tudo antes de gravar (erro = nada muda)
  writePackDir(next, packDirOf(dataDir, packId));
  return editorGet(dataDir, packId, kind, id);
}

/** Exclui: da base vira "$remove"; criada pelo pacote some do pacote. */
export function editorRemove(dataDir: string, packId: string, kind: EditorKind, id: string): EditorSummaryDto {
  const pack = loadPack(dataDir, packId);
  const next: Pack = { manifest: pack.manifest, data: JSON.parse(JSON.stringify(pack.data)) as PackData };
  const arr = recordsOf(next, kind);
  const i = arr.findIndex((x) => x.id === id);
  if (baseHas(kind, id)) { const r = { id, $remove: true }; if (i >= 0) arr[i] = r; else arr.push(r); }
  else if (i >= 0) arr.splice(i, 1);
  else throw new ValidationError('Registro não encontrado.');
  compile(next);
  writePackDir(next, packDirOf(dataDir, packId));
  return editorSummary(dataDir, packId);
}

/** Restaura o original da base (desfaz alterações ou exclusão). */
export function editorRevert(dataDir: string, packId: string, kind: EditorKind, id: string): EditorEntityDto {
  const pack = loadPack(dataDir, packId);
  if (!baseHas(kind, id)) throw new ValidationError('Só registros da base podem ser restaurados; para os criados, use Excluir.');
  const next: Pack = { manifest: pack.manifest, data: JSON.parse(JSON.stringify(pack.data)) as PackData };
  const arr = recordsOf(next, kind);
  const i = arr.findIndex((x) => x.id === id);
  if (i >= 0) arr.splice(i, 1);
  compile(next);
  writePackDir(next, packDirOf(dataDir, packId));
  return editorGet(dataDir, packId, kind, id);
}

/** Cria um pacote vazio para editar (já entra ativo no fim da ordem de carga). */
export function editorCreatePack(dataDir: string, input: { name: string; author?: string; description?: string }): EditorSummaryDto {
  const name = input.name.trim();
  if (!name) throw new ValidationError('Dê um nome ao pacote.');
  const existing = fs.existsSync(packsDir(dataDir)) ? fs.readdirSync(packsDir(dataDir)) : [];
  const id = uniqueIds([...existing, basePack().manifest.id])(name);
  const pack: Pack = { manifest: { format: PACK_FORMAT, id, name, version: '1.0.0', ...(input.author?.trim() ? { author: input.author.trim() } : {}), ...(input.description?.trim() ? { description: input.description.trim() } : {}) }, data: { countries: [], leagues: [], stadiums: [], clubs: [], players: [], coaches: [], cups: [] } };
  writePackDir(pack, path.join(packsDir(dataDir), id));
  let order: string[] = [];
  try { order = (JSON.parse(fs.readFileSync(path.join(packsDir(dataDir), 'load-order.json'), 'utf8')) as { enabled: string[] }).enabled; } catch { /* nenhuma */ }
  setLoadOrder(dataDir, [...order, id]);
  return editorSummary(dataDir, id);
}

/** Atualiza nome, versão, autor e descrição do pacote. */
export function editorUpdateManifest(dataDir: string, packId: string, m: { name: string; version: string; author?: string; description?: string }): EditorSummaryDto {
  const pack = loadPack(dataDir, packId);
  if (!m.name.trim() || !m.version.trim()) throw new ValidationError('Nome e versão são obrigatórios.');
  const manifest = { ...pack.manifest, name: m.name.trim(), version: m.version.trim(), author: m.author?.trim() || undefined, description: m.description?.trim() || undefined };
  writePackDir({ manifest, data: pack.data }, packDirOf(dataDir, packId));
  return editorSummary(dataDir, packId);
}

const allIds = (w: World) => [...w.countries, ...w.leagues, ...w.stadiums, ...w.clubs, ...w.players, ...(w.coaches ?? []), ...(w.cups ?? [])].map((x) => x.id);
function newIdFor(w: World, kind: EditorKind, r: Rec): string {
  const gen = uniqueIds(allIds(w));
  if (kind === 'countries') return gen(String(r.code ?? r.name ?? 'pais').toLowerCase());
  if (kind === 'leagues') return gen(r.country && r.tier ? `${String(r.country)}-${String(r.tier)}` : String(r.name ?? 'liga'));
  if (kind === 'clubs') return gen(String(r.name ?? 'clube'));
  if (kind === 'coaches') return gen(`tec ${String(r.firstName ?? '')} ${String(r.lastName ?? '')}`.trim());
  if (kind === 'cups') return gen(`${r.kind === 'supercup' ? 'sup' : 'cup'}-${String(r.country ?? 'pais')}`);
  return gen(`${String(r.firstName ?? '')} ${String(r.lastName ?? '')} ${String(r.birthDate ?? '').slice(0, 4)}`.trim() || 'jogador');
}

// ---------------------------------------------------------------- planilhas (CSV)
const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
/** junta b em a (objetos aninhados: atributos, contrato, instalações) */
function deepMerge(a: Rec, b: Rec): Rec {
  const out: Rec = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k] as Rec, v) : v;
  return out;
}

/** cada campo informado em `patch` (inclusive dentro de objetos) é igual ao de `cur` */
function sameAs(cur: Rec, patch: Rec): boolean {
  return Object.entries(patch).every(([k, v]) => {
    if (k === 'id') return true;
    if (isObj(v)) return isObj(cur[k]) && sameAs(cur[k] as Rec, v);
    return JSON.stringify(cur[k] ?? null) === JSON.stringify(v ?? null);
  });
}

/**
 * Importa jogadores ou clubes de um CSV para o pacote. Tudo ou nada: com qualquer erro (de formato ou de regra), nada é gravado e
 * o relatório aponta a linha. Linha com id existente altera o registro (só as colunas preenchidas); sem id (ou com id novo), cria.
 */
export function editorImportCsv(dataDir: string, packId: string, kind: CsvKind, text: string): CsvImportReportDto {
  const { records, issues } = rowsToRecords(kind, text);
  const warnings = issues.filter((i) => i.message.startsWith('Coluna(s) não reconhecida(s)')).map((i) => `Linha ${i.line}: ${i.message}`);
  const errors = issues.filter((i) => !i.message.startsWith('Coluna(s) não reconhecida(s)')).map((i) => `Linha ${i.line}: ${i.message}`);
  if (!records.length && !errors.length) errors.push('Nenhuma linha de dados no arquivo.');
  if (errors.length) return { created: 0, updated: 0, unchanged: 0, errors, warnings };
  const pack = loadPack(dataDir, packId);
  const w = universeOf(pack);
  const next: Pack = { manifest: pack.manifest, data: JSON.parse(JSON.stringify(pack.data)) as PackData };
  const arr = recordsOf(next, kind);
  const existing = new Set((w[kind] as Array<{ id: string }>).map((x) => x.id));
  const taken = new Set(allIds(w));
  const lineOf = new Map<string, number>();
  let created = 0, updated = 0, unchanged = 0;
  const overallOf = new Map(kind === 'players' ? w.players.map((p) => [p.id, to20(p.overall)] as const) : []);
  for (const { line, record } of records) {
    // com atributos na linha, a força vem deles (a coluna Força é só informativa)
    if (kind === 'players' && record.attributes && record.ability !== undefined) delete record.ability;
    let id = typeof record.id === 'string' ? record.id : '';
    if (id && !ID_PATTERN.test(id)) { errors.push(`Linha ${line}: id "${id}" inválido (minúsculas, números e hífen).`); continue; }
    const isUpdate = !!id && existing.has(id);
    if (!id) id = uniqueIds(taken)(kind === 'clubs' ? String(record.name ?? 'clube') : `${String(record.firstName ?? '')} ${String(record.lastName ?? '')} ${String(record.birthDate ?? '').slice(0, 4)}`.trim() || 'jogador');
    else if (!isUpdate && taken.has(id)) { errors.push(`Linha ${line}: o id "${id}" já é usado por outro registro.`); continue; }
    if (lineOf.has(id)) { errors.push(`Linha ${line}: o id "${id}" aparece de novo (linha ${lineOf.get(id)}).`); continue; }
    taken.add(id); lineOf.set(id, line);
    // linha igual ao que já existe (ex.: planilha exportada e reimportada sem mudanças): nada a gravar
    if (isUpdate) {
      const cur: Rec = { ...formRecord(w, kind, id)!, ...(kind === 'players' ? { ability: overallOf.get(id) } : {}) };
      if (sameAs(cur, record)) { unchanged++; continue; }
    }
    const i = arr.findIndex((x) => x.id === id);
    const prev = i >= 0 ? arr[i]! : null;
    let rec = deepMerge(prev && !prev.$remove ? prev : { id }, { ...record, id });
    // força informada sem atributos: os atributos são regerados para ela (descarta os que o pacote tinha)
    if (kind === 'players' && record.ability !== undefined && !record.attributes) delete rec.attributes;
    rec = clean(kind, rec, !baseHas(kind, id));
    if (i >= 0) arr[i] = rec; else arr.push(rec);
    if (isUpdate) updated++; else created++;
  }
  if (errors.length) return { created: 0, updated: 0, unchanged: 0, errors, warnings };
  try { compileUniverse(EMPTY_WORLD, [basePack(), next]); } catch (e) {
    if (!(e instanceof PackError)) throw e;
    const msgs = e.issues.slice(0, 20).map((x) => (x.record && lineOf.has(x.record) ? `Linha ${lineOf.get(x.record)}: ` : '') + x.message + (x.record && !lineOf.has(x.record) ? ` (${x.record})` : ''));
    return { created: 0, updated: 0, unchanged: 0, errors: e.issues.length > 20 ? [...msgs, `… e mais ${e.issues.length - 20} problema(s).`] : msgs, warnings };
  }
  writePackDir(next, packDirOf(dataDir, packId));
  return { created, updated, unchanged, errors: [], warnings };
}

/** CSV para baixar: só o cabeçalho (modelo) ou todos os registros do universo "base + pacote" (para editar e reimportar). */
export function editorExportCsv(dataDir: string, packId: string, kind: CsvKind, template: boolean): string {
  if (template) return toCsv(csvHeader(kind), []);
  const w = universeOf(loadPack(dataDir, packId));
  const overall = new Map(w.players.map((p) => [p.id, to20(p.overall)] as const));
  const rows = (w[kind] as Array<{ id: string }>).map((x) => recordToRow(kind, { ...formRecord(w, kind, x.id)!, ...(kind === 'players' ? { ability: overall.get(x.id) } : {}) }));
  return toCsv(csvHeader(kind), rows);
}
