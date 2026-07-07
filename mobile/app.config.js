// Expo dynamic config. Spreads the static app.json and injects `extra` so that
// standalone/EAS builds have a real backend URL (constants/config.js reads
// expoConfig.extra.apiUrl / .socketUrl). Override for local dev by exporting
// EXPO_PUBLIC_API_URL / EXPO_PUBLIC_SOCKET_URL before `expo start`.
const appJson = require('./app.json');

const PROD_API = 'https://freightconnect.onrender.com/api';
const PROD_SOCKET = 'https://freightconnect.onrender.com';

module.exports = () => ({
  ...appJson.expo,
  extra: {
    ...(appJson.expo.extra || {}),
    apiUrl: process.env.EXPO_PUBLIC_API_URL || PROD_API,
    socketUrl: process.env.EXPO_PUBLIC_SOCKET_URL || PROD_SOCKET,
  },
});
