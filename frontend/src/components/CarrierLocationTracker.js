// src/components/CarrierLocationTracker.js
// Tracks the carrier's browser GPS and emits location via the shared Socket.IO connection.
// Renders no UI — mount it inside any carrier page while a load is in-transit.
import { useEffect, useRef } from 'react';
import { getSocket } from '../services/socket';

const EMIT_INTERVAL_MS = 15_000; // throttle: send at most once every 15 s

export default function CarrierLocationTracker({ loadId }) {
  const lastEmit = useRef(0);

  useEffect(() => {
    if (!loadId) return;
    if (!('geolocation' in navigator)) return;

    const watchId = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        const now = Date.now();
        if (now - lastEmit.current < EMIT_INTERVAL_MS) return; // throttle
        lastEmit.current = now;

        const socket = getSocket();
        if (!socket) return;

        socket.emit('updateCarrierLocation', {
          loadId,
          latitude:  coords.latitude,
          longitude: coords.longitude,
          speed:     coords.speed != null ? Math.round(coords.speed * 3.6) : null, // m/s → km/h
          heading:   coords.heading,
          accuracy:  coords.accuracy ? Math.round(coords.accuracy) : null,
          source:    'browser',
          timestamp: new Date(timestamp).toISOString(),
        });
      },
      (err) => {
        console.error('Geolocation error:', err.message);
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [loadId]);

  return null;
}
