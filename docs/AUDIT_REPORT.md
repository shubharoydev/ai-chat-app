# Audit Report — Kafka Persistence & Performance

Date: 2026-10-11
Status: complete for the tested scope. Evidence collected from code inspection,
12 automated tests against real infrastructure, a MongoDB write benchmark, and
k6 HTTP load tests.

## Executive summary

The Kafka-backed persistence path works and is durable: messages sent through the
API are persisted to MongoDB through Kafka, persistence is idempotent, Kafka
offsets are committed only after a successful DB write, and poison messages are
dead-lettered. These behaviours are covered by 12 passing tests and corroborated
by load testing (2569/2569 messages persisted).

**The headline "60% write reduction" claim is unsupported.** That exact claim
does not exist anywhere in the repository or its git history, and no baseline or
benchmark accompanies it. A benchmark written for this audit shows that batching
`bulkWrite` reduces *write commands / round-trips* (not stored documents) as a
function of batch size — ~50% at batch 2, 90% at 10 — so a ~60% figure only holds
at a specific (small) batch size under an insert-heavy workload. It must not be
presented as a fixed, general saving.

## Priority status table

| Priority | Area | Status |
| :--- | :--- | :--- |
| 1 | "60% write reduction" claim | **Unverified / Unsupported** |
| 2 | Message persistence through Kafka (happy path) | **Verified** |
| 3 | Idempotency / no duplicates on redelivery | **Verified** |
| 4 | Offset-after-persist; DLQ on poison message | **Verified** |
| 5 | Partitioning / ordering / graceful shutdown / read-order bug | **Partial / Incorrect** |

Detail: `docs/architecture-audit.md`, `docs/architecture.md`,
`docs/reliability-test-results.md`, `docs/performance-results.md`,
`docs/k6-runbook.md`.

## 1. Claims that are safe to make now
- Messages are durably persisted to MongoDB through Kafka (2569/2569 in testing).
- Persistence is idempotent on the unique `messageId`; redelivery does not
  duplicate records.
- Kafka offsets are committed only after a successful Mongo write.
- Poison messages are dead-lettered; the offset is committed only after a
  successful DLQ delivery.

## 2. Claims that must be corrected or withdrawn
- **"60% write reduction"** → unverified/unsupported; restate as write-command
  reduction at a specified batch size.
- **"Partition-based scaling"** / "3-broker streaming" → brokers exist, but the
  topic is created with `numPartitions: 1`; no partition-level parallelism.
- **"Worker pause at 5000 messages"** → the documented `MAX_BUFFER_SIZE` logic is
  not implemented.
- **Per-message ordering** → not guaranteed (messages published without a key).

## 3. Verified defects
1. Read path returns the wrong 20 messages / inconsistent order (`slice(-20)` on a
   newest-first Redis list) — `chatService.js:151`.
2. `publishToKafka` sends no partition key — `chatService.js:19-22`.
3. Documented `MAX_BUFFER_SIZE`/pause logic absent — `messageWorker.js`.
4. Dead code `messageService.persistMessagesFromKafka`.
5. Uncoordinated graceful shutdown; in-memory buffer can be dropped on exit.
6. (Fixed in this audit) DLQ failure previously committed the offset → silent loss.

## 4. Tests: passed / failed / not run
- Passed: **12/12** Jest (`npm test`) — 3 validator, 5 unit, 4 integration.
- Passed: k6 smoke (1 VU × 5) and k6 load (20 VUs, ~1m40s), 0% failed requests.
- Failed: none.
- Not run: multi-partition scaling, broker-failure/leader-election, soak >1h,
  Aiven cloud path, Gemini `/ai ` path, consumer-lag tooling.

## 5. Reproduction commands
```powershell
docker compose up -d zookeeper1 zookeeper2 zookeeper3 kafka kafka2 kafka3 mongodb redis
cd backend; npm test
node performance/write-reduction/measure-write-reduction.mjs
performance\k6\start-backend-local.cmd
k6 run -e PROFILE=smoke -e BASE_URL=http://localhost:4100 performance/k6/chat-load.js
k6 run -e PROFILE=load  -e BASE_URL=http://localhost:4100 performance/k6/chat-load.js
```

## 6. Remaining work by risk
- **High:** fix the Redis read-order/slice defect.
- **Medium:** add a Kafka partition key (`chatId`); increase topic partitions and
  validate multi-consumer scaling; wire `stopMessageBatching()` into SIGTERM/SIGINT.
- **Low:** remove dead code; reconcile `docs/CHAT_PERSISTANCE_FLOW.md` with code.
