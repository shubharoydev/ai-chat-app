import { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserContext } from '../context/UserContext';
import FriendList from '../components/FriendList';
import ChatWindow from './ChatWindow';


function Home() {
  const { user, isLoading, logout, wsError } = useContext(UserContext);
  const navigate = useNavigate();
  const [selectedFriend, setSelectedFriend] = useState(null);

  useEffect(() => {
    if (!isLoading && !user) {
      navigate('/login');
    }
  }, [user, isLoading, navigate]);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  if (isLoading) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  return (
    <div className="flex h-screen">
      <div className="w-1/4 bg-white border-r">
        <div className="p-4 border-b">
          <button
            onClick={handleLogout}
            className="bg-red-500 text-white p-2 rounded hover:bg-red-600"
          >
            Logout
          </button>
        </div>
        <FriendList onSelectFriend={setSelectedFriend} />
      </div>
      <div className="w-3/4">
        {wsError && <p className="text-red-500 p-4">{wsError}</p>}
        {selectedFriend ? (
          <ChatWindow friend={selectedFriend} />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            Select a friend to start chatting
          </div>
        )}
      </div>
    </div>
  );
}

export default Home;