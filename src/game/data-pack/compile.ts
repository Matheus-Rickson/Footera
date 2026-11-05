/**
 * Montagem do universo: base (gerada pela semente) + pacotes de dados na ordem de carga → `World` validado.
 * Puro e determinístico (mesma base + mesmos pacotes = mesmo universo). Não grava nada: a carreira nova copia o resultado.
 */
import { createRng, clamp, type Rng } from '../rng.ts';
import { addYears, ageOn } from '../../shared/date.ts';
import { isPlausibleSecondary } from '../../shared/positions.ts';
import { uniqueIds } from '../../shared/slug.ts';
import type { Attributes, Club, Country, League, LeagueRules, Player, Position, Stadium, World } from '../../shared/types.ts';
import { COUNTRY_TEMPLATES, type CountryTemplate } from '../world/names.ts';
import { overallFor } from '../world/overall.ts';
import { ATTR_KEYS, ageAbilityDelta, buildPlayer, genAttributes, marketValue, SQUAD_TEMPLATE } from '../world/generator.ts';
import { PackError, type ClubRec, type CountryRec, type LeagueRec, type Pack, type PackIssue, type PlayerRec, type StadiumRec } from './format.ts';

export const DEFAULT_RULES: LeagueRules = {
  rounds: 2, pointsWin: 3, pointsDraw: 1, tiebreakers: ['points', 'wins', 'goalDiff', 'goalsFor', 'headToHead'],
  promotionSlots: 0, relegationSlots: 0, continentalSlots: 0, maxForeignPlayers: null, squadMin: 18, squadMax: 30,
};
/** Elenco mínimo depois da montagem: clubes com menos jogadores (ou menos de 2 goleiros) são completados com jogadores gerados. */
const FILL_GOALKEEPERS = 2;
const fillTarget = (rules: LeagueRules) => rules.squadMin + 2;

export interface CompileResult { world: World; warnings: PackIssue[]; /** pacotes aplicados, na ordem (id@versão) */ applied: string[] }

/** Atributos com a forma da posição e força (overall) o mais perto possível de `ability` (1–20, escala da tela). */
export function attributesForAbility(rng: Rng, pos: Position, ability: number): Attributes {
  const base = genAttributes(rng, pos, 10);
  const target = ability * 5;
  const shift = (d: number): Attributes => {
    const mv = <T extends object>(g: T): T => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, clamp(Math.round((v as number) + d), 1, 20)])) as T;
    return { technical: mv(base.technical), mental: mv(base.mental), physical: mv(base.physical) };
  };
  let best = base, bestErr = Infinity;
  for (let d = -12; d <= 12; d += 0.25) { // somar d a todos os atributos sobe a força de forma monotônica
    const a = shift(d), err = Math.abs(overallFor(a, pos) - target);
    if (err < bestErr) { best = a; bestErr = err; }
  }
  return best;
}

const ATTR_COUNT = ATTR_KEYS.technical.length + ATTR_KEYS.mental.length + ATTR_KEYS.physical.length;
function mergeAttributes(cur: Attributes | null, patch: NonNullable<PlayerRec['attributes']>): Attributes | null {
  const out = {
    technical: { ...(cur?.technical ?? {}), ...(patch.technical ?? {}) },
    mental: { ...(cur?.mental ?? {}), ...(patch.mental ?? {}) },
    physical: { ...(cur?.physical ?? {}), ...(patch.physical ?? {}) },
  };
  const n = Object.keys(out.technical).length + Object.keys(out.mental).length + Object.keys(out.physical).length;
  return n === ATTR_COUNT ? (out as unknown as Attributes) : null;
}
const missingAttributes = (patch: NonNullable<PlayerRec['attributes']>) =>
  (['technical', 'mental', 'physical'] as const).flatMap((g) => ATTR_KEYS[g].filter((k) => (patch[g] as Record<string, unknown> | undefined)?.[k] === undefined));

export function compileUniverse(base: World, packs: Pack[]): CompileResult {
  const issues: PackIssue[] = [];
  const warnings: PackIssue[] = [];
  const startDate = base.startDate, seed = base.seed;
  const fresh = packs[0]?.manifest.base === 'none';
  const countries = new Map<string, Country>(fresh ? [] : base.countries.map((c) => [c.id, { ...c }]));
  const leagues = new Map<string, League>(fresh ? [] : base.leagues.map((l) => [l.id, { ...l, rules: { ...l.rules } }]));
  const stadiums = new Map<string, Stadium>(fresh ? [] : base.stadiums.map((s) => [s.id, { ...s }]));
  const clubs = new Map<string, Club>(fresh ? [] : base.clubs.map((c) => [c.id, { ...c, facilities: { ...c.facilities } }]));
  const players = new Map<string, Player>(fresh ? [] : base.players.map((p) => [p.id, { ...p }]));
  const typeOf = new Map<string, string>();
  for (const [kind, m] of [['país', countries], ['liga', leagues], ['estádio', stadiums], ['clube', clubs], ['jogador', players]] as const) for (const k of m.keys()) typeOf.set(k, kind);
  const economyOf = (code: string) => [...countries.values()].find((c) => c.code === code)?.economy ?? 1;
  const tplOf = (code: string): CountryTemplate => COUNTRY_TEMPLATES.find((t) => t.code === code) ?? COUNTRY_TEMPLATES[0]!;

  packs.forEach((pack, idx) => {
    const P = pack.manifest.id;
    const err = (file: string, record: string | undefined, message: string) => issues.push({ pack: P, file, record, message });
    if (pack.manifest.base === 'none' && idx > 0) err('manifest.json', undefined, 'base de dados completa ("base": "none") precisa ser o primeiro pacote da ordem de carga');
    for (const r of pack.manifest.requires ?? []) if (!packs.slice(0, idx).some((q) => q.manifest.id === r)) err('manifest.json', undefined, `precisa do pacote "${r}" antes dele na ordem de carga`);
    if (packs.slice(0, idx).some((q) => q.manifest.id === P)) err('manifest.json', undefined, 'pacote repetido na ordem de carga');
    /** id novo: não pode estar em uso por outro tipo de entidade */
    const claim = (file: string, id: string, kind: string) => {
      const t = typeOf.get(id);
      if (t && t !== kind) { err(file, id, `id já usado por um(a) ${t}`); return false; }
      typeOf.set(id, kind); return true;
    };
    const need = (file: string, id: string, rec: object, keys: string[]) => {
      const miss = keys.filter((k) => (rec as Record<string, unknown>)[k] === undefined);
      if (miss.length) err(file, id, `id não existe no universo; para criar, faltam os campos: ${miss.join(', ')} (clubes e jogadores da base gerada dependem da semente)`);
      return miss.length === 0;
    };

    for (const r of pack.data.countries) apply('countries.json', r, countries, 'país', (c: CountryRec) => {
      if (!need('countries.json', c.id, c, ['code', 'name'])) return null;
      return { id: c.id, code: c.code!, name: c.name!, economy: c.economy ?? 1 };
    }, (cur, c) => { if (c.code) cur.code = c.code; if (c.name) cur.name = c.name; if (c.economy !== undefined) cur.economy = c.economy; });

    for (const r of pack.data.leagues) apply('leagues.json', r, leagues, 'liga', (l: LeagueRec) => {
      if (!need('leagues.json', l.id, l, ['country', 'name', 'tier'])) return null;
      return { id: l.id, countryId: l.country!, name: l.name!, tier: l.tier!, teamCount: 0, rules: { ...DEFAULT_RULES, ...l.rules } as LeagueRules };
    }, (cur, l) => { if (l.country) cur.countryId = l.country; if (l.name) cur.name = l.name; if (l.tier) cur.tier = l.tier; if (l.rules) cur.rules = { ...cur.rules, ...l.rules } as LeagueRules; });

    for (const r of pack.data.stadiums) apply('stadiums.json', r, stadiums, 'estádio', (s: StadiumRec) => {
      if (!need('stadiums.json', s.id, s, ['name'])) return null;
      return { id: s.id, name: s.name!, city: s.city ?? s.name!, capacity: s.capacity ?? 20_000 };
    }, (cur, s) => { if (s.name) cur.name = s.name; if (s.city) cur.city = s.city; if (s.capacity) cur.capacity = s.capacity; });

    for (const r of pack.data.clubs) {
      if (r.$remove && clubs.has(r.id)) {
        const freed = [...players.values()].filter((p) => p.clubId === r.id);
        for (const p of freed) p.clubId = null;
        if (freed.length) warnings.push({ pack: P, file: 'clubs.json', record: r.id, message: `clube removido: ${freed.length} jogador(es) ficaram sem clube` });
      }
      apply('clubs.json', r, clubs, 'clube', (c: ClubRec) => {
        if (!need('clubs.json', c.id, c, ['name', 'country', 'league'])) return null;
        const rng = createRng(`pack-club:${seed}:${c.id}`);
        const reputation = c.reputation ?? 50, city = c.city ?? c.name!;
        let stadiumId = c.stadium;
        if (!stadiumId) {
          stadiumId = uniqueIds(typeOf.keys())(`${c.id}-estadio`);
          typeOf.set(stadiumId, 'estádio');
          stadiums.set(stadiumId, { id: stadiumId, name: `Estádio ${city}`, city, capacity: Math.round((6000 + reputation * 650) / 100) * 100 });
        }
        const fac = (j: number) => clamp(Math.round(reputation / 6 + rng.int(-j, j)), 1, 20);
        const economy = countries.get(c.country!)?.economy ?? 1;
        return {
          id: c.id, name: c.name!, countryId: c.country!, leagueId: c.league!, stadiumId, city, reputation,
          shortName: c.shortName ?? (c.name!.normalize('NFD').replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w.slice(0, 3)).join('').toUpperCase().slice(0, 4) || 'CLB'),
          balance: c.balance ?? Math.round((reputation * 180_000 * economy) / 1000) * 1000,
          fans: c.fans ?? reputation * 3500 + rng.int(0, 20_000),
          facilities: { training: fac(2), youth: fac(3), medical: fac(2), stadium: fac(2), ...c.facilities },
        };
      }, (cur, c) => {
        if (c.name) cur.name = c.name; if (c.shortName) cur.shortName = c.shortName; if (c.country) cur.countryId = c.country; if (c.league) cur.leagueId = c.league;
        if (c.city) cur.city = c.city; if (c.stadium) cur.stadiumId = c.stadium; if (c.reputation !== undefined) cur.reputation = c.reputation;
        if (c.balance !== undefined) cur.balance = c.balance; if (c.fans !== undefined) cur.fans = c.fans; if (c.facilities) cur.facilities = { ...cur.facilities, ...c.facilities };
      });
    }

    for (const r of pack.data.players) apply('players.json', r, players, 'jogador', (p: PlayerRec) => {
      if (!need('players.json', p.id, p, ['firstName', 'lastName', 'birthDate', 'nationality', 'position', 'club'])) return null;
      const rng = createRng(`pack-player:${seed}:${p.id}`);
      let attributes: Attributes | null = null;
      if (p.ability !== undefined) attributes = mergeAttributes(attributesForAbility(rng, p.position!, p.ability), p.attributes ?? {});
      else if (p.attributes) attributes = mergeAttributes(null, p.attributes);
      if (!attributes) { err('players.json', p.id, p.attributes ? `faltam atributos: ${missingAttributes(p.attributes).join(', ')} (ou informe "ability")` : 'informe "attributes" (os 23) ou "ability" (força 1–20)'); return null; }
      const tpl = tplOf(p.nationality!);
      const gen = buildPlayer(rng, () => p.id, tpl, p.club ?? '', 50, p.position!, startDate, { first: p.firstName!, last: p.lastName! });
      const player: Player = {
        ...gen, id: p.id, clubId: p.club ?? null, firstName: p.firstName!, lastName: p.lastName!, birthDate: p.birthDate!, nationality: p.nationality!,
        extraNationalities: p.extraNationalities ?? [], position: p.position!, secondaryPositions: p.secondaryPositions ?? gen.secondaryPositions,
        foot: p.foot ?? gen.foot, heightCm: p.heightCm ?? gen.heightCm, weightKg: p.weightKg ?? gen.weightKg, attributes,
        personality: { ...gen.personality, ...p.personality },
      };
      finishPlayer(player, p, true);
      return player;
    }, (cur, p) => {
      const rng = createRng(`pack-player:${seed}:${cur.id}:${P}`);
      if (p.firstName) cur.firstName = p.firstName; if (p.lastName) cur.lastName = p.lastName; if (p.birthDate) cur.birthDate = p.birthDate;
      if (p.nationality) cur.nationality = p.nationality; if (p.extraNationalities) cur.extraNationalities = p.extraNationalities;
      if (p.club !== undefined) cur.clubId = p.club; if (p.position) cur.position = p.position; if (p.secondaryPositions) cur.secondaryPositions = p.secondaryPositions;
      if (p.foot) cur.foot = p.foot; if (p.heightCm) cur.heightCm = p.heightCm; if (p.weightKg) cur.weightKg = p.weightKg;
      if (p.personality) cur.personality = { ...cur.personality, ...p.personality };
      if (p.ability !== undefined) cur.attributes = mergeAttributes(attributesForAbility(rng, cur.position, p.ability), p.attributes ?? {})!;
      else if (p.attributes) cur.attributes = mergeAttributes(cur.attributes, p.attributes)!;
      finishPlayer(cur, p, false);
    });

    /** cria, altera ou remove um registro (remoção de quem não existe é só aviso) */
    function apply<T extends { id: string }, R extends { id: string; $remove?: true }>(file: string, rec: R, map: Map<string, T>, kind: string, create: (r: R) => T | null, patch: (cur: T, r: R) => void) {
      if (rec.$remove) {
        if (!map.delete(rec.id)) warnings.push({ pack: P, file, record: rec.id, message: 'remoção ignorada: id não existe' });
        else typeOf.delete(rec.id);
        return;
      }
      const cur = map.get(rec.id);
      if (cur) { patch(cur, rec); return; }
      if (!claim(file, rec.id, kind)) return;
      const made = create(rec);
      if (made) map.set(rec.id, made); else typeOf.delete(rec.id);
    }
  });

  /** valores derivados do jogador depois de criar/alterar (força, potencial, valor, contrato) */
  function finishPlayer(pl: Player, rec: PlayerRec, created: boolean) {
    const rng = createRng(`pack-finish:${seed}:${pl.id}`);
    pl.overall = overallFor(pl.attributes, pl.position);
    const age = ageOn(pl.birthDate, startDate);
    if (rec.internal?.potentialHidden !== undefined) pl.potentialHidden = rec.internal.potentialHidden;
    else if (rec.potential !== undefined) pl.potentialHidden = rec.potential * 5;
    else if (created) pl.potentialHidden = pl.overall + (age <= 25 ? Math.round(-ageAbilityDelta(age) * 5 * rng.float(0.75, 1.3)) : 0);
    pl.potentialHidden = clamp(Math.max(pl.potentialHidden, pl.overall), 1, 100);
    if (rec.internal?.potentialEstimated !== undefined) pl.potentialEstimated = rec.internal.potentialEstimated;
    else if (created || rec.potential !== undefined || rec.ability !== undefined || rec.attributes) pl.potentialEstimated = clamp(Math.round(pl.potentialHidden + rng.normal(0, 4)), pl.overall, 100);
    for (const k of ['condition', 'fatigue', 'morale', 'form'] as const) if (rec.internal?.[k] !== undefined) pl[k] = rec.internal[k]!;
    if (rec.marketValue !== undefined) pl.marketValue = rec.marketValue;
    else if (created || rec.ability !== undefined || rec.attributes || rec.potential !== undefined || rec.birthDate) pl.marketValue = marketValue(pl.overall, age, pl.potentialHidden, economyOf(pl.nationality));
    if (rec.contract?.salary !== undefined) pl.salary = rec.contract.salary;
    else if (created) pl.salary = Math.max(Math.round((pl.marketValue * 0.012) / 100) * 100, 1500);
    if (rec.contract?.end !== undefined) pl.contractEnd = rec.contract.end;
    else if (created) pl.contractEnd = addYears(startDate, 1 + (Math.abs(hash(pl.id)) % 4));
  }

  // ---------------------------------------------------------------- validação final (referências e regras do jogo)
  const final = (file: string, record: string, message: string) => issues.push({ pack: 'universo', file, record, message });
  const codes = new Map<string, string>();
  for (const c of countries.values()) { if (codes.has(c.code)) final('countries.json', c.id, `código ${c.code} repetido (também em ${codes.get(c.code)})`); codes.set(c.code, c.id); }
  for (const l of leagues.values()) if (!countries.has(l.countryId)) final('leagues.json', l.id, `país "${l.countryId}" não existe`);
  for (const c of clubs.values()) {
    if (!countries.has(c.countryId)) final('clubs.json', c.id, `país "${c.countryId}" não existe`);
    const lg = leagues.get(c.leagueId);
    if (!lg) final('clubs.json', c.id, `liga "${c.leagueId}" não existe`);
    else if (lg.countryId !== c.countryId) final('clubs.json', c.id, `a liga "${lg.id}" é de outro país`);
    if (!stadiums.has(c.stadiumId)) final('clubs.json', c.id, `estádio "${c.stadiumId}" não existe`);
  }
  for (const p of players.values()) {
    if (p.clubId !== null && !clubs.has(p.clubId)) final('players.json', p.id, `clube "${p.clubId}" não existe`);
    const age = ageOn(p.birthDate, startDate);
    if (age < 15 || age > 45) final('players.json', p.id, `idade ${age} na data de início (${startDate}): use 15 a 45 anos`);
    const odd = p.secondaryPositions.filter((s) => !isPlausibleSecondary(p.position, s));
    if (odd.length) warnings.push({ pack: 'universo', file: 'players.json', record: p.id, message: `posição secundária pouco comum para ${p.position}: ${odd.join(', ')}` });
  }
  const byCountry = new Map<string, League[]>();
  for (const l of leagues.values()) byCountry.set(l.countryId, [...(byCountry.get(l.countryId) ?? []), l]);
  for (const [cid, ls] of byCountry) {
    const tiers = ls.map((l) => l.tier).sort((a, b) => a - b);
    if (tiers.some((t, i) => t !== i + 1)) final('leagues.json', cid, `divisões do país devem ser 1, 2, 3… sem pular nem repetir (tem ${tiers.join(', ')})`);
    for (const l of ls) {
      const below = ls.find((x) => x.tier === l.tier + 1);
      if (below && below.rules.promotionSlots !== l.rules.relegationSlots) final('leagues.json', l.id, `rebaixa ${l.rules.relegationSlots}, mas "${below.id}" sobe ${below.rules.promotionSlots}`);
    }
  }
  if (issues.length) throw new PackError(issues);

  // ---------------------------------------------------------------- elencos: completa clubes curtos com jogadores gerados
  const newId = uniqueIds(typeOf.keys());
  const squadOf = new Map<string, Player[]>();
  for (const p of players.values()) if (p.clubId) squadOf.set(p.clubId, [...(squadOf.get(p.clubId) ?? []), p]);
  for (const c of clubs.values()) {
    const rules = leagues.get(c.leagueId)!.rules;
    const squad = squadOf.get(c.id) ?? [];
    const country = countries.get(c.countryId)!;
    const tpl = tplOf(country.code), rng = createRng(`pack-fill:${seed}:${c.id}`);
    let added = 0;
    const need = () => squad.length < fillTarget(rules) || squad.filter((p) => p.position === 'GK').length < FILL_GOALKEEPERS;
    for (let i = 0; need() && i < 60; i++) {
      const gks = squad.filter((p) => p.position === 'GK').length;
      const pos: Position = gks < FILL_GOALKEEPERS ? 'GK' : SQUAD_TEMPLATE.find((x) => squad.filter((p) => p.position === x).length < SQUAD_TEMPLATE.filter((y) => y === x).length) ?? 'CM';
      const name = { first: rng.pick(tpl.firstNames), last: rng.pick(tpl.lastNames) };
      const p = buildPlayer(rng, (_pre, hint) => newId(hint ?? 'jogador'), tpl, c.id, c.reputation, pos, startDate, name);
      p.nationality = country.code;
      players.set(p.id, p); squad.push(p); added++;
    }
    if (added) warnings.push({ pack: 'universo', file: 'clubs.json', record: c.id, message: `elenco completado com ${added} jogador(es) gerado(s)` });
    if (squad.length > rules.squadMax) issues.push({ pack: 'universo', file: 'players.json', record: c.id, message: `elenco com ${squad.length} jogadores (máximo ${rules.squadMax})` });
  }
  for (const l of leagues.values()) {
    l.teamCount = [...clubs.values()].filter((c) => c.leagueId === l.id).length;
    if (l.teamCount < 2) issues.push({ pack: 'universo', file: 'leagues.json', record: l.id, message: `liga com ${l.teamCount} clube(s): são necessários pelo menos 2` });
  }
  if (clubs.size === 0) issues.push({ pack: 'universo', file: 'clubs.json', message: 'o universo não tem nenhum clube' });
  if (issues.length) throw new PackError(issues);

  // estádios órfãos (de clubes removidos) saem do universo sem erro
  const usedStadiums = new Set([...clubs.values()].map((c) => c.stadiumId));
  return {
    world: { seed, startDate, countries: [...countries.values()], leagues: [...leagues.values()], stadiums: [...stadiums.values()].filter((s) => usedStadiums.has(s.id)), clubs: [...clubs.values()], players: [...players.values()] },
    warnings,
    applied: packs.map((p) => `${p.manifest.id}@${p.manifest.version}`),
  };
}

function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
