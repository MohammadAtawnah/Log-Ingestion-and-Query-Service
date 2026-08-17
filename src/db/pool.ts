import { Pool, PoolConfig } from 'pg';

let pool: Pool | null = null;

/**
 * Creates and returns the PostgreSQL connection pool.
 * Uses a singleton pattern — calling this multiple times returns the same pool.
 */
export function createPool(connectionString: string): Pool {
  if (pool) return pool;

  const config: PoolConfig = {
    connectionString,
    max: 50,                    // Max concurrent connections
    idleTimeoutMillis: 10000,   // Close idle connections after 10s
    connectionTimeoutMillis: 10000, // 10s connection timeout
    statement_timeout: 30000,   // 30s query timeout
  };

  pool = new Pool(config);

  pool.on('error', (err) => {
    console.error('Unexpected pool error:', err);
  });

  return pool;
}

/**
 * Returns the existing pool instance.
 * Throws if the pool hasn't been created yet.
 */
export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call createPool() first.');
  }
  return pool;
}

/**
 * Closes the pool gracefully.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
