import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL, // explicitly now defined
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(
  config => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      console.log('✅ Token explicitly attached:', token);
    } else {
      console.warn('⚠️ No token explicitly found in localStorage!');
    }
    return config;
  },
  error => Promise.reject(error)
);

export default api;
