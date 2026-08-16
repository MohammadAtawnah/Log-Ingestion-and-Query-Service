import {
  ValidLogEntry,
  LEVEL_MAP,
  LogQueryParams,
  AggregateQueryParams,
  BUCKET_INTERVALS,
  LEVEL_REVERSE,
  StoredLogEntry,
  AggregationBucket,
  LogAttributes,
} from '../types';
import { Pool } from 'pg';

/**
 * Inserts a batch of validated log entries using multi-row INSERT with unnest().
 * This is significantly faster than individual INSERTs and safer than raw COPY.
 * 
 * unnest() approach: build parallel arrays for each column and insert in one statement.
 */
export async function bulkInsertLogs(pool: Pool, logs: ValidLogEntry[]): Promise<void> {
  if (logs.length === 0) return;

  const timestamps: string[] = [];
  const levels: number[] = [];
  const services: string[] = [];
  const messages: string[] = [];
  const attributes: (string | null)[] = [];

  for (const log of logs) {
    timestamps.push(log.timestamp.toISOString());
    levels.push(LEVEL_MAP[log.level]);
    services.push(log.service);
    messages.push(log.message);
    attributes.push(log.attributes ? JSON.stringify(log.attributes) : null);
  }

  await pool.query(
    `INSERT INTO logs (timestamp, level, service, message, attributes)
     SELECT * FROM unnest(
       $1::timestamptz[],
       $2::smallint[],
       $3::text[],
       $4::text[],
       $5::jsonb[]
     )`,
    [timestamps, levels, services, messages, attributes]
  );
}

/**
 * Builds and executes a parameterized query for GET /logs.
 * Supports all filter combinations with keyset cursor pagination.
 */
export async function queryLogs(pool: Pool, params: LogQueryParams): Promise<{ logs: StoredLogEntry[]; nextCursor: string | null }> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  // Service filter
  if (params.service) {
    conditions.push(`service = $${paramIndex++}`);
    values.push(params.service);
  }

  // Level filter
  if (params.level) {
    conditions.push(`level = $${paramIndex++}`);
    values.push(LEVEL_MAP[params.level]);
  }

  // Time range filters
  if (params.since) {
    conditions.push(`timestamp >= $${paramIndex++}`);
    values.push(params.since.toISOString());
  }

  if (params.until) {
    conditions.push(`timestamp < $${paramIndex++}`);
    values.push(params.until.toISOString());
  }

  // Attribute filters (attr.<key>=<value>)
  if (params.attributes) {
    for (const [key, value] of Object.entries(params.attributes)) {
      // Use JSONB containment operator for indexed lookups
      conditions.push(`attributes @> $${paramIndex++}::jsonb`);
      values.push(JSON.stringify({ [key]: value }));
    }
  }

  // Message substring search (case-insensitive)
  if (params.q) {
    conditions.push(`message ILIKE $${paramIndex++}`);
    values.push(`%${params.q}%`);
  }

  // Cursor-based keyset pagination
  if (params.cursor) {
    conditions.push(`(timestamp, id) < ($${paramIndex++}::timestamptz, $${paramIndex++}::bigint)`);
    values.push(params.cursor.timestamp, params.cursor.id);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  // Fetch one extra row to determine if there's a next page
  const fetchLimit = params.limit + 1;

  const query = `
    SELECT id, timestamp, level, service, message, attributes
    FROM logs
    ${whereClause}
    ORDER BY timestamp DESC, id DESC
    LIMIT $${paramIndex}
  `;
  values.push(fetchLimit);

  const result = await pool.query(query, values);
  const hasMore = result.rows.length > params.limit;
  const rows = hasMore ? result.rows.slice(0, params.limit) : result.rows;

  const logs: StoredLogEntry[] = rows.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    timestamp: (row.timestamp as Date).toISOString(),
    level: LEVEL_REVERSE[row.level as number],
    service: row.service as string,
    message: row.message as string,
    attributes: (row.attributes as LogAttributes | null) || null,
  }));

  let nextCursor: string | null = null;
  if (hasMore && rows.length > 0) {
    const lastRow = rows[rows.length - 1];
    const cursorData = {
      timestamp: (lastRow.timestamp as Date).toISOString(),
      id: String(lastRow.id),
    };
    nextCursor = Buffer.from(JSON.stringify(cursorData)).toString('base64');
  }

  return { logs, nextCursor };
}

/**
 * Builds and executes a parameterized aggregation query for GET /logs/aggregate.
 * Uses date_bin() for accurate time bucketing with optional group_by.
 */
export async function aggregateLogs(pool: Pool, params: AggregateQueryParams): Promise<AggregationBucket[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  // Time range is required for aggregation
  conditions.push(`timestamp >= $${paramIndex++}`);
  values.push(params.since.toISOString());
  conditions.push(`timestamp < $${paramIndex++}`);
  values.push(params.until.toISOString());

  // Optional filters
  if (params.service) {
    conditions.push(`service = $${paramIndex++}`);
    values.push(params.service);
  }

  if (params.level) {
    conditions.push(`level = $${paramIndex++}`);
    values.push(LEVEL_MAP[params.level]);
  }

  if (params.attributes) {
    for (const [key, value] of Object.entries(params.attributes)) {
      conditions.push(`attributes @> $${paramIndex++}::jsonb`);
      values.push(JSON.stringify({ [key]: value }));
    }
  }

  if (params.q) {
    conditions.push(`message ILIKE $${paramIndex++}`);
    values.push(`%${params.q}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const interval = BUCKET_INTERVALS[params.bucket];

  let groupByColumn: string;
  let selectGroup: string;
  let groupByClause: string;

  if (params.groupBy === 'service') {
    selectGroup = 'service AS group_value';
    groupByColumn = ', service';
    groupByClause = ', service';
  } else if (params.groupBy === 'level') {
    selectGroup = 'level AS group_value';
    groupByColumn = ', level';
    groupByClause = ', level';
  } else {
    selectGroup = 'NULL AS group_value';
    groupByColumn = '';
    groupByClause = '';
  }

  const query = `
    SELECT
      date_bin('${interval}'::interval, timestamp, $${paramIndex}::timestamptz) AS bucket_start,
      ${selectGroup},
      COUNT(*)::integer AS count
    FROM logs
    ${whereClause}
    GROUP BY bucket_start${groupByClause}
    ORDER BY bucket_start ASC${groupByColumn}
  `;
  values.push(params.since.toISOString());

  const result = await pool.query(query, values);

  return result.rows.map((row: Record<string, unknown>) => {
    let group: string | null = null;
    if (params.groupBy === 'level' && row.group_value !== null) {
      group = LEVEL_REVERSE[row.group_value as number] || null;
    } else if (params.groupBy === 'service') {
      group = row.group_value as string;
    }

    return {
      start: (row.bucket_start as Date).toISOString(),
      group,
      count: row.count as number,
    };
  });
}
