# Architecture (As-Built)

This document describes the system as it is actually implemented in this
repository (verified against source on 2026-10-11). It intentionally omits
features that are documented elsewhere but not present in the code; those are
listed under "Known gaps" and detailed in `architecture-audit.md`.

## Components

| Component | Technology | Role |
| :--- | :--- | :--- |
| API / realtime | Node.js + Express 5 + Socket.IO (Redis adapter) | HTTP + WebSocket entrypoints |
| Cache / queue | Redis (ioredis) | recent-message cache, failed-message backup queue |
| Streaming | Apache Kafka (KafkaJS) | durable ingest buffer for persistence |
| Persistence | MongoDB (Mongoose) | long-term message store |
| AI | Google Gemini API | `/ai ` message handling |
| Rate limit | Arcjet | optional, `DISABLE_ARCJET=true` disables |

Kafka can run against a **local Docker cluster** (`KAFKA_BROKERS`) or **Aiven
cloud** (`SERVICE_URI` + SASL/SSL cert). `KAFKA_MODE=local` forces local mode
even when `SERVICE_URI` is present. See `backend/config/kafka.js`.

## Write path

```
Client ──HTTP/WS──▶ chatService.sendMessage
      │
      ├─ Socket.IO emit "receiveMessage" (instant, optimistic)
      ├─ Redis LPUSH chat:recent:{chatId}   (TTL 7d, best-effort)
      └─ Kafka produce chat-messages-persist (retry x3)
                 │ on failure
                 └─ Redis LPUSH chat:failed:{chatId} (TTL 7d)
                              │ every 30 min
                              └─ retryFailedMessages → republish to Kafka
```

Key implementation notes:
- `chatId = [userId, friendId].sort().join(':')` — order-independent chat id.
- `messageId = uuidv4()` — the idempotency key.
- Kafka messages are published by `value` only (no partition key).
- AI messages (`/ai `, `/ai:` prefix) publish both the user message and the model
  reply to the same topic.

## Persistence path

```
Kafka chat-messages-persist
      │ consumeBatch(group=chat-group-worker, eachBatchAutoResolve=false)
      ▼
messageWorker in-memory buffer
      ├─ flush when size ≥ MESSAGE_BULK_THRESHOLD (default 1000)
      └─ flush every MESSAGE_FLUSH_INTERVAL_MS (default 300000 = 5 min)
      ▼
MongoDB Message.bulkWrite([updateOne upsert on messageId], {ordered:false})
      │ success → resolveOffset() for every buffered message
      │ failure → keep buffer, re-throw (offsets stay uncommitted)
      ▼
Poison JSON / missing messageId → DLQ chat-messages-dlq, then commit offset
                                  (offset committed only if DLQ send succeeded)
```

Delivery semantics: **at-least-once** consumption combined with **idempotent
writes** (`upsert` on a unique `messageId` index). This is *not* exactly-once.

## Read path

```
GET /api/chat/messages/:friendId
      ▼
Redis LRANGE chat:recent:{chatId}
   hit  → return cache                                     (see gap: ordering)
   miss → Mongo find(chatId).sort(timestamp).limit(20)
          → read-repair: push results back into Redis
```

## Configuration surface

| Env var | Default | Meaning |
| :--- | :--- | :--- |
| `KAFKA_MODE` | (unset) | `local` forces local brokers; else `SERVICE_URI` decides |
| `KAFKA_BROKERS` | `localhost:9092` | local broker list |
| `SERVICE_URI` | (unset) | Aiven broker host:port |
| `KAFKA_PERSIST_TOPIC` | `chat-messages-persist` | ingest topic |
| `KAFKA_DLQ_TOPIC` | `chat-messages-dlq` | dead-letter topic |
| `KAFKA_CONSUMER_GROUP` | `chat-group-worker` | consumer group |
| `MESSAGE_BULK_THRESHOLD` | `1000` | volume flush trigger |
| `MESSAGE_FLUSH_INTERVAL_MS` | `300000` | time flush trigger |
| `DISABLE_ARCJET` | (unset) | `true` disables Arcjet |

## Known gaps (see `architecture-audit.md` for detail)
- Topic is created with `numPartitions: 1` → no partition-level worker scaling.
- Kafka publishes carry no key → no explicit ordering guarantee.
- Redis read path can return the wrong 20 messages (ordering/slice bug).
- No coordinated graceful shutdown; the in-memory buffer can be dropped on exit.
- Documented `MAX_BUFFER_SIZE` pause logic is not implemented.
- `services/messageService.js::persistMessagesFromKafka` is dead code.
