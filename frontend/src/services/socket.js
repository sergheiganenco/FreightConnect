import { io } from 'socket.io-client';

// Explicit env wins; production builds default to SAME-ORIGIN (single-origin
// deploy: Express serves the app + Socket.IO); dev falls back to localhost.
const SOCKET_URL =
  process.env.REACT_APP_API_URL?.replace('/api', '') ||
  (process.env.NODE_ENV === 'production' ? window.location.origin : 'http://localhost:5000');

let socket = null;

export function getSocket() {
  if (socket?.connected) return socket;

  const token = localStorage.getItem('token');
  if (!token) return null;

  if (socket) socket.disconnect();

  socket = io(SOCKET_URL, {
    auth: { token },
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connection error:', err.message);
    if (err.message === 'Authentication error') {
      console.warn('Socket auth failed — token may be expired');
    }
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export default { getSocket, disconnectSocket };
