import { useState, useEffect, useRef, useContext } from 'react';
import { getMessages } from '../utils/api';
import { UserContext } from '../context/UserContext';
import { sendWebSocketMessage } from '../utils/WebSocket.js';

function ChatWindow({ friend, onBack }) {
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
        //console.log('Historic messages loaded:', formatted.length);
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
        //console.log(`Replacing tempId ${tempId} → real messageId ${id || newMessage.messageId}`);
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
        //console.log('Adding confirmed WS message:', msg);
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

  // Generate avatar initials
  const getInitials = (name) => {
    if (!name) return '?';
    const parts = name.split(' ');
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  };

  // Get avatar color based on name
  const getAvatarColor = (name) => {
    if (!name) return 'bg-gray-400';
    const colors = [
      'bg-blue-500', 'bg-purple-500', 'bg-pink-500', 'bg-indigo-500',
      'bg-teal-500', 'bg-orange-500', 'bg-red-500', 'bg-cyan-500'
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  // Group messages by sender and time
  const groupMessages = (messages) => {
    const groups = [];
    let currentGroup = null;

    messages.forEach((msg) => {
      const isMe = msg.userId === currentUserId && !msg.isAI;
      const sender = isMe ? 'me' : msg.isAI ? 'ai' : 'friend';

      if (!currentGroup || currentGroup.sender !== sender) {
        currentGroup = { sender, messages: [msg] };
        groups.push(currentGroup);
      } else {
        currentGroup.messages.push(msg);
      }
    });

    return groups;
  };

  const messageGroups = groupMessages(messages);

  // Render
  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="p-4 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center gap-3">
          {/* Back button - only on mobile */}
          {onBack && (
            <button
              onClick={onBack}
              className="md:hidden p-2 -ml-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all duration-200"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div className={`w-10 h-10 rounded-full ${getAvatarColor(friend?.nickname || friend?.name)} flex items-center justify-center text-white font-semibold text-sm shadow-sm`}>
            {getInitials(friend?.nickname || friend?.name)}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-gray-900 truncate">
              {friend?.nickname || friend?.name || 'Unknown'}
            </h3>
            <p className="text-xs text-gray-500 truncate">{friend?.email}</p>
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 p-4 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        )}
        {messages.length === 0 && !loading && !error && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-sm font-medium">No messages yet</p>
            <p className="text-xs mt-1">Say hi to start the conversation!</p>
          </div>
        )}

        {messageGroups.map((group, groupIndex) => {
          const isMe = group.sender === 'me';
          const isAI = group.sender === 'ai';
          const senderName = isMe ? 'You' : isAI ? 'AI' : friend?.nickname || friend?.name || 'Friend';

          return (
            <div key={`group-${groupIndex}`} className={`mb-4 ${isMe ? 'flex flex-col items-end' : 'flex flex-col items-start'}`}>
              <div className="flex items-end gap-2 mb-1">
                {!isMe && (
                  <div className={`w-8 h-8 rounded-full ${getAvatarColor(isAI ? 'AI' : friend?.nickname || friend?.name)} flex items-center justify-center text-white font-semibold text-xs flex-shrink-0`}>
                    {getInitials(isAI ? 'AI' : friend?.nickname || friend?.name)}
                  </div>
                )}
                <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  {group.messages.map((msg, msgIndex) => (
                    <div
                      key={msg.id || `fallback-${groupIndex}-${msgIndex}`}
                      className={`mb-1 max-w-md px-4 py-2.5 rounded-2xl shadow-sm ${
                        isMe
                          ? 'bg-blue-600 text-white rounded-br-md'
                          : isAI
                            ? 'bg-gray-200 text-gray-800 rounded-bl-md'
                            : 'bg-white text-gray-800 rounded-bl-md border border-gray-200'
                      }`}
                    >
                      <p className="text-sm break-words">{msg.content}</p>
                      {msg.isAI && <span className="ml-2 text-xs opacity-70">AI</span>}
                      <div className={`text-xs mt-1 ${isMe ? 'text-blue-100' : 'text-gray-500'}`}>
                        {new Date(msg.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                {isMe && (
                  <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold text-xs flex-shrink-0">
                    {getInitials('You')}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white border-t border-gray-200">
        <div className="flex gap-3 items-end">
          <div className="flex-1 relative">
            <input
              type="text"
              value={newMessageText}
              onChange={(e) => setNewMessageText(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
              placeholder={
                !currentUserId || !currentFriendId ? 'Loading…' : 'Type a message…'
              }
              className="w-full p-3 pr-12 border border-gray-200 rounded-xl outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all duration-200 text-sm"
              disabled={loading || !currentUserId || !currentFriendId}
            />
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              disabled={loading || !currentUserId || !currentFriendId}
            >
            </button>
          </div>
          <button
            onClick={handleSendMessage}
            className="bg-blue-600 text-white p-3 rounded-xl hover:bg-blue-700 active:bg-blue-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all duration-200 shadow-sm flex items-center justify-center"
            disabled={
              loading ||
              !currentUserId ||
              !currentFriendId ||
              !newMessageText.trim()
            }
          >
            <svg className="w-5 h-5 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChatWindow;