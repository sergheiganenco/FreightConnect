import React, { useEffect, useState } from "react";
import { Box, Typography, CircularProgress, Chip } from "@mui/material";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import api from "../services/api";

export default function CarrierLiveMap() {
  const [fleet, setFleet] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFleet = async () => {
      try {
        const token = localStorage.getItem("token");
        const { data } = await api.get("/users/fleet", {
          headers: { Authorization: `Bearer ${token}` },
        });
        setFleet(data.fleet || []);
      } finally {
        setLoading(false);
      }
    };
    fetchFleet();
  }, []);

  // Default center: first truck or somewhere on US
  const center = fleet.length
    ? [fleet[0].location?.latitude || 39.8283, fleet[0].location?.longitude || -98.5795]
    : [39.8283, -98.5795];

  // Custom truck icon (optional)
  const truckIcon = new L.Icon({
    iconUrl: "https://cdn-icons-png.flaticon.com/512/1086/1086933.png",
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  });

  return (
    <Box sx={{ py: 4, px: { xs: 0, md: 2 }, maxWidth: "1200px", mx: "auto" }}>
      <Typography variant="h5" fontWeight={700} sx={{ color: "#fff", mb: 2 }}>
        🚚 Fleet Live Map
      </Typography>

      {loading ? (
        <CircularProgress sx={{ color: "#fff" }} />
      ) : (
        <Box sx={{ height: 540, borderRadius: 3, overflow: "hidden", boxShadow: 4 }}>
          <MapContainer center={center} zoom={5} style={{ height: "100%", width: "100%" }}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; OpenStreetMap contributors"
            />
            {fleet.map(truck =>
              truck.location?.latitude && truck.location?.longitude ? (
                <Marker
                  key={truck.truckId}
                  position={[truck.location.latitude, truck.location.longitude]}
                  icon={truckIcon}
                >
                  <Popup>
                    <Typography variant="subtitle1" fontWeight={600}>
                      Truck: {truck.truckId}
                    </Typography>
                    <Typography variant="body2">
                      Driver: <b>{truck.driverName || "Unassigned"}</b>
                    </Typography>
                    <Chip
                      size="small"
                      color={
                        truck.status === "Available"
                          ? "success"
                          : truck.status === "In Transit"
                          ? "info"
                          : truck.status === "On Load"
                          ? "warning"
                          : "default"
                      }
                      label={truck.status}
                      sx={{ mt: 1 }}
                    />
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      Lat: {truck.location.latitude.toFixed(4)}<br />
                      Lng: {truck.location.longitude.toFixed(4)}
                    </Typography>
                  </Popup>
                </Marker>
              ) : null
            )}
          </MapContainer>
        </Box>
      )}
    </Box>
  );
}
