import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { API_URL, LOCATION_TASK_NAME, TRACKING_DISTANCE_M } from '../constants/config';
import api from './api';

// ── Define the background task (must be at top level, outside components) ──
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('Background location error:', error.message);
    return;
  }
  if (!data) return;

  const { locations } = data;
  const location = locations[0];
  if (!location) return;

  try {
    const token = await SecureStore.getItemAsync('token');
    const loadId = await SecureStore.getItemAsync('trackingLoadId');
    if (!token || !loadId) return;

    await fetch(`${API_URL}/tracking/location`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        loadId,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        speed: location.coords.speed != null ? Math.round(location.coords.speed * 3.6) : null,
        heading: location.coords.heading,
        accuracy: location.coords.accuracy ? Math.round(location.coords.accuracy) : null,
        source: 'mobile_app',
      }),
    });
  } catch (err) {
    console.error('Background tracking POST failed:', err.message);
  }
});

// ── Public API ──────────────────────────────────────────────────────────────

// Privacy: the carrier must consent before any background location is collected.
// The backend also enforces this (location ingest returns 403 without consent),
// but we gate the client too so we never start the GPS service uninvited.
export async function hasGpsConsent() {
  try {
    const { data } = await api.get('/tracking/consent');
    return Boolean(data?.gpsConsent?.granted);
  } catch (_) {
    return false; // fail closed — treat unknown as not consented
  }
}

export async function setGpsConsent(granted) {
  const { data } = await api.post('/tracking/consent', { granted, version: 'v1' });
  return data?.gpsConsent;
}

export async function requestLocationPermissions() {
  const { status: fg } = await Location.requestForegroundPermissionsAsync();
  if (fg !== 'granted') return false;

  const { status: bg } = await Location.requestBackgroundPermissionsAsync();
  return bg === 'granted';
}

export async function startBackgroundTracking(loadId) {
  // Privacy gate: do not start the GPS service unless consent is on file.
  const consented = await hasGpsConsent();
  if (!consented) {
    const e = new Error('GPS tracking consent is required');
    e.code = 'gps_consent_required';
    throw e;
  }

  const hasPermission = await requestLocationPermissions();
  if (!hasPermission) {
    throw new Error('Location permissions not granted');
  }

  // Store the load ID so the background task knows which load to update
  await SecureStore.setItemAsync('trackingLoadId', loadId);

  const isStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (isStarted) {
    // Already running — just update the load ID
    return;
  }

  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.High,
    distanceInterval: TRACKING_DISTANCE_M,
    deferredUpdatesInterval: 15000,
    showsBackgroundLocationIndicator: true, // iOS: blue bar
    foregroundService: {
      notificationTitle: 'FreightConnect',
      notificationBody: 'Tracking your trip location',
      notificationColor: '#6a1fcf',
    },
  });

  console.log('Background tracking started for load:', loadId);
}

export async function stopBackgroundTracking() {
  const isStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (isStarted) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
  await SecureStore.deleteItemAsync('trackingLoadId');
  console.log('Background tracking stopped');
}

export async function isTracking() {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  } catch {
    return false;
  }
}
