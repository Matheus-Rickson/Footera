import { createRng, clamp, type Rng } from '../rng.ts';
import { COUNTRY_TEMPLATES, STADIUM_SUFFIX, type CountryTemplate } from './names.ts';
import { overallFor } from './overall.ts';
import { addDays, addYears } from '../../shared/date.ts';
import { SECONDARY_OPTIONS } from '../../shared/positions.ts';
import { uniqueIds } from '../../shared/slug.ts';
import type {
  Attributes, Club, Country, Foot, League, Player, Position, Stadium, World, IsoDate,
} from '../../shared/types.ts';
import { deriveGoalkeeper } from './goalkeeper.ts';
import { defaultCoaches } from '../coach-engine/worldCoaches.ts';
import { defaultCups } from '../cup-engine/catalog.ts';

export interface WorldOptions {
  seed: string;
  startDate?: IsoDate;
  /** Reduz o universo (útil em testes). */
  teamsPerLeagueOverride?: number;
  /** países gerados (códigos); padrão: Brasil e Inglaterra (universo dos testes e calibrações). A base fixa usa todos. */
  countries?: string[] | 'all';
  /** última divisão gerada; padrão 2 (universo dos testes). A base fixa usa todas as divisões de cada país. */
  maxTier?: number;
}

/** Universo de teste/calibração: o mesmo de antes da base fixa (Brasil e Inglaterra, duas divisões). */
export const TEST_COUNTRIES = ['BRA', 'ENG'];

/** 25 jogadores por elenco: composição fixa e coerente. */
export const SQUAD_TEMPLATE: Position[] = [
  'GK','GK','GK','CB','CB','CB','CB','LB','LWB','RB','RWB','DM','DM','CM','CM','CM','AM','AM','LW','LM','RW','RM','CF','CF','SS',
];

const POS_BIAS: Record<Position, Partial<Record<string, number>>> = {
  GK: { goalkeeping: 6, positioning: 2, agility: 2, jumping: 1, finishing: -16, dribbling: -12, passing: -8, crossing: -12, longShots: -12, firstTouch: -8, heading: -6, pace: -6, tackling: -8, marking: -8 },
  CB: { marking: 3, tackling: 3, heading: 3, strength: 3, jumping: 2, positioning: 2, finishing: -5, dribbling: -3, crossing: -3, pace: -1, goalkeeping: -12 },
  LB: { tackling: 2, pace: 2, stamina: 2, crossing: 2, finishing: -4, heading: -2, goalkeeping: -12 },
  RB: { tackling: 2, pace: 2, stamina: 2, crossing: 2, finishing: -4, heading: -2, goalkeeping: -12 },
  LWB: { stamina: 3, pace: 3, crossing: 2, marking: 2, workRate: 2, finishing: -4, heading: -2, goalkeeping: -12 },
  RWB: { stamina: 3, pace: 3, crossing: 2, positioning: 2, tackling: 2, finishing: -4, heading: -2, goalkeeping: -12 },
  DM: { tackling: 3, marking: 2, positioning: 2, stamina: 2, workRate: 2, finishing: -3, goalkeeping: -12 },
  CM: { passing: 3, vision: 2, stamina: 2, decisions: 2, workRate: 1, goalkeeping: -12 },
  LM: { passing: 2, vision: 2, crossing: 3, firstTouch: 2, stamina: 2, tackling: -2, heading: -2, goalkeeping: -12 },
  RM: { pace: 2, passing: 2, crossing: 3, dribbling: 2, workRate: 1, tackling: -2, heading: -2, goalkeeping: -12 },
  AM: { passing: 3, vision: 3, dribbling: 3, firstTouch: 2, longShots: 2, tackling: -3, marking: -3, goalkeeping: -12 },
  LW: { dribbling: 3, pace: 4, crossing: 3, agility: 2, tackling: -4, marking: -4, heading: -2, goalkeeping: -12 },
  RW: { dribbling: 3, pace: 4, crossing: 3, agility: 2, tackling: -4, marking: -4, heading: -2, goalkeeping: -12 },
  SS: { finishing: 3, firstTouch: 2, passing: 2, dribbling: 2, vision: 2, composure: 1, tackling: -5, marking: -5, goalkeeping: -12 },
  CF: { finishing: 4, composure: 2, positioning: 3, heading: 2, strength: 2, firstTouch: 1, tackling: -5, marking: -5, goalkeeping: -12 },
  ST: { finishing: 4, composure: 2, positioning: 2, firstTouch: 2, heading: 1, pace: 1, tackling: -5, marking: -5, goalkeeping: -12 },
};

export const ATTR_KEYS = {
  technical: ['finishing','passing','dribbling','tackling','marking','firstTouch','crossing','heading','longShots','goalkeeping'],
  mental: ['vision','composure','decisions','positioning','workRate','leadership','aggression'],
  physical: ['pace','stamina','strength','agility','jumping','naturalFitness'],
} as const;

/**
 * IDs legíveis e fixos por semente (base de dados editável), únicos no universo inteiro (um patch se refere a qualquer
 * entidade só pelo ID). Jogador: `nome-sobrenome-ano`; clube e estádio: o nome; país (`bra`) e liga (`bra-1`) vêm prontos.
 */
function makeIdFactory() {
  const gen = uniqueIds();
  return (prefix: string, hint?: string): string => gen(hint ?? prefix);
}

export function genAttributes(rng: Rng, pos: Position, ability: number): Attributes {
  const bias = POS_BIAS[pos];
  const make = <K extends string>(keys: readonly K[]): Record<K, number> => {
    const out = {} as Record<K, number>;
    for (const k of keys) {
      const raw = ability + (bias[k] ?? 0) * 0.5 + rng.normal(0, 1.6);
      out[k] = clamp(Math.round(raw), 1, 20);
    }
    return out;
  };
  const technical = make(ATTR_KEYS.technical);
  const mental = make(ATTR_KEYS.mental), physical = make(ATTR_KEYS.physical);
  // grupo de goleiro derivado do "goalkeeping" sorteado (a força não muda); a variação sai dos próprios atributos, sem consumir a sequência
  return { technical, mental, physical, goalkeeper: deriveGoalkeeper(technical.goalkeeping, ((technical.finishing + mental.vision + physical.pace) % 3) - 1) };
}

/** Ajuste (em pontos de atributo, escala 1..20) da habilidade atual conforme a idade. Jovens ainda não atingiram o auge. */
export function ageAbilityDelta(age: number): number {
  if (age < 17) return -3.2 - 0.5 * (17 - age);
  if (age <= 24) return -[3.2, 2.7, 2.2, 1.7, 1.2, 0.8, 0.45, 0.2][age - 17]! ;
  if (age <= 29) return 0;
  if (age >= 35) return -2.4;
  return -({ 30: 0.2, 31: 0.5, 32: 0.9, 33: 1.3, 34: 1.8 } as Record<number, number>)[age]!;
}

/**
 * Caixa inicial: parte fixa pela reputação e pela economia do país + 22% do valor do elenco. Sem a segunda parcela, os grandes clubes
 * começavam com caixa menor que o preço do próprio melhor jogador (ex.: 8,7 mi com elenco de 114 mi) e não conseguiam contratar.
 */
export const BALANCE_SQUAD_SHARE = 0.22;
export function startingBalance(reputation: number, economy: number, squad: ReadonlyArray<{ marketValue: number }>): number {
  const value = squad.reduce((s, p) => s + p.marketValue, 0);
  return Math.round((reputation * 180_000 * economy + BALANCE_SQUAD_SHARE * value) / 1000) * 1000;
}

export function marketValue(overall: number, age: number, potential: number, scale: number): number {
  const base = Math.pow(Math.max(overall - 30, 1) / 10, 3.2) * 90_000 * scale;
  const ageFactor = age <= 21 ? 1.5 : age <= 25 ? 1.25 : age <= 29 ? 1 : age <= 32 ? 0.6 : 0.3;
  const potFactor = 1 + Math.max(potential - overall, 0) / 60;
  return Math.round((base * ageFactor * potFactor) / 1000) * 1000;
}

export interface BuildOptions {
  /** Idade fixa (ex.: 16 para jovens da base); sem ela a idade segue a distribuição do universo (17..38). */
  forceAge?: number;
}

export function buildPlayer(
  rng: Rng, newId: (prefix: string, hint?: string) => string, tpl: CountryTemplate, clubId: string, clubRep: number,
  pos: Position, startDate: IsoDate, name: { first: string; last: string }, opts: BuildOptions = {},
): Player {
  const age = opts.forceAge ?? clamp(Math.round(rng.normal(25.5, 4.2)), 17, 38);
  const year = Number(startDate.slice(0, 4)) - age;
  // idade forçada: nascimento nos 12 meses anteriores ao aniversário, para ter exatamente `age` anos na data (jovens de 16 não podem sair com 15)
  const birthDate = opts.forceAge !== undefined ? addDays(addYears(startDate, -age), -rng.int(0, 364))
    : `${year}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`;
  // habilidade de auge cresce com a reputação do clube (escala 1..20); a idade ajusta a habilidade ATUAL
  const peak = clamp(6 + clubRep * 0.085 + rng.normal(0, 1.4), 3, 17);
  const delta = ageAbilityDelta(age);
  const attributes = genAttributes(rng, pos, clamp(peak + delta, 2, 17));
  const overall = overallFor(attributes, pos);
  // Jovens crescem até perto do auge; alguns têm teto acima do esperado. Veteranos não têm margem.
  let growth = 0;
  if (age <= 25) {
    growth = Math.round(-delta * 5 * rng.float(0.75, 1.3));
    if (rng.chance(0.08)) growth += rng.int(3, 10);
  }
  const potentialHidden = clamp(overall + growth, overall, 100);
  const potentialEstimated = clamp(Math.round(potentialHidden + rng.normal(0, 4)), overall, 100);
  const value = marketValue(overall, age, potentialHidden, tpl.wageScale);
  const foot: Foot = rng.weighted(['right', 'left', 'both'] as Foot[], [70, 24, 6]);
  // secundária só entre posições vizinhas no campo (goleiro nunca tem; ver SECONDARY_OPTIONS)
  const options = SECONDARY_OPTIONS[pos];
  const secondary: Position[] = rng.chance(0.35) && options.length > 0 ? [rng.pick(options)] : [];
  return {
    id: newId('plr', `${name.first} ${name.last} ${birthDate.slice(0, 4)}`),
    clubId,
    firstName: name.first,
    lastName: name.last,
    birthDate,
    nationality: tpl.code,
    extraNationalities: [],
    position: pos,
    secondaryPositions: secondary,
    foot,
    heightCm: pos === 'GK' ? rng.int(183, 200) : pos === 'CB' ? rng.int(178, 197) : rng.int(166, 192),
    weightKg: rng.int(62, 92),
    attributes,
    personality: {
      professionalism: rng.int(1, 20), ambition: rng.int(1, 20), loyalty: rng.int(1, 20),
      temperament: rng.int(1, 20), consistency: rng.int(1, 20),
    },
    potentialEstimated,
    potentialHidden,
    condition: 100,
    fatigue: 0,
    morale: 70,
    form: 50,
    marketValue: value,
    salary: Math.max(Math.round((value * 0.012) / 100) * 100, 1500),
    contractEnd: addYears(startDate, rng.int(1, 4)),
    overall,
  };
}

export function generateWorld(opts: WorldOptions): World {
  const startDate = opts.startDate ?? '2026-07-01';
  const root = createRng(`world:${opts.seed}`);
  const newId = makeIdFactory();

  const countries: Country[] = [];
  const leagues: League[] = [];
  const stadiums: Stadium[] = [];
  const clubs: Club[] = [];
  const players: Player[] = [];

  const wanted = opts.countries === 'all' ? null : new Set(opts.countries ?? TEST_COUNTRIES);
  const maxTier = opts.maxTier ?? (opts.countries === 'all' ? 99 : 2);
  for (const tpl of COUNTRY_TEMPLATES.filter((t) => !wanted || wanted.has(t.code))) {
    const crng = root.fork(`country:${tpl.code}`);
    const country: Country = { id: newId('cty', tpl.code), code: tpl.code, name: tpl.name, economy: tpl.wageScale };
    countries.push(country);
    const usedClubNames = new Set<string>();

    for (const lt of tpl.leagues.filter((l) => l.tier <= maxTier)) {
      const teams = opts.teamsPerLeagueOverride ?? lt.teams;
      const league: League = {
        id: newId('lg', `${country.id}-${lt.tier}`), countryId: country.id, name: lt.name, tier: lt.tier, teamCount: teams,
        rules: {
          rounds: 2, pointsWin: 3, pointsDraw: 1,
          tiebreakers: ['points', 'wins', 'goalDiff', 'goalsFor', 'headToHead'],
          promotionSlots: lt.promotion, relegationSlots: lt.relegation, continentalSlots: lt.continental,
          maxForeignPlayers: lt.foreignLimit, squadMin: 18, squadMax: 35,
        },
      };
      leagues.push(league);

      for (let i = 0; i < teams; i++) {
        const lrng = crng.fork(`league:${lt.tier}:club:${i}`);
        let name = '';
        let city = '';
        for (let tries = 0; tries < 200; tries++) {
          city = lrng.pick(tpl.cities);
          name = lrng.pick(tpl.clubPatterns).replace('{c}', city);
          if (!usedClubNames.has(name)) break;
          name = '';
        }
        if (!name) { city = `${lrng.pick(tpl.cities)}`; name = `${city} ${i + 1}`; }
        usedClubNames.add(name);

        // Reputação decresce com a posição na liga e com o nível da divisão.
        const tierBase = 78 - (lt.tier - 1) * 22 + (tpl.strength ?? 0);
        const reputation = clamp(Math.round(tierBase - (i / Math.max(teams - 1, 1)) * 24 + lrng.normal(0, 3)), 5, 99);
        const capacity = Math.round((6000 + reputation * 650 + lrng.int(0, 4000)) / 100) * 100;
        const stadium: Stadium = {
          id: '', city, capacity,
          name: `${lrng.pick(tpl.stadiumNames ?? STADIUM_SUFFIX)} ${city}`,
        };
        stadium.id = newId('std', stadium.name);
        stadiums.push(stadium);

        const club: Club = {
          id: newId('clb', name), name,
          shortName: name.replace(/[^A-Za-zÀ-ú ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w.slice(0, 3)).join('').toUpperCase().slice(0, 4) || 'CLB',
          countryId: country.id, city, leagueId: league.id, stadiumId: stadium.id, reputation,
          balance: 0, // definido depois do elenco (startingBalance)
          fans: reputation * 3500 + lrng.int(0, 20000),
          facilities: {
            training: clamp(Math.round(reputation / 6 + lrng.int(-2, 2)), 1, 20),
            youth: clamp(Math.round(reputation / 6 + lrng.int(-3, 3)), 1, 20),
            medical: clamp(Math.round(reputation / 6 + lrng.int(-2, 2)), 1, 20),
            stadium: clamp(Math.round(reputation / 6 + lrng.int(-2, 2)), 1, 20),
          },
        };
        clubs.push(club);

        const prng = lrng.fork('squad');
        const takenNames = new Set<string>();
        for (const pos of SQUAD_TEMPLATE) {
          let first = prng.pick(tpl.firstNames), last = prng.pick(tpl.lastNames);
          for (let tries = 0; tries < 50 && takenNames.has(`${first} ${last}`); tries++) {
            first = prng.pick(tpl.firstNames); last = prng.pick(tpl.lastNames);
          }
          takenNames.add(`${first} ${last}`);
          players.push(buildPlayer(prng, newId, tpl, club.id, reputation, pos, startDate, { first, last }));
        }
        club.balance = startingBalance(reputation, tpl.wageScale, players.filter((p) => p.clubId === club.id));
      }
    }
  }

  const code = new Map(countries.map((c) => [c.id, c.code]));
  const coaches = defaultCoaches(clubs.map((c) => ({ id: c.id, reputation: c.reputation, countryCode: code.get(c.countryId) ?? 'BRA' })), startDate);
  return { seed: opts.seed, startDate, countries, leagues, stadiums, clubs, players, coaches, cups: defaultCups(countries) };
}
