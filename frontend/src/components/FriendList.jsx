import { useState, useEffect, useContext } from 'react';
import { getFriends, addFriend } from '../utils/api';
import { UserContext } from '../context/UserContext';
import { useNavigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';

function FriendList({ onSelectFriend }) {
  const { user } = useContext(UserContext);
  const [friends, setFriends] = useState([]);
  const [error, setError] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newFriendEmail, setNewFriendEmail] = useState('');
  const navigate = useNavigate();

  // Fetch friends
  useEffect(() => {
    const fetchFriends = async () => {
      try {
        const { data } = await getFriends();
        const formattedFriends = Array.isArray(data.friends)
          ? data.friends.map((friend) => ({
              ...friend,
            }))
          : [];
        setFriends(formattedFriends);
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to fetch friends');
      }
    };
    fetchFriends();
  }, []);

  const handleAddFriend = async () => {
    if (!newFriendEmail) {
      toast.error('Friend email is required');
      return;
    }
    try {
      const { data } = await addFriend({ email: newFriendEmail });
      setFriends([...friends, { id: data.id, name: data.name || newFriendEmail }]);
      setNewFriendEmail('');
      setShowAddModal(false);
      toast.success('Friend successfully added!');
    } catch (err) {
      if (err.response?.status === 404) {
        toast.error('User not found');
        navigate('/'); 
      } else {
        toast.error(err.response?.data?.error || 'Failed to add friend');
      }
    }
  };

  return (
    <div className="p-4 bg-white rounded-lg shadow-md w-full md:w-80 lg:w-96 h-full overflow-y-auto">
      <Toaster position="top-right" reverseOrder={false} />
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Friends</h3>

      {/* Add friend button */}
      <button
        onClick={() => setShowAddModal(true)}
        className="mb-4 w-full bg-green-500 text-white p-3 rounded-lg hover:bg-green-600 transition-colors duration-200 text-sm"
      >
        Add Friend
      </button>

      {/* Friends list */}
      <ul className="space-y-2">
        {friends.length > 0 ? (
          friends.map((friend) => (
            <li
              key={friend.id}
              onClick={() => onSelectFriend(friend)}
              className="p-3 hover:bg-gray-100 rounded-lg cursor-pointer flex justify-between items-center transition-colors duration-200"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium text-gray-800">
                  {friend.nickname || friend.name || 'Unknown Friend'}
                </span>
              </div>
            </li>
          ))
        ) : (
          <p className="text-gray-500 text-sm">No friends available</p>
        )}
      </ul>

      {/* Retry button */}
      {error && (
        <button
          onClick={() => window.location.reload()}
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
              type="text"
              value={newFriendEmail}
              onChange={(e) => setNewFriendEmail(e.target.value)}
              placeholder="Enter friend's email"
              className="w-full p-3 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
            />
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setShowAddModal(false)}
                className="bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleAddFriend}
                className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 text-sm"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FriendList;
