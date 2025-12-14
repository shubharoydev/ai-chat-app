import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});
let isRefreshing = false;

api.interceptors.request.use(
  (config) => {
    console.debug(`[API] Request: ${config.method.toUpperCase()} ${config.url}`, {
      data: config.data,
      params: config.params,
      headers: config.headers
    });
    return config;
  },
  (error) => {
    console.error('[API] Request error:', error);
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => response,
  async (err) => {
    const orig = err.config;
    if (
      err.response?.status === 401 &&
      !orig?._retry &&
      !orig?.url?.includes('/api/auth/refresh-token')
    ) {
      if (isRefreshing) {
        return Promise.reject(err);
      }

      orig._retry = true;
      isRefreshing = true;

      try {
        await api.post('/api/auth/refresh-token'); // try to refresh
        isRefreshing = false;
        return api(orig); // retry original request
      } catch (refreshErr) {
        isRefreshing = false;

        // Refresh failed → ONLY redirect once
        if (!window.location.pathname.includes('/login')) {
          window.location.href = '/login';
        }
        return Promise.reject(refreshErr);
      }
    }
    return Promise.reject(err);
  }
);

export const signup = (d) => {
  console.log('[API] Signing up new user:', { email: d.email });
  return api.post('/api/auth/signup', d);
};

export const login = (d = {}) => {
  console.log('[API] Logging in user:', d.email ? { email: d.email } : 'Using cookie auth');
  return api.post('/api/auth/login', d);
};

export const logout = () => {
  console.log('[API] Logging out user');
  return api.post('/api/auth/logout');
};

export const addFriend = (d) => {
  console.log('[API] Adding friend:', d);
  return api.post('/api/users/friends', d);
};

export const getFriends = () => {
  console.log('[API] Fetching friends list');
  return api.get('/api/users/friends');
};

export const getMessages = (friendId, page = 1, limit = 20) => {
  console.log(`[API] Fetching messages for friend ${friendId}`, { page, limit });
  return api.get(`/api/chat/messages/${friendId}?page=${page}&limit=${limit}`);
};

export const searchFriends = (query) => {
  console.log('[API] Searching users:', { query });
  return api.get('/api/users/search', {
    params: { query }
  });
};

export default api;
