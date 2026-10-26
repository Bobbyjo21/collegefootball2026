import fs from 'node:fs/promises';
import { normalizeData } from './normalize.mjs';
import { summarizeRedZone } from './red-zone.mjs';

const API = 'https://api.collegefootballdata.com';
const apiKey = process.env.CFBD_API_KEY;
if (!apiKey) throw new Error('CFBD_API_KEY is missing. Add it as a GitHub Actions secret.');

const now = new Date();
const defaultSeason = now.getUTCMonth() < 2 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
const season = Number(process.env.CFB_SEASON || defaultSeason);
const warnings = [];

async function request(path, params = {}) {
  const url = new URL(API + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!response.ok) throw new Error(`${response.status} ${path}: ${(await response.text()).slice(0, 240)}`);
  return response.json();
}

async function optional(label, path, params) {
  try {
    return await request(path, params);
  } catch (error) {
    warnings.push(`${label} unavailable: ${error.message}`);
    return [];
  }
}

console.log(`Updating ${season} college football data…`);

const [teams, venues, games] = await Promise.all([
  request('/teams/fbs', { year: season }),
  request('/venues'),
  request('/games', { year: season, seasonType: 'both', classification: 'fbs' })
]);

const [basicStats, advancedStats, ratings, talent, returning] = await Promise.all([
  optional('Season statistics', '/stats/season', { year: season, classification: 'fbs' }),
  optional('Advanced statistics', '/stats/season/advanced', { year: season, classification: 'fbs', excludeGarbageTime: true }),
  optional('CORE ratings', '/ratings/core', { year: season }),
  optional('Talent ratings', '/talent', { year: season }),
  optional('Returning production', '/player/returning', { year: season })
]);

const completed = games.filter(game => game.completed);
const completedWeeks = [...new Set(completed.map(game => game.week))].sort((a, b) => a - b);
const completedIds = new Set(completed.map(game => game.id));
const boxScores = [];
const redZone = {};
let redZoneComplete = true;

for (const week of completedWeeks) {
  const [rows, plays, drives] = await Promise.all([
    optional(`Week ${week} box scores`, '/games/teams', {
      year: season, week, seasonType: 'both', classification: 'fbs'
    }),
    optional(`Week ${week} plays`, '/plays', {
      year: season, week, seasonType: 'both', classification: 'fbs'
    }),
    optional(`Week ${week} drives`, '/drives', {
      year: season, week, seasonType: 'both', classification: 'fbs'
    })
  ]);
  boxScores.push(...rows);
  console.log(`Week ${week}: ${rows.length} game boxes, ${plays.length} plays, ${drives.length} drives.`);
  if (plays.length < 100 || drives.length < 20) {
    redZoneComplete = false;
    warnings.push(`Week ${week} red-zone feed incomplete; season red-zone rates omitted.`);
    continue;
  }
  const weekly = summarizeRedZone(plays, drives, completedIds);
  for (const [name, stats] of Object.entries(weekly)) {
    const total = redZone[name] ??= { offenseTrips: 0, offenseTds: 0, defenseTrips: 0, defenseTds: 0 };
    for (const key of Object.keys(total)) total[key] += stats[key];
  }
}

const output = normalizeData({
  season, teams, venues, games, basicStats, advancedStats, ratings,
  talent, returning, boxScores, redZone: redZoneComplete ? redZone : {}, warnings
});

// Never replace a good published snapshot with an empty or malformed feed.
if (Object.keys(output.teams).length < 100 || output.games.length < 100) {
  throw new Error(
    `CFB feed incomplete: ${Object.keys(output.teams).length} teams, ${output.games.length} games. Keeping previous published data.`
  );
}

await fs.mkdir('data', { recursive: true });
await fs.writeFile('data/live-data.json', JSON.stringify(output, null, 2) + '\n');

console.log(`Saved ${Object.keys(output.teams).length} teams, ${output.games.length} games, and ${boxScores.length} box scores.`);
if (warnings.length) console.warn(warnings.join('\n'));
