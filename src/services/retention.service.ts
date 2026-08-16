import { Pool } from 'pg';

/**
 * Manages log retention by dropping expired partitions.
 * Runs as a background interval job.
 */
export class RetentionService {
  private pool: Pool;
  private retentionDays: number;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(pool: Pool, retentionDays: number) {
    this.pool = pool;
    this.retentionDays = retentionDays;
  }

  /**
   * Starts the retention cleanup on a regular interval.
   * Defaults to running every hour.
   */
  start(intervalMs: number = 60 * 60 * 1000): void {
    console.log(`Retention service started: deleting data older than ${this.retentionDays} days, checking every ${intervalMs / 1000}s`);
    
    // Run immediately on start
    this.cleanup().catch(err => console.error('Retention cleanup error:', err));
    
    // Then run on interval
    this.intervalId = setInterval(() => {
      this.cleanup().catch(err => console.error('Retention cleanup error:', err));
    }, intervalMs);
  }

  /**
   * Stops the retention cleanup interval.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('Retention service stopped.');
    }
  }

  /**
   * Performs the actual cleanup by dropping expired partitions.
   * Also ensures future partitions exist.
   */
  async cleanup(): Promise<void> {
    const client = await this.pool.connect();
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - this.retentionDays);
      cutoff.setDate(1); // Start of the month
      cutoff.setHours(0, 0, 0, 0);

      // Find partitions to drop
      const result = await client.query(`
        SELECT inhrelid::regclass::text AS partition_name
        FROM pg_inherits
        WHERE inhparent = 'logs'::regclass
        ORDER BY inhrelid::regclass::text
      `);

      for (const row of result.rows) {
        const partitionName = row.partition_name as string;
        // Parse the partition name to get year_month (format: logs_YYYY_MM)
        const match = partitionName.match(/logs_(\d{4})_(\d{2})/);
        if (!match) continue;

        const partYear = parseInt(match[1], 10);
        const partMonth = parseInt(match[2], 10) - 1; // JS months are 0-indexed
        const partDate = new Date(partYear, partMonth, 1);

        if (partDate < cutoff) {
          console.log(`Dropping expired partition: ${partitionName}`);
          await client.query(`DROP TABLE IF EXISTS ${partitionName}`);
          console.log(`Dropped partition: ${partitionName}`);
        }
      }

      // Ensure future partitions exist (2 months ahead)
      await this.ensureFuturePartitions(client);

    } finally {
      client.release();
    }
  }

  /**
   * Creates partitions for the next 2 months if they don't already exist.
   */
  private async ensureFuturePartitions(client: import('pg').PoolClient): Promise<void> {
    const now = new Date();

    for (let i = 0; i <= 2; i++) {
      const target = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const year = target.getFullYear();
      const month = String(target.getMonth() + 1).padStart(2, '0');
      const partitionName = `logs_${year}_${month}`;

      const rangeEnd = new Date(target);
      rangeEnd.setMonth(rangeEnd.getMonth() + 1);

      const startStr = target.toISOString().split('T')[0];
      const endStr = rangeEnd.toISOString().split('T')[0];

      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${partitionName} 
          PARTITION OF logs 
          FOR VALUES FROM ('${startStr}') TO ('${endStr}')
        `);
      } catch (err: unknown) {
        const pgErr = err as { code?: string };
        if (pgErr.code !== '42P07') {
          console.error(`Error creating partition ${partitionName}:`, err);
        }
      }
    }
  }
}
