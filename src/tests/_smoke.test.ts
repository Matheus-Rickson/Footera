import { test } from 'node:test';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { advanceTime } from '../database/repositories/competitionRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import { getSocialFeed } from '../database/repositories/socialRepository.ts';
test('smoke', async () => {
  const world = generateWorld({ seed: 'soc', teamsPerLeagueOverride: 8 });
  const db = await openDatabase(':memory:');
  createCareer(db, world, { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-01-01', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null }, world.clubs[0]!.id);
  const t0 = Date.now();
  for (let i = 0; i < 12; i++) { advanceTime(db, 'nextMatchday'); simulateMatchday(db); }
  const f = getSocialFeed(db, 'all', 200);
  console.log('ms', Date.now() - t0, 'total', f.total);
  const kinds: Record<string, number> = {};
  for (const p of f.posts) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
  console.log(JSON.stringify(kinds));
  for (const p of f.posts.slice(0, 14)) console.log(p.date, p.author.name, p.author.verified ? '✔' : '', '@' + p.author.handle, '|', p.text, '|', p.comments.map((c) => `${c.author.handle}: ${c.text}`).join(' / '));
  console.log(JSON.stringify(f.trending), f.profiles.map((x) => x.name).join(', '));
});
