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

// Helper: clear session and redirect to login
function forceLogout() {
  localStorage.clear();
  window.location.href = '/login';
}

// On a 401, attempt a single token refresh before giving up.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Only handle 401s; bail if no request config to retry.
    if (error.response?.status !== 401 || !originalRequest) {
      return Promise.reject(error);
    }

    // Don't try to refresh the refresh call itself, and only retry once.
    const isRefreshCall = originalRequest.url?.includes('/users/refresh-token');
    if (isRefreshCall || originalRequest._retry) {
      forceLogout();
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      // Use the current token to request a new one.
      const token = localStorage.getItem('token');
      const refreshRes = await api.post(
        '/users/refresh-token',
        {},
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );

      const newToken = refreshRes.data?.token;
      if (!newToken) {
        forceLogout();
        return Promise.reject(error);
      }

      // Persist the new token and (optionally) updated user.
      localStorage.setItem('token', newToken);
      if (refreshRes.data?.user?.role) {
        localStorage.setItem('role', refreshRes.data.user.role);
      }

      // Update default + original request headers, then retry.
      api.defaults.headers.common.Authorization = `Bearer ${newToken}`;
      originalRequest.headers = originalRequest.headers || {};
      originalRequest.headers.Authorization = `Bearer ${newToken}`;

      return api(originalRequest);
    } catch (refreshErr) {
      forceLogout();
      return Promise.reject(refreshErr);
    }
  }
);

export default api;
