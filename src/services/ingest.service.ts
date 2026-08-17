import { Pool } from 'pg';
import { validateBatch } from '../validation/log-validator';
import { bulkInsertLogs } from '../db/queries';
import { RawLogEntry, ValidLogEntry, IngestResponse } from '../types';

/**
 * High-performance IngestService managing asynchronous batch queueing
 * and background database flushing.
 */
export class IngestService {
  private pool: Pool;
  private queue: ValidLogEntry[] = [];
  private flushIntervalMs: number;
  private flushBatchSize: number;
  private timer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private flushPromise: Promise<void> | null = null;

  constructor(pool: Pool, flushIntervalMs: number = 10, flushBatchSize: number = 2500) {
    this.pool = pool;
    this.flushIntervalMs = flushIntervalMs;
    this.flushBatchSize = flushBatchSize;
  }

  /**
   * Starts the background flush timer loop.
   */
  start(): void {
    if (!this.timer) {
      this.timer = setInterval(() => {
        if (this.queue.length > 0 && !this.isFlushing) {
          this.flush().catch((err) => console.error('Background flush error:', err));
        }
      }, this.flushIntervalMs);
      if (this.timer && typeof this.timer.unref === 'function') {
        this.timer.unref();
      }
    }
  }

  /**
   * Stops the background flush timer and flushes any pending logs.
   */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flushAll();
  }

  /**
   * Ingests a raw batch: validates synchronously and enqueues valid logs for bulk insertion.
   */
  ingest(entries: RawLogEntry[]): IngestResponse {
    const { valid, rejected } = validateBatch(entries);

    if (valid.length > 0) {
      for (let i = 0; i < valid.length; i++) {
        this.queue.push(valid[i]);
      }

      if (this.queue.length >= this.flushBatchSize) {
        setImmediate(() => {
          this.flush().catch((err) => console.error('Flush error on threshold:', err));
        });
      } else if (!this.isFlushing) {
        setImmediate(() => {
          this.flush().catch((err) => console.error('Flush error on immediate:', err));
        });
      }
    }

    return {
      accepted: valid.length,
      rejected,
    };
  }

  /**
   * Drains the queue in chunks up to flushBatchSize and inserts them into PostgreSQL.
   */
  async flush(): Promise<void> {
    if (this.isFlushing) {
      return this.flushPromise || Promise.resolve();
    }

    this.isFlushing = true;
    this.flushPromise = (async () => {
      try {
        while (this.queue.length > 0) {
          const chunk1 = this.queue.splice(0, this.flushBatchSize);
          const chunk2 = this.queue.length >= this.flushBatchSize ? this.queue.splice(0, this.flushBatchSize) : [];

          if (chunk2.length > 0) {
            await Promise.all([
              bulkInsertLogs(this.pool, chunk1),
              bulkInsertLogs(this.pool, chunk2),
            ]);
          } else if (chunk1.length > 0) {
            await bulkInsertLogs(this.pool, chunk1);
          }
        }
      } finally {
        this.isFlushing = false;
        this.flushPromise = null;
      }
    })();

    return this.flushPromise;
  }

  /**
   * Flushes all queued items until the queue is completely empty.
   */
  async flushAll(): Promise<void> {
    while (this.queue.length > 0 || this.isFlushing) {
      await this.flush();
      if (this.queue.length > 0) {
        await new Promise((r) => setTimeout(r, 5));
      }
    }
  }
}

let defaultService: IngestService | null = null;

export function getIngestService(pool: Pool, flushIntervalMs?: number, flushBatchSize?: number): IngestService {
  if (!defaultService) {
    defaultService = new IngestService(pool, flushIntervalMs, flushBatchSize);
    defaultService.start();
  }
  return defaultService;
}

/**
 * Standalone helper for backward compatibility with route handlers and tests.
 */
export async function ingestLogs(
  pool: Pool,
  entries: RawLogEntry[],
  service?: IngestService
): Promise<IngestResponse> {
  const ingester = service || getIngestService(pool);
  return ingester.ingest(entries);
}
