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


        const formatted = data.messages.map((msg) => {
          // Extract REAL unique ID: MongoDB _id OR tempId (for optimistic)
          const permanentId = msg._id?.$oid || msg._id || msg.id || msg.tempId;
          if (!permanentId) {
            console.warn('Message has no ID at all, skipping:', msg);
            return null;
          }


          // Normalize userId & friendId (handle ObjectId wrapper)
          const userId = msg.userId?.$oid || msg.userId;
          const friendId = msg.friendId?.$oid || msg.friendId;


          if (!userId || !friendId) {
            console.warn('Missing userId or friendId:', msg);
            return null;
          }


          //  Normalize timestamp
          let timestamp = msg.timestamp || msg.createdAt || msg.updatedAt;
          if (timestamp) {
            if (timestamp.$date) {
              if (timestamp.$date.$numberLong) {
                timestamp = new Date(Number(timestamp.$date.$numberLong)).toISOString();
              } else {
                timestamp = timestamp.$date;
              }
            } else if (typeof timestamp === 'object' && timestamp.$numberLong) {
              timestamp = new Date(Number(timestamp.$numberLong)).toISOString();
            }
          } else {
            timestamp = new Date().toISOString();
          }


          //  Final clean message object
          return {
            id: permanentId,                    // This is the key! Works for DB + temp messages
            messageId: msg.messageId || undefined,
            tempId: msg.tempId || undefined,    // Only exists for optimistic/pending
            chatId: msg.chatId || `${[userId, friendId].sort().join(':')}`,
            userId,
            friendId,
            content: msg.content || '',
            timestamp,
            isAI: msg.isAI ?? false,
          };
        })
          .filter(Boolean)
          .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        setMessages(formatted);


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
      // Server confirmed a temp message → swap id (using messageId from server)
      // Check if this new message has a tempId that matches one of our local ones
      if (tempId && prev.some((m) => m.tempId === tempId)) {
        console.log(`Replacing tempId ${tempId} → real messageId ${id || newMessage.messageId}`);
        return prev.map((m) =>
          m.tempId === tempId
            ? { ...m, id: id || newMessage.messageId, messageId: newMessage.messageId, tempId: undefined }
            : m
        );
      }

      //  Brand-new confirmed message (not in our list)
      // Ensure we use messageId if available
      const uniqueId = id || newMessage.messageId;

      if (uniqueId && !prev.some((m) => m.id === uniqueId || m.messageId === uniqueId)) {
        const msg = {
          id: uniqueId,
          messageId: newMessage.messageId,
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
      <div className="flex-1 p-4 overflow-y-auto">
        {loading && <p className="text-gray-500 text-center mb-4">Loading messages…</p>}
        {messages.length === 0 && !loading && !error && (
          <p className="text-gray-400 text-center">No messages yet. Say hi!</p>
        )}

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
              className={`mb-4 ${isMe ? 'text-right' : 'text-left'}`}
            >
              <div
                className={`inline-block p-3 rounded-2xl max-w-xs break-words shadow-sm ${isMe
                  ? 'bg-green-500 text-white'
                  : msg.isAI
                    ? 'bg-gray-200 text-gray-800'
                    : 'bg-blue-500 text-white'
                  }`}
              >
                {msg.content}
                {msg.isAI && <span className="ml-2 text-xs opacity-80">[AI]</span>}
              </div>
              <div className="text-xs text-gray-500 mt-1 px-1">
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
        <div className="flex gap-2">
          <input
            type="text"
            value={newMessageText}
            onChange={(e) => setNewMessageText(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
            placeholder={
              !currentUserId || !currentFriendId ? 'Loading…' : 'Type a message…'
            }
            className="flex-1 p-3 border rounded-lg outline-none focus:border-blue-500 transition"
            disabled={loading || !currentUserId || !currentFriendId}
          />
          <button
            onClick={handleSendMessage}
            className="bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 disabled:bg-gray-400 transition font-medium"
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