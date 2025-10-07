import { useState, useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserContext } from '../context/UserContext';

function Login() {
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const { login: loginUser } = useContext(UserContext);
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.email || !formData.password) {
      setError('Email and password are required');
      return;
    }
    setError(''); // Clear previous error
    console.log('Attempting to login with:', formData);
    try {
      await loginUser(formData);
      console.log('Login successful, navigating to /');
      navigate('/');
    } catch (err) {
      console.error('Login error:', err);
      setError(err.response?.data?.message || 'Login failed'); // Use message field
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-lg w-96">
        <h2 className="text-2xl font-bold mb-6 text-center">Login</h2>
        {error && <p className="text-red-500 mb-4">{error}</p>}
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            name="email"
            placeholder="Email"
            value={formData.email}
            onChange={handleChange}
            className="w-full p-2 mb-4 border rounded"
          />
          <input
            type="password"
            name="password"
            placeholder="Password"
            value={formData.password}
            onChange={handleChange}
            className="w-full p-2 mb-4 border rounded"
          />
          <button
            type="submit"
            className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600"
          >
            Login
          </button>
        </form>
        <p className="mt-4 text-center">
          Don't have an account? <Link to="/signup" className="text-blue-500">Sign up</Link>
        </p>
      </div>
    </div>
  );
}

export default Login;