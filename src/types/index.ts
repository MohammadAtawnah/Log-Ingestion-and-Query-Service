/** Shared TypeScript types for the log ingestion service */

/** Valid log levels */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Numeric mapping for log levels (stored in DB as SMALLINT for performance) */
export const LEVEL_MAP: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Reverse mapping: number -> level string */
export const LEVEL_REVERSE: Record<number, LogLevel> = {
  0: 'debug',
  1: 'info',
  2: 'warn',
  3: 'error',
};

/** Valid log levels set for fast lookup */
export const VALID_LEVELS = new Set<string>(['debug', 'info', 'warn', 'error']);

/** Attribute values can be strings, numbers, or booleans */
export type AttributeValue = string | number | boolean;

/** Attributes are a flat key-value map */
export type LogAttributes = Record<string, AttributeValue>;

/** A raw log entry as received from the API */
export interface RawLogEntry {
  timestamp?: unknown;
  level?: unknown;
  service?: unknown;
  message?: unknown;
  attributes?: unknown;
}

/** A validated log entry ready for storage */
export interface ValidLogEntry {
  timestamp: Date;
  level: LogLevel;
  service: string;
  message: string;
  attributes: LogAttributes | null;
}

/** A log entry as returned from the database */
export interface StoredLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  attributes: LogAttributes | null;
}

/** Rejection detail for a failed log entry in a batch */
export interface RejectedEntry {
  index: number;
  reason: string;
}

/** Response from the ingest endpoint */
export interface IngestResponse {
  accepted: number;
  rejected: RejectedEntry[];
}

/** Cursor for keyset pagination */
export interface CursorData {
  timestamp: string;
  id: string;
}

/** Query parameters for GET /logs */
export interface LogQueryParams {
  service?: string;
  level?: LogLevel;
  since?: Date;
  until?: Date;
  attributes?: Record<string, string>;
  q?: string;
  limit: number;
  cursor?: CursorData;
}

/** Query parameters for GET /logs/aggregate */
export interface AggregateQueryParams {
  service?: string;
  level?: LogLevel;
  since: Date;
  until: Date;
  bucket: BucketSize;
  groupBy?: 'service' | 'level';
  attributes?: Record<string, string>;
  q?: string;
}

/** Valid bucket sizes for aggregation */
export type BucketSize = '1m' | '5m' | '1h' | '1d';

/** Bucket size to PostgreSQL interval mapping */
export const BUCKET_INTERVALS: Record<BucketSize, string> = {
  '1m': '1 minute',
  '5m': '5 minutes',
  '1h': '1 hour',
  '1d': '1 day',
};

/** Aggregation result bucket */
export interface AggregationBucket {
  start: string;
  group: string | null;
  count: number;
}

/** Response from the aggregate endpoint */
export interface AggregateResponse {
  buckets: AggregationBucket[];
}

/** Query response for GET /logs */
export interface LogQueryResponse {
  logs: StoredLogEntry[];
  next_cursor: string | null;
}

/** Application configuration */
export interface AppConfig {
  port: number;
  databaseUrl: string;
  retentionDays: number;
  authEnabled: boolean;
  loadgenApiKey: string | null;
  flushIntervalMs: number;
  flushBatchSize: number;
}
