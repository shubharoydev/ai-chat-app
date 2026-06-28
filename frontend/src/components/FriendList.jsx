import { useState, useEffect, useContext } from 'react';
import { getFriends, addFriend } from '../utils/api';
import { checkOnlineStatus, emitHeartbeat, subscribeToStatusUpdates } from '../utils/WebSocket';
import { UserContext } from '../context/UserContext';
import { useNavigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';

function FriendList({ onSelectFriend }) {
  const { user } = useContext(UserContext);
  const [friends, setFriends] = useState([]);
  const [error, setError] = useState('');
  const [onlineUsers, setOnlineUsers] = useState(new Set());

  // Search State
  const [searchQuery, setSearchQuery] = useState('');

  const [showAddModal, setShowAddModal] = useState(false);
  const [newFriendEmail, setNewFriendEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();

  // Fetch friends once when component mounts
  useEffect(() => {
    const fetchFriends = async () => {
      setLoading(true);
      setError('');
      try {
        const { data } = await getFriends();
        const formattedFriends = Array.isArray(data.friends)
          ? data.friends.map((friend) => ({
            id: friend.id,
            name: friend.name,
            nickname: friend.nickname,
            email: friend.email,
          }))
          : [];
        setFriends(formattedFriends);
      } catch (err) {
        console.error('Failed to fetch friends:', err);
        setError(err.response?.data?.error || 'Failed to fetch friends');
      } finally {
        setLoading(false);
      }
    };

    fetchFriends();
  }, []);

  useEffect(() => {
  const check = async () => {
    emitHeartbeat();
    if (!friends.length) return;

    const online = await checkOnlineStatus(friends.map(f => f.id));
    setOnlineUsers(new Set(online));
  };

  check();
  const interval = setInterval(check, 10000);

  const unsubscribe = subscribeToStatusUpdates(({ userId, status }) => {
    setOnlineUsers(prev => {
      const next = new Set(prev);
      status === 'online' ? next.add(userId) : next.delete(userId);
      return next;
    });
  });

  return () => {
    clearInterval(interval);
    unsubscribe?.();
  };
}, [friends]);

  //  Add new friend
  const handleAddFriend = async () => {
    const email = newFriendEmail.trim();
    if (!email) {
      toast.error('Friend email is required');
      return;
    }

    // Prevent duplicates
    if (friends.some((f) => f.email === email)) {
      toast.error('Friend already added');
      return;
    }

    setAdding(true);
    try {
      const { data } = await addFriend({ email });

      // Ensure we have consistent friend shape
      const newFriend = {
        id: data.id,
        name: data.name || email,
        nickname: data.nickname || '',
        email,
      };

      setFriends((prev) => [...prev, newFriend]);
      setNewFriendEmail('');
      setShowAddModal(false);
      toast.success('Friend successfully added!');
    } catch (err) {
      console.error('Add friend error:', err);
      if (err.response?.status === 404) {
        toast.error('User not found');
      } else if (err.response?.status === 409) {
        toast.error('Already friends');
      } else {
        toast.error(err.response?.data?.error || 'Failed to add friend');
      }
    } finally {
      setAdding(false);
    }
  };

  const handleRetry = async () => {
    setError('');
    toast.loading('Retrying...');
    try {
      const { data } = await getFriends();
      setFriends(data.friends || []);
      toast.dismiss();
      toast.success('Friends reloaded!');
    } catch (err) {
      toast.dismiss();
      toast.error('Retry failed. Please try again later.');
    }
  };

  // Filter friends based on search query
  const filteredFriends = friends.filter((friend) => {
    const query = searchQuery.toLowerCase();
    const name = (friend.name || '').toLowerCase();
    const nickname = (friend.nickname || '').toLowerCase();
    return name.includes(query) || nickname.includes(query);
  });

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

  return (
    <div className="bg-gray-50 h-full flex flex-col border-r border-gray-200">
      <Toaster position="top-right" reverseOrder={false} />

      {/* Header */}
      <div className="p-4 bg-white border-b border-gray-200">
        <h3 className="text-xl font-bold text-gray-800">
          Messages
        </h3>
      </div>

      {/* Search Bar */}
      <div className="p-3 bg-white">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg
              className="h-5 w-5 text-gray-400"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <input
            type="text"
            placeholder="Search friends..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="block w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-xl leading-5 bg-gray-50 placeholder-gray-400 focus:outline-none focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:text-sm transition-all duration-200"
          />
        </div>
      </div>

      {/* Add Friend Button */}
      <div className="px-3 pb-3 bg-white">
        <button
          onClick={() => setShowAddModal(true)}
          className="w-full bg-blue-600 text-white p-2.5 rounded-xl hover:bg-blue-700 active:bg-blue-800 transition-all duration-200 text-sm font-medium flex items-center justify-center gap-2 shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Friend
        </button>
      </div>

      {/* Friends List */}
      <ul className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : filteredFriends.length > 0 ? (
          filteredFriends.map((friend) => (
            <li
              key={friend.id}
              onClick={() => onSelectFriend(friend)}
              className="p-3 hover:bg-white rounded-xl cursor-pointer flex items-center gap-3 transition-all duration-200 group hover:shadow-sm"
            >
              {/* Avatar with online indicator */}
              <div className="relative flex-shrink-0">
                <div className={`w-12 h-12 rounded-full ${getAvatarColor(friend.nickname || friend.name)} flex items-center justify-center text-white font-semibold text-sm shadow-sm`}>
                  {getInitials(friend.nickname || friend.name)}
                </div>
                {onlineUsers.has(friend.id) && (
                  <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-gray-50 shadow-sm"></div>
                )}
              </div>

              {/* Friend Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-900 truncate">
                    {friend.nickname || friend.name || 'Unknown Friend'}
                  </span>
                  {onlineUsers.has(friend.id) && (
                    <span className="text-xs text-green-600 font-medium">Online</span>
                  )}
                </div>
                <span className="text-xs text-gray-500 truncate block">{friend.email}</span>
              </div>
            </li>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <p className="text-sm">
              {searchQuery ? 'No matching friends found' : 'No friends available'}
            </p>
          </div>
        )}
      </ul>

      {/* Retry Button */}
      {error && !loading && (
        <div className="px-3 pb-3">
          <button
            onClick={handleRetry}
            className="w-full bg-blue-600 text-white p-2.5 rounded-xl hover:bg-blue-700 transition-all duration-200 text-sm font-medium shadow-sm"
          >
            Retry Fetching Friends
          </button>
        </div>
      )}

      {/* Add Friend Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex justify-center items-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
            <h4 className="text-xl font-bold text-gray-900 mb-4">Add Friend</h4>
            <input
              type="email"
              value={newFriendEmail}
              onChange={(e) => setNewFriendEmail(e.target.value)}
              placeholder="Enter friend's email"
              className="w-full p-3 border border-gray-200 rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm transition-all duration-200"
              disabled={adding}
              autoFocus
            />
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowAddModal(false)}
                className="bg-gray-100 text-gray-700 px-5 py-2.5 rounded-xl hover:bg-gray-200 text-sm font-medium transition-all duration-200"
                disabled={adding}
              >
                Cancel
              </button>
              <button
                onClick={handleAddFriend}
                className="bg-blue-600 text-white px-5 py-2.5 rounded-xl hover:bg-blue-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm"
                disabled={adding}
              >
                {adding ? 'Adding...' : 'Add Friend'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FriendList;