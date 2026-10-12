# k6 Load-Test Runbook

## Prerequisites

- Docker infra up:
  ```powershell
  docker compose up -d zookeeper1 zookeeper2 zookeeper3 kafka kafka2 kafka3 mongodb redis
  ```
- k6 installed (`k6 version`).
- Node deps installed in `backend`.

## 1. Start a local backend (port 4100)

Use the launcher, which forces **local** infrastructure regardless of the cloud
`SERVICE_URI` in `backend/.env`:

```powershell
performance\k6\start-backend-local.cmd
```

It sets:

| Variable | Value |
| :--- | :--- |
| `KAFKA_MODE` | `local` (wins over `SERVICE_URI`) |
| `KAFKA_BROKERS` | `localhost:9092,localhost:9093,localhost:9094` |
| `MONGODB_URI` | `mongodb://localhost:27017/chatapp_k6` |
| `REDIS_URL` | `redis://localhost:6379/2` |
| `DISABLE_ARCJET` | `true` |
| `PORT` | `4100` |

Wait for `GET http://localhost:4100/api/auth/health` to return `200`.
Port **3000** is avoided so a separately running backend is not disturbed.

## 2. Run the tests

```powershell
k6 run -e PROFILE=smoke -e BASE_URL=http://localhost:4100 performance/k6/chat-load.js
k6 run -e PROFILE=load  -e BASE_URL=http://localhost:4100 performance/k6/chat-load.js
```

- `PROFILE=smoke` → 1 VU, 5 iterations (sanity + correctness).
- `PROFILE=load` → ramps 0→20 VUs, 60s sustained, ramps down (~1m40s), with
  latency/error thresholds.

Results of the last run are stored in
`performance/k6/smoke-output.txt` and `performance/k6/load-output.txt`.

## Endpoints exercised

| Method | Path | Notes |
| :--- | :--- | :--- |
| POST | `/api/auth/signup` | body `{name,email,password}` |
| POST | `/api/auth/login` | returns `tokens.accessToken` / `refreshToken` |
| POST | `/api/users/friends` | `{ email }` — mutual friendship |
| POST | `/api/chat/messages` | `{ friendId, content }` → 201 |
| GET | `/api/chat/messages/:friendId?page=1&limit=20` | → 200 |
| GET | `/api/auth/health` | unauthenticated, unrate-limited |

## Design notes / gotchas

- **Auth cookies.** Auth uses httpOnly cookies. `helpers.js` logs in, reads the
  tokens from the JSON body, and sends an explicit `Cookie` header. This avoids
  any per-VU cookie-jar surprises (e.g. `Secure` cookies over plain HTTP).
- **Per-VU identities.** `setup()` creates 1 receiver + 5 senders. Each VU logs
  in as one sender; the session is refreshed each iteration.
- **Unique emails.** `uniqueEmail()` uses `@k6test.com`. Joi's `email()` rejects
  reserved/invalid TLDs such as `.local`, so do not use them.
- **`/ai ` messages are avoided** — they require a live Gemini API key.
- **`DISABLE_ARCJET=true`** is required, otherwise auth routes are rate-limited
  and the test will see 429s.

## Troubleshooting

| Symptom | Cause | Fix |
| :--- | :--- | :--- |
| `receiver signup failed: 400 ... must be a valid email` | invalid TLD in generated email | use a real TLD (`.com`), already fixed in `helpers.js` |
| backend reaches `*.aivencloud.com` and times out | `SERVICE_URI` from `.env` selected cloud mode | use the launcher (`KAFKA_MODE=local`) |
| health check on 4000 fails | another backend already on that port | launcher uses 4100 |
| 429 responses | Arcjet enabled | set `DISABLE_ARCJET=true` |
| `run setup` hangs on signup | infra down | `docker compose ps`, verify Mongo/Redis/Kafka |
