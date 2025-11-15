import { useState, useEffect, useRef, useContext } from 'react';
import { getMessages } from '../utils/api';
import { UserContext } from '../context/UserContext';
import { sendWebSocketMessage } from '../utils/WebSocket.js';

function ChatWindow({ friend }) {
  const { newMessage, user, wsError } = useContext(UserContext);
  const [messages, setMessages] = useState([]);
  const [newMessageText, setNewMessageText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const currentUserId = user?.id;
  const currentFriendId = friend?.id;


  useEffect(() => {
    if (!currentFriendId || !currentUserId) return;

    const fetch = async () => {
      setLoading(true);
      setError('');
      try {
        const { data } = await getMessages(currentFriendId);

        const formatted = data.messages
          .map((msg) => {
            const id = msg.id || msg.tempId;               
            if (!id || !msg.userId || !msg.friendId) {
              console.warn('Skipping malformed historic message:', msg);
              return null;
            }
            return {
              id,
              tempId: msg.tempId,          
              chatId: msg.chatId,
              userId: msg.userId,
              friendId: msg.friendId,
              content: msg.content || '',
              timestamp: msg.timestamp,
              isAI: msg.isAI ?? false,
            };
          })
          .filter(Boolean);

        setMessages(formatted);
        console.log('Historic messages loaded:', formatted.length);
      } catch (e) {
        const msg = e.response?.data?.error || e.message;
        setError(msg);
        console.error('fetchMessages error:', msg);
      } finally {
        setLoading(false);
      }
    };

    fetch();
  }, [currentFriendId, currentUserId]);

  useEffect(() => {
    if (!newMessage) return;

    const {
      id,
      tempId,
      userId,
      friendId,
      content,
      timestamp,
      isAI,
      chatId,
    } = newMessage;

    
    const belongs =
      (friendId === currentUserId && userId === currentFriendId) ||
      (userId === currentUserId && friendId === currentFriendId);

    if (!belongs) return;

    setMessages((prev) => {
      // Server confirmed a temp message → swap id
      if (tempId && !isAI && prev.some((m) => m.tempId === tempId)) {
        console.log(`Replacing tempId ${tempId} → real id ${id}`);
        return prev.map((m) =>
          m.tempId === tempId ? { ...m, id, tempId: undefined } : m
        );
      }

      //  Brand-new confirmed message
      if (id && !prev.some((m) => m.id === id)) {
        const msg = {
          id,
          tempId,
          chatId: chatId || [userId, friendId].sort().join(':'),
          userId,
          friendId,
          content: content || '',
          timestamp: timestamp || new Date().toISOString(),
          isAI: isAI ?? false,
        };
        console.log('Adding confirmed WS message:', msg);
        return [...prev, msg];
      }

      //  Already present → ignore
      return prev;
    });
  }, [newMessage, currentUserId, currentFriendId]);

  //  Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Send new message 
  const handleSendMessage = () => {
    if (!newMessageText.trim()) return;
    if (!currentUserId || !currentFriendId) {
      setError('User not loaded');
      return;
    }

    const tempId = `temp-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const now = new Date().toISOString();

    const optimistic = {
      id: tempId,
      tempId,
      chatId: [currentUserId, currentFriendId].sort().join(':'),
      userId: currentUserId,
      friendId: currentFriendId,
      content: newMessageText,
      timestamp: now,
      isAI: false,
    };

    setMessages((prev) => [...prev, optimistic]);

    // Send to server
    sendWebSocketMessage({
      friendId: currentFriendId,
      content: newMessageText,
      tempId,
    });

    setNewMessageText('');
  };

  // Render
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 bg-white border-b">
        <h3 className="text-lg font-semibold">
          {friend?.nickname || friend?.name || 'Unknown'}
        </h3>
      </div>

      {/* Messages */}
      <div className="flex-1 p-4 overflow-y-auto">
        {wsError && (
          <p className="text-red-500 mb-4">
            WebSocket Error: {wsError}. Refresh the page.
          </p>
        )}
        {loading && <p className="text-gray-500 mb-4">Loading…</p>}
        {error && <p className="text-red-500 mb-4">{error}</p>}

        {messages.map((msg, i) => {
          const isMe = msg.userId === currentUserId;
          const sender = isMe
            ? 'You'
            : msg.isAI
            ? 'AI'
            : friend?.nickname || friend?.name || 'Friend';

          return (
            <div
              key={msg.id || `fallback-${i}`}
              className={`mb-2 ${isMe ? 'text-right' : 'text-left'}`}
            >
              <div
                className={`inline-block p-2 rounded-lg max-w-xs break-words ${
                  isMe
                    ? 'bg-green-500 text-white'
                    : msg.isAI
                    ? 'bg-gray-300 text-black'
                    : 'bg-blue-500 text-white'
                }`}
              >
                {msg.content}
                {msg.isAI && <span className="ml-2 text-xs">[AI]</span>}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {sender} •{' '}
                {new Date(msg.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 bg-white border-t">
        <div className="flex">
          <input
            type="text"
            value={newMessageText}
            onChange={(e) => setNewMessageText(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder={
              !currentUserId || !currentFriendId ? 'Loading…' : 'Type a message…'
            }
            className="flex-1 p-2 border rounded-l outline-none focus:border-blue-500"
            disabled={loading || !currentUserId || !currentFriendId}
          />
          <button
            onClick={handleSendMessage}
            className="bg-blue-500 text-white p-2 rounded-r hover:bg-blue-600 disabled:bg-gray-400 transition"
            disabled={
              loading ||
              !currentUserId ||
              !currentFriendId ||
              !newMessageText.trim()
            }
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChatWindow;