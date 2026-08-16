import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { searchLogs, ValidationError } from '../services/query.service';

/**
 * Registers the GET /logs endpoint for querying logs.
 */
export function registerQueryRoute(app: FastifyInstance, pool: Pool): void {
  app.get('/logs', async (request, reply) => {
    try {
      const rawParams = request.query as Record<string, string | undefined>;
      const result = await searchLogs(pool, rawParams);
      reply.code(200).send(result);
    } catch (err) {
      if (err instanceof ValidationError) {
        reply.code(400).send({ error: err.message });
      } else {
        console.error('Query error:', err);
        reply.code(500).send({ error: 'internal server error' });
      }
    }
  });
}
