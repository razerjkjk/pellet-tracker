// Shared boogie-streak math, used by getData (the Boogie Board) and the
// dance-off board. Everything is computed only from real logged burn
// dates — there is no manual entry and no way to type in a streak.

function dayMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}
function addDays(date: string, days: number): string {
  return new Date(dayMs(date) + days * 86400000).toISOString().slice(0, 10);
}
function diffDays(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / 86400000);
}

export interface StreakStats {
  currentStreak: number;
  longestStreak: number;
  /** First date a streak of each length was reached (for streak badges). */
  streakReachedOn: Map<number, string>;
}

/**
 * Streaks over consecutive calendar days with at least one burn logged.
 * `burnDates` must be the sorted, de-duplicated burn dates. The current
 * streak counts back from today, or from yesterday when today has no burn
 * yet, so the streak isn't broken mid-day. 0 when neither today nor
 * yesterday has a burn.
 */
export function streakStats(burnDates: string[], today: string): StreakStats {
  const burnDateSet = new Set(burnDates);
  let longestStreak = 0;
  let runLength = 0;
  let prevDate: string | null = null;
  const streakReachedOn = new Map<number, string>();
  for (const d of burnDates) {
    runLength = prevDate != null && diffDays(prevDate, d) === 1 ? runLength + 1 : 1;
    if (runLength > longestStreak) longestStreak = runLength;
    if (!streakReachedOn.has(runLength)) streakReachedOn.set(runLength, d);
    prevDate = d;
  }
  let currentStreak = 0;
  const streakAnchor = burnDateSet.has(today)
    ? today
    : burnDateSet.has(addDays(today, -1))
      ? addDays(today, -1)
      : null;
  if (streakAnchor != null) {
    let d = streakAnchor;
    while (burnDateSet.has(d)) {
      currentStreak += 1;
      d = addDays(d, -1);
    }
  }
  return { currentStreak, longestStreak, streakReachedOn };
}
