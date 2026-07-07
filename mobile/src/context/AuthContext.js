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
    await SecureStore.setItemAsync('token', data.token);
    await SecureStore.setItemAsync('user', JSON.stringify(data.user || data));
    setUser(data.user || data);
    await getSocket();
    return data;
  };

  const logout = async () => {
    disconnectSocket();
    await SecureStore.deleteItemAsync('token');
    await SecureStore.deleteItemAsync('user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
