import { RawLogEntry, ValidLogEntry, RejectedEntry, VALID_LEVELS, LogLevel } from '../types';

/**
 * Validates a single raw log entry and returns either a valid entry or a rejection reason.
 * Performs all validation rules specified in the API contract.
 */
export function validateLogEntry(
  entry: RawLogEntry,
  index: number
): { valid: ValidLogEntry } | { rejected: RejectedEntry } {
  // Validate timestamp
  if (entry.timestamp === undefined || entry.timestamp === null) {
    return { rejected: { index, reason: 'missing required field: timestamp' } };
  }

  if (typeof entry.timestamp !== 'string') {
    return { rejected: { index, reason: 'timestamp must be a string' } };
  }

  const timestamp = new Date(entry.timestamp);
  if (isNaN(timestamp.getTime())) {
    return { rejected: { index, reason: 'invalid timestamp: must be a valid ISO 8601 timestamp' } };
  }

  // Must not be more than 5 minutes in the future
  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
  if (timestamp > fiveMinutesFromNow) {
    return { rejected: { index, reason: 'timestamp must not be more than 5 minutes in the future' } };
  }

  // Validate level
  if (entry.level === undefined || entry.level === null) {
    return { rejected: { index, reason: 'missing required field: level' } };
  }

  if (typeof entry.level !== 'string' || !VALID_LEVELS.has(entry.level)) {
    return { rejected: { index, reason: `invalid level: '${entry.level}'` } };
  }

  // Validate service
  if (entry.service === undefined || entry.service === null) {
    return { rejected: { index, reason: 'missing required field: service' } };
  }

  if (typeof entry.service !== 'string' || entry.service.trim() === '') {
    return { rejected: { index, reason: 'service must be a non-empty string' } };
  }

  // Validate message
  if (entry.message === undefined || entry.message === null) {
    return { rejected: { index, reason: 'missing required field: message' } };
  }

  if (typeof entry.message !== 'string' || entry.message.trim() === '') {
    return { rejected: { index, reason: 'message must be a non-empty string' } };
  }

  // Validate attributes (optional)
  let attributes: Record<string, string | number | boolean> | null = null;
  if (entry.attributes !== undefined && entry.attributes !== null) {
    if (typeof entry.attributes !== 'object' || Array.isArray(entry.attributes)) {
      return { rejected: { index, reason: 'attributes must be a flat object' } };
    }

    const attrs = entry.attributes as Record<string, unknown>;
    for (const [key, value] of Object.entries(attrs)) {
      if (typeof value === 'object' || Array.isArray(value)) {
        return { rejected: { index, reason: `attribute '${key}' has invalid value: nested objects and arrays are not allowed` } };
      }
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        return { rejected: { index, reason: `attribute '${key}' has invalid value type: must be string, number, or boolean` } };
      }
    }

    attributes = attrs as Record<string, string | number | boolean>;
  }

  return {
    valid: {
      timestamp,
      level: entry.level as LogLevel,
      service: entry.service as string,
      message: entry.message as string,
      attributes,
    },
  };
}

/**
 * Validates an entire batch of log entries.
 * Returns arrays of valid entries and rejected entries.
 */
export function validateBatch(entries: RawLogEntry[]): {
  valid: ValidLogEntry[];
  rejected: RejectedEntry[];
} {
  const valid: ValidLogEntry[] = [];
  const rejected: RejectedEntry[] = [];

  for (let i = 0; i < entries.length; i++) {
    const result = validateLogEntry(entries[i], i);
    if ('valid' in result) {
      valid.push(result.valid);
    } else {
      rejected.push(result.rejected);
    }
  }

  return { valid, rejected };
}
