import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text } from 'react-native';
import { COLORS } from '../constants/config';

import LoadBoardScreen from '../screens/LoadBoardScreen';
import LoadDetailScreen from '../screens/LoadDetailScreen';
import LoadMapScreen from '../screens/LoadMapScreen';
import PODUploadScreen from '../screens/PODUploadScreen';
import ChatScreen from '../screens/ChatScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Tab = createBottomTabNavigator();
const LoadStack = createNativeStackNavigator();

// Minimal icon component (avoids installing vector icons)
function TabIcon({ label, focused }) {
  const icons = { Loads: '📦', Chat: '💬', Profile: '👤' };
  return (
    <Text style={{ fontSize: focused ? 22 : 20, opacity: focused ? 1 : 0.5 }}>
      {icons[label] || '●'}
    </Text>
  );
}

// Stack for Load Board → Detail → POD Upload
function LoadStackNavigator() {
  return (
    <LoadStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.bgCard },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <LoadStack.Screen
        name="Loads"
        component={LoadBoardScreen}
        options={{ title: 'Load Board' }}
      />
      <LoadStack.Screen
        name="LoadDetail"
        component={LoadDetailScreen}
        options={{ title: 'Load Details' }}
      />
      <LoadStack.Screen
        name="LoadMap"
        component={LoadMapScreen}
        options={{ title: 'Load Map' }}
      />
      <LoadStack.Screen
        name="PODUpload"
        component={PODUploadScreen}
        options={{ title: 'Upload POD' }}
      />
    </LoadStack.Navigator>
  );
}

export default function AppNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused }) => <TabIcon label={route.name} focused={focused} />,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: {
          backgroundColor: COLORS.bgCard,
          borderTopColor: COLORS.border,
          paddingBottom: 6,
          paddingTop: 6,
          height: 60,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        headerStyle: { backgroundColor: COLORS.bgCard },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      })}
    >
      <Tab.Screen
        name="Loads"
        component={LoadStackNavigator}
        options={{ headerShown: false }}
      />
      <Tab.Screen
        name="Chat"
        component={ChatScreen}
        options={{ title: 'Messages' }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
      />
    </Tab.Navigator>
  );
}
