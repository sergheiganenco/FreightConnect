import React, { useState, useEffect } from "react";
import {
  Modal,
  Paper,
  Typography,
  Button,
} from "@mui/material";
import { MapContainer, TileLayer, Marker, Polyline } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import api from "../services/api";

function ShipperLoadDetailsModal({ load, userRole, onClose, onAcceptLoad }) {
  const [route, setRoute] = useState([]);
  const [distance, setDistance] = useState(null);
  const [estimatedTime, setEstimatedTime] = useState(null);

  useEffect(() => {
    if (!load) return;
    const fetchRoute = async () => {
      try {
        const token = localStorage.getItem("token");
        const response = await api.get(`/loads/${load._id}/route`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.data.route) {
          // Leaflet needs lat,lng
          const transformed = response.data.route.map(([lng, lat]) => [lat, lng]);
          setRoute(transformed);
          setDistance(response.data.distance);
          setEstimatedTime(response.data.estimatedTime);
        }
      } catch (err) {
        console.error("Error fetching route:", err);
      }
    };
    fetchRoute();
  }, [load]);

  const handleAcceptLoad = () => {
    // If you do acceptance in the modal:
    onAcceptLoad(load);
  };

  return (
    <Modal
      open={!!load}
      onClose={onClose}
      sx={{ display: "flex", justifyContent: "center", alignItems: "center" }}
    >
      <Paper sx={{ p: 4, maxWidth: 800, width: "100%" }}>
        <Typography variant="h6">Load Details</Typography>
        <Typography>
          <strong>Title:</strong> {load?.title}
        </Typography>
        <Typography>
          <strong>Origin:</strong> {load?.origin}
        </Typography>
        <Typography>
          <strong>Destination:</strong> {load?.destination}
        </Typography>
        <Typography>
          <strong>Rate:</strong> ${load?.rate}
        </Typography>
        <Typography>
          <strong>Status:</strong> {load?.status}
        </Typography>

        <Typography sx={{ mt: 2 }}>
          <strong>Distance (Origin → Destination):</strong>{" "}
          {distance ? `${distance} miles` : "Calculating..."}
        </Typography>
        <Typography>
          <strong>Estimated Time:</strong>{" "}
          {estimatedTime ? `${estimatedTime} hours` : "Calculating..."}
        </Typography>

        {route.length > 0 ? (
          <MapContainer
            center={route[0]}
            zoom={6}
            style={{ height: "400px", width: "100%", marginTop: "10px" }}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Marker position={route[0]} />
            <Marker position={route[route.length - 1]} />
            <Polyline positions={route} color="blue" />
          </MapContainer>
        ) : (
          <Typography sx={{ mt: 2 }}>No route data available.</Typography>
        )}

        {/* Conditionally show Accept Load if carrier & status open */}
        {userRole === "carrier" && load?.status === "open" && (
          <Button
            variant="contained"
            color="primary"
            sx={{ mt: 2, mr: 2 }}
            onClick={handleAcceptLoad}
          >
            Accept Load
          </Button>
        )}

        <Button
          variant="contained"
          color="secondary"
          sx={{ mt: 2 }}
          onClick={onClose}
        >
          Close
        </Button>
      </Paper>
    </Modal>
  );
}

export default ShipperLoadDetailsModal;
