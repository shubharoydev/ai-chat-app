# Reliability Test Results

Runner: Jest 30 (ESM) against real infrastructure: local Kafka (3-broker cluster), MongoDB, and Redis started via `docker compose`.

## How to run

```powershell
cd backend
npm test
# individual suites
npx cross-env NODE_OPTIONS=--experimental-vm-modules jest p0.correctness
npx cross-env NODE_OPTIONS=--experimental-vm-modules jest p1.scaling
npx cross-env NODE_OPTIONS=--experimental-vm-modules jest p1.security-ai
```

`backend/tests/setup/env.setup.cjs` forces local infrastructure and sets
`KAFKA_MODE=local` so tests never touch the cloud (Aiven) configuration.

## Summary

| Suite | File | Tests | Result |
| :--- | :--- | :---: | :--- |
| Validator | `tests/validator.test.js` | 3 | PASS |
| Worker unit | `tests/messageWorker.unit.test.js` | 5 | PASS |
| Persistence integration | `tests/persistence.integration.test.js` | 4 | PASS |
| P0 Correctness & Durability | `tests/p0.correctness.test.js` | 4 | PASS |
| P1 Distributed Scaling | `tests/p1.scaling.test.js` | 2 | PASS |
| P1 Security & AI Resilience | `tests/p1.security-ai.test.js` | 5 | PASS |
| **Total** | | **23** | **PASS** |

## Unit tests (mocked Kafka/Mongo) — `messageWorker.unit.test.js`

1. **Collapse + upsert + commit-after-persist** — N messages produce exactly ONE
   `bulkWrite` with idempotent `updateOne` upserts; offsets are resolved only
   after the write resolves.
2. **DB failure preserves buffer / no commit** — when `bulkWrite` rejects, no
   offsets are resolved and the buffer is retained for retry.
3. **Poison message → DLQ + commit** — unparsable payloads are sent to the DLQ
   and their source offset is committed.
4. **Missing `messageId` → DLQ** — messages lacking the idempotency key are
   dead-lettered rather than written.
5. **DLQ failure → NO commit (no silent loss)** — when the DLQ send fails, the
   offset is left uncommitted so the message is redelivered. This is the fix for
   the previously silent-loss defect.

## Integration tests (real Kafka + Mongo) — `persistence.integration.test.js`

1. **End-to-end persistence + commit** — messages published to Kafka are written
   to MongoDB and their offsets committed.
2. **Idempotent redelivery** — publishing the same `messageId` twice yields a
   single stored record (no duplicates).
3. **Poison handling** — a malformed message is routed to the DLQ while valid
   messages in the same stream still persist.
4. **Offset durability across restart** — after a consumer restart, messages with
   uncommitted offsets are redelivered while committed ones are not.

## Correctness & Durability tests — `p0.correctness.test.js`

1. **Friendship authorization** — verifies users cannot message non-friends or read chats they do not belong to (`403 Forbidden`).
2. **Redis cache ordering consistency** — verifies latest 20 messages retrieved from Redis match chronological order of MongoDB queries.
3. **Kafka partition key affinity** — verifies `key: msg.chatId` routes all messages for a given chat to the identical partition.
4. **Fallback & retry recovery** — verifies Kafka publishing failures queue in Redis and successfully recover via `retryFailedMessages()`.

## Distributed Scaling tests — `p1.scaling.test.js`

1. **Multi-partition hash distribution** — verifies topics with 3 partitions distribute diverse chat keys across multiple partitions.
2. **Multi-consumer group parallelism** — verifies multiple active consumers in the same consumer group join, trigger rebalance, and achieve concurrent partition assignment.

## Security & AI Resilience tests — `p1.security-ai.test.js`

1. **JWT authentication** — verifies missing or tampered tokens are rejected (`401 Unauthorized`).
2. **AI fault tolerance & quota limits** — verifies Gemini quota exhaustion (429) returns controlled 503 errors and request timeouts (8s) fail gracefully without process crashes.

## What this proves

- At-least-once delivery with idempotent persistence (no duplicates on retry).
- Offsets are coupled to durable storage, not to in-memory success.
- Failure of the DLQ does not silently drop messages.
- Per-chat in-order partitioning via `key: msg.chatId`.
- Backpressure and bounded buffering (`MESSAGE_MAX_BUFFER_SIZE = 5000`).
- Chronological consistency between Redis and MongoDB read paths.
- Multi-partition scalability and multi-consumer group rebalancing.

## k6 verification (cross-check of the write path)

Smoke (1 VU, 5 iterations) and load (20 VUs, ~1m40s) both passed with **0%
failed requests**. The load run sent 2564 messages and the smoke run 5; MongoDB
held exactly **2569** documents afterwards, confirming end-to-end persistence of
every accepted write (at-least-once + idempotent). See
`performance-results.md` for timings.
