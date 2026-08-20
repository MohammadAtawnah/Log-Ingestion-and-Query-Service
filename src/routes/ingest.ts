import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { ingestLogs } from '../services/ingest.service';

/**
 * Registers the POST /logs endpoint for batch log ingestion.
 */
export function registerIngestRoute(app: FastifyInstance, pool: Pool): void {
  app.post('/logs', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>;

      // Validate top-level structure
      if (!body || typeof body !== 'object') {
        reply.code(400).send({ error: 'request body must be a JSON object' });
        return;
      }

      if (!body.logs || !Array.isArray(body.logs)) {
        reply.code(400).send({ error: "request body must contain a 'logs' array" });
        return;
      }

      if (body.logs.length === 0) {
        reply.code(400).send({ error: "'logs' array must not be empty" });
        return;
      }

      const result = await ingestLogs(pool, body.logs);

      if (result.accepted === 0) {
        // All entries rejected
        reply.code(400).send(result);
      } else {
        reply.code(200).send(result);
      }
    } catch (err) {
      console.error('Ingestion error:', err);
      reply.code(500).send({ error: 'internal server error' });
    }
  });
}
