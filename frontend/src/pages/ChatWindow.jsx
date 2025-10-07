import { useState, useEffect, useRef, useContext } from 'react';
import { getMessages } from '../utils/api';
import { UserContext } from '../context/UserContext';
import { sendWebSocketMessage } from '../utils/websocket';

function ChatWindow({ friend }) {
  const { newMessage, user, wsError } = useContext(UserContext);
  const [messages, setMessages] = useState([]);
  const [newMessageText, setNewMessageText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // Load chat history once
  useEffect(() => {
    const fetchMessages = async () => {
      setLoading(true);
      setError('');
      try {
        const { data } = await getMessages(friend.id);
        setMessages(
          data.messages.map((msg) => ({
            id: msg.id,
            chatId: msg.chatId,
            userId: msg.userId,
            friendId: msg.friendId,
            content: msg.content,
            timestamp: msg.timestamp,
            isAI: msg.isAI ?? false, 
          }))
        );
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to fetch messages');
      } finally {
        setLoading(false);
      }
    };
    fetchMessages();
    console.log('ChatWindow initialized for friendId:', friend.id, 'userId:', user.id); // Added: Log initialization
  }, [friend.id, user.id]);

  // Handle incoming socket messages
  useEffect(() => {
    if (!newMessage) return;

    console.log('New message from context:', newMessage);

    if (newMessage.friendId === friend.id || newMessage.userId === friend.id) { // Modified: Check both userId and friendId
      setMessages((prev) => {
        if (newMessage.tempId) {
          const updatedMessages = prev.map((msg) =>
            msg.id === newMessage.tempId ? { ...msg, id: newMessage.id } : msg
          );
          if (!updatedMessages.some((msg) => msg.id === newMessage.id)) {
            return [...updatedMessages, { ...newMessage, isAI: newMessage.isAI ?? false }];
          }
          return updatedMessages;
        }
        if (prev.some((msg) => msg.id === newMessage.id)) return prev;
        return [...prev, { ...newMessage, isAI: newMessage.isAI ?? false }];
      });
    } else {
      console.log('Message ignored, friendId mismatch:', newMessage.friendId, '!=', friend.id); // Added: Log ignored messages
    }
  }, [newMessage, friend.id]);

  //  scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  //  Send message via WebSocket
  const handleSendMessage = () => {
    if (!newMessageText.trim()) return;

    const tempId = Date.now().toString();
    const message = {
      id: tempId,
      friendId: friend.id,
      userId: user.id,
      chatId: [user.id, friend.id].sort().join(':'),
      content: newMessageText,
      timestamp: new Date().toISOString(),
      isAI: false,
    };

    setMessages((prev) => [...prev, message]);
    sendWebSocketMessage({ friendId: friend.id, content: newMessageText, tempId });

    setNewMessageText('');
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 bg-white border-b">
        <h3 className="text-lg font-semibold">
          {friend.nickname || friend.name}
        </h3>
      </div>
      <div className="flex-1 p-4 overflow-y-auto">
        {wsError && (
          <p className="text-red-500 mb-4">WebSocket Error: {wsError}. Please refresh.</p>
        )}
        {loading && <p className="text-gray-500 mb-4">Loading messages...</p>}
        {error && <p className="text-red-500 mb-4">{error}</p>}
 {messages.map((msg, index) => {
  const isUser = msg.userId === user.id; // ✅ true if current user sent it
  const isAI = msg.isAI;

  return (
    <div
      key={msg.id || index}
      className={`mb-2 ${isUser ? 'text-right' : 'text-left'}`}
    >
      <div
        className={`inline-block p-2 rounded-lg ${
          isUser
            ? 'bg-green-500 text-white'   // ✅ user → right side, green
            : isAI
            ? 'bg-gray-300 text-black'    // ✅ AI → left side, gray
            : 'bg-blue-500 text-white'    // ✅ friend → left side, blue
        }`}
      >
        {msg.content}
        {isAI && (
          <span className="ml-2 text-xs text-gray-700">[AI]</span>
        )}
      </div>
      <div className="text-xs text-gray-500">
        {new Date(msg.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
})}

        <div ref={messagesEndRef} />
      </div>
      <div className="p-4 bg-white border-t">
        <div className="flex">
          <input
            type="text"
            value={newMessageText}
            onChange={(e) => setNewMessageText(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 p-2 border rounded-l"
            disabled={loading}
          />
          <button
            onClick={handleSendMessage}
            className="bg-blue-500 text-white p-2 rounded-r hover:bg-blue-600"
            disabled={loading}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChatWindow;
