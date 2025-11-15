import { createContext, useState, useEffect, useCallback } from 'react';
import { login as apiLogin, logout as apiLogout } from '../utils/api.js';
import { connectWebSocket, disconnectWebSocket, sendWebSocketMessage } from '../utils/WebSocket.js';

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

  // auto-login on mount
  const tryAutoLogin = async () => {
    try {
      const { data } = await apiLogin();   
      setUser({
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
      });
      startSocket();
    } catch (err) {
      console.warn('No valid session – stay on login');
    } finally {
      setIsLoading(false);
    }
  };

  // manual login 
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
    const iv = setInterval(() => apiLogin().catch(() => {}), 60 * 60 * 1000);
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