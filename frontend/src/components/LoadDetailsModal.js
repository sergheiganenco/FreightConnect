// src/components/LoadDetailsModal.js
import React, { useState, useEffect } from "react";
import { Modal, Paper, Typography, Button } from "@mui/material";
import { MapContainer, TileLayer, Marker, Polyline } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import api from "../services/api";

function LoadDetailsModal({ load, userRole, onClose, onLoadAccepted }) {
  const [route, setRoute] = useState([]);
  const [distance, setDistance] = useState(null);
  const [estimatedTime, setEstimatedTime] = useState(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!load) return;
    const fetchRoute = async () => {
      try {
        const token = localStorage.getItem("token");
        const response = await api.get(`/loads/${load._id}/route`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.data && response.data.route) {
          // Convert from [lng, lat] to [lat, lng] for Leaflet
          const transformed = response.data.route.map(([lng, lat]) => [lat, lng]);
          setRoute(transformed);
          setDistance(response.data.distance);
          setEstimatedTime(response.data.estimatedTime);
        }
      } catch (err) {
        console.error("Error fetching route:", err);
        setErrorMessage("Failed to fetch route data.");
      }
    };
    fetchRoute();
  }, [load]);

  const handleAcceptLoad = async () => {
    try {
      const token = localStorage.getItem("token");
      await api.put(`/loads/${load._id}/accept`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSuccessMessage("Load accepted successfully!");
      // Notify parent so that the load is removed/updated in the list
      if (onLoadAccepted) onLoadAccepted(load._id);
    } catch (err) {
      console.error("Error accepting load:", err);
      setErrorMessage("Could not accept load. Please try again.");
    }
  };

  return (
    <Modal
      open={!!load}
      onClose={onClose}
      sx={{ display: "flex", justifyContent: "center", alignItems: "center" }}
    >
      <Paper sx={{ p: 4, maxWidth: 800, width: "100%" }}>
        <Typography variant="h6">Load Details</Typography>
        <Typography><strong>Title:</strong> {load?.title}</Typography>
        <Typography><strong>Origin:</strong> {load?.origin}</Typography>
        <Typography><strong>Destination:</strong> {load?.destination}</Typography>
        <Typography><strong>Rate:</strong> ${load?.rate}</Typography>
        <Typography><strong>Status:</strong> {load?.status}</Typography>
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

        {/* Only show Accept Load if the load is still open */}
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

        {/* If the load is already accepted, show a success message */}
        {load?.status !== "open" && successMessage && (
          <Typography color="green" sx={{ mt: 2 }}>
            {successMessage}
          </Typography>
        )}

        <Button variant="contained" color="secondary" sx={{ mt: 2 }} onClick={onClose}>
          Close
        </Button>

        {errorMessage && (
          <Typography color="error" sx={{ mt: 2 }}>
            {errorMessage}
          </Typography>
        )}
      </Paper>
    </Modal>
  );
}

export default LoadDetailsModal;
