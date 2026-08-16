/**
 * High-performance load test script for the Log Ingestion Service.
 * Simulates high-throughput log ingestion and concurrent query load.
 * Measures throughput (logs/sec), query response times, and latency percentiles (p50, p95, p99).
 * 
 * Usage:
 *   npx ts-node scripts/load-test.ts [options]
 * 
 * Options via environment variables:
 *   TARGET_URL: Base URL (default: http://localhost:8080)
 *   TOTAL_LOGS: Total logs to ingest (default: 100000)
 *   BATCH_SIZE: Logs per POST /logs batch (default: 2000)
 *   CONCURRENCY: Concurrent worker streams (default: 8)
 *   AUTH_TOKEN: Bearer token if auth enabled (default: none)
 */

import * as http from 'http';

const TARGET_URL = process.env.TARGET_URL || 'http://localhost:8080';
const TOTAL_LOGS = parseInt(process.env.TOTAL_LOGS || '100000', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '2000', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '8', 10);
const AUTH_TOKEN = process.env.AUTH_TOKEN || null;

const SERVICES = ['checkout', 'payment', 'auth-service', 'inventory', 'order-processor', 'frontend-gateway', 'notification', 'recommendation'];
const LEVELS = ['debug', 'info', 'warn', 'error'];
const MESSAGES = [
  'payment declined due to insufficient funds',
  'user authentication successful',
  'cache miss for product details',
  'database connection pool acquiring client',
  'order processed successfully with tracking id',
  'inventory reservation timed out',
  'rate limit threshold exceeded for client ip',
  'background retention partition created',
];

interface LatencyStats {
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

function calculatePercentiles(latencies: number[]): LatencyStats {
  if (latencies.length === 0) {
    return { count: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
  }

  latencies.sort((a, b) => a - b);
  const sum = latencies.reduce((acc, v) => acc + v, 0);
  const avg = sum / latencies.length;
  const min = latencies[0];
  const max = latencies[latencies.length - 1];

  const p50 = latencies[Math.floor(latencies.length * 0.50)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];

  return { count: latencies.length, min, max, avg, p50, p95, p99 };
}

function generateBatch(size: number): Record<string, unknown>[] {
  const batch: Record<string, unknown>[] = [];
  const now = Date.now();

  for (let i = 0; i < size; i++) {
    const service = SERVICES[Math.floor(Math.random() * SERVICES.length)];
    const level = LEVELS[Math.floor(Math.random() * LEVELS.length)];
    const message = MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
    const timestamp = new Date(now - Math.floor(Math.random() * 3600000)).toISOString();

    batch.push({
      timestamp,
      level,
      service,
      message,
      attributes: {
        user_id: String(Math.floor(Math.random() * 10000)),
        region: ['us-east', 'eu-west', 'ap-south', 'sa-east'][Math.floor(Math.random() * 4)],
        duration_ms: Math.floor(Math.random() * 500),
        success: Math.random() > 0.1,
      },
    });
  }

  return batch;
}

function sendRequest(
  method: string,
  path: string,
  body?: string
): Promise<{ statusCode: number; duration: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, TARGET_URL);
    const headers: Record<string, string> = {};

    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(body));
    }

    if (AUTH_TOKEN) {
      headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
    }

    const start = performance.now();
    const req = http.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        let resBody = '';
        res.on('data', (chunk) => (resBody += chunk));
        res.on('end', () => {
          const duration = performance.now() - start;
          resolve({ statusCode: res.statusCode || 0, duration, body: resBody });
        });
      }
    );

    req.on('error', (err) => reject(err));

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function runLoadTest(): Promise<void> {
  console.log('='.repeat(60));
  console.log('🚀 LOG INGESTION & QUERY SERVICE — LOAD TEST');
  console.log('='.repeat(60));
  console.log(`Target URL:    ${TARGET_URL}`);
  console.log(`Total Logs:    ${TOTAL_LOGS.toLocaleString()}`);
  console.log(`Batch Size:    ${BATCH_SIZE.toLocaleString()}`);
  console.log(`Concurrency:   ${CONCURRENCY}`);
  console.log(`Auth Token:    ${AUTH_TOKEN ? 'Present' : 'None'}`);
  console.log('-'.repeat(60));

  // Step 1: Health Check
  console.log('Step 1: Checking Service Health...');
  try {
    const health = await sendRequest('GET', '/health');
    if (health.statusCode !== 200) {
      console.error(`Health check failed with status ${health.statusCode}: ${health.body}`);
      process.exit(1);
    }
    console.log('✓ Service is healthy.\n');
  } catch (err) {
    console.error(`Cannot connect to service at ${TARGET_URL}:`, err);
    console.log('\nPlease start the service first (e.g. docker compose up) before running load tests.');
    process.exit(1);
  }

  // Step 2: Ingestion Benchmark with Concurrent Querying
  console.log(`Step 2: Ingesting ${TOTAL_LOGS.toLocaleString()} logs across ${CONCURRENCY} concurrent workers...`);

  const totalBatches = Math.ceil(TOTAL_LOGS / BATCH_SIZE);
  let completedBatches = 0;
  let totalAccepted = 0;
  let totalRejected = 0;

  const ingestLatencies: number[] = [];
  const queryLatencies: number[] = [];
  const aggLatencies: number[] = [];

  let isIngesting = true;

  // Background query worker (1 query/sec aggregate + filter queries)
  const queryWorker = async () => {
    while (isIngesting) {
      try {
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const until = new Date(Date.now() + 60 * 1000).toISOString();

        // 1. Aggregation query
        const aggRes = await sendRequest(
          'GET',
          `/logs/aggregate?since=${since}&until=${until}&bucket=1h&group_by=service`
        );
        if (aggRes.statusCode === 200) {
          aggLatencies.push(aggRes.duration);
        }

        // 2. Filtered logs query
        const queryRes = await sendRequest(
          'GET',
          `/logs?service=checkout&level=error&limit=50`
        );
        if (queryRes.statusCode === 200) {
          queryLatencies.push(queryRes.duration);
        }
      } catch {
        // Ignore background query errors during shutdown
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  };

  const queryPromise = queryWorker();

  // Ingestion worker pool
  const startTime = performance.now();
  let batchIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const currentBatchIdx = batchIndex++;
      if (currentBatchIdx >= totalBatches) break;

      const count = Math.min(BATCH_SIZE, TOTAL_LOGS - currentBatchIdx * BATCH_SIZE);
      const batch = generateBatch(count);
      const payload = JSON.stringify({ logs: batch });

      try {
        const res = await sendRequest('POST', '/logs', payload);
        ingestLatencies.push(res.duration);

        if (res.statusCode === 200) {
          const data = JSON.parse(res.body);
          totalAccepted += data.accepted || 0;
          totalRejected += (data.rejected || []).length;
        } else {
          console.error(`Batch ${currentBatchIdx} returned status ${res.statusCode}: ${res.body}`);
        }
      } catch (err) {
        console.error(`Batch ${currentBatchIdx} failed:`, err);
      }

      completedBatches++;
      if (completedBatches % Math.max(1, Math.floor(totalBatches / 10)) === 0 || completedBatches === totalBatches) {
        const elapsed = (performance.now() - startTime) / 1000;
        const currentRate = Math.round(totalAccepted / elapsed);
        console.log(
          `  Progress: ${completedBatches}/${totalBatches} batches (${totalAccepted.toLocaleString()} logs) | Speed: ${currentRate.toLocaleString()} logs/s`
        );
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  isIngesting = false;
  await queryPromise;

  const totalDurationSeconds = (performance.now() - startTime) / 1000;
  const throughput = Math.round(totalAccepted / totalDurationSeconds);

  const ingestStats = calculatePercentiles(ingestLatencies);
  const aggStats = calculatePercentiles(aggLatencies);
  const queryStats = calculatePercentiles(queryLatencies);

  // Print Results
  console.log('\n' + '='.repeat(60));
  console.log('📊 BENCHMARK RESULTS SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Ingested:    ${totalAccepted.toLocaleString()} logs (${totalRejected} rejected)`);
  console.log(`Duration:          ${totalDurationSeconds.toFixed(2)}s`);
  console.log(`Throughput:        ${throughput.toLocaleString()} logs/second`);
  console.log('-'.repeat(60));
  console.log('Batch Ingestion Latency:');
  console.log(`  Avg: ${ingestStats.avg.toFixed(1)}ms | p50: ${ingestStats.p50.toFixed(1)}ms | p95: ${ingestStats.p95.toFixed(1)}ms | p99: ${ingestStats.p99.toFixed(1)}ms`);
  console.log('-'.repeat(60));
  console.log('Concurrent Aggregation Latency (/logs/aggregate):');
  console.log(`  Avg: ${aggStats.avg.toFixed(1)}ms | p50: ${aggStats.p50.toFixed(1)}ms | p95: ${aggStats.p95.toFixed(1)}ms | p99: ${aggStats.p99.toFixed(1)}ms`);
  console.log('-'.repeat(60));
  console.log('Concurrent Filter Query Latency (/logs):');
  console.log(`  Avg: ${queryStats.avg.toFixed(1)}ms | p50: ${queryStats.p50.toFixed(1)}ms | p95: ${queryStats.p95.toFixed(1)}ms | p99: ${queryStats.p99.toFixed(1)}ms`);
  console.log('='.repeat(60));

  if (throughput >= 15000) {
    console.log(`✅ PERFORMANCE TARGET ACHIEVED: ${throughput.toLocaleString()} logs/s >= 15,000 logs/s baseline target.`);
  } else {
    console.log(`⚠️ Throughput was ${throughput.toLocaleString()} logs/s (baseline: 15,000 logs/s).`);
  }

  if (aggStats.p95 <= 1000) {
    console.log(`✅ AGGREGATION TARGET ACHIEVED: p95 ${aggStats.p95.toFixed(1)}ms <= 1,000ms target.`);
  }
}

if (require.main === module) {
  runLoadTest().catch(console.error);
}
