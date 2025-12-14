import { createContext, useState, useEffect, useCallback } from 'react';
import { login as apiLogin, logout as apiLogout, getFriends } from '../utils/api.js';
import { connectWebSocket, disconnectWebSocket, sendWebSocketMessage } from '../utils/WebSocket.js';
import api from '../utils/api.js';
export const UserContext = createContext();

export const UserProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [newMessage, _setNewMessage] = useState(null);
  const [wsError, setWsError] = useState(null);

  const setNewMessage = (msg) => {
    _setNewMessage(msg);
  };

  const startSocket = useCallback(() => {
    disconnectWebSocket();
    connectWebSocket(
      (msg) => setNewMessage(msg),
      (err) => setWsError(err.message ?? 'WebSocket error')
    );
  }, []);


const tryAutoLogin = async () => {
  try {
    console.log('Attempting auto-login...');
    const response = await api.get('/api/auth/me');


    // This line will only run if status is 200
    console.log('Auto-login SUCCESS:', response.data);


    setUser({
      id: response.data.user.id,
      name: response.data.user.name,
      email: response.data.user.email,
    });


    startSocket();
  } catch (err) {
    // Only runs on real error (401, 500, network, etc.)
    console.log('Auto-login failed → no session or error', err.response?.status);


    // Clear user only if truly not logged in
    setUser(null);
  } finally {
    setIsLoading(false);
  }
};


  const login = async (credentials) => {
    try {
      const { data } = await apiLogin(credentials);
      setUser({
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
      });
      startSocket();
    } catch (err) {
      console.error('Login failed:', err);
      throw err;
    }
  };

  const logout = async () => {
    try { await apiLogout(); } catch (_) {}
    setUser(null);
    setWsError(null);
    disconnectWebSocket();
  };

  useEffect(() => {
    tryAutoLogin();


    // Optional: Keep session alive every hour
    const iv = setInterval(() => {
      getFriends().catch(() => {});
    }, 60 * 60 * 1000);


    return () => {
      clearInterval(iv);
      disconnectWebSocket();
    };
  }, [startSocket]);

  return (
    <UserContext.Provider
      value={{
        user,
        login,
        logout,
        isLoading,
        newMessage,
        wsError,
        sendMessage: sendWebSocketMessage,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};