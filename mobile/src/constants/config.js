// API base URL — environment-aware.
// Production/staging URLs come from app config 'extra' (app.json or EAS env).
// In dev, falls back to emulator/simulator host: Android=10.0.2.2, iOS=localhost.
// For a physical device in dev, set extra.apiUrl / extra.socketUrl to your LAN IP.
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const extra = Constants.expoConfig?.extra || Constants.manifest?.extra || {};

// Production / staging URL from app config 'extra', set via app.json or EAS env
const CONFIGURED_API = extra.apiUrl;
const CONFIGURED_SOCKET = extra.socketUrl;

function devHost() {
  // Android emulator reaches host machine via 10.0.2.2; iOS sim via localhost
  return Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
}

export const API_URL = CONFIGURED_API || `http://${devHost()}:5000/api`;
export const SOCKET_URL = CONFIGURED_SOCKET || `http://${devHost()}:5000`;

// Tracking
export const LOCATION_TASK_NAME = 'background-location-task';
export const TRACKING_INTERVAL_MS = 15000; // 15 seconds
export const TRACKING_DISTANCE_M = 50;     // minimum meters moved before update

// Colors (matching web app theme)
export const COLORS = {
  primary:    '#6a1fcf',
  secondary:  '#e1129a',
  indigo:     '#6366f1',
  success:    '#34d399',
  warning:    '#fbbf24',
  error:      '#f87171',
  info:       '#22d3ee',
  bgDark:     '#0f0a1e',
  bgCard:     '#1a1135',
  bgInput:    '#241a40',
  textPrimary:'#ffffff',
  textMuted:  '#94a3b8',
  border:     'rgba(99,102,241,0.25)',
};
