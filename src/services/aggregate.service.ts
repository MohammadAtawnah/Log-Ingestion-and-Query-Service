import { Pool } from 'pg';
import { aggregateLogs } from '../db/queries';
import {
  AggregateQueryParams,
  AggregateResponse,
  VALID_LEVELS,
  LogLevel,
  BucketSize,
} from '../types';
import { ValidationError } from './query.service';

/** Valid bucket sizes */
const VALID_BUCKETS = new Set<string>(['1m', '5m', '1h', '1d']);

/**
 * Parses and validates parameters for GET /logs/aggregate, then executes the query.
 */
export async function getAggregation(
  pool: Pool,
  rawParams: Record<string, string | undefined>
): Promise<AggregateResponse> {
  const params = parseAggregateParams(rawParams);
  const buckets = await aggregateLogs(pool, params);
  return { buckets };
}

/**
 * Parses raw query string parameters into validated AggregateQueryParams.
 * Throws ValidationError for missing or invalid parameters.
 */
export function parseAggregateParams(raw: Record<string, string | undefined>): AggregateQueryParams {
  // Required: since
  if (!raw.since) {
    throw new ValidationError("missing required parameter: 'since'");
  }
  const since = new Date(raw.since);
  if (isNaN(since.getTime())) {
    throw new ValidationError(`invalid timestamp for 'since': '${raw.since}'`);
  }

  // Required: until
  if (!raw.until) {
    throw new ValidationError("missing required parameter: 'until'");
  }
  const until = new Date(raw.until);
  if (isNaN(until.getTime())) {
    throw new ValidationError(`invalid timestamp for 'until': '${raw.until}'`);
  }

  // since must be before until
  if (since >= until) {
    throw new ValidationError("'until' must be after 'since'");
  }

  // Required: bucket
  if (!raw.bucket) {
    throw new ValidationError("missing required parameter: 'bucket'");
  }
  if (!VALID_BUCKETS.has(raw.bucket)) {
    throw new ValidationError(`invalid bucket size: '${raw.bucket}' (must be one of: 1m, 5m, 1h, 1d)`);
  }
  const bucket = raw.bucket as BucketSize;

  // Optional: group_by
  let groupBy: 'service' | 'level' | undefined;
  if (raw.group_by) {
    if (raw.group_by !== 'service' && raw.group_by !== 'level') {
      throw new ValidationError(`invalid group_by: '${raw.group_by}' (must be 'service' or 'level')`);
    }
    groupBy = raw.group_by;
  }

  // Optional: service filter
  const params: AggregateQueryParams = { since, until, bucket, groupBy };

  if (raw.service) {
    params.service = raw.service;
  }

  if (raw.level) {
    if (!VALID_LEVELS.has(raw.level)) {
      throw new ValidationError(`invalid level: '${raw.level}'`);
    }
    params.level = raw.level as LogLevel;
  }

  if (raw.q) {
    params.q = raw.q;
  }

  // Attribute filters
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('attr.') && value !== undefined) {
      const attrKey = key.slice(5);
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
