import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeData } from './normalize.mjs';
import { summarizeRedZone } from './red-zone.mjs';

const mock = normalizeData({
  season: 2026,
  teams: [
    { id: 1, school: 'Nebraska', abbreviation: 'NEB', alternateNames: ['Nebraska Cornhuskers'], conference: 'Big Ten', location: { id: 10, latitude: 40.82, longitude: -96.70, timezone: 'America/Chicago', elevation: '1170', grass: false, dome: false } },
    { id: 2, school: 'Iowa', abbreviation: 'IOWA', alternateNames: [], conference: 'Big Ten', location: { id: 20, latitude: 41.66, longitude: -91.55, timezone: 'America/Chicago', elevation: '650', grass: false, dome: false } }
  ],
  venues: [{ id: 20, name: 'Kinnick Stadium', latitude: 41.66, longitude: -91.55, timezone: 'America/Chicago', elevation: '650', grass: false, dome: false }],
  games: [{ id: 100, week: 1, seasonType: 'regular', startDate: '2026-08-29T19:30:00Z', completed: true, neutralSite: false, venueId: 10, venue: 'Memorial Stadium', homeTeam: 'Nebraska', awayTeam: 'Iowa', homePoints: 28, awayPoints: 21 }],
  advancedStats: [
    { team: 'Nebraska', offense: { successRate: .48, ppa: .17, totalPPA: 10, plays: 70, drives: 11, fieldPosition: { averageStart: 28 }, havoc: { total: .12 }, standardDowns: { ppa: .16 } }, defense: { ppa: -.04, fieldPosition: { averageStart: 25 }, havoc: { total: .2 } } },
    { team: 'Iowa', offense: { successRate: .39, ppa: .01, totalPPA: 1, plays: 64, drives: 11, fieldPosition: { averageStart: 27 }, havoc: { total: .16 }, standardDowns: { ppa: .02 } }, defense: { ppa: .1, fieldPosition: { averageStart: 30 }, havoc: { total: .14 } } }
  ],
  ratings: [{ team: 'Nebraska', overall: 8, offense: 10, defense: 2, throughWeek: 1 }],
  returning: [{ team: 'Nebraska', percentPPA: 0.61, totalPPA: 1.46 }],
  basicStats: [{ team: 'Nebraska', statName: 'sacks', statValue: '3' }, { team: 'Nebraska', statName: 'sacksOpponent', statValue: '2' }],
  redZone: { Nebraska: { offenseTrips: 5, offenseTds: 4, defenseTrips: 4, defenseTds: 1 } },
  talent: [{ team: 'Nebraska', talent: 800 }, { team: 'Iowa', talent: 700 }],
  boxScores: [{ id: 100, teams: [
    { team: 'Nebraska', points: 28, stats: [{ category: 'totalYards', stat: '420' }, { category: 'rushingAttempts', stat: '40' }, { category: 'rushingYards', stat: '200' }, { category: 'netPassingYards', stat: '220' }, { category: 'completionAttempts', stat: '20-30' }, { category: 'thirdDownEff', stat: '7-14' }, { category: 'turnovers', stat: '1' }] },
    { team: 'Iowa', points: 21, stats: [{ category: 'totalYards', stat: '320' }, { category: 'rushingAttempts', stat: '35' }, { category: 'rushingYards', stat: '120' }, { category: 'netPassingYards', stat: '200' }, { category: 'completionAttempts', stat: '18-31' }, { category: 'thirdDownEff', stat: '5-13' }, { category: 'turnovers', stat: '2' }] }
  ] }]
});

assert.equal(mock.teams.Nebraska.gamesPlayed, 1);
assert.equal(mock.teams.Nebraska.model.ppg, 28);
assert.equal(mock.teams.Nebraska.model.pointsAllowed, 21);
assert.equal(mock.teams.Nebraska.model.successRate, 48);
assert.equal(mock.teams.Nebraska.model.returningProduction, 61);
assert.equal(mock.teams.Nebraska.model.sacks, 3);
assert.equal(mock.teams.Nebraska.model.sacksAllowed, 2);
assert.equal(mock.teams.Nebraska.model.redZoneTdPct, 80);
assert.equal(mock.teams.Nebraska.model.redZoneTdAllowed, 25);
assert.equal(mock.teams.Nebraska.model.startField, 72);
assert.equal(mock.teams.Nebraska.model.yardsGame, 420);
assert.equal(mock.teams.Nebraska.model.yardsAllowed, 320);
assert.equal(mock.teams.Nebraska.model.thirdDownPct, 50);
assert.equal(mock.teams.Nebraska.model.drivesGame, 11);
assert.equal(mock.teams.Nebraska.dataWeight, .2);
assert.equal(mock.venues[20].name, 'Kinnick Stadium');

const livePath = new URL('./data/live-data.json', import.meta.url);
if (fs.existsSync(livePath)) {
  const live = JSON.parse(fs.readFileSync(livePath, 'utf8'));
  assert.ok(live && typeof live === 'object');
  assert.ok(live.teams && live.games && live.venues);
}

const rz = summarizeRedZone(
  [{ gameId: 100, driveId: 'a', yardsToGoal: 18 }, { gameId: 100, driveId: 'a', yardsToGoal: 12 }, { gameId: 100, driveId: 'b', yardsToGoal: 35 }],
  [{ gameId: 100, id: 'a', offense: 'Nebraska', defense: 'Iowa', startOffenseScore: 0, endOffenseScore: 7 },
   { gameId: 100, id: 'b', offense: 'Iowa', defense: 'Nebraska', startOffenseScore: 0, endOffenseScore: 3 }],
  new Set([100])
);
assert.equal(rz.Nebraska.offenseTrips, 1);
assert.equal(rz.Nebraska.offenseTds, 1);
assert.equal(rz.Iowa.defenseTrips, 1);

console.log('Normalizer tests passed.');
