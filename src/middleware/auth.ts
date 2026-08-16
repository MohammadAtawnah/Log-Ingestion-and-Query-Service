import { FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';

/**
 * Creates authentication middleware.
 * When AUTH_ENABLED=true, validates Bearer tokens against the api_keys table.
 * When AUTH_ENABLED=false, all requests pass through (ignoring any Authorization header).
 */
export function createAuthMiddleware(authEnabled: boolean, loadgenApiKey: string | null, pool: Pool) {
  // Seed the loadgen API key at startup if enabled
  if (authEnabled && loadgenApiKey) {
    seedApiKey(pool, loadgenApiKey).catch(err => {
      console.error('Failed to seed loadgen API key:', err);
    });
  }

  return async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // Skip auth for health endpoint (always unauthenticated)
    const pathname = request.url.split('?')[0].replace(/\/+$/, '') || '/';
    if (pathname === '/health') return;

    // If auth is disabled, ignore any Authorization header
    if (!authEnabled) return;

    // Extract bearer token
    const authHeader = request.headers.authorization;
    const apiKeyHeader = request.headers['x-api-key'] as string | undefined;

    let token: string | null = null;

    if (authHeader) {
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (match) {
        token = match[1];
      } else {
        reply.code(401).send({ error: 'malformed Authorization header, expected: Bearer <token>' });
        return;
      }
    } else if (apiKeyHeader) {
      token = apiKeyHeader;
    }

    if (!token) {
      reply.code(401).send({ error: 'missing authentication credentials' });
      return;
    }

    // Validate the token
    const isValid = await validateApiKey(pool, token);
    if (!isValid) {
      reply.code(401).send({ error: 'invalid API key' });
      return;
    }
  };
}

/**
 * Seeds the loadgen API key in the database.
 * Idempotent — can be called multiple times safely.
 */
export async function seedApiKey(pool: Pool, apiKey: string): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'loadgen',
      permissions TEXT[] NOT NULL DEFAULT ARRAY['ingest', 'query'],
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    INSERT INTO api_keys (key, name, permissions) 
    VALUES ($1, 'loadgen', ARRAY['ingest', 'query'])
    ON CONFLICT (key) DO NOTHING
  `, [apiKey]);

  console.log('Loadgen API key seeded successfully.');
}

/**
 * Validates an API key against the database.
 */
export async function validateApiKey(pool: Pool, key: string): Promise<boolean> {
  try {
    const result = await pool.query('SELECT key FROM api_keys WHERE key = $1', [key]);
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

