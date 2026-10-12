# Performance Results

Date: 2026-10-11
Environment: single Windows host; Kafka (3 brokers), MongoDB and Redis in Docker;
backend local on port 4100; k6 v2.1.0.

---

## 1. Write-reduction benchmark

Harness: `performance/write-reduction/measure-write-reduction.mjs`
Method: write N = 2000 messages to MongoDB two ways and read the deltas from
`serverStatus.metrics.commands` and `opcounters`:
- baseline: one `insertOne`/message;
- batched: `bulkWrite` with batch size B.

Raw data: `performance/write-reduction/results-2026-10-11T07-44-01-343Z.json`.

| Variant | Batch | Write commands | Records written | Wall (ms) | Command reduction |
| :--- | :---: | ---: | ---: | ---: | ---: |
| baseline | 1 | 2000 | 2000 | 4868.7 | 0% |
| batched | 2 | 1000 | 2000 | 3922.9 | 50% |
| batched | 10 | 200 | 2000 | 2152.9 | 90% |
| batched | 100 | 20 | 2000 | 2010.1 | 99% |
| batched | 1000 | 2 | 2000 | 2337.5 | 99.9% |

### Conclusion

Batching reduces **write commands / server round-trips**, not the number of
documents written (always 2000 → **0% record reduction**). The reduction is a
direct function of batch size, e.g. ~50% at B=2, ~60% around B≈2.5, 90% at B=10,
and it saturates as B grows.

**The "60% write reduction" claim cannot be confirmed as a fixed property.** No
60% figure, baseline, or benchmark exists anywhere in the repository or its git
history. If a 60% number is used, it must be stated as *write-command reduction
at a specific batch size* (≈2.5 here), under an insert-heavy workload — it is not
a universal or document-storage saving.

---

## 2. k6 HTTP load test

Script: `performance/k6/chat-load.js` (see `docs/k6-runbook.md`).
Each iteration: login → send one message → read history (last 20) → sleep 0.2s.

### Smoke — 1 VU, 5 iterations

| Metric | Value |
| :--- | :--- |
| HTTP requests | 32 (0 failed, 0.00%) |
| Checks | 10/10 (100%) — send 201, read 200 |
| `http_req_duration` | avg 96.75 ms, p(95) 386 ms, p(99) 537ms, max 597ms |
| `send_message_latency` | avg 108ms, p(95) 316ms, max 371ms |

### Load — ramping to 20 VUs (20s ramp, 60s hold, 20s down)

| Metric | Value |
| :--- | :--- |
| HTTP requests | 7709 (0 failed, 0.00%) |
| Checks | 5128/5128 (100%) |
| Messages sent | 2564 (25.2 msg/s) |
| Throughput | ~75.7 req/s |
| `http_req_duration` avg | 138.28 ms |
| `http_req_duration` p(95) | 325.34 ms |
| `http_req_duration` p(99) | 499.84 ms |
| `...{endpoint:sendMessage}` p(95) | 385.37 ms |
| `{endpoint:getMessages} p(95)` | 88.01 ms |
| Iteration duration p95 | 874.24 ms |

Thresholds configured and met: `http_req_failed < 1%`, overall `p95 < 500ms`,
`p99 < 1000ms`, send `p95 < 500ms`, read `p95 < 300ms`.

### End-to-end persistence cross-check

Sent messages: 2564 (load) + 5 (smoke) = **2569**.
`db.messages.countDocuments()` in `chatapp_k6` = **2569**. Every accepted write
was persisted.

### Caveats (not measured / not claimed)

- This is a single-host dev stack; results are **not** production capacity.
- No real SLOs exist in the repository; the thresholds are conservative
  placeholders.
- The `/ai ` path was not exercised (requires a Gemini API key).
- Consumer-group lag could not be read via the CLI because the local brokers
  advertise `localhost` listeners that are not resolvable from inside the Kafka
  container. Persistence count is used as the durable evidence instead.
