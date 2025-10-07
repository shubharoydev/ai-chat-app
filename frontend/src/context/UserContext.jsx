import { createContext, useState, useEffect } from 'react';
import { checkHealth, login as apiLogin, refreshAccessToken, logout as apiLogout } from '../utils/api.js';
import { connectWebSocket, disconnectWebSocket } from '../utils/websocket';

export const UserContext = createContext();

export const UserProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [newMessage, setNewMessage] = useState(null);
  const [wsError, setWsError] = useState(null);

  const TOKEN_REFRESH_INTERVAL = 60 * 60 * 1000; // 60 minutes

  const getErrorMessage = (error) => {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    if (error.message) return error.message;
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown error';
    }
  };

  const handleTokenRefresh = async () => {
    try {
      const userId = localStorage.getItem('userId');
      if (!userId) throw new Error('No user ID found in localStorage');

      console.log('Attempting token refresh for userId:', userId);

      // 🔑 backend sends plain JSON, not `{ data: ... }`
      const response = await refreshAccessToken();
      const payload = response.data ?? response;

      console.log('Token refresh successful 1:', payload);

      localStorage.setItem('accessToken', payload.accessToken);
      console.log('acessToken');
      localStorage.setItem('userId', payload.userId);
      setUser({ id: payload.userId });

      // 🔑 reconnect WebSocket with new token
      disconnectWebSocket();
      const ws = connectWebSocket(
        payload.accessToken,
        (message) => {
          console.log('UserContext received message:', message); // Added: Log received messages
          setNewMessage({
            ...message,
            isAI: message.isAI ?? false, // Fixed: Ensure isAI is consistently boolean
          });
        },
        (error) => {
          const message = getErrorMessage(error);
          console.error('Socket.IO reconnection error:', message);
          setWsError(message);
        }
      );

      if (!ws) {
        setWsError('Failed to re-establish Socket.IO connection after refresh');
      } else {
        setWsError(null);
        console.log('UserContext WebSocket connected for userId:', userId); // Added: Log connection
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
      setUser(null);
      localStorage.clear();
      setWsError('Session expired. Please log in again.');
      window.location.href = '/login';
    }
  };

  const login = async (credentials) => {
    try {
      console.log('Attempting login with credentials:', credentials);
      const data = await apiLogin(credentials);
      console.log('Login API response:', data);

      setUser({ id: data.user.id });
      localStorage.setItem('accessToken', data.tokens.accessToken);
      localStorage.setItem('userId', data.user.id);

      const ws = connectWebSocket(
        data.tokens.accessToken,
        (message) => {
          console.log('UserContext received message:', message); // Added: Log received messages
          setNewMessage({
            ...message,
            isAI: message.isAI ?? false, // Fixed: Ensure isAI is consistently boolean
          });
        },
        (error) => {
          const message = getErrorMessage(error);
          console.error('Socket.IO connection error:', message);
          // 🔑 match backend error
          if (message.toLowerCase().includes('expired')) {
            handleTokenRefresh();
          } else {
            setWsError(message);
          }
        }
      );

      if (!ws) {
        setWsError('Failed to establish Socket.IO connection on login');
      } else {
        setWsError(null);
        console.log('UserContext WebSocket connected for userId:', data.user.id); // Added: Log connection
      }
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  };

  const init = async () => {
    const userId = localStorage.getItem('userId');
    const accessToken = localStorage.getItem('accessToken');

    if (userId && accessToken) {
      try {
        console.log('Initializing with userId:', userId, 'and accessToken:', accessToken);
        await checkHealth();
        setUser({ id: userId });

        const ws = connectWebSocket(
          accessToken,
          (message) => {
            console.log('UserContext received message:', message); // Added: Log received messages
            setNewMessage({
              ...message,
              isAI: message.isAI ?? false, 
            });
          },
          (error) => {
            const message = getErrorMessage(error);
            console.error('Socket.IO connection error:', message);
            if (message.toLowerCase().includes('expired')) {
              handleTokenRefresh();
            } else {
              setWsError(message);
            }
          }
        );

        if (ws) {
          console.log('UserContext WebSocket connected for userId:', userId); // Added: Log connection
        }
      } catch (error) {
        console.error('Health check failed:', error);
        await handleTokenRefresh();
      }
    }

    setIsLoading(false);
  };

  useEffect(() => {
    init();
    const refreshInterval = setInterval(() => {
      handleTokenRefresh();
    }, TOKEN_REFRESH_INTERVAL);
    return () => {
      clearInterval(refreshInterval);
      disconnectWebSocket();
    };
  }, []);

  const logout = async () => {
    try {
      const userId = localStorage.getItem('userId');
      if (userId) {
        await apiLogout({ userId });
      }
    } catch (error) {
      console.error('Logout failed:', error);
    }
    setUser(null);
    localStorage.clear();
    disconnectWebSocket();
    setWsError(null);
  };

  return (
    <UserContext.Provider value={{ user, login, logout, isLoading, newMessage, wsError }}>
      {children}
    </UserContext.Provider>
  );
};

