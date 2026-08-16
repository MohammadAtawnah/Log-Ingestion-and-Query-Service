import Fastify, { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { AppConfig } from './types';
import { registerHealthRoute } from './routes/health';
import { registerIngestRoute } from './routes/ingest';
import { registerQueryRoute } from './routes/query';
import { registerAggregateRoute } from './routes/aggregate';
import { createAuthMiddleware } from './middleware/auth';

/**
 * Creates and configures the Fastify application with all routes and middleware.
 */
export function createServer(pool: Pool, config: AppConfig): FastifyInstance {
  const app = Fastify({
    logger: {
      level: 'warn', // Keep logging minimal for performance
    },
    bodyLimit: 10 * 1024 * 1024, // 10MB body limit for large batches
    trustProxy: true,
    routerOptions: {
      ignoreTrailingSlash: true,
    },
  });

  // Register error handler for malformed JSON
  app.setErrorHandler((error: { statusCode?: number; code?: string; validation?: unknown; message: string }, _request, reply) => {
    if (error.statusCode === 400 && error.code === 'FST_ERR_CTP_INVALID_CONTENT_LENGTH') {
      reply.code(400).send({ error: 'invalid content length' });
      return;
    }

    if (error.validation) {
      reply.code(400).send({ error: error.message });
      return;
    }

    // Handle JSON parse errors
    if (error.statusCode === 400) {
      reply.code(400).send({ error: 'malformed JSON in request body' });
      return;
    }

    console.error('Unhandled error:', error);
    reply.code(500).send({ error: 'internal server error' });
  });

  // Register auth middleware (no-op when AUTH_ENABLED=false)
  const authMiddleware = createAuthMiddleware(config.authEnabled, config.loadgenApiKey, pool);
  app.addHook('preHandler', authMiddleware);

  // Register routes
  registerHealthRoute(app, pool);
  registerIngestRoute(app, pool);
  registerQueryRoute(app, pool);
  registerAggregateRoute(app, pool);

  return app;
}
