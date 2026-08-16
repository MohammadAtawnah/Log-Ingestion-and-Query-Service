import { Pool } from 'pg';
import { queryLogs } from '../db/queries';
import { LogQueryParams, LogQueryResponse, CursorData, VALID_LEVELS, LogLevel } from '../types';

/**
 * Parses and validates query parameters for GET /logs, then executes the query.
 */
export async function searchLogs(
  pool: Pool,
  rawParams: Record<string, string | undefined>
): Promise<LogQueryResponse> {
  const params = parseQueryParams(rawParams);
  const result = await queryLogs(pool, params);
  return {
    logs: result.logs,
    next_cursor: result.nextCursor,
  };
}

/**
 * Parses raw query string parameters into validated LogQueryParams.
 * Throws an error with a descriptive message for invalid parameters.
 */
export function parseQueryParams(raw: Record<string, string | undefined>): LogQueryParams {
  const params: LogQueryParams = { limit: 100 };

  // Service filter
  if (raw.service) {
    params.service = raw.service;
  }

  // Level filter
  if (raw.level) {
    if (!VALID_LEVELS.has(raw.level)) {
      throw new ValidationError(`invalid level: '${raw.level}'`);
    }
    params.level = raw.level as LogLevel;
  }

  // Since filter
  if (raw.since) {
    const since = new Date(raw.since);
    if (isNaN(since.getTime())) {
      throw new ValidationError(`invalid timestamp for 'since': '${raw.since}'`);
    }
    params.since = since;
  }

  // Until filter
  if (raw.until) {
    const until = new Date(raw.until);
    if (isNaN(until.getTime())) {
      throw new ValidationError(`invalid timestamp for 'until': '${raw.until}'`);
    }
    params.until = until;
  }

  // since must be before until
  if (params.since && params.until && params.since >= params.until) {
    throw new ValidationError("'until' must be after 'since'");
  }

  // Limit
  if (raw.limit) {
    const limit = Number(raw.limit);
    if (!Number.isInteger(limit) || isNaN(limit)) {
      throw new ValidationError(`invalid limit: '${raw.limit}' (must be a number)`);
    }
    if (limit < 1 || limit > 1000) {
      throw new ValidationError(`limit must be between 1 and 1000, got ${limit}`);
    }
    params.limit = limit;
  }

  // Message search
  if (raw.q) {
    params.q = raw.q;
  }

  // Cursor
  if (raw.cursor) {
    params.cursor = decodeCursor(raw.cursor);
  }

  // Attribute filters (attr.<key>=<value>)
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('attr.') && value !== undefined) {
      const attrKey = key.slice(5); // Remove 'attr.' prefix
      if (attrKey.length > 0) {
        attributes[attrKey] = value;
      }
    }
  }
  if (Object.keys(attributes).length > 0) {
    params.attributes = attributes;
  }

  return params;
}

/**
 * Decodes a base64 cursor string into CursorData.
 * Throws ValidationError if the cursor is malformed.
 */
export function decodeCursor(cursor: string): CursorData {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    const data = JSON.parse(decoded);

    if (!data.timestamp || !data.id) {
      throw new Error('missing fields');
    }

    // Validate the timestamp is valid
    const ts = new Date(data.timestamp);
    if (isNaN(ts.getTime())) {
      throw new Error('invalid timestamp in cursor');
    }

    // Validate id is a valid number string
    if (isNaN(Number(data.id))) {
      throw new Error('invalid id in cursor');
    }

    return {
      timestamp: data.timestamp,
      id: data.id,
    };
  } catch {
    throw new ValidationError('invalid or malformed cursor');
  }
}

/**
 * Custom error class for validation errors (results in 400 response).
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
