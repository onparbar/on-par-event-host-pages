const MILLISECONDS_PER_HOUR = 3_600_000;

function greatestCommonDivisor(left: number, right: number): number {
  while (right) [left, right] = [right, left % right];
  return left;
}

/** Contract duration parsing only; clock times and open-play quantities are not durations. */
export function parseEntertainmentDurationMinutes(value: string): number | null {
  const matches = [...value.matchAll(/\b(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\b/gi)];
  if (!matches.length) return null;
  const amounts = { hours: new Set<number>(), minutes: new Set<number>() };
  for (const match of matches) {
    if (value.slice(0, match.index).trimEnd().endsWith("-")) return null;
    const pieces = match[1].split(/\s+/);
    const fraction = pieces.at(-1)!;
    const [numerator, denominator] = fraction.split("/").map(Number);
    const amount = denominator === undefined ? numerator
      : denominator > 0 ? numerator / denominator + (pieces.length > 1 ? Number(pieces[0]) : 0) : NaN;
    if (!Number.isFinite(amount) || amount < 0) return null;
    amounts[/^h/i.test(match[2]) ? "hours" : "minutes"].add(amount);
  }
  // Equal duplicated evidence is harmless; different durations require review.
  if (amounts.hours.size > 1 || amounts.minutes.size > 1) return null;
  const minutes = ([...amounts.hours][0] ?? 0) * 60 + ([...amounts.minutes][0] ?? 0);
  const milliseconds = Math.round(minutes * 60_000);
  return minutes > 0 && Number.isSafeInteger(milliseconds) && milliseconds > 0 && Math.abs(minutes * 60_000 - milliseconds) < 0.000001
    ? milliseconds / 60_000 : null;
}

/** Use fractional hours rather than rounding a non-terminating purchased duration. */
export function formatEntertainmentDurationHours(minutes: number): string {
  const milliseconds = Math.round(minutes * 60_000);
  if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isSafeInteger(milliseconds) || milliseconds <= 0 || Math.abs(minutes * 60_000 - milliseconds) >= 0.000001) return "";
  const divisor = greatestCommonDivisor(milliseconds, MILLISECONDS_PER_HOUR);
  const numerator = milliseconds / divisor;
  const denominator = MILLISECONDS_PER_HOUR / divisor;
  let terminating = denominator;
  for (const factor of [2, 5]) while (terminating % factor === 0) terminating /= factor;
  if (terminating === 1) {
    const hours = milliseconds / MILLISECONDS_PER_HOUR;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const whole = Math.floor(numerator / denominator);
  return `${whole ? `${whole} ` : ""}${numerator % denominator}/${denominator} hour${whole ? "s" : ""}`;
}

export function formatEntertainmentIntervalHours(startAt: string, endAt: string): string {
  return formatEntertainmentDurationHours((Date.parse(endAt) - Date.parse(startAt)) / 60_000);
}

export function normalizeEntertainmentDurationHours(value: string): string {
  const minutes = parseEntertainmentDurationMinutes(value);
  return minutes == null ? value : formatEntertainmentDurationHours(minutes);
}
