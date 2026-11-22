import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import api from '../services/api';
import { getSocket, disconnectSocket } from '../services/socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session on app start
  useEffect(() => {
    (async () => {
      try {
        const token = await SecureStore.getItemAsync('token');
        const stored = await SecureStore.getItemAsync('user');
        if (token && stored) {
          const parsed = JSON.parse(stored);
          setUser(parsed);
          // Connect socket
          await getSocket();
        }
      } catch {
        // corrupted storage — clear
        await SecureStore.deleteItemAsync('token');
        await SecureStore.deleteItemAsync('user');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = async (email, password, mfaToken) => {
    const { data } = await api.post('/users/login', { email, password, mfaToken });
    // MFA-enabled accounts get { mfaRequired: true } with no token — do not persist a
    // session; the caller must prompt for the code and call login() again with it.
    if (data.mfaRequired && !data.token) {
      return data;
    }
    // Temporary password: the server blocks everything but change-password until it is
    // changed. Keep only the token (so the api interceptor can use it) - no user/socket,
    // so the app is not entered and a relaunch won't restore a half-session.
    if (data.user?.mustChangePassword) {
      await SecureStore.setItemAsync('token', data.token);
      return data;
    }
    await SecureStore.setItemAsync('token', data.token);
    await SecureStore.setItemAsync('user', JSON.stringify(data.user || data));
    setUser(data.user || data);
    await getSocket();
    return data;
  };

  // Second step of a temporary-password login: change it, then finish the normal login.
  const completePasswordChange = async (loginData, currentPassword, newPassword) => {
    await api.post('/users/change-password', { currentPassword, newPassword });
    const u = { ...loginData.user, mustChangePassword: false };
    await SecureStore.setItemAsync('user', JSON.stringify(u));
    setUser(u);
    await getSocket();
  };

  // User backed out of the password step: drop the token kept by login().
  const cancelPasswordChange = () => SecureStore.deleteItemAsync('token');

  const logout = async () => {
    // Unregister this device's push token before clearing the session (so a shared
    // phone doesn't keep pushing to the previous user).
    try {
      const pushToken = await SecureStore.getItemAsync('pushToken');
      if (pushToken) {
        await api.delete('/users/push-token', { data: { token: pushToken } });
        await SecureStore.deleteItemAsync('pushToken');
      }
    } catch (_) { /* non-fatal */ }
    disconnectSocket();
    await SecureStore.deleteItemAsync('token');
    await SecureStore.deleteItemAsync('user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, completePasswordChange, cancelPasswordChange }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
