// src/components/LoadDetailsModal.js
import React, { useState, useEffect } from 'react';
import {
  Modal, Paper, Typography, Button, Stack, DialogActions,
} from '@mui/material';
import { MapContainer, TileLayer, Marker, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../services/api';
import socket from '../services/socket';              // ★ singleton client
import StatusChip from '../features/carrierDashboard/sections/components/StatusChip';


export default function LoadDetailsModal({ load, userRole, onClose, onLoadAccepted }) {
  /* —— make a local copy so we can mutate status —— */
  const [loadState, setLoadState] = useState(load);

  const [route, setRoute]           = useState([]);
  const [distance, setDistance]     = useState(null);
  const [eta, setEta]               = useState(null);
  const [errorMessage, setError]    = useState('');
  const [successMessage, setOk]     = useState('');

  /* —— subscribe to live status updates —— */
  useEffect(() => {
    const handler = ({ loadId, status }) => {
      if (loadId === loadState._id) {
        setLoadState((prev) => ({ ...prev, status }));
      }
    };
    socket.on('loadStatusUpdated', handler);
    return () => socket.off('loadStatusUpdated', handler);
  }, [loadState._id]);

  /* —— fetch route on mount —— */
  useEffect(() => {
    (async () => {
      try {
        const token = localStorage.getItem('token');
        const { data } = await api.get(`/loads/${loadState._id}/route`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (data?.route) {
          const latLng = data.route.map(([lng, lat]) => [lat, lng]);
          setRoute(latLng);
          setDistance(data.distance);
          setEta(data.estimatedTime);
        }
      } catch (err) {
        console.error(err);
        setError('Failed to fetch route.');
      }
    })();
  }, [loadState._id]);

  /* —— accept load —— */
  const acceptLoad = async () => {
    try {
      const token = localStorage.getItem('token');
      await api.put(`/loads/${loadState._id}/accept`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLoadState((prev) => ({ ...prev, status: 'accepted' }));
      setOk('Load accepted successfully!');
      onLoadAccepted?.(loadState._id);
    } catch (err) {
      console.error(err);
      setError('Could not accept load.');
    }
  };

  /* —— date fmt helper —— */
  const fmt = (d) =>
    d
      ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      : 'TBD';

  const pickup = loadState.pickupTimeWindow?.start || loadState.pickupStart
    ? `${fmt(loadState.pickupTimeWindow?.start || loadState.pickupStart)}
       → ${fmt(loadState.pickupTimeWindow?.end   || loadState.pickupEnd)}`
    : 'TBD';

  const delivery = loadState.deliveryTimeWindow?.start || loadState.deliveryStart
    ? `${fmt(loadState.deliveryTimeWindow?.start || loadState.deliveryStart)}
       → ${fmt(loadState.deliveryTimeWindow?.end   || loadState.deliveryEnd)}`
    : 'TBD';

  /* —— render —— */
  return (
    <Modal open={!!load} onClose={onClose}
           sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <Paper sx={{ p: 4, maxWidth: 840, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        {/* header + status */}
        <Typography variant="h5" fontWeight={700} mb={1}>
          {loadState.title}
        </Typography>
        <StatusChip status={loadState.status} sx={{ mb: 2 }} />

        {/* details */}
        <Stack spacing={0.5}>
          <Typography><strong>Origin:</strong> {loadState.origin}</Typography>
          <Typography><strong>Destination:</strong> {loadState.destination}</Typography>
          <Typography><strong>Equipment:</strong> {loadState.equipmentType}</Typography>
          <Typography><strong>Rate:</strong> ${loadState.rate}</Typography>

          <Typography sx={{ mt: 1 }}><strong>Pickup Window:</strong> {pickup}</Typography>
          <Typography><strong>Delivery Window:</strong> {delivery}</Typography>

          <Typography sx={{ mt: 1 }}>
            <strong>Distance:</strong> {distance ? `${distance} miles` : 'Calculating…'}
          </Typography>
          <Typography><strong>ETA:</strong> {eta ? `${eta} hours` : 'Calculating…'}</Typography>
        </Stack>

        {/* map */}
        {route.length ? (
          <MapContainer center={route[0]} zoom={6}
                        style={{ height: 400, width: '100%', marginTop: 16 }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Marker position={route[0]} />
            <Marker position={route[route.length - 1]} />
            <Polyline positions={route} color="blue" />
          </MapContainer>
        ) : (
          <Typography sx={{ mt: 2 }}>No route data available.</Typography>
        )}

        {/* actions */}
        {successMessage && (
          <Typography color="success.main" sx={{ mt: 3 }}>{successMessage}</Typography>
       )}

            <DialogActions
               disableSpacing
               sx={{
                 position: 'sticky',
                 bottom: 0,
                 bgcolor: 'background.paper',
                 pt: 2,
               }}
             >
               <Button
                 variant="contained"
                 sx={{ mr: 2 }}
                 disabled={loadState.status !== 'open'}
                 onClick={acceptLoad}
               >
                 {loadState.status === 'open' ? 'Accept Load' : 'Accepted'}
               </Button>
            
               <Button variant="contained" color="secondary" onClick={onClose}>
                 Close
               </Button>
             </DialogActions>

        {errorMessage && (
          <Typography color="error" sx={{ mt: 2 }}>{errorMessage}</Typography>
        )}
      </Paper>
    </Modal>
  );
}
