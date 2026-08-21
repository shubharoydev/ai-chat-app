import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signup } from '../utils/api';
import { AuroraBackground } from '../components/AuroraBackground';

function Signup() {
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.password) {
      setError('All fields are required');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await signup(formData);
      navigate('/login');
    } catch (err) {
      setError(err.response?.data?.error || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuroraBackground showRadialGradient={true} animationSpeed={20}>
      <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md mx-4">
        <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">Sign Up</h2>
        {error && <p className="text-red-500 mb-4 text-center">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            name="name"
            placeholder="Name"
            value={formData.name}
            onChange={handleChange}
            className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <input
            type="email"
            name="email"
            placeholder="Email"
            value={formData.email}
            onChange={handleChange}
            className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <input
            type="password"
            name="password"
            placeholder="Password"
            value={formData.password}
            onChange={handleChange}
            className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-teal-500 text-white py-3 rounded-lg hover:bg-teal-600 transition-colors font-medium disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading && (
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {loading ? 'Signing up...' : 'Sign Up'}
          </button>
        </form>
        <p className="mt-4 text-center text-gray-600">
          Already have an account? <Link to="/login" className="text-teal-500 hover:underline">Login</Link>
        </p>
        <div className="mt-6 pt-4 border-t border-gray-200 text-center">
          <p className="text-sm text-gray-500">
            Made with ❤️ by{' '}
            <a 
              href="https://shubharoydev.vercel.app/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-teal-500 hover:underline"
            >
              Shubha Roy
            </a>
          </p>
        </div>
      </div>
    </AuroraBackground>
  );
}

export default Signup;