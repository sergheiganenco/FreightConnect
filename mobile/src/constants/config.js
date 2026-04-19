// API base URL — change to your backend address
// For local dev on physical device, use your computer's LAN IP (not localhost)
// For emulator: Android=10.0.2.2, iOS=localhost
export const API_URL = 'http://10.0.2.2:5000/api';
export const SOCKET_URL = 'http://10.0.2.2:5000';

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
