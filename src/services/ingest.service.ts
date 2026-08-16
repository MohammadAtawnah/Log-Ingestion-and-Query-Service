import { Pool } from 'pg';
import { validateBatch } from '../validation/log-validator';
import { bulkInsertLogs } from '../db/queries';
import { RawLogEntry, IngestResponse } from '../types';

/**
 * Processes a batch of log entries: validates each entry individually,
 * bulk-inserts valid ones, and returns the result.
 */
export async function ingestLogs(
  pool: Pool,
  entries: RawLogEntry[]
): Promise<IngestResponse> {
  const { valid, rejected } = validateBatch(entries);

  if (valid.length > 0) {
    await bulkInsertLogs(pool, valid);
  }

  return {
    accepted: valid.length,
    rejected,
  };
}
