# Reliability Test Results

Date: 2026-10-11
Runner: Jest 30 (ESM) against a real local Kafka (3 brokers), MongoDB and Redis
started via `docker compose`.

## How to run

```powershell
cd backend
npm test
# integration only
npx cross-env NODE_OPTIONS=--experimental-vm-modules jest persistence.integration
```

`backend/tests/setup/env.setup.cjs` forces local infrastructure and sets
`KAFKA_MODE=local` so tests never touch the cloud (Aiven) configuration.

## Summary

| Suite | File | Tests | Result |
| :--- | :--- | :---: | :--- |
| Validator | `tests/validator.test.js` | 3 | PASS |
| Worker unit | `tests/messageWorker.unit.test.js` | 5 | PASS |
| Persistence integration | `tests/persistence.integration.test.js` | 4 | PASS |
| **Total** | | **12** | **PASS** |

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

## What this proves

- At-least-once delivery with idempotent persistence (no duplicates on retry).
- Offsets are coupled to durable storage, not to in-memory success.
- Failure of the DLQ does not silently drop messages.

## What this does NOT prove

- Exactly-once semantics (not implemented).
- Ordering guarantees (no partition key; single partition today).
- Behavior under broker failure / leader election / long soak.
- The read path correctness (the `slice(-20)` defect is out of scope of these
  tests; see `architecture-audit.md`).
- The cloud (Aiven) path and the Gemini AI path (no credentials used).

## k6 verification (cross-check of the write path)

Smoke (1 VU, 5 iterations) and load (20 VUs, ~1m40s) both passed with **0%
failed requests**. The load run sent 2564 messages and the smoke run 5; MongoDB
held exactly **2569** documents afterwards, confirming end-to-end persistence of
every accepted write (at-least-once + idempotent). See
`performance-results.md` for timings.
