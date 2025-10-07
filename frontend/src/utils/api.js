import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, 
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const userId = localStorage.getItem('userId');
        if (!userId) throw new Error('No user ID found in localStorage');
        const { data } = await refreshAccessToken();
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('userId', data.userId);
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        localStorage.clear();
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);

export const signup = (data) => api.post('/auth/signup', data);

export const login = async (data) => {
  const response = await api.post('/auth/login', data);
  localStorage.setItem('accessToken', response.data.tokens.accessToken);
  localStorage.setItem('userId', response.data.user.id);
  return response.data;
};

export const refreshAccessToken = () =>
  api.post('/auth/refresh-token');

export const logout = () => api.post('/auth/logout', {}, { withCredentials: true });


export const addFriend = async (data) => {
  try {
    console.log('addFriend payload:', data); // Log payload for debugging
    const response = await api.post('/users/friends', data);
    return response;
  } catch (error) {
    console.error('addFriend error:', error.response?.data || error.message);
    throw error;
  }
};

export const updateFriendNickname = (data) => api.put('/users/friends/nickname', data);
export const searchUsers = (query) => api.get(`/users/search?query=${encodeURIComponent(query)}`);
export const getFriends = () => api.get('/users/friends');
export const sendMessage = (data) => api.post('/chat/messages', data);
export const getMessages = (friendId, page = 1, limit = 20) =>
  api.get(`/chat/messages/${friendId}?page=${page}&limit=${limit}`);
export const checkHealth = () => api.get('/auth/health');

export default api;