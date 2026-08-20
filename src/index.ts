import { loadConfig } from './config';
import { createPool, closePool } from './db/pool';
import { runMigrations } from './db/migrate';
import { createServer } from './server';
import { RetentionService } from './services/retention.service';
import { seedApiKey } from './middleware/auth';

/**
 * Application entry point.
 * 
 * Startup sequence:
 * 1. Load configuration
 * 2. Create database connection pool
 * 3. Run migrations (creates tables, partitions)
 * 4. Seed API key if auth enabled
 * 5. Create and start HTTP server
 * 6. Start retention service
 * 7. Report healthy
 */
async function main(): Promise<void> {
  const config = loadConfig();
  
  console.log('Starting Log Ingestion Service...');
  console.log(`  Port: ${config.port}`);
  console.log(`  Auth: ${config.authEnabled ? 'enabled' : 'disabled'}`);
  console.log(`  Retention: ${config.retentionDays} days`);

  // Step 1: Create database pool
  const pool = createPool(config.databaseUrl);

  // Step 2: Verify DB connection and run migrations
  console.log('Connecting to database...');
  try {
    await pool.query('SELECT 1');
    console.log('Database connected.');
  } catch (err) {
    console.error('Failed to connect to database:', err);
    process.exit(1);
  }

  console.log('Running migrations...');
  await runMigrations(pool, config.retentionDays);

  // Step 3: Seed API key before starting server if auth is enabled
  if (config.authEnabled && config.loadgenApiKey) {
    console.log('Seeding loadgen API key...');
    await seedApiKey(pool, config.loadgenApiKey);
  }

  // Step 4: Create and start HTTP server
  const app = createServer(pool, config);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`Server listening on port ${config.port}`);

  // Step 4: Start retention service
  const retention = new RetentionService(pool, config.retentionDays);
  retention.start();

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    retention.stop();
    await app.close();
    await closePool();
    console.log('Shutdown complete.');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
