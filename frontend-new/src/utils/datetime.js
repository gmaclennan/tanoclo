/**
 * @file src/utils/datetime.js
 * @brief Datetime manipulation utilities for timezone transformations, schedule boundaries,
 * and HH:MM formatting calculations.
 */

/**
 * Safely parses a timestamp string or Date object into a Date in UTC.
 * Ensures SQL datetime strings (e.g. 'YYYY-MM-DD HH:mm:ss') without timezone offsets
 * are treated as UTC rather than ambiguous local time.
 * @param {string|Date} ts
 * @returns {Date|null}
 */
export function parseTimestampToDate(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof ts === 'string') {
    if (!ts.includes('Z') && !ts.includes('+') && !/-\d\d:?\d\d$/.test(ts)) {
      return new Date(ts.replace(' ', 'T') + 'Z');
    }
    return new Date(ts);
  }
  return new Date(ts);
}

/**
 * Formats a date string as local time or custom timezone format
 * @param {string|Date} dateVal
 * @param {string} [timeZone]
 * @param {boolean} [includeSeconds]
 * @returns {string}
 */
export function formatLocalTime(dateVal, timeZone, includeSeconds = false) {
  if (!dateVal) return '';
  const d = parseTimestampToDate(dateVal);
  if (!d || isNaN(d.getTime())) return '';
  const options = { hour: '2-digit', minute: '2-digit', hour12: false };
  if (includeSeconds) {
    options.second = '2-digit';
  }
  if (timeZone) {
    try {
      return d.toLocaleTimeString([], { ...options, timeZone });
    } catch {
      // Fallback if invalid timeZone
    }
  }
  return d.toLocaleTimeString([], options);
}

/**
 * Formats a date string as YYYY-MM-DD
 * @param {Date} [date]
 * @returns {string}
 */
export function formatDateISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Converts minutes past midnight to HH:MM format
 * @param {number} minutes
 * @returns {string}
 */
export function minutesToTimeString(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Converts HH:MM string to minutes past midnight
 * @param {string} timeStr
 * @returns {number}
 */
export function timeStringToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}