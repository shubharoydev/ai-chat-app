/**
 * Write-reduction measurement harness.
 *
 * Purpose
 * -------
 * The repository contains no baseline implementation and no benchmark, so the
 * popular "60% fewer database writes" claim cannot be compared against
 * anything. This harness instead MEASURES the two distinct metrics that the
 * ambiguous phrase could mean, under an identical workload:
 *
 *   - write COMMANDS / round trips  (database write operations)
 *   - documents / records written   (individual record writes)
 *
 * It compares:
 *   A. Baseline "one write per message" (await updateOne per message)
 *   B. Batched "one write command per batch" (bulkWrite chunks) - the strategy
 *      used by backend/workers/messageWorker.js
 *
 * Counts are read from MongoDB's own serverStatus metrics before/after each
 * variant: metrics.commands.* counts commands (round trips) and opcounters.*
 * counts document operations.
 *
 * Run (from the repository root, with the local Mongo running):
 *   node performance/write-reduction/measure-write-reduction.mjs
 *
 * Optional env:
 *   BENCH_MONGO_URI   (default mongodb://localhost:27017/chatapp_writebench)
 *   BENCH_N           (default 2000)
 *   BENCH_BATCH_SIZES (default 1,2,10,100,1000)
 *
 * No data outside the dedicated benchmark database is touched.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

// Resolve mongoose from the backend workspace (where it is installed).
const requireFromBackend = createRequire(new URL('../../backend/package.json', import.meta.url));
const mongoose = requireFromBackend('mongoose');

const MONGO_URI = process.env.BENCH_MONGO_URI || 'mongodb://localhost:27017/chatapp_writebench';
const N = Number(process.env.BENCH_N) || 2000;
const BATCH_SIZES = (process.env.BENCH_BATCH_SIZES || '1,2,10,100,1000')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const buildDoc = (i) => ({
  messageId: `bench-${i}`,
  chatId: `bench-chat-${i % 100}`,
  userId: '507f1f77bcf86cd799439011',
  friendId: '507f1f77bcf86cd799439012',
  content: `benchmark message ${i}`,
  timestamp: new Date(),
  isAI: false,
});

// Reads the server-wide counters. writeCommands counts insert/update/
// findAndModify commands (one per round trip); recordsWritten counts document
// operations. Deliberately excludes deletes (benchmark cleanup).
const getServerCounters = async () => {
  const status = await mongoose.connection.db.admin().command({ serverStatus: 1 });
  const c = status.metrics.commands;
  return {
    writeCommands:
      (c.update?.total || 0) + (c.insert?.total || 0) + (c.findAndModify?.total || 0),
    recordsWritten: (status.opcounters.update || 0) + (status.opcounters.insert || 0),
  };
};

const measure = async (fn) => {
  const before = await getServerCounters();
  const start = process.hrtime.bigint();
  await fn();
  const wallMs = Number(process.hrtime.bigint() - start) / 1e6;
  const after = await getServerCounters();
  return {
    writeCommands: after.writeCommands - before.writeCommands,
    recordsWritten: after.recordsWritten - before.recordsWritten,
    wallMs: Number(wallMs.toFixed(1)),
  };
};

const runBaselinePerMessage = async (collection) => {
  for (let i = 0; i < N; i++) {
    const doc = buildDoc(i);
    await collection.updateOne(
      { messageId: doc.messageId },
      { $setOnInsert: doc },
      { upsert: true },
    );
  }
};

const runBatched = async (collection, batchSize) => {
  for (let start = 0; start < N; start += batchSize) {
    const ops = [];
    for (let i = start; i < Math.min(start + batchSize, N); i++) {
      const doc = buildDoc(i);
      ops.push({
        updateOne: {
          filter: { messageId: doc.messageId },
          update: { $setOnInsert: doc },
          upsert: true,
        },
      });
    }
    if (ops.length) {
      await collection.bulkWrite(ops, { ordered: false });
    }
  }
};

const main = async () => {
  console.log('Write-reduction measurement harness');
  console.log('====================================');
  console.log(`MongoDB        : ${MONGO_URI}`);
  console.log(`Messages (N)   : ${N}`);
  console.log(`Batch sizes    : ${BATCH_SIZES.join(', ')}`);
  console.log('');

  await mongoose.connect(MONGO_URI);
  const collection = mongoose.connection.collection('messages_bench');

  // Warmup (connection, indexes) - not measured.
  await collection.deleteMany({});
  await runBatched(collection, 100);
  await collection.deleteMany({});
  await sleep(100);

  const results = [];

  // Baseline: one write command per message.
  await collection.deleteMany({});
  const baseline = await measure(() => runBaselinePerMessage(collection));
  await collection.deleteMany({});
  const baselineCommands = baseline.writeCommands;

  results.push({
    variant: 'baseline (1 write per message)',
    batchSize: 1,
    ...baseline,
    commandReductionPct: 0,
  });

  // Batched variants.
  for (const batchSize of BATCH_SIZES) {
    if (batchSize === 1) continue; // baseline already covers size 1
    await collection.deleteMany({});
    const r = await measure(() => runBatched(collection, batchSize));
    await collection.deleteMany({});
    r.commandReductionPct = baselineCommands
      ? Number((((baselineCommands - r.writeCommands) / baselineCommands) * 100).toFixed(1))
      : 0;
    results.push({ variant: `batched (bulkWrite, batch=${batchSize})`, batchSize, ...r });
  }

  console.log('| Variant | Batch size | Write commands (round trips) | Records written | Wall (ms) | Command reduction vs baseline |');
  console.log('|---|---|---|---|---|---|');
  for (const r of results) {
    console.log(
      `| ${r.variant} | ${r.batchSize} | ${r.writeCommands} | ${r.recordsWritten} | ${r.wallMs} | ${r.commandReductionPct}% |`,
    );
  }
  console.log('');
  for (const r of results) {
    if (r.recordsWritten !== N) {
      console.log(`WARNING: ${r.variant} wrote ${r.recordsWritten} records (expected ${N}).`);
    }
  }
  console.log(`Document-level reduction (records written) for every variant: 0% (always ${N} records for ${N} messages).`);
  console.log('Interpretation: any percentage "write reduction" refers ONLY to the number of');
  console.log('database write COMMANDS / round trips, which scales with batch size. The number of');
  console.log('individual records persisted is unchanged.');

  const outDir = path.join(repoRoot, 'performance', 'write-reduction');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    mongoUri: MONGO_URI,
    n: N,
    note: 'writeCommands and recordsWritten are deltas read from serverStatus metrics.commands and opcounters.',
    results,
  }, null, 2));
  console.log('');
  console.log(`Raw results written to: ${path.relative(repoRoot, outFile)}`);

  await mongoose.disconnect();
};

main().catch((err) => {
  console.error('Benchmark failed:', err.message);
  process.exit(1);
});
