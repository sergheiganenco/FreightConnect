import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { ActivityIndicator, View } from 'react-native';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import AuthNavigator from './src/navigation/AuthNavigator';
import * as SecureStore from 'expo-secure-store';
import { registerForPushNotifications, showLocalNotification } from './src/services/notifications';
import { getSocket } from './src/services/socket';
import api from './src/services/api';
import { COLORS } from './src/constants/config';

// Import tracking task definition (must be at top level)
import './src/services/tracking';

function RootNavigator() {
  const { user, loading } = useAuth();

  // Register push notifications + listen for socket notifications
  useEffect(() => {
    if (!user) return;

    // Register this device's Expo push token with the backend so it can send
    // remote notifications when the app is closed.
    (async () => {
      try {
        const token = await registerForPushNotifications();
        if (token) {
          await SecureStore.setItemAsync('pushToken', token);
          await api.post('/users/push-token', { token });
        }
      } catch (_) { /* non-fatal — in-app socket notifications still work */ }
    })();

    // Listen for in-app notifications via socket
    (async () => {
      const socket = await getSocket();
      if (!socket) return;

      socket.on('notification:new', (notification) => {
        showLocalNotification(
          notification.title || 'FreightConnect',
          notification.body || 'You have a new notification',
          notification,
        );
      });

      return () => socket.off('notification:new');
    })();
  }, [user]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.bgDark }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return user ? <AppNavigator /> : <AuthNavigator />;
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer>
        <StatusBar style="light" />
        <RootNavigator />
      </NavigationContainer>
    </AuthProvider>
  );
}
