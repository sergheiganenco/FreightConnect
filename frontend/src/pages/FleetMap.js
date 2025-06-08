// src/pages/FleetMap.js

import React, { useEffect, useState } from "react";
import {
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Chip,
  Divider,
  CircularProgress,
} from "@mui/material";
import { MapContainer, TileLayer, Marker } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import api from "../services/api";
import socket from "../services/socket";

// Remove Leaflet icon warnings in dev:
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require("leaflet/dist/images/marker-icon-2x.png"),
  iconUrl: require("leaflet/dist/images/marker-icon.png"),
  shadowUrl: require("leaflet/dist/images/marker-shadow.png"),
});

const statusColors = {
  Available: "success",
  Assigned: "info",
  "At Pickup": "info",
  Loading: "warning",
  "In Transit": "primary",
  "At Delivery": "info",
  Delivered: "success",
  Maintenance: "secondary",
  Offline: "default",
};

export default function FleetMap() {
  const [fleet, setFleet] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState({ open: false, truck: null });

  useEffect(() => {
    fetchFleet();
    socket.on("fleetUpdated", fetchFleet);
    return () => socket.off("fleetUpdated", fetchFleet);
    // eslint-disable-next-line
  }, []);

  async function fetchFleet() {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const { data } = await api.get("/users/fleet", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setFleet(data.fleet || []);
    } catch (err) {
      // Optionally handle error
    } finally {
      setLoading(false);
    }
  }

  // Filter trucks with location
  const trucksWithLocation = fleet.filter(
    (t) =>
      t.location &&
      Number(t.location.latitude) &&
      Number(t.location.longitude)
  );

  return (
    <Box sx={{ pt: 3, width: "100%", maxWidth: 1400, mx: "auto", height: "80vh" }}>
      <Typography variant="h5" sx={{ mb: 2, color: "#fff", fontWeight: 700 }}>
        Live Fleet Map
      </Typography>

      <Box sx={{ borderRadius: 4, overflow: "hidden", boxShadow: 2, bgcolor: "#181b2a" }}>
        {loading ? (
          <CircularProgress sx={{ mt: 10, mx: "auto", display: "block" }} />
        ) : (
          <MapContainer
            center={[38, -96]} // Center of the USA
            zoom={5}
            style={{ height: "65vh", width: "100%" }}
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {trucksWithLocation.map((truck) => (
              <Marker
                key={truck.truckId}
                position={[
                  Number(truck.location.latitude),
                  Number(truck.location.longitude),
                ]}
                icon={new L.Icon.Default()}
                eventHandlers={{
                  click: () => setDialog({ open: true, truck }),
                }}
              >
                {/* No <Popup> here! */}
                <span style={{ display: "none" }} />
              </Marker>
            ))}
          </MapContainer>
        )}
      </Box>

      {/* Dialog for truck info */}
      <Dialog
        open={dialog.open}
        onClose={() => setDialog({ open: false, truck: null })}
        PaperProps={{
          sx: {
            minWidth: 340,
            bgcolor: "#192233",
            color: "#fff",
            borderRadius: 4,
            boxShadow: 6,
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700, fontSize: 22, color: "#fff" }}>
          Truck Details
        </DialogTitle>
        <DialogContent>
          {dialog.truck && (
            <Box>
              <Typography fontWeight={700} sx={{ fontSize: 19, mb: 1 }}>
                {dialog.truck.truckId}
              </Typography>
              <Divider sx={{ mb: 1, borderColor: "#333" }} />
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                <b>Driver:</b> {dialog.truck.driverName || <i>Unassigned</i>}
              </Typography>
              <Chip
                label={dialog.truck.status}
                color={statusColors[dialog.truck.status] || "default"}
                size="small"
                sx={{ my: 1, fontWeight: 600, fontSize: 15 }}
              />
              <Divider sx={{ my: 1, borderColor: "#333" }} />
              <Typography variant="body2">
                <b>Location:</b> <br />
                Lat: {dialog.truck.location?.latitude || "—"}
                <br />
                Lng: {dialog.truck.location?.longitude || "—"}
              </Typography>

              {/* Load details */}
              {(dialog.truck.assignedLoadDetails ||
                dialog.truck.assignedLoad) && (
                <>
                  <Divider sx={{ my: 1, borderColor: "#333" }} />
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    Assigned Load:
                  </Typography>
                  <Typography variant="body2" sx={{ fontSize: 16 }}>
                    <b>
                      {dialog.truck.assignedLoadDetails?.origin ||
                        dialog.truck.assignedLoad?.origin ||
                        "—"}
                      {" → "}
                      {dialog.truck.assignedLoadDetails?.destination ||
                        dialog.truck.assignedLoad?.destination ||
                        "—"}
                    </b>
                    <br />
                    <span style={{ fontSize: 13, color: "#aaa" }}>
                      (
                      {dialog.truck.assignedLoadDetails?.title ||
                        dialog.truck.assignedLoad?.title ||
                        "Untitled"}
                      )
                    </span>
                  </Typography>
                </>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ bgcolor: "#192233" }}>
          <Button
            onClick={() => setDialog({ open: false, truck: null })}
            variant="contained"
            sx={{
              bgcolor: "primary.main",
              color: "#fff",
              borderRadius: 2,
              px: 3,
              fontWeight: 700,
              fontSize: 16,
              boxShadow: 3,
              ":hover": { bgcolor: "#462aff" },
            }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
