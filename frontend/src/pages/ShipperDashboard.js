import React, { useState, useEffect } from "react";
import {
  TextField,
  Button,
  Grid,
  Typography,
  Select,
  MenuItem,
  Box,
  Paper,
  Snackbar,
  Alert,
  Modal,
} from "@mui/material";
import api from "../services/api";
import { MapContainer, TileLayer, Marker, Polyline } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import LoadDetailsModal from "../components/LoadDetailsModal"; // Shared Load Details Modal
import L from "leaflet";

function ShipperDashboard() {
  // Force the role to 'shipper' so we never show Accept Load in this dashboard
  const [userRole] = useState("shipper");

  const [loads, setLoads] = useState([]);
  const [newLoad, setNewLoad] = useState({
    title: "",
    origin: "",
    destination: "",
    rate: "",
    equipmentType: "",
  });
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedLoad, setSelectedLoad] = useState(null);
  const [trackingLoad, setTrackingLoad] = useState(null);
  const [carrierLocation, setCarrierLocation] = useState(null);
  const [route, setRoute] = useState([]);
  const [openSnackbar, setOpenSnackbar] = useState(false);
  const [error, setError] = useState(null);
  const [openTrackModal, setOpenTrackModal] = useState(false);

  // 1. Fetch posted loads
  useEffect(() => {
    const fetchPostedLoads = async () => {
      try {
        const token = localStorage.getItem("token");
        const response = await api.get("/loads/posted", {
          headers: { Authorization: `Bearer ${token}` },
          params: { status: statusFilter },
        });
        setLoads(response.data || []);
      } catch (err) {
        console.error("Error fetching posted loads:", err);
        setError("Failed to fetch posted loads.");
      }
    };

    fetchPostedLoads();
  }, [statusFilter]);

  // 2. Handle posting new load
  //    We rely on the backend to do geocoding
  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (!newLoad.equipmentType) {
        setError("Equipment Type is required.");
        return;
      }

      const token = localStorage.getItem("token");
      await api.post(
        "/loads",
        {
          title: newLoad.title,
          origin: newLoad.origin,
          destination: newLoad.destination,
          rate: newLoad.rate,
          equipmentType: newLoad.equipmentType,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Reset form
      setNewLoad({
        title: "",
        origin: "",
        destination: "",
        rate: "",
        equipmentType: "",
      });
      setOpenSnackbar(true);
      setError(null);
    } catch (err) {
      console.error("Error posting load:", err);
      setError("Failed to post load. Please check all fields and try again.");
    }
  };

  // 3. Handle tracking a load
  const handleTrackLoad = async (load) => {
    try {
      const token = localStorage.getItem("token");
      const response = await api.get(`/loads/${load._id}/tracking`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      setCarrierLocation(response.data.carrierLocation);
      setRoute(response.data.route);
      setTrackingLoad(load);
      setOpenTrackModal(true);
    } catch (err) {
      console.error("Error tracking load:", err);
      if (err.response?.status === 404) {
        setError("No carrier location found. The carrier might not have set it yet.");
      } else if (err.response?.status === 400) {
        setError("Load not accepted or missing data—cannot track.");
      } else {
        setError("Failed to track load.");
      }
    }
  };

  return (
    <Box sx={{ maxWidth: 1200, margin: "0 auto", p: 2 }}>
      <Typography variant="h4" gutterBottom>
        Shipper Dashboard
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Snackbar
        open={openSnackbar}
        autoHideDuration={3000}
        onClose={() => setOpenSnackbar(false)}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
      >
        <Alert severity="success" sx={{ width: "100%" }}>
          Load successfully posted!
        </Alert>
      </Snackbar>

      {/* Post Load Form */}
      <Paper sx={{ p: 2, mb: 4 }} elevation={3}>
        <Typography variant="h6" gutterBottom>
          Post a New Load
        </Typography>
        <Box component="form" onSubmit={handleSubmit}>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Title"
                fullWidth
                required
                value={newLoad.title}
                onChange={(e) =>
                  setNewLoad({ ...newLoad, title: e.target.value })
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Origin"
                fullWidth
                required
                value={newLoad.origin}
                onChange={(e) =>
                  setNewLoad({ ...newLoad, origin: e.target.value })
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Destination"
                fullWidth
                required
                value={newLoad.destination}
                onChange={(e) =>
                  setNewLoad({ ...newLoad, destination: e.target.value })
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Rate"
                fullWidth
                required
                value={newLoad.rate}
                onChange={(e) =>
                  setNewLoad({ ...newLoad, rate: e.target.value })
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Equipment Type *
              </Typography>
              <Select
                fullWidth
                displayEmpty
                required
                value={newLoad.equipmentType}
                onChange={(e) =>
                  setNewLoad({ ...newLoad, equipmentType: e.target.value })
                }
              >
                <MenuItem value="">
                  <em>Select Type</em>
                </MenuItem>
                <MenuItem value="Flatbed">Flatbed</MenuItem>
                <MenuItem value="Reefer">Reefer</MenuItem>
                <MenuItem value="Dry Van">Dry Van</MenuItem>
                <MenuItem value="Car Hauler">Car Hauler</MenuItem>
              </Select>
            </Grid>
          </Grid>
          <Button variant="contained" color="primary" type="submit" fullWidth>
            Post Load
          </Button>
        </Box>
      </Paper>

      {/* Status Filter */}
      <Box sx={{ mb: 3 }}>
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          displayEmpty
          sx={{ mr: 2 }}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="open">Open</MenuItem>
          <MenuItem value="accepted">Accepted</MenuItem>
          <MenuItem value="delivered">Delivered</MenuItem>
        </Select>
      </Box>

      {/* Posted Loads */}
      {loads.length > 0 ? (
        <Grid container spacing={2}>
          {loads.map((load) => (
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

                {/* Only show "Track Load" if accepted by a carrier */}
                {load.status === "accepted" && (
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
        <Typography>No loads found.</Typography>
      )}

      {/* View Details Modal */}
      {selectedLoad && (
        <LoadDetailsModal
          load={selectedLoad}
          userRole={userRole}        // <-- Pass "shipper" to the modal
          onClose={() => setSelectedLoad(null)}
        />
      )}

      {/* Track Load Modal */}
      <Modal
        open={openTrackModal}
        onClose={() => setOpenTrackModal(false)}
        sx={{ display: "flex", justifyContent: "center", alignItems: "center" }}
      >
        <Paper sx={{ p: 4, maxWidth: 800, width: "100%" }}>
          {trackingLoad ? (
            <>
              <Typography variant="h6" gutterBottom>
                Tracking: {trackingLoad.title}
              </Typography>

              <MapContainer
                center={
                  carrierLocation
                    ? [carrierLocation.latitude, carrierLocation.longitude]
                    : [39.8283, -98.5795] // default center: USA
                }
                zoom={8}
                style={{ height: "400px", width: "100%" }}
              >
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

                {/* Marker for carrier location */}
                {carrierLocation && (
                  <Marker
                    position={[carrierLocation.latitude, carrierLocation.longitude]}
                    icon={L.icon({
                      iconUrl: "https://cdn-icons-png.flaticon.com/512/684/684908.png",
                      iconSize: [30, 30],
                      iconAnchor: [15, 15],
                    })}
                  />
                )}

                {/* Route from carrier to destination */}
                {route && route.length > 0 ? (
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

export default ShipperDashboard;
