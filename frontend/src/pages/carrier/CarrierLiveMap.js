import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Box, Typography, CircularProgress, Chip, Paper, Stack, Alert } from '@mui/material';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import api from '../../services/api';
import { getSocket } from '../../services/socket';
import CarrierLocationTracker from '../../components/CarrierLocationTracker';
import { semantic } from '../../theme/tokens';

// How many seconds before a location is considered stale
const STALE_THRESHOLD_S = 120;

const truckIcon = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/1086/1086933.png',
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -36],
});

// Helper: age label
function ageLabel(updatedAt) {
  if (!updatedAt) return 'No signal';
  const seconds = Math.round((Date.now() - new Date(updatedAt).getTime()) / 1000);
  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function isStale(updatedAt) {
  if (!updatedAt) return true;
  return (Date.now() - new Date(updatedAt).getTime()) / 1000 > STALE_THRESHOLD_S;
}

// Child component to re-center map when data arrives
function MapAutoFit({ positions }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (positions.length && !fitted.current) {
      const bounds = L.latLngBounds(positions);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
      fitted.current = true;
    }
  }, [positions, map]);
  return null;
}

export default function CarrierLiveMap() {
  const [fleet, setFleet] = useState([]);
  const [activeLoads, setActiveLoads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0); // force re-render for age labels

  // Fetch fleet + active loads on mount
  useEffect(() => {
    (async () => {
      try {
        const [fleetRes, loadsRes] = await Promise.all([
          api.get('/users/fleet'),
          api.get('/loads?status=in-transit&role=carrier'),
        ]);
        setFleet(fleetRes.data.fleet || []);
        setActiveLoads(loadsRes.data.loads || loadsRes.data || []);
      } catch (err) {
        console.error('Failed to load fleet/loads:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Subscribe to live location updates via socket
  const handleLocationUpdate = useCallback((data) => {
    setActiveLoads((prev) =>
      prev.map((ld) =>
        ld._id === data.loadId
          ? { ...ld, carrierLocation: { ...data, updatedAt: data.updatedAt || new Date().toISOString() } }
          : ld,
      ),
    );
  }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.on('carrierLocationUpdate', handleLocationUpdate);
    return () => socket.off('carrierLocationUpdate', handleLocationUpdate);
  }, [handleLocationUpdate]);

  // Tick every 10s to refresh "ago" labels
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(iv);
  }, []);

  // Build markers: fleet trucks + active load positions
  const fleetMarkers = fleet
    .filter((t) => t.location?.latitude && t.location?.longitude)
    .map((t) => ({
      key:    `truck-${t.truckId}`,
      pos:    [t.location.latitude, t.location.longitude],
      label:  `Truck ${t.truckId}`,
      sub:    t.driverName || 'Unassigned',
      status: t.status || 'Unknown',
      age:    ageLabel(t.location.updatedAt),
      stale:  isStale(t.location.updatedAt),
    }));

  const loadMarkers = activeLoads
    .filter((ld) => ld.carrierLocation?.latitude && ld.carrierLocation?.longitude)
    .map((ld) => ({
      key:    `load-${ld._id}`,
      pos:    [ld.carrierLocation.latitude, ld.carrierLocation.longitude],
      label:  ld.title || 'Active Load',
      sub:    `${ld.origin} → ${ld.destination}`,
      status: 'In Transit',
      age:    ageLabel(ld.carrierLocation.updatedAt),
      stale:  isStale(ld.carrierLocation.updatedAt),
      speed:  ld.carrierLocation.speed,
      source: ld.carrierLocation.source,
    }));

  const allMarkers = [...fleetMarkers, ...loadMarkers];
  const positions = allMarkers.map((m) => m.pos);
  const center = positions.length ? positions[0] : [39.8283, -98.5795];

  // Find the first in-transit load to activate browser tracking
  const trackingLoadId = activeLoads.find((ld) => ld.status === 'in-transit')?._id;

  return (
    <Box sx={{ py: 4, px: { xs: 0, md: 2 }, maxWidth: 1200, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
        <Typography variant="h5" fontWeight={700} sx={{ color: '#fff' }}>
          Fleet Live Map
        </Typography>
        {trackingLoadId && (
          <Chip label="GPS Active" size="small" sx={{ bgcolor: semantic.success, color: '#000', fontWeight: 600 }} />
        )}
      </Stack>

      {!loading && allMarkers.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No trucks or in-transit loads with location data. Location updates will appear here in real time once a driver starts sharing their position.
        </Alert>
      )}

      {loading ? (
        <CircularProgress sx={{ color: '#fff' }} />
      ) : (
        <Paper sx={{ height: 560, borderRadius: 3, overflow: 'hidden', boxShadow: 4 }}>
          <MapContainer center={center} zoom={5} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; OpenStreetMap contributors"
            />
            <MapAutoFit positions={positions} />
            {allMarkers.map((m) => (
              <Marker key={m.key} position={m.pos} icon={truckIcon}>
                <Popup>
                  <Typography variant="subtitle2" fontWeight={700}>{m.label}</Typography>
                  <Typography variant="body2">{m.sub}</Typography>
                  <Chip
                    size="small"
                    label={m.status}
                    color={m.status === 'In Transit' ? 'warning' : m.status === 'Available' ? 'success' : 'default'}
                    sx={{ mt: 0.5 }}
                  />
                  <Typography variant="caption" display="block" sx={{ mt: 0.5, color: m.stale ? 'red' : 'green' }}>
                    {m.age} {m.stale ? '(stale)' : ''}
                  </Typography>
                  {m.speed != null && (
                    <Typography variant="caption" display="block">
                      Speed: {m.speed} km/h
                    </Typography>
                  )}
                  {m.source && (
                    <Typography variant="caption" display="block" sx={{ color: '#888' }}>
                      Source: {m.source}
                    </Typography>
                  )}
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </Paper>
      )}

      {/* Activate browser GPS tracking for the first in-transit load */}
      {trackingLoadId && <CarrierLocationTracker loadId={trackingLoadId} />}
    </Box>
  );
}
