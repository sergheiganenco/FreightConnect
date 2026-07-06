import { Alert } from 'react-native';
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_URL } from '../constants/config';

const api = axios.create({
  baseURL: API_URL,
  timeout: 15000,
});

// Attach JWT token to every request
api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── ToS acceptance (server blocks all API calls with 403 tosRequired until
// the current Terms of Service version is accepted; web shows a modal, on
// mobile we prompt once and accept via POST /tos/accept, then retry). ──
let tosPromptShowing = false;
function promptTosAcceptance() {
  return new Promise((resolve) => {
    Alert.alert(
      'Terms of Service',
      'To continue using FreightConnect you must accept the current Terms of Service (freightconnect.onrender.com/terms).',
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        {
          text: 'Accept',
          onPress: async () => {
            try {
              await api.post('/tos/accept');
              resolve(true);
            } catch (_) {
              resolve(false);
            }
          },
        },
      ],
      { cancelable: false },
    );
  });
}

// Handle 401 (expired token) and 403 tosRequired (ToS gate)
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.response?.status === 401) {
      await SecureStore.deleteItemAsync('token');
      await SecureStore.deleteItemAsync('user');
    }
    if (err.response?.status === 403 && err.response?.data?.tosRequired && !tosPromptShowing) {
      tosPromptShowing = true;
      try {
        const accepted = await promptTosAcceptance();
        if (accepted && err.config && !err.config.__tosRetried) {
          err.config.__tosRetried = true;
          return api.request(err.config); // retry the original call
        }
      } finally {
        tosPromptShowing = false;
      }
    }
    return Promise.reject(err);
  },
);

export default api;
