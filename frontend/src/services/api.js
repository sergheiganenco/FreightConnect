import axios from "axios";

// This will use environment variable in production, fallback to localhost for development
const baseURL =
  process.env.REACT_APP_API_URL ||
  "http://localhost:5000/api"; // Don't end with slash

const api = axios.create({
  baseURL, // e.g., "http://localhost:5000/api"
  headers: {
    "Content-Type": "application/json",
  },
});

// Attach token if available (before every request)
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      // Uncomment for debugging:
      // console.log("✅ Token attached:", token);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

export default api;
