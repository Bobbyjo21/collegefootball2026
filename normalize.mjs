const number = value => {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const percent = value => {
  const parsed = number(value);
  if (parsed === null) return null;
  return Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
};

const clean = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function pair(value) {
  const match = String(value ?? '').match(/(-?\d+(?:\.\d+)?)\s*[-/]\s*(-?\d+(?:\.\d+)?)/);
  return match ? [Number(match[1]), Number(match[2])] : [null, null];
}

function average(total, count) {
  return Number.isFinite(total) && count > 0 ? total / count : null;
}

function ratio(numerator, denominator, scale = 100) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? numerator / denominator * scale
    : null;
}

function assign(target, key, value) {
  if (Number.isFinite(value)) target[key] = Number(value.toFixed(4));
}

function teamBox(team) {
  const stats = {};
  for (const item of team?.stats ?? []) stats[clean(item.category)] = item.stat;
  return stats;
}

function aggregateBoxScores(boxScores) {
  const totals = {};
  const get = name => totals[name] ??= { games: 0, offense: {}, defense: {} };
  const add = (bucket, key, value) => {
    if (!Number.isFinite(value)) return;
    bucket[key] = (bucket[key] ?? 0) + value;
  };

  for (const game of boxScores ?? []) {
    if (!Array.isArray(game.teams) || game.teams.length < 2) continue;
    const [one, two] = game.teams;
    for (const [team, opponent] of [[one, two], [two, one]]) {
      const entry = get(team.team);
      entry.games++;
      const own = teamBox(team);
      const opp = teamBox(opponent);
      for (const [key, raw] of Object.entries(own)) {
        const direct = number(raw);
        if (direct !== null) add(entry.offense, key, direct);
        const [made, attempts] = pair(raw);
        if (made !== null) {
          add(entry.offense, `${key}made`, made);
          add(entry.offense, `${key}attempts`, attempts);
        }
      }
      for (const [key, raw] of Object.entries(opp)) {
        const direct = number(raw);
        if (direct !== null) add(entry.defense, key, direct);
        const [made, attempts] = pair(raw);
        if (made !== null) {
          add(entry.defense, `${key}made`, made);
          add(entry.defense, `${key}attempts`, attempts);
        }
      }
    }
  }
  return totals;
}

function buildGameSummaries(games) {
  const summaries = {};
  const get = name => summaries[name] ??= {
    games: 0, points: 0, allowed: 0, homeGames: 0, homeWins: 0,
    roadGames: 0, roadWins: 0, completedDates: []
  };
  for (const game of games.filter(game => game.completed && Number.isFinite(game.homePoints) && Number.isFinite(game.awayPoints))) {
    const home = get(game.homeTeam), away = get(game.awayTeam);
    home.games++; away.games++;
    home.points += game.homePoints; home.allowed += game.awayPoints;
    away.points += game.awayPoints; away.allowed += game.homePoints;
    home.completedDates.push(game.startDate); away.completedDates.push(game.startDate);
    if (!game.neutralSite) {
      home.homeGames++; away.roadGames++;
      if (game.homePoints > game.awayPoints) home.homeWins++;
      if (game.awayPoints > game.homePoints) away.roadWins++;
    }
  }
  return summaries;
}

function addBoxMetrics(model, box) {
  if (!box?.games) return;
  const g = box.games, o = box.offense, d = box.defense;
  const oPlays = (o.rushingattempts ?? 0) + (o.completionattemptsattempts ?? 0);
  const dPlays = (d.rushingattempts ?? 0) + (d.completionattemptsattempts ?? 0);
  assign(model, 'yardsGame', average(o.totalyards, g));
  assign(model, 'yardsPlay', ratio(o.totalyards, oPlays, 1));
  assign(model, 'passYardsGame', average(o.netpassingyards, g));
  assign(model, 'passYardsAttempt', ratio(o.netpassingyards, o.completionattemptsattempts, 1));
  assign(model, 'completionPct', ratio(o.completionattemptsmade, o.completionattemptsattempts));
  assign(model, 'rushYardsGame', average(o.rushingyards, g));
  assign(model, 'yardsRush', ratio(o.rushingyards, o.rushingattempts, 1));
  assign(model, 'thirdDownPct', ratio(o.thirddowneffmade, o.thirddowneffattempts));
  assign(model, 'fourthDownPct', ratio(o.fourthdowneffmade, o.fourthdowneffattempts));
  assign(model, 'redZoneTdPct', ratio(o.redzoneattemptsmade, o.redzoneattemptsattempts));
  assign(model, 'turnoversGame', average(o.turnovers, g));
  assign(model, 'sacksAllowed', average(o.sacksyardsmade, g));
  assign(model, 'tdIntRatio', ratio(o.passingtds, o.interceptions, 1));
  assign(model, 'fgPct', ratio(o.fieldgoalsmade, o.fieldgoalsattempts));
  assign(model, 'xpPct', ratio(o.extrapointsmade, o.extrapointsattempts));
  assign(model, 'puntAverage', ratio(o.puntyards, o.punts, 1));
  assign(model, 'puntReturn', ratio(o.puntreturnyards, o.puntreturns, 1));
  assign(model, 'kickReturn', ratio(o.kickreturnyards, o.kickreturns, 1));
  assign(model, 'penaltiesGame', average(o.totalpenaltiesyardsmade, g));

  assign(model, 'yardsAllowed', average(d.totalyards, g));
  assign(model, 'yardsPlayAllowed', ratio(d.totalyards, dPlays, 1));
  assign(model, 'passYardsAllowed', average(d.netpassingyards, g));
  assign(model, 'passYardsAttemptAllowed', ratio(d.netpassingyards, d.completionattemptsattempts, 1));
  assign(model, 'completionAllowed', ratio(d.completionattemptsmade, d.completionattemptsattempts));
  assign(model, 'rushYardsAllowed', average(d.rushingyards, g));
  assign(model, 'yardsRushAllowed', ratio(d.rushingyards, d.rushingattempts, 1));
  assign(model, 'thirdDownAllowed', ratio(d.thirddowneffmade, d.thirddowneffattempts));
  assign(model, 'redZoneTdAllowed', ratio(d.redzoneattemptsmade, d.redzoneattemptsattempts));
  assign(model, 'sacks', average(o.sacksyardsmade ?? o.sacks, g));
  assign(model, 'interceptions', average(o.passesintercepted, g));
  assign(model, 'forcedFumbles', average(o.fumblesrecovered, g));
  assign(model, 'defensiveTds', average((o.interceptiontds ?? 0) + (o.fumblereturntds ?? 0), g));
}

function addAdvancedMetrics(model, row, gamesPlayed) {
  if (!row || !gamesPlayed) return;
  const off = row.offense ?? {}, def = row.defense ?? {};
  assign(model, 'successRate', percent(off.successRate));
  assign(model, 'epaPlay', number(off.ppa));
  assign(model, 'offensiveEpa', average(number(off.totalPPA), gamesPlayed));
  assign(model, 'defensiveEpa', number(def.ppa));
  assign(model, 'earlyDownEpa', number(off.standardDowns?.ppa));
  assign(model, 'playsGame', average(number(off.plays), gamesPlayed));
  assign(model, 'drivesGame', average(number(off.drives), gamesPlayed));
  assign(model, 'startField', number(off.fieldPosition?.averageStart));
  assign(model, 'oppStartField', number(def.fieldPosition?.averageStart));
  assign(model, 'driveLength', ratio(number(off.openFieldYardsTotal), number(off.drives), 1));
  assign(model, 'havocAllowed', percent(off.havoc?.total));
  assign(model, 'havocRate', percent(def.havoc?.total));
}

export function normalizeData({ season, teams = [], venues = [], games = [], basicStats = [], advancedStats = [], ratings = [], talent = [], returning = [], boxScores = [], warnings = [] }) {
  const output = {
    season,
    updatedAt: new Date().toISOString(),
    sources: { cfbd: true, weather: 'Open-Meteo at simulation time' },
    warnings,
    teams: {},
    games: games.map(game => ({
      id: game.id, week: game.week, seasonType: game.seasonType, startDate: game.startDate,
      completed: game.completed, neutralSite: game.neutralSite, venueId: game.venueId,
      venue: game.venue, homeTeam: game.homeTeam, awayTeam: game.awayTeam,
      homePoints: game.homePoints, awayPoints: game.awayPoints
    })),
    venues: Object.fromEntries(venues.filter(v => v.id != null).map(v => [v.id, v]))
  };

  for (const team of teams) {
    output.teams[team.school] = {
      id: team.id,
      name: team.school,
      aliases: [team.abbreviation, ...(team.alternateNames ?? [])].filter(Boolean),
      conference: team.conference,
      color: team.color,
      location: team.location,
      gamesPlayed: 0,
      dataWeight: 0,
      raw: {},
      model: {}
    };
  }

  const ensure = name => output.teams[name] ??= { name, aliases: [], gamesPlayed: 0, dataWeight: 0, raw: {}, model: {} };
  for (const row of basicStats) ensure(row.team).raw[row.statName] = number(row.statValue) ?? row.statValue;

  const summaries = buildGameSummaries(games), boxes = aggregateBoxScores(boxScores);
  const advancedByTeam = Object.fromEntries(advancedStats.map(row => [row.team, row]));
  const ratingsByTeam = Object.fromEntries(ratings.map(row => [row.team, row]));
  const talentValues = talent.map(row => number(row.talent)).filter(Number.isFinite).sort((a, b) => a - b);
  const returningByTeam = Object.fromEntries(returning.map(row => [row.team, row]));

  for (const [name, team] of Object.entries(output.teams)) {
    const summary = summaries[name], model = team.model;
    const gp = summary?.games ?? boxes[name]?.games ?? 0;
    team.gamesPlayed = gp;
    team.dataWeight = Number((gp / (gp + 4)).toFixed(4));
    if (summary && gp) {
      assign(model, 'ppg', summary.points / gp);
      assign(model, 'pointsAllowed', summary.allowed / gp);
      assign(model, 'pointDiff', (summary.points - summary.allowed) / gp);
      assign(model, 'homeRecordPct', ratio(summary.homeWins, summary.homeGames));
      assign(model, 'roadRecordPct', ratio(summary.roadWins, summary.roadGames));
    }
    addBoxMetrics(model, boxes[name]);
    addAdvancedMetrics(model, advancedByTeam[name], gp);
    const drives = model.drivesGame * gp;
    if (summary && drives > 0) {
      assign(model, 'pointsDrive', summary.points / drives);
      assign(model, 'oppPointsDrive', summary.allowed / drives);
    }
    if (Number.isFinite(model.yardsPlay) && Number.isFinite(model.yardsPlayAllowed)) assign(model, 'yppDiff', model.yardsPlay - model.yardsPlayAllowed);
    if (Number.isFinite(model.thirdDownPct) && Number.isFinite(model.thirdDownAllowed)) assign(model, 'thirdDownDiff', model.thirdDownPct - model.thirdDownAllowed);
    if (Number.isFinite(model.redZoneTdPct) && Number.isFinite(model.redZoneTdAllowed)) assign(model, 'redZoneDiff', model.redZoneTdPct - model.redZoneTdAllowed);
    const rating = ratingsByTeam[name];
    if (rating) {
      assign(model, 'oppAdjusted', number(rating.overall));
      team.ratings = { overall: number(rating.overall), offense: number(rating.offense), defense: number(rating.defense), throughWeek: rating.throughWeek };
    }
    const talentRow = talent.find(row => row.team === name), talentValue = number(talentRow?.talent);
    if (talentValue !== null && talentValues.length) assign(model, 'talentComposite', talentValues.filter(v => v <= talentValue).length / talentValues.length * 100);
    const returningRow = returningByTeam[name];
    const returningValue = number(returningRow?.totalPPA ?? returningRow?.total ?? returningRow?.percentPPA);
    if (returningValue !== null) assign(model, 'returningProduction', percent(returningValue));
  }

  return output;
}
