/**
 * Red-zone possessions: one trip per offensive drive that ran a play
 * from the opponent's 20-yard line or closer. Touchdowns are credited
 * only when the offense gained at least six scoreboard points on the drive.
 */
export function summarizeRedZone(plays, drives, completedIds) {
  const completed = new Set([...completedIds].map(String));
  const redZoneKeys = new Set();
  const key = row => `${row.gameId}:${row.driveId ?? row.id}`;

  for (const play of plays) {
    const yards = Number(play.yardsToGoal);
    if (!completed.has(String(play.gameId)) || !play.driveId) continue;
    if (Number.isFinite(yards) && yards >= 1 && yards <= 20) {
      redZoneKeys.add(key(play));
    }
  }

  const byTeam = {};
  const entry = name => byTeam[name] ??= {
    offenseTrips: 0, offenseTds: 0, defenseTrips: 0, defenseTds: 0
  };
  const seen = new Set();
  for (const drive of drives) {
    const id = key(drive);
    if (!completed.has(String(drive.gameId)) || seen.has(id) || !redZoneKeys.has(id)) continue;
    if (!drive.offense || !drive.defense) continue;
    seen.add(id);
    const gained = Number(drive.endOffenseScore) - Number(drive.startOffenseScore);
    const touchdown = Number.isFinite(gained) && gained >= 6;
    const offense = entry(drive.offense), defense = entry(drive.defense);
    offense.offenseTrips++;
    defense.defenseTrips++;
    if (touchdown) { offense.offenseTds++; defense.defenseTds++; }
  }
  return byTeam;
}
