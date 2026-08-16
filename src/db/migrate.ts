import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Runs database migrations in order.
 * Checks schema_migrations table to skip already-applied migrations.
 * Creates partitions for the logs table based on retention period.
 */
export async function runMigrations(pool: Pool, retentionDays: number): Promise<void> {
  const client = await pool.connect();
  try {
    // Run migration SQL files in order
    const migrationsDir = path.resolve(__dirname, '../../migrations');
    
    if (!fs.existsSync(migrationsDir)) {
      console.warn('No migrations directory found, skipping migrations.');
      return;
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const version = parseInt(file.split('_')[0], 10);
      
      // Check if migration already applied
      try {
        const result = await client.query(
          'SELECT version FROM schema_migrations WHERE version = $1',
          [version]
        );
        if (result.rows.length > 0) {
          console.log(`Migration ${file} already applied, skipping.`);
          continue;
        }
      } catch {
        // schema_migrations table doesn't exist yet, run the migration
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`Applying migration: ${file}`);
      await client.query(sql);
      console.log(`Migration ${file} applied successfully.`);
    }

    // Create partitions for current and future months
    await createPartitions(client, retentionDays);

    console.log('All migrations completed.');
  } finally {
    client.release();
  }
}

/**
 * Creates monthly partitions for the logs table.
 * Creates partitions covering from (now - retentionDays) to (now + 2 months ahead).
 */
async function createPartitions(client: import('pg').PoolClient, retentionDays: number): Promise<void> {
  const now = new Date();
  
  // Start from beginning of retention period month
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - retentionDays);
  startDate.setDate(1);
  startDate.setHours(0, 0, 0, 0);

  // End 2 months in the future
  const endDate = new Date(now);
  endDate.setMonth(endDate.getMonth() + 3);
  endDate.setDate(1);
  endDate.setHours(0, 0, 0, 0);

  const current = new Date(startDate);
  while (current < endDate) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const partitionName = `logs_${year}_${month}`;

    const rangeStart = new Date(current);
    const rangeEnd = new Date(current);
    rangeEnd.setMonth(rangeEnd.getMonth() + 1);

    const startStr = rangeStart.toISOString().split('T')[0];
    const endStr = rangeEnd.toISOString().split('T')[0];

    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${partitionName} 
        PARTITION OF logs 
        FOR VALUES FROM ('${startStr}') TO ('${endStr}')
      `);
      console.log(`Partition ${partitionName} ready (${startStr} to ${endStr}).`);
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      // Partition already exists — that's fine
      if (pgErr.code !== '42P07') {
        throw err;
      }
    }

    current.setMonth(current.getMonth() + 1);
  }
}
