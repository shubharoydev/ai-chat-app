import { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserContext } from '../context/UserContext';
import FriendList from '../components/FriendList';
import ChatWindow from './ChatWindow';


function Home() {
  const { user, isLoading, logout, wsError } = useContext(UserContext);
  const navigate = useNavigate();
  const [selectedFriend, setSelectedFriend] = useState(null);
  const [showSidebar, setShowSidebar] = useState(true);

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

  const handleBackToFriends = () => {
    setSelectedFriend(null);
    setShowSidebar(true);
  };

  const handleSelectFriend = (friend) => {
    setSelectedFriend(friend);
    setShowSidebar(false);
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

  if (isLoading) return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar - Hidden on mobile when chat is open */}
      <div className={`${showSidebar ? 'flex' : 'hidden'} md:flex w-full md:w-80 bg-white border-r border-gray-200 flex-col flex-shrink-0 absolute md:relative z-10 h-full`}>
        {/* User Profile Header */}
        <div className="p-4 border-b border-gray-200 bg-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full ${getAvatarColor(user?.name)} flex items-center justify-center text-white font-semibold text-sm shadow-sm`}>
                {getInitials(user?.name)}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-bold text-gray-900 truncate">
                  {user?.name || 'User'}
                </h2>
                <p className="text-xs text-gray-500 truncate">{user?.email}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all duration-200"
              title="Logout"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
        <FriendList onSelectFriend={handleSelectFriend} />
      </div>

      {/* Main Chat Area */}
      <div className={`${!showSidebar ? 'flex' : 'hidden'} md:flex flex-1 flex-col min-w-0 h-full`}>
        {selectedFriend ? (
          <ChatWindow friend={selectedFriend} onBack={handleBackToFriends} />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <div className="text-center">
              <div className="w-24 h-24 mx-auto mb-4 bg-gray-200 rounded-full flex items-center justify-center">
                <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-700 mb-2">Welcome to Chat</h3>
              <p className="text-gray-500 text-sm">Select a friend from the sidebar to start chatting</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Home;