/**
 * Shared helpers for the k6 load tests.
 *
 * Auth is cookie-based. To avoid any ambiguity around the `Secure` cookie flag
 * when testing over plain HTTP, this helper captures the tokens returned in the
 * login response body and sends them explicitly as a Cookie header. Requests
 * remain fully authenticated through the same middleware as the UI.
 */
import http from 'k6/http';
import { check } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const uniqueEmail = (prefix) =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}@k6test.com`;

export const signup = (name, email, password) =>
  http.post(`${BASE_URL}/api/auth/signup`, JSON.stringify({ name, email, password }), {
    headers: JSON_HEADERS,
  });

export const login = (email, password) => {
  const res = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({ email, password }), {
    headers: JSON_HEADERS,
  });

  let body = {};
  try {
    body = res.json();
  } catch (e) {
    body = {};
  }

  return {
    status: res.status,
    access: body.tokens?.accessToken,
    refresh: body.tokens?.refreshToken,
    userId: body.user?.id,
  };
};

export const authHeader = (access, refresh) => ({
  'Content-Type': 'application/json',
  Cookie: `accessToken=${access}; refreshToken=${refresh}`,
});

export const addFriend = (access, refresh, email) =>
  http.post(`${BASE_URL}/api/users/friends`, JSON.stringify({ email }), {
    headers: authHeader(access, refresh),
  });

export const sendMessage = (access, refresh, friendId, content) =>
  http.post(`${BASE_URL}/api/chat/messages`, JSON.stringify({ friendId, content }), {
    headers: authHeader(access, refresh),
    tags: { endpoint: 'sendMessage' },
  });

export const getMessages = (access, refresh, friendId, page = 1, limit = 20) =>
  http.get(`${BASE_URL}/api/chat/messages/${friendId}?page=${page}&limit=${limit}`, {
    headers: authHeader(access, refresh),
    tags: { endpoint: 'getMessages' },
  });

export const checkSendOk = (res) =>
  check(res, {
    'send status is 201': (r) => r.status === 201,
  });

export const checkReadOk = (res) =>
  check(res, {
    'read status is 200': (r) => r.status === 200,
  });
