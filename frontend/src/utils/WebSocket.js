import { io } from 'socket.io-client';
import refreshAccessToken from './api.js';

let socket = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectDelay = 2000;
let messageQueue = [];

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

export const connectWebSocket = (token, onMessage, onError) => {
  if (!token) {
    console.error('No access token provided for Socket.IO connection');
    onError(new Error('No access token provided'));
    return null;
  }

  if (socket) {
    socket.disconnect();
  }

  const socketUrl = import.meta.env.VITE_WS_URL;
  if (!socketUrl) {
    console.error(
      'Socket.IO URL is not defined. Please check VITE_WS_URL in .env.'
    );
    onError(new Error('Socket.IO URL is not defined'));
    return null;
  }

  console.log('Attempting to connect to Socket.IO at:', socketUrl);

  socket = io(socketUrl, {
    auth: { token: `Bearer ${token}` },
    reconnection: true,
    reconnectionAttempts: maxReconnectAttempts,
    reconnectionDelay: reconnectDelay,
    transports: ['websocket'],
  });

  socket.on('connect', () => {
    console.log('Socket.IO connected to:', socketUrl);
    console.log('Joined room for userId:', socket.auth.userId || 'unknown'); // Added: Log room subscription
    reconnectAttempts = 0;
    while (messageQueue.length > 0) {
      const queuedMessage = messageQueue.shift();
      console.log('Sending queued message:', queuedMessage);
      socket.emit('sendMessage', queuedMessage);
    }
  });

  socket.on('reconnect_attempt', () => {
    console.log('Reconnect attempt:', reconnectAttempts + 1);
    if (reconnectAttempts >= maxReconnectAttempts) {
      onError(new Error('Max reconnect attempts reached'));
    }
    reconnectAttempts++;
  });

  socket.on('receiveMessage', (message) => {
    console.log('Received message:', message);
    onMessage({
      id: message.id || Date.now().toString(),
      chatId: message.chatId,
      userId: message.userId,
      friendId: message.friendId,
      content: message.content,
      timestamp: message.timestamp || new Date().toISOString(),
      isAI: message.isAI ?? false, 
      tempId: message.tempId,
    });
  });

  socket.on('error', (error) => {
    const message = getErrorMessage(error);
    console.error('Socket.IO error:', message);
    onError(new Error(message));
  });

  socket.on('connect_error', (error) => {
    const message = getErrorMessage(error);
    console.error('Connection error:', message);
    onError(new Error(message));
  });

  socket.on('disconnect', (reason) => {
    console.log('Socket.IO disconnected. Reason:', reason);
    if (reason === 'io server disconnect') {
      onError(new Error('Server disconnected the socket'));
    }
  });

  return socket;
};

export const disconnectWebSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
    messageQueue = [];
  }
};

export const sendWebSocketMessage = (message) => {
  if (socket && socket.connected) {
    console.log('Emitting sendMessage:', message);
    socket.emit('sendMessage', message);
  } else {
    console.warn('Socket.IO is not connected. Queuing message:', message);
    messageQueue.push(message);
  }
};