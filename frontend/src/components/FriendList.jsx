import { useState, useEffect, useContext } from 'react';
import { getFriends, addFriend } from '../utils/api';
import { UserContext } from '../context/UserContext';
import { useNavigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';

function FriendList({ onSelectFriend }) {
  const { user } = useContext(UserContext);
  const [friends, setFriends] = useState([]);
  const [error, setError] = useState('');
  
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

  return (
    <div className="p-4 bg-white rounded-lg shadow-md w-full md:w-80 lg:w-96 h-full overflow-y-auto flex flex-col">
      <Toaster position="top-right" reverseOrder={false} />
      
      <h3 className="text-lg font-semibold text-gray-800 mb-4">
        Friends
      </h3>

      {/* Search Bar */}
      <div className="relative mb-3">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          {/* Search Icon SVG */}
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
          className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 sm:text-sm transition duration-150 ease-in-out"
        />
      </div>

      {/* Add Friend Button */}
      <button
        onClick={() => setShowAddModal(true)}
        className="mb-4 w-full bg-green-500 text-white p-3 rounded-lg hover:bg-green-600 transition-colors duration-200 text-sm"
      >
        Add Friend
      </button>

      {/* Friends List */}
      <ul className="space-y-2 flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-gray-500 text-sm">Loading friends...</p>
        ) : filteredFriends.length > 0 ? (
          filteredFriends.map((friend) => (
            <li
              key={friend.id}
              onClick={() => onSelectFriend(friend)}
              className="p-3 hover:bg-gray-100 rounded-lg cursor-pointer flex justify-between items-center transition-colors duration-200"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium text-gray-800">
                  {friend.nickname || friend.name || 'Unknown Friend'}
                </span>
                <span className="text-xs text-gray-500">{friend.email}</span>
              </div>
            </li>
          ))
        ) : (
          <p className="text-gray-500 text-sm">
            {searchQuery ? 'No matching friends found' : 'No friends available'}
          </p>
        )}
      </ul>

      {/* Retry Button */}
      {error && !loading && (
        <button
          onClick={handleRetry}
          className="mt-4 w-full bg-blue-500 text-white p-3 rounded-lg hover:bg-blue-600 transition-colors duration-200 text-sm"
        >
          Retry Fetching Friends
        </button>
      )}

      {/* Add Friend Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white p-6 rounded-lg w-80 relative">
            <h4 className="text-lg font-semibold mb-4">Add Friend</h4>
            <input
              type="email"
              value={newFriendEmail}
              onChange={(e) => setNewFriendEmail(e.target.value)}
              placeholder="Enter friend's email"
              className="w-full p-3 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
              disabled={adding}
            />
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setShowAddModal(false)}
                className="bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400 text-sm"
                disabled={adding}
              >
                Cancel
              </button>
              <button
                onClick={handleAddFriend}
                className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 text-sm disabled:opacity-50"
                disabled={adding}
              >
                {adding ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FriendList;