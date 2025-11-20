import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

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
  (response) => {
    console.debug(`[API] Response: ${response.config.method.toUpperCase()} ${response.config.url}`, {
      status: response.status,
      data: response.data
    });
    return response;
  },
  async (err) => {
    const orig = err.config;
    
    console.error('[API] Response error:', {
      url: orig?.url,
      method: orig?.method,
      status: err.response?.status,
      data: err.response?.data
    });

    if (err.response?.status === 401 && !orig._retry) {
      console.log('[API] 401 Unauthorized, attempting token refresh...');
      orig._retry = true;
      try {
        console.log('[API] Refreshing access token...');
        await api.post('/auth/refresh-token');
        console.log('[API] Token refresh successful, retrying original request');
        return api(orig);
      } catch (refreshError) {
        console.error('[API] Token refresh failed:', refreshError);
        console.log('[API] Redirecting to login page');
        window.location.href = '/login';
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

export default api;
