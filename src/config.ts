import { AppConfig } from './types';

/**
 * Loads application configuration from environment variables with sensible defaults.
 * All optional features default to OFF per the spec requirement.
 */
export function loadConfig(): AppConfig {
  return {
    port: parseInt(process.env.PORT || '8080', 10),
    databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/logservice',
    retentionDays: parseInt(process.env.RETENTION_DAYS || '30', 10),
    authEnabled: process.env.AUTH_ENABLED === 'true',
    loadgenApiKey: process.env.LOADGEN_API_KEY || null,
    flushIntervalMs: parseInt(process.env.FLUSH_INTERVAL_MS || '50', 10),
    flushBatchSize: parseInt(process.env.FLUSH_BATCH_SIZE || '5000', 10),
  };
}
