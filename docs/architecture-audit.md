# Architecture Audit — Kafka Persistence Path

Audit date: 2026-10-11
Scope: write path, Kafka consumption/persistence, read path, failure handling,
documentation claims, and the (unsupported) "60% write reduction" claim.

All statements below are backed by code inspection and/or executed tests. Where a
claim could not be confirmed, it is labelled explicitly.

---

## 1. Verified architecture (as built)

Message write path (`backend/services/chatService.js`):

1. `sendMessage(userId, friendId, content, clientTempId)` builds a `message`
   object with a UUID `messageId`, a sorted `chatId` (`[a,b].sort().join(':')`),
   and an ISO timestamp.
2. The message is emitted over Socket.IO to `userId` and `friendId`
   (`io.to(...).emit("receiveMessage", ...)`) — fire-and-forget.
3. The message is pushed to Redis: `LPUSH chat:recent:{chatId}` with a 7-day TTL.
   Failures are logged and swallowed (`redisWriteFailed`), the flow continues.
3. The message is published to Kafka topic `chat-messages-persist` via
   `publishToKafka`, wrapped in `async-retry` (3 retries, 1s..5s). On failure the
   message is pushed to a Redis backup list `chat:failed:{chatId}` (TTL 7 days).
   A `setInterval` (30 min) calls `retryFailedMessages` to republish them.

Consumption/persistence:

- `workers/messageWorker.js` consumes `chat-messages-persist` (group
  `chat-group-worker`) and buffers messages in memory.
- Flush triggers: volume (default 1000 messages) or time (default 5 minutes).
- Persistence uses `Message.bulkWrite([...updateOne upsert on messageId],
  { ordered: false })` with `$setOnInsert` → idempotent inserts.
- Kafka offsets are resolved (`resolveOffset`) **only after** the Mongo write
  succeeds. On failure the buffer is preserved and the error re-thrown.

Read path:

- `chatService.getMessages` tries Redis `chat:recent:{chatId}` first; on miss
  queries Mongo (`chatId` + `timestamp` index) and read-repairs the cache.

## Verified status of individual claims

| # | Claim | Status | Evidence |
| :--- | :--- | :--- | :--- |
| 1 | Messages persisted to Mongo via Kafka | **Verified** | Integration test; k6: 2569 sent, 2569 persisted |
| 2 | Idempotent persistence on `messageId` (no duplicates) | **Verified** | `persistence.integration.test.js` duplicate-redelivery test |
| 3 | Kafka offset committed only after DB success | **Verified** | Integration test + code `messageWorker.js:87-90` |
| 4 | Poison messages routed to DLQ | **Verified** | Integration + unit tests |
| 5 | "60% write reduction" | **Unverified / Unsupported** | String absent from repo & git history; no baseline exists |
| 6 | "3-broker cluster" for streaming | **Partial** | 3 brokers run in Docker; topic created with `numPartitions: 1` |
| 7 | Partition-based horizontal scaling of workers | **Incorrect (as configured)** | `numPartitions: 1` ⇒ a single partition ⇒ one active consumer |
| 8 | Per-message ordering preserved | **Incorrect (as configured)** | `publishToKafka` sends no key (`chatService.js:21`) |
| 9 | `MAX_BUFFER_SIZE = 5000` consumer pause | **Incorrect (doc-only)** | No such code in `messageWorker.js` |
| 10 | Read path returns newest N messages | **Incorrect (bug)** | `slice(-20)` on newest-first list returns the *oldest* 20 |
| 11 | Graceful shutdown flushes the buffer | **Partial (unwired)** | `stopMessageBatching()` exists but is not wired into shutdown |
| 11b | "Never lose messages" / exactly-once | **Partial** | Verified: at-least-once + idempotent persistence; NOT exactly-once |

## Documentation / code mismatches (verified)

1. `docs/CHAT_PERSISTANCE_FLOW.md` §2.1 & §8.1 describe a `MAX_BUFFER_SIZE = 5000`
   consumer-pause mechanism and a "pause consumer" branch. There is **no** such
   logic in `workers/messageWorker.js` (lines 45-181). The consumer is never
   paused; the buffer is unbounded between flushes.
2. README claims "Multiple workers across Kafka partitions" and
   "Kafka auto-rebalancing", but `config/kafka.js` `ensureTopic` defaults to
   `numPartitions: 1`, so a topic has a single partition and only one consumer
   in a group can be active.
3. README claims "Worker pause/resume memory protection" and the persistence doc
   describes a `MAX_BUFFER_SIZE = 5000` consumer pause — this code does not exist.

### Correctness defects found

1. **Read ordering / wrong slice** — `chatService.js:151` — Redis stores messages
   newest-first (`lpush`) but `slice(-20)` returns the *oldest* 20 of the cached
   list, and the list is returned newest-first while the Mongo path returns
   oldest-first. For chats with > 20 cached messages the UI can receive the wrong
   20 messages in the wrong order.
2. **No per-chat ordering guarantee** — `chatService.js:19-22` publishes messages
   with `value` only (no `key`). Messages from the same chat can be spread across
   partitions/requests; with the current single partition it happens to be
   ordered, but there is no explicit guarantee.
3. **Doc/code mismatch on buffer cap** — documented `MAX_BUFFER_SIZE = 5000`
   pause logic does not exist in `messageWorker.js`.
4. **Dead code** — `services/messageService.js::persistMessagesFromKafka` is not
   referenced anywhere.
5. **Uncoordinated shutdown** — `redisSetup.js` SIGTERM handler calls
   `process.exit(0)`; the worker is not wired to flush/stop, so a SIGTERM can drop
   the in-memory buffer (mitigated only by Kafka redelivery of uncommitted
   offsets).

### Previously fixed during this audit

- **DLQ silent loss** — `sendToDLQ` now returns a boolean; the source offset is
  committed only when the DLQ hand-off succeeds (`messageWorker.js:23-43,124-132`).

## Priority status table

| Priority | Area | Status |
| :--- | :--- | :--- |
| 1 | "60% write reduction" claim | **Unverified / Unsupported** |
| 2 | Message persistence through Kafka (happy path) | **Verified** |
| 3 | Idempotency / no duplicates on redelivery | **Verified** |
| 4 | Offset-after-persist; DLQ on poison message | **Verified** |
| 5 | Partitioning / ordering / graceful shutdown / read-order bug | **Partial / Incorrect** |

## Closing sections

### 1. Claims that are safe to make now
- Messages are durably persisted to MongoDB through Kafka; the exact count sent
  equals the count stored (2569/2569 in the load run).
- Persistence is idempotent on `messageId`; redelivery does not create duplicates.
- Kafka offsets are committed only after a successful Mongo write.
- Poison messages are dead-lettered, and the source offset is committed only after
  a successful DLQ delivery.

### 2. Claims that must be corrected or withdrawn
- "60% write reduction" → withdraw unless re-stated as *write-command/round-trip*
  reduction measured at a specific batch size (see performance doc).
- "Partition-based scaling" / "3-broker streaming" → the cluster has 3 brokers
  but the topic is created with 1 partition; no partition parallelism today.
- "Worker pause at 5000 messages" → does not exist.
- "Guaranteed per-message ordering" → not explicitly guaranteed (no key).

### 3. Verified defects
1. Redis read path returns the wrong/ordered-oldest 20 messages.
2. `publishToKafka` sends no key (no ordering key).
3. Documented `MAX_BUFFER_SIZE`/pause logic absent.
4. `messageService.persistMessagesFromKafka` dead code.
5. Uncoordinated graceful shutdown (buffer can be dropped on SIGTERM).
6. (Fixed) DLQ failure previously committed the offset → silent loss.

### 4. Tests passed / failed / not run
- Passed: 12/12 (`npm test`) — 3 validator, 5 unit, 4 integration.
- Passed: k6 smoke (1 VU, 5 iters) and k6 load (20 VUs, ~1m40s).
- Not run: multi-broker partition scaling, broker failure/leader election,
  long-running soak (>1h), cloud (Aiven) path, AI/Gemini path (no key),
  consumer-lag tooling (Docker advertised-listener limitation).

### 5. Reproduction commands
```powershell
# infra
docker compose up -d zookeeper1 zookeeper2 zookeeper3 kafka kafka2 kafka3 mongodb redis
# tests
cd backend; npm test
# write-reduction benchmark
node performance/write-reduction/measure-write-reduction.mjs
# local backend for k6 (port 4100, local Kafka, Arcjet disabled)
performance\k6\start-backend-local.cmd
# k6
k6 run -e PROFILE=smoke -e BASE_URL=http://localhost:4100 performance/k6/chat-load.js
k6 run -e PROFILE=load  -e BASE_URL=http://localhost:4100 performance/k6/chat-load.js
```

### 6. Remaining work by risk
- **High:** fix the Redis read-order/slice bug; add idempotency/ordering
  assertions for the read path.
- **Medium:** key Kafka messages by `chatId`; raise topic partitions and validate
  multi-consumer scaling; wire `stopMessageBatching()` into SIGTERM/SIGINT.
- **Low:** remove dead code; reconcile `docs/CHAT_PERSISTANCE_FLOW.md` with the
  implemented behaviour.
