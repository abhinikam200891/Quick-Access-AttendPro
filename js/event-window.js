/**
 * Event Check-in Window
 * One definition of when an event's check-in is open, shared by the host page, the
 * check-in page, the admin and the demo engine. It matches submit_attendance in
 * supabase/schema.sql: times are in the event's timezone, and an end time earlier
 * than the start time means the event runs past midnight into the next day.
 */

const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export function toMinutes(time) {
  const [h, m] = String(time || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function clockLabel(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function isOvernight(event) {
  return toMinutes(event.end_time) < toMinutes(event.start_time);
}

function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/**
 * Date (YYYY-MM-DD) and minutes since midnight of a moment, on the given timezone's clock
 */
export function nowInZone(timeZone, at = new Date()) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(at);
  } catch (e) {
    // Unknown timezone name: use the device's own clock
    parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(at);
  }
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute'))
  };
}

/**
 * Where "now" sits relative to the event's check-in window.
 * @returns {{state: 'waiting'|'open'|'closed', overnight: boolean, start: number, end: number,
 *            endDate: string, minutesSinceStart: number|null, isLate: boolean}}
 */
export function getEventWindow(event, at = new Date()) {
  const now = nowInZone(event.timezone || DEFAULT_TIMEZONE, at);
  const start = toMinutes(event.start_time);
  const end = toMinutes(event.end_time);
  const overnight = end < start;
  const endDate = overnight ? addDays(event.date, 1) : event.date;

  // Compare (date, minute) pairs
  const before = (d1, m1, d2, m2) => d1 < d2 || (d1 === d2 && m1 < m2);
  const after = (d1, m1, d2, m2) => d1 > d2 || (d1 === d2 && m1 > m2);

  let state = 'open';
  if (before(now.date, now.minutes, event.date, start)) state = 'waiting';
  else if (after(now.date, now.minutes, endDate, end)) state = 'closed';

  let minutesSinceStart = null;
  if (state !== 'waiting') {
    minutesSinceStart = now.date === event.date ? now.minutes - start : now.minutes + 1440 - start;
  }
  const grace = event.late_grace_minutes ?? 15;

  return {
    state,
    overnight,
    start,
    end,
    endDate,
    minutesSinceStart,
    isLate: minutesSinceStart !== null && minutesSinceStart > grace,
    isToday: now.date === event.date
  };
}

/**
 * "18:00 - 09:00 (next day)" style label for an event's window
 */
export function formatWindow(event) {
  const label = `${clockLabel(toMinutes(event.start_time))} - ${clockLabel(toMinutes(event.end_time))}`;
  return isOvernight(event) ? `${label} (next day)` : label;
}

/**
 * Admin form check. Returns an error message, or null when the window is valid.
 */
export function validateEventTimes(startTime, endTime) {
  if (!startTime || !endTime) return 'Enter both the opening and closing time.';
  if (toMinutes(startTime) === toMinutes(endTime)) {
    return 'Check-in opening and closing times are the same, so check-in would never be open.';
  }
  return null;
}
