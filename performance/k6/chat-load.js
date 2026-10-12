/**
 * k6 load test for the AI Chat Application message write + read path.
 *
 * It exercises realistic, existing endpoints discovered in the codebase:
 *   POST /api/auth/signup
 *   POST /api/auth/login
 *   POST /api/users/friends
 *   POST /api/chat/messages        (write path -> Redis + Kafka -> worker -> Mongo)
 *   GET  /api/chat/messages/:id    (read path  -> Redis cache-aside -> Mongo)
 *
 * Profiles (select with -e PROFILE=smoke|load):
 *   smoke : 1 VU, 5 iterations - correctness + cold-start sanity.
 *   load  : ramp to 20 VUs, sustained, then ramp down (~1m40s) with thresholds.
 *
 * Run (from the repository root, backend running on :4000):
 *   k6 run -e PROFILE=smoke performance/k6/chat-load.js
 *   k6 run -e PROFILE=load  -e BASE_URL=http://localhost:4000 performance/k6/chat-load.js
 *
 * The thresholds below are deliberately conservative starting points, not a
 * claim about the application's real SLOs (none are defined in the repository).
 */
import { sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import {
  uniqueEmail,
  signup,
  login,
  addFriend,
  sendMessage,
  getMessages,
  checkSendOk,
  checkReadOk,
} from './helpers.js';

const PROFILE = __ENV.PROFILE || 'smoke';

export const options = PROFILE === 'load'
  ? {
      scenarios: {
        chat: {
          executor: 'ramping-vus',
          startVUs: 0,
          stages: [
            { duration: '20s', target: 20 },
            { duration: '60s', target: 20 },
            { duration: '20s', target: 0 },
          ],
          gracefulRampDown: '5s',
        },
      },
      thresholds: {
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(95)<500', 'p(99)<1000'],
        'http_req_duration{endpoint:sendMessage}': ['p(95)<500'],
        'http_req_duration{endpoint:getMessages}': ['p(95)<300'],
      },
      summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
    }
  : {
      vus: 1,
      iterations: 5,
      thresholds: {
        http_req_failed: ['rate<0.01'],
      },
      summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
    };

// Custom business metrics (message-level, independent of HTTP request timing).
const messagesSent = new Counter('messages_sent');
const sendLatency = new Trend('send_message_latency', true);

export function setup() {
  const password = 'k6-password-123';
  const receiverEmail = uniqueEmail('receiver');

  const recv = signup('k6 Receiver', receiverEmail, password);
  if (recv.status !== 201 && recv.status !== 409) {
    throw new Error(`receiver signup failed: ${recv.status} ${recv.body}`);
  }
  const receiver = login(receiverEmail, password);
  if (!receiver.userId) throw new Error(`receiver login failed: ${receiver.status} ${receiver.access}`);

  const senders = [];
  const SENDER_COUNT = 5;
  for (let i = 0; i < SENDER_COUNT; i++) {
    const email = uniqueEmail(`sender${i}`);
    const su = signup(`k6 Sender ${i}`, email, password);
    if (su.status !== 201 && su.status !== 409) {
      throw new Error(`sender signup failed: ${su.status} ${su.body}`);
    }
    const creds = login(email, password);
    if (!creds.userId) throw new Error(`sender login failed: ${creds.status}`);
    const fr = addFriend(creds.access, creds.refresh, receiverEmail);
    if (fr.status !== 201 && fr.status !== 409) {
      throw new Error(`addFriend failed: ${fr.status} ${fr.body}`);
    }
    senders.push({ email, access: creds.access, refresh: creds.refresh, userId: creds.userId });
  }

  return { receiver, senders, password };
}

export default function (data) {
  // Each VU logs in as one sender and reuses cookies for the whole iteration set.
  const sender = data.senders[(__VU - 1) % data.senders.length];
  let access = sender.access;
  let refresh = sender.refresh;

  // Refresh the session once per iteration (cheap; mirrors long-lived clients).
  const relogin = login(sender.email, data.password);
  if (relogin.userId) {
    access = relogin.access;
    refresh = relogin.refresh;
  }

  const content = `k6 load message vu=${__VU} iter=${__ITER} t=${Date.now()}`;

  const start = Date.now();
  const res = sendMessage(access, refresh, data.receiver.userId, content);
  sendLatency.add(Date.now() - start);
  if (checkSendOk(res)) messagesSent.add(1);

  // Exercise the cache-aside read path.
  const readRes = getMessages(access, refresh, data.receiver.userId, 1, 20);
  checkReadOk(readRes);

  sleep(0.2);
}
