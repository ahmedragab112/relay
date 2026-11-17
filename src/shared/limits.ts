// A limit error is only a hint: the provider decides when a model works again. When it
// says when, use that; otherwise retry soon instead of parking the model for hours.
export const DEFAULT_LIMIT_COOLDOWN_MS = 60_000;

const UNIT_MS: Record<string, number> = {
  s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
  m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
  h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000,
};

const ABSOLUTE = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z)\b/;
const DURATION = /\b(?:retry(?:[- ]after)?|try again|wait|resets?|reset)\b[^.\d]{0,40}?(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/i;

export function limitResetAt(message: string, now = Date.now()): number | undefined {
  const absolute = ABSOLUTE.exec(message);
  if (absolute) {
    const at = Date.parse(absolute[1]);
    return Number.isFinite(at) && at > now ? at : undefined;
  }
  const duration = DURATION.exec(message);
  if (!duration) return undefined;
  const value = Number(duration[1]);
  const unit = UNIT_MS[duration[2].toLowerCase()];
  if (!Number.isFinite(value) || !unit) return undefined;
  return now + Math.round(value * unit);
}

export function resetLabel(until: number, now = Date.now()): string {
  const remaining = until - now;
  if (remaining <= 0) return 'available now';
  if (remaining < 90_000) return `resets in ${Math.ceil(remaining / 1000)}s`;
  if (remaining < 90 * 60_000) return `resets in ${Math.ceil(remaining / 60_000)}m`;
  const time = new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `resets at ${time}`;
}
