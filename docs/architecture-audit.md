# Verified Architecture & Delivery Guarantees

This document details the verified implementation, delivery guarantees, and operational safeguards of the AI Chat Application backend.

---

## 1. System Architecture Overview

### Message Write Path (`backend/services/chatService.js`)
1. `sendMessage(userId, friendId, content, clientTempId)` verifies mutual friendship authorization between `userId` and `friendId` (rejects non-friends with `403 Forbidden`).
2. Generates a message payload with a UUID `messageId`, sorted conversation identifier `chatId` (`[userId, friendId].sort().join(':')`), and ISO timestamp.
3. Emits the message via Socket.IO for immediate client delivery.
4. Pushes the message to Redis (`LPUSH chat:recent:{chatId}`) with a 7-day TTL.
5. Publishes to Kafka topic `chat-messages-persist` with `key: msg.chatId` to preserve per-conversation partition ordering.
6. If Kafka publishing fails, the message is pushed to the Redis backup queue (`chat:failed:{chatId}`) with exponential backoff retries via `retryFailedMessages`. If both Kafka and Redis fail, an explicit `503` error is returned to the client.

### Background Worker & Persistence (`backend/workers/messageWorker.js`)
1. Consumes `chat-messages-persist` with manual offset control (`autoCommit: false`).
2. Buffers messages in memory. Flushes when the buffer reaches `MESSAGE_BULK_THRESHOLD` (1,000) or when `MESSAGE_FLUSH_INTERVAL_MS` (5 minutes) elapses.
3. Implements flow control: when the buffer reaches `MESSAGE_MAX_BUFFER_SIZE` (5,000), backpressure is applied and immediate flushes are executed with consumer heartbeats.
4. Performs bulk MongoDB persistence via `Message.bulkWrite` using idempotent `$setOnInsert` upserts on the unique `messageId`.
5. Offsets are committed to Kafka **only after** MongoDB acknowledges successful persistence. If a database error occurs, offsets remain uncommitted and the buffer is preserved for retry.
6. Poison messages (malformed JSON or missing `messageId`) are routed to `chat-messages-dlq`. The source offset is committed only upon verified delivery to the DLQ.

### Read Path (`backend/services/chatService.js`)
1. Checks mutual friendship before returning history (`403 Forbidden` if unauthorized).
2. Reads recent messages from Redis (`LRANGE 0 19`), reversed to return chronological order (`oldest -> newest`).
3. If cache misses, queries MongoDB indexed on `{ chatId: 1, timestamp: -1 }`, limits to 20, reverses chronologically, and repopulates Redis cache (read-repair).

---

## 2. Verified Guarantees

| Guarantee | Mechanism | Verification Evidence |
| :--- | :--- | :--- |
| **At-Least-Once Delivery** | Manual offset commits after DB write; redelivery on uncommitted restart | `tests/persistence.integration.test.js` |
| **Idempotent Persistence** | MongoDB `updateOne` upserts with `$setOnInsert` on unique `messageId` | `tests/persistence.integration.test.js` |
| **Per-Chat In-Order Delivery** | Kafka publishing keyed by `chatId` (`key: msg.chatId`) | `tests/p0.correctness.test.js` |
| **Poison Isolation** | Malformed payloads routed to Dead-Letter Queue (`chat-messages-dlq`) | `tests/persistence.integration.test.js` |
| **Fail-Safe Fallback** | Kafka publish failure queues to Redis; dual-failure returns explicit `503` | `tests/p0.correctness.test.js` |
| **Bounded Memory & Backpressure** | `MESSAGE_MAX_BUFFER_SIZE = 5000` with consumer heartbeats and immediate drain | `backend/workers/messageWorker.js` |
| **Graceful Shutdown** | Intercepts `SIGINT`/`SIGTERM` to stop consumer, flush in-flight buffer, close connections | `backend/server.js` |
| **Multi-Partition Parallelism** | Cluster topics support multi-partition hashing and consumer group rebalancing | `tests/p1.scaling.test.js` |
| **Security & AI Resilience** | Friendship authorization on all chat APIs; Gemini 8s timeouts and quota failovers | `tests/p1.security-ai.test.js` |

---

## 3. Test Verification Commands

```powershell
# Start local infrastructure
docker compose up -d zookeeper1 zookeeper2 zookeeper3 kafka kafka2 kafka3 mongodb redis

# Run complete test suite (23/23 tests)
cd backend
npm test

# Run write-reduction benchmark
node performance/write-reduction/measure-write-reduction.mjs

# Run k6 load test suite
performance\k6\start-backend-local.cmd
k6 run -e PROFILE=smoke -e BASE_URL=http://localhost:4100 performance/k6/chat-load.js
k6 run -e PROFILE=load  -e BASE_URL=http://localhost:4100 performance/k6/chat-load.js
```
