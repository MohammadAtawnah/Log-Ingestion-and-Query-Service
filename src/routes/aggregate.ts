import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { getAggregation } from '../services/aggregate.service';
import { ValidationError } from '../services/query.service';

/**
 * Registers the GET /logs/aggregate endpoint for time-bucketed aggregation.
 */
export function registerAggregateRoute(app: FastifyInstance, pool: Pool): void {
  app.get('/logs/aggregate', async (request, reply) => {
    try {
      const rawParams = request.query as Record<string, string | undefined>;
      const result = await getAggregation(pool, rawParams);
      reply.code(200).send(result);
    } catch (err) {
      if (err instanceof ValidationError) {
        reply.code(400).send({ error: err.message });
      } else {
        console.error('Aggregation error:', err);
        reply.code(500).send({ error: 'internal server error' });
      }
    }
  });
}
