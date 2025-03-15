// src/pages/ShipperLoads.js
import React, { useState, useEffect } from 'react';
import {
  Typography,
  Box,
  Paper,
  Button,
  Grid,
  Select,
  MenuItem,
  Snackbar,
  Alert,
  Modal,
} from '@mui/material';
import api from '../services/api';
import LoadDetailsModal from '../components/LoadDetailsModal';
import { MapContainer, TileLayer, Marker, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { io } from 'socket.io-client'; // <-- Added for real-time updates

function ShipperLoads() {
  const [loads, setLoads] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedLoad, setSelectedLoad] = useState(null);
  const [trackingLoad, setTrackingLoad] = useState(null);
  const [carrierLocation, setCarrierLocation] = useState(null);
  const [route, setRoute] = useState([]);
  const [error, setError] = useState('');
  const [openSnackbar, setOpenSnackbar] = useState(false);
  const [openTrackModal, setOpenTrackModal] = useState(false);

  useEffect(() => {
    const fetchLoads = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await api.get('/loads/posted', {
          headers: { Authorization: `Bearer ${token}` },
        });
        setLoads(response.data || []);
      } catch (err) {
        setError('Failed to fetch loads.');
      }
    };

    fetchLoads();

    // Real-time updates setup (Socket.IO integration)
    const socket = io(process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000');

    socket.on('loadStatusUpdated', (update) => {
      setLoads((prevLoads) =>
        prevLoads.map((load) =>
          load._id === update.loadId ? { ...load, status: update.status } : load
        )
      );
      setOpenSnackbar(true);
    });

    // Cleanup on unmount
    return () => {
      socket.disconnect();
    };
  }, []);

  const filteredLoads = loads.filter((load) =>
    statusFilter === 'all' ? true : load.status === statusFilter
  );

  const handleTrackLoad = async (load) => {
    try {
      const token = localStorage.getItem('token');
      const response = await api.get(`/loads/${load._id}/tracking`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setCarrierLocation(response.data.carrierLocation);
      setRoute(response.data.route);
      setTrackingLoad(load);
      setOpenTrackModal(true);
    } catch (err) {
      if (err.response?.status === 404) {
        setError('No carrier location found.');
      } else if (err.response?.status === 400) {
        setError('Load not accepted or missing data.');
      } else {
        setError('Failed to track load.');
      }
    }
  };

  return (
    <Box sx={{ maxWidth: 1200, margin: '0 auto', p: 2 }}>
      <Typography variant="h4" gutterBottom>
        Loads
      </Typography>

      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle1">Filter by status:</Typography>
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="all">All</MenuItem>
          <MenuItem value="open">Open</MenuItem>
          <MenuItem value="accepted">Accepted</MenuItem>
          <MenuItem value="delivered">Delivered</MenuItem>
        </Select>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Snackbar
        open={openSnackbar}
        autoHideDuration={3000}
        onClose={() => setOpenSnackbar(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity="info" sx={{ width: '100%' }}>
          Load status updated in real-time!
        </Alert>
      </Snackbar>

      {filteredLoads.length > 0 ? (
        <Grid container spacing={2}>
          {filteredLoads.map((load) => (
            <Grid item xs={12} key={load._id}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="h6">{load.title}</Typography>
                <Typography>
                  <strong>Origin:</strong> {load.origin}
                </Typography>
                <Typography>
                  <strong>Destination:</strong> {load.destination}
                </Typography>
                <Typography>
                  <strong>Status:</strong> {load.status}
                </Typography>
                <Button
                  variant="contained"
                  color="primary"
                  sx={{ mt: 2, mr: 2 }}
                  onClick={() => setSelectedLoad(load)}
                >
                  View Details
                </Button>
                {(load.status === 'accepted' || load.status === 'in-transit') && (
                  <Button
                    variant="contained"
                    color="secondary"
                    sx={{ mt: 2 }}
                    onClick={() => handleTrackLoad(load)}
                  >
                    Track Load
                  </Button>
                )}
              </Paper>
            </Grid>
          ))}
        </Grid>
      ) : (
        <Typography>No loads found for the selected filter.</Typography>
      )}

      {selectedLoad && (
        <LoadDetailsModal
          load={selectedLoad}
          userRole="shipper"
          onClose={() => setSelectedLoad(null)}
        />
      )}

      <Modal
        open={openTrackModal}
        onClose={() => setOpenTrackModal(false)}
        sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}
      >
        <Paper sx={{ p: 4, maxWidth: 800, width: '100%' }}>
          {trackingLoad ? (
            <>
              <Typography variant="h6" gutterBottom>
                Tracking: {trackingLoad.title}
              </Typography>
              <MapContainer
                center={
                  carrierLocation
                    ? [carrierLocation.latitude, carrierLocation.longitude]
                    : [39.8283, -98.5795]
                }
                zoom={8}
                style={{ height: '400px', width: '100%' }}
              >
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                {carrierLocation && (
                  <Marker
                    position={[carrierLocation.latitude, carrierLocation.longitude]}
                    icon={L.icon({
                      iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png',
                      iconSize: [30, 30],
                      iconAnchor: [15, 15],
                    })}
                  />
                )}
                {route?.length ? (
                  <Polyline positions={route} color="blue" weight={5} />
                ) : (
                  <Typography sx={{ mt: 1 }}>No Route Found</Typography>
                )}
              </MapContainer>
            </>
          ) : (
            <Typography>No tracking information available.</Typography>
          )}
        </Paper>
      </Modal>
    </Box>
  );
}

export default ShipperLoads;
