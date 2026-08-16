import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';

/**
 * Registers the GET /health endpoint.
 * Returns 200 only when the database is connected and ready.
 */
export function registerHealthRoute(app: FastifyInstance, pool: Pool): void {
  app.get('/health', async (_request, reply) => {
    try {
      // Verify DB connectivity
      await pool.query('SELECT 1');
      reply.code(200).send({ status: 'ok' });
    } catch (err) {
      console.error('Health check failed:', err);
      reply.code(503).send({ status: 'unhealthy' });
    }
  });
}
