/**
 * Base fixa 1.2.0 (uma vez só; decisão do usuário em 08/11/2026, docs/CONTINENTAIS.md): os 8 países da CONMEBOL que faltavam no
 * universo — Uruguai, Colômbia, Equador, Paraguai, Chile, Peru, Bolívia e Venezuela — como países **simplificados** (só a 1ª divisão,
 * com o tamanho real de 2026, sem acesso nem rebaixamento, temporada em ano civil). Clubes, cidades, estádios e jogadores fictícios,
 * gerados como o resto da base. Lê a base 1.1.0, acrescenta e grava de volta com o exportador exato: o que já existia sai idêntico.
 * Determinístico (semente própria).
 *
 *   node --disable-warning=ExperimentalWarning scripts/base-conmebol.ts
 */
import path from 'node:path';
import { baseUniverse, basePack } from '../src/services/universeService.node.ts';
import { clubRec, playerRec, stadiumRec } from '../src/game/data-pack/export.ts';
import { writePackDir } from '../src/services/packService.node.ts';
import { clamp, createRng } from '../src/game/rng.ts';
import { buildPlayer, SQUAD_TEMPLATE, startingBalance } from '../src/game/world/generator.ts';
import { STADIUM_SUFFIX } from '../src/game/world/names.ts';
import { CONMEBOL_TEMPLATES } from '../src/game/world/conmebolTemplates.ts';
import { slugify } from '../src/shared/slug.ts';
import type { Club, Player, Stadium } from '../src/shared/types.ts';

export const BASE_VERSION_CONMEBOL = '1.2.0';

function main() {
  const { world } = baseUniverse();
  if (world.countries.some((c) => CONMEBOL_TEMPLATES.some((t) => t.code === c.code))) throw new Error('A base já tem os países da CONMEBOL (versão 1.2.0 ou posterior).');
  const rng = createRng('footera-base-1.2-conmebol');
  const usedIds = new Set<string>([...world.clubs.map((c) => c.id), ...world.stadiums.map((s) => s.id), ...world.players.map((p) => p.id), ...world.leagues.map((l) => l.id), ...world.countries.map((c) => c.id)]);
  const uniq = (base: string) => { const b = slugify(base) || 'x'; let id = b, k = 2; while (usedIds.has(id)) id = `${b}-${k++}`; usedIds.add(id); return id; };
  const pack = basePack();
  const ref = pack.data.leagues.find((l) => l.id === 'arg-1')!;
  const countries: Array<Record<string, unknown>> = [], leagues: Array<Record<string, unknown>> = [];
  const newClubs: Club[] = [], newStadiums: Stadium[] = [], newPlayers: Player[] = [];

  for (const tpl of CONMEBOL_TEMPLATES) {
    const crng = rng.fork(`country:${tpl.code}`);
    const cid = tpl.code.toLowerCase();
    if (usedIds.has(cid)) throw new Error(`id de país já usado: ${cid}`);
    usedIds.add(cid);
    countries.push({ id: cid, code: tpl.code, name: tpl.name, economy: tpl.wageScale, seasonStart: '01-01' });
    const usedNames = new Set<string>();
    for (const lt of tpl.leagues) {
      const lid = `${cid}-${lt.tier}`;
      usedIds.add(lid);
      leagues.push({ id: lid, country: cid, name: lt.name, tier: lt.tier,
        rules: { ...ref.rules, promotionSlots: lt.promotion, relegationSlots: lt.relegation, continentalSlots: lt.continental, maxForeignPlayers: lt.foreignLimit } });
      for (let i = 0; i < lt.teams; i++) {
        const r = crng.fork(`league:${lt.tier}:club:${i}`);
        let name = '', city = '';
        for (let tries = 0; tries < 200 && !name; tries++) {
          city = r.pick(tpl.cities);
          const n = r.pick(tpl.clubPatterns).replace('{c}', city);
          if (!usedNames.has(n)) name = n;
        }
        if (!name) throw new Error(`${tpl.code}: nomes de clube insuficientes`);
        usedNames.add(name);
        // mesma régua do gerador: reputação cai com a posição na liga e com a força do país
        const reputation = clamp(Math.round(78 + (tpl.strength ?? 0) - (i / Math.max(lt.teams - 1, 1)) * 24 + r.normal(0, 3)), 5, 99);
        const stadium: Stadium = { id: '', city, name: `${r.pick(tpl.stadiumNames ?? STADIUM_SUFFIX)} ${city}`, capacity: Math.round((6000 + reputation * 650 + r.int(0, 4000)) / 100) * 100 };
        stadium.id = uniq(`estadio-${stadium.name}`);
        const club: Club = {
          id: uniq(name), name, countryId: cid, city, leagueId: lid, stadiumId: stadium.id, reputation,
          shortName: name.normalize('NFD').replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w.slice(0, 3)).join('').toUpperCase().slice(0, 4) || 'CLB',
          balance: 0, fans: reputation * 3500 + r.int(0, 20000),
          facilities: {
            training: clamp(Math.round(reputation / 6 + r.int(-2, 2)), 1, 20), youth: clamp(Math.round(reputation / 6 + r.int(-3, 3)), 1, 20),
            medical: clamp(Math.round(reputation / 6 + r.int(-2, 2)), 1, 20), stadium: clamp(Math.round(reputation / 6 + r.int(-2, 2)), 1, 20),
          },
        };
        const prng = r.fork('squad'), taken = new Set<string>();
        const squad = SQUAD_TEMPLATE.map((pos) => {
          let first = prng.pick(tpl.firstNames), last = prng.pick(tpl.lastNames);
          for (let t = 0; t < 50 && taken.has(`${first} ${last}`); t++) { first = prng.pick(tpl.firstNames); last = prng.pick(tpl.lastNames); }
          taken.add(`${first} ${last}`);
          return buildPlayer(prng, (_p, hint) => uniq(hint ?? 'jogador'), tpl, club.id, reputation, pos, world.startDate, { first, last });
        });
        club.balance = startingBalance(reputation, tpl.wageScale, squad);
        newClubs.push(club); newStadiums.push(stadium); newPlayers.push(...squad);
      }
    }
  }

  const out = {
    manifest: { ...pack.manifest, version: BASE_VERSION_CONMEBOL, description: 'Universo fictício padrão: 24 países (16 completos ou por divisão + 8 da CONMEBOL simplificados); Brasil com estados, estaduais e Série D de 96 clubes. Dados fictícios.' },
    data: { ...pack.data,
      countries: [...pack.data.countries, ...countries], leagues: [...pack.data.leagues, ...leagues],
      clubs: [...pack.data.clubs, ...newClubs.map(clubRec)], stadiums: [...pack.data.stadiums, ...newStadiums.map(stadiumRec)],
      players: [...pack.data.players, ...newPlayers.map((p) => playerRec(p))] },
  };
  writePackDir(out as typeof pack, path.join('data', 'base'));
  console.log(`Base ${BASE_VERSION_CONMEBOL}: +${countries.length} países, +${leagues.length} ligas, +${newClubs.length} clubes, +${newPlayers.length} jogadores.`);
}

main();
