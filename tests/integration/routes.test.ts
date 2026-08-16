import { createServer } from '../../src/server';
import { AppConfig } from '../../src/types';
import { Pool } from 'pg';

describe('API Route Integration Tests', () => {
  let mockPool: Partial<Pool>;
  const baseConfig: AppConfig = {
    port: 8080,
    databaseUrl: 'postgres://postgres:postgres@localhost:5432/logservice',
    retentionDays: 30,
    authEnabled: false,
    loadgenApiKey: null,
    flushIntervalMs: 50,
    flushBatchSize: 5000,
  };

  beforeEach(() => {
    mockPool = {
      query: jest.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
        if (typeof sql === 'string' && sql.includes('SELECT 1')) {
          return { rows: [{ '?column?': 1 }], rowCount: 1 };
        }
        if (typeof sql === 'string' && sql.includes('INSERT INTO logs')) {
          return { rows: [], rowCount: 1 };
        }
        if (typeof sql === 'string' && sql.includes('FROM logs') && sql.includes('SELECT id, timestamp')) {
          return {
            rows: [
              {
                id: '1',
                timestamp: new Date('2026-07-20T14:32:01.123Z'),
                level: 3,
                service: 'checkout',
                message: 'payment declined',
                attributes: { user_id: '42' },
              },
            ],
            rowCount: 1,
          };
        }
        if (typeof sql === 'string' && sql.includes('date_bin')) {
          return {
            rows: [
              {
                bucket_start: new Date('2026-07-20T14:00:00.000Z'),
                group_value: null,
                count: 42,
              },
            ],
            rowCount: 1,
          };
        }
        if (typeof sql === 'string' && sql.includes('SELECT key FROM api_keys')) {
          const key = params && params[0];
          if (key === 'valid-secret-key') {
            return { rows: [{ key: 'valid-secret-key' }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
  });

  describe('GET /health', () => {
    it('should return 200 { status: "ok" } when DB is healthy', async () => {
      const app = createServer(mockPool as Pool, baseConfig);
      const res = await app.inject({
        method: 'GET',
        url: '/health',
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ status: 'ok' });
    });

    it('should return 503 when DB connectivity fails', async () => {
      mockPool.query = jest.fn().mockRejectedValue(new Error('Connection lost'));
      const app = createServer(mockPool as Pool, baseConfig);
      const res = await app.inject({
        method: 'GET',
        url: '/health',
      });
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.payload)).toEqual({ status: 'unhealthy' });
    });
  });

  describe('POST /logs', () => {
    it('should accept a valid batch of logs and return 200', async () => {
      const app = createServer(mockPool as Pool, baseConfig);
      const res = await app.inject({
        method: 'POST',
        url: '/logs',
        headers: { 'content-type': 'application/json' },
        payload: {
          logs: [
            {
              timestamp: '2026-07-20T14:32:01.123Z',
              level: 'error',
              service: 'checkout',
              message: 'payment declined',
              attributes: { user_id: '42' },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.accepted).toBe(1);
      expect(data.rejected).toEqual([]);
    });

    it('should partially accept valid logs and report rejected ones with 200', async () => {
      const app = createServer(mockPool as Pool, baseConfig);
      const res = await app.inject({
        method: 'POST',
        url: '/logs',
        headers: { 'content-type': 'application/json' },
        payload: {
          logs: [
            {
              timestamp: '2026-07-20T14:32:01.123Z',
              level: 'error',
              service: 'checkout',
              message: 'payment declined',
            },
            {
              timestamp: '2026-07-20T14:32:01.123Z',
              level: 'invalid-level',
              service: 'checkout',
              message: 'bad log',
            },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.accepted).toBe(1);
      expect(data.rejected.length).toBe(1);
      expect(data.rejected[0].index).toBe(1);
    });

    it('should return 400 when all logs in batch are rejected', async () => {
      const app = createServer(mockPool as Pool, baseConfig);
      const res = await app.inject({
        method: 'POST',
        url: '/logs',
        headers: { 'content-type': 'application/json' },
        payload: {
          logs: [
            {
              timestamp: 'not-a-date',
              level: 'unknown',
              service: '',
              message: '',
            },
          ],
        },
      });
      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.payload);
      expect(data.accepted).toBe(0);
      expect(data.rejected.length).toBe(1);
    });

    it('should return 400 when logs array is empty', async () => {
      const app = createServer(mockPool as Pool, baseConfig);
      const res = await app.inject({
        method: 'POST',
        url: '/logs',
        headers: { 'content-type': 'application/json' },
        payload: { logs: [] },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload)).toHaveProperty('error');
    });

    it('should return 400 when body is malformed JSON', async () => {
      const app = createServer(mockPool as Pool, baseConfig);
      const res = await app.inject({
        method: 'POST',
        url: '/logs',
        headers: { 'content-type': 'application/json' },
        payload: 'not json',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /logs', () => {
    it('should query logs with valid parameters', async () => {
      const app = createServer(mockPool as Pool, baseConfig);
      const res = await app.inject({
        method: 'GET',
        url: '/logs?service=checkout&level=error&limit=10',
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.logs.length).toBe(1);
      expect(data.logs[0].service).toBe('checkout');
      expect(data.logs[0].level).toBe('error');
    });

    it('should reject invalid level with 400', async () => {
      const app = createServer(mockPool as Pool, baseConfig);
      const res = await app.inject({
        method: 'GET',
        url: '/logs?level=invalid',
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).error).toContain('invalid level');
    });

    it('should reject invalid limit with 400', async () => {
      const app = createServer(mockPool as Pool, baseConfig);
      const res = await app.inject({
        method: 'GET',
        url: '/logs?limit=5000',
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).error).toContain('limit');
    });

    it('should reject until earlier than since with 400', async () => {
      const app = createServer(mockPool as Pool, baseConfig);
      const res = await app.inject({
        method: 'GET',
        url: '/logs?since=2026-07-20T15:00:00Z&until=2026-07-20T14:00:00Z',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /logs/aggregate', () => {
    it('should aggregate logs with valid since, until, and bucket', async () => {
      const app = createServer(mockPool as Pool, baseConfig);
      const res = await app.inject({
        method: 'GET',
        url: '/logs/aggregate?since=2026-07-20T14:00:00Z&until=2026-07-20T15:00:00Z&bucket=1h',
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.buckets.length).toBe(1);
      expect(data.buckets[0].count).toBe(42);
    });

    it('should return 400 if bucket is missing', async () => {
      const app = createServer(mockPool as Pool, baseConfig);
      const res = await app.inject({
        method: 'GET',
        url: '/logs/aggregate?since=2026-07-20T14:00:00Z&until=2026-07-20T15:00:00Z',
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).error).toContain('bucket');
    });

    it('should return 400 if bucket size is invalid', async () => {
      const app = createServer(mockPool as Pool, baseConfig);
      const res = await app.inject({
        method: 'GET',
        url: '/logs/aggregate?since=2026-07-20T14:00:00Z&until=2026-07-20T15:00:00Z&bucket=10m',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('Authentication contract', () => {
    it('when AUTH_ENABLED=false, ignores unrecognized Authorization headers', async () => {
      const app = createServer(mockPool as Pool, { ...baseConfig, authEnabled: false });
      const res = await app.inject({
        method: 'GET',
        url: '/logs',
        headers: { authorization: 'Bearer random-unrecognized-token' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('when AUTH_ENABLED=true, GET /health is always unauthenticated', async () => {
      const app = createServer(mockPool as Pool, { ...baseConfig, authEnabled: true });
      const res = await app.inject({
        method: 'GET',
        url: '/health',
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ status: 'ok' });
    });

    it('when AUTH_ENABLED=true, rejects data endpoints without token with 401', async () => {
      const app = createServer(mockPool as Pool, { ...baseConfig, authEnabled: true });
      const res = await app.inject({
        method: 'GET',
        url: '/logs',
      });
      expect(res.statusCode).toBe(401);
    });

    it('when AUTH_ENABLED=true, accepts valid Bearer token with 200', async () => {
      const app = createServer(mockPool as Pool, { ...baseConfig, authEnabled: true });
      const res = await app.inject({
        method: 'GET',
        url: '/logs',
        headers: { authorization: 'Bearer valid-secret-key' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('when AUTH_ENABLED=true, rejects invalid Bearer token with 401', async () => {
      const app = createServer(mockPool as Pool, { ...baseConfig, authEnabled: true });
      const res = await app.inject({
        method: 'GET',
        url: '/logs',
        headers: { authorization: 'Bearer invalid-token' },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
