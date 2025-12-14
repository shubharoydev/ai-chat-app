import { io } from 'socket.io-client';

let socket = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectionDelay = 2000;
let messageQueue = [];

//connect
export const connectWebSocket = (onMessage, onError) => {
  console.log('[WebSocket] Initializing WebSocket connection...');
  if (socket) {
    console.log('[WebSocket] Disconnecting existing WebSocket...');
    socket.disconnect();
    console.log('[WebSocket] Existing WebSocket disconnected');
  }

  const socketUrl = import.meta.env.VITE_WS_URL;
  if (!socketUrl) {
    onError(new Error('VITE_WS_URL missing'));
    return null;
  }

  socket = io(socketUrl, {
    withCredentials: true,
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: maxReconnectAttempts,
    reconnectionDelay,
  });

  socket.on('connect', () => {
    console.log('[WebSocket] Connected to server with socket ID:', socket.id);
    reconnectAttempts = 0;
    while (messageQueue.length) socket.emit('sendMessage', messageQueue.shift());
  });
  socket.on('token-refreshed', (newAccessToken) => {
  console.log('[WebSocket] Received fresh accessToken from server');
  
  // Update the cookie so future HTTP requests work without refresh
  document.cookie = `accessToken=${newAccessToken}; path=/; SameSite=Lax; ${
    import.meta.env.PROD ? 'Secure;' : ''
  }`;
  });
  socket.on('reconnect_attempt', (attemptNumber) => {
    console.log(`[WebSocket] Reconnection attempt ${attemptNumber}...`);
  });

  socket.on('reconnect', (attemptNumber) => {
    console.log(`[WebSocket] Successfully reconnected after ${attemptNumber} attempts`);
  });

  socket.on('reconnect_error', (error) => {
    console.error('[WebSocket] Reconnection error:', error);
  });

  socket.on('reconnect_failed', () => {
    console.error('[WebSocket] Failed to reconnect after multiple attempts');
  });

  socket.on('receiveMessage', (msg) => {
    const messageId = msg.tempId || msg.id || `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    console.log('[WebSocket] Received message:', {
      id: messageId,
      from: msg.userId,
      to: msg.friendId,
      content: msg.content?.substring(0, 30) + (msg.content?.length > 30 ? '...' : '')
    });

    if (typeof onMessage === 'function') {
      try {
        onMessage({
          id: messageId,
          chatId: msg.chatId || (msg.userId && msg.friendId ?
            [msg.userId, msg.friendId].sort().join(':') : undefined),
          userId: msg.userId,
          friendId: msg.friendId,
          content: msg.content,
          timestamp: msg.timestamp || new Date().toISOString(),
          isAI: msg.isAI ?? false,
          tempId: msg.tempId,
          ...(msg._id && { _id: msg._id }),
          ...(msg.createdAt && { createdAt: msg.createdAt })
        });
      } catch (err) {
        console.error('[WebSocket] Error in message handler:', err);
      }
    }
  });

  socket.on('connect_error', (err) => {
    console.error('[WebSocket] Connection error:', err.message);
    onError(err);
  });

  socket.on('error', (error) => {
    console.error('[WebSocket] Connection error:', error);
    console.error('[WebSocket] Error details:', {
      message: error.message,
      type: error.type,
      description: error.description
    });
    if (onError) onError(error);
  });

  socket.on('disconnect', (r) => {
    console.log('[WebSocket] Disconnected from server. Reason:', r);
    console.log('[WebSocket] Will attempt to reconnect automatically...');
    if (onError) onError(new Error(`Disconnected: ${r}`));
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

export const sendWebSocketMessage = (payload) => {
  if (!socket) {
    const error = new Error('WebSocket not initialized');
    console.warn('[WebSocket] Socket not initialized, queueing message');
    messageQueue.push(payload);
    return Promise.reject(error);
  }

  if (!socket.connected) {
    const error = new Error('WebSocket not connected');
    console.warn('[WebSocket] Socket not connected, queueing message');
    messageQueue.push(payload);

    if (reconnectAttempts < maxReconnectAttempts) {
      console.log('[WebSocket] Attempting to reconnect...');
      socket.connect();
    }

    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    try {
      console.log('[WebSocket] Sending message:', {
        to: payload.friendId,
        content: payload.content?.substring(0, 30) + (payload.content?.length > 30 ? '...' : '')
      });

      const messageToSend = {
        ...payload,
        timestamp: payload.timestamp || new Date().toISOString(),
        tempId: payload.tempId,
      };

      console.log('[WebSocket] Sending message with payload:', {
        ...messageToSend,
        content: messageToSend.content?.substring(0, 30) + (messageToSend.content?.length > 30 ? '...' : '')
      });

      socket.emit('sendMessage', messageToSend, (response) => {
        if (response?.error) {
          console.error('[WebSocket] Error sending message:', response.error);
          reject(new Error(response.error));
        } else {
          console.log('[WebSocket] Message sent successfully', {
            ...response,
            messages: Array.isArray(response.messages)
              ? response.messages.map(m => ({
                ...m,
                content: m.content?.substring(0, 30) + (m.content?.length > 30 ? '...' : '')
              }))
              : response.messages
          });
          resolve({
            ...response,
            tempId: messageToSend.tempId
          });
        }
      });
    } catch (err) {
      console.error('[WebSocket] Error in sendWebSocketMessage:', err);
      reject(err);
    }
  });
};
