/**
 * Base fixa 1.1.0 (uma vez só, decisão do usuário em 07/11/2026): estados do Brasil, divisão "Sem divisão", Série D com 96 clubes e os
 * clubes dos estaduais (docs/ESTADUAIS.md). Lê a base 1.0.0, acrescenta e grava de volta com o exportador exato: os clubes, jogadores e
 * estádios existentes saem idênticos (edita os registros crus do pacote; os patches continuam valendo). Determinístico (semente própria).
 *
 *   node --disable-warning=ExperimentalWarning scripts/base-estaduais.ts
 */
import path from 'node:path';
import { baseUniverse, basePack } from '../src/services/universeService.node.ts';
import { clubRec, playerRec, stadiumRec } from '../src/game/data-pack/export.ts';
import { writePackDir } from '../src/services/packService.node.ts';
import { createRng } from '../src/game/rng.ts';
import { buildPlayer, SQUAD_TEMPLATE, startingBalance } from '../src/game/world/generator.ts';
import { COUNTRY_TEMPLATES } from '../src/game/world/names.ts';
import { ESTADUAIS } from '../src/game/format-engine/formats.ts';
import { slugify } from '../src/shared/slug.ts';
import type { Club, Player, Stadium } from '../src/shared/types.ts';

export const BASE_VERSION_ESTADUAIS = '1.1.0';

const UFS: Array<[string, string]> = [
  ['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapá'], ['AM', 'Amazonas'], ['BA', 'Bahia'], ['CE', 'Ceará'], ['DF', 'Distrito Federal'],
  ['ES', 'Espírito Santo'], ['GO', 'Goiás'], ['MA', 'Maranhão'], ['MT', 'Mato Grosso'], ['MS', 'Mato Grosso do Sul'], ['MG', 'Minas Gerais'],
  ['PA', 'Pará'], ['PB', 'Paraíba'], ['PR', 'Paraná'], ['PE', 'Pernambuco'], ['PI', 'Piauí'], ['RJ', 'Rio de Janeiro'],
  ['RN', 'Rio Grande do Norte'], ['RS', 'Rio Grande do Sul'], ['RO', 'Rondônia'], ['RR', 'Roraima'], ['SC', 'Santa Catarina'],
  ['SP', 'São Paulo'], ['SE', 'Sergipe'], ['TO', 'Tocantins'],
];
// composição real de 2026 por estado (docs/ESTADUAIS.md): Séries A, B e C (Wikipédia pt) e D (REC Série D 2026, Anexo A)
const REAL: Record<'bra-1' | 'bra-2' | 'bra-3' | 'bra-4', Record<string, number>> = {
  'bra-1': { SP: 6, RJ: 4, MG: 2, PR: 2, BA: 2, RS: 2, PA: 1, SC: 1 },
  'bra-2': { SP: 4, GO: 3, SC: 2, CE: 2, PE: 2, PR: 2, MG: 2, RS: 1, AL: 1, MT: 1 },
  'bra-3': { SP: 4, SC: 3, SE: 2, RS: 2, PE: 1, PB: 1, PA: 1, PR: 1, MA: 1, AM: 1, GO: 1, CE: 1, RJ: 1 },
  'bra-4': { AC: 3, AL: 3, AM: 3, AP: 2, BA: 4, CE: 5, DF: 4, ES: 3, GO: 5, MA: 4, MG: 5, MS: 2, MT: 5, PA: 2, PB: 3, PE: 4, PI: 4, PR: 4, RJ: 6, RN: 3, RO: 2, RR: 3, RS: 4, SC: 4, SE: 2, SP: 5, TO: 2 },
};
/** clubes de reserva por estado (fora do estadual: sobem quando alguém cai) */
const reserve = (uf: string) => (uf === 'SP' || uf === 'RJ' ? 4 : 3);
const STRONG = new Set(['SP', 'RJ', 'MG', 'RS', 'PR', 'SC']);

const PRE = ['São', 'Santa', 'Nova', 'Vila', 'Porto', 'Campo', 'Serra', 'Rio', 'Lagoa', 'Monte', 'Vale', 'Ponte', 'Barra', 'Pedra', 'Bom', 'Alto', 'Cruz', 'Fazenda', 'Morro', 'Arraial'];
const SUF = ['Verde', 'Alegre', 'Bonito', 'do Sul', 'da Mata', 'das Flores', 'dos Pinhais', 'do Norte', 'Azul', 'Dourado', 'Formoso', 'Grande', 'Real', 'Bela', 'Redonda',
  'do Oeste', 'das Pedras', 'do Campo', 'dos Ventos', 'da Serra', 'Velha', 'Nova', 'Clara', 'do Leste', 'das Palmeiras', 'do Rio', 'Escura', 'dos Anjos', 'da Luz', 'Serena'];

function bag(counts: Record<string, number>): string[] { return Object.entries(counts).flatMap(([uf, n]) => Array<string>(n).fill(uf)); }

function main() {
  const { world } = baseUniverse();
  const bra = world.countries.find((c) => c.id === 'bra')!;
  if (bra.states?.length) throw new Error('A base já tem os estados do Brasil (versão 1.1.0 ou posterior).');
  const rng = createRng('footera-base-1.1-estaduais');
  const tpl = COUNTRY_TEMPLATES.find((t) => t.code === 'BRA')!;
  bra.states = UFS.map(([code, name]) => ({ code, name }));
  const d = world.leagues.find((l) => l.id === 'bra-4')!;
  world.leagues.push({ id: 'bra-sd', countryId: 'bra', name: 'Sem divisão', tier: 5, teamCount: 0, rules: { ...d.rules, promotionSlots: 0, relegationSlots: 0 }, active: false });

  // 1. estados dos 80 clubes existentes, na proporção real de cada série (a Série D tem 96 vagas: 20 aqui, 76 clubes novos)
  const dLeft: string[] = [];
  for (const lg of ['bra-1', 'bra-2', 'bra-3', 'bra-4'] as const) {
    const tokens = rng.fork(lg).shuffle(bag(REAL[lg]));
    const clubs = world.clubs.filter((c) => c.leagueId === lg);
    clubs.forEach((c, i) => { c.state = tokens[i]!; });
    if (lg === 'bra-4') dLeft.push(...tokens.slice(clubs.length));
    else if (tokens.length !== clubs.length) throw new Error(`${lg}: ${clubs.length} clubes para ${tokens.length} vagas reais`);
  }

  // 2. clubes novos: 76 da Série D e os sem divisão que completam os estaduais (+ reserva)
  const usedIds = new Set<string>([...world.clubs.map((c) => c.id), ...world.stadiums.map((s) => s.id), ...world.players.map((p) => p.id), ...world.leagues.map((l) => l.id), ...world.countries.map((c) => c.id)]);
  const uniq = (base: string) => { let id = slugify(base) || 'x', k = 2; while (usedIds.has(id)) id = `${slugify(base)}-${k++}`; usedIds.add(id); return id; };
  const usedCities = new Set(world.clubs.filter((c) => c.countryId === 'bra').map((c) => c.city));
  const usedNames = new Set(world.clubs.map((c) => c.name));
  const crng = rng.fork('cities');
  const city = () => { for (;;) { const c = `${crng.pick(PRE)} ${crng.pick(SUF)}`; if (!usedCities.has(c)) { usedCities.add(c); return c; } } };
  const newClubs: Club[] = [], newStadiums: Stadium[] = [], newPlayers: Player[] = [];
  const create = (uf: string, league: 'bra-4' | 'bra-sd', rep: number, r: ReturnType<typeof createRng>) => {
    const c = city();
    let name = r.pick(tpl.clubPatterns).replace('{c}', c);
    while (usedNames.has(name)) name = r.pick(tpl.clubPatterns).replace('{c}', c);
    usedNames.add(name);
    const id = uniq(name);
    const stadium: Stadium = { id: uniq(`estadio-${c}`), name: `${r.pick(['Estádio Municipal', 'Estádio', 'Arena'])} ${c}`, city: c, capacity: Math.round((league === 'bra-4' ? r.int(4000, 15000) : r.int(1500, 8000)) / 100) * 100 };
    const fac = (j: number) => Math.max(1, Math.min(20, Math.round(rep / 6 + r.int(-j, j)) || 1));
    const club: Club = {
      id, name, countryId: 'bra', city: c, leagueId: league, stadiumId: stadium.id, reputation: rep, state: uf,
      shortName: name.normalize('NFD').replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w.slice(0, 3)).join('').toUpperCase().slice(0, 4) || 'CLB',
      balance: 0, fans: rep * 3500 + r.int(2000, 12000),
      facilities: { training: fac(1), youth: fac(1), medical: fac(1), stadium: fac(1) },
    };
    const squad = SQUAD_TEMPLATE.map((pos) => buildPlayer(r, (_p, hint) => uniq(hint ?? 'jogador'), tpl, id, rep, pos, world.startDate, { first: r.pick(tpl.firstNames), last: r.pick(tpl.lastNames) }));
    club.balance = startingBalance(rep, bra.economy, squad);
    newClubs.push(club); newStadiums.push(stadium); newPlayers.push(...squad);
  };
  const nrng = rng.fork('new');
  for (const uf of dLeft) create(uf, 'bra-4', nrng.int(5, 15), nrng.fork(`d:${uf}:${newClubs.length}`));
  const all = () => [...world.clubs, ...newClubs].filter((c) => c.countryId === 'bra');
  for (const [uf] of UFS) {
    const slots = ESTADUAIS.filter((e) => e.uf === uf).reduce((s, e) => s + e.format(2026).size, 0);
    const national = all().filter((c) => c.state === uf).length;
    const n = Math.max(0, slots - national) + reserve(uf);
    for (let i = 0; i < n; i++) create(uf, 'bra-sd', STRONG.has(uf) ? nrng.int(2, 8) : nrng.int(1, 6), nrng.fork(`sd:${uf}:${i}`));
  }
  world.clubs.push(...newClubs); world.stadiums.push(...newStadiums); world.players.push(...newPlayers);
  const brazil = () => world.clubs.filter((c) => c.countryId === 'bra');

  // 3. divisão do estadual: os mais fortes do estado (série nacional, depois reputação) na elite; em SP e RJ, os seguintes na A2
  const tier = new Map(world.leagues.map((l) => [l.id, l.tier]));
  for (const [uf] of UFS) {
    const ranked = brazil().filter((c) => c.state === uf).sort((a, b) => tier.get(a.leagueId)! - tier.get(b.leagueId)! || b.reputation - a.reputation || a.id.localeCompare(b.id));
    const a1 = ESTADUAIS.find((e) => e.uf === uf && e.division === 1)!.format(2026).size;
    const a2 = ESTADUAIS.find((e) => e.uf === uf && e.division === 2)?.format(2026).size ?? 0;
    ranked.forEach((c, i) => { c.stateDivision = i < a1 ? 1 : i < a1 + a2 ? 2 : null; });
  }

  // grava editando os registros crus (os demais países, clubes e jogadores ficam byte a byte iguais)
  const pack = basePack();
  const out = { manifest: { ...pack.manifest, version: BASE_VERSION_ESTADUAIS, description: 'Universo fictício padrão: 16 países; Brasil com estados, estaduais e Série D de 96 clubes. Dados fictícios.' }, data: { ...pack.data } };
  out.data.countries = pack.data.countries.map((c) => (c.id === 'bra' ? { ...c, states: bra.states } : c));
  const leagueRecord = pack.data.leagues.find((l) => l.id === 'bra-4')!;
  out.data.leagues = [...pack.data.leagues, { id: 'bra-sd', country: 'bra', name: 'Sem divisão', tier: 5, rules: { ...leagueRecord.rules, promotionSlots: 0, relegationSlots: 0 }, active: false }];
  const byId = new Map(world.clubs.map((c) => [c.id, c]));
  out.data.clubs = [...pack.data.clubs.map((r) => { const c = byId.get(r.id)!; return c.state ? { ...r, state: c.state, stateDivision: c.stateDivision ?? null } : r; }), ...newClubs.map(clubRec)];
  out.data.stadiums = [...pack.data.stadiums, ...newStadiums.map(stadiumRec)];
  out.data.players = [...pack.data.players, ...newPlayers.map((p) => playerRec(p))];
  writePackDir(out, path.join('data', 'base'));
  console.log(`Base ${BASE_VERSION_ESTADUAIS}: +${newClubs.length} clubes (${newClubs.filter((c) => c.leagueId === 'bra-4').length} da Série D), +${newPlayers.length} jogadores; Brasil com ${brazil().length} clubes.`);
}

main();
