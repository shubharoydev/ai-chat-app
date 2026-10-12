# Chat Data Persistence & Flow

This document details the lifecycle of a chat message, highlighting the at-least-once delivery and idempotent persistence architecture using Redis, Kafka, and MongoDB with bulk processing and offset-after-write reliability.

## Architecture Guidelines

-   **Real-Time First**: Users see messages immediately via WebSocket (Socket.IO).
-   **Cache-Aside**: Recent messages are served from Redis for speed.
-   **Async Persistence**: Long-term storage is handled asynchronously via Kafka to prevent database bottlenecks.
-   **At-Least-Once Delivery**: Messages are retained in Kafka until committed; failed or unparsed poison messages are isolated to a Dead-Letter Queue (DLQ).
-   **Bulk Write Optimization**: Worker buffers incoming messages and performs `bulkWrite` upserts, reducing database round-trips by 50% to 99.9% under load.
-   **Offset-Coupled Persistence**: Kafka consumer offsets are committed only after successful MongoDB write execution, preventing silent message loss.

```mermaid
flowchart TD
    A[User Sends Message] --> B{Input Validation}
    B --> C[Socket.IO Delivery<br/>Real-time to Users]
    C --> D[Redis Cache Write<br/>chat:recent:chatId]
    D --> E[Kafka Queue<br/>chat-messages-persist]
    E --> F[Message Worker<br/>Bulk Processing]
    F --> G[MongoDB Storage<br/>bulkWrite upsert]
```

---

## 1. Sending a Message (The Write Path)

When a user sends a message (`POST /api/chat/messages` or Socket `sendMessage`):

1.  **Validation**: Input is validated (Joi schemas) for content, friendId, and user permissions.

2.  **Immediate Delivery (Socket.IO)**:
    -   The message is emitted to both the sender and receiver immediately.
    -   *User Experience*: Instant feedback (Optimistic UI).
    -   Includes temporary ID for client-side tracking.

3.  **Caching (Redis - Recent History)**:
    -   Message is pushed to a Redis list: `chat:recent:{chatId}`.
    -   TTL: 7 Days.
    -   **Fault Tolerance**: If Redis is down, this step is skipped (logged), but the flow continues.

4.  **Queueing (Kafka - Persistence)**:
    -   Message is published to topic: `chat-messages-persist`.
    -   Includes unique `messageId` for deduplication.
    -   **Fault Tolerance (Kafka Down)**:
        -   If Kafka is unreachable, the system writes the message to a "Backup Redis Queue": `chat:failed:{chatId}`.
        -   A background job (`retryFailedMessages`) periodically attempts to republish these to Kafka.

```mermaid
flowchart TD
    A[Publish to Kafka] --> B{Kafka Available?}
    
    B -->|Yes| C[Success: Message in Kafka<br/>Proceed to Worker]
    
    B -->|No| D[Kafka Down Detected]
    D --> E[Write to Backup Queue<br/>chat:failed:chatId in Redis]
    E --> F[Background Retry Service]
    
    subgraph F [Retry Service]
        F1[Poll Backup Queue] --> F2{Check Kafka Status}
        F2 -->|Available| F3[Re-publish to Kafka]
        F2 -->|Unavailable| F4[Wait & Retry<br/>Exponential Backoff]
        F4 --> F2
    end
    
    F3 --> C
```

---

## 2. Processing & Storage (Enhanced Worker Path)

A dedicated background worker (`messageWorker.js`) handles storage with intelligent batching:

### 2.1 Consumption & Buffering

1.  **Consumption**:
    -   Consumes messages from `chat-messages-persist` topic in batches.
### 2.1 Consumption & Buffering

1.  **Consumption**:
    -   Consumes messages from `chat-messages-persist` topic in batches.
    -   Uses `autoCommit: false` for precise offset control.

2.  **Intelligent Buffering**:
    -   Messages are accumulated in an in-memory buffer.
    -   **Dual Trigger Flush System**:
        -   **Volume-based**: When buffer reaches 1,000 messages (or configured `MESSAGE_BULK_THRESHOLD`), immediate flush is triggered.
        -   **Time-based**: Periodic interval (5 minutes or configured `MESSAGE_FLUSH_INTERVAL_MS`) flushes accumulated messages.

### 2.2 Bulk Processing

3.  **Enhanced Bulk Write (MongoDB)**:
    -   Uses `Message.bulkWrite` with `updateOne` and `{ upsert: true }` keyed by unique `messageId`.
    -   **Idempotency**: Duplicate messages (same `messageId`) are safe updates (`$setOnInsert`), preventing duplication upon retry.
    -   **Efficiency**: Reduces database network round-trips by up to 99.9% under sustained traffic.

4.  **Kafka Storage & Offset Management**:
    -   **Offset Commit**: Kafka offsets are resolved and committed **only after** successful MongoDB write.
    -   **Storage Efficiency**: Standard topic retention ensures older committed messages are cleaned up by Kafka broker policies.

### 2.3 Error Handling & Dead-Letter Queue (DLQ)

5.  **Robust Error Handling**:
    -   **DB Failures**: If MongoDB write fails, buffer is retained for subsequent retry; Kafka offsets are NOT resolved.
    -   **Poison Messages**: Unparsable payloads or messages missing `messageId` are routed to `chat-messages-dlq`. The offset is committed only if DLQ delivery succeeds (preventing silent message loss).

```mermaid
flowchart TD
    A[Kafka Consumer<br/>Batch Reading] --> B[Buffer Messages<br/>In-memory Storage]
    
    B --> C{Buffer Check}
    C -->|>= 1,000 msgs| D[Immediate Flush<br/>Trigger: Volume]
    C -->|5 min elapsed| E[Scheduled Flush<br/>Trigger: Time]
    
    D --> G[MongoDB bulkWrite]
    E --> G
    
    G --> I{Write Successful?}
    I -->|Yes| J[Commit Kafka Offsets]
    J --> K[Clear Buffer]
    I -->|No| L[Preserve Buffer<br/>Log Error, Retry on Next Trigger]
    L --> B
```

---

## 3. Retrieving Messages (The Read Path)

When the frontend requests chat history (`GET /messages/:friendId`):

1.  **Check Redis**:
    -   Attempts to read from `chat:recent:{chatId}`.
    -   Returns last 20 messages by default (configurable).
    -   **Fault Tolerance**: If Redis is down or returns an error, proceeds to MongoDB.

2.  **Fallback to MongoDB**:
    -   If Redis is empty or unreachable, queries the `messages` collection in MongoDB.
    -   Uses indexed query on `chatId` and `timestamp` for efficient retrieval.
    -   Pagination support for large chat histories.

3.  **Self-Healing (Read Repair)**:
    -   If data was fetched from MongoDB (because Redis was empty/down), the system pushes these messages back into Redis.
    -   This ensures that subsequent requests are served from the cache, "healing" the cache state automatically.

```mermaid
flowchart TD
    A[Frontend Requests<br/>Chat History] --> B{Redis Available?}
    
    subgraph S1 [Path A: Redis Success]
        B -->|Yes| C{Redis Has Data?}
        C -->|Yes| D[Return from Cache<br/>Fast Response]
        C -->|No| E[Empty Cache<br/>Fallback to DB]
    end
    
    subgraph S2 [Path B: Redis Failure]
        B -->|No| F[Redis Unavailable<br/>Proceed Directly to DB]
    end
    
    E --> G[Query MongoDB<br/>chatId + timestamp index]
    F --> G
    
    G --> H[Return Results<br/>Slower Response]
    H --> I[Self-Healing Step]
    
    subgraph S3 [Cache Repair]
        I --> J{Redis Available Now?}
        J -->|Yes| K[Repopulate Redis Cache<br/>chat:recent:chatId]
        J -->|No| L[Skip Repair<br/>Log Warning]
    end
```

---

## 4. Enhanced Worker Features

### 4.1 Bulk Threshold Optimization

```javascript
const BULK_THRESHOLD = 1000; // Auto-flush at 1000 messages
const FLUSH_INTERVAL = 5 * 60 * 1000; // 5 minutes
```

- **High Throughput**: During peak usage, buffer reaches threshold quickly → immediate flush
- **Low Activity**: During normal usage, time-based flush ensures regular persistence
- **Memory Efficiency**: Controlled buffer size prevents memory issues

### 4.2 Kafka Storage Management

```javascript
// After successful DB write
for (const { kafkaMsg, resolveOffset } of messageBuffer) {
  resolveOffset(kafkaMsg.offset); // Commit offset → removes from Kafka
}
```

- **Automatic Cleanup**: Processed messages are automatically removed from Kafka
- **Storage Efficiency**: Prevents unlimited Kafka topic growth
- **Cost Optimization**: Reduces storage requirements in cloud environments

### 4.3 Enhanced Monitoring

```javascript
logInfo('MongoDB bulkWrite completed', {
  insertedCount: result.upsertedCount || 0,
  modifiedCount: result.modifiedCount || 0,
  totalProcessed: messageBuffer.length,
});
```

- **Performance Metrics**: Track insert/modify ratios
- **Throughput Monitoring**: Monitor processing rates
- **Error Tracking**: Detailed error logging for debugging

---

## 5. Failure Scenarios & Recovery

```mermaid
flowchart LR
    subgraph A [Component Failure Matrix]
        direction TB
        A1[Redis Down] --> A2[Impact: Cache Miss]
        A2 --> A3[Recovery: Fallback to DB<br/>+ Self-Heal]
        
        A4[Kafka Down] --> A5[Impact: Queue Blocked]
        A5 --> A6[Recovery: Backup Queue<br/>+ Retry Service]
        
        A7[MongoDB Down] --> A8[Impact: Storage Blocked]
        A8 --> A9[Recovery: Buffer Preserved<br/>Kafka Retention]
        
        A10[Worker Crash] --> A11[Impact: Processing Stopped]
        A11 --> A12[Recovery: New Instance<br/>Kafka Resumes]
    end
    
    subgraph B [High Load Handling]
        direction TB
        B1[Spike in Traffic] --> B2{Buffer Check}
        B2 -->|>1,000| B3[Auto-flush Triggered]
        B2 -->|>= 1,000| B3[Auto-flush Triggered]
        B3 --> B5[Immediate Processing]
        B5 --> B6[Normal Flow Restored]
    end
```

| Failure | Impact | Recovery Mechanism |
| :--- | :--- | :--- |
| **Redis Down** | No cache hits. Slightly higher DB load. | **Read Path**: Falls back to Mongo. **Write Path**: Skips cache write, goes to Kafka. **Self-Heal**: When Redis returns, next read repopulates it. |
| **Kafka Down** | Messages not persisted immediately. | **Write Path**: Saves to `chat:failed` Redis key. **Recovery**: Background job retries publishing to Kafka later. |
| **MongoDB Down** | Worker cannot flush. | **Worker**: Buffer retained in memory. **Kafka**: Offsets stay uncommitted. **Recovery**: Worker retries bulk write on subsequent flush tick. |
| **Worker Crash** | In-flight batch interrupted. | **Kafka**: Offsets were not committed before crash. New worker instance resumes from last committed offset. Redelivered messages are safely deduplicated by MongoDB `messageId` upsert. |
| **Poison Message**| Malformed payload. | **Worker**: Message routed to DLQ (`chat-messages-dlq`). Source offset committed only on DLQ success. |
| **High Load** | Buffer fills quickly. | **Auto-flush**: Triggers immediate bulk flush upon reaching 1,000 messages, minimizing latency. |

---

## 6. Performance Optimizations

### 6.1 Database Optimizations

- **Unique Index**: `messageId` with unique constraint for fast upserts
- **Composite Index**: `chatId + timestamp` for efficient chat history queries
- **Bulk Operations**: `bulkWrite` with `ordered: false` for parallel processing

### 6.2 Memory Management

- **Controlled Buffer**: Maximum 5000 messages prevents memory issues
- **Immediate Flush**: Auto-flush at 1000 messages for high throughput
- **Garbage Collection**: Buffer cleared after successful commits

### 6.3 Kafka Optimizations

- **Batch Processing**: Consumes messages in batches for efficiency
- **Offset Management**: Precise control over message processing
- **Storage Cleanup**: Automatic removal of processed messages

---

## 7. Monitoring & Observability

### 7.1 Key Metrics

- **Message Throughput**: Messages processed per second
- **Buffer Utilization**: Current buffer size vs thresholds
- **Error Rates**: Failed operations and error types
- **Latency**: Time from message send to DB persistence

### 7.2 Logging

```javascript
logInfo('Bulk threshold reached, flushing immediately', {
  count: messageBuffer.length,
  threshold: BULK_THRESHOLD,
});

logError('MongoDB bulkWrite failed', { 
  error: err.message,
  bufferSize: messageBuffer.length 
});
```

### 7.3 Health Checks

- **Worker Status**: Active processing or paused
- **Buffer Health**: Current buffer size and last flush time
- **Kafka Connectivity**: Consumer connection status
- **MongoDB Connectivity**: Database connection status

---

## 8. Configuration

### 8.1 Tunable Parameters

```javascript
const BULK_THRESHOLD = 1000;     // Messages for immediate flush (MESSAGE_BULK_THRESHOLD)
const FLUSH_INTERVAL = 300000;   // 5 minutes in milliseconds (MESSAGE_FLUSH_INTERVAL_MS)
```

### 8.2 Environment-Specific Settings

- **Development**: Lower thresholds for faster debugging
- **Production**: Optimized for throughput and efficiency
- **Testing**: Configurable values for load testing

---

## 9. Best Practices

### 9.1 Message Design

- **Unique IDs**: Every message has a unique `messageId` for deduplication
- **Immutable Content**: Message content never changes after creation
- **Consistent Schema**: All messages follow the same structure

### 9.2 Error Handling

- **Never Lose Messages**: Buffer preserved on failures
- **Graceful Degradation**: System continues operating with reduced functionality
- **Comprehensive Logging**: All errors logged with context

### 9.3 Scaling Considerations

- **Horizontal Scaling**: Multiple worker instances can process different partitions
- **Load Balancing**: Kafka automatically balances load across consumers
- **Resource Management**: Memory and connection limits properly configured